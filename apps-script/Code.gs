/**
 * AVEND Business Plan — Endpoint de Telemetria
 * --------------------------------------------------
 * Recebe POSTs do front (telemetria de sessões + quiz answers).
 * Persiste em Google Sheets numa tab "Sessions" e numa tab "Events".
 *
 * COMO IMPLANTAR:
 *  1. Crie uma planilha Google nova
 *  2. Extensions → Apps Script
 *  3. Cole este arquivo em Code.gs
 *  4. Salve, depois clique em "Deploy" → "New deployment"
 *  5. Type: "Web app"
 *     - Description: "AVEND Telemetry endpoint"
 *     - Execute as: "Me"
 *     - Who has access: "Anyone"  (necessário pra POST sem login)
 *  6. Copie a URL do Web app (algo como https://script.google.com/.../exec)
 *  7. No app.js do AVEND, ajuste:
 *       const TELEMETRY_ENDPOINT = "https://script.google.com/.../exec";
 *
 * AVISOS:
 *  - Apps Script Web Apps não suportam CORS preflight (OPTIONS) com headers
 *    custom. Por isso usamos POST sem custom headers + Content-Type text/plain
 *    e o body como JSON string. doPost(e) parseia e.postData.contents.
 *  - Quando o front usa navigator.sendBeacon, o tipo é text/plain por padrão.
 */

const SHEET_NAME_SESSIONS = "Sessions";
const SHEET_NAME_EVENTS   = "Events";
const SHEET_NAME_LEADS    = "Hot Leads";

/* ============================================================
   NOTIFICAÇÃO DE LEAD QUENTE
   Configure UM dos webhooks abaixo. Deixe em branco os que não usa.
   Quando um investidor com perfil OTIMISTA ou TURBO completar o quiz
   E tiver fornecido nome OU email OU telefone, dispara notificação.
   ============================================================ */

/* >>> SEGURANÇA: tokens NUNCA devem ficar hardcoded neste arquivo <<<
   Use Script Properties (Project Settings → Script Properties).
   Para configurar:
     1. No editor: ⚙ Project Settings (engrenagem na esquerda)
     2. Role até "Script Properties"
     3. Clique "Add script property" e adicione cada par chave/valor:
        - DISCORD_WEBHOOK
        - SLACK_WEBHOOK
        - TELEGRAM_BOT_TOKEN
        - TELEGRAM_CHAT_ID
        - GENERIC_WEBHOOK
     4. Salve. As propriedades ficam só na sua conta (nunca no git).

   Alternativa rápida pra setup inicial: rode setupWebhookProperties()
   uma vez no editor (depois de preencher os valores nessa função).
*/
const _PROPS = PropertiesService.getScriptProperties();
const DISCORD_WEBHOOK    = _PROPS.getProperty("DISCORD_WEBHOOK")    || "";
const SLACK_WEBHOOK      = _PROPS.getProperty("SLACK_WEBHOOK")      || "";
const TELEGRAM_BOT_TOKEN = _PROPS.getProperty("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_CHAT_ID   = _PROPS.getProperty("TELEGRAM_CHAT_ID")   || "";
const GENERIC_WEBHOOK    = _PROPS.getProperty("GENERIC_WEBHOOK")    || "";

/* Helper: setup inicial das propriedades.
   PREENCHA os valores ABAIXO TEMPORARIAMENTE, rode 1 vez, depois VOLTE
   PRA STRINGS VAZIAS antes de qualquer commit. */
function setupWebhookProperties() {
  const props = PropertiesService.getScriptProperties();
  const config = {
    // DISCORD_WEBHOOK:    "",
    // SLACK_WEBHOOK:      "",
    // TELEGRAM_BOT_TOKEN: "",
    // TELEGRAM_CHAT_ID:   "",
    // GENERIC_WEBHOOK:    ""
  };
  Object.entries(config).forEach(([k, v]) => { if (v) props.setProperty(k, v); });
  Logger.log("Properties saved. Configured keys: " + Object.keys(config).filter(k => config[k]).join(", "));
  Logger.log("⚠ APAGUE OS VALORES desta função antes de commitar!");
}

// Critérios — perfis quentes (modificável)
const HOT_PROFILES = ["otimista", "turbo"];
// Considera lead quente também se o tempo na página for >= X minutos (mesmo sem perfil)
const HOT_TIME_THRESHOLD_MIN = 5;

// Colunas da aba Sessions
const SESSION_HEADERS = [
  "session_id", "started_at", "last_seen", "total_time_min",
  "visitor_id", "visitor_name", "visitor_email", "visitor_phone", "visitor_city",
  "quiz_completed", "profile", "score",
  "tabs_visited", "presets_clicked", "sliders_changed",
  "user_agent", "referrer", "raw_json"
];

// Colunas da aba Events
const EVENT_HEADERS = [
  "session_id", "ts_offset_ms", "event_type", "data_json",
  "visitor_name", "visitor_email", "received_at"
];

function doPost(e) {
  try {
    // Proteção contra Run manual do editor (e === undefined)
    if (!e || !e.postData) {
      Logger.log("doPost called without event/postData. " +
        "Se você clicou 'Run' no editor, isso é esperado — testes só funcionam via runTest_doPost().");
      return jsonResponse_({ ok: false, error: "no postData (chamada manual? use runTest_doPost)" });
    }

    const body = e.postData.contents || "{}";
    Logger.log("doPost received: " + body.slice(0, 200) + (body.length > 200 ? "..." : ""));

    const payload = JSON.parse(body);

    if (payload.type === "session") {
      saveSession_(payload.session);
      maybeNotifyHotLead_(payload.session);
      Logger.log("✓ Session saved: " + (payload.session && payload.session.sessionId));
      return jsonResponse_({ ok: true, type: "session", id: payload.session && payload.session.sessionId });
    }

    if (payload.type === "event") {
      saveEvent_(payload.session_id, payload.event, payload.visitor || {});
      maybeNotifySpecialEvent_(payload.session_id, payload.event, payload.visitor || {});
      Logger.log("✓ Event saved: " + (payload.event && payload.event.type));
      return jsonResponse_({ ok: true, type: "event", evt: payload.event && payload.event.type });
    }

    Logger.log("Unknown payload.type: " + payload.type);
    return jsonResponse_({ ok: false, error: "unknown payload.type", got: payload.type });
  } catch (err) {
    Logger.log("doPost error: " + err);
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  // Healthcheck — abra a URL do Web App no browser pra ver isso
  return jsonResponse_({
    ok: true,
    service: "avend-telemetry",
    version: "1.1",
    sheetsConnected: !!SpreadsheetApp.getActiveSpreadsheet(),
    timestamp: new Date().toISOString()
  });
}

/* ============================================================
   TESTE MANUAL — rode esta função (não doPost) no editor
   ============================================================ */
function runTest_doPost() {
  // Simula uma chamada de session real
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        type: "session",
        session: {
          sessionId: "s_test_manual_" + Date.now(),
          startedAt: Date.now() - 120000,
          lastSeen: Date.now(),
          totalTimeMs: 120000,
          visitorName: "Teste Manual",
          visitorEmail: "teste@avend.com",
          visitorPhone: "11999999999",
          visitorCity: "São Paulo / SP",
          quizCompleted: true,
          profile: "base",
          tabTime: { overview: 60000, simulador: 60000 },
          interactions: { sliders: { faturamentoPorMaquina: { changes: 2 } }, presets: {} },
          events: [],
          userAgent: "Manual Test",
          referrer: ""
        }
      })
    }
  };
  const result = doPost(fakeEvent);
  Logger.log("Result: " + result.getContent());
  Logger.log("Verifique a aba 'Sessions' da planilha — deve ter uma linha nova com 'Teste Manual'.");
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- SHEET helpers ---------- */
function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sheet;
}

