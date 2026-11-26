-- =====================================================================
-- Dindom · Relatórios › Tempos (preparo e entrega)
-- Rode DEPOIS do 011_mapa_calor.sql. Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado é apagado.
--
-- Por que precisa: a Cardápio Web não informa quando o pedido ficou pronto, saiu ou foi entregue,
-- só a hora em que foi feito. Mas o app já confere os pedidos a cada minuto e vê cada troca de etapa
-- (Confirmado → Pronto → Saiu para entrega → Entregue). Este arquivo passa a guardar a hora de cada troca.
--
-- • cw_order_events: a primeira vez que cada pedido apareceu em cada etapa.
-- • Começa a contar a partir de agora: pedidos antigos não têm esses horários.
-- • Só funciona se a equipe mudar a etapa no painel da Cardápio Web NA HORA (marcar "Pronto" quando
--   a pizza sai do forno, "Saiu para entrega" quando o entregador pega, "Entregue" quando ele volta).
-- • cw_tempos: a tela Relatórios › Tempos pede os tempos de cada pedido do período.
-- =====================================================================

create table if not exists public.cw_order_events (
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_id bigint not null,
  status text not null,
  at timestamptz not null,
  primary key (org_id, order_id, status)
);
-- Sem políticas: só as funções abaixo (security definer) leem e escrevem.
alter table public.cw_order_events enable row level security;
create index if not exists cw_order_events_at on public.cw_order_events (org_id, at);

-- Toda troca de etapa de um pedido recente vira um registro com a hora da troca.
-- A hora é o updated_at que a Cardápio Web manda junto (mais exato que a hora da busca),
-- limitada entre a criação do pedido e agora.
create or replace function public.cw_track_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.status is distinct from old.status) and new.created_at > now() - interval '1 day' then
    insert into cw_order_events (org_id, order_id, status, at)
    values (new.org_id, new.id, new.status,
      least(clock_timestamp(), greatest(coalesce(new.updated_at, clock_timestamp()), new.created_at)))
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists cw_orders_status on public.cw_orders;
create trigger cw_orders_status after insert or update of status on public.cw_orders
  for each row execute function public.cw_track_status();

-- Minutos entre dois horários (vazio se faltar um deles ou se estiverem fora de ordem).
create or replace function public.cw_min(a timestamptz, b timestamptz) returns numeric
language sql immutable as $$
  select case when a is null or b is null or b < a then null else round((extract(epoch from (b - a)) / 60)::numeric, 1) end
$$;

-- Tempos de cada pedido de p_from a p_to (sem cancelados e sem os canais fora da conta). A tela pede o período
-- atual junto com o anterior, para comparar; p_cut é onde começa o atual ("orders" conta só o atual).
-- Cada linha: [número, criado em, tipo, canal, bairro, itens, aceite, preparo, marcou pronto?, espera, rua, total]
--   aceite  = feito → confirmado
--   preparo = confirmado (ou feito) → pronto (ou, sem "pronto", até sair para entrega)
--   espera  = pronto → saiu para entrega (pizza pronta esperando o entregador)
--   rua     = saiu para entrega → entregue
--   total   = feito → entregue (retirada: feito → pronto)
create or replace function public.cw_tempos(p_from timestamptz, p_to timestamptz, p_exclude text[] default null, p_cut timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o uuid; ex text[] := coalesce(p_exclude, '{}'::text[]);
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores veem os relatórios.'; end if;
  return (
    with base as (
      select c.id, c.display_id, c.created_at, c.order_type, c.sales_channel, c.data
      from cw_orders c
      where c.org_id = o and c.created_at >= p_from and c.created_at < p_to
        and c.status not in ('canceled', 'canceling', 'pending_online_payment')
        and not (coalesce(c.sales_channel, '') = any(ex))
    ), ev as (
      select e.order_id,
        min(e.at) filter (where e.status = 'confirmed') as conf,
        min(e.at) filter (where e.status in ('ready', 'waiting_to_catch')) as ready,
        min(e.at) filter (where e.status = 'released') as out_at,
        min(e.at) filter (where e.status = 'delivered') as deliv
      from cw_order_events e
      where e.org_id = o and e.order_id in (select id from base)
      group by e.order_id
    ), d as (
      select b.*, ev.conf, ev.ready, ev.out_at, ev.deliv
      from base b join ev on ev.order_id = b.id
      where ev.ready is not null or ev.out_at is not null or ev.deliv is not null
    )
    select jsonb_build_object(
      'since', (select min(at) from cw_order_events where org_id = o),
      'orders', (select count(*) from base where created_at >= coalesce(p_cut, p_from)),
      'rows', (select coalesce(jsonb_agg(jsonb_build_array(
          d.display_id, d.created_at, d.order_type, d.sales_channel, nullif(trim(coalesce(d.data->>'neighborhood', '')), ''),
          (select coalesce(sum(public.cw_num(i->>'quantity')), 0) from jsonb_array_elements(case when jsonb_typeof(d.data->'items') = 'array' then d.data->'items' else '[]'::jsonb end) i),
          public.cw_min(d.created_at, d.conf),
          public.cw_min(coalesce(d.conf, d.created_at), coalesce(d.ready, d.out_at)),
          d.ready is not null,
          public.cw_min(d.ready, d.out_at),
          public.cw_min(d.out_at, d.deliv),
          public.cw_min(d.created_at, case when d.order_type = 'delivery' then d.deliv else coalesce(d.ready, d.deliv) end)
        ) order by d.created_at), '[]'::jsonb) from d))
  );
end $$;

revoke all on function public.cw_tempos(timestamptz, timestamptz, text[], timestamptz) from public, anon;
grant execute on function public.cw_tempos(timestamptz, timestamptz, text[], timestamptz) to authenticated;
revoke all on function public.cw_track_status() from public, anon, authenticated;
