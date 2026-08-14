-- ============================================================================
-- Migração 0007 — Motivos de Ausência (registro manual do operador)
-- ============================================================================
-- Não importa nenhuma planilha de RH — é um registro manual: no módulo
-- Pessoas, pra cada técnico "sem OS hoje", o operador escolhe o motivo numa
-- lista suspensa. Fica salvo por (slot, técnico, dia), então dá pra
-- consultar depois "quantas vezes fulano se ausentou e por quê".
-- ============================================================================

create table public.ausencias (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('C10','C13','C14','JH','VIRTUS')),
  nome_tecnico text not null,
  data_referencia text not null,  -- 'DD/MM/YY', mesmo formato usado no resto do painel
  motivo text not null check (motivo in (
    'Afastado','Atestado','Falta Injustificada','Férias','Folga',
    'Novo Recurso em Treinamento','Outros','TBD'
  )),
  registrado_por uuid references auth.users(id),
  registrado_em timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot, nome_tecnico, data_referencia)
);
comment on table public.ausencias is 'Motivo de ausência registrado manualmente pelo operador, por técnico/dia. Não vem de nenhuma importação — é preenchido no módulo Pessoas.';

create index idx_ausencias_tecnico on public.ausencias (nome_tecnico);
create index idx_ausencias_data on public.ausencias (data_referencia);

create or replace function public.set_updated_at_ausencias()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger trg_ausencias_updated_at
  before update on public.ausencias
  for each row execute function public.set_updated_at_ausencias();

alter table public.ausencias enable row level security;

create policy "usuarios ativos leem ausencias" on public.ausencias for select using (public.esta_ativo());
create policy "admin/operador inserem ausencias" on public.ausencias for insert with check (public.pode_editar());
create policy "admin/operador atualizam ausencias" on public.ausencias for update using (public.pode_editar()) with check (public.pode_editar());
create policy "admin/operador apagam ausencias" on public.ausencias for delete using (public.pode_editar());

alter publication supabase_realtime add table public.ausencias;
