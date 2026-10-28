-- =====================================================================
-- Dindom · reservas pelo link público (/reserva)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado do app é apagado.
--
-- Como funciona:
-- • O cliente preenche o questionário em /reserva, sem login. A página só consegue
--   chamar criar_reserva(), que confere tudo de novo aqui no servidor, barra robôs
--   (campo escondido) e limita os envios por aparelho (IP) e por WhatsApp.
-- • Cada reserva vira, na mesma hora, um evento na agenda (agenda "Reservas e eventos")
--   e uma notificação para a equipe. O evento fica em records e chega em tempo real
--   a todos os aparelhos, como os demais dados do app.
-- • Só a equipe logada lê e altera as reservas (status, detalhes, anotações internas).
--   Ao alterar a reserva, o evento da agenda é atualizado sozinho.
-- • A contabilidade não vê as reservas.
-- =====================================================================

-- ---------- Tabela ----------

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  criado_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'recusada', 'cancelada')),
  origem text not null default 'link_publico',
  -- Respostas do questionário
  nome text not null,
  empresa text,
  whatsapp text not null,                 -- só os números, com DDD (ex.: 85999998888)
  email text,
  tipo text not null check (tipo in ('aniversario', 'confraternizacao', 'reuniao', 'outro')),
  tipo_outro text,                        -- quando o tipo é "outro": qual
  homenageado text,
  data date not null,
  inicio time not null,
  termino time not null,                  -- menor que o início = termina depois da meia-noite
  pessoas int not null check (pessoas between 1 and 2000),
  decoracao boolean not null default false,
  alimentacao text,
  orcamento numeric(12, 2),
  observacoes text,
  aceite boolean not null default false,
  -- Equipe
  notas_internas text,
  evento_id text,                         -- vínculo com o evento da agenda (records: events / evento_id)
  vista_em timestamptz,                   -- primeira vez que alguém da equipe abriu (até lá aparece como NOVA)
  vista_por text,
  atualizado_em timestamptz,
  atualizado_por uuid,
  ip_hash text                            -- só para o limite de envios; o IP em si não é guardado
);
create index if not exists reservas_org_data on public.reservas (org_id, data);
create index if not exists reservas_ip on public.reservas (ip_hash, criado_em);
create index if not exists reservas_whatsapp on public.reservas (whatsapp, criado_em);

-- ---------- Permissões ----------

alter table public.reservas enable row level security;

drop policy if exists "equipe lê as reservas" on public.reservas;
create policy "equipe lê as reservas" on public.reservas for select
  using (public.is_member(org_id) and public.my_role(org_id) <> 'contador');

drop policy if exists "equipe altera as reservas" on public.reservas;
create policy "equipe altera as reservas" on public.reservas for update
  using (public.is_member(org_id) and public.my_role(org_id) <> 'contador')
  with check (public.is_member(org_id) and public.my_role(org_id) <> 'contador');

-- O público nunca toca na tabela: só cria reservas por criar_reserva().
revoke all on public.reservas from anon;
revoke insert, delete, truncate on public.reservas from authenticated;
grant select, update on public.reservas to authenticated;

-- ---------- Automatismos ----------

-- Campos que não mudam depois de criada a reserva; registra quem alterou.
create or replace function public.reservas_antes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.evento_id := 'rv-' || new.id;
  else
    new.id := old.id; new.org_id := old.org_id; new.criado_em := old.criado_em; new.origem := old.origem;
    new.aceite := old.aceite; new.ip_hash := old.ip_hash; new.evento_id := old.evento_id;
    new.atualizado_em := now(); new.atualizado_por := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists reservas_antes on public.reservas;
create trigger reservas_antes before insert or update on public.reservas
  for each row execute function public.reservas_antes();

