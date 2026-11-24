// Edge Function: preventivas-foto
// Chamada pelo Power Automate para cada foto do formulário "Ações Preventivas" (arquivo no OneDrive da empresa).
// Reduz a imagem (lado maior 1600 px, JPEG 80) respeitando a rotação do celular (EXIF) e grava no bucket público
// "preventivas-fotos", para o painel mostrar a foto sem exigir login Microsoft.
//
// Autorização: token do Power Automate (o mesmo da função SQL preventivas_receber), conferido pelo hash na tabela
// preventivas_tokens — por isso a função é publicada com verify_jwt = false.
//
// Pedido (POST, JSON):  { "token": "...", "nome": "20250803_102145(0)_Fulano.jpg", "base64": "<conteúdo do arquivo em base64>" }
// Resposta:             { "ok": true, "chave": "20250803_102145_0__Fulano.jpg", "bytes_in": 3200000, "bytes_out": 210000, "reduzida": true }
//
// A "chave" (nome do arquivo no bucket) é calculada IGUAL no painel (preventivas-rede/index.html, função chaveFoto).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const BUCKET = 'preventivas-fotos';
const LADO_MAX = 1280;          // lado maior em px (era 1600; reduzido para economizar Storage)
const QUALIDADE = 70;           // JPEG (era 80)
const JA_REDUZIDA = 300 * 1024; // foto já pequena, sem rotação EXIF e dentro do lado máximo: guarda como veio (evita reencodar)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function chaveFoto(nome: string): string {
  let n = nome;
  try { n = decodeURIComponent(n); } catch { /* nome já veio decodificado */ }
  n = n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');
  return n.slice(-150);
}

async function sha256Hex(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Lê a orientação EXIF (1..8) de um JPEG; 1 = normal.
function orientacaoExif(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) break;
    const marcador = b[o + 1];
    const tam = (b[o + 2] << 8) | b[o + 3];
    if (marcador === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) {
      const t = o + 10, le = b[t] === 0x49;
      const u16 = (p: number) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
      const u32 = (p: number) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
        : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
      const ifd = t + u32(t + 4), n = u16(ifd);
      for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === 0x0112) return u16(e + 8); }
      return 1;
    }
    if (marcador === 0xda) break;
    o += 2 + tam;
  }
  return 1;
}

async function reduzJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const orient = orientacaoExif(bytes);
  let img = await Image.decode(bytes) as Image;
  const maior = Math.max(img.width, img.height);
  if (orient === 1 && maior <= LADO_MAX && bytes.length <= JA_REDUZIDA) return bytes;
  if (maior > LADO_MAX) {
    const f = LADO_MAX / maior;
    img = img.resize(Math.round(img.width * f), Math.round(img.height * f));
  }
  // imagescript gira no sentido ANTI-horário (testado): EXIF 6 pede 90° horário => rotate(270); EXIF 8 => rotate(90)
  if (orient === 3) img = img.rotate(180);
  else if (orient === 6) img = img.rotate(270);
  else if (orient === 8) img = img.rotate(90);
  return await img.encodeJPEG(QUALIDADE);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405);

  let corpo: { token?: string; nome?: string; base64?: string };
  try { corpo = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const { token, nome, base64 } = corpo;
  if (!token || !nome || !base64) return json({ erro: 'campos obrigatórios: token, nome, base64' }, 400);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: tk, error: errTk } = await sb.from('preventivas_tokens').select('id').eq('ativo', true).eq('token_hash', await sha256Hex(token)).maybeSingle();
  if (errTk || !tk) return json({ erro: 'token inválido' }, 403);

  const chave = chaveFoto(nome);
  if (!chave) return json({ erro: 'nome inválido' }, 400);
  const ext = (chave.split('.').pop() || '').toLowerCase();
  let bytes: Uint8Array;
  try { bytes = base64ParaBytes(base64); } catch { return json({ erro: 'base64 inválido' }, 400); }
  const bytesIn = bytes.length;

  let tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'mp4' ? 'video/mp4' : 'image/jpeg';
  let reduzida = false;
  if (ext === 'jpg' || ext === 'jpeg') {
    try { bytes = await reduzJpeg(bytes); reduzida = true; tipo = 'image/jpeg'; }
    catch (e) { console.warn('não consegui reduzir, guardando o original:', String(e)); }
  }

  const { error } = await sb.storage.from(BUCKET).upload(chave, bytes, { contentType: tipo, upsert: true, cacheControl: '31536000' });
  if (error) return json({ erro: 'falha ao gravar: ' + error.message }, 500);
  return json({ ok: true, chave, bytes_in: bytesIn, bytes_out: bytes.length, reduzida });
});
