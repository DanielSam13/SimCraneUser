// Edge Function: stripe-webhook
// Recebe os eventos do Stripe e faz a VALIDAÇÃO AUTOMÁTICA da licença:
// quando um pagamento é aprovado, escreve em `profiles.access_expires_at`
// (a mesma coluna que o admin preenche à mão), aprova o usuário e registra
// o plano (mensal / semestral / anual). Renovações estendem a validade;
// cancelamento/falha atualizam o status e a licença expira naturalmente.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt: o Stripe não manda JWT do Supabase; a autenticidade é
//    garantida pela assinatura do webhook, verificada abaixo.)
//
// Segredos necessários (supabase secrets set ...):
//   STRIPE_SECRET_KEY           sk_live_... (ou sk_test_...)
//   STRIPE_WEBHOOK_SECRET       whsec_... (do endpoint criado no Stripe)
//   STRIPE_PRICE_MENSAL         price_...  (assinatura mensal)
//   STRIPE_PRICE_SEMESTRAL      price_...  (assinatura de 6 meses)
//   STRIPE_PRICE_ANUAL          price_...  (assinatura anual)
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente da função.

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  // O runtime do Deno usa fetch — evita o cliente HTTP padrão (Node) do SDK.
  httpClient: Stripe.createFetchHttpClient(),
});

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

// Mapa price → rótulo de plano. A DURAÇÃO não é calculada à mão: usamos o
// `current_period_end` da assinatura como fonte da verdade, então mensal,
// semestral (interval_count = 6) e anual funcionam sem cálculo de dias.
const PRICE_TO_PLAN: Record<string, string> = {
  [Deno.env.get('STRIPE_PRICE_MENSAL') ?? '']: 'mensal',
  [Deno.env.get('STRIPE_PRICE_SEMESTRAL') ?? '']: 'semestral',
  [Deno.env.get('STRIPE_PRICE_ANUAL') ?? '']: 'anual',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ error: 'missing stripe-signature' }, 400);

  // O corpo BRUTO é obrigatório para validar a assinatura do webhook.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    // Versão async: obrigatória no Deno/edge (usa SubtleCrypto).
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Assinatura inválida do webhook:', err);
    return json({ error: 'invalid signature' }, 400);
  }

  // Idempotência: se já processamos este event.id, encerra sem reaplicar.
  const { error: dupErr } = await supabase
    .from('billing_events')
    .insert({ id: event.id, type: event.type });
  if (dupErr) {
    // 23505 = unique_violation → evento repetido (reenvio do Stripe).
    if ((dupErr as { code?: string }).code === '23505') {
      return json({ ignored: 'duplicate event' });
    }
    console.error('Falha ao registrar billing_event:', dupErr);
    // Segue mesmo assim — melhor processar do que perder o evento.
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription' || !session.subscription) break;
        const userId = await resolveUserIdFromSession(session);
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await applyLicense(userId, sub);
        break;
      }

      case 'invoice.paid': {
        // Renovação recorrente: estende a validade para o novo período.
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        await applyLicense(null, sub);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        await updateBySubscription(invoice.subscription as string, {
          subscription_status: 'past_due',
        });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Sincroniza status e validade (cancelamento no fim do período,
        // reativação, troca de plano, etc.). Nunca corta o acesso antes da
        // data já paga: mantemos access_expires_at = current_period_end.
        const sub = event.data.object as Stripe.Subscription;
        await applyLicense(null, sub);
        break;
      }

      default:
        // Demais eventos não afetam a licença.
        break;
    }
  } catch (err) {
    console.error(`Erro ao processar ${event.type}:`, err);
    return json({ error: String(err) }, 500);
  }

  return json({ received: true, type: event.type });
});

// Descobre o id do perfil (auth.users.id) a partir da sessão de checkout.
// A função create-checkout-session grava o id em client_reference_id e nos
// metadados, então basta lê-lo aqui.
async function resolveUserIdFromSession(session: Stripe.Checkout.Session): Promise<string | null> {
  return (
    session.client_reference_id ||
    (session.metadata?.supabase_user_id as string | undefined) ||
    null
  );
}

// Aplica/atualiza a licença no perfil a partir do objeto Subscription do Stripe.
// Se userId vier null (eventos de renovação/atualização), descobrimos o perfil
// pelos metadados da assinatura ou, em último caso, pelo stripe_subscription_id.
async function applyLicense(userId: string | null, sub: Stripe.Subscription) {
  const uid =
    userId ||
    (sub.metadata?.supabase_user_id as string | undefined) ||
    (await userIdBySubscription(sub.id));

  if (!uid) {
    console.warn(`Assinatura ${sub.id} sem perfil correspondente — ignorada.`);
    return;
  }

  const priceId = sub.items.data[0]?.price?.id ?? '';
  const plan = PRICE_TO_PLAN[priceId] ?? null;

  // Fonte da verdade da validade: o fim do período atual pago no Stripe.
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const status = mapStatus(sub.status);
  const changes: Record<string, unknown> = {
    stripe_customer_id: sub.customer as string,
    stripe_subscription_id: sub.id,
    plan,
    subscription_status: status,
    auto_renew: !sub.cancel_at_period_end,
  };

  // Só concede acesso quando a assinatura está de fato ativa/em teste.
  if (periodEnd && (sub.status === 'active' || sub.status === 'trialing')) {
    changes.approved = true;
    changes.access_expires_at = periodEnd;
  }

  const { error } = await supabase.from('profiles').update(changes).eq('id', uid);
  if (error) throw error;

  console.log(`Licença aplicada: user=${uid} plano=${plan} status=${status} até ${periodEnd}`);
}

async function updateBySubscription(subscriptionId: string, changes: Record<string, unknown>) {
  const { error } = await supabase
    .from('profiles')
    .update(changes)
    .eq('stripe_subscription_id', subscriptionId);
  if (error) throw error;
}

async function userIdBySubscription(subscriptionId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  return data?.id ?? null;
}

// Normaliza os status do Stripe para os 3 que o painel entende.
function mapStatus(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    default:
      // canceled, incomplete_expired, paused...
      return 'canceled';
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
