/* ============================================================================
 * Cliente Supabase — GIGA+ Analytics
 * Projeto: giga-analytics (South America - São Paulo)
 *
 * A "publishable key" abaixo é segura para ficar no navegador — ela só
 * funciona em conjunto com as regras de Row Level Security (RLS) já ativas
 * no banco (ver supabase/migrations). Nunca coloque a "secret key" aqui.
 * ========================================================================== */
const SUPABASE_URL = 'https://wdbhqsenyegxercgihth.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_YiueMNb86nrq_zCSiC53-w_Hof5VO4M';

// window.supabase vem do CDN (@supabase/supabase-js) carregado antes deste script.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
