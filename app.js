/* ============================================================
   AVEND Business Plan — App logic (modelo realista)
   Premissas:
   - Máquina estabiliza no mês 1 (sem ramp-up)
   - Implantação: lag de 1 mês (35-45 dias na prática)
   - Regime tributário dinâmico: MEI até R$ 130k/ano,
     Simples Nacional Anexo I progressivo acima
   - Abastecedor CLT (R$ 4k/mês) a cada 10 máquinas, a partir da 6ª
   - Perdas: 1% do faturamento
   - Custo real por nova máquina: 35k + reserva + 2k frete + 1,5k abastecimento
   ============================================================ */

const MODEL = {
  /* Custos variáveis (% do faturamento) */
  variavel: {
    cmv: 0.40,
    aluguelEspaco: 0.05,
    royalties: 0.05,
    taxaCartoes: 0.0145,
    operacionalRota: 0.03,
    perdas: 0.01
  },

  /* Royalty mínimo por máquina (COF):
     5% sobre faturamento, com piso de R$ 250 quando fat < R$ 5.000 */
  royaltyMinimo: 250,

  /* Custos fixos por máquina (R$/mês) */
  fixoPorMaquina: {
    fnp: 100,
    sistema: 95,
    manutencao: 100
  },

  /* CAPEX de aquisição (R$) */
  custoPrimeiraMaquina: 55000,       // franquia + 1ª máquina
  custoMaquinaAdicional: 35000,      // máquinas seguintes
  custoFreteNova: 2000,              // frete de instalação
  custoAbastecimentoInicial: 1500,   // estoque + setup inicial

  /* Patrimônio (ativo) — valor contábil/de mercado por máquina pertencente ao franqueado.
     Cada vending machine é ativo do franqueado: compõe o patrimônio do negócio. */
  valorAtivoPorMaquina: 28500,

  /* Regime tributário */
  mei: {
    limiteAnual: 130000,
    fixoMensal: 85
  },
  /* Simples Nacional Anexo I (comércio).
     Alíquota efetiva = (RBT12 × nominal - dedução) / RBT12 */
  simplesNacionalFaixas: [
    { teto:  180000, nominal: 0.0400, deducao:      0 },
    { teto:  360000, nominal: 0.0730, deducao:   5940 },
    { teto:  720000, nominal: 0.0950, deducao:  13860 },
    { teto: 1800000, nominal: 0.1070, deducao:  22500 },
    { teto: 3600000, nominal: 0.1430, deducao:  87300 },
    { teto: 4800000, nominal: 0.1900, deducao: 378000 }
  ],

  /* Operação escalável */
  abastecedor: {
    salarioMensal: 4000,           // CLT com encargos (aproximação)
    maqPorAbastecedor: 10,
    frotaMinParaContratar: 6       // 1-5 máquinas: franqueado faz a rota
  },

  horizonteMeses: 60
};

/* ---------- Helpers ---------- */
const fmtBRL = (v, opts = {}) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: opts.digits ?? 0 });
const fmtPct = (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

const pctVariavelTotal = () =>
  MODEL.variavel.cmv + MODEL.variavel.aluguelEspaco + MODEL.variavel.royalties +
  MODEL.variavel.taxaCartoes + MODEL.variavel.operacionalRota + MODEL.variavel.perdas;

const fixoPorMaquinaTotal = () =>
  MODEL.fixoPorMaquina.fnp + MODEL.fixoPorMaquina.sistema + MODEL.fixoPorMaquina.manutencao;

/* ---------- Imposto por regime ----------
   Decide o regime baseado no faturamento anualizado do mês
   (faturamento_mensal × 12). Para projeção é uma aproximação
   prática do RBT12 quando o regime está estabilizado.
*/
function calcImpostoMensal(faturamentoMensal) {
  const rbt12 = faturamentoMensal * 12;
  if (rbt12 <= MODEL.mei.limiteAnual) {
    return { regime: "MEI", valor: MODEL.mei.fixoMensal, aliquota: MODEL.mei.fixoMensal / faturamentoMensal };
  }
  for (const faixa of MODEL.simplesNacionalFaixas) {
    if (rbt12 <= faixa.teto) {
      const aliq = (rbt12 * faixa.nominal - faixa.deducao) / rbt12;
      return { regime: `Simples Nacional (até ${fmtBRL(faixa.teto)}/ano)`, valor: faturamentoMensal * aliq, aliquota: aliq };
    }
  }
  // Acima do Simples: LP (simplificação com alíquota efetiva média de ~25%)
  return { regime: "Lucro Presumido/Real", valor: faturamentoMensal * 0.25, aliquota: 0.25 };
}

/* ---------- Abastecedores necessários ---------- */
function abastecedoresNecessarios(frota) {
  if (frota < MODEL.abastecedor.frotaMinParaContratar) return 0;
  return Math.ceil((frota - 5) / MODEL.abastecedor.maqPorAbastecedor);
}

/* ---------- Cálculo mensal consolidado ---------- */
function calcularMes(frota, faturamentoPorMaquina) {
  const faturamentoTotal = frota * faturamentoPorMaquina;

  // Royalty: 5% por máquina, com piso de R$ 250 por máquina (COF)
  const royaltyPorMaq    = Math.max(faturamentoPorMaquina * MODEL.variavel.royalties, MODEL.royaltyMinimo);
  const royaltyTotal     = royaltyPorMaq * frota;

  // Outros variáveis (todos exceto royalty, que já é tratado com piso)
  const pctOutrosVar     = pctVariavelTotal() - MODEL.variavel.royalties;
  const outrosVariaveis  = faturamentoTotal * pctOutrosVar;
  const custoVariavel    = outrosVariaveis + royaltyTotal;

  const fixoMaqTotal     = frota * fixoPorMaquinaTotal();
  const nAbast           = abastecedoresNecessarios(frota);
  const custoAbast       = nAbast * MODEL.abastecedor.salarioMensal;
  const imposto          = calcImpostoMensal(faturamentoTotal);
  const lucroLiquido     = faturamentoTotal - custoVariavel - fixoMaqTotal - custoAbast - imposto.valor;

  return {
    faturamentoTotal,
    custoVariavel,
    royaltyTotal,
    royaltyPorMaq,
    fixoMaqTotal,
    custoAbast,
    nAbast,
    imposto,
    lucroLiquido,
    margem: lucroLiquido / faturamentoTotal
  };
}

/* ---------- Simulação com 2 fases de reinvestimento ----------
   Lógica: a 1ª máquina já foi comprada (CAPEX R$ 55k do bolso do
   franqueado). O caixa de reinvestimento começa em 0 e acumula o
   lucro mensal. Payback da 1ª é KPI separado, calculado sobre o
   lucro acumulado (não descontado do caixa de expansão).
*/
function simulate(params) {
  const {
    faturamentoPorMaquina,
    percReinvestFase1,
    duracaoFase1Meses,
    percReinvestFase2,
    reservaCapital,
    capacidadeImplantacao,
    horizonteMeses
  } = params;

  const H = horizonteMeses || MODEL.horizonteMeses;

  const custoNovaMaquina =
    MODEL.custoMaquinaAdicional +
    reservaCapital +
    MODEL.custoFreteNova +
    MODEL.custoAbastecimentoInicial;

  const linhas = [];
  let maquinasAtivas = 1;
  let maquinasPendentes = 0;
  let caixa = 0;                  // caixa de reinvestimento (não inclui CAPEX da 1ª)
  let lucroAcumulado = 0;         // para cálculo de payback da 1ª
  let contadorMaquinas = 1;
  let paybackMeses = null;

  for (let mes = 1; mes <= H; mes++) {
    if (maquinasPendentes > 0) {
      maquinasAtivas += maquinasPendentes;
      maquinasPendentes = 0;
    }

    const mensal = calcularMes(maquinasAtivas, faturamentoPorMaquina);
    lucroAcumulado += mensal.lucroLiquido;

    if (paybackMeses === null && lucroAcumulado >= MODEL.custoPrimeiraMaquina) {
      paybackMeses = mes;
    }

    const percReinvest = mes <= duracaoFase1Meses ? percReinvestFase1 : percReinvestFase2;
    const proLabore = mensal.lucroLiquido * (1 - percReinvest / 100);
    caixa += mensal.lucroLiquido * (percReinvest / 100);

    let compradasEsteMes = 0;
    const eventos = [];
    while (caixa >= custoNovaMaquina && compradasEsteMes < capacidadeImplantacao) {
      caixa -= custoNovaMaquina;
      maquinasPendentes += 1;
      compradasEsteMes += 1;
      contadorMaquinas += 1;
      eventos.push(`Compra da ${contadorMaquinas}ª máquina`);
    }

    linhas.push({
      mes,
      maquinasAtivas,
      faturamentoTotal: mensal.faturamentoTotal,
      custoVariavel: mensal.custoVariavel,
      fixoMaqTotal: mensal.fixoMaqTotal,
      custoAbast: mensal.custoAbast,
      nAbast: mensal.nAbast,
      imposto: mensal.imposto,
      lucroLiquido: mensal.lucroLiquido,
      proLabore,
      fase: mes <= duracaoFase1Meses ? 1 : 2,
      percReinvestAtivo: percReinvest,
      margem: mensal.margem,
      caixaAcumulado: caixa,
      lucroAcumulado,
      patrimonio: maquinasAtivas * MODEL.valorAtivoPorMaquina,
      evento: eventos.join(" · "),
      novasMaquinas: compradasEsteMes
    });
  }

  const totalProLabore = linhas.reduce((s, r) => s + r.proLabore, 0);
  const frotaFinal = linhas[linhas.length - 1].maquinasAtivas;

  return {
    linhas,
    custoNovaMaquina,
    paybackMeses,
    horizonteMeses: H,
    margem1Maq: linhas[0].margem,
    lucro1Maq: linhas[0].lucroLiquido,
    regime1Maq: linhas[0].imposto.regime,
    frotaFinal,
    lucroMensalFinal: linhas[linhas.length - 1].lucroLiquido,
    regimeFinal: linhas[linhas.length - 1].imposto.regime,
    totalProLabore,
    patrimonioFinal: frotaFinal * MODEL.valorAtivoPorMaquina,
    valorAtivoPorMaquina: MODEL.valorAtivoPorMaquina
  };
}

/* ---------- Estado + UI ---------- */
const state = {
  faturamentoPorMaquina: 10000,
  percReinvestFase1: 100,
  duracaoFase1Meses: 36,          // 3 anos em 100%
  percReinvestFase2: 50,          // depois 50% (começa a tirar pró-labore)
  reservaCapital: 5000,
  capacidadeImplantacao: 2,
  horizonteMeses: 60,
  charts: {}
};

function currentParams() {
  return {
    faturamentoPorMaquina: state.faturamentoPorMaquina,
    percReinvestFase1: state.percReinvestFase1,
    duracaoFase1Meses: state.duracaoFase1Meses,
    percReinvestFase2: state.percReinvestFase2,
    reservaCapital: state.reservaCapital,
    capacidadeImplantacao: state.capacidadeImplantacao,
    horizonteMeses: state.horizonteMeses
  };
}

/* ---------- Tab nav ---------- */
function activateTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === name));
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Re-render charts que podem ter sido inicializados enquanto a aba estava hidden
  if (name === "mercado") {
    requestAnimationFrame(() => {
      if (state.charts.density) state.charts.density.resize();
      else renderMarketChart();
    });
  } else {
    // Saiu da aba Mercado — limpa o ?cidade= da URL pra não ficar "viciada"
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("cidade")) {
        url.searchParams.delete("cidade");
        const newUrl = url.pathname + (url.search || "") + (url.hash || "");
        window.history.replaceState({}, "", newUrl);
      }
    } catch (e) { /* ignore */ }
  }

  // Telemetria
  if (typeof TELEMETRY !== "undefined") TELEMETRY.setTab(name);
}
function bindTabs() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));
  document.querySelectorAll("[data-goto]").forEach(el => el.addEventListener("click", (e) => {
    // se for link <a>, prevenir o jump pra "#"
    if (el.tagName === "A") e.preventDefault();
    activateTab(el.dataset.goto);
  }));
}

/* ---------- Sliders ---------- */
const SLIDER_BINDINGS = [
  ["input_faturamento_maq",         "out_faturamento_maq",         v => fmtBRL(v),         "faturamentoPorMaquina"],
  ["input_reinvest_fase1",          "out_reinvest_fase1",          v => v + "%",           "percReinvestFase1"],
  ["input_duracao_fase1",           "out_duracao_fase1",           v => formatDuracao(v),  "duracaoFase1Meses"],
  ["input_reinvest_fase2",          "out_reinvest_fase2",          v => v + "%",           "percReinvestFase2"],
  ["input_reserva_capital",         "out_reserva_capital",         v => fmtBRL(v),         "reservaCapital"],
  ["input_capacidade_implantacao",  "out_capacidade_implantacao",  v => v + "/mês",        "capacidadeImplantacao"],
  ["input_horizonte",               "out_horizonte",               v => (v/12).toFixed(0) + " anos", "horizonteMeses"]
];

function formatDuracao(meses) {
  if (meses % 12 === 0) return (meses/12) + " ano" + (meses/12 > 1 ? "s" : "");
  return meses + " meses";
}

function bindSliders() {
  SLIDER_BINDINGS.forEach(([inputId, outputId, fmt, stateKey]) => {
    const input  = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (!input || !output) return;
    input.value = state[stateKey];
    output.textContent = fmt(Number(input.value));
    input.addEventListener("input", () => {
      const v = Number(input.value);
      const prev = state[stateKey];
      state[stateKey] = v;
      output.textContent = fmt(v);
      updateCenarioLabel();
      renderAll();
      if (typeof TELEMETRY !== "undefined") TELEMETRY.trackSliderChange(stateKey, prev, v);
    });
  });

  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const preset = chip.dataset.preset;
      if (preset === "conservador") Object.assign(state, {
        faturamentoPorMaquina: 7000,  percReinvestFase1: 100, duracaoFase1Meses: 36,
        percReinvestFase2: 50,        reservaCapital: 5000,  capacidadeImplantacao: 1,
        horizonteMeses: 60
      });
      if (preset === "base") Object.assign(state, {
        faturamentoPorMaquina: 10000, percReinvestFase1: 100, duracaoFase1Meses: 36,
        percReinvestFase2: 50,        reservaCapital: 5000,  capacidadeImplantacao: 2,
        horizonteMeses: 60
      });
      if (preset === "otimista") Object.assign(state, {
        faturamentoPorMaquina: 15000, percReinvestFase1: 100, duracaoFase1Meses: 48,
        percReinvestFase2: 70,        reservaCapital: 5000,  capacidadeImplantacao: 3,
        horizonteMeses: 60
      });
      if (preset === "turbo") Object.assign(state, {
        faturamentoPorMaquina: 12000, percReinvestFase1: 100, duracaoFase1Meses: 60,
        percReinvestFase2: 100,       reservaCapital: 5000,  capacidadeImplantacao: 3,
        horizonteMeses: 84
      });
      syncInputsFromState();
      updateCenarioLabel();
      renderAll();
      if (typeof TELEMETRY !== "undefined") TELEMETRY.trackPreset(preset);
    });
  });
}

