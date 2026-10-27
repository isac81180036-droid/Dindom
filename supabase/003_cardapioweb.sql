-- =====================================================================
-- Dindom · integração com a Cardápio Web (pedidos e vendas)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado do app é apagado.
--
-- Como funciona:
-- • O administrador cola no app o token da API (Portal da Cardápio Web › Configurações ›
--   Integrações › API). O token fica só aqui no banco: nenhuma tela consegue lê-lo de volta.
-- • A cada minuto o próprio banco busca os pedidos novos e alterados (pg_cron + http) e
--   guarda um resumo de cada pedido em cw_orders, sem telefone nem endereço do cliente.
-- • Na primeira ligação, traz também o histórico dos últimos 30 dias, aos poucos.
-- • Gerentes e administradores veem as vendas; colaboradores e contabilidade, não.
-- =====================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- ---------- Tabelas ----------

-- Ligação com a loja na Cardápio Web. Sem políticas de leitura: o app nunca vê o token.
create table if not exists public.cw_config (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  api_key text not null,
  env text not null default 'producao' check (env in ('producao', 'sandbox')),
  merchant_id bigint,
  merchant_name text,
  last_poll timestamptz,          -- até quando os pedidos alterados já foram buscados
  backfill_from timestamptz,      -- histórico a trazer: início do período
  backfill_page int,              -- próxima página do histórico (null = histórico completo)
  last_ok timestamptz,
  last_error text,
  error_at timestamptz,
  connected_at timestamptz not null default now(),
  connected_by uuid
);
alter table public.cw_config enable row level security;

-- Pedidos. "data" é o pedido completo da API, sem telefone e endereço do cliente.
create table if not exists public.cw_orders (
  org_id uuid not null references public.orgs(id) on delete cascade,
  id bigint not null,
  display_id int,
  status text not null,
  order_type text,
  sales_channel text,
  created_at timestamptz not null,
  updated_at timestamptz,
  total numeric,
  data jsonb,
  needs_detail boolean not null default true,  -- falta buscar (ou atualizar) o pedido completo
  synced_at timestamptz,
  primary key (org_id, id)
);
create index if not exists cw_orders_created on public.cw_orders (org_id, created_at);
create index if not exists cw_orders_pending on public.cw_orders (org_id, created_at) where needs_detail;
alter table public.cw_orders enable row level security;

drop policy if exists "gestores leem os pedidos" on public.cw_orders;
create policy "gestores leem os pedidos" on public.cw_orders for select using (public.is_manager(org_id));

-- ---------- Chamadas à API (só o servidor usa) ----------

