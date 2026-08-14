-- ============================================================================
-- Migração 0004 — Configurações e Equipe (GIGA+ Analytics — Alteração 20)
-- ============================================================================
-- Substitui as chaves localStorage 'config' e 'roster' por tabelas
-- compartilhadas no Supabase (metas de SLA/Capacity e a equipe fixa de
-- técnicos passam a ser as mesmas pra todo mundo que usa o painel).
--
--   configuracoes — chave/valor (jsonb); hoje só existe a chave 'geral' com o
--                   mesmo objeto que já era salvo localmente (SLA, alertas,
--                   projeção, capacity).
--   equipe        — 1 linha por técnico, com o slot (C10/C13/C14/JH/VIRTUS),
--                   igual à estrutura ROSTER[slot] já usada em memória.
-- ============================================================================

create table public.configuracoes (
  chave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
comment on table public.configuracoes is 'Config compartilhada do painel (chave "geral" = metas de SLA/Capacity/projeção).';

create table public.equipe (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('C10','C13','C14','JH','VIRTUS')),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (slot, nome)
);
comment on table public.equipe is 'Lista fixa de técnicos por slot (regional/empresa), usada em absenteísmo e classificação de recurso.';

-- Alias semântico: mesma regra de permissão de "importar" também vale pra
-- editar configurações e a equipe (administrador ou operador ativos).
create or replace function public.pode_editar()
returns boolean
language sql
security definer
stable
set search_path = public
as $$ select public.pode_importar() $$;

alter table public.configuracoes enable row level security;
alter table public.equipe enable row level security;

create policy "usuarios ativos leem config" on public.configuracoes for select using (public.esta_ativo());
create policy "admin/operador inserem config" on public.configuracoes for insert with check (public.pode_editar());
create policy "admin/operador atualizam config" on public.configuracoes for update using (public.pode_editar()) with check (public.pode_editar());

create policy "usuarios ativos leem equipe" on public.equipe for select using (public.esta_ativo());
create policy "admin/operador inserem equipe" on public.equipe for insert with check (public.pode_editar());
create policy "admin/operador atualizam equipe" on public.equipe for update using (public.pode_editar()) with check (public.pode_editar());
create policy "admin/operador apagam equipe" on public.equipe for delete using (public.pode_editar());

-- ============================= Seed: config padrão (igual ao DEFAULT_CONFIG atual) =============================
insert into public.configuracoes (chave, valor) values (
  'geral',
  '{"reparo":{"ideal":24,"max":48},"ativacao":{"ideal":36,"max":48},"alertaVermelho":1.5,"alertaAmarelo":3,"capacity":{},"projecao":{"antes16h":78,"depois16h":50,"horaCorte":16}}'::jsonb
) on conflict (chave) do nothing;

