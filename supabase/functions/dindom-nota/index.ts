// Dindom · leitura da nota fiscal por foto (Claude, da Anthropic).
// Publicar: Supabase > Edge Functions > Secrets: crie ANTHROPIC_API_KEY com a chave do console.anthropic.com.
// Depois: Deploy a new function > Via Editor, nome "dindom-nota", colar este arquivo e Deploy
// (deixe "Verify JWT" LIGADO: só quem está logado no app usa).
//
// POST { images: [{ data: base64, media_type }], products: [{ id, name, unit }], categories: [string] }
// → { ok: true, nota: {...} } com loja, CNPJ, data, chave de acesso, total e cada item (com o produto do
//   estoque que ele parece ser, ou um nome limpo para cadastrar).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const anthropic = new Anthropic(); // lê ANTHROPIC_API_KEY dos Secrets do Supabase

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `Você lê notas fiscais de compra (cupom NFC-e, DANFE ou nota de mercado/atacado) fotografadas pelo comprador de uma pizzaria em Macapá-AP.
Extraia exatamente o que está impresso, sem inventar nada.
- items: uma linha por produto da nota, na ordem impressa. desc = descrição como está na nota. qty = quantidade (decimal com ponto). unit = unidade impressa (UN, KG, G, CX, PCT, L, FD...). unit_price = valor unitário em reais. total = valor total da linha em reais (já com desconto do item, se houver).
- Se a nota vier em várias fotos (partes de cima para baixo), junte tudo e não repita itens que aparecem em duas fotos.
- product_id: o id do produto do estoque da pizzaria que é o MESMO produto (mesma coisa, mesmo tipo; marca e tamanho de embalagem podem mudar). Se nenhum servir, "".
- product_qty: a quantidade comprada convertida para a unidade desse produto do estoque, usando o tamanho da embalagem escrito na descrição (ex.: 2 UN de "FARINHA 5KG" com produto em kg = 10; 3 FD de "COCA 2L C/6" com produto em un = 18). Sem produto ou sem como converter: 0.
- product_name: nome curto e limpo do produto em português, como a pizzaria cadastraria (ex.: "Mussarela", "Farinha de trigo", "Refrigerante 2L"), sem marca nem código.
- category: uma das categorias da lista. kind: "preparo" (massas, molhos, farinha, óleo, fermento), "montagem" (queijos, carnes, recheios) ou "apoio" (bebidas, embalagens, descartáveis, limpeza).
- cnpj só com números; date no formato AAAA-MM-DD; access_key = os 44 números da chave de acesso, se aparecerem (sem espaços), senão "". Campo desconhecido: "" ou 0.
- is_receipt = false se as fotos não forem de uma nota de compra.
- notes: avise em português se alguma parte estiver ilegível, cortada ou se o total dos itens não bater com o total da nota; senão "".`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_receipt', 'store_name', 'cnpj', 'date', 'access_key', 'number', 'total', 'items', 'notes'],
  properties: {
    is_receipt: { type: 'boolean' },
    store_name: { type: 'string' },
    cnpj: { type: 'string' },
    date: { type: 'string' },
    access_key: { type: 'string' },
    number: { type: 'string' },
    total: { type: 'number' },
    notes: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['desc', 'qty', 'unit', 'unit_price', 'total', 'product_id', 'product_qty', 'product_name', 'category', 'kind'],
        properties: {
          desc: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string' },
          unit_price: { type: 'number' },
          total: { type: 'number' },
          product_id: { type: 'string' },
          product_qty: { type: 'number' },
          product_name: { type: 'string' },
          category: { type: 'string' },
          kind: { type: 'string', enum: ['preparo', 'montagem', 'apoio'] },
        },
      },
    },
  },
};

const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'método não aceito' }, 405);
  try {
    // Só gente da equipe (logada no app) usa: confere o login e o vínculo com a pizzaria.
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await sb.auth.getUser(jwt);
    if (!auth?.user) return json({ error: 'Entre no app de novo.' }, 401);
    const { data: member } = await sb.from('members').select('org_id, role').eq('user_id', auth.user.id).eq('active', true).limit(1).maybeSingle();
    if (!member || member.role === 'contador') return json({ error: 'Sem acesso ao estoque.' }, 403);

    const body = await req.json();
    const images = (Array.isArray(body.images) ? body.images : []).slice(0, 5)
      .filter((i: { data?: string; media_type?: string }) => i && typeof i.data === 'string' && MEDIA.includes(String(i.media_type)));
    if (!images.length) return json({ error: 'Mande pelo menos uma foto da nota.' }, 400);
    const products = (Array.isArray(body.products) ? body.products : []).slice(0, 800)
      .map((p: { id: string; name: string; unit: string }) => `${p.id} | ${p.name} | ${p.unit}`).join('\n');
    const categories = (Array.isArray(body.categories) ? body.categories : []).join(', ');

    const content = [
      ...images.map((i: { data: string; media_type: string }) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: i.media_type as 'image/jpeg', data: i.data },
      })),
      {
        type: 'text' as const,
        text: `Produtos do estoque (id | nome | unidade):\n${products || '(nenhum cadastrado)'}\n\nCategorias: ${categories || 'Outros'}\n\n` +
          `Leia ${images.length > 1 ? `estas ${images.length} fotos da mesma nota` : 'esta nota'} e devolva os dados.`,
      },
    ];

    const response = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') return json({ error: 'A leitura foi recusada. Tente outra foto.' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'A nota é grande demais para uma leitura. Tente em duas partes.' }, 422);
    const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const nota = JSON.parse(text);
    return json({ ok: true, nota });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'A chave da Anthropic (ANTHROPIC_API_KEY) está errada ou faltando nos Secrets do Supabase.' }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Muitas leituras ao mesmo tempo. Espere um minuto e tente de novo.' }, 429);
    if (e instanceof Anthropic.BadRequestError) return json({ error: 'A foto não pôde ser lida (' + e.message + ').' }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: `A leitura falhou (${e.status}). Tente de novo.` }, 502);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
