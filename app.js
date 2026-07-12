// web/app.js
'use strict';

// ── Utilitários de formatação ────────────────────────────────────────────────

const fmtRS = v =>
  v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (v, decimals = 1) =>
  v == null ? '—' : (v * 100).toFixed(decimals) + '%';

const fmtDias = v => {
  if (v == null) return '—';
  if (v > 0) return `+${v}d (adiantado)`;
  if (v < 0) return `${v}d (atrasado)`;
  return 'No prazo';
};

const fmtData = iso => {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[+m - 1]}/${y}`;
};

const fmtDatetime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const ie_color = ie => ie == null ? '' : ie < 1 ? 'green' : ie <= 1.05 ? 'amber' : 'red';
const dias_color = d => d == null ? '' : d >= 0 ? 'green' : d >= -30 ? 'amber' : 'red';

function el(tag, cls, html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

// ── Estado global ────────────────────────────────────────────────────────────

let DADOS = null;
let obraAtual = null;
let secaoAtual = 'dashboard';
const SECOES_DEF = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'prazo', label: 'Prazo', icon: 'event_note' },
  { id: 'custo', label: 'Custo', icon: 'payments' },
  { id: 'pls', label: 'PLS', icon: 'receipt_long' },
  { id: 'fluxo', label: 'Fluxo', icon: 'account_balance_wallet' },
];
const SECAO_COMPARATIVO = { id: 'comparativo', label: 'Comparativo', icon: 'compare_arrows' };
const chartInstances = {};

// ── Navegação ────────────────────────────────────────────────────────────────

function renderObraSelector() {
  const box = document.getElementById('obra-selector');
  box.innerHTML = '';
  const slugs = Object.keys(DADOS.obras);
  if (slugs.length === 1) {
    const obra = DADOS.obras[slugs[0]];
    box.innerHTML = `<div class="obra-nome">${obra.nome}</div>
      <div class="obra-cod">${obra.localizacao || ''}</div>`;
  } else {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Selecionar obra');
    slugs.forEach(slug => {
      const opt = document.createElement('option');
      opt.value = slug;
      opt.textContent = DADOS.obras[slug].nome;
      sel.appendChild(opt);
    });
    sel.value = obraAtual;
    sel.addEventListener('change', e => selecionarObra(e.target.value));
    box.appendChild(sel);
  }
}

function secoesDisponiveis() {
  const secoes = [...SECOES_DEF];
  if (Object.keys(DADOS.obras).length > 1) secoes.push(SECAO_COMPARATIVO);
  return secoes;
}

function renderSecoesNav() {
  const nav = document.getElementById('secoes-nav');
  nav.innerHTML = '';
  secoesDisponiveis().forEach(({ id, label, icon }) => {
    const btn = el('button', id === secaoAtual ? 'ativo' : '');
    btn.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${label}</span>`;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => selecionarSecao(id));
    nav.appendChild(btn);
  });
}

function selecionarObra(slug) {
  obraAtual = slug;
  renderSecao();
}

function selecionarSecao(s) {
  secaoAtual = s;
  renderSecoesNav();
  renderSecao();
}

function renderSecao() {
  destroyCharts();
  const main = document.getElementById('conteudo');
  main.innerHTML = '';
  if (secaoAtual === 'comparativo') { renderComparativo(); return; }
  const obra = DADOS.obras[obraAtual];
  if (!obra) return;
  if (secaoAtual === 'dashboard') renderDashboard(obra, main);
  else if (secaoAtual === 'custo') renderCusto(obra, main);
  else if (secaoAtual === 'prazo') renderPrazo(obra, main);
  else if (secaoAtual === 'pls') renderPLS(obra, main);
  else if (secaoAtual === 'fluxo') renderFluxo(obra, main);
}

function destroyCharts() {
  Object.values(chartInstances).forEach(c => c.destroy());
  Object.keys(chartInstances).forEach(k => delete chartInstances[k]);
}