/* ---------- Save session ----------
   Usa LockService pra evitar race condition: requests concorrentes da
   mesma sessão (heartbeat + visibility change + critical event chegando
   simultâneos) podiam causar 2 linhas pra mesma sessionId em vez de
   atualizar a existente. */
function saveSession_(s) {
  if (!s || !s.sessionId) return;

  const lock = LockService.getScriptLock();
  try {
    // Espera até 10s pra adquirir o lock
    lock.waitLock(10000);
  } catch (e) {
    Logger.log("saveSession_ couldn't acquire lock: " + e);
    return;
  }

  try {
    saveSessionLocked_(s);
  } finally {
    lock.releaseLock();
  }
}

function saveSessionLocked_(s) {
  const sheet = getSheet_(SHEET_NAME_SESSIONS, SESSION_HEADERS);
  const data = sheet.getDataRange().getValues();
  let rowIdx = -1;

  // Procura linha existente desta session
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === s.sessionId) { rowIdx = i + 1; break; }
  }

  const startedAt = s.startedAt ? new Date(s.startedAt) : new Date();
  const lastSeen  = s.lastSeen  ? new Date(s.lastSeen)  : new Date();
  const totalMin  = s.totalTimeMs ? (s.totalTimeMs / 60000).toFixed(2) : "";

  const tabsVisited = s.tabTime ? Object.keys(s.tabTime).map(k =>
    `${k}:${(s.tabTime[k] / 1000).toFixed(0)}s`).join(", ") : "";

  const presets = s.interactions && s.interactions.presets
    ? Object.entries(s.interactions.presets).map(([k, v]) => `${k}×${v}`).join(", ")
    : "";

  const sliders = s.interactions && s.interactions.sliders
    ? Object.keys(s.interactions.sliders).join(", ")
    : "";

  const row = [
    s.sessionId,
    startedAt,
    lastSeen,
    totalMin,
    s.visitorId  || "",
    s.visitorName  || "",
    s.visitorEmail || "",
    s.visitorPhone || "",
    s.visitorCity  || "",
    s.quizCompleted ? "yes" : "no",
    s.profile || "",
    computeLeadScore_(s),    // 0-10
    tabsVisited,
    presets,
    sliders,
    s.userAgent || "",
    s.referrer  || "",
    JSON.stringify(s)
  ];

  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

/* ---------- Save event ---------- */
function saveEvent_(sessionId, evt, visitor) {
  if (!sessionId || !evt) return;
  const sheet = getSheet_(SHEET_NAME_EVENTS, EVENT_HEADERS);
  sheet.appendRow([
    sessionId,
    evt.t || 0,
    evt.type || "unknown",
    JSON.stringify(evt.data || {}),
    visitor.name  || "",
    visitor.email || "",
    new Date()
  ]);
}

/* ---------- Manual: gerar resumo ---------- */
function generateSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessions = ss.getSheetByName(SHEET_NAME_SESSIONS);
  if (!sessions) { Logger.log("No sessions yet"); return; }
  const data = sessions.getDataRange().getValues();
  const total = data.length - 1;
  const completed = data.filter((r, i) => i > 0 && r[9] === "yes").length;
  const avgMin = data.slice(1).reduce((s, r) => s + (parseFloat(r[3]) || 0), 0) / Math.max(1, total);
  Logger.log(`Total: ${total} | Quiz completed: ${completed} | Avg time: ${avgMin.toFixed(1)} min`);
}

/* ============================================================
   HOT LEAD — detecção e notificação
   ============================================================ */

const HOT_LEAD_FLAG_PROP = "hot_lead_notified_";

function maybeNotifyHotLead_(s) {
  if (!s || !s.sessionId) return;

  // Critérios: precisa ter contato + (perfil quente OU tempo alto)
  const hasContact = !!(s.visitorName || s.visitorEmail || s.visitorPhone);
  if (!hasContact) return;

  // Ignore list — não notifica visitas internas (Giovanni, equipe)
  if (isIgnoredVisitor_({ name: s.visitorName, email: s.visitorEmail, phone: s.visitorPhone })) {
    Logger.log("HotLead ignored (in IGNORE_LIST): " + (s.visitorEmail || s.visitorPhone || s.visitorName));
    return;
  }

  const minutes = (s.totalTimeMs || 0) / 60000;
  const profileHot = s.profile && HOT_PROFILES.indexOf(s.profile) !== -1;
  const timeHot    = minutes >= HOT_TIME_THRESHOLD_MIN;
  const quizDone   = !!s.quizCompleted;

  // Só notifica se completou quiz E perfil quente, OU se ficou muito tempo
  const shouldNotify = (quizDone && profileHot) || (timeHot && hasContact);
  if (!shouldNotify) return;

  // Anti-duplicata: só notifica 1x por sessão
  const props = PropertiesService.getScriptProperties();
  const flagKey = HOT_LEAD_FLAG_PROP + s.sessionId;
  if (props.getProperty(flagKey)) return;
  props.setProperty(flagKey, "1");

  // Registra no sheet de leads
  saveHotLead_(s);

  // Dispara nos webhooks configurados
  const summary = buildLeadSummary_(s);
  if (DISCORD_WEBHOOK)  sendDiscord_(summary);
  if (SLACK_WEBHOOK)    sendSlack_(summary);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) sendTelegram_(summary);
  if (GENERIC_WEBHOOK)  sendGeneric_(summary, s);
}

/* Score de qualidade do lead (0-10) — pondera contato + quiz + perfil + tempo + interação */
function computeLeadScore_(s) {
  let score = 0;

  // Contato (até 3 pontos)
  if (s.visitorName)  score += 0.5;
  if (s.visitorEmail) score += 1.0;
  if (s.visitorPhone) score += 1.5; // telefone vale mais — usuário se comprometeu

  // Quiz completo (até 2 pontos)
  if (s.quizCompleted) score += 2;

  // Perfil identificado (até 2.5 pontos)
  if (s.profile === "turbo")          score += 2.5;
  else if (s.profile === "otimista")  score += 2.0;
  else if (s.profile === "base")      score += 1.0;
  else if (s.profile === "conservador") score += 0.5;

  // Tempo na página (até 1.5 pontos): 1pt aos 5min, 1.5pt aos 15min+
  const min = (s.totalTimeMs || 0) / 60000;
  if (min >= 15)      score += 1.5;
  else if (min >= 5)  score += 1.0;
  else if (min >= 2)  score += 0.5;

  // Interação (até 1 ponto)
  const slidersUsed = Object.keys((s.interactions || {}).sliders || {}).length;
  const presetsUsed = Object.keys((s.interactions || {}).presets || {}).length;
  if (slidersUsed >= 3 || presetsUsed >= 1) score += 1.0;
  else if (slidersUsed >= 1) score += 0.5;

  // Cap 10
  return Math.min(10, Math.round(score * 10) / 10);
}

