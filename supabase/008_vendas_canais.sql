-- =====================================================================
-- Dindom · Vendas: filtro por canal de venda (ex.: tirar o 99Food da conta)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado é apagado.
--
-- O relatório de vendas (cw_report) ganha o parâmetro opcional p_exclude: canais que ficam fora de
-- faturamento, pedidos, cancelados, mais vendidos, sabores, tipos, pagamentos e pedidos em andamento.
-- "by_channel" continua trazendo todos os canais, para a tela mostrar o que dá para pôr de volta.
-- Chamadas antigas (sem p_exclude) continuam funcionando igual.
-- =====================================================================

drop function if exists public.cw_report(timestamptz, timestamptz);

create or replace function public.cw_report(p_from timestamptz, p_to timestamptz, p_exclude text[] default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o uuid; c cw_config; st jsonb; result jsonb; ex text[] := coalesce(p_exclude, '{}'::text[]);
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

  with base_all as (
    select * from cw_orders where org_id = o and created_at >= p_from and created_at < p_to
  ), base as (
    select * from base_all where not (coalesce(sales_channel, '') = any(ex))
  ), valid as (
    select * from base where status not in ('canceled', 'canceling', 'pending_online_payment')
  ), valid_all as (
    select * from base_all where status not in ('canceled', 'canceling', 'pending_online_payment')
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
    -- Todos os canais, mesmo os filtrados: a tela mostra cada um com o valor para pôr de volta.
    'by_channel', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (
      select sales_channel as k, count(*) as n, coalesce(sum(total), 0) as v from valid_all group by 1) t),
    'payments', (select coalesce(jsonb_agg(t order by t.v desc), '[]') from (
      select x->>'payment_method' as k, count(*) as n, sum((x->>'total')::numeric) as v
      from valid v, jsonb_array_elements(coalesce(v.data->'payments', '[]'::jsonb)) x
      where coalesce(x->>'status', '') not in ('cancelled', 'refunded', 'abandoned') group by 1) t),
    'top_items', (select coalesce(jsonb_agg(t order by t.q desc, t.v desc), '[]') from (
      select i->>'name' as name, sum((i->>'quantity')::numeric) as q, sum((i->>'total_price')::numeric) as v
      from items group by 1 order by 2 desc, 3 desc limit 10) t),
    'top_options', (select coalesce(jsonb_agg(t order by t.q desc), '[]') from (
      select x->>'option_group_name' as grp, x->>'name' as name, sum((x->>'quantity')::numeric * (i->>'quantity')::numeric) as q
      from items, jsonb_array_elements(coalesce(i->'options', '[]'::jsonb)) x group by 1, 2 order by 3 desc limit 10) t),
    'excluded', to_jsonb(ex)
  ) into result;

  return result || jsonb_build_object('status', st,
    'live', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from (
      select id, display_id, status, order_type, sales_channel, created_at, total,
        data->'customer'->>'name' as customer, (data->>'estimated_time')::int as est, data->'items' as items
      from cw_orders where org_id = o and created_at > now() - interval '24 hours'
        and not (coalesce(sales_channel, '') = any(ex))
        and status in ('waiting_confirmation', 'pending_payment', 'scheduled_confirmed', 'confirmed', 'ready', 'waiting_to_catch', 'released')
      order by created_at limit 60) t));
end $$;

revoke all on function public.cw_report(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.cw_report(timestamptz, timestamptz, text[]) to authenticated;