function syncInputsFromState() {
  SLIDER_BINDINGS.forEach(([inputId, outputId, fmt, stateKey]) => {
    const input  = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (!input || !output) return;
    input.value = state[stateKey];
    output.textContent = fmt(state[stateKey]);
  });
}

function updateCenarioLabel() {
  const label = document.getElementById("cenario-label");
  if (!label) return;
  const v = state.faturamentoPorMaquina;
  let nome = "Customizado";
  let key  = "custom";
  if (v === 10000)      { nome = "Base";          key = "base"; }
  else if (v === 15000) { nome = "Otimista";      key = "otimista"; }
  else if (v === 7000)  { nome = "Conservador";   key = "conservador"; }
  else if (v === 12000) { nome = "Turbo ⚡";       key = "turbo"; }
  label.textContent = `${nome} · ${fmtBRL(v)}/máq`;
  // tag visual no chip pai
  const chip = label.closest(".cenario-chip");
  if (chip) chip.dataset.cenario = key;
}

/* ---------- Count-up numérico nos KPIs ---------- */
function countUp(el, from, to, duration, format) {
  if (el._raf) cancelAnimationFrame(el._raf);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const v = from + (to - from) * eased;
    el.textContent = format(v);
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

function setKpiAnimated(id, to, format) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = el._lastVal ?? 0;
  countUp(el, prev, to, 700, format);
  el._lastVal = to;
}

/* ---------- KPIs / Overview + mini ---------- */
function renderKPIs(sim) {
  const anos = Math.round(sim.horizonteMeses / 12);

  // Título dinâmico da seção Simulador
  const simTitle = document.getElementById("sim-title-horizonte");
  if (simTitle) {
    const h = sim.horizonteMeses;
    simTitle.textContent = h % 12 === 0 ? `${h/12} Anos` : `${h} Meses`;
  }

  setKpiAnimated("kpi-payback", sim.paybackMeses ?? 0,
    v => sim.paybackMeses ? `${Math.round(v)} meses` : "—");
  setKpiAnimated("kpi-margem", sim.margem1Maq, v => fmtPct(v));
  setKpiAnimated("kpi-maquinas", sim.frotaFinal,
    v => `${Math.round(v)} máquina${Math.round(v) > 1 ? "s" : ""}`);
  setKpiAnimated("kpi-lucro-final", sim.lucroMensalFinal, v => fmtBRL(v));

  // Hints dinâmicos do horizonte
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setText("kpi-maq-hint", `Após ${anos} ano${anos>1?"s":""}`);
  setText("kpi-lucro-hint", `Mês ${sim.horizonteMeses} · operação madura`);

  setKpiAnimated("mini-lucro-maq", sim.lucro1Maq, v => fmtBRL(v));
  setKpiAnimated("mini-custo-nova", sim.custoNovaMaquina, v => fmtBRL(v));
  setKpiAnimated("mini-frota-final", sim.frotaFinal, v => `${Math.round(v)} un.`);
  setKpiAnimated("mini-lucro-final", sim.lucroMensalFinal, v => fmtBRL(v));
  setKpiAnimated("mini-prolabore", sim.totalProLabore, v => fmtBRL(v));
  setKpiAnimated("mini-patrimonio", sim.patrimonioFinal, v => fmtBRL(v));

  // Stat strip do overview
  const lucroCumul = sim.linhas[sim.linhas.length - 1].lucroAcumulado;
  setKpiAnimated("strip-capex", sim.custoNovaMaquina, v => fmtBRL(v));
  setKpiAnimated("strip-lucro-cumul", lucroCumul, v => fmtBRL(v));
  setKpiAnimated("strip-prolabore", sim.totalProLabore, v => fmtBRL(v));
  setKpiAnimated("strip-patrimonio", sim.patrimonioFinal, v => fmtBRL(v));

  // Info tributária dinâmica no hero
  const regimeHint = document.getElementById("kpi-regime-hint");
  if (regimeHint) {
    regimeHint.textContent =
      `Regime mês 1: ${sim.regime1Maq} · regime final (mês ${sim.horizonteMeses}): ${sim.regimeFinal}`;
  }
}

/* ---------- Tabela detalhada ---------- */
function renderTable(sim) {
  const tbody = document.getElementById("sim-tbody");
  tbody.innerHTML = sim.linhas.map(row => {
    const aliquota = row.imposto.aliquota;
    const faseClass = row.fase === 1 ? "fase-1" : "fase-2";
    const faseLabel = row.fase === 1 ? "F1" : "F2";
    const reinvLucro = row.lucroLiquido * (row.percReinvestAtivo / 100);
    return `
      <tr>
        <td>${row.mes}</td>
        <td><span class="fase-badge ${faseClass}">${faseLabel} · ${row.percReinvestAtivo}%</span></td>
        <td>${row.maquinasAtivas}</td>
        <td>${fmtBRL(row.faturamentoTotal)}</td>
        <td>${fmtBRL(row.imposto.valor)} <span class="muted">(${fmtPct(aliquota)})</span></td>
        <td>${fmtBRL(row.lucroLiquido)} <span class="muted">(${fmtPct(row.margem)})</span></td>
        <td>${fmtBRL(reinvLucro)} ${row.proLabore > 0 ? `<span class="muted">/ ${fmtBRL(row.proLabore)}</span>` : ""}</td>
        <td>${fmtBRL(row.caixaAcumulado)}</td>
        <td class="patrimonio-cell">${fmtBRL(row.patrimonio)}</td>
        <td class="${row.evento ? "evt" : ""}">${row.evento || ""}</td>
      </tr>
    `;
  }).join("");
}

/* ---------- Timeline ---------- */
function renderTimeline(sim) {
  const container = document.getElementById("timeline-list");
  const marcos = sim.linhas.filter(r => r.novasMaquinas > 0);

  const html = [`
    <div class="tl-item">
      <div class="tl-month">Mês 1</div>
      <div class="tl-title">Abertura da 1ª máquina AVEND</div>
      <div class="tl-meta">
        <span>Investimento inicial: <strong>${fmtBRL(MODEL.custoPrimeiraMaquina)}</strong></span>
        <span>Regime: <strong>${sim.regime1Maq}</strong></span>
        <span>Lucro/mês: <strong>${fmtBRL(sim.lucro1Maq)}</strong></span>
        <span>Margem: <strong>${fmtPct(sim.margem1Maq)}</strong></span>
      </div>
    </div>
  `];

  if (sim.paybackMeses) {
    html.push(`
      <div class="tl-item">
        <div class="tl-month">Mês ${sim.paybackMeses}</div>
        <div class="tl-title">Payback da 1ª máquina</div>
        <div class="tl-meta"><span>Investimento de ${fmtBRL(MODEL.custoPrimeiraMaquina)} recuperado.</span></div>
      </div>
    `);
  }

  marcos.forEach(r => {
    const ativacao = r.mes + 1;
    const proximaLinha = sim.linhas.find(l => l.mes === ativacao);
    const frotaDepois = proximaLinha ? proximaLinha.maquinasAtivas : r.maquinasAtivas + r.novasMaquinas;
    const lucroProj = proximaLinha ? proximaLinha.lucroLiquido : null;
    html.push(`
      <div class="tl-item">
        <div class="tl-month">Mês ${r.mes} → ativação mês ${ativacao}</div>
        <div class="tl-title">${r.evento}</div>
        <div class="tl-meta">
          <span>Máquinas após ativação: <strong>${frotaDepois} un.</strong></span>
          ${lucroProj != null ? `<span>Lucro projetado: <strong>${fmtBRL(lucroProj)}</strong></span>` : ""}
          <span>CAPEX unit.: <strong>${fmtBRL(sim.custoNovaMaquina)}</strong></span>
        </div>
      </div>
    `);
  });

  if (marcos.length === 0) {
    html.push(`
      <div class="tl-item">
        <div class="tl-month">—</div>
        <div class="tl-title">Nenhuma nova aquisição neste cenário</div>
        <div class="tl-meta"><span>Ajuste os inputs para acelerar a expansão.</span></div>
      </div>
    `);
  }

  container.innerHTML = html.join("");
}

/* ---------- Comparador de modelos dinâmico ---------- */
function renderComparador(sim) {
  // Com 1 máquina e 2 máquinas no faturamento atual
  const fat = state.faturamentoPorMaquina;
  const m1 = calcularMes(1, fat);
  const m2 = calcularMes(2, fat);
  const paybackM1 = MODEL.custoPrimeiraMaquina / m1.lucroLiquido;
  const paybackM2 = sim.custoNovaMaquina / m2.lucroLiquido;

  const el = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };

  el("cmp-m1-invest",  fmtBRL(MODEL.custoPrimeiraMaquina));
  el("cmp-m1-payback", `${Math.round(paybackM1)} meses`);
  el("cmp-m1-lucro",   fmtBRL(m1.lucroLiquido));
  el("cmp-m1-regime",  m1.imposto.regime.split(" (")[0]);

  el("cmp-m2-invest",  fmtBRL(sim.custoNovaMaquina));
  el("cmp-m2-payback", `${Math.round(paybackM2)} meses`);
  el("cmp-m2-lucro",   fmtBRL(m2.lucroLiquido));
  el("cmp-m2-regime",  m2.imposto.regime.split(" (")[0]);

  // Tabela comparativa
  el("cmp-tab-invest-1", fmtBRL(MODEL.custoPrimeiraMaquina));
  el("cmp-tab-invest-2", fmtBRL(sim.custoNovaMaquina));
  el("cmp-tab-payback-1", `${Math.round(paybackM1)} meses`);
  el("cmp-tab-payback-2", `${Math.round(paybackM2)} meses`);
  el("cmp-tab-lucro-1", fmtBRL(m1.lucroLiquido));
  el("cmp-tab-lucro-2", fmtBRL(m2.lucroLiquido));
  el("cmp-tab-margem-1", fmtPct(m1.margem));
  el("cmp-tab-margem-2", fmtPct(m2.margem));
  el("cmp-tab-regime-1", m1.imposto.regime.split(" (")[0]);
  el("cmp-tab-regime-2", m2.imposto.regime.split(" (")[0]);
}

/* ---------- Charts ---------- */
const CHART_DEFAULTS = {
  plugins: {
    legend: { labels: { color: "#a7adca", font: { family: "Inter", size: 12 } } },
    tooltip: {
      backgroundColor: "rgba(10,13,36,0.95)",
      borderColor: "rgba(139,48,230,0.5)",
      borderWidth: 1,
      titleColor: "#eef1ff",
      bodyColor: "#a7adca",
      padding: 10
    }
  },
  scales: {
    x: { ticks: { color: "#6d7396", font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.04)" } },
    y: { ticks: { color: "#6d7396", font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.06)" } }
  }
};

function gradient(ctx, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, 280);
  stops.forEach(([pos, color]) => g.addColorStop(pos, color));
  return g;
}
function destroyIfExists(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

/* ---------- Tooltip rico estilo Google Finance ----------
   External HTML tooltip que mostra todos os dados daquele mês:
   máquinas, faturamento, imposto, lucro, fase, eventos.
*/
function getOrCreateRichTooltip() {
  let el = document.getElementById("rich-tooltip");
  if (!el) {
    el = document.createElement("div");
    el.id = "rich-tooltip";
    el.className = "rich-tooltip";
    document.body.appendChild(el);
  }
  return el;
}

function richTooltipHandler(currentSim) {
  return function(context) {
    const tooltipEl = getOrCreateRichTooltip();
    const tooltip = context.tooltip;

    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = 0;
      tooltipEl.style.pointerEvents = "none";
      return;
    }

    const idx = tooltip.dataPoints[0]?.dataIndex;
    if (idx == null || !currentSim?.linhas?.[idx]) return;
    const r = currentSim.linhas[idx];

    const fase = r.fase === 1 ? "F1" : "F2";
    const faseTone = r.fase === 1 ? "fase-1" : "fase-2";
    const reinvestPct = r.percReinvestAtivo;
    const proLab = r.proLabore > 0 ? r.proLabore : 0;

    tooltipEl.innerHTML = `
      <header class="rt-head">
        <span class="rt-mes">Mês ${r.mes}</span>
        <span class="rt-fase ${faseTone}">${fase} · ${reinvestPct}% reinvest</span>
      </header>
      <div class="rt-body">
        <div class="rt-row"><span>Máquinas</span><strong>${r.maquinasAtivas} un</strong></div>
        <div class="rt-row"><span>Faturamento</span><strong>${fmtBRL(r.faturamentoTotal)}</strong></div>
        <div class="rt-row"><span>Imposto (${(r.imposto.aliquota * 100).toFixed(1).replace(".", ",")}%)</span><strong class="rt-neg">−${fmtBRL(r.imposto.valor)}</strong></div>
        <div class="rt-row rt-row-hl"><span>Lucro líquido</span><strong class="rt-pos">${fmtBRL(r.lucroLiquido)}</strong></div>
        ${proLab > 0 ? `<div class="rt-row"><span>Pró-labore</span><strong>${fmtBRL(proLab)}</strong></div>` : ""}
        <div class="rt-row"><span>Caixa expansão</span><strong>${fmtBRL(r.caixaAcumulado)}</strong></div>
        <div class="rt-row"><span>Patrimônio</span><strong class="rt-asset">${fmtBRL(r.patrimonio)}</strong></div>
        ${r.evento ? `<div class="rt-event">⭐ ${r.evento}</div>` : ""}
      </div>
      <footer class="rt-foot">
        Margem ${(r.margem * 100).toFixed(1).replace(".", ",")}% · ${r.imposto.regime.split(" (")[0]}
      </footer>
    `;

    const canvasRect = context.chart.canvas.getBoundingClientRect();
    const x = canvasRect.left + window.scrollX + tooltip.caretX;
    const y = canvasRect.top + window.scrollY + tooltip.caretY;

    // Smart positioning: keep tooltip inside viewport
    tooltipEl.style.opacity = 1;
    tooltipEl.style.pointerEvents = "none";
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top  = y + "px";
    // Position via translate (mais performático)
    requestAnimationFrame(() => {
      const tw = tooltipEl.offsetWidth;
      const th = tooltipEl.offsetHeight;
      let translateX = 14;
      let translateY = -th / 2;
      if (x + tw + 24 > window.innerWidth) translateX = -tw - 14;
      if (y + translateY < 8) translateY = 8 - (y - canvasRect.top);
      tooltipEl.style.transform = `translate(${translateX}px, ${translateY}px)`;
    });
  };
}

function renderCharts(sim) {
  const labels = sim.linhas.map(r => r.mes);
  const frota = sim.linhas.map(r => r.maquinasAtivas);
  const faturamento = sim.linhas.map(r => r.faturamentoTotal);
  const lucro = sim.linhas.map(r => r.lucroLiquido);
  const imposto = sim.linhas.map(r => r.imposto.valor);
  const caixa = sim.linhas.map(r => r.caixaAcumulado);

  const tooltipHandler = richTooltipHandler(sim);

  /* Frota */
  destroyIfExists("frota");
  const ctxF = document.getElementById("chart-frota").getContext("2d");
  state.charts.frota = new Chart(ctxF, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Máquinas ativas",
        data: frota,
        borderColor: "#3DD9D6",
        backgroundColor: gradient(ctxF, [[0, "rgba(61,217,214,0.35)"], [1, "rgba(61,217,214,0.0)"]]),
        fill: true, tension: 0.28, borderWidth: 3,
        pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: "#fff", pointHoverBorderColor: "#8B30E6"
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, ...CHART_DEFAULTS,
      interaction: { mode: "index", intersect: false, axis: "x" },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: { enabled: false, external: tooltipHandler }
      },
      scales: { ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 1 } } }
    }
  });

  /* Financeiro: Faturamento + Lucro + Imposto */
  destroyIfExists("financeiro");
  const ctxFin = document.getElementById("chart-financeiro").getContext("2d");
  state.charts.financeiro = new Chart(ctxFin, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Faturamento bruto", data: faturamento,
          borderColor: "#4B6CE2",
          backgroundColor: gradient(ctxFin, [[0, "rgba(75,108,226,0.30)"], [1, "rgba(75,108,226,0.0)"]]),
          fill: true, tension: 0.28, borderWidth: 3, pointRadius: 0 },
        { label: "Lucro líquido", data: lucro,
          borderColor: "#39e887",
          backgroundColor: gradient(ctxFin, [[0, "rgba(57,232,135,0.35)"], [1, "rgba(57,232,135,0.0)"]]),
          fill: true, tension: 0.28, borderWidth: 3, pointRadius: 0 },
        { label: "Imposto (DAS/MEI)", data: imposto,
          borderColor: "#ffb020",
          backgroundColor: "rgba(255,176,32,0.08)",
          fill: true, tension: 0.28, borderWidth: 2, pointRadius: 0, borderDash: [6,4] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, ...CHART_DEFAULTS,
      interaction: { mode: "index", intersect: false, axis: "x" },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: { enabled: false, external: tooltipHandler }
      },
      scales: { ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => fmtBRL(v) } } }
    }
  });

  /* Caixa com marcadores */
  destroyIfExists("caixa");
  const ctxC = document.getElementById("chart-caixa").getContext("2d");
  const marcadores = sim.linhas.map(r => r.novasMaquinas > 0 ? r.caixaAcumulado + sim.custoNovaMaquina : null);
  const pointRadius = sim.linhas.map(r => r.novasMaquinas > 0 ? 7 : 0);
  const pointColors = sim.linhas.map(r => r.novasMaquinas > 0 ? "#ffb020" : "transparent");
  state.charts.caixa = new Chart(ctxC, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Caixa acumulado", data: caixa,
          borderColor: "#8B30E6",
          backgroundColor: gradient(ctxC, [[0, "rgba(139,48,230,0.30)"], [1, "rgba(139,48,230,0.0)"]]),
          fill: true, tension: 0.28, borderWidth: 3,
          pointRadius: 0, pointHoverRadius: 5 },
        { label: "Aquisição de máquina", data: marcadores,
          borderColor: "transparent", backgroundColor: "#ffb020",
          pointRadius, pointHoverRadius: 9,
          pointBackgroundColor: pointColors,
          pointBorderColor: "#fff", pointBorderWidth: 2,
          showLine: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, ...CHART_DEFAULTS,
      interaction: { mode: "index", intersect: false, axis: "x" },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: { enabled: false, external: tooltipHandler }
      },
      scales: { ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => fmtBRL(v) } } }
    }
  });
}

