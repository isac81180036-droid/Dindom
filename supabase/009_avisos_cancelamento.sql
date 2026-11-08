-- =====================================================================
-- Dindom · aviso de pedido cancelado (no app e no celular)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado é apagado.
--
-- Quando a Cardápio Web cancela um pedido, a sincronização (003) traz o pedido completo, com o motivo
-- ("cancellation_reason"). Neste momento:
--   1. entra uma notificação no app (records › notifications, tipo "cancel"), que abre o aviso na tela
--      de gerentes e administradores com o app aberto;
--   2. se a função "dindom-push" estiver publicada no Supabase (Edge Functions), vai um aviso para
--      o celular, mesmo com o app fechado (Web Push).
-- Cancelamentos antigos (de antes deste SQL ou do histórico) não geram aviso.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Configuração do envio (só o servidor lê) ----------
create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  url text,                 -- endereço da função dindom-push
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'), -- o banco prova para a função que é ele
  vapid_public text,        -- chaves do Web Push: a função cria na primeira vez
  vapid_private text
);
insert into public.push_config (id, url) values (1, 'https://lcohonwvajfiztrxbncm.supabase.co/functions/v1/dindom-push')
  on conflict (id) do nothing;
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- ---------- Celulares que recebem aviso ----------
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists push_subs_own on public.push_subs;
create policy push_subs_own on public.push_subs for select to authenticated using (user_id = auth.uid());
revoke all on public.push_subs from anon;
grant select on public.push_subs to authenticated;

-- Liga este celular (troca o dono se outra pessoa já usou o mesmo aparelho).
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores recebem os avisos de cancelamento.'; end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Inscrição inválida.'; end if;
  delete from push_subs where endpoint = p_endpoint;
  insert into push_subs (org_id, user_id, endpoint, p256dh, auth, ua) values (o, auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200));
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- ---------- Aviso de cancelamento ----------
alter table public.cw_orders add column if not exists cancel_notified_at timestamptz;
-- O que já estava cancelado não avisa.
update public.cw_orders set cancel_notified_at = now() where status in ('canceled', 'canceling') and cancel_notified_at is null;

-- Códigos do iFood e outros apps → português. Texto livre (ex.: "Pedido em duplicidade") passa como está.
create or replace function public.cw_cancel_reason(r text) returns text language sql immutable as $$
  select case upper(coalesce(r, ''))
    when '' then null
    when 'CUSTOMER_NOT_FOUND' then 'Cliente não encontrado na entrega'
    when 'CONSUMER_CANCELLATION_REQUESTED' then 'O cliente pediu o cancelamento'
    when 'CUSTOMER_CANCELLATION_REQUESTED' then 'O cliente pediu o cancelamento'
    when 'DUPLICATE_ORDER' then 'Pedido em duplicidade'
    when 'SYSTEMIC_ISSUES' then 'Problema no sistema'
    when 'UNAVAILABLE_ITEM' then 'Item indisponível'
    when 'RESTAURANT_WITHOUT_DELIVERY_MAN' then 'Loja sem entregador'
    when 'OUTDATED_MENU' then 'Cardápio desatualizado'
    when 'ORDER_OUTSIDE_THE_DELIVERY_AREA' then 'Endereço fora da área de entrega'
    when 'OUTSIDE_DELIVERY_AREA' then 'Endereço fora da área de entrega'
    when 'BLOCKED_CUSTOMER' then 'Cliente bloqueado'
    when 'OUTSIDE_DELIVERY_HOURS' then 'Fora do horário de entrega'
    when 'INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT' then 'Dificuldades internas da loja'
    when 'RISK_AREA' then 'Área de risco'
    when 'RESTAURANT_CLOSED' then 'Loja fechada'
    when 'DELIVERY_FAILED' then 'A entrega não deu certo'
    when 'PAYMENT_FAILED' then 'Pagamento não aprovado'
    when 'TIMEOUT' then 'Pedido não aceito a tempo'
    when 'ORDER_TIMEOUT' then 'Pedido não aceito a tempo'
    else case when r ~ '^[A-Z0-9_]+$' then initcap(replace(r, '_', ' ')) else r end
  end
$$;

create or replace function public.cw_cancel_alert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg push_config;
  reason text; channel text; num text; title text; body text; nid text;
begin
  if new.status not in ('canceled', 'canceling') or new.cancel_notified_at is not null then return new; end if;
  -- Cancelamento antigo (histórico): marca como avisado sem avisar.
  if coalesce(new.updated_at, new.created_at) < now() - interval '6 hours' then
    new.cancel_notified_at := now(); return new;
  end if;
  -- Espera o pedido completo, que traz o motivo (chega na mesma rodada da sincronização).
  if new.needs_detail then return new; end if;

  new.cancel_notified_at := now();
  begin
    reason := cw_cancel_reason(new.data->>'cancellation_reason');
    channel := case new.sales_channel when 'food99' then '99Food' when 'ifood' then 'iFood' when 'catalog' then 'Cardápio digital'
      when 'store_front_catalog' then 'Cardápio da loja' when 'portal' then 'Balcão' when 'whatsapp_extension' then 'WhatsApp'
      else coalesce(new.sales_channel, '') end;
    num := coalesce(new.display_id::text, new.id::text);
    nid := 'cx-' || new.id;
    title := 'Pedido #' || num || ' cancelado' || case when channel <> '' then ' · ' || channel else '' end;
    body := coalesce('Motivo: ' || reason, 'Sem motivo informado') ||
      case when new.total is not null then ' · R$ ' || translate(to_char(new.total, 'FM999,999,990.00'), ',.', '.,') else '' end ||
      coalesce(' · ' || nullif(new.data->'customer'->>'name', ''), '');

    insert into records (org_id, collection, id, data) values (new.org_id, 'notifications', nid, jsonb_build_object(
      'id', nid, 'kind', 'cancel', 'roles', jsonb_build_array('gerente', 'admin'),
      'text', title || '. ' || body,
      'at', to_char(now() at time zone 'America/Fortaleza', 'DD/MM/YYYY "às" HH24:MI'),
      'ts', (extract(epoch from now()) * 1000)::bigint,
      'tone', 'crit', 'icon', 'alert', 'href', '#vendas', 'read', false,
      'cancel', jsonb_build_object(
        'order', new.id, 'number', num, 'channel', channel, 'type', new.order_type, 'total', new.total,
        'customer', new.data->'customer'->>'name', 'reason', reason, 'created_at', new.created_at,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('q', i->'quantity', 'name', i->>'name')), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(new.data->'items', '[]'::jsonb)) i))))
    on conflict (org_id, collection, id) do nothing;

    -- Celular (Web Push), se a função estiver publicada.
    select * into cfg from push_config where id = 1;
    if cfg.url is not null and exists (select 1 from push_subs where org_id = new.org_id) then
      perform net.http_post(
        url := cfg.url,
        body := jsonb_build_object('org_id', new.org_id, 'title', title, 'body', body, 'url', '#vendas', 'tag', nid),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-dindom-secret', cfg.secret));
    end if;
  exception when others then
    null; -- o aviso nunca pode travar a sincronização dos pedidos
  end;
  return new;
end $$;

drop trigger if exists cw_orders_cancel_alert on public.cw_orders;
create trigger cw_orders_cancel_alert before insert or update on public.cw_orders
  for each row execute function public.cw_cancel_alert();
