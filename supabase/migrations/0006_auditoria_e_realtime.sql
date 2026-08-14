-- ============================================================================
-- Migração 0006 — Auditoria e Tempo Real (GIGA+ Analytics — Alteração 20, Fases 4-5)
-- ============================================================================
-- auditoria: log append-only (ninguém edita/apaga pela aplicação) de ações
-- que alteram dados compartilhados — importações, mudanças de config/equipe,
-- "limpar base". Só administrador lê; cada usuário só registra ações em seu
-- próprio nome (usuario_id = auth.uid() garantido pela policy de insert).
--
-- Realtime: habilita replicação nas tabelas que o painel deve sincronizar ao
-- vivo entre usuários (import feito por alguém aparece pros outros sem
-- precisar recarregar a página).
-- ============================================================================

create table public.auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid references auth.users(id),
  acao text not null,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
comment on table public.auditoria is 'Log append-only de ações que alteram dados compartilhados do painel.';

create index idx_auditoria_criado_em on public.auditoria (criado_em desc);
create index idx_auditoria_usuario on public.auditoria (usuario_id);

alter table public.auditoria enable row level security;

create policy "admin le auditoria" on public.auditoria for select using (public.meu_papel() = 'administrador');
create policy "usuarios ativos registram sua propria auditoria" on public.auditoria for insert
  with check (public.esta_ativo() and usuario_id = auth.uid());
-- Sem policy de update/delete: log é append-only mesmo para administrador (via app).

-- ============================= Realtime =============================
alter publication supabase_realtime add table public.importacoes_csv;
alter publication supabase_realtime add table public.ordens_servico;
alter publication supabase_realtime add table public.historico_diario;
alter publication supabase_realtime add table public.backlog_atual;
alter publication supabase_realtime add table public.backlog_snapshots;
alter publication supabase_realtime add table public.configuracoes;
alter publication supabase_realtime add table public.equipe;
