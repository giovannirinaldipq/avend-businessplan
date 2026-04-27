# AVEND — Telemetria via Google Apps Script

Backend "serverless" gratuito para receber dados de telemetria do site.
Salva tudo numa planilha Google Sheets, em duas abas: **Sessions** e **Events**.

---

## 🔒 IMPORTANTE — Segurança de tokens

**NUNCA** cole tokens (Telegram, Slack, etc.) direto no `Code.gs` se for commitar.
Este repo é público — qualquer um vê o código.

### ✅ Forma correta: Script Properties

1. No editor do Apps Script, clique na engrenagem **⚙ Project Settings** (esquerda)
2. Role até a seção **"Script Properties"**
3. Clique em **"Add script property"** e adicione cada chave:

   | Property | Valor (exemplo) |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | `123456789:ABC-DEF...` |
   | `TELEGRAM_CHAT_ID` | `987654321` |
   | `DISCORD_WEBHOOK` | `https://discord.com/api/webhooks/...` |
   | `SLACK_WEBHOOK` | `https://hooks.slack.com/services/...` |
   | `GENERIC_WEBHOOK` | `https://hook.us1.make.com/...` |

4. Salve. Os valores ficam **apenas na sua conta** Google (jamais no git).

O `Code.gs` lê esses valores automaticamente via `PropertiesService.getScriptProperties()`.

### ⚠ Se você já commitou um token por engano

1. **Resete o token imediatamente**:
   - Telegram: `@BotFather` → `/mybots` → escolha o bot → API Token → **Revoke**
   - Slack: app settings → regenerate webhook URL
   - Discord: Server Settings → Integrations → delete + recreate webhook
2. Configure o NOVO token via Script Properties (não no código)
3. Republique o deploy

O token antigo no histórico do git fica inválido e inofensivo após o reset.

---

## Como implantar (10 minutos)

### 1. Criar a planilha
- Acesse <https://sheets.new>
- Renomeie para algo como **"AVEND Telemetria"**
- Anote o link/ID

### 2. Colar o script
- Na planilha, vá em **Extensões → Apps Script**
- Apague o código que aparece e **cole o conteúdo de `Code.gs`**
- Em **Project Settings** → defina o nome do projeto: `AVEND Telemetry`
- Salve (Ctrl+S)

### 3. Publicar como Web App
- Clique em **Deploy → New deployment**
- Em **Type**, escolha **Web app** (engrenagem ⚙ no canto)
- Configure:
  - **Description**: `AVEND Telemetry endpoint v1`
  - **Execute as**: `Me (seu@email.com)`
  - **Who has access**: **Anyone** (necessário pra POST sem login)
- Clique em **Deploy**
- Autorize o app na primeira vez (Google vai pedir permissões pra Sheets)
- **Copie a URL** que aparece (algo como `https://script.google.com/macros/s/AKfy.../exec`)

### 4. Conectar o site
No arquivo `app.js`, procure a linha:
```js
const TELEMETRY_ENDPOINT = ""; // ex: "https://script.google.com/..."
```

Substitua pela URL do passo 3:
```js
const TELEMETRY_ENDPOINT = "https://script.google.com/macros/s/AKfy.../exec";
```

Faça commit e push. O GitHub Pages atualiza em ~1 minuto.

### 5. Validar
- Abra o site num navegador anônimo (pra criar uma sessão nova)
- Mexa em alguns sliders, abra o quiz, responda
- Volte na sua planilha — duas abas devem ter sido criadas (**Sessions** e **Events**) com dados.

---

## O que cada aba registra

### Sessions
Uma linha por visita única. Atualizada a cada 30 segundos enquanto o visitante
está na página + snapshot final no `beforeunload`.

| Coluna | Descrição |
|---|---|
| `session_id` | ID único da sessão (`s_xxxxxx_xxxxx`) |
| `started_at` | Timestamp de entrada |
| `last_seen` | Última atividade detectada |
| `total_time_min` | Tempo total na página em minutos |
| `visitor_id` | ID externo (se vier via `?id=...` na URL) |
| `visitor_name`, `visitor_email`, `visitor_phone`, `visitor_city` | Dados do quiz ou querystring |
| `quiz_completed` | `yes` / `no` |
| `profile` | Perfil identificado (conservador / base / otimista / turbo) |
| `tabs_visited` | Tempo por aba (`overview:120s, simulador:340s, ...`) |
| `presets_clicked` | Quais presets foram usados (`base×2, turbo×1`) |
| `sliders_changed` | Quais sliders mexeu |
| `user_agent` | Browser do visitante |
| `referrer` | De onde veio |
| `raw_json` | JSON completo (backup) |

### Events
Uma linha por evento (granular). Útil pra timeline de comportamento.

| Coluna | Descrição |
|---|---|
| `session_id` | Liga ao registro de Sessions |
| `ts_offset_ms` | Tempo desde o início da sessão (ms) |
| `event_type` | `tab_view`, `quiz_answered`, `preset_clicked`, etc. |
| `data_json` | Payload do evento |
| `visitor_name`, `visitor_email` | Pra filtros rápidos |
| `received_at` | Quando o servidor recebeu |

---

## Como mandar o link pro investidor já com dados

Se você já tem nome/email/telefone/cidade no seu CRM, mande o link com a
querystring:

```
https://giovannirinaldipq.github.io/avend-businessplan/?id=12345&name=João%20Silva&email=joao@empresa.com&phone=11999998888&city=São%20Paulo/SP
```

Parâmetros aceitos: `id`, `name` (ou `nome`), `email`, `phone` (ou `tel`), `city` (ou `cidade`).

