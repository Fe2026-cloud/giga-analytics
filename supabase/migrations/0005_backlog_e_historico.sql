-- ============================================================================
-- Migração 0005 — Backlog e Histórico Diário (GIGA+ Analytics — Alteração 20)
-- ============================================================================
-- Substitui as chaves localStorage 'backlogChamados', 'backlogSnapshotsV2' e
-- 'history'. Fonte do backlog continua EXCLUSIVAMENTE o XLSX de chamados
-- abertos — nada aqui é calculado a partir dos CSVs de atividade.
--
--   backlog_atual      — última importação do XLSX (linha única, tipo "config")
--   backlog_snapshots  — 1 linha por importação válida do XLSX (nunca apagada,
--                        deduplicada por (data_referencia, assinatura) —
--                        mesma regra "mesmo arquivo não duplica" que já existia)
--   historico_diario   — 1 linha por dia (efetividade/presença), usada na
--                        evolução operacional por gestor
-- ============================================================================

create table public.backlog_atual (
  id boolean primary key default true check (id), -- trava: só pode existir 1 linha
  por_regional_tipo jsonb not null,
  total_considerado integer not null,
  ignoradas_unidade integer not null,
  total_linhas integer not null,
  filename text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
comment on table public.backlog_atual is 'Última importação do XLSX de chamados abertos (fonte exclusiva do backlog).';

create table public.backlog_snapshots (
  id uuid primary key default gen_random_uuid(),
  data_referencia text not null,       -- dia operacional vigente no momento da importação
  timestamp timestamptz not null,
  por_regional_tipo jsonb not null,
  total_geral integer not null,
  total_considerado integer not null,
  filename text,
  file_size bigint,
  assinatura text not null,            -- filename+tamanho+total, evita duplicar o mesmo arquivo
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (data_referencia, assinatura)
);
create index idx_backlog_snapshots_data on public.backlog_snapshots (data_referencia);
comment on table public.backlog_snapshots is 'Fotografias horárias do backlog, uma por importação válida do XLSX. Nunca apagadas quando um XLSX novo é importado.';

create table public.historico_diario (
  data_referencia text primary key,
  por_regional jsonb not null,         -- {C10:{tecnicos:[...],total,concluidas,naoConcluidas,backlog}, C13:{...}, C14:{...}}
  total integer not null,
  concluidas integer not null,
  nao_concluidas integer not null,
  abertas integer not null,
  updated_at timestamptz not null default now()
);
comment on table public.historico_diario is 'Snapshot diário (efetividade/presença) por regional, usado na evolução operacional por gestor.';

alter table public.backlog_atual enable row level security;
alter table public.backlog_snapshots enable row level security;
alter table public.historico_diario enable row level security;

create policy "usuarios ativos leem backlog_atual" on public.backlog_atual for select using (public.esta_ativo());
create policy "admin/operador inserem backlog_atual" on public.backlog_atual for insert with check (public.pode_editar());
create policy "admin/operador atualizam backlog_atual" on public.backlog_atual for update using (public.pode_editar()) with check (public.pode_editar());

create policy "usuarios ativos leem backlog_snapshots" on public.backlog_snapshots for select using (public.esta_ativo());
create policy "admin/operador inserem backlog_snapshots" on public.backlog_snapshots for insert with check (public.pode_editar());

create policy "usuarios ativos leem historico_diario" on public.historico_diario for select using (public.esta_ativo());
create policy "admin/operador inserem historico_diario" on public.historico_diario for insert with check (public.pode_editar());
create policy "admin/operador atualizam historico_diario" on public.historico_diario for update using (public.pode_editar()) with check (public.pode_editar());