// ── Componentes base ─────────────────────────────────────────────────────────

function kpiRow(cards) {
  const row = el('div', 'kpi-row');
  cards.forEach(({ label, value, desc, color }) => {
    const card = el('div', `kpi-card ${color || ''}`);
    card.innerHTML = `<div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${desc ? `<div class="kpi-desc">${desc}</div>` : ''}`;
    row.appendChild(card);
  });
  return row;
}

function sectionHeader(text) {
  return el('div', 'section-header', text);
}

// ── Seção: Dashboard (visão geral) ───────────────────────────────────────────

function dashCard(title, icon, bodyHtml) {
  const card = el('div', 'card dash-card');
  card.innerHTML = `<div class="dash-card-head">
      <span class="dash-card-title">${title}</span>
      <span class="material-symbols-outlined">${icon}</span>
    </div>${bodyHtml}`;
  return card;
}

function deltaMesAnterior(meses) {
  const realizados = (meses || []).filter(m => m.realizado);
  if (realizados.length < 2) return null;
  const atual = realizados[realizados.length - 1].valor_rs;
  const anterior = realizados[realizados.length - 2].valor_rs;
  if (!anterior) return null;
  return (atual - anterior) / anterior;
}

function serviceListCard(titulo, itens, msgVazio) {
  const card = el('div', 'card');
  card.innerHTML = `<h3 class="dash-section-title">${titulo}</h3>`;
  if (!itens?.length) {
    card.appendChild(el('div', 'empty-state', msgVazio));
    return card;
  }
  const ul = el('ul', 'service-list');
  itens.forEach(item => {
    const pct = Math.min((item.avanco_servico_pct || 0) * 100, 100);
    const li = el('li', 'service-item');
    li.innerHTML = `
      <div class="service-head">
        <span class="service-nome">${item.nome}</span>
        <span class="service-pct">${fmtPct(item.avanco_servico_pct)}</span>
      </div>
      <div class="dual-bar-track"><div class="dual-bar-fill exec" style="width:${pct.toFixed(1)}%"></div></div>`;
    ul.appendChild(li);
  });
  card.appendChild(ul);
  return card;
}

