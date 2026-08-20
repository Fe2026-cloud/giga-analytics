-- ============================================================================
-- Migração 0018 — Marcar OS como sinalizada (Calculadora de Prazo)
-- ============================================================================
-- Registra quando um operador avisa o técnico de uma OS que está perto do
-- vencimento (coluna Sinalizar da Calculadora de Prazo), pra não avisar duas
-- vezes e pra saber quem/quando avisou. Chave é só o número da OS (não o dia)
-- porque a mesma OS em aberto costuma aparecer de novo em CSVs de dias
-- seguintes enquanto não é concluída — sinalizar uma vez deve "grudar" nela
-- até ela ser desmarcada ou concluída, independente de reimportação.
-- ============================================================================

create table public.prazo_sinalizacoes (
  os text primary key,
  nivel text not null check (nivel in ('ate24h','48h')),
  sinalizado_por uuid references auth.users(id),
  sinalizado_em timestamptz not null default now()
);
comment on table public.prazo_sinalizacoes is 'Marcação de "já avisei o técnico" por OS, feita na Calculadora de Prazo. Sobrevive a reimportação (chave é só o número da OS).';

alter table public.prazo_sinalizacoes enable row level security;

create policy "usuarios ativos leem sinalizacoes"
  on public.prazo_sinalizacoes for select
  using (public.esta_ativo());
create policy "operador/admin marcam sinalizacoes"
  on public.prazo_sinalizacoes for insert
  with check (public.pode_editar());
create policy "operador/admin atualizam sinalizacoes"
  on public.prazo_sinalizacoes for update
  using (public.pode_editar())
  with check (public.pode_editar());
create policy "operador/admin desmarcam sinalizacoes"
  on public.prazo_sinalizacoes for delete
  using (public.pode_editar());

alter publication supabase_realtime add table public.prazo_sinalizacoes;