/* ---------- Unit Economics — decomposição do faturamento ---------- */
function renderUnitEconomics(sim) {
  const fat = state.faturamentoPorMaquina;
  const m = calcularMes(1, fat);
  const v = MODEL.variavel;

  const items = [
    { key: "cmv",       label: "CMV (produtos)", valor: fat * v.cmv,           color: "#8B30E6" },
    { key: "aluguel",   label: "Aluguel do ponto", valor: fat * v.aluguelEspaco, color: "#4B6CE2" },
    { key: "royalties", label: "Royalties",       valor: m.royaltyPorMaq,        color: "#3DD9D6" },
    { key: "cartoes",   label: "Taxa de cartões", valor: fat * v.taxaCartoes,   color: "#61a5ff" },
    { key: "rota",      label: "Operacional de rota", valor: fat * v.operacionalRota, color: "#b88cff" },
    { key: "perdas",    label: "Perdas/vandalismo",   valor: fat * v.perdas,    color: "#ff7aa2" },
    { key: "fixos",     label: "Fixos por máquina",   valor: fixoPorMaquinaTotal(), color: "#ffb020" },
    { key: "imposto",   label: `Imposto (${m.imposto.regime.split(" (")[0]})`, valor: m.imposto.valor, color: "#ff8f3a" },
    { key: "lucro",     label: "Lucro líquido",   valor: m.lucroLiquido, color: "#39e887", lucro: true }
  ];

  // Barra horizontal
  const bar = document.getElementById("unit-econ-bar");
  if (bar) {
    bar.innerHTML = items.map(it => {
      const pct = Math.max(0, (it.valor / fat) * 100);
      return `<span style="width:${pct}%; background:${it.color};" title="${it.label}: ${fmtBRL(it.valor)} (${pct.toFixed(1)}%)"></span>`;
    }).join("");
  }

  // Cards de decomposição
  const grid = document.getElementById("unit-econ-grid");
  if (grid) {
    grid.innerHTML = items.map(it => {
      const pct = ((it.valor / fat) * 100).toFixed(1).replace(".", ",");
      return `
        <div class="unit-econ-item ue-item ${it.lucro ? "lucro" : ""}" style="--ue-color: ${it.color};">
          <div class="ue-header">
            <span class="ue-swatch"></span>
            <span class="ue-label">${it.label}</span>
          </div>
          <div class="ue-value">${fmtBRL(it.valor)}</div>
          <div class="ue-pct">${pct}% do faturamento</div>
        </div>
      `;
    }).join("");
  }
}

/* ---------- Render principal ---------- */
function renderAll() {
  const sim = simulate(currentParams());
  renderKPIs(sim);
  renderTable(sim);
  renderTimeline(sim);
  renderComparador(sim);
  renderUnitEconomics(sim);
  renderCharts(sim);
}

/* ---------- Mercado: gráfico de densidade global ---------- */
function renderMarketChart() {
  const ctxEl = document.getElementById("mkt-chart-density");
  if (!ctxEl) return;
  if (state.charts.density) state.charts.density.destroy();

  const ctx = ctxEl.getContext("2d");
  // hab por máquina — quanto MENOR, mais maduro o mercado
  const data = [
    { country: "Japão",          hab: 25,    color: "#39e887" },
    { country: "EUA",            hab: 65,    color: "#3DD9D6" },
    { country: "Coreia do Sul",  hab: 65,    color: "#3DD9D6" },
    { country: "China",          hab: 500,   color: "#4B6CE2" },
    { country: "Brasil",         hab: 2500,  color: "#ffb020" }
  ];

  state.charts.density = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => d.country),
      datasets: [{
        label: "Habitantes por máquina",
        data: data.map(d => d.hab),
        backgroundColor: data.map(d => d.color + "DD"),
        borderColor: data.map(d => d.color),
        borderWidth: 2,
        borderRadius: 8
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` 1 máquina para cada ${ctx.parsed.x.toLocaleString("pt-BR")} habitantes`
          },
          backgroundColor: "rgba(7,8,42,0.95)",
          borderColor: "rgba(139,48,230,0.45)",
          borderWidth: 1,
          padding: 12,
          titleColor: "#eef1ff",
          bodyColor: "#eef1ff"
        }
      },
      scales: {
        x: {
          type: "logarithmic",
          ticks: {
            color: "#a7adca",
            callback: (v) => v.toLocaleString("pt-BR")
          },
          grid: { color: "rgba(139,48,230,0.10)" },
          title: {
            display: true,
            text: "habitantes por máquina (escala logarítmica · menor = mais maduro)",
            color: "#a7adca",
            font: { size: 11 }
          }
        },
        y: {
          ticks: { color: "#eef1ff", font: { weight: 600 } },
          grid: { display: false }
        }
      }
    }
  });
}

/* ============================================================
   QUIZ — Diagnóstico de perfil de investidor
   Mapeia respostas → parâmetros calibrados do simulador.
   Lógica determinística, debugável, com rationale legível.
   ============================================================ */

const QUIZ_QUESTIONS = [
  {
    id: "atividade",
    title: "Qual sua situação profissional hoje?",
    hint: "Ajuda a entender seu contexto e calibrar a abordagem do nosso time.",
    options: [
      { value: "clt",          icon: "💼", title: "CLT (carteira assinada)",
        desc: "Trabalho com vínculo formal e quero diversificar a renda." },
      { value: "autonomo",     icon: "🛠", title: "Autônomo / freelancer",
        desc: "Trabalho por conta — médico, advogado, consultor, prestador, etc." },
      { value: "empresario",   icon: "🏢", title: "Empresário / sócio",
        desc: "Já tenho negócio próprio rodando e quero expandir/diversificar." },
      { value: "aposentado",   icon: "🌴", title: "Aposentado / pensionista",
        desc: "Quero usar o tempo e capital pra construir algo." },
      { value: "transicao",    icon: "🪜", title: "Em transição",
        desc: "Saindo de um trabalho, planejando o próximo passo." }
    ]
  },
  {
    id: "experiencia",
    title: "Você já investiu em franquia ou negócio próprio?",
    hint: "Sem julgamento — ajuda nosso time a calibrar a complexidade da explicação.",
    options: [
      { value: "primeira",     icon: "🌱", title: "Será meu primeiro",
        desc: "Sem experiência prévia. Vou precisar de orientação completa." },
      { value: "ja-tive",      icon: "📚", title: "Já tive negócio próprio",
        desc: "Tenho ou tive um negócio (não-franquia), conheço a operação básica." },
      { value: "ja-franquia",  icon: "🏆", title: "Já tenho/tive franquia",
        desc: "Conheço o modelo de franquia e já operei pelo menos uma." },
      { value: "investidor",   icon: "📈", title: "Sou investidor",
        desc: "Avalio negócios como investimento — comparo retorno e risco." }
    ]
  },
  {
    id: "objetivo",
    title: "O que você quer construir com a AVEND?",
    hint: "Não tem resposta certa. Suas escolhas moldam a projeção pra você.",
    options: [
      { value: "renda-extra",  icon: "💼", title: "Uma renda extra",
        desc: "Mantenho minha atividade principal e diversifico com algo passivo." },
      { value: "sair-clt",     icon: "🪜", title: "Sair da CLT em alguns anos",
        desc: "Construir uma operação que substitua meu salário aos poucos." },
      { value: "viver-disso",  icon: "🌟", title: "Viver disso integralmente",
        desc: "Quero que essa seja minha principal fonte de renda — desde o início." },
      { value: "patrimonio",   icon: "🏗", title: "Construir patrimônio escalável",
        desc: "Reinvestir tudo, escalar agressivamente, montar uma rede grande." }
    ]
  },
  {
    id: "capital",
    title: "Quanto capital adicional você tem nos próximos 12 meses?",
    hint: "Além dos R$ 55k da 1ª máquina. Capital que pode acelerar a expansão sem depender só do reinvestimento.",
    options: [
      { value: "so-1a",   icon: "🌱", title: "Só a 1ª máquina",
        desc: "R$ 55k iniciais. Quero que o próprio negócio gere caixa para crescer." },
      { value: "50-100",  icon: "🌿", title: "R$ 50–100 mil adicionais",
        desc: "Posso comprar 1–2 máquinas extras nos primeiros meses se fizer sentido." },
      { value: "100-300", icon: "🌳", title: "R$ 100–300 mil adicionais",
        desc: "Capital pra acelerar sem depender só do reinvestimento." },
      { value: "300+",    icon: "🚀", title: "Acima de R$ 300 mil",
        desc: "Quero montar uma operação grande desde o início." }
    ]
  },
  {
    id: "reinvest",
    title: "O lucro que vier — você consegue reinvestir?",
    hint: "Pensando nos primeiros 2–3 anos. Quanto mais reinvest, mais rápido o flywheel acelera.",
    options: [
      { value: "preciso-tirar",  icon: "🏠", title: "Vou precisar tirar pra viver",
        desc: "Conto com essa renda no orçamento mensal desde o início." },
      { value: "meio-meio",      icon: "⚖", title: "Posso reinvestir 70–80%",
        desc: "Aceito tirar uma parte, mas a maior parte volta pro negócio." },
      { value: "reinvesto-tudo", icon: "🔁", title: "Reinvesto 100% nos primeiros anos",
        desc: "Tenho outras fontes de renda, deixo a operação rodar sozinha pra escalar." }
    ]
  },
  {
    id: "meta",
    title: "Quanto você quer ter de lucro mensal em 5 anos?",
    hint: "Lucro líquido depois de impostos. Vamos calibrar o plano para perseguir isso.",
    options: [
      { value: "ate-15k",  icon: "💵", title: "R$ 5–15 mil/mês",
        desc: "Substituir um salário ou complementar a renda da família." },
      { value: "15-50k",   icon: "💰", title: "R$ 15–50 mil/mês",
        desc: "Renda confortável, equivalente a um cargo médio-alto." },
      { value: "50-150k",  icon: "💸", title: "R$ 50–150 mil/mês",
        desc: "Renda de empresário com operação de médio porte." },
      { value: "150+",     icon: "🏆", title: "Acima de R$ 150 mil/mês",
        desc: "Construir uma operação grande, com equipe estruturada." }
    ]
  },
  {
    id: "horizonte",
    title: "Em quanto tempo você quer atingir essa meta?",
    hint: "Quanto mais tempo, mais o flywheel de reinvestimento trabalha a seu favor.",
    options: [
      { value: "3",  icon: "⏰", title: "3 anos",
        desc: "Quero acelerar — meta agressiva no curto prazo." },
      { value: "5",  icon: "🗓", title: "5 anos",
        desc: "Horizonte equilibrado, é o que a maioria escolhe." },
      { value: "7",  icon: "📅", title: "7 anos",
        desc: "Construir com calma, sem pressa." },
      { value: "10", icon: "🏛", title: "10 anos",
        desc: "Maratona — patrimônio sólido, risco controlado." }
    ]
  },
  {
    id: "dedicacao",
    title: "Quanto tempo você pretende dedicar à operação?",
    hint: "AVEND tem suporte e telemetria, mas envolvimento ativo do franqueado é o que gera resultado.",
    options: [
      { value: "horas-semana", icon: "⏳", title: "Algumas horas por semana",
        desc: "Negócio paralelo. Supervisão remota, abastecedor faz a rota." },
      { value: "meio-periodo", icon: "🕐", title: "Meio período",
        desc: "Posso visitar pontos, negociar locais, acompanhar de perto." },
      { value: "integral",     icon: "💪", title: "Tempo integral",
        desc: "Quero que essa seja minha atividade principal." }
    ]
  },
  {
    id: "risco",
    title: "Como você se sente com risco em investimentos?",
    hint: "Não muda a operação em si — calibra a velocidade da expansão sugerida.",
    options: [
      { value: "conservador", icon: "🛡", title: "Prefiro segurança",
        desc: "Aceito retorno menor em troca de previsibilidade." },
      { value: "equilibrado", icon: "⚖", title: "Equilibrado",
        desc: "Aceito risco calculado se a recompensa for proporcional." },
      { value: "arrojado",    icon: "🎲", title: "Tenho perfil arrojado",
        desc: "Disposto a apostar mais alto se a oportunidade compensar." }
    ]
  },
  {
    id: "prontidao",
    title: "Em quanto tempo você quer começar?",
    hint: "Última pergunta. Essa resposta nos diz se você está pronto pra agir ou ainda em fase de pesquisa.",
    options: [
      { value: "ja",          icon: "⚡", title: "Quero começar agora",
        desc: "Tenho capital e estou decidido. Quanto antes, melhor." },
      { value: "30-dias",     icon: "📅", title: "Nas próximas semanas",
        desc: "Estou alinhando os últimos detalhes — pronto pra avançar." },
      { value: "3-meses",     icon: "🗓", title: "Nos próximos 3 meses",
        desc: "Estou organizando capital ou aguardando momento certo." },
      { value: "pesquisando", icon: "🔎", title: "Ainda pesquisando",
        desc: "Comparando opções, sem urgência. Quero entender melhor antes." }
    ]
  }
];

