import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. Supabase Initialization
const SUPABASE_URL = 'https://ihgibjxqfmixeycngoje.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6m5Uqcf9ESDYvjDYJzit9Q_M2ppw65S';
const ADMIN_EMAIL_LIMIT = 'eng.daniel.nascimento@gmail.com';

// Web Push (VAPID) — cole aqui a sua CHAVE PÚBLICA VAPID.
// Gere com:  npx web-push generate-vapid-keys
// A chave PRIVADA vai como segredo da Edge Function (veja SETUP_NOTIFICACOES_E_PRESENCA.md).
// Enquanto estiver vazia, o push (app fechado) fica desativado — as notificações em
// primeiro plano (app aberto) continuam funcionando normalmente.
const VAPID_PUBLIC_KEY = '';

// Usuário é considerado "online" se foi visto nos últimos 2 minutos.
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 2. DOM Elements
const authContainer = document.getElementById('auth-container');
const dashboardContainer = document.getElementById('dashboard-container');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const authError = document.getElementById('auth-error');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const adminEmailDisplay = document.getElementById('admin-email-display');
const adminAvatar = document.getElementById('admin-avatar');
const searchInput = document.getElementById('search-input');
const moduleFilterSelect = document.getElementById('module-filter');
const sortSelect = document.getElementById('sort-select');
const statsIndex = document.getElementById('stats-index');
const btnClearFilter = document.getElementById('btn-clear-filter');
const resultCount = document.getElementById('result-count');
const profilesList = document.getElementById('profiles-list');
const emptyState = document.getElementById('empty-state');
const toastContainer = document.getElementById('toast-container');
const alertsContainer = document.getElementById('alerts-container');

// Navegação
const navItems = document.querySelectorAll('.nav-item');
const navBadgePending = document.getElementById('nav-badge-pending');
const navCountModules = document.getElementById('nav-count-modules');
const viewTitle = document.getElementById('view-title');
const viewSubtitle = document.getElementById('view-subtitle');
const livePill = document.getElementById('live-pill');
const btnRefresh = document.getElementById('btn-refresh');
const btnNewModule = document.getElementById('btn-new-module');

// Drawer (detalhes do usuário)
const drawer = document.getElementById('user-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerHeader = document.getElementById('drawer-header');
const drawerAccess = document.getElementById('drawer-access');
const drawerModules = document.getElementById('drawer-modules');
const drawerModulesTools = document.getElementById('drawer-modules-tools');
const drawerLicense = document.getElementById('drawer-license');
const drawerActivity = document.getElementById('drawer-activity');
const drawerDanger = document.getElementById('drawer-danger');
const editUserForm = document.getElementById('edit-user-form');
const editUserNameInput = document.getElementById('edit-user-name');
const editUserCompanyInput = document.getElementById('edit-user-company');
const editUserGroupInput = document.getElementById('edit-user-group');

// Módulos (catálogo)
const modulesList = document.getElementById('modules-list');
const modulesEmpty = document.getElementById('modules-empty');
const modulesNotice = document.getElementById('modules-notice');
const moduleModal = document.getElementById('module-modal');
const moduleForm = document.getElementById('module-form');
const moduleModalTitle = document.getElementById('module-modal-title');
const moduleIconInput = document.getElementById('module-icon');
const moduleNameInput = document.getElementById('module-name');
const moduleKeyInput = document.getElementById('module-key');
const moduleDescriptionInput = document.getElementById('module-description');
const moduleOrderInput = document.getElementById('module-order');
const moduleDefaultInput = document.getElementById('module-default');
const btnCloseModuleModal = document.getElementById('btn-close-module-modal');
const btnCancelModule = document.getElementById('btn-cancel-module');
const btnSaveModule = document.getElementById('btn-save-module');

// 3. Constants and App State
const TRIAL_DAYS = 14;
const DAY_MS = 86400000;
// Rótulos amigáveis dos planos de assinatura (Stripe → painel).
const PLAN_LABELS = { mensal: 'Mensal', semestral: 'Semestral', anual: 'Anual' };
// Duração de cada plano em dias — usada só para desenhar a barra de validade.
const PLAN_DAYS = { mensal: 30, semestral: 182, anual: 365 };
const VIEWS = {
  users:   { title: 'Usuários', subtitle: 'Aprovação, licenças e acesso aos módulos' },
  modules: { title: 'Módulos',  subtitle: 'Catálogo de módulos do SimCrane Pro e quem tem acesso' }
};
let profiles = [];
let modules = [];
// false quando a tabela app_modules ainda não existe (migração 0004 não rodada).
let modulesAvailable = true;
let profilesLoaded = false;
// Filtro ativo do índice (null = mostra todos). Um dos: trial, expired, licensed, pending, accessed.
let statusFilter = null;
// Filtro por módulo: '' = todos, '__none__' = sem nenhum módulo, ou a chave do módulo.
let moduleFilter = '';
let sortBy = 'name';
let currentView = 'users';
let drawerUserId = null;
// Detecta quando a seção de licença do drawer precisa ser redesenhada sem
// apagar uma data que o admin está digitando.
let drawerLicenseKey = '';
let editingModuleKey = null;
let currentUser = null;
let profilesSubscription = null;
let modulesSubscription = null;
let modulesLoaded = false;
let refetchTimer = null;
let modulesRefetchTimer = null;
let presenceTimer = null;
const notifiedUsers = new Set();
const lastStatValues = new Map();

// 4. Utility Functions
// Escapa texto vindo do banco antes de interpolar em innerHTML. Nome, empresa e
// grupo são editáveis pelo próprio usuário, então sem isso viram XSS no painel.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

// Data local (yyyy-mm-dd) para o <input type="date">. Usar o trecho UTC da ISO
// mostra o dia seguinte para licenças gravadas como 23:59:59 no horário local.
const toDateInputValue = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  // Format as dd/mm/yyyy
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} às ${hh}:${min}`;
};

// Presence / Activity helpers
const isOnline = (p) =>
  !!p.last_seen_at && (Date.now() - new Date(p.last_seen_at).getTime()) < ONLINE_THRESHOLD_MS;

// Formata segundos acumulados como "12h 30m", "45m" ou "—".
const fmtDuration = (seconds) => {
  const s = Number(seconds) || 0;
  if (s <= 0) return '—';
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${m > 0 ? ' ' + m + 'm' : ''}`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

// "agora", "há 5 min", "há 2 h", "há 3 d".
const fmtRelative = (iso) => {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60 * 1000) return 'agora';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
};

// Cor estável do avatar a partir do id do usuário.
const hueFor = (id) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
};

const getStatus = (p) => {
  if (p.role === 'admin') return { key: 'admin', label: 'Admin' };
  if (!p.approved) return { key: 'pending', label: 'Acesso Pendente' };

  const now = Date.now();
  const licEnd = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
  if (licEnd && now < licEnd) {
    const days = Math.max(0, Math.ceil((licEnd - now) / DAY_MS));
    return { key: 'licensed', label: 'Licença ativa', days };
  }

  const trialEnd = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : 0;
  if (trialEnd && now < trialEnd) {
    const days = Math.max(0, Math.ceil((trialEnd - now) / DAY_MS));
    return { key: 'trial', label: `Em teste (${days}d)`, days };
  }

  return { key: 'expired', label: 'Trial Vencido' };
};

