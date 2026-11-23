-- 0025 · Escala operacional: só usuários logados executam as funções de gestão (anon fica só com esc_ver_tecnico)
revoke execute on function public.esc_e_admin(), public.esc_existe_admin(), public.esc_gerar_tokens(text), public.esc_meu_acesso(),
  public.esc_papel(), public.esc_pode_editar(text), public.esc_pode_ler(text), public.esc_rotacionar_token(text),
  public.esc_salvar_board(text, jsonb, integer), public.esc_virar_admin(), public.esc_email() from anon, public;
grant execute on function public.esc_e_admin(), public.esc_existe_admin(), public.esc_gerar_tokens(text), public.esc_meu_acesso(),
  public.esc_papel(), public.esc_pode_editar(text), public.esc_pode_ler(text), public.esc_rotacionar_token(text),
  public.esc_salvar_board(text, jsonb, integer), public.esc_virar_admin(), public.esc_email() to authenticated;
alter function public.esc_email() set search_path = public;
