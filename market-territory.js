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
     Fonte primária: cities-data.js (5.500+ municípios IBGE,
     SIDRA tabela 6579 — gerado por build-cities.py).
     Fallback: array CITIES_FALLBACK abaixo (27 capitais),
     usado quando o arquivo principal não carregou.
     ----------------------------------------------------------- */
  const CITIES_FALLBACK = [
    // Top 50 — metrópoles
    // 27 capitais — usado apenas se cities-data.js não carregou.
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
    ["São Luís", "MA", 1037241],
    ["Maceió", "AL", 957916],
    ["Campo Grande", "MS", 916001],
    ["Teresina", "PI", 866300],
    ["João Pessoa", "PB", 833932],
    ["Natal", "RN", 751300],
    ["Aracaju", "SE", 657013],
    ["Cuiabá", "MT", 618124],
    ["Florianópolis", "SC", 508826],
    ["Porto Velho", "RO", 460434],
    ["Macapá", "AP", 442933],
    ["Boa Vista", "RR", 436591],
    ["Rio Branco", "AC", 412723],
    ["Palmas", "TO", 313349],
    ["Vitória", "ES", 322869]
  ];

  // Carrega base completa (5.500+ municípios IBGE) se cities-data.js
  // foi incluído antes deste arquivo. Senão, usa o fallback de capitais.
  const SOURCE = (root.MARKET_TERRITORY_CITIES && root.MARKET_TERRITORY_CITIES.length)
    ? root.MARKET_TERRITORY_CITIES
    : CITIES_FALLBACK;

  // Hidrata para objetos { n, uf, pop } — uma vez no carregamento
  const CITIES = SOURCE.map(function (row) {
    return { n: row[0], uf: row[1], pop: row[2] };
  });

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

    // 3) Match por prefixo. Só aceita se for único.
    const byPrefix = CITIES.filter(c => normalize(c.n).startsWith(cn));
    if (byPrefix.length === 1) return byPrefix[0];

    return null;
  }

  // lookupCity é como findCity mas distingue not_found vs ambíguo,
  // pra UI mostrar o disambiguator.
  function lookupCity(cidadeRaw, ufRaw) {
    const cn = normalize(cidadeRaw);
    if (!cn) return { status: "not_found", input: cidadeRaw, uf: ufRaw };
    const uf = (ufRaw || "").toUpperCase();

    if (uf) {
      const exact = CITIES.find(c => normalize(c.n) === cn && c.uf === uf);
      if (exact) return { status: "found", city: exact };
    }
    const byName = CITIES.filter(c => normalize(c.n) === cn);
    if (byName.length === 1) return { status: "found", city: byName[0] };
    if (byName.length > 1) {
      // Ordena por população decrescente — mais provável primeiro
      const sorted = byName.slice().sort((a, b) => b.pop - a.pop);
      return { status: "ambiguous", matches: sorted, query: cidadeRaw };
    }
    const byPrefix = CITIES.filter(c => normalize(c.n).startsWith(cn));
    if (byPrefix.length === 1) return { status: "found", city: byPrefix[0] };
    if (byPrefix.length > 1 && byPrefix.length <= 8) {
      // Match parcial com poucas opções — mostra disambiguator
      const sorted = byPrefix.slice().sort((a, b) => b.pop - a.pop);
      return { status: "ambiguous", matches: sorted, query: cidadeRaw };
    }
    return { status: "not_found", input: cidadeRaw, uf: ufRaw };
  }

  /* ---------- TIER · RANKING · CENÁRIOS ---------------------- */

  // Tier de cidade — alvo prioritário ≥ 30k hab.
  function getMarketTier(pop) {
    if (pop < 30000)    return { key: "micro",    label: "Cidade pequena",       warn: true,  desc: "Abaixo do alvo prioritário da rede AVEND" };
    if (pop < 100000)   return { key: "pequena",  label: "Cidade média-pequena", warn: false, desc: "Mercado regional — boa oportunidade pioneira" };
    if (pop < 500000)   return { key: "media",    label: "Cidade média",         warn: false, desc: "Mercado consolidado — boa entrada para a rede" };
    if (pop < 2000000)  return { key: "grande",   label: "Cidade grande",        warn: false, desc: "Mercado denso — espaço para múltiplas unidades" };
    return                     { key: "metro",    label: "Metrópole",            warn: false, desc: "Mercado escalável — alvo prioritário da rede" };
  }

  // Ranking nacional pela população (CITIES já vem ordenado descendente).
  function getRanking(city) {
    if (!city) return null;
    const idx = CITIES.indexOf(city);
    if (idx === -1) return null;
    return { posicao: idx + 1, total: CITIES.length };
  }

  // Cenários de densidade global aplicados à população local.
  // Fontes citadas no próprio site: Japão 1:25 · Coreia/EUA 1:65 ·
  // China 1:500 · Brasil 1:2.500.
  function getScenarios(pop) {
    return {
      brasil:    { ratio: 2500, label: "Brasil (atual)",      flag: "🇧🇷", value: Math.floor(pop / 2500) },
      china:     { ratio: 500,  label: "China",               flag: "🇨🇳", value: Math.floor(pop / 500) },
      coreia_eua:{ ratio: 65,   label: "Coreia / EUA",        flag: "🇰🇷", value: Math.floor(pop / 65) },
      japao:     { ratio: 25,   label: "Japão (saturação)",   flag: "🇯🇵", value: Math.floor(pop / 25) }
    };
  }

  /* ---------- SLUG · PERMALINK ------------------------------- */

  function slug(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function citySlug(city) {
    return city ? slug(city.n) + "-" + city.uf.toLowerCase() : "";
  }

  // Resolve slug "catanduva-sp" → city object
  function findBySlug(slugStr) {
    const want = String(slugStr || "").toLowerCase().trim();
    if (!want) return null;
    const m = want.match(/^(.+)-([a-z]{2})$/);
    if (!m) return null;
    const cityPart = m[1];
    const ufPart = m[2].toUpperCase();
    return CITIES.find(c => slug(c.n) === cityPart && c.uf === ufPart) || null;
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

  /* ---------- TOOLTIP HELPER --------------------------------- */
  // Renderiza um (i) com tooltip nativo (CSS) explicando metodologia.
  function info(text) {
    return `<button type="button" class="mkt-info" tabindex="0"
      aria-label="${escapeHtml(text)}" data-tip="${escapeHtml(text)}">i</button>`;
  }

  // Wrapper de número com data-target — animado pelo runCountUps após render.
  function num(value, extraClass) {
    const v = Math.floor(Number(value) || 0);
    return `<span class="mkt-count-up ${extraClass || ""}" data-target="${v}">0</span>`;
  }

  /* ---------- BUILD HTML ------------------------------------- */

  function buildHTML(data, meta) {
    const m = data.analise_mercado;
    const p = data.mapeamento_pontos;
    const tier = getMarketTier(data.populacao);
    const ranking = (meta && meta.ranking) || null;
    const scenarios = getScenarios(data.populacao);
    const slugStr = (meta && meta.slug) || "";
    const ocupacao = m.capacidade_maxima > 0
      ? Math.round((m.maquinas_atuais / m.capacidade_maxima) * 100)
      : 0;
    const gapPct = 100 - ocupacao;

    // Banner de tier (warning se < 30k hab)
    const tierBanner = tier.warn ? `
      <div class="mkt-tier-banner mkt-tier-warn" role="note">
        <span class="mkt-tier-icon" aria-hidden="true">⚠</span>
        <div class="mkt-tier-body">
          <strong>${tier.label}</strong> · ${tier.desc}.
          A AVEND atua principalmente em cidades acima de 30 mil habitantes.
          Cidades menores podem ser atendidas via formato adaptado —
          fale com nosso time para uma avaliação personalizada.
        </div>
      </div>
    ` : "";

    // Badge de ranking nacional
    const rankBadge = ranking ? `
      <div class="mkt-rank-badge" title="Posição entre os ${fmtNum(ranking.total)} municípios brasileiros (IBGE 2025)">
        <span class="mkt-rank-icon" aria-hidden="true">🏆</span>
        <span class="mkt-rank-body">
          <span class="mkt-rank-pos">#${fmtNum(ranking.posicao)}</span>
          <span class="mkt-rank-aux">de ${fmtNum(ranking.total)} cidades · pop. BR</span>
        </span>
      </div>
    ` : "";

    return `
      <div class="mkt-report" data-city-slug="${escapeHtml(slugStr)}">

      <div class="mkt-head">
        <div class="mkt-eyebrow">DIAGNÓSTICO DE MERCADO · TERRITÓRIO</div>
        <h3 class="mkt-title">
          ${escapeHtml(data.cidade)}${data.uf ? `<span class="mkt-uf">/${escapeHtml(data.uf)}</span>` : ""}
        </h3>
        <p class="mkt-sub">
          População estimada: <strong>${fmtNum(data.populacao)}</strong> habitantes
          · <span class="mkt-tier-tag mkt-tier-${tier.key}">${tier.label}</span>
        </p>
        ${rankBadge}
      </div>

      ${tierBanner}

      <div class="mkt-gap-block">
        <div class="mkt-gap-chart-wrap">
          <canvas id="mkt-donut" width="240" height="240" role="img"
            aria-label="Donut: ${m.maquinas_atuais} máquinas operando hoje vs. ${m.gap_oportunidade} vagas livres"></canvas>
          <div class="mkt-gap-center">
            <div class="mkt-gap-pct">${num(gapPct)}<span class="mkt-gap-pct-sym">%</span></div>
            <div class="mkt-gap-lbl">do mercado<br/>ainda livre</div>
          </div>
        </div>
        <div class="mkt-gap-stats">
          <div class="mkt-stat mkt-stat-current">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">
              Operando hoje (mercado total)
              ${info("Estimativa do mercado total de vending na cidade — não diferencia AVEND vs. concorrência. Cálculo: pop ÷ 2.500 (densidade média Brasil, ABVM 2024).")}
            </span>
            <span class="mkt-stat-val">${num(m.maquinas_atuais)}</span>
            <span class="mkt-stat-aux">máquinas no baseline Brasil</span>
          </div>
          <div class="mkt-stat mkt-stat-max">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">
              Capacidade máxima
              ${info("Saturação realista para o estágio atual do mercado brasileiro: pop ÷ 400. Meio-termo ajustado entre densidade Brasil (1:2.500) e mercados maduros como EUA/Coreia (1:65), considerando o ritmo de adoção projetado pela ABVM (CAGR 11,58% até 2032).")}
            </span>
            <span class="mkt-stat-val">${num(m.capacidade_maxima)}</span>
            <span class="mkt-stat-aux">saturação realista no horizonte</span>
          </div>
          <div class="mkt-stat mkt-stat-gap">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">
              Gap de oportunidade
              ${info("Capacidade máxima menos máquinas operando hoje. É o espaço que a cidade ainda comporta — onde a AVEND pode crescer sem canibalizar mercado existente.")}
            </span>
            <span class="mkt-stat-val">${num(m.gap_oportunidade)}</span>
            <span class="mkt-stat-aux">vagas que a cidade ainda comporta</span>
          </div>
        </div>
      </div>

      <!-- CENÁRIOS GLOBAIS -->
      <div class="mkt-scenarios">
        <header class="mkt-scenarios-head">
          <h4 class="mkt-scenarios-title">
            E se ${escapeHtml(data.cidade)} alcançasse a densidade de outros mercados?
            ${info("Aplica a densidade real de cada país (vending por habitante) à população local. Mostra o teto de oportunidade conforme o mercado brasileiro amadurece. Fontes: ABVM, JVMA, Grand View Research.")}
          </h4>
          <p class="mkt-scenarios-sub">
            Densidades mundiais aplicadas à população de <strong>${fmtNum(data.populacao)}</strong> habitantes.
          </p>
        </header>
        <div class="mkt-scenarios-grid">
          ${scenarioCard(scenarios.brasil,    "atual")}
          ${scenarioCard(scenarios.china,     "neutro")}
          ${scenarioCard(scenarios.coreia_eua,"alvo")}
          ${scenarioCard(scenarios.japao,     "topo")}
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
          ${info("Estimativa de locais ideais para instalação de vending. Multiplicadores aplicados a cada 100 mil habitantes, calibrados a partir de benchmarks da rede AVEND e do IBGE Cadastro Central de Empresas.")}
        </h4>
        <p class="mkt-points-sub">
          <strong>Nossa Diretoria de Pontos está pronta</strong>
          para capturar e negociar estes locais para a sua operação.
        </p>
      </div>

      <div class="mkt-points-bars" role="list">
        ${pointBar("🏥", "Hospitais e clínicas de grande porte", p.hospitais, p.total_premium, "tráfego 24/7", "Multiplicador ×3 por 100 mil hab. Inclui hospitais, prontos-socorros e clínicas com fluxo intenso de pacientes e acompanhantes.")}
        ${pointBar("🏭", "Grandes indústrias e galpões", p.industrias, p.total_premium, "fluxo cativo", "Multiplicador ×8 por 100 mil hab. Inclui plantas industriais, galpões logísticos e centros de distribuição com colaboradores em turnos.")}
        ${pointBar("💪", "Academias de rede", p.academias, p.total_premium, "público fitness, alto giro", "Multiplicador ×15 por 100 mil hab. Inclui academias de bandeiras nacionais e regionais — alto giro de público fitness, ticket médio elevado.")}
        ${pointBar("🏢", "Polos corporativos / prédios comerciais", p.corporativo, p.total_premium, "alto ticket médio", "Multiplicador ×5 por 100 mil hab. Inclui edifícios corporativos, coworkings e centros empresariais — público executivo de alto ticket médio.")}
      </div>

      <div class="mkt-points-total">
        <div class="mkt-points-total-lbl">
          <span class="mkt-points-total-eyebrow">TOTAL DE OPORTUNIDADES PREMIUM</span>
          <span class="mkt-points-total-city">em ${escapeHtml(data.cidade)}</span>
        </div>
        <div class="mkt-points-total-val">${num(p.total_premium)}</div>
      </div>

      <div class="mkt-actions">
        <button type="button" class="mkt-action mkt-action-secondary" data-action="print-report">
          <span aria-hidden="true">📄</span>
          <span>Imprimir / salvar PDF deste diagnóstico</span>
        </button>
      </div>

      <p class="mkt-disclaimer">
        Estimativas baseadas em densidade populacional (IBGE 2025) e benchmarks da rede AVEND.
        Não substituem o relatório de mercado oficial — são um diagnóstico inicial.
      </p>

      </div>
    `;
  }

  function scenarioCard(s, role) {
    const labelMap = {
      atual:  "Hoje no Brasil",
      neutro: "Comparativo",
      alvo:   "Mercado maduro",
      topo:   "Saturação total"
    };
    return `
      <div class="mkt-scen mkt-scen-${role}">
        <div class="mkt-scen-head">
          <span class="mkt-scen-flag" aria-hidden="true">${s.flag}</span>
          <span class="mkt-scen-role">${labelMap[role]}</span>
        </div>
        <div class="mkt-scen-country">${s.label}</div>
        <div class="mkt-scen-ratio">1 vending : <strong>${fmtNum(s.ratio)}</strong> hab</div>
        <div class="mkt-scen-val">${num(s.value)} <span class="mkt-scen-unit">máq</span></div>
      </div>
    `;
  }

  function pointBar(icon, title, count, total, desc, methodology) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="mkt-pt-row" role="listitem">
        <span class="mkt-pt-icon" aria-hidden="true">${icon}</span>
        <div class="mkt-pt-body">
          <div class="mkt-pt-line">
            <span class="mkt-pt-title">
              ${title}
              ${methodology ? info(methodology) : ""}
            </span>
            <span class="mkt-pt-count">${num(count)}</span>
          </div>
          <div class="mkt-pt-bar-wrap">
            <span class="mkt-pt-bar" style="width:${pct}%"></span>
          </div>
          <div class="mkt-pt-desc">${desc}</div>
        </div>
      </div>
    `;
  }

  /* ---------- DISAMBIGUATOR ---------------------------------- */

  function buildDisambiguatorHTML(matches, query) {
    return `
      <div class="mkt-head">
        <div class="mkt-eyebrow">DIAGNÓSTICO DE MERCADO · TERRITÓRIO</div>
        <h3 class="mkt-title">Encontramos ${matches.length} cidades</h3>
        <p class="mkt-sub">
          Sua busca por <strong>${escapeHtml(query)}</strong> bateu em
          <strong>${matches.length} cidades brasileiras</strong>. Qual delas você quer analisar?
        </p>
      </div>
      <div class="mkt-disambig-list" role="list">
        ${matches.map(c => `
          <button type="button" class="mkt-disambig-opt" role="listitem"
                  data-city="${escapeHtml(c.n)}" data-uf="${escapeHtml(c.uf)}">
            <span class="mkt-disambig-name">${escapeHtml(c.n)} <span class="mkt-disambig-uf">/${escapeHtml(c.uf)}</span></span>
            <span class="mkt-disambig-pop">${fmtNum(c.pop)} hab</span>
            <span class="mkt-disambig-arrow" aria-hidden="true">→</span>
          </button>
        `).join("")}
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

  /* ---------- COUNT-UP ANIMATION ----------------------------- */
  // Anima todos elementos com class .mkt-count-up dentro do container.
  // Ease-out cubic, 700ms — consistente com o resto do site.
  function runCountUps(container) {
    const els = container.querySelectorAll(".mkt-count-up");
    const duration = 700;
    const ease = t => 1 - Math.pow(1 - t, 3);
    els.forEach(el => {
      const target = parseInt(el.dataset.target || "0", 10) || 0;
      if (target === 0) { el.textContent = "0"; return; }
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const v = Math.floor(target * ease(t));
        el.textContent = NF.format(v);
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
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
      container.innerHTML = buildHTML(data, { ranking: null, slug: slug(cidade) + (uf ? "-" + uf.toLowerCase() : "") });
      const canvas = container.querySelector("#mkt-donut");
      if (canvas) renderDonut(canvas, data);
      runCountUps(container);
      wireReportActions(container, { cidade, uf, populacao: pop });
      if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
        root.TELEMETRY.track("market_territory_manual", {
          cidade, uf, populacao: pop,
          gap: data.analise_mercado.gap_oportunidade,
          premium: data.mapeamento_pontos.total_premium
        });
      }
    });
  }

  /* ---------- WIRING DO DISAMBIGUATOR ------------------------ */

  function wireDisambiguator(container) {
    const buttons = container.querySelectorAll(".mkt-disambig-opt");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const cidade = btn.dataset.city;
        const uf = btn.dataset.uf;
        render(container, cidade, uf);
      });
    });
  }

  /* ---------- WIRING DOS BOTÕES DE AÇÃO (PDF, WhatsApp) ------ */

  function wireReportActions(container, ctx) {
    const printBtn = container.querySelector('[data-action="print-report"]');
    if (printBtn) {
      printBtn.addEventListener("click", () => {
        const cidade = ctx.cidade || "";
        const uf = ctx.uf || "";
        const pop = ctx.populacao || 0;
        const reportEl = container.querySelector(".mkt-report");
        if (!reportEl) return;

        // ESTRATÉGIA: clonar o relatório pra um container ISOLADO no body,
        // esconder o resto do body inteiro via CSS print, e imprimir só
        // esse container. Evita páginas em branco do resto da árvore DOM.

        const clone = reportEl.cloneNode(true);

        // Remove do clone o que não faz sentido em PDF
        clone.querySelectorAll(".mkt-info, .mkt-actions, .mkt-rank-badge[title]")
          .forEach(el => {
            if (el.classList.contains("mkt-info")) el.remove();
            else if (el.classList.contains("mkt-actions")) el.remove();
          });

        // Constrói o print-area com header AVEND e footer
        const dataStr = new Date().toLocaleDateString("pt-BR", {
          day: "2-digit", month: "2-digit", year: "numeric"
        });
        const printArea = document.createElement("div");
        printArea.className = "mkt-print-area";
        printArea.innerHTML =
          '<header class="mkt-print-header">' +
            '<div class="mkt-print-brand">AVEND</div>' +
            '<div class="mkt-print-brand-sub">Vending Machines &amp; Franchising</div>' +
            '<h1 class="mkt-print-title">Diagnóstico de Mercado e Território</h1>' +
            '<div class="mkt-print-meta">' +
              '<strong>' + escapeHtml(cidade) + (uf ? ' / ' + escapeHtml(uf) : '') + '</strong>' +
              ' · População ' + fmtNum(pop) + ' hab' +
              ' · Gerado em ' + dataStr +
            '</div>' +
          '</header>';
        printArea.appendChild(clone);
        printArea.insertAdjacentHTML("beforeend",
          '<footer class="mkt-print-footer">' +
            'AVEND · Diagnóstico inicial baseado em densidade IBGE 2025 e benchmarks da rede. ' +
            'Não substitui o relatório de mercado oficial. ' +
            '<span class="mkt-print-url">avend.com.br</span>' +
          '</footer>'
        );

        document.body.appendChild(printArea);
        document.body.classList.add("is-mkt-printing");

        // Nome de arquivo amigável (vira nome do PDF salvo)
        const prevTitle = document.title;
        const safeName = slug(cidade) + (uf ? "-" + uf.toLowerCase() : "");
        document.title = "Diagnostico-AVEND-" + (safeName || "mercado");

        const cleanup = () => {
          document.body.classList.remove("is-mkt-printing");
          if (printArea.parentNode) printArea.parentNode.removeChild(printArea);
          document.title = prevTitle;
          window.removeEventListener("afterprint", cleanup);
        };
        window.addEventListener("afterprint", cleanup);
        // Pequeno delay pro layout calcular antes do dialog
        setTimeout(() => window.print(), 100);

        if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
          root.TELEMETRY.track("market_territory_print", { cidade, uf });
        }
      });
    }

  }

  /* ---------- PERMALINK (?cidade=catanduva-sp) --------------- */

  function updateURL(citySlugStr) {
    if (!root.history || !root.history.replaceState) return;
    try {
      const url = new URL(root.location.href);
      if (citySlugStr) url.searchParams.set("cidade", citySlugStr);
      else url.searchParams.delete("cidade");
      root.history.replaceState({}, "", url.toString());
    } catch (e) { /* ignore */ }
  }

  function readCityFromURL() {
    if (!root.location) return null;
    try {
      const url = new URL(root.location.href);
      return url.searchParams.get("cidade");
    } catch (e) { return null; }
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

    const lookup = lookupCity(cidade, uf);

    // AMBÍGUO: mostra disambiguator
    if (lookup.status === "ambiguous") {
      container.innerHTML = buildDisambiguatorHTML(lookup.matches, cidade);
      wireDisambiguator(container);
      if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
        root.TELEMETRY.track("market_territory_ambiguous", {
          query: cidade, matches: lookup.matches.length
        });
      }
      return null;
    }

    // NÃO ENCONTRADO: form manual
    if (lookup.status !== "found") {
      container.innerHTML = buildNotFoundHTML(cidade, uf);
      wireManualForm(container);
      return null;
    }

    // ENCONTRADO: render completo
    const city = lookup.city;
    const data = calculate(city.pop, city.n, city.uf);
    const ranking = getRanking(city);
    const slugStr = citySlug(city);
    container.innerHTML = buildHTML(data, { ranking, slug: slugStr });
    const canvas = container.querySelector("#mkt-donut");
    if (canvas) renderDonut(canvas, data);
    runCountUps(container);
    wireReportActions(container, { cidade: city.n, uf: city.uf, populacao: city.pop });

    // Atualiza URL pra deep-link
    updateURL(slugStr);

    if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
      root.TELEMETRY.track("market_territory_rendered", {
        cidade: city.n, uf: city.uf, populacao: city.pop,
        ranking: ranking ? ranking.posicao : null,
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

  // Popula um <datalist> com cidades da base — autocomplete nativo.
  // Limita às top N por população (default 600) para não pesar o DOM
  // com 5.500+ <option>. Buscas diretas continuam usando a base inteira.
  function populateDatalist(datalistEl, limit) {
    if (!datalistEl) return;
    const max = typeof limit === "number" ? limit : 600;
    // CITIES vem ordenado por população decrescente (cities-data.js).
    const list = CITIES.length > max ? CITIES.slice(0, max) : CITIES;
    const frag = document.createDocumentFragment();
    list.forEach(function (c) {
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
    lookupCity: lookupCity,
    parseInput: parseInput,
    attachStandalone: attachStandalone,
    populateDatalist: populateDatalist,
    getRanking: getRanking,
    getScenarios: getScenarios,
    getMarketTier: getMarketTier,
    citySlug: citySlug,
    findBySlug: findBySlug,
    readCityFromURL: readCityFromURL,
    citiesCount: function () { return CITIES.length; }
  };
})(typeof window !== "undefined" ? window : this);
