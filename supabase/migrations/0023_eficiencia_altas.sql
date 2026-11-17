-- ============================================================================
-- Migração 0023 — módulo EFICIÊNCIA DE ALTAS (vendas × ativações)
-- ============================================================================
-- Fonte: export "data" do Power BI (XLSX), 1 linha por contrato vendido.
--   • eficiencia_contratos : 1 linha por contrato (upsert por contrato a cada importação,
--                            então o estado mais recente — ativado, cancelado, motivo — prevalece)
--   • eficiencia_importacoes : 1 linha por mês de referência importado (o mês com mais vendas no arquivo);
--                            é ela que define quais meses aparecem no painel, para um mês parcial
--                            (ex.: as vendas de outubro que só aparecem porque ativaram em novembro)
--                            não entrar no comparativo mensal como se fosse um mês completo.
-- Regras (conferidas contra o Power BI): vendas do mês = Data Venda no mês · altas do mês = Data Ativação no mês
-- (inclui ativação de venda de meses anteriores) · eficiência = altas ÷ vendas.
-- ============================================================================

create table public.eficiencia_contratos (
  contrato text primary key,
  cliente text,
  area text,
  territorio text,
  uf text,
  cidade text,
  bairro text,
  canal text,
  equipe text,
  aprov_sydle text,
  data_venda date not null,
  data_ativacao date,
  habilitado boolean not null default false,
  data_cancelamento date,
  motivo1 text,
  submotivo1 text,
  ultimo_motivo text,
  ultimo_submotivo text,
  tipo_motivo text,
  responsavel text,
  status text,
  expurgo boolean not null default false,
  tipo_expurgo text,
  semana text,
  ftta boolean not null default false,
  importado_em timestamptz not null default now()
);
comment on table public.eficiencia_contratos is 'Contratos vendidos (export do Power BI) para o módulo Eficiência de Altas.';
create index eficiencia_contratos_venda_idx on public.eficiencia_contratos (data_venda);
create index eficiencia_contratos_ativacao_idx on public.eficiencia_contratos (data_ativacao);

create table public.eficiencia_importacoes (
  mes date primary key,
  arquivo text,
  linhas integer not null default 0,
  vendas integer not null default 0,
  altas integer not null default 0,
  importado_por uuid references auth.users(id),
  importado_em timestamptz not null default now()
);
comment on table public.eficiencia_importacoes is 'Mês de referência (1º dia) de cada importação do módulo Eficiência de Altas.';

alter table public.eficiencia_contratos enable row level security;
alter table public.eficiencia_importacoes enable row level security;

create policy "usuarios ativos leem eficiencia_contratos"
  on public.eficiencia_contratos for select using (public.esta_ativo());
create policy "operador/admin inserem eficiencia_contratos"
  on public.eficiencia_contratos for insert with check (public.pode_editar());
create policy "operador/admin atualizam eficiencia_contratos"
  on public.eficiencia_contratos for update using (public.pode_editar()) with check (public.pode_editar());
create policy "operador/admin apagam eficiencia_contratos"
  on public.eficiencia_contratos for delete using (public.pode_editar());

create policy "usuarios ativos leem eficiencia_importacoes"
  on public.eficiencia_importacoes for select using (public.esta_ativo());
create policy "operador/admin inserem eficiencia_importacoes"
  on public.eficiencia_importacoes for insert with check (public.pode_editar());
create policy "operador/admin atualizam eficiencia_importacoes"
  on public.eficiencia_importacoes for update using (public.pode_editar()) with check (public.pode_editar());
create policy "operador/admin apagam eficiencia_importacoes"
  on public.eficiencia_importacoes for delete using (public.pode_editar());

alter publication supabase_realtime add table public.eficiencia_contratos;
alter publication supabase_realtime add table public.eficiencia_importacoes;
