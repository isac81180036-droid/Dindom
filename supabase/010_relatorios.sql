-- =====================================================================
-- Dindom · Relatórios (gráficos e leituras da empresa) e avaliações do Google
-- Rode DEPOIS do 004_insights.sql. Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado do app é apagado.
--
-- O que muda:
-- • cw_insights ganha o parâmetro opcional p_exclude (canais fora da conta, como em Vendas › Resumo).
--   Chamadas antigas, sem ele, continuam funcionando igual.
-- • cw_relatorio: tudo o que a tela Relatórios desenha, já somado: vendas por dia, semana e mês,
--   mapa de dia x hora, faixas de ticket, frequência e safras de clientes, sabores, adicionais,
--   entrega (taxa cobrada x paga ao entregador) e as avaliações da Cardápio Web em detalhe.
-- • Google: o administrador cola a chave da Places API e escolhe a loja. A chave fica só aqui no
--   banco. A nota e as avaliações são buscadas na hora em que a tela abre e NÃO ficam guardadas
--   (regra de uso do Google); só o código do local (place ID) é guardado.
-- • Se um dia rodar o 004_insights.sql de novo, rode este arquivo depois dele.
-- =====================================================================

-- Número em texto → numeric; qualquer outra coisa vira null (campos que a API pode mandar vazios).
create or replace function public.cw_num(t text) returns numeric
language sql immutable as $$ select case when t ~ '^-?[0-9]+(\.[0-9]+)?$' then t::numeric end $$;

-- ---------- Insights: agora com filtro de canal ----------

drop function if exists public.cw_insights(timestamptz, timestamptz, text);

