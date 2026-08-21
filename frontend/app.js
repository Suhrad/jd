import Vapi from 'https://esm.sh/@vapi-ai/web';

// ── State ──────────────────────────────────────────────────────────────────
let vapi                   = null;
let currentCandidateId     = null;
let currentJobId           = null;
let callTimerInterval      = null;
let callStartTime          = null;
let pollingInterval        = null;
let activeCallId           = null;
let currentModalReportData = null;
let allCandidatesCache     = [];
let currentTone            = 'warm';
let currentQuestionsState  = [];
let allCompaniesCache      = [];
let currentCompanyId       = 1;
let currentUser            = null;

// ── Admin State ─────────────────────────────────────────────────────────────
let adminCompanyCatalogCache = [];
let adminUsersCache          = [];
let activeCatalogData        = [];
let catalogCurrentPage       = 1;
const catalogPageSize        = 50;


// ── Auth Helpers ───────────────────────────────────────────────────────────
function getAuthToken() {
  return localStorage.getItem('weekday_token');
}

function getAuthHeaders() {
  const token = getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

window.handleLogout = function() {
  localStorage.removeItem('weekday_token');
  localStorage.removeItem('weekday_user');
  window.location.href = '/login.html';
};

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[boot] DOMContentLoaded fired');
  injectSvgGradients();
  setConnection('initializing', 'Initializing...');

  // Auth check — if no token at all, go to login immediately
  const token = getAuthToken();
  console.log('[boot] token exists:', !!token);
  if (!token) {
    const targetHash = window.location.hash || '';
    if (targetHash && targetHash !== '#/screener/role' && targetHash !== '#/admin/portfolios') {
      sessionStorage.setItem('redirect_after_login', targetHash);
    }
    window.location.href = '/login.html';
    return;
  }

  // Restore user synchronously from localStorage on Frame 1 (Instant 0ms UI Render)
  const storedUser = localStorage.getItem('weekday_user');
  console.log('[boot] storedUser exists:', !!storedUser);
  if (storedUser) {
    try { currentUser = JSON.parse(storedUser); } catch (_) {}
  }
  console.log('[boot] currentUser after localStorage restore:', currentUser?.email, currentUser?.role);

  function renderUserUI() {
    console.log('[boot] renderUserUI called, currentUser:', currentUser?.email);
    if (!currentUser) return;
    const nameBadge = document.getElementById('userNameBadge');
    const cleanName = (currentUser.name || 'User').replace(/\(Admin\)|\(AM\)/gi, '').trim();
    if (nameBadge) nameBadge.innerText = `👤 ${cleanName} (${currentUser.role === 'admin' ? 'Admin' : 'AM'})`;
    console.log('[boot] calling handleRoute, hash:', window.location.hash);
    handleRoute();
  }

  if (currentUser) {
    renderUserUI();
  }

  // Verify token & sync user profile in background
  try {
    console.log('[boot] fetching /api/auth/me...');
    const meRes = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    console.log('[boot] /api/auth/me status:', meRes.status);
    if (!meRes.ok) {
      localStorage.removeItem('weekday_token');
      localStorage.removeItem('weekday_user');
      window.location.href = '/login.html';
      return;
    }
    const meData = await meRes.json();
    currentUser = meData.user;
    localStorage.setItem('weekday_user', JSON.stringify(currentUser));
    console.log('[boot] /api/auth/me OK, user:', currentUser.email, currentUser.role);
    renderUserUI();
  } catch (e) {
    console.log('[boot] /api/auth/me catch:', e.message);
    if (currentUser) renderUserUI();
  }

  if (currentUser) {
    // Background data fetching (non-blocking)
    if (currentUser.role === 'admin') {
      loadAdminUserList().catch(e => console.error('loadAdminUserList error:', e));
      loadAdminCompanyCatalog().catch(e => console.error('loadAdminCompanyCatalog error:', e));
      loadAdminAnalytics().catch(e => console.error('loadAdminAnalytics error:', e));
    } else {
      loadCompanies().catch(e => console.error('loadCompanies error:', e));
      loadCandidates().catch(e => console.error('loadCandidates error:', e));
      loadPersonaLibrary().catch(e => console.error('loadPersonaLibrary error:', e));
      initVapi().catch(e => console.error('initVapi error:', e));
      setupJdAutoExtractor();
    }
  }

  // Close combobox dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.combobox-wrapper')) {
      const compDropdown = document.getElementById('companyDropdown');
      if (compDropdown) compDropdown.style.display = 'none';
      const roleDropdown = document.getElementById('roleDropdown');
      if (roleDropdown) roleDropdown.style.display = 'none';
    }
  });
});

// ── Company & Role Selection Logic ───────────────────────────────────────
async function loadCompanies() {
  try {
    const res = await fetch('/api/companies', { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.companies) {
      allCompaniesCache = data.companies;
      renderCompanyDropdown(allCompaniesCache);
      // Clean slate on start: Leave company and role blank so user can type freely
    }
  } catch (err) {
    console.error('Failed to load companies:', err);
  }
}

window.showCompanyDropdown = function() {
  const dropdown = document.getElementById('companyDropdown');
  if (dropdown) {
    renderCompanyDropdown(allCompaniesCache);
    dropdown.style.display = 'block';
  }
};

window.filterCompanyDropdown = function(query) {
  const dropdown = document.getElementById('companyDropdown');
  if (!dropdown) return;
  const filtered = allCompaniesCache.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
  renderCompanyDropdown(filtered);
  dropdown.style.display = 'block';
};

function renderCompanyDropdown(companies) {
  const dropdown = document.getElementById('companyDropdown');
  if (!dropdown) return;
  if (companies.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px 14px; font-size:13px; color:#94a3b8;">No saved companies match (type to add new)</div>';
    return;
  }

  dropdown.innerHTML = companies.map(c => `
    <div onclick="selectCompany(${c.id}, '${escapeQuotes(c.name)}', '')" style="padding:10px 14px; font-size:13px; color:#09090b; cursor:pointer; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
      <strong style="color:#09090b; display:block; font-weight:600;">${c.name}</strong>
      <span style="font-size:11px; color:#64748b;">${c.hq_location || 'Bangalore'}</span>
    </div>
  `).join('');
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

window.selectCompany = async function(id, name, pitch) {
  currentCompanyId = id;
  const input = document.getElementById('companyNameInput');
  const hidden = document.getElementById('companyIdHidden');
  const dropdown = document.getElementById('companyDropdown');
  const pitchPill = document.getElementById('companyPitchPill');

  if (input) input.value = name;
  if (hidden) hidden.value = id;
  if (dropdown) dropdown.style.display = 'none';

  if (pitchPill) {
    pitchPill.style.display = 'none';
  }

  // Reset the parsed JD cache when company changes manually
  if (!skipSavedJobPopulate) {
    lastAutoParsedJdText = '';
  }

  await loadRolesForCompany(id);
};

let currentCompanyRolesCache = [];

async function loadRolesForCompany(companyId) {
  try {
    const res = await fetch(`/api/companies/${companyId}/roles`, { headers: getAuthHeaders() });
    const data = await res.json();
    currentCompanyRolesCache = data.roles || [];
  } catch (err) {
    console.error('Failed to load roles for company:', err);
  }
}

// ── Target Role Combobox Logic ──────────────────────────────────────────
window.showRoleDropdown = function() {
  const dropdown = document.getElementById('roleDropdown');
  if (!dropdown) return;
  if (!currentCompanyId && currentCompanyRolesCache.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px 14px; font-size:12.5px; color:#94a3b8;">Select a company first to see saved roles, or type custom role directly</div>';
    dropdown.style.display = 'block';
    return;
  }
  renderRoleDropdown(currentCompanyRolesCache);
  dropdown.style.display = 'block';
};

window.filterRoleDropdown = function(query) {
  const dropdown = document.getElementById('roleDropdown');
  if (!dropdown) return;
  const filtered = currentCompanyRolesCache.filter(r => r.title.toLowerCase().includes((query || '').toLowerCase()));
  renderRoleDropdown(filtered);
  dropdown.style.display = 'block';
};

function renderRoleDropdown(roles) {
  const dropdown = document.getElementById('roleDropdown');
  if (!dropdown) return;
  if (!roles || roles.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px 14px; font-size:12.5px; color:#94a3b8;">No matching saved roles (press enter to use custom title)</div>';
    return;
  }

  dropdown.innerHTML = roles.map(r => `
    <div onclick="selectRole('${escapeQuotes(r.title)}')" style="padding:10px 14px; font-size:13px; color:#09090b; cursor:pointer; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
      <strong style="color:#09090b; font-weight:600;">${r.title}</strong>
      ${r.jd_text ? '<span style="font-size:10.5px; color:#047857; background:#ecfdf5; border:1px solid #a7f3d0; padding:2px 6px; border-radius:4px; font-weight:600;">JD Ready ✓</span>' : ''}
    </div>
  `).join('');
}

window.selectRole = async function(roleTitle) {
  const jobTitleInput = document.getElementById('jobTitle');
  const dropdown = document.getElementById('roleDropdown');
  if (jobTitleInput) jobTitleInput.value = roleTitle;
  if (dropdown) dropdown.style.display = 'none';

  // 1. Immediately populate from in-memory role cache if available
  const cleanTitle = (roleTitle || '').trim().toLowerCase();
  const cachedRole = currentCompanyRolesCache.find(r => (r.title || '').trim().toLowerCase() === cleanTitle);
  if (cachedRole) {
    if (cachedRole.location) document.getElementById('location').value = cachedRole.location;
    if (cachedRole.max_notice_days) document.getElementById('maxNoticeDays').value = cachedRole.max_notice_days;
    if (cachedRole.tech_stack) document.getElementById('techStack').value = cachedRole.tech_stack;
    if (cachedRole.target_cpa) document.getElementById('targetCpa').value = cachedRole.target_cpa;
    if (cachedRole.jd_text) {
      document.getElementById('jdText').value = cachedRole.jd_text;
      if (typeof handleJdTextBlur === 'function') handleJdTextBlur();
    }
  }

  // 2. Fetch full saved job configuration from DB (by-pair)
  if (currentCompanyId) {
    try {
      const res = await fetch(`/api/jobs/by-pair?companyId=${currentCompanyId}&roleTitle=${encodeURIComponent(roleTitle)}`, {
        headers: getAuthHeaders()
      });
      const job = await res.json();
      if (job && (job.id || job.jd_text)) {
        populateFormFromJob(job);
        showToast(`Loaded JD & configuration for ${roleTitle}`, 'success');
      } else if (cachedRole && cachedRole.jd_text) {
        showToast(`Loaded JD for ${roleTitle}`, 'info');
      }
    } catch (err) {
      console.warn('Failed to load saved config for role:', err);
    }
  }
};

function populateFormFromJob(job) {
  currentJobId = job.id;
  if (job.location) document.getElementById('location').value = job.location;
  if (job.max_notice_days) document.getElementById('maxNoticeDays').value = job.max_notice_days;
  if (job.tech_stack) document.getElementById('techStack').value = job.tech_stack;
  if (job.target_cpa) document.getElementById('targetCpa').value = job.target_cpa;
  if (job.tone) setTone(job.tone);
  if (job.language_mode) document.getElementById('languageMode').value = job.language_mode;
  if (job.voice_id) document.getElementById('voiceId').value = job.voice_id;
  if (document.getElementById('recruiterName')) {
    const rName = job.recruiter_name || 'Maya';
    document.getElementById('recruiterName').value = rName;
    if (typeof handleRecruiterNameInput === 'function') handleRecruiterNameInput(rName);
  }

  if (job.jd_text) document.getElementById('jdText').value = job.jd_text;

  if (job.custom_questions && Array.isArray(job.custom_questions) && job.custom_questions.length > 0) {
    currentQuestionsState = job.custom_questions;
    renderQuestionsArchitect();
  }

  // Update URL hash state with explicit jobId parameter
  const currentHashClean = (window.location.hash || '#/screener/role').split('?')[0];
  if (currentHashClean.startsWith('#/screener/')) {
    window.history.replaceState(null, '', `${currentHashClean}?jobId=${job.id}`);
  }
}

// ── Admin Panel Logic ─────────────────────────────────────────────────────

window.openAdminPanel = async function() {
  switchTab(5);
};

async function loadAdminUserList() {
  const container = document.getElementById('adminUserList');
  if (!container) return;

  try {
    if (allCompaniesCache.length === 0) {
      const resComp = await fetch('/api/companies', { headers: getAuthHeaders() });
      const dataComp = await resComp.json();
      if (dataComp.companies) allCompaniesCache = dataComp.companies;
    }

    const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
    const data = await res.json();

    if (!data.users) return;
    adminUsersCache = data.users.filter(u => u.role !== 'admin');

    // Update summary stat cards
    const amStat = document.getElementById('statTotalAMs');
    if (amStat) amStat.innerText = adminUsersCache.length;

    const coStat = document.getElementById('statTotalCompanies');
    if (coStat && allCompaniesCache.length > 0) coStat.innerText = `${allCompaniesCache.length}`;

    renderAmList(adminUsersCache);
  } catch (err) {
    console.error('Failed to load admin user list:', err);
  }
}

window.filterAmList = function(query) {
  if (!query) {
    renderAmList(adminUsersCache);
    return;
  }
  const q = query.toLowerCase().trim();
  const filtered = adminUsersCache.filter(u => 
    (u.name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q)
  );
  renderAmList(filtered);
};

function renderAmList(users) {
  const container = document.getElementById('adminUserList');
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0; color:#64748b;">
        <p style="font-weight:600; font-size:14px;">No Account Managers found matching query.</p>
      </div>`;
    return;
  }

  container.innerHTML = users.map(u => {
    const assignedIds = (u.assignedCompanies || []).map(c => c.id);
    const initial = (u.name || 'A').charAt(0).toUpperCase();
    const isSuperAdmin = u.role === 'admin';

    return `
      <div class="am-portfolio-card">
        <div class="am-card-top">
          <div class="am-user-meta">
            <div class="am-avatar-pill">${initial}</div>
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="am-name-title">${u.name}</span>
                <span class="am-role-badge">${u.role.toUpperCase()}</span>
              </div>
              <div class="am-email-sub">${u.email}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button onclick="openEditAmModal(${u.id})" class="btn-secondary" style="padding:6px 12px; font-size:12px;">✏️ Edit Creds</button>
            ${!isSuperAdmin ? `<button onclick="handleDeleteAm(${u.id}, '${u.name.replace(/'/g, "\\'")}')" class="btn-secondary" style="padding:6px 12px; font-size:12px; color:#be123c; border-color:#fecdd3;">🗑️ Remove</button>` : ''}
            <button onclick="saveAmAssignments(${u.id})" class="btn-primary" style="padding:6px 14px; font-size:12px;">Save Portfolio</button>
          </div>
        </div>

        <!-- AM Productivity & Performance Metrics Bar -->
        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin: 12px 0 14px 0; padding:10px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
          <div>
            <div style="font-size:11px; color:#64748b; font-weight:600;">Configured JDs</div>
            <div style="font-size:16px; font-weight:800; color:#09090b;">${u.metrics?.totalJdsConfigured || 0}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#64748b; font-weight:600;">Screening Calls</div>
            <div style="font-size:16px; font-weight:800; color:#09090b;">${u.metrics?.totalScreeningCalls || 0}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#64748b; font-weight:600;">Candidate Pass Rate</div>
            <div style="font-size:16px; font-weight:800; color:#059669;">${u.metrics?.candidatePassRate || 0}%</div>
          </div>
          <div>
            <div style="font-size:11px; color:#64748b; font-weight:600;">Assigned Companies</div>
            <div style="font-size:16px; font-weight:800; color:#2563eb;">${assignedIds.length} / ${allCompaniesCache.length}</div>
          </div>
        </div>

        <div class="am-toolbar">
          <span>Assigned Companies (<strong style="color:var(--black);">${assignedIds.length}</strong> / ${allCompaniesCache.length})</span>
          <div style="display:flex; align-items:center; gap:12px;">
            <input type="text" placeholder="Search companies..." oninput="filterCompanyGridForAm(${u.id}, this.value)" style="padding:4px 8px; font-size:11px; width:140px; border-radius:6px;" />
            <label style="cursor:pointer; color:#047857; font-weight:700;">
              <input type="checkbox" onchange="toggleSelectAllAmCompanies(${u.id}, this.checked)" ${assignedIds.length === allCompaniesCache.length && allCompaniesCache.length > 0 ? 'checked' : ''} /> Select All
            </label>
          </div>
        </div>

        <div id="amCompGrid_${u.id}" class="am-comp-grid">
          ${allCompaniesCache.map(c => `
            <label class="am-comp-item am-comp-item-${u.id}" data-name="${c.name.toLowerCase()}">
              <input type="checkbox" class="am-comp-cb-${u.id}" value="${c.id}" ${assignedIds.includes(c.id) ? 'checked' : ''} />
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

window.filterCompanyGridForAm = function(userId, query) {
  const items = document.querySelectorAll(`.am-comp-item-${userId}`);
  const q = (query || '').toLowerCase().trim();
  items.forEach(item => {
    const name = item.getAttribute('data-name') || '';
    item.style.display = name.includes(q) ? 'flex' : 'none';
  });
};

window.toggleSelectAllAmCompanies = function(userId, isChecked) {
  const cbs = document.querySelectorAll(`.am-comp-cb-${userId}`);
  cbs.forEach(cb => cb.checked = isChecked);
};

window.saveAmAssignments = async function(userId) {
  const cbs = document.querySelectorAll(`.am-comp-cb-${userId}:checked`);
  const companyIds = Array.from(cbs).map(cb => parseInt(cb.value));

  try {
    const res = await fetch(`/api/admin/users/${userId}/assignments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ companyIds })
    });
    if (res.ok) {
      showToast('✓ Assignments saved successfully!', 'success');
      await loadAdminUserList();
    }
  } catch (err) {
    showToast('Failed to save assignments.', 'error');
  }
};

