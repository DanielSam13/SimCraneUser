import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. Supabase Initialization
const SUPABASE_URL = 'https://ihgibjxqfmixeycngoje.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5Nnux0U1qyHluC2QJaQ9Yg_L0gtIwIh';
const ADMIN_EMAIL_LIMIT = 'eng.daniel.nascimento@gmail.com';

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
const alertsContainer  = document.getElementById('alerts-container');
const onlineSummary   = document.getElementById('online-summary');
const onlineCountEl   = document.getElementById('online-count');

// Activity Modal Elements
const activityModal      = document.getElementById('activity-modal');
const activityModalTitle = document.getElementById('activity-modal-title');
const activityModalBody  = document.getElementById('activity-modal-body');
const btnCloseActivity   = document.getElementById('btn-close-activity-modal');

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
const POLL_INTERVAL_MS = 30000; // 30 seconds
const ONLINE_MS  = 5  * 60 * 1000; // < 5 min  = online
const RECENT_MS  = 30 * 60 * 1000; // < 30 min = recently active

// SQL to run in Supabase to enable presence + session tracking
const SETUP_SQL =
`-- 1. Adicionar coluna de presença à tabela profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 2. Criar tabela de sessões para rastreamento de horas/dia
CREATE TABLE IF NOT EXISTS user_sessions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at   TIMESTAMPTZ,
  date       DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date
  ON user_sessions(user_id, date);

-- 3. Política de acesso (RLS) — ajuste conforme necessário
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuários gerenciam próprias sessões"
  ON user_sessions FOR ALL USING (auth.uid() = user_id);`;

let profiles = [];
let currentUser = null;
let profilesSubscription = null;
let pollingInterval = null;
// null = not yet initialized (first load); Set = known pending user IDs
let knownPendingIds = null;

// 4. Presence helpers
const getPresenceStatus = (p) => {
  if (!p.last_seen_at) return 'offline';
  const diff = Date.now() - new Date(p.last_seen_at).getTime();
  if (diff < ONLINE_MS)  return 'online';
  if (diff < RECENT_MS)  return 'recent';
  return 'offline';
};

const presenceLabel = { online: 'Online agora', recent: 'Ativo recentemente', offline: 'Offline' };

const updateOnlineSummary = () => {
  const count = profiles.filter(p => p.role !== 'admin' && getPresenceStatus(p) === 'online').length;
  onlineCountEl.textContent = count === 1 ? '1 online' : `${count} online`;
};

// 5. Utility Functions
const fmtDate = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
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

// 5. Toast Notifications
const showToast = (message, type = 'success', duration = 4000) => {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
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

// 6. System Notification Helpers
const sendNotification = (title, body) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: './icons/icon.svg' });
    } catch (err) {
      console.error('Failed to trigger notification:', err);
    }
  }
};

const requestNotificationPermission = () => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
};

// 7. New-user Detection
// Called after every fetchProfiles(). On first call (knownPendingIds === null),
// silently initializes the baseline. On subsequent calls, fires toast + OS
// notification for each ID that wasn't in the previous snapshot.
const detectNewPendingUsers = () => {
  const currentPending = profiles.filter(p => !p.approved && p.role !== 'admin');

  if (knownPendingIds === null) {
    knownPendingIds = new Set(currentPending.map(p => p.id));
    return;
  }

  const newUsers = currentPending.filter(u => !knownPendingIds.has(u.id));
  newUsers.forEach(u => {
    const name = u.full_name || 'Novo usuário';
    showToast(`🔔 ${name} aguarda aprovação de acesso!`, 'warning', 7000);
    sendNotification('Aprovação Pendente', `${name} acabou de solicitar acesso ao SimCrane.`);
  });

  knownPendingIds = new Set(currentPending.map(p => p.id));
};

// 8. Page Title Badge
const updatePageTitle = () => {
  const pending = profiles.filter(p => !p.approved && p.role !== 'admin').length;
  document.title = pending > 0
    ? `(${pending}) SimCrane User - Gerenciamento`
    : 'SimCrane User - Gerenciamento';
};

// 9. Activity Modal
const closeActivityModal = () => { activityModal.style.display = 'none'; };

