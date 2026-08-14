-- ============================================================================
-- Migração 0012 — Seed da equipe de Rede Externa (lista de permissão)
-- ============================================================================
-- Vem do mesmo arquivo ESCALA R3.csv, nas linhas com rótulo "Rede Externa
-- Litoral Norte/Sul", "Infraestrutura Litoral Norte" e "Rede B2B". Só os
-- técnicos cadastrados aqui aparecem nas tabelas do módulo Rede Externa.
-- ============================================================================

delete from public.rede_externa_equipe;

insert into public.rede_externa_equipe (nome, grupo) values
('ALLYSON EDUARDO GUILHERME DA SILVA','Rede Externa'),
('ISAIAS CARDOSO MAGALHÃES','Rede Externa'),
('RICHARD SHELTON FERREIRA DA SILVA','Rede Externa'),
('EDIMAR BENJAMIN CRUZ','Rede Externa'),
('MARCILIO GONÇALVES FERREIRA','Rede Externa'),
('SMALLEY ALVES SANTOS','Rede Externa'),
('EDINALDO PEREIRA CRUZ','Rede Externa'),
('MILTON DA SILVA VIEIRA','Rede Externa'),
('FELIPE PEREIRA DA CRUZ','Rede Externa'),
('DANILO BARBOSA CARMONA','Rede Externa'),
('THIAGO SOUZA FERREIRA DOS SANTOS','Rede Externa'),
('JOAO VICTOR DOS SANTOS OLIVEIRA','Rede Externa'),
('HELMO SANTOS ROCHA','Rede Externa'),
('ELTON KISSER COSTA','Rede Externa'),
('MARCOS PAULO LOPES NASCIMENTO','Rede Externa'),
('GERSON RUBEM DOS SANTOS CABRAL','Rede Externa'),
('SILVIO CESAR GOES','Rede Externa'),
('ROBERTO DOS SANTOS RANDOLI','Rede Externa'),
('AILTON ROSA SANTOS','Rede Externa'),
('FERNANDO REGIS DE ANDRADE AZEVEDO','Rede Externa'),
('DANIEL CRISTIANO DE OLIVEIRA','Infraestrutura POP'),
('Lucas Matos de campos','Infraestrutura POP'),
('RENAN SOUZA SILVA','Infraestrutura POP'),
('DANIEL ANTONIO DA SILVA','B2B');