-- ============================= Seed: equipe (mesma lista fixa que já existia no código) =============================
insert into public.equipe (slot, nome) values
('C10','ADRIANO DE SOUZA MARQUES'),('C10','ALEXANDRE CESAR DA SILVA'),('C10','AXEL BRENDON SILVA DA COSTA'),
('C10','CLEVERTON DANTAS DE SOUZA'),('C10','DAVE MATHEUS HOSTINS DOS SANTOS'),('C10','FRANCISCO FLAVIO SILVA DOS SANTOS'),
('C10','GUILHERME BLOTA NEVES'),('C10','GUILHERME DE OLIVEIRA SANTOS'),('C10','JONATHAN ALVES BARBOSA'),
('C10','ROGERIO DA SILVA SANTANIELLI'),
('C14','ADRIANO CAETANO DOS SANTOS'),('C14','Alan Maciel Oliveira Silva Guatura'),('C14','ALESSANDRO OLIVEIRA SANTOS'),
('C14','Alexandre Marlon de Lima'),('C14','ALYSSON DA COSTA SANT''ANNA'),('C14','Andre Gustavo dos Santos Passos'),
('C14','BRUNO CALEBE VIEIRA DA SILVA'),('C14','Cristiano dos Santos'),('C14','DIOGO ALBERTO FERREIRA DA PAIXAO'),
('C14','DOMINGOS FERREIRA DE SOUZA'),('C14','DOUGLAS LUIZ DOS SANTOS'),('C14','EVERALDO LEITE DE SOUZA'),
('C14','Farao Rodrigues da Silva'),('C14','Felipe Felix do Prado Francisco'),('C14','HEBERTON BATISTA LIMA DA CRUZ'),
('C14','Hercules Xavier Moreira'),('C14','HUMBERTO JOSE HIPOLITO'),('C14','JOSE SIDNEI MARTINIANO'),
('C14','JULIO ANTONIO CARVALHO DA CUNHA'),('C14','JULIO DO CARMO AVELAR'),('C14','KAUA LIMA SANTOS DA SILVA'),
('C14','LEONIDAS DE SOUZA'),('C14','LUIZ DE ANDRADE MOREIRA'),('C14','MARCELO DE MATOS LESSA'),
('C14','MARCOS FRANCISCO DE LIMA'),('C14','MATEUS JESUS SANTOS'),('C14','MATEUS RODRIGUES DOS SANTOS'),
('C14','MOISES NUNES DE SOUZA NETO'),('C14','PAULO SERGIANO LAURINDO DO NASCIMENTO'),('C14','RAFAEL DE OLIVEIRA LOURENCO'),
('C14','RAFAEL FERREIRA DE SOUZA'),('C14','Renan Vinícius de Souza'),('C14','Rogerio de Morais Da Silva Junior'),
('C14','Rogerio Prates'),('C14','Sidcley Silva de Oliveira Filho'),('C14','VITTOR LORENZO BONETTI JESUS'),
('C14','WERICK FERNANDO DOS SANTOS'),('C14','WILSON MENDES DE SOUZA'),
('C13','Fabiano Rodrigo David de Campos Júnior'),('C13','Luciano Henrique Alves da Silveira'),
('JH','ADILSON GONCALVES DA SILVA'),('JH','ANDERSON LOPES GARCIA'),('JH','BRUNO DE SOUZA CARVALHO QUIRINO'),
('JH','CAIO REINAN DE ANDRADE REIS'),('JH','CARLOS ANDRE DIAS BARBOSA CAMPOS'),('JH','CARLOS DA SILVA SOUZA'),
('JH','CARLOS HENRIQUE MENEZES SANTANNA'),('JH','CARLOS JOSE SILVA DE ALMEIDA'),('JH','DOUGLAS SIERRO DOS SANTOS SOUZA'),
('JH','EDMILSON PANAJOTTO ROSA'),('JH','EMERSON BARBOSA DE SOUSA'),('JH','EVERTHON SOARES ZAGO'),
('JH','FABIANO DOS SANTOS PARADA'),('JH','GLEYDSON VINICIO DE SOUZA SANTOS'),('JH','GUILHERME MARQUES FELICIANO RODRIGUES'),
('JH','IGOR ARAUJO DE SOUZA'),('JH','ISAQUE IZIDORIO DOS SANTOS'),('JH','JEFFERSON BARBOSA DA SILVA'),
('JH','JOSE AUGUSTO TAKAHASHI'),('JH','LEANDRO ARAUJO DOS SANTOS'),('JH','MARCELO EDUARDO DE SIQUEIRA'),
('JH','MARCELO MARTINS VERISSIMO ESPIRITO SANTO'),('JH','MARCO AURELIO NICODEMOS DO PRADO'),('JH','MARCOS DOS SANTOS BELO'),
('JH','MARIO EDUARDO LIMA BEZERRA'),('JH','MURILO CRUZ DOS SANTOS'),('JH','RAFAEL DE MELO GONCALVES'),
('JH','RODOLFO VELUDO GENEROZO'),('JH','RODRIGO SANTOS RAMOS'),('JH','SAMUEL DO NASCIMENTO BARBOSA'),
('JH','SERGIO SILVA DA CONCEICAO'),('JH','SINVALDO BRITO DA SILVA'),('JH','VINICIUS GUEDES WELLS RUIZ'),
('JH','GABRIEL MESSIAS DE OLIVEIRA'),('JH','NAILSON MIRANDA SANTOS'),('JH','PASCHOAL CARVALHO PALINKAS'),
('JH','RICARDO TACONI DANTAS'),
('VIRTUS','Andre Luiz de Oliveira Gomes'),('VIRTUS','Giovani Gonçalves de Souza'),('VIRTUS','Andre Luiz da Silva'),
('VIRTUS','Francisco de Campos Serra Junior'),('VIRTUS','Marcio Aparecido Cruz'),('VIRTUS','Marcus Vinicius Pandolfi'),
('VIRTUS','Paulo Henrique Amaral Melo'),('VIRTUS','Izaias Nobrega de Almeida'),('VIRTUS','Joao Lucas Do Nascimento Mendonca'),
('VIRTUS','Samuel Braz Silva'),('VIRTUS','Thiago Goncalo Silva')
on conflict (slot, nome) do nothing;
