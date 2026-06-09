import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. Supabase Initialization
const SUPABASE_URL = 'https://ihgibjxqfmixeycngoje.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5Nnux0U1qyHluC2QJaQ9Yg_L0gtIwIh';
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
const searchInput = document.getElementById('search-input');
const profilesList = document.getElementById('profiles-list');
const dashboardLoading = document.getElementById('dashboard-loading');
const emptyState = document.getElementById('empty-state');
const toastContainer = document.getElementById('toast-container');

// Edit User Modal Elements
const editModal = document.getElementById('edit-modal');
const editUserForm = document.getElementById('edit-user-form');
const editUserIdInput = document.getElementById('edit-user-id');
const editUserNameInput = document.getElementById('edit-user-name');
const editUserCompanyInput = document.getElementById('edit-user-company');
const editUserGroupInput = document.getElementById('edit-user-group');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

// 3. Constants and App State
const TRIAL_DAYS = 14;
const DAY_MS = 86400000;
let profiles = [];
let currentUser = null;
let profilesSubscription = null;
let refetchTimer = null;
let presenceTimer = null;
const notifiedUsers = new Set();
const alertsContainer = document.getElementById('alerts-container');

// 4. Utility Functions
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
  const expiringUsers = profiles.filter(p => {
    if (!p.approved || p.role === 'admin' || !p.trial_ends_at) return false;
    const licEnd = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
    if (licEnd && Date.now() < licEnd) return false; // Has active paid license
    
    const trialEnd = new Date(p.trial_ends_at).getTime();
    const diff = trialEnd - Date.now();
    return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000; // <= 3 days remaining
  });
  
  alertsContainer.innerHTML = '';
  updatePageTitle();

  if (pendingUsers.length === 0 && expiringUsers.length === 0) {
    alertsContainer.style.display = 'none';
    return;
  }

  alertsContainer.style.display = 'flex';

  // 1. Pending users alert
  if (pendingUsers.length > 0) {
    const names = pendingUsers.map(u => `<strong>${u.full_name || 'Sem Nome'}</strong>`).join(', ');
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

// Supabase Real-time Subscription Helpers
const subscribeToProfiles = () => {
  if (profilesSubscription) return;
  profilesSubscription = supabase
    .channel('profiles-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
      console.log('Realtime profile update:', payload);
      // Avisa instantaneamente sobre novos cadastros. Como o período de teste
      // agora é aprovado automaticamente, a mensagem só informa que um novo
      // usuário foi adicionado (não pede mais aprovação).
      if (payload.eventType === 'INSERT' && payload.new.role !== 'admin') {
        const userName = payload.new.full_name || 'Novo usuário';
        showToast(`✅ ${userName} cadastrou-se e já está em período de teste!`, 'success', 7000);
        sendNotification('Novo usuário cadastrado', `${userName} acabou de se cadastrar no SimCrane e já está com o período de teste ativo.`);
      }
      // Heartbeats geram muitos UPDATEs — agrupa as recargas para não martelar o banco.
      scheduleRefetch();
    })
    .subscribe();
};

const unsubscribeFromProfiles = () => {
  if (profilesSubscription) {
    supabase.removeChannel(profilesSubscription);
    profilesSubscription = null;
  }
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
    notifiedUsers.clear();
    currentUser = null;
    profiles = [];
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
  dashboardContainer.style.display = 'flex';
  adminEmailDisplay.textContent = currentUser?.email || ADMIN_EMAIL_LIMIT;
  ensureNotificationsAndPush();
  subscribeToProfiles();
  fetchProfiles();
  // A cada 60 s: envia heartbeat ao banco (atualiza last_seen_at + acumula segundos)
  // e re-renderiza para manter "online / visto há..." em dia mesmo sem novos eventos.
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (!currentUser) return;
    supabase.rpc('record_heartbeat', { p_delta: 60 })
      .then(null, err => console.warn('[Presence] record_heartbeat falhou:', err));
    if (profiles.length) renderProfiles();
  }, 60000);
};

