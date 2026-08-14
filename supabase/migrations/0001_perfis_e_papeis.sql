-- ============================================================================
-- Migração 0001 — Usuários e Perfis (GIGA+ Analytics — Alteração 20, Fase 1)
-- ============================================================================
-- O que faz:
--   1. Cria o enum de papéis de permissão (administrador / operador / visualizacao)
--   2. Cria a tabela public.perfis, 1:1 com auth.users (Supabase Auth já existe,
--      não precisamos criar tabela de login — só estender com nossos dados)
--   3. Estrutura (não ativada ainda) para permissão por regional/EPS:
--      coluna regionais_permitidas — NULL/vazio = enxerga tudo (Consolidado)
--   4. Trigger que cria automaticamente um perfil quando alguém se cadastra
--      no Supabase Auth — o PRIMEIRO usuário a se cadastrar vira administrador
--      automaticamente (bootstrap), os seguintes entram como "operador" por
--      padrão (um admin promove/rebaixa depois pela tela de administração).
--   5. Row Level Security: cada usuário só lê o próprio perfil; administradores
--      leem e editam todos.
-- ============================================================================

-- 1. Enum de papéis --------------------------------------------------------
create type public.papel_usuario as enum ('administrador', 'operador', 'visualizacao');

-- 2. Tabela de perfis -------------------------------------------------------
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome_completo text,
  papel public.papel_usuario not null default 'operador',
  -- Fase futura (não obrigatório ativar já): lista de regionais/EPS que o
  -- usuário pode ver. NULL ou array vazio = vê tudo (Consolidado + todas).
  -- Valores esperados quando ativado: 'C10','C13','C14','JH','VIRTUS'.
  regionais_permitidas text[],
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.perfis is 'Extensão de auth.users: papel de permissão e escopo de regionais de cada usuário do painel.';
comment on column public.perfis.regionais_permitidas is 'NULL/[] = acesso a todas as regionais (Consolidado). Estrutura pronta, não ativada na Fase 1.';

-- updated_at automático -------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_perfis_updated_at
  before update on public.perfis
  for each row execute function public.set_updated_at();

-- 3. Função auxiliar p/ policies (evita recursão de RLS na própria tabela) --
create or replace function public.meu_papel()
returns public.papel_usuario
language sql
security definer
stable
set search_path = public
as $$
  select papel from public.perfis where id = auth.uid()
$$;

-- 4. Bootstrap automático de perfil ao criar usuário -------------------------
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Row Level Security -------------------------------------------------------
alter table public.perfis enable row level security;

create policy "usuario ve o proprio perfil"
  on public.perfis for select
  using (id = auth.uid());

create policy "admin ve todos os perfis"
  on public.perfis for select
  using (public.meu_papel() = 'administrador');

create policy "admin atualiza qualquer perfil"
  on public.perfis for update
  using (public.meu_papel() = 'administrador')
  with check (public.meu_papel() = 'administrador');

-- Nenhuma policy de INSERT/DELETE para usuários comuns: perfis nascem
-- exclusivamente pela trigger acima (SECURITY DEFINER, roda como owner,
-- não passa pela RLS). Exclusão de usuário deve ser feita via painel
-- de administração do Supabase Auth (cascade apaga o perfil junto).