A telemetria captura automaticamente. Se ele depois preencher o quiz, os
dados do quiz **complementam** os já fornecidos via querystring.

---

## Funções úteis no Apps Script

### Resumo manual
No editor do Apps Script, você pode rodar `generateSummary()` para ver no log:
```
Total: 23 | Quiz completed: 12 | Avg time: 4.7 min
```

### Atualizar deploy depois de mudanças
1. Edite `Code.gs`
2. Salve
3. **Deploy → Manage deployments**
4. Edite o deploy ativo (ícone de lápis ✏️) → **New version** → Deploy
5. **A URL não muda** — não precisa atualizar o `app.js`

---

## Limitações importantes

- **Quota Apps Script**: 20.000 execuções/dia para usuários gratuitos. Cada
  visitante consome ~10–30 execuções (heartbeats + eventos). Comporta facilmente
  500–1.000 visitantes/dia.
- **CORS**: usamos `Content-Type: text/plain` + `mode: no-cors` para evitar
  preflight. Por isso não conseguimos ler a resposta no front (só fire-and-forget).
- **Privacy**: dados pessoais ficam na sua conta Google. **Não há compartilhamento
  com terceiros**. A telemetria é declarada no banner LGPD do quiz.
- **Backup**: a planilha é a fonte de verdade. Faça backup periódico (Ficheiro →
  Fazer uma cópia).

---

---

## 🚨 Notificação de Lead Quente (configurar webhook)

O `Code.gs` já vem com **detecção automática de lead quente** e notificação
em tempo real via webhook. Sempre que um visitante:

- **Completar o quiz** com perfil `otimista` ou `turbo`
  **E** tiver fornecido nome/email/telefone, OU
- **Ficar mais de 5 minutos** na página com algum dado de contato

… você recebe uma notificação no canal que escolher. Só notifica **1 vez por
sessão** (anti-spam). Os leads também ficam registrados na aba **Hot Leads**
da planilha pra você acompanhar.

### Opções de canal (escolha 1 ou mais)

#### Opção A · Discord (mais bonito visualmente)
1. No seu servidor: **Server Settings → Integrations → Webhooks → New Webhook**
2. Escolha o canal, copie a URL
3. No `Code.gs`, cole em `DISCORD_WEBHOOK`
4. Salvar + redeploy

#### Opção B · Slack
1. <https://api.slack.com/apps> → Create New App → From scratch
2. Add features → Incoming Webhooks → Activate → Add to Workspace
3. Copie a URL `https://hooks.slack.com/services/...`
4. Cole em `SLACK_WEBHOOK`

#### Opção C · Telegram (recomendado pra mobile / WhatsApp-like)
1. No Telegram, fale com **@BotFather** → `/newbot` → siga as instruções
2. Copie o **token** que ele dá (`123456789:ABC-DEF...`) → cole em `TELEGRAM_BOT_TOKEN`
3. Pra pegar seu chat ID: fale com **@userinfobot** ou **@get_id_bot** no Telegram
4. Cole o ID em `TELEGRAM_CHAT_ID` (pode ser seu próprio user ou um grupo onde adicionou o bot)
5. **Importante:** mande pelo menos uma mensagem ao seu bot antes do primeiro disparo (senão o Telegram bloqueia)

#### Opção D · Webhook genérico (Make/Zapier/n8n/CallMeBot WhatsApp)
1. Configure um cenário em qualquer plataforma de automação
2. Pegue a URL pública do webhook
3. Cole em `GENERIC_WEBHOOK`
4. O payload chega como JSON com `type: "hot_lead"` + todos os dados

#### 🎁 BÔNUS: WhatsApp via CallMeBot (gratuito)
1. Salve o número **+34 644 51 95 23** nos contatos como "CallMeBot"
2. No WhatsApp, mande **"I allow callmebot to send me messages"** pra esse número
3. Você recebe um `apikey` no retorno
4. Use como `GENERIC_WEBHOOK`:
   ```
   https://api.callmebot.com/whatsapp.php?phone=SEUNUMERO&apikey=SEUAPIKEY&text=
   ```
   *(o site vai fazer URL-encode da mensagem automaticamente — funciona com mensagens curtas)*

### Testar antes de ir pra produção

No editor do Apps Script, com tudo configurado:

1. Selecione a função `testHotLeadWebhook` no dropdown
2. Clique em **Run**
3. Você deve receber a notificação em ~5 segundos no canal configurado
4. Uma linha de teste aparece em **Hot Leads** sheet

### Critérios e ajustes

No topo do `Code.gs`:
```js
const HOT_PROFILES = ["otimista", "turbo"];   // perfis considerados quentes
const HOT_TIME_THRESHOLD_MIN = 5;             // OU >= 5min com contato
```

Mude conforme sua estratégia. Pra ser mais agressivo, adicione `"base"` em
`HOT_PROFILES` ou reduza o threshold de tempo.

### Re-notificar leads antigos
Se quiser reenviar notificação de uma sessão (ex.: depois de configurar o webhook
pela primeira vez), rode `clearHotLeadFlags()` no editor → limpa os marcadores
"já notificado" e o próximo POST do mesmo visitante dispara novamente.

---

## Próximas evoluções sugeridas

- [ ] Dashboard nativo no Sheets com gráficos (segmentação por perfil, conversão)
- [x] ~~Webhook pro WhatsApp/Slack quando perfil arrojado/turbo completar quiz~~ ✅
- [ ] Funil: visitas → quiz aberto → quiz completo → plano aplicado
- [ ] Heatmap de cliques (`mousemove` agregado)
- [ ] A/B test da copy do hero