// Edit AM Modal & Deletion Handlers
window.openEditAmModal = function(userId) {
  const user = adminUsersCache.find(u => u.id === userId);
  if (!user) return;
  document.getElementById('editAmUserId').value = user.id;
  document.getElementById('editAmName').value = user.name;
  document.getElementById('editAmEmail').value = user.email;
  document.getElementById('editAmPassword').value = '';
  document.getElementById('editAmModal').classList.remove('hidden');
};

window.closeEditAmModal = function() {
  document.getElementById('editAmModal').classList.add('hidden');
};

window.handleSaveAmCredentials = async function(e) {
  e.preventDefault();
  const userId   = document.getElementById('editAmUserId').value;
  const name     = document.getElementById('editAmName').value.trim();
  const email    = document.getElementById('editAmEmail').value.trim();
  const password = document.getElementById('editAmPassword').value.trim();

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, email, password })
    });
    if (res.ok) {
      showToast('✓ Credentials updated successfully!', 'success');
      closeEditAmModal();
      await loadAdminUserList();
    } else {
      const errData = await res.json();
      showToast(errData.error || 'Failed to update credentials.', 'error');
    }
  } catch (err) {
    showToast('Failed to update credentials.', 'error');
  }
};

window.handleDeleteAm = async function(userId, userName) {
  if (!confirm(`Are you sure you want to remove Account Manager "${userName}"? This will revoke their access and clear company assignments.`)) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      showToast(`✓ Account Manager "${userName}" removed.`, 'success');
      await loadAdminUserList();
    } else {
      const errData = await res.json();
      showToast(errData.error || 'Failed to delete user.', 'error');
    }
  } catch (err) {
    showToast('Failed to delete user.', 'error');
  }
};

// ── User Profile Settings Modal Handlers ───────────────────────────────────
window.openProfileModal = function() {
  if (!currentUser) return;
  document.getElementById('profileNameInput').value = currentUser.name || '';
  document.getElementById('profileEmailInput').value = currentUser.email || '';
  document.getElementById('profilePasswordInput').value = '';
  document.getElementById('profileConfirmPasswordInput').value = '';
  const errorMsg = document.getElementById('profileErrorMsg');
  if (errorMsg) errorMsg.style.display = 'none';
  document.getElementById('editProfileModal').classList.remove('hidden');
};

window.closeProfileModal = function() {
  document.getElementById('editProfileModal').classList.add('hidden');
};

window.handleSaveProfile = async function(e) {
  e.preventDefault();
  const name     = document.getElementById('profileNameInput').value.trim();
  const email    = document.getElementById('profileEmailInput').value.trim();
  const password = document.getElementById('profilePasswordInput').value;
  const confirm  = document.getElementById('profileConfirmPasswordInput').value;
  const errorMsg = document.getElementById('profileErrorMsg');
  const btn      = document.getElementById('btnSaveProfile');

  if (errorMsg) errorMsg.style.display = 'none';

  if (!name) {
    if (errorMsg) { errorMsg.innerText = 'Full name is required.'; errorMsg.style.display = 'block'; }
    return;
  }
  if (!email) {
    if (errorMsg) { errorMsg.innerText = 'Email address is required.'; errorMsg.style.display = 'block'; }
    return;
  }
  if (password && password !== confirm) {
    if (errorMsg) { errorMsg.innerText = 'New passwords do not match.'; errorMsg.style.display = 'block'; }
    return;
  }
  if (password && password.length < 4) {
    if (errorMsg) { errorMsg.innerText = 'Password must be at least 4 characters long.'; errorMsg.style.display = 'block'; }
    return;
  }

  btn.disabled = true;
  btn.innerText = 'Saving...';

  try {
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, email, password: password || undefined })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update profile.');

    // Save updated token and user object
    localStorage.setItem('weekday_token', data.token);
    localStorage.setItem('weekday_user', JSON.stringify(data.user));
    currentUser = data.user;

    // Update header badge
    const nameBadge = document.getElementById('userNameBadge');
    const cleanName = (currentUser.name || 'User').replace(/\(Admin\)|\(AM\)/gi, '').trim();
    if (nameBadge) nameBadge.innerHTML = `👤 ${cleanName} (${currentUser.role === 'admin' ? 'Admin' : 'AM'}) ⚙️`;

    showToast('✓ Profile updated successfully!', 'success');
    closeProfileModal();
  } catch (err) {
    if (errorMsg) {
      errorMsg.innerText = err.message;
      errorMsg.style.display = 'block';
    } else {
      showToast(err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerText = 'Save Profile Changes';
  }
};

// ── SPA URL Deep Link Router Engine ───────────────────────────────────────
const ROUTE_MAP = {
  '#/screener/role':      { type: 'screener', tab: 1 },
  '#/screener/questions': { type: 'screener', tab: 2 },
  '#/screener/call':      { type: 'screener', tab: 3 },
  '#/hub':                { type: 'hub',      tab: 4 },
  '#/admin/portfolios':   { type: 'admin',    subTab: 1 },
  '#/admin/catalog':      { type: 'admin',    subTab: 2 },
  '#/admin/analytics':    { type: 'admin',    subTab: 3 },
  '#/admin/additions':    { type: 'admin',    subTab: 4 },
};

window.navigate = function(hash) {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    handleRoute();
  }
};

