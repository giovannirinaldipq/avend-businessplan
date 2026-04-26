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

// Colunas da aba Sessions
const SESSION_HEADERS = [
  "session_id", "started_at", "last_seen", "total_time_min",
  "visitor_id", "visitor_name", "visitor_email", "visitor_phone", "visitor_city",
  "quiz_completed", "profile",
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
    const body = e.postData && e.postData.contents ? e.postData.contents : "{}";
    const payload = JSON.parse(body);

    if (payload.type === "session") {
      saveSession_(payload.session);
      return jsonResponse_({ ok: true, type: "session" });
    }

    if (payload.type === "event") {
      saveEvent_(payload.session_id, payload.event, payload.visitor || {});
      return jsonResponse_({ ok: true, type: "event" });
    }

    return jsonResponse_({ ok: false, error: "unknown payload.type" });
  } catch (err) {
    Logger.log("doPost error: " + err);
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  // Healthcheck simples
  return jsonResponse_({ ok: true, service: "avend-telemetry", version: "1.0" });
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

/* ---------- Save session ---------- */
function saveSession_(s) {
  if (!s || !s.sessionId) return;

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
