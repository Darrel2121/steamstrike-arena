/**
 * Main Client Application Router & View Controller
 * Switches between Lobby, Battle Map Editor, and Game Arena.
 * Coordinates NetworkClient, InputManager, LobbyUI, and GameRenderer.
 */

import { MapEditor } from './editor/MapEditor.js';
import { createDefaultMap, PRESET_MAPS, getPresetMap } from '../../shared/MapSchema.js';
import { NetworkClient } from './NetworkClient.js';
import { InputManager } from './InputManager.js';
import { LobbyUI } from './ui/LobbyUI.js';
import { GameRenderer } from './rendering/GameRenderer.js';
import { ProgressionManager, generateSteampunkCallsign } from './ProgressionManager.js';
import { getEmblemDefinition } from '../../shared/ProgressionSchema.js';
import { WorkshopUI } from './ui/WorkshopUI.js';
import { AuthModal } from './ui/AuthModal.js';

export class App {
  constructor() {
    this.currentView = 'home'; // Default to website landing page
    this.heroMode = 'solo';

    this.activeMatchMap = null;
    this.localPlayerId = null;
    this.gameLoopActive = false;
    this.animationFrameId = null;
    this.isMatchOver = false;
    this.soloWarmupTimer = null;
    this.landscapePromptDismissed = Boolean(
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('steamstrike_dismiss_rotate')
    );

    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const apiBase = isLocal ? '' : 'https://steamstrike-server.onrender.com';
    this.progressionManager = new ProgressionManager({ apiBase });
    this.bindDomElements();
    this.authModal = new AuthModal(this.progressionManager);
    this.workshopUI = new WorkshopUI(this.progressionManager, {
      authModal: this.authModal
    });
    this.progressionManager.init();

    this.initNetworking();
    this.initMapEditor();
    this.initGameRenderer();
    this.attachEventListeners();

    this.switchView('home');
    this.checkUrlInvitation();
  }

  bindDomElements() {
    this.views = {
      home: document.getElementById('view-home'),
      lobby: document.getElementById('view-lobby'),
      editor: document.getElementById('view-editor'),
      game: document.getElementById('view-game'),
      workshop: document.getElementById('view-workshop')
    };

    this.navButtons = {
      home: document.getElementById('navBtnHome'),
      lobby: document.getElementById('navBtnLobby'),
      editor: document.getElementById('navBtnEditor'),
      workshop: document.getElementById('navBtnWorkshop'),
      auth: document.getElementById('navBtnAuth')
    };

    // Mobile Navigation ("Бутерброд")
    this.btnHamburgerToggle = document.getElementById('btnHamburgerToggle');
    this.mobileNavDrawer = document.getElementById('mobileNavDrawer');
    this.btnCloseMobileNav = document.getElementById('btnCloseMobileNav');
    this.mobileNavBackdrop = document.getElementById('mobileNavBackdrop');
    this.mHeaderUserBadge = document.getElementById('mHeaderUserBadge');
    this.mNavButtons = {
      home: document.getElementById('mNavBtnHome'),
      lobby: document.getElementById('mNavBtnLobby'),
      editor: document.getElementById('mNavBtnEditor'),
      workshop: document.getElementById('mNavBtnWorkshop'),
      auth: document.getElementById('mNavBtnAuth'),
      fullscreen: document.getElementById('mBtnGlobalFullscreen')
    };

    this.headerBrand = document.getElementById('headerBrand');
    this.headerUserBadge = document.getElementById('headerUserBadge');

    // Home / Landing Page elements
    this.btnHeroQuickPlay = document.getElementById('btnHeroQuickPlay');
    this.btnModeSolo = document.getElementById('btnModeSolo');
    this.btnModeOnline = document.getElementById('btnModeOnline');
    this.homePlayerNameInput = document.getElementById('homePlayerNameInput');
    this.homeRoomField = document.getElementById('homeRoomField');
    this.homeRoomInput = document.getElementById('homeRoomInput');
    this.homeMapSelect = document.getElementById('homeMapSelect');
    this.btnRandomCallsign = document.getElementById('btnRandomCallsign');
    this.btnPortalEditor = document.getElementById('btnPortalEditor');
    this.btnPortalWorkshop = document.getElementById('btnPortalWorkshop');
    this.btnPortalLobby = document.getElementById('btnPortalLobby');
    this.homeUserCallsign = document.getElementById('homeUserCallsign');
    this.homeUserBadge = document.getElementById('homeUserBadge');

    // Lobby & Game elements
    this.btnEnterEditor = document.getElementById('btnEnterEditor');
    this.btnQuickPlay = document.getElementById('btnQuickPlay');
    this.btnReturnToEditor = document.getElementById('btnReturnToEditor');
    this.btnReturnToLobby = document.getElementById('btnReturnToLobby');
    this.btnGlobalFullscreen = document.getElementById('btnGlobalFullscreen');
    this.btnGameFullscreen = document.getElementById('btnGameFullscreen');
    this.btnEditorFullscreen = document.getElementById('btnEditorFullscreen');

    this.gameMapNameDisplay = document.getElementById('gameMapNameDisplay');
    this.editorCanvas = document.getElementById('editorCanvas');
    this.gameCanvas = document.getElementById('gameCanvas');

    // Game Idle Overlay & buttons
    this.gameIdleOverlay = document.getElementById('gameIdleOverlay');
    this.btnIdleSoloPlay = document.getElementById('btnIdleSoloPlay');
    this.btnIdleGoLobby = document.getElementById('btnIdleGoLobby');
    this.btnIdleGoHome = document.getElementById('btnIdleGoHome');

    // Arena Loading Overlay
    this.gameLoadingOverlay = document.getElementById('gameLoadingOverlay');
    this.gameLoadingTitle = document.getElementById('gameLoadingTitle');
    this.gameLoadingDesc = document.getElementById('gameLoadingDesc');

    // Landscape Orientation Prompt elements for mobile
    this.landscapeRotatePrompt = document.getElementById('landscapeRotatePrompt');
    this.btnRotateFullscreen = document.getElementById('btnRotateFullscreen');
    this.btnDismissRotatePrompt = document.getElementById('btnDismissRotatePrompt');
  }

