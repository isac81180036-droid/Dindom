-- =====================================================================
-- Dindom · acesso da Contabilidade (rode depois do schema.sql)
-- Supabase > SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
--
-- A contabilidade só LÊ os dados do ponto (colaboradores, marcações, ajustes,
-- unidades e turnos) e só grava o próprio cadastro.
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
