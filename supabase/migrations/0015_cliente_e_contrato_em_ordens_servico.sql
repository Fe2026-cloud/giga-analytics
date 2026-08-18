-- ============================================================================
-- Migração 0015 — Cliente e Contrato em ordens_servico
-- ============================================================================
-- Detalhamento das ordens de um motivo (módulo Improdutivas) precisa mostrar
-- nome do cliente e número do contrato. Vêm das colunas "Nome" e "Número do
-- contrato" do CSV de OS normal (ver normalizeRows em index.html). Colunas
-- nullable — importações antigas continuam funcionando sem esse dado.
-- ============================================================================

alter table public.ordens_servico
  add column if not exists cliente text,
  add column if not exists contrato text;

comment on column public.ordens_servico.cliente is 'Nome do cliente (coluna "Nome" no CSV)';
comment on column public.ordens_servico.contrato is 'Número do contrato (coluna "Número do contrato" no CSV)';
