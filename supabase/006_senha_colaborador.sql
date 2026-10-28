-- =====================================================================
-- Dindom · o administrador define a senha de qualquer pessoa da equipe
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema. Nenhum dado do app é apagado.
--
-- Além de gravar a senha nova, conserta o acesso que ficou pela metade:
-- • e-mail ainda não confirmado (com "Confirm email" ligado no Supabase, o login falha);
-- • conta de login que existe mas não ficou ligada à equipe (cadastro que falhou no meio);
-- • conta ligada à pessoa, mas com um e-mail diferente do cadastro no app.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Devolve 'ok', ou 'sem_conta' quando o e-mail ainda não tem login (aí o app cria a conta e chama de novo).
create or replace function public.definir_senha(p_emp_id text, p_email text, p_password text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare o uuid; mail text := lower(trim(coalesce(p_email, ''))); ligado uuid; conta uuid; dono text;
begin
  select org_id into o from members where user_id = auth.uid() and role = 'admin' and active limit 1;
  if o is null then raise exception 'Só o administrador define senhas.'; end if;
  if p_role not in ('colaborador', 'gerente', 'admin', 'contador') then raise exception 'Nível de acesso inválido.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Use pelo menos 8 caracteres na senha.'; end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'O cadastro da pessoa está sem um e-mail válido.'; end if;

  select user_id into ligado from members where org_id = o and emp_id = p_emp_id limit 1;   -- login já ligado à pessoa
  select id into conta from auth.users where lower(email) = mail limit 1;                   -- login com o e-mail do cadastro

  if ligado is null and conta is null then return 'sem_conta'; end if;

  if ligado is null then
    -- O e-mail tem login, mas sem vínculo com a equipe: liga à pessoa.
    select emp_id into dono from members where user_id = conta limit 1;
    if dono is not null then raise exception 'Este e-mail já é o acesso de outra pessoa da equipe.'; end if;
    insert into members (org_id, user_id, emp_id, role) values (o, conta, p_emp_id, p_role);
    ligado := conta;
  elsif conta is not null and conta <> ligado then
    raise exception 'O e-mail % já tem outra conta de login. Use outro e-mail no cadastro.', mail;
  elsif conta is null then
    -- A conta ligada à pessoa usa outro e-mail: passa a usar o do cadastro, que é o que ela digita para entrar.
    update auth.users set email = mail, updated_at = now() where id = ligado;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', mail), updated_at = now()
      where user_id = ligado and provider = 'email';
  end if;

  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
    where id = ligado;
  -- Nível de acesso igual ao do cadastro no app (o "ativo" não muda: desativado continua sem entrar).
  update members set role = p_role where org_id = o and user_id = ligado and role <> p_role;
  return 'ok';
end $$;

revoke all on function public.definir_senha(text, text, text, text) from public, anon;
grant execute on function public.definir_senha(text, text, text, text) to authenticated;