/* ---------- Mapeamento de respostas → parâmetros do simulador ---------- */
/* ============================================================
   CALC SUGGESTION v2 — Lógica ponderada com prioridades claras
   ============================================================
   Em vez de "última regra ganha", calculamos um SCORE DE AMBIÇÃO
   (0-10) ponderando todas as respostas. Esse score guia os parâmetros
   finais de forma coerente.

   Detectamos contradições e:
   - quando há sinais conflitantes, prevalece a INTENÇÃO PRIMÁRIA
     (objetivo + meta) sobre detalhes operacionais
   - registramos warnings no rationale
   ============================================================ */

const AMBITION_WEIGHTS = {
  objetivo:   { "renda-extra": 1, "sair-clt": 4, "viver-disso": 7, "patrimonio": 10 },
  meta:       { "ate-15k": 1,    "15-50k": 4,   "50-150k": 7,    "150+": 10 },
  capital:    { "so-1a": 1,      "50-100": 4,   "100-300": 7,    "300+": 10 },
  reinvest:   { "preciso-tirar": 1, "meio-meio": 6, "reinvesto-tudo": 10 },
  horizonte:  { "3": 8,          "5": 6,        "7": 5,          "10": 4 },  // horizontes mais curtos = mais ambição
  risco:      { "conservador": 1, "equilibrado": 5, "arrojado": 10 },
  dedicacao:  { "horas-semana": 2, "meio-periodo": 5, "integral": 9 },
  experiencia:{ "primeira": 3, "ja-tive": 6, "ja-franquia": 8, "investidor": 10 },
  atividade:  { "clt": 4, "transicao": 5, "autonomo": 6, "aposentado": 5, "empresario": 9 }
};

function computeAmbitionScore(answers) {
  // Pesos por dimensão (soma = 100)
  const dimWeights = {
    objetivo: 18,    // intenção primária — peso alto
    meta:     18,    // intenção primária
    capital:  15,    // realidade financeira
    reinvest: 12,    // disposição
    risco:    10,
    dedicacao: 9,
    experiencia: 8,
    horizonte: 6,
    atividade: 4     // contexto, não sinal direto de ambição
  };
  let total = 0;
  let weightSum = 0;
  Object.entries(dimWeights).forEach(([dim, w]) => {
    const ans = answers[dim];
    if (ans && AMBITION_WEIGHTS[dim] && AMBITION_WEIGHTS[dim][ans] !== undefined) {
      total += AMBITION_WEIGHTS[dim][ans] * w;
      weightSum += w;
    }
  });
  if (weightSum === 0) return 5;
  return total / weightSum; // 0-10
}

function detectContradictions(answers) {
  const warns = [];
  // Contradição clássica: objetivo agressivo + reinvest preciso-tirar
  if (["viver-disso", "patrimonio"].includes(answers.objetivo) && answers.reinvest === "preciso-tirar") {
    warns.push({
      severity: "high",
      msg: "Você quer construir patrimônio/viver disso, mas precisa tirar lucro pra viver. <strong>Plano calibrado mais defensivo</strong> — aceleração só depois que o pró-labore base estiver garantido."
    });
  }
  // Contradição: renda-extra + meta alta
  if (answers.objetivo === "renda-extra" && ["50-150k", "150+"].includes(answers.meta)) {
    warns.push({
      severity: "medium",
      msg: "Renda extra com meta acima de R$ 50k/mês é incomum — <strong>plano vai precisar de mais capital ou horizonte maior</strong> pra fechar essa equação."
    });
  }
  // Patrimônio + meta baixa
  if (answers.objetivo === "patrimonio" && answers.meta === "ate-15k") {
    warns.push({
      severity: "low",
      msg: "Patrimônio escalável com meta modesta de R$ 5-15k/mês — <strong>plano prioriza acúmulo</strong> de máquinas (lucro acumulado), não renda mensal."
    });
  }
  // Primeira vez + meta agressiva
  if (answers.experiencia === "primeira" && answers.meta === "150+") {
    warns.push({
      severity: "medium",
      msg: "Como será sua primeira operação, recomendamos uma <strong>curva de aprendizado mais conservadora</strong> antes de buscar metas acima de R$ 150k/mês."
    });
  }
  // CLT + integral
  if (answers.atividade === "clt" && answers.dedicacao === "integral") {
    warns.push({
      severity: "medium",
      msg: "Você está em CLT mas pretende dedicação integral — provavelmente significa que <strong>vai sair do emprego</strong>. Plano considera essa transição."
    });
  }
  // Capital baixo + meta alta
  if (["so-1a", "50-100"].includes(answers.capital) && ["50-150k", "150+"].includes(answers.meta)) {
    warns.push({
      severity: "medium",
      msg: "Capital limitado para meta alta — <strong>flywheel de reinvestimento</strong> precisará trabalhar a seu favor por mais tempo."
    });
  }
  return warns;
}

function calcSuggestion(answers) {
  const ambition = computeAmbitionScore(answers); // 0-10
  const contradictions = detectContradictions(answers);
  const rationale = [];
  const warnings = [];

  contradictions.forEach(c => warnings.push(c));

  // Default: cenário base
  const p = {
    faturamentoPorMaquina: 10000,
    percReinvestFase1: 100,
    duracaoFase1Meses: 36,
    percReinvestFase2: 50,
    reservaCapital: 5000,
    capacidadeImplantacao: 2,
    horizonteMeses: 60
  };

  // ─── HORIZONTE (direto da resposta) ──────────────────────────
  const horMap = { "3": 36, "5": 60, "7": 84, "10": 120 };
  if (answers.horizonte) {
    p.horizonteMeses = horMap[answers.horizonte] || 60;
  }

  // ─── FATURAMENTO MÉDIO POR MÁQUINA ───────────────────────────
  // Calibrado pela ambição combinada (meta + risco + experiência)
  // Range: 6.000 (super conservador) → 16.000 (turbo realista)
  const fatBase = 6000 + (ambition / 10) * 10000;
  p.faturamentoPorMaquina = Math.round(fatBase / 500) * 500;

  // Override por meta declarada (a mais informativa)
  if (answers.meta === "ate-15k")     p.faturamentoPorMaquina = Math.min(p.faturamentoPorMaquina, 8000);
  if (answers.meta === "150+")        p.faturamentoPorMaquina = Math.max(p.faturamentoPorMaquina, 14000);
  // Risco ajusta range
  if (answers.risco === "conservador") p.faturamentoPorMaquina = Math.min(p.faturamentoPorMaquina, 9000);
  if (answers.risco === "arrojado")    p.faturamentoPorMaquina = Math.max(p.faturamentoPorMaquina, 12000);
  // Primeira vez = teto realista
  if (answers.experiencia === "primeira") p.faturamentoPorMaquina = Math.min(p.faturamentoPorMaquina, 11000);

  // ─── CAPACIDADE DE IMPLANTAÇÃO ───────────────────────────────
  // Combinação de: capital, dedicação, experiência
  let cap = 2;
  if (answers.capital === "so-1a")    cap = 1;
  else if (answers.capital === "50-100")  cap = 2;  // 50-100k extra dá pra 1-2 máq nos primeiros meses
  else if (answers.capital === "100-300") cap = 2;
  else if (answers.capital === "300+")    cap = 3;
  // Dedicação reduz teto
  if (answers.dedicacao === "horas-semana") cap = Math.min(cap, 1);
  if (answers.dedicacao === "integral")     cap = Math.max(cap, 2);
  // Empresário/investidor pode acelerar
  if (["empresario", "investidor"].includes(answers.experiencia)) cap = Math.max(cap, 2);
  // Risco arrojado pode subir 1
  if (answers.risco === "arrojado" && cap < 4) cap += 1;
  // Risco conservador desce 1
  if (answers.risco === "conservador" && cap > 1) cap -= 1;
  // Meta 150+ exige cap mínimo 3
  if (answers.meta === "150+") cap = Math.max(cap, 3);
  p.capacidadeImplantacao = cap;

  // ─── REINVESTIMENTO (Fase 1 e Fase 2) ────────────────────────
  // Lógica priorizada: contradição "objetivo agressivo + preciso tirar" usa
  // resolução defensiva (50/30) em vez de aplicar regra do reinvest cega
  let f1 = 100, f2 = 50;
  // Por OBJETIVO (intenção primária)
  if (answers.objetivo === "renda-extra")    { f1 = 100; f2 = 30; }
  else if (answers.objetivo === "sair-clt")  { f1 = 100; f2 = 70; }
  else if (answers.objetivo === "viver-disso") { f1 = 100; f2 = 50; }
  else if (answers.objetivo === "patrimonio")  { f1 = 100; f2 = 100; }
  // Reinvest declarado: ajusta SUAVE em vez de override total
  if (answers.reinvest === "preciso-tirar")    { f1 = Math.min(f1, 70); f2 = Math.min(f2, 30); }
  else if (answers.reinvest === "reinvesto-tudo") {
    // Mas se objetivo é renda-extra, segue moderado pra não trair a intenção
    if (answers.objetivo === "renda-extra") { f2 = Math.max(f2, 50); }
    else { f1 = 100; f2 = Math.max(f2, 80); }
  }
  // Atividade: aposentado prioriza renda
  if (answers.atividade === "aposentado") f2 = Math.min(f2, 40);
  // CLT querendo renda extra é mais cauteloso
  if (answers.atividade === "clt" && answers.objetivo === "renda-extra") f2 = Math.min(f2, 30);
  p.percReinvestFase1 = f1;
  p.percReinvestFase2 = f2;

  // ─── DURAÇÃO FASE 1 ──────────────────────────────────────────
  if (answers.objetivo === "renda-extra") p.duracaoFase1Meses = 12;   // pró-labore cedo
  else if (answers.objetivo === "viver-disso") p.duracaoFase1Meses = 24;
  else if (answers.objetivo === "sair-clt")    p.duracaoFase1Meses = 36;
  else if (answers.objetivo === "patrimonio")  p.duracaoFase1Meses = 60;
  // Aposentado quer ver renda cedo
  if (answers.atividade === "aposentado") p.duracaoFase1Meses = Math.min(p.duracaoFase1Meses, 24);

  // ─── RESERVA DE CAPITAL ──────────────────────────────────────
  if (answers.capital === "so-1a")    p.reservaCapital = 3000;
  else if (answers.capital === "300+") p.reservaCapital = 8000;
  else                                 p.reservaCapital = 5000;

  // Garantir bounds
  p.faturamentoPorMaquina = Math.max(5000, Math.min(30000, p.faturamentoPorMaquina));
  p.percReinvestFase1     = Math.max(50, Math.min(100, p.percReinvestFase1));
  p.percReinvestFase2     = Math.max(0, Math.min(100, p.percReinvestFase2));
  p.duracaoFase1Meses     = Math.max(12, Math.min(120, p.duracaoFase1Meses));
  p.reservaCapital        = Math.max(2000, Math.min(10000, p.reservaCapital));
  p.capacidadeImplantacao = Math.max(1, Math.min(5, p.capacidadeImplantacao));
  p.horizonteMeses        = Math.max(36, Math.min(120, p.horizonteMeses));

  // ─── RATIONALE — texto humano explicando cada escolha ────────
  rationale.push(`<strong>Ambição calibrada</strong>: ${ambition.toFixed(1)}/10 — combinação de objetivo, capital, meta e perfil.`);
  rationale.push(`Horizonte de <strong>${(p.horizonteMeses / 12)} ano${p.horizonteMeses === 12 ? "" : "s"}</strong> pra atingir a meta declarada.`);
  rationale.push(`Faturamento médio por máquina: <strong>R$ ${p.faturamentoPorMaquina.toLocaleString("pt-BR")}/mês</strong> (calibrado entre cenário pessimista de R$ 6k e turbo de R$ 16k).`);
  rationale.push(`Capacidade de <strong>${p.capacidadeImplantacao} máq/mês</strong> — combina capital disponível, dedicação e experiência.`);
  rationale.push(`Reinvestimento <strong>${p.percReinvestFase1}%</strong> na Fase 1 (${p.duracaoFase1Meses / 12 % 1 === 0 ? p.duracaoFase1Meses/12 + " ano" + (p.duracaoFase1Meses>12?"s":"") : p.duracaoFase1Meses + " meses"}) e <strong>${p.percReinvestFase2}%</strong> na Fase 2 — pró-labore consistente com sua intenção.`);

  // Adiciona warnings de contradição depois do rationale base
  warnings.forEach(w => rationale.push(`⚠ ${w.msg}`));

  return { params: p, rationale, ambition, warnings };
}

/* ============================================================
   CLASSIFY PROFILE v2 — Combina respostas declaradas (50%) com
   parâmetros do plano (50%). Evita classificações que ignoram
   o que o usuário REALMENTE disse.
   ============================================================ */
function classifyProfile(p, answers) {
  // Score por parâmetros (0-9)
  let paramScore = 0;
  if (p.faturamentoPorMaquina >= 13000)      paramScore += 2;
  else if (p.faturamentoPorMaquina >= 10500) paramScore += 1;
  if (p.capacidadeImplantacao >= 3)      paramScore += 2;
  else if (p.capacidadeImplantacao >= 2) paramScore += 1;
  if (p.percReinvestFase1 >= 100) paramScore += 1;
  if (p.percReinvestFase2 >= 70)       paramScore += 2;
  else if (p.percReinvestFase2 >= 50)  paramScore += 1;
  if (p.horizonteMeses >= 84)          paramScore += 1;
  // normalizar pra 0-10
  paramScore = (paramScore / 9) * 10;

  // Score por respostas (ambition já calculada)
  const ambition = answers ? computeAmbitionScore(answers) : 5;

  // Combina 50/50
  const combined = (paramScore + ambition) / 2;

  if (combined < 3) return {
    key: "conservador", emoji: "🌱",
    label: "Construtor Cauteloso",
    desc: "Crescimento controlado, renda previsível desde o início. Você prioriza segurança e caixa no bolso."
  };
  if (combined < 5.5) return {
    key: "base", emoji: "⚖️",
    label: "Empreendedor Equilibrado",
    desc: "Equilíbrio entre escala e segurança — o caminho da maioria da rede AVEND."
  };
  if (combined < 8) return {
    key: "otimista", emoji: "🚀",
    label: "Investidor Arrojado",
    desc: "Expansão acelerada com alto reinvestimento. Você joga pra ganhar grande no médio prazo."
  };
  return {
    key: "turbo", emoji: "⚡",
    label: "Acelerador Turbo",
    desc: "Máxima escala — flywheel total, ambição agressiva. Construindo uma operação de porte."
  };
}

