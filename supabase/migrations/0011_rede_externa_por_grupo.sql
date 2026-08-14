-- ============================================================================
-- Migração 0011 — Rede Externa passa a ser 2 CSVs separados (Infraestrutura
-- POP e Rede Externa), sem depender de lista de técnicos pra classificar.
-- ============================================================================
-- Descobrimos que o grupo (Infraestrutura POP / Rede Externa) já vem definido
-- por qual arquivo foi importado — não precisa mais de roster nome->grupo.
-- Adiciona a coluna "grupo" em rede_externa_importacoes e troca a constraint
-- de unicidade de (data_referencia) pra (data_referencia, grupo), já que agora
-- pode ter 2 importações no mesmo dia (uma de cada grupo).
-- ============================================================================

alter table public.rede_externa_importacoes
  add column grupo text not null default 'Rede Externa' check (grupo in ('Infraestrutura POP','Rede Externa','B2B'));

alter table public.rede_externa_importacoes
  drop constraint rede_externa_importacoes_data_referencia_key;

alter table public.rede_externa_importacoes
  add constraint rede_externa_importacoes_data_grupo_key unique (data_referencia, grupo);

comment on column public.rede_externa_importacoes.grupo is 'Infraestrutura POP / Rede Externa / B2B — definido por qual CSV foi importado (não mais por lista de técnicos).';