function scoreEmoji_(score) {
  if (score >= 9) return "🔥🔥🔥";
  if (score >= 7) return "🔥🔥";
  if (score >= 5) return "🔥";
  if (score >= 3) return "♨️";
  return "❄️";
}

function buildLeadSummary_(s) {
  const minutes = ((s.totalTimeMs || 0) / 60000).toFixed(1);
  const profile = (s.profile || "—").toUpperCase();
  const profileEmoji = {
    "TURBO": "⚡", "OTIMISTA": "🚀", "BASE": "⚖️", "CONSERVADOR": "🌱"
  }[profile] || "👤";

  const score = computeLeadScore_(s);
  const heat = scoreEmoji_(score);

  const contact = [];
  if (s.visitorName)  contact.push("👤 " + s.visitorName);
  if (s.visitorEmail) contact.push("📧 " + s.visitorEmail);
  if (s.visitorPhone) {
    // Formata link clicável de WhatsApp
    const phoneDigits = String(s.visitorPhone).replace(/\D/g, "");
    contact.push("📱 " + s.visitorPhone + (phoneDigits.length >= 10 ? ` · wa.me/55${phoneDigits.replace(/^55/, "")}` : ""));
  }
  if (s.visitorCity)  contact.push("📍 " + s.visitorCity);

  // Quiz answers — mapeamento de valores curtos pra texto legível
  const ANSWER_LABELS = {
    objetivo: {
      "renda-extra": "Renda extra", "sair-clt": "Sair da CLT",
      "viver-disso": "Viver disso integralmente", "patrimonio": "Construir patrimônio"
    },
    capital: {
      "so-1a": "Só a 1ª máquina (R$ 55k)", "50-100": "R$ 50-100k adicionais",
      "100-300": "R$ 100-300k adicionais", "300+": "Acima de R$ 300k"
    },
    reinvest: {
      "preciso-tirar": "Precisa tirar pra viver", "meio-meio": "Reinveste 70-80%",
      "reinvesto-tudo": "Reinveste 100%"
    },
    meta: {
      "ate-15k": "R$ 5-15k/mês", "15-50k": "R$ 15-50k/mês",
      "50-150k": "R$ 50-150k/mês", "150+": "Acima de R$ 150k/mês"
    },
    horizonte: { "3":"3 anos", "5":"5 anos", "7":"7 anos", "10":"10 anos" },
    dedicacao: {
      "horas-semana":"Algumas horas/semana", "meio-periodo":"Meio período",
      "integral":"Tempo integral"
    },
    risco: { "conservador":"Conservador", "equilibrado":"Equilibrado", "arrojado":"Arrojado" },
    atividade: {
      "clt":"CLT", "autonomo":"Autônomo/freelancer", "empresario":"Empresário/sócio",
      "aposentado":"Aposentado", "transicao":"Em transição"
    },
    experiencia: {
      "primeira":"Primeira vez", "ja-tive":"Já teve negócio",
      "ja-franquia":"Já teve franquia", "investidor":"Investidor"
    }
  };

  let answersText = "";
  if (s.events && s.events.length) {
    const answers = s.events.filter(e => e.type === "quiz_answered");
    if (answers.length) {
      const map = {};
      answers.forEach(a => { map[a.data.q] = a.data.value; });
      const lines = [];
      const ORDER = ["atividade", "experiencia", "objetivo", "capital", "reinvest", "meta", "horizonte", "dedicacao", "risco"];
      ORDER.forEach(q => {
        if (map[q]) {
          const label = (ANSWER_LABELS[q] && ANSWER_LABELS[q][map[q]]) || map[q];
          lines.push(`• *${q.charAt(0).toUpperCase()+q.slice(1)}:* ${label}`);
        }
      });
      answersText = "\n📝 *Respostas:*\n" + lines.join("\n");
    }
  }

  // Tabs visitadas (top 3 por tempo)
  let tabs = "—";
  if (s.tabTime) {
    const sorted = Object.entries(s.tabTime)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} (${(v/1000).toFixed(0)}s)`);
    if (sorted.length) tabs = sorted.join(", ");
  }

  const slidersUsed = Object.keys((s.interactions || {}).sliders || {}).length;
  const presetsUsed = Object.keys((s.interactions || {}).presets || {}).length;

  return {
    title: `${heat} LEAD ${score}/10 · ${profileEmoji} ${profile}`,
    score: score,
    heat: heat,
    contactBlock: contact.join("\n"),
    profileEmoji,
    profile,
    minutes,
    sliders: slidersUsed,
    presets: presetsUsed,
    tabs,
    answersText,
    sessionId: s.sessionId,
    rawSession: s
  };
}

function saveHotLead_(s) {
  const headers = [
    "received_at", "session_id", "name", "email", "phone", "city",
    "profile", "time_min", "user_agent", "referrer"
  ];
  const sheet = getSheet_(SHEET_NAME_LEADS, headers);
  sheet.appendRow([
    new Date(),
    s.sessionId,
    s.visitorName || "",
    s.visitorEmail || "",
    s.visitorPhone || "",
    s.visitorCity || "",
    s.profile || "",
    ((s.totalTimeMs || 0) / 60000).toFixed(1),
    s.userAgent || "",
    s.referrer || ""
  ]);
}

/* ---------- Senders ---------- */

function sendDiscord_(d) {
  try {
    const fields = [];
    if (d.contactBlock) fields.push({ name: "Contato", value: "```\n" + d.contactBlock + "\n```", inline: false });
    fields.push({ name: "Perfil", value: d.profileEmoji + " " + d.profile, inline: true });
    fields.push({ name: "Tempo na página", value: d.minutes + " min", inline: true });
    fields.push({ name: "Sliders mexidos", value: String(d.sliders), inline: true });
    if (d.tabs) fields.push({ name: "Abas visitadas", value: d.tabs, inline: false });
    if (d.answersText) fields.push({ name: "Respostas-chave", value: d.answersText.replace("*Respostas:*\n", ""), inline: false });

    const payload = {
      username: "AVEND Lead Bot",
      embeds: [{
        title: d.title,
        color: 0xffb020, // amber
        fields: fields,
        footer: { text: "Session: " + d.sessionId },
        timestamp: new Date().toISOString()
      }]
    };
    UrlFetchApp.fetch(DISCORD_WEBHOOK, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log("Discord webhook error: " + err); }
}

function sendSlack_(d) {
  try {
    const text =
      `*${d.title}*\n` +
      `${d.contactBlock}\n\n` +
      `*Perfil:* ${d.profileEmoji} ${d.profile} · *Tempo:* ${d.minutes} min · *Sliders:* ${d.sliders}\n` +
      `*Abas:* ${d.tabs}` +
      d.answersText;
    UrlFetchApp.fetch(SLACK_WEBHOOK, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text }),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log("Slack webhook error: " + err); }
}

function sendTelegram_(d) {
  try {
    // Mensagem usa MarkdownV2 simulado via escape — aqui usamos Markdown legacy
    // que é mais permissivo. Estrutura otimizada pra leitura no celular.
    const lines = [];
    lines.push(`*${d.title}*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);

    if (d.contactBlock) {
      lines.push("");
      lines.push("👋 *Contato:*");
      lines.push(d.contactBlock);
    }

    lines.push("");
    lines.push("📊 *Engajamento:*");
    lines.push(`• Perfil: ${d.profileEmoji} ${d.profile}`);
    lines.push(`• Tempo na página: *${d.minutes} min*`);
    lines.push(`• Sliders mexidos: ${d.sliders}`);
    if (d.presets > 0) lines.push(`• Presets clicados: ${d.presets}`);
    lines.push(`• Abas top 3: ${d.tabs}`);

    if (d.answersText) {
      lines.push(d.answersText);
    }

    lines.push("");
    lines.push(`_Score AVEND: ${d.score}/10_ · _session ${d.sessionId.slice(0, 16)}…_`);

    const text = lines.join("\n");

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const r = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) {
      Logger.log("Telegram FALHOU (status " + r.getResponseCode() + "): " + r.getContentText().slice(0, 300));
    }
  } catch (err) { Logger.log("Telegram webhook error: " + err); }
}

