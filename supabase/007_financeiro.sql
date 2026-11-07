-- =====================================================================
-- Dindom · Financeiro (custos, metas e lucro)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado do app é apagado.
--
-- Os números do financeiro (folha, custos, lucro) ficam numa tabela própria, que SÓ o
-- administrador lê e altera. Gerentes e colaboradores não enxergam, nem pelo app nem pela API.
-- Uma linha "config" (custos e metas) e uma linha por mês ("m-2026-11": faturamento lançado à mão
-- e despesas extras do mês).
-- =====================================================================

create table if not exists public.financeiro (
  org_id uuid not null references public.orgs(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (org_id, id)
);

alter table public.financeiro enable row level security;

drop policy if exists financeiro_admin on public.financeiro;
create policy financeiro_admin on public.financeiro for all to authenticated
  using (public.is_admin(org_id))
  with check (public.is_admin(org_id));

revoke all on public.financeiro from anon;
grant select, insert, update, delete on public.financeiro to authenticated;