const STATUS_BADGE = {
  admin: 'badge-admin', pending: 'badge-pending', licensed: 'badge-licensed',
  trial: 'badge-trial', expired: 'badge-expired'
};

// Trial aprovado, sem licença paga, terminando em até 3 dias?
const isTrialExpiringSoon = (p) => {
  if (!p.approved || p.role === 'admin' || !p.trial_ends_at) return false;
  const licEnd = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
  if (licEnd && Date.now() < licEnd) return false; // Has active paid license
  const diff = new Date(p.trial_ends_at).getTime() - Date.now();
  return diff > 0 && diff <= 3 * DAY_MS;
};

// Dados da barra de validade do card: quanto falta do período atual.
const getValidity = (p, status) => {
  if (status.key === 'licensed') {
    const total = PLAN_DAYS[p.plan] || 365;
    return {
      label: `Licença até <strong>${fmtDate(p.access_expires_at)}</strong>`,
      right: `${status.days} dia(s)`,
      pct: Math.min(100, (status.days / total) * 100),
      color: 'var(--success-color)'
    };
  }
  if (status.key === 'trial') {
    return {
      label: `Teste até <strong>${fmtDate(p.trial_ends_at)}</strong>`,
      right: `${status.days} dia(s)`,
      pct: Math.min(100, (status.days / TRIAL_DAYS) * 100),
      color: status.days <= 3 ? 'var(--accent-color)' : 'var(--info-color)'
    };
  }
  if (status.key === 'expired') {
    const end = p.access_expires_at || p.trial_ends_at;
    return {
      label: end ? `Venceu em <strong>${fmtDate(end)}</strong>` : 'Sem período ativo',
      right: '0 dia',
      pct: 0,
      color: 'var(--danger-color)'
    };
  }
  return null;
};

// Data de término relevante (para ordenar por "validade mais próxima").
const activeEndTime = (p) => {
  const status = getStatus(p);
  if (status.key === 'licensed') return new Date(p.access_expires_at).getTime();
  if (status.key === 'trial') return new Date(p.trial_ends_at).getTime();
  return Infinity;
};

// Um usuário "já acessou o app" se tem login registrado ou já foi visto online.
const hasAccessed = (p) => !!p.last_login_at || !!p.last_seen_at || (Number(p.total_online_seconds) || 0) > 0;

const userModules = (p) => Array.isArray(p.modules) ? p.modules : [];

// Cards do índice (clicáveis). A ordem define a exibição da esquerda para a direita.
const STAT_CARDS = [
  { key: 'trial',    label: 'Em teste',              icon: '🧪', cls: 'stat-trial' },
  { key: 'expired',  label: 'Trial vencido',         icon: '⌛', cls: 'stat-expired' },
  { key: 'licensed', label: 'Licença ativa',         icon: '🔑', cls: 'stat-licensed' },
  { key: 'pending',  label: 'Aguardando aprovação',  icon: '🔔', cls: 'stat-pending' },
  { key: 'accessed', label: 'Já acessaram o app',    icon: '👥', cls: 'stat-accessed' },
];

// Um perfil pertence a uma categoria do índice? (Admins não entram nas contagens.)
const matchesStatFilter = (p, key) => {
  if (p.role === 'admin') return false;
  if (key === 'accessed') return hasAccessed(p);
  return getStatus(p).key === key;
};

const matchesModuleFilter = (p, key) => {
  if (!key) return true;
  if (p.role === 'admin') return false;
  if (key === '__none__') return userModules(p).length === 0;
  return userModules(p).includes(key);
};

// Contador animado (de valor anterior até o novo).
const animateCount = (el, from, to) => {
  if (from === to) { el.textContent = to; return; }
  const start = performance.now();
  const duration = 600;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// Toast Notifications
const showToast = (message, type = 'success', duration = 4000) => {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  toastContainer.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);
};

// Notification Helpers
// Usa o Service Worker (registration.showNotification) quando disponível — funciona no
// Android/Chrome e em PWAs instalados. Cai para `new Notification()` só como último recurso.
const sendNotification = async (title, body) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        icon: './icons/icon.svg',
        badge: './icons/icon.svg',
        tag: 'simcrane-pending',
        renotify: true
      });
      return;
    }
    new Notification(title, { body, icon: './icons/icon.svg' });
  } catch (err) {
    console.error('Failed to trigger notification:', err);
  }
};

// Converte a chave VAPID (base64 url-safe) para Uint8Array, exigido pelo PushManager.
const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
};

// Registra a inscrição de Web Push deste admin e salva no Supabase para que a
// Edge Function consiga enviar notificações mesmo com o app fechado.
const setupPushSubscription = async () => {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Push] VAPID_PUBLIC_KEY não configurada — push (app fechado) desativado.');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] Navegador não suporta Web Push.');
    return;
  }
  if (Notification.permission !== 'granted' || !currentUser) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const json = sub.toJSON();
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: currentUser.id,
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth
      }, { onConflict: 'endpoint' });
    if (error) throw error;
    console.log('[Push] Inscrição registrada com sucesso.');
  } catch (err) {
    console.error('[Push] Falha ao registrar inscrição:', err);
  }
};

// Pede permissão de notificação e, se concedida, registra o Web Push.
const ensureNotificationsAndPush = async () => {
  if (!('Notification' in window)) return;
  let perm = Notification.permission;
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
  }
  if (perm === 'granted') await setupPushSubscription();
};

const updatePageTitle = () => {
  const pending = profiles.filter(p => !p.approved && p.role !== 'admin').length;
  document.title = pending > 0
    ? `(${pending}) SimCrane User - Gerenciamento`
    : 'SimCrane User - Gerenciamento';
};

// Alerts & Expiring Trials Check
const checkUserAlerts = () => {
  if (!alertsContainer) return;

  const pendingUsers = profiles.filter(p => !p.approved && p.role !== 'admin');
  const expiringUsers = profiles.filter(isTrialExpiringSoon);

  alertsContainer.innerHTML = '';
  updatePageTitle();

  if (pendingUsers.length === 0 && expiringUsers.length === 0) {
    alertsContainer.style.display = 'none';
    return;
  }

  alertsContainer.style.display = 'flex';

  // 1. Pending users alert
  if (pendingUsers.length > 0) {
    const names = pendingUsers.map(u => `<strong>${escapeHtml(u.full_name || 'Sem Nome')}</strong>`).join(', ');
    const alert = document.createElement('div');
    alert.className = 'alert-banner';
    alert.innerHTML = `
      <span class="alert-banner-icon">🔔</span>
      <div class="alert-banner-text">
        ${pendingUsers.length === 1
          ? `${names} aguarda aprovação de acesso!`
          : `${pendingUsers.length} usuários aguardam aprovação: ${names}`}
      </div>
    `;
    alertsContainer.appendChild(alert);

    // System notification
    pendingUsers.forEach(u => {
      if (!notifiedUsers.has(u.id)) {
        notifiedUsers.add(u.id);
        sendNotification('Aprovação Pendente', `O usuário ${u.full_name || 'Sem Nome'} aguarda aprovação de acesso.`);
      }
    });
  }

  // 2. Expiring trials alert
  if (expiringUsers.length > 0) {
    const alert = document.createElement('div');
    alert.className = 'alert-banner alert-banner-danger';
    alert.innerHTML = `
      <span class="alert-banner-icon">⚠️</span>
      <div class="alert-banner-text">
        Há <strong>${expiringUsers.length}</strong> usuário(s) com período de teste vencendo em menos de 3 dias!
      </div>
    `;
    alertsContainer.appendChild(alert);

    // System notification
    expiringUsers.forEach(u => {
      if (!notifiedUsers.has(u.id)) {
        notifiedUsers.add(u.id);
        const trialEnd = new Date(u.trial_ends_at).getTime();
        const days = Math.max(1, Math.ceil((trialEnd - Date.now()) / DAY_MS));
        sendNotification('Teste Expirando', `O trial de ${u.full_name || 'Sem Nome'} expira em ${days} dia(s).`);
      }
    });
  }
};

