-- ============================================================================
-- Migração 0019 — Reincidências informadas ao gestor (módulo Reincidências)
-- ============================================================================
-- Registra quando um assistente já reportou uma reincidência (IRR/IFI) ao gestor
-- da área (coluna "Informada?" do módulo Reincidências) — pra não reportar duas
-- vezes e pra saber quem/quando informou. Chave é só o número da OS que
-- reincidiu (a nova), pelo mesmo motivo da 0018: a OS em aberto reaparece nos
-- CSVs dos dias seguintes e a marcação deve "grudar" nela.
-- ============================================================================

create table public.reincidencia_informadas (
  os text primary key,
  informado_por uuid references auth.users(id),
  informado_em timestamptz not null default now()
);
comment on table public.reincidencia_informadas is 'Marcação de "já informei o gestor" por OS reincidente (IRR/IFI). Sobrevive a reimportação (chave é só o número da OS).';

alter table public.reincidencia_informadas enable row level security;

create policy "usuarios ativos leem reincidencias informadas"
  on public.reincidencia_informadas for select
  using (public.esta_ativo());
create policy "operador/admin marcam reincidencias informadas"
  on public.reincidencia_informadas for insert
  with check (public.pode_editar());
create policy "operador/admin atualizam reincidencias informadas"
  on public.reincidencia_informadas for update
  using (public.pode_editar())
  with check (public.pode_editar());
create policy "operador/admin desmarcam reincidencias informadas"
  on public.reincidencia_informadas for delete
  using (public.pode_editar());

alter publication supabase_realtime add table public.reincidencia_informadas;
