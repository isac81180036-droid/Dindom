-- =====================================================================
-- Dindom · Relatórios › mapa de calor das entregas
-- Rode DEPOIS do 010_relatorios.sql. Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado é apagado.
--
-- O que muda:
-- • Cada pedido de entrega passa a guardar a posição APROXIMADA do endereço: latitude e longitude
--   arredondadas para 3 casas (um quadrado de uns 110 m, mais ou menos um quarteirão). Rua, número,
--   complemento e telefone continuam sem ser guardados.
-- • Os pedidos de entrega dos últimos 6 meses são buscados de novo na Cardápio Web, aos poucos
--   (45 por minuto, os mais recentes primeiro), para ganhar essa posição. Não gera aviso de cancelamento.
-- • cw_mapa: a tela Relatórios › Entrega e bairros pede os pontos do mapa já somados.
-- =====================================================================

-- Número em texto → numeric (o mesmo do 010; repetido aqui para este arquivo rodar sozinho).
create or replace function public.cw_num(t text) returns numeric
language sql immutable as $$ select case when t ~ '^-?[0-9]+(\.[0-9]+)?$' then t::numeric end $$;

-- Pedido guardado: o mesmo do 004, agora com a posição aproximada da entrega ("v": 3).
create or replace function public.cw_clean(o jsonb) returns jsonb
language sql immutable as $$
  select (o - 'customer' - 'delivery_address' - 'public_id') || jsonb_build_object(
    'v', 3,
    'customer', case when jsonb_typeof(o->'customer') = 'object'
      then jsonb_build_object('id', o->'customer'->'id', 'name', public.cw_short_name(o->'customer'->>'name')) end,
    'neighborhood', nullif(trim(coalesce(o->'delivery_address'->>'neighborhood', '')), ''),
    'geo', case
      when public.cw_num(o->'delivery_address'->>'latitude') between -90 and 90
       and public.cw_num(o->'delivery_address'->>'longitude') between -180 and 180
       and not (public.cw_num(o->'delivery_address'->>'latitude') = 0 and public.cw_num(o->'delivery_address'->>'longitude') = 0)
      then jsonb_build_array(round(public.cw_num(o->'delivery_address'->>'latitude'), 3), round(public.cw_num(o->'delivery_address'->>'longitude'), 3)) end)
$$;

-- Pontos do mapa: pedidos de entrega do período (sem os canais fora da conta), somados por quadrado de ~110 m.
-- Cada ponto traz o bairro mais comum dele, para a tabela da tela.
create or replace function public.cw_mapa(p_from timestamptz, p_to timestamptz, p_exclude text[] default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o uuid; ex text[] := coalesce(p_exclude, '{}'::text[]);
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores veem os relatórios.'; end if;
  return (
    with d as (
      select (data->'geo'->>0)::numeric as lat, (data->'geo'->>1)::numeric as lng, total,
        nullif(trim(data->>'neighborhood'), '') as nb, coalesce((data->>'v')::int, 1) as v, needs_detail
      from cw_orders
      where org_id = o and order_type = 'delivery' and created_at >= p_from and created_at < p_to
        and status not in ('canceled', 'canceling', 'pending_online_payment') and total is not null
        and not (coalesce(sales_channel, '') = any(ex))
    )
    select jsonb_build_object(
      'deliveries', (select count(*) from d),
      'with_geo', (select count(*) from d where lat is not null),
      -- Ainda sem posição porque o pedido não foi buscado de novo (some sozinho em algumas horas).
      'pending', (select count(*) from d where lat is null and v < 3),
      'points', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (
        select lat, lng, count(*) as n, coalesce(sum(total), 0) as v, mode() within group (order by nb) as nb
        from d where lat is not null group by lat, lng) t))
  );
end $$;

revoke all on function public.cw_mapa(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.cw_mapa(timestamptz, timestamptz, text[]) to authenticated;

-- Pedidos de entrega já guardados: busca de novo para ganhar a posição (só na primeira vez que este arquivo roda).
update public.cw_orders set needs_detail = true
where order_type = 'delivery' and data is not null and coalesce((data->>'v')::int, 1) < 3 and not needs_detail
  and status not in ('canceled', 'canceling') and created_at > now() - interval '175 days';
