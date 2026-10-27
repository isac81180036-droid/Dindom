-- =====================================================================
-- Dindom · Vendas › Insights (clientes, bairros, horários, produtos, avaliações)
-- Rode DEPOIS do 003_cardapioweb.sql. Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado do app é apagado.
--
-- O que muda:
-- • Os pedidos passam a guardar o código do cliente na Cardápio Web (para saber quem volta e quem
--   sumiu). Os pedidos já guardados são buscados de novo, aos poucos, para ganhar esse código.
-- • O histórico passa a cobrir quase 6 meses (175 dias; antes, 30), para dar para ver clientes perdidos.
-- • Guarda a lista de clientes cadastrados (só primeiro nome, inicial do sobrenome e data do cadastro;
--   sem telefone nem e-mail) e as avaliações dos pedidos.
-- =====================================================================

-- Mesma função do 003, já com a correção da extensão http (por garantia).
create or replace function public.cw_get(p_env text, p_key text, p_path text, out status int, out body jsonb)
language plpgsql security definer set search_path = public, extensions as $$
declare r extensions.http_response;
begin
  -- Versões antigas da extensão não aceitam mudar o tempo limite: fica o padrão (5 segundos).
  begin perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MSEC', '6000'); exception when others then null; end;
  r := extensions.http((
    'GET',
    (case when p_env = 'sandbox' then 'https://integracao.sandbox.cardapioweb.com' else 'https://integracao.cardapioweb.com' end) || '/api/partner/v1' || p_path,
    array[extensions.http_header('X-API-KEY', p_key), extensions.http_header('Accept', 'application/json')],
    null, null)::extensions.http_request);
  status := r.status;
  begin body := r.content::jsonb; exception when others then body := null; end;
end $$;

-- ---------- Tabelas novas ----------

create table if not exists public.cw_customers (
  org_id uuid not null references public.orgs(id) on delete cascade,
  id bigint not null,
  name text,                 -- primeiro nome e inicial do sobrenome
  created_at timestamptz,    -- quando se cadastrou no cardápio
  notifications boolean,     -- aceita receber avisos da loja
  synced_at timestamptz not null default now(),
  primary key (org_id, id)
);
alter table public.cw_customers enable row level security;
drop policy if exists "gestores leem os clientes" on public.cw_customers;
create policy "gestores leem os clientes" on public.cw_customers for select using (public.is_manager(org_id));

create table if not exists public.cw_reviews (
  org_id uuid not null references public.orgs(id) on delete cascade,
  id bigint not null,
  order_id bigint,
  customer_id bigint,
  rating numeric,
  comment text,
  answers jsonb,             -- nota por quesito (atendimento, embalagem, tempo de entrega...)
  created_at timestamptz,
  primary key (org_id, id)
);
create index if not exists cw_reviews_created on public.cw_reviews (org_id, created_at);
alter table public.cw_reviews enable row level security;
drop policy if exists "gestores leem as avaliações" on public.cw_reviews;
create policy "gestores leem as avaliações" on public.cw_reviews for select using (public.is_manager(org_id));

alter table public.cw_config
  add column if not exists cust_page int,
  add column if not exists cust_done_at timestamptz,
  add column if not exists rev_from timestamptz,
  add column if not exists rev_page int,
  add column if not exists rev_done_at timestamptz;

-- ---------- Pedido guardado: agora com o código do cliente ----------

-- "Maria Souza Lima" → "Maria L." (inicial do último sobrenome, pulando "da", "dos"...)
create or replace function public.cw_short_name(n text) returns text
language sql immutable as $$
  select nullif(trim(a[1] || case when array_length(a, 1) > 1 then ' ' || upper(left(a[array_length(a, 1)], 1)) || '.' else '' end), '')
  from (select regexp_split_to_array(trim(coalesce(n, '')), '\s+') as a) s
$$;

-- "v": 2 marca os pedidos que já têm o código do cliente.
create or replace function public.cw_clean(o jsonb) returns jsonb
language sql immutable as $$
  select (o - 'customer' - 'delivery_address' - 'public_id') || jsonb_build_object(
    'v', 2,
    'customer', case when jsonb_typeof(o->'customer') = 'object'
      then jsonb_build_object('id', o->'customer'->'id', 'name', public.cw_short_name(o->'customer'->>'name')) end,
    'neighborhood', nullif(trim(coalesce(o->'delivery_address'->>'neighborhood', '')), ''))
