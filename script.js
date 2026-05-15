// ============================================================
// SUPABASE CONFIG — substitua pelos seus dados
// ============================================================
const SUPABASE_URL = 'https://leyqpinjhhaoywfdgahf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxleXFwaW5qaGhhb3l3ZmRnYWhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTAzNjAsImV4cCI6MjA5NDM4NjM2MH0.ypzGe5bAzTsPJatuZPziR359nH5U4_PUBSLVcmZQvc4';

// Cliente Supabase (carregado via CDN no index.html)
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// STATE
// ============================================================
let appState = {
    user: null,          // objeto do Supabase Auth
    profile: null,       // linha da tabela profiles
    balance: 0,
    corns: 0,
    hasHat: false,
    hatEquipped: false,
    selectedPayment: 'pix',
    tempC: null,
    weatherCode: null,   // WMO weather code
    weatherTheme: null,  // classe CSS atual
    weatherCity: null,   // cidade detectada
};

// ============================================================
// INIT — roda ao carregar a página
// ============================================================
(async function init() {
    // Tenta restaurar sessão existente
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        appState.user = session.user;
        await loadProfile();
        showPage('page-dashboard');
    }

    // Escuta mudanças de autenticação (login, logout, refresh de token)
    sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            appState.user = session.user;
            await loadProfile();
        }
        if (event === 'SIGNED_OUT') {
            appState.user = null;
            appState.profile = null;
            appState.balance = 0;
            appState.corns = 0;
        }
    });

    // Inicia o clima em background (não bloqueia o carregamento)
    fetchWeather();
})();

// ============================================================
// SUPABASE — PERFIL
// ============================================================
async function loadProfile() {
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', appState.user.id)
        .single();

    if (error) {
        // Perfil ainda não existe: cria um novo
        if (error.code === 'PGRST116') {
            await createProfile();
        } else {
            console.error('Erro ao carregar perfil:', error.message);
        }
        return;
    }

    appState.profile = data;
    appState.balance = data.balance ?? 0;
    appState.corns = data.corns ?? 0;
    appState.hasHat = data.has_hat ?? false;
    appState.hatEquipped = data.hat_equipped ?? false;

    // Restaura último clima salvo enquanto busca o atual
    if (data.last_temp_c !== null && data.last_temp_c !== undefined) {
        appState.tempC = data.last_temp_c;
        appState.weatherCode = data.last_weather_code ?? null;
        applyWeatherTheme(data.last_temp_c, data.last_weather_code ?? 0);
    }

    // Preenche dados do usuário no state
    appState.user.name = data.full_name ?? appState.user.email;
    appState.user.birth = data.birth_date ?? '';
}

async function createProfile() {
    const meta = appState.user.user_metadata ?? {};
    const { data, error } = await sb.from('profiles').insert({
        id: appState.user.id,
        full_name: meta.full_name ?? '',
        birth_date: meta.birth_date ?? null,
        balance: 0,
        corns: 0,
        has_hat: false,
        hat_equipped: false,
        last_temp_c: null,
        last_weather_code: null,
        last_weather_city: null,
    }).select().single();

    if (!error) {
        appState.profile = data;
        appState.balance = 0;
        appState.corns = 0;
    } else {
        console.error('Erro ao criar perfil:', error.message);
    }
}

async function saveProfile(fields) {
    if (!appState.user) return;
    const { error } = await sb
        .from('profiles')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', appState.user.id);
    if (error) { showToast('❌ Erro ao salvar: ' + error.message); }
}

// ============================================================
// SUPABASE — AUTENTICAÇÃO
// ============================================================
async function doRegister() {
    const name  = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass  = document.getElementById('reg-pass').value;
    const pass2 = document.getElementById('reg-pass2').value;
    const birth = document.getElementById('reg-birth').value;

    if (!name || !email || !pass || !pass2 || !birth) { showToast('⚠️ Preencha todos os campos!'); return; }
    if (pass !== pass2)   { showToast('❌ As senhas não coincidem!'); return; }
    if (pass.length < 8)  { showToast('❌ Mínimo 8 caracteres na senha!'); return; }

    setLoading('reg-btn', true);

    const { data, error } = await sb.auth.signUp({
        email,
        password: pass,
        options: {
            data: { full_name: name, birth_date: formatDate(birth) }
        }
    });

    setLoading('reg-btn', false);

    if (error) { showToast('❌ ' + error.message); return; }

    // Se confirmação de e-mail estiver desativada no Supabase, o usuário
    // já vem autenticado. Se estiver ativa, mostra aviso.
    if (data.user && !data.session) {
        showToast('📨 Confirme seu e-mail para entrar!');
        setTimeout(() => showPage('page-login'), 1500);
        return;
    }

    appState.user = data.user;
    await createProfile();
    showToast('🎉 Conta criada com sucesso!');
    setTimeout(() => showPage('page-dashboard'), 800);
}

