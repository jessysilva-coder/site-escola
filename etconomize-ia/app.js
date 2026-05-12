/* ============================================================
   ETconomize — frontend app logic
   - Theme management (dark/light com persistência via localStorage)
   - Stars background animado
   - Google Sign-In via GIS (Google Identity Services)
   - Teste de ping na API Apps Script
   ============================================================ */

(function () {
  'use strict';

  /* ----------- Theme management ----------- */
  const THEME_KEY = 'etconomize-theme';
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle .ti');
    if (icon) icon.className = theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
  }
  updateThemeIcon(savedTheme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeIcon(next);
    // Re-render do botão Google pra trocar o tema dele também
    if (window.google && google.accounts && !ETconomize.user) {
      renderGoogleButton();
    }
  });

  /* ----------- Stars background ----------- */
  function generateStars(count) {
    const layer = document.getElementById('stars');
    for (let i = 0; i < count; i++) {
      const star = document.createElement('span');
      star.className = 'star';
      star.style.left = (Math.random() * 100) + '%';
      star.style.top = (Math.random() * 100) + '%';
      const size = Math.random() < 0.85 ? 1 : 2;
      star.style.width = size + 'px';
      star.style.height = size + 'px';
      star.style.opacity = (0.3 + Math.random() * 0.55).toFixed(2);
      const duration = (2 + Math.random() * 4).toFixed(2);
      const delay = (Math.random() * 5).toFixed(2);
      star.style.animationDuration = duration + 's';
      star.style.animationDelay = delay + 's';
      layer.appendChild(star);
    }
  }
  generateStars(90);

  /* ----------- Google Sign-In ----------- */
  function waitForGIS(callback, attempts) {
    attempts = attempts || 0;
    if (window.google && google.accounts && google.accounts.id) {
      callback();
    } else if (attempts < 60) {
      setTimeout(() => waitForGIS(callback, attempts + 1), 100);
    } else {
      console.error('Google Identity Services não carregou em tempo hábil.');
    }
  }

  function renderGoogleButton() {
    const container = document.getElementById('signin-container');
    container.innerHTML = '';
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    google.accounts.id.renderButton(container, {
      theme: isDark ? 'filled_black' : 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'left',
      locale: 'pt-BR'
    });
  }

  waitForGIS(() => {
    google.accounts.id.initialize({
      client_id: ETconomize.CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    renderGoogleButton();
  });

  function handleCredentialResponse(response) {
    const idToken = response.credential;
    const payload = parseJwt(idToken);
    ETconomize.idToken = idToken;
    ETconomize.user = payload;
    showDashboard(payload);
  }

  /**
   * Decodifica o payload do JWT só pra mostrar nome/email/foto no UI.
   * IMPORTANTE: validação de verdade é responsabilidade do backend
   * (que verifica a assinatura usando as chaves públicas do Google).
   */
  function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
    return JSON.parse(jsonPayload);
  }

  function showDashboard(user) {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('user-name').textContent = user.name || user.email;
    document.getElementById('user-email').textContent = user.email;

    const avatar = document.getElementById('user-avatar');
    if (user.picture) {
      avatar.style.backgroundImage = `url(${user.picture})`;
      avatar.textContent = '';
    } else {
      avatar.style.backgroundImage = '';
      avatar.textContent = (user.name || user.email).charAt(0).toUpperCase();
    }
  }

  document.getElementById('logout-btn').addEventListener('click', () => {
    google.accounts.id.disableAutoSelect();
    ETconomize.idToken = null;
    ETconomize.user = null;
    document.getElementById('ping-result').classList.add('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('auth-section').classList.remove('hidden');
    renderGoogleButton();
  });

  /* ----------- API ping test ----------- */
  document.getElementById('ping-btn').addEventListener('click', async () => {
    const btn = document.getElementById('ping-btn');
    const result = document.getElementById('ping-result');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2"></i><span>Pingando...</span>';
    result.classList.add('hidden');

    try {
      const url = ETconomize.APPS_SCRIPT_URL + '?action=ping';
      const response = await fetch(url);
      const data = await response.json();
      result.textContent = JSON.stringify(data, null, 2);
      result.classList.remove('hidden');
    } catch (err) {
      result.textContent = '❌ Erro: ' + err.message;
      result.classList.remove('hidden');
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
      }, 400);
    }
  });

})();