  initNetworking() {
    this.networkClient = new NetworkClient();
    this.inputManager = new InputManager(this.gameCanvas);

    this.lobbyUI = new LobbyUI(this.networkClient, {
      progressionManager: this.progressionManager,
      onMatchStart: (matchData) => this.startLiveMatch(matchData),
      onRequestCustomMap: () => (this.editor?.map ? this.editor.map : null),
      onSwitchToLobby: () => this.switchView('lobby'),
      onRequestLandscape: () => this.requestLandscapeOrientation()
    });

    // Auto-connect on startup for instant zero-latency lobby and room operations
    const token = this.progressionManager?.getToken();
    this.networkClient.connect(null, token);

    this.networkClient.on('lobbyState', (state) => {
      if (state.yourPlayerId) {
        this.localPlayerId = state.yourPlayerId;
      }
    });

    this.networkClient.on('matchInit', (matchData) => {
      this.localPlayerId = matchData.playerId;
      this.startLiveMatch(matchData);
    });

    this.networkClient.on('matchOver', (outcome) => {
      this.handleMatchOver(outcome);
    });

    this.networkClient.on('elimination', (payload) => {
      this.handleElimination(payload);
    });

    this.networkClient.on('respawn', (payload) => {
      if (this.gameRenderer && payload?.entityId) {
        this.gameRenderer.removeWreckById(payload.entityId);
        if (payload.entityId === this.localPlayerId) {
          this.gameRenderer.centerCameraOn(payload.x, payload.y);
          this.gameRenderer.addNotification('⚙ Автоматон відновлено! Повернення у бій!', { type: 'info', color: '#5ffbf1', duration: 2.5 });
        }
      }
    });

    this.networkClient.on('damage', (payload) => {
      this.handleDamage(payload);
    });
  }

  initMapEditor() {
    if (this.editorCanvas) {
      this.editor = new MapEditor(this.editorCanvas, {
        onLaunch: (map, mode) => {
          if (mode === 'online') {
            this.launchMatchWithMap(map);
          } else {
            this.launchSoloTraining(map);
          }
        },
        onReturnHome: () => this.switchView('home')
      });

      window.addEventListener('launchCustomMap', (e) => {
        if (e.detail?.map) {
          if (e.detail.mode === 'online') {
            this.launchMatchWithMap(e.detail.map);
          } else {
            this.launchSoloTraining(e.detail.map);
          }
        }
      });

      window.addEventListener('editorReturnHome', () => {
        this.switchView('home');
      });
    }
  }

  initGameRenderer() {
    if (this.gameCanvas) {
      const container = this.gameCanvas.parentElement;
      const w = container?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
      const h = container?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
      // Tighter tactical FOV: target visible world width ~520px (13 tiles across)
      const targetWorldWidth = 520;
      const calculatedZoom = Math.max(1.8, Math.min(4.5, Math.round((w / targetWorldWidth) * 100) / 100));

      this.gameRenderer = new GameRenderer(this.gameCanvas, {
        zoom: calculatedZoom,
        minZoom: 1.5,
        maxZoom: 4.5,
        adaptiveZoom: true,
        targetWorldWidth: 520
      });

      this.gameCanvas.addEventListener('click', (e) => {
        if (this.isMatchOver && this.gameRenderer?.hud) {
          const rect = this.gameCanvas.getBoundingClientRect();
          const scaleX = this.gameCanvas.width / (rect.width || 1);
          const scaleY = this.gameCanvas.height / (rect.height || 1);
          const cx = (e.clientX - rect.left) * scaleX;
          const cy = (e.clientY - rect.top) * scaleY;

          const action = this.gameRenderer.hud.checkButtonClick(cx, cy);
          if (action === 'restart') {
            this.restartCurrentMatch();
          } else if (action === 'lobby') {
            this.returnToLobbyFromMatch();
          }
        }
      });

      this.gameCanvas.addEventListener('mousemove', (e) => {
        if (this.isMatchOver && this.gameRenderer?.hud) {
          const rect = this.gameCanvas.getBoundingClientRect();
          const scaleX = this.gameCanvas.width / (rect.width || 1);
          const scaleY = this.gameCanvas.height / (rect.height || 1);
          const mx = (e.clientX - rect.left) * scaleX;
          const my = (e.clientY - rect.top) * scaleY;
          this.gameRenderer.hud.handleMouseMove(mx, my);
        }
      });

      // Mouse wheel dynamic camera zoom adjustment (Bullet Echo style)
      this.gameCanvas.addEventListener('wheel', (e) => {
        if (this.gameRenderer && this.currentView === 'game') {
          e.preventDefault();
          const zoomDelta = e.deltaY < 0 ? 0.12 : -0.12;
          this.gameRenderer.adjustZoom(zoomDelta);
        }
      }, { passive: false });
    }
  }