function renderDashboard(obra, container) {
  const p = obra.prazo, c = obra.custo, f = obra.fluxo, pls = obra.pls;

  // ── Linha de 4 cards ──
  const summary = el('div', 'dash-summary');

  // Card 1: Prazo
  if (p?.avanco) {
    const exec = p.avanco.global_exec_acum, plan = p.avanco.global_plan_acum;
    const idp = plan > 0 ? exec / plan : null;
    const idpCls = idp == null ? 'blue' : idp >= 0.95 ? 'green' : idp >= 0.85 ? 'amber' : 'red';
    summary.appendChild(dashCard('Prazo', 'timeline', `
      <div class="dash-value">${fmtPct(exec)} <span class="dash-value-sub">/ ${fmtPct(plan)} plan.</span></div>
      <span class="dash-badge ${idpCls}">IDP: ${idp != null ? idp.toFixed(2) : '—'}</span>
      <div class="dual-bar">
        <div class="dual-bar-track"><div class="dual-bar-fill exec" style="width:${Math.min(exec * 100, 100).toFixed(1)}%"></div></div>
        <div class="dual-bar-track thin"><div class="dual-bar-fill plan" style="width:${Math.min(plan * 100, 100).toFixed(1)}%"></div></div>
      </div>`));
  } else {
    summary.appendChild(dashCard('Prazo', 'timeline', `<div class="empty-state">Sem dados de prazo</div>`));
  }

  // Card 2: Custo Incorrido
  if (f) {
    const delta = deltaMesAnterior(f.meses);
    const deltaHtml = delta == null ? '' :
      `<span class="dash-badge ${delta > 0 ? 'red' : 'green'}">
        <span class="material-symbols-outlined" style="font-size:15px">${delta > 0 ? 'trending_up' : 'trending_down'}</span>
        ${(delta * 100).toFixed(1)}% vs mês ant.</span>`;
    summary.appendChild(dashCard('Custo Incorrido', 'account_balance_wallet', `
      <div class="dash-line">No mês: <strong>${fmtRS(f.despesa_mes_atual_rs)}</strong></div>
      <div class="dash-line">Acumulado: <strong>${fmtRS(f.despesa_acumulada_rs)}</strong></div>
      ${deltaHtml}`));
  } else {
    summary.appendChild(dashCard('Custo Incorrido', 'account_balance_wallet', `<div class="empty-state">Sem dados de fluxo</div>`));
  }

  // Card 3: Resultado (economia vs orçamento — IE)
  if (c) {
    const disc = c.discrepancia_acumulada_total;
    const discCls = disc <= 0 ? 'green' : 'red';
    const ieCls = ie_color(c.ie_atual_total) || 'blue';
    summary.appendChild(dashCard('Resultado', 'analytics', `
      <div class="dash-value" style="color:var(--${discCls})">${fmtRS(disc)}</div>
      <div class="dash-line">${disc <= 0 ? 'Economia acumulada' : 'Estouro acumulado'} vs orçamento</div>
      <span class="dash-badge ${ieCls}">IE ${c.ie_atual_total?.toFixed(3) ?? '—'} · proj. ${c.ie_projetado_total?.toFixed(3) ?? '—'}</span>`));
  } else {
    summary.appendChild(dashCard('Resultado', 'analytics', `<div class="empty-state">Sem dados de custo</div>`));
  }

  // Card 4: PLS
  const mods = [pls?.modulo1 && { n: 1, m: pls.modulo1 }, pls?.modulo2 && { n: 2, m: pls.modulo2 }].filter(Boolean);
  if (mods.length) {
    const linhas = mods.map(({ n, m }) => `
      <div class="dash-line">Mód ${n} — mês: <strong>${fmtRS(m.medicao_mes_rs)}</strong> (${fmtPct(m.avanco_fisico_mes_pct)})</div>
      <div class="dash-line">Mód ${n} — acum: <strong>${fmtRS(m.acumulado_recebido_rs)}</strong> (${fmtPct(m.avanco_fisico_acumulado_pct)})</div>`).join('');
    const totalMedido = mods.reduce((s, { m }) => s + (m.acumulado_recebido_rs || 0), 0);
    summary.appendChild(dashCard('PLS', 'receipt_long', `${linhas}
      <span class="dash-badge blue">Total medido: ${fmtRS(totalMedido)}</span>`));
  } else {
    summary.appendChild(dashCard('PLS', 'receipt_long', `<div class="empty-state">Sem medições PLS</div>`));
  }

  container.appendChild(summary);

  // ── Grade 8/4 ──
  const grid = el('div', 'dash-grid');
  const left = el('div', 'dash-col-left');
  const right = el('div', 'dash-col-right');

  // Gerenciador de Prazo (curva S)
  const cardPrazo = el('div', 'card');
  cardPrazo.innerHTML = `<h3 class="dash-section-title">Gerenciador de Prazo</h3>`;
  const curva = p?.curva_mensal || [];
  if (curva.length) {
    const body = el('div', 'dash-chart-body');
    const canvas = document.createElement('canvas');
    canvas.height = 260;
    body.appendChild(canvas);
    cardPrazo.appendChild(body);
    chartInstances['dash-prazo'] = new Chart(canvas, {
      data: {
        labels: curva.map(r => r.mes),
        datasets: [
          { type: 'line', label: 'Executado', data: curva.map(r => r.exec_acum_pct * 100),
            borderColor: '#1e3a8a', backgroundColor: '#1e3a8a', tension: 0.3, pointRadius: 3 },
          { type: 'line', label: 'Planejado', data: curva.map(r => r.plan_acum_pct * 100),
            borderColor: '#757682', borderDash: [6, 4], backgroundColor: '#757682',
            tension: 0.3, pointRadius: 3 },
          { type: 'bar', label: 'Avanço no mês', data: curva.map(r => r.avanco_mes_pct * 100),
            backgroundColor: 'rgba(30,58,138,0.25)', borderRadius: 3 },
        ]
      },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } } },
        plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}%` } } }
      }
    });
  } else {
    cardPrazo.appendChild(el('div', 'empty-state', 'Histórico do GP indisponível.'));
  }
  left.appendChild(cardPrazo);

  // Gerenciador Econômico
  const cardEcon = el('div', 'card');
  cardEcon.innerHTML = `<h3 class="dash-section-title">Gerenciador Econômico</h3>`;
  const realizados = (f?.meses || []).filter(m => m.realizado);
  if (realizados.length) {
    const body = el('div', 'dash-chart-body');
    const canvas = document.createElement('canvas');
    canvas.height = 260;
    body.appendChild(canvas);
    cardEcon.appendChild(body);

    let acum = 0;
    const realizadoAcum = realizados.map(m => (acum += m.valor_rs));

    const medicoes = (pls?.historico_medicoes || []).slice()
      .sort((a, b) => (a.periodo_fim || '').localeCompare(b.periodo_fim || ''));
    const medidoAcumAte = yyyymm => {
      const porMod = {};
      medicoes.forEach(h => {
        if (h.periodo_fim && h.periodo_fim.slice(0, 7) <= yyyymm) porMod[h.modulo] = h.rs_acum;
      });
      const vals = Object.values(porMod);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };

    chartInstances['dash-econ'] = new Chart(canvas, {
      data: {
        labels: realizados.map(m => fmtData(m.data)),
        datasets: [
          { type: 'line', label: 'Realizado Acum.', data: realizadoAcum,
            borderColor: '#1e3a8a', backgroundColor: '#1e3a8a', tension: 0.2, pointRadius: 3 },
          { type: 'line', label: 'Medido Acum.', data: realizados.map(m => medidoAcumAte(m.data.slice(0, 7))),
            borderColor: '#16a34a', borderDash: [6, 4], backgroundColor: '#16a34a',
            tension: 0.2, pointRadius: 3, spanGaps: true },
          { type: 'bar', label: 'Gasto Mensal', data: realizados.map(m => m.valor_rs),
            backgroundColor: 'rgba(30,58,138,0.25)', borderRadius: 3 },
        ]
      },
      options: {
        responsive: true,
        scales: { y: { ticks: { callback: v => fmtRS(v) } }, x: { ticks: { maxRotation: 45 } } },
        plugins: { tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRS(ctx.raw)}` } } }
      }
    });
  } else {
    cardEcon.appendChild(el('div', 'empty-state', 'Sem fluxo realizado para exibir.'));
  }
  left.appendChild(cardEcon);

  // Listas de serviços
  right.appendChild(serviceListCard('Principais Serviços do Mês',
    p?.top5_mes_vigente, 'Sem dados no GP deste mês.'));
  right.appendChild(serviceListCard('Principais Serviços do Próximo Mês',
    p?.top5_proximo_mes, 'Sem dados no GP deste mês.'));

  grid.appendChild(left);
  grid.appendChild(right);
  container.appendChild(grid);
}

