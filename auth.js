// =========================================================================
// MÓDULO DE AUTENTICAÇÃO UNIFICADA (SUPABASE AUTH + PIN 6 DÍGITOS)
// =========================================================================
(function () {
  const DOMAIN_INTERNO = 'novaera.app';
  const STORAGE_PROFILE_KEY = 'novaera_auth_profile_v1';

  let _sb = null;
  let _currentProfile = null;
  let _allowedRoles = [];
  let _onAuthReady = null;
  let _tituloTela = 'Acesso Operacional';

  function montarEmailInterno(usuario) {
    const limpo = String(usuario || '').trim().toLowerCase();
    if (!limpo) return '';
    return limpo.includes('@') ? limpo : `${limpo}@${DOMAIN_INTERNO}`;
  }

  function salvarPerfilLocal(profile) {
    _currentProfile = profile;
    if (profile) {
      localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(STORAGE_PROFILE_KEY);
    }
  }

  function lerPerfilLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function injetarTelaLogin() {
    if (document.getElementById('novaera-auth-overlay')) return;

    const div = document.createElement('div');
    div.id = 'novaera-auth-overlay';
    div.className = 'fixed inset-0 bg-slate-950/95 z-[100] hidden flex items-center justify-center p-4 backdrop-blur-sm';
    div.innerHTML = `
      <div class="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5">
        <div class="text-center space-y-2">
          <img src="Logo.jpg" onerror="this.style.display='none'" alt="Nova Era" class="w-16 h-16 mx-auto rounded-2xl object-cover border border-slate-200 shadow-sm">
          <div>
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-orange-600">Nova Era Facilities</span>
            <h2 id="auth-modal-titulo" class="text-xl font-extrabold text-slate-900 mt-0.5">${_tituloTela}</h2>
            <p class="text-xs text-slate-500 mt-0.5">Digite seu usuário e PIN de 6 dígitos</p>
          </div>
        </div>

        <form id="novaera-auth-form" class="space-y-3.5">
          <div>
            <label class="block text-[11px] font-extrabold text-slate-700 uppercase mb-1">Usuário</label>
            <input type="text" id="auth-input-user" autocomplete="username" autocapitalize="none" autocorrect="off" required
              placeholder="Digite seu usuário"
              class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:bg-white">
          </div>

          <div>
            <label class="block text-[11px] font-extrabold text-slate-700 uppercase mb-1">PIN (6 dígitos)</label>
            <input type="password" id="auth-input-pin" inputmode="numeric" pattern="[0-9]*" minlength="6" maxlength="12" autocomplete="current-password" required
              placeholder="••••••"
              class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-3 text-base font-extrabold tracking-[0.35em] text-center text-slate-900 outline-none focus:border-orange-500 focus:bg-white">
          </div>

          <div id="auth-error-box" class="hidden bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-3 py-2.5 rounded-xl text-center"></div>

          <button type="submit" id="auth-btn-submit"
            class="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-3.5 rounded-xl text-sm shadow-md transition-all">
            Entrar no Sistema
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(div);

    document.getElementById('novaera-auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = document.getElementById('auth-input-user').value.trim();
      const pin = document.getElementById('auth-input-pin').value.trim();
      await fazerLogin(user, pin);
    });
  }

  function mostrarErroLogin(msg) {
    const box = document.getElementById('auth-error-box');
    if (!box) return;
    if (!msg) {
      box.classList.add('hidden');
      box.textContent = '';
    } else {
      box.textContent = msg;
      box.classList.remove('hidden');
    }
  }

  function abrirTelaLogin(msgErro = '') {
    injetarTelaLogin();
    const tit = document.getElementById('auth-modal-titulo');
    if (tit) tit.textContent = _tituloTela;
    mostrarErroLogin(msgErro);
    document.getElementById('novaera-auth-overlay').classList.remove('hidden');
  }

  function fecharTelaLogin() {
    const el = document.getElementById('novaera-auth-overlay');
    if (el) el.classList.add('hidden');
  }

  async function buscarPerfilColaborador(user) {
    if (!user) return null;

    try {
      const queryPromise = _sb
        .from('colaboradores')
        .select('id, nome, cliente_padrao, perfil, ativo, auth_email, auth_user_id')
        .or(`auth_user_id.eq.${user.id},auth_email.ilike.${user.email}`)
        .limit(1)
        .maybeSingle();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_PERFIL')), 5000)
      );

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
      if (!error && data) {
        const perfil = {
          colaborador_id: data.id,
          auth_user_id: user.id,
          email: user.email,
          nome: data.nome,
          perfil: String(data.perfil || 'OPERADOR').toUpperCase(),
          cliente_padrao: data.cliente_padrao || null,
          ativo: data.ativo !== false
        };
        salvarPerfilLocal(perfil);
        return perfil;
      }
    } catch (e) {
      const cached = lerPerfilLocal();
      if (cached && cached.auth_user_id === user.id) return cached;
    }

    const cached = lerPerfilLocal();
    if (cached && cached.auth_user_id === user.id) return cached;
    return null;
  }

  function perfilAutorizado(profile) {
    if (!profile || profile.ativo === false) return false;
    if (!_allowedRoles || _allowedRoles.length === 0) return true;
    return _allowedRoles.includes(String(profile.perfil || '').toUpperCase());
  }

  async function fazerLogin(usuario, pin) {
    const btn = document.getElementById('auth-btn-submit');
    mostrarErroLogin('');

    if (!usuario || pin.length < 6) {
      mostrarErroLogin('Informe o usuário e o PIN de 6 dígitos.');
      return;
    }

    if (!navigator.onLine) {
      mostrarErroLogin('Sem conexão no momento. Conecte-se para fazer o primeiro login.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Validando...';

    try {
      const email = montarEmailInterno(usuario);
      const { data, error } = await _sb.auth.signInWithPassword({ email, password: pin });

      if (error || !data?.user) {
        mostrarErroLogin('Usuário ou PIN incorretos.');
        return;
      }

      const profile = await buscarPerfilColaborador(data.user);
      if (!profile) {
        await _sb.auth.signOut();
        mostrarErroLogin('Usuário não vinculado na tabela de colaboradores.');
        return;
      }

      if (!perfilAutorizado(profile)) {
        await _sb.auth.signOut();
        salvarPerfilLocal(null);
        mostrarErroLogin(`Acesso negado para o perfil "${profile.perfil}" nesta tela.`);
        return;
      }

      fecharTelaLogin();
      if (typeof _onAuthReady === 'function') _onAuthReady(profile);
    } catch (err) {
      mostrarErroLogin('Falha de rede ao autenticar. Tente novamente.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar no Sistema';
    }
  }

  async function init(sbClient, options = {}) {
    _sb = sbClient;
    _allowedRoles = (options.allowedRoles || []).map((r) => r.toUpperCase());
    _onAuthReady = options.onReady || null;
    _tituloTela = options.titulo || 'Acesso Operacional';

    injetarTelaLogin();

    try {
      const { data } = await _sb.auth.getSession();
      const session = data?.session;

      if (session?.user) {
        const profile = await buscarPerfilColaborador(session.user);
        if (profile && perfilAutorizado(profile)) {
          fecharTelaLogin();
          if (typeof _onAuthReady === 'function') _onAuthReady(profile);
          return profile;
        }
      }
    } catch (e) {
      const cached = lerPerfilLocal();
      if (cached && perfilAutorizado(cached)) {
        fecharTelaLogin();
        if (typeof _onAuthReady === 'function') _onAuthReady(cached);
        return cached;
      }
    }

    abrirTelaLogin();
    return null;
  }

  async function logout() {
    if (!confirm('Deseja sair da sua conta neste aparelho?')) return;
    try {
      await _sb.auth.signOut();
    } catch (e) {}
    salvarPerfilLocal(null);
    location.reload();
  }

  window.NovaEraAuth = {
    init,
    logout,
    getUser: () => _currentProfile || lerPerfilLocal()
  };
})();
