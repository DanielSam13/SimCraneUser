# Compra de licença (Stripe) + validação automática

Este guia ativa a **compra automática de licença** do SimCrane nas modalidades
**mensal**, **semestral** e **anual**. Quando o pagamento é aprovado, o próprio
sistema **valida o usuário** e libera o acesso — sem aprovação manual do admin.

> Como funciona, em uma frase: o acesso do SimCrane já é controlado pela coluna
> `profiles.access_expires_at` (a mesma data que o admin preenche à mão no
> painel). A integração faz o **webhook do Stripe escrever nessa coluna sozinho**
> quando a assinatura é paga. O app cliente **não muda** a forma de checar acesso.

---

## Visão geral do fluxo

```
Usuário escolhe um plano no SimCrane Pro
        │
        ▼
create-checkout-session (Edge Function)  ──►  Checkout do Stripe (paga com cartão/Pix)
                                                        │  pagamento aprovado
                                                        ▼
                                             stripe-webhook (Edge Function)
                                                        │  valida a assinatura
                                                        ▼
                        profiles: approved = true, access_expires_at = fim do período,
                                  plan = mensal|semestral|anual, subscription_status = active
                                                        │
                                                        ▼
                                   Painel mostra "Licença ativa" + plano ♻
```

- **Semestral** no Stripe = preço com `interval = month` e `interval_count = 6`.
- A **validade** vem do `current_period_end` da assinatura — nada de calcular
  dias na mão, então renovações mensais/semestrais/anuais funcionam sozinhas.

---

## 1. Rodar o SQL

Supabase → **SQL Editor** → cole e rode:
`supabase/migrations/0003_license_subscriptions.sql`

Isso adiciona em `profiles` as colunas `plan`, `subscription_status`,
`stripe_customer_id`, `stripe_subscription_id`, `auto_renew` e cria a tabela
`billing_events` (idempotência do webhook).

---

## 2. Criar os produtos e preços no Stripe

Stripe → **Product catalog** → crie **1 produto** (ex.: "SimCrane Pro") com **3
preços recorrentes**:

| Plano | Recorrência | Configuração no Stripe |
|---|---|---|
| Mensal | Mensal | `interval = month`, `interval_count = 1` |
| Semestral | 6 meses | `interval = month`, `interval_count = 6` |
| Anual | Anual | `interval = year`, `interval_count = 1` |

Anote os três **Price IDs** (`price_...`).

---

## 3. Deploy das Edge Functions

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

> `--no-verify-jwt` no webhook é intencional: o Stripe não envia um JWT do
> Supabase. A autenticidade é garantida pela **assinatura do webhook**
> (verificada dentro da função com o `STRIPE_WEBHOOK_SECRET`).

### 3.1 Segredos

```bash
supabase secrets set STRIPE_SECRET_KEY="sk_live_..."       # ou sk_test_...
supabase secrets set STRIPE_PRICE_MENSAL="price_..."
supabase secrets set STRIPE_PRICE_SEMESTRAL="price_..."
supabase secrets set STRIPE_PRICE_ANUAL="price_..."
supabase secrets set CHECKOUT_SUCCESS_URL="https://SEU-APP/obrigado"
supabase secrets set CHECKOUT_CANCEL_URL="https://SEU-APP/planos"
# STRIPE_WEBHOOK_SECRET é preenchido no passo 4.
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem no
ambiente das funções.)

---

## 4. Criar o Webhook no Stripe

Stripe → **Developers → Webhooks → Add endpoint**:

- **Endpoint URL:**
  `https://<seu-projeto>.supabase.co/functions/v1/stripe-webhook`
- **Eventos a escutar:**
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Copie o **Signing secret** (`whsec_...`) e registre:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
```

Faça o deploy do webhook de novo se ele já estava no ar, para pegar o segredo:
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

---

## 5. Chamar o checkout no app cliente (SimCrane Pro)

No app onde o usuário escolhe o plano, com o mesmo cliente Supabase já
autenticado:

```js
async function comprarPlano(plano /* 'mensal' | 'semestral' | 'anual' */) {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(
    'https://<seu-projeto>.supabase.co/functions/v1/create-checkout-session',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ plan: plano }),
    },
  );

  const { url } = await res.json();
  window.location.href = url; // redireciona ao Checkout do Stripe
}
```

Depois do pagamento, o Stripe chama o `stripe-webhook`, que libera o acesso
automaticamente. O usuário volta para a `CHECKOUT_SUCCESS_URL`.

---

## 6. O que muda no painel admin

- Usuários com assinatura paga aparecem como **"Licença ativa"** + um badge do
  plano (**Mensal / Semestral / Anual**) com `♻` (renova) ou `⏹` (renovação
  cancelada).
- **Pagamento pendente** (falha na cobrança) e **Cancelada** aparecem como
  badges próprios; o acesso continua válido até a data já paga.
- O **preenchimento manual** de validade continua funcionando como **override**
  / fallback — nada foi removido.

---

## Testar antes de ir para produção

1. Use as chaves `sk_test_...` e o **modo de teste** do Stripe.
2. `stripe listen --forward-to https://<projeto>.supabase.co/functions/v1/stripe-webhook`
   (ou dispare eventos pelo painel do Stripe).
3. Compre um plano com um **cartão de teste** (`4242 4242 4242 4242`).
4. Confira no painel que o usuário virou **"Licença ativa"** com o plano certo e
   validade = fim do período.

---

## Pontos de atenção

| Tema | Comportamento |
|---|---|
| Reenvio de evento | `billing_events` garante idempotência (não estende 2×). |
| Renovação | `invoice.paid` estende a validade automaticamente. |
| Cancelamento | acesso mantido até o fim do período pago; status = `canceled`. |
| Falha de cobrança | status = `past_due`; acesso segue até a validade atual (graça). |
| Reembolso/chargeback | o Stripe cancela a assinatura → `subscription.deleted`. |
| Segurança | webhook só aceita eventos com assinatura Stripe válida. |
| Trial (14 dias) | continua existindo; a compra simplesmente sobrepõe a validade. |
