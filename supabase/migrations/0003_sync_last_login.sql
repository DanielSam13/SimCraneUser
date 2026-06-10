-- =====================================================================
-- SimCrane User — Sincroniza o último login (auth.users → profiles)
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
-- =====================================================================
--
-- O Supabase já grava `last_sign_in_at` em auth.users a CADA login de
-- qualquer usuário (visível em Authentication → Users → "Last sign in at").
-- Este trigger copia esse horário para `profiles.last_login_at` (e
-- `last_seen_at`), que é o que o painel exibe — assim o "último login"
-- aparece para TODOS os usuários SEM precisar tocar no app cliente.
--
-- Observação: o "tempo total de uso" (duração logado) continua dependendo
-- dos heartbeats (record_heartbeat) no app cliente — o auth.users não mede
-- duração de sessão, só o instante do último login.
-- ---------------------------------------------------------------------

create or replace function public.sync_last_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só age quando o instante de login realmente muda.
  if new.last_sign_in_at is distinct from old.last_sign_in_at
     and new.last_sign_in_at is not null then
    update public.profiles
       set last_login_at = new.last_sign_in_at,
           last_seen_at  = greatest(coalesce(last_seen_at, new.last_sign_in_at), new.last_sign_in_at)
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_last_login on auth.users;
create trigger trg_sync_last_login
  after update on auth.users
  for each row execute function public.sync_last_login();

-- ---------------------------------------------------------------------
-- Preenche de uma vez o último login dos usuários que JÁ existem,
-- a partir do que o auth.users já tem registrado.
-- ---------------------------------------------------------------------
update public.profiles p
   set last_login_at = u.last_sign_in_at,
       last_seen_at  = greatest(coalesce(p.last_seen_at, u.last_sign_in_at), u.last_sign_in_at)
  from auth.users u
 where u.id = p.id
   and u.last_sign_in_at is not null;

-- =====================================================================
-- Pronto. O painel passa a mostrar o "Último login" de todos os usuários.
-- (Requer que o 0001_presence_and_push.sql já tenha criado as colunas.)
-- =====================================================================