// Recarrega a lista com debounce, coalescendo rajadas de eventos (ex.: heartbeats).
const scheduleRefetch = () => {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(fetchProfiles, 800);
};

const scheduleModulesRefetch = () => {
  clearTimeout(modulesRefetchTimer);
  modulesRefetchTimer = setTimeout(fetchModules, 500);
};

// Supabase Real-time Subscription Helpers
const subscribeToProfiles = () => {
  if (profilesSubscription) return;
  profilesSubscription = supabase
    .channel('profiles-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
      console.log('Realtime profile update:', payload);
      // Trigger instant warning for new signups
      if (payload.eventType === 'INSERT' && !payload.new.approved) {
        const userName = payload.new.full_name || 'Novo usuário';
        showToast(`🔔 ${escapeHtml(userName)} aguarda aprovação de acesso!`, 'warning', 7000);
        sendNotification('Aprovação Pendente', `${userName} acabou de solicitar acesso ao SimCrane.`);
      }
      // Heartbeats geram muitos UPDATEs — agrupa as recargas para não martelar o banco.
      scheduleRefetch();
    })
    .subscribe((status) => {
      livePill.classList.toggle('is-live', status === 'SUBSCRIBED');
    });
};

// Canal separado para o catálogo: só é aberto depois que a tabela app_modules
// existe, para não derrubar o realtime de perfis antes da migração 0004.
const subscribeToModules = () => {
  if (modulesSubscription) return;
  modulesSubscription = supabase
    .channel('modules-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_modules' }, scheduleModulesRefetch)
    .subscribe();
};

const unsubscribeFromProfiles = () => {
  if (profilesSubscription) {
    supabase.removeChannel(profilesSubscription);
    profilesSubscription = null;
  }
  if (modulesSubscription) {
    supabase.removeChannel(modulesSubscription);
    modulesSubscription = null;
  }
  livePill.classList.remove('is-live');
};

// 5. Auth and Session Management
const checkSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    showLogin();
    return;
  }

  try {
    const user = session.user;
    // Query profile role
    const { data: profile, error: pError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (pError || !profile || profile.role !== 'admin') {
      console.warn('Blocked non-admin email:', user.email);
      await supabase.auth.signOut();
      showLogin('Acesso negado: Esta conta não possui privilégios de administrador.');
      return;
    }

    // Logged in as admin
    currentUser = user;
    // Atualiza last_seen_at ao restaurar sessão existente (sem alterar last_login_at)
    supabase.rpc('record_heartbeat', { p_delta: 0 }).then(null, err => console.warn('[Presence] record_heartbeat (restore) falhou:', err));
    showDashboard();
  } catch (err) {
    console.error('Session check failed', err);
    showLogin('Erro ao verificar sessão.');
  }
};

const handleLogin = async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  authError.style.display = 'none';
  btnLogin.disabled = true;
  btnLogin.innerHTML = '<div class="spinner"></div>';

  try {
    // Authenticate
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    // Verify admin role
    const { data: profile, error: pError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (pError || !profile || profile.role !== 'admin') {
      await supabase.auth.signOut();
      throw new Error('Acesso negado: Apenas administradores podem entrar.');
    }

    currentUser = data.user;
    // Registra horário de login e inicializa last_seen_at no banco
    supabase.rpc('record_login').then(null, err => console.warn('[Presence] record_login falhou:', err));
    showToast('Login realizado com sucesso!');
    showDashboard();
  } catch (err) {
    console.error('Erro de login:', err);
    authError.textContent = err.message || 'E-mail ou senha incorretos.';
    authError.style.display = 'block';
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Entrar';
  }
};

const handleLogout = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast('Erro ao sair: ' + error.message, 'error');
  } else {
    unsubscribeFromProfiles();
    clearInterval(presenceTimer);
    clearTimeout(refetchTimer);
    clearTimeout(modulesRefetchTimer);
    closeDrawer();
    notifiedUsers.clear();
    lastStatValues.clear();
    currentUser = null;
    profiles = [];
    modules = [];
    profilesLoaded = false;
    modulesLoaded = false;
    showLogin();
    showToast('Você saiu do aplicativo.');
  }
};

const showLogin = (msg = '') => {
  authContainer.style.display = 'flex';
  dashboardContainer.style.display = 'none';
  if (msg) {
    authError.textContent = msg;
    authError.style.display = 'block';
  } else {
    authError.style.display = 'none';
  }
  // Clear forms
  passwordInput.value = '';
};

const showDashboard = () => {
  authContainer.style.display = 'none';
  dashboardContainer.style.display = 'block';
  const email = currentUser?.email || ADMIN_EMAIL_LIMIT;
  adminEmailDisplay.textContent = email;
  adminAvatar.textContent = email[0].toUpperCase();
  setView(location.hash === '#modulos' ? 'modules' : 'users', { push: false });
  ensureNotificationsAndPush();
  subscribeToProfiles();
  fetchModules();
  fetchProfiles();
  // A cada 60 s: envia heartbeat ao banco (atualiza last_seen_at + acumula segundos)
  // e re-renderiza para manter "online / visto há..." em dia mesmo sem novos eventos.
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (!currentUser) return;
    supabase.rpc('record_heartbeat', { p_delta: 60 })
      .then(null, err => console.warn('[Presence] record_heartbeat falhou:', err));
    if (profiles.length) renderAll();
  }, 60000);
};

// Troca entre as abas Usuários / Módulos.
const setView = (view, { push = true } = {}) => {
  currentView = view;
  navItems.forEach(item => item.classList.toggle('is-active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach(sec => sec.classList.toggle('is-active', sec.id === `view-${view}`));
  viewTitle.textContent = VIEWS[view].title;
  viewSubtitle.textContent = VIEWS[view].subtitle;
  btnNewModule.hidden = view !== 'modules' || !modulesAvailable;
  if (push) history.replaceState(null, '', location.pathname + location.search + (view === 'modules' ? '#modulos' : ''));
  if (view === 'modules') renderModulesView({ animate: true });
  else renderProfiles({ animate: true });
};

// 6. Data Loading
const fetchProfiles = async () => {
  if (!profilesLoaded) renderSkeleton();

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true });

    if (error) {
      throw error;
    }

    const firstLoad = !profilesLoaded;
    profiles = data || [];
    profilesLoaded = true;
    renderAll({ animate: firstLoad });
    checkUserAlerts();
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    showToast('Erro ao carregar usuários. Verifique a conexão.', 'error');
    if (!profilesLoaded) profilesList.innerHTML = '';
  }
};

