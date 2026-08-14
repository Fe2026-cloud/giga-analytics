-- ============================================================================
-- Migração 0002 — Corrige cast de enum na trigger de bootstrap de usuário
-- ============================================================================
-- Bug: "column "papel" is of type papel_usuario but expression is of type text"
-- O CASE WHEN dentro do PL/pgSQL resolve como text; faltava cast explícito
-- pro enum public.papel_usuario antes do INSERT.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eh_primeiro_usuario boolean;
begin
  select not exists(select 1 from public.perfis) into eh_primeiro_usuario;

  insert into public.perfis (id, email, nome_completo, papel)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome_completo', new.email),
    (case when eh_primeiro_usuario then 'administrador' else 'operador' end)::public.papel_usuario
  );

  return new;
end;
$$;