async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;

    if (!email || !pass) { showToast('⚠️ Preencha e-mail e senha!'); return; }

    setLoading('login-btn', true);

    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

    setLoading('login-btn', false);

    if (error) { showToast('❌ ' + (error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)); return; }

    appState.user = data.user;
    await loadProfile();
    showToast('✅ Login realizado!');
    setTimeout(() => showPage('page-dashboard'), 600);
}

async function doForgot() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) { showToast('⚠️ Informe seu e-mail!'); return; }

    setLoading('forgot-btn', true);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/?reset=true'
    });
    setLoading('forgot-btn', false);

    if (error) { showToast('❌ ' + error.message); return; }
    showToast('📨 Link enviado para ' + email);
    setTimeout(() => showPage('page-login'), 1500);
}

async function doLogout() {
    if (!confirm('Deseja mesmo sair?')) return;
    await sb.auth.signOut();
    showPage('page-welcome');
    showToast('👋 Até a próxima!');
}

// ============================================================
// SUPABASE — DEPÓSITO
// ============================================================
async function doDeposit() {
    const val = parseFloat(document.getElementById('deposit-amount').value);
    if (!val || val < 10) { showToast('⚠️ Valor mínimo: R$ 10,00'); return; }
    if (!appState.user)   { showToast('⚠️ Faça login primeiro!'); return; }

    const isCard  = appState.selectedPayment === 'card';
    const tax     = isCard ? val * 0.025 : 0;
    const credited = parseFloat((val - tax).toFixed(2));
    const corns   = Math.floor(val / 10) * 10;
    const newBalance = parseFloat((appState.balance + credited).toFixed(2));
    const newCorns   = appState.corns + corns;

    setLoading('deposit-btn', true);

    // 1. Salva transação
    const { error: txError } = await sb.from('transactions').insert({
        user_id:          appState.user.id,
        type:             'deposit',
        amount:           credited,
        payment_method:   appState.selectedPayment,
        tax:              tax,
        corns_earned:     corns,
        description:      'Depósito via ' + (isCard ? 'Cartão' : 'PIX'),
    });

    if (txError) { setLoading('deposit-btn', false); showToast('❌ Erro ao registrar: ' + txError.message); return; }

    // 2. Atualiza saldo e grãos no perfil
    await saveProfile({ balance: newBalance, corns: newCorns });

    setLoading('deposit-btn', false);

    appState.balance = newBalance;
    appState.corns   = newCorns;

    document.getElementById('success-amount').textContent = formatCurrency(credited);
    document.getElementById('success-corns').textContent  = '+' + corns + ' Grãos de Milho';

    launchConfetti();
    showPage('page-success');
}

// ============================================================
// SUPABASE — HISTÓRICO
// ============================================================
async function loadHistory() {
    if (!appState.user) return;

    const { data, error } = await sb
        .from('transactions')
        .select('*')
        .eq('user_id', appState.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) { console.error('Histórico:', error.message); return; }

    renderHistory(data);
}

function renderHistory(txs) {
    const container = document.getElementById('history-list');
    if (!container) return;

    if (!txs || txs.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--gray);padding:24px 0;">Nenhuma transação ainda 🌽</p>';
        return;
    }

    const icons = { deposit: '💰', purchase: '🛍️', reward: '🎁' };
    const bgColors = { deposit: '#E8F5E9', purchase: '#FFF3E0', reward: '#FCE4EC' };

    container.innerHTML = txs.map(tx => {
        const isCredit = tx.type === 'deposit';
        const dateStr  = new Date(tx.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        const icon     = icons[tx.type] || '💳';
        const bg       = bgColors[tx.type] || '#F3F4F6';
        return `
          <div class="history-item">
            <div class="history-icon" style="background:${bg};">${icon}</div>
            <div style="flex:1;">
              <div style="font-weight:700;font-size:14px;">${tx.description}</div>
              <div style="font-size:12px;color:var(--gray);">${dateStr} ${tx.corns_earned ? '• 🌽 +' + tx.corns_earned : ''}</div>
            </div>
            <div style="font-weight:800;color:${isCredit ? '#2E7D32' : 'var(--red)'};">
              ${isCredit ? '+' : '-'}${formatCurrency(tx.amount)}
            </div>
          </div>`;
    }).join('');
}