create or replace function public.cw_insights(p_from timestamptz, p_to timestamptz, p_tz text, p_exclude text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  pf timestamptz := p_from - (p_to - p_from);
  tz text := coalesce(nullif(p_tz, ''), 'America/Sao_Paulo');
  ex text[] := coalesce(p_exclude, '{}'::text[]);
  res jsonb := '{}'::jsonb;
  hist_from timestamptz;
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores veem as vendas.'; end if;
  begin perform now() at time zone tz; exception when others then tz := 'America/Sao_Paulo'; end;

  create temp table if not exists cw_tmp_o (id bigint, created_at timestamptz, total numeric, order_type text, sales_channel text,
    cid bigint, cname text, nb text, data jsonb) on commit drop;
  truncate cw_tmp_o;
  insert into cw_tmp_o
  select id, created_at, total, order_type, sales_channel,
    nullif(data->'customer'->>'id', '')::bigint, data->'customer'->>'name', nullif(trim(data->>'neighborhood'), ''), data
  from cw_orders
  where org_id = o and total is not null and status not in ('canceled', 'canceling', 'pending_online_payment')
    and not (coalesce(sales_channel, '') = any(ex));

  select min(created_at) into hist_from from cw_tmp_o;

  -- Visão geral: período atual e o anterior, do mesmo tamanho.
  res := res || jsonb_build_object(
    'history_from', hist_from,
    'excluded', to_jsonb(ex),
    'pending', (select count(*) from cw_orders where org_id = o and needs_detail),
    'without_customer_id', (select count(*) from cw_orders where org_id = o and data is not null and coalesce((data->>'v')::int, 1) < 2),
    'cur', (select jsonb_build_object('orders', count(*), 'revenue', coalesce(sum(total), 0), 'customers', count(distinct cid),
        'items_per_order', round(avg((select sum((i->>'quantity')::numeric) from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) i
          where coalesce(i->>'status', '') <> 'canceled')), 2))
      from cw_tmp_o where created_at >= p_from and created_at < p_to),
    'prev', (select jsonb_build_object('orders', count(*), 'revenue', coalesce(sum(total), 0), 'customers', count(distinct cid))
      from cw_tmp_o where created_at >= pf and created_at < p_from));

  -- Clientes: primeiro e último pedido de cada um em todo o histórico guardado.
  create temp table if not exists cw_tmp_c (cid bigint, name text, first_at timestamptz, last_at timestamptz, n int, spent numeric, n90 int)
    on commit drop;
  truncate cw_tmp_c;
  insert into cw_tmp_c
  select cid, (array_agg(cname order by created_at desc))[1], min(created_at), max(created_at), count(*), sum(total),
    count(*) filter (where created_at > now() - interval '90 days')
  from cw_tmp_o where cid is not null group by cid;

  res := res || jsonb_build_object('customers', jsonb_build_object(
    'known', (select count(*) from cw_tmp_c),
    'new', (select count(*) from cw_tmp_c where first_at >= p_from and first_at < p_to),
    'new_revenue', (select coalesce(sum(t.total), 0) from cw_tmp_o t join cw_tmp_c c using (cid)
      where t.created_at >= p_from and t.created_at < p_to and c.first_at >= p_from and c.first_at < p_to),
    'returning', (select count(distinct t.cid) from cw_tmp_o t join cw_tmp_c c using (cid)
      where t.created_at >= p_from and t.created_at < p_to and c.first_at < p_from),
    -- Recompra: de quem fez o 1º pedido entre 90 e 30 dias atrás, quantos já voltaram.
    'repurchase_base', (select count(*) from cw_tmp_c where first_at between now() - interval '90 days' and now() - interval '30 days'),
    'repurchase_back', (select count(*) from cw_tmp_c where first_at between now() - interval '90 days' and now() - interval '30 days' and n >= 2),
    'avg_gap_days', (select round(avg(extract(epoch from (last_at - first_at)) / 86400 / (n - 1))::numeric, 1) from cw_tmp_c where n >= 2),
    'avg_spent', (select round(avg(spent), 2) from cw_tmp_c),
    'one_time', (select count(*) from cw_tmp_c where n = 1 and last_at < now() - interval '30 days'),
    -- Quanto do faturamento vem dos 20% que mais gastam.
    'top20_share', (select round(100 * sum(spent) filter (where rk <= greatest(1, ceil(cnt * 0.2))) / nullif(sum(spent), 0), 1)
      from (select spent, row_number() over (order by spent desc) as rk, count(*) over () as cnt from cw_tmp_c) s),
    'loyal_count', (select count(*) from cw_tmp_c where n90 >= 3),
    'loyal', (select coalesce(jsonb_agg(t), '[]') from (select cid as id, name, n90 as n, spent, last_at from cw_tmp_c
      where n90 >= 3 order by n90 desc, spent desc limit 15) t),
    'risk_count', (select count(*) from cw_tmp_c where n >= 2 and last_at between now() - interval '60 days' and now() - interval '30 days'),
    'risk', (select coalesce(jsonb_agg(t), '[]') from (select cid as id, name, n, spent, last_at from cw_tmp_c
      where n >= 2 and last_at between now() - interval '60 days' and now() - interval '30 days' order by spent desc limit 15) t),
    'lost_count', (select count(*) from cw_tmp_c where n >= 2 and last_at < now() - interval '60 days'),
    'lost_value', (select coalesce(sum(spent), 0) from cw_tmp_c where n >= 2 and last_at < now() - interval '60 days'),
    'lost', (select coalesce(jsonb_agg(t), '[]') from (select cid as id, name, n, spent, last_at from cw_tmp_c
      where n >= 2 and last_at < now() - interval '60 days' order by spent desc limit 15) t)));

  -- Cadastros (lista de clientes da Cardápio Web): quem se cadastrou e quantos chegaram a pedir.
  res := res || jsonb_build_object('signups', jsonb_build_object(
    'total', (select count(*) from cw_customers where org_id = o),
    'period', (select count(*) from cw_customers where org_id = o and created_at >= p_from and created_at < p_to),
    'period_ordered', (select count(*) from cw_customers k where org_id = o and created_at >= p_from and created_at < p_to
      and exists (select 1 from cw_tmp_c c where c.cid = k.id)),
    'never_ordered', (select count(*) from cw_customers k where org_id = o and created_at >= coalesce(hist_from, now())
      and created_at < now() - interval '7 days' and not exists (select 1 from cw_tmp_c c where c.cid = k.id)),
    'notifications', (select count(*) from cw_customers where org_id = o and notifications)));

  -- Pagamento online começado e não concluído (cliente desistiu no pagamento).
  res := res || jsonb_build_object('abandoned', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(total), 0))
    from cw_orders where org_id = o and status = 'pending_online_payment' and created_at >= p_from and created_at < p_to
      and created_at < now() - interval '1 hour' and not (coalesce(sales_channel, '') = any(ex))));

  -- Bairros (pedidos de entrega), com o período anterior para ver quem cresce.
  res := res || jsonb_build_object('neighborhoods', (select coalesce(jsonb_agg(t order by t.v desc), '[]') from (
    select max(nb) as name, count(*) filter (where created_at >= p_from) as n, coalesce(sum(total) filter (where created_at >= p_from), 0) as v,
      count(*) filter (where created_at < p_from) as pn, coalesce(sum(total) filter (where created_at < p_from), 0) as pv
    from cw_tmp_o where nb is not null and created_at >= pf and created_at < p_to
    group by lower(nb) having count(*) filter (where created_at >= p_from) > 0
    order by 3 desc limit 12) t));

  -- Horários (hora do relógio) e dias da semana (dia de trabalho, que vira às 5h), com média por dia.
  res := res || jsonb_build_object(
    'hours', (select coalesce(jsonb_agg(t order by t.h), '[]') from (
      select extract(hour from created_at at time zone tz)::int as h, count(*) as n, sum(total) as v
      from cw_tmp_o where created_at >= p_from and created_at < p_to group by 1) t),
    'weekdays', (select coalesce(jsonb_agg(t order by t.d), '[]') from (
      select extract(dow from d)::int as d, count(*) as n, sum(v) as v, count(distinct d) as days from (
        select ((created_at at time zone tz) - interval '5 hours')::date as d, total as v
        from cw_tmp_o where created_at >= p_from and created_at < p_to) x group by 1) t));

  -- Produtos: atual x anterior (em alta e em queda) e pares que saem no mesmo pedido.
  res := res || jsonb_build_object(
    'items', (select coalesce(jsonb_agg(t), '[]') from (
      select i->>'name' as name,
        coalesce(sum((i->>'quantity')::numeric) filter (where created_at >= p_from), 0) as q,
        coalesce(sum((i->>'total_price')::numeric) filter (where created_at >= p_from), 0) as v,
        coalesce(sum((i->>'quantity')::numeric) filter (where created_at < p_from), 0) as pq
      from cw_tmp_o, jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) i
      where created_at >= pf and created_at < p_to and coalesce(i->>'status', '') <> 'canceled'
      group by 1) t),
    'pairs', (select coalesce(jsonb_agg(t), '[]') from (
      select a.name as a, b.name as b, count(*) as n from
        (select distinct id, i->>'name' as name from cw_tmp_o, jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) i
          where created_at >= p_from and created_at < p_to and coalesce(i->>'status', '') <> 'canceled') a
        join (select distinct id, i->>'name' as name from cw_tmp_o, jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) i
          where created_at >= p_from and created_at < p_to and coalesce(i->>'status', '') <> 'canceled') b
          on a.id = b.id and a.name < b.name
      group by 1, 2 having count(*) >= 2 order by 3 desc limit 5) t));

  -- Canais, tipo de pedido, pagamentos (com as taxas pagas), agendados e cupons.
  res := res || jsonb_build_object(
    'channels', (select coalesce(jsonb_agg(t), '[]') from (select sales_channel as k, count(*) as n, sum(total) as v
      from cw_tmp_o where created_at >= p_from and created_at < p_to group by 1) t),
    'types', (select coalesce(jsonb_agg(t), '[]') from (select order_type as k, count(*) as n, sum(total) as v,
        round(avg((data->>'delivery_fee')::numeric), 2) as fee
      from cw_tmp_o where created_at >= p_from and created_at < p_to group by 1) t),
    'payments', (select coalesce(jsonb_agg(t), '[]') from (
      select x->>'payment_method' as k, count(*) as n, sum((x->>'total')::numeric) as v, coalesce(sum((x->>'payment_fee')::numeric), 0) as fee
      from cw_tmp_o, jsonb_array_elements(coalesce(data->'payments', '[]'::jsonb)) x
      where created_at >= p_from and created_at < p_to and coalesce(x->>'status', '') not in ('cancelled', 'refunded', 'abandoned')
      group by 1) t),
    'scheduled', (select count(*) from cw_tmp_o where created_at >= p_from and created_at < p_to and data->>'order_timing' = 'scheduled'),
    'coupons', (select jsonb_build_object(
        'orders', count(*) filter (where cp),
        'discount', coalesce(sum(disc) filter (where cp), 0),
        'ticket_with', round(avg(total) filter (where cp), 2),
        'ticket_without', round(avg(total) filter (where not cp), 2))
      from (select total,
          exists (select 1 from jsonb_array_elements(coalesce(data->'discounts', '[]'::jsonb)) x where x->>'category' = 'coupon') as cp,
          (select coalesce(sum((x->>'total')::numeric), 0) from jsonb_array_elements(coalesce(data->'discounts', '[]'::jsonb)) x where x->>'category' = 'coupon') as disc
        from cw_tmp_o where created_at >= p_from and created_at < p_to) s),
    'top_coupons', (select coalesce(jsonb_agg(t), '[]') from (
      select coalesce(x->>'coupon_code', x->>'coupon_name') as code, count(*) as n, sum((x->>'total')::numeric) as v
      from cw_tmp_o, jsonb_array_elements(coalesce(data->'discounts', '[]'::jsonb)) x
      where created_at >= p_from and created_at < p_to and x->>'category' = 'coupon' group by 1 order by 2 desc limit 3) t));

  -- Cancelamentos (todos os pedidos do período, inclusive os cancelados).
  res := res || jsonb_build_object('cancel', (select jsonb_build_object(
      'n', count(*) filter (where status in ('canceled', 'canceling')),
      'total', count(*),
      'v', coalesce(sum(total) filter (where status in ('canceled', 'canceling')), 0),
      'reasons', (select coalesce(jsonb_agg(t), '[]') from (
        select coalesce(nullif(trim(data->>'cancellation_reason'), ''), 'Sem motivo informado') as reason, count(*) as n
        from cw_orders where org_id = o and created_at >= p_from and created_at < p_to and status in ('canceled', 'canceling')
          and not (coalesce(sales_channel, '') = any(ex))
        group by 1 order by 2 desc limit 3) t))
    from cw_orders where org_id = o and created_at >= p_from and created_at < p_to and status <> 'pending_online_payment'
      and not (coalesce(sales_channel, '') = any(ex))));

  -- Avaliações: nota média, nota por quesito e comentários das notas baixas.
  res := res || jsonb_build_object('reviews', jsonb_build_object(
    'n', (select count(*) from cw_reviews where org_id = o and created_at >= p_from and created_at < p_to),
    'avg', (select round(avg(rating), 2) from cw_reviews where org_id = o and created_at >= p_from and created_at < p_to),
    'prev_avg', (select round(avg(rating), 2) from cw_reviews where org_id = o and created_at >= pf and created_at < p_from),
    'low', (select count(*) from cw_reviews where org_id = o and created_at >= p_from and created_at < p_to and rating <= 3),
    'aspects', (select coalesce(jsonb_agg(t order by t.avg), '[]') from (
      select a->>'question' as q, round(avg((a->>'answer')::numeric), 2) as avg, count(*) as n
      from cw_reviews, jsonb_array_elements(coalesce(answers, '[]'::jsonb)) a
      where org_id = o and created_at >= p_from and created_at < p_to and a->>'answer' ~ '^[0-9]+(\.[0-9]+)?$'
      group by 1) t),
    'comments', (select coalesce(jsonb_agg(t), '[]') from (
      select r.rating, r.comment, r.created_at, k.name from cw_reviews r left join cw_customers k on k.org_id = r.org_id and k.id = r.customer_id
      where r.org_id = o and r.created_at >= p_from and r.created_at < p_to and r.comment is not null and r.rating <= 3
      order by r.created_at desc limit 5) t)));

  return res;