-- Espelha a reserva como evento da agenda (e avisa a equipe quando é nova).
-- O evento leva todas as respostas em "reserva", para o app mostrar o painel mesmo sem internet.
create or replace function public.reservas_agenda() returns trigger
language plpgsql security definer set search_path = public as $$
declare tipo text; quem text; ev jsonb;
begin
  tipo := case new.tipo when 'aniversario' then 'Aniversário' when 'confraternizacao' then 'Confraternização de empresa'
    when 'reuniao' then 'Reunião' else coalesce(nullif(new.tipo_outro, ''), 'Outro') end;
  quem := coalesce(nullif(new.empresa, ''), new.nome);
  ev := jsonb_build_object(
    'id', new.evento_id,
    'title', '🎉 ' || tipo || ' – ' || quem || ' (' || new.pessoas || case when new.pessoas = 1 then ' pessoa)' else ' pessoas)' end,
    'cal', 'reservas',
    'date', to_char(new.data, 'YYYY-MM-DD'),
    'start', to_char(new.inicio, 'HH24:MI'),
    -- Festa que passa da meia-noite ocupa a agenda até o fim do dia; o término real fica na reserva.
    'end', case when new.termino > new.inicio then to_char(new.termino, 'HH24:MI') else '23:59' end,
    'repeat', 'none', 'place', '', 'notes', '',
    'reserva', jsonb_build_object(
      'id', new.id, 'codigo', upper(left(replace(new.id::text, '-', ''), 6)), 'status', new.status, 'origem', new.origem,
      'nome', new.nome, 'empresa', new.empresa, 'whatsapp', new.whatsapp, 'email', new.email,
      'tipo', new.tipo, 'tipo_outro', new.tipo_outro, 'homenageado', new.homenageado,
      'data', to_char(new.data, 'YYYY-MM-DD'), 'inicio', to_char(new.inicio, 'HH24:MI'), 'termino', to_char(new.termino, 'HH24:MI'),
      'pessoas', new.pessoas, 'decoracao', new.decoracao, 'alimentacao', new.alimentacao, 'orcamento', new.orcamento,
      'observacoes', new.observacoes, 'notas', new.notas_internas,
      'criado_em', new.criado_em, 'vista_em', new.vista_em, 'vista_por', new.vista_por, 'atualizado_em', new.atualizado_em));

  insert into records (org_id, collection, id, data, deleted) values (new.org_id, 'events', new.evento_id, ev, false)
    on conflict (org_id, collection, id) do update set data = excluded.data, deleted = false;

  if tg_op = 'INSERT' then
    insert into records (org_id, collection, id, data) values (new.org_id, 'notifications', new.evento_id, jsonb_build_object(
      'id', new.evento_id,
      'text', 'Nova reserva: ' || tipo || ' – ' || quem || ', ' || to_char(new.data, 'DD/MM/YYYY') || ' às ' || to_char(new.inicio, 'HH24:MI') ||
        ' (' || new.pessoas || case when new.pessoas = 1 then ' pessoa)' else ' pessoas)' end,
      'at', to_char(now() at time zone 'America/Fortaleza', 'DD/MM/YYYY "às" HH24:MI'),
      'ts', (extract(epoch from now()) * 1000)::bigint,
      'tone', 'warn', 'icon', 'party', 'href', '#reservas/' || new.id, 'read', false))
    on conflict (org_id, collection, id) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists reservas_agenda on public.reservas;
create trigger reservas_agenda after insert or update on public.reservas
  for each row execute function public.reservas_agenda();

-- ---------- Link público ----------