$$;

-- ---------- Sincronização (substitui a do 003) ----------

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

  -- 2. Histórico de pedidos (uma página de 100 por vez, até completar).
  if c.backfill_page is not null then
    begin
      select * into res from cw_get(c.env, c.api_key, '/orders/history?start_date=' || cw_iso(c.backfill_from) ||
        '&end_date=' || cw_iso(started) || '&per_page=100&page=' || c.backfill_page);
      if res.status = 200 then
        perform cw_upsert_lite(p_org, res.body->'orders');
        pages := coalesce((res.body->'pagination'->>'total_pages')::int, 0);
        update cw_config set backfill_page = case when c.backfill_page >= pages then null else c.backfill_page + 1 end where org_id = p_org;
      elsif res.status = 400 then
        update cw_config set backfill_page = null where org_id = p_org;
      end if;
    exception when others then null;
    end;
  end if;

  -- 3. Clientes cadastrados: uma página de 50 por minuto; a lista inteira é revista uma vez por dia.
  if c.cust_page is null and (c.cust_done_at is null or c.cust_done_at < started - interval '1 day') then c.cust_page := 1; end if;
  if c.cust_page is not null then
    begin
      select * into res from cw_get(c.env, c.api_key, '/merchant/customers?per_page=50&page=' || c.cust_page);
      if res.status = 200 then
        insert into cw_customers (org_id, id, name, created_at, notifications, synced_at)
        select p_org, (x->>'id')::bigint, cw_short_name(x->>'name'), (x->>'created_at')::timestamptz, (x->>'notifications_enabled')::boolean, now()
        from jsonb_array_elements(coalesce(res.body->'customers', '[]'::jsonb)) x where x->>'id' is not null
        on conflict (org_id, id) do update set name = excluded.name, created_at = excluded.created_at,
          notifications = excluded.notifications, synced_at = excluded.synced_at;
        pages := coalesce((res.body->'pagination'->>'total_pages')::int, 0);
        if c.cust_page >= pages then update cw_config set cust_page = null, cust_done_at = started where org_id = p_org;
        else update cw_config set cust_page = c.cust_page + 1 where org_id = p_org; end if;
      elsif res.status in (400, 401, 403, 404) then
        update cw_config set cust_page = null, cust_done_at = started where org_id = p_org; -- indisponível: tenta amanhã
      end if;
    exception when others then null;
    end;
  end if;

  -- 4. Avaliações: a cada 30 minutos, as dos últimos 2 dias (na primeira vez, 6 meses).
  if c.rev_page is null and (c.rev_done_at is null or c.rev_done_at < started - interval '30 minutes') then
    c.rev_page := 1;
    c.rev_from := coalesce(c.rev_done_at - interval '2 days', started - interval '175 days');
    update cw_config set rev_page = 1, rev_from = c.rev_from where org_id = p_org;
  end if;
  begin
    select * into res from cw_get(c.env, c.api_key, '/merchant/reviews?start_date=' || cw_iso(c.rev_from) ||
      '&end_date=' || cw_iso(started) || '&per_page=100&page=' || c.rev_page);
    if res.status = 200 then
      insert into cw_reviews (org_id, id, order_id, customer_id, rating, comment, answers, created_at)
      select p_org, (x->>'id')::bigint, (x->>'order_id')::bigint, (x->>'customer_id')::bigint, (x->>'rating')::numeric,
        nullif(trim(coalesce(x->>'comment', '')), ''), x->'answers', (x->>'created_at')::timestamptz
      from jsonb_array_elements(coalesce(res.body->'reviews', '[]'::jsonb)) x where x->>'id' is not null
      on conflict (org_id, id) do update set rating = excluded.rating, comment = excluded.comment, answers = excluded.answers;
      pages := coalesce((res.body->'pagination'->>'total_pages')::int, 0);
      if c.rev_page >= pages then update cw_config set rev_page = null, rev_done_at = started where org_id = p_org;
      else update cw_config set rev_page = c.rev_page + 1 where org_id = p_org; end if;
    elsif res.status in (400, 401, 403, 404) then
      update cw_config set rev_page = null, rev_done_at = started where org_id = p_org;
    end if;
  exception when others then null;
  end;

  -- 5. Pedidos completos: os mais recentes primeiro. 45 por minuto deixa metade do limite da API
  --    (300 a cada 3 minutos por loja) para outros sistemas que usem o mesmo token.
  for r in select id from cw_orders where org_id = p_org and needs_detail order by created_at desc limit 45 loop
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