// ============================================================
// SUPABASE — RECOMPENSAS
// ============================================================
async function buyReward(id, cost, icon) {
    if (appState.corns < cost) { showToast('❌ Grãos insuficientes! Precisa de ' + cost + ' 🌽'); return; }
    if (!appState.user) return;

    const newCorns = appState.corns - cost;
    const extraFields = id === 'chapeu' ? { has_hat: true } : {};

    await saveProfile({ corns: newCorns, ...extraFields });

    appState.corns = newCorns;
    if (id === 'chapeu') appState.hasHat = true;

    document.getElementById('corn-count').textContent     = appState.corns;
    document.getElementById('corn-shop-count').textContent = appState.corns;
    showToast(icon + ' Item adquirido! -' + cost + ' 🌽');
}

// ============================================================
// CLIMA — Open-Meteo (100% grátis, sem API key)
// + WMO weather codes para detectar chuva, neve, névoa, etc.
// + Cache no Supabase para usuários logados
// ============================================================

/**
 * Mapeamento de códigos WMO → classe CSS de tema
 * Referência: https://open-meteo.com/en/docs#weathervariables
 */
const WMO_TO_THEME = {
    // 0: Clear sky
    0:  'mild',
    // 1-3: Mainly clear, partly cloudy, overcast
    1:  'mild', 2: 'fog', 3: 'fog',
    // 45-48: Fog
    45: 'fog', 48: 'fog',
    // 51-57: Drizzle
    51: 'rainy', 53: 'rainy', 55: 'rainy', 56: 'rainy', 57: 'rainy',
    // 61-67: Rain
    61: 'rainy', 63: 'rainy', 65: 'rainy', 66: 'rainy', 67: 'rainy',
    // 71-77: Snow
    71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
    // 80-82: Rain showers
    80: 'rainy', 81: 'rainy', 82: 'rainy',
    // 85-86: Snow showers
    85: 'snow', 86: 'snow',
    // 95-99: Thunderstorm
    95: 'storm', 96: 'storm', 99: 'storm',
};

const WEATHER_CONFIG = {
    cold: {
        bodyClass:  'weather-cold',
        emoji:      '🥶',
        desc:       'Frio',
        minTemp:    -Infinity,
        maxTemp:    15,
    },
    mild: {
        bodyClass:  'weather-mild',
        emoji:      '🌤️',
        desc:       'Ameno',
        minTemp:    15,
        maxTemp:    25,
    },
    hot: {
        bodyClass:  'weather-hot',
        emoji:      '🌡️',
        desc:       'Quente',
        minTemp:    25,
        maxTemp:    35,
    },
    scorching: {
        bodyClass:  'weather-scorching',
        emoji:      '🔥',
        desc:       'Escaldante',
        minTemp:    35,
        maxTemp:    Infinity,
    },
    rainy: {
        bodyClass:  'weather-rainy',
        emoji:      '🌧️',
        desc:       'Chuvoso',
        minTemp:    -Infinity,
        maxTemp:    Infinity,
    },
    storm: {
        bodyClass:  'weather-storm',
        emoji:      '⛈️',
        desc:       'Tempestade',
        minTemp:    -Infinity,
        maxTemp:    Infinity,
    },
    snow: {
        bodyClass:  'weather-snow',
        emoji:      '❄️',
        desc:       'Nevando',
        minTemp:    -Infinity,
        maxTemp:    Infinity,
    },
    fog: {
        bodyClass:  'weather-fog',
        emoji:      '🌫️',
        desc:       'Nublado',
        minTemp:    -Infinity,
        maxTemp:    Infinity,
    },
};

/**
 * Determina a chave de tema baseada em temperatura E código WMO.
 * Precipitação / fenômeno especial tem prioridade sobre temperatura.
 */