/* ---------- Quiz state machine ----------
   Slide 0 = identificação (opcional). Depois N perguntas do array QUIZ_QUESTIONS.
   Total de slides = QUIZ_QUESTIONS.length + 1.
*/
const QUIZ_TOTAL_SLIDES = QUIZ_QUESTIONS.length + 1; // 1 slide de identificação + N perguntas

const quizState = {
  current: 0,                // 0 = identificação, 1..7 = perguntas
  answers: {},
  identity: {},              // { name, email, phone, city }
  total: QUIZ_TOTAL_SLIDES
};

function openQuiz(reset = true) {
  if (reset) {
    quizState.current = 0;
    quizState.answers = {};
  }
  document.getElementById("quiz-result").hidden = true;
  const ov = document.getElementById("quiz-overlay");
  ov.hidden = false;
  ov.setAttribute("aria-hidden", "false");
  document.body.classList.add("quiz-open");
  renderQuizSlide();
  TELEMETRY.track("quiz_opened", { reset });
}

function closeQuiz() {
  const ov = document.getElementById("quiz-overlay");
  const rs = document.getElementById("quiz-result");
  ov.hidden = true;
  rs.hidden = true;
  ov.setAttribute("aria-hidden", "true");
  rs.setAttribute("aria-hidden", "true");
  document.body.classList.remove("quiz-open");
}

function renderQuizSlide() {
  document.getElementById("quiz-cur").textContent = quizState.current + 1;
  document.getElementById("quiz-tot").textContent = quizState.total;
  const pct = ((quizState.current + 1) / quizState.total) * 100;
  document.getElementById("quiz-fill").style.width = pct + "%";

  const stage = document.getElementById("quiz-stage");

  // Slide 0: Identificação
  if (quizState.current === 0) {
    const id = quizState.identity;
    stage.innerHTML = `
      <div class="quiz-question quiz-identity">
        <h2 id="quiz-q-title" class="quiz-q-title">Antes de começar — como podemos te chamar?</h2>
        <p class="quiz-q-hint">
          Identificação <strong>opcional</strong>. Serve só pra personalizar seu plano e permitir
          que nosso time te procure depois, se você quiser. Você pode pular essa etapa.
        </p>
        <div class="quiz-identity-grid">
          <label class="quiz-id-field">
            <span class="quiz-id-lbl">Nome</span>
            <input type="text" id="qid-name" class="quiz-id-input" placeholder="João da Silva"
                   autocomplete="name" maxlength="80" value="${escapeAttr(id.name || "")}" />
            <span class="quiz-id-feedback" data-for="name"></span>
          </label>
          <label class="quiz-id-field">
            <span class="quiz-id-lbl">E-mail</span>
            <input type="email" id="qid-email" class="quiz-id-input" placeholder="seu@email.com"
                   autocomplete="email" maxlength="120" inputmode="email"
                   value="${escapeAttr(id.email || "")}" />
            <span class="quiz-id-feedback" data-for="email"></span>
          </label>
          <label class="quiz-id-field">
            <span class="quiz-id-lbl">Telefone / WhatsApp</span>
            <input type="tel" id="qid-phone" class="quiz-id-input" placeholder="(11) 99999-9999"
                   autocomplete="tel" maxlength="16" inputmode="tel"
                   value="${escapeAttr(id.phone || "")}" />
            <span class="quiz-id-feedback" data-for="phone"></span>
          </label>
          <label class="quiz-id-field">
            <span class="quiz-id-lbl">Cidade / UF</span>
            <input type="text" id="qid-city" class="quiz-id-input" placeholder="São Paulo / SP"
                   autocomplete="address-level2" maxlength="80" value="${escapeAttr(id.city || "")}" />
            <span class="quiz-id-feedback" data-for="city"></span>
          </label>
          <label class="quiz-id-field">
            <span class="quiz-id-lbl">Consultor AVEND <small style="opacity:0.6">(opcional)</small></span>
            <input type="text" id="qid-consultor" class="quiz-id-input" placeholder="Nome de quem está te atendendo"
                   autocomplete="off" maxlength="80" value="${escapeAttr(id.consultor || "")}" />
            <span class="quiz-id-feedback" data-for="consultor"></span>
          </label>

          <!-- Honeypot anti-spam: campo invisível que bots preenchem.
               Se vier preenchido, o "lead" é descartado silenciosamente. -->
          <label class="quiz-id-honeypot" aria-hidden="true">
            Não preencha este campo
            <input type="text" id="qid-website" name="website" tabindex="-1"
                   autocomplete="off" />
          </label>
        </div>
        <div class="quiz-id-privacy">
          <span aria-hidden="true">🔒</span>
          <span>Seus dados são tratados conforme a LGPD. Não compartilhamos com terceiros.</span>
        </div>
      </div>
    `;

    // Setup máscara de telefone
    const phoneInput = document.getElementById("qid-phone");
    if (phoneInput) {
      const applyPhoneMask = () => {
        const raw = phoneInput.value.replace(/\D/g, "").slice(0, 11);
        phoneInput.value = formatPhoneBR(raw);
      };
      phoneInput.addEventListener("input", applyPhoneMask);
      // Aplica logo se já tem valor
      if (phoneInput.value) applyPhoneMask();
    }

    // Setup feedback visual + sync state
    ["name", "email", "phone", "city", "consultor"].forEach(field => {
      const inp = document.getElementById("qid-" + field);
      if (!inp) return;
      inp.addEventListener("input", () => {
        const value = inp.value.trim();
        quizState.identity[field] = value;
        // Validação visual em tempo real
        const feedback = stage.querySelector(`.quiz-id-feedback[data-for="${field}"]`);
        const validity = validateIdentityField(field, value);
        inp.classList.toggle("is-valid", validity.state === "valid");
        inp.classList.toggle("is-error", validity.state === "error");
        if (feedback) {
          feedback.textContent = validity.message || "";
          feedback.dataset.state = validity.state || "";
        }
        // Sync TELEMETRY
        if (typeof TELEMETRY !== "undefined") {
          const map = { name: "visitorName", email: "visitorEmail", phone: "visitorPhone", city: "visitorCity", consultor: "visitorConsultor" };
          // Salva sempre o valor digitado, mesmo se inválido (usuário pode estar terminando de digitar)
          TELEMETRY.session[map[field]] = value || null;
          TELEMETRY.persist();
        }
      });
      // Trigger inicial pra mostrar valid no que veio prefilled
      inp.dispatchEvent(new Event("input"));
    });

    // Footer: identificação é sempre permite avançar
    document.getElementById("quiz-back").disabled = true;
    document.getElementById("quiz-next").disabled = false;
    document.getElementById("quiz-next").innerHTML = `Começar questionário <span aria-hidden="true">→</span>`;
    document.getElementById("quiz-hint").innerHTML =
      `Você pode <strong>pular</strong> e continuar anônimo — basta clicar em Começar questionário.`;
    return;
  }

  // Slide 1..N: perguntas
  const q = QUIZ_QUESTIONS[quizState.current - 1];
  const selected = quizState.answers[q.id];

  stage.innerHTML = `
    <div class="quiz-question" data-q="${q.id}">
      <h2 id="quiz-q-title" class="quiz-q-title">${q.title}</h2>
      <p class="quiz-q-hint">${q.hint}</p>
      <div class="quiz-opts">
        ${q.options.map(o => `
          <button class="quiz-opt ${selected === o.value ? "is-selected" : ""}"
                  type="button" data-value="${o.value}">
            <span class="quiz-opt-icon" aria-hidden="true">${o.icon}</span>
            <span class="quiz-opt-body">
              <span class="quiz-opt-title">${o.title}</span>
              <span class="quiz-opt-desc">${o.desc}</span>
            </span>
            <span class="quiz-opt-check" aria-hidden="true">✓</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  // wiring
  const isLast = quizState.current === quizState.total - 1;
  stage.querySelectorAll(".quiz-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      stage.querySelectorAll(".quiz-opt").forEach(b => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      quizState.answers[q.id] = btn.dataset.value;
      document.getElementById("quiz-next").disabled = false;
      document.getElementById("quiz-hint").textContent =
        isLast ? "Última pergunta — clique em Ver meu plano →" : "Ótimo. Clique em Próxima →";
      if (typeof TELEMETRY !== "undefined")
        TELEMETRY.track("quiz_answered", { q: q.id, value: btn.dataset.value, step: quizState.current });
    });
  });

  // Buttons state
  document.getElementById("quiz-back").disabled = false; // sempre pode voltar pra identidade
  const nextBtn = document.getElementById("quiz-next");
  nextBtn.disabled = !selected;
  nextBtn.innerHTML = isLast ? `Ver meu plano <span aria-hidden="true">→</span>` : `Próxima <span aria-hidden="true">→</span>`;
  document.getElementById("quiz-hint").textContent = selected
    ? (isLast ? "Última pergunta — clique em Ver meu plano →" : "Ótimo. Clique em Próxima →")
    : "Selecione uma opção para continuar";
}

// Escape básico pra atributos HTML
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------- Validações da identificação ---------- */

// Máscara de telefone brasileiro: (11) 99999-9999 ou (11) 9999-9999
function formatPhoneBR(digits) {
  const d = String(digits || "").replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Regex de e-mail simples — pega 99% dos casos sem ser draconiano
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateIdentityField(field, value) {
  if (!value) return { state: null, message: "" }; // vazio = neutro (campo é opcional)

  if (field === "name") {
    if (value.length < 2)
      return { state: "error", message: "Nome muito curto" };
    if (!/[a-zà-ú]/i.test(value))
      return { state: "error", message: "Nome inválido" };
    return { state: "valid", message: "" };
  }

  if (field === "email") {
    if (!EMAIL_RE.test(value))
      return { state: "error", message: "E-mail incompleto" };
    return { state: "valid", message: "" };
  }

  if (field === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10)
      return { state: "error", message: "Faltam dígitos (DDD + número)" };
    if (digits.length > 11)
      return { state: "error", message: "Telefone com dígitos a mais" };
    // DDD válido (11-99)
    const ddd = parseInt(digits.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99)
      return { state: "error", message: "DDD inválido" };
    return { state: "valid", message: "" };
  }

  if (field === "city") {
    if (value.length < 2)
      return { state: "error", message: "Cidade muito curta" };
    return { state: "valid", message: "" };
  }

  if (field === "consultor") {
    if (value.length < 2)
      return { state: "error", message: "Nome muito curto" };
    if (!/[a-zà-ú]/i.test(value))
      return { state: "error", message: "Nome inválido" };
    return { state: "valid", message: "" };
  }

  return { state: null, message: "" };
}

// Check do honeypot: se preenchido, é bot
function isHoneypotTriggered() {
  const hp = document.getElementById("qid-website");
  return !!(hp && hp.value && hp.value.trim().length > 0);
}

function quizNext() {
  if (quizState.current === 0) {
    // Honeypot: se preencheu o campo invisível, é bot. Limpa identificação
    // silenciosamente (sem dar feedback pro bot saber que foi pego).
    if (isHoneypotTriggered()) {
      quizState.identity = {};
      if (typeof TELEMETRY !== "undefined") {
        TELEMETRY.track("honeypot_triggered", {});
        // limpa visitor info no telemetry também
        TELEMETRY.session.visitorName = null;
        TELEMETRY.session.visitorEmail = null;
        TELEMETRY.session.visitorPhone = null;
        TELEMETRY.session.visitorCity = null;
        TELEMETRY.session.visitorConsultor = null;
        TELEMETRY.session.botSuspected = true;
        TELEMETRY.persist();
      }
    }
    // Registra evento de identificação
    if (typeof TELEMETRY !== "undefined") {
      const provided = ["name", "email", "phone", "city", "consultor"].filter(f => quizState.identity[f]);
      if (provided.length > 0) {
        TELEMETRY.track("quiz_identified", { fields: provided });
      } else {
        TELEMETRY.track("quiz_identification_skipped", {});
      }
    }
  }
  if (quizState.current + 1 < quizState.total) {
    quizState.current++;
    renderQuizSlide();
  } else {
    showQuizResult();
  }
}
function quizBack() {
  if (quizState.current > 0) {
    quizState.current--;
    renderQuizSlide();
  }
}

/* Faixas de meta declarada (em R$/mês) — pra validar se o plano entrega */
const META_RANGES = {
  "ate-15k":  { min: 5000,   target: 10000,  max: 15000,   label: "R$ 5–15 mil/mês" },
  "15-50k":   { min: 15000,  target: 30000,  max: 50000,   label: "R$ 15–50 mil/mês" },
  "50-150k":  { min: 50000,  target: 90000,  max: 150000,  label: "R$ 50–150 mil/mês" },
  "150+":     { min: 150000, target: 200000, max: 500000,  label: "Acima de R$ 150 mil/mês" }
};

/* Avalia se o plano sugerido entrega a meta declarada */
function evaluateMetaDelivery(sim, metaAnswer) {
  const range = META_RANGES[metaAnswer];
  if (!range || !sim) return null;
  const lucroFinal = sim.lucroMensalFinal || 0;
  const target = range.target;
  const pctMeta = (lucroFinal / target) * 100;

  let status, color, msg;
  if (lucroFinal >= range.min && lucroFinal <= range.max) {
    status = "match"; color = "#39e887";
    msg = `🎯 <strong>Plano alinhado com sua meta</strong> de ${range.label}. Projeção de ${fmtBRL(lucroFinal)}/mês está dentro da faixa.`;
  } else if (lucroFinal > range.max) {
    status = "over"; color = "#3DD9D6";
    msg = `🚀 <strong>Plano supera sua meta</strong>. Projeção de ${fmtBRL(lucroFinal)}/mês está acima da faixa de ${range.label} — você pediu menos do que pode entregar.`;
  } else {
    status = "under"; color = "#ffb020";
    const gap = target - lucroFinal;
    msg = `⚠ <strong>Plano entrega ${pctMeta.toFixed(0)}% da sua meta</strong>. Projeção de ${fmtBRL(lucroFinal)}/mês fica ${fmtBRL(gap)} abaixo do target. Considere aumentar capital, horizonte ou capacidade.`;
  }
  return { status, color, msg, pctMeta, lucroFinal, range };
}

