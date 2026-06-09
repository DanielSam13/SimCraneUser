# Auto-aprovação + Notificações (app fechado) + Presença (online / horas)

Este guia ativa **três** coisas que o painel passou a suportar:

0. **Auto-aprovação do período de teste** — todo novo cadastro já entra com o
   teste **ativo**, sem precisar da aprovação manual do admin (a edição continua
   toda disponível no painel).
1. **Web Push** — receber notificação de novo usuário mesmo com o app **fechado**.
2. **Presença** — ver quem está **online agora**, o **último acesso** e o **tempo total de uso** de cada usuário.

> O código do painel já está pronto. Falta só a configuração no **Supabase** e
> (para as horas) chamar 2 funções no **app cliente do SimCrane**.

---

## 0. Rodar o SQL da auto-aprovação

Supabase → **SQL Editor** → cole e rode o arquivo:
`supabase/migrations/0002_auto_approve_trial.sql`

Isso cria um **trigger** (`BEFORE INSERT` em `profiles`) que, para todo novo
usuário (exceto admin):
- marca `approved = true`;
- inicia `trial_started_at` e define `trial_ends_at = agora + 14 dias`.

Como é um trigger no banco, funciona qualquer que seja o app que crie o perfil
— o painel não precisa de nenhuma mudança. O painel continua permitindo
**bloquear**, **estender (+14d)**, **licenciar** e **excluir** normalmente.

> O script também aprova de uma vez os usuários que já estavam **pendentes**
> antes dele. Se preferir tratar os antigos manualmente, comente o `UPDATE`
> no fim do arquivo antes de rodar.

---

## 1. Rodar o SQL da presença

Supabase → **SQL Editor** → cole e rode o arquivo:
`supabase/migrations/0001_presence_and_push.sql`

Isso cria:
- colunas `last_login_at`, `last_seen_at`, `total_online_seconds` em `profiles`;
- as funções `record_login()` e `record_heartbeat(p_delta)`;
- a tabela `push_subscriptions` com RLS.

---

## 2. Habilitar o Realtime da tabela `profiles`

Supabase → **Database → Replication** → publicação `supabase_realtime` → marque a
tabela **`profiles`**.

> Sem isso o aviso **instantâneo** (com o app aberto) não dispara. Esta era a
> causa nº 1 do "não avisa".

---

## 3. Web Push (notificação com o app fechado)

### 3.1 Gerar as chaves VAPID
```bash
npx web-push generate-vapid-keys
```
Guarde a **Public Key** e a **Private Key**.

### 3.2 Colar a chave pública no painel
Em `app.js`, preencha:
```js
const VAPID_PUBLIC_KEY = 'COLE_AQUI_A_PUBLIC_KEY';
```

### 3.3 Deploy da Edge Function
```bash
supabase functions deploy notify-new-user

supabase secrets set VAPID_PUBLIC_KEY="...public..."
supabase secrets set VAPID_PRIVATE_KEY="...private..."
supabase secrets set VAPID_SUBJECT="mailto:seu-email@dominio.com"
```
(`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente da função.)

### 3.4 Criar o Database Webhook
Supabase → **Database → Webhooks** → **Create a new hook**:
- **Table:** `profiles`
- **Events:** `INSERT`
- **Type:** Supabase Edge Function → `notify-new-user`

Pronto. Quando um novo usuário se cadastrar, a função envia o push para todos
os admins que abriram o painel e concederam permissão de notificação.

> **iPhone/iPad:** o push só funciona com o painel **instalado na tela inicial**
> (Compartilhar → "Adicionar à Tela de Início") e iOS **16.4+**. No navegador
> comum do iOS o push não é entregue — isso é limitação da Apple, não do app.

---

## 4. Presença (online / horas) — chamadas no APP CLIENTE

> ### Por que "ainda não informa quem está logado / o tempo de uso"?
> O painel só sabe mostrar a presença — ele **não grava** o login/tempo dos
> usuários finais. Quem grava é o **app cliente do SimCrane**. Então, se a
> presença não aparece, é por um destes dois motivos:
>
> 1. **O SQL do passo 1 não foi rodado** → as colunas/funções não existem e
>    nem a sua própria linha de admin fica "Online" (o painel chama
>    `record_login`/`record_heartbeat` para o admin, mas a chamada falha em
>    silêncio). **Teste:** após rodar o passo 1, recarregue o painel — a sua
>    linha de admin deve passar a mostrar 🟢 *Online agora*.
> 2. **O app cliente não chama as RPCs** → os demais usuários nunca gravam
>    `last_seen_at`/`total_online_seconds`, então aparecem como *"Nunca
>    acessou"*. A correção é o trecho abaixo, no app que o usuário final usa.

O painel **exibe** a presença, mas quem **grava** os dados é o app que o usuário
final usa (o SimCrane). Adicione lá, usando o mesmo cliente Supabase já
autenticado:

```js
// 1) Uma vez, logo após o login do usuário:
await supabase.rpc('record_login');

// 2) Heartbeat enquanto o app estiver aberto/ativo (a cada 60s):
const HEARTBEAT_MS = 60_000;
setInterval(() => {
  if (document.visibilityState === 'visible') {
    supabase.rpc('record_heartbeat', { p_delta: 60 });
  }
}, HEARTBEAT_MS);
```

Com isso, no painel cada usuário passa a mostrar:
- 🟢 **Online agora** (visto nos últimos 2 min) ou **"Visto há X"**;
- **⏱️ tempo total de uso** (soma dos heartbeats);
- **Último login** (no tooltip da linha de atividade).

> Ajuste o `p_delta` se mudar o intervalo do heartbeat (ele = nº de segundos
> desde o último heartbeat). A função limita valores absurdos a 60s.

---

## Resumo do que cada parte resolve

| Sintoma | Causa | Onde resolve |
|---|---|---|
| Novo usuário fica "Acesso Pendente" | exigia aprovação manual | Passo 0 (auto-aprovação) |
| Não avisa novo usuário (app aberto) | Realtime de `profiles` desligado | Passo 2 |
| Notificação não aparece no Android | usava `new Notification()` | já corrigido (usa `showNotification`) |
| Nada chega com app fechado | sem Web Push | Passos 1 e 3 |
| Não mostra quem está logado | SQL não rodado **ou** app cliente sem RPC | Passos 1 e 4 |
| Não mostra horas de uso | app cliente não chama `record_heartbeat` | Passos 1 e 4 |
