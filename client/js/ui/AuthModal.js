/**
 * AuthModal.js
 * Controller for the Steampunk Authentication & Account Linking Modal.
 * Integrates Google Identity Services (GSI) with seamless fallback mock for offline/headless test execution.
 */

export class AuthModal {
  /**
   * @param {Object} progressionManager - Instance of ProgressionManager
   * @param {Object} [options]
   */
  constructor(progressionManager, options = {}) {
    this.prog = progressionManager;
    this.isOpen = false;
    this.pendingToken = null;

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
      authCallsignDisplay: document.getElementById('authCallsignDisplay'),
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
    this.dom.btnClose?.addEventListener('click', () => this.close());
    this.dom.overlay?.addEventListener('click', (e) => {
      if (e.target === this.dom.overlay) this.close();
    });

    // Mock Google Sign-In button for offline / testing
    this.dom.btnMockGoogleSignIn?.addEventListener('click', () => {
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

    this.dom.btnConfirmLinkMerge?.addEventListener('click', () => {
      this.executeLink('merge');
    });

    this.dom.btnConfirmLinkCloud?.addEventListener('click', () => {
      this.executeLink('keep_cloud');
    });

    this.dom.btnSignOut?.addEventListener('click', () => {
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
      this.dom.authTypeBadge.textContent = isGuest ? '⚙ Guest Mechanist' : '🌐 Linked Google Account';
      this.dom.authTypeBadge.className = `auth-type-pill ${isGuest ? 'guest' : 'linked'}`;
    }

    if (this.dom.authLevelBadge) {
      this.dom.authLevelBadge.textContent = `Rank ${profile.level}`;
    }

    if (this.dom.authCallsignDisplay) {
      this.dom.authCallsignDisplay.textContent = profile.username || 'FoundryMechanic';
    }

    if (this.dom.authEmailDisplay) {
      this.dom.authEmailDisplay.textContent = isGuest ? 'Stored Locally in Browser Machinery' : (profile.email || 'Cloud Verified');
    }

    if (this.dom.authStatusNotice) {
      this.dom.authStatusNotice.textContent = isGuest
        ? 'Your progression is safely recorded locally in this browser. Link Google to preserve your blueprints across multiple terminals.'
        : 'Your account is linked to Google Identity. Progression is securely synchronized with the steam cloud.';
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
        if (this.dom.linkGuestScrap) this.dom.linkGuestScrap.textContent = `${profile.currency?.scrap} Scrap`;
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
