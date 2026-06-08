-- =====================================================================
-- SimCrane User — Presença (online / horas) + Web Push
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas de presença na tabela de perfis
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_login_at         timestamptz,
  add column if not exists last_seen_at          timestamptz,
  add column if not exists total_online_seconds  bigint not null default 0;

-- ---------------------------------------------------------------------
-- 2) RPCs que o APP CLIENTE do SimCrane deve chamar
--    - record_login():    uma vez, logo após o login do usuário.
--    - record_heartbeat(): periodicamente (ex.: a cada 60s) enquanto usa.
--    Ambas operam sobre o próprio usuário (auth.uid()), então são seguras
--    para serem chamadas com a chave anon pelo cliente autenticado.
-- ---------------------------------------------------------------------
create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_login_at = now(),
         last_seen_at  = now()
   where id = auth.uid();
end;
$$;

create or replace function public.record_heartbeat(p_delta integer default 60)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Protege contra valores absurdos (aba que ficou suspensa, relógio errado, etc.)
  if p_delta is null or p_delta < 0 or p_delta > 3600 then
    p_delta := 60;
  end if;

  update public.profiles
     set last_seen_at = now(),
         total_online_seconds = coalesce(total_online_seconds, 0) + p_delta
   where id = auth.uid();
end;
$$;

grant execute on function public.record_login()            to authenticated;
grant execute on function public.record_heartbeat(integer) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Tabela de inscrições de Web Push (uma por dispositivo do admin)
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Cada admin só enxerga / gerencia as próprias inscrições.
drop policy if exists "push: select own" on public.push_subscriptions;
create policy "push: select own"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push: update own" on public.push_subscriptions;
create policy "push: update own"
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: delete own"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- =====================================================================
-- Depois de rodar este SQL:
--   • Habilite o Realtime da tabela `profiles` (Database → Replication).
--   • Faça o deploy da Edge Function `notify-new-user`.
--   • Crie o Database Webhook de INSERT em `profiles` apontando para ela.
-- Passo a passo completo em SETUP_NOTIFICACOES_E_PRESENCA.md
-- =====================================================================
