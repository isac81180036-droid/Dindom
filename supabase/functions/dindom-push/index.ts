// Dindom · envio de avisos para o celular (Web Push).
// Publicar: Supabase > Edge Functions > Deploy a new function > Via Editor, nome "dindom-push",
// colar este arquivo e Deploy. Depois, em Details, desligar "Verify JWT with legacy secret"
// (quem chama é o próprio banco, provando com o segredo guardado em push_config).
//
// GET  → devolve a chave pública para o app inscrever o celular (cria as chaves na primeira vez).
// POST → { org_id, title, body, url, tag } com o cabeçalho x-dindom-secret: envia para os celulares
//        de gerentes e administradores da pizzaria e apaga inscrições que não existem mais.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dindom-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Cfg = { secret: string; vapid_public: string | null; vapid_private: string | null };

async function config(): Promise<Cfg> {
  const { data, error } = await sb.from('push_config').select('secret, vapid_public, vapid_private').eq('id', 1).single();
  if (error || !data) throw new Error('Rode o supabase/009_avisos_cancelamento.sql antes.');
  if (data.vapid_public && data.vapid_private) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from('push_config').update({ vapid_public: k.publicKey, vapid_private: k.privateKey }).eq('id', 1).is('vapid_public', null);
  const again = await sb.from('push_config').select('secret, vapid_public, vapid_private').eq('id', 1).single();
  return again.data as Cfg;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const cfg = await config();
    if (req.method === 'GET') return json({ publicKey: cfg.vapid_public });
    if (req.method !== 'POST') return json({ error: 'método não aceito' }, 405);
    if (req.headers.get('x-dindom-secret') !== cfg.secret) return json({ error: 'sem permissão' }, 403);

    const msg = await req.json();
    webpush.setVapidDetails('https://isac81180036-droid.github.io/Dindom/', cfg.vapid_public!, cfg.vapid_private!);
    const { data: members } = await sb.from('members').select('user_id').eq('org_id', msg.org_id).eq('active', true).in('role', ['gerente', 'admin']);
    const allowed = new Set((members ?? []).map((m) => m.user_id));
    const { data: subs } = await sb.from('push_subs').select('id, user_id, endpoint, p256dh, auth').eq('org_id', msg.org_id);
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url || '#vendas', tag: msg.tag });
    let sent = 0;
    await Promise.all((subs ?? []).filter((s) => allowed.has(s.user_id)).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from('push_subs').delete().eq('id', s.id); // celular desinscrito ou app desinstalado
      }
    }));
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