// 6. Profiles CRUD Operations
const fetchProfiles = async () => {
  dashboardLoading.style.display = 'flex';
  profilesList.innerHTML = '';
  emptyState.style.display = 'none';
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true });
      
    if (error) {
      throw error;
    }
    
    profiles = data || [];
    renderProfiles();
    checkUserAlerts();
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    showToast('Erro ao carregar usuários. Verifique a conexão.', 'error');
  } finally {
    dashboardLoading.style.display = 'none';
  }
};

const patchProfile = async (profileId, changes) => {
  // Find current elements in table to show loading/disabled state
  const row = document.querySelector(`tr[data-id="${profileId}"]`);
  const buttons = row ? row.querySelectorAll('button, input') : [];
  buttons.forEach(b => b.disabled = true);
  
  try {
    const { error } = await supabase
      .from('profiles')
      .update(changes)
      .eq('id', profileId);
      
    if (error) throw error;
    
    // Update local state
    profiles = profiles.map(p => p.id === profileId ? { ...p, ...changes } : p);
    renderProfiles();
    showToast('Usuário atualizado com sucesso!');
  } catch (err) {
    console.error('Erro ao salvar alterações:', err);
    showToast('Erro ao salvar alterações.', 'error');
    // Restore button states
    buttons.forEach(b => b.disabled = false);
  }
};

const toggleApproval = (p) => {
  if (p.approved) {
    patchProfile(p.id, { approved: false });
  } else {
    const changes = { approved: true };
    if (!p.trial_started_at) {
      const now = new Date();
      changes.trial_started_at = now.toISOString();
      changes.trial_ends_at = new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString();
    }
    patchProfile(p.id, changes);
  }
};

const extendTrial = (p) => {
  const base = Math.max(Date.now(), p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : 0);
  const changes = {
    trial_started_at: p.trial_started_at || new Date().toISOString(),
    trial_ends_at: new Date(base + TRIAL_DAYS * DAY_MS).toISOString()
  };
  patchProfile(p.id, changes);
};

const saveLicense = (p, dateString) => {
  if (!dateString) return;
  // Interpret as end of local day
  const iso = new Date(`${dateString}T23:59:59`).toISOString();
  patchProfile(p.id, { access_expires_at: iso });
};

const clearLicense = (p) => {
  patchProfile(p.id, { access_expires_at: null });
};

const deleteUser = async (p) => {
  if (confirm(`Tem certeza que deseja excluir o usuário "${p.full_name || 'Sem Nome'}" permanentemente? Esta ação removerá a conta do banco de dados.`)) {
    const row = document.querySelector(`tr[data-id="${p.id}"]`);
    const buttons = row ? row.querySelectorAll('button, input') : [];
    buttons.forEach(b => b.disabled = true);
    
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
      renderProfiles();
      showToast('Usuário excluído com sucesso!');
    } catch (err) {
      console.error('Erro ao excluir usuário:', err);
      showToast(err.message || 'Erro ao excluir usuário.', 'error');
      buttons.forEach(b => b.disabled = false);
    }
  }
};

// Edit User Modal Handlers
const openEditModal = (p) => {
  editUserIdInput.value = p.id;
  editUserNameInput.value = p.full_name || '';
  editUserCompanyInput.value = p.company_name || '';
  editUserGroupInput.value = p.user_group || '';
  editModal.style.display = 'flex';
};

const closeEditModal = () => {
  editModal.style.display = 'none';
  editUserIdInput.value = '';
  editUserNameInput.value = '';
  editUserCompanyInput.value = '';
  editUserGroupInput.value = '';
};