function escapeMarkdown_(s) {
  return String(s || "").replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function sendGeneric_(d, session) {
  try {
    UrlFetchApp.fetch(GENERIC_WEBHOOK, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        type: "hot_lead",
        title: d.title,
        profile: d.profile,
        profile_emoji: d.profileEmoji,
        minutes: parseFloat(d.minutes),
        sliders: d.sliders,
        tabs: d.tabs,
        contact: {
          name: session.visitorName,
          email: session.visitorEmail,
          phone: session.visitorPhone,
          city: session.visitorCity,
          id: session.visitorId
        },
        session_id: d.sessionId,
        raw: session
      }),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log("Generic webhook error: " + err); }
}

/* Útil pra teste manual: dispara webhook com dados fake e LOGA cada tentativa */
function testHotLeadWebhook() {
  Logger.log("=== AVEND TELEMETRY · TESTE DE WEBHOOK ===");

  // 1. Diagnóstico de configuração
  Logger.log("\n--- Configuração detectada ---");
  Logger.log("DISCORD_WEBHOOK:    " + (DISCORD_WEBHOOK ? "✓ configurado (" + DISCORD_WEBHOOK.slice(0, 50) + "...)" : "✗ vazio"));
  Logger.log("SLACK_WEBHOOK:      " + (SLACK_WEBHOOK ? "✓ configurado" : "✗ vazio"));
  Logger.log("TELEGRAM_BOT_TOKEN: " + (TELEGRAM_BOT_TOKEN ? "✓ configurado (" + TELEGRAM_BOT_TOKEN.slice(0, 12) + "...)" : "✗ vazio"));
  Logger.log("TELEGRAM_CHAT_ID:   " + (TELEGRAM_CHAT_ID ? "✓ configurado (" + TELEGRAM_CHAT_ID + ")" : "✗ vazio"));
  Logger.log("GENERIC_WEBHOOK:    " + (GENERIC_WEBHOOK ? "✓ configurado" : "✗ vazio"));

  if (!DISCORD_WEBHOOK && !SLACK_WEBHOOK && !TELEGRAM_BOT_TOKEN && !GENERIC_WEBHOOK) {
    Logger.log("\n⚠ NENHUM webhook configurado. Preencha pelo menos um no topo do Code.gs.");
    return;
  }

  // 2. Constrói payload de teste
  const fake = {
    sessionId: "s_test_" + Date.now(),
    startedAt: Date.now() - 8 * 60000,
    lastSeen: Date.now(),
    totalTimeMs: 8 * 60000,
    visitorName: "Carlos Mendes (TESTE)",
    visitorEmail: "carlos.teste@empresa.com",
    visitorPhone: "11987654321",
    visitorCity: "São Paulo / SP",
    profile: "otimista",
    quizCompleted: true,
    tabTime: { overview: 60000, simulador: 240000, mercado: 120000 },
    interactions: { sliders: { faturamentoPorMaquina: {}, percReinvestFase1: {} }, presets: {} },
    events: [
      { t: 1000, type: "quiz_answered", data: { q: "objetivo",  value: "viver-disso" } },
      { t: 2000, type: "quiz_answered", data: { q: "capital",   value: "100-300" } },
      { t: 3000, type: "quiz_answered", data: { q: "meta",      value: "50-150k" } },
      { t: 4000, type: "quiz_answered", data: { q: "horizonte", value: "5" } }
    ]
  };

  // Limpa flag pra forçar disparo
  PropertiesService.getScriptProperties().deleteProperty(HOT_LEAD_FLAG_PROP + fake.sessionId);

  // 3. Tenta cada webhook EXPLICITAMENTE com response logging
  const summary = buildLeadSummary_(fake);
  Logger.log("\n--- Disparando webhooks ---");

  if (DISCORD_WEBHOOK) {
    Logger.log("\n→ DISCORD: testando...");
    testDiscord_(summary);
  }
  if (SLACK_WEBHOOK) {
    Logger.log("\n→ SLACK: testando...");
    testSlack_(summary);
  }
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    Logger.log("\n→ TELEGRAM: testando...");
    testTelegram_(summary);
  } else if (TELEGRAM_BOT_TOKEN || TELEGRAM_CHAT_ID) {
    Logger.log("\n⚠ TELEGRAM: token OU chat_id está faltando — preciso dos DOIS");
  }
  if (GENERIC_WEBHOOK) {
    Logger.log("\n→ GENERIC: testando...");
    testGeneric_(summary, fake);
  }

  // 4. Salva também na aba Hot Leads
  saveHotLead_(fake);
  Logger.log("\n✓ Linha adicionada na aba 'Hot Leads' da planilha");

  Logger.log("\n=== FIM DO TESTE ===");
}

