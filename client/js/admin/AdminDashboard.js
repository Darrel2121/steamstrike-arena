/**
 * Steamstrike — Standalone Admin Dashboard Controller
 * Powers metrics analytics, player moderation/bans, bug report triage, news CMS, and live game balance.
 */

class AdminDashboard {
  constructor() {
    this.adminKey = sessionStorage.getItem('steamstrike_admin_key') || '';
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    this.apiBase = isLocal ? '' : 'https://steamstrike-server.onrender.com';
    this.currentTab = 'stats';
    this.configPayload = null;
    this.playersData = [];
    this.bugsData = [];
    this.newsData = [];
    this.communityMapsData = [];
    this.activeBugFilter = 'all';
    this.activeMapFilter = 'all';

    this.bindDom();
    this.attachEvents();
    this.init();
  }

  bindDom() {
    this.dom = {
      authOverlay: document.getElementById('adminAuthOverlay'),
      mainDashboard: document.getElementById('adminMainDashboard'),
      loginForm: document.getElementById('adminLoginForm'),
      adminKeyInput: document.getElementById('adminKeyInput'),
      authError: document.getElementById('adminAuthError'),
      btnLogout: document.getElementById('btnAdminLogout'),
      serverPulse: document.getElementById('adminServerPulse'),
      tabBtns: document.querySelectorAll('.admin-tab-btn'),
      tabContents: document.querySelectorAll('.admin-tab-content'),

      // Stats Tab
      statActiveRooms: document.getElementById('statActiveRooms'),
      statActivePlayers: document.getElementById('statActivePlayers'),
      statActiveBots: document.getElementById('statActiveBots'),
      statTotalProfiles: document.getElementById('statTotalProfiles'),
      statTotalBans: document.getElementById('statTotalBans'),
      statCommunityMaps: document.getElementById('statCommunityMaps'),
      statUptime: document.getElementById('statUptime'),
      roomsTableBody: document.getElementById('adminRoomsTableBody'),
      leaderboardTableBody: document.getElementById('adminLeaderboardTableBody'),
      btnRefreshStats: document.getElementById('btnRefreshStats'),

      // Players Tab
      playerSearchInput: document.getElementById('playerSearchInput'),
      playersTableBody: document.getElementById('adminPlayersTableBody'),
      bansTableBody: document.getElementById('adminBansTableBody'),
      btnRefreshPlayers: document.getElementById('btnRefreshPlayers'),
      modalBanPlayer: document.getElementById('modalBanPlayer'),
      formBanPlayer: document.getElementById('formBanPlayer'),
      banTargetDisplay: document.getElementById('banTargetDisplay'),
      banTargetType: document.getElementById('banTargetType'),
      banTargetValue: document.getElementById('banTargetValue'),
      banReasonInput: document.getElementById('banReasonInput'),
      banDurationSelect: document.getElementById('banDurationSelect'),

      // Bugs Tab
      bugsListContainer: document.getElementById('bugsListContainer'),
      btnRefreshBugs: document.getElementById('btnRefreshBugs'),
      bugFilterBtns: document.querySelectorAll('.btn-filter-bug'),
      badgeNewBugsCount: document.getElementById('badgeNewBugsCount'),

      // Maps Tab
      badgePendingMapsCount: document.getElementById('badgePendingMapsCount'),
      headerPendingMapsPill: document.getElementById('headerPendingMapsPill'),
      mapFilterBtns: document.querySelectorAll('.btn-filter-map'),
      btnRefreshAdminMaps: document.getElementById('btnRefreshAdminMaps'),
      adminMapsListContainer: document.getElementById('adminMapsListContainer'),

      // News Tab
      newsFormHeader: document.getElementById('newsFormHeader'),
      newsEditId: document.getElementById('newsEditId'),
      newsTitleInput: document.getElementById('newsTitleInput'),
      newsCategorySelect: document.getElementById('newsCategorySelect'),
      newsAuthorInput: document.getElementById('newsAuthorInput'),
      newsSummaryInput: document.getElementById('newsSummaryInput'),
      newsContentInput: document.getElementById('newsContentInput'),
      newsPinnedCheckbox: document.getElementById('newsPinnedCheckbox'),
      adminNewsForm: document.getElementById('adminNewsForm'),
      btnResetNewsForm: document.getElementById('btnResetNewsForm'),
      adminNewsListContainer: document.getElementById('adminNewsListContainer'),
      btnRefreshNews: document.getElementById('btnRefreshNews'),

      // Balance Tab
      configCategoriesContainer: document.getElementById('adminConfigCategoriesContainer'),
      btnSaveAllConfig: document.getElementById('btnSaveAllConfig'),
      btnResetConfigDefaults: document.getElementById('btnResetConfigDefaults'),

      // Toast
      toast: document.getElementById('adminToast')
    };
  }