const handleEditUserSubmit = async (e) => {
  e.preventDefault();
  const profileId = editUserIdInput.value;
  const newName = editUserNameInput.value.trim();
  const newCompany = editUserCompanyInput.value.trim();
  const newGroup = editUserGroupInput.value.trim();
  
  if (!profileId) return;
  
  closeEditModal();
  
  await patchProfile(profileId, {
    full_name: newName,
    company_name: newCompany || null,
    user_group: newGroup || null
  });
};

// 7. Rendering Logic
const renderProfiles = () => {
  const filter = searchInput.value.toLowerCase().trim();
  const filtered = profiles.filter(p => {
    const nameMatch = (p.full_name || '').toLowerCase().includes(filter);
    const idMatch = p.id.toLowerCase().includes(filter);
    const companyMatch = (p.company_name || '').toLowerCase().includes(filter);
    const groupMatch = (p.user_group || '').toLowerCase().includes(filter);
    const dateMatch = fmtDate(p.created_at).includes(filter) ||
                      fmtDate(p.trial_ends_at).includes(filter) ||
                      fmtDate(p.access_expires_at).includes(filter);
                      
    return nameMatch || idMatch || companyMatch || groupMatch || dateMatch;
  });
  
  profilesList.innerHTML = '';
  
  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  
  filtered.forEach(p => {
    const isSelf = p.id === currentUser?.id;
    const isAdmin = p.role === 'admin';
    const status = getStatus(p);

    // Presença / atividade
    const online = isOnline(p);
    const seenText = online
      ? 'Online agora'
      : (p.last_seen_at ? `Visto ${fmtRelative(p.last_seen_at)}` : 'Nunca acessou');
    const usageText = (p.total_online_seconds && p.total_online_seconds > 0)
      ? ` · ⏱️ ${fmtDuration(p.total_online_seconds)} de uso`
      : '';
    const loginTitle = p.last_login_at ? `Último login: ${fmtDateTime(p.last_login_at)}` : 'Sem login registrado';
    
    // Check if trial is expiring in less than 3 days
    let isExpiringSoon = false;
    if (p.approved && p.role !== 'admin' && p.trial_ends_at) {
      const licEnd = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
      const isLicensed = licEnd && Date.now() < licEnd;
      if (!isLicensed) {
        const trialEnd = new Date(p.trial_ends_at).getTime();
        const diff = trialEnd - Date.now();
        isExpiringSoon = diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000;
      }
    }
    
    // Status Badge classes
    let statusClass = 'badge-pending';
    if (status.key === 'admin') statusClass = 'badge-admin';
    else if (status.key === 'licensed') statusClass = 'badge-licensed';
    else if (status.key === 'trial') statusClass = 'badge-trial';
    else if (status.key === 'expired') statusClass = 'badge-expired';
    
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    
    // Generate HTML for each user
    tr.innerHTML = `
      <td class="td-name">
        <div class="user-cell">
          <div class="avatar-wrap">
            <div class="avatar">${(p.full_name || '?')[0].toUpperCase()}</div>
            <span class="avatar-status ${online ? 'is-online' : 'is-offline'}" title="${seenText}"></span>
          </div>
          <div class="user-info">
            <span class="user-name">${p.full_name || 'Sem Nome'}</span>
            <span class="user-id" title="${p.id}">
              ID: ${p.id.substring(0, 8)}...
              ${p.company_name ? ` | 🏢 ${p.company_name}` : ''}
              ${p.user_group ? ` | 👥 ${p.user_group}` : ''}
            </span>
            <span class="user-activity ${online ? 'online' : ''}" title="${loginTitle}">
              ${online ? '<span class="online-dot"></span>' : ''}${seenText}${usageText}
            </span>
          </div>
        </div>
      </td>
      
      <td class="td-status">
        <span class="status-badge ${statusClass}">${status.label}</span>
        ${isExpiringSoon ? '<span class="pulse-warning" title="Trial expira em menos de 3 dias!">⚠️</span>' : ''}
      </td>
      
      <td class="td-validity">
        ${isAdmin ? '<span style="color: var(--text-muted);">—</span>' : `
          ${!p.approved ? `
            <div class="validity-cell">
              <div class="validity-row" style="color: var(--accent-color); font-weight: 500;" title="Horário de cadastro e solicitação de aprovação">
                <span>🕒</span> <span>Solicitado em:<br>${fmtDateTime(p.created_at)}</span>
              </div>
            </div>
          ` : `
            <div class="validity-cell">
              <div class="validity-row" title="Término do período de testes">
                <span>🧪</span> <span>${fmtDate(p.trial_ends_at)}</span>
              </div>
              <div class="validity-row" title="Término da licença ativa">
                <span>🔑</span> <span>${fmtDate(p.access_expires_at)}</span>
              </div>
            </div>
          `}
        `}
      </td>
      
      <td class="td-actions">
        ${isAdmin ? `
          <div style="text-align: right; font-size: 12px; color: var(--text-muted); font-weight: 500;">Administrador</div>
        ` : `
          <div class="actions-cell">
            <div class="action-row">
              <button class="btn btn-icon btn-action-toggle ${p.approved ? 'btn-danger-outline' : 'btn-success-outline'}" ${isSelf ? 'disabled' : ''}>
                ${p.approved ? 'Bloquear' : 'Aprovar'}
              </button>
              
              ${p.approved ? `
                <button class="btn btn-icon btn-info-outline btn-extend-trial">+14d teste</button>
              ` : ''}
              
              <button class="btn btn-icon btn-info-outline btn-edit-user" title="Editar informações do usuário">
                Editar
              </button>
              
              <button class="btn btn-icon btn-danger-outline btn-delete-user" ${isSelf ? 'disabled' : ''} title="Excluir usuário permanentemente">
                Excluir
              </button>
            </div>
            
            ${p.approved ? `
              <div class="license-form">
                <input type="date" class="date-picker" value="${p.access_expires_at ? p.access_expires_at.split('T')[0] : ''}">
                <button class="btn btn-icon btn-primary btn-small btn-save-license" title="Salvar validade da licença">Salvar</button>
                ${p.access_expires_at ? `
                  <button class="btn btn-icon btn-danger-outline btn-small btn-clear-license" title="Limpar licença">✕</button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `}
      </td>
    `;
    
    // Add Event Listeners for actions if they exist
    if (!isAdmin) {
      const btnToggle = tr.querySelector('.btn-action-toggle');
      if (btnToggle) {
        btnToggle.addEventListener('click', () => toggleApproval(p));
      }
      
      const btnExtend = tr.querySelector('.btn-extend-trial');
      if (btnExtend) {
        btnExtend.addEventListener('click', () => extendTrial(p));
      }
      
      const btnEdit = tr.querySelector('.btn-edit-user');
      if (btnEdit) {
        btnEdit.addEventListener('click', () => openEditModal(p));
      }
      
      const btnDelete = tr.querySelector('.btn-delete-user');
      if (btnDelete) {
        btnDelete.addEventListener('click', () => deleteUser(p));
      }
      
      const btnSave = tr.querySelector('.btn-save-license');
      const datePicker = tr.querySelector('.date-picker');
      if (btnSave && datePicker) {
        btnSave.addEventListener('click', () => {
          saveLicense(p, datePicker.value);
        });
      }
      
      const btnClear = tr.querySelector('.btn-clear-license');
      if (btnClear) {
        btnClear.addEventListener('click', () => clearLicense(p));
      }
    }
    
    profilesList.appendChild(tr);
  });
};

// 8. Event Listeners
loginForm.addEventListener('submit', handleLogin);
btnLogout.addEventListener('click', handleLogout);
searchInput.addEventListener('input', renderProfiles);
editUserForm.addEventListener('submit', handleEditUserSubmit);
btnCloseModal.addEventListener('click', closeEditModal);
btnCancelEdit.addEventListener('click', closeEditModal);

// Initialize App
checkSession();