function resolveThemeKey(tempC, wmoCode) {
    // Fenômeno especial tem prioridade
    const wmoTheme = WMO_TO_THEME[wmoCode];
    if (wmoTheme && wmoTheme !== 'mild') return wmoTheme;

    // Caso contrário, decide pela temperatura
    if (tempC < 15)  return 'cold';
    if (tempC < 25)  return 'mild';
    if (tempC < 35)  return 'hot';
    return 'scorching';
}

/**
 * Aplica o tema visual de clima em toda a interface.
 * @param {number} tempC    - Temperatura em graus Celsius
 * @param {number} wmoCode  - Código WMO do tempo atual (0 se desconhecido)
 * @param {string} city     - Nome da cidade (opcional)
 */
function applyWeatherTheme(tempC, wmoCode = 0, city = null) {
    const key    = resolveThemeKey(tempC, wmoCode);
    const config = WEATHER_CONFIG[key];

    // Remove todas as classes de clima anteriores
    const allClasses = Object.values(WEATHER_CONFIG).map(c => c.bodyClass);
    document.body.classList.remove(...allClasses);
    document.body.classList.add(config.bodyClass);

    appState.weatherTheme = key;

    // Texto exibido nos badges
    const cityLabel = city ? ` • ${city}` : '';
    const txt = `${config.emoji} ${tempC}°C • ${config.desc}${cityLabel}`;

    // Atualiza todos os badges de clima na página
    ['weather-text-w', 'weather-text-sb', 'weather-text-m'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    });

    // Atualiza card de clima no dashboard se existir
    const wiTemp = document.getElementById('wi-temp');
    const wiDesc = document.getElementById('wi-desc');
    const wiCity = document.getElementById('wi-city');
    if (wiTemp) wiTemp.textContent = `${config.emoji} ${tempC}°C`;
    if (wiDesc) wiDesc.textContent = config.desc;
    if (wiCity) wiCity.textContent = city || '';

    console.log(`[Clima] ${tempC}°C | WMO: ${wmoCode} → Tema: ${config.desc} (${config.bodyClass})`);
}

/**
 * Salva o clima atual no Supabase (perfil do usuário logado).
 * Não bloqueia a UI — falha silenciosamente.
 */
async function persistWeatherToSupabase(tempC, wmoCode, city) {
    if (!appState.user) return;
    try {
        await saveProfile({
            last_temp_c:       tempC,
            last_weather_code: wmoCode,
            last_weather_city: city || null,
            last_weather_at:   new Date().toISOString(),
        });
    } catch (e) {
        console.warn('[Clima] Falha ao salvar no Supabase:', e.message);
    }
}

/**
 * Ponto de entrada do sistema de clima.
 * Tenta geolocalização → fallback por IP → fallback padrão (tema ameno).
 */
async function fetchWeather() {
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            async ({ coords }) => {
                await getWeatherByCoords(coords.latitude, coords.longitude);
            },
            async () => {
                // Usuário negou permissão ou timeout: fallback por IP
                await getWeatherByIP();
            },
            { timeout: 8000, maximumAge: 300000 } // cache de 5 min
        );
    } else {
        await getWeatherByIP();
    }
}

/**
 * Busca clima via Open-Meteo (gratuito, sem API key, HTTPS).
 * Inclui código WMO do tempo atual.
 */
