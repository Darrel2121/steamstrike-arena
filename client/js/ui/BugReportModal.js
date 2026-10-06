/**
 * Bug Report & Feedback Modal Manager
 * Allows players to report bugs, suggest features, and send diagnostics.
 */

export class BugReportModal {
  /**
   * @param {Object} [options]
   * @param {Object} [options.app]
   */
  constructor(options = {}) {
    this.app = options.app || null;
    this.overlay = null;
    this.form = null;
    this.categorySelect = null;
    this.descInput = null;
    this.contactInput = null;
    this.btnSubmit = null;
    this.btnClose = null;
    this.statusBox = null;
    this.isSubmitting = false;

    this.initElements();
  }

  initElements() {
    this.overlay = document.getElementById('bugModalOverlay');
    this.btnClose = document.getElementById('btnBugClose');
    this.btnCancel = document.getElementById('btnBugCancel');
    this.btnSubmit = document.getElementById('btnBugSubmit');
    this.categorySelect = document.getElementById('bugCategorySelect');
    this.descInput = document.getElementById('bugDescInput');
    this.contactInput = document.getElementById('bugContactInput');
    this.statusBox = document.getElementById('bugStatusNotice');
    this.diagInfo = document.getElementById('bugDiagSummary');

    if (this.btnClose) {
      this.btnClose.addEventListener('click', () => this.hide());
    }
    if (this.btnCancel) {
      this.btnCancel.addEventListener('click', () => this.hide());
    }
    if (this.overlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.hide();
        }
      });
    }
    if (this.btnSubmit) {
      this.btnSubmit.addEventListener('click', () => this.submitReport());
    }

    // Connect trigger buttons
    const btnOpenDesktop = document.getElementById('btnOpenBugReport');
    if (btnOpenDesktop) {
      btnOpenDesktop.addEventListener('click', () => this.show());
    }

    const btnOpenMobile = document.getElementById('mBtnOpenBugReport');
    if (btnOpenMobile) {
      btnOpenMobile.addEventListener('click', () => {
        if (typeof window !== 'undefined' && window.app && typeof window.app.closeMobileNav === 'function') {
          window.app.closeMobileNav();
        }
        this.show();
      });
    }

    const btnOpenFooter = document.getElementById('btnFooterBugReport');
    if (btnOpenFooter) {
      btnOpenFooter.addEventListener('click', (e) => {
        e.preventDefault();
        this.show();
      });
    }
  }

  getDiagnostics() {
    const w = typeof window !== 'undefined' ? window.innerWidth : 800;
    const h = typeof window !== 'undefined' ? window.innerHeight : 600;
    const screenRes = typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'unknown';
    const currentView = this.app?.currentView || 'home';
    const callsign = this.app?.localPlayerName || 'Guest';
    const roomId = this.app?.networkClient?.roomId || 'none';
    const mapName = this.app?.activeMatchMap?.name || 'none';
    const fps = this.app?.gameRenderer?.currentFps || '30-60';

    return {
      viewport: `${w}x${h}`,
      screen: screenRes,
      pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      currentView,
      callsign,
      roomId,
      mapName,
      fps,
      language: typeof navigator !== 'undefined' ? navigator.language : 'uk',
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      timestamp: new Date().toISOString()
    };
  }

  show(prefilledCategory = 'gameplay') {
    if (!this.overlay) {
      this.initElements();
    }
    if (!this.overlay) return;

    if (this.categorySelect && prefilledCategory) {
      this.categorySelect.value = prefilledCategory;
    }
    if (this.statusBox) {
      this.statusBox.style.display = 'none';
      this.statusBox.className = 'auth-notice';
    }
    if (this.descInput) {
      this.descInput.value = '';
    }

    // Populate auto-diagnostics summary chip
    if (this.diagInfo) {
      const diag = this.getDiagnostics();
      this.diagInfo.textContent = `💻 Екран: ${diag.viewport} | Секція: ${diag.currentView} | Гравець: ${diag.callsign}`;
    }

    this.overlay.style.display = 'flex';
    this.overlay.classList.add('active');

    setTimeout(() => {
      if (this.descInput) {
        this.descInput.focus();
      }
    }, 100);
  }

  hide() {
    if (!this.overlay) return;
    this.overlay.style.display = 'none';
    this.overlay.classList.remove('active');
  }

  async submitReport() {
    if (this.isSubmitting) return;

    const category = this.categorySelect?.value || 'general';
    const description = this.descInput?.value?.trim() || '';
    const contact = this.contactInput?.value?.trim() || '';

    if (!description) {
      this.showStatus('Будь ласка, опишіть проблему або вашу пропозицію.', 'error');
      if (this.descInput) this.descInput.focus();
      return;
    }

    this.isSubmitting = true;
    if (this.btnSubmit) {
      this.btnSubmit.disabled = true;
      this.btnSubmit.textContent = '⚙ Відправка...';
    }

    const payload = {
      category,
      description,
      contact,
      clientInfo: this.getDiagnostics()
    };

    try {
      const token = this.app?.authService?.getToken?.() || null;
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/feedback/bug', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.success) {
        this.showStatus('✔ Дякуємо! Звіт успішно надіслано інженерам майстерні Steamstrike.', 'success');
        if (this.descInput) this.descInput.value = '';
        setTimeout(() => {
          this.hide();
        }, 2200);
      } else {
        this.showStatus(data.error || 'Не вдалося надіслати звіт. Спробуйте пізніше.', 'error');
      }
    } catch (err) {
      this.showStatus('Помилка з\'єднання з сервером. Перевірте мережу.', 'error');
    } finally {
      this.isSubmitting = false;
      if (this.btnSubmit) {
        this.btnSubmit.disabled = false;
        this.btnSubmit.textContent = '⚙ Надіслати звіт';
      }
    }
  }

  showStatus(msg, type = 'info') {
    if (!this.statusBox) return;
    this.statusBox.textContent = msg;
    this.statusBox.style.display = 'block';
    if (type === 'error') {
      this.statusBox.style.background = 'rgba(231, 29, 54, 0.15)';
      this.statusBox.style.borderColor = '#ff4757';
      this.statusBox.style.color = '#ff6b81';
    } else if (type === 'success') {
      this.statusBox.style.background = 'rgba(46, 196, 182, 0.15)';
      this.statusBox.style.borderColor = '#2ec4b6';
      this.statusBox.style.color = '#5ffbf1';
    } else {
      this.statusBox.style.background = 'rgba(197, 155, 39, 0.15)';
      this.statusBox.style.borderColor = 'var(--color-brass-primary)';
      this.statusBox.style.color = 'var(--color-brass-bright)';
    }
  }
}
