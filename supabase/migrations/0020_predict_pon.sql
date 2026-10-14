-- ============================================================================
-- Migração 0020 — Predict PON (módulo de alerta de PON/cliente via AutoISP)
-- ============================================================================
-- Quem coleta é a extensão "Predict PON" no Chrome de um operador logado no
-- AutoISP (só GET). Ela grava aqui e o módulo Predict PON do site lê para todos
-- os usuários ativos. Nenhuma senha, cookie ou CPF/CNPJ é gravado.
--
--   predict_pon_leituras   — 1 linha por coleta (resumo + alertas de PON/OLT)
--   predict_pon_clientes   — último sinal de cada contrato das O.S. (1 linha por contrato)
--   predict_pon_hist       — sinal por contrato por dia (para "piorou / melhorou")
--
--   predict_pon_contratos_alvo(limite)  — quais contratos a extensão deve consultar agora
--   predict_pon_gravar_clientes(lista)  — grava a rodada de clientes e calcula a mudança
-- ============================================================================

-- ============================= Leituras (PON/OLT) =============================
create table public.predict_pon_leituras (
  id bigint generated always as identity primary key,
  coletado_em timestamptz not null default now(),
  coletado_por uuid references auth.users(id) default auth.uid(),
  coletor text,    -- e-mail de quem coletou (o perfil de outra pessoa não é legível por RLS)
  versao text,
  cidades text[] not null default '{}',
  resumo jsonb not null default '{}',
  alertas jsonb,   -- lista de alertas (OLT degradada, massiva, risco, CTO, ONU)
  olts jsonb,      -- OLTs com conexão/estado e contagem por PON
  erros jsonb
);
comment on table public.predict_pon_leituras is 'Uma linha por coleta da extensão Predict PON. alertas/olts ficam só 3 dias; o resumo fica 90 dias para o gráfico de evolução.';
create index idx_ppl_coletado on public.predict_pon_leituras (coletado_em desc);

-- Limpeza na própria gravação (sem pg_cron): tira o detalhe das leituras com
-- mais de 3 dias e apaga as com mais de 90.
create or replace function public.predict_pon_limpar_leituras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.predict_pon_leituras set alertas = null, olts = null, erros = null
   where coletado_em < now() - interval '3 days' and alertas is not null;
  delete from public.predict_pon_leituras where coletado_em < now() - interval '90 days';
  delete from public.predict_pon_hist where dia < current_date - 120;
  return null;
end $$;

-- ============================= Clientes (sinal por contrato) =============================
create table public.predict_pon_clientes (
  contrato text primary key,          -- "Número do contrato" das O.S. = erp_id do AutoISP
  gpon_id bigint,                     -- id do cliente no AutoISP (/gpon_clients/<id>)
  olt text,
  olt_id integer,
  pon text,                           -- ex.: 0/3/3
  serial text,
  cidade text,
  bairro text,
  lat double precision,
  lng double precision,
  rx_dbm numeric(6,2),
  status_autoisp text,                -- OK / warning / critical / loss_signal / power_fail / down
  situacao text not null check (situacao in ('ok','atencao','critico','sem_sinal','sem_energia','offline','nao_encontrado')),
  leitura_autoisp_em timestamptz,     -- acs_last_inform (último contato do roteador)
  rx_anterior numeric(6,2),
  situacao_anterior text,
  mudou_em timestamptz,               -- última mudança de situação ou de 1,5 dB ou mais
  ruim_desde timestamptz,             -- desde quando está em atenção/crítico/sem sinal
  checado_em timestamptz not null default now(),
  checado_por uuid references auth.users(id) default auth.uid()
);
comment on table public.predict_pon_clientes is 'Último sinal lido no AutoISP (detailed_info) para cada contrato das O.S. Sem nome, CPF/CNPJ ou senha.';
create index idx_ppc_situacao on public.predict_pon_clientes (situacao);
create index idx_ppc_olt_pon on public.predict_pon_clientes (olt, pon);

create table public.predict_pon_hist (
  contrato text not null,
  dia date not null,
  rx_min numeric(6,2),
  rx_max numeric(6,2),
  rx_ultimo numeric(6,2),
  pior_situacao text,
  primary key (contrato, dia)
);
comment on table public.predict_pon_hist is 'Sinal por contrato por dia (120 dias).';

