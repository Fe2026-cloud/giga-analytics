-- ============================================================================
-- Migração 0003 — Ordens de Serviço (GIGA+ Analytics — Alteração 20, Fase 1 item 4)
-- ============================================================================
-- Substitui as chaves localStorage 'operacional' e 'historico' (mesma tabela,
-- diferenciadas pela flag "vigente" em importacoes_csv, exatamente como
-- sugerido no brief).
--
--   importacoes_csv  — 1 linha por arquivo CSV importado (metadado do lote)
--   ordens_servico   — 1 linha por Ordem de Serviço, ligada à importação
--
-- regional/empresa/vigente NÃO são duplicados em cada OS: vêm sempre via
-- join com importacoes_csv, evitando dessincronia quando um dia operacional
-- vigente vira histórico (a mesma linha de importacoes_csv só tem vigente
-- trocado de true pra false, as OS ligadas a ela não precisam ser tocadas).
-- ============================================================================

create table public.importacoes_csv (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('C10','C13','C14','JH','VIRTUS')),
  regional text not null check (regional in ('C10','C13','C14')),
  empresa text not null check (empresa in ('MOP','JH','VIRTUS')),
  data_referencia text not null,     -- formato 'DD/MM/YY', igual ao parsing atual
  vigente boolean not null default true,
  filename text,
  total_linhas integer not null default 0,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (slot, data_referencia)
);
comment on table public.importacoes_csv is 'Metadado de cada arquivo CSV importado. vigente=true é o dia operacional aberto daquele slot; vigente=false já foi encerrado (histórico).';

create table public.ordens_servico (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.importacoes_csv(id) on delete cascade,
  os text,
  data text,
  status text,
  bairro text,
  cidade text,
  tipo text,
  motivo text,
  recurso text,
  abertura_at timestamptz,
  inicio_at timestamptz,
  fim_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.ordens_servico is 'Uma linha por Ordem de Serviço. regional/empresa/vigente vêm via join com importacoes_csv (ver importacao_id).';

create index idx_os_importacao on public.ordens_servico (importacao_id);
create index idx_os_recurso on public.ordens_servico (recurso);
create index idx_os_status on public.ordens_servico (status);
create index idx_os_data on public.ordens_servico (data);
create index idx_ic_slot_vigente on public.importacoes_csv (slot, vigente);

-- ============================= Funções auxiliares p/ RLS =============================
create or replace function public.esta_ativo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo = true)
$$;

create or replace function public.pode_importar()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and ativo = true and papel in ('administrador','operador')
  )
$$;

-- ============================= RLS =============================
alter table public.importacoes_csv enable row level security;
alter table public.ordens_servico enable row level security;

create policy "usuarios ativos leem importacoes"
  on public.importacoes_csv for select
  using (public.esta_ativo());
create policy "operador/admin inserem importacoes"
  on public.importacoes_csv for insert
  with check (public.pode_importar());
create policy "operador/admin atualizam importacoes"
  on public.importacoes_csv for update
  using (public.pode_importar())
  with check (public.pode_importar());
create policy "operador/admin apagam importacoes"
  on public.importacoes_csv for delete
  using (public.pode_importar());

create policy "usuarios ativos leem ordens"
  on public.ordens_servico for select
  using (public.esta_ativo());
create policy "operador/admin inserem ordens"
  on public.ordens_servico for insert
  with check (public.pode_importar());
create policy "operador/admin atualizam ordens"
  on public.ordens_servico for update
  using (public.pode_importar())
  with check (public.pode_importar());
create policy "operador/admin apagam ordens"
  on public.ordens_servico for delete
  using (public.pode_importar());