/* Versões dos senders com logging detalhado (só usadas pelo teste) */
function testDiscord_(d) {
  try {
    const fields = [];
    if (d.contactBlock) fields.push({ name: "Contato", value: "```\n" + d.contactBlock + "\n```", inline: false });
    fields.push({ name: "Perfil", value: d.profileEmoji + " " + d.profile, inline: true });
    fields.push({ name: "Tempo", value: d.minutes + " min", inline: true });
    const payload = {
      username: "AVEND Lead Bot (TESTE)",
      embeds: [{ title: d.title, color: 0xffb020, fields: fields, timestamp: new Date().toISOString() }]
    };
    const r = UrlFetchApp.fetch(DISCORD_WEBHOOK, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    const body = r.getContentText();
    if (code >= 200 && code < 300) {
      Logger.log("  ✓ Discord OK (status " + code + ")");
    } else {
      Logger.log("  ✗ Discord FALHOU (status " + code + "): " + body.slice(0, 300));
    }
  } catch (err) { Logger.log("  ✗ Discord exception: " + err); }
}

function testSlack_(d) {
  try {
    const text = `*${d.title}*\n${d.contactBlock}\n\n*Perfil:* ${d.profileEmoji} ${d.profile} · *Tempo:* ${d.minutes} min`;
    const r = UrlFetchApp.fetch(SLACK_WEBHOOK, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({ text }), muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    const body = r.getContentText();
    if (code >= 200 && code < 300) {
      Logger.log("  ✓ Slack OK (status " + code + ")");
    } else {
      Logger.log("  ✗ Slack FALHOU (status " + code + "): " + body.slice(0, 300));
    }
  } catch (err) { Logger.log("  ✗ Slack exception: " + err); }
}

function testTelegram_(d) {
  try {
    const text =
      `*${escapeMarkdown_(d.title)}*\n\n` +
      `${escapeMarkdown_(d.contactBlock)}\n\n` +
      `_Perfil:_ ${d.profileEmoji} ${escapeMarkdown_(d.profile)}\n` +
      `_Tempo:_ ${d.minutes} min`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const r = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    const body = r.getContentText();
    if (code === 200) {
      Logger.log("  ✓ Telegram OK — mensagem enviada");
    } else {
      Logger.log("  ✗ Telegram FALHOU (status " + code + "): " + body.slice(0, 400));
      // Diagnóstico de erros comuns
      try {
        const json = JSON.parse(body);
        if (json.error_code === 400 && /chat not found/i.test(json.description || "")) {
          Logger.log("  💡 SOLUÇÃO: O TELEGRAM_CHAT_ID está errado ou você nunca falou com o bot.");
          Logger.log("     1. Abra o Telegram, procure seu bot pelo nome (@SeuBot)");
          Logger.log("     2. Mande qualquer mensagem (ex: 'oi') pro bot");
          Logger.log("     3. Confirme o chat_id em @userinfobot");
          Logger.log("     4. Rode esta função novamente");
        } else if (json.error_code === 401) {
          Logger.log("  💡 SOLUÇÃO: TELEGRAM_BOT_TOKEN inválido. Confira no @BotFather.");
        } else if (json.error_code === 403) {
          Logger.log("  💡 SOLUÇÃO: Bot bloqueado pelo usuário. Desbloqueie no Telegram e mande /start pro bot.");
        } else if (/can't parse entities/i.test(json.description || "")) {
          Logger.log("  💡 SOLUÇÃO: Erro de markdown — geralmente passageiro, tente de novo.");
        }
      } catch (e) {}
    }
  } catch (err) { Logger.log("  ✗ Telegram exception: " + err); }
}

function testGeneric_(d, session) {
  try {
    const r = UrlFetchApp.fetch(GENERIC_WEBHOOK, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({
        type: "hot_lead", title: d.title, profile: d.profile,
        minutes: parseFloat(d.minutes), session_id: d.sessionId, raw: session
      }),
      muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    const body = r.getContentText();
    if (code >= 200 && code < 300) {
      Logger.log("  ✓ Generic OK (status " + code + ")");
    } else {
      Logger.log("  ✗ Generic FALHOU (status " + code + "): " + body.slice(0, 300));
    }
  } catch (err) { Logger.log("  ✗ Generic exception: " + err); }
}

/* Limpa flags de notificação (use se quiser re-notificar leads antigos) */
function clearHotLeadFlags() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let cleared = 0;
  for (const k in all) {
    if (k.indexOf(HOT_LEAD_FLAG_PROP) === 0 || k.indexOf(SPECIAL_EVENT_FLAG_PROP) === 0) {
      props.deleteProperty(k);
      cleared++;
    }
  }
  Logger.log("Cleared " + cleared + " notification flags");
}

/* ============================================================
   DIAGNÓSTICO — Para descobrir por que notificação às vezes não chega
   Rode diagnoseLeadFlow() no editor pra ver:
   - Configuração atual de critérios
   - Últimas 15 sessões da planilha com avaliação:
     * deveria ter notificado? (perfil quente + contato)
     * tem flag de notificação? (anti-duplicata)
     * data/hora exata
   - Teste de envio real ao Telegram
   ============================================================ */
function diagnoseLeadFlow() {
  Logger.log("=== AVEND · DIAGNÓSTICO DE NOTIFICAÇÕES ===\n");

  // 1. Configuração
  Logger.log("--- CONFIGURAÇÃO ATUAL ---");
  Logger.log("HOT_PROFILES (perfis quentes): " + JSON.stringify(HOT_PROFILES));
  Logger.log("HOT_TIME_THRESHOLD_MIN: " + HOT_TIME_THRESHOLD_MIN + " min");
  Logger.log("Telegram configurado: " + (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? "✓" : "✗"));
  Logger.log("Discord:  " + (DISCORD_WEBHOOK ? "✓" : "✗"));
  Logger.log("Slack:    " + (SLACK_WEBHOOK ? "✓" : "✗"));
  Logger.log("Generic:  " + (GENERIC_WEBHOOK ? "✓" : "✗"));

  // 2. Últimas sessões
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionsSheet = ss.getSheetByName(SHEET_NAME_SESSIONS);
  if (!sessionsSheet) {
    Logger.log("\n⚠ Aba 'Sessions' não existe ainda — nenhum lead foi recebido.");
    return;
  }

  const data = sessionsSheet.getDataRange().getValues();
  const allRows = data.slice(1).reverse();

  // Dedupe: pra cada sessionId, mantém só a linha com MAIOR tempo (snapshot final)
  const seen = {};
  const dedupedRows = [];
  allRows.forEach(r => {
    const sid = r[0];
    const time = parseFloat(r[3]) || 0;
    if (!seen[sid] || time > seen[sid].time) {
      if (seen[sid]) {
        // remove o anterior do array
        const idx = dedupedRows.indexOf(seen[sid].row);
        if (idx >= 0) dedupedRows.splice(idx, 1);
      }
      seen[sid] = { row: r, time };
      dedupedRows.push(r);
    }
  });
  const rows = dedupedRows.slice(0, 15);

  const dupCount = allRows.length - Object.keys(seen).length;
  if (dupCount > 0) {
    Logger.log(`\n⚠ Detectadas ${dupCount} linha(s) duplicada(s) na planilha (race condition).`);
    Logger.log(`   Foi corrigido com LockService nesta versão. Linhas antigas podem ser limpas`);
    Logger.log(`   manualmente na planilha (mantenha sempre a linha com maior tempo da sessão).`);
  }

  Logger.log("\n--- ÚLTIMAS " + rows.length + " SESSÕES ÚNICAS ---");
  Logger.log("(da mais recente pra mais antiga, snapshot final de cada sessão)\n");

  const props = PropertiesService.getScriptProperties();
  let notifiedCount = 0;
  let shouldHaveNotified = 0;

  rows.forEach((row, i) => {
    const sessionId   = row[0];
    const startedAt   = row[1];
    const totalMin    = parseFloat(row[3]) || 0;
    const visitorName = row[5];
    const visitorEmail = row[6];
    const visitorPhone = row[7];
    const quizDone    = row[9] === "yes";
    const profile     = row[10];

    const hasContact   = !!(visitorName || visitorEmail || visitorPhone);
    const profileHot   = profile && HOT_PROFILES.indexOf(profile) !== -1;
    const timeHot      = totalMin >= HOT_TIME_THRESHOLD_MIN;
    const shouldNotify = (quizDone && profileHot && hasContact) || (timeHot && hasContact);

    const flagKey = HOT_LEAD_FLAG_PROP + sessionId;
    const wasNotified = !!props.getProperty(flagKey);

    if (shouldNotify) shouldHaveNotified++;
    if (wasNotified) notifiedCount++;

    let status;
    if (shouldNotify && wasNotified)         status = "✅ NOTIFICOU";
    else if (shouldNotify && !wasNotified)   status = "❌ DEVERIA TER NOTIFICADO MAS NÃO!";
    else if (!shouldNotify && hasContact)    status = "○ não atende critérios (perfil " + (profile || "—") + ", " + totalMin.toFixed(1) + "min)";
    else                                      status = "○ sem contato / anônimo";

    const visitor = visitorName || visitorEmail || "anônimo";
    Logger.log(
      `${(i+1).toString().padStart(2)}. ${status}\n` +
      `    ${visitor} · ${(profile || "no profile").toUpperCase()} · ${totalMin.toFixed(1)} min · ${quizDone ? "quiz ✓" : "quiz ✗"}\n` +
      `    session: ${sessionId} · ${startedAt}`
    );
  });

  Logger.log(`\n--- RESUMO ---`);
  Logger.log(`Sessões avaliadas: ${rows.length}`);
  Logger.log(`Que deveriam ter notificado: ${shouldHaveNotified}`);
  Logger.log(`Que efetivamente notificaram: ${notifiedCount}`);
  if (shouldHaveNotified > notifiedCount) {
    const lost = shouldHaveNotified - notifiedCount;
    Logger.log(`\n⚠ ${lost} notificação(ões) perdida(s)! Possíveis causas:`);
    Logger.log(`   - sendBeacon falhou (mobile fechando aba muito rápido)`);
    Logger.log(`   - Rate limit do Apps Script no momento`);
    Logger.log(`   - Bot Telegram caiu / chat_id mudou`);
    Logger.log(`   Use forceNotify('SESSION_ID') pra disparar manualmente.`);
  }

  // 3. Teste de envio Telegram
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    Logger.log("\n--- TESTE DE ENVIO TELEGRAM ---");
    try {
      const r = UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "post", contentType: "application/json",
        payload: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: `🩺 *Diagnóstico AVEND* — ${new Date().toLocaleString("pt-BR")}\n\nSe você recebeu esta mensagem, o canal Telegram está OK.`,
          parse_mode: "Markdown"
        }),
        muteHttpExceptions: true
      });
      Logger.log("Status: " + r.getResponseCode());
      if (r.getResponseCode() === 200) {
        Logger.log("✓ Telegram funcional. Você deve ter recebido um teste agora.");
      } else {
        Logger.log("✗ Telegram falhou: " + r.getContentText().slice(0, 300));
      }
    } catch (err) {
      Logger.log("✗ Exception: " + err);
    }
  }

  Logger.log("\n=== FIM DO DIAGNÓSTICO ===");
}

