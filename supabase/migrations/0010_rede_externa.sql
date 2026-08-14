-- ============================================================================
-- Migração 0010 — Módulo Rede Externa (Infraestrutura POP / Rede Externa / B2B)
-- ============================================================================
-- Time separado das regionais C10/C13/C14/JH/VIRTUS — não tem "regional" fixa,
-- atua em várias cidades/estados (SP, RJ, ES). Um CSV nacional por dia, mesmo
-- padrão de dia vigente + histórico que já usamos pra Reparo/Ativação, só que
-- sem subdivisão por slot (é 1 arquivo só, não 5).
--
-- rede_externa_equipe: roster nome -> grupo (Infraestrutura POP/Rede Externa/
-- B2B), pra classificar cada técnico no relatório. Fica vazia até alguém
-- importar a lista — enquanto isso, o painel mostra todo mundo como "não
-- classificado" (não trava nada, só falta o agrupamento).
-- ============================================================================

create table public.rede_externa_importacoes (
  id uuid primary key default gen_random_uuid(),
  data_referencia text not null,
  vigente boolean not null default true,
  filename text,
  total_linhas integer not null default 0,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (data_referencia)
);
comment on table public.rede_externa_importacoes is 'Metadados de cada CSV diário importado do time de Rede Externa (nacional, sem slot/regional).';

create table public.rede_externa_atividades (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.rede_externa_importacoes(id) on delete cascade,
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
  fim_at timestamptz
);
comment on table public.rede_externa_atividades is 'Linha a linha do CSV de Rede Externa (mesmas colunas que ordens_servico, tabela separada por ser outro time/escopo).';
create index idx_rede_ext_ativ_importacao on public.rede_externa_atividades (importacao_id);
create index idx_rede_ext_ativ_recurso on public.rede_externa_atividades (recurso);
create index idx_rede_ext_ativ_status on public.rede_externa_atividades (status);

create table public.rede_externa_equipe (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  grupo text not null check (grupo in ('Infraestrutura POP','Rede Externa','B2B')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (nome)
);
comment on table public.rede_externa_equipe is 'Roster fixo nome -> grupo (Infraestrutura POP/Rede Externa/B2B) do time de Rede Externa.';

alter table public.rede_externa_importacoes enable row level security;
alter table public.rede_externa_atividades enable row level security;
alter table public.rede_externa_equipe enable row level security;

create policy "usuarios ativos leem rede_externa_importacoes" on public.rede_externa_importacoes for select using (public.esta_ativo());
create policy "admin/operador gravam rede_externa_importacoes" on public.rede_externa_importacoes for insert with check (public.pode_importar());
create policy "admin/operador atualizam rede_externa_importacoes" on public.rede_externa_importacoes for update using (public.pode_importar()) with check (public.pode_importar());
create policy "admin/operador apagam rede_externa_importacoes" on public.rede_externa_importacoes for delete using (public.pode_importar());

create policy "usuarios ativos leem rede_externa_atividades" on public.rede_externa_atividades for select using (public.esta_ativo());
create policy "admin/operador gravam rede_externa_atividades" on public.rede_externa_atividades for insert with check (public.pode_importar());
create policy "admin/operador atualizam rede_externa_atividades" on public.rede_externa_atividades for update using (public.pode_importar()) with check (public.pode_importar());
create policy "admin/operador apagam rede_externa_atividades" on public.rede_externa_atividades for delete using (public.pode_importar());

create policy "usuarios ativos leem rede_externa_equipe" on public.rede_externa_equipe for select using (public.esta_ativo());
create policy "admin/operador gravam rede_externa_equipe" on public.rede_externa_equipe for insert with check (public.pode_importar());
create policy "admin/operador atualizam rede_externa_equipe" on public.rede_externa_equipe for update using (public.pode_importar()) with check (public.pode_importar());
create policy "admin/operador apagam rede_externa_equipe" on public.rede_externa_equipe for delete using (public.pode_importar());

alter publication supabase_realtime add table public.rede_externa_importacoes;
alter publication supabase_realtime add table public.rede_externa_atividades;
alter publication supabase_realtime add table public.rede_externa_equipe;