const fetchUserActivity = async (userId) => {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('user_sessions')
    .select('started_at, ended_at, date')
    .eq('user_id', userId)
    .gte('started_at', since)
    .order('started_at', { ascending: false });
  if (error) return { error };

  // Aggregate seconds and session count per day
  const byDate = {};
  (data || []).forEach(s => {
    const key = s.date || s.started_at.split('T')[0];
    if (!byDate[key]) byDate[key] = { sessions: 0, seconds: 0 };
    byDate[key].sessions++;
    const end   = s.ended_at ? new Date(s.ended_at) : new Date();
    const start = new Date(s.started_at);
    byDate[key].seconds += Math.max(0, (end - start) / 1000);
  });

  return {
    data: Object.entries(byDate)
      .map(([date, v]) => ({ date, sessions: v.sessions, hours: v.seconds / 3600 }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
};

const openActivityModal = async (p) => {
  const status   = getPresenceStatus(p);
  const chipClass = { online: 'chip-online', recent: 'chip-recent', offline: 'chip-offline' }[status];
  const dotColor  = { online: 'presence-online', recent: 'presence-recent', offline: 'presence-offline' }[status];

  activityModalTitle.textContent = `Atividade — ${p.full_name || 'Sem Nome'}`;
  activityModalBody.innerHTML = `
    <div class="activity-user-info">
      <span class="activity-presence-chip ${chipClass}">
        <span class="presence-dot" style="position:static;border:none;width:8px;height:8px;" class="${dotColor}"></span>
        ${presenceLabel[status]}
      </span>
      ${p.last_seen_at
        ? `<span style="font-size:12px;color:var(--text-muted);">Último acesso: ${fmtDateTime(p.last_seen_at)}</span>`
        : '<span style="font-size:12px;color:var(--text-muted);">Presença não rastreada ainda</span>'}
    </div>
    <div class="dashboard-loading"><div class="spinner"></div><p>Carregando atividade...</p></div>
  `;
  activityModal.style.display = 'flex';

  const { data, error } = await fetchUserActivity(p.id);

  if (error) {
    activityModalBody.querySelector('.dashboard-loading')?.remove();
    activityModalBody.insertAdjacentHTML('beforeend', `
      <div class="activity-setup-msg">
        <p>⚠️ A tabela <code>user_sessions</code> ainda não existe no banco de dados.</p>
        <p>Execute o SQL abaixo no <strong>Supabase → SQL Editor</strong> para habilitar o rastreamento:</p>
        <pre class="activity-sql">${SETUP_SQL}</pre>
        <p style="margin-top:12px;">Depois, adicione o código de rastreamento ao app SimCrane (usuário).</p>
      </div>
    `);
    return;
  }

  const loading = activityModalBody.querySelector('.dashboard-loading');
  if (loading) loading.remove();

  if (!data || data.length === 0) {
    activityModalBody.insertAdjacentHTML('beforeend',
      '<p class="activity-empty">Nenhuma sessão registrada nos últimos 30 dias.</p>');
    return;
  }

  const maxHours   = Math.max(...data.map(d => d.hours));
  const totalHours = data.reduce((s, d) => s + d.hours, 0);
  const totalH     = Math.floor(totalHours);
  const totalM     = Math.round((totalHours - totalH) * 60);

  activityModalBody.insertAdjacentHTML('beforeend', `
    <table class="activity-table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Tempo online</th>
          <th>Sessões</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(d => {
          const h   = Math.floor(d.hours);
          const m   = Math.round((d.hours - h) * 60);
          const pct = Math.min(100, (d.hours / Math.max(maxHours, 0.01)) * 100);
          return `
            <tr>
              <td style="color:var(--text-muted);font-size:12px;">${fmtDate(d.date)}</td>
              <td>
                <span class="activity-hours-text">${h}h ${String(m).padStart(2,'0')}min</span>
                <div class="activity-hours-bar">
                  <div class="activity-hours-fill" style="width:${pct}%"></div>
                </div>
              </td>
              <td><span class="activity-sessions-badge">${d.sessions}</span></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="activity-total-row">
      <span>Total nos últimos 30 dias</span>
      <strong>${totalH}h ${String(totalM).padStart(2,'0')}min em ${data.reduce((s,d)=>s+d.sessions,0)} sessões</strong>
    </div>
  `);
};

// 11. Alert Banners (in-dashboard)
const checkUserAlerts = () => {
  if (!alertsContainer) return;

  const pendingUsers = profiles.filter(p => !p.approved && p.role !== 'admin');
  const expiringUsers = profiles.filter(p => {
    if (!p.approved || p.role === 'admin' || !p.trial_ends_at) return false;
    const licEnd = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
    if (licEnd && Date.now() < licEnd) return false;
    const diff = new Date(p.trial_ends_at).getTime() - Date.now();
    return diff > 0 && diff <= 3 * DAY_MS;
  });

  alertsContainer.innerHTML = '';
  updatePageTitle();
  updateOnlineSummary();

  if (pendingUsers.length === 0 && expiringUsers.length === 0) {
    alertsContainer.style.display = 'none';
    return;
  }

  alertsContainer.style.display = 'flex';

  if (pendingUsers.length > 0) {
    const names = pendingUsers.map(u => `<strong>${u.full_name || 'Sem Nome'}</strong>`).join(', ');
    const el = document.createElement('div');
    el.className = 'alert-banner';
    el.innerHTML = `
      <span class="alert-banner-icon">🔔</span>
      <div class="alert-banner-text">
        ${pendingUsers.length === 1
          ? `${names} aguarda aprovação de acesso!`
          : `${pendingUsers.length} usuários aguardam aprovação: ${names}`}
      </div>
    `;
    alertsContainer.appendChild(el);
  }

  if (expiringUsers.length > 0) {
    const el = document.createElement('div');
    el.className = 'alert-banner alert-banner-danger';
    el.innerHTML = `
      <span class="alert-banner-icon">⚠️</span>
      <div class="alert-banner-text">
        Há <strong>${expiringUsers.length}</strong> usuário(s) com período de teste vencendo em menos de 3 dias!
      </div>
    `;
    alertsContainer.appendChild(el);

    expiringUsers.forEach(u => {
      const days = Math.max(1, Math.ceil((new Date(u.trial_ends_at).getTime() - Date.now()) / DAY_MS));
      sendNotification('Teste Expirando', `O trial de ${u.full_name || 'Sem Nome'} expira em ${days} dia(s).`);
    });
  }
};

// 12. Polling — reliable 30-second background check
const startPolling = () => {
  if (pollingInterval) return;
  pollingInterval = setInterval(() => fetchProfiles(true), POLL_INTERVAL_MS);
};

const stopPolling = () => {
  clearInterval(pollingInterval);
  pollingInterval = null;
};

// 11. Supabase Realtime — fires instantly when DB is configured for it
const subscribeToProfiles = () => {
  if (profilesSubscription) return;
  profilesSubscription = supabase
    .channel('profiles-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
      fetchProfiles(true);
    })
    .subscribe();
};

const unsubscribeFromProfiles = () => {
  if (profilesSubscription) {
    supabase.removeChannel(profilesSubscription);
    profilesSubscription = null;
  }
};

// 12. Auth and Session Management
const checkSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) { showLogin(); return; }

  try {
    const { data: profile, error: pError } = await supabase
      .from('profiles').select('role').eq('id', session.user.id).single();

    if (pError || !profile || profile.role !== 'admin') {
      await supabase.auth.signOut();
      showLogin('Acesso negado: Esta conta não possui privilégios de administrador.');
      return;
    }

    currentUser = session.user;
    showDashboard();
  } catch (err) {
    console.error('Session check failed', err);
    showLogin('Erro ao verificar sessão.');
  }
};

const handleLogin = async (e) => {
  e.preventDefault();
  authError.style.display = 'none';
  btnLogin.disabled = true;
  btnLogin.innerHTML = '<div class="spinner"></div>';

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) throw error;

    const { data: profile, error: pError } = await supabase
      .from('profiles').select('role').eq('id', data.user.id).single();

    if (pError || !profile || profile.role !== 'admin') {
      await supabase.auth.signOut();
      throw new Error('Acesso negado: Apenas administradores podem entrar.');
    }

    currentUser = data.user;
    showToast('Login realizado com sucesso!');
    showDashboard();
  } catch (err) {
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
    stopPolling();
    unsubscribeFromProfiles();
    knownPendingIds = null;
    currentUser = null;
    profiles = [];
    showLogin();
    showToast('Você saiu do aplicativo.');
  }
};

const showLogin = (msg = '') => {
  authContainer.style.display = 'flex';
  dashboardContainer.style.display = 'none';
  authError.textContent = msg;
  authError.style.display = msg ? 'block' : 'none';
  passwordInput.value = '';
};

const showDashboard = () => {
  authContainer.style.display = 'none';
  dashboardContainer.style.display = 'flex';
  adminEmailDisplay.textContent = currentUser?.email || ADMIN_EMAIL_LIMIT;
  requestNotificationPermission();
  subscribeToProfiles();
  startPolling();
  fetchProfiles();
};

// 13. Profiles CRUD Operations

// silent=true → skip loading spinner (used by polling/realtime refreshes)
const fetchProfiles = async (silent = false) => {
  if (!silent) {
    dashboardLoading.style.display = 'flex';
    profilesList.innerHTML = '';
    emptyState.style.display = 'none';
  }

  try {
    const { data, error } = await supabase
      .from('profiles').select('*').order('full_name', { ascending: true });
    if (error) throw error;

    profiles = data || [];
    renderProfiles();
    checkUserAlerts();
    detectNewPendingUsers();
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    if (!silent) showToast('Erro ao carregar usuários. Verifique a conexão.', 'error');
  } finally {
    if (!silent) dashboardLoading.style.display = 'none';
  }
};

const patchProfile = async (profileId, changes) => {
  const row = document.querySelector(`tr[data-id="${profileId}"]`);
  const buttons = row ? row.querySelectorAll('button, input') : [];
  buttons.forEach(b => b.disabled = true);

  try {
    const { error } = await supabase.from('profiles').update(changes).eq('id', profileId);
    if (error) throw error;

    profiles = profiles.map(p => p.id === profileId ? { ...p, ...changes } : p);
    renderProfiles();
    checkUserAlerts();
    showToast('Usuário atualizado com sucesso!');
  } catch (err) {
    console.error('Erro ao salvar alterações:', err);
    showToast('Erro ao salvar alterações.', 'error');
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
  patchProfile(p.id, {
    trial_started_at: p.trial_started_at || new Date().toISOString(),
    trial_ends_at: new Date(base + TRIAL_DAYS * DAY_MS).toISOString(),
  });
};

const saveLicense = (p, dateString) => {
  if (!dateString) return;
  patchProfile(p.id, { access_expires_at: new Date(`${dateString}T23:59:59`).toISOString() });
};

const clearLicense = (p) => patchProfile(p.id, { access_expires_at: null });

const deleteUser = async (p) => {
  if (!confirm(`Tem certeza que deseja excluir o usuário "${p.full_name || 'Sem Nome'}" permanentemente? Esta ação removerá a conta do banco de dados.`)) return;

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
    profiles = profiles.filter(item => item.id !== p.id);
    renderProfiles();
    checkUserAlerts();
    showToast('Usuário excluído com sucesso!');
  } catch (err) {
    showToast(err.message || 'Erro ao excluir usuário.', 'error');
    buttons.forEach(b => b.disabled = false);
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
  if (!profileId) return;
  closeEditModal();
  await patchProfile(profileId, {
    full_name: editUserNameInput.value.trim(),
    company_name: editUserCompanyInput.value.trim() || null,
    user_group: editUserGroupInput.value.trim() || null,
  });
};

// 14. Rendering Logic
const renderProfiles = () => {
  const filter = searchInput.value.toLowerCase().trim();
  const filtered = profiles.filter(p => {
    return (p.full_name || '').toLowerCase().includes(filter)
      || p.id.toLowerCase().includes(filter)
      || (p.company_name || '').toLowerCase().includes(filter)
      || (p.user_group || '').toLowerCase().includes(filter)
      || fmtDate(p.created_at).includes(filter)
      || fmtDate(p.trial_ends_at).includes(filter)
      || fmtDate(p.access_expires_at).includes(filter);
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

    let isExpiringSoon = false;
    if (p.approved && p.role !== 'admin' && p.trial_ends_at) {
      const licEnd = p.access_expires_at ? new Date(p.access_expires_at).getTime() : 0;
      if (!(licEnd && Date.now() < licEnd)) {
        const diff = new Date(p.trial_ends_at).getTime() - Date.now();
        isExpiringSoon = diff > 0 && diff <= 3 * DAY_MS;
      }
    }

    let statusClass = 'badge-pending';
    if (status.key === 'admin') statusClass = 'badge-admin';
    else if (status.key === 'licensed') statusClass = 'badge-licensed';
    else if (status.key === 'trial') statusClass = 'badge-trial';
    else if (status.key === 'expired') statusClass = 'badge-expired';

    const tr = document.createElement('tr');
    tr.dataset.id = p.id;

    const presence = isAdmin ? 'offline' : getPresenceStatus(p);

    tr.innerHTML = `
      <td class="td-name">
        <div class="user-cell">
          <div class="avatar-wrapper">
            <div class="avatar">${(p.full_name || '?')[0].toUpperCase()}</div>
            <span class="presence-dot presence-${presence}" title="${presenceLabel[presence]}"></span>
          </div>
          <div class="user-info">
            <span class="user-name">${p.full_name || 'Sem Nome'}</span>
            <span class="user-id" title="${p.id}">
              ID: ${p.id.substring(0, 8)}...
              ${p.company_name ? ` | 🏢 ${p.company_name}` : ''}
              ${p.user_group ? ` | 👥 ${p.user_group}` : ''}
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
              ${p.approved ? `<button class="btn btn-icon btn-info-outline btn-extend-trial">+14d teste</button>` : ''}
              <button class="btn btn-icon btn-info-outline btn-edit-user" title="Editar informações do usuário">Editar</button>
              ${p.approved ? `<button class="btn btn-icon btn-info-outline btn-activity" title="Ver atividade e horas online">Atividade</button>` : ''}
              <button class="btn btn-icon btn-danger-outline btn-delete-user" ${isSelf ? 'disabled' : ''} title="Excluir usuário permanentemente">Excluir</button>
            </div>
            ${p.approved ? `
              <div class="license-form">
                <input type="date" class="date-picker" value="${p.access_expires_at ? p.access_expires_at.split('T')[0] : ''}">
                <button class="btn btn-icon btn-primary btn-small btn-save-license" title="Salvar validade da licença">Salvar</button>
                ${p.access_expires_at ? `<button class="btn btn-icon btn-danger-outline btn-small btn-clear-license" title="Limpar licença">✕</button>` : ''}
              </div>
            ` : ''}
          </div>
        `}
      </td>
    `;

    if (!isAdmin) {
      tr.querySelector('.btn-action-toggle')?.addEventListener('click', () => toggleApproval(p));
      tr.querySelector('.btn-extend-trial')?.addEventListener('click', () => extendTrial(p));
      tr.querySelector('.btn-edit-user')?.addEventListener('click', () => openEditModal(p));
      tr.querySelector('.btn-activity')?.addEventListener('click', () => openActivityModal(p));
      tr.querySelector('.btn-delete-user')?.addEventListener('click', () => deleteUser(p));

      const datePicker = tr.querySelector('.date-picker');
      tr.querySelector('.btn-save-license')?.addEventListener('click', () => saveLicense(p, datePicker?.value));
      tr.querySelector('.btn-clear-license')?.addEventListener('click', () => clearLicense(p));
    }

    profilesList.appendChild(tr);
  });
};

// 15. Event Listeners
loginForm.addEventListener('submit', handleLogin);
btnLogout.addEventListener('click', handleLogout);
searchInput.addEventListener('input', renderProfiles);
editUserForm.addEventListener('submit', handleEditUserSubmit);
btnCloseModal.addEventListener('click', closeEditModal);
btnCancelEdit.addEventListener('click', closeEditModal);
btnCloseActivity.addEventListener('click', closeActivityModal);
activityModal.addEventListener('click', (e) => { if (e.target === activityModal) closeActivityModal(); });

// Initialize App
checkSession();
