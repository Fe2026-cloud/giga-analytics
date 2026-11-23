# Escala operacional · como funciona e como publicar

## Peças
- `index.html` — a escala (editor). Não contém nenhum nome: os dados vêm de `dados.js` (no computador do administrador) ou, no site publicado, do Supabase depois do login.
- `ver.html` — página do técnico: mostra **só a escala dele**, a partir de um link pessoal.
- `nuvem.js` + `config.js` — login, perfis, sincronização e a tela **Configurações**.
- `dados.js` — **privado** (está no `.gitignore`): nomes, gestores, férias e escala-base. Nunca vai para o GitHub.
- Banco: `supabase/migrations/0024_*.sql` e `0025_*.sql` (já aplicados no projeto `giga-analytics`).

## Perfis
| Perfil | Entra com | Pode |
|---|---|---|
| Administrador | e-mail + senha | tudo + Configurações (acessos, links, publicação) |
| Editor (GA/GO) | e-mail + senha | editar as tabelas liberadas para ele |
| Leitor | e-mail + senha | só olhar as tabelas liberadas |
| Técnico | link pessoal (sem senha) | ver só a própria escala |

## Primeira publicação (uma vez)
1. Ative o GitHub Pages: repositório → *Settings → Pages → Branch `main` / pasta `/ (root)`*. O endereço fica `https://fe2026-cloud.github.io/giga-analytics/escala-telecom/`.
2. Abra esse endereço, clique em **Criar conta** (e-mail + senha ≥ 8) e confirme o e-mail se pedir. Depois do login clique em **“Sou o administrador desta escala”** (só funciona para a primeira conta — faça isso logo).
3. No computador (pasta `escala-telecom`): `python -m http.server 5174`, abra `http://localhost:5174`, **Configurações → Nuvem → Entrar na nuvem** (mesma conta) → **Publicar tudo**. Isso envia dados, contatos, plantonistas, as 5 tabelas e gera os links dos técnicos.
4. No site publicado: **Configurações → Acessos** libera os GAs e GOs (e-mail, perfil e tabelas). Cada um cria a conta na tela de login.
5. **Configurações → Links dos técnicos**: confira o endereço público, gere os links, copie ou envie por WhatsApp.

## Rotina
- GAs/GOs editam no site publicado; tudo sincroniza (um aviso aparece se duas pessoas salvarem a mesma tabela).
- Mudou nome/férias no `dados.js`? Rode **Publicar tudo** de novo (ou envie o arquivo em *Publicação → Enviar dados.js*).
- Link de técnico vazou? **Girar link** — o antigo para de funcionar.
