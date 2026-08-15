-- ============================================================================
-- Migração 0014 — Botão de limpar individual por regional/grupo (🗑 em cada
-- dropzone) — mesma trava de administrador da migração 0013, agora também
-- pra rede_externa_importacoes (antes usava pode_importar(), admin ou
-- operador; apagar dados importados sempre afeta todo mundo que usa o
-- painel, então fica só pra administrador).
-- ============================================================================

drop policy "admin/operador apagam rede_externa_importacoes" on public.rede_externa_importacoes;

create policy "so admin apaga rede_externa_importacoes"
  on public.rede_externa_importacoes for delete
  using (public.meu_papel() = 'administrador');