// Tabela inexistente: PostgREST responde PGRST205 (ou 42P01 do Postgres).
const isMissingTable = (error) =>
  error && (error.code === 'PGRST205' || error.code === '42P01' || /app_modules/.test(error.message || '') && /not find|does not exist/.test(error.message || ''));

const fetchModules = async () => {
  try {
    const { data, error } = await supabase
      .from('app_modules')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    modules = data || [];
    modulesAvailable = true;
    subscribeToModules();
  } catch (err) {
    modules = [];
    modulesAvailable = !isMissingTable(err);
    if (modulesAvailable) {
      console.error('Erro ao buscar módulos:', err);
      showToast('Erro ao carregar módulos.', 'error');
    }
  }
  modulesLoaded = true;
  btnNewModule.hidden = currentView !== 'modules' || !modulesAvailable;
  renderModuleFilterOptions();
  renderAll();
};

const refreshAll = async () => {
  btnRefresh.classList.add('is-spinning');
  await Promise.all([fetchModules(), fetchProfiles()]);
  btnRefresh.classList.remove('is-spinning');
};

// 7. Profiles CRUD Operations
// Aplica alterações no perfil. Retorna true em caso de sucesso.
const patchProfile = async (profileId, changes, successMsg = 'Usuário atualizado com sucesso!') => {
  const card = profilesList.querySelector(`[data-id="${profileId}"]`);
  card?.classList.add('is-busy');
  const drawerButtons = drawerUserId === profileId ? drawer.querySelectorAll('button, input') : [];
  drawerButtons.forEach(b => b.disabled = true);

  try {
    const { error } = await supabase
      .from('profiles')
      .update(changes)
      .eq('id', profileId);

    if (error) throw error;

    // Update local state
    profiles = profiles.map(p => p.id === profileId ? { ...p, ...changes } : p);
    if (successMsg) showToast(successMsg);
    return true;
  } catch (err) {
    console.error('Erro ao salvar alterações:', err);
    showToast('Erro ao salvar alterações.', 'error');
    return false;
  } finally {
    drawerButtons.forEach(b => b.disabled = false);
    renderAll();
    checkUserAlerts();
  }
};

const toggleApproval = (p) => {
  if (p.approved) {
    patchProfile(p.id, { approved: false }, 'Acesso bloqueado.');
  } else {
    const changes = { approved: true };
    if (!p.trial_started_at) {
      const now = new Date();
      changes.trial_started_at = now.toISOString();
      changes.trial_ends_at = new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString();
    }
    patchProfile(p.id, changes, 'Acesso aprovado! ✅');
  }
};

const extendTrial = (p) => {
  const base = Math.max(Date.now(), p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : 0);
  const changes = {
    trial_started_at: p.trial_started_at || new Date().toISOString(),
    trial_ends_at: new Date(base + TRIAL_DAYS * DAY_MS).toISOString()
  };
  patchProfile(p.id, changes, `Teste estendido em ${TRIAL_DAYS} dias.`);
};

const saveLicense = (p, dateString) => {
  if (!dateString) {
    showToast('Escolha uma data de validade.', 'warning');
    return;
  }
  // Interpret as end of local day
  const iso = new Date(`${dateString}T23:59:59`).toISOString();
  patchProfile(p.id, { access_expires_at: iso }, 'Licença salva.');
};

const clearLicense = (p) => {
  patchProfile(p.id, { access_expires_at: null }, 'Licença removida.');
};

// Liga/desliga um módulo para o usuário.
const setUserModule = (p, key, enabled) => {
  const current = userModules(p);
  const next = enabled
    ? [...new Set([...current, key])]
    : current.filter(k => k !== key);
  const mod = modules.find(m => m.key === key);
  const name = escapeHtml(mod?.name || key);
  patchProfile(p.id, { modules: next }, enabled ? `Módulo <strong>${name}</strong> liberado.` : `Módulo <strong>${name}</strong> removido.`);
};

const setAllUserModules = (p, enabled) => {
  const next = enabled ? modules.map(m => m.key) : [];
  patchProfile(p.id, { modules: next }, enabled ? 'Todos os módulos liberados.' : 'Todos os módulos removidos.');
};

const deleteUser = async (p) => {
  if (confirm(`Tem certeza que deseja excluir o usuário "${p.full_name || 'Sem Nome'}" permanentemente? Esta ação removerá a conta do banco de dados.`)) {
    const card = profilesList.querySelector(`[data-id="${p.id}"]`);
    card?.classList.add('is-busy');

    try {
      const { error } = await supabase.rpc('delete_user', { user_id: p.id });
      if (error) {
        if (error.message.includes('function') && (error.message.includes('does not exist') || error.code === '42883')) {
          throw new Error('Função "delete_user" não instalada no banco. Por favor, execute o script SQL nas configurações do Supabase.');
        }
        throw error;
      }

      // Remove from local array
      profiles = profiles.filter(item => item.id !== p.id);
      if (drawerUserId === p.id) closeDrawer();
      renderAll();
      showToast('Usuário excluído com sucesso!');
    } catch (err) {
      console.error('Erro ao excluir usuário:', err);
      showToast(escapeHtml(err.message || 'Erro ao excluir usuário.'), 'error');
      card?.classList.remove('is-busy');
    }
  }
};

const handleEditUserSubmit = async (e) => {
  e.preventDefault();
  if (!drawerUserId) return;
  await patchProfile(drawerUserId, {
    full_name: editUserNameInput.value.trim(),
    company_name: editUserCompanyInput.value.trim() || null,
    user_group: editUserGroupInput.value.trim() || null
  }, 'Dados do usuário salvos.');
};

// 8. Modules CRUD Operations
const openModuleModal = (mod = null) => {
  editingModuleKey = mod?.key || null;
  moduleModalTitle.textContent = mod ? 'Editar módulo' : 'Novo módulo';
  moduleIconInput.value = mod?.icon || '';
  moduleNameInput.value = mod?.name || '';
  moduleKeyInput.value = mod?.key || '';
  moduleKeyInput.disabled = !!mod;
  delete moduleKeyInput.dataset.touched;
  moduleDescriptionInput.value = mod?.description || '';
  moduleOrderInput.value = mod ? mod.sort_order : (modules.reduce((max, m) => Math.max(max, m.sort_order), -1) + 1);
  moduleDefaultInput.checked = mod ? !!mod.default_enabled : true;
  moduleModal.style.display = 'flex';
  setTimeout(() => moduleNameInput.focus(), 50);
};

const closeModuleModal = () => {
  moduleModal.style.display = 'none';
  editingModuleKey = null;
  moduleForm.reset();
};

