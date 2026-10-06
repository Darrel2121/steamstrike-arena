/**
 * AdminPanelModal.js
 * Comprehensive Administrative Control Panel for Steamstrike: Tactical Arena.
 * Allows administrators to configure all general gameplay, vision, acoustics,
 * kinematics, bot AI, combat ballistics, and progression reward parameters in real-time.
 */

import {
  GAME_SETTINGS_SCHEMA,
  GAME_SETTING_CATEGORIES,
  GAME_SETTING_PRESETS,
  getDefaultGameSettings,
  sanitizeGameSettings
} from '../../shared/GameSettings.js';

export class AdminPanelModal {
  /**
   * @param {Object} options
   * @param {Object} options.app - Main App instance
   * @param {string} [options.apiBase] - API base URL
   */
  constructor(options = {}) {
    this.app = options.app || null;
    this.apiBase = options.apiBase || '';
    this.adminToken = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('steamstrike_admin_token')) || null;
    this.isAdmin = Boolean(this.adminToken);

    this.settings = getDefaultGameSettings();
    this.originalSettings = getDefaultGameSettings();
    this.defaults = getDefaultGameSettings();
    this.schema = GAME_SETTINGS_SCHEMA;
    this.categories = GAME_SETTING_CATEGORIES;
    this.presets = GAME_SETTING_PRESETS;

    this.activeCategory = 'movement';
    this.searchQuery = '';
    this.isDirty = false;
    this.isOpen = false;

