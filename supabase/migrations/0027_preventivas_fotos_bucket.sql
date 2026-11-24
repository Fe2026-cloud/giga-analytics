-- ============================================================================
-- Migração 0027 — bucket de fotos do painel PREVENTIVAS DE REDE
-- ============================================================================
-- As fotos do formulário ficam no SharePoint da empresa (exigem login Microsoft). Para o painel mostrá-las sem login,
-- um fluxo do Power Automate manda cada foto para a Edge Function "preventivas-foto", que reduz a imagem e grava aqui.
--   • Bucket PÚBLICO só para leitura: quem tem o link da foto vê; ninguém consegue listar o conteúdo (não há policy de SELECT).
--   • Não existe policy de INSERT/UPDATE/DELETE: só a Edge Function (service_role) grava.
--   • Nome do arquivo = nome original da foto no OneDrive "limpo" (sem acento/espaço), igual ao que o painel calcula.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preventivas-fotos', 'preventivas-fotos', true, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do nothing;
