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

  // Re-render charts that may have been initialized while hidden
  if (name === "mercado") {
    requestAnimationFrame(() => {
      if (state.charts.density) state.charts.density.resize();
      else renderMarketChart();
    });
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
  setText("kpi-lucro-hint", `Mês ${sim.horizonteMeses} · frota completa`);

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
          <span>Frota após ativação: <strong>${frotaDepois} máq.</strong></span>
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
        <div class="rt-row"><span>Frota</span><strong>${r.maquinasAtivas} máq</strong></div>
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
  }
];

/* ---------- Mapeamento de respostas → parâmetros do simulador ---------- */
function calcSuggestion(answers) {
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
  const rationale = [];

  // === Horizonte (direto) ===
  const horMap = { "3": 36, "5": 60, "7": 84, "10": 120 };
  if (answers.horizonte) {
    p.horizonteMeses = horMap[answers.horizonte] || 60;
    rationale.push(`Horizonte de <strong>${answers.horizonte} ano${answers.horizonte === "1" ? "" : "s"}</strong> — alinhado à sua resposta.`);
  }

  // === Objetivo (afeta reinvest e fat) ===
  if (answers.objetivo === "renda-extra") {
    p.percReinvestFase2 = 30;
    p.faturamentoPorMaquina = 8000;
    rationale.push("Foco em <strong>renda extra</strong> → Fase 2 com 30% reinvest, pró-labore aparece cedo.");
  } else if (answers.objetivo === "sair-clt") {
    p.percReinvestFase2 = 70;
    p.duracaoFase1Meses = 36;
    rationale.push("Para <strong>sair da CLT</strong>, deixei Fase 1 em 3 anos com 100% reinvest e Fase 2 a 70% — escala consistente sem sufocar caixa.");
  } else if (answers.objetivo === "viver-disso") {
    p.percReinvestFase2 = 50;
    p.faturamentoPorMaquina = 12000;
    p.duracaoFase1Meses = 24;
    rationale.push("Para <strong>viver disso</strong>, Fase 1 mais curta (2 anos) — pró-labore consistente entra antes.");
  } else if (answers.objetivo === "patrimonio") {
    p.percReinvestFase1 = 100;
    p.percReinvestFase2 = 100;
    p.faturamentoPorMaquina = 12000;
    p.duracaoFase1Meses = 60;
    rationale.push("Foco em <strong>patrimônio escalável</strong> → 100% reinvest nas duas fases, flywheel total.");
  }

  // === Capital ===
  if (answers.capital === "so-1a") {
    p.capacidadeImplantacao = 1;
    p.reservaCapital = 3000;
    rationale.push("Sem capital adicional, expansão depende 100% do reinvestimento — capacidade conservadora de <strong>1 máq/mês</strong>.");
  } else if (answers.capital === "50-100") {
    p.capacidadeImplantacao = Math.max(p.capacidadeImplantacao, 1);
  } else if (answers.capital === "100-300") {
    p.capacidadeImplantacao = Math.max(p.capacidadeImplantacao, 2);
    rationale.push("Capital adicional permite manter capacidade de <strong>2 máq/mês</strong> mesmo nos primeiros meses.");
  } else if (answers.capital === "300+") {
    p.capacidadeImplantacao = 3;
    p.reservaCapital = 8000;
    rationale.push("R$ 300k+ em capital → expansão acelerada para <strong>3 máq/mês</strong> independente do reinvestimento.");
  }

  // === Reinvest (refina objetivo) ===
  if (answers.reinvest === "preciso-tirar") {
    p.percReinvestFase1 = Math.min(p.percReinvestFase1, 70);
    p.percReinvestFase2 = Math.min(p.percReinvestFase2, 30);
    rationale.push("Como você precisa tirar pra viver, Fase 1 a <strong>70%</strong> e Fase 2 a 30% — pró-labore aparece desde o início.");
  } else if (answers.reinvest === "reinvesto-tudo") {
    p.percReinvestFase1 = 100;
    p.percReinvestFase2 = Math.max(p.percReinvestFase2, 70);
  }

  // === Meta de lucro ===
  if (answers.meta === "ate-15k") {
    p.faturamentoPorMaquina = Math.min(p.faturamentoPorMaquina, 8000);
  } else if (answers.meta === "50-150k") {
    p.faturamentoPorMaquina = Math.max(p.faturamentoPorMaquina, 12000);
    p.capacidadeImplantacao = Math.max(p.capacidadeImplantacao, 2);
    rationale.push("Meta R$ 50–150k/mês → faturamento médio R$ 12k/máq e capacidade ≥ 2/mês.");
  } else if (answers.meta === "150+") {
    p.faturamentoPorMaquina = 15000;
    p.capacidadeImplantacao = Math.max(p.capacidadeImplantacao, 3);
    p.percReinvestFase1 = 100;
    p.percReinvestFase2 = Math.max(p.percReinvestFase2, 70);
    rationale.push("Meta acima de R$ 150k/mês → plano arrojado: R$ 15k/máq, 3+ máq/mês, 70%+ reinvest.");
  }

  // === Risco ===
  if (answers.risco === "conservador") {
    p.faturamentoPorMaquina = Math.min(p.faturamentoPorMaquina, 9000);
    p.capacidadeImplantacao = Math.max(1, p.capacidadeImplantacao - 1);
    rationale.push("Perfil conservador → faturamento em cenário pessimista (R$ 9k/máq) e capacidade reduzida em 1.");
  } else if (answers.risco === "arrojado") {
    p.faturamentoPorMaquina = Math.max(p.faturamentoPorMaquina, 12000);
  }

  // === Dedicação ===
  if (answers.dedicacao === "horas-semana") {
    p.capacidadeImplantacao = Math.min(p.capacidadeImplantacao, 1);
    rationale.push("Dedicação reduzida → capacidade de implantação limitada a 1 máq/mês.");
  } else if (answers.dedicacao === "integral") {
    p.capacidadeImplantacao = Math.max(p.capacidadeImplantacao, 2);
  }

  // Garantir bounds dos sliders
  p.faturamentoPorMaquina = Math.max(5000, Math.min(30000, p.faturamentoPorMaquina));
  p.percReinvestFase1     = Math.max(50, Math.min(100, p.percReinvestFase1));
  p.percReinvestFase2     = Math.max(0, Math.min(100, p.percReinvestFase2));
  p.duracaoFase1Meses     = Math.max(12, Math.min(120, p.duracaoFase1Meses));
  p.reservaCapital        = Math.max(2000, Math.min(10000, p.reservaCapital));
  p.capacidadeImplantacao = Math.max(1, Math.min(5, p.capacidadeImplantacao));
  p.horizonteMeses        = Math.max(36, Math.min(120, p.horizonteMeses));

  return { params: p, rationale };
}

