/* ============================================================
   ETconomize v1 — frontend logic
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     CONSTANTS
     ============================================================ */
  const MASCOTES_DATA = [
    { id: 'azul',    nome: 'Azul',    desc: 'Organizado, mantém tudo no lugar' },
    { id: 'roxo',    nome: 'Roxo',    desc: 'Observador, 3 olhos atentos' },
    { id: 'rosa',    nome: 'Rosa',    desc: 'Multitarefa criativa' },
    { id: 'laranja', nome: 'Laranja', desc: 'Antenado, capta oportunidades' },
    { id: 'verde',   nome: 'Verde',   desc: 'Estrategista com foco' },
    { id: 'amarelo', nome: 'Amarelo', desc: 'Hiperativo, nunca para' }
  ];

  // Paleta pra gráficos de categoria (cores dos próprios mascotes)
  const CHART_PALETTE = [
    '#02B8FB', '#FB58C8', '#C6F404', '#FCC802',
    '#F84802', '#B19BFF', '#04E170', '#FF5A6E',
    '#00BCD4', '#E91E63', '#9C27B0', '#FF9800'
  ];

  const MES_NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    idToken: null,
    user: null,
    profile: null,
    cartao: null,
    responsaveis: [],
    categorias: [],
    currentView: 'dashboard',
    filters: {
      mes: new Date().getMonth() + 1,
      ano: new Date().getFullYear()
    },
    onboarding: { mascote: null },
    charts: {}
  };

  /* ============================================================
     HELPERS
     ============================================================ */
  const $ = id => document.getElementById(id);

  function brl(v) {
    return (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function parseJwt(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join(''));
      return JSON.parse(json);
    } catch (_) { return {}; }
  }

  function applyMascoteTheme(mascote) {
    document.documentElement.setAttribute('data-mascote', mascote || 'verde');
  }

  function cssvar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function toast(msg, kind = '') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function showLoader() { $('loader').classList.remove('hidden'); }
  function hideLoader() { $('loader').classList.add('hidden'); }

  function destroyChart(id) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
  }

  /* ============================================================
     API CLIENT
     ============================================================ */
  const api = {
    async call(action, params = {}) {
      try {
        const r = await fetch(ETconomize.APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, idToken: state.idToken, ...params })
        });
        return await r.json();
      } catch (err) {
        return { ok: false, error: 'network_error', message: err.message };
      }
    },
    whoami()                     { return this.call('whoami'); },
    getUser()                    { return this.call('getUser'); },
    createUser(p)                { return this.call('createUser', p); },
    updateUser(p)                { return this.call('updateUser', p); },
    listCategorias()             { return this.call('listCategorias'); },
    addReceita(p)                { return this.call('addReceita', p); },
    listReceitas(p)              { return this.call('listReceitas', p); },
    deleteReceita(p)             { return this.call('deleteReceita', p); },
    addDespesa(p)                { return this.call('addDespesa', p); },
    listDespesas(p)              { return this.call('listDespesas', p); },
    deleteDespesa(p)             { return this.call('deleteDespesa', p); },
    getCartao()                  { return this.call('getCartao'); },
    saveCartao(p)                { return this.call('saveCartao', p); },
    listResponsaveis()           { return this.call('listResponsaveis'); },
    addResponsavel(p)            { return this.call('addResponsavel', p); },
    deleteResponsavel(p)         { return this.call('deleteResponsavel', p); },
    addCompraCartao(p)           { return this.call('addCompraCartao', p); },
    deleteCompraCartao(p)        { return this.call('deleteCompraCartao', p); },
    listComprasCartao()          { return this.call('listComprasCartao'); },
    dashboard(p)                 { return this.call('dashboard', p); }
  };

  /* ============================================================
     STARS BACKGROUND
     ============================================================ */
  function generateStars(count) {
    const layer = $('stars');
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = (Math.random() * 100) + '%';
      const size = Math.random() < 0.85 ? 1 : 2;
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.opacity = (0.3 + Math.random() * 0.55).toFixed(2);
      s.style.animationDuration = (2 + Math.random() * 4).toFixed(2) + 's';
      s.style.animationDelay = (Math.random() * 5).toFixed(2) + 's';
      layer.appendChild(s);
    }
  }

  /* ============================================================
     GOOGLE SIGN-IN
     ============================================================ */
  function waitForGIS(cb, t = 0) {
    if (window.google && google.accounts && google.accounts.id) cb();
    else if (t < 60) setTimeout(() => waitForGIS(cb, t + 1), 100);
    else console.error('GIS não carregou');
  }

  function renderGoogleButton() {
    const c = $('signin-container');
    c.innerHTML = '';
    google.accounts.id.renderButton(c, {
      theme: 'filled_black', size: 'large', text: 'signin_with',
      shape: 'pill', logo_alignment: 'left', locale: 'pt-BR'
    });
  }

  function initGoogleSignIn() {
    waitForGIS(() => {
      google.accounts.id.initialize({
        client_id: ETconomize.CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      renderGoogleButton();
    });
  }

  async function handleCredentialResponse(response) {
    state.idToken = response.credential;
    state.profile = parseJwt(response.credential);
    showLoader();
    const res = await api.getUser();
    hideLoader();
    if (!res.ok) {
      toast('Erro ao verificar usuário: ' + (res.error || 'desconhecido'), 'neg');
      return;
    }
    if (res.exists) {
      state.user = res.user;
      applyMascoteTheme(res.user.mascote_escolhido);
      enterApp();
    } else {
      state.onboarding.mascote = null;
      showOnboarding();
    }
  }

  function logout() {
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    state.idToken = null;
    state.user = null;
    state.profile = null;
    state.cartao = null;
    state.responsaveis = [];
    Object.keys(state.charts).forEach(destroyChart);
    applyMascoteTheme('verde');
    $('app-container').classList.add('hidden');
    $('screen-onboarding').classList.add('hidden');
    $('screen-auth').classList.remove('hidden');
    renderGoogleButton();
  }

  /* ============================================================
     ONBOARDING
     ============================================================ */
  function showOnboarding() {
    $('screen-auth').classList.add('hidden');
    $('screen-onboarding').classList.remove('hidden');
    const firstName = (state.profile.name || state.profile.email || 'comandante').split(' ')[0];
    $('onb-name').textContent = firstName;
    renderMascoteGrid($('mascote-grid'), null, m => {
      state.onboarding.mascote = m;
      applyMascoteTheme(m);
      $('btn-step-saldo').disabled = false;
    });
    $('step-mascote').classList.remove('hidden');
    $('step-saldo').classList.add('hidden');
  }

  function renderMascoteGrid(container, selected, onSelect) {
    container.innerHTML = '';
    MASCOTES_DATA.forEach(m => {
      const card = document.createElement('div');
      card.className = 'mascote-card' + (m.id === selected ? ' selected' : '');
      card.innerHTML = `
        <img src="./${m.id}.png" alt="ET ${m.nome}" />
        <div class="mascote-name">${m.nome}</div>
      `;
      card.addEventListener('click', () => {
        container.querySelectorAll('.mascote-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        if (onSelect) onSelect(m.id);
      });
      container.appendChild(card);
    });
  }

  function setupOnboardingHandlers() {
    $('btn-step-saldo').addEventListener('click', () => {
      $('step-mascote').classList.add('hidden');
      $('step-saldo').classList.remove('hidden');
      setTimeout(() => $('input-saldo').focus(), 100);
    });
    $('btn-back-mascote').addEventListener('click', () => {
      $('step-saldo').classList.add('hidden');
      $('step-mascote').classList.remove('hidden');
    });
    $('btn-finalize').addEventListener('click', async () => {
      const saldo = parseFloat($('input-saldo').value);
      if (isNaN(saldo) || saldo < 0) {
        toast('Informe um saldo válido (pode ser 0)', 'neg');
        return;
      }
      showLoader();
      const res = await api.createUser({
        mascote_escolhido: state.onboarding.mascote,
        saldo_inicial: saldo
      });
      hideLoader();
      if (!res.ok) {
        toast('Erro ao criar conta: ' + (res.error || 'desconhecido'), 'neg');
        return;
      }
      state.user = res.user;
      toast('Bem-vindo a bordo, comandante! 🛸', 'pos');
      enterApp();
    });
  }

  /* ============================================================
     APP ENTRY
     ============================================================ */
  async function enterApp() {
    $('screen-auth').classList.add('hidden');
    $('screen-onboarding').classList.add('hidden');
    $('app-container').classList.remove('hidden');

    // header user
    const firstName = (state.user.nome || '').split(' ')[0] || state.profile.email;
    $('header-user').textContent = firstName;

    // load categorias once
    const cats = await api.listCategorias();
    if (cats.ok) state.categorias = cats.categorias;

    // load responsáveis
    await refreshResponsaveis();

    // load cartão
    await refreshCartao();

    // setup filters (mes/ano)
    setupFilters();

    // initial view
    switchView(state.currentView);
  }

  async function refreshResponsaveis() {
    const r = await api.listResponsaveis();
    if (r.ok) state.responsaveis = r.responsaveis;
  }

  async function refreshCartao() {
    const r = await api.getCartao();
    if (r.ok) state.cartao = r.cartao;
  }

  /* ============================================================
     FILTERS (mes / ano)
     ============================================================ */
  function setupFilters() {
    const fMes = $('filter-mes');
    const fAno = $('filter-ano');
    fMes.innerHTML = MES_NOMES.map((n, i) =>
      `<option value="${i + 1}" ${(i + 1) === state.filters.mes ? 'selected' : ''}>${n}</option>`
    ).join('');
    const anoAtual = new Date().getFullYear();
    const anos = [];
    for (let y = anoAtual - 2; y <= anoAtual + 1; y++) anos.push(y);
    fAno.innerHTML = anos.map(y =>
      `<option value="${y}" ${y === state.filters.ano ? 'selected' : ''}>${y}</option>`
    ).join('');
    fMes.addEventListener('change', () => { state.filters.mes = parseInt(fMes.value, 10); reloadCurrentView(); });
    fAno.addEventListener('change', () => { state.filters.ano = parseInt(fAno.value, 10); reloadCurrentView(); });
  }

  function reloadCurrentView() {
    if (state.currentView === 'dashboard') loadDashboard();
    if (state.currentView === 'receitas') loadReceitas();
    if (state.currentView === 'despesas') loadDespesas();
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  function switchView(name) {
    state.currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('view-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));

    if (name === 'dashboard') loadDashboard();
    if (name === 'receitas') loadReceitas();
    if (name === 'despesas') loadDespesas();
    if (name === 'cartao')   loadCartaoView();
    if (name === 'config')   renderConfig();
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */
  async function loadDashboard() {
    showLoader();
    const r = await api.dashboard({ mes: state.filters.mes, ano: state.filters.ano });
    hideLoader();
    if (!r.ok) {
      toast('Erro ao carregar dashboard', 'neg');
      return;
    }
    renderDashboard(r);
  }

  function renderDashboard(d) {
    // Saldo
    const saldoEl = $('saldo-atual');
    saldoEl.textContent = brl(d.saldo_atual);
    saldoEl.classList.toggle('neg', d.saldo_atual < 0);
    $('saldo-inicial-info').textContent = 'saldo inicial: ' + brl(d.user.saldo_inicial);

    // Receitas
    $('receitas-total').textContent = brl(d.receitas.total_mes);
    renderDoughnutChart('chart-receitas-categoria', d.receitas.por_categoria);
    renderBarChart('chart-receitas-mensal', d.receitas.mensal, cssvar('--money-pos'));

    // Despesas
    $('despesas-total').textContent = brl(d.despesas.total_mes);
    renderDoughnutChart('chart-despesas-categoria', d.despesas.por_categoria);
    renderStackedBarChart('chart-despesas-mensal', d.despesas.mensal_empilhada);

    // Cartão
    if (d.cartao.has_cartao) {
      $('cartao-empty').classList.add('hidden');
      $('cartao-summary').classList.remove('hidden');
      $('cartao-total-mes').textContent = brl(d.cartao.total_mes);
      renderBarChart('chart-cartao-proximos',
        d.cartao.proximos_12_meses.map(p => ({ mes_label: p.mes_label, total: p.total })),
        cssvar('--accent-fill'));
      renderDoughnutChart('chart-cartao-categoria', d.cartao.por_categoria);
      renderDoughnutChart('chart-cartao-responsavel', d.cartao.por_responsavel);
    } else {
      $('cartao-empty').classList.remove('hidden');
      $('cartao-summary').classList.add('hidden');
    }
  }

  /* ============================================================
     CHARTS
     ============================================================ */
  function chartCommonOptions() {
    const textColor = cssvar('--text-secondary');
    const gridColor = 'rgba(255,255,255,0.04)';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: textColor, font: { size: 11 }, boxWidth: 10, padding: 10 } },
        tooltip: {
          backgroundColor: '#1A0F40', titleColor: '#F0E8FF', bodyColor: '#F0E8FF',
          borderColor: cssvar('--border-strong'), borderWidth: 1, padding: 10,
          callbacks: { label: ctx => ' ' + brl(ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed) }
        }
      }
    };
  }

  function renderDoughnutChart(canvasId, items) {
    destroyChart(canvasId);
    if (!items || items.length === 0) {
      const c = $(canvasId);
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      return;
    }
    const ctx = $(canvasId).getContext('2d');
    state.charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: items.map(i => i.categoria),
        datasets: [{
          data: items.map(i => i.total),
          backgroundColor: items.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          borderWidth: 0
        }]
      },
      options: {
        ...chartCommonOptions(),
        cutout: '62%'
      }
    });
  }

  function renderBarChart(canvasId, items, color) {
    destroyChart(canvasId);
    if (!items || items.length === 0) return;
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'bar',
      data: {
        labels: items.map(i => shortMonthLabel(i.mes_label)),
        datasets: [{
          data: items.map(i => i.total),
          backgroundColor: color,
          borderRadius: 6,
          maxBarThickness: 28
        }]
      },
      options: {
        ...chartCommonOptions(),
        plugins: { ...chartCommonOptions().plugins, legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: textColor, font: { size: 10 }, callback: v => brl(v).replace('R$', '').trim() }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  function renderStackedBarChart(canvasId, items) {
    destroyChart(canvasId);
    if (!items || items.length === 0) return;
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'bar',
      data: {
        labels: items.map(i => shortMonthLabel(i.mes_label)),
        datasets: [
          { label: 'Gerais', data: items.map(i => i.geral), backgroundColor: cssvar('--money-neg'), borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 }, maxBarThickness: 28 },
          { label: 'Cartão', data: items.map(i => i.cartao), backgroundColor: cssvar('--accent-fill'), borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 }, maxBarThickness: 28 }
        ]
      },
      options: {
        ...chartCommonOptions(),
        scales: {
          x: { stacked: true, ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, ticks: { color: textColor, font: { size: 10 }, callback: v => brl(v).replace('R$', '').trim() }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  function shortMonthLabel(yyyymm) {
    const [y, m] = String(yyyymm).split('-');
    return MES_NOMES[parseInt(m, 10) - 1] + '/' + String(y).slice(-2);
  }

  /* ============================================================
     RECEITAS
     ============================================================ */
  async function loadReceitas() {
    showLoader();
    const r = await api.listReceitas({ mes: state.filters.mes, ano: state.filters.ano });
    hideLoader();
    if (!r.ok) { toast('Erro ao carregar receitas', 'neg'); return; }
    renderReceitasTable(r.receitas);
  }

  function renderReceitasTable(receitas) {
    const tbody = $('table-receitas').querySelector('tbody');
    if (!receitas || receitas.length === 0) {
      tbody.innerHTML = '';
      $('empty-receitas').classList.remove('hidden');
      return;
    }
    $('empty-receitas').classList.add('hidden');
    tbody.innerHTML = receitas.map(r => `
      <tr>
        <td>${formatDate(r.data)}</td>
        <td>${escapeHtml(r.descricao)}${r.origem === 'recorrencia' ? ' <i class="ti ti-repeat" title="Recorrente" style="color:var(--text-tertiary);font-size:13px;vertical-align:middle;"></i>' : ''}</td>
        <td><span class="badge-cat">${escapeHtml(r.categoria)}</span></td>
        <td class="num money-pos">${brl(r.valor)}</td>
        <td class="actions">
          <button class="btn-icon-trash" data-action="del-receita" data-id="${r.id}" data-ref="${r.ref_recorrencia || ''}" aria-label="Excluir">
            <i class="ti ti-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="del-receita"]').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteReceita(btn.dataset.id, btn.dataset.ref));
    });
  }

  function showAddReceitaModal() {
    const cats = state.categorias.filter(c => c.tipo === 'receita');
    showModal(`
      <h2>Nova receita</h2>
      <p class="modal-sub">Registre uma entrada de dinheiro</p>
      <form id="form-receita" class="form-stack">
        <label>
          <span>Descrição</span>
          <input type="text" name="descricao" required placeholder="Ex: Salário de maio" />
        </label>
        <div class="row-2">
          <label>
            <span>Valor (R$)</span>
            <input type="number" name="valor" min="0.01" step="0.01" required inputmode="decimal" />
          </label>
          <label>
            <span>Data</span>
            <input type="date" name="data" value="${todayISO()}" required />
          </label>
        </div>
        <label>
          <span>Categoria</span>
          <select name="categoria" required>
            ${cats.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join('')}
          </select>
        </label>
        <label class="checkbox-line">
          <input type="checkbox" name="recorrente" id="rec-recorrente" />
          <span>Repete todo mês (ex: salário)</span>
        </label>
        <label id="rec-dia-wrap" style="display:none;">
          <span>Dia do mês</span>
          <input type="number" name="dia_do_mes" min="1" max="28" placeholder="1" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-plus"></i><span>Adicionar</span>
          </button>
        </div>
      </form>
    `);
    $('rec-recorrente').addEventListener('change', e => {
      $('rec-dia-wrap').style.display = e.target.checked ? '' : 'none';
    });
    $('form-receita').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const recorrente = fd.get('recorrente') === 'on';
      showLoader();
      const r = await api.addReceita({
        descricao: fd.get('descricao'),
        valor: parseFloat(fd.get('valor')),
        data: fd.get('data'),
        categoria: fd.get('categoria'),
        recorrente,
        dia_do_mes: recorrente ? parseInt(fd.get('dia_do_mes'), 10) : null
      });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Receita registrada 🛸', 'pos');
      closeModal();
      loadReceitas();
    });
  }

  function confirmDeleteReceita(id, ref) {
    const temRef = !!ref;
    showModal(`
      <h2>Apagar receita?</h2>
      <p class="modal-sub">Essa ação não pode ser desfeita.</p>
      ${temRef ? `
        <label class="checkbox-line" style="margin-top:8px;">
          <input type="checkbox" id="del-also-rec" />
          <span>Apagar também o modelo recorrente (não vai mais gerar nos próximos meses)</span>
        </label>
      ` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
        <button class="btn btn-danger" id="btn-confirm-del">
          <i class="ti ti-trash"></i><span>Apagar</span>
        </button>
      </div>
    `);
    $('btn-confirm-del').addEventListener('click', async () => {
      const deleteRec = temRef && $('del-also-rec').checked;
      showLoader();
      const r = await api.deleteReceita({ id, delete_recurring: deleteRec });
      hideLoader();
      if (!r.ok) { toast('Erro ao apagar', 'neg'); return; }
      toast('Receita apagada', 'pos');
      closeModal();
      loadReceitas();
    });
  }

  /* ============================================================
     DESPESAS
     ============================================================ */
  async function loadDespesas() {
    showLoader();
    const r = await api.listDespesas({ mes: state.filters.mes, ano: state.filters.ano });
    hideLoader();
    if (!r.ok) { toast('Erro ao carregar despesas', 'neg'); return; }
    renderDespesasTable(r.despesas);
  }

  function renderDespesasTable(despesas) {
    const tbody = $('table-despesas').querySelector('tbody');
    if (!despesas || despesas.length === 0) {
      tbody.innerHTML = '';
      $('empty-despesas').classList.remove('hidden');
      return;
    }
    $('empty-despesas').classList.add('hidden');
    tbody.innerHTML = despesas.map(d => `
      <tr>
        <td>${formatDate(d.data)}</td>
        <td>${escapeHtml(d.descricao)}${d.origem === 'recorrencia' ? ' <i class="ti ti-repeat" title="Recorrente" style="color:var(--text-tertiary);font-size:13px;vertical-align:middle;"></i>' : ''}</td>
        <td><span class="badge-cat">${escapeHtml(d.categoria)}</span></td>
        <td class="num money-neg">${brl(d.valor)}</td>
        <td class="actions">
          <button class="btn-icon-trash" data-action="del-despesa" data-id="${d.id}" data-ref="${d.ref_recorrencia || ''}" aria-label="Excluir">
            <i class="ti ti-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="del-despesa"]').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteDespesa(btn.dataset.id, btn.dataset.ref));
    });
  }

  function showAddDespesaModal() {
    const cats = state.categorias.filter(c => c.tipo === 'despesa');
    showModal(`
      <h2>Nova despesa</h2>
      <p class="modal-sub">Registre uma saída de dinheiro</p>
      <form id="form-despesa" class="form-stack">
        <label>
          <span>Descrição</span>
          <input type="text" name="descricao" required placeholder="Ex: Supermercado" />
        </label>
        <div class="row-2">
          <label>
            <span>Valor (R$)</span>
            <input type="number" name="valor" min="0.01" step="0.01" required inputmode="decimal" />
          </label>
          <label>
            <span>Data</span>
            <input type="date" name="data" value="${todayISO()}" required />
          </label>
        </div>
        <label>
          <span>Categoria</span>
          <select name="categoria" required>
            ${cats.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join('')}
          </select>
        </label>
        <div class="row-2">
          <label>
            <span>Status</span>
            <select name="status">
              <option value="pago">Pago</option>
              <option value="pendente">Pendente</option>
            </select>
          </label>
          <label>
            <span>Forma de pagamento</span>
            <input type="text" name="forma_pagamento" placeholder="PIX, dinheiro..." />
          </label>
        </div>
        <label>
          <span>Responsável (opcional)</span>
          <select name="responsavel_id">
            <option value="">— sem responsável (eu mesmo)</option>
            ${state.responsaveis.map(r => `<option value="${r.id}">${escapeHtml(r.nome)}</option>`).join('')}
          </select>
        </label>
        <label class="checkbox-line">
          <input type="checkbox" name="recorrente" id="desp-recorrente" />
          <span>Repete todo mês (ex: aluguel, Netflix)</span>
        </label>
        <label id="desp-dia-wrap" style="display:none;">
          <span>Dia do mês</span>
          <input type="number" name="dia_do_mes" min="1" max="28" placeholder="5" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-plus"></i><span>Adicionar</span>
          </button>
        </div>
      </form>
    `);
    $('desp-recorrente').addEventListener('change', e => {
      $('desp-dia-wrap').style.display = e.target.checked ? '' : 'none';
    });
    $('form-despesa').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const recorrente = fd.get('recorrente') === 'on';
      showLoader();
      const r = await api.addDespesa({
        descricao: fd.get('descricao'),
        valor: parseFloat(fd.get('valor')),
        data: fd.get('data'),
        categoria: fd.get('categoria'),
        status: fd.get('status'),
        forma_pagamento: fd.get('forma_pagamento') || '',
        responsavel_id: fd.get('responsavel_id') || null,
        recorrente,
        dia_do_mes: recorrente ? parseInt(fd.get('dia_do_mes'), 10) : null
      });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Despesa registrada', 'pos');
      closeModal();
      loadDespesas();
    });
  }

  function confirmDeleteDespesa(id, ref) {
    const temRef = !!ref;
    showModal(`
      <h2>Apagar despesa?</h2>
      <p class="modal-sub">Essa ação não pode ser desfeita.</p>
      ${temRef ? `
        <label class="checkbox-line" style="margin-top:8px;">
          <input type="checkbox" id="del-also-rec" />
          <span>Apagar também o modelo recorrente</span>
        </label>
      ` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
        <button class="btn btn-danger" id="btn-confirm-del">
          <i class="ti ti-trash"></i><span>Apagar</span>
        </button>
      </div>
    `);
    $('btn-confirm-del').addEventListener('click', async () => {
      const deleteRec = temRef && $('del-also-rec').checked;
      showLoader();
      const r = await api.deleteDespesa({ id, delete_recurring: deleteRec });
      hideLoader();
      if (!r.ok) { toast('Erro ao apagar', 'neg'); return; }
      toast('Despesa apagada', 'pos');
      closeModal();
      loadDespesas();
    });
  }

  /* ============================================================
     CARTÃO
     ============================================================ */
  async function loadCartaoView() {
    showLoader();
    await refreshCartao();
    await refreshResponsaveis();
    hideLoader();
    renderCartaoView();
  }

  function renderCartaoView() {
    if (!state.cartao) {
      $('cartao-setup').classList.remove('hidden');
      $('cartao-view').classList.add('hidden');
      $('btn-add-compra').classList.add('hidden');
      attachCartaoFormHandler();
      return;
    }
    $('cartao-setup').classList.add('hidden');
    $('cartao-view').classList.remove('hidden');
    $('btn-add-compra').classList.remove('hidden');

    $('cartao-apelido').textContent = state.cartao.apelido;
    $('cartao-bandeira').textContent = state.cartao.bandeira || '';
    $('cartao-limite').textContent = brl(state.cartao.limite);
    $('cartao-fechamento').textContent = 'dia ' + state.cartao.dia_fechamento;
    $('cartao-vencimento').textContent = 'dia ' + state.cartao.dia_vencimento;

    renderResponsaveisChips();
    loadCompras();
  }

  function attachCartaoFormHandler() {
    const form = $('form-cartao');
    if (form.dataset.attached) return;
    form.dataset.attached = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      showLoader();
      const r = await api.saveCartao({
        apelido: fd.get('apelido'),
        bandeira: fd.get('bandeira'),
        limite: parseFloat(fd.get('limite')),
        dia_fechamento: parseInt(fd.get('dia_fechamento'), 10),
        dia_vencimento: parseInt(fd.get('dia_vencimento'), 10)
      });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Cartão salvo! 🛸', 'pos');
      await refreshCartao();
      await refreshResponsaveis();
      renderCartaoView();
    });
  }

  function renderResponsaveisChips() {
    const container = $('responsaveis-list');
    if (state.responsaveis.length === 0) {
      container.innerHTML = '<span class="muted">Nenhum ainda.</span>';
      return;
    }
    // O primeiro responsável é o "Eu" (não pode ser excluído)
    const sorted = state.responsaveis.slice();
    container.innerHTML = sorted.map((r, idx) => `
      <span class="chip ${idx === 0 ? 'chip-locked' : ''}">
        ${escapeHtml(r.nome)}
        ${idx === 0 ? '' : `<button class="chip-remove" data-id="${r.id}" aria-label="Remover">×</button>`}
      </span>
    `).join('');
    container.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteResponsavel(btn.dataset.id));
    });
  }

  function showAddResponsavelModal() {
    if (state.responsaveis.length >= 2) {
      toast('Limite de 2 responsáveis por cartão', 'neg');
      return;
    }
    showModal(`
      <h2>Adicionar responsável</h2>
      <p class="modal-sub">Quem mais usa esse cartão?</p>
      <form id="form-resp" class="form-stack">
        <label>
          <span>Nome</span>
          <input type="text" name="nome" required placeholder="Ex: Joana" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-plus"></i><span>Adicionar</span>
          </button>
        </div>
      </form>
    `);
    $('form-resp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = new FormData(e.target).get('nome');
      showLoader();
      const r = await api.addResponsavel({ nome });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Responsável adicionado', 'pos');
      closeModal();
      await refreshResponsaveis();
      renderResponsaveisChips();
    });
  }

  function confirmDeleteResponsavel(id) {
    showModal(`
      <h2>Remover responsável?</h2>
      <p class="modal-sub">As compras já registradas em nome dessa pessoa continuarão na planilha, mas ficarão sem responsável.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
        <button class="btn btn-danger" id="btn-confirm-del">
          <i class="ti ti-trash"></i><span>Remover</span>
        </button>
      </div>
    `);
    $('btn-confirm-del').addEventListener('click', async () => {
      showLoader();
      const r = await api.deleteResponsavel({ id });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Responsável removido', 'pos');
      closeModal();
      await refreshResponsaveis();
      renderResponsaveisChips();
    });
  }

  function showEditCartaoModal() {
    const c = state.cartao;
    showModal(`
      <h2>Editar cartão</h2>
      <p class="modal-sub">Atualize os dados do seu cartão</p>
      <form id="form-edit-cartao" class="form-stack">
        <label>
          <span>Apelido</span>
          <input type="text" name="apelido" required value="${escapeHtml(c.apelido)}" />
        </label>
        <label>
          <span>Bandeira</span>
          <input type="text" name="bandeira" value="${escapeHtml(c.bandeira)}" />
        </label>
        <label>
          <span>Limite (R$)</span>
          <input type="number" name="limite" min="0" step="0.01" required value="${c.limite}" />
        </label>
        <div class="row-2">
          <label>
            <span>Fechamento</span>
            <input type="number" name="dia_fechamento" min="1" max="31" required value="${c.dia_fechamento}" />
          </label>
          <label>
            <span>Vencimento</span>
            <input type="number" name="dia_vencimento" min="1" max="31" required value="${c.dia_vencimento}" />
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-device-floppy"></i><span>Salvar</span>
          </button>
        </div>
      </form>
    `);
    $('form-edit-cartao').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      showLoader();
      const r = await api.saveCartao({
        apelido: fd.get('apelido'),
        bandeira: fd.get('bandeira'),
        limite: parseFloat(fd.get('limite')),
        dia_fechamento: parseInt(fd.get('dia_fechamento'), 10),
        dia_vencimento: parseInt(fd.get('dia_vencimento'), 10)
      });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Cartão atualizado', 'pos');
      closeModal();
      await refreshCartao();
      renderCartaoView();
    });
  }

  async function loadCompras() {
    const r = await api.listComprasCartao();
    if (!r.ok) return;
    renderComprasTable(r.compras);
  }

  function renderComprasTable(compras) {
    const tbody = $('table-compras').querySelector('tbody');
    if (!compras || compras.length === 0) {
      tbody.innerHTML = '';
      $('empty-compras').classList.remove('hidden');
      return;
    }
    $('empty-compras').classList.add('hidden');
    const respMap = {};
    state.responsaveis.forEach(r => { respMap[r.id] = r.nome; });
    tbody.innerHTML = compras.map(c => `
      <tr>
        <td>${formatDate(c.data_compra)}</td>
        <td>${escapeHtml(c.descricao)}</td>
        <td><span class="badge-cat">${escapeHtml(respMap[c.responsavel_id] || '—')}</span></td>
        <td class="num money-neg">${brl(c.valor_total)}</td>
        <td class="num">${c.parcelas}x</td>
        <td class="actions">
          <button class="btn-icon-trash" data-action="del-compra" data-id="${c.id}" aria-label="Excluir">
            <i class="ti ti-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="del-compra"]').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteCompra(btn.dataset.id));
    });
  }

  function showAddCompraModal() {
    if (!state.cartao) { toast('Cadastre um cartão primeiro', 'neg'); return; }
    showModal(`
      <h2>Nova compra no cartão</h2>
      <p class="modal-sub">Registre uma compra em ${escapeHtml(state.cartao.apelido)}</p>
      <form id="form-compra" class="form-stack">
        <label>
          <span>Descrição</span>
          <input type="text" name="descricao" required placeholder="Ex: Tênis novo" />
        </label>
        <div class="row-2">
          <label>
            <span>Valor total (R$)</span>
            <input type="number" name="valor_total" min="0.01" step="0.01" required inputmode="decimal" />
          </label>
          <label>
            <span>Data da compra</span>
            <input type="date" name="data_compra" value="${todayISO()}" required />
          </label>
        </div>
        <div class="row-2">
          <label>
            <span>Parcelas</span>
            <input type="number" name="parcelas" min="1" max="60" value="1" required />
          </label>
          <label>
            <span>Categoria</span>
            <select name="categoria" required>
              ${state.categorias.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label>
          <span>Responsável</span>
          <select name="responsavel_id" required>
            ${state.responsaveis.map(r => `<option value="${r.id}">${escapeHtml(r.nome)}</option>`).join('')}
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-plus"></i><span>Adicionar</span>
          </button>
        </div>
      </form>
    `);
    $('form-compra').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      showLoader();
      const r = await api.addCompraCartao({
        descricao: fd.get('descricao'),
        valor_total: parseFloat(fd.get('valor_total')),
        data_compra: fd.get('data_compra'),
        categoria: fd.get('categoria'),
        parcelas: parseInt(fd.get('parcelas'), 10),
        responsavel_id: fd.get('responsavel_id')
      });
      hideLoader();
      if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
      toast('Compra registrada 💳', 'pos');
      closeModal();
      loadCompras();
    });
  }

  function confirmDeleteCompra(id) {
    showModal(`
      <h2>Apagar compra?</h2>
      <p class="modal-sub">Vai remover a compra e todas as parcelas. Essa ação não pode ser desfeita.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
        <button class="btn btn-danger" id="btn-confirm-del">
          <i class="ti ti-trash"></i><span>Apagar</span>
        </button>
      </div>
    `);
    $('btn-confirm-del').addEventListener('click', async () => {
      showLoader();
      const r = await api.deleteCompraCartao({ id });
      hideLoader();
      if (!r.ok) { toast('Erro ao apagar', 'neg'); return; }
      toast('Compra apagada', 'pos');
      closeModal();
      loadCompras();
    });
  }

  /* ============================================================
     CONFIG
     ============================================================ */
  function renderConfig() {
    renderMascoteGrid($('mascote-grid-config'), state.user.mascote_escolhido, async (m) => {
      applyMascoteTheme(m);
      showLoader();
      const r = await api.updateUser({ mascote_escolhido: m });
      hideLoader();
      if (r.ok) {
        state.user = r.user;
        toast('Mascote atualizado 🛸', 'pos');
      } else {
        toast('Erro ao atualizar', 'neg');
      }
    });
    $('config-saldo').value = state.user.saldo_inicial;
    $('config-user-info').textContent = state.user.email + ' · cadastrado em ' + formatDate(state.user.data_cadastro);
  }

  async function saveSaldoInicial() {
    const v = parseFloat($('config-saldo').value);
    if (isNaN(v) || v < 0) { toast('Saldo inválido', 'neg'); return; }
    showLoader();
    const r = await api.updateUser({ saldo_inicial: v });
    hideLoader();
    if (!r.ok) { toast('Erro: ' + (r.error || 'desconhecido'), 'neg'); return; }
    state.user = r.user;
    toast('Saldo inicial atualizado', 'pos');
  }

  /* ============================================================
     MODAL
     ============================================================ */
  function showModal(html) {
    $('modal-content').innerHTML = html;
    $('modal-overlay').classList.remove('hidden');
    $('modal-content').querySelectorAll('[data-action="close-modal"]').forEach(btn => {
      btn.addEventListener('click', closeModal);
    });
  }

  function closeModal() {
    $('modal-overlay').classList.add('hidden');
    $('modal-content').innerHTML = '';
  }

  /* ============================================================
     INIT — wire up event listeners
     ============================================================ */
  function init() {
    generateStars(90);
    initGoogleSignIn();
    setupOnboardingHandlers();

    // Logout
    $('logout-btn').addEventListener('click', logout);

    // Bottom nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Add buttons
    $('btn-add-receita').addEventListener('click', showAddReceitaModal);
    $('btn-add-despesa').addEventListener('click', showAddDespesaModal);
    $('btn-add-compra').addEventListener('click', showAddCompraModal);
    $('btn-add-responsavel').addEventListener('click', showAddResponsavelModal);
    $('btn-edit-cartao').addEventListener('click', showEditCartaoModal);

    // Config
    $('btn-save-saldo').addEventListener('click', saveSaldoInicial);

    // Modal: clicar fora fecha
    $('modal-overlay').addEventListener('click', (e) => {
      if (e.target === $('modal-overlay')) closeModal();
    });
    // Esc fecha
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('modal-overlay').classList.contains('hidden')) closeModal();
    });
  }

  init();
})();