  attachEventListeners() {
    if (this.headerBrand) {
      this.headerBrand.addEventListener('click', () => this.switchView('home'));
    }
    if (this.navButtons.home) {
      this.navButtons.home.addEventListener('click', () => this.switchView('home'));
    }
    if (this.navButtons.lobby) {
      this.navButtons.lobby.addEventListener('click', () => this.switchView('lobby'));
    }
    if (this.navButtons.editor) {
      this.navButtons.editor.addEventListener('click', () => this.switchView('editor'));
    }
    if (this.navButtons.game) {
      this.navButtons.game.addEventListener('click', () => this.switchView('game'));
    }
    if (this.navButtons.workshop) {
      this.navButtons.workshop.addEventListener('click', () => this.switchView('workshop'));
    }
    if (this.navButtons.auth) {
      this.navButtons.auth.addEventListener('click', () => this.authModal.open());
    }

    // Mobile Navigation ("Бутерброд") Drawer Controls
    const openMobileDrawer = () => {
      if (this.mobileNavDrawer) {
        this.mobileNavDrawer.style.display = 'flex';
        this.mobileNavDrawer.classList.add('open');
        this.btnHamburgerToggle?.classList.add('open');
        this.btnHamburgerToggle?.setAttribute('aria-expanded', 'true');
      }
    };
    const closeMobileDrawer = () => {
      if (this.mobileNavDrawer) {
        this.mobileNavDrawer.classList.remove('open');
        this.mobileNavDrawer.style.display = 'none';
        this.btnHamburgerToggle?.classList.remove('open');
        this.btnHamburgerToggle?.setAttribute('aria-expanded', 'false');
      }
    };

    const addTap = (el, handler) => {
      if (!el) return;
      const fn = (e) => {
        if (e && e.type === 'touchend') {
          e.preventDefault();
        }
        handler(e);
      };
      el.addEventListener('click', fn);
      el.addEventListener('touchend', fn, { passive: false });
    };

    if (this.btnHamburgerToggle) {
      addTap(this.btnHamburgerToggle, (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        const isOpen = this.mobileNavDrawer?.classList.contains('open') && this.mobileNavDrawer?.style.display !== 'none';
        if (isOpen) {
          closeMobileDrawer();
        } else {
          openMobileDrawer();
        }
      });
    }

    addTap(this.btnCloseMobileNav, closeMobileDrawer);
    addTap(this.mobileNavBackdrop, closeMobileDrawer);

    if (this.mNavButtons) {
      addTap(this.mNavButtons.home, () => {
        this.switchView('home');
        closeMobileDrawer();
      });
      addTap(this.mNavButtons.lobby, () => {
        this.switchView('lobby');
        closeMobileDrawer();
      });
      addTap(this.mNavButtons.editor, () => {
        this.switchView('editor');
        closeMobileDrawer();
      });
      addTap(this.mNavButtons.game, () => {
        this.switchView('game');
        closeMobileDrawer();
      });
      addTap(this.mNavButtons.workshop, () => {
        this.switchView('workshop');
        closeMobileDrawer();
      });
      addTap(this.mNavButtons.auth, () => {
        this.authModal.open();
        closeMobileDrawer();
      });
      addTap(this.mNavButtons.fullscreen, () => {
        this.toggleFullscreen();
        closeMobileDrawer();
      });
    }

    // Home / Landing Page Interactive Controls
    if (this.btnModeSolo && this.btnModeOnline) {
      this.btnModeSolo.addEventListener('click', () => {
        this.heroMode = 'solo';
        this.btnModeSolo.classList.add('active');
        this.btnModeOnline.classList.remove('active');
        if (this.homeRoomField) this.homeRoomField.style.display = 'none';
      });
      this.btnModeOnline.addEventListener('click', () => {
        this.heroMode = 'online';
        this.btnModeOnline.classList.add('active');
        this.btnModeSolo.classList.remove('active');
        if (this.homeRoomField) this.homeRoomField.style.display = 'flex';
        this.lobbyUI?.fetchAndRenderRooms();
      });
    }

    if (this.btnRandomCallsign) {
      this.btnRandomCallsign.addEventListener('click', () => {
        const rand = generateSteampunkCallsign();
        if (this.homePlayerNameInput) this.homePlayerNameInput.value = rand;
        if (this.lobbyUI?.dom?.playerNameInput) this.lobbyUI.dom.playerNameInput.value = rand;
        this.progressionManager?.updateIdentity({ username: rand });
      });

      this.homePlayerNameInput?.addEventListener('change', () => {
        const val = this.homePlayerNameInput.value?.trim();
        if (val) {
          if (this.lobbyUI?.dom?.playerNameInput) this.lobbyUI.dom.playerNameInput.value = val;
          this.progressionManager?.updateIdentity({ username: val });
        }
      });
    }

    if (this.btnHeroQuickPlay) {
      const handleHeroQuickPlay = (e) => {
        if (e && e.type === 'touchend') {
          e.preventDefault();
        }
        if (this.btnHeroQuickPlay.disabled) return;

        this.btnHeroQuickPlay.disabled = true;
        this.btnHeroQuickPlay.innerHTML = '<span class="spin-gear">⚙</span> ЗАПУСК БОЮ...';

        const name = (this.homePlayerNameInput?.value || 'FoundryRanger_1').trim();
        if (this.lobbyUI?.dom?.playerNameInput) this.lobbyUI.dom.playerNameInput.value = name;
        if (this.progressionManager?.profile && this.progressionManager.profile.username !== name) {
          this.progressionManager.updateIdentity({ username: name });
        }

        const selectedMap = this.getSelectedHeroMap();
        if (this.lobbyUI?.dom?.lobbyMapSelect && this.homeMapSelect) {
          this.lobbyUI.dom.lobbyMapSelect.value = this.homeMapSelect.value;
        }
        const selectedMode = document.getElementById('homeGameModeSelect')?.value || 'ffa_dm';
        if (this.lobbyUI?.dom?.lobbyGameModeSelect) {
          this.lobbyUI.dom.lobbyGameModeSelect.value = selectedMode;
        }

        if (this.heroMode === 'solo') {
          this.requestLandscapeOrientation();
          this.launchSoloTraining(selectedMap);
        } else {
          this.requestLandscapeOrientation();
          const room = (this.homeRoomInput?.value || 'Sector_Omega').trim();
          const pwd = (document.getElementById('homeRoomPasswordInput')?.value || '').trim();
          if (this.lobbyUI?.dom?.roomInput) this.lobbyUI.dom.roomInput.value = room;
          if (this.lobbyUI?.dom?.roomPasswordInput) this.lobbyUI.dom.roomPasswordInput.value = pwd;
          this.switchView('lobby');
          this.lobbyUI.handleCreateRoom(room, pwd || null);
          this.resetHeroPlayButton();
        }
      };

      this.btnHeroQuickPlay.addEventListener('click', handleHeroQuickPlay);
      this.btnHeroQuickPlay.addEventListener('touchend', handleHeroQuickPlay, { passive: false });
    }

    if (this.btnPortalEditor) {
      this.btnPortalEditor.addEventListener('click', () => this.switchView('editor'));
    }
    if (this.btnPortalWorkshop) {
      this.btnPortalWorkshop.addEventListener('click', () => this.switchView('workshop'));
    }
    if (this.btnPortalLobby) {
      this.btnPortalLobby.addEventListener('click', () => this.switchView('lobby'));
    }

    if (this.progressionManager) {
      this.progressionManager.on('profileUpdated', (p) => {
        const emblemDef = getEmblemDefinition(p?.emblem);
        const icon = emblemDef ? emblemDef.icon : (p?.isGuest !== false ? '⚙' : '🌐');

        if (this.headerUserBadge && p) {
          this.headerUserBadge.textContent = `${icon} ${p.username || 'Механік'}`;
        }
        if (this.mHeaderUserBadge && p) {
          this.mHeaderUserBadge.textContent = `${icon} ${p.username || 'Механік'}`;
        }
        if (this.homeUserCallsign && p) {
          this.homeUserCallsign.textContent = `${icon} ${p.username || 'FoundryRanger_1'}`;
          if (this.homePlayerNameInput) {
            this.homePlayerNameInput.value = p.username || '';
          }
          if (this.lobbyUI?.dom?.playerNameInput) {
            this.lobbyUI.dom.playerNameInput.value = p.username || '';
          }
        }
        if (this.homeUserBadge && p) {
          this.homeUserBadge.textContent = p.isGuest !== false ? 'Гість' : 'Google';
          this.homeUserBadge.className = `pill-badge ${p.isGuest !== false ? 'guest' : 'linked'}`;
        }
        if (this.networkClient && p) {
          this.networkClient.setLoadout({
            weaponId: p.equippedWeapon,
            classId: p.equippedClass,
            profile: p
          });
        }
      });
    }

    if (this.btnEnterEditor) {
      this.btnEnterEditor.addEventListener('click', () => this.switchView('editor'));
    }
    if (this.btnQuickPlay) {
      addTap(this.btnQuickPlay, () => {
        this.requestLandscapeOrientation();
        const defaultMap = this.editor?.map ? this.editor.map : createDefaultMap();
        this.launchSoloTraining(defaultMap);
      });
    }

    if (this.btnReturnToEditor) {
      addTap(this.btnReturnToEditor, () => {
        this.isMatchOver = false;
        this.activeMatchMap = null;
        if (this.gameRenderer) {
          this.gameRenderer.clearMatchOutcome();
          this.gameRenderer.clearWrecks();
        }
        this.stopGameLoop({ keepOverlayHidden: true });
        this.switchView('editor');
      });
    }
    if (this.btnReturnToLobby) {
      addTap(this.btnReturnToLobby, () => {
        this.returnToLobbyFromMatch();
      });
    }

    const btnTouchExitMatch = document.getElementById('btnTouchExitMatch');
    if (btnTouchExitMatch) {
      addTap(btnTouchExitMatch, () => {
        this.returnToLobbyFromMatch();
      });
    }

    // Idle Overlay Actions
    if (this.btnIdleSoloPlay) {
      addTap(this.btnIdleSoloPlay, () => {
        this.requestLandscapeOrientation();
        if (this.gameIdleOverlay) {
          this.gameIdleOverlay.style.display = 'none';
        }
        const selectedMap = this.getSelectedHeroMap();
        this.launchSoloTraining(selectedMap);
      });
    }
    if (this.btnIdleGoLobby) {
      addTap(this.btnIdleGoLobby, () => this.switchView('lobby'));
    }
    if (this.btnIdleGoHome) {
      addTap(this.btnIdleGoHome, () => this.switchView('home'));
    }

    // Fullscreen Mode Controls
    if (this.btnGlobalFullscreen) {
      this.btnGlobalFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }
    if (this.btnGameFullscreen) {
      this.btnGameFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }
    if (this.btnEditorFullscreen) {
      this.btnEditorFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }

    // Mobile Landscape Orientation Prompt Actions
    if (this.btnRotateFullscreen) {
      this.btnRotateFullscreen.addEventListener('click', async () => {
        this.landscapePromptDismissed = true;
        try {
          sessionStorage.setItem('steamstrike_dismiss_rotate', '1');
        } catch (_) {}
        await this.toggleFullscreen();
        await this.requestLandscapeOrientation();
        if (this.landscapeRotatePrompt) {
          this.landscapeRotatePrompt.style.display = 'none';
        }
      });
    }

    if (this.btnDismissRotatePrompt) {
      this.btnDismissRotatePrompt.addEventListener('click', () => {
        this.landscapePromptDismissed = true;
        try {
          sessionStorage.setItem('steamstrike_dismiss_rotate', '1');
        } catch (_) {}
        if (this.landscapeRotatePrompt) {
          this.landscapeRotatePrompt.style.display = 'none';
        }
      });
    }

    document.addEventListener('fullscreenchange', () => this.updateFullscreenUI());
    const handleViewportChange = () => {
      this.resizeGameCanvas();
      if (this.currentView === 'editor' && this.editor) {
        this.editor.setupCanvas();
        this.editor.render();
      }
      this.checkLandscapeOrientationPrompt();
    };

    window.addEventListener('resize', handleViewportChange);
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.addEventListener === 'function') {
      screen.orientation.addEventListener('change', handleViewportChange);
    }