end $$;

-- ---------- Relatórios ----------

-- Números para a tela Relatórios. Período pela data do pedido; semanas, meses, frequência e safras
-- olham todo o histórico guardado. p_tz: fuso do aparelho. p_exclude: canais fora da conta.
create or replace function public.cw_relatorio(p_from timestamptz, p_to timestamptz, p_tz text, p_exclude text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  c cw_config;
  pf timestamptz := p_from - (p_to - p_from);
  tz text := coalesce(nullif(p_tz, ''), 'America/Sao_Paulo');
  ex text[] := coalesce(p_exclude, '{}'::text[]);
  res jsonb;
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores veem os relatórios.'; end if;
  begin perform now() at time zone tz; exception when others then tz := 'America/Sao_Paulo'; end;
  select * into c from cw_config where org_id = o;

  res := jsonb_build_object(
    'status', jsonb_build_object('connected', c.org_id is not null, 'merchant', c.merchant_name, 'last_ok', c.last_ok,
      'history', c.backfill_page is not null,
      'queue', (select count(*) from cw_orders where org_id = o and needs_detail),
      'has_orders', exists (select 1 from cw_orders where org_id = o), 'now', now()),
    'day_from', ((p_from at time zone tz) - interval '5 hours')::date,
    'day_to', ((p_to at time zone tz) - interval '5 hours')::date,
    'ins', public.cw_insights(p_from, p_to, tz, ex));

  -- Pedidos válidos de todo o histórico: dia de trabalho (vira às 5h), hora e o 1º pedido do cliente.
  create temp table if not exists cw_tmp_r (id bigint, created_at timestamptz, bday date, hr int, total numeric, order_type text,
    sales_channel text, cid bigint, nb text, data jsonb, first_at timestamptz) on commit drop;
  truncate cw_tmp_r;
  insert into cw_tmp_r
  select id, created_at, ((created_at at time zone tz) - interval '5 hours')::date, extract(hour from created_at at time zone tz)::int,
    total, order_type, sales_channel, cid, nb, data, case when cid is not null then min(created_at) over (partition by cid) end
  from (
    select id, created_at, total, order_type, sales_channel, nullif(data->'customer'->>'id', '')::bigint as cid,
      nullif(trim(data->>'neighborhood'), '') as nb, data
    from cw_orders
    where org_id = o and total is not null and status not in ('canceled', 'canceling', 'pending_online_payment')
      and not (coalesce(sales_channel, '') = any(ex))) s;

  -- Vendas no tempo.
  res := res || jsonb_build_object(
    -- Por dia: o período escolhido e o anterior (para comparar no gráfico).
    'daily', (select coalesce(jsonb_agg(t order by t.d), '[]') from (
      select bday as d, count(*) as n, sum(total) as v from cw_tmp_r where created_at >= pf and created_at < p_to group by 1) t),
    -- Por semana (começa na segunda), em todo o histórico; "nv" e "nn" são de clientes no 1º pedido.
    'weeks', (select coalesce(jsonb_agg(t order by t.w), '[]') from (
      select date_trunc('week', bday)::date as w, count(*) as n, sum(total) as v,
        count(*) filter (where cid is not null and created_at = first_at) as nn,
        coalesce(sum(total) filter (where cid is not null and date_trunc('week', ((first_at at time zone tz) - interval '5 hours')::date) = date_trunc('week', bday)), 0) as nv,
        coalesce(sum(total) filter (where cid is not null and date_trunc('week', ((first_at at time zone tz) - interval '5 hours')::date) < date_trunc('week', bday)), 0) as rv
      from cw_tmp_r group by 1) t),
    'months', (select coalesce(jsonb_agg(t order by t.m), '[]') from (
      select to_char(bday, 'YYYY-MM') as m, count(*) as n, sum(total) as v, count(distinct cid) as c, count(distinct bday) as days,
        max(bday) as last_day
      from cw_tmp_r group by 1) t),
    -- Dia da semana x hora do relógio.
    'heat', (select coalesce(jsonb_agg(t), '[]') from (
      select extract(dow from bday)::int as d, hr as h, count(*) as n, sum(total) as v
      from cw_tmp_r where created_at >= p_from and created_at < p_to group by 1, 2) t),
    -- Faixas de valor do pedido, de R$ 20 em R$ 20 (a última junta tudo de R$ 200 para cima).
    'tickets', (select coalesce(jsonb_agg(t order by t.b), '[]') from (
      select least(floor(total / 20)::int, 10) * 20 as b, count(*) as n, sum(total) as v
      from cw_tmp_r where created_at >= p_from and created_at < p_to group by 1) t),
    'ticket_stats', (select jsonb_build_object(
        'median', round((percentile_cont(0.5) within group (order by total))::numeric, 2),
        'p90', round((percentile_cont(0.9) within group (order by total))::numeric, 2),
        'max', max(total))
      from cw_tmp_r where created_at >= p_from and created_at < p_to));

  -- Clientes: quantas vezes cada um já pediu e safras (mês do 1º pedido → quantos voltaram).
  res := res || jsonb_build_object(
    'freq', (select coalesce(jsonb_agg(t order by t.o), '[]') from (
      select case when n = 1 then '1' when n = 2 then '2' when n <= 4 then '3 a 4' when n <= 9 then '5 a 9' else '10 ou mais' end as k,
        min(n) as o, count(*) as c, sum(spent) as v
      from (select cid, count(*) as n, sum(total) as spent from cw_tmp_r where cid is not null group by cid) s group by 1) t),
    'cohorts', (select coalesce(jsonb_agg(t order by t.m), '[]') from (
      select to_char(((first_at at time zone tz) - interval '5 hours')::date, 'YYYY-MM') as m, count(*) as n,
        count(*) filter (where n >= 2) as back, round(avg(spent), 2) as spent
      from (select cid, min(first_at) as first_at, count(*) as n, sum(total) as spent from cw_tmp_r where cid is not null group by cid) s
      group by 1) t),
    'no_customer', (select count(*) from cw_tmp_r where cid is null and created_at >= p_from and created_at < p_to));

  -- Sabores (opções dos grupos "Sabores"): meia pizza conta meio. Atual x período anterior.
  create temp table if not exists cw_tmp_f (oid bigint, created_at timestamptz, ord bigint, name text, w numeric) on commit drop;
  truncate cw_tmp_f;
  insert into cw_tmp_f
  select r.id, r.created_at, i.ord, x->>'name',
    coalesce(public.cw_num(x->>'quantity'), 1) * coalesce(public.cw_num(i.i->>'quantity'), 1)
      / greatest(coalesce(public.cw_num(x->>'option_group_total_selected_options'), 1), 1)
  from cw_tmp_r r, jsonb_array_elements(coalesce(r.data->'items', '[]'::jsonb)) with ordinality as i(i, ord),
    jsonb_array_elements(coalesce(i.i->'options', '[]'::jsonb)) x
  where r.created_at >= pf and r.created_at < p_to and coalesce(i.i->>'status', '') <> 'canceled'
    and x->>'option_group_name' ilike '%sabor%' and x->>'name' is not null;

  res := res || jsonb_build_object(
    'flavors', (select coalesce(jsonb_agg(t order by t.q desc), '[]') from (
      select name, round(coalesce(sum(w) filter (where created_at >= p_from), 0), 1) as q,
        round(coalesce(sum(w) filter (where created_at < p_from), 0), 1) as pq
      from cw_tmp_f group by 1 order by 2 desc limit 60) t),
    -- Duplas de sabores na mesma pizza (meio a meio).
    'flavor_pairs', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (
      select a.name as a, b.name as b, count(*) as n
      from (select distinct oid, ord, name from cw_tmp_f where created_at >= p_from) a
        join (select distinct oid, ord, name from cw_tmp_f where created_at >= p_from) b on a.oid = b.oid and a.ord = b.ord and a.name < b.name
      group by 1, 2 having count(*) >= 2 order by 3 desc limit 6) t));

  -- Adicionais pagos (bordas, extras): opções com preço, fora dos grupos de sabores.
  res := res || jsonb_build_object('addons', (
    with ad as (
      select r.id, x->>'name' as name, x->>'option_group_name' as grp,
        coalesce(public.cw_num(x->>'quantity'), 1) * coalesce(public.cw_num(i->>'quantity'), 1) as q,
        coalesce(public.cw_num(x->>'unit_price'), 0) as price
      from cw_tmp_r r, jsonb_array_elements(coalesce(r.data->'items', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'options', '[]'::jsonb)) x
      where r.created_at >= p_from and r.created_at < p_to and coalesce(i->>'status', '') <> 'canceled'
        and coalesce(public.cw_num(x->>'unit_price'), 0) > 0 and coalesce(x->>'option_group_name', '') not ilike '%sabor%')
    select jsonb_build_object(
      'orders', (select count(distinct id) from ad),
      'revenue', (select coalesce(sum(q * price), 0) from ad),
      'top', (select coalesce(jsonb_agg(t order by t.v desc), '[]') from (
        select name, max(grp) as grp, sum(q) as q, sum(q * price) as v from ad group by 1 order by 4 desc limit 8) t))));

  -- Entrega e taxas: o que foi cobrado do cliente x o que foi pago ao entregador; descontos por tipo.
  res := res || jsonb_build_object(
    'fees', (select jsonb_build_object(
        'deliveries', count(*) filter (where order_type = 'delivery'),
        'delivery_fee', coalesce(sum(public.cw_num(data->>'delivery_fee')) filter (where order_type = 'delivery'), 0),
        'driver_fee', coalesce(sum(public.cw_num(data->>'driver_fee')) filter (where order_type = 'delivery'), 0),
        'with_driver', count(*) filter (where order_type = 'delivery' and data->>'driver_id' is not null),
        'free', count(*) filter (where order_type = 'delivery' and coalesce(public.cw_num(data->>'delivery_fee'), 0) = 0),
        'drivers', count(distinct data->>'driver_id') filter (where order_type = 'delivery'),
        'driver_days', count(distinct (data->>'driver_id') || '|' || bday::text) filter (where order_type = 'delivery'),
        'service_fee', coalesce(sum(public.cw_num(data->>'service_fee')), 0),
        'additional_fee', coalesce(sum(public.cw_num(data->>'additional_fee')), 0))
      from cw_tmp_r where created_at >= p_from and created_at < p_to),
    'discounts', (select coalesce(jsonb_agg(t order by t.v desc), '[]') from (
      select coalesce(x->>'category', 'outros') as k, count(distinct r.id) as n, coalesce(sum(public.cw_num(x->>'total')), 0) as v
      from cw_tmp_r r, jsonb_array_elements(coalesce(r.data->'discounts', '[]'::jsonb)) x
      where r.created_at >= p_from and r.created_at < p_to group by 1) t),
    -- Quem lançou o pedido (balcão, telefone e WhatsApp): primeiro nome e inicial.
    'attendants', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (
      select public.cw_short_name(u) as name, count(*) as n, sum(total) as v
      from (select r.total, (select i->'user'->>'name' from jsonb_array_elements(coalesce(r.data->'items', '[]'::jsonb)) i
              where nullif(trim(i->'user'->>'name'), '') is not null limit 1) as u
            from cw_tmp_r r where r.created_at >= p_from and r.created_at < p_to) s
      where u is not null group by 1 order by 2 desc limit 8) t));

  -- Avaliações da Cardápio Web, ligadas ao pedido (tipo, hora, dia e bairro).
  create temp table if not exists cw_tmp_v (id bigint, rating numeric, comment text, answers jsonb, created_at timestamptz, cid bigint,
    order_id bigint, otype text, hr int, dow int, nb text, name text) on commit drop;
  truncate cw_tmp_v;
  insert into cw_tmp_v
  select v.id, v.rating, v.comment, v.answers, v.created_at, v.customer_id, v.order_id, ord.order_type,
    extract(hour from ord.created_at at time zone tz)::int,
    extract(dow from ((ord.created_at at time zone tz) - interval '5 hours')::date)::int,
    nullif(trim(ord.data->>'neighborhood'), ''), k.name
  from cw_reviews v
    left join cw_orders ord on ord.org_id = v.org_id and ord.id = v.order_id
    left join cw_customers k on k.org_id = v.org_id and k.id = v.customer_id
  where v.org_id = o and v.rating is not null;

  res := res || jsonb_build_object('reviews', jsonb_build_object(
    'all_n', (select count(*) from cw_tmp_v),
    'all_avg', (select round(avg(rating), 2) from cw_tmp_v),
    'n', (select count(*) from cw_tmp_v where created_at >= p_from and created_at < p_to),
    'avg', (select round(avg(rating), 2) from cw_tmp_v where created_at >= p_from and created_at < p_to),
    'pn', (select count(*) from cw_tmp_v where created_at >= pf and created_at < p_from),
    'pavg', (select round(avg(rating), 2) from cw_tmp_v where created_at >= pf and created_at < p_from),
    'commented', (select count(*) from cw_tmp_v where created_at >= p_from and created_at < p_to and comment is not null),
    -- Estrelas: a nota (média dos quesitos) arredondada.
    'stars', (select coalesce(jsonb_agg(t order by t.s desc), '[]') from (
      select greatest(1, least(5, round(rating)))::int as s, count(*) filter (where created_at >= p_from) as n,
        count(*) filter (where created_at < p_from) as pn
      from cw_tmp_v where created_at >= pf and created_at < p_to group by 1) t),
    'monthly', (select coalesce(jsonb_agg(t order by t.m), '[]') from (
      select to_char(created_at at time zone tz, 'YYYY-MM') as m, count(*) as n, round(avg(rating), 2) as avg,
        count(*) filter (where rating <= 3) as low
      from cw_tmp_v group by 1) t),
    'aspects', (select coalesce(jsonb_agg(t order by t.avg), '[]') from (
      select a->>'question' as q,
        round(avg(public.cw_num(a->>'answer')) filter (where v.created_at >= p_from), 2) as avg,
        count(*) filter (where v.created_at >= p_from) as n,
        round(avg(public.cw_num(a->>'answer')) filter (where v.created_at < p_from), 2) as pavg
      from cw_tmp_v v, jsonb_array_elements(coalesce(v.answers, '[]'::jsonb)) a
      where v.created_at >= pf and v.created_at < p_to and public.cw_num(a->>'answer') is not null
      group by 1 having count(*) filter (where v.created_at >= p_from) > 0) t),
    'by_type', (select coalesce(jsonb_agg(t), '[]') from (
      select otype as k, count(*) as n, round(avg(rating), 2) as avg
      from cw_tmp_v where created_at >= p_from and created_at < p_to and otype is not null group by 1) t),
    'by_hour', (select coalesce(jsonb_agg(t order by t.h), '[]') from (
      select hr as h, count(*) as n, round(avg(rating), 2) as avg
      from cw_tmp_v where created_at >= p_from and created_at < p_to and hr is not null group by 1) t),
    'by_dow', (select coalesce(jsonb_agg(t order by t.d), '[]') from (
      select dow as d, count(*) as n, round(avg(rating), 2) as avg
      from cw_tmp_v where created_at >= p_from and created_at < p_to and dow is not null group by 1) t),
    'by_nb', (select coalesce(jsonb_agg(t order by t.avg), '[]') from (
      select max(nb) as name, count(*) as n, round(avg(rating), 2) as avg
      from cw_tmp_v where created_at >= p_from and created_at < p_to and nb is not null
      group by lower(nb) having count(*) >= 3 order by 3 limit 6) t)));

  res := res || jsonb_build_object('reviews', (res->'reviews') || jsonb_build_object(
    -- Nota por sabor: todo o histórico de avaliações (por período seriam poucas por sabor).
    'flavors', (select coalesce(jsonb_agg(t order by t.avg), '[]') from (
      select f.name, count(*) as n, round(avg(v.rating), 2) as avg
      from cw_tmp_v v
        join cw_orders ord on ord.org_id = o and ord.id = v.order_id,
        lateral (select distinct x->>'name' as name
          from jsonb_array_elements(coalesce(ord.data->'items', '[]'::jsonb)) i, jsonb_array_elements(coalesce(i->'options', '[]'::jsonb)) x
          where x->>'option_group_name' ilike '%sabor%' and x->>'name' is not null) f
      group by 1 having count(*) >= 5 order by 3 limit 60) t),
    -- Quem deu nota baixa (há mais de 14 dias) e pediu de novo depois.
    'low_back', (select jsonb_build_object('n', count(*), 'back', count(*) filter (where again))
      from (select v.cid, exists (select 1 from cw_tmp_r r where r.cid = v.cid and r.created_at > min(v.created_at) + interval '1 hour') as again
            from cw_tmp_v v where v.rating <= 3 and v.cid is not null and v.created_at < now() - interval '14 days' group by v.cid) s),
    'recent', (select coalesce(jsonb_agg(t), '[]') from (
      select rating, comment, created_at, name from cw_tmp_v
      where created_at >= p_from and created_at < p_to and comment is not null order by created_at desc limit 12) t),
    'low_list', (select coalesce(jsonb_agg(t), '[]') from (
      select v.rating, v.comment, v.created_at, v.name, v.otype,
        (select a->>'question' from jsonb_array_elements(coalesce(v.answers, '[]'::jsonb)) a
          where public.cw_num(a->>'answer') is not null order by public.cw_num(a->>'answer') limit 1) as worst
      from cw_tmp_v v where v.created_at >= p_from and v.created_at < p_to and v.rating <= 3 order by v.created_at desc limit 15) t)));

  return res;
