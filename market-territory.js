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
  // Mostram o teto TOTAL de vending — todas as máquinas, todos
  // os tipos. Coerente com a "capacidade máxima" da cidade.
  // Ratios totais: Japão 1:25 · Coreia/EUA 1:65 · China 1:500 · Brasil 1:2.500.
  function getScenarios(pop) {
    return {
      brasil:    { ratio: 2500, label: "Brasil (atual)",     flag: "🇧🇷", value: Math.floor(pop / 2500) },
      china:     { ratio: 500,  label: "China",              flag: "🇨🇳", value: Math.floor(pop / 500) },
      coreia_eua:{ ratio: 65,   label: "Coreia / EUA",       flag: "🇰🇷", value: Math.floor(pop / 65) },
      japao:     { ratio: 25,   label: "Japão (saturação)",  flag: "🇯🇵", value: Math.floor(pop / 25) }
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

  // Composição do mercado vending Brasil:
  // ~65% das máquinas são de CAFÉ (não competem com a AVEND).
  // ~35% são SNACKS/BEBIDAS — segmento direto da AVEND.
  // Filtramos "operando hoje" e "capacidade" pelo share AVEND para
  // refletir o mercado-alvo real, sem inflar com café que não disputa.
  const SHARE_CAFE = 0.65;
  const SHARE_AVEND = 1 - SHARE_CAFE;  // 0.35

  function calculate(populacao, cidade, uf) {
    const pop = Math.max(0, Math.floor(Number(populacao) || 0));
    const fator = pop / 100000;

    // Mercado VENDING TOTAL (teto físico da cidade — independente
    // de que tipo de máquina ocupa). Capacidade não muda por
    // composição café/snacks; ela é o limite estrutural do território.
    const total_vending_atual = Math.floor(pop / 2500);
    const capacidade_maxima = Math.floor(pop / 400);

    // Filtro 35% afeta APENAS o "quantas máquinas inseridas" do
    // segmento AVEND (snacks/bebidas) — porque o café (65%) não
    // compete com a AVEND.
    const maquinas_atuais = Math.floor(total_vending_atual * SHARE_AVEND);
    const cafe_atual = Math.floor(total_vending_atual * SHARE_CAFE);

    // Gap = capacidade total da cidade menos máquinas AVEND atuais.
    // Mostra o espaço bruto que a cidade ainda comporta — onde
    // a AVEND pode crescer.
    const gap_oportunidade = Math.max(0, capacidade_maxima - maquinas_atuais);

    const hospitais = Math.floor(fator * 3);
    const industrias = Math.floor(fator * 8);
    const academias = Math.floor(fator * 15);
    const corporativo = Math.floor(fator * 5);
    const empresas = Math.floor(fator * 30);  // empresas com 50+ funcionários
    const total_premium = hospitais + industrias + academias + corporativo + empresas;

    return {
      cidade: cidade || "",
      uf: uf || "",
      populacao: pop,
      analise_mercado: {
        maquinas_atuais, capacidade_maxima, gap_oportunidade,
        // Contexto: total vending e participação café (não-concorrente)
        total_vending_atual, cafe_atual,
        share_avend: SHARE_AVEND, share_cafe: SHARE_CAFE
      },
      mapeamento_pontos: { hospitais, industrias, academias, corporativo, empresas, total_premium }
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

      <!-- COMPOSIÇÃO DO MERCADO VENDING (contexto) -->
      <div class="mkt-composition" role="note">
        <div class="mkt-composition-head">
          <span class="mkt-composition-eyebrow">COMPOSIÇÃO DO MERCADO VENDING</span>
          ${info("Estudos de mercado mostram que ~65% das máquinas vending no Brasil são de café (não competem com snacks/bebidas). Os 35% restantes são o segmento direto da AVEND. Os números abaixo já consideram esse filtro.")}
        </div>
        <div class="mkt-composition-bar">
          <span class="mkt-composition-cafe" style="width:${Math.round(m.share_cafe * 100)}%">
            <span class="mkt-composition-pct">${Math.round(m.share_cafe * 100)}%</span>
            <span class="mkt-composition-lbl">☕ Café <em>(não concorre)</em></span>
          </span>
          <span class="mkt-composition-avend" style="width:${Math.round(m.share_avend * 100)}%">
            <span class="mkt-composition-pct">${Math.round(m.share_avend * 100)}%</span>
            <span class="mkt-composition-lbl">🍫 Snacks &amp; Bebidas <em>(AVEND)</em></span>
          </span>
        </div>
        <p class="mkt-composition-note">
          O segmento da AVEND é <strong>snacks &amp; bebidas</strong>.
          Excluímos o café da contagem porque não disputa o mesmo ponto comercial.
        </p>
      </div>

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
              Operando hoje (snacks &amp; bebidas)
              ${info("Estimativa de máquinas snacks/bebidas operando em " + escapeHtml(data.cidade) + ". Cálculo: (pop ÷ 2.500) × 35%. Excluímos os 65% de máquinas de café por não competirem com o segmento da AVEND. Densidade base: ABVM 2024.")}
            </span>
            <span class="mkt-stat-val">${num(m.maquinas_atuais)}</span>
            <span class="mkt-stat-aux">de ${fmtNum(m.total_vending_atual)} vending no total · ${fmtNum(m.cafe_atual)} são café</span>
          </div>
          <div class="mkt-stat mkt-stat-max">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">
              Capacidade máxima
              ${info("Teto físico de vending na cidade — todos os tipos (snacks, bebidas, café). Cálculo: pop ÷ 400. Meio-termo entre densidade Brasil atual (1:2.500) e mercados maduros como EUA/Coreia (1:65), considerando o ritmo de adoção projetado pela ABVM (CAGR 11,58% até 2032). A composição café/snacks NÃO altera este teto — ele é estrutural ao território.")}
            </span>
            <span class="mkt-stat-val">${num(m.capacidade_maxima)}</span>
            <span class="mkt-stat-aux">teto físico do território (todos os tipos)</span>
          </div>
          <div class="mkt-stat mkt-stat-gap">
            <span class="mkt-stat-dot" aria-hidden="true"></span>
            <span class="mkt-stat-lbl">
              Gap de oportunidade
              ${info("Capacidade total da cidade menos máquinas AVEND operando hoje. É o espaço bruto que a cidade ainda comporta — onde a AVEND pode crescer.")}
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
            ${info("Aplica a densidade real de vending por habitante de cada país à população local. Mostra o teto total de máquinas (todos os tipos) que a cidade comportaria conforme o mercado matura. Fontes: ABVM, JVMA, Grand View Research.")}
          </h4>
          <p class="mkt-scenarios-sub">
            Densidades mundiais aplicadas à população de <strong>${fmtNum(data.populacao)}</strong> habitantes
            — referência <strong>total vending</strong> (todos os tipos de máquina).
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
          ${info("Estimativa dos PRINCIPAIS locais para instalação de vending — alta densidade de público, ticket médio elevado, contratos estáveis. Multiplicadores aplicados a cada 100 mil habitantes, calibrados a partir de benchmarks da rede AVEND e bases RAIS/IBGE 2022 (Cadastro Central de Empresas e CNES).")}
        </h4>
        <p class="mkt-points-sub">
          <strong>Nossa Diretoria de Pontos está pronta</strong>
          para capturar e negociar estes locais para a sua operação.
          O total de ${fmtNum(m.gap_oportunidade)} vagas que a cidade comporta
          inclui também pontos médios (mercados, postos, escolas, condomínios) —
          os premium abaixo são os <strong>de maior retorno</strong>.
        </p>
      </div>

      <div class="mkt-points-bars" role="list">
        ${pointBar("🏥", "Hospitais e clínicas de grande porte", p.hospitais, p.total_premium, "tráfego 24/7", "Multiplicador ×3 por 100 mil hab. Inclui hospitais, prontos-socorros e clínicas com fluxo intenso de pacientes e acompanhantes.")}
        ${pointBar("🏭", "Grandes indústrias e galpões", p.industrias, p.total_premium, "fluxo cativo", "Multiplicador ×8 por 100 mil hab. Inclui plantas industriais, galpões logísticos e centros de distribuição com colaboradores em turnos.")}
        ${pointBar("💪", "Academias de rede", p.academias, p.total_premium, "público fitness, alto giro", "Multiplicador ×15 por 100 mil hab. Inclui academias de bandeiras nacionais e regionais — alto giro de público fitness, ticket médio elevado.")}
        ${pointBar("🏢", "Polos corporativos / prédios comerciais", p.corporativo, p.total_premium, "alto ticket médio", "Multiplicador ×5 por 100 mil hab. Inclui edifícios corporativos, coworkings e centros empresariais — público executivo de alto ticket médio.")}
        ${pointBar("👥", "Empresas com 50+ funcionários", p.empresas, p.total_premium, "público cativo, contrato B2B", "Multiplicador ×30 por 100 mil hab. Empresas formais médias e grandes (50+ colaboradores) — escritórios, comércios maiores, transportadoras, call centers, redes de varejo. Base RAIS/IBGE 2022.")}
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
      wireReportActions(container, { cidade, uf, populacao: pop, data: data, ranking: null });
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
        const data = ctx.data || calculate(pop, cidade, uf);
        const ranking = ctx.ranking || null;
        const reportEl = container.querySelector(".mkt-report");
        if (!reportEl) return;

        // GATE DE LEAD: pra baixar o PDF precisa preencher nome + consultor.
        // Se já preencheu antes (no quiz ou em download anterior), pré-popula
        // mas ainda mostra pra confirmar.
        openPdfLeadGate({
          cidade: cidade, uf: uf, populacao: pop, codigo: null
        }, function (leadInfo) {
          // leadInfo = { nome, consultor }
          // Persiste e dispara telemetria — é nosso lead capturado!
          try {
            localStorage.setItem("avend-pdf-lead", JSON.stringify({
              nome: leadInfo.nome,
              consultor: leadInfo.consultor,
              cidade: cidade, uf: uf, ts: Date.now()
            }));
          } catch (e) { /* ignore */ }
          if (root.TELEMETRY) {
            root.TELEMETRY.session.visitorName     = root.TELEMETRY.session.visitorName     || leadInfo.nome;
            root.TELEMETRY.session.visitorConsultor = leadInfo.consultor || root.TELEMETRY.session.visitorConsultor;
            if (cidade && !root.TELEMETRY.session.visitorCity) {
              root.TELEMETRY.session.visitorCity = cidade + (uf ? " / " + uf : "");
            }
            if (typeof root.TELEMETRY.persist === "function") root.TELEMETRY.persist();
            if (typeof root.TELEMETRY.track === "function") {
              root.TELEMETRY.track("market_territory_pdf_lead", {
                nome: leadInfo.nome,
                consultor: leadInfo.consultor,
                cidade: cidade, uf: uf, populacao: pop
              });
            }
          }
          actuallyPrintReport(container, ctx, reportEl, leadInfo);
        });
      });
    }
  }

  /* ---------- MODAL DE CAPTURA DE LEAD (gate do PDF) ---------- */

  function openPdfLeadGate(reqCtx, onSubmit) {
    // Pré-popula com dados do quiz/download anterior se houver
    let prefill = { nome: "", consultor: "" };
    try {
      const fromQuiz = JSON.parse(localStorage.getItem("avend-quiz-data") || "{}");
      if (fromQuiz && fromQuiz.identity) {
        prefill.nome      = fromQuiz.identity.name || "";
        prefill.consultor = fromQuiz.identity.consultor || "";
      }
      const prev = JSON.parse(localStorage.getItem("avend-pdf-lead") || "{}");
      if (prev.nome      && !prefill.nome)      prefill.nome = prev.nome;
      if (prev.consultor && !prefill.consultor) prefill.consultor = prev.consultor;
    } catch (e) { /* ignore */ }

    const overlay = document.createElement("div");
    overlay.className = "mkt-gate-overlay";
    overlay.innerHTML =
      '<div class="mkt-gate-modal" role="dialog" aria-modal="true" aria-labelledby="mkt-gate-title">' +
        '<button type="button" class="mkt-gate-close" aria-label="Fechar">&times;</button>' +
        '<div class="mkt-gate-eyebrow">DOWNLOAD DO DIAGNÓSTICO</div>' +
        '<h2 class="mkt-gate-title" id="mkt-gate-title">' +
          'Antes de baixar — quem está recebendo?' +
        '</h2>' +
        '<p class="mkt-gate-sub">' +
          'Pra organizar a entrega do diagnóstico de <strong>' + escapeHtml(reqCtx.cidade || "sua cidade") +
          (reqCtx.uf ? '/' + escapeHtml(reqCtx.uf) : '') +
          '</strong>, precisamos de duas informações rápidas.' +
        '</p>' +
        '<form class="mkt-gate-form" id="mkt-gate-form" autocomplete="off">' +
          '<label class="mkt-gate-field">' +
            '<span class="mkt-gate-lbl">Seu nome</span>' +
            '<input type="text" id="mkt-gate-nome" class="mkt-gate-input"' +
              ' value="' + escapeHtml(prefill.nome) + '"' +
              ' placeholder="Ex: João da Silva" required maxlength="80" autofocus />' +
          '</label>' +
          '<label class="mkt-gate-field">' +
            '<span class="mkt-gate-lbl">Consultor AVEND</span>' +
            '<input type="text" id="mkt-gate-consultor" class="mkt-gate-input"' +
              ' value="' + escapeHtml(prefill.consultor) + '"' +
              ' placeholder="Quem está te atendendo?" required maxlength="80" />' +
          '</label>' +
          '<button type="submit" class="mkt-gate-btn">' +
            '📄 Continuar para o PDF <span aria-hidden="true">→</span>' +
          '</button>' +
          '<p class="mkt-gate-privacy">' +
            '🔒 Seus dados ficam guardados conforme LGPD. Não compartilhamos com terceiros.' +
          '</p>' +
        '</form>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.classList.add("mkt-gate-open");

    const close = () => {
      overlay.remove();
      document.body.classList.remove("mkt-gate-open");
      document.removeEventListener("keydown", onEsc);
    };
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onEsc);

    overlay.querySelector(".mkt-gate-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector("#mkt-gate-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const nome      = overlay.querySelector("#mkt-gate-nome").value.trim();
      const consultor = overlay.querySelector("#mkt-gate-consultor").value.trim();
      if (nome.length < 2 || consultor.length < 2) return;
      close();
      onSubmit({ nome: nome, consultor: consultor });
    });

    // Foca no primeiro campo vazio
    setTimeout(() => {
      const nomeEl = overlay.querySelector("#mkt-gate-nome");
      const consEl = overlay.querySelector("#mkt-gate-consultor");
      if (nomeEl && !nomeEl.value) nomeEl.focus();
      else if (consEl && !consEl.value) consEl.focus();
    }, 50);
  }

  /* ---------- PRINT real (após gate) -------------------------- */

  function actuallyPrintReport(container, ctx, reportEl, leadInfo) {
    const cidade = ctx.cidade || "";
    const uf = ctx.uf || "";
    const pop = ctx.populacao || 0;
    const data = ctx.data || calculate(pop, cidade, uf);
    const ranking = ctx.ranking || null;
    const m = data.analise_mercado;
    const p = data.mapeamento_pontos;
    const tier = getMarketTier(pop);
    const gapPct = m.capacidade_maxima > 0
      ? Math.round((m.gap_oportunidade / m.capacidade_maxima) * 100)
      : 0;

    // Código único do relatório (4 chars) — para auditoria/tracking visual
    const codigo = (Date.now().toString(36) + Math.random().toString(36).slice(2, 4))
      .slice(-4).toUpperCase();

    // Clone do relatório (parte da análise detalhada)
    const clone = reportEl.cloneNode(true);
    clone.querySelectorAll(".mkt-info, .mkt-actions").forEach(function (el) { el.remove(); });
    const innerHead = clone.querySelector(".mkt-head");
    if (innerHead) innerHead.remove();
    const innerRank = clone.querySelector(".mkt-rank-badge");
    if (innerRank) innerRank.remove();

    const dataStr = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit", month: "long", year: "numeric"
    });

    // === MONTAGEM DO PDF ===
    const printArea = document.createElement("div");
    printArea.className = "mkt-print-area";

    // 1) CAPA — banner gradient + logo + título + meta
    const cover =
      '<header class="mkt-print-cover">' +
        '<div class="mkt-print-cover-bg" aria-hidden="true"></div>' +
        '<div class="mkt-print-cover-watermark" aria-hidden="true">AVEND</div>' +
        '<div class="mkt-print-cover-inner">' +
          '<div class="mkt-print-brand-row">' +
            '<div class="mkt-print-logo">AVEND</div>' +
            '<div class="mkt-print-tagline">Vending Machines &amp; Franchising</div>' +
          '</div>' +
          '<div class="mkt-print-cover-body">' +
            '<div class="mkt-print-eyebrow">Diagnóstico Executivo de Mercado</div>' +
            '<h1 class="mkt-print-h1">Mercado &amp; Território</h1>' +
            '<h2 class="mkt-print-h2">' +
              escapeHtml(cidade) + (uf ? '<span class="mkt-print-h2-uf">/' + escapeHtml(uf) + '</span>' : '') +
            '</h2>' +
          '</div>' +
          '<div class="mkt-print-cover-meta">' +
            '<div class="mkt-print-cover-meta-item">' +
              '<span class="mkt-print-cover-meta-lbl">População</span>' +
              '<span class="mkt-print-cover-meta-val">' + fmtNum(pop) + ' hab</span>' +
            '</div>' +
            '<div class="mkt-print-cover-meta-item">' +
              '<span class="mkt-print-cover-meta-lbl">Perfil</span>' +
              '<span class="mkt-print-cover-meta-val">' + escapeHtml(tier.label) + '</span>' +
            '</div>' +
            (ranking ? (
              '<div class="mkt-print-cover-meta-item">' +
                '<span class="mkt-print-cover-meta-lbl">Ranking BR</span>' +
                '<span class="mkt-print-cover-meta-val">#' + fmtNum(ranking.posicao) + ' de ' + fmtNum(ranking.total) + '</span>' +
              '</div>'
            ) : '') +
            '<div class="mkt-print-cover-meta-item">' +
              '<span class="mkt-print-cover-meta-lbl">Gerado em</span>' +
              '<span class="mkt-print-cover-meta-val">' + dataStr + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</header>';

    // 2) SUMÁRIO EXECUTIVO — 4 KPIs grandes
    const summary =
      '<section class="mkt-print-section mkt-print-summary">' +
        '<header class="mkt-print-section-head">' +
          '<span class="mkt-print-section-num">01</span>' +
          '<h3 class="mkt-print-section-title">Sumário Executivo</h3>' +
        '</header>' +
        '<div class="mkt-print-kpi-grid">' +
          '<div class="mkt-print-kpi mkt-print-kpi-now">' +
            '<div class="mkt-print-kpi-val">' + fmtNum(m.maquinas_atuais) + '</div>' +
            '<div class="mkt-print-kpi-lbl">máquinas AVEND<br/>operando hoje</div>' +
          '</div>' +
          '<div class="mkt-print-kpi mkt-print-kpi-cap">' +
            '<div class="mkt-print-kpi-val">' + fmtNum(m.capacidade_maxima) + '</div>' +
            '<div class="mkt-print-kpi-lbl">capacidade total<br/>da cidade</div>' +
          '</div>' +
          '<div class="mkt-print-kpi mkt-print-kpi-gap">' +
            '<div class="mkt-print-kpi-val">' + fmtNum(m.gap_oportunidade) + '</div>' +
            '<div class="mkt-print-kpi-lbl">vagas<br/>disponíveis</div>' +
          '</div>' +
          '<div class="mkt-print-kpi mkt-print-kpi-prem">' +
            '<div class="mkt-print-kpi-val">' + fmtNum(p.total_premium) + '</div>' +
            '<div class="mkt-print-kpi-lbl">pontos premium<br/>identificados</div>' +
          '</div>' +
        '</div>' +
        '<p class="mkt-print-summary-line">' +
          '<strong>' + gapPct + '%</strong> do mercado de <strong>' + escapeHtml(cidade) + '</strong> ainda está disponível para a AVEND. ' +
          'Hoje há <strong>' + fmtNum(m.maquinas_atuais) + ' máquinas</strong> AVEND operando — ' +
          'espaço bruto para mais <strong>' + fmtNum(m.gap_oportunidade) + '</strong>, sendo ' +
          '<strong>' + fmtNum(p.total_premium) + ' em pontos premium</strong> de maior retorno.' +
        '</p>' +
      '</section>';

    // 3) ANÁLISE DETALHADA — clone do relatório
    const detailHead =
      '<section class="mkt-print-section mkt-print-detail">' +
        '<header class="mkt-print-section-head">' +
          '<span class="mkt-print-section-num">02</span>' +
          '<h3 class="mkt-print-section-title">Análise Detalhada</h3>' +
        '</header>';

    // 4) PRÓXIMOS PASSOS — call to action + contato
    const nextSteps =
      '<section class="mkt-print-section mkt-print-next">' +
        '<header class="mkt-print-section-head">' +
          '<span class="mkt-print-section-num">03</span>' +
          '<h3 class="mkt-print-section-title">Próximos Passos</h3>' +
        '</header>' +
        '<ul class="mkt-print-next-list">' +
          '<li><strong>Avaliação dos pontos premium</strong> da cidade pela Diretoria de Pontos da AVEND</li>' +
          '<li><strong>Plano de implantação</strong> personalizado conforme perfil do investidor</li>' +
          '<li><strong>Projeção financeira</strong> realista no simulador AVEND, com tributação real</li>' +
        '</ul>' +
        '<div class="mkt-print-contact">' +
          '<div class="mkt-print-contact-item">' +
            '<span class="mkt-print-contact-lbl">DIAGNÓSTICO ONLINE</span>' +
            '<span class="mkt-print-contact-val">avend.com.br/?cidade=' + slug(cidade) + (uf ? '-' + uf.toLowerCase() : '') + '</span>' +
          '</div>' +
          '<div class="mkt-print-contact-item">' +
            '<span class="mkt-print-contact-lbl">SAIBA MAIS</span>' +
            '<span class="mkt-print-contact-val">avend.com.br</span>' +
          '</div>' +
        '</div>' +
      '</section>';

    // 5) FOOTER — 3 colunas
    const leadDetalhe = leadInfo
      ? '<span class="mkt-print-footer-lead">Para ' + escapeHtml(leadInfo.nome) + ' · Consultor: ' + escapeHtml(leadInfo.consultor) + '</span><br/>'
      : '';
    const footer =
      '<footer class="mkt-print-footer">' +
        '<div class="mkt-print-footer-col mkt-print-footer-brand">' +
          '<strong>AVEND</strong> · Vending Machines &amp; Franchising' +
        '</div>' +
        '<div class="mkt-print-footer-col mkt-print-footer-disclaimer">' +
          leadDetalhe +
          'Diagnóstico inicial · base IBGE 2025 + benchmarks da rede. ' +
          'Não substitui relatório de mercado oficial.' +
        '</div>' +
        '<div class="mkt-print-footer-col mkt-print-footer-code">' +
          'AV-' + codigo + ' · ' + dataStr +
        '</div>' +
      '</footer>';

    printArea.innerHTML = cover + summary + detailHead;
    printArea.querySelector(".mkt-print-detail").appendChild(clone);
    printArea.insertAdjacentHTML("beforeend", nextSteps + footer);

    document.body.appendChild(printArea);
    document.body.classList.add("is-mkt-printing");

    const prevTitle = document.title;
    const safeName = slug(cidade) + (uf ? "-" + uf.toLowerCase() : "");
    document.title = "Diagnostico-AVEND-" + (safeName || "mercado");

    const cleanup = function () {
      document.body.classList.remove("is-mkt-printing");
      if (printArea.parentNode) printArea.parentNode.removeChild(printArea);
      document.title = prevTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(function () { window.print(); }, 120);

    if (root.TELEMETRY && typeof root.TELEMETRY.track === "function") {
      root.TELEMETRY.track("market_territory_print", { cidade: cidade, uf: uf, codigo: codigo });
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
    wireReportActions(container, { cidade: city.n, uf: city.uf, populacao: city.pop, data: data, ranking: ranking });

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
