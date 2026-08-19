-- ============================================================================
-- Migração 0017 — Limpa sufixo de regional colado no nome do técnico (Recurso)
-- ============================================================================
-- Alguns exports de OS trazem o nome do técnico com o rótulo da regional colado
-- (ex.: "FULANO LITORAL SUL" em vez de "FULANO"), fazendo a mesma pessoa virar
-- 2 entradas diferentes em Produção por Recurso e outros lugares que agrupam
-- por nome do recurso. index.html já para de gerar isso em novas importações
-- (normalizeRows/normalizeRedeExternaRows) — esta migração só limpa o que já
-- está salvo.
-- ============================================================================

update public.ordens_servico
set recurso = trim(regexp_replace(
  recurso,
  '\s+(LITORAL\s+(SUL|NORTE)|VALE\s+DO\s+PARA[IÍ]BA|REDE\s+EXTERNA|INFRAESTRUTURA(\s+POP)?|REDE\s+B2B)\s*$',
  '', 'i'
))
where recurso ~* '\s+(LITORAL\s+(SUL|NORTE)|VALE\s+DO\s+PARA[IÍ]BA|REDE\s+EXTERNA|INFRAESTRUTURA(\s+POP)?|REDE\s+B2B)\s*$';

update public.rede_externa_atividades
set recurso = trim(regexp_replace(
  recurso,
  '\s+(LITORAL\s+(SUL|NORTE)|VALE\s+DO\s+PARA[IÍ]BA|REDE\s+EXTERNA|INFRAESTRUTURA(\s+POP)?|REDE\s+B2B)\s*$',
  '', 'i'
))
where recurso ~* '\s+(LITORAL\s+(SUL|NORTE)|VALE\s+DO\s+PARA[IÍ]BA|REDE\s+EXTERNA|INFRAESTRUTURA(\s+POP)?|REDE\s+B2B)\s*$';
