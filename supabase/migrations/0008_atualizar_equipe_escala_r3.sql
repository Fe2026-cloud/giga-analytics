-- ============================================================================
-- Migração 0008 — Atualização da equipe conforme ESCALA R3.csv (13/08/2026)
-- ============================================================================
-- Substitui por completo as listas de C10/C13/C14/JH/VIRTUS pela versão mais
-- atual da escala. Resumo das mudanças em relação ao seed da migração 0004:
--   C14    : saem "ADRIANO CAETANO DOS SANTOS" e "DOMINGOS FERREIRA DE SOUZA" (38 -> 36)
--   VIRTUS : entram 4 novos recursos (11 -> 15)
--   C10/C13/JH: sem mudança de conteúdo (só normalização de acento/caixa)
--   Total: 98 -> 100 técnicos
-- ============================================================================

delete from public.equipe where slot in ('C10','C13','C14','JH','VIRTUS');

insert into public.equipe (slot, nome) values
('C10','ADRIANO DE SOUZA MARQUES'),('C10','ALEXANDRE CESAR DA SILVA'),('C10','AXEL BRENDON SILVA DA COSTA'),
('C10','CLEVERTON DANTAS DE SOUZA'),('C10','DAVE MATHEUS HOSTINS DOS SANTOS'),('C10','FRANCISCO FLAVIO SILVA DOS SANTOS'),
('C10','GUILHERME BLOTA NEVES'),('C10','GUILHERME DE OLIVEIRA SANTOS'),('C10','JONATHAN ALVES BARBOSA'),
('C10','ROGERIO DA SILVA SANTANIELLI'),

('C13','Fabiano Rodrigo David de Campos Júnior'),('C13','Luciano Henrique Alves da Silveira'),

('C14','Alan Maciel Oliveira Silva Guatura'),('C14','ALESSANDRO OLIVEIRA SANTOS'),('C14','Alexandre Marlon de Lima'),
('C14','ALYSSON DA COSTA SANT''ANNA'),('C14','Andre Gustavo dos Santos Passos'),('C14','BRUNO CALEBE VIEIRA DA SILVA'),
('C14','Cristiano dos Santos'),('C14','DIOGO ALBERTO FERREIRA DA PAIXAO'),('C14','DOUGLAS LUIZ DOS SANTOS'),
('C14','EVERALDO LEITE DE SOUZA'),('C14','Farao Rodrigues da Silva'),('C14','Felipe Felix do Prado Francisco'),
('C14','HEBERTON BATISTA LIMA DA CRUZ'),('C14','Hercules Xavier Moreira'),('C14','HUMBERTO JOSE HIPOLITO'),
('C14','JOSE SIDNEI MARTINIANO'),('C14','JULIO ANTONIO CARVALHO DA CUNHA'),('C14','JULIO DO CARMO AVELAR'),
('C14','KAUA LIMA SANTOS DA SILVA'),('C14','LEONIDAS DE SOUZA'),('C14','LUIZ DE ANDRADE MOREIRA'),
('C14','MARCELO DE MATOS LESSA'),('C14','MARCOS FRANCISCO DE LIMA'),('C14','MATEUS JESUS SANTOS'),
('C14','MATEUS RODRIGUES DOS SANTOS'),('C14','MOISES NUNES DE SOUZA NETO'),('C14','PAULO SERGIANO LAURINDO DO NASCIMENTO'),
('C14','RAFAEL DE OLIVEIRA LOURENCO'),('C14','RAFAEL FERREIRA DE SOUZA'),('C14','Renan Vinícius de Souza'),
('C14','Rogerio de Morais Da Silva Junior'),('C14','Rogerio Prates'),('C14','Sidcley Silva de Oliveira Filho'),
('C14','VITTOR LORENZO BONETTI JESUS'),('C14','WERICK FERNANDO DOS SANTOS'),('C14','WILSON MENDES DE SOUZA'),

('JH','ADILSON GONCALVES DA SILVA'),('JH','ANDERSON LOPES GARCIA'),('JH','Bruno de Souza Carvalho Quirino'),
('JH','CAIO REINAN DE ANDRADE REIS'),('JH','CARLOS ANDRÉ DIAS BARBOSA CAMPOS'),('JH','Carlos da Silva Souza'),
('JH','Carlos Henrique Menezes Santanna'),('JH','CARLOS JOSE SILVA DE ALMEIDA'),('JH','Douglas Sierro Dos Santos Souza'),
('JH','EDMILSON PANAJOTTO ROSA'),('JH','Emerson Barbosa de Sousa'),('JH','Everthon Soares Zago'),
('JH','FABIANO DOS SANTOS PARADA'),('JH','Gleydson Vinício de Souza Santos'),('JH','GUILHERME MARQUES FELICIANO RODRIGUES'),
('JH','Igor Araujo de Souza'),('JH','ISAQUE IZIDORIO DOS SANTOS'),('JH','JEFFERSON BARBOSA DA SILVA'),
('JH','JOSÉ AUGUSTO TAKAHASHI'),('JH','Leandro Araújo dos Santos'),('JH','MARCELO EDUARDO DE SIQUEIRA'),
('JH','Marcelo Martins Verissimo Espirito Santo'),('JH','MARCO AURÉLIO NICODEMOS DO PRADO'),('JH','Marcos dos Santos Belo'),
('JH','Mario Eduardo lima bezerra'),('JH','MURILO CRUZ DOS SANTOS'),('JH','Rafael de Melo Goncalves'),
('JH','RODOLFO VELUDO GENEROZO'),('JH','RODRIGO SANTOS RAMOS'),('JH','SAMUEL DO NASCIMENTO BARBOSA'),
('JH','SERGIO SILVA DA CONCEIÇÃO'),('JH','SINVALDO BRITO DA SILVA'),('JH','Vinicius Guedes Wells Ruiz'),
('JH','GABRIEL MESSIAS DE OLIVEIRA'),('JH','Nailson Miranda Santos'),('JH','Paschoal Carvalho Palinkas'),
('JH','Ricardo taconi Dantas'),

('VIRTUS','ANDRE LUIZ DA SILVA'),('VIRTUS','Thiago Goncalo Silva'),('VIRTUS','Joao Lucas Do Nascimento Mendonca'),
('VIRTUS','GIOVANI GONÇALVES DE SOUZA'),('VIRTUS','Marcos Vinicius Pires'),('VIRTUS','MARCUS VINICIUS PANDOLFI'),
('VIRTUS','Paulo Henrique Amaral Melo'),('VIRTUS','FRANCISCO DE CAMPOS SERRA JUNIOR'),('VIRTUS','Fabiano Luis Pozzer'),
('VIRTUS','MARCIO APARECIDO CRUZ'),('VIRTUS','Izaias Nobrega de Almeida'),('VIRTUS','JEFFERSON DA SILVA'),
('VIRTUS','Andre Luiz de Oliveira Gomes'),('VIRTUS','Samuel Braz Silva'),('VIRTUS','Jonathan Washington Rodrigues santos');