-- Ligar a loja agora traz 6 meses de histórico.
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
    raise exception 'A Cardápio Web não respondeu (%). Tente de novo em instantes.', sqlerrm;
  end;
  if res.status = 401 then raise exception 'A Cardápio Web não aceitou este token. Confira se copiou o token inteiro.'; end if;
  if res.status <> 200 or res.body->>'id' is null then raise exception 'A Cardápio Web respondeu com erro %. Tente de novo em instantes.', res.status; end if;
  mid := (res.body->>'id')::bigint;
  -- Outra loja (ou ambiente): os dados guardados eram da anterior.
  if exists (select 1 from cw_config where org_id = o and (merchant_id is distinct from mid or env <> p_env)) then
    delete from cw_orders where org_id = o;
    delete from cw_customers where org_id = o;
    delete from cw_reviews where org_id = o;
  end if;
  insert into cw_config (org_id, api_key, env, merchant_id, merchant_name, last_poll, backfill_from, backfill_page,
    last_ok, last_error, error_at, connected_at, connected_by, cust_page, cust_done_at, rev_page, rev_done_at)
  values (o, k, p_env, mid, res.body->>'name', null, now() - interval '175 days', 1, null, null, null, now(), auth.uid(), 1, null, null, null)
  on conflict (org_id) do update set
    api_key = excluded.api_key, env = excluded.env, merchant_id = excluded.merchant_id, merchant_name = excluded.merchant_name,
    last_poll = null, backfill_from = excluded.backfill_from, backfill_page = 1,
    last_error = null, error_at = null, connected_at = now(), connected_by = auth.uid(),
    cust_page = 1, cust_done_at = null, rev_page = null, rev_done_at = null;
  return res.body->>'name';
end $$;

-- ---------- Insights ----------

-- Números para a aba Insights. Período pela data do pedido; clientes fiéis, em risco e perdidos
-- olham todo o histórico guardado. p_tz: fuso do aparelho (para horários e dias da semana).
create or replace function public.cw_insights(p_from timestamptz, p_to timestamptz, p_tz text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  len interval := p_to - p_from;
  pf timestamptz := p_from - (p_to - p_from);
  tz text := coalesce(nullif(p_tz, ''), 'America/Sao_Paulo');
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
  where org_id = o and total is not null and status not in ('canceled', 'canceling', 'pending_online_payment');

  select min(created_at) into hist_from from cw_tmp_o;

  -- Visão geral: período atual e o anterior, do mesmo tamanho.
  res := res || jsonb_build_object(
    'history_from', hist_from,
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
      and created_at < now() - interval '1 hour'));

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
        group by 1 order by 2 desc limit 3) t))
    from cw_orders where org_id = o and created_at >= p_from and created_at < p_to and status <> 'pending_online_payment'));

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


-- ---------- Ajustes nos dados já guardados ----------

-- Pedidos guardados antes desta versão: busca de novo para ganhar o código do cliente.
update public.cw_orders set needs_detail = true where data is not null and coalesce((data->>'v')::int, 1) < 2 and not needs_detail;
-- Amplia o histórico para 6 meses (só na primeira vez que este arquivo roda).
update public.cw_config set backfill_from = now() - interval '175 days', backfill_page = 1
  where backfill_from is null or backfill_from > now() - interval '174 days';

-- ---------- Permissões e tempo real ----------

revoke all on function public.cw_get(text, text, text) from public, anon, authenticated;
revoke all on function public.cw_sync_org(uuid) from public, anon, authenticated;
revoke all on function public.cw_connect(text, text) from public, anon;
revoke all on function public.cw_insights(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.cw_connect(text, text) to authenticated;
grant execute on function public.cw_insights(timestamptz, timestamptz, text) to authenticated;