// ── Seção: Custo ─────────────────────────────────────────────────────────────

function renderCusto(obra, container) {
  const c = obra.custo;
  if (!c) {
    container.appendChild(el('div', 'error', 'Dados de custo não disponíveis.'));
    return;
  }

  container.appendChild(kpiRow([
    { label: 'IE Atual', value: c.ie_atual_total?.toFixed(3) ?? '—',
      desc: c.ie_atual_total < 1 ? 'Economia' : 'Estouro', color: ie_color(c.ie_atual_total) },
    { label: 'IE Projetado', value: c.ie_projetado_total?.toFixed(3) ?? '—',
      desc: 'ao final da obra', color: ie_color(c.ie_projetado_total) },
    { label: 'Discrepância Acum.', value: fmtRS(c.discrepancia_acumulada_total),
      desc: 'acumulado', color: c.discrepancia_acumulada_total <= 0 ? 'green' : 'red' },
    { label: 'Custo Proj. / UH', value: fmtRS(c.custo_projetado_uh),
      desc: 'por unidade', color: 'blue' },
  ]));

  container.appendChild(kpiRow([
    { label: 'Custo Incorrido', value: fmtRS(c.custo_incorrido), color: 'dark' },
    { label: 'Custo a Incorrer', value: fmtRS(c.custo_a_incorrer), color: 'dark' },
    { label: 'Orçamento Projetado', value: fmtRS(c.orcamento_projetado_total), color: 'blue' },
  ]));

  if (!c.categorias?.length) return;

  container.appendChild(sectionHeader('IE por Categoria'));

  const wrap = el('div', 'chart-wrap');
  const canvas = document.createElement('canvas');
  canvas.id = 'chart-custo-cat';
  canvas.height = 280;
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const labels = c.categorias.map(cat => cat.nome);
  const ies = c.categorias.map(cat => cat.ie_atual);
  const colors = ies.map(ie => ie < 1 ? '#16a34a' : ie <= 1.05 ? '#eab308' : '#ba1a1a');

  chartInstances['custo-cat'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'IE Atual',
        data: ies,
        backgroundColor: colors,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, refLine: { enabled: true } },
      scales: {
        y: {
          beginAtZero: false,
          suggestedMin: 0.85,
          suggestedMax: 1.20,
          ticks: { callback: v => v.toFixed(2) }
        }
      }
    }
  });
  // A linha de referência IE=1 é desenhada pelo plugin global 'refLine' (ver final do arquivo),
  // ativado pelo refLine:{ enabled: true } nas opções acima.
}