function handleRoute() {
  if (!currentUser) {
    const storedUser = localStorage.getItem('weekday_user');
    if (storedUser) {
      try { currentUser = JSON.parse(storedUser); } catch (_) {}
    }
  }
  if (!currentUser) return;

  const nameBadge = document.getElementById('userNameBadge');
  if (nameBadge) {
    const cleanName = (currentUser.name || 'User').replace(/\(Admin\)|\(AM\)/gi, '').trim();
    nameBadge.innerText = `👤 ${cleanName} (${currentUser.role === 'admin' ? 'Admin' : 'AM'})`;
  }

  const defaultHash = currentUser.role === 'admin' ? '#/admin/portfolios' : '#/screener/role';
  if (!window.location.hash) {
    window.history.replaceState(null, '', defaultHash);
  }

  const currentHash = window.location.hash || defaultHash;
  const hashClean   = currentHash.split('?')[0];
  const routeConfig = ROUTE_MAP[hashClean];

  const screenerWork = document.getElementById('screenerWorkspace');
  const screenerNav  = document.getElementById('screenerWizardNav');
  const adminWork    = document.getElementById('adminWorkspace');
  const adminNav     = document.getElementById('adminNavTabs');

  if (currentUser.role === 'admin') {
    // ADMIN GUARANTEE: Never show 3-step screener wizard nav bar or Candidate Hub button for Admin users
    if (screenerNav) screenerNav.style.display = 'none';
    const hubBtn = document.getElementById('tabBtn4');
    if (hubBtn) hubBtn.style.display = 'none';

    if (!routeConfig || routeConfig.type !== 'admin') {
      if (hashClean === '#/hub') {
        // Admin looking at Candidate Hub
        if (adminWork)    adminWork.style.display    = 'none';
        if (adminNav)     adminNav.style.display     = 'none';
        if (screenerWork) screenerWork.style.display = 'block';

        for (let i = 1; i <= 4; i++) {
          const view = document.getElementById(`tabView${i}`);
          if (view) view.classList.toggle('active', i === 4);
        }
        renderLeaderboardDashboard();
        return;
      }

      // Default to admin portfolios if hash is invalid or screener route
      window.history.replaceState(null, '', '#/admin/portfolios');
      handleRoute();
      return;
    }

    // Admin Operations Module View
    if (screenerWork) screenerWork.style.display = 'none';
    if (adminWork)    adminWork.style.display    = 'block';
    if (adminNav)     adminNav.style.display     = 'flex';

    const subTabNum = routeConfig.subTab || 1;
    for (let i = 1; i <= 4; i++) {
      const btn  = document.getElementById(`adminSubTabBtn${i}`);
      const view = document.getElementById(`adminSubView${i}`);
      if (btn)  btn.classList.toggle('active', i === subTabNum);
      if (view) view.style.display = (i === subTabNum) ? 'block' : 'none';
    }

    if (subTabNum === 1) loadAdminUserList();
    else if (subTabNum === 2) loadAdminCompanyCatalog();
    else if (subTabNum === 3) loadAdminAnalytics();
    else if (subTabNum === 4) loadAdminNotifications();

    // Check notification badge count in background
    loadAdminNotifications();

  } else {
    // ACCOUNT MANAGER USER
    if (adminWork) adminWork.style.display = 'none';
    if (adminNav)  adminNav.style.display  = 'none';

    if (routeConfig && routeConfig.type === 'admin') {
      window.location.hash = '#/screener/role';
      return;
    }

    const tabNum = routeConfig ? routeConfig.tab : 1;

    // Screener Nav Bar stays visible across ALL 4 tabs (1, 2, 3, and 4)
    if (screenerNav) {
      screenerNav.style.display = 'flex';
    }
    if (screenerWork) screenerWork.style.display = 'block';

    for (let i = 1; i <= 4; i++) {
      const btn  = document.getElementById(`tabBtn${i}`);
      const view = document.getElementById(`tabView${i}`);
      if (btn)  btn.classList.toggle('active', i === tabNum);
      if (view) view.classList.toggle('active', i === tabNum);
    }

    if (tabNum === 2) {
      checkAndLoadDeepLinkQuestions();
    } else if (tabNum === 4) {
      renderLeaderboardDashboard();
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getHashQueryParams() {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return {};
  const queryStr = hash.substring(qIdx + 1);
  const params = new URLSearchParams(queryStr);
  const result = {};
  for (const [k, v] of params.entries()) {
    result[k.toLowerCase()] = v;
  }
  return result;
}

let lastLoadedDeepLinkKey = '';

async function checkAndLoadDeepLinkQuestions() {
  const queryParams = getHashQueryParams();
  const targetJobId = queryParams.jobid || queryParams.job_id || queryParams.id;
  const targetCompanyId = queryParams.companyid || queryParams.company_id;
  const targetRoleTitle = queryParams.role || queryParams.roletitle || queryParams.title;

  if (targetJobId || (targetCompanyId && targetRoleTitle)) {
    const key = `jobId:${targetJobId}_co:${targetCompanyId}_role:${targetRoleTitle}`;
    if (lastLoadedDeepLinkKey === key && currentQuestionsState.length > 0) {
      return;
    }
    lastLoadedDeepLinkKey = key;
    await loadDeepLinkedJobQuestions(targetJobId, targetCompanyId, targetRoleTitle);
  }
}

async function loadDeepLinkedJobQuestions(jobId, companyId, roleTitle) {
  try {
    let url = '';
    if (jobId) {
      url = `/api/jobs/${jobId}`;
    } else if (companyId && roleTitle) {
      url = `/api/jobs/by-pair?companyId=${companyId}&roleTitle=${encodeURIComponent(roleTitle)}`;
    }
    if (!url) return;

    showToast('⏳ Loading JD questionnaire from database...', 'info');

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) {
      showToast('Job config not found. Architecting AI questions...', 'warning');
      if (currentQuestionsState.length === 0) await generateScriptWithAI();
      return;
    }

    const job = await res.json();
    if (!job) {
      if (currentQuestionsState.length === 0) await generateScriptWithAI();
      return;
    }

    currentJobId = job.id;
    if (job.company_id) currentCompanyId = job.company_id;

    // Auto-populate Step 1 parameters
    if (job.title) {
      const titleEl = document.getElementById('jobTitle');
      if (titleEl) titleEl.value = job.title;
    }
    if (job.location) {
      const locEl = document.getElementById('location');
      if (locEl) locEl.value = job.location;
    }
    if (job.max_notice_days) {
      const noticeEl = document.getElementById('maxNoticeDays');
      if (noticeEl) noticeEl.value = job.max_notice_days;
    }
    if (job.tech_stack) {
      const techEl = document.getElementById('techStack');
      if (techEl) techEl.value = job.tech_stack;
    }
    if (job.target_cpa) {
      const cpaEl = document.getElementById('targetCpa');
      if (cpaEl) cpaEl.value = job.target_cpa;
    }
    if (job.tone) setTone(job.tone);
    if (job.jd_text) {
      const jdEl = document.getElementById('jdText');
      if (jdEl) jdEl.value = job.jd_text;
    }

    const companyNameEl = document.getElementById('companyNameInput');
    if (companyNameEl && job.company_name) {
      companyNameEl.value = job.company_name;
    }

    // Check if custom questions exist in PostgreSQL for this job
    let questions = job.custom_questions;
    if (typeof questions === 'string') {
      try { questions = JSON.parse(questions); } catch (_) {}
    }

    if (Array.isArray(questions) && questions.length > 0) {
      // PRESERVE SAVED QUESTIONS FROM DB — DO NOT REGENERATE
      currentQuestionsState = questions;
      renderQuestionsArchitect();
      showToast(`✓ Loaded ${questions.length} saved questions for "${job.title}" (${job.company_name})`, 'success');
    } else {
      // First visit for this JD without saved questions — generate initial questions
      showToast('Generating initial AI questions for this JD...', 'info');
      await generateScriptWithAI();
    }
  } catch (err) {
    console.error('loadDeepLinkedJobQuestions error:', err);
    if (currentQuestionsState.length === 0) await generateScriptWithAI();
  }
}

window.addEventListener('hashchange', handleRoute);

window.switchAdminSubTab = function(subTabNum) {
  const map = { 1: '#/admin/portfolios', 2: '#/admin/catalog', 3: '#/admin/analytics', 4: '#/admin/additions' };
  if (map[subTabNum]) navigate(map[subTabNum]);
};

async function loadAdminCompanyCatalog() {
  const tbody = document.getElementById('companyCatalogTableBody');
  if (!tbody) return;

  // Render from in-memory cache instantly (0ms) if available
  if (adminCompanyCatalogCache.length > 0) {
    activeCatalogData = adminCompanyCatalogCache;
    const totalRolesCount = adminCompanyCatalogCache.reduce((acc, c) => acc + (c.roles ? c.roles.length : 0), 0);
    const coStat = document.getElementById('statTotalCompanies');
    if (coStat) coStat.innerText = adminCompanyCatalogCache.length;
    const roleStat = document.getElementById('statTotalRoles');
    if (roleStat) roleStat.innerText = totalRolesCount;

    renderCompanyCatalogTable(adminCompanyCatalogCache);
  } else {
    // Show clean loading state while initial fetch completes
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="padding:32px; text-align:center; color:#64748b;">
          <p style="font-weight:600; font-size:13.5px;">Loading master company catalog...</p>
        </td>
      </tr>`;
  }

  try {
    const res = await fetch('/api/companies', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.companies) return;

    adminCompanyCatalogCache = data.companies;
    allCompaniesCache = data.companies;
    activeCatalogData = data.companies;

    // Calculate total role postings dynamically
    const totalRolesCount = adminCompanyCatalogCache.reduce((acc, c) => acc + (c.roles ? c.roles.length : 0), 0);

    const coStat = document.getElementById('statTotalCompanies');
    if (coStat) coStat.innerText = adminCompanyCatalogCache.length;

    const roleStat = document.getElementById('statTotalRoles');
    if (roleStat) roleStat.innerText = totalRolesCount;

    renderCompanyCatalogTable(adminCompanyCatalogCache);
  } catch (err) {
    console.error('Failed to load company catalog:', err);
  }
} // end loadAdminCompanyCatalog

// Add New Company Modal Handlers
window.openAddCompanyModal = function() {
  document.getElementById('newCompanyName').value = '';
  document.getElementById('newCompanyHq').value = '';
  document.getElementById('newCompanyRoles').value = '';
  if (document.getElementById('newCompanyJd')) document.getElementById('newCompanyJd').value = '';
  document.getElementById('addCompanyModal').classList.remove('hidden');
};

window.closeAddCompanyModal = function() {
  document.getElementById('addCompanyModal').classList.add('hidden');
};

window.handleSaveNewCompany = async function(e) {
  e.preventDefault();
  const name       = document.getElementById('newCompanyName').value.trim();
  const hqLocation = document.getElementById('newCompanyHq').value.trim();
  const roles      = document.getElementById('newCompanyRoles').value.trim();
  const jdText     = document.getElementById('newCompanyJd')?.value?.trim() || '';

  try {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, hqLocation, roles, jdText })
    });
    if (res.ok) {
      showToast(`✓ Company "${name}" & open roles added with full JD!`, 'success');
      closeAddCompanyModal();
      adminCompanyCatalogCache = []; // reset cache to force fresh fetch
      await loadAdminCompanyCatalog();
    } else {
      const errData = await res.json();
      showToast(errData.error || 'Failed to add company.', 'error');
    }
  } catch (err) {
    showToast('Failed to add company.', 'error');
  }
};



window.changeCatalogPage = function(delta) {
  catalogCurrentPage += delta;
  renderCompanyCatalogTable(activeCatalogData);
};

window.setCatalogPage = function(pageNum) {
  catalogCurrentPage = pageNum;
  renderCompanyCatalogTable(activeCatalogData);
};

window.filterCompanyCatalog = function(query) {
  catalogCurrentPage = 1; // Reset to page 1 on search
  if (!query) {
    activeCatalogData = adminCompanyCatalogCache;
  } else {
    const q = query.toLowerCase().trim();
    activeCatalogData = adminCompanyCatalogCache.filter(c => 
      (c.name || '').toLowerCase().includes(q) ||
      (c.hq_location || '').toLowerCase().includes(q) ||
      (c.elevator_pitch || '').toLowerCase().includes(q)
    );
  }
  renderCompanyCatalogTable(activeCatalogData);
};

function renderCompanyCatalogTable(companies) {
  if (Array.isArray(companies) && companies.length > 0) {
    activeCatalogData = companies;
  } else if (!activeCatalogData || activeCatalogData.length === 0) {
    activeCatalogData = adminCompanyCatalogCache || [];
  }
  const tbody = document.getElementById('companyCatalogTableBody');
  const pagContainer = document.getElementById('companyCatalogPagination');
  if (!tbody) return;

  if (activeCatalogData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="padding:24px; text-align:center; color:#64748b;">No companies found matching search query.</td>
      </tr>`;
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  // Calculate Pagination (50 entries per page)
  const totalPages = Math.ceil(activeCatalogData.length / catalogPageSize) || 1;
  if (catalogCurrentPage > totalPages) catalogCurrentPage = totalPages;
  if (catalogCurrentPage < 1) catalogCurrentPage = 1;

  const startIndex = (catalogCurrentPage - 1) * catalogPageSize;
  const pageItems = activeCatalogData.slice(startIndex, startIndex + catalogPageSize);

  tbody.innerHTML = pageItems.map(c => {
    const roles = c.roles || [];
    const rolesList = roles.slice(0, 6).map(r => `<span style="padding:2px 7px; border-radius:4px; background:#f1f5f9; border:1px solid #cbd5e1; font-weight:600; font-size:11px; margin-right:4px; display:inline-block; margin-bottom:4px; color:#1e293b;">${r}</span>`).join('');
    const moreCount = roles.length > 6 ? `<span style="font-size:11px; color:#64748b; font-weight:700;">+${roles.length - 6} more</span>` : '';

    return `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 12px 16px; font-weight: 700; color: var(--black); font-size: 14px;">${c.name}</td>
        <td style="padding: 12px 16px; color: #475569;">${c.hq_location || 'Bangalore'}</td>
        <td style="padding: 12px 16px; color: #64748b; font-size: 12.5px;">${c.elevator_pitch && !c.elevator_pitch.endsWith('tech team') ? c.elevator_pitch : 'Core Engineering'}</td>
        <td style="padding: 12px 16px;">${rolesList} ${moreCount}</td>
      </tr>
    `;
  }).join('');

  // Render Pagination Controls Below Table
  if (pagContainer) {
    const startItemNum = startIndex + 1;
    const endItemNum = Math.min(startIndex + catalogPageSize, activeCatalogData.length);

    pagContainer.innerHTML = `
      <div style="font-size:13px; color:#64748b; font-weight:500;">
        Showing <strong style="color:var(--black);">${startItemNum}</strong> to <strong style="color:var(--black);">${endItemNum}</strong> of <strong style="color:var(--black);">${activeCatalogData.length}</strong> companies
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn-secondary" onclick="changeCatalogPage(-1)" ${catalogCurrentPage === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} style="padding:6px 14px; font-size:12.5px;">← Previous</button>
        <span style="font-size:13px; font-weight:600; color:#334155; padding:0 8px;">Page ${catalogCurrentPage} of ${totalPages}</span>
        <button class="btn-secondary" onclick="changeCatalogPage(1)" ${catalogCurrentPage === totalPages ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} style="padding:6px 14px; font-size:12.5px;">Next →</button>
      </div>
    `;
  }
}

async function loadAdminAnalytics() {
  const container = document.getElementById('adminAnalyticsContent');
  if (!container) return;

  try {
    const res = await fetch('/api/candidates', { headers: getAuthHeaders() });
    const candidates = await res.json();

    const totalCalls = candidates.length;
    const completedCalls = candidates.filter(c => c.status === 'completed');
    const passes = completedCalls.filter(c => c.recommendation && (c.recommendation.startsWith('Yes') || c.recommendation.startsWith('Conditional')));
    const passRate = completedCalls.length > 0 ? Math.round((passes.length / completedCalls.length) * 100) : 0;

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; margin-bottom:24px;">
        <div style="background:#f8fafc; border:1.5px solid var(--border); padding:16px; border-radius:10px;">
          <div style="font-size:12px; color:#64748b; font-weight:600;">Total Conducted Screening Calls</div>
          <div style="font-size:24px; font-weight:800; color:var(--black); font-family:'Outfit',sans-serif; margin-top:4px;">${totalCalls}</div>
        </div>
        <div style="background:#f8fafc; border:1.5px solid var(--border); padding:16px; border-radius:10px;">
          <div style="font-size:12px; color:#64748b; font-weight:600;">Completed Evaluations</div>
          <div style="font-size:24px; font-weight:800; color:var(--black); font-family:'Outfit',sans-serif; margin-top:4px;">${completedCalls.length}</div>
        </div>
        <div style="background:#f8fafc; border:1.5px solid var(--border); padding:16px; border-radius:10px;">
          <div style="font-size:12px; color:#64748b; font-weight:600;">Candidate Qualification Pass Rate</div>
          <div style="font-size:24px; font-weight:800; color:#059669; font-family:'Outfit',sans-serif; margin-top:4px;">${passRate}%</div>
        </div>
      </div>

      <div style="overflow-x:auto; border:1.5px solid var(--border); border-radius:10px; background:#ffffff;">
        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
          <thead>
            <tr style="background:#f8fafc; border-bottom:1.5px solid var(--border); color:#475569; font-weight:700;">
              <th style="padding:10px 14px;">Candidate Name</th>
              <th style="padding:10px 14px;">Role &amp; Company</th>
              <th style="padding:10px 14px;">Overall Score</th>
              <th style="padding:10px 14px;">Tech Score</th>
              <th style="padding:10px 14px;">Comm Score</th>
              <th style="padding:10px 14px;">Recommendation</th>
              <th style="padding:10px 14px; text-align:right;">Detailed Call Report</th>
            </tr>
          </thead>
          <tbody>
            ${candidates.length === 0 ? `
              <tr><td colspan="7" style="padding:20px; text-align:center; color:#64748b;">No call evaluations recorded yet. Conduct a live call in Step 3 to see live reports.</td></tr>
            ` : candidates.map(c => `
              <tr style="border-bottom:1px solid var(--border); cursor:pointer;" onclick="window.onCandidateClick(${c.id})" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding:10px 14px; font-weight:700; color:var(--black); font-size:13.5px;">${c.name || 'Candidate'}</td>
                <td style="padding:10px 14px; color:#475569;">${c.job_title || 'Software Engineer'} ${c.company_name ? `@ ${c.company_name}` : ''}</td>
                <td style="padding:10px 14px; font-weight:800; color:var(--black);">${c.overall_score || 0}/10</td>
                <td style="padding:10px 14px; color:#475569;">${c.technical_score || 0}/10</td>
                <td style="padding:10px 14px; color:#475569;">${c.communication_score || 0}/10</td>
                <td style="padding:10px 14px;">
                  <span style="padding:3px 9px; border-radius:6px; font-weight:700; font-size:11.5px; ${c.recommendation && (c.recommendation.startsWith('Yes') || c.recommendation.startsWith('Strong') || c.recommendation.startsWith('Conditional')) ? 'background:#ecfdf5; color:#047857;' : 'background:#fff1f2; color:#be123c;'}">${c.recommendation || 'Pending'}</span>
                </td>
                <td style="padding:10px 14px; text-align:right;">
                  <button class="btn-secondary" onclick="event.stopPropagation(); window.onCandidateClick(${c.id})" style="padding:5px 12px; font-size:12px; font-weight:600;">🎙️ View Recording &amp; Transcript →</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Failed to load admin analytics:', err);
  }
}

window.handleCreateUser = async function(e) {
  e.preventDefault();
  const name = document.getElementById('newAmName').value.trim();
  const email = document.getElementById('newAmEmail').value.trim();
  const password = document.getElementById('newAmPassword').value;

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, email, password, role: 'account_manager' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create user');

    showToast(`✓ Account Manager ${name} created!`, 'success');
    document.getElementById('newAmName').value = '';
    document.getElementById('newAmEmail').value = '';
    document.getElementById('newAmPassword').value = '';
    await loadAdminUserList();
  } catch (err) {
    showToast(`⚠️ ${err.message}`, 'error');
  }
};

async function initVapi() {
  try {
    const res  = await fetch('/api/config');
    const body = await res.json();

    if (!res.ok) {
      setConnection('error', 'No API Key');
      showToast(`⚠️ ${body.error}`, 'error');
      return;
    }

    vapi = new Vapi(body.vapiPublicKey);
    wireVapiEvents();
    setConnection('connected', 'WeekdayAI is ready');
  } catch (err) {
    setConnection('error', 'Init Failed');
    console.error('Vapi init error:', err);
    showToast('Failed to initialize Maya. Is server running?', 'error');
  }
}

// ── Navigation Tab Switcher ────────────────────────────────────────────────
window.switchTab = function (tabNum) {
  // Auto-save current state on tab switch so no parameters or questions are lost
  if (currentUser && currentUser.role !== 'admin') {
    saveJob({ isAutoSave: true }).catch(() => {});
  }
  const map = { 1: '#/screener/role', 2: '#/screener/questions', 3: '#/screener/call', 4: '#/hub' };
  if (map[tabNum]) {
    let targetHash = map[tabNum];
    if (tabNum <= 3) {
      if (currentJobId) {
        targetHash += `?jobId=${currentJobId}`;
      } else {
        const companyId = currentCompanyId || 1;
        const roleTitle = document.getElementById('jobTitle')?.value?.trim();
        if (roleTitle) {
          targetHash += `?companyId=${companyId}&role=${encodeURIComponent(roleTitle)}`;
        }
      }
    }
    navigate(targetHash);
  }
};

window.copyAirtableDeepLink = function() {
  let targetUrl = '';
  if (currentJobId) {
    targetUrl = `${window.location.origin}/index.html#/screener/questions?jobId=${currentJobId}`;
  } else {
    const companyId = currentCompanyId || 1;
    const roleTitle = document.getElementById('jobTitle')?.value?.trim();
    if (roleTitle) {
      targetUrl = `${window.location.origin}/index.html#/screener/questions?companyId=${companyId}&role=${encodeURIComponent(roleTitle)}`;
    } else {
      targetUrl = `${window.location.origin}/index.html#/screener/questions`;
    }
  }

  navigator.clipboard.writeText(targetUrl)
    .then(() => showToast(`✓ Airtable Deep Link copied to clipboard!`, 'success'))
    .catch(() => showToast(`Link: ${targetUrl}`, 'info'));
};

window.saveAndNext = async function (currentTab) {
  if (currentTab === 1) {
    // Disable both Save & Continue buttons while working
    const btns = document.querySelectorAll('[onclick="saveAndNext(1)"]');
    await generateScriptWithAI();

    btns.forEach(b => { b.disabled = false; b.textContent = 'Save & Continue to AI Questions →'; });
    switchTab(2);

  } else if (currentTab === 2) {
    await saveJob();
    switchTab(3);
  }
};

// ── Tone Selector Handler ──────────────────────────────────────────────────
window.setTone = function (toneKey) {
  currentTone = toneKey;
  document.querySelectorAll('.tone-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-tone') === toneKey);
  });
};

let lastSavedJdFingerprint = '';
let isJdChanged = false;

// ── Job Config ─────────────────────────────────────────────────────────────
// NOTE: loadLatestJob is no longer called on boot.
// Form population is driven by company → role selection (handleRoleSelect → populateFormFromJob).
// This function is preserved for manual/programmatic use only.
async function loadLatestJob(companyId) {
  try {
    const url = companyId
      ? `/api/jobs/latest?companyId=${companyId}`
      : '/api/jobs/latest';
    const res = await fetch(url, { headers: getAuthHeaders() });
    const job = await res.json();
    if (job) {
      populateFormFromJob(job);
    }
  } catch (err) {
    console.warn('Could not load last job:', err.message);
  }
}

// ── AI Question Generator & Copilot ────────────────────────────────────────
window.generateScriptWithAI = async function () {
  let jdText          = document.getElementById('jdText').value.trim();
  const companyNameEl = document.getElementById('companyNameInput');
  const companyName   = (companyNameEl ? companyNameEl.value.trim() : '') || 'Weekday';
  const jobTitle      = document.getElementById('jobTitle').value.trim() || 'Software Engineer / Founder Office';
  const techStack     = document.getElementById('techStack').value.trim() || 'Software Engineering';
  const copilotPrompt = document.getElementById('copilotPrompt').value.trim();

  // If no JD text is present, provide a smart default so AI generator ALWAYS works!
  if (!jdText) {
    jdText = `Hiring for ${jobTitle} at ${companyName}. Requirements: ${techStack}. Looking for high ownership, strong problem solving, and immediate joining capability.`;
    document.getElementById('jdText').value = jdText;
  }

  const btn = document.getElementById('btnGenQuestions');
  btn.disabled = true;
  btn.textContent = '⚡ Architecting Questions...';

  try {
    const res = await fetch('/api/jobs/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdText, companyName, jobTitle, techStack, copilotPrompt })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentQuestionsState = data.topics || [];
    renderQuestionsArchitect();
    showToast('⚡ Interview questions architected successfully!', 'success');
  } catch (err) {
    showToast(`AI Architect failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Architect Questions with AI';
  }
};

// ── Copilot Action Dispatcher ──────────────────────────────────────────────
window.executeCopilotAction = async function () {
  const mode = document.getElementById('copilotMode')?.value || 'REPLACE_ALL';
  const prompt = document.getElementById('copilotPrompt').value.trim();

  if (mode === 'ADD_NEW') {
    if (!prompt) { showToast('Please enter what topic/question you want to add.', 'error'); return; }
    await addAIQuestionTopic(prompt);
  } else {
    await generateScriptWithAI();
  }
};

window.promptAddAiCategoryCard = function () {
  const input = prompt("Enter what question/topic you want AI to generate a card for:\n(e.g., 'Test sales resilience under cold call rejection' or 'Ask about notice period flexibility')");
  if (input && input.trim()) {
    addAIQuestionTopic(input.trim());
  }
};

async function addAIQuestionTopic(promptText) {
  const companyNameEl = document.getElementById('companyNameInput');
  const companyName = (companyNameEl ? companyNameEl.value.trim() : '') || 'Weekday';
  const jobTitle    = document.getElementById('jobTitle').value.trim();
  const techStack   = document.getElementById('techStack').value.trim();
  const jdText      = document.getElementById('jdText').value.trim();

  showToast('✨ Generating new AI category card...', '');
  try {
    const res = await fetch('/api/jobs/add-ai-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText, companyName, jobTitle, techStack, jdText })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentQuestionsState.push(data.newTopic);
    renderQuestionsArchitect();
    showToast('✨ New AI category card added!', 'success');
  } catch (err) {
    showToast(`Failed to add AI card: ${err.message}`, 'error');
  }
}

// ── Single Card Inline AI Refinement ────────────────────────────────────────
window.toggleInlineRefineBox = function (tIdx) {
  const box = document.getElementById(`refine-box-${tIdx}`);
  if (box) {
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
      const input = document.getElementById(`refine-input-${tIdx}`);
      if (input) input.focus();
    }
  }
};

window.refineSingleTopicWithAI = async function (tIdx) {
  const input = document.getElementById(`refine-input-${tIdx}`);
  const promptText = input ? input.value.trim() : '';

  if (!promptText) {
    showToast('Please enter an instruction (e.g. "Focus 50% on system design").', 'error');
    return;
  }

  const topic           = currentQuestionsState[tIdx];
  const companyNameEl   = document.getElementById('companyNameInput');
  const companyName     = (companyNameEl ? companyNameEl.value.trim() : '') || 'Weekday';
  const jobTitle        = document.getElementById('jobTitle').value.trim();
  const techStack       = document.getElementById('techStack').value.trim();
  const jdText          = document.getElementById('jdText').value.trim();
  const currentQuestion = topic.questions[0] || '';

  const btn = document.getElementById(`refine-btn-${tIdx}`);
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Refining...'; }

  try {
    const res = await fetch('/api/jobs/refine-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: topic.category,
        currentQuestion,
        jdText,
        companyName,
        jobTitle,
        techStack,
        prompt: promptText
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentQuestionsState[tIdx].questions[0] = data.refinedQuestion;
    renderQuestionsArchitect();
    showToast(`⚡ Refined "${topic.category}" question successfully!`, 'success');
  } catch (err) {
    showToast(`Refine failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refine Card'; }
  }
};

// ── Render Questions Architect Workspace ────────────────────────────────────
function renderQuestionsArchitect() {
  const container  = document.getElementById('topicsContainer');
  const countBadge = document.getElementById('questionCountBadge');

  if (!currentQuestionsState.length) {
    container.innerHTML = `
      <div class="topics-empty-placeholder">
        <div class="empty-sparkle">⚡</div>
        <h3>No Question Script Architected Yet</h3>
        <p>Click the <strong>"⚡ Run AI Copilot"</strong> button above to parse your JD and automatically generate 7 category topic cards.</p>
      </div>`;
    if (countBadge) countBadge.textContent = '0 Questions Active';
    updateRunningSummaryStats(0);
    return;
  }

  let totalQCount = 0;

  container.innerHTML = currentQuestionsState.map((topic, tIdx) => {
    const isEnabled = topic.enabled !== false;
    const questions = topic.questions || [];
    totalQCount += isEnabled ? questions.length : 0;

    return `
      <div class="topic-card ${isEnabled ? 'enabled-card' : 'disabled-card'}" id="topic-card-${tIdx}">
        <div class="topic-header">
          <div class="topic-title">
            <span>${topicIconMap(topic.category)}</span>
            <span>${esc(topic.category)}</span>
          </div>
          <div class="topic-header-actions">
            <button class="btn-card-refine" onclick="toggleInlineRefineBox(${tIdx})" title="Refine entire card with prompt">Card Refine</button>
            <label class="topic-toggle">
              <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleTopicEnabled(${tIdx}, this.checked)" />
              <span>Enable</span>
            </label>
          </div>
        </div>

        <!-- Inline Card AI Refine Prompt Box -->
        <div class="card-refine-box" id="refine-box-${tIdx}" style="display:none;">
          <input type="text" id="refine-input-${tIdx}" class="card-refine-input"
            placeholder="e.g. Focus 50% on system design and ask why they left 1st job in < 6 months..."
            onkeydown="if(event.key==='Enter') refineSingleTopicWithAI(${tIdx})" />
          <button class="btn-card-refine-run" id="refine-btn-${tIdx}" onclick="refineSingleTopicWithAI(${tIdx})">Refine Card</button>
        </div>

        ${isEnabled ? `
          <div class="topic-questions-list">
            ${questions.map((q, qIdx) => {
              const lowerQ = (q || '').toLowerCase();
              const isTechCat = topic.category.toLowerCase().includes('technical') || topic.category.toLowerCase().includes('architecture');
              const hasLogisticsKeywords = lowerQ.includes('notice') || lowerQ.includes('ctc') || lowerQ.includes('salary') || lowerQ.includes('budget') || lowerQ.includes('location');
              const showMismatchWarning = isTechCat && hasLogisticsKeywords;

              return `
                <div class="q-item-wrapper" style="margin-bottom:8px;">
                  <div class="q-item" style="display:flex; align-items:center; gap:8px;">
                    <input type="text" class="q-input" value="${esc(q)}" placeholder="Type custom interview question..." oninput="updateQuestionText(${tIdx}, ${qIdx}, this.value)" style="flex:1; padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;" />
                    <button type="button" class="btn-card-refine" onclick="refineQuestionInline(${tIdx}, ${qIdx})" style="padding:6px 12px; font-size:12px; font-weight:600; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; cursor:pointer;" title="1-Click AI Refine this question">✨ AI Refine</button>
                    <button class="btn-icon-del" onclick="deleteQuestion(${tIdx}, ${qIdx})" title="Delete question">✕</button>
                  </div>
                  ${showMismatchWarning ? `
                    <div style="font-size:11px; color:#d97706; background:#fffbeb; padding:3px 8px; border-radius:4px; margin-top:4px; display:inline-flex; align-items:center; gap:4px; border:1px solid #fde68a;">
                      <span>💡 Topic Mismatch: Notice/Salary question detected in Tech card.</span>
                      <button onclick="moveQuestionToCategory(${tIdx}, ${qIdx}, 'Logistics & Hard Dealbreakers')" style="background:none; border:none; color:#b45309; font-weight:700; text-decoration:underline; cursor:pointer; font-size:11px; padding:0;">Move to Logistics Card</button>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
            <button class="btn-add-q" onclick="addQuestionToTopic(${tIdx})">+ Add Question</button>
          </div>
        ` : ''}
      </div>`;
  }).join('');

  if (countBadge) countBadge.textContent = `${totalQCount} Questions Active`;
  updateRunningSummaryStats(totalQCount);
}

function updateRunningSummaryStats(activeQCount) {
  const countEl = document.getElementById('summaryActiveQuestionsCount');
  const durEl   = document.getElementById('summarySyncedDuration');
  const recruiterName = document.getElementById('recruiterName')?.value?.trim() || 'Maya';

  const estMins = Math.max(3, Math.round((activeQCount || 1) * 1.5));

  if (countEl) countEl.textContent = `${activeQCount} Active Questions`;
  if (durEl)   durEl.textContent   = `~${estMins} Mins (Synced to ${recruiterName})`;
}

window.refineQuestionInline = async function(tIdx, qIdx) {
  const currentQ = currentQuestionsState[tIdx]?.questions[qIdx] || '';
  const category = currentQuestionsState[tIdx]?.category || 'General';
  const companyNameEl = document.getElementById('companyNameInput');
  const companyName   = (companyNameEl ? companyNameEl.value.trim() : '') || 'Weekday';
  const jobTitle      = document.getElementById('jobTitle')?.value?.trim() || 'Software Engineer';
  const techStack     = document.getElementById('techStack')?.value?.trim() || '';

  showToast(`⚡ AI Refining question inline...`, 'info');

  try {
    const res = await fetch('/api/jobs/refine-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        currentQuestion: currentQ,
        companyName,
        jobTitle,
        techStack,
        prompt: 'Make it punchier, conversational, and max 2 aspects.'
      })
    });
    const data = await res.json();
    if (data.refinedQuestion) {
      currentQuestionsState[tIdx].questions[qIdx] = data.refinedQuestion;
      renderQuestionsArchitect();
      showToast(`✨ Question refined inline!`, 'success');
      saveJob({ isAutoSave: true }).catch(() => {});
    }
  } catch (err) {
    showToast('Failed to refine question inline.', 'error');
  }
};

window.moveQuestionToCategory = function(fromTidx, fromQidx, targetCategoryName) {
  const qText = currentQuestionsState[fromTidx]?.questions[fromQidx];
  if (!qText) return;

  // Find or create target category
  let targetCat = currentQuestionsState.find(t => t.category.toLowerCase().includes('logistics'));
  if (!targetCat) {
    targetCat = { category: targetCategoryName, enabled: true, questions: [] };
    currentQuestionsState.push(targetCat);
  }

  targetCat.questions.push(qText);
  currentQuestionsState[fromTidx].questions.splice(fromQidx, 1);

  renderQuestionsArchitect();
  showToast(`✓ Question moved to ${targetCategoryName}!`, 'success');
  saveJob({ isAutoSave: true }).catch(() => {});
};

function topicIconMap(category) {
  if (category.includes('Career'))     return '🔄';
  if (category.includes('Technical'))  return '⚡';
  if (category.includes('Company'))    return '🏢';
  if (category.includes('Ownership'))  return '🚀';
  if (category.includes('Product'))    return '📊';
  if (category.includes('Academics'))  return '🎓';
  if (category.includes('Logistics'))  return '📍';
  return '💬';
}

window.toggleTopicEnabled = function (tIdx, enabled) {
  currentQuestionsState[tIdx].enabled = enabled;
  renderQuestionsArchitect();
  saveJob({ isAutoSave: true }).catch(() => {});
};

window.updateQuestionText = function (tIdx, qIdx, text) {
  currentQuestionsState[tIdx].questions[qIdx] = text;
  // Recalculate stats live
  let total = 0;
  currentQuestionsState.forEach(t => { if (t.enabled !== false) total += (t.questions || []).length; });
  updateRunningSummaryStats(total);
  saveJob({ isAutoSave: true }).catch(() => {});
};

window.deleteQuestion = function (tIdx, qIdx) {
  currentQuestionsState[tIdx].questions.splice(qIdx, 1);
  renderQuestionsArchitect();
  saveJob({ isAutoSave: true }).catch(() => {});
};

window.addQuestionToTopic = function (tIdx) {
  currentQuestionsState[tIdx].questions.push('');
  renderQuestionsArchitect();
  saveJob({ isAutoSave: true }).catch(() => {});
};

// ── Save Job Config ────────────────────────────────────────────────────────
window.saveJob = async function (options = {}) {
  const isAutoSave = options && options.isAutoSave;
  const companyNameInput = document.getElementById('companyNameInput');
  const companyName   = companyNameInput ? companyNameInput.value.trim() : 'Weekday';
  const companyId     = currentCompanyId || 1;
  const title         = document.getElementById('jobTitle')?.value?.trim() || '';
  const location      = document.getElementById('location')?.value?.trim() || 'Hybrid / Onsite';
  const maxNoticeDays = document.getElementById('maxNoticeDays')?.value?.trim() || '30';
  const techStack     = document.getElementById('techStack')?.value?.trim() || '';
  const targetCpa     = document.getElementById('targetCpa')?.value?.trim() || '';
  const languageMode  = document.getElementById('languageMode')?.value || 'en-IN';
  const voiceId       = document.getElementById('voiceId')?.value || 'shimmer';
  const recruiterName = document.getElementById('recruiterName')?.value?.trim() || 'Maya';
  let jdText          = document.getElementById('jdText')?.value?.trim() || '';

  if (!title) {
    if (!isAutoSave) showToast('Please select a Target Role Title.', 'error');
    return;
  }
  if (!jdText) {
    jdText = `Hiring for ${title} at ${companyName || 'Weekday'}. Requirements: ${techStack || 'Engineering'}.`;
    if (document.getElementById('jdText')) document.getElementById('jdText').value = jdText;
  }

  try {
    const newFingerprint = `${title}__${companyName}__${jdText}`.trim();
    if (newFingerprint !== lastSavedJdFingerprint) {
      isJdChanged = true;
      lastSavedJdFingerprint = newFingerprint;
    } else {
      isJdChanged = false;
    }

    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        companyId,
        companyName,
        title,
        location,
        maxNoticeDays,
        techStack,
        targetCpa,
        tone: currentTone,
        languageMode,
        voiceId,
        recruiterName,
        customQuestions: currentQuestionsState,
        jdText
      })
    });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error);

    currentJobId = job.id;
    const currentHashClean = (window.location.hash || '#/screener/role').split('?')[0];
    if (currentHashClean.startsWith('#/screener/')) {
      window.history.replaceState(null, '', `${currentHashClean}?jobId=${job.id}`);
    }

    const status = document.getElementById('jobSaveStatus');
    if (status) {
      status.textContent = '✓ Config & Persona saved!';
      setTimeout(() => (status.textContent = ''), 3500);
    }
    if (!isAutoSave) {
      showToast('Screening configuration saved!', 'success');
    }
  } catch (err) {
    if (!isAutoSave) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }
};

