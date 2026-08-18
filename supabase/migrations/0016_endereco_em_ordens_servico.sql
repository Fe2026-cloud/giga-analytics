-- ============================================================================
-- Migração 0016 — Endereço em ordens_servico
-- ============================================================================
-- Detalhamento das ordens de um motivo (módulo Improdutivas) também mostra o
-- endereço. Vem da coluna "Endereço" do CSV de OS normal (ver normalizeRows
-- em index.html). Nullable — importações antigas continuam funcionando.
-- ============================================================================

alter table public.ordens_servico
  add column if not exists endereco text;

comment on column public.ordens_servico.endereco is 'Endereço da OS (coluna "Endereço" no CSV)';