create trigger trg_predict_pon_limpar
  after insert on public.predict_pon_leituras
  for each statement execute function public.predict_pon_limpar_leituras();

-- ============================= RLS =============================
alter table public.predict_pon_leituras enable row level security;
alter table public.predict_pon_clientes enable row level security;
alter table public.predict_pon_hist enable row level security;

create policy "usuarios ativos leem leituras do predict pon"
  on public.predict_pon_leituras for select using (public.esta_ativo());
create policy "operador/admin gravam leituras do predict pon"
  on public.predict_pon_leituras for insert with check (public.pode_editar());

create policy "usuarios ativos leem clientes do predict pon"
  on public.predict_pon_clientes for select using (public.esta_ativo());
create policy "operador/admin gravam clientes do predict pon"
  on public.predict_pon_clientes for insert with check (public.pode_editar());
create policy "operador/admin atualizam clientes do predict pon"
  on public.predict_pon_clientes for update using (public.pode_editar()) with check (public.pode_editar());

create policy "usuarios ativos leem historico do predict pon"
  on public.predict_pon_hist for select using (public.esta_ativo());
create policy "operador/admin gravam historico do predict pon"
  on public.predict_pon_hist for insert with check (public.pode_editar());
create policy "operador/admin atualizam historico do predict pon"
  on public.predict_pon_hist for update using (public.pode_editar()) with check (public.pode_editar());

-- ============================= Contratos a consultar =============================
-- Contratos com Ativação, Reparo ou Mudança nos últimos 90 dias, na ordem:
--   1) nunca consultados e com O.S. nos últimos 30 dias (janela de IRR/IFI)
--   2) sinal ruim consultado há mais de 30 min
--   3) nunca consultados (resto)
--   4) sinal bom há mais de 12 h; não encontrados há mais de 24 h
-- security invoker: quem chama precisa ler ordens_servico (RLS normal).
create or replace function public.predict_pon_contratos_alvo(p_limite integer default 300)
returns table (contrato text, ultima_os timestamptz, tipo text, prioridade integer)
language sql
stable
security invoker
set search_path = public
as $$
  with os as (
    select upper(regexp_replace(trim(o.contrato), '^0+(?=.)', '')) as contrato,
           coalesce(o.fim_at, o.abertura_at, o.created_at) as quando,
           o.tipo
      from public.ordens_servico o
     where o.contrato is not null and trim(o.contrato) <> ''
       and o.tipo in ('Ativação','Reparo Corretivo','Mudança de Endereço','Mudança de Cômodo')
       and coalesce(o.fim_at, o.abertura_at, o.created_at) > now() - interval '90 days'
  ), ultima as (
    select distinct on (os.contrato) os.contrato, os.quando, os.tipo
      from os order by os.contrato, os.quando desc
  ), alvo as (
    select u.contrato, u.quando, u.tipo,
           case
             when c.contrato is null and u.quando > now() - interval '30 days' then 1
             when c.situacao in ('atencao','critico','sem_sinal') and c.checado_em < now() - interval '30 minutes' then 2
             when c.contrato is null then 3
             when c.situacao = 'nao_encontrado' and c.checado_em < now() - interval '24 hours' then 4
             when c.situacao not in ('atencao','critico','sem_sinal','nao_encontrado') and c.checado_em < now() - interval '12 hours' then 4
             else null
           end as prioridade
      from ultima u
      left join public.predict_pon_clientes c on c.contrato = u.contrato
  )
  select a.contrato, a.quando, a.tipo, a.prioridade
    from alvo a
   where a.prioridade is not null
   order by a.prioridade, a.quando desc
   limit greatest(1, least(coalesce(p_limite, 300), 1500));
$$;

