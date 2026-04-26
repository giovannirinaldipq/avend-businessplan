# AVEND — Telemetria via Google Apps Script

Backend "serverless" gratuito para receber dados de telemetria do site.
Salva tudo numa planilha Google Sheets, em duas abas: **Sessions** e **Events**.

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

## Próximas evoluções sugeridas

- [ ] Dashboard nativo no Sheets com gráficos (segmentação por perfil, conversão)
- [ ] Webhook pro WhatsApp/Slack quando perfil **arrojado/turbo** completar quiz
- [ ] Funil: visitas → quiz aberto → quiz completo → plano aplicado
- [ ] Heatmap de cliques (`mousemove` agregado)
- [ ] A/B test da copy do hero