  attachEvents() {
    // Auth Form Submit
    this.dom.loginForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = this.dom.adminKeyInput.value.trim();
      this.login(key);
    });

    // Logout
    this.dom.btnLogout?.addEventListener('click', () => this.logout());

    // Tab Navigation
    this.dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Refresh Buttons
    this.dom.btnRefreshStats?.addEventListener('click', () => this.loadStats());
    this.dom.btnRefreshPlayers?.addEventListener('click', () => this.loadPlayers());
    this.dom.btnRefreshBugs?.addEventListener('click', () => this.loadBugs());
    this.dom.btnRefreshNews?.addEventListener('click', () => this.loadNews());

    // Search Players
    this.dom.playerSearchInput?.addEventListener('input', () => this.renderPlayersTable());

    // Ban Form Submit
    this.dom.formBanPlayer?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitBanPlayer();
    });

    // Close Modal buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.dom.modalBanPlayer) this.dom.modalBanPlayer.style.display = 'none';
      });
    });

    // Bug filters
    this.dom.bugFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.bugFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeBugFilter = btn.dataset.filter;
        this.renderBugsList();
      });
    });

    // Map filters
    this.dom.mapFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.mapFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeMapFilter = btn.dataset.filter;
        this.renderMapsList();
      });
    });

    this.dom.btnRefreshAdminMaps?.addEventListener('click', () => this.loadMaps());

    // News Form Submit
    this.dom.adminNewsForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitNewsForm();
    });

    this.dom.btnResetNewsForm?.addEventListener('click', () => {
      this.resetNewsForm();
    });

    // Balance Save & Reset
    this.dom.btnSaveAllConfig?.addEventListener('click', () => this.saveConfig());
    this.dom.btnResetConfigDefaults?.addEventListener('click', () => this.resetConfigDefaults());

    // Presets
    document.querySelectorAll('.btn-preset-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.preset;
        this.applyPreset(presetId);
      });
    });
  }

  init() {
    if (this.adminKey) {
      this.login(this.adminKey, true);
    }
  }

  async login(key, isAuto = false) {
    if (!key) return;

    try {
      const res = await fetch(`${this.apiBase}/api/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: key })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (this.dom.authError) {
          this.dom.authError.textContent = data.error || 'Невірний пароль або заблоковано за rate-limit';
          this.dom.authError.style.display = 'block';
        }
        if (isAuto) {
          sessionStorage.removeItem('steamstrike_admin_key');
        }
        return;
      }

      // Success
      this.adminKey = key;
      sessionStorage.setItem('steamstrike_admin_key', key);

      if (this.dom.authOverlay) this.dom.authOverlay.style.display = 'none';
      if (this.dom.mainDashboard) this.dom.mainDashboard.style.display = 'block';
      if (this.dom.btnLogout) this.dom.btnLogout.style.display = 'inline-block';

      this.showToast('✓ Авторизація успішна! Ласкаво просимо до командного вузла.');
      this.configPayload = data;
      this.loadTabContent(this.currentTab);
    } catch (err) {
      console.error('[AdminDashboard] Login error:', err);
      if (this.dom.authError) {
        this.dom.authError.textContent = 'Помилка з\'єднання з сервером: ' + err.message;
        this.dom.authError.style.display = 'block';
      }
    }
  }

  logout() {
    sessionStorage.removeItem('steamstrike_admin_key');
    this.adminKey = '';
    window.location.reload();
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    this.dom.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    this.dom.tabContents.forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));
    this.loadTabContent(tabName);
  }

  loadTabContent(tabName) {
    if (tabName === 'stats') this.loadStats();
    else if (tabName === 'players') this.loadPlayers();
    else if (tabName === 'bugs') this.loadBugs();
    else if (tabName === 'news') this.loadNews();
    else if (tabName === 'maps') this.loadMaps();
    else if (tabName === 'balance') this.loadBalanceConfig();
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-admin-key': this.adminKey
    };
  }

  showToast(message, type = 'info') {
    if (!this.dom.toast) return;
    this.dom.toast.textContent = message;
    this.dom.toast.style.display = 'block';
    this.dom.toast.style.background = type === 'error' ? '#c0392b' : type === 'success' ? '#27ae60' : '#2980b9';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.dom.toast.style.display = 'none';
    }, 3500);
  }

  // =========================================================================
  // 1. STATS TAB
  // =========================================================================
  async loadStats() {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/stats`, { headers: this.getHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const s = data.stats;
      if (this.dom.statActiveRooms) this.dom.statActiveRooms.textContent = s.activeRooms;
      if (this.dom.statActivePlayers) this.dom.statActivePlayers.textContent = s.activePlayers;
      if (this.dom.statActiveBots) this.dom.statActiveBots.textContent = s.activeBots;
      if (this.dom.statTotalProfiles) this.dom.statTotalProfiles.textContent = s.totalRegisteredProfiles;
      if (this.dom.statTotalBans) this.dom.statTotalBans.textContent = s.totalBans;
      if (s.communityMaps && this.dom.statCommunityMaps) {
        this.dom.statCommunityMaps.textContent = s.communityMaps.total;
      }

      if (s.communityMaps) {
        if (this.dom.badgePendingMapsCount) {
          if (s.communityMaps.pending > 0) {
            this.dom.badgePendingMapsCount.textContent = s.communityMaps.pending;
            this.dom.badgePendingMapsCount.style.display = 'inline-block';
          } else {
            this.dom.badgePendingMapsCount.style.display = 'none';
          }
        }
        if (this.dom.headerPendingMapsPill) {
          if (s.communityMaps.pending > 0) {
            this.dom.headerPendingMapsPill.textContent = `${s.communityMaps.pending} на розгляді`;
            this.dom.headerPendingMapsPill.style.display = 'inline-block';
          } else {
            this.dom.headerPendingMapsPill.style.display = 'none';
          }
        }
      }

      const hrs = Math.floor(s.uptimeSeconds / 3600);
      const mins = Math.floor((s.uptimeSeconds % 3600) / 60);
      const secs = s.uptimeSeconds % 60;
      if (this.dom.statUptime) this.dom.statUptime.textContent = `${hrs}г ${mins}хв ${secs}с`;

      // Render Rooms Table
      if (this.dom.roomsTableBody) {
        if (!s.rooms || s.rooms.length === 0) {
          this.dom.roomsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #8e9aa8; padding: 20px;">Немає активних кімнат</td></tr>`;
        } else {
          this.dom.roomsTableBody.innerHTML = s.rooms.map(r => `
            <tr>
              <td><strong style="color: #ffcf48;">${r.id}</strong> ${r.locked ? '🔒' : ''}</td>
              <td>${r.map}</td>
              <td><span class="tab-pill" style="background: #34495e;">${r.mode}</span></td>
              <td>👤 ${r.humans} | 🤖 ${r.bots}</td>
              <td><span style="color: ${r.state === 'IN_PROGRESS' ? '#2ec4b6' : '#ffcf48'}; font-weight: bold;">${r.state}</span></td>
            </tr>
          `).join('');
        }
      }

      // Render Leaderboard
      if (this.dom.leaderboardTableBody) {
        if (!s.leaderboard || s.leaderboard.length === 0) {
          this.dom.leaderboardTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #8e9aa8; padding: 20px;">Немає даних</td></tr>`;
        } else {
          this.dom.leaderboardTableBody.innerHTML = s.leaderboard.map((p, idx) => `
            <tr>
              <td><strong style="color: #ffcf48;">#${idx + 1}</strong></td>
              <td><strong>${p.username}</strong></td>
              <td>Рівень ${p.level}</td>
              <td><span style="color: #2ec4b6;">${p.xp.toLocaleString()} XP</span></td>
              <td>🏆 ${p.wins} / ${p.matches}</td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      console.error('[AdminDashboard] Failed to load stats:', err);
      this.showToast('Помилка завантаження статистики: ' + err.message, 'error');
    }
  }

  // =========================================================================
  // 2. PLAYERS & MODERATION TAB
  // =========================================================================
  async loadPlayers() {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/players`, { headers: this.getHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.playersData = data.players || [];
      this.bansData = data.bans || [];
      this.renderPlayersTable();
      this.renderBansTable();
    } catch (err) {
      console.error('[AdminDashboard] Failed to load players:', err);
      this.showToast('Помилка завантаження списку гравців: ' + err.message, 'error');
    }
  }

  renderPlayersTable() {
    if (!this.dom.playersTableBody) return;
    const query = (this.dom.playerSearchInput?.value || '').trim().toLowerCase();

    const filtered = this.playersData.filter(p => {
      if (!query) return true;
      return (p.username && p.username.toLowerCase().includes(query)) || (p.id && p.id.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
      this.dom.playersTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #8e9aa8; padding: 20px;">Гравців не знайдено</td></tr>`;
      return;
    }

    this.dom.playersTableBody.innerHTML = filtered.map(p => `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 11px; color: #8e9aa8;">${p.id}</td>
        <td><strong>${p.username}</strong> ${p.isGuest ? '<span style="font-size: 10px; color: #8e9aa8;">(Гість)</span>' : ''}</td>
        <td>Lvl ${p.level} <span style="font-size: 11px; color: #8e9aa8;">(${p.xp} XP)</span></td>
        <td><span style="color: #ffcf48;">${p.equippedClass}</span></td>
        <td>${p.equippedWeapon}</td>
        <td>⚔️ ${p.career.matchesPlayed || 0} / 🏆 ${p.career.wins || 0}</td>
        <td>
          ${p.isBanned 
            ? '<span class="tab-pill" style="background: #c0392b;">⛔ Заблокований</span>' 
            : p.isLiveOnline
              ? `<span class="tab-pill" style="background: #2ec4b6;">🟢 В кімнаті ${p.currentRoom || ''}</span>`
              : '<span class="tab-pill" style="background: #27ae60;">✓ Офлайн / Збережено</span>'
          }
        </td>
        <td>
          <div style="display: flex; gap: 4px;">
            ${p.isBanned
              ? `<button class="btn-steampunk btn-iron btn-action-unban" data-id="${p.id}" style="font-size: 10px; padding: 3px 6px;">🔓 Розбан</button>`
              : `<button class="btn-steampunk btn-copper btn-action-ban" data-id="${p.id}" data-name="${p.username}" style="font-size: 10px; padding: 3px 6px; background: #c0392b;">🔨 Бан</button>`
            }
            <button class="btn-steampunk btn-iron btn-action-kick" data-id="${p.id}" style="font-size: 10px; padding: 3px 6px;">🚪 Кік</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Attach row button events
    this.dom.playersTableBody.querySelectorAll('.btn-action-ban').forEach(b => {
      b.addEventListener('click', () => {
        this.openBanModal('profileId', b.dataset.id, b.dataset.name);
      });
    });

    this.dom.playersTableBody.querySelectorAll('.btn-action-unban').forEach(b => {
      b.addEventListener('click', () => {
        this.unbanPlayer(b.dataset.id);
      });
    });

    this.dom.playersTableBody.querySelectorAll('.btn-action-kick').forEach(b => {
      b.addEventListener('click', () => {
        this.kickPlayer(b.dataset.id);
      });
    });
  }

  renderBansTable() {
    if (!this.dom.bansTableBody) return;
    if (!this.bansData || this.bansData.length === 0) {
      this.dom.bansTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #8e9aa8; padding: 14px;">Активних блокувань немає</td></tr>`;
      return;
    }

    this.dom.bansTableBody.innerHTML = this.bansData.map(b => `
      <tr>
        <td><span class="tab-pill" style="background: #34495e;">${b.targetType}</span></td>
        <td><strong style="color: #ff6b6b;">${b.targetValue}</strong></td>
        <td>${b.reason}</td>
        <td>${new Date(b.timestamp).toLocaleString()}</td>
        <td>
          <button class="btn-steampunk btn-iron btn-ban-remove" data-id="${b.id}" style="font-size: 10px; padding: 3px 8px;">🔓 Скасувати</button>
        </td>
      </tr>
    `).join('');

    this.dom.bansTableBody.querySelectorAll('.btn-ban-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.unbanPlayer(btn.dataset.id);
      });
    });
  }

  openBanModal(type, value, name) {
    if (!this.dom.modalBanPlayer) return;
    this.dom.banTargetType.value = type;
    this.dom.banTargetValue.value = value;
    this.dom.banTargetDisplay.textContent = `${name || value} (${type})`;
    this.dom.modalBanPlayer.style.display = 'flex';
  }

  async submitBanPlayer() {
    const targetType = this.dom.banTargetType.value;
    const targetValue = this.dom.banTargetValue.value;
    const reason = this.dom.banReasonInput.value.trim();
    const duration = parseInt(this.dom.banDurationSelect.value, 10);
    const expiresAt = duration > 0 ? Date.now() + duration : null;

    try {
      const res = await fetch(`${this.apiBase}/api/admin/players/ban`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ targetType, targetValue, reason, expiresAt })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast(`✓ ${data.message}`, 'success');
      if (this.dom.modalBanPlayer) this.dom.modalBanPlayer.style.display = 'none';
      this.loadPlayers();
    } catch (err) {
      this.showToast('Помилка блокування: ' + err.message, 'error');
    }
  }

  async unbanPlayer(target) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/players/unban`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ id: target })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ Блокування скасовано', 'success');
      this.loadPlayers();
    } catch (err) {
      this.showToast('Помилка скасування бану: ' + err.message, 'error');
    }
  }

  async kickPlayer(playerId) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/players/kick`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ playerId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast(`✓ ${data.message}`, 'success');
    } catch (err) {
      this.showToast('Помилка виключення гравця: ' + err.message, 'error');
    }
  }

  // =========================================================================
  // 3. BUG REPORTS TAB
  // =========================================================================
  async loadBugs() {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/bugs`, { headers: this.getHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.bugsData = data.reports || [];
      const newCount = this.bugsData.filter(b => b.status === 'new').length;
      if (this.dom.badgeNewBugsCount) {
        this.dom.badgeNewBugsCount.textContent = newCount;
        this.dom.badgeNewBugsCount.style.display = newCount > 0 ? 'inline-block' : 'none';
      }

      this.renderBugsList();
    } catch (err) {
      console.error('[AdminDashboard] Failed to load bugs:', err);
      this.showToast('Помилка завантаження багрепортів: ' + err.message, 'error');
    }
  }

  renderBugsList() {
    if (!this.dom.bugsListContainer) return;

    const filtered = this.bugsData.filter(b => {
      if (this.activeBugFilter === 'all') return true;
      return b.status === this.activeBugFilter;
    });

    if (filtered.length === 0) {
      this.dom.bugsListContainer.innerHTML = `<div style="text-align: center; color: #8e9aa8; padding: 40px;">Звітів у цій категорії немає</div>`;
      return;
    }

    this.dom.bugsListContainer.innerHTML = filtered.map(b => {
      const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleString() : 'Невідома дата';
      const client = b.clientInfo || {};
      return `
        <div class="bug-card status-${b.status || 'new'}">
          <div class="bug-header">
            <div>
              <span class="tab-pill" style="background: #34495e; margin-right: 6px;">${b.category}</span>
              <strong style="color: #ffcf48;">${b.contact || 'Анонімний інженер'}</strong>
              <span class="bug-meta">(${dateStr})</span>
            </div>

            <div style="display: flex; gap: 8px; align-items: center;">
              <select class="steampunk-select bug-status-select" data-id="${b.id}" style="font-size: 11px; padding: 3px 6px;">
                <option value="new" ${b.status === 'new' ? 'selected' : ''}>🔴 Новий</option>
                <option value="in_progress" ${b.status === 'in_progress' ? 'selected' : ''}>🟡 В роботі</option>
                <option value="resolved" ${b.status === 'resolved' ? 'selected' : ''}>🟢 Вирішено</option>
                <option value="rejected" ${b.status === 'rejected' ? 'selected' : ''}>⚪ Відхилено</option>
              </select>
              <button class="btn-steampunk btn-iron btn-delete-bug" data-id="${b.id}" title="Видалити звіт" style="padding: 2px 8px; color: #ff6b6b;">🗑</button>
            </div>
          </div>

          <div class="bug-desc">${b.description}</div>

          <div class="bug-client-info">
            IP: ${client.ip || 'н/д'} | Браузер: ${client.userAgent ? client.userAgent.slice(0, 70) + '...' : 'н/д'}
          </div>
        </div>
      `;
    }).join('');

    // Attach bug events
    this.dom.bugsListContainer.querySelectorAll('.bug-status-select').forEach(select => {
      select.addEventListener('change', () => {
        this.updateBugStatus(select.dataset.id, select.value);
      });
    });

    this.dom.bugsListContainer.querySelectorAll('.btn-delete-bug').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Видалити цей звіт?')) {
          this.deleteBug(btn.dataset.id);
        }
      });
    });
  }

  async updateBugStatus(id, status) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/bugs/status`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ id, status })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ Статус звіту оновлено', 'success');
      this.loadBugs();
    } catch (err) {
      this.showToast('Помилка оновлення статусу: ' + err.message, 'error');
    }
  }

  async deleteBug(id) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/bugs/delete`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ Звіт видалено', 'success');
      this.loadBugs();
    } catch (err) {
      this.showToast('Помилка видалення: ' + err.message, 'error');
    }
  }

  // =========================================================================
  // 4. NEWS CMS TAB
  // =========================================================================
  async loadNews() {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/news`, { headers: this.getHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.newsData = data.news || [];
      this.renderNewsList();
    } catch (err) {
      console.error('[AdminDashboard] Failed to load news:', err);
      this.showToast('Помилка завантаження новин: ' + err.message, 'error');
    }
  }

  renderNewsList() {
    if (!this.dom.adminNewsListContainer) return;
    if (this.newsData.length === 0) {
      this.dom.adminNewsListContainer.innerHTML = `<div style="text-align: center; color: #8e9aa8; padding: 30px;">Новин ще немає. Створіть першу публікацію ліворуч!</div>`;
      return;
    }

    this.dom.adminNewsListContainer.innerHTML = this.newsData.map(n => `
      <div class="news-item-card">
        <div class="news-item-header">
          <div>
            <span class="tab-pill" style="background: ${n.tagColor || '#2ec4b6'}; margin-right: 6px;">${n.category}</span>
            <strong style="color: #ffcf48; font-size: 14px;">${n.title}</strong>
            ${n.pinned ? '📌' : ''}
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn-steampunk btn-iron btn-edit-news" data-id="${n.id}" style="font-size: 10px; padding: 3px 8px;">✏️ Редагувати</button>
            <button class="btn-steampunk btn-copper btn-delete-news" data-id="${n.id}" style="font-size: 10px; padding: 3px 8px; color: #ff6b6b;">🗑</button>
          </div>
        </div>

        <p style="font-size: 12px; color: #c9d1d9; margin: 4px 0; line-height: 1.4;">${n.summary}</p>

        <div style="font-size: 10px; color: #8e9aa8; display: flex; justify-content: space-between;">
          <span>Автор: ${n.author}</span>
          <span>${n.date}</span>
        </div>
      </div>
    `).join('');

    this.dom.adminNewsListContainer.querySelectorAll('.btn-edit-news').forEach(btn => {
      btn.addEventListener('click', () => {
        this.populateNewsEdit(btn.dataset.id);
      });
    });

    this.dom.adminNewsListContainer.querySelectorAll('.btn-delete-news').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Видалити цю новину?')) {
          this.deleteNews(btn.dataset.id);
        }
      });
    });
  }

  populateNewsEdit(id) {
    const article = this.newsData.find(n => n.id === id);
    if (!article) return;

    this.dom.newsEditId.value = article.id;
    this.dom.newsTitleInput.value = article.title;
    this.dom.newsCategorySelect.value = article.category;
    this.dom.newsAuthorInput.value = article.author;
    this.dom.newsSummaryInput.value = article.summary;
    this.dom.newsContentInput.value = article.content;
    this.dom.newsPinnedCheckbox.checked = Boolean(article.pinned);

    if (this.dom.newsFormHeader) this.dom.newsFormHeader.innerHTML = '<span>✏️</span> Редагувати новину';
    if (this.dom.btnResetNewsForm) this.dom.btnResetNewsForm.style.display = 'inline-block';
  }

  resetNewsForm() {
    this.dom.newsEditId.value = '';
    this.dom.adminNewsForm.reset();
    if (this.dom.newsFormHeader) this.dom.newsFormHeader.innerHTML = '<span>✏️</span> Створити новину / патч';
    if (this.dom.btnResetNewsForm) this.dom.btnResetNewsForm.style.display = 'none';
  }

  async submitNewsForm() {
    const id = this.dom.newsEditId.value;
    const payload = {
      title: this.dom.newsTitleInput.value.trim(),
      category: this.dom.newsCategorySelect.value,
      author: this.dom.newsAuthorInput.value.trim(),
      summary: this.dom.newsSummaryInput.value.trim(),
      content: this.dom.newsContentInput.value.trim(),
      pinned: this.dom.newsPinnedCheckbox.checked
    };

    try {
      const url = id ? `${this.apiBase}/api/admin/news/update` : `${this.apiBase}/api/admin/news`;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(id ? { id, ...payload } : payload)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast(`✓ ${data.message}`, 'success');
      this.resetNewsForm();
      this.loadNews();
    } catch (err) {
      this.showToast('Помилка збереження новини: ' + err.message, 'error');
    }
  }

  async deleteNews(id) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/news/delete`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ Новину видалено', 'success');
      this.loadNews();
    } catch (err) {
      this.showToast('Помилка видалення: ' + err.message, 'error');
    }
  }

  // =========================================================================
  // 5. COMMUNITY MAPS TAB
  // =========================================================================
  async loadMaps() {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/community-maps`, { headers: this.getHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.communityMapsData = data.maps || [];
      this.renderMapsList();

      // Also update badges
      const pendingCount = this.communityMapsData.filter(m => m.status === 'pending').length;
      if (this.dom.badgePendingMapsCount) {
        if (pendingCount > 0) {
          this.dom.badgePendingMapsCount.textContent = pendingCount;
          this.dom.badgePendingMapsCount.style.display = 'inline-block';
        } else {
          this.dom.badgePendingMapsCount.style.display = 'none';
        }
      }
      if (this.dom.headerPendingMapsPill) {
        if (pendingCount > 0) {
          this.dom.headerPendingMapsPill.textContent = `${pendingCount} на розгляді`;
          this.dom.headerPendingMapsPill.style.display = 'inline-block';
        } else {
          this.dom.headerPendingMapsPill.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('[AdminDashboard] Failed to load community maps:', err);
      this.showToast('Помилка завантаження карт: ' + err.message, 'error');
    }
  }

  renderMapsList() {
    if (!this.dom.adminMapsListContainer) return;

    const filtered = this.communityMapsData.filter(m => {
      if (this.activeMapFilter === 'all') return true;
      return m.status === this.activeMapFilter;
    });

    if (filtered.length === 0) {
      this.dom.adminMapsListContainer.innerHTML = `<div style="text-align: center; color: #8e9aa8; padding: 40px;">Карт у цій категорії немає</div>`;
      return;
    }

    this.dom.adminMapsListContainer.innerHTML = filtered.map(m => {
      const dateStr = m.submittedAt ? new Date(m.submittedAt).toLocaleString() : 'Невідома дата';
      const mapGeo = m.map || {};
      const width = mapGeo.width || 20;
      const height = mapGeo.height || 20;
      const tiles = Array.isArray(mapGeo.tiles) ? mapGeo.tiles : [];
      const spawns = Array.isArray(mapGeo.spawns) ? mapGeo.spawns : [];
      const decorations = Array.isArray(mapGeo.decorations) ? mapGeo.decorations : [];

      let walls = 0;
      let obstacles = 0;
      for (let i = 0; i < tiles.length; i++) {
        if (tiles[i] === 1) walls++;
        else if (tiles[i] === 2) obstacles++;
      }
      const playerSpawns = spawns.filter(s => s.type === 'player' || s.type === 0).length;
      const botSpawns = spawns.filter(s => s.type === 'bot' || s.type === 1).length;

      let statusBadge = `<span class="tab-pill" style="background: #e67e22; color: #fff;">⏳ На розгляді</span>`;
      if (m.status === 'approved') {
        statusBadge = `<span class="tab-pill" style="background: #27ae60; color: #fff;">✅ Схвалено для гри</span>`;
      } else if (m.status === 'rejected') {
        statusBadge = `<span class="tab-pill" style="background: #c0392b; color: #fff;">❌ Відхилено</span>`;
      }

      return `
        <div class="bug-card status-${m.status || 'pending'}" style="margin-bottom: 14px;">
          <div class="bug-header" style="flex-wrap: wrap; gap: 8px;">
            <div>
              ${statusBadge}
              <strong style="color: #ffcf48; font-size: 15px; margin-left: 6px;">${m.name}</strong>
              <span class="bug-meta" style="margin-left: 8px;">Автор: <strong>${m.author}</strong> &bull; (${dateStr})</span>
            </div>

            <div style="display: flex; gap: 6px; align-items: center; margin-left: auto;">
              ${m.status !== 'approved' ? `
                <button class="btn-steampunk btn-launch btn-approve-map" data-id="${m.id}" title="Схвалити карту для публічного вибору в лобі" style="font-size: 11px; padding: 4px 10px; font-weight: bold;">
                  ✅ Схвалити
                </button>
              ` : ''}

              ${m.status !== 'rejected' ? `
                <button class="btn-steampunk btn-copper btn-reject-map" data-id="${m.id}" title="Відхилити карту" style="font-size: 11px; padding: 4px 10px; background: #c0392b;">
                  ❌ Відхилити
                </button>
              ` : ''}

              ${m.status !== 'pending' ? `
                <button class="btn-steampunk btn-iron btn-pending-map" data-id="${m.id}" title="Повернути на розгляд" style="font-size: 11px; padding: 4px 8px;">
                  ⏳ На розгляд
                </button>
              ` : ''}

              <button class="btn-steampunk btn-iron btn-delete-map" data-id="${m.id}" title="Видалити карту назавжди" style="padding: 4px 8px; color: #ff6b6b;">🗑</button>
            </div>
          </div>

          <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: #ffcf48; background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 4px; border: 1px solid rgba(197,155,39,0.2); flex-wrap: wrap;">
            <span>📐 Розмір: <strong>${width}x${height}</strong></span>
            <span>🧱 Стіни: <strong>${walls}</strong></span>
            <span>🛡️ Укриття: <strong>${obstacles}</strong></span>
            <span>👤 Спавни гравців: <strong>${playerSpawns}</strong></span>
            <span>🤖 Спавни ботів: <strong>${botSpawns}</strong></span>
            <span>⚙️ Декор: <strong>${decorations.length}</strong></span>
          </div>

          ${m.description ? `<div class="bug-desc" style="margin-top: 8px; font-style: italic;">"${m.description}"</div>` : ''}
          ${m.reviewNote ? `<div style="margin-top: 6px; font-size: 12px; color: #ff9f43;">📝 Примітка модератора: ${m.reviewNote}</div>` : ''}
        </div>
      `;
    }).join('');

    // Attach map action listeners
    this.dom.adminMapsListContainer.querySelectorAll('.btn-approve-map').forEach(btn => {
      btn.addEventListener('click', () => {
        this.updateMapStatus(btn.dataset.id, 'approved', 'Схвалено адміністратором');
      });
    });

    this.dom.adminMapsListContainer.querySelectorAll('.btn-reject-map').forEach(btn => {
      btn.addEventListener('click', () => {
        const note = prompt('Вкажіть причину відхилення (опціонально):', 'Порушення структури або дисбаланс спавнів');
        if (note !== null) {
          this.updateMapStatus(btn.dataset.id, 'rejected', note);
        }
      });
    });

    this.dom.adminMapsListContainer.querySelectorAll('.btn-pending-map').forEach(btn => {
      btn.addEventListener('click', () => {
        this.updateMapStatus(btn.dataset.id, 'pending', '');
      });
    });

    this.dom.adminMapsListContainer.querySelectorAll('.btn-delete-map').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Видалити цю запропоновану карту назавжди?')) {
          this.deleteCommunityMap(btn.dataset.id);
        }
      });
    });
  }

  async updateMapStatus(id, status, reviewNote = '') {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/community-maps/status`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ id, status, reviewNote })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast(`✓ Статус карти оновлено на '${status}'`, 'success');
      this.loadMaps();
    } catch (err) {
      this.showToast('Помилка оновлення статусу карти: ' + err.message, 'error');
    }
  }

  async deleteCommunityMap(id) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/community-maps/delete`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ Карту успішно видалено', 'success');
      this.loadMaps();
    } catch (err) {
      this.showToast('Помилка видалення карти: ' + err.message, 'error');
    }
  }

  // =========================================================================
  // 6. BALANCE & CONFIG TAB
  // =========================================================================
  async loadBalanceConfig() {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/config`, { headers: this.getHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.configPayload = data;
      this.renderConfigGrid();
    } catch (err) {
      console.error('[AdminDashboard] Failed to load config:', err);
      this.showToast('Помилка завантаження конфігурації: ' + err.message, 'error');
    }
  }

  renderConfigGrid() {
    if (!this.dom.configCategoriesContainer || !this.configPayload) return;
    const { settings, schema, categories } = this.configPayload;

    const html = Object.entries(categories).map(([catKey, cat]) => {
      const fieldKeys = cat.fields || [];
      const fieldsHtml = fieldKeys.map(k => {
        const item = schema[k];
        if (!item) return '';
        const curVal = settings[k] !== undefined ? settings[k] : item.default;

        return `
          <div class="config-field-row" style="margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.25); border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label for="cfg_${k}" style="font-size: 12px; color: #ffcf48; font-weight: bold;">${item.label}</label>
              <span id="cfg_val_${k}" style="font-family: var(--font-mono); font-size: 12px; color: #2ec4b6; font-weight: bold;">
                ${curVal} ${item.unit || ''}
              </span>
            </div>
            <input 
              type="range" 
              id="cfg_${k}" 
              class="admin-config-input" 
              data-key="${k}" 
              min="${item.min}" 
              max="${item.max}" 
              step="${item.step || 1}" 
              value="${curVal}" 
              style="width: 100%; cursor: pointer;"
            >
            <div style="font-size: 10px; color: #8e9aa8; margin-top: 2px;">${item.description}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="config-category-card steampunk-panel" style="padding: 16px; margin-bottom: 16px;">
          <h4 style="font-family: var(--font-header); font-size: 15px; color: #ffcf48; margin: 0 0 12px 0; border-bottom: 1px solid rgba(197, 155, 39, 0.2); padding-bottom: 6px;">
            ${cat.icon || '⚙️'} ${cat.title}
          </h4>
          <div>${fieldsHtml}</div>
        </div>
      `;
    }).join('');

    this.dom.configCategoriesContainer.innerHTML = html;

    // Attach range sliders input events
    this.dom.configCategoriesContainer.querySelectorAll('.admin-config-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        const valSpan = document.getElementById(`cfg_val_${key}`);
        const item = schema[key];
        if (valSpan && item) {
          valSpan.textContent = `${input.value} ${item.unit || ''}`;
        }
      });
    });
  }

  async saveConfig() {
    const updatedSettings = {};
    this.dom.configCategoriesContainer.querySelectorAll('.admin-config-input').forEach(input => {
      const key = input.dataset.key;
      updatedSettings[key] = parseFloat(input.value);
    });

    try {
      const res = await fetch(`${this.apiBase}/api/admin/config`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ settings: updatedSettings })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ ' + data.message, 'success');
      this.configPayload.settings = data.settings;
    } catch (err) {
      this.showToast('Помилка збереження конфігурації: ' + err.message, 'error');
    }
  }

  async applyPreset(presetId) {
    try {
      const res = await fetch(`${this.apiBase}/api/admin/config/preset`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ presetId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast(`✓ ${data.message}`, 'success');
      this.configPayload.settings = data.settings;
      this.renderConfigGrid();
    } catch (err) {
      this.showToast('Помилка застосування пресету: ' + err.message, 'error');
    }
  }

  async resetConfigDefaults() {
    if (!confirm('Скинути всі налаштування до стандартних заводських значень?')) return;

    try {
      const res = await fetch(`${this.apiBase}/api/admin/config/reset`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.showToast('✓ ' + data.message, 'success');
      this.configPayload.settings = data.settings;
      this.renderConfigGrid();
    } catch (err) {
      this.showToast('Помилка скидання: ' + err.message, 'error');
    }
  }
}

// Instantiate on load
window.addEventListener('DOMContentLoaded', () => {
  window.adminDashboard = new AdminDashboard();
});