/* Força notificação de uma sessão específica (ignora anti-duplicata).
   Use depois de descobrir um sessionId no diagnoseLeadFlow() que não notificou. */
function forceNotify(sessionId) {
  if (!sessionId) {
    Logger.log("⚠ Passe o sessionId. Ex: forceNotify('s_abc123_xyz')");
    return;
  }
  // Limpa flag pra forçar
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(HOT_LEAD_FLAG_PROP + sessionId);

  // Recupera dados da sessão da planilha
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_SESSIONS);
  if (!sheet) { Logger.log("Sheet 'Sessions' não existe."); return; }
  const data = sheet.getDataRange().getValues();
  const row = data.find((r, i) => i > 0 && r[0] === sessionId);
  if (!row) { Logger.log("Session não encontrada: " + sessionId); return; }

  // Reconstrói objeto session — busca raw_json por header pra ser robusto
  const headerRow = data[0];
  const rawJsonIdx = headerRow.indexOf("raw_json");
  const rawJson = rawJsonIdx >= 0 ? row[rawJsonIdx] : null;

  let session;
  try { session = JSON.parse(rawJson); }
  catch (e) {
    // Fallback: monta a partir das colunas (busca por header)
    const col = (name) => { const i = headerRow.indexOf(name); return i >= 0 ? row[i] : null; };
    session = {
      sessionId: col("session_id"),
      startedAt: new Date(col("started_at")).getTime(),
      lastSeen: new Date(col("last_seen")).getTime(),
      totalTimeMs: (parseFloat(col("total_time_min")) || 0) * 60000,
      visitorName: col("visitor_name"), visitorEmail: col("visitor_email"),
      visitorPhone: col("visitor_phone"), visitorCity: col("visitor_city"),
      quizCompleted: col("quiz_completed") === "yes", profile: col("profile"),
      tabTime: {}, interactions: { sliders: {}, presets: {} }, events: []
    };
  }

  Logger.log("Disparando notificação de " + sessionId + "...");
  maybeNotifyHotLead_(session);
  Logger.log("Concluído. Verifique o Telegram + aba 'Hot Leads'.");
}

/* ============================================================
   EVENTOS ESPECIAIS — notificações secundárias
   - returning_visitor: alguém que já visitou voltou
   - dwell_milestone_10m / 15m: ficou MUITO tempo na página
   - deep_engagement: explorou a fundo
   - quiz_abandoned: abriu o quiz mas desistiu (oportunidade de retargeting)
   ============================================================ */

const SPECIAL_EVENT_FLAG_PROP = "special_event_notified_";

// Quais eventos especiais notificar (false = só registra, não dispara webhook)
const NOTIFY_SPECIAL_EVENTS = {
  "lead_intent":           true,   // 🔥 PRIORIDADE MÁXIMA — clicou no botão WhatsApp
  "returning_visitor":     true,
  "dwell_milestone_10m":   true,
  "dwell_milestone_15m":   true,
  "deep_engagement":       true,
  "quiz_abandoned":        false   // vira ruído se ligar
};

