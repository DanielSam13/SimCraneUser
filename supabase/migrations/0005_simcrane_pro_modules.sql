-- =====================================================================
-- SimCrane User — Módulos que o SimCrane Pro realmente bloqueia
--
-- Rode este script no Supabase: Dashboard → SQL Editor → New query → Run.
-- Requer a migração 0004_user_modules.sql.
--
-- O SimCrane Pro verifica três chaves na barra lateral:
--   • cadsim     → botão "CADSim" (editor CAD)
--   • cinematic  → botão "Cinematic" (roteiro de içamento filmado em MP4)
--   • portico    → botão "PÓRTICO" (pórtico hidráulico)
--
-- Regra no app: uma chave só bloqueia algo se existir neste catálogo. Se o
-- módulo for excluído daqui, o app volta ao comportamento antigo (Pórtico
-- livre para todos; CADSim e Cinematic só para administradores).
-- Administradores sempre têm todos os módulos.
--
-- Para o acesso de hoje não mudar no dia em que a migração entra:
--   • Pórtico entra como "padrão" e é liberado para todos os usuários que já
--     existem (como era antes).
--   • CADSim e Cinematic NÃO são padrão: continuam só com administradores até
--     você liberar usuário a usuário (ou "Liberar p/ todos") no painel.
-- O backfill só roda para módulos criados AGORA — rodar o script de novo não
-- devolve um módulo que o admin já removeu de alguém.
-- =====================================================================

with novos as (
  insert into public.app_modules (key, name, description, icon, sort_order, default_enabled) values
    ('cadsim',    'CADSim',    'Editor CAD que abre por cima do simulador.',              '📐', 10, false),
    ('portico',   'Pórtico',   'Pórtico hidráulico: operação, LMI e lingadas.',           '🏗️', 11, true),
    ('cinematic', 'Cinematic', 'Roteiro de içamento filmado e exportado em MP4.',         '🎬', 12, false)
  on conflict (key) do nothing
  returning key, sort_order, default_enabled
)
update public.profiles p
   set modules = p.modules || array(
         select n.key from novos n
          where n.default_enabled and not (n.key = any(p.modules))
          order by n.sort_order)
 where coalesce(p.role, 'user') <> 'admin'
   and exists (select 1 from novos n
                where n.default_enabled and not (n.key = any(p.modules)));

-- ---------------------------------------------------------------------
-- OPCIONAL — remover os módulos de exemplo da 0004
-- ---------------------------------------------------------------------
-- "Simulador 3D" (simulador), "Catálogo de guindastes" (catalogo) e
-- "Desenhos CAD" (cad) foram criados como sugestão e o SimCrane Pro não
-- verifica essas chaves: ligar ou desligar não muda nada no app. Se quiser
-- deixar o catálogo só com o que tem efeito, descomente a linha abaixo (o
-- gatilho trg_cleanup_removed_module tira as chaves dos perfis sozinho).
--
-- delete from public.app_modules where key in ('simulador', 'catalogo', 'cad');
