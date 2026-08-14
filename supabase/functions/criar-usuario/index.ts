// Edge Function: criar-usuario
// Chamada pela tela de Administração (index.html) quando um administrador
// cadastra um novo usuário. Roda no servidor da Supabase (Deno) — é o único
// lugar seguro pra usar a service_role key (nunca pode ir pro navegador).
//
// Fluxo:
//   1. Confere que quem está chamando é um administrador ativo (via o JWT
//      da própria sessão de quem chamou, checado contra a tabela perfis).
//   2. Cria o usuário no Supabase Auth com a senha padrão.
//   3. A trigger handle_new_user() já cria a linha em perfis com
//      papel='operador' por padrão — aqui ajustamos pro papel escolhido e
//      marcamos deve_trocar_senha=true (obriga trocar no 1º acesso).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SENHA_PADRAO = 'Trocar123';
const PAPEIS_PERMITIDOS = ['operador', 'visualizacao'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Sem autorização.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Quem está chamando?
    const jwt = authHeader.replace('Bearer ', '');
    const { data: quemChama, error: erroUsuario } = await admin.auth.getUser(jwt);
    if (erroUsuario || !quemChama?.user) return jsonResponse({ error: 'Sessão inválida.' }, 401);

    const { data: perfilChamador, error: erroPerfil } = await admin
      .from('perfis')
      .select('papel, ativo')
      .eq('id', quemChama.user.id)
      .single();
    if (erroPerfil || !perfilChamador || perfilChamador.papel !== 'administrador' || !perfilChamador.ativo) {
      return jsonResponse({ error: 'Só administradores ativos podem criar usuários.' }, 403);
    }

    const { email, papel } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return jsonResponse({ error: 'E-mail inválido.' }, 400);
    }
    if (!PAPEIS_PERMITIDOS.includes(papel)) {
      return jsonResponse({ error: 'Papel inválido — use operador ou visualizacao.' }, 400);
    }

    const { data: novoUsuario, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: SENHA_PADRAO,
      email_confirm: true,
    });
    if (erroCriar) return jsonResponse({ error: erroCriar.message }, 400);

    const { error: erroUpdate } = await admin
      .from('perfis')
      .update({ papel, deve_trocar_senha: true })
      .eq('id', novoUsuario.user.id);
    if (erroUpdate) return jsonResponse({ error: erroUpdate.message }, 400);

    return jsonResponse({ ok: true, id: novoUsuario.user.id, senha_padrao: SENHA_PADRAO });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