end $$;

-- ---------- Google (Places API): nota e avaliações da loja ----------

-- Ligação com o Google. Sem políticas de leitura: o app nunca vê a chave.
-- Só a chave e o código do local ficam guardados; nota e avaliações são buscadas na hora.
create table if not exists public.g_config (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  api_key text not null,
  place_id text not null,
  place_name text,
  calls_day date,                -- controle de uso: quantas consultas já foram feitas hoje
  calls int not null default 0,
  connected_at timestamptz not null default now(),
  connected_by uuid
);
alter table public.g_config enable row level security;

-- Chamada à Places API (New). Com p_body, é POST (busca por texto); sem, é GET (detalhes do local).
create or replace function public.g_http(p_url text, p_key text, p_mask text, p_body text, out status int, out body jsonb)
language plpgsql security definer set search_path = public, extensions as $$
declare r extensions.http_response;
  h extensions.http_header[] := array[extensions.http_header('X-Goog-Api-Key', p_key), extensions.http_header('X-Goog-FieldMask', p_mask),
    extensions.http_header('Accept', 'application/json')];
begin
  begin perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MSEC', '8000'); exception when others then null; end;
  if p_body is null then
    r := extensions.http(('GET', p_url, h, null, null)::extensions.http_request);
  else
    r := extensions.http(('POST', p_url, h, 'application/json', p_body)::extensions.http_request);
  end if;
  status := r.status;
  begin body := r.content::jsonb; exception when others then body := null; end;