// Sugere a chave a partir do nome ("Simulador 3D" → "simulador-3d").
const slugify = (text) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const handleModuleSubmit = async (e) => {
  e.preventDefault();
  const payload = {
    name: moduleNameInput.value.trim(),
    icon: moduleIconInput.value.trim() || null,
    description: moduleDescriptionInput.value.trim() || null,
    sort_order: parseInt(moduleOrderInput.value, 10) || 0,
    default_enabled: moduleDefaultInput.checked,
    updated_at: new Date().toISOString()
  };
  btnSaveModule.disabled = true;
  try {
    let error;
    if (editingModuleKey) {
      ({ error } = await supabase.from('app_modules').update(payload).eq('key', editingModuleKey));
    } else {
      const key = moduleKeyInput.value.trim();
      if (modules.some(m => m.key === key)) throw new Error(`Já existe um módulo com a chave "${key}".`);
      ({ error } = await supabase.from('app_modules').insert({ ...payload, key }));
    }
    if (error) throw error;
    showToast(editingModuleKey ? 'Módulo atualizado.' : `Módulo <strong>${escapeHtml(payload.name)}</strong> criado.`);
    closeModuleModal();
    await fetchModules();
  } catch (err) {
    console.error('Erro ao salvar módulo:', err);
    showToast(escapeHtml(err.message || 'Erro ao salvar módulo.'), 'error');
  } finally {
    btnSaveModule.disabled = false;
  }
};

const deleteModule = async (mod) => {
  if (!confirm(`Excluir o módulo "${mod.name}"? Ele será removido de todos os usuários.`)) return;
  try {
    const { error } = await supabase.from('app_modules').delete().eq('key', mod.key);
    if (error) throw error;
    if (moduleFilter === mod.key) moduleFilter = '';
    showToast('Módulo excluído.');
    await Promise.all([fetchModules(), fetchProfiles()]);
  } catch (err) {
    console.error('Erro ao excluir módulo:', err);
    showToast(escapeHtml(err.message || 'Erro ao excluir módulo.'), 'error');
  }
};

// Libera ou remove um módulo de todos os usuários (exceto admins).
const setModuleForAll = async (mod, enabled) => {
  const msg = enabled
    ? `Liberar "${mod.name}" para TODOS os usuários?`
    : `Remover "${mod.name}" de TODOS os usuários?`;
  if (!confirm(msg)) return;
  try {
    const { data, error } = await supabase.rpc('set_module_for_all', { p_key: mod.key, p_enabled: enabled });
    if (error) throw error;
    showToast(`${escapeHtml(mod.name)}: ${data ?? 0} usuário(s) ${enabled ? 'liberados' : 'removidos'}.`);
    await fetchProfiles();
  } catch (err) {
    console.error('Erro na ação em massa:', err);
    showToast(escapeHtml(err.message || 'Erro ao aplicar a todos.'), 'error');
  }
};

// 9. Rendering Logic
const renderAll = ({ animate = false } = {}) => {
  renderNav();
  if (currentView === 'users') renderProfiles({ animate });
  else renderModulesView({ animate });
  refreshDrawer();
};

const renderNav = () => {
  const pending = profiles.filter(p => !p.approved && p.role !== 'admin').length;
  navBadgePending.hidden = pending === 0;
  navBadgePending.textContent = pending;
  navCountModules.textContent = modulesAvailable && modules.length ? modules.length : '';
};

const renderSkeleton = () => {
  emptyState.style.display = 'none';
  profilesList.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
};

const renderModuleFilterOptions = () => {
  if (!modules.some(m => m.key === moduleFilter) && moduleFilter !== '__none__') moduleFilter = '';
  moduleFilterSelect.hidden = !modulesAvailable || modules.length === 0;
  moduleFilterSelect.innerHTML = `
    <option value="">Todos os módulos</option>
    ${modules.map(m => `<option value="${escapeHtml(m.key)}">${escapeHtml(m.icon || '🧩')} ${escapeHtml(m.name)}</option>`).join('')}
    <option value="__none__">Sem nenhum módulo</option>
  `;
  moduleFilterSelect.value = moduleFilter;
};

// Renderiza o índice de totais (cards clicáveis). O card ativo fica destacado e,
// ao ser clicado novamente, limpa o filtro.
const renderStats = ({ animate = false } = {}) => {
  if (!statsIndex) return;
  statsIndex.innerHTML = '';
  const totalUsers = profiles.filter(p => p.role !== 'admin').length;

  STAT_CARDS.forEach((card, i) => {
    const count = profiles.filter(p => matchesStatFilter(p, card.key)).length;
    const share = totalUsers ? Math.round((count / totalUsers) * 100) : 0;
    const isActive = statusFilter === card.key;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `stat-card ${card.cls}${isActive ? ' is-active' : ''}`;
    if (animate) btn.style.animationDelay = `${i * 50}ms`;
    else btn.style.animation = 'none';
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.title = isActive ? 'Clique para limpar o filtro' : `Filtrar: ${card.label}`;
    btn.innerHTML = `
      <span class="stat-top">
        <span class="stat-icon">${card.icon}</span>
        <span class="stat-share">${share}%</span>
      </span>
      <span class="stat-value">${count}</span>
      <span class="stat-label">${card.label}</span>
      <span class="stat-bar"><span></span></span>
    `;
    btn.addEventListener('click', () => {
      statusFilter = (statusFilter === card.key) ? null : card.key;
      renderProfiles({ animate: true });
    });
    statsIndex.appendChild(btn);

    const valueEl = btn.querySelector('.stat-value');
    const prev = lastStatValues.has(card.key) ? lastStatValues.get(card.key) : 0;
    animateCount(valueEl, prev, count);
    lastStatValues.set(card.key, count);
    // Anima a barra a partir de 0 no frame seguinte.
    const bar = btn.querySelector('.stat-bar span');
    requestAnimationFrame(() => { bar.style.width = `${share}%`; });
  });
};

const sortProfiles = (list) => {
  const byName = (a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'pt-BR');
  const sorted = [...list];
  if (sortBy === 'recent') {
    sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  } else if (sortBy === 'online') {
    sorted.sort((a, b) => (isOnline(b) - isOnline(a)) ||
      (new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0)) || byName(a, b));
  } else if (sortBy === 'expiring') {
    sorted.sort((a, b) => (activeEndTime(a) - activeEndTime(b)) || byName(a, b));
  } else {
    sorted.sort(byName);
  }
  return sorted;
};

// Badges de status (compartilhado entre card e drawer).
const renderBadges = (p, status) => {
  const isAdmin = p.role === 'admin';
  const planLabel = escapeHtml(PLAN_LABELS[p.plan] || p.plan);
  return `
    <span class="status-badge ${STATUS_BADGE[status.key]}">${status.label}</span>
    ${(!isAdmin && p.plan && status.key === 'licensed') ? `<span class="status-badge badge-plan" title="Assinatura ${planLabel}${p.auto_renew === false ? ' — renovação cancelada' : ' — renova automaticamente'}">${planLabel}${p.auto_renew === false ? ' ⏹' : ' ♻'}</span>` : ''}
    ${(!isAdmin && p.subscription_status === 'past_due') ? '<span class="status-badge badge-pastdue" title="A última cobrança falhou. O acesso vale até a validade atual.">Pagamento pendente</span>' : ''}
    ${(!isAdmin && p.subscription_status === 'canceled' && p.plan) ? '<span class="status-badge badge-canceled" title="Assinatura cancelada. O acesso permanece até o fim do período já pago.">Cancelada</span>' : ''}
    ${(!isAdmin && p.trial_reused) ? '<span class="status-badge badge-reused" title="Este e-mail já usou o período de teste. Não recebe acesso automático — requer aprovação manual.">Reincidente</span>' : ''}
    ${isTrialExpiringSoon(p) ? '<span class="pulse-warning" title="Trial expira em menos de 3 dias!">⚠️</span>' : ''}
  `;
};

