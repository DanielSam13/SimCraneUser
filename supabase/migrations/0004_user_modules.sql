-- =====================================================================
-- SimCrane User — Liberação de MÓDULOS por usuário
--
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
--
-- O que muda:
--   • Tabela `app_modules`: catálogo dos módulos do SimCrane Pro
--     (chave, nome, descrição, ícone, ordem). O admin cria/edita pelo painel.
--   • Coluna `profiles.modules` (text[]): chaves dos módulos liberados para
--     cada usuário. O admin liga/desliga módulo a módulo no painel.
--   • Módulos marcados como "padrão" (`default_enabled`) são liberados
--     automaticamente para todo cadastro novo.
--   • RPC `has_module(chave)`: o APP CLIENTE pergunta se o usuário logado
--     pode abrir um módulo. Admin sempre pode.
--
-- Segurança: o gatilho `protect_profile_access_fields` (já existente) só
-- deixa o próprio usuário alterar nome, empresa e renovação automática —
-- então `modules` já fica protegida contra edição pelo usuário final. No
-- INSERT feito pelo próprio usuário, o gatilho abaixo descarta qualquer valor
-- enviado e aplica apenas os módulos padrão.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Catálogo de módulos
-- ---------------------------------------------------------------------
create table if not exists public.app_modules (
  key             text primary key
                  check (key ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  name            text not null,
  description     text,
  icon            text,
  sort_order      integer not null default 0,
  default_enabled boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.app_modules enable row level security;

-- Qualquer usuário autenticado lê o catálogo (o app cliente mostra os nomes).
drop policy if exists "app_modules: authenticated select" on public.app_modules;
create policy "app_modules: authenticated select"
  on public.app_modules for select
  to authenticated
  using (true);

-- Só admin cria, edita e remove módulos.
drop policy if exists "app_modules: admin write" on public.app_modules;
create policy "app_modules: admin write"
  on public.app_modules for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Realtime: o painel atualiza sozinho quando o catálogo muda.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'app_modules') then
    alter publication supabase_realtime add table public.app_modules;
  end if;
end;
$$;

-- Módulos iniciais (sugestão — renomeie, remova ou crie outros no painel).
-- As chaves são o que o app cliente verifica com has_module('chave').
insert into public.app_modules (key, name, description, icon, sort_order, default_enabled) values
  ('simulador', 'Simulador 3D',            'Operação e simulação de içamento em 3D.',     '🏗️', 0, true),
  ('catalogo',  'Catálogo de guindastes',  'Modelos, tabelas de carga e dimensões.',      '📚', 1, true),
  ('cad',       'Desenhos CAD',            'Plano de rigging e desenhos salvos na nuvem.', '📐', 2, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2) Módulos liberados por usuário
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists modules text[] not null default '{}';

-- Backfill: quem já existe mantém acesso a tudo que é padrão hoje, para a
-- novidade não bloquear ninguém de surpresa.
update public.profiles
   set modules = (select coalesce(array_agg(key order by sort_order), '{}')
                    from public.app_modules where default_enabled)
 where cardinality(modules) = 0;

-- ---------------------------------------------------------------------
-- 3) Cadastro novo recebe os módulos padrão
-- ---------------------------------------------------------------------
-- Sem SECURITY DEFINER de propósito: assim `current_user` continua sendo o
-- papel de quem fez o INSERT (authenticated / anon), e não o dono da função.
create or replace function public.apply_default_modules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Usuário comum criando o próprio perfil não escolhe módulos; perfis
  -- criados pelo sistema (handle_new_user) vêm vazios. Nos dois casos,
  -- aplica os padrões. Admin / service role podem enviar uma lista própria.
  if (current_user in ('authenticated', 'anon') and not public.is_admin())
     or coalesce(cardinality(NEW.modules), 0) = 0 then
    NEW.modules := (select coalesce(array_agg(key order by sort_order), '{}')
                      from public.app_modules where default_enabled);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_apply_default_modules on public.profiles;
create trigger trg_apply_default_modules
  before insert on public.profiles
  for each row execute function public.apply_default_modules();

-- ---------------------------------------------------------------------
-- 4) Ao remover um módulo do catálogo, tira a chave de todos os perfis
-- ---------------------------------------------------------------------
create or replace function public.cleanup_removed_module()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set modules = array_remove(modules, OLD.key)
   where OLD.key = any(modules);
  return OLD;
end;
$$;

drop trigger if exists trg_cleanup_removed_module on public.app_modules;
create trigger trg_cleanup_removed_module
  after delete on public.app_modules
  for each row execute function public.cleanup_removed_module();

-- ---------------------------------------------------------------------
-- 5) Liberar / remover um módulo de TODOS os usuários (ação em massa do painel)
-- ---------------------------------------------------------------------
create or replace function public.set_module_for_all(p_key text, p_enabled boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_modules where key = p_key) then
    raise exception 'Módulo % não existe.', p_key;
  end if;

  if p_enabled then
    update public.profiles
       set modules = array_append(modules, p_key)
     where coalesce(role, 'user') <> 'admin' and not (p_key = any(modules));
  else
    update public.profiles
       set modules = array_remove(modules, p_key)
     where coalesce(role, 'user') <> 'admin' and p_key = any(modules);
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.set_module_for_all(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6) RPC para o APP CLIENTE: o usuário logado pode abrir o módulo?
--    Exige acesso válido (has_access) E o módulo liberado. Admin sempre pode.
--    Uso no SimCrane Pro:
--      const { data: ok } = await supabase.rpc('has_module', { p_key: 'cad' });
--    Ou leia a lista inteira de uma vez: select modules from profiles where id = auth.uid().
-- ---------------------------------------------------------------------
create or replace function public.has_module(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or (public.has_access() and p_key = any(p.modules)))
  );
$$;

grant execute on function public.has_module(text) to authenticated;

-- =====================================================================
-- Pronto. No painel, aba "Módulos" para o catálogo e, em cada usuário,
-- a seção "Módulos liberados" para ligar/desligar o acesso.
-- =====================================================================