    this.initDom();
    this.bindEvents();
    this.fetchPublicSettings();
  }

  /**
   * Builds and inserts the Admin Panel modal overlay into document body
   */
  initDom() {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('adminModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'adminModalOverlay';
      overlay.className = 'auth-modal-overlay';
      overlay.style.display = 'none';
      overlay.style.zIndex = '10005';
      document.body.appendChild(overlay);
    }
    this.overlay = overlay;
    this.renderModal();
  }

  /**
   * Fetches latest public gameplay parameters from server
   */
  async fetchPublicSettings() {
    try {
      const res = await fetch(`${this.apiBase}/api/config/public`);
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          this.settings = sanitizeGameSettings(data.settings);
          this.originalSettings = { ...this.settings };
          if (this.isOpen && this.isAdmin) {
            this.renderSettingsList();
          }
        }
      }
    } catch (err) {
      console.warn('[AdminPanelModal] Could not fetch public settings, using local schema defaults:', err.message);
    }
  }

  /**
   * Renders the complete modal dialog depending on auth state
   */
  renderModal() {
    if (!this.overlay) return;

    if (!this.isAdmin) {
      this.renderLoginView();
    } else {
      this.renderDashboardView();
    }
  }

  /**
   * Renders Steampunk Admin Access Gate view
   */
  renderLoginView() {
    this.overlay.innerHTML = `
      <div class="auth-modal-panel admin-gate-panel" style="max-width: 480px; text-align: center;">
        <div class="auth-modal-header">
          <div class="auth-modal-title">⚙️ Доступ Головного Інженера</div>
          <button type="button" class="btn-close-modal" id="btnAdminCloseGate" title="Закрити">&times;</button>
        </div>

        <div style="font-size: 48px; margin: 16px 0 8px;">🔐</div>
        <p style="font-size: 13px; color: var(--color-brass-glow, #ffcf48); margin-bottom: 20px;">
          Панель конфігурації глобальних параметрів гри, фізики, ліхтаря, акустики та ботів.
        </p>

        <form id="adminLoginForm" onsubmit="return false;" style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
          <div>
            <label for="adminKeyInput" style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
              Ключ доступу або пароль адміністратора:
            </label>
            <input 
              type="password" 
              id="adminKeyInput" 
              class="steampunk-input" 
              placeholder="Введіть майстер-пароль (за замовчуванням: steamstrike2026 або admin)" 
              required 
              style="width: 100%; box-sizing: border-box;"
              autocomplete="current-password"
            />
          </div>

          <div id="adminLoginNotice" class="auth-notice" style="display: none;"></div>

          <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button type="button" id="btnAdminCancelGate" class="btn-steampunk btn-iron" style="flex: 1;">
              Скасувати
            </button>
            <button type="submit" id="btnAdminSubmitLogin" class="btn-steampunk btn-brass" style="flex: 2;">
              ⚙ Увійти в адмінку
            </button>
          </div>
        </form>
      </div>
    `;

    const btnClose = document.getElementById('btnAdminCloseGate');
    const btnCancel = document.getElementById('btnAdminCancelGate');
    const form = document.getElementById('adminLoginForm');

    if (btnClose) btnClose.onclick = () => this.close();
    if (btnCancel) btnCancel.onclick = () => this.close();
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('adminKeyInput');
        if (input) this.handleLogin(input.value.trim());
      };
    }
  }

  /**
   * Renders Full Admin Control Panel Dashboard view
   */
  renderDashboardView() {
    const categoriesHtml = Object.values(this.categories).map(cat => {
      const isActive = cat.id === this.activeCategory;
      return `
        <button 
          type="button" 
          class="admin-cat-tab ${isActive ? 'active' : ''}" 
          data-category="${cat.id}"
          title="${cat.description}"
        >
          ${cat.title}
        </button>
      `;
    }).join('');

    const presetsHtml = Object.values(this.presets).map(p => `
      <button 
        type="button" 
        class="admin-preset-btn" 
        data-preset="${p.id}" 
        title="${p.description}"
      >
        ${p.name}
      </button>
    `).join('');

    this.overlay.innerHTML = `
      <div class="auth-modal-panel admin-dashboard-panel">
        <!-- Header -->
        <div class="auth-modal-header" style="border-bottom: 2px solid rgba(197, 155, 39, 0.4); padding-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="font-size: 22px;">⚙️</div>
            <div>
              <div class="auth-modal-title" style="margin: 0; font-size: 17px;">Панель Адміністратора Steamstrike</div>
              <div style="font-size: 11px; color: #94a3b8;">Глобальне калібрування балансу та симуляції в реальному часі</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="btnAdminLogout" class="btn-steampunk btn-iron" style="font-size: 11px; padding: 4px 10px;" title="Вийти з режиму адміністратора">
              🚪 Вийти
            </button>
            <button type="button" class="btn-close-modal" id="btnAdminCloseDash" title="Закрити панель">&times;</button>
          </div>
        </div>

        <!-- Presets Quick Bar -->
        <div class="admin-presets-bar">
          <span class="admin-presets-label">⚡ Швидкі пресети:</span>
          <div class="admin-presets-list">
            ${presetsHtml}
          </div>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="admin-toolbar">
          <div class="admin-search-wrap">
            <span style="font-size: 14px; opacity: 0.7;">🔍</span>
            <input 
              type="text" 
              id="adminSearchInput" 
              class="steampunk-input admin-search-input" 
              placeholder="Пошук параметра (назва чи опис)..." 
              value="${this.searchQuery}"
            />
          </div>
          <div class="admin-category-tabs">
            ${categoriesHtml}
          </div>
        </div>

        <!-- Category Description Banner -->
        <div class="admin-category-desc" id="adminCatDesc">
          ${this.categories[this.activeCategory]?.description || ''}
        </div>

        <!-- Settings Scroll Container -->
        <div class="admin-settings-scroll" id="adminSettingsList">
          <!-- Populated by renderSettingsList() -->
        </div>

        <!-- Feedback Notice -->
        <div id="adminDashNotice" class="auth-notice" style="display: none; margin-top: 10px;"></div>

        <!-- Footer Actions Bar -->
        <div class="admin-footer-bar">
          <div class="admin-footer-left">
            <button type="button" id="btnAdminResetAll" class="btn-steampunk btn-iron" title="Скинути всі налаштування до початкових стандартних значень">
              🔄 Скинути все
            </button>
            <button type="button" id="btnAdminExport" class="btn-steampunk btn-iron" title="Експортувати параметри в JSON файл">
              📥 Експорт JSON
            </button>
            <label class="btn-steampunk btn-iron" style="cursor: pointer; margin: 0;" title="Імпортувати параметри з JSON файлу">
              📤 Імпорт JSON
              <input type="file" id="adminImportFile" accept=".json" style="display: none;">
            </label>
          </div>
          <div class="admin-footer-right">
            <button type="button" id="btnAdminSaveApply" class="btn-steampunk btn-brass" style="font-weight: 700;">
              💾 Застосувати зміни (Live Apply)
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindDashboardEvents();
    this.renderSettingsList();
  }

  /**
   * Binds interactive events for dashboard controls
   */
  bindDashboardEvents() {
    const btnClose = document.getElementById('btnAdminCloseDash');
    const btnLogout = document.getElementById('btnAdminLogout');
    const btnSave = document.getElementById('btnAdminSaveApply');
    const btnResetAll = document.getElementById('btnAdminResetAll');
    const btnExport = document.getElementById('btnAdminExport');
    const inputImport = document.getElementById('adminImportFile');
    const searchInput = document.getElementById('adminSearchInput');

    if (btnClose) btnClose.onclick = () => this.close();
    if (btnLogout) btnLogout.onclick = () => this.handleLogout();
    if (btnSave) btnSave.onclick = () => this.handleSaveSettings();
    if (btnResetAll) btnResetAll.onclick = () => this.handleResetAll();
    if (btnExport) btnExport.onclick = () => this.handleExportJson();
    if (inputImport) {
      inputImport.onchange = (e) => this.handleImportJson(e);
    }

    if (searchInput) {
      searchInput.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderSettingsList();
      };
    }

    // Category tab clicks
    const tabs = this.overlay.querySelectorAll('.admin-cat-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        const cat = tab.getAttribute('data-category');
        if (cat && this.categories[cat]) {
          this.activeCategory = cat;
          tabs.forEach(t => t.classList.toggle('active', t === tab));
          const descEl = document.getElementById('adminCatDesc');
          if (descEl) descEl.textContent = this.categories[cat].description;
          this.renderSettingsList();
        }
      };
    });

    // Preset buttons clicks
    const presetBtns = this.overlay.querySelectorAll('.admin-preset-btn');
    presetBtns.forEach(btn => {
      btn.onclick = () => {
        const presetId = btn.getAttribute('data-preset');
        if (presetId) this.handleApplyPreset(presetId);
      };
    });
  }

  /**
   * Renders the active list of setting items with dual slider & number inputs
   */
  renderSettingsList() {
    const container = document.getElementById('adminSettingsList');
    if (!container) return;

    let items = this.schema;

    // If searching, search across all categories; otherwise filter by active category
    if (this.searchQuery) {
      items = items.filter(item => {
        return (
          item.label.toLowerCase().includes(this.searchQuery) ||
          item.description.toLowerCase().includes(this.searchQuery) ||
          item.key.toLowerCase().includes(this.searchQuery)
        );
      });
    } else {
      items = items.filter(item => item.category === this.activeCategory);
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
          Параметрів за запитом "<strong>${this.escapeHtml(this.searchQuery)}</strong>" не знайдено.
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      const currentVal = this.settings[item.key] ?? item.default;
      const defaultVal = item.default;
      const isModified = currentVal !== defaultVal;

      return `
        <div class="admin-setting-row ${isModified ? 'is-modified' : ''}" data-key="${item.key}">
          <div class="admin-setting-info">
            <div class="admin-setting-header">
              <span class="admin-setting-label">${item.label}</span>
              <span class="admin-setting-unit">${item.unit}</span>
              ${isModified ? '<span class="admin-setting-mod-badge">ЗМІНЕНО</span>' : ''}
            </div>
            <div class="admin-setting-desc">${item.description}</div>
            <div class="admin-setting-meta">
              Діапазон: <strong>${item.min}</strong> - <strong>${item.max}</strong> ${item.unit} | За замовчуванням: <strong>${defaultVal}</strong> ${item.unit}
            </div>
          </div>

          <div class="admin-setting-controls">
            <input 
              type="range" 
              class="admin-slider" 
              data-key="${item.key}"
              min="${item.min}" 
              max="${item.max}" 
              step="${item.step}" 
              value="${currentVal}"
            />
            <div style="display: flex; align-items: center; gap: 6px;">
              <input 
                type="number" 
                class="steampunk-input admin-number-input" 
                data-key="${item.key}"
                min="${item.min}" 
                max="${item.max}" 
                step="${item.step}" 
                value="${currentVal}"
              />
              <button 
                type="button" 
                class="btn-steampunk btn-iron admin-btn-reset-single" 
                data-key="${item.key}" 
                title="Скинути цей параметр до замовчування (${defaultVal} ${item.unit})"
              >
                ↩
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners for sliders and number inputs
    const rows = container.querySelectorAll('.admin-setting-row');
    rows.forEach(row => {
      const key = row.getAttribute('data-key');
      const item = this.schema.find(s => s.key === key);
      if (!item) return;

      const slider = row.querySelector('.admin-slider');
      const numInput = row.querySelector('.admin-number-input');
      const resetBtn = row.querySelector('.admin-btn-reset-single');

      const updateValue = (val) => {
        let num = Number(val);
        if (isNaN(num)) num = item.default;
        num = Math.max(item.min, Math.min(item.max, num));
        
        // Round to step precision
        const stepDecimals = (item.step.toString().split('.')[1] || '').length;
        num = Number(num.toFixed(stepDecimals));

        this.settings[key] = num;
        if (slider) slider.value = num;
        if (numInput) numInput.value = num;
        this.isDirty = true;

        const isModified = num !== item.default;
        row.classList.toggle('is-modified', isModified);
        const modBadge = row.querySelector('.admin-setting-mod-badge');
        if (isModified && !modBadge) {
          const hdr = row.querySelector('.admin-setting-header');
          if (hdr) {
            const span = document.createElement('span');
            span.className = 'admin-setting-mod-badge';
            span.textContent = 'ЗМІНЕНО';
            hdr.appendChild(span);
          }
        } else if (!isModified && modBadge) {
          modBadge.remove();
        }
      };

      if (slider) {
        slider.oninput = (e) => updateValue(e.target.value);
      }
      if (numInput) {
        numInput.oninput = (e) => updateValue(e.target.value);
      }
      if (resetBtn) {
        resetBtn.onclick = () => updateValue(item.default);
      }
    });
  }

  /**
   * Handles admin authentication submission
   */
  async handleLogin(password) {
    const noticeEl = document.getElementById('adminLoginNotice');
    const submitBtn = document.getElementById('btnAdminSubmitLogin');

    if (!password) {
      this.showNotice(noticeEl, 'Будь ласка, введіть пароль адміністратора', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Перевірка...';
    }

    try {
      const res = await fetch(`${this.apiBase}/api/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.adminToken = data.adminToken || password;
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('steamstrike_admin_token', this.adminToken);
        }
        this.isAdmin = true;
        if (data.settings) {
          this.settings = sanitizeGameSettings(data.settings);
          this.originalSettings = { ...this.settings };
        }
        this.renderModal();
      } else {
        this.showNotice(noticeEl, data.error || 'Невірний пароль адміністратора', 'error');
      }
    } catch (err) {
      this.showNotice(noticeEl, 'Помилка з\'єднання із сервером: ' + err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '⚙ Увійти в адмінку';
      }
    }
  }

  /**
   * Handles logout
   */
  handleLogout() {
    this.adminToken = null;
    this.isAdmin = false;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('steamstrike_admin_token');
    }
    this.renderModal();
  }

  /**
   * Saves and live-applies current configuration to server
   */
  async handleSaveSettings() {
    const noticeEl = document.getElementById('adminDashNotice');
    const saveBtn = document.getElementById('btnAdminSaveApply');

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Збереження...';
    }

    try {
      const res = await fetch(`${this.apiBase}/api/admin/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`,
          'x-admin-key': this.adminToken
        },
        body: JSON.stringify({
          settings: this.settings,
          adminKey: this.adminToken
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.isDirty = false;
        this.originalSettings = { ...this.settings };
        this.showNotice(noticeEl, '✔ Усі параметри гри успішно оновлено та активовано в реальному часі!', 'success');
      } else {
        this.showNotice(noticeEl, data.error || 'Не вдалося зберегти налаштування', 'error');
      }
    } catch (err) {
      this.showNotice(noticeEl, 'Помилка відправки на сервер: ' + err.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Застосувати зміни (Live Apply)';
      }
    }
  }

  /**
   * Applies predefined setting preset
   */
  async handleApplyPreset(presetId) {
    const preset = this.presets[presetId];
    if (!preset) return;

    const noticeEl = document.getElementById('adminDashNotice');
    try {
      const res = await fetch(`${this.apiBase}/api/admin/config/preset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`,
          'x-admin-key': this.adminToken
        },
        body: JSON.stringify({
          presetId,
          adminKey: this.adminToken
        })
      });

      const data = await res.json();
      if (res.ok && data.success && data.settings) {
        this.settings = sanitizeGameSettings(data.settings);
        this.renderSettingsList();
        this.showNotice(noticeEl, `✔ Пресет "${preset.name}" активовано!`, 'success');
      } else {
        // Fallback local apply
        this.settings = sanitizeGameSettings(preset.settings);
        this.renderSettingsList();
        this.showNotice(noticeEl, `Пресет "${preset.name}" завантажено локально. Натисніть "Застосувати зміни" для збереження на сервері.`, 'success');
      }
    } catch (err) {
      this.settings = sanitizeGameSettings(preset.settings);
      this.renderSettingsList();
      this.showNotice(noticeEl, `Пресет "${preset.name}" застосовано локально.`, 'success');
    }
  }

  /**
   * Resets all parameters to factory defaults
   */
  async handleResetAll() {
    if (!confirm('Ви впевнені, що бажаєте скинути абсолютно всі налаштування гри до заводських значень?')) {
      return;
    }

    const noticeEl = document.getElementById('adminDashNotice');
    try {
      const res = await fetch(`${this.apiBase}/api/admin/config/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`,
          'x-admin-key': this.adminToken
        },
        body: JSON.stringify({ adminKey: this.adminToken })
      });

      const data = await res.json();
      if (res.ok && data.success && data.settings) {
        this.settings = sanitizeGameSettings(data.settings);
      } else {
        this.settings = getDefaultGameSettings();
      }
    } catch (err) {
      this.settings = getDefaultGameSettings();
    }

    this.renderSettingsList();
    this.showNotice(noticeEl, '✔ Усі параметри успішно скинуто до початкових стандартів!', 'success');
  }

  /**
   * Exports current configuration to a downloadable JSON file
   */
  handleExportJson() {
    try {
      const jsonStr = JSON.stringify(this.settings, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `steamstrike_game_config_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Помилка експорту JSON: ' + err.message);
    }
  }

  /**
   * Imports configuration from uploaded JSON file
   */
  handleImportJson(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    const noticeEl = document.getElementById('adminDashNotice');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        this.settings = sanitizeGameSettings(parsed);
        this.renderSettingsList();
        this.showNotice(noticeEl, '✔ Конфігурацію успішно імпортовано з файлу. Не забудьте натиснути "Застосувати зміни"!', 'success');
      } catch (err) {
        this.showNotice(noticeEl, 'Помилка читання JSON файлу: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  /**
   * Displays status feedback notification
   */
  showNotice(el, msg, type = 'success') {
    if (!el) return;
    el.style.display = 'block';
    el.className = `auth-notice auth-notice-${type}`;
    el.textContent = msg;

    if (this.noticeTimeout) clearTimeout(this.noticeTimeout);
    this.noticeTimeout = setTimeout(() => {
      if (el) el.style.display = 'none';
    }, 6000);
  }

  /**
   * Escapes HTML string
   */
  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Binds global keyboard hotkeys (F2, Ctrl+Shift+A) and modal backdrop click
   */
  bindEvents() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // F2 hotkey or Ctrl+Shift+A
      if (e.key === 'F2' || (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a'))) {
        e.preventDefault();
        this.toggle();
      }

      // Close modal on Escape
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    if (this.overlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.close();
        }
      });
    }
  }

  /**
   * Opens the admin panel modal
   */
  open() {
    if (!this.overlay) return;
    this.isOpen = true;
    this.overlay.style.display = 'flex';
    this.fetchPublicSettings();
    this.renderModal();
  }

  /**
   * Closes the admin panel modal
   */
  close() {
    if (!this.overlay) return;
    this.isOpen = false;
    this.overlay.style.display = 'none';
  }

  /**
   * Toggles modal visibility
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