// ── Seção: Prazo ─────────────────────────────────────────────────────────────

function renderPrazo(obra, container) {
  const p = obra.prazo;
  if (!p) {
    container.appendChild(el('div', 'error', 'Dados de prazo não disponíveis.'));
    return;
  }
  const av = p.avanco || {};

  container.appendChild(kpiRow([
    { label: 'Status', value: fmtDias(p.status_dias), color: dias_color(p.status_dias) },
    { label: 'Prazo Projetado', value: p.prazo_projetado ?? '—', color: 'blue' },
    { label: 'Próximo Mês (plan)', value: fmtPct(p.planejado_proximo_mes_pct), color: 'dark' },
    { label: 'Próximo Mês (proj)', value: fmtPct(p.projetado_proximo_mes_pct), color: 'dark' },
  ]));

  container.appendChild(sectionHeader('Avanço Físico por Frente'));

  const frentes = [
    { label: 'Global',          plan: av.global_plan_acum,         exec: av.global_exec_acum },
    { label: 'Global (mês)',    plan: av.global_plan_mes,          exec: av.global_exec_mes },
    { label: 'Habitação',       plan: av.habitacao_plan_acum,      exec: av.habitacao_exec_acum },
    { label: 'Infraestrutura',  plan: av.infraestrutura_plan_acum, exec: av.infraestrutura_exec_acum },
    { label: 'Equipamentos',    plan: av.equipamentos_plan_acum,   exec: av.equipamentos_exec_acum },
  ];

  const progressWrap = el('div', 'chart-wrap');
  frentes.forEach(({ label, plan, exec }) => {
    const row = el('div', 'progress-row');
    row.innerHTML = `
      <span class="progress-label">${label}</span>
      <div class="progress-track">
        <div class="progress-fill plan" style="width:${Math.min((plan||0)*100,100).toFixed(1)}%"></div>
        <div class="progress-fill exec" style="width:${Math.min((exec||0)*100,100).toFixed(1)}%"></div>
      </div>
      <span class="progress-val">${fmtPct(exec)}</span>`;
    progressWrap.appendChild(row);
  });
  container.appendChild(progressWrap);

  if (p.top5_mes_vigente?.length) {
    container.appendChild(sectionHeader('Top 5 — Mês Vigente'));
    const tbl = el('table', 'data-table');
    tbl.innerHTML = `<thead><tr><th>Serviço</th><th>Contribuição</th><th>% Planejado</th></tr></thead>`;
    const body = document.createElement('tbody');
    p.top5_mes_vigente.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${item.nome}</td><td>${fmtPct(item.contribuicao_pct)}</td><td>${fmtPct(item.avanco_servico_pct)}</td>`;
      body.appendChild(tr);
    });
    tbl.appendChild(body);
    container.appendChild(tbl);
  }

  if (p.top5_proximo_mes?.length) {
    container.appendChild(sectionHeader('Top 5 — Próximo Mês'));
    const tbl = el('table', 'data-table');
    tbl.innerHTML = `<thead><tr><th>Serviço</th><th>Contribuição</th><th>% Planejado</th></tr></thead>`;
    const body = document.createElement('tbody');
    p.top5_proximo_mes.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${item.nome}</td><td>${fmtPct(item.contribuicao_pct)}</td><td>${fmtPct(item.avanco_servico_pct)}</td>`;
      body.appendChild(tr);
    });
    tbl.appendChild(body);
    container.appendChild(tbl);
  }
}

