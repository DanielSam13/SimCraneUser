-- =====================================================================
-- SimCrane User — Regra: e-mail que JÁ usou o período de teste não recebe
-- acesso automático. Precisa aguardar a APROVAÇÃO manual do admin.
--
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
--
-- Como funciona:
--   • Toda vez que um perfil ganha um trial (trial_started_at preenchido),
--     o e-mail é guardado de forma permanente na tabela `trial_history`.
--   • Quando um novo cadastro é criado (INSERT em `profiles`), um gatilho
--     verifica se o e-mail já consta em `trial_history`. Se já usou teste:
--       - força `approved = false` (sem acesso automático);
--       - zera `trial_started_at` / `trial_ends_at` (não ganha novo teste);
--       - marca `trial_reused = true` para o painel destacar o reincidente.
--   • O admin ainda pode liberar manualmente pelo botão "Aprovar".
--
-- O histórico é por e-mail e sobrevive à exclusão do perfil, então recriar
-- a conta com o mesmo e-mail não devolve o teste.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Coluna que sinaliza, no painel, quem é reincidente de teste
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists trial_reused boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) Histórico permanente de e-mails que já usaram o teste
--    (chave = e-mail normalizado em minúsculas)
-- ---------------------------------------------------------------------
create table if not exists public.trial_history (
  email             text primary key,
  last_user_id      uuid,
  first_trial_at    timestamptz not null default now(),
  last_trial_ends_at timestamptz,
  times_used        integer not null default 1,
  updated_at        timestamptz not null default now()
);

alter table public.trial_history enable row level security;

-- Só admins enxergam o histórico (consulta a partir do painel, se necessário).
drop policy if exists "trial_history: admin select" on public.trial_history;
create policy "trial_history: admin select"
  on public.trial_history for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- 3) Helper: e-mail (minúsculo) de um usuário a partir do id do perfil
-- ---------------------------------------------------------------------
create or replace function public.email_for_profile(p_id uuid)
returns text
language sql
security definer
set search_path = public, auth
stable
as $$
  select lower(trim(email)) from auth.users where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- 4) Registra no histórico quando um perfil ganha um trial
--    Dispara em INSERT (trial já preenchido) e em UPDATE (trial recém-dado).
-- ---------------------------------------------------------------------
create or replace function public.record_trial_usage()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  -- Só age quando o trial passou a existir agora.
  if NEW.trial_started_at is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.trial_started_at is not null then
    return NEW; -- já tinha trial; nada de novo a registrar
  end if;

  v_email := public.email_for_profile(NEW.id);
  if v_email is null then
    return NEW;
  end if;

  insert into public.trial_history (email, last_user_id, first_trial_at, last_trial_ends_at, times_used, updated_at)
  values (v_email, NEW.id, coalesce(NEW.trial_started_at, now()), NEW.trial_ends_at, 1, now())
  on conflict (email) do update
    set last_user_id       = excluded.last_user_id,
        last_trial_ends_at = excluded.last_trial_ends_at,
        times_used         = public.trial_history.times_used + 1,
        updated_at         = now();

  return NEW;
end;
$$;

drop trigger if exists trg_record_trial_usage on public.profiles;
create trigger trg_record_trial_usage
  after insert or update of trial_started_at on public.profiles
  for each row execute function public.record_trial_usage();

-- ---------------------------------------------------------------------
-- 5) Bloqueia acesso automático para e-mail que já usou o teste
--    BEFORE INSERT: novo cadastro reincidente entra como pendente.
-- ---------------------------------------------------------------------
create or replace function public.enforce_trial_reuse()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  v_email := public.email_for_profile(NEW.id);
  if v_email is null then
    return NEW;
  end if;

  if exists (select 1 from public.trial_history where email = v_email) then
    -- Já usou teste antes: sem acesso automático, aguarda o admin.
    NEW.approved          := false;
    NEW.trial_started_at  := null;
    NEW.trial_ends_at     := null;
    NEW.trial_reused      := true;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_trial_reuse on public.profiles;
create trigger trg_enforce_trial_reuse
  before insert on public.profiles
  for each row execute function public.enforce_trial_reuse();

-- ---------------------------------------------------------------------
-- 6) Backfill: registra no histórico todo mundo que JÁ usou teste,
--    para a regra valer também para os cadastros existentes.
-- ---------------------------------------------------------------------
insert into public.trial_history (email, last_user_id, first_trial_at, last_trial_ends_at, times_used, updated_at)
select lower(trim(u.email)) as email,
       p.id,
       coalesce(p.trial_started_at, now()),
       p.trial_ends_at,
       1,
       now()
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.trial_started_at is not null
   and u.email is not null
on conflict (email) do nothing;

-- =====================================================================
-- Pronto. A partir daqui, e-mails que já consumiram o teste entram como
-- "Acesso Pendente / Reincidente" e só liberam com aprovação do admin.
-- =====================================================================
