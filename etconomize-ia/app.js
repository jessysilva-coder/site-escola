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
    // Filtros independentes por view — mudar um não afeta os outros
    viewFilters: {
      dashboard: { mes: new Date().getMonth() + 1, ano: new Date().getFullYear() },
      receitas:  { mes: null, ano: new Date().getFullYear() },
      despesas:  { mes: null, ano: new Date().getFullYear() },
      cartao:    { mes: null, ano: new Date().getFullYear() }
    },
    onboarding: { mascote: null },
    charts: {}
  };

  // Compat shim: alguns trechos antigos liam state.filters
  Object.defineProperty(state, 'filters', {
    get() { return state.viewFilters[state.currentView] || { mes: null, ano: null }; }
  });

  /* ============================================================
     HELPERS
     ============================================================ */
  const $ = id => document.getElementById(id);

  function brl(v) {
    return (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function labelNumber(v) {
    return Math.round(parseFloat(v) || 0).toLocaleString('pt-BR');
  }


  function monthKeyFromDate(dateStr) {
    const d = parseLocalDate(dateStr);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function isWithinCurrentFilters(dateStr) {
    const d = parseLocalDate(dateStr);
    if (!d) return false;
    if (state.filters.ano != null && d.getFullYear() !== state.filters.ano) return false;
    if (state.filters.mes != null && (d.getMonth() + 1) !== state.filters.mes) return false;
    return true;
  }

  function isRecurringItem(item) {
    return item?.origem === 'recorrencia' || item?.recorrente === true || item?.recorrente === 'true' || !!item?.ref_recorrencia || !!item?.dia_do_mes;
  }

  function compraValorParcela(compra) {
    const valorParcela = parseFloat(compra?.valor_parcela);
    if (!Number.isNaN(valorParcela) && valorParcela > 0) return valorParcela;
    const valorTotal = parseFloat(compra?.valor_total) || 0;
    const parcelas = Math.max(parseInt(compra?.parcelas, 10) || 1, 1);
    return valorTotal / parcelas;
  }

  function aggregateByKey(items, keyGetter, valueGetter) {
    return items.reduce((acc, item) => {
      const key = keyGetter(item);
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + (valueGetter(item) || 0);
      return acc;
    }, {});
  }

  /* ------------------------------------------------------------
     Projeção de recorrências em meses futuros
     Pra cada ref_recorrencia, identifica a última ocorrência
     existente (qualquer ano) e projeta no ano alvo:
     - Se a última ocorrência foi em ANO ANTERIOR ao alvo → projeta Jan-Dez do alvo
     - Se foi no MESMO ano do alvo → projeta do mês seguinte até Dez
     - Se foi em ano POSTERIOR → não projeta
     ------------------------------------------------------------ */
  function projectRecurringInYear(items, year) {
    if (year == null) return items.slice();

    const groups = {};
    items.forEach(item => {
      if (!item || !item.ref_recorrencia) return;
      const d = parseLocalDate(item.data);
      if (!d) return;
      const monthKey = monthKeyFromDate(item.data);
      const prev = groups[item.ref_recorrencia];
      if (!prev || prev._monthKey < monthKey) {
        groups[item.ref_recorrencia] = {
          ...item,
          _monthKey: monthKey,
          _lastYear: d.getFullYear(),
          _lastMonth: d.getMonth() + 1,
          _day: d.getDate()
        };
      }
    });

    const projected = [];
    Object.values(groups).forEach(g => {
      const dia = Math.min(g._day || 1, 28);
      let startMonth;
      if (g._lastYear < year) {
        startMonth = 1; // última no passado → ano todo
      } else if (g._lastYear === year) {
        startMonth = g._lastMonth + 1; // próximo mês até Dez
      } else {
        return; // última no futuro → ignora
      }
      for (let m = startMonth; m <= 12; m++) {
        const mm = String(m).padStart(2, '0');
        const dd = String(dia).padStart(2, '0');
        projected.push({
          ...g,
          id: `${g.id}-proj-${year}-${m}`,
          data: `${year}-${mm}-${dd}`,
          origem: 'recorrencia',
          is_projected: true,
          _monthKey: undefined,
          _lastYear: undefined,
          _lastMonth: undefined,
          _day: undefined
        });
      }
    });

    return [...items, ...projected];
  }

  /* ------------------------------------------------------------
     Constrói série mensal Jan-Dez do ano alvo (com projeção de
     recorrências em meses futuros), ou todos os meses se year=null
     ------------------------------------------------------------ */
  function buildMonthlySeries(items, year, valueGetter = i => parseFloat(i.valor) || 0) {
    const projected = projectRecurringInYear(items || [], year);
    const totals = {};
    projected.forEach(it => {
      const d = parseLocalDate(it.data);
      if (!d) return;
      if (year != null && d.getFullYear() !== year) return;
      const key = monthKeyFromDate(it.data);
      totals[key] = (totals[key] || 0) + valueGetter(it);
    });

    if (year != null) {
      const out = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, '0')}`;
        out.push({ mes_label: key, total: totals[key] || 0 });
      }
      return out;
    }
    return Object.keys(totals).sort().map(k => ({ mes_label: k, total: totals[k] }));
  }

  /* ------------------------------------------------------------
     Constrói matriz mensal por chave (ex: por responsável)
     ------------------------------------------------------------ */
  function buildMonthlySeriesByGroup(items, year, groupGetter, valueGetter) {
    const projected = projectRecurringInYear(items || [], year);
    const matrix = {}; // { mes_label: { grupo: total } }
    projected.forEach(it => {
      const d = parseLocalDate(it.data);
      if (!d) return;
      if (year != null && d.getFullYear() !== year) return;
      const monthKey = monthKeyFromDate(it.data);
      const grp = groupGetter(it) || 'Sem responsável';
      if (!matrix[monthKey]) matrix[monthKey] = {};
      matrix[monthKey][grp] = (matrix[monthKey][grp] || 0) + (valueGetter(it) || 0);
    });

    let mesesOrdenados;
    if (year != null) {
      mesesOrdenados = [];
      for (let m = 1; m <= 12; m++) mesesOrdenados.push(`${year}-${String(m).padStart(2, '0')}`);
    } else {
      mesesOrdenados = Object.keys(matrix).sort();
    }
    return { meses: mesesOrdenados, matrix };
  }

  function formatDate(s) {
    const d = parseLocalDate(s);
    if (!d) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  /* Parseia "YYYY-MM-DD" como data LOCAL, não UTC.
     Evita o bug clássico onde new Date("2026-05-01") vira "2026-04-30 21:00" em BR. */
  function parseLocalDate(s) {
    if (s == null || s === '') return null;
    if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
    const str = String(s);
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /* Garante que a data enviada pro backend não vá pra "ontem" por causa de timezone.
     Recebe "YYYY-MM-DD" do input[type=date] e retorna "YYYY-MM-DDT12:00:00". */
  function safeDateForBackend(formDate) {
    if (!formDate || typeof formDate !== 'string') return formDate;
    return /^\d{4}-\d{2}-\d{2}$/.test(formDate) ? (formDate + 'T12:00:00') : formDate;
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
    const id = mascote || 'verde';
    document.documentElement.setAttribute('data-mascote', id);
    syncMascoteMedia(id);
  }

  function syncMascoteMedia(mascote) {
    const id = mascote || 'verde';
    document.querySelectorAll('.js-mascote-img').forEach(img => {
      img.src = `./${id}.png`;
      img.alt = `Mascote ${id}`;
    });
  }

  function selectedMascoteName() {
    const id = (state.user && state.user.mascote_escolhido) || state.onboarding.mascote || 'verde';
    const found = MASCOTES_DATA.find(m => m.id === id);
    return found ? found.nome : 'Mascote';
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

  const LOADER_PHRASES = [
    'Transmitindo dados para a central de controle do seu orçamento.',
    'Os ETs estão somando, subtraindo e tentando não multiplicar seus boletos.',
    'Abduzindo despesas suspeitas… nenhuma fatura escapará.',
    'Carregando… porque até alienígena precisa fechar a conta.',
    'Processando números… sem deixar o saldo ser levado por outra galáxia.',
    'Aguarde: estamos abduzindo seus gastos para análise.',
    'Atenção, terráqueo: seu orçamento está entrando em órbita.',
    'Aguarde um instante: estamos procurando vida inteligente nos seus gastos.',
    'O ET viu sua fatura e pediu mais 3 segundos para processar.',
    'Carregando… porque nem disco voador gira tão rápido quanto a fatura do seu cartão.',
    'Somando receitas, caçando despesas e fingindo que não vimos aquele delivery.',
    'O ET tentou dividir a conta… descobriu que era tudo seu mesmo.',
    'Carregando dados e afastando meteoros chamados "gastos inesperados".',
    'Conferindo se o saldo está positivo ou apenas vivendo uma fase misteriosa.',
    'Estamos carregando… respire fundo, seus boletos não vão abduzir você hoje.'
  ];

  let _loaderCount = 0;
  function showLoader() {
    _loaderCount++;
    if (_loaderCount === 1) {
      const phrase = LOADER_PHRASES[Math.floor(Math.random() * LOADER_PHRASES.length)];
      const phraseEl = $('loader-phrase');
      if (phraseEl) phraseEl.textContent = phrase;
      // garante que o mascote do loader é o do user logado
      if (state.user && state.user.mascote_escolhido) {
        syncMascoteMedia(state.user.mascote_escolhido);
      }
      $('loader').classList.remove('hidden');
    }
  }
  function hideLoader() {
    _loaderCount = Math.max(0, _loaderCount - 1);
    if (_loaderCount === 0) {
      $('loader').classList.add('hidden');
    }
  }

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
    } else if (res.registration_open === false) {
      // Cadastros encerrados — mostra tela amigável (não passa pelo onboarding)
      showRegistrationClosedScreen();
    } else {
      state.onboarding.mascote = null;
      showOnboarding();
    }
  }

  function showRegistrationClosedScreen() {
    $('screen-auth').classList.add('hidden');
    $('screen-onboarding').classList.add('hidden');
    $('app-container').classList.add('hidden');
    $('screen-registration-closed').classList.remove('hidden');
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
        if (res.error === 'registration_closed') {
          showRegistrationClosedScreen();
          return;
        }
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
    applyMascoteTheme(state.user.mascote_escolhido);

    // header user
    const firstName = (state.user.nome || '').split(' ')[0] || state.profile.email;
    $('header-user').textContent = firstName;

    showLoader();
    try {
      // load categorias once
      const cats = await api.listCategorias();
      if (cats.ok) state.categorias = cats.categorias;

      // load responsáveis
      await refreshResponsaveis();

      // load cartão
      await refreshCartao();

      // setup filters (mes/ano)
      setupFilters();

      // initial view (loadDashboard tem seu próprio show/hide, o contador segura)
      switchView(state.currentView);
    } finally {
      hideLoader();
    }
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
     FILTERS (mes / ano) — independentes por view
     ============================================================ */
  const FILTER_VIEW_IDS = {
    dashboard: { mes: 'filter-mes', ano: 'filter-ano' },
    receitas:  { mes: 'filter-mes-receitas', ano: 'filter-ano-receitas' },
    despesas:  { mes: 'filter-mes-despesas', ano: 'filter-ano-despesas' },
    cartao:    { mes: 'filter-mes-cartao',   ano: 'filter-ano-cartao' }
  };

  function setupFilters() {
    Object.keys(FILTER_VIEW_IDS).forEach(setupOneViewFilters);
  }

  function setupOneViewFilters(viewName) {
    const ids = FILTER_VIEW_IDS[viewName];
    if (!ids) return;
    const fMes = ids.mes ? $(ids.mes) : null;
    const fAno = ids.ano ? $(ids.ano) : null;

    const filtros = state.viewFilters[viewName];

    if (fMes) {
      fMes.innerHTML = [
        '<option value="all">Todos os meses</option>',
        ...MES_NOMES.map((n, i) =>
          `<option value="${i + 1}" ${(i + 1) === filtros.mes ? 'selected' : ''}>${n}</option>`
        )
      ].join('');
      if (filtros.mes == null) fMes.value = 'all';

      fMes.addEventListener('change', () => {
        state.viewFilters[viewName].mes = fMes.value === 'all' ? null : parseInt(fMes.value, 10);
        if (state.currentView === viewName) reloadCurrentView();
      });
    }

    if (fAno) {
      const anoAtual = new Date().getFullYear();
      const anos = [];
      for (let y = anoAtual - 2; y <= anoAtual + 2; y++) anos.push(y);
      fAno.innerHTML = [
        '<option value="all">Todos os anos</option>',
        ...anos.map(y =>
          `<option value="${y}" ${y === filtros.ano ? 'selected' : ''}>${y}</option>`
        )
      ].join('');
      if (filtros.ano == null) fAno.value = 'all';

      fAno.addEventListener('change', () => {
        state.viewFilters[viewName].ano = fAno.value === 'all' ? null : parseInt(fAno.value, 10);
        if (state.currentView === viewName) reloadCurrentView();
      });
    }
  }

  function currentFilterPayload() {
    const f = state.viewFilters[state.currentView] || {};
    return { mes: f.mes, ano: f.ano };
  }

  function reloadCurrentView() {
    if (state.currentView === 'dashboard') loadDashboard();
    if (state.currentView === 'receitas') loadReceitas();
    if (state.currentView === 'despesas') loadDespesas();
    if (state.currentView === 'cartao') loadCartaoView();
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  function switchView(name) {
    state.currentView = name;
    $('app-container').setAttribute('data-current-view', name);
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
  /* ============================================================
     DASHBOARD
     ============================================================ */

  /* Expande uma compra do cartão em "lançamentos virtuais" mensais.
     - Compras à vista (1x): 1 lançamento no mês da compra
     - Compras parceladas: N lançamentos, do mês da compra até mês+N-1
     - Compras recorrentes: lança em todos os meses do ano filtrado
       a partir do mês da primeira ocorrência
  */
  function expandCompraEmParcelas(compra, year) {
    const valor = compraValorParcela(compra);
    if (!compra.data_compra) return [];
    const baseDate = parseLocalDate(compra.data_compra);
    if (!baseDate) return [];

    const out = [];
    const baseYear = baseDate.getFullYear();
    const baseMonth = baseDate.getMonth() + 1;

    if (isRecurringItem(compra)) {
      // Recorrente: cada mês a partir da data base até dezembro do ano alvo
      // (cobre anos posteriores ao da compra)
      const targetYear = year != null ? year : baseYear + 2;
      let y = baseYear, m = baseMonth;
      while (y < targetYear || (y === targetYear && m <= 12)) {
        out.push({
          ...compra,
          data: `${y}-${String(m).padStart(2, '0')}-01`,
          valor: valor
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    } else {
      // Parcelada (ou 1x): de baseMonth até baseMonth + parcelas - 1
      const parcelas = Math.max(1, parseInt(compra.parcelas, 10) || 1);
      let y = baseYear, m = baseMonth;
      for (let i = 0; i < parcelas; i++) {
        out.push({
          ...compra,
          data: `${y}-${String(m).padStart(2, '0')}-01`,
          valor: valor
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
    return out;
  }

  /* Filtros aplicados a uma lista expandida (já transformada em lançamentos por mês) */
  function filterByYearMonth(items, year, month) {
    return items.filter(it => {
      const d = parseLocalDate(it.data);
      if (!d) return false;
      if (year != null && d.getFullYear() !== year) return false;
      if (month != null && (d.getMonth() + 1) !== month) return false;
      return true;
    });
  }

  async function loadDashboard() {
    showLoader();
    const filtros = state.viewFilters.dashboard;
    const ano = filtros.ano;
    const mes = filtros.mes;

    // SEM filtro de ano: precisamos do histórico todo pra projetar recorrências
    // que foram cadastradas em anos anteriores no ano alvo.
    const [receitasRes, despesasRes, comprasRes, dashRes] = await Promise.all([
      api.listReceitas({}),
      api.listDespesas({}),
      api.listComprasCartao(),
      api.dashboard({ mes, ano })
    ]);
    hideLoader();

    if (!dashRes.ok) {
      toast('Erro ao carregar dashboard', 'neg');
      return;
    }

    renderDashboard(dashRes, {
      receitasAno: receitasRes.ok ? (receitasRes.receitas || []) : [],
      despesasAno: despesasRes.ok ? (despesasRes.despesas || []) : [],
      comprasLista: comprasRes.ok ? (comprasRes.compras || []) : []
    });
  }

  function renderDashboard(d, extras = {}) {
    const filtros = state.viewFilters.dashboard;
    const ano = filtros.ano;
    const mes = filtros.mes;

    // Saldo
    const saldoEl = $('saldo-atual');
    saldoEl.textContent = brl(d.saldo_atual);
    saldoEl.classList.toggle('neg', d.saldo_atual < 0);
    $('saldo-inicial-info').textContent = 'saldo inicial: ' + brl(d.user.saldo_inicial);

    // Listas com projeção de recorrências futuras
    const receitasAno = extras.receitasAno || [];
    const despesasAno = extras.despesasAno || [];
    const comprasLista = extras.comprasLista || [];

    const receitasComProj = projectRecurringInYear(receitasAno, ano);
    const despesasComProj = projectRecurringInYear(despesasAno, ano);

    // Expande compras em lançamentos mensais (parcelas + recorrências)
    const comprasExpandidas = [];
    comprasLista.forEach(c => {
      expandCompraEmParcelas(c, ano).forEach(ce => comprasExpandidas.push(ce));
    });

    // KPIs do mês filtrado (considera projeções E parcelas)
    const receitasMesFiltrado = filterByYearMonth(receitasComProj, ano, mes);
    const despesasMesFiltrado = filterByYearMonth(despesasComProj, ano, mes);
    const comprasMesFiltrado = filterByYearMonth(comprasExpandidas, ano, mes);

    const totalReceitas = receitasMesFiltrado.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
    const totalDespesas = despesasMesFiltrado.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
    const totalCartaoMes = comprasMesFiltrado.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);

    $('receitas-total').textContent = brl(totalReceitas);
    $('despesas-total').textContent = brl(totalDespesas);

    // Gráficos "por categoria" — recalcula localmente pra refletir as projeções
    const receitasPorCat = Object.entries(aggregateByKey(
      receitasMesFiltrado, i => i.categoria || '—', i => parseFloat(i.valor) || 0
    )).map(([categoria, total]) => ({ categoria, total }));
    const despesasPorCat = Object.entries(aggregateByKey(
      despesasMesFiltrado, i => i.categoria || '—', i => parseFloat(i.valor) || 0
    )).map(([categoria, total]) => ({ categoria, total }));

    renderCategoryColumnChart('chart-receitas-categoria', receitasPorCat, 'categoria');
    renderCategoryColumnChart('chart-despesas-categoria', despesasPorCat, 'categoria');

    // Séries mensais Jan-Dez do ano selecionado
    const receitasMensal = buildMonthlySeries(receitasAno, ano);
    renderLineChart('chart-receitas-mensal', receitasMensal, 'Receitas');

    const despesasGeraisMensal = buildMonthlySeries(despesasAno, ano);
    const cartaoMensal = buildMonthlySeries(comprasExpandidas, ano);
    const despesasEmpilhada = receitasMensal.map((r, i) => ({
      mes_label: r.mes_label,
      geral: despesasGeraisMensal[i] ? despesasGeraisMensal[i].total : 0,
      cartao: cartaoMensal[i] ? cartaoMensal[i].total : 0
    }));
    renderStackedBarChart('chart-despesas-mensal', despesasEmpilhada);

    // Doughnut "Recorrente vs Não recorrente" (despesas do mês filtrado)
    const totalRecorrenteMes = despesasMesFiltrado.filter(isRecurringItem).reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
    const totalNaoRecorrenteMes = despesasMesFiltrado.filter(i => !isRecurringItem(i)).reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);
    renderDoughnutChart('chart-despesas-recorrencia', [
      { label: 'Recorrente', total: totalRecorrenteMes },
      { label: 'Não recorrente', total: totalNaoRecorrenteMes }
    ]);

    // Fluxo mensal combo bar+line (receitas/despesas barras, saldo linha)
    let runningSaldo = parseFloat(d.user.saldo_inicial) || 0;
    const fluxoMensal = receitasMensal.map((r, i) => {
      const receitas = r.total;
      const despesas = (despesasGeraisMensal[i] ? despesasGeraisMensal[i].total : 0) + (cartaoMensal[i] ? cartaoMensal[i].total : 0);
      runningSaldo += receitas - despesas;
      return { mes_label: r.mes_label, receitas, despesas, saldo: runningSaldo };
    });
    renderFluxoChart('chart-fluxo-mensal', fluxoMensal);

    // Seção cartão
    if (d.cartao && d.cartao.has_cartao) {
      $('cartao-empty').classList.add('hidden');
      $('cartao-summary').classList.remove('hidden');
      $('cartao-kpi').classList.remove('hidden');
      $('cartao-total-mes').textContent = brl(totalCartaoMes);

      // Próximos 12 meses (Jan-Dez do ano selecionado) com parcelas + recorrências
      renderLineChart('chart-cartao-proximos', cartaoMensal, 'Cartão');

      const responsavelMap = {};
      state.responsaveis.forEach(r => { responsavelMap[r.id] = r.nome; });

      // "Pagamento por responsável MÊS A MÊS" — agora soma:
      //   compras do cartão (expandidas em parcelas/recorrências)
      // + despesas com responsavel_id (com projeção de recorrências)
      const lancamentosPorResp = [];
      filterByYearMonth(comprasExpandidas, ano, null).forEach(c => {
        const nome = responsavelMap[c.responsavel_id];
        if (!nome) return;
        lancamentosPorResp.push({ data: c.data, valor: parseFloat(c.valor) || 0, _resp: nome });
      });
      filterByYearMonth(despesasComProj, ano, null).forEach(d2 => {
        const nome = responsavelMap[d2.responsavel_id];
        if (!nome) return;
        lancamentosPorResp.push({ data: d2.data, valor: parseFloat(d2.valor) || 0, _resp: nome });
      });
      const respMensal = buildMonthlySeriesByGroup(
        lancamentosPorResp,
        ano,
        item => item._resp,
        item => parseFloat(item.valor) || 0
      );
      renderResponsavelMensalChart('chart-cartao-responsavel-mensal', respMensal);

      // Análise de parcelamento — categorias originais (não expandidas)
      const comprasOriginaisFiltradas = comprasLista.filter(c => {
        const d = parseLocalDate(c.data_compra);
        if (!d) return false;
        if (ano != null && d.getFullYear() !== ano) return false;
        if (mes != null && (d.getMonth() + 1) !== mes) return false;
        return true;
      });
      const comprasParceladas = comprasOriginaisFiltradas.filter(c => !isRecurringItem(c) && (parseInt(c.parcelas, 10) || 1) > 1).length;
      const comprasVista = comprasOriginaisFiltradas.filter(c => !isRecurringItem(c) && (parseInt(c.parcelas, 10) || 1) === 1).length;
      const comprasRecorrentes = comprasOriginaisFiltradas.filter(isRecurringItem).length;
      renderDoughnutChart('chart-cartao-parcelamento', [
        { label: 'Parceladas', total: comprasParceladas },
        { label: 'À vista', total: comprasVista },
        { label: 'Recorrentes', total: comprasRecorrentes }
      ]);
    } else {
      $('cartao-empty').classList.remove('hidden');
      $('cartao-summary').classList.add('hidden');
      $('cartao-kpi').classList.add('hidden');
      ['chart-cartao-proximos', 'chart-cartao-responsavel-mensal', 'chart-cartao-parcelamento'].forEach(clearChart);
    }
  }

  /* ============================================================
     CHARTS
     ============================================================ */
  const valueLabelsPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = cssvar('--text-primary');
      ctx.font = "600 11px 'JetBrains Mono', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        meta.data.forEach((element, index) => {
          const rawValue = dataset.data[index];
          const value = typeof rawValue === 'object'
            ? (rawValue.y ?? rawValue.x ?? 0)
            : rawValue;
          if (!value) return;
          const label = labelNumber(value);
          const pos = element.tooltipPosition();

          if (chart.config.type === 'bar' && chart.options.indexAxis === 'y') {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, pos.x + 8, pos.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, pos.x, pos.y - 8);
          }
        });
      });
      ctx.restore();
    }
  };

  if (window.Chart && !Chart.registry.plugins.get('valueLabels')) {
    Chart.register(valueLabelsPlugin);
  }

  function parsedChartValue(ctx) {
    if (ctx.parsed && typeof ctx.parsed === 'object') {
      if (ctx.parsed.y !== undefined) return ctx.parsed.y;
      if (ctx.parsed.x !== undefined) return ctx.parsed.x;
    }
    return ctx.parsed || 0;
  }

  function chartCommonOptions(showLegend = false) {
    const textColor = cssvar('--text-secondary');
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 18, left: 6, bottom: 0 } },
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: { color: textColor, font: { size: 11 }, boxWidth: 10, padding: 10 }
        },
        tooltip: {
          backgroundColor: '#1A0F40',
          titleColor: '#F0E8FF',
          bodyColor: '#F0E8FF',
          borderColor: cssvar('--border-strong'),
          borderWidth: 1,
          padding: 10,
          callbacks: { label: ctx => ` ${brl(parsedChartValue(ctx))}` }
        }
      }
    };
  }

  function clearChart(canvasId) {
    destroyChart(canvasId);
    const canvas = $(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function renderCategoryColumnChart(canvasId, items, labelKey = 'categoria') {
    destroyChart(canvasId);
    if (!items || items.length === 0) {
      clearChart(canvasId);
      return;
    }
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'bar',
      data: {
        labels: items.map(i => i[labelKey] || i.categoria || i.responsavel || '—'),
        datasets: [{
          label: 'Valor',
          data: items.map(i => i.total || 0),
          backgroundColor: cssvar('--accent-fill'),
          borderColor: cssvar('--accent-fill'),
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 30
        }]
      },
      options: {
        ...chartCommonOptions(false),
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, font: { size: 10 }, callback: v => labelNumber(v) },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  function renderLineChart(canvasId, items, datasetLabel) {
    destroyChart(canvasId);
    if (!items || items.length === 0) {
      clearChart(canvasId);
      return;
    }
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'line',
      data: {
        labels: items.map(i => shortMonthLabel(i.mes_label)),
        datasets: [{
          label: datasetLabel,
          data: items.map(i => i.total || 0),
          borderColor: cssvar('--accent-fill'),
          backgroundColor: cssvar('--accent-soft'),
          pointBackgroundColor: cssvar('--accent-fill'),
          pointBorderColor: cssvar('--accent-fill'),
          pointRadius: 4,
          pointHoverRadius: 5,
          borderWidth: 3,
          tension: 0.28,
          fill: true
        }]
      },
      options: {
        ...chartCommonOptions(false),
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, font: { size: 10 }, callback: v => labelNumber(v) },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  function renderStackedBarChart(canvasId, items) {
    destroyChart(canvasId);
    if (!items || items.length === 0) {
      clearChart(canvasId);
      return;
    }
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'bar',
      data: {
        labels: items.map(i => shortMonthLabel(i.mes_label)),
        datasets: [
          {
            label: 'Gerais',
            data: items.map(i => i.geral || 0),
            backgroundColor: cssvar('--accent-fill'),
            borderColor: cssvar('--accent-fill'),
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 34
          },
          {
            label: 'Cartão',
            data: items.map(i => i.cartao || 0),
            backgroundColor: 'rgba(255,255,255,0.18)',
            borderColor: cssvar('--accent-fill'),
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 34
          }
        ]
      },
      options: {
        ...chartCommonOptions(true),
        scales: {
          x: { stacked: true, ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: textColor, font: { size: 10 }, callback: v => labelNumber(v) },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });
  }

  function renderDoughnutChart(canvasId, items) {
    destroyChart(canvasId);
    const validItems = (items || []).filter(item => (item.total || 0) > 0);
    if (validItems.length === 0) {
      clearChart(canvasId);
      return;
    }
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: validItems.map(item => item.label),
        datasets: [{
          data: validItems.map(item => item.total),
          backgroundColor: [cssvar('--accent-fill'), 'rgba(255,255,255,0.2)', '#8B7DFF', '#F9C74F'],
          borderColor: cssvar('--bg-card'),
          borderWidth: 4,
          hoverOffset: 4
        }]
      },
      options: {
        ...chartCommonOptions(true),
        cutout: '62%',
        plugins: {
          ...chartCommonOptions(true).plugins,
          tooltip: {
            ...chartCommonOptions(true).plugins.tooltip,
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((sum, v) => sum + v, 0) || 1;
                const value = ctx.parsed || 0;
                const pct = Math.round((value / total) * 100);
                return ` ${ctx.label}: ${labelNumber(value)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  function renderFluxoChart(canvasId, items) {
    destroyChart(canvasId);
    if (!items || items.length === 0) {
      clearChart(canvasId);
      return;
    }
    const textColor = cssvar('--text-tertiary');
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'bar',
      data: {
        labels: items.map(i => shortMonthLabel(i.mes_label)),
        datasets: [
          {
            type: 'bar',
            label: 'Receitas',
            data: items.map(i => i.receitas || 0),
            backgroundColor: cssvar('--accent-fill'),
            borderColor: cssvar('--accent-fill'),
            borderWidth: 0,
            borderRadius: 6,
            maxBarThickness: 28,
            order: 2
          },
          {
            type: 'bar',
            label: 'Despesas',
            data: items.map(i => i.despesas || 0),
            backgroundColor: '#FF7A8A',
            borderColor: '#FF7A8A',
            borderWidth: 0,
            borderRadius: 6,
            maxBarThickness: 28,
            order: 2
          },
          {
            type: 'line',
            label: 'Saldo',
            data: items.map(i => i.saldo || 0),
            borderColor: 'rgba(255,255,255,0.85)',
            backgroundColor: 'rgba(255,255,255,0.85)',
            pointBackgroundColor: 'rgba(255,255,255,0.95)',
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2.5,
            tension: 0.28,
            fill: false,
            order: 1
          }
        ]
      },
      options: {
        ...chartCommonOptions(true),
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: textColor, font: { size: 10 }, callback: v => labelNumber(v) }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  function getResponsavelColors() {
    // 1ª cor = mascote do user, 2ª cor = branco sutil, depois fallback
    const accent = cssvar('--accent-fill') || '#C6F404';
    return [accent, 'rgba(255, 255, 255, 0.65)', '#02B8FB', '#FB58C8', '#FCC802', '#04E170'];
  }

  function renderResponsavelMensalChart(canvasId, data) {
    destroyChart(canvasId);
    // Aceita tanto o formato novo { meses: [...], matrix: { mes: { resp: total } } }
    // quanto o legado { mes: { resp: total } }
    let meses, matrix;
    if (data && Array.isArray(data.meses) && data.matrix) {
      meses = data.meses;
      matrix = data.matrix;
    } else {
      matrix = data || {};
      meses = Object.keys(matrix).sort();
    }
    if (meses.length === 0) {
      clearChart(canvasId);
      return;
    }
    const responsaveis = [...new Set(meses.flatMap(mes => Object.keys(matrix[mes] || {})))];
    if (responsaveis.length === 0) {
      clearChart(canvasId);
      return;
    }
    const textColor = cssvar('--text-tertiary');
    const colors = getResponsavelColors();
    state.charts[canvasId] = new Chart($(canvasId).getContext('2d'), {
      type: 'bar',
      data: {
        labels: meses.map(shortMonthLabel),
        datasets: responsaveis.map((resp, idx) => ({
          label: resp,
          data: meses.map(mes => (matrix[mes] && matrix[mes][resp]) || 0),
          backgroundColor: colors[idx % colors.length],
          borderColor: colors[idx % colors.length],
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 28
        }))
      },
      options: {
        ...chartCommonOptions(true),
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: textColor, font: { size: 10 }, callback: v => labelNumber(v) }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  function shortMonthLabel(yyyymm) {
    if (!yyyymm) return '—';
    const [y, m] = String(yyyymm).split('-');
    return MES_NOMES[parseInt(m, 10) - 1] + '/' + String(y).slice(-2);
  }

  /* ============================================================
     RECEITAS
     ============================================================ */
  async function loadReceitas() {
    showLoader();
    const r = await api.listReceitas(currentFilterPayload());
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
          <input type="text" name="descricao" placeholder="Ex: Salário de maio" />
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
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-plus"></i><span>Adicionar</span>
          </button>
        </div>
      </form>
    `);
    $('form-receita').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const recorrente = fd.get('recorrente') === 'on';
      showLoader();
      const r = await api.addReceita({
        descricao: fd.get('descricao') || '',
        valor: parseFloat(fd.get('valor')),
        data: safeDateForBackend(fd.get('data')),
        categoria: fd.get('categoria'),
        recorrente,
        dia_do_mes: recorrente ? 1 : null
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
    const r = await api.listDespesas(currentFilterPayload());
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
          <input type="text" name="descricao" placeholder="Ex: Supermercado" />
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
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-plus"></i><span>Adicionar</span>
          </button>
        </div>
      </form>
    `);
    $('form-despesa').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const recorrente = fd.get('recorrente') === 'on';
      showLoader();
      const r = await api.addDespesa({
        descricao: fd.get('descricao') || '',
        valor: parseFloat(fd.get('valor')),
        data: safeDateForBackend(fd.get('data')),
        categoria: fd.get('categoria'),
        status: fd.get('status'),
        forma_pagamento: fd.get('forma_pagamento') || '',
        responsavel_id: fd.get('responsavel_id') || null,
        recorrente,
        dia_do_mes: recorrente ? 1 : null
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
    const filtros = state.viewFilters.cartao || {};
    let compras = r.compras || [];

    // Filtra compras pelos filtros independentes do cartão.
    // Pra recorrentes ou parceladas, considera "aparece" se alguma das
    // parcelas/ocorrências cair no mês/ano filtrado.
    if (filtros.ano != null || filtros.mes != null) {
      compras = compras.filter(c => {
        const expandidas = expandCompraEmParcelas(c, filtros.ano);
        return expandidas.some(e => {
          const d = parseLocalDate(e.data);
          if (!d) return false;
          if (filtros.ano != null && d.getFullYear() !== filtros.ano) return false;
          if (filtros.mes != null && (d.getMonth() + 1) !== filtros.mes) return false;
          return true;
        });
      });
    }
    renderComprasTable(compras);
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
        <td class="num money-neg">${brl(c.valor_parcela != null ? c.valor_parcela : ((parseFloat(c.valor_total) || 0) / Math.max(parseInt(c.parcelas, 10) || 1, 1)))}</td>
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
          <input type="text" name="descricao" placeholder="Ex: Tênis novo" />
        </label>
        <div class="row-2">
          <label>
            <span>Valor da parcela (R$)</span>
            <input type="number" name="valor_parcela" min="0.01" step="0.01" required inputmode="decimal" />
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
        <label class="checkbox-line">
          <input type="checkbox" name="recorrente" id="compra-recorrente" />
          <span>Repete todo mês no cartão</span>
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
      const parcelas = Math.max(1, parseInt(fd.get('parcelas'), 10) || 1);
      const valorParcela = parseFloat(fd.get('valor_parcela'));
      const recorrente = fd.get('recorrente') === 'on';
      showLoader();
      const r = await api.addCompraCartao({
        descricao: fd.get('descricao') || '',
        valor_total: valorParcela * parcelas,
        valor_parcela: valorParcela,
        data_compra: safeDateForBackend(fd.get('data_compra')),
        categoria: fd.get('categoria'),
        parcelas,
        responsavel_id: fd.get('responsavel_id'),
        recorrente,
        dia_do_mes: recorrente ? 1 : null
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

    // Voltar da tela de "cadastros encerrados" pra auth
    const backFromClosed = $('btn-back-from-closed');
    if (backFromClosed) {
      backFromClosed.addEventListener('click', () => {
        $('screen-registration-closed').classList.add('hidden');
        $('screen-auth').classList.remove('hidden');
        // limpa o estado da sessão pra forçar nova escolha de conta
        state.idToken = null;
        state.profile = null;
        if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
        renderGoogleButton();
      });
    }

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