    window.addEventListener('keydown', (e) => {
      if (this.isMatchOver) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this.restartCurrentMatch();
          return;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          this.returnToLobbyFromMatch();
          return;
        }
      }

      if (e.key === 'f' || e.key === 'F') {
        const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
          e.preventDefault();
          this.toggleFullscreen();
        }
      }
    });
  }

  resetHeroPlayButton() {
    if (this.btnHeroQuickPlay) {
      this.btnHeroQuickPlay.disabled = false;
      this.btnHeroQuickPlay.innerHTML = '⚔ В БІЙ! (СТАРТ ГРИ)';
    }
  }

  async toggleFullscreen() {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.warn('Fullscreen request failed:', err);
      }
    } else {
      if (document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch (err) {
          console.warn(err);
        }
      }
    }
  }

  /**
   * Attempts to lock the screen to landscape orientation (especially useful on mobile touch devices).
   */
  async requestLandscapeOrientation() {
    if (typeof window === 'undefined') return;
    try {
      // Mobile browsers (Chrome on Android) strictly require fullscreen mode to permit orientation lock
      const isMobileOrTouch = Boolean(
        (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) ||
        ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0)
      );
      if (isMobileOrTouch && !document.fullscreenElement && document.documentElement && typeof document.documentElement.requestFullscreen === 'function') {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      if (screen && screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) {}
  }

  /**
   * Evaluates if device is in portrait mode on mobile/touch viewports while in game view,
   * showing the rotate prompt if needed.
   */
  checkLandscapeOrientationPrompt() {
    if (!this.landscapeRotatePrompt) return;
    if (this.landscapePromptDismissed) {
      this.landscapeRotatePrompt.style.display = 'none';
      return;
    }
    if (typeof window === 'undefined') return;

    const isPortrait = window.innerHeight > window.innerWidth;
    const isMobileOrTouch = Boolean(
      (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) ||
      ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0)
    );

    if (this.currentView === 'game' && isPortrait && isMobileOrTouch) {
      this.landscapeRotatePrompt.style.display = 'flex';
    } else {
      this.landscapeRotatePrompt.style.display = 'none';
    }
  }

  updateFullscreenUI() {
    const isFs = Boolean(document.fullscreenElement);
    const label = isFs ? '🗗 Віконний режим' : '⛶ Повний екран';
    const gameLabel = isFs ? '🗗 Вікно (F)' : '⛶ Повний екран (F)';

    if (this.btnGlobalFullscreen) this.btnGlobalFullscreen.textContent = label;
    if (this.btnGameFullscreen) this.btnGameFullscreen.textContent = gameLabel;
    if (this.btnEditorFullscreen) this.btnEditorFullscreen.textContent = isFs ? '🗗' : '⛶';

    setTimeout(() => {
      this.resizeGameCanvas();
      if (this.editor) {
        this.editor.setupCanvas();
        this.editor.render();
      }
    }, 100);
  }

  resizeGameCanvas() {
    if (!this.gameCanvas || !this.gameRenderer) return;
    const container = this.gameCanvas.parentElement;
    if (!container) return;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    if (w > 0 && h > 0) {
      this.gameRenderer.resize(w, h);
    }
  }

  populateHeroMapList() {
    if (!this.homeMapSelect) return;
    const currentVal = this.homeMapSelect.value;
    this.homeMapSelect.innerHTML = '';

    for (const preset of PRESET_MAPS) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = `${preset.name} — ${preset.description}`;
      this.homeMapSelect.appendChild(opt);
    }

    try {
      const savedMapRaw = localStorage.getItem('steampunk_tactical_custom_map_v1') || localStorage.getItem('steampunk_tactical_custom_map');
      if (savedMapRaw) {
        const savedMap = JSON.parse(savedMapRaw);
        const opt = document.createElement('option');
        opt.value = '__saved__';
        opt.textContent = `🛠 Користувацька: ${savedMap.name || 'Saved Arena'}`;
        this.homeMapSelect.appendChild(opt);
      }
    } catch (_) {}

    if (currentVal && Array.from(this.homeMapSelect.options).some(o => o.value === currentVal)) {
      this.homeMapSelect.value = currentVal;
    }
  }

  getSelectedHeroMap() {
    const val = this.homeMapSelect ? this.homeMapSelect.value : 'foundry';
    if (val === '__saved__') {
      try {
        const savedRaw = localStorage.getItem('steampunk_tactical_custom_map_v1') || localStorage.getItem('steampunk_tactical_custom_map');
        if (savedRaw) return JSON.parse(savedRaw);
      } catch (_) {}
    }
    return getPresetMap(val);
  }

  switchView(viewName) {
    if (this.currentView === 'game' && viewName !== 'game') {
      this.stopGameLoop({ keepOverlayHidden: true });
    }
    this.currentView = viewName;

    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('in-game', viewName === 'game');
    }

    Object.keys(this.views).forEach(key => {
      if (this.views[key]) {
        if (key === viewName) {
          this.views[key].classList.add('active');
        } else {
          this.views[key].classList.remove('active');
        }
      }
    });

    Object.keys(this.navButtons).forEach(key => {
      if (this.navButtons[key]) {
        if (key === viewName) {
          this.navButtons[key].classList.add('active');
          this.navButtons[key].classList.remove('btn-iron');
        } else {
          this.navButtons[key].classList.remove('active');
          this.navButtons[key].classList.add('btn-iron');
        }
      }
    });

    if (this.mNavButtons) {
      Object.keys(this.mNavButtons).forEach(key => {
        if (this.mNavButtons[key]) {
          if (key === viewName) {
            this.mNavButtons[key].classList.add('active');
          } else {
            this.mNavButtons[key].classList.remove('active');
          }
        }
      });
    }

    if (viewName === 'home') {
      this.populateHeroMapList();
      if (this.heroMode === 'online') {
        this.lobbyUI?.fetchAndRenderRooms();
      }
    }

    if (viewName === 'lobby' && this.lobbyUI) {
      this.lobbyUI.populateMapList();
      this.lobbyUI.fetchAndRenderRooms();
      this.lobbyUI.startRoomsPoll();
    }

    if (viewName === 'workshop' && this.workshopUI) {
      this.workshopUI.render();
    }

    if (viewName === 'editor' && this.editor) {
      setTimeout(() => {
        this.editor.setupCanvas();
        this.editor.render();
      }, 50);
    }

    if (viewName === 'game') {
      if (this.gameIdleOverlay) {
        this.gameIdleOverlay.style.display = (this.gameLoopActive || this.activeMatchMap) ? 'none' : 'flex';
      }
      this.requestLandscapeOrientation();
      this.checkLandscapeOrientationPrompt();
      setTimeout(() => this.resizeGameCanvas(), 50);
    } else {
      if (this.landscapeRotatePrompt) {
        this.landscapeRotatePrompt.style.display = 'none';
      }
    }
  }

  /**
   * Starts a live authoritative multiplayer match session.
   * @param {Object} matchData - S2C_MATCH_INIT payload
   */
  startLiveMatch(matchData) {
    if (this.soloWarmupTimer) {
      clearTimeout(this.soloWarmupTimer);
      this.soloWarmupTimer = null;
    }
    if (this.gameLoadingOverlay) {
      this.gameLoadingOverlay.style.display = 'none';
    }
    this.resetHeroPlayButton();

    if (this.gameIdleOverlay) {
      this.gameIdleOverlay.style.display = 'none';
    }
    this.localPlayerId = matchData.playerId;
    const targetMap = this.activeMatchMap || this.editor?.map || createDefaultMap();

    // Reset input poll timer so initial frame does not accumulate lobby latency
    if (this.inputManager && typeof this.inputManager.resetPollTime === 'function') {
      this.inputManager.resetPollTime();
    }

    // Inject upgraded character stats into kinematics and visibility, prioritizing authoritative server speed
    if (typeof matchData?.maxSpeed === 'number' && this.networkClient) {
      this.networkClient.playerSpeed = matchData.maxSpeed;
    } else if (this.progressionManager) {
      const stats = this.progressionManager.getCalculatedStats();
      if (this.networkClient) {
        this.networkClient.playerSpeed = stats.speed;
      }
    }

    if (this.progressionManager && this.gameRenderer?.visibilityRenderer) {
      const stats = this.progressionManager.getCalculatedStats();
      this.gameRenderer.visibilityRenderer.lanternRange = stats.lanternRange;
    }

    if (this.gameMapNameDisplay) {
      this.gameMapNameDisplay.textContent = targetMap.name || 'Foundry Arena';
    }

    if (this.gameRenderer) {
      this.gameRenderer.clearMatchOutcome();
      this.gameRenderer.clearWrecks();
      this.gameRenderer.setMap(targetMap);
      if (this.networkClient) {
        this.networkClient.setMap(targetMap);
        this.networkClient.setGeometrySegments(this.gameRenderer.segments);
      }
    }

    this.isMatchOver = false;
    this.switchView('game');
    this.resizeGameCanvas();
    this.startGameLoop();
  }

  /**
   * Quick-launch solo match on a custom or default map into the lobby.
   * @param {Object} map
   */
  launchMatchWithMap(map) {
    this.activeMatchMap = map;
    const roomId = (this.lobbyUI?.dom?.roomInput?.value || 'Sector_Custom').trim();
    const playerName = (this.lobbyUI?.dom?.playerNameInput?.value || 'HostEngineer').trim();

    const doCreate = () => {
      const prof = this.progressionManager?.getProfile();
      if (prof && this.networkClient) {
        this.networkClient.setLoadout({
          weaponId: prof.equippedWeapon,
          classId: prof.equippedClass,
          profile: prof
        });
      }
      this.networkClient.createLobby({
        roomId,
        playerName,
        mapName: map.name || 'Custom Arena',
        maxPlayers: 4,
        map,
        equippedWeapon: prof?.equippedWeapon || 'revolver',
        equippedClass: prof?.equippedClass || 'vanguard',
        profile: prof
      });
    };

    if (this.networkClient.isConnected && this.networkClient.socket?.readyState === 1) {
      doCreate();
    } else {
      const token = this.progressionManager?.getToken();
      this.networkClient.connect(null, token);
      const onOpen = () => {
        this.networkClient.off('open', onOpen);
        doCreate();
      };
      this.networkClient.on('open', onOpen);
    }

    this.switchView('lobby');
  }

  /**
   * Solo training mode: connects to server, joins a dedicated room with auto-filled bots, and starts match.
   * @param {Object} map
   */
  launchSoloTraining(map) {
    if (this.gameIdleOverlay) {
      this.gameIdleOverlay.style.display = 'none';
    }
    const targetMap = map || this.editor?.map || createDefaultMap();
    this.activeMatchMap = targetMap;

    // Immediately switch to game view with loading overlay so players see immediate progress
    this.switchView('game');
    if (this.gameLoadingOverlay) {
      this.gameLoadingOverlay.style.display = 'flex';
      if (this.gameLoadingTitle) this.gameLoadingTitle.textContent = 'ПІДКЛЮЧЕННЯ ДО АРЕНИ...';
      if (this.gameLoadingDesc) this.gameLoadingDesc.textContent = 'Зв\'язок із сервером та генерація ботів...';
    }

    if (this.soloWarmupTimer) clearTimeout(this.soloWarmupTimer);
    this.soloWarmupTimer = setTimeout(() => {
      if (this.gameLoadingDesc && !this.gameLoopActive) {
        this.gameLoadingDesc.textContent = 'Сервер прокидається з режиму сну... Зачекайте декілька секунд (холодний старт Render)';
      }
    }, 3500);

    if (this.progressionManager) {
      const stats = this.progressionManager.getCalculatedStats();
      if (this.networkClient) {
        this.networkClient.playerSpeed = stats.speed;
      }
      if (this.gameRenderer?.visibilityRenderer) {
        this.gameRenderer.visibilityRenderer.lanternRange = stats.lanternRange;
      }
    }

    if (this.gameMapNameDisplay) {
      this.gameMapNameDisplay.textContent = targetMap.name || 'Solo Training';
    }

    const soloRoomId = `solo_${Date.now().toString(36)}`;
    const playerName = (this.lobbyUI?.dom?.playerNameInput?.value || 'SoloCadet').trim();
    const gameMode = document.getElementById('homeGameModeSelect')?.value || document.getElementById('lobbyGameModeSelect')?.value || 'ffa_dm';
    const isDm = gameMode === 'ffa_dm' || gameMode === 'team_dm';
    const rawTarget = document.getElementById('homeTargetKillsSelect')?.value || document.getElementById('lobbyTargetKillsInput')?.value;
    const selectedTarget = parseInt(rawTarget, 10);
    const targetKills = isDm ? (Number.isFinite(selectedTarget) && selectedTarget > 0 ? selectedTarget : (gameMode === 'team_dm' ? 15 : 30)) : 0;

    const doLaunch = () => {
      const prof = this.progressionManager?.getProfile();
      if (prof && this.networkClient) {
        this.networkClient.setLoadout({
          weaponId: prof.equippedWeapon,
          classId: prof.equippedClass,
          profile: prof
        });
      }

      const onLobbyState = (state) => {
        if (state.roomId === soloRoomId) {
          this.networkClient.off('lobbyState', onLobbyState);
          this.networkClient.startMatch({ fillBots: true });
        }
      };
      this.networkClient.on('lobbyState', onLobbyState);

      this.networkClient.createLobby({
        roomId: soloRoomId,
        playerName,
        mapName: targetMap.name || 'Solo Training Arena',
        maxPlayers: 4,
        map: targetMap,
        autoFillBots: true,
        gameMode,
        targetKills,
        equippedWeapon: prof?.equippedWeapon || 'revolver',
        equippedClass: prof?.equippedClass || 'vanguard',
        profile: prof
      });
    };

    if (this.networkClient.isConnected && this.networkClient.socket?.readyState === 1) {
      doLaunch();
    } else {
      const token = this.progressionManager?.getToken();
      this.networkClient.connect(null, token);
      const onOpen = () => {
        this.networkClient.off('open', onOpen);
        doLaunch();
      };
      this.networkClient.on('open', onOpen);
    }
  }

  startGameLoop() {
    this.stopGameLoop({ keepOverlayHidden: true });
    this.gameLoopActive = true;
    if (this.gameIdleOverlay) {
      this.gameIdleOverlay.style.display = 'none';
    }
    this.lastFrameTime = performance.now();

    const loop = (now) => {
      if (!this.gameLoopActive) return;

      // Calculate real elapsed frame delta (seconds)
      const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;

      // 1. Obtain predicted local player for screen aiming
      const localPlayerPredicted = this.networkClient.getLocalPredictedPlayer();
      const playerScreenPos = this.gameRenderer?.getLocalPlayerScreenPosition(localPlayerPredicted)
        || { x: 400, y: 400 };

      // 2. Poll input and send to network client (freeze inputs when match concludes)
      if (!this.isMatchOver) {
        const input = this.inputManager.pollInput(playerScreenPos.x, playerScreenPos.y);
        const isDead = localPlayerPredicted && (localPlayerPredicted.isAlive === false || (localPlayerPredicted.hp !== undefined && localPlayerPredicted.hp <= 0));
        if (isDead) {
          input.moveX = 0;
          input.moveY = 0;
          input.firing = false;
          input.sprint = false;
          input.ability = false;
          input.reload = false;
          input.aimAngle = this.lastDeathAngle ?? localPlayerPredicted.angle ?? 0;
        } else if (localPlayerPredicted) {
          this.lastDeathAngle = localPlayerPredicted.angle;
        }

        if (this.networkClient.isConnected) {
          this.networkClient.sendInput(input);
        }
      }

      // 3. Obtain interpolated states (local player at predicted pos, remote players interpolated)
      const state = this.networkClient.getInterpolatedState();
      const localPlayer = state.localPlayer || localPlayerPredicted;

      // 4. Update renderer (camera tracking, acoustic wave decay, HUD gauge updates)
      if (this.gameRenderer) {
        this.gameRenderer.update(dt, {
          localPlayer,
          players: state.players,
          soundEvents: state.soundEvents
        });

        // 5. Render frame using canonical options object
        this.gameRenderer.render({
          ...state,
          localPlayer
        });
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  stopGameLoop(options = {}) {
    this.gameLoopActive = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (!options?.keepOverlayHidden && this.gameIdleOverlay && this.currentView === 'game' && !this.isMatchOver && !this.activeMatchMap) {
      this.gameIdleOverlay.style.display = 'flex';
    }
  }

  handleMatchOver(outcome) {
    this.isMatchOver = true;
    const isWinner = outcome.winnerId && outcome.winnerId === this.localPlayerId;

    if (outcome.results && Array.isArray(outcome.results)) {
      const myResult = outcome.results.find(r => r.playerId === this.localPlayerId);
      if (myResult && this.progressionManager) {
        this.progressionManager.addRewards(myResult);
      }
    } else if (this.progressionManager) {
      const fallbackRewards = {
        xp: isWinner ? 200 : 80,
        scrap: isWinner ? 100 : 35,
        cores: isWinner ? 1 : 0
      };
      this.progressionManager.addRewards(fallbackRewards);
    }

    if (this.gameRenderer) {
      this.gameRenderer.setMatchOutcome(outcome);
      if (isWinner) {
        this.gameRenderer.addNotification('★ ПЕРЕМОГА: Ви вижили в горнилі!', { type: 'kill', color: '#ffcf48', duration: 4.5 });
      } else if (outcome.draw) {
        this.gameRenderer.addNotification('⚔ НІЧИЯ: Взаємна ліквідація', { type: 'warn', color: '#ff9f1c', duration: 4.5 });
      } else {
        this.gameRenderer.addNotification('☠ ПОРАЗКА: Вас ліквідовано', { type: 'death', color: '#e71d36', duration: 4.5 });
      }
    }
  }

  restartCurrentMatch() {
    this.isMatchOver = false;
    if (this.gameRenderer) {
      this.gameRenderer.clearMatchOutcome();
      this.gameRenderer.clearWrecks();
    }
    const map = this.activeMatchMap || this.getSelectedHeroMap() || createDefaultMap();
    if (this.heroMode === 'solo' || !this.networkClient.roomId || this.networkClient.roomId.startsWith('solo_')) {
      this.launchSoloTraining(map);
    } else {
      this.launchMatchWithMap(map);
    }
  }

  returnToLobbyFromMatch() {
    if (this.soloWarmupTimer) {
      clearTimeout(this.soloWarmupTimer);
      this.soloWarmupTimer = null;
    }
    if (this.gameLoadingOverlay) {
      this.gameLoadingOverlay.style.display = 'none';
    }
    this.resetHeroPlayButton();
    this.isMatchOver = false;
    this.activeMatchMap = null;
    if (this.gameRenderer) {
      this.gameRenderer.clearMatchOutcome();
      this.gameRenderer.clearWrecks();
    }
    this.stopGameLoop({ keepOverlayHidden: true });
    this.switchView('lobby');
  }

  handleElimination(payload) {
    if (!payload) return;
    const { victimId, killerId, victimName, killerName, respawnTimer } = payload;
    const isVictimLocal = victimId === this.localPlayerId;
    const isKillerLocal = killerId === this.localPlayerId;

    if (this.gameRenderer) {
      const state = this.networkClient.getInterpolatedState();
      this.gameRenderer.registerWreckById(victimId, state?.players || []);
    }

    const vName = victimName || (isVictimLocal ? 'Вас' : 'Бійця');
    const kName = killerName || (isKillerLocal ? 'Ви' : 'Супротивник');

    if (isVictimLocal) {
      const isRespawn = typeof respawnTimer === 'number' && respawnTimer > 0;
      const text = isRespawn
        ? `☠ Вас ліквідував ${kName}! Відродження через 3с...`
        : `☠ Вас ліквідував ${kName}! (Ви вибули з бою)`;
      this.gameRenderer?.addNotification(text, { type: 'death', color: '#ff4d4d', duration: 4.5 });
    } else if (isKillerLocal) {
      this.gameRenderer?.addNotification(`⚡ Ви ліквідували ${vName}! (+XP, +Scrap)`, { type: 'kill', color: '#ffcf48', duration: 3.5 });
    } else {
      this.gameRenderer?.addNotification(`☠ ${kName} ліквідував ${vName}`, { type: 'info', color: '#cbd5e1', duration: 3.0 });
    }
  }

  handleDamage(payload) {
    if (!payload) return;
    if (payload.targetId === this.localPlayerId && payload.remainingHp <= 30 && payload.remainingHp > 0) {
      this.gameRenderer?.addNotification('⚠️ Критичний рівень пари та тиску!', { type: 'warn', color: '#ff9f1c', duration: 2.0 });
    }
  }

  /**
   * Checks window URL search params for direct room invitation (e.g. ?room=Sector_Omega).
   * Automatically configures inputs, transitions to lobby, and joins the chamber.
   */
  checkUrlInvitation() {
    if (typeof window === 'undefined' || !window.location) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view') || (window.location.hash ? window.location.hash.replace('#', '') : null);
      if (viewParam && ['home', 'lobby', 'editor', 'workshop', 'game'].includes(viewParam)) {
        this.switchView(viewParam);
      }

      const room = params.get('room');
      const pwd = params.get('pwd') || params.get('password');
      if (room && room.trim()) {
        const cleanRoom = room.trim();
        const cleanPwd = pwd ? pwd.trim() : null;
        if (this.homeRoomInput) this.homeRoomInput.value = cleanRoom;
        if (this.lobbyUI?.dom?.roomInput) this.lobbyUI.dom.roomInput.value = cleanRoom;
        if (cleanPwd) {
          if (this.lobbyUI?.dom?.roomPasswordInput) this.lobbyUI.dom.roomPasswordInput.value = cleanPwd;
          const homePwdInput = document.getElementById('homeRoomPasswordInput');
          if (homePwdInput) homePwdInput.value = cleanPwd;
        }

        this.heroMode = 'online';
        if (this.btnModeOnline) this.btnModeOnline.classList.add('active');
        if (this.btnModeSolo) this.btnModeSolo.classList.remove('active');
        if (this.homeRoomField) this.homeRoomField.style.display = 'flex';

        this.switchView('lobby');
        if (this.lobbyUI) {
          this.lobbyUI.handleJoinRoom(cleanRoom, cleanPwd);
          this.lobbyUI.showCopyToast(`Знайдено запрошення в кімнату "${cleanRoom}"!`);
        }
      }
    } catch (err) {
      console.warn('Failed to parse room invitation from URL:', err);
    }
  }
}

function bootstrapApp() {
  if (typeof window !== 'undefined' && !window.app) {
    try {
      window.app = new App();
      console.log('[Clockwork Echo] Client initialized successfully.');
    } catch (err) {
      console.error('[Clockwork Echo] App initialization failed:', err);
    }
  }
}

// Auto-instantiate: handle both pending and already-loaded DOM states
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrapApp);
  } else {
    bootstrapApp();
  }
}

export default App;
