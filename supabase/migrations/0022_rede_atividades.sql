-- ============================================================================
-- Migração 0022 — módulo REDE (ordens de rede abertas e há quanto tempo)
-- ============================================================================
-- Cada importação (1 CSV de atividades por cluster: C10, C13, C14) é uma FOTO do momento:
-- substitui por inteiro as OS abertas daquele cluster. O painel calcula "tempo aberta" no
-- navegador (agora − aberta_em), então o contador anda sozinho sem nova importação.
--   • rede_atividades  : 1 linha por OS aberta (iniciado / em rota / pendente / suspenso)
--   • rede_importacoes : 1 linha por cluster com quando/quem/qual arquivo foi a última foto
-- ============================================================================

create table public.rede_atividades (
  cluster text not null check (cluster in ('C10', 'C13', 'C14')),
  os text not null,
  recurso text,
  status text not null,
  tipo_atividade text,
  contrato text,
  endereco text,
  bairro text,
  cidade text,
  unidade text,
  janela text,
  inicio_previsto text,
  fim_previsto text,
  aberta_em timestamptz,
  importado_em timestamptz not null default now(),
  primary key (cluster, os)
);
comment on table public.rede_atividades is 'OS de rede abertas por cluster (foto da última importação do CSV de atividades). Tempo aberta = agora − aberta_em, calculado no painel.';
create index rede_atividades_aberta_em_idx on public.rede_atividades (aberta_em);

create table public.rede_importacoes (
  cluster text primary key check (cluster in ('C10', 'C13', 'C14')),
  arquivo text,
  data_arquivo date,
  total_linhas integer not null default 0,
  abertas integer not null default 0,
  ignoradas integer not null default 0,
  importado_por uuid references auth.users(id),
  importado_em timestamptz not null default now()
);
comment on table public.rede_importacoes is 'Última importação do módulo Rede, por cluster.';

alter table public.rede_atividades enable row level security;
alter table public.rede_importacoes enable row level security;

create policy "usuarios ativos leem rede_atividades"
  on public.rede_atividades for select using (public.esta_ativo());
create policy "operador/admin inserem rede_atividades"
  on public.rede_atividades for insert with check (public.pode_editar());
create policy "operador/admin atualizam rede_atividades"
  on public.rede_atividades for update using (public.pode_editar()) with check (public.pode_editar());
create policy "operador/admin apagam rede_atividades"
  on public.rede_atividades for delete using (public.pode_editar());

create policy "usuarios ativos leem rede_importacoes"
  on public.rede_importacoes for select using (public.esta_ativo());
create policy "operador/admin inserem rede_importacoes"
  on public.rede_importacoes for insert with check (public.pode_editar());
create policy "operador/admin atualizam rede_importacoes"
  on public.rede_importacoes for update using (public.pode_editar()) with check (public.pode_editar());
create policy "operador/admin apagam rede_importacoes"
  on public.rede_importacoes for delete using (public.pode_editar());

alter publication supabase_realtime add table public.rede_atividades;
alter publication supabase_realtime add table public.rede_importacoes;