function maybeNotifySpecialEvent_(sessionId, evt, visitor) {
  if (!evt || !evt.type) return;
  if (!NOTIFY_SPECIAL_EVENTS[evt.type]) return;
  // Só notifica se tiver pelo menos algum contato (senão é ruído)
  const hasContact = !!(visitor.name || visitor.email || visitor.phone);
  if (!hasContact && evt.type !== "deep_engagement") return;

  // Ignore list — não notifica visitas internas (Giovanni, equipe, etc)
  if (isIgnoredVisitor_(visitor)) {
    Logger.log("Ignored visitor (in IGNORE_LIST): " + (visitor.email || visitor.phone || visitor.name));
    return;
  }

  // Anti-duplicata: 1x por (sessao + evento)
  const props = PropertiesService.getScriptProperties();
  const flagKey = SPECIAL_EVENT_FLAG_PROP + sessionId + "_" + evt.type;
  if (props.getProperty(flagKey)) return;
  props.setProperty(flagKey, "1");

  // Recupera a sessão completa da planilha pra ter perfil, tempo, etc
  const fullSession = getSessionFromSheet_(sessionId) || {};
  // Mescla dados de visitor (vindos do evento) com a sessão recuperada
  const session = Object.assign({}, fullSession, {
    visitorName:  visitor.name  || fullSession.visitorName,
    visitorEmail: visitor.email || fullSession.visitorEmail,
    visitorPhone: visitor.phone || fullSession.visitorPhone,
    visitorCity:  visitor.city  || fullSession.visitorCity,
    sessionId: sessionId
  });

  // Monta summary unificado (mesma estrutura do hot lead) e adiciona contexto do evento
  const summary = buildLeadSummary_(session);
  // Override do título com a label do evento especial
  summary.title = specialEventTitle_(evt.type, summary);
  summary.eventType = evt.type;
  summary.eventData = evt.data || {};

  if (DISCORD_WEBHOOK)  sendDiscordSpecial_(summary, evt.type);
  if (SLACK_WEBHOOK)    sendSlack_(summary);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) sendTelegramSpecial_(summary);
  if (GENERIC_WEBHOOK)  sendGenericSpecial_(summary, evt, visitor, sessionId);
}

function specialEventTitle_(eventType, summary) {
  const labels = {
    "lead_intent":         `🔥🔥🔥 LEAD ${summary.score}/10 QUER FALAR · clicou no WhatsApp`,
    "returning_visitor":   `🔄 Visitante retornou · ${summary.score}/10`,
    "dwell_milestone_10m": `⏱ ${summary.score}/10 · +10 min na página`,
    "dwell_milestone_15m": `⏱ ${summary.score}/10 · +15 min (super engajado!)`,
    "deep_engagement":     `🎯 ${summary.score}/10 · Engajamento profundo`,
    "quiz_abandoned":      `💤 Abandonou o quiz no meio`
  };
  return labels[eventType] || eventType;
}

/* Recupera uma sessão da planilha por sessionId (busca por header pra ser robusto) */
function getSessionFromSheet_(sessionId) {
  if (!sessionId) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_SESSIONS);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const sidIdx = headers.indexOf("session_id");
  for (let i = 1; i < data.length; i++) {
    if (data[i][sidIdx] === sessionId) {
      const row = data[i];
      const col = (name) => { const j = headers.indexOf(name); return j >= 0 ? row[j] : null; };
      // Tenta hidratar do raw_json (mais completo)
      try {
        const raw = col("raw_json");
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      // Fallback: monta a partir das colunas
      return {
        sessionId: col("session_id"),
        startedAt: new Date(col("started_at")).getTime(),
        lastSeen:  new Date(col("last_seen")).getTime(),
        totalTimeMs: (parseFloat(col("total_time_min")) || 0) * 60000,
        visitorName:  col("visitor_name"),
        visitorEmail: col("visitor_email"),
        visitorPhone: col("visitor_phone"),
        visitorCity:  col("visitor_city"),
        quizCompleted: col("quiz_completed") === "yes",
        profile: col("profile"),
        tabTime: {},
        interactions: { sliders: {}, presets: {} },
        events: []
      };
    }
  }
  return null;
}

/* TESTE DA IGNORE_LIST — rode no editor pra diagnosticar */
function testIgnoreList() {
  Logger.log("=== AVEND · TESTE DA IGNORE_LIST ===\n");

  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("IGNORE_LIST");

  // 1. Existe?
  if (raw === null) {
    Logger.log("❌ IGNORE_LIST NÃO está configurada nas Script Properties.");
    Logger.log("   → Vá em ⚙ Project Settings → Script Properties → Add script property");
    Logger.log("   → Property: IGNORE_LIST");
    Logger.log("   → Value: giovannirinaldipq@gmail.com,17991440473,giovanni rinaldi");
    return;
  }

  if (!raw.trim()) {
    Logger.log("⚠ IGNORE_LIST está VAZIA. Adicione valores separados por vírgula.");
    return;
  }

  Logger.log("✓ IGNORE_LIST encontrada.");
  Logger.log("Valor RAW: " + JSON.stringify(raw));
  const items = raw.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  Logger.log("Itens parseados (" + items.length + "):");
  items.forEach((item, i) => Logger.log("   " + (i+1) + ". " + JSON.stringify(item)));

  // 2. Testa se a função isIgnoredVisitor_ existe (Code.gs atualizado?)
  if (typeof isIgnoredVisitor_ !== "function") {
    Logger.log("\n❌ Função isIgnoredVisitor_ NÃO encontrada!");
    Logger.log("   → Você precisa atualizar o Code.gs pela versão nova:");
    Logger.log("   → https://github.com/giovannirinaldipq/avend-businessplan/blob/main/apps-script/Code.gs");
    Logger.log("   → Cole tudo, salve (Ctrl+S), Deploy → Manage deployments → ✏ → New version → Deploy");
    return;
  }
  Logger.log("\n✓ Função isIgnoredVisitor_ existe.");

  // 3. Testa cenários típicos
  Logger.log("\n--- Testando cenários ---");
  const testCases = [
    { label: "Giovanni por email", visitor: { email: "giovannirinaldipq@gmail.com" } },
    { label: "Giovanni por phone", visitor: { phone: "(17) 99144-0473" } },
    { label: "Giovanni por phone (só dígitos)", visitor: { phone: "17991440473" } },
    { label: "Giovanni por nome",  visitor: { name: "Giovanni Rinaldi" } },
    { label: "Visitor desconhecido (deve passar)", visitor: { email: "investidor@x.com", name: "Maria Silva" } }
  ];
  testCases.forEach(tc => {
    const blocked = isIgnoredVisitor_(tc.visitor);
    Logger.log("  " + (blocked ? "🚫 BLOQUEADO" : "✅ passa  ") + " · " + tc.label);
  });

  Logger.log("\n--- Diagnóstico do código ---");
  Logger.log("Hot lead flow chama isIgnoredVisitor_? " + (maybeNotifyHotLead_.toString().includes("isIgnoredVisitor_") ? "✓" : "❌ Code.gs antigo!"));
  Logger.log("Special event flow chama isIgnoredVisitor_? " + (maybeNotifySpecialEvent_.toString().includes("isIgnoredVisitor_") ? "✓" : "❌ Code.gs antigo!"));

  Logger.log("\n=== FIM DO TESTE ===");
  Logger.log("Se tudo apareceu ✓ acima E bloqueou nos 4 primeiros cenários,");
  Logger.log("a ignore list está OK. Se ainda chegar notificação:");
  Logger.log("  1. Você não fez 'New version' no deploy depois do último save");
  Logger.log("  2. Os dados que digitou no quiz não batem (confira espaços extras)");
}

