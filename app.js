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
}
function bindTabs() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));
  document.querySelectorAll("[data-goto]").forEach(el => el.addEventListener("click", () => activateTab(el.dataset.goto)));
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
      state[stateKey] = v;
      output.textContent = fmt(v);
      updateCenarioLabel();
      renderAll();
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
  const v = state.faturamentoPorMaquina;
  let nome = "Customizado";
  if (v === 10000) nome = "Base";
  else if (v === 15000) nome = "Otimista";
  else if (v === 7000) nome = "Conservador";
  label.textContent = `${nome} (${fmtBRL(v)}/máq)`;
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

function renderCharts(sim) {
  const labels = sim.linhas.map(r => r.mes);
  const frota = sim.linhas.map(r => r.maquinasAtivas);
  const faturamento = sim.linhas.map(r => r.faturamentoTotal);
  const lucro = sim.linhas.map(r => r.lucroLiquido);
  const imposto = sim.linhas.map(r => r.imposto.valor);
  const caixa = sim.linhas.map(r => r.caixaAcumulado);

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

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  bindSliders();
  updateCenarioLabel();
  renderAll();
});

/* Expor para debug no console (opcional) */
if (typeof window !== "undefined") {
  window.AVEND = { simulate, calcularMes, calcImpostoMensal, MODEL, state };
}
