-- =====================================================================
-- SimCrane User — Aprovação automática do período de teste
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
-- =====================================================================
--
-- A partir daqui, todo novo usuário que se cadastrar no SimCrane já entra
-- com o PERÍODO DE TESTE ATIVO automaticamente — sem precisar da aprovação
-- manual do admin. Toda a edição (bloquear, estender, licenciar, excluir)
-- continua disponível normalmente no painel.
--
-- O trigger roda BEFORE INSERT, então funciona qualquer que seja o app
-- cliente que crie o perfil (o painel não precisa fazer nada).
-- ---------------------------------------------------------------------

-- 14 dias de teste — mesmo valor de TRIAL_DAYS no app.js.
create or replace function public.auto_approve_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nunca mexe em contas de admin.
  if new.role is distinct from 'admin' then
    -- Já entra aprovado (não fica "Acesso Pendente").
    if new.approved is null or new.approved = false then
      new.approved := true;
    end if;

    -- Inicia o período de teste se ainda não tiver um.
    if new.trial_started_at is null then
      new.trial_started_at := now();
    end if;
    if new.trial_ends_at is null then
      new.trial_ends_at := now() + interval '14 days';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_approve_trial on public.profiles;
create trigger trg_auto_approve_trial
  before insert on public.profiles
  for each row execute function public.auto_approve_trial();

-- ---------------------------------------------------------------------
-- (Opcional) Aprovar/iniciar o teste para quem JÁ estava pendente antes
-- deste script. Comente o bloco abaixo se preferir aprovar manualmente
-- os pendentes antigos.
-- ---------------------------------------------------------------------
update public.profiles
   set approved         = true,
       trial_started_at = coalesce(trial_started_at, now()),
       trial_ends_at    = coalesce(trial_ends_at, now() + interval '14 days')
 where role is distinct from 'admin'
   and approved = false;

-- =====================================================================
-- Pronto. Novos cadastros entram direto em período de teste.
-- =====================================================================
