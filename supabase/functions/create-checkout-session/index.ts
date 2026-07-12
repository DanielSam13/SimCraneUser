// Edge Function: create-checkout-session
// Chamada pelo app cliente (SimCrane Pro) quando o usuário escolhe um plano
// (mensal / semestral / anual). Cria uma sessão de Checkout do Stripe e
// devolve a URL para redirecionar o usuário ao pagamento.
//
// O usuário precisa estar autenticado no Supabase: o app envia o header
//   Authorization: Bearer <access_token>
// e nós amarramos a compra ao id desse usuário (client_reference_id +
// metadados), para que o `stripe-webhook` valide a licença no perfil certo.
//
// Deploy:
//   supabase functions deploy create-checkout-session
//
// Segredos necessários (supabase secrets set ...):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_MENSAL, STRIPE_PRICE_SEMESTRAL,
//   STRIPE_PRICE_ANUAL, CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL
//   SUPABASE_URL e SUPABASE_ANON_KEY já existem no ambiente da função.

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const PLAN_TO_PRICE: Record<string, string | undefined> = {
  mensal: Deno.env.get('STRIPE_PRICE_MENSAL'),
  semestral: Deno.env.get('STRIPE_PRICE_SEMESTRAL'),
  anual: Deno.env.get('STRIPE_PRICE_ANUAL'),
};

const SUCCESS_URL = Deno.env.get('CHECKOUT_SUCCESS_URL') ?? '';
const CANCEL_URL = Deno.env.get('CHECKOUT_CANCEL_URL') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // 1) Autentica o usuário pelo token que o app enviou.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'missing bearer token' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'invalid session' }, 401);
  const user = userData.user;

  // 2) Valida o plano pedido.
  let plan = '';
  try {
    const body = await req.json();
    plan = String(body.plan ?? '').toLowerCase();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const priceId = PLAN_TO_PRICE[plan];
  if (!priceId) {
    return json({ error: 'plano inválido — use mensal, semestral ou anual' }, 400);
  }

  // 3) Reaproveita o cliente Stripe do usuário (se já comprou antes).
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Amarra o pagamento ao usuário do Supabase (lido pelo webhook).
      client_reference_id: user.id,
      customer: profile?.stripe_customer_id || undefined,
      customer_email: profile?.stripe_customer_id ? undefined : user.email,
      metadata: { supabase_user_id: user.id, plan },
      subscription_data: { metadata: { supabase_user_id: user.id, plan } },
      success_url: SUCCESS_URL || `${new URL(req.url).origin}?checkout=success`,
      cancel_url: CANCEL_URL || `${new URL(req.url).origin}?checkout=cancel`,
      allow_promotion_codes: true,
    });

    return json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Erro ao criar checkout:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