// ── Recruiter Name Dynamic Handler ─────────────────────────────────────────
window.handleRecruiterNameInput = function(val) {
  const name = (val || '').trim() || 'Maya';
  const startBtnSpan = document.getElementById('startBtnText');
  if (startBtnSpan) startBtnSpan.textContent = `Start Screening with ${name}`;

  // Recalculate stats live to sync name in summary panel
  let total = 0;
  if (Array.isArray(currentQuestionsState)) {
    currentQuestionsState.forEach(t => { if (t.enabled !== false) total += (t.questions || []).length; });
  }
  updateRunningSummaryStats(total);
};

// ── Start Interview ────────────────────────────────────────────────────────
window.startInterview = async function () {
  const candidateName = document.getElementById('candidateName').value.trim();
  const candidateBio  = document.getElementById('candidateBio')?.value?.trim() || '';
  const recruiterName = document.getElementById('recruiterName')?.value?.trim() || 'Maya';

  if (!candidateName) { showToast("Please enter candidate's full name.", 'error'); return; }
  if (!currentJobId)  { showToast('Please save Screening Config first.', 'error'); return; }
  if (!vapi)          { showToast('AI Recruiter engine not initialized. Check Vapi key in .env.', 'error'); return; }

  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.textContent = `Connecting to ${recruiterName}...`;

  try {
    const currentVoiceId = document.getElementById('voiceId')?.value || 'rachel';
    const res = await fetch('/api/candidates', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ 
        name: candidateName, 
        jobId: currentJobId, 
        candidateBio,
        recruiterName,
        voiceId: currentVoiceId,
        clonedPersonaInstructions: activeClonedPersona?.system_instructions || '',
        clonedPersonaDna: activeClonedPersona?.style_dna || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentCandidateId = data.candidateId;

    const jobTitle = document.getElementById('jobTitle').value.trim();
    document.getElementById('callerInitial').textContent     = candidateName[0].toUpperCase();
    document.getElementById('callerNameDisplay').textContent = candidateName;
    document.getElementById('callerRoleDisplay').textContent = `${recruiterName} screening for ${jobTitle || 'Role'}`;

    showState('active');
    setLabel('aiStatusLabel', `Connecting to ${recruiterName}...`);
    setBadge('Calling', 'calling');

    const call = await vapi.start(data.vapiConfig);
    activeCallId = call?.id || null;

    if (activeCallId) {
      fetch(`/api/candidates/${currentCandidateId}/call-started`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: activeCallId })
      }).catch(console.error);
    }

  } catch (err) {
    console.error('Failed to start interview:', err);
    showToast(`Failed to start: ${err.message}`, 'error');
    showState('idle');
    setBadge('Idle', '');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<div class="start-btn-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div><span id="startBtnText">Start Screening with ${recruiterName}</span>`;
  }
};