const renderPresence = (p) => {
  const online = isOnline(p);
  const seenText = online
    ? 'Online agora'
    : (p.last_seen_at ? `Visto ${fmtRelative(p.last_seen_at)}` : 'Nunca acessou');
  return { online, seenText };
};

const renderModuleChips = (p) => {
  if (!modulesAvailable || modules.length === 0 || p.role === 'admin') return '';
  const enabled = userModules(p);
  const MAX = 6;
  const chips = modules.slice(0, MAX).map(m => {
    const on = enabled.includes(m.key);
    return `<span class="module-chip ${on ? '' : 'is-off'}" title="${escapeHtml(m.name)}: ${on ? 'liberado' : 'bloqueado'}">${escapeHtml(m.icon || '🧩')} ${escapeHtml(m.name)}</span>`;
  }).join('');
  const extra = modules.length > MAX ? `<span class="module-chip">+${modules.length - MAX}</span>` : '';
  return `<div class="module-chips">${chips}${extra}</div>`;
};

const renderProfiles = ({ animate = false } = {}) => {
  if (!profilesLoaded) return;
  renderStats({ animate });
  const filter = searchInput.value.toLowerCase().trim();
  const filtered = sortProfiles(profiles.filter(p => {
    // Filtro do índice: mostra somente a categoria escolhida.
    if (statusFilter && !matchesStatFilter(p, statusFilter)) return false;
    if (!matchesModuleFilter(p, moduleFilter)) return false;

    const nameMatch = (p.full_name || '').toLowerCase().includes(filter);
    const idMatch = p.id.toLowerCase().includes(filter);
    const companyMatch = (p.company_name || '').toLowerCase().includes(filter);
    const groupMatch = (p.user_group || '').toLowerCase().includes(filter);
    const dateMatch = fmtDate(p.created_at).includes(filter) ||
                      fmtDate(p.trial_ends_at).includes(filter) ||
                      fmtDate(p.access_expires_at).includes(filter);

    return nameMatch || idMatch || companyMatch || groupMatch || dateMatch;
  }));

  const hasFilters = !!(statusFilter || moduleFilter || filter);
  btnClearFilter.style.display = hasFilters ? 'inline-flex' : 'none';
  resultCount.textContent = hasFilters
    ? `${filtered.length} de ${profiles.length} usuário(s)`
    : `${profiles.length} usuário(s)`;

  profilesList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  filtered.forEach((p, i) => {
    const isAdmin = p.role === 'admin';
    const status = getStatus(p);
    const { online, seenText } = renderPresence(p);
    const usageText = (p.total_online_seconds && p.total_online_seconds > 0)
      ? ` · ⏱️ ${fmtDuration(p.total_online_seconds)}`
      : '';
    const loginTitle = p.last_login_at ? `Último login: ${fmtDateTime(p.last_login_at)}` : 'Sem login registrado';
    const validity = getValidity(p, status);
    const meta = [
      p.company_name ? `🏢 ${escapeHtml(p.company_name)}` : '',
      p.user_group ? `👥 ${escapeHtml(p.user_group)}` : ''
    ].filter(Boolean).join(' · ') || `ID: ${p.id.substring(0, 8)}…`;

    const card = document.createElement('article');
    card.className = `user-card${status.key === 'pending' ? ' is-pending' : ''}${drawerUserId === p.id ? ' is-selected' : ''}`;
    card.dataset.id = p.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir detalhes de ${p.full_name || 'Sem Nome'}`);
    if (animate) card.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
    else card.style.animation = 'none';
    card.style.setProperty('--hue', hueFor(p.id));

    card.innerHTML = `
      <div class="user-card-head">
        <div class="avatar-wrap">
          <div class="avatar">${escapeHtml((p.full_name || '?')[0].toUpperCase())}</div>
          <span class="avatar-status ${online ? 'is-online' : 'is-offline'}" title="${seenText}"></span>
        </div>
        <div class="user-info">
          <span class="user-name">${escapeHtml(p.full_name || 'Sem Nome')}</span>
          <span class="user-id" title="${p.id}">${meta}</span>
        </div>
        <span class="card-chevron">›</span>
      </div>

      <div class="badges">${renderBadges(p, status)}</div>

      ${validity ? `
        <div class="validity">
          <div class="validity-labels"><span>${validity.label}</span><span>${validity.right}</span></div>
          <div class="progress" style="--bar: ${validity.color}"><span style="width: ${animate ? 0 : validity.pct}%"></span></div>
        </div>
      ` : ''}
      ${status.key === 'pending' ? `
        <div class="validity-note">🕒 Solicitado em ${fmtDateTime(p.created_at)}${p.trial_reused ? '<br>🔁 Já usou teste — aprovação manual' : ''}</div>
      ` : ''}

      ${renderModuleChips(p)}

      <div class="user-card-foot">
        <span class="user-activity ${online ? 'online' : ''}" title="${loginTitle}">
          ${online ? '<span class="online-dot"></span>' : ''}${seenText}${usageText}
        </span>
        <span class="spacer"></span>
        ${isAdmin ? '<span class="foot-meta">Administrador</span>' : ''}
        ${!isAdmin && !p.approved ? '<button type="button" class="btn btn-xs btn-success-outline btn-quick-approve">Aprovar</button>' : ''}
      </div>
    `;

    if (validity && animate) {
      const bar = card.querySelector('.progress span');
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${validity.pct}%`; }));
    }

    card.addEventListener('click', () => openDrawer(p.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(p.id); }
    });
    const btnApprove = card.querySelector('.btn-quick-approve');
    if (btnApprove) {
      btnApprove.addEventListener('click', (e) => { e.stopPropagation(); toggleApproval(p); });
    }

    profilesList.appendChild(card);
  });
};

// ---------- Drawer ----------
const openDrawer = (id) => {
  drawerUserId = id;
  drawerLicenseKey = '';
  renderDrawer({ full: true });
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  drawerBackdrop.classList.add('is-open');
  profilesList.querySelectorAll('.user-card').forEach(c => c.classList.toggle('is-selected', c.dataset.id === id));
  drawer.querySelector('.drawer-close')?.focus();
};

const closeDrawer = () => {
  drawerUserId = null;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  drawerBackdrop.classList.remove('is-open');
  profilesList.querySelectorAll('.user-card.is-selected').forEach(c => c.classList.remove('is-selected'));
};

