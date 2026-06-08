// Edge Function: notify-new-user
// Disparada por um Database Webhook de INSERT na tabela `profiles`.
// Envia uma notificação de Web Push para todos os admins inscritos, mesmo
// com o app fechado.
//
// Deploy:
//   supabase functions deploy notify-new-user
//
// Segredos necessários (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente da função.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@simcrane.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));

    // Formato do Database Webhook: { type, table, record, old_record, schema }
    const eventType = payload.type ?? payload.eventType;
    const record = payload.record ?? payload.new ?? {};

    if (eventType && eventType !== 'INSERT') {
      return json({ ignored: 'not an insert' });
    }
    // Só avisa sobre cadastros ainda não aprovados.
    if (record.approved === true) {
      return json({ ignored: 'already approved' });
    }

    const name = record.full_name || 'Novo usuário';
    const body = JSON.stringify({
      title: 'Aprovação Pendente',
      body: `${name} acabou de solicitar acesso ao SimCrane.`,
      tag: 'simcrane-pending',
      url: './',
    });

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth');
    if (error) throw error;

    const results = await Promise.allSettled(
      (subs ?? []).map((s) =>
        webpush
          .sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          )
          .catch(async (err: any) => {
            // Remove inscrições expiradas / inválidas.
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
            }
            throw err;
          })
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    return json({ sent, total: subs?.length ?? 0 });
  } catch (err) {
    console.error('notify-new-user error:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