create or replace function public.cw_iso(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

create or replace function public.cw_get(p_env text, p_key text, p_path text, out status int, out body jsonb)
language plpgsql security definer set search_path = public, extensions as $$
declare r extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MSEC', '6000');
  r := extensions.http((
    'GET',
    (case when p_env = 'sandbox' then 'https://integracao.sandbox.cardapioweb.com' else 'https://integracao.cardapioweb.com' end) || '/api/partner/v1' || p_path,
    array[extensions.http_header('X-API-KEY', p_key), extensions.http_header('Accept', 'application/json')],
    null, null)::extensions.http_request);
  status := r.status;
  begin body := r.content::jsonb; exception when others then body := null; end;
end $$;

-- Grava a lista resumida (polling ou histórico). Pedido novo ou alterado fica marcado para buscar o completo.
create or replace function public.cw_upsert_lite(p_org uuid, p_list jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into cw_orders (org_id, id, status, order_type, sales_channel, created_at, updated_at, needs_detail)
  select p_org, (x->>'id')::bigint, x->>'status', x->>'order_type', x->>'sales_channel',
    (x->>'created_at')::timestamptz, (x->>'updated_at')::timestamptz, true
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  where x->>'id' is not null
  on conflict (org_id, id) do update set
    status = excluded.status, order_type = excluded.order_type, sales_channel = excluded.sales_channel,
    updated_at = excluded.updated_at, needs_detail = true
  where cw_orders.updated_at is distinct from excluded.updated_at or cw_orders.status <> excluded.status;
  get diagnostics n = row_count;
  return n;
end $$;

-- Pedido completo → o que fica guardado (sem telefone e endereço; só o primeiro nome e o bairro).
create or replace function public.cw_clean(o jsonb) returns jsonb
language sql immutable as $$
  select (o - 'customer' - 'delivery_address' - 'public_id') || jsonb_build_object(
    'customer', jsonb_build_object('name', nullif(split_part(trim(coalesce(o->'customer'->>'name', '')), ' ', 1), '')),
    'neighborhood', o->'delivery_address'->>'neighborhood')
$$;

-- ---------- Sincronização (roda a cada minuto pelo pg_cron) ----------

create or replace function public.cw_sync_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c cw_config;
  res record;
  started timestamptz := clock_timestamp();
  since timestamptz;
  pages int;
  r record;
  err text;
begin
  select * into c from cw_config where org_id = p_org;
  if not found then return; end if;

  -- 1. Pedidos novos e alterados (a API só aceita até 24 horas atrás).
  begin
    if c.last_poll is not null and c.last_poll < started - interval '23 hours' and c.backfill_page is null then
      -- Ficou mais de um dia sem buscar: o histórico cobre o buraco.
      update cw_config set backfill_from = c.last_poll - interval '1 hour', backfill_page = 1 where org_id = p_org;
      c.backfill_from := c.last_poll - interval '1 hour'; c.backfill_page := 1;
    end if;
    since := greatest(coalesce(c.last_poll, started - interval '8 hours') - interval '2 minutes', started - interval '23 hours');
    select * into res from cw_get(c.env, c.api_key, '/orders?updated_since=' || cw_iso(since));
    if res.status = 401 then
      err := 'A Cardápio Web recusou o token. O administrador precisa colar um token novo em Vendas › Conexão.';
    elsif res.status <> 200 or jsonb_typeof(res.body) <> 'array' then
      err := 'A Cardápio Web respondeu com erro ' || res.status || ' ao buscar os pedidos.';
    else
      perform cw_upsert_lite(p_org, res.body);
      update cw_config set last_poll = started where org_id = p_org;
    end if;
  exception when others then
    err := 'A Cardápio Web não respondeu (' || sqlerrm || ').';
  end;
  if err is not null then
    update cw_config set last_error = err, error_at = clock_timestamp() where org_id = p_org;
    return;
  end if;

  -- 2. Histórico (uma página de 100 pedidos por vez, até completar).
  if c.backfill_page is not null then
    begin
      select * into res from cw_get(c.env, c.api_key, '/orders/history?start_date=' || cw_iso(c.backfill_from) ||
        '&end_date=' || cw_iso(started) || '&per_page=100&page=' || c.backfill_page);
      if res.status = 200 then
        perform cw_upsert_lite(p_org, res.body->'orders');
        pages := coalesce((res.body->'pagination'->>'total_pages')::int, 0);
        update cw_config set backfill_page = case when c.backfill_page >= pages then null else c.backfill_page + 1 end where org_id = p_org;
      elsif res.status = 400 then
        update cw_config set backfill_page = null where org_id = p_org; -- período fora do aceito pela API: desiste do histórico
      end if;
    exception when others then null; -- tenta de novo no próximo minuto
    end;
  end if;

  -- 3. Pedidos completos: os mais recentes primeiro. 30 por minuto deixa folga no limite da API
  --    (300 a cada 3 minutos por loja, dividido com outros sistemas que a pizzaria use).
  for r in select id from cw_orders where org_id = p_org and needs_detail order by created_at desc limit 30 loop
    begin
      select * into res from cw_get(c.env, c.api_key, '/orders/' || r.id);
    exception when others then exit;
    end;
    exit when res.status = 429;
    if res.status = 404 then
      update cw_orders set needs_detail = false, synced_at = clock_timestamp() where org_id = p_org and id = r.id;
    elsif res.status = 200 and res.body ? 'id' then
      update cw_orders set
        data = cw_clean(res.body),
        total = (res.body->>'total')::numeric,
        display_id = (res.body->>'display_id')::int,
        status = coalesce(res.body->>'status', status),
        order_type = coalesce(res.body->>'order_type', order_type),
        sales_channel = coalesce(res.body->>'sales_channel', sales_channel),
        updated_at = coalesce((res.body->>'updated_at')::timestamptz, updated_at),
        needs_detail = false,
        synced_at = clock_timestamp()
      where org_id = p_org and id = r.id;
    else
      exit;
    end if;
  end loop;

  update cw_config set last_ok = clock_timestamp(), last_error = null, error_at = null where org_id = p_org;
end $$;

create or replace function public.cw_sync() returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('dindom-cw-sync')) then return; end if; -- já tem uma rodando
  for o in select org_id from cw_config loop
    begin
      perform cw_sync_org(o);
    exception when others then
      update cw_config set last_error = sqlerrm, error_at = clock_timestamp() where org_id = o;
    end;
  end loop;
end $$;

-- ---------- Chamadas do app ----------

-- O administrador liga (ou troca) a loja. Confere o token na hora e devolve o nome da loja.
create or replace function public.cw_connect(p_key text, p_env text) returns text
language plpgsql security definer set search_path = public as $$
declare o uuid; res record; k text := trim(coalesce(p_key, '')); mid bigint;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador liga a Cardápio Web.'; end if;
  if p_env not in ('producao', 'sandbox') then raise exception 'Ambiente inválido.'; end if;
  if length(k) < 10 then raise exception 'Cole o token da API gerado no Portal da Cardápio Web.'; end if;
  begin
    select * into res from cw_get(p_env, k, '/merchant');
  exception when others then
    raise exception 'A Cardápio Web não respondeu. Tente de novo em instantes.';
  end;
  if res.status = 401 then raise exception 'A Cardápio Web não aceitou este token. Confira se copiou o token inteiro.'; end if;
  if res.status <> 200 or res.body->>'id' is null then raise exception 'A Cardápio Web respondeu com erro %. Tente de novo em instantes.', res.status; end if;
  mid := (res.body->>'id')::bigint;
  -- Outra loja (ou ambiente): os pedidos guardados eram da anterior.
  if exists (select 1 from cw_config where org_id = o and (merchant_id is distinct from mid or env <> p_env)) then
    delete from cw_orders where org_id = o;
  end if;
  insert into cw_config (org_id, api_key, env, merchant_id, merchant_name, last_poll, backfill_from, backfill_page, last_ok, last_error, error_at, connected_at, connected_by)
  values (o, k, p_env, mid, res.body->>'name', null, now() - interval '30 days', 1, null, null, null, now(), auth.uid())
  on conflict (org_id) do update set
    api_key = excluded.api_key, env = excluded.env, merchant_id = excluded.merchant_id, merchant_name = excluded.merchant_name,
    last_poll = null, backfill_from = excluded.backfill_from, backfill_page = 1,
    last_error = null, error_at = null, connected_at = now(), connected_by = auth.uid();
  return res.body->>'name';
end $$;

-- Desliga: apaga o token e para a sincronização. Os pedidos já guardados continuam nos relatórios.
create or replace function public.cw_disconnect() returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador desliga a Cardápio Web.'; end if;
  delete from cw_config where org_id = o;
end $$;

-- Tudo o que a tela de Vendas mostra, já somado: situação da ligação, totais do período,
-- pedidos em andamento e rankings. Período pela data de criação do pedido.
create or replace function public.cw_report(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o uuid; c cw_config; st jsonb; result jsonb;
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores veem as vendas.'; end if;
  select * into c from cw_config where org_id = o;
  st := jsonb_build_object(
    'connected', c.org_id is not null,
    'merchant', c.merchant_name,
    'merchant_id', c.merchant_id,
    'env', c.env,
    'connected_at', c.connected_at,
    'last_ok', c.last_ok,
    'error', case when c.error_at is not null and (c.last_ok is null or c.error_at > c.last_ok) then c.last_error end,
    'history', c.backfill_page is not null,
    'queue', (select count(*) from cw_orders where org_id = o and needs_detail),
    'has_orders', exists (select 1 from cw_orders where org_id = o),
    'now', now());

  with base as (
    select * from cw_orders where org_id = o and created_at >= p_from and created_at < p_to
  ), valid as (
    select * from base where status not in ('canceled', 'canceling', 'pending_online_payment')
  ), items as (
    select i from valid v, jsonb_array_elements(coalesce(v.data->'items', '[]'::jsonb)) i
    where coalesce(i->>'status', '') <> 'canceled'
  )
  select jsonb_build_object(
    'orders', (select count(*) from valid),
    'revenue', (select coalesce(sum(total), 0) from valid),
    'pending', (select count(*) from valid where total is null),
    'delivery_fees', (select coalesce(sum((data->>'delivery_fee')::numeric), 0) from valid),
    'discounts', (select coalesce(sum((x->>'total')::numeric), 0) from valid v, jsonb_array_elements(coalesce(v.data->'discounts', '[]'::jsonb)) x),
    'canceled', (select count(*) from base where status in ('canceled', 'canceling')),
    'canceled_value', (select coalesce(sum(total), 0) from base where status in ('canceled', 'canceling')),
    'by_type', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (
      select order_type as k, count(*) as n, coalesce(sum(total), 0) as v from valid group by 1) t),
    'by_channel', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (
      select sales_channel as k, count(*) as n, coalesce(sum(total), 0) as v from valid group by 1) t),
    'payments', (select coalesce(jsonb_agg(t order by t.v desc), '[]') from (
      select x->>'payment_method' as k, count(*) as n, sum((x->>'total')::numeric) as v
      from valid v, jsonb_array_elements(coalesce(v.data->'payments', '[]'::jsonb)) x
      where coalesce(x->>'status', '') not in ('cancelled', 'refunded', 'abandoned') group by 1) t),
    'top_items', (select coalesce(jsonb_agg(t order by t.q desc, t.v desc), '[]') from (
      select i->>'name' as name, sum((i->>'quantity')::numeric) as q, sum((i->>'total_price')::numeric) as v
      from items group by 1 order by 2 desc, 3 desc limit 10) t),
    -- Sabores e complementos: quantidade da opção vezes a quantidade do item.
    'top_options', (select coalesce(jsonb_agg(t order by t.q desc), '[]') from (
      select x->>'option_group_name' as grp, x->>'name' as name, sum((x->>'quantity')::numeric * (i->>'quantity')::numeric) as q
      from items, jsonb_array_elements(coalesce(i->'options', '[]'::jsonb)) x group by 1, 2 order by 3 desc limit 10) t)
  ) into result;

  return result || jsonb_build_object('status', st,
    -- Em andamento agora (independe do período escolhido).
    'live', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from (
      select id, display_id, status, order_type, created_at, total,
        data->'customer'->>'name' as customer, (data->>'estimated_time')::int as est, data->'items' as items
      from cw_orders where org_id = o and created_at > now() - interval '24 hours'
        and status in ('waiting_confirmation', 'pending_payment', 'scheduled_confirmed', 'confirmed', 'ready', 'waiting_to_catch', 'released')
      order by created_at limit 60) t));
end $$;

-- ---------- Permissões ----------

revoke all on function public.cw_get(text, text, text) from public, anon, authenticated;
revoke all on function public.cw_upsert_lite(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cw_sync_org(uuid) from public, anon, authenticated;
revoke all on function public.cw_sync() from public, anon, authenticated;
revoke all on function public.cw_connect(text, text) from public, anon;
revoke all on function public.cw_disconnect() from public, anon;
revoke all on function public.cw_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.cw_connect(text, text) to authenticated;
grant execute on function public.cw_disconnect() to authenticated;
grant execute on function public.cw_report(timestamptz, timestamptz) to authenticated;

-- ---------- Tempo real e agendamento ----------

-- A tela de Vendas atualiza sozinha quando chega pedido.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cw_orders') then
    alter publication supabase_realtime add table public.cw_orders;
  end if;
end $$;

-- Busca os pedidos a cada minuto (o mesmo nome substitui o agendamento anterior).
select cron.schedule('dindom-cardapioweb', '* * * * *', 'select public.cw_sync()');