// Atualiza o drawer aberto quando os dados mudam (realtime / após salvar),
// preservando o que o admin estiver digitando nos formulários.
const refreshDrawer = () => {
  if (!drawerUserId) return;
  if (!profiles.some(p => p.id === drawerUserId)) { closeDrawer(); return; }
  renderDrawer({ full: false });
};

const renderDrawer = ({ full }) => {
  const p = profiles.find(item => item.id === drawerUserId);
  if (!p) return;
  const isAdmin = p.role === 'admin';
  const isSelf = p.id === currentUser?.id;
  const status = getStatus(p);
  const { online, seenText } = renderPresence(p);

  // Cabeçalho
  drawerHeader.style.setProperty('--hue', hueFor(p.id));
  drawerHeader.innerHTML = `
    <button type="button" class="icon-btn drawer-close" title="Fechar">✕</button>
    <div class="drawer-header-main">
      <div class="avatar-wrap" style="--hue: ${hueFor(p.id)}">
        <div class="avatar avatar-lg">${escapeHtml((p.full_name || '?')[0].toUpperCase())}</div>
        <span class="avatar-status ${online ? 'is-online' : 'is-offline'}" title="${seenText}"></span>
      </div>
      <div class="user-info">
        <h2 id="drawer-title">${escapeHtml(p.full_name || 'Sem Nome')}</h2>
        <span class="user-id">${[p.company_name ? `🏢 ${escapeHtml(p.company_name)}` : '', p.user_group ? `👥 ${escapeHtml(p.user_group)}` : ''].filter(Boolean).join(' · ') || 'Sem empresa / grupo'}</span>
        <span class="user-id" title="${p.id}">ID: ${p.id}</span>
      </div>
    </div>
    <div class="badges">${renderBadges(p, status)}</div>
  `;
  drawerHeader.querySelector('.drawer-close').addEventListener('click', closeDrawer);

  // Acesso
  if (isAdmin) {
    drawerAccess.innerHTML = '<div class="muted-box">Administradores têm acesso total ao SimCrane e a todos os módulos.</div>';
  } else {
    drawerAccess.innerHTML = `
      <div class="section-head"><h3>🔐 Acesso</h3></div>
      <div class="btn-grid">
        <button type="button" class="btn btn-small ${p.approved ? 'btn-danger-outline' : 'btn-success-outline'} js-toggle" ${isSelf ? 'disabled' : ''}>
          ${p.approved ? '⛔ Bloquear acesso' : '✅ Aprovar acesso'}
        </button>
        <button type="button" class="btn btn-small btn-info-outline js-extend" ${p.approved ? '' : 'disabled title="Aprove o usuário primeiro"'}>🧪 +${TRIAL_DAYS} dias de teste</button>
      </div>
      ${status.key === 'pending' ? `<p class="validity-note" style="margin-top: 10px;">🕒 Solicitado em ${fmtDateTime(p.created_at)}${p.trial_reused ? ' · 🔁 já usou teste antes' : ''}</p>` : ''}
    `;
    drawerAccess.querySelector('.js-toggle').addEventListener('click', () => toggleApproval(p));
    drawerAccess.querySelector('.js-extend').addEventListener('click', () => extendTrial(p));
  }

  // Módulos
  renderDrawerModules(p);

  // Licença — só redesenha quando os dados relevantes mudam, para não apagar a
  // data que o admin está escolhendo.
  const licenseKey = `${p.id}|${p.approved}|${p.access_expires_at}|${p.trial_ends_at}|${isAdmin}`;
  if (full || licenseKey !== drawerLicenseKey) {
    drawerLicenseKey = licenseKey;
    renderDrawerLicense(p, isAdmin);
  }

  // Atividade
  drawerActivity.innerHTML = `
    <div class="section-head"><h3>📈 Atividade</h3></div>
    <div class="kv-grid">
      <div class="kv"><span>Status</span><strong style="color: ${online ? '#6ee7b7' : 'inherit'}">${seenText}</strong></div>
      <div class="kv"><span>Tempo de uso</span><strong>${fmtDuration(p.total_online_seconds)}</strong></div>
      <div class="kv"><span>Último login</span><strong>${fmtDateTime(p.last_login_at)}</strong></div>
      <div class="kv"><span>Cadastro</span><strong>${fmtDateTime(p.created_at)}</strong></div>
    </div>
  `;

  // Zona de perigo
  if (isAdmin) {
    drawerDanger.innerHTML = '';
  } else {
    drawerDanger.innerHTML = `
      <div class="section-head"><h3>⚠️ Zona de perigo</h3></div>
      <button type="button" class="btn btn-small btn-danger-outline js-delete" style="width: 100%;" ${isSelf ? 'disabled' : ''}>🗑️ Excluir usuário permanentemente</button>
    `;
    drawerDanger.querySelector('.js-delete').addEventListener('click', () => deleteUser(p));
  }

  if (full) {
    editUserNameInput.value = p.full_name || '';
    editUserCompanyInput.value = p.company_name || '';
    editUserGroupInput.value = p.user_group || '';
    drawer.querySelector('.drawer-body').scrollTop = 0;
  }
};

const renderDrawerModules = (p) => {
  drawerModulesTools.innerHTML = '';
  if (p.role === 'admin') {
    drawerModules.innerHTML = '<div class="muted-box">✨ Todos os módulos (administrador).</div>';
    return;
  }
  if (!modulesAvailable) {
    drawerModules.innerHTML = `<div class="muted-box">Para liberar módulos, rode a migração <code>supabase/migrations/0004_user_modules.sql</code> no SQL Editor do Supabase.</div>`;
    return;
  }
  if (modules.length === 0) {
    drawerModules.innerHTML = '<div class="muted-box">Nenhum módulo cadastrado ainda. <button type="button" class="link-btn js-go-modules">Criar módulos →</button></div>';
    drawerModules.querySelector('.js-go-modules').addEventListener('click', () => { closeDrawer(); setView('modules'); });
    return;
  }

  const enabled = userModules(p);
  drawerModulesTools.innerHTML = `
    <button type="button" class="btn btn-xs btn-ghost js-all">Todos</button>
    <button type="button" class="btn btn-xs btn-ghost js-none">Nenhum</button>
  `;
  drawerModulesTools.querySelector('.js-all').addEventListener('click', () => setAllUserModules(p, true));
  drawerModulesTools.querySelector('.js-none').addEventListener('click', () => setAllUserModules(p, false));

  drawerModules.innerHTML = '';
  modules.forEach(m => {
    const on = enabled.includes(m.key);
    const row = document.createElement('label');
    row.className = `switch-row${on ? ' is-on' : ''}`;
    row.innerHTML = `
      <span class="module-icon">${escapeHtml(m.icon || '🧩')}</span>
      <span>
        <strong>${escapeHtml(m.name)}</strong>
        <small>${escapeHtml(m.description || m.key)}</small>
      </span>
      <span class="switch">
        <input type="checkbox" ${on ? 'checked' : ''} aria-label="Liberar ${escapeHtml(m.name)}">
        <span class="switch-track"></span>
      </span>
    `;
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      row.classList.toggle('is-on', input.checked);
      setUserModule(p, m.key, input.checked);
    });
    drawerModules.appendChild(row);
  });
};

