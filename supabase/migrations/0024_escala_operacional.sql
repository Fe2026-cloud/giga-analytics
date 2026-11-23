-- ============================================================================
-- 0024 · Escala operacional (Rede Externa, Infra e Field) compartilhada
--
-- Modelo de acesso:
--   · GAs e GOs entram com e-mail + senha (Supabase Auth). O que cada um pode fazer vem de
--     esc_acessos (por e-mail): 'admin' (tudo + configurações), 'editor' (edita as tabelas
--     liberadas) e 'leitor' (só olha as tabelas liberadas).
--   · Técnicos NÃO têm login: recebem um link pessoal (esc_tokens) que mostra só a escala
--     dele, via função esc_ver_tecnico().
--   · Nomes, gestores, férias e escala-base ficam em esc_config / esc_boards e só chegam ao
--     navegador depois do login (o código público não carrega esses dados).
-- ============================================================================

create table if not exists public.esc_acessos (
  email       text primary key check (email = lower(email)),
  nome        text,
  papel       text not null check (papel in ('admin','editor','leitor')),
  boards      text[] not null default '{}',
  criado_em   timestamptz not null default now(),
  criado_por  text
);

create table if not exists public.esc_config (
  chave          text primary key,
  valor          text not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

create table if not exists public.esc_boards (
  id             text primary key,
  estado         jsonb not null,
  versao         integer not null default 1,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

-- tabela pequena só com a versão (o Realtime avisa isto, sem trafegar o estado inteiro)
create table if not exists public.esc_versoes (
  board          text primary key,
  versao         integer not null,
  atualizado_em  timestamptz not null default now(),
  por            text
);

create table if not exists public.esc_tokens (
  token      text primary key,
  board      text not null,
  pid        integer not null,
  nome       text not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (board, pid)
);

create table if not exists public.esc_auditoria (
  id       bigserial primary key,
  quando   timestamptz not null default now(),
  email    text,
  acao     text not null,
  board    text,
  detalhe  jsonb
);

-- ---------------------------------------------------------------- funções de apoio
create or replace function public.esc_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.esc_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.esc_acessos where email = public.esc_email()
$$;

create or replace function public.esc_e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' from public.esc_acessos where email = public.esc_email()), false)
$$;

create or replace function public.esc_pode_ler(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.esc_acessos a
                 where a.email = public.esc_email() and (a.papel = 'admin' or b = any(a.boards)))
$$;

create or replace function public.esc_pode_editar(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.esc_acessos a
                 where a.email = public.esc_email() and a.papel in ('admin','editor')
                   and (a.papel = 'admin' or b = any(a.boards)))
$$;

-- ---------------------------------------------------------------- RLS
alter table public.esc_acessos   enable row level security;
alter table public.esc_config    enable row level security;
alter table public.esc_boards    enable row level security;
alter table public.esc_versoes   enable row level security;
alter table public.esc_tokens    enable row level security;
alter table public.esc_auditoria enable row level security;

drop policy if exists esc_acessos_sel on public.esc_acessos;
create policy esc_acessos_sel on public.esc_acessos for select to authenticated
  using (public.esc_e_admin() or email = public.esc_email());
drop policy if exists esc_acessos_adm on public.esc_acessos;
create policy esc_acessos_adm on public.esc_acessos for all to authenticated
  using (public.esc_e_admin()) with check (public.esc_e_admin());

drop policy if exists esc_config_sel on public.esc_config;
create policy esc_config_sel on public.esc_config for select to authenticated
  using (public.esc_papel() is not null);
drop policy if exists esc_config_adm on public.esc_config;
create policy esc_config_adm on public.esc_config for all to authenticated
  using (public.esc_e_admin()) with check (public.esc_e_admin());

drop policy if exists esc_boards_sel on public.esc_boards;
create policy esc_boards_sel on public.esc_boards for select to authenticated
  using (public.esc_pode_ler(id));
-- escrita só pela função esc_salvar_board (controle de versão); admin também pode direto
drop policy if exists esc_boards_adm on public.esc_boards;
create policy esc_boards_adm on public.esc_boards for all to authenticated
  using (public.esc_e_admin()) with check (public.esc_e_admin());

drop policy if exists esc_versoes_sel on public.esc_versoes;
create policy esc_versoes_sel on public.esc_versoes for select to authenticated
  using (public.esc_pode_ler(board));

drop policy if exists esc_tokens_adm on public.esc_tokens;
create policy esc_tokens_adm on public.esc_tokens for all to authenticated
  using (public.esc_e_admin()) with check (public.esc_e_admin());

drop policy if exists esc_auditoria_sel on public.esc_auditoria;
create policy esc_auditoria_sel on public.esc_auditoria for select to authenticated
  using (public.esc_e_admin());

-- ---------------------------------------------------------------- RPCs (usuários logados)
create or replace function public.esc_existe_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.esc_acessos where papel = 'admin')
$$;

-- o primeiro a chamar, quando ainda não existe administrador, vira administrador
create or replace function public.esc_virar_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.esc_email() = '' then return false; end if;
  if exists (select 1 from public.esc_acessos where papel = 'admin') then return false; end if;
  insert into public.esc_acessos(email, papel, boards, criado_por)
  values (public.esc_email(), 'admin', '{}', 'bootstrap')
  on conflict (email) do update set papel = 'admin';
  insert into public.esc_auditoria(email, acao) values (public.esc_email(), 'virou_admin');
  return true;
end $$;

create or replace function public.esc_meu_acesso() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', a.email, 'nome', a.nome, 'papel', a.papel, 'boards', to_jsonb(a.boards))
  from public.esc_acessos a where a.email = public.esc_email()
$$;

-- salva o estado de uma tabela com controle de versão (evita um GA sobrescrever o outro sem perceber)
create or replace function public.esc_salvar_board(p_id text, p_estado jsonb, p_versao integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur integer; nova integer;
begin
  if not public.esc_pode_editar(p_id) then
    return jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  end if;
  select versao into cur from public.esc_boards where id = p_id for update;
  if not found then
    if not public.esc_e_admin() then return jsonb_build_object('ok', false, 'erro', 'tabela_inexistente'); end if;
    insert into public.esc_boards(id, estado, versao, atualizado_por) values (p_id, p_estado, 1, public.esc_email());
    nova := 1;
  else
    if p_versao is distinct from cur then
      return jsonb_build_object('ok', false, 'erro', 'conflito', 'versao', cur);
    end if;
    nova := cur + 1;
    update public.esc_boards set estado = p_estado, versao = nova, atualizado_em = now(), atualizado_por = public.esc_email()
    where id = p_id;
  end if;
  insert into public.esc_versoes(board, versao, por) values (p_id, nova, public.esc_email())
  on conflict (board) do update set versao = excluded.versao, atualizado_em = now(), por = excluded.por;
  insert into public.esc_auditoria(email, acao, board, detalhe)
  values (public.esc_email(), 'salvou', p_id, jsonb_build_object('versao', nova));
  return jsonb_build_object('ok', true, 'versao', nova);
end $$;

-- cria o link pessoal de cada técnico da tabela que ainda não tem (só administrador)
create or replace function public.esc_gerar_tokens(p_board text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; est jsonb; pp jsonb;
begin
  if not public.esc_e_admin() then raise exception 'apenas administrador'; end if;
  select estado into est from public.esc_boards where id = p_board;
  if est is null then return 0; end if;
  for pp in select * from jsonb_array_elements(est -> 'people') loop
    if coalesce(pp ->> 'status', '') = 'Vaga' or (pp ->> 'nome') ~* '(^|[^a-z])vaga([^a-z]|$)' then continue; end if;
    if not exists (select 1 from public.esc_tokens where board = p_board and pid = (pp ->> 'id')::int) then
      insert into public.esc_tokens(token, board, pid, nome)
      values (replace(gen_random_uuid()::text, '-', ''), p_board, (pp ->> 'id')::int, pp ->> 'nome');
      n := n + 1;
    else
      update public.esc_tokens set nome = pp ->> 'nome' where board = p_board and pid = (pp ->> 'id')::int;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.esc_rotacionar_token(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare novo text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.esc_e_admin() then raise exception 'apenas administrador'; end if;
  update public.esc_tokens set token = novo, ativo = true where token = p_token;
  if not found then return null; end if;
  insert into public.esc_auditoria(email, acao) values (public.esc_email(), 'rotacionou_token');
  return novo;
end $$;

-- ---------------------------------------------------------------- RPC pública do técnico (sem login)
-- Devolve SOMENTE a escala da pessoa dona do link (e contatos do GA/GO/GG dela).
create or replace function public.esc_ver_tecnico(p_token text, p_de date default null, p_ate date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.esc_tokens%rowtype; est jsonb; pes jsonb; dias jsonb; cont jsonb; plant jsonb; pre text;
begin
  select * into t from public.esc_tokens where token = p_token and ativo;
  if not found then return null; end if;
  select estado into est from public.esc_boards where id = t.board;
  if est is null then return null; end if;
  select pe into pes from jsonb_array_elements(est -> 'people') pe where (pe ->> 'id')::int = t.pid limit 1;
  if pes is null then return null; end if;
  pre := t.pid::text || '|';
  select coalesce(jsonb_object_agg(substr(e.key, length(pre) + 1),
                  jsonb_build_object('t', e.value ->> 't', 'sa', coalesce((e.value ->> 'sa')::boolean, false))), '{}'::jsonb)
    into dias
  from jsonb_each(est -> 'grid') e
  where left(e.key, length(pre)) = pre
    and (p_de  is null or substr(e.key, length(pre) + 1) >= to_char(p_de,  'YYYY-MM-DD'))
    and (p_ate is null or substr(e.key, length(pre) + 1) <= to_char(p_ate, 'YYYY-MM-DD'));
  select valor::jsonb into cont from public.esc_config where chave = 'contatos';
  select valor::jsonb into plant from public.esc_config where chave = 'plantonistas';
  cont := coalesce(cont, '{}'::jsonb);
  return jsonb_build_object(
    'nome', pes ->> 'nome',
    'area', pes ->> 'area',
    'grupo', pes ->> 'grupo',
    'ga', pes ->> 'ga', 'go', pes ->> 'go', 'gg', pes ->> 'gg',
    'tel_ga', coalesce(cont ->> (pes ->> 'ga'), ''), 'tel_go', coalesce(cont ->> (pes ->> 'go'), ''),
    'tel_gg', coalesce(cont ->> (pes ->> 'gg'), ''),
    'turnos', est -> 'settings' -> 'shifts',
    'jornada', est -> 'settings' ->> 'jornada',
    'intervalo', est -> 'settings' ->> 'intervalo',
    'inicio', est ->> 'inicio',
    'plantonistas', plant,
    'dias', dias
  );
end $$;

-- permissões de execução
revoke all on function public.esc_existe_admin(), public.esc_virar_admin(), public.esc_meu_acesso(),
  public.esc_salvar_board(text, jsonb, integer), public.esc_gerar_tokens(text), public.esc_rotacionar_token(text),
  public.esc_ver_tecnico(text, date, date) from public;
grant execute on function public.esc_existe_admin(), public.esc_virar_admin(), public.esc_meu_acesso(),
  public.esc_salvar_board(text, jsonb, integer), public.esc_gerar_tokens(text), public.esc_rotacionar_token(text) to authenticated;
grant execute on function public.esc_ver_tecnico(text, date, date) to anon, authenticated;

-- Realtime: avisa quando alguém salva uma tabela
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'esc_versoes') then
    alter publication supabase_realtime add table public.esc_versoes;
  end if;
end $$;