/* Ignore list — leads de teste interno (Giovanni + equipe) */
function isIgnoredVisitor_(visitor) {
  if (!visitor) return false;
  // Lê de Script Properties (formato: "email1@x.com,email2@x.com,phone1,phone2")
  const props = PropertiesService.getScriptProperties();
  const ignoreRaw = (props.getProperty("IGNORE_LIST") || "").toLowerCase();
  if (!ignoreRaw) return false;
  const ignoreList = ignoreRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (!ignoreList.length) return false;

  const email = (visitor.email || "").toLowerCase();
  const phoneDigits = String(visitor.phone || "").replace(/\D/g, "");
  const name = (visitor.name || "").toLowerCase();

  return ignoreList.some(item => {
    if (!item) return false;
    if (item.includes("@") && email && email === item) return true;          // email match exato
    if (/^\d{10,}$/.test(item.replace(/\D/g, ""))) {
      const itemDigits = item.replace(/\D/g, "");
      if (phoneDigits && phoneDigits.includes(itemDigits)) return true;       // phone substring match
    }
    if (item.length > 2 && name.includes(item)) return true;                  // name substring match
    return false;
  });
}

/* Versão Telegram dedicada pra eventos especiais (com info do evento como header) */
function sendTelegramSpecial_(d) {
  try {
    const lines = [];
    lines.push(`*${d.title}*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);

    if (d.contactBlock) {
      lines.push("");
      lines.push("👋 *Contato:*");
      lines.push(d.contactBlock);
    }

    lines.push("");
    lines.push("📊 *Engajamento:*");
    lines.push(`• Perfil: ${d.profileEmoji} ${d.profile}`);
    lines.push(`• Tempo na página: *${d.minutes} min*`);
    lines.push(`• Sliders mexidos: ${d.sliders}`);
    if (d.presets > 0) lines.push(`• Presets clicados: ${d.presets}`);
    lines.push(`• Abas top 3: ${d.tabs}`);

    if (d.eventData) {
      const lines2 = [];
      if (d.eventData.visitNumber)     lines2.push(`• Esta é a *${d.eventData.visitNumber}ª* visita`);
      if (d.eventData.previousProfile) lines2.push(`• Perfil anterior: *${d.eventData.previousProfile.toUpperCase()}*`);
      if (d.eventData.tabsVisited)     lines2.push(`• Abas visitadas: ${d.eventData.tabsVisited}`);
      if (d.eventData.answeredCount !== undefined)
        lines2.push(`• Respondeu ${d.eventData.answeredCount} pergunta(s) antes de sair`);
      if (lines2.length) {
        lines.push("");
        lines.push("⚡ *Detalhes do evento:*");
        lines.push(lines2.join("\n"));
      }
    }

    if (d.answersText) lines.push(d.answersText);

    lines.push("");
    lines.push(`_Score AVEND: ${d.score}/10_ · _session ${(d.sessionId || "").slice(0, 16)}…_`);

    const text = lines.join("\n");
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const r = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID, text: text,
        parse_mode: "Markdown", disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) {
      Logger.log("Telegram special event FALHOU (status " + r.getResponseCode() + "): " + r.getContentText().slice(0, 300));
    }
  } catch (err) { Logger.log("Telegram special event error: " + err); }
}

function buildSpecialEventSummary_(evt, visitor, sessionId) {
  const labels = {
    "lead_intent":         "🔥🔥🔥 LEAD QUER FALAR AGORA — abriu WhatsApp",
    "returning_visitor":   "🔄 Visitante retornou",
    "dwell_milestone_10m": "⏱ +10 min na página",
    "dwell_milestone_15m": "⏱ +15 min na página (super engajado!)",
    "deep_engagement":     "🎯 Engajamento profundo (explorou tudo)",
    "quiz_abandoned":      "💤 Abandonou o quiz no meio"
  };
  const colors = {
    "lead_intent":         0xff3366,   // vermelho-rosa, máxima atenção
    "returning_visitor":   0x4B6CE2,
    "dwell_milestone_10m": 0xffb020,
    "dwell_milestone_15m": 0xff6b6b,
    "deep_engagement":     0x39e887,
    "quiz_abandoned":      0xa7adca
  };

  const contact = [];
  if (visitor.name)  contact.push("👤 " + visitor.name);
  if (visitor.email) contact.push("📧 " + visitor.email);
  if (visitor.phone) contact.push("📞 " + visitor.phone);
  if (visitor.city)  contact.push("📍 " + visitor.city);

  let extra = "";
  if (evt.data && evt.data.visitNumber) extra = `\n*Visita nº:* ${evt.data.visitNumber}`;
  if (evt.data && evt.data.previousProfile) extra += `\n*Perfil anterior:* ${evt.data.previousProfile.toUpperCase()}`;
  if (evt.data && evt.data.elapsedMs) extra += `\n*Tempo na página:* ${(evt.data.elapsedMs/60000).toFixed(1)} min`;
  if (evt.data && evt.data.tabsVisited) extra += `\n*Abas visitadas:* ${evt.data.tabsVisited} · *Sliders:* ${evt.data.slidersChanged}`;
  if (evt.data && evt.data.answeredCount !== undefined) extra += `\n*Respondeu antes de sair:* ${evt.data.answeredCount} pergunta(s)`;

  // Lead intent: dados ricos do plano
  if (evt.type === "lead_intent" && evt.data && evt.data.params) {
    const p = evt.data.params;
    extra += `\n*Perfil:* ${(evt.data.profile || "").toUpperCase()}`;
    extra += `\n*Plano sugerido:* R$ ${(p.faturamentoPorMaquina || 0).toLocaleString("pt-BR")}/máq · ${p.capacidadeImplantacao}/mês · ${(p.horizonteMeses || 60) / 12} anos`;
    extra += `\n\n⚡ *AÇÃO IMEDIATA*: o investidor está abrindo o WhatsApp pra falar com você AGORA.`;
  }

  return {
    title: labels[evt.type] || evt.type,
    contactBlock: contact.join("\n") || "(visitante anônimo)",
    extra: extra,
    eventType: evt.type,
    color: colors[evt.type] || 0x8B30E6,
    sessionId: sessionId,
    answersText: ""   // compat com sender genérico
  };
}

function sendDiscordSpecial_(d, eventType) {
  try {
    const fields = [
      { name: "Contato", value: "```\n" + d.contactBlock + "\n```", inline: false }
    ];
    if (d.extra) fields.push({ name: "Detalhes", value: d.extra.replace(/\n\*/g, "\n").replace(/\*/g, ""), inline: false });
    const payload = {
      username: "AVEND Lead Bot",
      embeds: [{
        title: d.title,
        color: d.color,
        fields: fields,
        footer: { text: "Session: " + d.sessionId },
        timestamp: new Date().toISOString()
      }]
    };
    UrlFetchApp.fetch(DISCORD_WEBHOOK, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log("Discord special event error: " + err); }
}

function sendGenericSpecial_(d, evt, visitor, sessionId) {
  try {
    UrlFetchApp.fetch(GENERIC_WEBHOOK, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        type: "special_event",
        event_type: evt.type,
        title: d.title,
        contact: visitor,
        event_data: evt.data,
        session_id: sessionId
      }),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log("Generic special event error: " + err); }
}