end $$;

-- Erro do Google → o que fazer, em português.
create or replace function public.g_error(p_status int, p_body jsonb) returns text
language sql immutable as $$
  select case
    when p_status = 200 then null
    when m ilike '%API key not valid%' or m ilike '%API_KEY_INVALID%' then 'O Google não aceitou esta chave. Confira se copiou a chave inteira.'
    when m ilike '%has not been used%' or m ilike '%is disabled%' or m ilike '%SERVICE_DISABLED%' or m ilike '%not enabled%'
      then 'A "Places API (New)" ainda não está ativada neste projeto do Google Cloud. Ative, espere uns minutos e tente de novo.'
    when m ilike '%billing%' then 'O projeto do Google Cloud está sem conta de faturamento. O Google exige um cartão cadastrado, mesmo que o uso do app fique na faixa gratuita.'
    when m ilike '%referer%' or m ilike '%IP address%' or m ilike '%are blocked%' or m ilike '%API_KEY_SERVICE_BLOCKED%'
      then 'A chave tem uma restrição que bloqueia o servidor. Em "Restrições do aplicativo" deixe "Nenhuma" e, em "Restrições de API", marque só a Places API (New).'
    when p_status = 404 or m ilike '%not found%' then 'O Google não encontrou este local. Procure a loja de novo pelo nome.'
    when p_status = 429 or m ilike '%quota%' then 'O limite de consultas ao Google foi atingido. Tente de novo mais tarde.'
    else 'O Google respondeu com erro ' || coalesce(p_status::text, '?') || coalesce(': ' || left(nullif(m, ''), 180), '') || '.'
  end
  from (select coalesce(p_body->'error'->>'message', '') || ' ' || coalesce(p_body->'error'->>'status', '') || ' ' || coalesce(p_body->'error'->'details'->0->>'reason', '') as m) s