const renderDrawerLicense = (p, isAdmin) => {
  if (isAdmin) { drawerLicense.innerHTML = ''; return; }
  drawerLicense.innerHTML = `
    <div class="section-head"><h3>🔑 Validade</h3></div>
    <div class="kv-grid" style="margin-bottom: 12px;">
      <div class="kv"><span>Teste até</span><strong>${fmtDate(p.trial_ends_at)}</strong></div>
      <div class="kv"><span>Licença até</span><strong>${fmtDate(p.access_expires_at)}</strong></div>
    </div>
    ${p.approved ? `
      <div class="license-form">
        <input type="date" class="date-picker" value="${toDateInputValue(p.access_expires_at)}" aria-label="Validade da licença">
        <button type="button" class="btn btn-small btn-primary js-save-license">Salvar</button>
        ${p.access_expires_at ? '<button type="button" class="btn btn-small btn-danger-outline js-clear-license" title="Limpar licença">✕</button>' : ''}
      </div>
      <div class="quick-chips">
        <button type="button" class="btn btn-xs btn-ghost" data-add="30">+30 dias</button>
        <button type="button" class="btn btn-xs btn-ghost" data-add="182">+6 meses</button>
        <button type="button" class="btn btn-xs btn-ghost" data-add="365">+1 ano</button>
      </div>
    ` : '<div class="muted-box">Aprove o usuário para definir a validade da licença.</div>'}
  `;
  if (!p.approved) return;

  const datePicker = drawerLicense.querySelector('.date-picker');
  drawerLicense.querySelector('.js-save-license').addEventListener('click', () => saveLicense(p, datePicker.value));
  drawerLicense.querySelector('.js-clear-license')?.addEventListener('click', () => clearLicense(p));
  // Atalhos: somam a partir da validade atual (ou de hoje) e preenchem a data.
  drawerLicense.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
      const base = Math.max(Date.now(), current);
      datePicker.value = toDateInputValue(new Date(base + Number(btn.dataset.add) * DAY_MS).toISOString());
      datePicker.focus();
    });
  });
};

// ---------- Aba Módulos ----------
const renderModulesView = ({ animate = false } = {}) => {
  if (!modulesLoaded) return;
  if (!modulesAvailable) {
    modulesNotice.style.display = 'block';
    modulesNotice.innerHTML = `
      <strong>Falta um passo no banco.</strong> Rode a migração
      <code>supabase/migrations/0004_user_modules.sql</code> no Supabase
      (Dashboard → SQL Editor → New query → Run) para ativar a liberação de módulos.
    `;
    modulesList.innerHTML = '';
    modulesEmpty.style.display = 'none';
    return;
  }
  modulesNotice.style.display = 'none';
  modulesList.innerHTML = '';
  modulesEmpty.style.display = modules.length ? 'none' : 'block';

  const users = profiles.filter(p => p.role !== 'admin');
  modules.forEach((m, i) => {
    const count = users.filter(p => userModules(p).includes(m.key)).length;
    const pct = users.length ? Math.round((count / users.length) * 100) : 0;
    const card = document.createElement('article');
    card.className = 'module-card';
    if (animate) card.style.animationDelay = `${i * 50}ms`;
    else card.style.animation = 'none';
    card.innerHTML = `
      <div class="module-card-head">
        <div class="module-card-icon">${escapeHtml(m.icon || '🧩')}</div>
        <div>
          <h3>${escapeHtml(m.name)}</h3>
          <span class="module-key">${escapeHtml(m.key)}</span>
        </div>
        ${m.default_enabled ? '<span class="tag-default" title="Liberado automaticamente para novos cadastros">★ Padrão</span>' : ''}
      </div>
      <p class="module-desc">${escapeHtml(m.description || 'Sem descrição.')}</p>
      <div class="module-usage">
        <div class="validity-labels"><span><strong>${count}</strong> de ${users.length} usuário(s) com acesso</span><span>${pct}%</span></div>
        <div class="progress" style="--bar: linear-gradient(90deg, #8b5cf6, #3b82f6)"><span style="width: ${animate ? 0 : pct}%"></span></div>
      </div>
      <div class="module-actions">
        <button type="button" class="btn btn-xs btn-success-outline js-all">Liberar p/ todos</button>
        <button type="button" class="btn btn-xs btn-danger-outline js-none">Remover de todos</button>
        <span style="flex: 1"></span>
        <button type="button" class="btn btn-xs btn-ghost js-users" title="Ver usuários com este módulo">👥</button>
        <button type="button" class="btn btn-xs btn-ghost js-edit">Editar</button>
        <button type="button" class="btn btn-xs btn-danger-outline js-delete" title="Excluir módulo">🗑️</button>
      </div>
    `;
    if (animate) {
      const bar = card.querySelector('.progress span');
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${pct}%`; }));
    }
    card.querySelector('.js-all').addEventListener('click', () => setModuleForAll(m, true));
    card.querySelector('.js-none').addEventListener('click', () => setModuleForAll(m, false));
    card.querySelector('.js-edit').addEventListener('click', () => openModuleModal(m));
    card.querySelector('.js-delete').addEventListener('click', () => deleteModule(m));
    card.querySelector('.js-users').addEventListener('click', () => {
      moduleFilter = m.key;
      moduleFilterSelect.value = m.key;
      setView('users');
    });
    modulesList.appendChild(card);
  });
};

// 10. Event Listeners
loginForm.addEventListener('submit', handleLogin);
btnLogout.addEventListener('click', handleLogout);
searchInput.addEventListener('input', () => renderProfiles());
moduleFilterSelect.addEventListener('change', () => {
  moduleFilter = moduleFilterSelect.value;
  renderProfiles({ animate: true });
});
sortSelect.addEventListener('change', () => {
  sortBy = sortSelect.value;
  renderProfiles({ animate: true });
});
btnClearFilter.addEventListener('click', () => {
  statusFilter = null;
  moduleFilter = '';
  moduleFilterSelect.value = '';
  searchInput.value = '';
  renderProfiles({ animate: true });
});
navItems.forEach(item => item.addEventListener('click', () => setView(item.dataset.view)));
btnRefresh.addEventListener('click', refreshAll);
btnNewModule.addEventListener('click', () => openModuleModal());
drawerBackdrop.addEventListener('click', closeDrawer);
editUserForm.addEventListener('submit', handleEditUserSubmit);
moduleForm.addEventListener('submit', handleModuleSubmit);
btnCloseModuleModal.addEventListener('click', closeModuleModal);
btnCancelModule.addEventListener('click', closeModuleModal);
moduleModal.addEventListener('click', (e) => { if (e.target === moduleModal) closeModuleModal(); });
// Preenche a chave a partir do nome até o admin editar a chave manualmente.
moduleNameInput.addEventListener('input', () => {
  if (!editingModuleKey && !moduleKeyInput.dataset.touched) moduleKeyInput.value = slugify(moduleNameInput.value);
});
moduleKeyInput.addEventListener('input', () => { moduleKeyInput.dataset.touched = '1'; });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (moduleModal.style.display === 'flex') closeModuleModal();
  else if (drawerUserId) closeDrawer();
});

// Initialize App
checkSession();