function showQuizResult() {
  const sug = calcSuggestion(quizState.answers);
  const profile = classifyProfile(sug.params, quizState.answers);
  const sim = simulate(sug.params);
  const metaEval = evaluateMetaDelivery(sim, quizState.answers.meta);

  // Persistir
  try {
    localStorage.setItem("avend-quiz-completed", "1");
    localStorage.setItem("avend-quiz-data", JSON.stringify({
      answers: quizState.answers,
      identity: quizState.identity,
      params: sug.params,
      profile: profile.key,
      ambition: sug.ambition,
      ts: Date.now()
    }));
  } catch (e) { /* ignore */ }

  // Atualiza session da telemetria com os dados de identificação
  if (typeof TELEMETRY !== "undefined") {
    TELEMETRY.session.quizCompleted = true;
    TELEMETRY.session.profile = profile.key;
    if (quizState.identity.name)      TELEMETRY.session.visitorName      = quizState.identity.name;
    if (quizState.identity.email)     TELEMETRY.session.visitorEmail     = quizState.identity.email;
    if (quizState.identity.phone)     TELEMETRY.session.visitorPhone     = quizState.identity.phone;
    if (quizState.identity.city)      TELEMETRY.session.visitorCity      = quizState.identity.city;
    if (quizState.identity.consultor) TELEMETRY.session.visitorConsultor = quizState.identity.consultor;
    TELEMETRY.persist();
  }

  // Render
  document.getElementById("quiz-result-emoji").textContent = profile.emoji;
  // Personaliza o título com o primeiro nome se foi informado
  const firstName = (quizState.identity.name || "").split(/\s+/)[0];
  const labelEl = document.getElementById("quiz-result-label");
  labelEl.innerHTML = firstName
    ? `${firstName}, seu perfil é<br><span class="qr-profile-name">${profile.label}</span>`
    : profile.label;
  document.getElementById("quiz-result-desc").textContent  = profile.desc;
  document.getElementById("quiz-result-modal").dataset.profile = profile.key;

  const params = sug.params;
  document.getElementById("quiz-result-params").innerHTML = `
    <div class="qr-param"><span class="qr-param-lbl">Faturamento médio / máq</span><span class="qr-param-val">${fmtBRL(params.faturamentoPorMaquina)}<small>/mês</small></span></div>
    <div class="qr-param"><span class="qr-param-lbl">Reinvest Fase 1</span><span class="qr-param-val">${params.percReinvestFase1}%</span></div>
    <div class="qr-param"><span class="qr-param-lbl">Reinvest Fase 2</span><span class="qr-param-val">${params.percReinvestFase2}%</span></div>
    <div class="qr-param"><span class="qr-param-lbl">Duração Fase 1</span><span class="qr-param-val">${formatDuracao(params.duracaoFase1Meses)}</span></div>
    <div class="qr-param"><span class="qr-param-lbl">Capacidade implantação</span><span class="qr-param-val">${params.capacidadeImplantacao}<small>máq/mês</small></span></div>
    <div class="qr-param"><span class="qr-param-lbl">Horizonte</span><span class="qr-param-val">${params.horizonteMeses / 12}<small>anos</small></span></div>
  `;

  document.getElementById("quiz-result-projection").innerHTML = `
    <div class="qr-proj"><span class="qr-proj-lbl">Total de máquinas</span><span class="qr-proj-val">${sim.frotaFinal} unidades</span></div>
    <div class="qr-proj qr-proj-hl"><span class="qr-proj-lbl">Lucro mensal final</span><span class="qr-proj-val">${fmtBRL(sim.lucroMensalFinal)}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Payback 1ª máq</span><span class="qr-proj-val">${sim.paybackMeses ? sim.paybackMeses + " meses" : "—"}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Patrimônio final</span><span class="qr-proj-val">${fmtBRL(sim.patrimonioFinal)}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Lucro acumulado</span><span class="qr-proj-val">${fmtBRL(sim.linhas[sim.linhas.length - 1].lucroAcumulado)}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Pró-labore total</span><span class="qr-proj-val">${fmtBRL(sim.totalProLabore)}</span></div>
  `;

  // Bloco de validação da meta — injetado dinamicamente antes do rationale
  const rationaleList = document.getElementById("quiz-result-rationale");
  const rationaleSection = rationaleList.closest(".quiz-result-section");
  // Remove bloco antigo se existir (re-render do quiz)
  document.getElementById("qr-meta-eval")?.remove();

  if (metaEval) {
    const metaBlock = document.createElement("div");
    metaBlock.id = "qr-meta-eval";
    metaBlock.className = "qr-meta-eval qr-meta-" + metaEval.status;
    metaBlock.innerHTML = `
      <div class="qr-meta-bar-wrap">
        <span class="qr-meta-bar" style="width:${Math.min(100, metaEval.pctMeta)}%; background:${metaEval.color};"></span>
      </div>
      <p class="qr-meta-msg">${metaEval.msg}</p>
    `;
    rationaleSection.parentNode.insertBefore(metaBlock, rationaleSection);
  }

  rationaleList.innerHTML = sug.rationale.length
    ? sug.rationale.map(r => `<li>${r}</li>`).join("")
    : `<li>Plano calibrado a partir do cenário base da rede.</li>`;

  // ─── Market Territory: diagnóstico de mercado da cidade ────────
  // Renderiza apenas se o usuário informou cidade na identificação.
  // Se a cidade não estiver na base local, o módulo abre fallback manual.
  try {
    const mktSection = document.getElementById("qr-section-market");
    const mktWrap    = document.getElementById("market-territory-wrap");
    const rationaleNum = document.getElementById("qr-rationale-num");
    const cityRaw = (quizState.identity && quizState.identity.city) || "";

    if (mktSection && mktWrap && typeof MarketTerritory !== "undefined") {
      if (cityRaw && cityRaw.length >= 2) {
        mktSection.hidden = false;
        MarketTerritory.render(mktWrap, cityRaw);
        if (rationaleNum) rationaleNum.textContent = "04";
      } else {
        mktSection.hidden = true;
        if (rationaleNum) rationaleNum.textContent = "03";
      }
    }
  } catch (e) {
    console.warn("[market-territory] falha ao renderizar:", e);
  }

  // Save pending application
  quizState.pendingParams = sug.params;
  quizState.pendingProfile = profile;

  // Switch view
  document.getElementById("quiz-overlay").hidden = true;
  const rs = document.getElementById("quiz-result");
  rs.hidden = false;
  rs.setAttribute("aria-hidden", "false");

  TELEMETRY.track("quiz_completed", {
    profile: profile.key,
    answers: quizState.answers,
    params: sug.params
  });
}

/* Monta mensagem rica de WhatsApp com dados do investidor + plano sugerido */
function buildWhatsAppMessage(profile, params, sim) {
  const id = quizState.identity || {};
  const firstName = (id.name || "").split(/\s+/)[0];

  const intro = firstName
    ? `Olá! Sou *${id.name}*, acabei de fazer o diagnóstico AVEND.`
    : `Olá! Acabei de fazer o diagnóstico AVEND e gostaria de conversar.`;

  const lines = [intro, ""];
  if (profile?.label) {
    lines.push(`📊 *Meu perfil identificado:* ${profile.label} ${profile.emoji || ""}`);
  }
  lines.push("");
  lines.push("📋 *Plano sugerido pelo simulador:*");
  if (params) {
    lines.push(`• Faturamento médio/máquina: ${fmtBRL(params.faturamentoPorMaquina)}/mês`);
    lines.push(`• Capacidade de implantação: ${params.capacidadeImplantacao} máq/mês`);
    lines.push(`• Horizonte: ${params.horizonteMeses / 12} anos`);
  }
  if (sim) {
    lines.push("");
    lines.push("📈 *Projeção desse plano:*");
    lines.push(`• Total de máquinas: ${sim.frotaFinal} unidades`);
    lines.push(`• Lucro mensal final estimado: ${fmtBRL(sim.lucroMensalFinal)}`);
    if (sim.paybackMeses) lines.push(`• Payback da 1ª máquina: ${sim.paybackMeses} meses`);
    lines.push(`• Patrimônio em equipamentos: ${fmtBRL(sim.patrimonioFinal)}`);
  }
  lines.push("");
  lines.push("Gostaria de conversar sobre como dar o próximo passo. 🚀");
  return lines.join("\n");
}

/* Abre WhatsApp com mensagem pré-formatada e dispara evento crítico */
function openWhatsAppWithLead() {
  if (!AVEND_WHATSAPP) return;
  const profile = quizState.pendingProfile;
  const params  = quizState.pendingParams;
  const sim = params ? simulate(params) : null;
  const msg = buildWhatsAppMessage(profile, params, sim);
  const url = `https://wa.me/${AVEND_WHATSAPP}?text=${encodeURIComponent(msg)}`;

  // Telemetria — evento CRITICAL (vai pro webhook imediatamente)
  if (typeof TELEMETRY !== "undefined") {
    TELEMETRY.track("lead_intent", {
      profile: profile?.key,
      hasContact: !!(quizState.identity?.name || quizState.identity?.email || quizState.identity?.phone),
      params: params || null
    });
  }

  // Abre WhatsApp em nova aba
  window.open(url, "_blank", "noopener,noreferrer");
}

function applyQuizSuggestion() {
  const params = quizState.pendingParams;
  if (!params) return;
  Object.assign(state, params);
  syncInputsFromState();
  updateCenarioLabel();
  renderAll();
  closeQuiz();
  activateTab("simulador");
  // smooth highlight pulse no chip
  setTimeout(() => {
    const chip = document.querySelector(".cenario-chip");
    if (chip) {
      chip.classList.add("cenario-chip-pulse");
      setTimeout(() => chip.classList.remove("cenario-chip-pulse"), 2400);
    }
  }, 600);
  TELEMETRY.track("quiz_plan_applied", { profile: quizState.pendingProfile?.key });
}

function bindQuiz() {
  document.getElementById("quiz-next")?.addEventListener("click", quizNext);
  document.getElementById("quiz-back")?.addEventListener("click", quizBack);
  // Botão "Pular" foi removido — quiz é OBRIGATÓRIO agora
  document.getElementById("quiz-redo")?.addEventListener("click", () => openQuiz(true));
  document.getElementById("quiz-apply")?.addEventListener("click", applyQuizSuggestion);
  // Botão WhatsApp — só aparece se AVEND_WHATSAPP estiver configurado
  const waBtn = document.getElementById("quiz-whatsapp");
  if (waBtn) {
    if (AVEND_WHATSAPP) {
      waBtn.hidden = false;
      waBtn.addEventListener("click", openWhatsAppWithLead);
    } else {
      waBtn.hidden = true;
    }
  }
  document.getElementById("open-quiz")?.addEventListener("click", () => openQuiz(true));
  document.getElementById("open-quiz-hero")?.addEventListener("click", () => openQuiz(true));
  document.getElementById("open-quiz-header")?.addEventListener("click", () => openQuiz(true));
  // ESC NÃO fecha — quiz é obrigatório
}

/* ============================================================
   VSL — Por que AVEND? (vídeo + CTAs)
   ============================================================ */
function loadVslVideo() {
  const player = document.getElementById("vsl-player");
  const cover  = document.getElementById("vsl-cover");
  if (!player || !cover) return;
  if (!VSL_VIDEO_URL) {
    // Sinaliza visualmente que o vídeo está em produção
    cover.classList.add("vsl-cover-pending");
    return;
  }
  const embed = buildVslEmbedUrl(VSL_VIDEO_URL);
  if (!embed) return;

  // Cria iframe lazy (só ao clicar)
  const iframe = document.createElement("iframe");
  iframe.src = embed;
  iframe.title = "Por que investir na AVEND?";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allowFullscreen = true;
  iframe.className = "vsl-iframe";
  cover.replaceWith(iframe);

  if (typeof TELEMETRY !== "undefined") {
    TELEMETRY.track("vsl_video_played", { url: VSL_VIDEO_URL.slice(0, 80) });
  }
}