// ── Seção: PLS ───────────────────────────────────────────────────────────────

function renderPLS(obra, container) {
  const pls = obra.pls;
  if (!pls) {
    container.appendChild(el('div', 'error', 'Dados PLS não disponíveis.'));
    return;
  }
  const m1 = pls.modulo1;
  const m2 = pls.modulo2;
  const curva = pls.previsao_curva || [];
  const historico = pls.historico_medicoes || [];

  const kpis = [];
  if (m1) kpis.push({ label: 'Contrato Mód 1', value: fmtRS(m1.contrato_total_rs), color: 'blue' });
  if (m2) kpis.push({ label: 'Contrato Mód 2', value: fmtRS(m2.contrato_total_rs), color: 'blue' });
  const totalContrato = (m1?.contrato_total_rs || 0) + (m2?.contrato_total_rs || 0);
  const totalRecebido = (m1?.acumulado_recebido_rs || 0) + (m2?.acumulado_recebido_rs || 0);
  kpis.push({ label: 'Total Contrato', value: fmtRS(totalContrato), color: 'dark' });
  kpis.push({ label: 'Já Recebido',
    value: fmtRS(totalRecebido),
    desc: totalContrato > 0 ? fmtPct(totalRecebido / totalContrato) + ' do total' : '',
    color: 'green' });
  container.appendChild(kpiRow(kpis));

  const kpis2 = [];
  if (m1) kpis2.push(
    { label: 'Mód 1 — Medição nº', value: String(m1.numero_medicao), desc: m1.periodo_referencia, color: 'blue' },
    { label: 'Mód 1 — Avanço Mês', value: fmtPct(m1.avanco_fisico_mes_pct), color: 'green' },
    { label: 'Mód 1 — Avanço Acum.', value: fmtPct(m1.avanco_fisico_acumulado_pct), color: 'green' },
  );
  if (m2) kpis2.push(
    { label: 'Mód 2 — Medição nº', value: String(m2.numero_medicao), desc: m2.periodo_referencia, color: 'blue' },
    { label: 'Mód 2 — Avanço Acum.', value: fmtPct(m2.avanco_fisico_acumulado_pct), color: 'green' },
  );
  if (kpis2.length) container.appendChild(kpiRow(kpis2));

  if (curva.length) {
    container.appendChild(sectionHeader('Previsão de Recebimento PLS'));
    const wrap = el('div', 'chart-wrap');
    const canvas = document.createElement('canvas');
    canvas.id = 'chart-pls-prev';
    canvas.height = 300;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    const labels = curva.map(r => fmtData(r.data));

    const realMap1 = {}, realMap2 = {};
    historico.forEach(h => {
      const key = h.periodo_fim.slice(0, 7);
      if (h.modulo === 1) realMap1[key] = (realMap1[key] || 0) + h.rs_periodo;
      if (h.modulo === 2) realMap2[key] = (realMap2[key] || 0) + h.rs_periodo;
    });

    chartInstances['pls-prev'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Mód 1 Previsto', data: curva.map(r => r.prev_mod1),
            backgroundColor: 'rgba(30,58,138,0.7)', stack: 'prev', borderRadius: 3 },
          { label: 'Mód 2 Previsto', data: curva.map(r => r.prev_mod2),
            backgroundColor: 'rgba(22,163,74,0.7)', stack: 'prev', borderRadius: 3 },
          { label: 'Mód 1 Realizado',
            data: curva.map(r => realMap1[r.data.slice(0, 7)] ?? null),
            type: 'line', borderColor: '#1e3a8a', backgroundColor: '#1e3a8a',
            pointStyle: 'circle', pointRadius: 6, spanGaps: false, borderDash: [5, 4] },
          { label: 'Mód 2 Realizado',
            data: curva.map(r => realMap2[r.data.slice(0, 7)] ?? null),
            type: 'line', borderColor: '#16a34a', backgroundColor: '#16a34a',
            pointStyle: 'rectRot', pointRadius: 6, spanGaps: false, borderDash: [5, 4] },
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: { ticks: { callback: v => fmtRS(v) } },
          x: { ticks: { maxRotation: 45 } }
        },
        plugins: {
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRS(ctx.raw)}` } }
        }
      }
    });
  }

  if (historico.length) {
    container.appendChild(sectionHeader('Histórico de Medições (Atestada)'));
    const tbl = el('table', 'data-table');
    tbl.innerHTML = `<thead><tr>
      <th>Medição</th><th>Período</th><th>% Período</th>
      <th>R$ Período</th><th>% Acum.</th><th>R$ Acum.</th>
    </tr></thead>`;
    const body = document.createElement('tbody');
    historico.forEach(h => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>Mód ${h.modulo} — nº${h.numero_medicao}</td>
        <td>${h.periodo_fim ? new Date(h.periodo_fim + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td>${fmtPct(h.pct_periodo)}</td>
        <td>${fmtRS(h.rs_periodo)}</td>
        <td>${fmtPct(h.pct_acum)}</td>
        <td>${fmtRS(h.rs_acum)}</td>`;
      body.appendChild(tr);
    });
    tbl.appendChild(body);
    container.appendChild(tbl);
  }
}