// ── End Interview ──────────────────────────────────────────────────────────
window.endInterview = function () {
  if (vapi) {
    try { vapi.stop(); } catch (_) {}
  }
};

// ── Vapi Event Listeners ───────────────────────────────────────────────────
function wireVapiEvents() {
  vapi.on('call-start', () => {
    setBadge('Active', 'active');
    setLabel('aiStatusLabel', 'Maya is conducting the screening call...');
    startCallTimer();
    loadCandidates();

    // Reset Live Transcript Feed
    const feed = document.getElementById('liveTranscriptFeed');
    if (feed) feed.innerHTML = '<p class="lt-placeholder">Live conversation stream started...</p>';
  });

  vapi.on('message', (msg) => {
    if (msg.type === 'transcript' && msg.transcript) {
      appendLiveTranscript(msg.role === 'assistant' ? 'Maya' : 'Candidate', msg.transcript, msg.role);
    }
  });

  vapi.on('call-end', async () => {
    stopCallTimer();
    showState('processing');
    setBadge('Processing', 'processing');
    showToast('Screening call ended. Evaluating dealbreakers (~20 sec)...', '');
    await loadCandidates();
    startPolling();
  });

  vapi.on('speech-start', () => {
    setLabel('aiStatusLabel', '🤖 Maya is speaking...');
    const vis = document.getElementById('visualizer');
    vis.classList.remove('listening');
    vis.classList.add('speaking');
  });

  vapi.on('speech-end', () => {
    setLabel('aiStatusLabel', '🎤 Listening to candidate...');
    const vis = document.getElementById('visualizer');
    vis.classList.remove('speaking');
    vis.classList.add('listening');
  });

  vapi.on('volume-level', (level) => {
    document.querySelectorAll('.vis-bar').forEach((bar) => {
      const jitter = (0.5 + Math.random() * 0.5) * level;
      bar.style.height = `${Math.max(6, Math.min(50, jitter * 54))}px`;
    });
  });

  vapi.on('error', (err) => {
    console.error('Vapi error:', err);
    showToast(`Call error: ${err?.message || 'Unknown error'}`, 'error');
    showState('idle');
    setBadge('Idle', '');
    stopCallTimer();
    clearInterval(pollingInterval);
    loadCandidates();
  });
}

// ── Live Transcript Stream Smart Scroll & Fullscreen ─────────────────────────
let userIsScrolledUp = false;

window.handleTranscriptScroll = function (feedEl) {
  if (!feedEl) return;
  const distanceToBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight;
  userIsScrolledUp = distanceToBottom > 60;
  const pill = document.getElementById('ltScrollPill');
  if (pill) {
    if (userIsScrolledUp) pill.classList.remove('hidden');
    else pill.classList.add('hidden');
  }
};

window.scrollToTranscriptBottom = function () {
  const feed = document.getElementById('liveTranscriptFeed');
  if (feed) {
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    userIsScrolledUp = false;
    const pill = document.getElementById('ltScrollPill');
    if (pill) pill.classList.add('hidden');
  }
};

window.openFullscreenTranscript = function () {
  const feed = document.getElementById('liveTranscriptFeed');
  const fsFeed = document.getElementById('fsTranscriptFeed');
  const modal = document.getElementById('fullscreenTranscriptModal');
  if (feed && fsFeed && modal) {
    fsFeed.innerHTML = feed.innerHTML;
    modal.classList.remove('hidden');
  }
};

window.closeFullscreenTranscript = function () {
  const modal = document.getElementById('fullscreenTranscriptModal');
  if (modal) modal.classList.add('hidden');
};

window.closeFullscreenTranscriptOnBg = function (e) {
  if (e.target && e.target.id === 'fullscreenTranscriptModal') {
    closeFullscreenTranscript();
  }
};

let currentTurnSpeaker = null;
let currentTurnMsgElement = null;
let currentFsTurnMsgElement = null;

function appendLiveTranscript(speaker, text, role) {
  const feed = document.getElementById('liveTranscriptFeed');
  const fsFeed = document.getElementById('fsTranscriptFeed');
  if (!feed) return;

  const placeholder = feed.querySelector('.lt-placeholder');
  if (placeholder) placeholder.remove();

  const isBot = role === 'assistant';
  const speakerLabel = isBot ? '🤖 Maya (AI Recruiter)' : '👤 Candidate';
  const innerHTML = `<div class="lt-speaker-badge">${speakerLabel}</div><div>${esc(text)}</div>`;

  // Update existing speaker turn bubble or append new speech bubble
  if (currentTurnSpeaker === role && currentTurnMsgElement) {
    currentTurnMsgElement.innerHTML = innerHTML;
    if (currentFsTurnMsgElement) currentFsTurnMsgElement.innerHTML = innerHTML;
  } else {
    currentTurnSpeaker = role;

    const msgDiv = document.createElement('div');
    msgDiv.className = `lt-msg ${isBot ? 'bot' : 'user'}`;
    msgDiv.innerHTML = innerHTML;
    feed.appendChild(msgDiv);
    currentTurnMsgElement = msgDiv;

    if (fsFeed) {
      const fsMsgDiv = document.createElement('div');
      fsMsgDiv.className = `lt-msg ${isBot ? 'bot' : 'user'}`;
      fsMsgDiv.innerHTML = innerHTML;
      fsFeed.appendChild(fsMsgDiv);
      currentFsTurnMsgElement = fsMsgDiv;
      fsFeed.scrollTop = fsFeed.scrollHeight;
    }
  }

  // Only auto-scroll feed if user hasn't manually scrolled up to read earlier text!
  if (!userIsScrolledUp) {
    feed.scrollTop = feed.scrollHeight;
  } else {
    const pill = document.getElementById('ltScrollPill');
    if (pill) pill.classList.remove('hidden');
  }
}

// ── Result Polling ─────────────────────────────────────────────────────────
function startPolling() {
  let attempts = 0;
  const MAX    = 24;

  clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    if (attempts++ >= MAX || !currentCandidateId) {
      clearInterval(pollingInterval);
      showState('idle');
      setBadge('Idle', '');
      showToast('Analysis timed out. Click refresh to check History.', 'error');
      return;
    }

    updateProcessingSteps(attempts);

    try {
      const res  = await fetch(`/api/candidates/${currentCandidateId}/results`);
      const data = await res.json();

      if (data.status === 'completed' && data.overallScore != null) {
        clearInterval(pollingInterval);
        await loadCandidates();
        showState('idle');
        setBadge('Idle', '');
        document.getElementById('candidateName').value = '';
        showToast('✅ Evaluation report ready!', 'success');
        setTimeout(() => openModal(currentCandidateId, data), 600);
      }
    } catch (err) {
      console.warn('Polling error:', err.message);
    }
  }, 3000);
}

function updateProcessingSteps(attempt) {
  const s1 = document.getElementById('procStep1');
  const s2 = document.getElementById('procStep2');
  const s3 = document.getElementById('procStep3');
  if (attempt >= 2) { s1.className = 'proc-step done';   s1.children[0].textContent = '✓'; }
  if (attempt >= 4) { s2.className = 'proc-step active'; s2.children[0].textContent = '⟳'; }
  if (attempt >= 7) { s3.className = 'proc-step active'; s3.children[0].textContent = '⟳'; }
}

// ── Candidates List & Filtering ────────────────────────────────────────────
window.loadCandidates = async function () {
  try {
    const res          = await fetch('/api/candidates', { headers: getAuthHeaders() });
    allCandidatesCache = await res.json();
    renderCandidates(allCandidatesCache);
  } catch (err) {
    console.error('Failed to load candidates:', err);
  }
};

window.filterCandidates = function () {
  const query = (document.getElementById('historySearchInput')?.value || '').toLowerCase().trim();
  if (!query) {
    renderCandidates(allCandidatesCache);
    return;
  }
  const filtered = allCandidatesCache.filter(c => 
    (c.name || '').toLowerCase().includes(query) ||
    (c.job_title || '').toLowerCase().includes(query) ||
    (c.recommendation || '').toLowerCase().includes(query)
  );
  renderCandidates(filtered);
};

