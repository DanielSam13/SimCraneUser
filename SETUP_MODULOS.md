# Liberação de módulos por usuário

O painel agora permite que o **admin escolha quais módulos do SimCrane Pro cada
usuário pode abrir**.

- **Aba "Módulos"**: catálogo dos módulos (criar, editar, excluir, liberar ou
  remover de todos os usuários de uma vez). Marque **Padrão para novos** para
  liberar o módulo automaticamente em todo cadastro novo.
- **Detalhes do usuário** (clique no card): seção **Módulos liberados** com um
  interruptor por módulo, além dos atalhos **Todos** / **Nenhum**.
- **Filtro por módulo** na lista de usuários (inclui "Sem nenhum módulo").

---

## 1. Rodar o SQL

Supabase → **SQL Editor** → cole e rode
`supabase/migrations/0004_user_modules.sql` (ou `supabase db push` pela CLI).

Isso cria:

| Objeto | Para quê |
|---|---|
| tabela `app_modules` | catálogo (chave, nome, descrição, ícone, ordem, padrão) |
| coluna `profiles.modules` (`text[]`) | chaves dos módulos liberados para o usuário |
| gatilho `trg_apply_default_modules` | cadastro novo recebe os módulos "padrão" |
| gatilho `trg_cleanup_removed_module` | excluir um módulo o remove de todos os perfis |
| RPC `set_module_for_all(chave, liga)` | ação em massa do painel (só admin) |
| RPC `has_module(chave)` | consulta usada pelo app cliente |

Três módulos iniciais são criados como sugestão — **Simulador 3D**
(`simulador`), **Catálogo de guindastes** (`catalogo`) e **Desenhos CAD**
(`cad`). Renomeie, apague ou crie outros pela aba Módulos. Quem já está
cadastrado recebe todos os módulos padrão, então ninguém perde acesso no dia em
que a migração entra.

Segurança: o usuário final **não consegue** alterar a própria lista de módulos.
O gatilho `protect_profile_access_fields`, que já existe, bloqueia isso no
UPDATE, e no INSERT o novo gatilho descarta qualquer lista enviada pelo usuário.

---

## 2. Módulos que o SimCrane Pro já bloqueia (CADSim, Cinematic, Pórtico)

Rode também `supabase/migrations/0005_simcrane_pro_modules.sql`. Ela cadastra
as três chaves que o SimCrane Pro verifica na barra lateral:

| Chave | Botão no app | Sem cadastro (padrão antigo) | Depois da 0005 |
|---|---|---|---|
| `cadsim` | CADSim | só administradores | ninguém liberado até você ligar |
| `portico` | PÓRTICO | livre para todos | liberado para todos os usuários atuais e novos ("Padrão") |
| `cinematic` | Cinematic | só administradores | ninguém liberado até você ligar |

- Usuário sem o módulo **vê o botão com um cadeado**; ao clicar, aparece o
  aviso "Fora do seu pacote — o módulo X não está incluído no seu pacote" e o
  painel não abre. Administrador sempre tem todos.
- A mudança chega ao app **na hora** (Realtime) ou quando a janela volta ao foco.
- Se um desses módulos for **excluído** do catálogo, o app volta ao padrão antigo
  da tabela acima.
- Na aba **Módulos** do painel, os três aparecem em "Controlados pelo SimCrane
  Pro". Se algum não estiver cadastrado, aparece um card tracejado com
  **+ Cadastrar módulo**. Os demais módulos (ex.: `simulador`, `catalogo`, `cad`)
  ficam em "Outros módulos": o app ainda não verifica essas chaves. A 0005 traz
  uma linha comentada para apagá-los, se quiser.

## 3. Bloquear outros módulos no app SimCrane Pro

O painel só **grava** a permissão. Quem decide se a tela abre é o app cliente.
Use a **chave** do módulo (a que aparece em roxo no card do catálogo):

```js
// Uma chamada por módulo:
const { data: liberado } = await supabase.rpc('has_module', { p_key: 'cad' });
if (!liberado) mostrarBloqueio('Seu plano não inclui Desenhos CAD.');

// Ou a lista inteira de uma vez (ex.: para montar o menu):
const { data: perfil } = await supabase
  .from('profiles')
  .select('modules')
  .eq('id', user.id)
  .single();
const podeAbrir = (chave) => perfil.modules.includes(chave);
```

`has_module` já considera o acesso geral (aprovado e com teste ou licença
válidos). Admin sempre recebe `true`.

Para proteger também os **dados** de um módulo no banco, use `has_module` nas
policies. Exemplo para os desenhos CAD:

```sql
alter policy cad_drawings_select_own on public.cad_drawings
  using ((auth.uid() = owner) and public.has_module('cad'));
```
