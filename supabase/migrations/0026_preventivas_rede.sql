-- ============================================================================
-- Migração 0026 — PREVENTIVAS DE REDE (painel preventivas-rede/)
-- ============================================================================
-- Fonte: formulário do Microsoft Forms "AÇÕES PREVENTIVAS - GESTÃO RAFAEL FRAGA" (planilha no OneDrive).
-- Atualização automática: um fluxo do Power Automate ("Quando uma nova linha é adicionada" na planilha)
-- chama a função preventivas_receber() a cada resposta nova. A função confere um token secreto e grava a linha
-- (upsert pelo ID da resposta, então reenviar a mesma linha não duplica).
--   • preventivas_respostas : 1 linha por resposta do Forms; "dados" guarda a linha como veio da planilha
--                             (chaves = títulos das colunas), o painel normaliza no navegador.
--   • preventivas_tokens    : tokens de envio (só o hash SHA-256). Sem policy = ninguém lê pela API.
-- Leitura: qualquer usuário ativo do painel. Escrita direta: operador/admin (carga manual pelo painel).
-- ============================================================================

create table public.preventivas_respostas (
  id bigint primary key,                       -- coluna "ID" da planilha (nº da resposta no Forms)
  dados jsonb not null,
  recebido_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.preventivas_respostas is 'Respostas do formulário Ações Preventivas (Forms), 1 linha por resposta.';

create table public.preventivas_tokens (
  id bigserial primary key,
  nome text not null,
  token_hash text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
comment on table public.preventivas_tokens is 'Tokens que autorizam o Power Automate a enviar respostas. Guarda só o hash.';

alter table public.preventivas_respostas enable row level security;
alter table public.preventivas_tokens enable row level security;   -- sem policies: acesso só via função security definer

create policy "usuarios ativos leem preventivas_respostas"
  on public.preventivas_respostas for select using (public.esta_ativo());
create policy "operador/admin inserem preventivas_respostas"
  on public.preventivas_respostas for insert with check (public.pode_editar());
create policy "operador/admin atualizam preventivas_respostas"
  on public.preventivas_respostas for update using (public.pode_editar()) with check (public.pode_editar());
create policy "operador/admin apagam preventivas_respostas"
  on public.preventivas_respostas for delete using (public.pode_editar());

-- Recebe 1 linha (objeto) ou várias (array) da planilha. Retorna quantas foram gravadas.
create or replace function public.preventivas_receber(p_token text, p_dados jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_itens jsonb;
  v_item jsonb;
  v_id text;
  v_n integer := 0;
begin
  if p_token is null or not exists (
    select 1 from public.preventivas_tokens
    where ativo and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) then
    raise exception 'token invalido' using errcode = '28000';
  end if;

  v_itens := case jsonb_typeof(p_dados) when 'array' then p_dados when 'object' then jsonb_build_array(p_dados) else null end;
  if v_itens is null then raise exception 'p_dados deve ser objeto ou array'; end if;
  if jsonb_array_length(v_itens) > 2000 then raise exception 'maximo de 2000 linhas por chamada'; end if;

  for v_item in select * from jsonb_array_elements(v_itens) loop
    v_id := coalesce(v_item->>'ID', v_item->>'Id', v_item->>'id');
    continue when v_id is null or v_id !~ '^\d{1,12}$';
    insert into public.preventivas_respostas (id, dados)
    values (v_id::bigint, v_item)
    on conflict (id) do update set dados = excluded.dados, atualizado_em = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
comment on function public.preventivas_receber(text, jsonb) is 'Endpoint do Power Automate: valida o token e faz upsert das linhas da planilha de Ações Preventivas.';

revoke all on function public.preventivas_receber(text, jsonb) from public;
grant execute on function public.preventivas_receber(text, jsonb) to anon, authenticated;

alter publication supabase_realtime add table public.preventivas_respostas;