-- ============================= Gravar rodada de clientes =============================
-- Recebe [{contrato, gpon_id, olt, olt_id, pon, serial, cidade, bairro, lat, lng,
--          rx_dbm, status_autoisp, situacao, leitura_autoisp_em}, ...]
-- e calcula rx_anterior / mudou_em / ruim_desde comparando com o que já estava gravado.
create or replace function public.predict_pon_gravar_clientes(p_lista jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if not public.pode_editar() then
    raise exception 'sem permissão para gravar o Predict PON';
  end if;

  with novos as (
    select distinct on (upper(regexp_replace(trim(x.contrato), '^0+(?=.)', ''))) x.*
      from jsonb_to_recordset(p_lista) as x(
      contrato text, gpon_id bigint, olt text, olt_id integer, pon text, serial text,
      cidade text, bairro text, lat double precision, lng double precision,
      rx_dbm numeric, status_autoisp text, situacao text, leitura_autoisp_em timestamptz)
     where x.contrato is not null and x.situacao is not null
     order by upper(regexp_replace(trim(x.contrato), '^0+(?=.)', ''))
  )
  insert into public.predict_pon_clientes as c
    (contrato, gpon_id, olt, olt_id, pon, serial, cidade, bairro, lat, lng, rx_dbm,
     status_autoisp, situacao, leitura_autoisp_em, mudou_em, ruim_desde, checado_em, checado_por)
  select upper(regexp_replace(trim(n.contrato), '^0+(?=.)', '')), n.gpon_id, n.olt, n.olt_id, n.pon, n.serial,
         n.cidade, n.bairro, n.lat, n.lng, n.rx_dbm, n.status_autoisp, n.situacao, n.leitura_autoisp_em,
         null,
         case when n.situacao in ('atencao','critico','sem_sinal') then now() end,
         now(), auth.uid()
    from novos n
  on conflict (contrato) do update set
    gpon_id = coalesce(excluded.gpon_id, c.gpon_id),
    olt = coalesce(excluded.olt, c.olt),
    olt_id = coalesce(excluded.olt_id, c.olt_id),
    pon = coalesce(excluded.pon, c.pon),
    serial = coalesce(excluded.serial, c.serial),
    cidade = coalesce(excluded.cidade, c.cidade),
    bairro = coalesce(excluded.bairro, c.bairro),
    lat = coalesce(excluded.lat, c.lat),
    lng = coalesce(excluded.lng, c.lng),
    rx_dbm = excluded.rx_dbm,
    status_autoisp = excluded.status_autoisp,
    situacao = excluded.situacao,
    leitura_autoisp_em = coalesce(excluded.leitura_autoisp_em, c.leitura_autoisp_em),
    rx_anterior = case when c.situacao is distinct from excluded.situacao
                         or abs(coalesce(c.rx_dbm, 0) - coalesce(excluded.rx_dbm, 0)) >= 1.5
                       then c.rx_dbm else c.rx_anterior end,
    situacao_anterior = case when c.situacao is distinct from excluded.situacao
                               or abs(coalesce(c.rx_dbm, 0) - coalesce(excluded.rx_dbm, 0)) >= 1.5
                             then c.situacao else c.situacao_anterior end,
    mudou_em = case when c.situacao is distinct from excluded.situacao
                      or abs(coalesce(c.rx_dbm, 0) - coalesce(excluded.rx_dbm, 0)) >= 1.5
                    then now() else c.mudou_em end,
    ruim_desde = case when excluded.situacao in ('atencao','critico','sem_sinal')
                      then coalesce(c.ruim_desde, now()) end,
    checado_em = now(),
    checado_por = auth.uid();
  get diagnostics n = row_count;

  insert into public.predict_pon_hist as h (contrato, dia, rx_min, rx_max, rx_ultimo, pior_situacao)
  select distinct on (1) upper(regexp_replace(trim(x.contrato), '^0+(?=.)', '')), current_date, x.rx_dbm, x.rx_dbm, x.rx_dbm, x.situacao
    from jsonb_to_recordset(p_lista) as x(contrato text, rx_dbm numeric, situacao text)
   where x.contrato is not null and x.situacao is not null and x.situacao <> 'nao_encontrado'
   order by 1
  on conflict (contrato, dia) do update set
    rx_min = least(h.rx_min, excluded.rx_min),
    rx_max = greatest(h.rx_max, excluded.rx_max),
    rx_ultimo = excluded.rx_ultimo,
    pior_situacao = case
      when array_position(array['critico','sem_sinal','atencao','sem_energia','offline','ok'], excluded.pior_situacao)
         < array_position(array['critico','sem_sinal','atencao','sem_energia','offline','ok'], h.pior_situacao)
      then excluded.pior_situacao else h.pior_situacao end;

  return n;
end $$;

grant execute on function public.predict_pon_contratos_alvo(integer) to authenticated;
grant execute on function public.predict_pon_gravar_clientes(jsonb) to authenticated;

alter publication supabase_realtime add table public.predict_pon_leituras;
alter publication supabase_realtime add table public.predict_pon_clientes;
