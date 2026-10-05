/**
 * AuthModal.js
 * Controller for the Steampunk Authentication & Account Linking Modal.
 * Integrates Google Identity Services (GSI) with seamless fallback mock for offline/headless test execution.
 */

import { generateSteampunkCallsign } from '../ProgressionManager.js';
import { STEAMPUNK_EMBLEMS, getEmblemDefinition } from '../../shared/ProgressionSchema.js';

export class AuthModal {
  /**
   * @param {Object} progressionManager - Instance of ProgressionManager
   * @param {Object} [options]
   */
  constructor(progressionManager, options = {}) {
    this.prog = progressionManager;
    this.isOpen = false;
    this.pendingToken = null;
    this._noticeTimer = null;

    this.bindDom();
    this.attachEvents();
    this.initGsi();

    if (this.prog) {
      this.prog.on('profileUpdated', () => this.render());
    }
  }

  bindDom() {
    this.dom = {
      overlay: document.getElementById('authModalOverlay'),
      btnClose: document.getElementById('btnAuthClose'),
      authTypeBadge: document.getElementById('authTypeBadge'),
      authLevelBadge: document.getElementById('authLevelBadge'),
      authActiveEmblem: document.getElementById('authActiveEmblem'),
      authCallsignInput: document.getElementById('authCallsignInput'),
      authCallsignDisplay: document.getElementById('authCallsignDisplay'),
      btnSaveCallsign: document.getElementById('btnSaveCallsign'),
      btnAuthRandomCallsign: document.getElementById('btnAuthRandomCallsign'),
      authCallsignNotice: document.getElementById('authCallsignNotice'),
      authSelectedEmblemName: document.getElementById('authSelectedEmblemName'),
      authEmblemsGrid: document.getElementById('authEmblemsGrid'),
      authEmailDisplay: document.getElementById('authEmailDisplay'),
      authStatusNotice: document.getElementById('authStatusNotice'),

      gsiContainer: document.getElementById('gsiContainer'),
      btnMockGoogleSignIn: document.getElementById('btnMockGoogleSignIn'),
      linkConfirmSection: document.getElementById('linkConfirmSection'),
      linkGuestXp: document.getElementById('linkGuestXp'),
      linkGuestScrap: document.getElementById('linkGuestScrap'),
      btnConfirmLinkMerge: document.getElementById('btnConfirmLinkMerge'),
      btnConfirmLinkCloud: document.getElementById('btnConfirmLinkCloud'),
      btnSignOut: document.getElementById('btnSignOut')
    };
  }