function renderCandidates(candidates) {
  const list = document.getElementById('candidatesList');
  if (!candidates.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>No candidates found.</p>
      </div>`;
    return;
  }

  list.innerHTML = candidates.map(c => {
    const hasScores = c.overall_score != null;
    return `
      <div class="candidate-card" id="card-${c.id}" onclick="onCandidateClick(${c.id})">
        <div class="cc-header">
          <span class="cc-name">${esc(c.name)}</span>
          <span class="chip chip-${c.status}">${c.status}</span>
        </div>
        <div class="cc-role">${esc(c.job_title || '')} ${c.company_name ? '@ ' + esc(c.company_name) : ''}</div>
        ${hasScores ? `
          <div class="cc-scores">
            <span class="cc-score">Overall: <strong>${c.overall_score}/10</strong></span>
            <span class="cc-score">Tech: <strong>${c.technical_score}/10</strong></span>
            <span class="cc-score">Comm: <strong>${c.communication_score}/10</strong></span>
          </div>
          <div class="cc-rec">&rarr; ${esc(c.recommendation || '')}</div>
        ` : ''}
      </div>`;
  }).join('');
}

window.onCandidateClick = async function (id) {
  try {
    const res  = await fetch(`/api/candidates/${id}/results`);
    const data = await res.json();
    if (data.status !== 'completed' || data.overallScore == null) {
      showToast('Results not available yet. Please wait.', '');
      return;
    }
    openModal(id, data);
  } catch (err) {
    showToast('Failed to load results.', 'error');
  }
};

// ── Results Modal ──────────────────────────────────────────────────────────
async function openModal(candidateId, data) {
  currentModalReportData = { ...data };

  let candidateName = `Candidate #${candidateId}`;
  let meta = '';
  try {
    const res = await fetch(`/api/candidates/${candidateId}`);
    const c   = await res.json();
    candidateName = c.name || candidateName;
    currentModalReportData._name = candidateName;
    if (c.job_title)     meta += `${c.job_title} @ ${c.company_name || 'Weekday'}`;
    if (c.duration_secs) meta += ` · ${formatDuration(c.duration_secs)}`;
    currentModalReportData._meta = meta;
  } catch (_) {}

  document.getElementById('modalCandidateName').textContent = candidateName;
  document.getElementById('modalMeta').textContent          = meta;

  const overall  = data.overallScore || 0;
  const offset   = 314 - (314 * overall / 10);
  const ringFill = document.getElementById('ringOverallFill');
  document.getElementById('scoreOverall').textContent = `${overall}`;
  setTimeout(() => {
    ringFill.style.strokeDashoffset = String(offset);
    if      (overall >= 8) ringFill.style.stroke = '#059669';
    else if (overall >= 6) ringFill.style.stroke = '#0284c7';
    else if (overall >= 4) ringFill.style.stroke = '#d97706';
    else                   ringFill.style.stroke = '#e11d48';
  }, 80);

  const tech = data.technicalScore     || 0;
  const comm = data.communicationScore || 0;
  document.getElementById('scoreTechnical').textContent     = `${tech}/10`;
  document.getElementById('scoreCommunication').textContent = `${comm}/10`;
  setTimeout(() => {
    document.getElementById('barTech').style.width = `${tech * 10}%`;
    document.getElementById('barComm').style.width = `${comm * 10}%`;
  }, 100);

  const isDroppedCall = data.recommendation === 'Call Dropped Early (Re-Screen)' || data.overallScore === 0;
  const health        = data.callHealth || {};
  const hasIncident   = health.hasIncident || isDroppedCall;

  // Render Uber-Grade Call Incident Diagnostic Banner
  const incContainer = document.getElementById('incidentBannerContainer');
  if (incContainer) {
    if (hasIncident) {
      const durationText = data.durationSecs ? `${data.durationSecs}s` : '0:25s';
      const rootCause    = health.rootCause || 'Candidate disconnected during Beat 2 (Story & Switch Reason).';
      const impact       = health.impact    || 'Technical stack, notice period & salary budget unverified.';
      const sentiment    = health.sentiment || 'Neutral / Abrupt Disconnect';
      const title        = health.incidentTitle || `🚨 CALL INCIDENT DETECTED: Call Dropped at ${durationText}`;

      incContainer.innerHTML = `
        <div class="incident-card">
          <div class="incident-card-header">
            <div class="incident-badge">
              <span class="pulse-red"></span> ${esc(title)}
            </div>
            <span class="incident-timestamp">INCIDENT AUDIT DIAGNOSTIC</span>
          </div>

          <div class="incident-grid">
            <div class="incident-col">
              <div class="inc-label">🔍 ROOT CAUSE</div>
              <div class="inc-val">${esc(rootCause)}</div>
            </div>
            <div class="incident-col">
              <div class="inc-label">⚡ IMPACT &amp; UNVERIFIED PILLARS</div>
              <div class="inc-val">${esc(impact)}</div>
            </div>
            <div class="incident-col">
              <div class="inc-label">😊 CANDIDATE SENTIMENT</div>
              <div class="inc-val sentiment-neutral">${esc(sentiment)}</div>
            </div>
          </div>

          <div class="incident-actions">
            <button class="btn-inc-action primary" onclick="retryAiCall(${candidateId})">📞 Retry AI Call</button>
            <button class="btn-inc-action whatsapp" onclick="copyRecoveryWhatsAppCard(${candidateId})">📲 Send Recovery WhatsApp</button>
            <button class="btn-inc-action secondary" onclick="flagForHumanReview(${candidateId})">📝 Flag for Human Review</button>
          </div>
        </div>`;
    } else {
      incContainer.innerHTML = '';
    }
  }

  const recMap = {
    'Strong Yes': ['rec-strong-yes', '🟢'],
    'Yes':        ['rec-yes',        '🔵'],
    'Maybe':      ['rec-maybe',      '🟡'],
    'No':         ['rec-no',         '🔴'],
    'Call Dropped Early (Re-Screen)': ['rec-no', '🔴']
  };
  const [cls, emoji] = recMap[data.recommendation] || ['rec-no', '🔴'];
  const recEl = document.getElementById('recommendationBanner');
  recEl.className   = `recommendation-banner ${cls}`;
  recEl.textContent = isDroppedCall 
    ? `🔴 Call Dropped Early (< 45s) — Re-Screen Recommended`
    : `${emoji}  Maya Recommendation: ${data.recommendation || 'Inconclusive'}`;

  // Audio Recording Playback Player
  const audioContainer = document.getElementById('audioPlayerContainer');
  const audioPlayer    = document.getElementById('modalAudioPlayer');
  if (data.recordingUrl) {
    if (audioPlayer) audioPlayer.src = data.recordingUrl;
    if (audioContainer) audioContainer.style.display = 'block';
  } else {
    if (audioContainer) audioContainer.style.display = 'none';
    if (audioPlayer) audioPlayer.src = '';
  }

  document.getElementById('modalSummary').textContent = data.summary || 'No summary available.';

  const hlEl = document.getElementById('modalHighlights');
  hlEl.innerHTML = (data.highlights || []).length
    ? data.highlights.map(h => `<li>${esc(h)}</li>`).join('')
    : '<li>No highlights recorded.</li>';

  const cnEl          = document.getElementById('modalConcerns');
  const concernsBlock = document.getElementById('concernsBlock');
  const concerns      = data.concerns || [];
  if (concerns.length) {
    cnEl.innerHTML = concerns.map(c => `<li>${esc(c)}</li>`).join('');
    concernsBlock.style.display = '';
  } else {
    concernsBlock.style.display = 'none';
  }

  // ── Talent Persona Card ─────────────────────────────────────────────────
  const personaBlock = document.getElementById('talentPersonaBlock');
  const tp = data.talentPersona;
  if (tp && tp.label) {
    document.getElementById('tpIcon').textContent  = tp.icon  || '👤';
    document.getElementById('tpLabel').textContent = tp.label || '';
    document.getElementById('tpDesc').textContent  = tp.description || '';
    document.getElementById('tpNote').textContent  = tp.recruiterNote || '';
    personaBlock.style.display = '';
  } else {
    personaBlock.style.display = 'none';
  }

  // ── Answer Depth Radar ──────────────────────────────────────────────────
  const radarBlock = document.getElementById('answerRadarBlock');
  const radarCards = document.getElementById('answerRadarCards');
  const vague      = data.vagueAnswers || [];
  if (vague.length) {
    radarCards.innerHTML = vague.map(v => `
      <div class="radar-item">
        <div class="radar-flag-row">
          <span class="radar-flag-dot"></span>
          <span class="radar-flag-text">${esc(v.flag || 'Depth not confirmed in call')}</span>
        </div>
        <div class="radar-q"><strong>Q asked:</strong> ${esc(v.questionAsked || '')}</div>
        <div class="radar-q"><strong>Candidate said:</strong> "${esc(v.candidateAnswer || '')}"</div>
        <div class="radar-reason">${esc(v.flagReason || '')}</div>
        <div class="radar-followup">
          <span class="radar-followup-label">Round 2</span>
          <span class="radar-followup-text">${esc(v.followUpQuestion || '')}</span>
        </div>
      </div>`).join('');
    radarBlock.style.display = '';
  } else {
    radarBlock.style.display = 'none';
  }

  document.getElementById('modalTranscript').textContent =
    (data.transcript || '').trim() || 'Transcript not available.';


  document.getElementById('resultsModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

window.closeModal = function () {
  document.getElementById('resultsModal').classList.add('hidden');
  document.body.style.overflow = '';
};

window.handleModalClick = function (e) {
  if (e.target.id === 'resultsModal') closeModal();
};

// ── Copy / Download Report ─────────────────────────────────────────────────
window.copyWhatsAppCard = function () {
  const d = currentModalReportData;
  if (!d) return;

  const recEmojiMap = { 'Strong Yes': '🟢', 'Yes': '🔵', 'Maybe': '🟡', 'No': '🔴' };
  const emoji = recEmojiMap[d.recommendation] || '⚪';

  const card = `*${emoji} AI CANDIDATE SCREENING REPORT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Candidate*: ${d._name || 'Candidate'}
*Role*: ${d._meta || 'Position'}
*Maya Recommendation*: *${d.recommendation || 'Evaluated'}*

📊 *SCORE BREAKDOWN*
• *Overall Score*: ${d.overallScore || '—'}/10
• *Technical Depth*: ${d.technicalScore || '—'}/10
• *Communication*: ${d.communicationScore || '—'}/10

📝 *EXECUTIVE SUMMARY*
${d.summary || 'Screening completed successfully.'}

✅ *KEY STRENGTHS*
${(d.highlights || []).map(h => `• ${h}`).join('\n') || '• Strong candidate profile'}

⚠️ *DEALBREAKERS & LOGISTICS*
${(d.concerns || []).map(c => `• ${c}`).join('\n') || '• Notice period, WFO location & CTC aligned'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Generated automatically by WeekdayAI_`;

  navigator.clipboard.writeText(card)
    .then(() => showToast('📲 Formatted WhatsApp card copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed.', 'error'));
};

window.copyCandidateReport = function () {
  const d = currentModalReportData;
  if (!d) return;

  const text = `📋 CANDIDATE SCREENING REPORT
==============================
Candidate:      ${d._name || 'N/A'}
Role:           ${d._meta || 'N/A'}
Recommendation: ${d.recommendation || 'N/A'}

📊 SCORES
• Overall Score:    ${d.overallScore || '—'}/10
• Technical Fit:    ${d.technicalScore || '—'}/10
• Communication:    ${d.communicationScore || '—'}/10

📝 EXECUTIVE SUMMARY
${d.summary || 'N/A'}

✅ KEY HIGHLIGHTS
${(d.highlights || []).map(h => `• ${h}`).join('\n') || '• None recorded'}

⚠️ CONCERNS & DEALBREAKERS
${(d.concerns || []).map(c => `• ${c}`).join('\n') || '• None'}
`;

  navigator.clipboard.writeText(text)
    .then(()  => showToast('📋 Bullet report copied to clipboard!', 'success'))
    .catch(()  => showToast('Copy failed — try the Download button.', 'error'));
};

window.downloadCandidateReport = function () {
  const d = currentModalReportData;
  if (!d) return;

  const name = (d._name || 'candidate').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const text = `CANDIDATE SCREENING REPORT
==========================
Candidate:      ${d._name || 'N/A'}
Role:           ${d._meta || 'N/A'}
Recommendation: ${d.recommendation || 'N/A'}

SCORES
------
Overall Score:  ${d.overallScore || '—'}/10
Technical Fit:  ${d.technicalScore || '—'}/10
Communication:  ${d.communicationScore || '—'}/10

EXECUTIVE SUMMARY
-----------------
${d.summary || 'N/A'}

KEY HIGHLIGHTS
--------------
${(d.highlights || []).map(h => `- ${h}`).join('\n') || '- None recorded'}

CONCERNS & DEALBREAKERS
-----------------------
${(d.concerns || []).map(c => `- ${c}`).join('\n') || '- None'}

FULL TRANSCRIPT
---------------
${(d.transcript || 'N/A').trim()}
`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${name}_screening_report.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 Report downloaded!', 'success');
};

// ── UI State Machine ───────────────────────────────────────────────────────
function showState(state) {
  document.getElementById('stateIdle').classList.toggle('hidden',       state !== 'idle');
  document.getElementById('stateActive').classList.toggle('hidden',     state !== 'active');
  document.getElementById('stateProcessing').classList.toggle('hidden', state !== 'processing');

  if (state !== 'active') {
    document.getElementById('visualizer').classList.remove('speaking', 'listening');
  }
}

function setBadge(text, type) {
  const badge = document.getElementById('callStatusBadge');
  badge.textContent = text;
  badge.className   = `status-badge${type ? ' ' + type : ''}`;
}

function setLabel(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setConnection(state, label) {
  const dot = document.getElementById('connectionDot');
  const lbl = document.getElementById('connectionLabel');
  if (dot) dot.className = `dot ${state}`;
  if (lbl) lbl.textContent = label;
}

function startCallTimer() {
  callStartTime = Date.now();
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    document.getElementById('callTimer').textContent = formatDuration(elapsed);
  }, 1000);
}

function stopCallTimer() { clearInterval(callTimerInterval); }

function formatDuration(secs) {
  if (!secs) return '0:00';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

let toastTimer = null;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Step 4: Role Leaderboard & Ranking Dashboard ───────────────────────────
let topRankedCandidateCache = null;

window.renderLeaderboardDashboard = function () {
  const selectFilter = document.getElementById('leaderboardRoleFilter');
  const selectedRole = selectFilter ? selectFilter.value : 'ALL';

  // Populate Role Filter dropdown with unique roles in cache
  if (selectFilter && allCandidatesCache.length) {
    const roles = Array.from(new Set(allCandidatesCache.map(c => c.job_title).filter(Boolean)));
    const currentVal = selectFilter.value;
    selectFilter.innerHTML = `<option value="ALL">All Roles &amp; Positions</option>` +
      roles.map(r => `<option value="${esc(r)}"${r === currentVal ? ' selected' : ''}>${esc(r)}</option>`).join('');
  }

  // Filter candidates with completed scorecards
  let candidates = allCandidatesCache.filter(c => c.overall_score != null);
  if (selectedRole !== 'ALL') {
    candidates = candidates.filter(c => c.job_title === selectedRole);
  }

  // Sort by Overall Score DESC, Tech Score DESC, Comm Score DESC
  candidates.sort((a, b) => {
    if (b.overall_score !== a.overall_score) return b.overall_score - a.overall_score;
    if (b.technical_score !== a.technical_score) return b.technical_score - a.technical_score;
    return (b.communication_score || 0) - (a.communication_score || 0);
  });

  const spotlightBanner = document.getElementById('spotlightBanner');
  const tbody             = document.getElementById('leaderboardTbody');

  if (!candidates.length) {
    if (spotlightBanner) spotlightBanner.style.display = 'none';
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 36px; text-align: center;">
            <p class="empty-sub">No completed evaluations found for this role filter. Run screening calls to view rankings.</p>
          </td>
        </tr>`;
    }
    return;
  }

  // #1 Spotlight Candidate
  const top = candidates[0];
  topRankedCandidateCache = top;

  // Update Executive KPI Strip
  const kpiTotal     = document.getElementById('kpiTotalScreened');
  const kpiTop       = document.getElementById('kpiTopScore');
  const kpiIncidents = document.getElementById('kpiIncidentsCount');
  const incBadge     = document.getElementById('incidentBadgeCount');

  const incidentsList = allCandidatesCache.filter(c => 
    !c.incident_resolved && (c.recommendation === 'Call Dropped Early (Re-Screen)' || c.overall_score === 0 || (c.call_health && c.call_health.hasIncident))
  );

  if (kpiTotal)     kpiTotal.textContent     = String(candidates.length);
  if (kpiTop)       kpiTop.textContent       = top?.overall_score != null ? `${top.overall_score}/10` : '—';
  if (kpiIncidents) kpiIncidents.textContent = String(incidentsList.length);
  if (incBadge)     incBadge.textContent     = `${incidentsList.length} TASKS`;

  if (spotlightBanner) {
    spotlightBanner.style.display = 'flex';
    document.getElementById('spotlightName').textContent    = top.name;
    document.getElementById('spotlightMeta').textContent    = `${top.job_title || 'Role'} ${top.company_name ? '@ ' + top.company_name : ''}`;
    document.getElementById('spotlightOverall').textContent = `${top.overall_score}/10`;
    document.getElementById('spotlightTech').textContent    = `${top.technical_score}/10`;
    document.getElementById('spotlightComm').textContent    = `${top.communication_score}/10`;
  }

  // Render Ranking Table Rows
  const recMap = {
    'Strong Yes': '🟢 Strong Yes',
    'Yes':        '🔵 Yes',
    'Maybe':      '🟡 Maybe',
    'No':         '🔴 No'
  };

  tbody.innerHTML = candidates.map((c, idx) => {
    let rankBadge = `<span class="rank-pill">${idx + 1}</span>`;
    if (idx === 0) rankBadge = `<span class="rank-pill gold">🥇</span>`;
    if (idx === 1) rankBadge = `<span class="rank-pill silver">🥈</span>`;
    if (idx === 2) rankBadge = `<span class="rank-pill bronze">🥉</span>`;

    return `
      <tr onclick="onCandidateClick(${c.id})" style="cursor:pointer;">
        <td>${rankBadge}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.job_title || '')} ${c.company_name ? '@ ' + esc(c.company_name) : ''}</td>
        <td><strong>${c.overall_score}/10</strong></td>
        <td>${c.technical_score}/10</td>
        <td>${c.communication_score}/10</td>
        <td>${recMap[c.recommendation] || c.recommendation || '—'}</td>
        <td><button class="btn-secondary" style="padding:4px 10px; font-size:11px;" onclick="event.stopPropagation(); onCandidateClick(${c.id})">View Dossier &rarr;</button></td>
      </tr>`;
  }).join('');

  // SECTION 3: Render Recruiter Activity Task Queue (Ashby Light Theme)
  const incContainer = document.getElementById('incidentsGridContainer');
  if (incContainer) {
    if (incidentsList.length) {
      incContainer.innerHTML = incidentsList.map(c => {
        const health = c.call_health || {};
        const title  = `⚠️ CALL FOLLOW-UP · ${c.name}`;
        const root   = health.rootCause || 'Candidate disconnected during Beat 2 greeting.';
        const impact = health.impact || 'Technical stack & notice period unverified.';
        const sent   = health.sentiment || 'Neutral / Abrupt Disconnect';

        return `
          <div class="incident-card" id="inc-card-${c.id}">
            <div class="incident-card-header">
              <div class="incident-badge">
                <span class="pulse-red"></span> ${esc(title)}
              </div>
              <span class="incident-timestamp">${esc(c.job_title || 'Role')}</span>
            </div>

            <div class="incident-grid">
              <div class="incident-col">
                <div class="inc-label">🔍 ROOT CAUSE</div>
                <div class="inc-val">${esc(root)}</div>
              </div>
              <div class="incident-col">
                <div class="inc-label">⚡ IMPACT</div>
                <div class="inc-val">${esc(impact)}</div>
              </div>
              <div class="incident-col">
                <div class="inc-label">😊 SENTIMENT</div>
                <div class="inc-val sentiment-neutral">${esc(sent)}</div>
              </div>
            </div>

            <div class="incident-actions">
              <button class="btn-inc-action primary" onclick="retryAiCall(${c.id})">📞 Re-dial AI Call</button>
              <button class="btn-inc-action whatsapp" onclick="copyRecoveryWhatsAppCard(${c.id})">📲 WhatsApp</button>
              <button class="btn-inc-action resolve" onclick="resolveIncident(${c.id})">✓ Mark Resolved</button>
            </div>
          </div>`;
      }).join('');
    } else {
      incContainer.innerHTML = `
        <div class="topics-empty-placeholder" style="padding: 28px;">
          <div class="empty-sparkle">✓</div>
          <h3>All Tasks Resolved &amp; Cleared</h3>
          <p>No active call follow-ups needed. Calls that drop early (< 45s) will appear here for 1-click recruiter action.</p>
        </div>`;
    }
  }
};

window.shareSpotlightWhatsApp = function () {
  const top = topRankedCandidateCache;
  if (!top) return;

  const card = `*🥇 #1 TOP RANKED CANDIDATE REPORT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Candidate*: ${top.name}
*Role*: ${top.job_title || 'Role'} @ ${top.company_name || 'Weekday'}
*Maya Recommendation*: *${top.recommendation || 'Strong Yes'}*

📊 *SCORES*
• *Overall Rating*: ${top.overall_score}/10
• *Technical Fit*: ${top.technical_score}/10
• *Communication*: ${top.communication_score}/10

📝 *RECRUITER SUMMARY*
${top.summary || 'Top candidate evaluated by Maya AI.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Verified by WeekdayAI Leaderboard_`;

  navigator.clipboard.writeText(card)
    .then(() => showToast('📲 Top Candidate WhatsApp Card copied!', 'success'))
    .catch(() => showToast('Copy failed.', 'error'));
};

// ── Call Incident Resolution & Dismiss Handler ──────────────────────────────
window.resolveIncident = async function (candidateId) {
  const cardEl = document.getElementById(`inc-card-${candidateId}`);
  if (cardEl) {
    cardEl.classList.add('resolving');
  }

  try {
    const res = await fetch(`/api/candidates/${candidateId}/resolve-incident`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to resolve incident');

    // Update in-memory cache
    const cand = allCandidatesCache.find(c => String(c.id) === String(candidateId));
    if (cand) cand.incident_resolved = 1;

    setTimeout(() => {
      renderLeaderboardDashboard();
      showToast('✓ Task marked resolved and cleared from queue!', 'success');
    }, 300);
  } catch (err) {
    showToast(`Could not resolve: ${err.message}`, 'error');
    if (cardEl) cardEl.classList.remove('resolving');
  }
};

window.retryAiCall = function (candidateId) {
  closeModal();
  switchTab(3);
  const nameEl = document.getElementById('candidateName');
  if (nameEl && currentModalReportData?._name) {
    nameEl.value = currentModalReportData._name;
  }
  showToast('📞 Initiating AI Retry screening call with Maya...', 'success');
};

window.copyRecoveryWhatsAppCard = function (candidateId) {
  const name = currentModalReportData?._name || `Candidate #${candidateId}`;
  const meta = currentModalReportData?._meta || 'Role';
  const msg  = `*🚨 RECOVERY FOLLOW-UP: WEEKDAY RECRUITING TEAM*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Hi ${name}!*

It looks like our screening call disconnected after a few seconds while discussing your experience for *${meta}*.

Would you be free for a quick 2-minute follow-up call right now to complete your profile for the hiring team?

_Or let us know what time works best for you!_
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Sent via WeekdayAI Recruiter System_`;

  navigator.clipboard.writeText(msg)
    .then(() => showToast('📲 Recovery WhatsApp Message copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed.', 'error'));
};

window.flagForHumanReview = function (candidateId) {
  showToast(`📝 Candidate #${candidateId} flagged for human recruiter follow-up!`, 'success');
};

function injectSvgGradients() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `
    <defs>
      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#09090b"/>
        <stop offset="50%"  stop-color="#4f46e5"/>
        <stop offset="100%" stop-color="#0284c7"/>
      </linearGradient>
    </defs>`;
  document.body.prepend(svg);
}

let jdParseTimeout = null;
let lastAutoParsedJdText = '';
let skipSavedJobPopulate = false;

function setupJdAutoExtractor() {
  const jdTextEl = document.getElementById('jdText');
  if (!jdTextEl) return;

  const triggerExtraction = async () => {
    const text = jdTextEl.value.trim();
    if (!text || text.length < 100) return;
    if (text === lastAutoParsedJdText) return;
    
    lastAutoParsedJdText = text;
    const statusEl = document.getElementById('jdParseStatus');
    if (statusEl) {
      statusEl.className = 'jd-parse-status parsing';
      statusEl.innerHTML = '✨ AI is analyzing this Job Description to extract details...';
    }

    try {
      skipSavedJobPopulate = true;
      const res = await fetch('/api/jobs/parse-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdText: text })
      });
      if (!res.ok) throw new Error('Parsing failed');
      const data = await res.json();
      
      // Check extracted companyName
      const extCompName = (data.companyName || '').trim();
      const compInput = document.getElementById('companyNameInput');
      const compHidden = document.getElementById('companyIdHidden');
      
      if (extCompName) {
        if (compInput) compInput.value = extCompName;
        const matchedComp = allCompaniesCache.find(c => c.name.toLowerCase() === extCompName.toLowerCase());
        if (matchedComp) {
          currentCompanyId = matchedComp.id;
          if (compHidden) compHidden.value = matchedComp.id;
          await loadRolesForCompany(matchedComp.id);
        } else {
          currentCompanyId = null;
          if (compHidden) compHidden.value = '';
        }
      } else {
        // If not detected by AI, leave blank so user can type freely
        if (compInput) compInput.value = '';
        if (compHidden) compHidden.value = '';
        currentCompanyId = null;
      }

      // Role title free-text input
      const jobTitleInput = document.getElementById('jobTitle');
      if (jobTitleInput) {
        jobTitleInput.value = (data.title && data.title.trim()) ? data.title.trim() : '';
      }

      // Form parameter inputs
      document.getElementById('location').value      = data.location      || '';
      document.getElementById('maxNoticeDays').value = data.maxNoticeDays || '';
      document.getElementById('techStack').value     = data.techStack     || '';
      document.getElementById('targetCpa').value     = data.targetCpa     || '';
      if (data.tone) setTone(data.tone);
      if (data.voiceId) {
        const vSelect = document.getElementById('voiceId');
        if (vSelect) vSelect.value = data.voiceId;
      }

      // Auto-architect 7 screening category questions for the new JD
      if (typeof window.generateScriptWithAI === 'function') {
        window.generateScriptWithAI();
      }

      if (statusEl) {
        statusEl.className = 'jd-parse-status success';
        statusEl.innerHTML = '✓ Role parameters & 7 screening questions extracted!';
        setTimeout(() => {
          if (statusEl.className === 'jd-parse-status success') statusEl.innerHTML = '';
        }, 5000);
      }
      showToast('✨ AI auto-populated role parameters & 7 screening questions!', 'success');
    } catch (err) {
      console.warn('[JdAutoExtractor] failed:', err.message);
      if (statusEl) {
        statusEl.className = 'jd-parse-status error';
        statusEl.innerHTML = '⚠️ AI extraction failed. You can still fill details manually.';
        setTimeout(() => {
          if (statusEl.className === 'jd-parse-status error') statusEl.innerHTML = '';
        }, 5000);
      }
    } finally {
      setTimeout(() => { skipSavedJobPopulate = false; }, 500);
    }
  };

  jdTextEl.addEventListener('paste', () => {
    clearTimeout(jdParseTimeout);
    jdParseTimeout = setTimeout(triggerExtraction, 100);
  });

  jdTextEl.addEventListener('input', () => {
    clearTimeout(jdParseTimeout);
    jdParseTimeout = setTimeout(triggerExtraction, 1500);
  });

  jdTextEl.addEventListener('blur', () => {
    clearTimeout(jdParseTimeout);
    triggerExtraction();
  });
}

// ── Recruiter Persona Studio & Cloner ─────────────────────────────────────
let allPersonasCache = [];
let activeClonedPersona = null;
let currentExtractedDna = null;

window.loadPersonaLibrary = async function() {
  const select = document.getElementById('personaPresetSelect');
  if (!select) return;

  try {
    const res = await fetch('/api/personas', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.personas) return;

    allPersonasCache = data.personas;

    // Preserve current selection if valid
    const currentVal = select.value || 'default_maya';

    select.innerHTML = `
      <option value="default_maya">Default (Maya — Warm Consultative)</option>
      ${allPersonasCache.map(p => `<option value="${p.id}">${escapeQuotes(p.persona_name)}</option>`).join('')}
      <option value="__custom_new__">+ Clone New Recruiter Style...</option>
    `;

    if (allPersonasCache.some(p => String(p.id) === currentVal) || currentVal === 'default_maya') {
      select.value = currentVal;
    }
  } catch (err) {
    console.warn('loadPersonaLibrary error:', err);
  }
};

window.handlePersonaPresetChange = function(val) {
  if (val === '__custom_new__') {
    openClonePersonaModal();
    return;
  }

  const descEl = document.getElementById('activePersonaDnaDesc');
  const nameInput = document.getElementById('recruiterName');
  const voiceSelect = document.getElementById('voiceId');

  if (val === 'default_maya') {
    activeClonedPersona = null;
    if (nameInput) nameInput.value = 'Maya';
    if (voiceSelect) {
      voiceSelect.value = 'rachel';
      handleVoiceSelectChange('rachel');
    }
    if (descEl) descEl.textContent = 'Using standard warm consultative interview phrasing.';
    showToast('Applied default Maya recruiter persona.', 'info');
    return;
  }

  const persona = allPersonasCache.find(p => String(p.id) === String(val));
  if (persona) {
    activeClonedPersona = persona;
    if (nameInput) nameInput.value = persona.recruiter_name;
    if (voiceSelect && persona.voice_id) {
      voiceSelect.value = persona.voice_id;
      handleVoiceSelectChange(persona.voice_id);
    }
    const dna = persona.style_dna || {};
    const summary = dna.executiveSummary || 'Cloned custom recruiter personality.';
    if (descEl) descEl.textContent = `${persona.persona_name}: ${summary}`;
    showToast(`✓ Cloned persona "${persona.persona_name}" activated!`, 'success');
  }
};

let activeCloneInputMode = 'description';

window.handleCloneTextareaInput = function(val) {
  const counter = document.getElementById('cloneCharCounter');
  if (counter) {
    const len = (val || '').length;
    const min = activeCloneInputMode === 'description' ? 20 : 50;
    counter.textContent = `${len} / ${min} min chars`;
    counter.style.color = len >= min ? '#059669' : '#94a3b8';
    counter.style.fontWeight = len >= min ? '700' : '500';
  }
};

window.setCloneInputMode = function(mode) {
  activeCloneInputMode = mode;
  const btnDesc = document.getElementById('btnCloneModeDesc');
  const btnTrans = document.getElementById('btnCloneModeTrans');
  const hint = document.getElementById('cloneModeHint');
  const label = document.getElementById('cloneInputLabel');
  const sampleBtn = document.getElementById('btnLoadSampleTranscript');
  const pills = document.getElementById('cloneInspirationPills');
  const txt = document.getElementById('cloneTranscriptText');

  if (mode === 'description') {
    if (btnDesc) btnDesc.classList.add('active');
    if (btnTrans) btnTrans.classList.remove('active');
    if (hint) hint.textContent = 'Define conversational tone, probing rules, and pitching style in plain English.';
    if (label) label.textContent = 'Recruiter Style & Phrasing Prompt';
    if (sampleBtn) sampleBtn.style.display = 'none';
    if (pills) pills.style.display = 'block';
    if (txt && !txt.value) {
      txt.placeholder = "Describe how you want this recruiter to speak, probe, and pitch... e.g. 'High-energy founder mentality who speaks fast, probes deeply into production outages and system trade-offs, and pitches our high equity upside.'";
    }
  } else {
    if (btnTrans) btnTrans.classList.add('active');
    if (btnDesc) btnDesc.classList.remove('active');
    if (hint) hint.textContent = 'Extracts signature style & conversational pivots from actual past interview dialogue.';
    if (label) label.textContent = 'Paste Past Screening Transcripts or Excerpts';
    if (sampleBtn) sampleBtn.style.display = 'inline-block';
    if (pills) pills.style.display = 'none';
    if (txt && !txt.value) {
      txt.placeholder = "Paste actual interview dialogue or candidate screening notes here...\ne.g. 'Recruiter: Hey Aryan! Great to connect. I saw you built the streaming engine at Swiggy. Walk me through the hardest bug you ran into...'";
    }
  }
  handleCloneTextareaInput(txt?.value || '');
};

window.applyCloneInspiration = function(type) {
  const txt = document.getElementById('cloneTranscriptText');
  const nameInput = document.getElementById('cloneRecruiterNameInput');
  const voiceSelect = document.getElementById('cloneBaseVoiceSelect');

  document.querySelectorAll('.persona-preset-card').forEach(card => card.classList.remove('active'));
  const activeCard = document.getElementById(`presetCard_${type}`);
  if (activeCard) activeCard.classList.add('active');

  if (type === 'founder') {
    if (nameInput && (!nameInput.value || nameInput.value === 'Maya')) nameInput.value = 'Suhrad (Founder)';
    if (voiceSelect) voiceSelect.value = 'adam';
    if (txt) txt.value = 'High-energy founder mentality. Speaks fast, punchy, and confident. Uses phrases like "Love that momentum", "Help me understand the architectural trade-offs you made", "If the founders gave you full ownership tomorrow, how would you design this from scratch?". Probes deeply into production outages, scaling limits, and founder ambition. Pitches rapid growth, high equity upside, and zero red tape.';
  } else if (type === 'tech_griller') {
    if (nameInput && (!nameInput.value || nameInput.value === 'Maya')) nameInput.value = 'Alex (Tech Lead)';
    if (voiceSelect) voiceSelect.value = 'alloy';
    if (txt) txt.value = 'Razor-sharp principal engineer screening style. Direct, concise, zero small talk. Probes into distributed database concurrency, cache invalidation, edge-cases, and trade-offs. Uses phrases like "Walk me through the exact bottlenecks", "Why didn\'t you choose event-driven architecture?", "Quantify that performance gain for me".';
  } else if (type === 'consultative') {
    if (nameInput && (!nameInput.value || nameInput.value === 'Maya')) nameInput.value = 'Priya (Talent Partner)';
    if (voiceSelect) voiceSelect.value = 'neerja';
    if (txt) txt.value = 'Warm, empathetic talent partner. Creates deep psychological safety so candidates open up. Probes into team collaboration, leadership under pressure, and conflict resolution. Uses phrases like "That makes total sense, thank you for sharing that context", "Let\'s double-click on how you aligned stakeholders", "I really appreciate that transparency". Pitches culture, mentorship, and career acceleration.';
  } else if (type === 'fast_track') {
    if (nameInput && (!nameInput.value || nameInput.value === 'Maya')) nameInput.value = 'Neerja (Tech Recruiter)';
    if (voiceSelect) voiceSelect.value = 'neerja';
    if (txt) txt.value = 'Crisp, articulate Bangalore tech recruiter with authentic Indian English cadence. Extremely efficient. Quickly verifies core tech stack, hands-on production depth, CTC budget, and notice period buyout flexibility. Uses phrases like "Great to connect with you today", "Could you walk me through your hands-on contribution on that project?", "What is your current notice period and joining flexibility?".';
  }
  handleCloneTextareaInput(txt?.value || '');
  showToast('Preset applied. Feel free to customize the prompt.', 'info');
};

window.openClonePersonaModal = function() {
  const modal = document.getElementById('clonePersonaModal');
  if (modal) {
    modal.classList.remove('hidden');
    setCloneInputMode('description');
    // Pre-populate recruiter name if currently filled
    const currentName = document.getElementById('recruiterName')?.value?.trim();
    const cloneNameInput = document.getElementById('cloneRecruiterNameInput');
    if (cloneNameInput && currentName && currentName !== 'Maya') {
      cloneNameInput.value = currentName;
    }
  }
};

window.closeClonePersonaModal = function() {
  const modal = document.getElementById('clonePersonaModal');
  if (modal) modal.classList.add('hidden');
  const select = document.getElementById('personaPresetSelect');
  if (select && select.value === '__custom_new__') {
    select.value = activeClonedPersona ? activeClonedPersona.id : 'default_maya';
  }
};

window.loadSampleRecruiterTranscript = function() {
  const sample = `Recruiter (Suhrad): Hey Aryan, thanks for jumping on. I saw you built the core streaming engine over at Swiggy. Love that momentum. Walk me through the hardest production outage you debugged there.
Candidate: We had a massive socket leak during the IPL matches when 200k concurrent users connected. The memory spiked to 98% in 3 minutes.
Recruiter (Suhrad): What architectural trade-offs did you make to resolve that without dropping active orders?
Candidate: We rewrote the connection pool using a non-blocking netpoll reactor and dropped the heartbeat interval from 30s to 5s.
Recruiter (Suhrad): Fair enough, let's peel back that layer. If the founders handed you full ownership of our real-time voice infrastructure tomorrow, how would you design it from scratch?`;

  const txtEl = document.getElementById('cloneTranscriptText');
  const nameEl = document.getElementById('cloneRecruiterNameInput');
  if (txtEl) txtEl.value = sample;
  if (nameEl && !nameEl.value) nameEl.value = 'Suhrad';
  showToast('Sample recruiter transcript loaded.', 'info');
};

window.handleExtractPersonaDNA = async function() {
  const nameInput = document.getElementById('cloneRecruiterNameInput');
  const transcriptInput = document.getElementById('cloneTranscriptText');
  const voiceSelect = document.getElementById('cloneBaseVoiceSelect');
  const btn = document.getElementById('btnExtractPersonaDna');
  const saveBtn = document.getElementById('btnSaveClonedPersona');
  const resultCard = document.getElementById('clonedDnaResultCard');

  const recruiterName = nameInput?.value?.trim() || 'Recruiter';
  const textInput = transcriptInput?.value?.trim() || '';
  const roleTitle = document.getElementById('jobTitle')?.value?.trim() || 'Software Engineer';
  const inputType = activeCloneInputMode || 'description';

  const minChars = inputType === 'description' ? 20 : 50;
  if (!textInput || textInput.length < minChars) {
    showToast(`Please enter at least ${minChars} characters describing the recruiter style or interview dialogue.`, 'warning');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Extracting Persona Profile...';
  }

  try {
    const res = await fetch('/api/personas/clone', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        recruiterName,
        styleInput: textInput,
        roleTitle,
        inputType
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Extraction failed');

    currentExtractedDna = data.personaDNA;

    // Render result card
    if (resultCard) {
      resultCard.style.display = 'block';
      const nameEl = document.getElementById('dnaCardPersonaName');
      const summaryEl = document.getElementById('dnaCardSummary');
      const phrasesContainer = document.getElementById('dnaCardPhrasesChips');
      const probingEl = document.getElementById('dnaCardProbing');
      const pitchingEl = document.getElementById('dnaCardPitching');

      if (nameEl) nameEl.textContent = currentExtractedDna.personaName || `${recruiterName} Persona Profile`;
      if (summaryEl) summaryEl.textContent = currentExtractedDna.executiveSummary || 'Trained signature recruiter profile.';
      if (probingEl) probingEl.textContent = currentExtractedDna.probingTechnique || 'Direct technical deep-dive';
      if (pitchingEl) pitchingEl.textContent = currentExtractedDna.pitchingCharisma || 'Founder vision & fast growth';

      if (phrasesContainer && Array.isArray(currentExtractedDna.signaturePhrases)) {
        phrasesContainer.innerHTML = currentExtractedDna.signaturePhrases.map(p => `
          <span style="background:#ffffff; color:#0f172a; font-size:11px; font-weight:600; padding:4px 9px; border-radius:6px; border:1px solid #cbd5e1; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
            "${escapeQuotes(p)}"
          </span>
        `).join('');
      }
    }

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = '1';
    }

    showToast('Persona profile successfully extracted.', 'success');
  } catch (err) {
    showToast(`Extraction failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Extract Persona Profile`;
    }
  }
};

let currentPreviewAudio = null;
let currentPreviewingSelectId = null;

window.toggleVoicePreview = function(selectId) {
  const selectEl = document.getElementById(selectId);
  if (!selectEl) return;

  const voiceId = selectEl.value;
  const btnEl = document.getElementById(selectId === 'voiceId' ? 'btnPlayVoiceId' : 'btnPlayCloneBaseVoiceSelect');

  // If currently playing the same voice, stop it
  if (currentPreviewingSelectId === selectId && currentPreviewAudio && !currentPreviewAudio.paused) {
    currentPreviewAudio.pause();
    currentPreviewAudio.currentTime = 0;
    currentPreviewAudio = null;
    resetVoicePreviewBtn(selectId);
    currentPreviewingSelectId = null;
    return;
  }

  // Cancel any existing playback
  if (currentPreviewAudio) {
    currentPreviewAudio.pause();
    currentPreviewAudio.currentTime = 0;
    currentPreviewAudio = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (currentPreviewingSelectId) {
    resetVoicePreviewBtn(currentPreviewingSelectId);
  }

  currentPreviewingSelectId = selectId;

  if (btnEl) {
    btnEl.classList.add('playing');
    btnEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop`;
  }

  const defaultText = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play`;
  playVoiceSynthesis('', voiceId, btnEl, defaultText, '');
};

function resetVoicePreviewBtn(selectId) {
  const btnEl = document.getElementById(selectId === 'voiceId' ? 'btnPlayVoiceId' : 'btnPlayCloneBaseVoiceSelect');
  if (btnEl) {
    btnEl.classList.remove('playing');
    btnEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play`;
  }
}

// ── Studio-Grade Azure Neural Audio Stream Player (Zero-Lag MP3 Cloud Stream) ─────
function playVoiceSynthesis(text, voiceId, btnEl, defaultBtnText, recruiterName = '') {
  if (currentPreviewAudio) {
    currentPreviewAudio.pause();
    currentPreviewAudio.currentTime = 0;
    currentPreviewAudio = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  const cleanup = () => {
    if (btnEl) {
      btnEl.classList.remove('playing');
      if (defaultBtnText) btnEl.innerHTML = defaultBtnText;
    }
    if (currentPreviewingSelectId) {
      resetVoicePreviewBtn(currentPreviewingSelectId);
      currentPreviewingSelectId = null;
    }
    if (currentPreviewAudio) {
      currentPreviewAudio = null;
    }
  };

  try {
    // Stream real studio-quality Azure Neural MP3 audio directly from backend
    const url = `/api/voice/preview?voiceId=${encodeURIComponent(voiceId || 'neerja')}${text ? '&text=' + encodeURIComponent(text) : ''}`;
    const audio = new Audio(url);
    currentPreviewAudio = audio;

    audio.onended = cleanup;
    audio.onerror = (err) => {
      console.warn('[Audio Stream Error]:', err);
      cleanup();
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('Playback interrupted:', err);
        cleanup();
      });
    }
  } catch (err) {
    console.error('Audio initialization failed:', err);
    cleanup();
  }
}

window.previewClonedGreetingAudio = function() {
  if (!currentExtractedDna) return;
  const recruiterName = document.getElementById('cloneRecruiterNameInput')?.value?.trim() || 'Recruiter';
  const voiceId = document.getElementById('cloneBaseVoiceSelect')?.value || 'neerja';
  const text = currentExtractedDna.sampleGreeting || `Hey! ${recruiterName} here. Excited to dive into what you've been building and how you might shape this role!`;

  const btn = document.getElementById('btnPreviewClonedVoice');
  if (btn) {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Playing...`;
  }
  playVoiceSynthesis(text, voiceId, btn, `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play Audio Greeting`, recruiterName);
};

// ── Audio Greeting Preview Player (Main Screener Header) ─────────────────────
window.previewWelcomeMessage = function() {
  const recruiterName = document.getElementById('recruiterName')?.value?.trim() || 'Maya';
  const companyName   = document.getElementById('companyNameInput')?.value?.trim() || 'Weekday';
  const roleTitle     = document.getElementById('jobTitle')?.value?.trim() || 'Software Engineer';
  const voiceId       = document.getElementById('voiceId')?.value || 'neerja';

  const text = "Hi, I'm " + recruiterName + " from " + companyName + "! I'll be guiding your voice screening call today for the " + roleTitle + " position. Let's get started whenever you're ready!";
  const btn  = document.getElementById('btnPreviewGreeting');
  const voiceSelect  = document.getElementById('voiceId');
  const selectedText = voiceSelect?.options[voiceSelect.selectedIndex]?.text || voiceId;

  playVoiceSynthesis(text, voiceId, btn, 'Preview Welcome Message', recruiterName);
  showToast('Playing greeting preview for ' + recruiterName + ' (' + selectedText + ')...', 'info');
};

// ── JD File Upload & Parsing Handlers ─────────────────────────────────────
window.handleJdFileSelect = function(e) {
  const file = e.target.files[0];
  if (file) processJdFile(file);
};

window.handleJdFileDrop = function(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) processJdFile(file);
};

function processJdFile(file) {
  const statusEl = document.getElementById('jdParseStatus');
  if (statusEl) {
    statusEl.className = 'jd-parse-status loading';
    statusEl.innerHTML = `⏳ Reading document file "${file.name}"...`;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    const fileContent = evt.target.result || '';
    const jdTextarea = document.getElementById('jdText');
    if (jdTextarea) {
      jdTextarea.value = fileContent;
      // Trigger AI parsing automatically
      const pasteEvent = new Event('input', { bubbles: true });
      jdTextarea.dispatchEvent(pasteEvent);
    }
  };
  reader.onerror = function() {
    if (statusEl) {
      statusEl.className = 'jd-parse-status error';
      statusEl.innerHTML = '⚠️ Failed to read file. Please paste JD text directly.';
    }
  };
  reader.readAsText(file);
}

// ── Resume File Upload Handlers ──────────────────────────────────────────
window.handleResumeFileSelect = function(e) {
  const file = e.target.files[0];
  if (file) processResumeFile(file);
};

window.handleResumeFileDrop = function(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) processResumeFile(file);
};

function processResumeFile(file) {
  showToast(`⏳ Reading candidate resume "${file.name}"...`, 'info');

  const reader = new FileReader();
  reader.onload = function(evt) {
    const fileContent = evt.target.result || '';
    const bioTextarea = document.getElementById('candidateBio');
    if (bioTextarea) {
      bioTextarea.value = fileContent;
      showToast(`✓ Resume "${file.name}" loaded! Maya will use this for personalized opener.`, 'success');
    }
  };
  reader.onerror = function() {
    showToast('⚠️ Failed to read resume file. Please paste bio text directly.', 'error');
  };
  reader.readAsText(file);
}

// ── Admin Governance & AM Additions Queue ─────────────────────────────────
let allAdminNotifsCache = [];
let activeNotifFilter = 'pending'; // 'pending' | 'all'
let pendingAdminActionData = null; // { notifId, action }

window.setNotifFilter = function(filterMode) {
  activeNotifFilter = filterMode;
  const btnPending = document.getElementById('btnNotifFilterPending');
  const btnAll = document.getElementById('btnNotifFilterAll');

  if (filterMode === 'pending') {
    if (btnPending) {
      btnPending.style.background = '#ffffff';
      btnPending.style.color = '#09090b';
      btnPending.style.fontWeight = '700';
      btnPending.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
    }
    if (btnAll) {
      btnAll.style.background = 'transparent';
      btnAll.style.color = '#64748b';
      btnAll.style.fontWeight = '600';
      btnAll.style.boxShadow = 'none';
    }
  } else {
    if (btnAll) {
      btnAll.style.background = '#ffffff';
      btnAll.style.color = '#09090b';
      btnAll.style.fontWeight = '700';
      btnAll.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
    }
    if (btnPending) {
      btnPending.style.background = 'transparent';
      btnPending.style.color = '#64748b';
      btnPending.style.fontWeight = '600';
      btnPending.style.boxShadow = 'none';
    }
  }

  renderAdminNotificationsTable();
};

window.loadAdminNotifications = async function() {
  const tbody = document.getElementById('adminNotificationsTableBody');
  const countBadge = document.getElementById('adminNotifBadgeCount');
  const pendingPill = document.getElementById('notifPendingCountPill');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/notifications', { headers: getAuthHeaders() });
    const data = await res.json();
    allAdminNotifsCache = data.notifications || [];

    const unreviewedCount = allAdminNotifsCache.filter(n => n.review_status === 'unreviewed').length;
    if (countBadge) {
      if (unreviewedCount > 0) {
        countBadge.textContent = unreviewedCount;
        countBadge.style.display = 'inline-block';
      } else {
        countBadge.style.display = 'none';
      }
    }
    if (pendingPill) {
      pendingPill.textContent = unreviewedCount;
      pendingPill.style.display = unreviewedCount > 0 ? 'inline-block' : 'none';
    }

    renderAdminNotificationsTable();
  } catch (err) {
    console.error('Failed to load admin notifications:', err);
  }
};

function renderAdminNotificationsTable() {
  const tbody = document.getElementById('adminNotificationsTableBody');
  if (!tbody) return;

  const displayList = activeNotifFilter === 'pending'
    ? allAdminNotifsCache.filter(n => n.review_status === 'unreviewed')
    : allAdminNotifsCache;

  if (displayList.length === 0) {
    if (activeNotifFilter === 'pending') {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding:48px 16px; text-align:center; color:#64748b;">
            <div style="font-size:32px; margin-bottom:8px;">🎉</div>
            <div style="font-weight:700; font-size:15px; color:#09090b; margin-bottom:4px;">Inbox Zero — All Clear!</div>
            <div style="font-size:13px; color:#64748b;">No pending company additions require review.</div>
          </td>
        </tr>`;
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding:32px 16px; text-align:center; color:#64748b; font-size:13px;">
            No company addition history records found.
          </td>
        </tr>`;
    }
    return;
  }

  tbody.innerHTML = displayList.map(n => {
    const dateStr = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let statusBadge = '<span style="background:#fef3c7; color:#92400e; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11.5px; border:1px solid #fde68a;">Pending Review</span>';
    if (n.review_status === 'reviewed') {
      statusBadge = '<span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11.5px; border:1px solid #bbf7d0;">✓ Reviewed</span>';
    } else if (n.review_status === 'revoked') {
      statusBadge = '<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:6px; font-weight:700; font-size:11.5px; border:1px solid #fecaca;">🚫 Access Revoked</span>';
    }

    const actionButtons = n.review_status === 'unreviewed' ? `
      <div style="display:flex; align-items:center; gap:8px;">
        <button type="button" onclick="promptAdminNotificationAction(${n.id}, 'mark_reviewed')" 
          style="background:#ecfdf5; color:#065f46; border:1.5px solid #a7f3d0; border-radius:8px; font-weight:700; font-size:12px; padding:6px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:all 0.15s ease;" 
          onmouseover="this.style.background='#d1fae5'; this.style.borderColor='#6ee7b7';" 
          onmouseout="this.style.background='#ecfdf5'; this.style.borderColor='#a7f3d0';">
          ✓ Mark Reviewed
        </button>
        <button type="button" onclick="promptAdminNotificationAction(${n.id}, 'revoke_am')" 
          style="background:#fff1f2; color:#be123c; border:1.5px solid #fecdd3; border-radius:8px; font-weight:700; font-size:12px; padding:6px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:all 0.15s ease;" 
          onmouseover="this.style.background='#ffe4e6'; this.style.borderColor='#fda4af';" 
          onmouseout="this.style.background='#fff1f2'; this.style.borderColor='#fecdd3';">
          🚫 Remove from AM
        </button>
      </div>
    ` : `
      <span style="color:#64748b; font-size:12px; font-weight:600;">✓ Resolved</span>
    `;

    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:13px 16px; font-weight:700; color:#09090b;">🏢 ${escapeQuotes(n.company_name)}</td>
        <td style="padding:13px 16px; color:#334155; font-weight:600;">👤 ${escapeQuotes(n.am_name)}</td>
        <td style="padding:13px 16px; color:#475569;">🎯 ${escapeQuotes(n.role_title || 'Role')}</td>
        <td style="padding:13px 16px; color:#64748b; font-size:12px;">${dateStr}</td>
        <td style="padding:13px 16px;">${statusBadge}</td>
        <td style="padding:13px 16px;">${actionButtons}</td>
      </tr>
    `;
  }).join('');
}

window.promptAdminNotificationAction = function(notifId, action) {
  const notif = allAdminNotifsCache.find(n => n.id === notifId);
  if (!notif) return;

  pendingAdminActionData = { notifId, action, notif };

  const modal = document.getElementById('adminActionConfirmModal');
  const title = document.getElementById('confirmModalTitle');
  const subtitle = document.getElementById('confirmModalSubtitle');
  const icon = document.getElementById('confirmModalIcon');
  const header = document.getElementById('confirmModalHeader');
  const summaryBox = document.getElementById('confirmModalSummaryBox');
  const explanation = document.getElementById('confirmModalExplanation');
  const submitBtn = document.getElementById('confirmModalSubmitBtn');

  if (action === 'mark_reviewed') {
    if (title) title.innerText = 'Verify & Mark as Reviewed';
    if (subtitle) subtitle.innerText = 'Confirm company details and dismiss from pending queue';
    if (icon) icon.innerText = '✓';
    if (header) {
      header.style.background = '#f0fdf4';
      header.style.borderBottom = '1px solid #bbf7d0';
    }
    if (explanation) {
      explanation.innerHTML = 'Marking this entry as <strong>Reviewed</strong> verifies the company details and removes it from the pending review queue.';
    }
    if (submitBtn) {
      submitBtn.innerText = '✓ Confirm & Dismiss';
      submitBtn.style.background = '#059669';
      submitBtn.onmouseover = () => { submitBtn.style.background = '#047857'; };
      submitBtn.onmouseout = () => { submitBtn.style.background = '#059669'; };
    }
  } else {
    // Revoke action
    if (title) title.innerText = 'Revoke AM Company Access';
    if (subtitle) subtitle.innerText = 'Remove company from Account Manager\'s active portfolio';
    if (icon) icon.innerText = '🚫';
    if (header) {
      header.style.background = '#fef2f2';
      header.style.borderBottom = '1px solid #fecaca';
    }
    if (explanation) {
      explanation.innerHTML = 'This will <strong>remove the company</strong> from <strong>' + escapeQuotes(notif.am_name) + '\'s</strong> portfolio and dismiss it from the review list. Historical candidate transcripts will remain safe.';
    }
    if (submitBtn) {
      submitBtn.innerText = '🚫 Confirm & Remove Access';
      submitBtn.style.background = '#dc2626';
      submitBtn.onmouseover = () => { submitBtn.style.background = '#b91c1c'; };
      submitBtn.onmouseout = () => { submitBtn.style.background = '#dc2626'; };
    }
  }

  if (summaryBox) {
    summaryBox.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:12.5px;">
        <div><span style="color:#64748b;">Company:</span> <strong style="color:#09090b;">${escapeQuotes(notif.company_name)}</strong></div>
        <div><span style="color:#64748b;">Account Manager:</span> <strong style="color:#09090b;">${escapeQuotes(notif.am_name)}</strong></div>
        <div style="grid-column: 1 / -1;"><span style="color:#64748b;">Target Role:</span> <strong style="color:#09090b;">${escapeQuotes(notif.role_title || 'Software Engineer')}</strong></div>
      </div>
    `;
  }

  if (modal) modal.classList.remove('hidden');
};

window.closeAdminActionModal = function() {
  const modal = document.getElementById('adminActionConfirmModal');
  if (modal) modal.classList.add('hidden');
  pendingAdminActionData = null;
};

window.executePendingAdminAction = async function() {
  if (!pendingAdminActionData) return;
  const { notifId, action, notif } = pendingAdminActionData;
  const submitBtn = document.getElementById('confirmModalSubmitBtn');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = '⏳ Processing...';
  }

  try {
    const res = await fetch(`/api/admin/notifications/${notifId}/action`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action })
    });
    if (!res.ok) throw new Error('Action failed to execute');

    closeAdminActionModal();

    // Optimistically update cache so item vanishes immediately
    const targetIdx = allAdminNotifsCache.findIndex(n => n.id === notifId);
    if (targetIdx !== -1) {
      allAdminNotifsCache[targetIdx].review_status = (action === 'mark_reviewed') ? 'reviewed' : 'revoked';
    }

    if (action === 'mark_reviewed') {
      showToast(`✓ Marked "${notif?.company_name || 'Company'}" as reviewed and dismissed from queue!`, 'success');
    } else {
      showToast(`🚫 Revoked "${notif?.company_name || 'Company'}" from ${notif?.am_name || 'AM'} and dismissed!`, 'warning');
    }

    // Refresh data and counters
    await loadAdminNotifications();
  } catch (err) {
    showToast(`Action failed: ${err.message}`, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