function classifyProfile(p) {
  let score = 0;
  if (p.faturamentoPorMaquina >= 12000) score += 2;
  else if (p.faturamentoPorMaquina >= 10000) score += 1;
  if (p.capacidadeImplantacao >= 3) score += 2;
  else if (p.capacidadeImplantacao >= 2) score += 1;
  if (p.percReinvestFase1 >= 100) score += 1;
  if (p.percReinvestFase2 >= 70) score += 2;
  else if (p.percReinvestFase2 >= 50) score += 1;
  if (p.horizonteMeses >= 84) score += 1;

  if (score <= 2) return {
    key: "conservador", emoji: "🌱",
    label: "Construtor Cauteloso",
    desc: "Crescimento controlado, renda previsível desde o início. Você prioriza segurança e caixa no bolso."
  };
  if (score <= 5) return {
    key: "base", emoji: "⚖️",
    label: "Empreendedor Equilibrado",
    desc: "Equilíbrio entre escala e segurança — o caminho da maioria da rede AVEND."
  };
  if (score <= 7) return {
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
   Slide 0 = identificação (opcional). Depois 7 perguntas (1..7).
   Total de slides = 8.
*/
const QUIZ_TOTAL_SLIDES = QUIZ_QUESTIONS.length + 1; // 1 slide de identificação + 7 perguntas

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
    ["name", "email", "phone", "city"].forEach(field => {
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
          const map = { name: "visitorName", email: "visitorEmail", phone: "visitorPhone", city: "visitorCity" };
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
        TELEMETRY.session.botSuspected = true;
        TELEMETRY.persist();
      }
    }
    // Registra evento de identificação
    if (typeof TELEMETRY !== "undefined") {
      const provided = ["name", "email", "phone", "city"].filter(f => quizState.identity[f]);
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

function showQuizResult() {
  const sug = calcSuggestion(quizState.answers);
  const profile = classifyProfile(sug.params);
  const sim = simulate(sug.params);

  // Persistir
  try {
    localStorage.setItem("avend-quiz-completed", "1");
    localStorage.setItem("avend-quiz-data", JSON.stringify({
      answers: quizState.answers,
      identity: quizState.identity,
      params: sug.params,
      profile: profile.key,
      ts: Date.now()
    }));
  } catch (e) { /* ignore */ }

  // Atualiza session da telemetria com os dados de identificação
  if (typeof TELEMETRY !== "undefined") {
    TELEMETRY.session.quizCompleted = true;
    TELEMETRY.session.profile = profile.key;
    if (quizState.identity.name)  TELEMETRY.session.visitorName  = quizState.identity.name;
    if (quizState.identity.email) TELEMETRY.session.visitorEmail = quizState.identity.email;
    if (quizState.identity.phone) TELEMETRY.session.visitorPhone = quizState.identity.phone;
    if (quizState.identity.city)  TELEMETRY.session.visitorCity  = quizState.identity.city;
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
    <div class="qr-proj"><span class="qr-proj-lbl">Frota final</span><span class="qr-proj-val">${sim.frotaFinal} máquinas</span></div>
    <div class="qr-proj qr-proj-hl"><span class="qr-proj-lbl">Lucro mensal final</span><span class="qr-proj-val">${fmtBRL(sim.lucroMensalFinal)}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Payback 1ª máq</span><span class="qr-proj-val">${sim.paybackMeses ? sim.paybackMeses + " meses" : "—"}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Patrimônio final</span><span class="qr-proj-val">${fmtBRL(sim.patrimonioFinal)}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Lucro acumulado</span><span class="qr-proj-val">${fmtBRL(sim.linhas[sim.linhas.length - 1].lucroAcumulado)}</span></div>
    <div class="qr-proj"><span class="qr-proj-lbl">Pró-labore total</span><span class="qr-proj-val">${fmtBRL(sim.totalProLabore)}</span></div>
  `;

  const rationaleList = document.getElementById("quiz-result-rationale");
  rationaleList.innerHTML = sug.rationale.length
    ? sug.rationale.map(r => `<li>${r}</li>`).join("")
    : `<li>Plano calibrado a partir do cenário base da rede.</li>`;

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
  document.getElementById("quiz-skip")?.addEventListener("click", () => {
    closeQuiz();
    TELEMETRY.track("quiz_skipped", { step: quizState.current + 1 });
    try { localStorage.setItem("avend-quiz-skipped", "1"); } catch (e) {}
  });
  document.getElementById("quiz-redo")?.addEventListener("click", () => openQuiz(true));
  document.getElementById("quiz-apply")?.addEventListener("click", applyQuizSuggestion);
  document.getElementById("open-quiz")?.addEventListener("click", () => openQuiz(true));
  document.getElementById("open-quiz-hero")?.addEventListener("click", () => openQuiz(true));
  document.getElementById("open-quiz-header")?.addEventListener("click", () => openQuiz(true));
  // ESC fecha
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("quiz-open")) {
      closeQuiz();
    }
  });
}

function maybeAutoOpenQuiz() {
  try {
    const completed = localStorage.getItem("avend-quiz-completed");
    const skipped   = localStorage.getItem("avend-quiz-skipped");
    if (!completed && !skipped) {
      // Primeira visita: abrir após hero animar
      setTimeout(() => openQuiz(true), 1200);
    }
  } catch (e) { /* ignore */ }
}

/* ============================================================
   TELEMETRY — sessão, tempo, interações
   Persistência: localStorage + (opcional) POST para Apps Script
   Configure TELEMETRY_ENDPOINT abaixo com a URL do seu Web App.
   ============================================================ */

/* >>> URL do endpoint (Apps Script Web App). Vazio = só local. <<<
   Como configurar: veja apps-script/Code.gs e apps-script/README.md
*/
const TELEMETRY_ENDPOINT = ""; // ex: "https://script.google.com/macros/s/AKfy.../exec"

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

  const session = {
    sessionId: SESSION_ID,
    startedAt: Date.now(),
    lastSeen: Date.now(),
    visitorId: null,
    visitorName: null,
    visitorEmail: null,
    visitorPhone: null,
    visitorCity: null,
    events: [],
    tabTime: {},
    interactions: { sliders: {}, presets: {}, ctas: 0 },
    quizCompleted: false,
    profile: null,
    userAgent: (typeof navigator !== "undefined" ? navigator.userAgent : ""),
    referrer: (typeof document !== "undefined" ? document.referrer : "")
  };

  // Captura visitante via query string (?name=&email=&phone=&city=&id=)
  try {
    const u = new URL(window.location.href);
    session.visitorId    = u.searchParams.get("id");
    session.visitorName  = u.searchParams.get("name") || u.searchParams.get("nome");
    session.visitorEmail = u.searchParams.get("email");
    session.visitorPhone = u.searchParams.get("phone") || u.searchParams.get("tel");
    session.visitorCity  = u.searchParams.get("city")  || u.searchParams.get("cidade");
  } catch (e) {}

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
    "quiz_completed", "quiz_plan_applied", "quiz_identified", "page_loaded"
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
  setInterval(() => {
    if (document.visibilityState === "visible") {
      commitTabTime();
      session.totalTimeMs = Date.now() - session.startedAt;
      persist();
      sendSessionSnapshot();
    }
  }, 30000);

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

    // Sessões com score, ordenadas DESC por calor
    const enriched = sessions.map(s => ({ s, score: computeHeatScore(s), heat: heatLevel(computeHeatScore(s)) }))
      .sort((a, b) => b.score - a.score);

    const fmtPct = v => v.toFixed(0) + "%";
    const fmtMin = ms => (ms / 60000).toFixed(1);

    const html = `
      <div class="admin-panel admin-panel-pro">
        <header class="admin-head">
          <div>
            <h2>📊 AVEND · Painel de Telemetria</h2>
            <p class="admin-subtitle">Análise de comportamento e leads — dados locais (${sessions.length} sessões)</p>
          </div>
          <button class="admin-close" type="button" aria-label="Fechar">✕</button>
        </header>

        <!-- KPIs gerais -->
        <div class="admin-kpis">
          <div class="admin-kpi"><div class="admin-kpi-val">${sessions.length}</div><div class="admin-kpi-lbl">Sessões totais</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${totalIdentified}</div><div class="admin-kpi-lbl">Identificados</div></div>
          <div class="admin-kpi"><div class="admin-kpi-val">${totalQuizCompleted}</div><div class="admin-kpi-lbl">Quiz completos</div></div>
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
              return `
                <details class="admin-session" data-heat="${heat.key}">
                  <summary>
                    <span class="admin-heat" style="background:${heat.color}; box-shadow:0 0 12px ${heat.color}55;">${score}</span>
                    <span class="admin-session-visitor-block">
                      <span class="admin-session-visitor">${visitorTag}</span>
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
  } catch (e) { console.error("Admin panel error:", e); }
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  bindSliders();
  updateCenarioLabel();
  renderAll();
  renderMarketChart();
  bindQuiz();
  maybeAutoOpenQuiz();
  maybeShowAdmin();
  TELEMETRY.track("page_loaded", { url: location.href });
});

/* Expor para debug no console (opcional) */
if (typeof window !== "undefined") {
  window.AVEND = { simulate, calcularMes, calcImpostoMensal, MODEL, state };
}
