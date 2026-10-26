-- =====================================================================
-- Dindom · acesso da Contabilidade (rode depois do schema.sql)
-- Supabase > SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
--
-- A contabilidade só LÊ os dados do ponto (colaboradores, marcações, ajustes,
-- unidades e turnos) e só grava o próprio cadastro.
-- O admin define a senha do parceiro pelo app (Parceiros > Senha de acesso).
-- =====================================================================

-- Novo nível de acesso: contador.
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('colaborador', 'gerente', 'admin', 'contador'));

-- Leitura: a contabilidade vê só o que é do ponto.
drop policy if exists "membros leem os dados" on public.records;
create policy "membros leem os dados" on public.records for select using (
  public.is_member(org_id) and (
    public.my_role(org_id) <> 'contador'
    or collection in ('employees', 'punches', 'adjusts', 'units')
    or (collection = 'meta' and id in ('shifts', 'org'))
  )
);

-- Escrita: a contabilidade só grava o próprio cadastro (ex.: ao trocar a senha provisória).
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
