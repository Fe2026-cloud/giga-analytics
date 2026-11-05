-- ============================================================================
-- Migração 0021 — Cumprimento de Agenda (módulo novo)
-- ============================================================================
-- Guarda o export "Analítico" do Power BI (Indicador de Cumprimento de Agenda),
-- 1 linha por OS e por indicador (REPAROS_24H / ALTAS_48H). O painel NÃO recalcula a
-- regra: usa os flags que já vêm no arquivo —
--   • flag_prazo = cumpriu o prazo de 24h/48h desde a abertura  (Indicador ATUAL)
--   • cumpriu    = coluna "Resolutividade" = Sim                  (NOVO indicador:
--                  cumprimento de agenda + cumprimento de SLA)
--   • marcacao   = AGENDA (cliente confirmou dentro do prazo) | AGENDA_SC (sem confirmação → vale o SLA)
-- Chave (os, indicador): reimportar o mesmo período atualiza as linhas em vez de duplicar.
-- ============================================================================

create table public.cumprimento_agenda_os (
  os text not null,
  indicador text not null,
  chamado text,
  contrato text,
  cidade text,
  regional text,
  cluster text,
  terceirizada text,
  marcacao text,
  flag_prazo boolean,
  cumpriu boolean,
  flag_confirmacao boolean,
  data_abertura date,
  turno_chamado text,
  data_inicio_os date,
  turno_inicio text,
  data_evento date,
  turno_evento text,
  usuario_menor_agenda text,
  data_menor_agenda date,
  turno_menor_agenda text,
  data_primeira_visita date,
  turno_primeira_visita text,
  total_visitas integer,
  nca_antes_visita boolean,
  total_nca integer,
  flag_antecipacao boolean,
  flag_visita_menor_agenda boolean,
  flag_quebra_menor_agenda boolean,
  flag_visita_24h boolean,
  motivo_quebra text,
  submotivo_quebra text,
  operador_cat text,
  agenda_dentro_24h boolean,
  diferenca_minutos integer,
  importado_por uuid references auth.users(id),
  importado_em timestamptz not null default now(),
  primary key (os, indicador)
);
comment on table public.cumprimento_agenda_os is 'Export analítico do Power BI "Cumprimento de Agenda" (1 linha por OS/indicador). Flags vêm prontos do arquivo.';
create index cumprimento_agenda_os_data_evento_idx on public.cumprimento_agenda_os (data_evento);

alter table public.cumprimento_agenda_os enable row level security;

create policy "usuarios ativos leem cumprimento de agenda"
  on public.cumprimento_agenda_os for select
  using (public.esta_ativo());
create policy "operador/admin importam cumprimento de agenda"
  on public.cumprimento_agenda_os for insert
  with check (public.pode_editar());
create policy "operador/admin atualizam cumprimento de agenda"
  on public.cumprimento_agenda_os for update
  using (public.pode_editar())
  with check (public.pode_editar());
create policy "admin apaga cumprimento de agenda"
  on public.cumprimento_agenda_os for delete
  using (public.meu_papel() = 'administrador');

alter publication supabase_realtime add table public.cumprimento_agenda_os;