  attachEvents() {
    const addTap = (el, handler) => {
      if (!el) return;
      el.addEventListener('click', handler);
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        handler(e);
      }, { passive: false });
    };

    addTap(this.dom.btnClose, () => this.close());
    this.dom.overlay?.addEventListener('click', (e) => {
      if (e.target === this.dom.overlay) this.close();
    });

    const saveCallsignHandler = async () => {
      const val = (this.dom.authCallsignInput?.value || '').trim();
      if (!val) return;
      const currentProfile = this.prog?.getProfile();
      if (currentProfile && currentProfile.username === val) return;
      if (this.prog) {
        await this.prog.updateIdentity({ username: val });
        this.showCallsignNotice('Позивний збережено!');
      }
    };

    addTap(this.dom.btnSaveCallsign, saveCallsignHandler);
    this.dom.authCallsignInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveCallsignHandler();
      }
    });
    this.dom.authCallsignInput?.addEventListener('change', saveCallsignHandler);
    this.dom.authCallsignInput?.addEventListener('blur', saveCallsignHandler);

    addTap(this.dom.btnAuthRandomCallsign, async () => {
      const rand = generateSteampunkCallsign();
      if (this.dom.authCallsignInput) {
        this.dom.authCallsignInput.value = rand;
      }
      if (this.prog) {
        await this.prog.updateIdentity({ username: rand });
        this.showCallsignNotice('Позивний оновлено!');
      }
    });

    // Mock Google Sign-In button for offline / testing
    addTap(this.dom.btnMockGoogleSignIn, () => {
      this.handleGoogleCredentialResponse({
        credential: 'mock_jwt_' + Date.now(),
        isMock: true
      });
    });

    // Expose window trigger for zero-dependency headless tests
    if (typeof window !== 'undefined') {
      window.__triggerGoogleMockSignIn = (token) => {
        return this.handleGoogleCredentialResponse({
          credential: token || ('mock_jwt_' + Date.now()),
          isMock: true
        });
      };
    }

    addTap(this.dom.btnConfirmLinkMerge, () => {
      this.executeLink('merge');
    });

    addTap(this.dom.btnConfirmLinkCloud, () => {
      this.executeLink('keep_cloud');
    });

    addTap(this.dom.btnSignOut, () => {
      this.prog.saveToken(null);
      this.prog.profile = this.prog.createDefaultGuestProfile();
      this.prog.saveLocalProfile();
      this.prog.emit('profileUpdated', this.prog.profile);
      this.render();
    });
  }

  open() {
    this.isOpen = true;
    if (this.dom.overlay) {
      this.dom.overlay.style.display = 'flex';
    }
    this.render();
  }

  close() {
    this.isOpen = false;
    if (this.dom.overlay) {
      this.dom.overlay.style.display = 'none';
    }
    if (this.dom.linkConfirmSection) {
      this.dom.linkConfirmSection.style.display = 'none';
    }
  }

  render() {
    const profile = this.prog?.getProfile();
    if (!profile) return;

    const isGuest = profile.isGuest !== false;
    if (this.dom.authTypeBadge) {
      this.dom.authTypeBadge.textContent = isGuest ? '⚙ Гість-механік' : '🌐 Прив\'язаний акаунт Google';
      this.dom.authTypeBadge.className = `auth-type-pill ${isGuest ? 'guest' : 'linked'}`;
    }

    if (this.dom.authLevelBadge) {
      this.dom.authLevelBadge.textContent = `Ранг ${profile.level}`;
    }

    if (this.dom.authCallsignDisplay) {
      this.dom.authCallsignDisplay.textContent = profile.username || 'FoundryMechanic';
    }

    if (this.dom.authCallsignInput) {
      if (document.activeElement !== this.dom.authCallsignInput) {
        this.dom.authCallsignInput.value = profile.username || '';
      }
    }

    const activeEmblemId = profile.emblem || 'gear';
    const emblemDef = getEmblemDefinition(activeEmblemId);

    if (this.dom.authActiveEmblem) {
      this.dom.authActiveEmblem.textContent = emblemDef.icon;
      this.dom.authActiveEmblem.title = `${emblemDef.name} — «${emblemDef.motto}»`;
    }

    if (this.dom.authSelectedEmblemName) {
      this.dom.authSelectedEmblemName.textContent = emblemDef.name;
    }

    this.renderEmblemsGrid(activeEmblemId);

    if (this.dom.authEmailDisplay) {
      this.dom.authEmailDisplay.textContent = isGuest ? 'Збережено локально в механізмах браузера' : (profile.email || 'Хмарна автентифікація');
    }

    if (this.dom.authStatusNotice) {
      this.dom.authStatusNotice.textContent = isGuest
        ? 'Ваш бойовий прогрес зберігається локально в браузері. Прив\'яжіть акаунт Google, щоб синхронізувати креслення між різними терміналами.'
        : 'Ваш акаунт прив\'язано до Google. Прогрес надійно синхронізовано з паровою хмарою.';
    }

    if (this.dom.btnSignOut) {
      this.dom.btnSignOut.style.display = isGuest ? 'none' : 'block';
    }

    // Toggle Google sign-in container visibility if already linked
    if (this.dom.gsiContainer) {
      this.dom.gsiContainer.style.display = isGuest ? 'block' : 'none';
    }
    if (this.dom.btnMockGoogleSignIn) {
      this.dom.btnMockGoogleSignIn.style.display = isGuest ? 'inline-flex' : 'none';
    }
  }

  showCallsignNotice(msg) {
    if (!this.dom.authCallsignNotice) return;
    this.dom.authCallsignNotice.textContent = msg;
    this.dom.authCallsignNotice.style.display = 'block';
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      if (this.dom.authCallsignNotice) {
        this.dom.authCallsignNotice.style.display = 'none';
      }
    }, 2800);
  }

  renderEmblemsGrid(activeEmblemId) {
    if (!this.dom.authEmblemsGrid) return;
    this.dom.authEmblemsGrid.innerHTML = '';

    for (const emblem of STEAMPUNK_EMBLEMS) {
      const card = document.createElement('div');
      card.className = `emblem-card ${emblem.id === activeEmblemId ? 'selected' : ''}`;
      card.title = `${emblem.name}\n«${emblem.motto}»`;

      const icon = document.createElement('div');
      icon.className = 'emblem-card-icon';
      icon.textContent = emblem.icon;

      const name = document.createElement('div');
      name.className = 'emblem-card-name';
      name.textContent = emblem.name;

      card.appendChild(icon);
      card.appendChild(name);

      const selectEmblem = async (e) => {
        if (e && e.type === 'touchend') e.preventDefault();
        if (this.prog) {
          await this.prog.updateIdentity({ emblem: emblem.id });
          this.showCallsignNotice(`Герб обрано: ${emblem.name}`);
        }
      };

      card.addEventListener('click', selectEmblem);
      card.addEventListener('touchend', selectEmblem, { passive: false });

      this.dom.authEmblemsGrid.appendChild(card);
    }
  }

  initGsi() {
    if (typeof window === 'undefined') return;

    if (window.google?.accounts?.id) {
      this.setupGsi();
    } else {
      // Attempt loading official GSI script, fall back to mock button on failure
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => this.setupGsi();
      script.onerror = () => {
        // Offline / sandbox mode: mock button remains active
        if (this.dom.btnMockGoogleSignIn) {
          this.dom.btnMockGoogleSignIn.style.display = 'inline-flex';
        }
      };
      document.head.appendChild(script);
    }
  }

  setupGsi() {
    try {
      const realClientId = window.__GOOGLE_CLIENT_ID__ || '1051560828434-1ahgmrf87g5ebvpjaoit688sq000jreo.apps.googleusercontent.com';
      if (realClientId && !realClientId.startsWith('mock-') && window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: realClientId,
          callback: (res) => this.handleGoogleCredentialResponse(res)
        });

        if (this.dom.gsiContainer) {
          this.dom.gsiContainer.style.display = 'block';
          window.google.accounts.id.renderButton(this.dom.gsiContainer, {
            theme: 'filled_black',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            logo_alignment: 'left'
          });
          if (this.dom.btnMockGoogleSignIn) {
            this.dom.btnMockGoogleSignIn.style.display = 'none';
          }
        }
      } else {
        if (this.dom.gsiContainer) {
          this.dom.gsiContainer.style.display = 'none';
        }
        if (this.dom.btnMockGoogleSignIn) {
          this.dom.btnMockGoogleSignIn.style.display = 'inline-flex';
        }
      }
    } catch (_) {
      if (this.dom.btnMockGoogleSignIn) {
        this.dom.btnMockGoogleSignIn.style.display = 'inline-flex';
      }
    }
  }

  async handleGoogleCredentialResponse(response) {
    const idToken = response?.credential;
    if (!idToken) return;

    const profile = this.prog.getProfile();
    const hasGuestProgress = (profile.level > 1 || (profile.xp || 0) > 0 || (profile.currency?.scrap || 0) !== 500);

    if (profile.isGuest && hasGuestProgress) {
      // Prompt user with account linking merge confirmation
      this.pendingToken = idToken;
      if (this.dom.linkConfirmSection) {
        this.dom.linkConfirmSection.style.display = 'block';
        if (this.dom.linkGuestXp) this.dom.linkGuestXp.textContent = `${profile.xp} XP`;
        if (this.dom.linkGuestScrap) this.dom.linkGuestScrap.textContent = `${profile.currency?.scrap} Брухту`;
      }
    } else {
      await this.prog.linkGoogleAccount(idToken, 'merge');
      if (this.dom.linkConfirmSection) this.dom.linkConfirmSection.style.display = 'none';
      this.render();
    }
  }

  async executeLink(strategy) {
    if (!this.pendingToken) return;
    await this.prog.linkGoogleAccount(this.pendingToken, strategy);
    this.pendingToken = null;
    if (this.dom.linkConfirmSection) {
      this.dom.linkConfirmSection.style.display = 'none';
    }
    this.render();
  }
}

export default AuthModal;