$$;

-- Procura a loja pelo nome (o administrador escolhe na lista). Sem p_key, usa a chave já guardada.
create or replace function public.g_search(p_key text, p_query text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o uuid; k text := nullif(trim(coalesce(p_key, '')), ''); q text := trim(coalesce(p_query, '')); res record;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador liga o Google.'; end if;
  if k is null then select api_key into k from g_config where org_id = o; end if;
  if k is null or length(k) < 20 then raise exception 'Cole a chave da API criada no Google Cloud.'; end if;
  if length(q) < 3 then raise exception 'Digite o nome da loja e a cidade.'; end if;
  begin
    select * into res from g_http('https://places.googleapis.com/v1/places:searchText', k,
      'places.id,places.displayName,places.formattedAddress',
      jsonb_build_object('textQuery', q, 'languageCode', 'pt-BR', 'regionCode', 'BR')::text);
  exception when others then
    raise exception 'O Google não respondeu (%). Tente de novo em instantes.', sqlerrm;
  end;
  if res.status <> 200 then raise exception '%', g_error(res.status, res.body); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'name', x->'displayName'->>'text', 'address', x->>'formattedAddress')), '[]'::jsonb)
    from (select x from jsonb_array_elements(coalesce(res.body->'places', '[]'::jsonb)) x limit 6) s);