function bindVsl() {
  const cover = document.getElementById("vsl-cover");
  if (cover) {
    if (!VSL_VIDEO_URL) cover.classList.add("vsl-cover-pending");
    cover.addEventListener("click", loadVslVideo);
    cover.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); loadVslVideo(); }
    });
  }

  // Scroll up button (no card final das razões)
  document.getElementById("vsl-scroll-up")?.addEventListener("click", () => {
    document.getElementById("vsl-player")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // CTA WhatsApp da página VSL (sem dados de quiz, mensagem mais genérica)
  const vslWa = document.getElementById("vsl-whatsapp");
  if (vslWa) {
    if (AVEND_WHATSAPP) {
      vslWa.addEventListener("click", () => {
        const id = quizState?.identity || {};
        const firstName = (id.name || "").split(/\s+/)[0];
        const intro = firstName
          ? `Olá! Sou *${id.name}*, vi o vídeo de apresentação da AVEND e gostaria de saber mais.`
          : `Olá! Vi o vídeo de apresentação da AVEND e gostaria de saber mais sobre a franquia.`;
        const url = `https://wa.me/${AVEND_WHATSAPP}?text=${encodeURIComponent(intro)}`;
        if (typeof TELEMETRY !== "undefined") TELEMETRY.track("lead_intent", { source: "vsl_page" });
        window.open(url, "_blank", "noopener,noreferrer");
      });
    } else {
      vslWa.style.display = "none";
    }
  }
  // CTA Diagnóstico
  document.getElementById("vsl-quiz")?.addEventListener("click", () => openQuiz(true));
}

function maybeAutoOpenQuiz() {
  // Quiz é OPCIONAL — não abre automaticamente.
  // Acesso pelos botões "Diagnóstico" no header e no hero.
  return;
}

/* ============================================================
   TELEMETRY — sessão, tempo, interações
   Persistência: localStorage + (opcional) POST para Apps Script
   Configure TELEMETRY_ENDPOINT abaixo com a URL do seu Web App.
   ============================================================ */

/* >>> URL do endpoint (Apps Script Web App). Vazio = só local. <<<
   Como configurar: veja apps-script/Code.gs e apps-script/README.md
*/
const TELEMETRY_ENDPOINT = "https://script.google.com/macros/s/AKfycbwdC4YKekPo6qliAs1QtbLwBm4zuwh2PPIBOFJC5MTDOSwRgViQFMPbvjZlCnSwUKsB/exec";

/* >>> WhatsApp da AVEND para receber leads quentes diretamente <<<
   Formato: código do país + DDD + número (apenas dígitos).
   Ex: 5511999998888 (Brasil + SP + número). Sem espaços, traços ou parênteses.
   Deixe vazio "" para esconder o botão "Quero conversar" do resultado do quiz.
*/
const AVEND_WHATSAPP = "5517996003377"; // ⚠ TROCAR PELO NÚMERO REAL DA AVEND

/* >>> URL do vídeo VSL (aba "Por que AVEND?") <<<
   Aceita:
   - YouTube share: "https://youtu.be/VIDEO_ID"
   - YouTube watch: "https://www.youtube.com/watch?v=VIDEO_ID"
   - YouTube embed: "https://www.youtube.com/embed/VIDEO_ID"
   - Vimeo:         "https://player.vimeo.com/video/VIDEO_ID"
   Deixe "" pra mostrar capa "Vídeo em produção".
*/
const VSL_VIDEO_URL = ""; // ⚠ COLAR URL DO VÍDEO QUANDO ESTIVER PRONTO

/* Converte URL pra formato embed apropriado com autoplay */
function buildVslEmbedUrl(rawUrl) {
  if (!rawUrl) return "";
  let m = rawUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0&modestbranding=1`;
  m = rawUrl.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0&modestbranding=1`;
  if (rawUrl.includes("youtube.com/embed/")) {
    return rawUrl + (rawUrl.includes("?") ? "&" : "?") + "autoplay=1&rel=0&modestbranding=1";
  }
  if (rawUrl.includes("vimeo.com")) {
    return rawUrl + (rawUrl.includes("?") ? "&" : "?") + "autoplay=1&dnt=1&title=0&byline=0&portrait=0";
  }
  return rawUrl;
}

const TELEMETRY = (() => {
  const SESSION_ID = (() => {
    const key = "avend-session-id";
    let id = null;
    try {
      id = sessionStorage.getItem(key);
      if (!id) {
        id = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
        sessionStorage.setItem(key, id);
      }
    } catch (e) { id = "s_anon_" + Date.now(); }
    return id;
  })();

  // Detecta retorno: se já existem sessões anteriores no localStorage índice
  let visitNumber = 1;
  try {
    const idx = JSON.parse(localStorage.getItem("avend-tel-index") || "[]");
    // Filtra a própria sessão (caso esteja sendo criada agora)
    const previous = idx.filter(id => id !== SESSION_ID);
    visitNumber = previous.length + 1;
  } catch (e) {}

  const session = {
    sessionId: SESSION_ID,
    startedAt: Date.now(),
    lastSeen: Date.now(),
    visitorId: null,
    visitorName: null,
    visitorEmail: null,
    visitorPhone: null,
    visitorCity: null,
    visitorConsultor: null,
    visitNumber: visitNumber,    // 1ª visita = 1, retornos = 2+
    events: [],
    tabTime: {},
    interactions: { sliders: {}, presets: {}, ctas: 0 },
    milestones: {},               // { dwell_1m: ts, dwell_3m: ts, deep_engagement: ts, ... }
    quizCompleted: false,
    profile: null,
    userAgent: (typeof navigator !== "undefined" ? navigator.userAgent : ""),
    referrer: (typeof document !== "undefined" ? document.referrer : "")
  };

  // Captura visitante via query string (?name=&email=&phone=&city=&id=)
  try {
    const u = new URL(window.location.href);
    session.visitorId    = u.searchParams.get("id");
    session.visitorName      = u.searchParams.get("name") || u.searchParams.get("nome");
    session.visitorEmail     = u.searchParams.get("email");
    session.visitorPhone     = u.searchParams.get("phone") || u.searchParams.get("tel");
    session.visitorCity      = u.searchParams.get("city")  || u.searchParams.get("cidade");
    session.visitorConsultor = u.searchParams.get("consultor");
  } catch (e) {}

  // Tenta recuperar dados da última sessão (mesmo browser) se for retorno
  if (visitNumber > 1) {
    try {
      const idx = JSON.parse(localStorage.getItem("avend-tel-index") || "[]");
      const prev = idx.filter(id => id !== SESSION_ID).reverse();
      for (const pid of prev) {
        const pdata = JSON.parse(localStorage.getItem("avend-tel-" + pid) || "{}");
        if (pdata.visitorName || pdata.visitorEmail) {
          // Auto-prefill se não veio via querystring
          if (!session.visitorName)      session.visitorName      = pdata.visitorName;
          if (!session.visitorEmail)     session.visitorEmail     = pdata.visitorEmail;
          if (!session.visitorPhone)     session.visitorPhone     = pdata.visitorPhone;
          if (!session.visitorCity)      session.visitorCity      = pdata.visitorCity;
          if (!session.visitorConsultor) session.visitorConsultor = pdata.visitorConsultor;
          if (pdata.profile && !session.previousProfile) session.previousProfile = pdata.profile;
          break;
        }
      }
    } catch (e) {}
  }

  // Tab tracking
  let currentTab = "overview";
  let tabEnteredAt = Date.now();

  function commitTabTime() {
    const elapsed = Date.now() - tabEnteredAt;
    session.tabTime[currentTab] = (session.tabTime[currentTab] || 0) + elapsed;
    tabEnteredAt = Date.now();
  }

  /* ---------- HTTP transport ---------- */
  // Eventos críticos são enviados imediatamente; outros são "batched" em
  // intervalos. No unload, manda snapshot completo via sendBeacon.
  const CRITICAL_EVENTS = new Set([
    "quiz_completed", "quiz_plan_applied", "quiz_identified", "page_loaded",
    "returning_visitor", "deep_engagement", "dwell_milestone_5m",
    "dwell_milestone_10m", "dwell_milestone_15m",
    "lead_intent",                  // 🔥 lead clicou em "conversar com a AVEND"
    "market_territory_pdf_lead"     // 📄 lead baixou PDF do diagnóstico de mercado
  ]);

  function postJSON_(payload) {
    if (!TELEMETRY_ENDPOINT) return;
    try {
      // Apps Script aceita text/plain (evita CORS preflight)
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        navigator.sendBeacon(TELEMETRY_ENDPOINT, blob);
        return;
      }
      fetch(TELEMETRY_ENDPOINT, {
        method: "POST",
        body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        keepalive: true,
        mode: "no-cors"
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function sendSessionSnapshot() {
    postJSON_({ type: "session", session });
  }
  function sendEvent(evt) {
    postJSON_({
      type: "event",
      session_id: SESSION_ID,
      event: evt,
      visitor: {
        name:  session.visitorName,
        email: session.visitorEmail,
        phone: session.visitorPhone,
        city:  session.visitorCity
      }
    });
  }

  function track(type, data = {}) {
    session.lastSeen = Date.now();
    const evt = { t: Date.now() - session.startedAt, type, data };
    session.events.push(evt);
    persist();
    if (CRITICAL_EVENTS.has(type)) {
      sendEvent(evt);
      sendSessionSnapshot();
    } else {
      sendEvent(evt);
    }
  }

  function persist() {
    try {
      localStorage.setItem("avend-tel-" + SESSION_ID, JSON.stringify(session));
      const idx = JSON.parse(localStorage.getItem("avend-tel-index") || "[]");
      if (!idx.includes(SESSION_ID)) {
        idx.push(SESSION_ID);
        localStorage.setItem("avend-tel-index", JSON.stringify(idx.slice(-50)));
      }
    } catch (e) {}
  }

  function setTab(name) {
    commitTabTime();
    currentTab = name;
    tabEnteredAt = Date.now();
    track("tab_view", { tab: name });
  }

  function trackSliderChange(stateKey, oldValue, newValue) {
    if (!session.interactions.sliders[stateKey]) {
      session.interactions.sliders[stateKey] = { firstChangeAt: Date.now(), changes: 0, initial: oldValue, last: newValue };
    }
    session.interactions.sliders[stateKey].changes++;
    session.interactions.sliders[stateKey].last = newValue;
  }

  function trackPreset(name) {
    session.interactions.presets[name] = (session.interactions.presets[name] || 0) + 1;
    track("preset_clicked", { preset: name });
  }

  // Snapshot quando esconder a aba (mobile não dispara beforeunload)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      commitTabTime();
      session.totalTimeMs = Date.now() - session.startedAt;
      persist();
      sendSessionSnapshot();
    }
  });

  // beforeunload: snapshot final via sendBeacon
  window.addEventListener("beforeunload", () => {
    commitTabTime();
    session.totalTimeMs = Date.now() - session.startedAt;
    persist();
    sendSessionSnapshot();
  });

  // Heartbeat a cada 30s persiste local + manda snapshot remoto
  // Também avalia milestones (dwell time, deep engagement)
  setInterval(() => {
    if (document.visibilityState === "visible") {
      commitTabTime();
      session.totalTimeMs = Date.now() - session.startedAt;
      persist();
      sendSessionSnapshot();
      checkMilestones_();
    }
  }, 30000);

  /* ---------- Milestones e detectores especiais ---------- */
  const DWELL_THRESHOLDS = [
    { key: "1m",  ms: 60000 },
    { key: "3m",  ms: 180000 },
    { key: "5m",  ms: 300000 },
    { key: "10m", ms: 600000 },
    { key: "15m", ms: 900000 }
  ];

  function fireMilestone_(key, data = {}) {
    if (session.milestones[key]) return; // já disparou
    session.milestones[key] = Date.now();
    track("dwell_milestone_" + key, data);
  }

  function checkMilestones_() {
    const elapsed = Date.now() - session.startedAt;

    // 1. Milestones de tempo
    DWELL_THRESHOLDS.forEach(t => {
      if (elapsed >= t.ms) fireMilestone_(t.key, { elapsedMs: elapsed });
    });

    // 2. Deep engagement: 5+ tabs visitadas + 3+ sliders mexidos
    if (!session.milestones.deep_engagement) {
      const tabsVisited = Object.keys(session.tabTime || {}).length;
      const slidersChanged = Object.keys((session.interactions || {}).sliders || {}).length;
      if (tabsVisited >= 5 && slidersChanged >= 3) {
        session.milestones.deep_engagement = Date.now();
        track("deep_engagement", { tabsVisited, slidersChanged });
      }
    }

    // 3. Quiz abandonado: abriu quiz mas não completou em 60s
    if (!session.milestones.quiz_abandoned && !session.quizCompleted) {
      const opened = session.events.find(e => e.type === "quiz_opened");
      const lastAnswer = [...session.events].reverse().find(e => e.type === "quiz_answered");
      if (opened) {
        const referenceTime = lastAnswer ? lastAnswer.t : opened.t;
        const sinceLast = elapsed - referenceTime;
        if (sinceLast > 60000) {
          session.milestones.quiz_abandoned = Date.now();
          const answeredCount = session.events.filter(e => e.type === "quiz_answered").length;
          track("quiz_abandoned", { answeredCount, idleMs: sinceLast });
        }
      }
    }
  }

  // Dispara returning_visitor uma vez no carregamento se for retorno
  if (visitNumber > 1) {
    setTimeout(() => {
      track("returning_visitor", {
        visitNumber: visitNumber,
        previousProfile: session.previousProfile || null
      });
    }, 500);
  }

  return {
    session, track, setTab, trackSliderChange, trackPreset,
    commitTabTime, persist, sendSessionSnapshot, SESSION_ID,
    endpoint: TELEMETRY_ENDPOINT
  };
})();

/* ============================================================
   ADMIN — painel de telemetria via ?admin=1
   Funil de conversão · Score de calor · Distribuição de perfis
   ============================================================ */

/* Score de calor (0-100): pondera tempo, identificação, quiz, perfil */
function computeHeatScore(s) {
  let score = 0;
  // Tempo (0-40 pontos): cada minuto vale 4 pontos, capa em 10min
  const min = (s.totalTimeMs || 0) / 60000;
  score += Math.min(40, min * 4);
  // Identificação (0-25 pontos)
  if (s.visitorName)  score += 7;
  if (s.visitorEmail) score += 8;
  if (s.visitorPhone) score += 8;
  if (s.visitorCity)  score += 2;
  // Quiz (0-15 pontos)
  if (s.quizCompleted) score += 15;
  // Perfil (0-20 pontos)
  if (s.profile === "turbo")    score += 20;
  else if (s.profile === "otimista") score += 15;
  else if (s.profile === "base")     score += 8;
  else if (s.profile === "conservador") score += 4;
  return Math.round(score);
}

function heatLevel(score) {
  if (score >= 70) return { key: "fire",  label: "🔥 Quente", color: "#ff6b6b" };
  if (score >= 45) return { key: "warm",  label: "♨ Morno",   color: "#ffb020" };
  if (score >= 20) return { key: "cool",  label: "🌤 Tépido", color: "#3DD9D6" };
  return { key: "cold", label: "❄ Frio", color: "#a7adca" };
}

function computeFunnel(sessions) {
  const total = sessions.length;
  const quizOpened = sessions.filter(s => (s.events || []).some(e => e.type === "quiz_opened")).length;
  const identified = sessions.filter(s =>
    (s.events || []).some(e => e.type === "quiz_identified") ||
    s.visitorName || s.visitorEmail
  ).length;
  const quizCompleted = sessions.filter(s => s.quizCompleted).length;
  const planApplied   = sessions.filter(s => (s.events || []).some(e => e.type === "quiz_plan_applied")).length;

  return [
    { key: "visit",     label: "Visitou",          n: total,         pct: 100 },
    { key: "opened",    label: "Abriu quiz",       n: quizOpened,    pct: total ? (quizOpened / total) * 100 : 0 },
    { key: "id",        label: "Identificou-se",   n: identified,    pct: total ? (identified / total) * 100 : 0 },
    { key: "completed", label: "Completou quiz",   n: quizCompleted, pct: total ? (quizCompleted / total) * 100 : 0 },
    { key: "applied",   label: "Aplicou plano",    n: planApplied,   pct: total ? (planApplied / total) * 100 : 0 }
  ];
}

function computeProfileDist(sessions) {
  const all = sessions.filter(s => s.profile);
  const total = all.length || 1;
  const counts = { conservador: 0, base: 0, otimista: 0, turbo: 0 };
  all.forEach(s => { if (counts[s.profile] !== undefined) counts[s.profile]++; });
  const order = [
    { key: "conservador", label: "Conservador", emoji: "🌱", color: "#a7adca" },
    { key: "base",        label: "Base",        emoji: "⚖", color: "#4B6CE2" },
    { key: "otimista",    label: "Otimista",    emoji: "🚀", color: "#39e887" },
    { key: "turbo",       label: "Turbo",       emoji: "⚡", color: "#ffb020" }
  ];
  return order.map(p => ({ ...p, n: counts[p.key], pct: (counts[p.key] / total) * 100 }));
}

function computeTopSliders(sessions) {
  const counts = {};
  const friendly = {
    faturamentoPorMaquina: "Faturamento / máquina",
    percReinvestFase1: "Reinvest Fase 1",
    duracaoFase1Meses: "Duração Fase 1",
    percReinvestFase2: "Reinvest Fase 2",
    reservaCapital: "Reserva de capital",
    capacidadeImplantacao: "Capacidade implantação",
    horizonteMeses: "Horizonte"
  };
  sessions.forEach(s => {
    const sliders = (s.interactions && s.interactions.sliders) || {};
    Object.keys(sliders).forEach(k => {
      counts[k] = (counts[k] || 0) + (sliders[k].changes || 1);
    });
  });
  return Object.entries(counts)
    .map(([k, n]) => ({ key: k, label: friendly[k] || k, n }))
    .sort((a, b) => b.n - a.n);
}

function computeAvgTime(sessions) {
  const times = sessions.map(s => s.totalTimeMs || 0).filter(t => t > 0);
  if (!times.length) return 0;
  return times.reduce((a, b) => a + b, 0) / times.length / 60000;
}

function maybeShowAdmin() {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("admin") !== "1") return;

    const idx = JSON.parse(localStorage.getItem("avend-tel-index") || "[]");
    const sessions = idx.map(id => {
      try { return JSON.parse(localStorage.getItem("avend-tel-" + id)); } catch { return null; }
    }).filter(Boolean);

    // Computações
    const funnel       = computeFunnel(sessions);
    const profileDist  = computeProfileDist(sessions);
    const topSliders   = computeTopSliders(sessions);
    const avgMin       = computeAvgTime(sessions);
    const totalQuizCompleted = sessions.filter(s => s.quizCompleted).length;
    const totalIdentified = sessions.filter(s => s.visitorName || s.visitorEmail).length;
    const totalReturning = sessions.filter(s => (s.visitNumber || 1) > 1).length;
    const totalDeepEngaged = sessions.filter(s => s.milestones && s.milestones.deep_engagement).length;

    // Sessões com score, ordenadas DESC por calor
    const enriched = sessions.map(s => ({ s, score: computeHeatScore(s), heat: heatLevel(computeHeatScore(s)) }))
      .sort((a, b) => b.score - a.score);

    const fmtPct = v => v.toFixed(0) + "%";
    const fmtMin = ms => (ms / 60000).toFixed(1);

    const baseUrl = location.origin + location.pathname.replace(/\/?(\?.*)?$/, "/");

    const html = `
      <div class="admin-panel admin-panel-pro">
        <header class="admin-head">
          <div>
            <h2>📊 AVEND · Painel de Telemetria</h2>
            <p class="admin-subtitle">Análise de comportamento e leads — dados locais (${sessions.length} sessões)</p>
          </div>
          <button class="admin-close" type="button" aria-label="Fechar">✕</button>
        </header>

        <!-- Gerador de URL com querystring -->
        <section class="admin-section admin-urlbuilder">
          <h3 class="admin-section-title">🔗 Gerador de link personalizado</h3>
          <p class="admin-urlbuilder-hint">
            Preencha os dados que você já tem do investidor. Quando ele abrir o link,
            o quiz já vem pré-preenchido e a telemetria captura desde o primeiro segundo.
          </p>
          <div class="admin-urlbuilder-grid">
            <label class="admin-ub-field">
              <span>Nome</span>
              <input type="text" id="ub-name" placeholder="João da Silva" />
            </label>
            <label class="admin-ub-field">
              <span>E-mail</span>
              <input type="email" id="ub-email" placeholder="joao@empresa.com" />
            </label>
            <label class="admin-ub-field">
              <span>Telefone</span>
              <input type="tel" id="ub-phone" placeholder="11987654321" />
            </label>
            <label class="admin-ub-field">
              <span>Cidade / UF</span>
              <input type="text" id="ub-city" placeholder="São Paulo / SP" />
            </label>
            <label class="admin-ub-field">
              <span>ID externo (CRM)</span>
              <input type="text" id="ub-id" placeholder="opcional" />
            </label>
          </div>
          <div class="admin-ub-output">
            <input type="text" id="ub-result" readonly value="${baseUrl}" />
            <button class="admin-btn admin-btn-primary" id="ub-copy" type="button">📋 Copiar</button>
            <button class="admin-btn" id="ub-wa" type="button">💬 Compartilhar WhatsApp</button>
          </div>
          <div class="admin-ub-feedback" id="ub-feedback"></div>
        </section>

        <!-- KPIs gerais -->
        <div class="admin-kpis">
          <div class="admin-kpi"><div class="admin-kpi-val">${sessions.length}</div><div class="admin-kpi-lbl">Sessões totais</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${totalIdentified}</div><div class="admin-kpi-lbl">Identificados</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${totalQuizCompleted}</div><div class="admin-kpi-lbl">Quiz completos</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${totalReturning}<small>↻</small></div><div class="admin-kpi-lbl">Retornantes</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${totalDeepEngaged}<small>🎯</small></div><div class="admin-kpi-lbl">Engajamento profundo</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${avgMin.toFixed(1)}<small>min</small></div><div class="admin-kpi-lbl">Tempo médio</div></div>
          <div class="admin-kpi admin-kpi-hot"><div class="admin-kpi-val">${enriched.filter(e => e.score >= 70).length}</div><div class="admin-kpi-lbl">🔥 Leads quentes</div></div>
        </div>

        <!-- Funil -->
        <section class="admin-section">
          <h3 class="admin-section-title">Funil de conversão</h3>
          <div class="admin-funnel">
            ${funnel.map((f, i) => {
              const prev = i > 0 ? funnel[i-1].n : f.n;
              const dropoff = i > 0 && prev > 0 ? ((prev - f.n) / prev) * 100 : 0;
              return `
                <div class="admin-funnel-row">
                  <div class="admin-funnel-label">${f.label}</div>
                  <div class="admin-funnel-bar">
                    <span class="admin-funnel-fill" style="width:${Math.max(2, f.pct)}%"></span>
                    <span class="admin-funnel-num">${f.n}</span>
                  </div>
                  <div class="admin-funnel-pct">${fmtPct(f.pct)}</div>
                  ${i > 0 ? `<div class="admin-funnel-drop">${dropoff > 0 ? `↓ ${fmtPct(dropoff)} drop` : "—"}</div>` : `<div class="admin-funnel-drop">base</div>`}
                </div>
              `;
            }).join("")}
          </div>
        </section>

        <!-- Distribuição de perfis + Top sliders (lado a lado) -->
        <section class="admin-section admin-grid-2">
          <div>
            <h3 class="admin-section-title">Distribuição de perfis</h3>
            ${profileDist.every(p => p.n === 0) ? `<p class="admin-empty">Nenhum perfil identificado ainda.</p>` : `
              <div class="admin-profiles">
                ${profileDist.map(p => `
                  <div class="admin-profile-row">
                    <span class="admin-profile-emoji" aria-hidden="true">${p.emoji}</span>
                    <span class="admin-profile-label">${p.label}</span>
                    <span class="admin-profile-bar">
                      <span class="admin-profile-fill" style="width:${p.pct}%; background:${p.color};"></span>
                    </span>
                    <span class="admin-profile-num">${p.n}</span>
                    <span class="admin-profile-pct">${fmtPct(p.pct)}</span>
                  </div>
                `).join("")}
              </div>
            `}
          </div>
          <div>
            <h3 class="admin-section-title">Top sliders mexidos</h3>
            ${topSliders.length === 0 ? `<p class="admin-empty">Ninguém mexeu em sliders ainda.</p>` : `
              <ol class="admin-sliders">
                ${topSliders.slice(0, 7).map((sl, i) => `
                  <li>
                    <span class="admin-slider-rank">${i + 1}</span>
                    <span class="admin-slider-label">${sl.label}</span>
                    <span class="admin-slider-count">${sl.n} mexidas</span>
                  </li>
                `).join("")}
              </ol>
            `}
          </div>
        </section>

        <!-- Sessões -->
        <section class="admin-section">
          <header class="admin-list-head">
            <h3 class="admin-section-title">Sessões (ordenadas por calor)</h3>
            <div class="admin-actions">
              <button class="admin-btn admin-export" type="button">⬇ Exportar JSON</button>
              <button class="admin-btn admin-btn-danger admin-clear" type="button">🗑 Limpar tudo</button>
            </div>
          </header>
          <div class="admin-list">
            ${enriched.map(({ s, score, heat }) => {
              const dur = (s.totalTimeMs || (Date.now() - s.startedAt));
              const visitorTag = s.visitorName || s.visitorEmail || s.visitorId || "anônimo";
              const subTag = [s.visitorEmail, s.visitorPhone, s.visitorCity].filter(Boolean).join(" · ");
              const profileTag = s.quizCompleted
                ? `<span class="admin-tag admin-tag-ok">${(s.profile || "completou").toUpperCase()}</span>`
                : (s.events||[]).some(e=>e.type==="quiz_opened")
                  ? `<span class="admin-tag admin-tag-warn">abriu quiz</span>`
                  : `<span class="admin-tag">não respondeu</span>`;
              const badges = [];
              if ((s.visitNumber || 1) > 1)        badges.push(`<span class="admin-badge admin-badge-return" title="Visita #${s.visitNumber}">↻ ${s.visitNumber}ª</span>`);
              if (s.milestones && s.milestones.deep_engagement) badges.push(`<span class="admin-badge admin-badge-deep" title="Engajamento profundo">🎯</span>`);
              if (s.milestones && s.milestones["15m"])          badges.push(`<span class="admin-badge admin-badge-time" title="+15min na página">⏱ 15+</span>`);
              else if (s.milestones && s.milestones["10m"])     badges.push(`<span class="admin-badge admin-badge-time" title="+10min na página">⏱ 10+</span>`);
              if (s.botSuspected) badges.push(`<span class="admin-badge admin-badge-bot" title="Suspeita de bot (honeypot)">🤖</span>`);
              return `
                <details class="admin-session" data-heat="${heat.key}">
                  <summary>
                    <span class="admin-heat" style="background:${heat.color}; box-shadow:0 0 12px ${heat.color}55;">${score}</span>
                    <span class="admin-session-visitor-block">
                      <span class="admin-session-visitor">
                        ${visitorTag}
                        ${badges.join("")}
                      </span>
                      ${subTag ? `<span class="admin-session-sub">${subTag}</span>` : ""}
                    </span>
                    <span class="admin-session-time">${fmtMin(dur)} min</span>
                    ${profileTag}
                    <span class="admin-session-events">${(s.events||[]).length} eventos</span>
                  </summary>
                  <pre>${JSON.stringify(s, null, 2)}</pre>
                </details>
              `;
            }).join("")}
          </div>
        </section>

      </div>
    `;

    const div = document.createElement("div");
    div.className = "admin-overlay";
    div.innerHTML = html;
    document.body.appendChild(div);
    div.querySelector(".admin-close").addEventListener("click", () => div.remove());
    div.querySelector(".admin-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `avend-telemetry-${Date.now()}.json`;
      a.click();
    });
    div.querySelector(".admin-clear").addEventListener("click", () => {
      if (!confirm("Limpar todas as sessões registradas localmente?\n\nIsso NÃO afeta os dados na sua planilha Google.")) return;
      idx.forEach(id => localStorage.removeItem("avend-tel-" + id));
      localStorage.removeItem("avend-tel-index");
      div.remove();
    });

    // URL Builder: monta URL com querystring em tempo real
    const buildUrl = () => {
      const params = new URLSearchParams();
      const map = { name: "ub-name", email: "ub-email", phone: "ub-phone", city: "ub-city", id: "ub-id" };
      Object.entries(map).forEach(([key, inputId]) => {
        const v = (document.getElementById(inputId)?.value || "").trim();
        if (v) params.set(key, v);
      });
      const qs = params.toString();
      return baseUrl + (qs ? "?" + qs : "");
    };
    const updateResult = () => {
      const result = document.getElementById("ub-result");
      if (result) result.value = buildUrl();
    };
    ["ub-name", "ub-email", "ub-phone", "ub-city", "ub-id"].forEach(id => {
      div.querySelector("#" + id)?.addEventListener("input", updateResult);
    });
    div.querySelector("#ub-copy")?.addEventListener("click", async () => {
      const url = buildUrl();
      const fb = document.getElementById("ub-feedback");
      try {
        await navigator.clipboard.writeText(url);
        if (fb) { fb.textContent = "✓ Copiado pra área de transferência"; fb.dataset.state = "ok"; }
      } catch (err) {
        // Fallback: seleciona o input
        const input = document.getElementById("ub-result");
        input.select(); document.execCommand("copy");
        if (fb) { fb.textContent = "✓ Copiado (selecionado)"; fb.dataset.state = "ok"; }
      }
      setTimeout(() => { if (fb) { fb.textContent = ""; fb.dataset.state = ""; } }, 3000);
    });
    div.querySelector("#ub-wa")?.addEventListener("click", () => {
      const url = buildUrl();
      const name = (document.getElementById("ub-name")?.value || "").trim();
      const greeting = name ? `Olá ${name.split(" ")[0]}!` : "Olá!";
      const msg = `${greeting} Preparei um diagnóstico personalizado da AVEND pra você. Demora 2 minutos:\n\n${url}\n\nQualquer dúvida estou à disposição.`;
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    });
  } catch (e) { console.error("Admin panel error:", e); }
}