-- Recebe o questionário da página /reserva. Devolve { ok, codigo }.
-- As mensagens de erro aparecem para o cliente: ficam em português e dizem o que corrigir.
create or replace function public.criar_reserva(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o uuid; r public.reservas; hdr json; ip text; h text;
  hoje date := (now() at time zone 'America/Fortaleza')::date;
  agora time := (now() at time zone 'America/Fortaleza')::time;
  v_nome text := left(btrim(coalesce(p ->> 'nome', '')), 120);
  v_empresa text := left(nullif(btrim(coalesce(p ->> 'empresa', '')), ''), 120);
  v_whats text := regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g');
  v_email text := left(nullif(lower(btrim(coalesce(p ->> 'email', ''))), ''), 160);
  v_tipo text := coalesce(p ->> 'tipo', '');
  v_outro text := left(nullif(btrim(coalesce(p ->> 'tipo_outro', '')), ''), 60);
  v_hom text := left(nullif(btrim(coalesce(p ->> 'homenageado', '')), ''), 120);
  v_alim text := left(nullif(btrim(coalesce(p ->> 'alimentacao', '')), ''), 1500);
  v_obs text := left(nullif(btrim(coalesce(p ->> 'observacoes', '')), ''), 2000);
  v_data date; v_ini time; v_fim time; v_pessoas int; v_orc numeric;
begin
  -- Campo escondido preenchido: é robô. Responde como se tivesse dado certo e não grava nada.
  if coalesce(p ->> 'site', '') <> '' then
    return jsonb_build_object('ok', true, 'codigo', upper(left(md5(random()::text), 6)));
  end if;

  select id into o from orgs order by created_at limit 1;
  if o is null then raise exception 'As reservas ainda não estão disponíveis.'; end if;

  if length(v_nome) < 2 then raise exception 'Informe o nome do responsável.'; end if;
  if length(v_whats) in (12, 13) and left(v_whats, 2) = '55' then v_whats := substr(v_whats, 3); end if;
  if length(v_whats) not in (10, 11) then raise exception 'Informe um WhatsApp válido, com DDD.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'O e-mail parece incorreto. Confira ou deixe em branco.'; end if;
  if v_tipo not in ('aniversario', 'confraternizacao', 'reuniao', 'outro') then raise exception 'Escolha o tipo de evento.'; end if;

  if coalesce(p ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Informe a data do evento.'; end if;
  begin v_data := (p ->> 'data')::date; exception when others then raise exception 'Informe uma data válida.'; end;
  if v_data < hoje then raise exception 'A data do evento já passou. Escolha uma data a partir de hoje.'; end if;
  if v_data > hoje + 730 then raise exception 'Escolha uma data nos próximos dois anos.'; end if;

  if coalesce(p ->> 'inicio', '') !~ '^\d{2}:\d{2}$' or coalesce(p ->> 'termino', '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Informe o horário de início e o horário previsto de término.';
  end if;
  begin v_ini := (p ->> 'inicio')::time; v_fim := (p ->> 'termino')::time; exception when others then raise exception 'Horário inválido.'; end;
  if v_ini = v_fim then raise exception 'O horário de término precisa ser diferente do início.'; end if;
  if v_data = hoje and v_ini < agora then raise exception 'Esse horário de hoje já passou. Escolha outro horário.'; end if;

  if coalesce(p ->> 'pessoas', '') !~ '^\d{1,4}$' then raise exception 'Informe a quantidade de pessoas.'; end if;
  v_pessoas := (p ->> 'pessoas')::int;
  if v_pessoas < 1 or v_pessoas > 2000 then raise exception 'Informe uma quantidade de pessoas entre 1 e 2000.'; end if;

  if jsonb_typeof(p -> 'decoracao') is distinct from 'boolean' then raise exception 'Diga se precisa de decoração.'; end if;
  if nullif(p ->> 'orcamento', '') is not null then
    begin v_orc := round((p ->> 'orcamento')::numeric, 2); exception when others then raise exception 'Orçamento inválido.'; end;
    if v_orc < 0 or v_orc > 9999999 then raise exception 'Orçamento inválido.'; end if;
  end if;
  if (p -> 'aceite') is distinct from 'true'::jsonb then
    raise exception 'Marque a caixa "Entendo que a reserva só é garantida após confirmação da equipe".';
  end if;

  -- Limite de envios: por aparelho (IP), por WhatsApp e no total.
  begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
  ip := btrim(split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-forwarded-for', hdr ->> 'x-real-ip', ''), ',', 1));
  h := case when ip <> '' then md5(o::text || ip) end;
  if h is not null and (select count(*) from reservas where ip_hash = h and criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'Recebemos muitas solicitações deste aparelho agora. Tente de novo mais tarde ou fale com a gente pelo WhatsApp.';
  end if;
  if (select count(*) from reservas where whatsapp = v_whats and criado_em > now() - interval '1 day') >= 3 then
    raise exception 'Já recebemos solicitações deste WhatsApp hoje. Nossa equipe vai entrar em contato.';
  end if;
  if (select count(*) from reservas where criado_em > now() - interval '10 minutes') >= 40 then
    raise exception 'Muitas solicitações neste momento. Tente de novo em alguns minutos.';
  end if;

  insert into reservas (org_id, nome, empresa, whatsapp, email, tipo, tipo_outro, homenageado, data, inicio, termino, pessoas,
    decoracao, alimentacao, orcamento, observacoes, aceite, ip_hash)
  values (o, v_nome, v_empresa, v_whats, v_email, v_tipo, case when v_tipo = 'outro' then v_outro end, v_hom, v_data, v_ini, v_fim, v_pessoas,
    (p ->> 'decoracao')::boolean, v_alim, v_orc, v_obs, true, h)
  returning * into r;

  return jsonb_build_object('ok', true, 'codigo', upper(left(replace(r.id::text, '-', ''), 6)));
end $$;

revoke all on function public.criar_reserva(jsonb) from public;
grant execute on function public.criar_reserva(jsonb) to anon, authenticated;
