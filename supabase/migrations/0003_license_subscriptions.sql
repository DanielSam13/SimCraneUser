-- =====================================================================
-- SimCrane User — Compra de licença (Stripe) + validação automática
--
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
--
-- O acesso do SimCrane já é controlado por `profiles.access_expires_at`
-- (a mesma data que o admin preenche à mão no painel). Esta migração só
-- ACRESCENTA o que falta para que um pagamento aprovado no Stripe escreva
-- nessa coluna sozinho, nas modalidades mensal / semestral / anual:
--
--   • colunas de assinatura em `profiles` (plano, status, ids do Stripe);
--   • a tabela `billing_events`, que garante idempotência do webhook
--     (o Stripe pode reenviar o mesmo evento — processamos só uma vez).
--
-- A escrita nos perfis é feita pela Edge Function `stripe-webhook` usando a
-- SERVICE ROLE KEY (ignora RLS), então nenhuma policy de UPDATE é aberta ao
-- cliente aqui — o usuário final nunca edita a própria licença.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas de assinatura na tabela de perfis
--    plan: 'mensal' | 'semestral' | 'anual' (null = sem assinatura paga)
--    subscription_status: 'active' | 'past_due' | 'canceled' (null = nenhuma)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists plan                   text,
  add column if not exists subscription_status    text,
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists auto_renew             boolean not null default true;

-- Índices para o webhook localizar o perfil por cliente/assinatura do Stripe.
create index if not exists idx_profiles_stripe_customer
  on public.profiles (stripe_customer_id);
create index if not exists idx_profiles_stripe_subscription
  on public.profiles (stripe_subscription_id);

-- ---------------------------------------------------------------------
-- 2) Idempotência: cada event.id do Stripe é registrado uma única vez.
--    Se o Stripe reenviar o mesmo evento, o INSERT conflita e o webhook
--    sabe que já processou — evita estender a licença em duplicidade.
-- ---------------------------------------------------------------------
create table if not exists public.billing_events (
  id            text primary key,          -- event.id do Stripe (evt_...)
  type          text not null,             -- ex.: 'invoice.paid'
  user_id       uuid,                      -- perfil afetado, quando conhecido
  processed_at  timestamptz not null default now()
);

alter table public.billing_events enable row level security;

-- Só admins consultam o histórico de eventos de cobrança (a partir do painel,
-- se um dia for útil). A gravação é sempre via service role (ignora RLS).
drop policy if exists "billing_events: admin select" on public.billing_events;
create policy "billing_events: admin select"
  on public.billing_events for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- =====================================================================
-- Depois de rodar este SQL:
--   • Faça o deploy das Edge Functions `stripe-webhook` e
--     `create-checkout-session`.
--   • Configure os segredos do Stripe (chaves, price IDs, webhook secret).
--   • Aponte o webhook do Stripe para a função `stripe-webhook`.
-- Passo a passo completo em SETUP_STRIPE_LICENSAS.md
-- =====================================================================
