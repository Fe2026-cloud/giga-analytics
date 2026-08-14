-- ============================================================================
-- Migração 0013 — "Limpar base" (apaga TUDO) fica restrito a administrador
-- ============================================================================
-- limparOrdensServicoDoSupabase() apaga TODA a tabela importacoes_csv (as
-- ordens_servico ligadas somem via on delete cascade). Até aqui, a policy de
-- delete usava pode_importar() (admin OU operador) — mesma regra de importar
-- um CSV normal. Restringe só o DELETE pra administrador; INSERT/UPDATE
-- continuam liberados pra operador (import normal e fechar dia vigente
-- continuam funcionando igual).
-- ============================================================================

drop policy "operador/admin apagam importacoes" on public.importacoes_csv;

create policy "so admin apaga importacoes"
  on public.importacoes_csv for delete
  using (public.meu_papel() = 'administrador');