// ── Seção: Fluxo ─────────────────────────────────────────────────────────────

function renderFluxo(obra, container) {
  const f = obra.fluxo;
  if (!f) {
    container.appendChild(el('div', 'error', 'Dados de fluxo não disponíveis.'));
    return;
  }

  container.appendChild(kpiRow([
    { label: 'Despesa Mês Atual', value: fmtRS(f.despesa_mes_atual_rs), color: 'dark' },
    { label: 'Despesa Acumulada', value: fmtRS(f.despesa_acumulada_rs), color: 'dark' },
    { label: 'Previsto Próx. Mês', value: fmtRS(f.previsto_proximo_mes_rs), color: 'blue' },
    { label: 'Total Projetado', value: fmtRS(f.total_projetado_rs), color: 'blue' },
  ]));

  if (!f.meses?.length) return;

  container.appendChild(sectionHeader('Fluxo de Desembolso'));

  const wrap = el('div', 'chart-wrap');
  const canvas = document.createElement('canvas');
  canvas.id = 'chart-fluxo';
  canvas.height = 280;
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const todosMeses = f.meses;

  chartInstances['fluxo'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: todosMeses.map(m => fmtData(m.data)),
      datasets: [
        {
          label: 'Realizado',
          data: todosMeses.map(m => m.realizado ? m.valor_rs : null),
          backgroundColor: 'rgba(22,163,74,0.75)',
          borderRadius: 4,
        },
        {
          label: 'Previsto',
          data: todosMeses.map(m => !m.realizado ? m.valor_rs : null),
          backgroundColor: 'rgba(30,58,138,0.45)',
          borderRadius: 4,
        },
      ]
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtRS(ctx.raw)}` } }
      },
      scales: {
        y: { ticks: { callback: v => fmtRS(v) } },
        x: { ticks: { maxRotation: 45 } }
      }
    }
  });
}

// ── Comparativo ──────────────────────────────────────────────────────────────

function renderComparativo() {
  const main = document.getElementById('conteudo');
  const comp = DADOS.comparativo?.obras || [];
  if (!comp.length) {
    main.appendChild(el('div', 'error', 'Nenhuma obra no comparativo.'));
    return;
  }

  main.appendChild(sectionHeader('Comparativo entre Obras'));
  const grid = el('div', 'comp-grid');

  comp.forEach(obra => {
    const card = el('div', 'comp-card');
    card.innerHTML = `<h3>${obra.nome}</h3>`;

    const items = [
      { label: 'IE Atual',
        value: obra.ie_atual != null ? obra.ie_atual.toFixed(3) : '—',
        cls: ie_color(obra.ie_atual) },
      { label: 'IE Projetado',
        value: obra.ie_projetado != null ? obra.ie_projetado.toFixed(3) : '—',
        cls: ie_color(obra.ie_projetado) },
      { label: 'Avanço Físico',
        value: fmtPct(obra.avanco_global_pct),
        cls: '' },
      { label: 'Status',
        value: fmtDias(obra.status_dias),
        cls: dias_color(obra.status_dias) },
      { label: 'Prazo Projetado',
        value: obra.prazo_projetado ?? '—',
        cls: '' },
      { label: 'PLS Mód 1',
        value: fmtPct(obra.pls_avanco_mod1),
        cls: '' },
      { label: 'PLS Mód 2',
        value: fmtPct(obra.pls_avanco_mod2),
        cls: '' },
    ];

    items.forEach(({ label, value, cls }) => {
      const row = el('div', 'comp-item');
      row.innerHTML = `<span>${label}</span><span class="comp-val ${cls}">${value}</span>`;
      card.appendChild(row);
    });

    grid.appendChild(card);
  });

  main.appendChild(grid);
}

// ── Plugin global: linha de referência IE=1 nos gráficos de barra ────────────

Chart.register({
  id: 'refLine',
  afterDraw(chart) {
    if (!chart.config.options?.plugins?.refLine?.enabled) return;
    const { ctx, scales: { y } } = chart;
    const yPos = y.getPixelForValue(1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(chart.chartArea.left, yPos);
    ctx.lineTo(chart.chartArea.right, yPos);
    ctx.strokeStyle = '#ba1a1a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.restore();
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const main = document.getElementById('conteudo');
  main.innerHTML = '<p class="loading">Carregando dados...</p>';
  try {
    const resp = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    DADOS = await resp.json();
  } catch (e) {
    main.innerHTML = `<div class="error">Erro ao carregar data.json: ${e.message}</div>`;
    return;
  }

  document.getElementById('gerado-em').textContent = `Atualizado em ${fmtDatetime(DADOS.gerado_em)}`;

  const slugs = Object.keys(DADOS.obras);
  if (!slugs.length) {
    main.innerHTML = '<p class="loading">Nenhuma obra encontrada.</p>';
    return;
  }
  obraAtual = slugs[0];
  renderObraSelector();
  renderSecoesNav();
  renderSecao();
}

init();