/* ---------- Setup do bloco standalone de Mercado/Território ---------- */
function bindMarketTerritory() {
  const form     = document.getElementById("mkt-territory-search");
  const input    = document.getElementById("mkt-territory-city");
  const wrap     = document.getElementById("market-territory-standalone");
  const datalist = document.getElementById("mkt-territory-list");
  if (!form || !input || !wrap) {
    console.warn("[market-territory] DOM incompleto", { form: !!form, input: !!input, wrap: !!wrap });
    return;
  }

  // BLINDAGEM: prevent default no submit, sempre — mesmo se o
  // módulo não tiver carregado, evita reload da página.
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof MarketTerritory === "undefined") {
      console.error("[market-territory] módulo não carregou. Verifique se market-territory.js está acessível.");
      wrap.hidden = false;
      wrap.innerHTML = '<p style="color:#ffb020; padding:16px; text-align:center;">⚠ Módulo não carregou. Recarregue a página com Ctrl+F5.</p>';
      return;
    }
    const value = (input.value || "").trim();
    if (!value) return;
    wrap.hidden = false;
    MarketTerritory.render(wrap, value);
    try { wrap.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch (e2) { /* navegadores antigos */ }
  });

  if (typeof MarketTerritory === "undefined") {
    console.warn("[market-territory] MarketTerritory ainda não definido no bind — submit usará fallback.");
    return;
  }

  // Autocomplete via datalist com as cidades da base
  if (datalist) MarketTerritory.populateDatalist(datalist);

  // Pré-popular com cidade do quiz, se o usuário já preencheu
  try {
    const saved = JSON.parse(localStorage.getItem("avend-quiz-data") || "{}");
    if (saved && saved.identity && saved.identity.city && !input.value) {
      input.value = saved.identity.city;
    }
  } catch (e) { /* ignore */ }

  // Mostra contagem real de cidades na UI — se cities-data.js não
  // carregou, vai aparecer "27 cidades" e o usuário identifica na hora.
  const count = MarketTerritory.citiesCount();
  const countEl = document.getElementById("mkt-territory-count");
  if (countEl) {
    const formatted = new Intl.NumberFormat("pt-BR").format(count);
    countEl.textContent = formatted + " cidades";
    if (count < 1000) {
      countEl.style.color = "#ffb020";
      countEl.title = "Base reduzida — cities-data.js não carregou. Recarregue a página com Ctrl+F5.";
    }
  }
  console.log("[market-territory] standalone ligado · " + count + " cidades na base");

  // Permalink: se a URL tem ?cidade=catanduva-sp, auto-busca ao carregar.
  try {
    const slugFromURL = MarketTerritory.readCityFromURL();
    if (slugFromURL) {
      const city = MarketTerritory.findBySlug(slugFromURL);
      if (city) {
        input.value = city.n + " / " + city.uf;
        wrap.hidden = false;
        MarketTerritory.render(wrap, city.n, city.uf);
        // Ativa a tab Mercado pra o usuário ver direto
        const mercadoTab = document.querySelector('.tab[data-tab="mercado"]');
        if (mercadoTab) mercadoTab.click();
        // Scroll após pequeno delay (depois da troca de tab)
        setTimeout(() => {
          try { wrap.scrollIntoView({ behavior: "smooth", block: "start" }); }
          catch (e) { /* ignore */ }
        }, 200);
      }
    }
  } catch (e) { console.warn("[market-territory] erro ao ler permalink:", e); }
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  bindSliders();
  updateCenarioLabel();
  renderAll();
  renderMarketChart();
  bindQuiz();
  bindVsl();
  bindMarketTerritory();
  maybeAutoOpenQuiz();
  maybeShowAdmin();
  TELEMETRY.track("page_loaded", { url: location.href });
});

/* Expor para debug no console (opcional) */
if (typeof window !== "undefined") {
  window.AVEND = { simulate, calcularMes, calcImpostoMensal, MODEL, state };
}
