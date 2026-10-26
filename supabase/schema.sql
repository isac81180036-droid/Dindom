-- =====================================================================
-- Dindom · banco de dados no Supabase
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema (só cria o que ainda não existe).
-- =====================================================================

-- ---------- Tabelas ----------

-- A pizzaria (um único negócio por banco).
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Dindom',
  created_at timestamptz not null default now()
);

-- Quem faz parte da equipe: liga a conta de login (auth.users) ao cadastro de colaborador do app.
create table if not exists public.members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emp_id text not null,
  role text not null check (role in ('colaborador', 'gerente', 'admin', 'contador')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Todos os dados do app, item por item (produtos, pontos, chamados, eventos...).
-- collection = tipo do dado; id = identificador do item; data = o item em JSON.
create table if not exists public.records (
  org_id uuid not null references public.orgs(id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (org_id, collection, id)
);
create index if not exists records_org_updated on public.records (org_id, updated_at);

-- ---------- Funções de permissão ----------

create or replace function public.my_role(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members where org_id = o and user_id = auth.uid() and active
$$;

create or replace function public.is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role(o) is not null
$$;

create or replace function public.is_manager(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(o) in ('gerente', 'admin'), false)
$$;

create or replace function public.is_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(o) = 'admin', false)
$$;

create or replace function public.my_emp(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select emp_id from members where org_id = o and user_id = auth.uid() and active
$$;

-- ---------- Segurança por linha (RLS) ----------

alter table public.orgs enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;

drop policy if exists "membros leem a pizzaria" on public.orgs;
create policy "membros leem a pizzaria" on public.orgs for select using (public.is_member(id));

drop policy if exists "admin altera a pizzaria" on public.orgs;
create policy "admin altera a pizzaria" on public.orgs for update using (public.is_admin(id));

-- Cada pessoa lê o próprio vínculo (inclusive desativado, para o app avisar); membros leem a equipe.
drop policy if exists "membros leem a equipe" on public.members;
create policy "membros leem a equipe" on public.members for select
  using (user_id = auth.uid() or public.is_member(org_id));

drop policy if exists "admin gerencia a equipe" on public.members;
create policy "admin gerencia a equipe" on public.members for all
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));

drop policy if exists "membros leem os dados" on public.records;
create policy "membros leem os dados" on public.records for select using (public.is_member(org_id));

-- Membros gravam os dados do dia a dia. Cadastro de colaboradores: só o admin
-- (cada pessoa pode atualizar o próprio cadastro, por exemplo ao trocar a senha).
drop policy if exists "membros gravam os dados" on public.records;
create policy "membros gravam os dados" on public.records for insert
  with check (public.is_member(org_id) and (collection <> 'employees' or public.is_admin(org_id) or id = public.my_emp(org_id)));

drop policy if exists "membros atualizam os dados" on public.records;
create policy "membros atualizam os dados" on public.records for update
  using (public.is_member(org_id))
  with check (public.is_member(org_id) and (collection <> 'employees' or public.is_admin(org_id) or id = public.my_emp(org_id)));

-- ---------- Criação da pizzaria (primeira configuração) ----------

-- Só funciona uma vez: depois que a pizzaria existe, ninguém mais cria outra.
create or replace function public.create_org(p_name text, p_emp_id text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if auth.uid() is null then raise exception 'É preciso estar logado.'; end if;
  if exists (select 1 from orgs) then raise exception 'A pizzaria já foi configurada.'; end if;
  insert into orgs (name) values (coalesce(nullif(p_name, ''), 'Dindom')) returning id into o;
  insert into members (org_id, user_id, emp_id, role) values (o, auth.uid(), p_emp_id, 'admin');
  return o;
end $$;

-- Diz ao app se a pizzaria já foi configurada (para mostrar login ou primeira configuração).
create or replace function public.org_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orgs)
$$;

grant execute on function public.create_org(text, text) to authenticated;
grant execute on function public.org_exists() to anon, authenticated;

-- ---------- Automatismos ----------

-- Atualiza o horário de alteração.
create or replace function public.touch_updated() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_updated();

-- NSR do ponto: número sequencial gerado pelo servidor, que nunca repete nem muda.
create sequence if not exists public.nsr_seq;

create or replace function public.set_nsr() returns trigger
language plpgsql security definer set search_path = public as $$
declare existing jsonb;
begin
  if new.collection = 'punches' then
    select data -> 'nsr' into existing from records
      where org_id = new.org_id and collection = new.collection and id = new.id;
    if existing is not null then
      new.data := jsonb_set(new.data, '{nsr}', existing);
    else
      new.data := jsonb_set(new.data, '{nsr}', to_jsonb(nextval('public.nsr_seq')));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists records_nsr on public.records;
create trigger records_nsr before insert or update on public.records
  for each row execute function public.set_nsr();

-- Tempo real: os aparelhos recebem na hora o que os outros gravam.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- ---------- Contabilidade (também em 002_contabilidade.sql) ----------
-- A contabilidade só lê os dados do ponto e não grava nada.
drop policy if exists "membros leem os dados" on public.records;
create policy "membros leem os dados" on public.records for select using (
  public.is_member(org_id) and (
    public.my_role(org_id) <> 'contador'
    or collection in ('employees', 'punches', 'adjusts', 'units')
    or (collection = 'meta' and id in ('shifts', 'org'))
  )
);
drop policy if exists "membros gravam os dados" on public.records;
create policy "membros gravam os dados" on public.records for insert
  with check (public.is_member(org_id)
    and (public.my_role(org_id) <> 'contador' or (collection = 'employees' and id = public.my_emp(org_id)))
    and (collection <> 'employees' or public.is_admin(org_id) or id = public.my_emp(org_id)));
drop policy if exists "membros atualizam os dados" on public.records;
create policy "membros atualizam os dados" on public.records for update
  using (public.is_member(org_id)
    and (public.my_role(org_id) <> 'contador' or (collection = 'employees' and id = public.my_emp(org_id))))
  with check (public.is_member(org_id)
    and (public.my_role(org_id) <> 'contador' or (collection = 'employees' and id = public.my_emp(org_id)))
    and (collection <> 'employees' or public.is_admin(org_id) or id = public.my_emp(org_id)));
-- ---------- Parceiros: senha definida pelo admin ----------
create extension if not exists pgcrypto with schema extensions;

-- O app confere se este arquivo já rodou antes de criar o login do parceiro.
create or replace function public.parceiros_ok() returns boolean
language sql stable as $$ select true $$;

-- Liga à equipe uma conta de login que ficou sem vínculo (cadastro que falhou no meio)
-- e grava a senha nova. Devolve null se o e-mail ainda não tem conta.
create or replace function public.claim_user(p_email text, p_emp_id text, p_role text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; u uuid;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador cadastra acessos.'; end if;
  if p_role not in ('colaborador', 'gerente', 'admin', 'contador') then raise exception 'Nível de acesso inválido.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Use pelo menos 8 caracteres na senha.'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then return null; end if;
  if exists (select 1 from members where user_id = u) then raise exception 'Este e-mail já tem uma conta no sistema.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = u;
  insert into members (org_id, user_id, emp_id, role) values (o, u, p_emp_id, p_role);
  return u;
end $$;

-- O admin define (ou troca) a senha de um parceiro da contabilidade.
create or replace function public.set_partner_password(p_emp_id text, p_password text)
returns void language plpgsql security definer set search_path = public as $$
declare o uuid; u uuid;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador muda a senha de parceiros.'; end if;
  select user_id into u from members where org_id = o and emp_id = p_emp_id and role = 'contador';
  if u is null then raise exception 'Parceiro não encontrado.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Use pelo menos 8 caracteres na senha.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = u;
end $$;

revoke all on function public.claim_user(text, text, text, text) from public, anon;
revoke all on function public.set_partner_password(text, text) from public, anon;
grant execute on function public.parceiros_ok() to authenticated;
grant execute on function public.claim_user(text, text, text, text) to authenticated;
grant execute on function public.set_partner_password(text, text) to authenticated;
