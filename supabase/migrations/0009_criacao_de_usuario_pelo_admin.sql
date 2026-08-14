-- ============================================================================
-- Migração 0009 — Criação de usuário direto pela tela de Administração
-- ============================================================================
-- Agora que o cadastro público (Auth > Sign In / Providers) está desativado,
-- só um administrador consegue dar acesso a alguém novo. Ele faz isso pela
-- tela de Administração (e-mail + papel), o painel chama uma Edge Function
-- (que usa a service_role key, nunca exposta no navegador) pra criar o
-- usuário de verdade no Supabase Auth com uma senha padrão. No primeiro
-- login, o painel obriga a pessoa a trocar essa senha.
-- ============================================================================

alter table public.perfis
  add column deve_trocar_senha boolean not null default false;

comment on column public.perfis.deve_trocar_senha is
  'true = conta criada pelo admin com senha padrão; painel bloqueia até a pessoa trocar no primeiro acesso.';

-- Qualquer usuário logado pode limpar a PRÓPRIA flag (depois de trocar a senha).
-- security definer + só toca na própria linha (auth.uid()) -> seguro, não dá
-- pra usar isso pra mexer em papel/ativo de ninguém.
create or replace function public.marcar_senha_trocada()
returns void
language sql
security definer
set search_path = public
as $$
  update public.perfis set deve_trocar_senha = false where id = auth.uid();
$$;