end $$;

-- Liga (ou troca) a loja. Confere a chave e o local na hora e devolve o nome da loja.
create or replace function public.g_connect(p_key text, p_place text) returns text
language plpgsql security definer set search_path = public as $$
declare o uuid; k text := nullif(trim(coalesce(p_key, '')), ''); p text := trim(coalesce(p_place, '')); res record; nm text;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador liga o Google.'; end if;
  if k is null then select api_key into k from g_config where org_id = o; end if;
  if k is null or length(k) < 20 then raise exception 'Cole a chave da API criada no Google Cloud.'; end if;
  if p !~ '^[A-Za-z0-9_-]{10,}$' or length(p) > 400 then raise exception 'Escolha a loja na lista.'; end if;
  begin
    select * into res from g_http('https://places.googleapis.com/v1/places/' || p || '?languageCode=pt-BR&regionCode=BR', k, 'id,displayName', null);
  exception when others then
    raise exception 'O Google não respondeu (%). Tente de novo em instantes.', sqlerrm;
  end;
  if res.status <> 200 then raise exception '%', g_error(res.status, res.body); end if;
  nm := coalesce(res.body->'displayName'->>'text', 'Loja no Google');
  insert into g_config (org_id, api_key, place_id, place_name, calls_day, calls, connected_at, connected_by)
  values (o, k, p, nm, null, 0, now(), auth.uid())
  on conflict (org_id) do update set api_key = excluded.api_key, place_id = excluded.place_id, place_name = excluded.place_name,
    connected_at = now(), connected_by = auth.uid();
  return nm;
