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
let secaoAtual = 'custo';
const SECOES = ['custo', 'prazo', 'pls', 'fluxo'];
const SECOES_LABELS = { custo: 'Custo', prazo: 'Prazo', pls: 'PLS', fluxo: 'Fluxo' };
const chartInstances = {};

// ── Navegação ────────────────────────────────────────────────────────────────

function renderObrasTabs() {
  const nav = document.getElementById('obras-nav');
  nav.innerHTML = '';
  const obras = Object.entries(DADOS.obras);
  obras.forEach(([slug, obra]) => {
    const btn = el('button', slug === obraAtual ? 'ativo' : '');
    btn.textContent = obra.nome;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => selecionarObra(slug));
    nav.appendChild(btn);
  });
  if (obras.length > 1) {
    const btn = el('button', obraAtual === 'comparativo' ? 'ativo' : '');
    btn.textContent = 'Comparativo';
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => selecionarObra('comparativo'));
    nav.appendChild(btn);
  }
}

function renderSecoesTabs() {
  const nav = document.getElementById('secoes-nav');
  nav.innerHTML = '';
  SECOES.forEach(s => {
    const btn = el('button', s === secaoAtual ? 'ativo' : '');
    btn.textContent = SECOES_LABELS[s];
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => selecionarSecao(s));
    nav.appendChild(btn);
  });
}

function selecionarObra(slug) {
  obraAtual = slug;
  renderObrasTabs();
  const isComp = slug === 'comparativo';
  document.getElementById('secoes-sidebar').style.display = isComp ? 'none' : '';
  if (isComp) {
    renderComparativo();
  } else {
    renderSecoesTabs();
    renderSecao();
  }
}

function selecionarSecao(s) {
  secaoAtual = s;
  renderSecoesTabs();
  renderSecao();
}

function renderSecao() {
  const obra = DADOS.obras[obraAtual];
  if (!obra) return;
  destroyCharts();
  const main = document.getElementById('conteudo');
  main.innerHTML = '';
  if (secaoAtual === 'custo') renderCusto(obra, main);
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
  const colors = ies.map(ie => ie < 1 ? '#1a9e4b' : ie <= 1.05 ? '#e8a317' : '#e03e3e');

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
            backgroundColor: 'rgba(28,143,209,0.7)', stack: 'prev', borderRadius: 3 },
          { label: 'Mód 2 Previsto', data: curva.map(r => r.prev_mod2),
            backgroundColor: 'rgba(26,158,75,0.7)', stack: 'prev', borderRadius: 3 },
          { label: 'Mód 1 Realizado',
            data: curva.map(r => realMap1[r.data.slice(0, 7)] ?? null),
            type: 'line', borderColor: '#1c8fd1', backgroundColor: '#1c8fd1',
            pointStyle: 'circle', pointRadius: 6, spanGaps: false, borderDash: [5, 4] },
          { label: 'Mód 2 Realizado',
            data: curva.map(r => realMap2[r.data.slice(0, 7)] ?? null),
            type: 'line', borderColor: '#1a9e4b', backgroundColor: '#1a9e4b',
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
          backgroundColor: 'rgba(26,158,75,0.75)',
          borderRadius: 4,
        },
        {
          label: 'Previsto',
          data: todosMeses.map(m => !m.realizado ? m.valor_rs : null),
          backgroundColor: 'rgba(28,143,209,0.55)',
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
  destroyCharts();
  const main = document.getElementById('conteudo');
  main.innerHTML = '';
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
    ctx.strokeStyle = '#e03e3e';
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
    const resp = await fetch('data.json');
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
  renderObrasTabs();
  renderSecoesTabs();
  renderSecao();
}

init();