async function getWeatherByCoords(lat, lon, city = null) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast`
            + `?latitude=${lat}&longitude=${lon}`
            + `&current_weather=true`
            + `&timezone=auto`;

        const res  = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data    = await res.json();
        const cw      = data.current_weather;
        const tempC   = Math.round(cw.temperature);
        const wmoCode = cw.weathercode ?? 0;

        appState.tempC       = tempC;
        appState.weatherCode = wmoCode;
        appState.weatherCity = city;

        applyWeatherTheme(tempC, wmoCode, city);

        // Salva no Supabase em background (sem await para não bloquear)
        persistWeatherToSupabase(tempC, wmoCode, city);

    } catch (e) {
        console.warn('[Clima] Open-Meteo falhou, tentando fallback IP:', e.message);
        await getWeatherByIP();
    }
}

/**
 * Detecta cidade/coordenadas pelo IP usando ip-api.com (gratuito, sem key).
 * Limite: 45 req/min (mais que suficiente para uso normal).
 * ATENÇÃO: ip-api.com não suporta HTTPS no plano gratuito.
 * Por isso, usamos open.ip-api.com que aceita HTTPS.
 */
async function getWeatherByIP() {
    try {
        // Tentativa 1: ipapi.co (HTTPS, gratuito, 1000 req/dia)
        const geoRes  = await fetch('https://ipapi.co/json/');
        const geoData = await geoRes.json();

        if (geoData.latitude && geoData.longitude) {
            await getWeatherByCoords(
                geoData.latitude,
                geoData.longitude,
                geoData.city || null
            );
            return;
        }
        throw new Error('Sem coordenadas no ipapi.co');
    } catch (e1) {
        console.warn('[Clima] ipapi.co falhou:', e1.message);
        try {
            // Tentativa 2: ip-api.com via HTTP (funciona em HTTP ou via proxy)
            const geoRes2  = await fetch('https://ip-api.com/json/?fields=lat,lon,city,status');
            const geoData2 = await geoRes2.json();

            if (geoData2.status === 'success' && geoData2.lat) {
                await getWeatherByCoords(geoData2.lat, geoData2.lon, geoData2.city || null);
                return;
            }
            throw new Error('Resposta inválida do ip-api.com');
        } catch (e2) {
            console.warn('[Clima] ip-api.com também falhou:', e2.message);
            // Último recurso: aplica tema padrão (ameno — SP tem clima quente)
            applyWeatherTheme(28, 0, null);
        }
    }
}

// ============================================================
// PAGE NAVIGATION
// ============================================================
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(id);
    if (page) {
        page.classList.add('active');
        window.scrollTo(0, 0);
    }
    if (id === 'page-dashboard') {
        updateDashboard();
        showDashTab('home');
    }
    if (id === 'page-profile') updateProfilePage();
    if (id === 'page-deposit') updateDepositPage();
}

function showDashTab(tab) {
    ['home', 'rewards', 'history'].forEach(t => {
        const el = document.getElementById('dash-' + t);
        if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });
    ['home', 'rewards', 'history'].forEach(t => {
        const bn = document.getElementById('bn-' + t);
        if (bn) bn.classList.toggle('active', t === tab);
    });
    const bnDeposit = document.getElementById('bn-deposit');
    if (bnDeposit) bnDeposit.classList.remove('active');
    const bnProfile = document.getElementById('bn-profile');
    if (bnProfile) bnProfile.classList.remove('active');
    ['home', 'deposit', 'rewards', 'history', 'profile'].forEach(t => {
        const sb_el = document.getElementById('sb-' + t);
        if (sb_el) sb_el.classList.toggle('active', t === tab);
    });

    if (tab === 'rewards') {
        document.getElementById('corn-shop-count').textContent = appState.corns;
    }
    if (tab === 'history') {
        loadHistory(); // Carrega do Supabase
    }
}

// ============================================================
// DEPOSIT UI
// ============================================================
function setAmount(val) {
    document.getElementById('deposit-amount').value = val;
    updateDepositSummary();
}

function selectPayment(type) {
    appState.selectedPayment = type;
    const pixOpt  = document.getElementById('pay-pix');
    const cardOpt = document.getElementById('pay-card');
    const pixChk  = document.getElementById('pix-check');
    const cardChk = document.getElementById('card-check');

    if (type === 'pix') {
        pixOpt.classList.add('selected');   cardOpt.classList.remove('selected');
        pixChk.style.cssText  = 'background:var(--grad);color:white;border:none;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
        cardChk.style.cssText = 'background:transparent;color:transparent;border:2px solid var(--border);width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
    } else {
        cardOpt.classList.add('selected');  pixOpt.classList.remove('selected');
        cardChk.style.cssText = 'background:var(--grad);color:white;border:none;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
        pixChk.style.cssText  = 'background:transparent;color:transparent;border:2px solid var(--border);width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
    }
    updateDepositSummary();
}

function updateDepositSummary() {
    const val     = parseFloat(document.getElementById('deposit-amount').value) || 0;
    const summary = document.getElementById('deposit-summary');
    if (val <= 0) { summary.style.display = 'none'; return; }

    summary.style.display = 'block';
    const isCard = appState.selectedPayment === 'card';
    const tax    = isCard ? val * 0.025 : 0;
    const total  = val - tax;
    const corns  = Math.floor(val / 10) * 10;

    document.getElementById('sum-amount').textContent = formatCurrency(val);
    document.getElementById('sum-tax').textContent    = '-' + formatCurrency(tax);
    document.getElementById('sum-total').textContent  = formatCurrency(total);
    document.getElementById('sum-corns').textContent  = corns;
    document.getElementById('sum-tax-row').style.display = isCard ? 'flex' : 'none';
}

// ============================================================
// PROFILE UI
// ============================================================
let hatOn = false;
async function toggleHat() {
    hatOn = !hatOn;
    const hat = document.getElementById('hat-display');
    const btn = document.getElementById('hat-btn');
    if (hat) hat.style.display = hatOn ? 'block' : 'none';
    if (btn) btn.textContent   = hatOn ? 'Remover' : 'Equipar';
    await saveProfile({ hat_equipped: hatOn });
}

function editProfile() {
    showToast('✏️ Edição disponível em breve!');
}

function updateProfilePage() {
    const name  = appState.user?.name  || appState.user?.email || '—';
    const email = appState.user?.email || '—';
    const birth = appState.user?.birth || appState.profile?.birth_date || '—';

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('profile-name',  name);
    set('profile-email', email);
    set('info-name',     name);
    set('info-email',    email);
    set('info-birth',    birth);

    // Stats
    const statCorns   = document.querySelector('#page-profile .profile-stat-val');
    if (statCorns) statCorns.textContent = appState.corns;
}

function updateDashboard() {
    const name = appState.user?.name || appState.user?.email || 'Usuário';
    const firstName = name.split(' ')[0];
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('dash-greeting',   firstName + ' 👋');
    set('corn-count',      appState.corns);
    set('balance-display', formatCurrency(appState.balance));
}

function updateDepositPage() {
    const el = document.getElementById('dep-current-balance');
    if (el) el.textContent = formatCurrency(appState.balance);
    const amtEl = document.getElementById('deposit-amount');
    if (amtEl) amtEl.value = '';
    const sumEl = document.getElementById('deposit-summary');
    if (sumEl) sumEl.style.display = 'none';
}

// ============================================================
// FIRE CURSOR EFFECT
// ============================================================
let lastX = 0, lastY = 0;

document.addEventListener('mousemove', e => { lastX = e.clientX; lastY = e.clientY; });

function spawnSpark() {
    const colors = ['#F4B400', '#FF7A00', '#FF5722', '#FFCC02', '#FF8C00'];
    const spark = document.createElement('div');
    spark.className = 'spark';
    const size    = 4 + Math.random() * 8;
    const offsetX = (Math.random() - 0.5) * 20;
    spark.style.cssText = `left:${lastX + offsetX - size / 2}px;top:${lastY - size / 2}px;width:${size}px;height:${size}px;background:${colors[Math.floor(Math.random() * colors.length)]};animation-duration:${0.5 + Math.random() * 0.6}s;animation-delay:0s;`;
    document.body.appendChild(spark);
    setTimeout(() => spark.remove(), 900);
}

if (window.innerWidth > 768) {
    setInterval(spawnSpark, 40);
}

// ============================================================
// CONFETTI
// ============================================================
function launchConfetti() {
    const area = document.getElementById('success-confetti-area');
    if (!area) return;
    const colors = ['#F4B400', '#FF7A00', '#D62828', '#2196F3', '#4CAF50'];
    for (let i = 0; i < 16; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        const x     = (Math.random() - 0.5) * 200;
        const delay = Math.random() * 0.5;
        piece.style.cssText = `background:${colors[i % colors.length]};left:calc(50% + ${x}px);top:0;animation-delay:${delay}s;`;
        area.appendChild(piece);
        setTimeout(() => piece.remove(), 1500);
    }
}

// ============================================================
// HELPERS
// ============================================================
function formatCurrency(val) {
    return 'R$ ' + Number(val).toFixed(2)
        .replace('.', ',')
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function formatDate(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}
function togglePass(id) {
    const el = document.getElementById(id);
    if (el) el.type = el.type === 'password' ? 'text' : 'password';
}
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}
function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.7' : '1';
    if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.textContent = '⏳ Aguarde...';
    } else {
        btn.textContent = btn.dataset.originalText || btn.textContent;
    }
}