end $$;

create or replace function public.g_disconnect() returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador desliga o Google.'; end if;
  delete from g_config where org_id = o;
end $$;

-- Nota, total e avaliações em destaque, buscados agora no Google (nada disso fica guardado).
-- No máximo 30 consultas por dia: fica dentro da faixa gratuita do Google (1.000 por mês).
create or replace function public.g_place() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o uuid; c g_config; res record; base jsonb;
begin
  select org_id into o from members where user_id = auth.uid() and active and role in ('gerente', 'admin') limit 1;
  if o is null then raise exception 'Só gerentes e administradores veem os relatórios.'; end if;
  select * into c from g_config where org_id = o;
  if not found then return jsonb_build_object('connected', false); end if;
  base := jsonb_build_object('connected', true, 'name', c.place_name, 'place_id', c.place_id);
  if c.calls_day = current_date and c.calls >= 30 then return base || jsonb_build_object('limited', true); end if;
  update g_config set calls_day = current_date, calls = case when calls_day = current_date then calls + 1 else 1 end where org_id = o;
  begin
    select * into res from g_http('https://places.googleapis.com/v1/places/' || c.place_id || '?languageCode=pt-BR&regionCode=BR', c.api_key,
      'id,displayName,rating,userRatingCount,googleMapsUri,reviews', null);
  exception when others then
    return base || jsonb_build_object('error', 'O Google não respondeu. Tente de novo em instantes.');
  end;
  if res.status <> 200 or res.body is null then return base || jsonb_build_object('error', g_error(res.status, res.body)); end if;
  return base || jsonb_build_object(
    'name', coalesce(res.body->'displayName'->>'text', c.place_name),
    'rating', res.body->'rating',
    'count', res.body->'userRatingCount',
    'url', res.body->>'googleMapsUri',
    'at', now(),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
        'rating', x->'rating',
        'text', coalesce(x->'originalText'->>'text', x->'text'->>'text'),
        'author', x->'authorAttribution'->>'displayName',
        'author_url', x->'authorAttribution'->>'uri',
        'photo', x->'authorAttribution'->>'photoUri',
        'time', x->>'publishTime',
        'rel', x->>'relativePublishTimeDescription',
        'url', x->>'googleMapsUri')), '[]'::jsonb)
      from jsonb_array_elements(coalesce(res.body->'reviews', '[]'::jsonb)) x));
end $$;

-- ---------- Permissões ----------

revoke all on function public.cw_insights(timestamptz, timestamptz, text, text[]) from public, anon;
revoke all on function public.cw_relatorio(timestamptz, timestamptz, text, text[]) from public, anon;
revoke all on function public.g_http(text, text, text, text) from public, anon, authenticated;
revoke all on function public.g_search(text, text) from public, anon;
revoke all on function public.g_connect(text, text) from public, anon;
revoke all on function public.g_disconnect() from public, anon;
revoke all on function public.g_place() from public, anon;
grant execute on function public.cw_insights(timestamptz, timestamptz, text, text[]) to authenticated;
grant execute on function public.cw_relatorio(timestamptz, timestamptz, text, text[]) to authenticated;
grant execute on function public.g_search(text, text) to authenticated;
grant execute on function public.g_connect(text, text) to authenticated;
grant execute on function public.g_disconnect() to authenticated;
grant execute on function public.g_place() to authenticated;
