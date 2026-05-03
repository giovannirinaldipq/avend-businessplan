/* ============================================================
   MarketTerritory — Diagnóstico de Mercado e Mapeamento de
   Território para a franqueadora AVEND.

   Premissas de design:
   - Sem dependência de API externa (compatível com Apps Script).
   - Base local de ~140 cidades brasileiras (capitais + maiores).
   - Fallback manual quando a cidade não está na base.
   - Foco 100% em demografia e território — sem ROI/finanças.

   API pública:
     MarketTerritory.render(container, cidadeRaw, ufRaw?)
     MarketTerritory.calculate(populacao, cidade, uf)
     MarketTerritory.findCity(cidade, uf?)
     MarketTerritory.parseInput("São Paulo / SP")  → { cidade, uf }

   Estrutura de dados (saída):
     {
       cidade, uf, populacao,
       analise_mercado: { maquinas_atuais, capacidade_maxima, gap_oportunidade },
       mapeamento_pontos: { hospitais, industrias, academias, corporativo, total_premium }
     }
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- BASE DE DADOS LOCAL ----------------------------
     Estimativas IBGE (Censo 2022 + projeções 2024).
     Formato compacto: [nome, UF, populacao].
     Cobertura: 27 capitais + cidades ≥ ~120k hab + alvos
     estratégicos da rede AVEND.
     ----------------------------------------------------------- */
  const CITIES_RAW = [
    // Top 50 — metrópoles
    ["São Paulo", "SP", 11451245],
    ["Rio de Janeiro", "RJ", 6211423],
    ["Brasília", "DF", 2817381],
    ["Fortaleza", "CE", 2428678],
    ["Salvador", "BA", 2418005],
    ["Belo Horizonte", "MG", 2315560],
    ["Manaus", "AM", 2063689],
    ["Curitiba", "PR", 1773733],
    ["Recife", "PE", 1488920],
    ["Goiânia", "GO", 1437366],
    ["Porto Alegre", "RS", 1332570],
    ["Belém", "PA", 1303403],
    ["Guarulhos", "SP", 1291784],
    ["Campinas", "SP", 1138309],
    ["São Luís", "MA", 1037241],
    ["Maceió", "AL", 957916],
    ["Duque de Caxias", "RJ", 924624],
    ["Campo Grande", "MS", 916001],
    ["São Gonçalo", "RJ", 896744],
    ["Teresina", "PI", 866300],
    ["João Pessoa", "PB", 833932],
    ["Nova Iguaçu", "RJ", 821128],
    ["São Bernardo do Campo", "SP", 815905],
    ["Santo André", "SP", 760181],
    ["Natal", "RN", 751300],
    ["Osasco", "SP", 740000],
    ["São José dos Campos", "SP", 729737],
    ["Ribeirão Preto", "SP", 698129],
    ["Uberlândia", "MG", 706597],
    ["Jaboatão dos Guararapes", "PE", 706867],
    ["Sorocaba", "SP", 687357],
    ["Contagem", "MG", 668949],
    ["Aracaju", "SE", 657013],
    ["Feira de Santana", "BA", 619609],
    ["Cuiabá", "MT", 618124],
    ["Joinville", "SC", 616317],
    ["Aparecida de Goiânia", "GO", 590146],
    ["Londrina", "PR", 575377],
    ["Juiz de Fora", "MG", 540756],
    ["Ananindeua", "PA", 535547],
    ["Serra", "ES", 520653],
    ["Caxias do Sul", "RS", 517451],
    ["Niterói", "RJ", 515317],
    ["Belford Roxo", "RJ", 513117],
    ["Florianópolis", "SC", 508826],
    ["Campos dos Goytacazes", "RJ", 487186],
    ["São José do Rio Preto", "SP", 469173],
    ["Porto Velho", "RO", 460434],
    ["Macapá", "AP", 442933],
    ["Jundiaí", "SP", 442658],
    ["Betim", "MG", 444690],

    // 51-100 — cidades médias-grandes
    ["São João de Meriti", "RJ", 454857],
    ["Boa Vista", "RR", 436591],
    ["Mogi das Cruzes", "SP", 432192],
    ["Maringá", "PR", 423666],
    ["Santos", "SP", 418375],
    ["Mauá", "SP", 417064],
    ["Rio Branco", "AC", 412723],
    ["Vila Velha", "ES", 414420],
    ["Montes Claros", "MG", 414240],
    ["Piracicaba", "SP", 410275],
    ["Diadema", "SP", 393206],
    ["Olinda", "PE", 393115],
    ["Caruaru", "PE", 376783],
    ["Anápolis", "GO", 391772],
    ["Bauru", "SP", 379146],
    ["Carapicuíba", "SP", 369584],
    ["Itaquaquecetuba", "SP", 363788],
    ["Caucaia", "CE", 365212],
    ["Blumenau", "SC", 366418],
    ["Cariacica", "ES", 363264],
    ["Franca", "SP", 358539],
    ["Ponta Grossa", "PR", 358838],
    ["São Vicente", "SP", 357334],
    ["Petrolina", "PE", 354317],
    ["Vitória da Conquista", "BA", 332419],
    ["Cascavel", "PR", 332332],
    ["Ribeirão das Neves", "MG", 331045],
    ["Praia Grande", "SP", 330845],
    ["São José dos Pinhais", "PR", 329058],
    ["Pelotas", "RS", 327778],
    ["Canoas", "RS", 327069],
    ["Vitória", "ES", 322869],
    ["Guarujá", "SP", 322750],
    ["Uberaba", "MG", 339984],
    ["Palmas", "TO", 313349],
    ["Paulista", "PE", 311988],
    ["Limeira", "SP", 308482],
    ["Santarém", "PA", 308339],
    ["Petrópolis", "RJ", 304954],
    ["Taubaté", "SP", 305034],
    ["Camaçari", "BA", 300372],
    ["Suzano", "SP", 300559],
    ["Mossoró", "RN", 300618],
    ["Marabá", "PA", 287079],
    ["Várzea Grande", "MT", 287541],
    ["Foz do Iguaçu", "PR", 287227],
    ["Sumaré", "SP", 286211],
    ["Barueri", "SP", 274278],
    ["Taboão da Serra", "SP", 273324],
    ["Gravataí", "RS", 271675],

    // 101-140 — cidades médias regionais relevantes
    ["Santa Maria", "RS", 271633],
    ["Itajaí", "SC", 264054],
    ["Governador Valadares", "MG", 257383],
    ["Águas Lindas de Goiás", "GO", 257521],
    ["Imperatriz", "MA", 256033],
    ["Macaé", "RJ", 256672],
    ["Indaiatuba", "SP", 256223],
    ["Cotia", "SP", 261268],
    ["Volta Redonda", "RJ", 261293],
    ["Chapecó", "SC", 254135],
    ["Rio Verde", "GO", 253156],
    ["São Carlos", "SP", 252378],
    ["São José", "SC", 250181],
    ["Itaboraí", "RJ", 235579],
    ["Hortolândia", "SP", 235994],
    ["Rondonópolis", "MT", 245947],
    ["Sete Lagoas", "MG", 245766],
    ["Embu das Artes", "SP", 245149],
    ["Americana", "SP", 245574],
    ["Marília", "SP", 240590],
    ["Divinópolis", "MG", 240408],
    ["Ipatinga", "MG", 240735],
    ["Cabo Frio", "RJ", 232482],
    ["Magé", "RJ", 247612],
    ["Colombo", "PR", 247719],
    ["Dourados", "MS", 226404],
    ["Itapevi", "SP", 220730],
    ["Criciúma", "SC", 219393],
    ["Itabuna", "BA", 213763],
    ["Luziânia", "GO", 215048],
    ["Nova Friburgo", "RJ", 191664],
    ["Teresópolis", "RJ", 188081],
    ["Jaraguá do Sul", "SC", 184579],
    ["Guarapuava", "PR", 184543],
    ["Valparaíso de Goiás", "GO", 174000],
    ["Bragança Paulista", "SP", 171516],
    ["Itu", "SP", 173631],
    ["Ilhéus", "BA", 159265],
    ["Sinop", "MT", 159340],
    ["Lages", "SC", 158846],
    ["Atibaia", "SP", 156408],
    ["Parnaíba", "PI", 156481],
    ["Caxias", "MA", 165525],
    ["Balneário Camboriú", "SC", 145796],
    ["Toledo", "PR", 142880],
    ["Teófilo Otoni", "MG", 142016],
    ["Brusque", "SC", 138445],
    ["Apucarana", "PR", 137200],
    ["Itaguaí", "RJ", 134761],
    ["Resende", "RJ", 134371],
    ["Três Lagoas", "MS", 130000],
    ["Uruguaiana", "RS", 130084],
    ["Salto", "SP", 124200],
    ["Catalão", "GO", 121000],
    ["Umuarama", "PR", 117500],
    ["Parintins", "AM", 116655],
    ["Ji-Paraná", "RO", 116610]
  ];

  // Hidrata para objetos { n, uf, pop } — uma vez no carregamento
  const CITIES = CITIES_RAW.map(([n, uf, pop]) => ({ n, uf, pop }));

  /* ---------- NORMALIZAÇÃO E PARSING DE INPUT ---------------- */

  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")  // remove acentos
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ");
  }

  // Aceita: "São Paulo", "São Paulo / SP", "São Paulo - SP",
  //         "São Paulo, SP", "São Paulo SP"
  function parseInput(raw) {
    const txt = String(raw || "").trim();
    if (!txt) return { cidade: "", uf: "" };

    // Padrões com separador explícito
    let m = txt.match(/^(.+?)\s*[\/,\-–|]\s*([A-Za-z]{2})\s*$/);
    if (m) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };

    // Padrão "Cidade SP" (UF colada no final)
    m = txt.match(/^(.+?)\s+([A-Za-z]{2})\s*$/);
    if (m && /^[A-Za-z]{2}$/.test(m[2])) {
      return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
    }

    return { cidade: txt, uf: "" };
  }

  function findCity(cidadeRaw, ufRaw) {
    const cn = normalize(cidadeRaw);
    if (!cn) return null;
    const uf = (ufRaw || "").toUpperCase();

    // 1) Match exato cidade + UF
    if (uf) {
      const exact = CITIES.find(c => normalize(c.n) === cn && c.uf === uf);
      if (exact) return exact;
    }

    // 2) Match por nome de cidade
    const byName = CITIES.filter(c => normalize(c.n) === cn);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      if (uf) return byName.find(c => c.uf === uf) || null;
      return null;  // ambíguo, precisa UF
    }

    // 3) Match por prefixo (ex: "Rib. Preto" → "Ribeirão Preto" não bate,
    //    mas "Sao Paul" bate). Só aceita se for único.
    const byPrefix = CITIES.filter(c => normalize(c.n).startsWith(cn));
    if (byPrefix.length === 1) return byPrefix[0];

    return null;
  }

  /* ---------- CÁLCULOS DO MOTOR ------------------------------ */

  function calculate(populacao, cidade, uf) {
    const pop = Math.max(0, Math.floor(Number(populacao) || 0));
    const fator = pop / 100000;

    const maquinas_atuais = Math.floor(pop / 2500);
    const capacidade_maxima = Math.floor(pop / 400);
    const gap_oportunidade = Math.max(0, capacidade_maxima - maquinas_atuais);

    const hospitais = Math.floor(fator * 3);
    const industrias = Math.floor(fator * 8);
    const academias = Math.floor(fator * 15);
    const corporativo = Math.floor(fator * 5);
    const total_premium = hospitais + industrias + academias + corporativo;

    return {
      cidade: cidade || "",
      uf: uf || "",
      populacao: pop,
      analise_mercado: { maquinas_atuais, capacidade_maxima, gap_oportunidade },
      mapeamento_pontos: { hospitais, industrias, academias, corporativo, total_premium }
    };
  }

  /* ---------- HELPERS DE FORMATAÇÃO -------------------------- */

  const NF = new Intl.NumberFormat("pt-BR");
  function fmtNum(n) { return NF.format(Math.floor(Number(n) || 0)); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* ---------- BUILD HTML ------------------------------------- */

  function buildHTML(data) {
    const m = data.analise_mercado;
    const p = data.mapeamento_pontos;
    const ocupacao = m.capacidade_maxima > 0
      ? Math.round((m.maquinas_atuais / m.capacidade_maxima) * 100)
      : 0;
    const gapPct = 100 - ocupacao;

    return `
      <div class="mkt-head">
        <div class="mkt-eyebrow">DIAGNÓSTICO DE MERCADO · TERRITÓRIO</div>
        <h3 class="mkt-title">
          ${escapeHtml(data.cidade)}${data.uf ? `<span class="mkt-uf">/${escapeHtml(data.uf)}</span>` : ""}
        </h3>
        <p class="mkt-sub">
          População estimada: <strong>${fmtNum(data.populacao)}</strong> habitantes
        </p>
      </div>

      <div class="mkt-gap-block">
        <div class="mkt-gap-chart-wrap">
          <canvas id="mkt-donut" width="240" height="240" aria-label="Gráfico de gap de mercado"></canvas>
          <div class="mkt-gap-center">
            <div class="mkt-gap-pct">${gapPct}%</div>
            <div class="mkt-gap-lbl">do mercado<br/>ainda livre</div>
          </div>
        </div>
        <div class="mkt-gap-stats">
          <div class="mkt-stat mkt-stat-current">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">Operando hoje (estimativa)</span>
            <span class="mkt-stat-val">${fmtNum(m.maquinas_atuais)}</span>
            <span class="mkt-stat-aux">máquinas no baseline Brasil</span>
          </div>
          <div class="mkt-stat mkt-stat-max">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">Capacidade máxima</span>
            <span class="mkt-stat-val">${fmtNum(m.capacidade_maxima)}</span>
            <span class="mkt-stat-aux">saturação real do território</span>
          </div>
          <div class="mkt-stat mkt-stat-gap">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">Gap de oportunidade</span>
            <span class="mkt-stat-val">${fmtNum(m.gap_oportunidade)}</span>
            <span class="mkt-stat-aux">vagas que a cidade ainda comporta</span>
          </div>
        </div>
      </div>

      <div class="mkt-urgency">
        <span class="mkt-urgency-icon" aria-hidden="true">⚡</span>
        <p class="mkt-urgency-text">
          Cada novo franqueado ocupa um pedaço deste gap.
          Os <strong>pontos premium da sua cidade</strong> não vão ficar disponíveis para sempre —
          quem chegar primeiro, captura primeiro.
        </p>
      </div>

      <div class="mkt-points-head">
        <h4 class="mkt-points-title">
          Pontos premium mapeáveis em ${escapeHtml(data.cidade)}
        </h4>
        <p class="mkt-points-sub">
          <strong>Nossa Diretoria de Pontos está pronta</strong>
          para capturar e negociar estes locais para a sua operação —
          antes mesmo do contrato fechar.
        </p>
      </div>

      <div class="mkt-points-bars" role="list">
        ${pointBar("🏥", "Hospitais e clínicas de grande porte", p.hospitais, p.total_premium, "tráfego 24/7")}
        ${pointBar("🏭", "Grandes indústrias e galpões", p.industrias, p.total_premium, "fluxo cativo")}
        ${pointBar("💪", "Academias de rede", p.academias, p.total_premium, "público fitness, alto giro")}
        ${pointBar("🏢", "Polos corporativos / prédios comerciais", p.corporativo, p.total_premium, "alto ticket médio")}
      </div>

      <div class="mkt-points-total">
        <div class="mkt-points-total-lbl">
          <span class="mkt-points-total-eyebrow">TOTAL DE OPORTUNIDADES PREMIUM</span>
          <span class="mkt-points-total-city">em ${escapeHtml(data.cidade)}</span>
        </div>
        <div class="mkt-points-total-val">${fmtNum(p.total_premium)}</div>
      </div>

      <p class="mkt-disclaimer">
        Estimativas baseadas em densidade populacional e benchmarks da rede AVEND.
        Não substituem o relatório de mercado oficial — são um diagnóstico inicial.
      </p>
    `;
  }

  function pointBar(icon, title, count, total, desc) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="mkt-pt-row" role="listitem">
        <span class="mkt-pt-icon" aria-hidden="true">${icon}</span>
        <div class="mkt-pt-body">
          <div class="mkt-pt-line">
            <span class="mkt-pt-title">${title}</span>
            <span class="mkt-pt-count">${fmtNum(count)}</span>
          </div>
          <div class="mkt-pt-bar-wrap">
            <span class="mkt-pt-bar" style="width:${pct}%"></span>
          </div>
          <div class="mkt-pt-desc">${desc}</div>
        </div>
      </div>
    `;
  }

  function buildNotFoundHTML(cidadeRaw, ufRaw) {
    const hasCidade = !!cidadeRaw;
    return `
      <div class="mkt-head">
        <div class="mkt-eyebrow">DIAGNÓSTICO DE MERCADO · TERRITÓRIO</div>
        <h3 class="mkt-title">${hasCidade ? "Cidade fora da nossa base local" : "Informe a cidade"}</h3>
        <p class="mkt-sub">
          ${hasCidade
            ? `Não localizamos <strong>${escapeHtml(cidadeRaw)}${ufRaw ? " / " + escapeHtml(ufRaw) : ""}</strong> na base.`
            : "Para gerar o diagnóstico de mercado, preencha os dados abaixo."}
          Informe a população estimada e geramos o diagnóstico na hora.
        </p>
      </div>

      <form class="mkt-manual-form" id="mkt-manual-form" autocomplete="off">
        <div class="mkt-manual-grid">
          <label class="mkt-manual-field mkt-manual-city">
            <span class="mkt-manual-lbl">Cidade</span>
            <input type="text" class="mkt-manual-input" id="mkt-manual-city"
                   value="${escapeHtml(cidadeRaw || "")}"
                   placeholder="Ex: Patos de Minas" required maxlength="80" />
          </label>
          <label class="mkt-manual-field mkt-manual-uf">
            <span class="mkt-manual-lbl">UF</span>
            <input type="text" class="mkt-manual-input" id="mkt-manual-uf"
                   value="${escapeHtml(ufRaw || "")}"
                   placeholder="MG" maxlength="2" />
          </label>
          <label class="mkt-manual-field mkt-manual-pop">
            <span class="mkt-manual-lbl">População estimada</span>
            <input type="number" class="mkt-manual-input" id="mkt-manual-pop"
                   placeholder="Ex: 152000" min="1000" max="20000000" required inputmode="numeric" />
          </label>
        </div>
        <button type="submit" class="mkt-manual-btn">
          Gerar diagnóstico de território <span aria-hidden="true">→</span>
        </button>
        <p class="mkt-manual-hint">
          Dica: você encontra a população atualizada em <em>cidades.ibge.gov.br</em>.
        </p>
      </form>
    `;
  }

  /* ---------- CHART.JS DONUT --------------------------------- */

  let donutChart = null;

  function renderDonut(canvas, data) {
    if (!root.Chart || !canvas) return;
    if (donutChart) { try { donutChart.destroy(); } catch (e) { /* noop */ } donutChart = null; }
    const m = data.analise_mercado;

    donutChart = new root.Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Operando hoje", "Espaço disponível"],
        datasets: [{
          data: [m.maquinas_atuais, m.gap_oportunidade],
          backgroundColor: ["#4B6CE2", "#3DD9D6"],
          borderColor: "#0d0e36",
          borderWidth: 4,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: "72%",
        animation: { duration: 900, easing: "easeOutCubic" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(13,14,54,0.95)",
            borderColor: "rgba(61,217,214,0.4)",
            borderWidth: 1,
            padding: 10,
            titleFont: { size: 12, weight: "600" },
            bodyFont: { size: 13 },
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${fmtNum(ctx.parsed)}`
            }
          }
        }
      }
    });
  }

  /* ---------- WIRING DO FORM MANUAL -------------------------- */

  function wireManualForm(container) {
    const form = container.querySelector("#mkt-manual-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const cidade = container.querySelector("#mkt-manual-city").value.trim();
      const uf = container.querySelector("#mkt-manual-uf").value.trim().toUpperCase();
      const pop = parseInt(container.querySelector("#mkt-manual-pop").value, 10);
      if (!cidade || !pop || pop < 1000) return;
      const data = calculate(pop, cidade, uf);
      container.innerHTML = buildHTML(data);
      const canvas = container.querySelector("#mkt-donut");
      if (canvas) renderDonut(canvas, data);
      // Telemetria opcional — não falha se não existir
      if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
        root.TELEMETRY.track("market_territory_manual", {
          cidade, uf, populacao: pop,
          gap: data.analise_mercado.gap_oportunidade,
          premium: data.mapeamento_pontos.total_premium
        });
      }
    });
  }

  /* ---------- API PÚBLICA: render ---------------------------- */

  function render(container, cidadeRaw, ufRaw) {
    if (!container) return null;

    // Se UF veio explicit, respeita; senão tenta extrair do input bruto.
    let cidade, uf;
    if (ufRaw && String(ufRaw).trim()) {
      cidade = String(cidadeRaw || "").trim();
      uf = String(ufRaw).trim().toUpperCase();
    } else {
      const parsed = parseInput(cidadeRaw);
      cidade = parsed.cidade;
      uf = parsed.uf;
    }

    if (!cidade) {
      container.innerHTML = buildNotFoundHTML("", "");
      wireManualForm(container);
      return null;
    }

    const city = findCity(cidade, uf);
    if (!city) {
      container.innerHTML = buildNotFoundHTML(cidade, uf);
      wireManualForm(container);
      return null;
    }

    const data = calculate(city.pop, city.n, city.uf);
    container.innerHTML = buildHTML(data);
    const canvas = container.querySelector("#mkt-donut");
    if (canvas) renderDonut(canvas, data);

    // Telemetria opcional
    if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
      root.TELEMETRY.track("market_territory_rendered", {
        cidade: city.n, uf: city.uf, populacao: city.pop,
        gap: data.analise_mercado.gap_oportunidade,
        premium: data.mapeamento_pontos.total_premium
      });
    }
    return data;
  }

  /* ---------- STANDALONE: usar fora do quiz ------------------ */
  // Liga um <form> + <input> + <div container> para uso direto na tab Mercado.
  // O executivo digita a cidade e o diagnóstico aparece sem precisar do quiz.
  function attachStandalone(formEl, inputEl, containerEl, opts) {
    if (!formEl || !inputEl || !containerEl) return;
    const options = opts || {};

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      const value = String(inputEl.value || "").trim();
      if (!value) return;
      containerEl.hidden = false;
      render(containerEl, value);
      // Scroll suave pra resposta — agradável em reunião de vendas.
      if (options.scrollIntoView !== false) {
        try { containerEl.scrollIntoView({ behavior: "smooth", block: "center" }); }
        catch (e2) { /* navegadores antigos */ }
      }
    });
  }

  // Popula um <datalist> com todas as cidades da base — autocomplete grátis.
  function populateDatalist(datalistEl) {
    if (!datalistEl) return;
    const frag = document.createDocumentFragment();
    CITIES.forEach(function (c) {
      const opt = document.createElement("option");
      opt.value = c.n + " / " + c.uf;
      frag.appendChild(opt);
    });
    datalistEl.innerHTML = "";
    datalistEl.appendChild(frag);
  }

  /* ---------- EXPÕE ------------------------------------------ */

  root.MarketTerritory = {
    render: render,
    calculate: calculate,
    findCity: findCity,
    parseInput: parseInput,
    attachStandalone: attachStandalone,
    populateDatalist: populateDatalist,
    citiesCount: function () { return CITIES.length; }
  };
})(typeof window !== "undefined" ? window : this);
