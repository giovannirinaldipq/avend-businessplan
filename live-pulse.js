/* ============================================================
   AVEND Live Pulse — Notificações de atividade da rede
   ============================================================
   Pop-ups discretos no canto inferior esquerdo simulando
   atividade da rede (vendas, marcos, outros visitantes).

   Premissas:
   - Nivel C: estatística extrapolada (não dados reais)
   - Disclaimer: "exemplos da atividade típica da rede"
   - Frequência respeitosa: 1ª aos 45s, depois 75-120s
   - Máximo 6 por sessão (sem fadiga)
   - Pause quando user em quiz/tour/PDF gate
   - Toggle pra desligar (localStorage)
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- CONFIG (editável) ----------------------------- */
  const CONFIG = {
    enabled: true,
    startDelayMs: 45 * 1000,        // 45s pra primeira notificação
    intervalMin:  75 * 1000,        // 75s mínimo entre notificações
    intervalMax: 120 * 1000,        // 120s máximo
    maxPerSession: 6,               // limite total de notificações
    autoDismissMs: 6500,            // 6.5s de exibição
    pausedRecheckMs: 30 * 1000,     // se pausado, tenta de novo em 30s

    // Range das unidades — formato 40XX
    unidadeMin: 4001,
    unidadeMax: 4099,

    // Pool de produtos AVEND com gramatura/volume reais do mercado
    // gen: "m" → "vendeu um" · gen: "f" → "vendeu uma"
    // preco: valor médio praticado em vending no Brasil 2026
    produtos: [
      // Refrigerantes em lata (350ml padrão)
      { nome: "Coca-Cola Zero lata 350ml",        icon: "🥤", gen: "f", preco: 7.00 },
      { nome: "Coca-Cola Original lata 350ml",    icon: "🥤", gen: "f", preco: 7.00 },
      { nome: "Fanta Laranja lata 350ml",         icon: "🥤", gen: "f", preco: 6.50 },
      { nome: "Guaraná Antarctica lata 350ml",    icon: "🥤", gen: "m", preco: 6.50 },
      { nome: "Sprite lata 350ml",                icon: "🥤", gen: "m", preco: 6.50 },
      // Sucos em lata (290ml é o padrão Del Valle Frut)
      { nome: "Del Valle Frut Uva lata 290ml",    icon: "🧃", gen: "m", preco: 7.50 },
      { nome: "Del Valle Frut Laranja lata 290ml",icon: "🧃", gen: "m", preco: 7.50 },
      // Águas
      { nome: "Crystal sem gás 500ml",            icon: "💧", gen: "f", preco: 4.50 },
      { nome: "Crystal com gás 500ml",            icon: "💧", gen: "f", preco: 5.00 },
      // Chocolates (gramaturas padrão Brasil)
      { nome: "Snickers 45g",                     icon: "🍫", gen: "m", preco: 6.00 },
      { nome: "Twix 45g",                         icon: "🍫", gen: "m", preco: 6.00 },
      { nome: "Kit Kat 4 Dedos 41,5g",            icon: "🍫", gen: "m", preco: 6.50 },
      { nome: "M&M's Chocolate 49g",              icon: "🍬", gen: "m", preco: 7.00 },
      // Salgadinhos
      { nome: "Ruffles Churrasco 76g",            icon: "🍟", gen: "m", preco: 9.50 },
      { nome: "Ruffles Tradicional 76g",          icon: "🍟", gen: "m", preco: 9.50 }
    ],

    // Mistura dos 3 tipos de evento
    mix: { atividade: 0.60, marco: 0.25, conversor: 0.15 }
  };

  /* ---------- STATE ----------------------------------------- */
  const state = {
    shown: 0,
    timer: null,
    container: null,
    lastUnidades: []  // últimas 5 unidades pra evitar repetição visível
  };

  /* ---------- HELPERS --------------------------------------- */
  function pickProduto() {
    return CONFIG.produtos[Math.floor(Math.random() * CONFIG.produtos.length)];
  }

  function pickUnidade() {
    // Sorteia até achar uma que não está nas últimas 5
    let n, tries = 0;
    do {
      n = CONFIG.unidadeMin +
          Math.floor(Math.random() * (CONFIG.unidadeMax - CONFIG.unidadeMin + 1));
      tries++;
    } while (state.lastUnidades.indexOf(n) !== -1 && tries < 30);

    state.lastUnidades.push(n);
    if (state.lastUnidades.length > 5) state.lastUnidades.shift();
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }

  // Formato BRL pt-BR (R$ 7,00)
  const NF_BRL = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL"
  });
  function fmtBRL(v) { return NF_BRL.format(Number(v) || 0); }

  /* ---------- EVENT BUILDERS -------------------------------- */
  function buildAtividade() {
    const unidade = pickUnidade();
    const produto = pickProduto();
    const minAtras = 1 + Math.floor(Math.random() * 3); // 1-3 min
    const tempo = minAtras === 1 ? "agora há pouco" : "há " + minAtras + " min";
    const artigo = produto.gen === "f" ? "uma" : "um";
    // Valor em R$ no campo "time" — destaque visual sutil pro investidor
    // somar mentalmente as vendas ao longo da sessão.
    const valor = produto.preco ? fmtBRL(produto.preco) : null;
    return {
      _type: "atividade",
      icon: produto.icon,
      title: "Unidade #" + unidade,
      body: "vendeu " + artigo + " " + produto.nome,
      time: tempo,
      valor: valor  // renderizado em destaque cyan
    };
  }

  function buildMarco() {
    const variantes = [
      function () {
        const n = 18 + Math.floor(Math.random() * 25);  // 18-42
        return {
          _type: "marco",
          icon: "⚡",
          title: "Rede AVEND",
          body: n + "ª venda só nesta hora",
          time: "agora"
        };
      },
      function () {
        const valor = 300 + Math.floor(Math.random() * 600); // 300-900
        return {
          _type: "marco",
          icon: "🎯",
          title: "Unidade #" + pickUnidade(),
          body: "ultrapassou R$ " + valor + " em vendas hoje",
          time: "há instantes"
        };
      },
      function () {
        const n = 600 + Math.floor(Math.random() * 1500); // 600-2100
        return {
          _type: "marco",
          icon: "📈",
          title: "Rede AVEND",
          body: n.toLocaleString("pt-BR") + "ª venda do dia",
          time: "agora"
        };
      },
      function () {
        return {
          _type: "marco",
          icon: "🔥",
          title: "Unidade #" + pickUnidade(),
          body: "está entre as top 10 da rede neste mês",
          time: ""
        };
      }
    ];
    return variantes[Math.floor(Math.random() * variantes.length)]();
  }

  function buildConversor() {
    const acoes = [
      { evento: "iniciou o diagnóstico personalizado", icon: "📋" },
      { evento: "concluiu o quiz de perfil",           icon: "🎯" },
      { evento: "baixou o estudo de mercado",          icon: "📄" },
      { evento: "aplicou um plano sob medida",         icon: "✨" }
    ];
    const a = acoes[Math.floor(Math.random() * acoes.length)];
    const min = 1 + Math.floor(Math.random() * 5); // 1-5 min
    const tempo = min === 1 ? "agora há pouco" : "há " + min + " min";
    return {
      _type: "conversor",
      icon: a.icon,
      title: "Outro visitante",
      body: a.evento,
      time: tempo
    };
  }

  function buildEvent() {
    const r = Math.random();
    if (r < CONFIG.mix.atividade) return buildAtividade();
    if (r < CONFIG.mix.atividade + CONFIG.mix.marco) return buildMarco();
    return buildConversor();
  }

  /* ---------- RENDER ---------------------------------------- */
  // Helper: monta a linha "valor + tempo + ⓘ" com destaque cyan no preço
  // e disclaimer compactado num ⓘ com tooltip nativo.
  // Compartilhado entre showEvent (modo real) e showStacked (modo debug).
  function renderTimeLine(evt) {
    if (!evt.valor && !evt.time) {
      return '<div class="live-pulse-time"><span class="live-pulse-info" ' +
             'title="exemplos da atividade típica da rede AVEND" aria-label="info">ⓘ</span></div>';
    }
    let html = '<div class="live-pulse-time">';
    if (evt.valor) {
      html += '<span class="live-pulse-valor">' + escapeHtml(evt.valor) + '</span>';
      if (evt.time) html += ' · ';
    }
    if (evt.time) html += escapeHtml(evt.time);
    html += ' <span class="live-pulse-info" ' +
            'title="exemplos da atividade típica da rede AVEND" aria-label="info">ⓘ</span>';
    html += '</div>';
    return html;
  }

  function ensureContainer() {
    if (state.container) return state.container;
    const c = document.createElement("div");
    c.className = "live-pulse-container";
    c.setAttribute("aria-live", "polite");
    c.setAttribute("aria-atomic", "false");
    document.body.appendChild(c);
    state.container = c;
    return c;
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("live-pulse-toast-leaving");
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  function showEvent(evt) {
    const c = ensureContainer();

    // Remove o anterior se ainda estiver visível
    const old = c.querySelector(".live-pulse-toast:not(.live-pulse-toast-leaving)");
    if (old) dismissToast(old);

    const toast = document.createElement("div");
    toast.className = "live-pulse-toast live-pulse-toast-" + evt._type;
    toast.innerHTML =
      '<div class="live-pulse-icon" aria-hidden="true">' + evt.icon + '</div>' +
      '<div class="live-pulse-body">' +
        '<div class="live-pulse-title">' + escapeHtml(evt.title) + '</div>' +
        '<div class="live-pulse-text">' + escapeHtml(evt.body) + '</div>' +
        renderTimeLine(evt) +
      '</div>' +
      '<button type="button" class="live-pulse-close" aria-label="Fechar">×</button>';

    c.appendChild(toast);
    state.shown++;

    // Auto-dismiss
    const dismissTimer = setTimeout(function () { dismissToast(toast); }, CONFIG.autoDismissMs);

    // Click no X cancela auto-dismiss e remove
    const closeBtn = toast.querySelector(".live-pulse-close");
    closeBtn.addEventListener("click", function () {
      clearTimeout(dismissTimer);
      dismissToast(toast);
    });

    // Hover pausa o auto-dismiss (UX humanizado)
    toast.addEventListener("mouseenter", function () { clearTimeout(dismissTimer); });
    toast.addEventListener("mouseleave", function () {
      setTimeout(function () { dismissToast(toast); }, 1500);
    });

    // Telemetria
    if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
      root.TELEMETRY.track("live_pulse_shown", {
        type: evt._type, body: evt.body, num: state.shown
      });
    }
  }

  /* ---------- ORCHESTRATION --------------------------------- */
  function isPaused() {
    if (!document.body) return true;
    const cl = document.body.classList;
    return cl.contains("quiz-open") ||
           cl.contains("tour-open") ||
           cl.contains("mkt-gate-open") ||
           cl.contains("is-mkt-printing") ||
           cl.contains("live-pulse-off");
  }

  function scheduleNext() {
    if (state.shown >= CONFIG.maxPerSession) return;
    const delay = CONFIG.intervalMin +
                  Math.random() * (CONFIG.intervalMax - CONFIG.intervalMin);
    state.timer = setTimeout(tick, delay);
  }

  function tick() {
    if (state.shown >= CONFIG.maxPerSession) return;
    if (isPaused()) {
      // Adia 30s e tenta de novo
      state.timer = setTimeout(tick, CONFIG.pausedRecheckMs);
      return;
    }
    showEvent(buildEvent());
    scheduleNext();
  }

  /* ---------- INIT ------------------------------------------ */
  function init() {
    if (!CONFIG.enabled) return;

    // User pode ter desligado em sessão anterior
    try {
      if (localStorage.getItem("avend-live-pulse-off") === "1") {
        document.body.classList.add("live-pulse-off");
        return;
      }
    } catch (e) { /* ignore */ }

    state.timer = setTimeout(tick, CONFIG.startDelayMs);
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* Helper de debug: empilha vários toasts SEM o cleanup automático.
     Uso: criar toast direto sem chamar showEvent (que dismissa o anterior). */
  function showStacked(evt) {
    const c = ensureContainer();
    const toast = document.createElement("div");
    toast.className = "live-pulse-toast live-pulse-toast-" + evt._type;
    toast.innerHTML =
      '<div class="live-pulse-icon" aria-hidden="true">' + evt.icon + '</div>' +
      '<div class="live-pulse-body">' +
        '<div class="live-pulse-title">' + escapeHtml(evt.title) + '</div>' +
        '<div class="live-pulse-text">' + escapeHtml(evt.body) + '</div>' +
        renderTimeLine(evt) +
      '</div>' +
      '<button type="button" class="live-pulse-close" aria-label="Fechar">×</button>' +
      '<div class="live-pulse-disclaimer">exemplos da atividade típica da rede</div>';
    c.appendChild(toast);
    toast.querySelector(".live-pulse-close").addEventListener("click", function () {
      dismissToast(toast);
    });
    // Auto-dismiss um pouco mais longo no modo debug (12s)
    setTimeout(function () { dismissToast(toast); }, 12000);
  }

  // Expor API mínima pra debug/futuro
  root.AvendLivePulse = {
    show: function () { showEvent(buildEvent()); },     // força um agora (substitui anterior)
    pause: function () { document.body.classList.add("live-pulse-off"); },
    resume: function () { document.body.classList.remove("live-pulse-off"); },
    disablePermanently: function () {
      try { localStorage.setItem("avend-live-pulse-off", "1"); } catch (e) {}
      document.body.classList.add("live-pulse-off");
    },
    enableAgain: function () {
      try { localStorage.removeItem("avend-live-pulse-off"); } catch (e) {}
      document.body.classList.remove("live-pulse-off");
    },

    /* ----- DEBUG / DEMO -----
       demo(n)  → mostra n toasts em SEQUÊNCIA (1.2s entre cada).
                  Cada novo dismissa o anterior — vê todas as variantes
                  em ordem natural.
       stack(n) → mostra n toasts EMPILHADOS ao mesmo tempo (forçado).
                  Útil pra avaliar tipografia/cores lado-a-lado.
                  Default n=4. Ignora a regra de "1 por vez".              */
    demo: function (n) {
      n = n || 6;
      for (let i = 0; i < n; i++) {
        setTimeout(function () { showEvent(buildEvent()); }, i * 1200);
      }
    },
    stack: function (n) {
      n = n || 4;
      for (let i = 0; i < n; i++) {
        setTimeout(function () { showStacked(buildEvent()); }, i * 120);
      }
    }
  };
})(typeof window !== "undefined" ? window : this);
