/**
 * Steampunk Tactical Lobby UI Controller
 * Manages player nicknames, room selection, custom map integration, player roster,
 * ready states, and match launch transition.
 */

import { createDefaultMap, deserializeMap, PRESET_MAPS, getPresetMap } from '../../../shared/MapSchema.js';
import { STORAGE_KEY_CUSTOM_MAP } from '../../../shared/Constants.js';
import { getEmblemDefinition } from '../../../shared/ProgressionSchema.js';

export class LobbyUI {
  /**
   * @param {Object} networkClient - Instance of NetworkClient
   * @param {Object} [options]
   * @param {Function} [options.onMatchStart]
   * @param {Function} [options.onRequestCustomMap]
   */
  constructor(networkClient, options = {}) {
    this.networkClient = networkClient;
    this.options = options;
    this.onMatchStart = options.onMatchStart || null;

    this.currentLobbyState = null;
    this.isReady = false;
    this.roomsPollInterval = null;
    this._copyToastTimer = null;
    this.publishedCommunityMaps = new Map();

    this.bindDom();
    this.initProfileSync();
    this.attachEvents();
    this.bindNetworkEvents();
    this.populateMapList();
    this.fetchCommunityMaps();
    this.fetchAndRenderRooms();
    this.startRoomsPoll();
  }

  initProfileSync() {
    if (this.options.progressionManager) {
      const sync = () => {
        const prof = this.options.progressionManager.getProfile();
        if (prof?.username && this.dom.playerNameInput) {
          if (!this.dom.playerNameInput.value || this.dom.playerNameInput.value === 'FoundryRanger_1') {
            this.dom.playerNameInput.value = prof.username;
          }
        }
      };
      sync();
      this.options.progressionManager.on('profileUpdated', sync);
    }
  }

  bindDom() {
    this.dom = {
      playerNameInput: document.getElementById('playerNameInput'),
      roomInput: document.getElementById('roomInput'),
      btnJoinRoom: document.getElementById('btnJoinRoom'),
      btnCreateRoom: document.getElementById('btnCreateRoom'),
      btnToggleReady: document.getElementById('btnToggleReady'),
      btnStartMatch: document.getElementById('btnStartMatch'),
      btnQuickPlay: document.getElementById('btnQuickPlay'),
      btnEnterEditor: document.getElementById('btnEnterEditor'),
      lobbyStatusCard: document.getElementById('lobbyStatusCard'),
      lobbyRoomTitle: document.getElementById('lobbyRoomTitle'),
      lobbyMapTitle: document.getElementById('lobbyMapTitle'),
      lobbyModeBadge: document.getElementById('lobbyModeBadge'),
      lobbyPlayerList: document.getElementById('lobbyPlayerList'),
      lobbyErrorMsg: document.getElementById('lobbyErrorMsg'),
      lobbyPingBadge: document.getElementById('lobbyPingBadge'),
      lobbyMapSelect: document.getElementById('lobbyMapSelect'),
      homeMapSelect: document.getElementById('homeMapSelect'),
      lobbyGameModeSelect: document.getElementById('lobbyGameModeSelect'),
      lobbyTargetKillsGroup: document.getElementById('lobbyTargetKillsGroup'),
      lobbyTargetKillsInput: document.getElementById('lobbyTargetKillsInput'),
      lobbyTargetKillsSelect: document.getElementById('lobbyTargetKillsSelect'),
      lobbyHostConfigRow: document.getElementById('lobbyHostConfigRow'),
      roomActiveTargetKillsInput: document.getElementById('roomActiveTargetKillsInput'),
      btnUpdateRoomTargetKills: document.getElementById('btnUpdateRoomTargetKills'),
      lobbyTeamSelectGroup: document.getElementById('lobbyTeamSelectGroup'),
      btnSelectTeam1: document.getElementById('btnSelectTeam1'),
      btnSelectTeam2: document.getElementById('btnSelectTeam2'),
      homeGameModeSelect: document.getElementById('homeGameModeSelect'),
      homeTargetKillsGroup: document.getElementById('homeTargetKillsGroup'),
      homeTargetKillsInput: document.getElementById('homeTargetKillsInput'),
      homeTargetKillsSelect: document.getElementById('homeTargetKillsSelect'),
      btnCopyRoomCode: document.getElementById('btnCopyRoomCode'),
      btnCopyRoomLink: document.getElementById('btnCopyRoomLink'),
      lobbyCopyToast: document.getElementById('lobbyCopyToast'),
      btnLobbyRefreshRooms: document.getElementById('btnLobbyRefreshRooms'),
      lobbyRoomsList: document.getElementById('lobbyRoomsList'),
      homeRoomsList: document.getElementById('homeRoomsList'),
      btnHomeRefreshRooms: document.getElementById('btnHomeRefreshRooms'),
      btnHomeJoinRoom: document.getElementById('btnHomeJoinRoom'),
      btnHomeCreateRoom: document.getElementById('btnHomeCreateRoom'),
      roomPasswordInput: document.getElementById('roomPasswordInput'),
      homeRoomPasswordInput: document.getElementById('homeRoomPasswordInput'),
      lobbyLockBadge: document.getElementById('lobbyLockBadge'),
      homeBotFillSelect: document.getElementById('homeBotFillSelect'),
      homeBotDifficultySelect: document.getElementById('homeBotDifficultySelect'),
      lobbyBotFillSelect: document.getElementById('lobbyBotFillSelect'),
      lobbyBotDifficultySelect: document.getElementById('lobbyBotDifficultySelect'),
      roomActiveBotFillSelect: document.getElementById('roomActiveBotFillSelect'),
      roomActiveBotDifficultySelect: document.getElementById('roomActiveBotDifficultySelect'),
      lobbyBotBadge: document.getElementById('lobbyBotBadge')
    };
  }

  addTapAndClick(el, handler) {
    if (!el) return;
    const fn = (e) => {
      if (e && e.type === 'touchend') {
        e.preventDefault();
      }
      handler(e);
    };
    el.addEventListener('click', fn);
    el.addEventListener('touchend', fn, { passive: false });
  }

  attachEvents() {
    this.addTapAndClick(this.dom.btnJoinRoom, () => this.handleJoinRoom());
    this.addTapAndClick(this.dom.btnCreateRoom, () => this.handleCreateRoom());
    this.addTapAndClick(this.dom.btnToggleReady, () => this.handleToggleReady());
    this.addTapAndClick(this.dom.btnStartMatch, () => this.handleStartMatch());
    this.addTapAndClick(this.dom.btnCopyRoomCode, () => this.handleCopyRoomCode());
    this.addTapAndClick(this.dom.btnCopyRoomLink, () => this.handleCopyRoomLink());
    this.addTapAndClick(this.dom.btnLobbyRefreshRooms, () => this.fetchAndRenderRooms());
    this.addTapAndClick(this.dom.btnHomeRefreshRooms, () => this.fetchAndRenderRooms());

    // Host live room config update button
    this.addTapAndClick(this.dom.btnUpdateRoomTargetKills, () => {
      if (this.currentLobbyState && this.isHost()) {
        const mode = this.currentLobbyState.gameMode || 'ffa_dm';
        const val = parseInt(this.dom.roomActiveTargetKillsInput?.value || 30, 10);
        const targetKills = Number.isFinite(val) && val > 0 ? val : 30;
        const fillWithBots = this.dom.roomActiveBotFillSelect ? (this.dom.roomActiveBotFillSelect.value === 'true') : true;
        const botDifficulty = this.dom.roomActiveBotDifficultySelect ? this.dom.roomActiveBotDifficultySelect.value : 'normal';
        this.networkClient.changeGameMode(mode, targetKills, fillWithBots, botDifficulty);
      }
    });

    // Sync Home & Lobby Bot Selects
    if (this.dom.homeBotFillSelect) {
      this.dom.homeBotFillSelect.addEventListener('change', () => {
        const val = this.dom.homeBotFillSelect.value;
        if (this.dom.lobbyBotFillSelect) this.dom.lobbyBotFillSelect.value = val;
        const diffWrap = document.getElementById('homeBotDifficultyWrapper');
        if (diffWrap) diffWrap.style.display = val === 'false' ? 'none' : 'block';
      });
    }
    if (this.dom.lobbyBotFillSelect) {
      this.dom.lobbyBotFillSelect.addEventListener('change', () => {
        const val = this.dom.lobbyBotFillSelect.value;
        if (this.dom.homeBotFillSelect) this.dom.homeBotFillSelect.value = val;
        const diffWrap = document.getElementById('lobbyBotDifficultyWrapper');
        if (diffWrap) diffWrap.style.display = val === 'false' ? 'none' : 'block';
      });
    }
    if (this.dom.homeBotDifficultySelect) {
      this.dom.homeBotDifficultySelect.addEventListener('change', () => {
        const val = this.dom.homeBotDifficultySelect.value;
        if (this.dom.lobbyBotDifficultySelect) this.dom.lobbyBotDifficultySelect.value = val;
      });
    }
    if (this.dom.lobbyBotDifficultySelect) {
      this.dom.lobbyBotDifficultySelect.addEventListener('change', () => {
        const val = this.dom.lobbyBotDifficultySelect.value;
        if (this.dom.homeBotDifficultySelect) this.dom.homeBotDifficultySelect.value = val;
      });
    }

    // Sync Home & Lobby Map Selects
    if (this.dom.homeMapSelect) {
      this.dom.homeMapSelect.addEventListener('change', () => {
        const val = this.dom.homeMapSelect.value;
        if (this.dom.lobbyMapSelect) this.dom.lobbyMapSelect.value = val;
      });
    }
    if (this.dom.lobbyMapSelect) {
      this.dom.lobbyMapSelect.addEventListener('change', () => {
        const val = this.dom.lobbyMapSelect.value;
        if (this.dom.homeMapSelect) this.dom.homeMapSelect.value = val;
      });
    }

    // Sync Home mode select
    if (this.dom.homeGameModeSelect) {
      this.dom.homeGameModeSelect.addEventListener('change', () => {
        const mode = this.dom.homeGameModeSelect.value;
        const isDm = mode === 'ffa_dm' || mode === 'team_dm';
        if (this.dom.homeTargetKillsGroup) {
          this.dom.homeTargetKillsGroup.style.display = isDm ? 'flex' : 'none';
        }
        if (this.dom.lobbyGameModeSelect) {
          this.dom.lobbyGameModeSelect.value = mode;
          if (this.dom.lobbyTargetKillsGroup) {
            this.dom.lobbyTargetKillsGroup.style.display = isDm ? 'block' : 'none';
          }
        }
      });
    }

    // Sync Home Target Kills Select & Input
    if (this.dom.homeTargetKillsSelect) {
      this.dom.homeTargetKillsSelect.addEventListener('change', () => {
        const val = this.dom.homeTargetKillsSelect.value;
        if (this.dom.homeTargetKillsInput) this.dom.homeTargetKillsInput.value = val;
        if (this.dom.lobbyTargetKillsInput) this.dom.lobbyTargetKillsInput.value = val;
        if (this.dom.lobbyTargetKillsSelect) this.dom.lobbyTargetKillsSelect.value = val;
      });
    }
    if (this.dom.homeTargetKillsInput) {
      this.dom.homeTargetKillsInput.addEventListener('input', () => {
        const val = this.dom.homeTargetKillsInput.value;
        if (this.dom.lobbyTargetKillsInput) this.dom.lobbyTargetKillsInput.value = val;
      });
    }

    // Sync Lobby Target Kills Select & Input
    if (this.dom.lobbyTargetKillsSelect) {
      this.dom.lobbyTargetKillsSelect.addEventListener('change', () => {
        const val = this.dom.lobbyTargetKillsSelect.value;
        if (this.dom.lobbyTargetKillsInput) this.dom.lobbyTargetKillsInput.value = val;
        if (this.dom.homeTargetKillsInput) this.dom.homeTargetKillsInput.value = val;
        if (this.dom.homeTargetKillsSelect) this.dom.homeTargetKillsSelect.value = val;
        if (this.currentLobbyState && this.isHost()) {
          const mode = this.dom.lobbyGameModeSelect?.value || 'ffa_dm';
          const targetKills = parseInt(val, 10);
          this.networkClient.changeGameMode(mode, targetKills);
        }
      });
    }

    if (this.dom.lobbyTargetKillsInput) {
      this.dom.lobbyTargetKillsInput.addEventListener('input', () => {
        const val = this.dom.lobbyTargetKillsInput.value;
        if (this.dom.homeTargetKillsInput) this.dom.homeTargetKillsInput.value = val;
      });
      this.dom.lobbyTargetKillsInput.addEventListener('change', () => {
        if (this.currentLobbyState && this.isHost()) {
          const mode = this.dom.lobbyGameModeSelect?.value || 'ffa_dm';
          const val = parseInt(this.dom.lobbyTargetKillsInput.value || 30, 10);
          const targetKills = Number.isFinite(val) && val > 0 ? val : 30;
          this.networkClient.changeGameMode(mode, targetKills);
        }
      });
    }

    if (this.dom.lobbyGameModeSelect) {
      this.dom.lobbyGameModeSelect.addEventListener('change', () => {
        const mode = this.dom.lobbyGameModeSelect.value;
        const isDm = mode === 'ffa_dm' || mode === 'team_dm';
        if (this.dom.homeGameModeSelect) {
          this.dom.homeGameModeSelect.value = mode;
        }
        if (this.dom.homeTargetKillsGroup) {
          this.dom.homeTargetKillsGroup.style.display = isDm ? 'flex' : 'none';
        }
        if (this.dom.lobbyTargetKillsGroup) {
          this.dom.lobbyTargetKillsGroup.style.display = isDm ? 'block' : 'none';
        }
        if (this.currentLobbyState && this.isHost()) {
          const val = parseInt(this.dom.lobbyTargetKillsInput?.value || 30, 10);
          const targetKills = isDm ? (Number.isFinite(val) && val > 0 ? val : 30) : 0;
          this.networkClient.changeGameMode(mode, targetKills);
        }
      });
    }

    this.addTapAndClick(this.dom.btnSelectTeam1, () => {
      this.networkClient.changeTeam('team1');
    });

    this.addTapAndClick(this.dom.btnSelectTeam2, () => {
      this.networkClient.changeTeam('team2');
    });

    this.addTapAndClick(this.dom.btnHomeJoinRoom, () => {
      const homeInput = document.getElementById('homeRoomInput');
      const homePwdInput = this.dom.homeRoomPasswordInput || document.getElementById('homeRoomPasswordInput');
      const room = homeInput?.value?.trim() || 'Sector_Omega';
      const password = homePwdInput?.value?.trim() || null;
      this.handleJoinRoom(room, password);
      if (typeof this.options.onSwitchToLobby === 'function') {
        this.options.onSwitchToLobby();
      }
    });

    this.addTapAndClick(this.dom.btnHomeCreateRoom, () => {
      const homeInput = document.getElementById('homeRoomInput');
      const homePwdInput = this.dom.homeRoomPasswordInput || document.getElementById('homeRoomPasswordInput');
      const room = homeInput?.value?.trim() || 'Sector_Omega';
      const password = homePwdInput?.value?.trim() || null;
      this.handleCreateRoom(room, password);
      if (typeof this.options.onSwitchToLobby === 'function') {
        this.options.onSwitchToLobby();
      }
    });
  }

  bindNetworkEvents() {
    this.networkClient.on('open', () => {
      this.showError('');
      this.resetAllActionButtons();
      if (this.dom.lobbyPingBadge) {
        this.dom.lobbyPingBadge.textContent = 'Підключено';
        this.dom.lobbyPingBadge.style.color = 'var(--color-status-success)';
      }
      this.fetchAndRenderRooms();
    });

    this.networkClient.on('close', () => {
      this.resetAllActionButtons();
      if (this.dom.lobbyPingBadge) {
        this.dom.lobbyPingBadge.textContent = 'Відключено';
        this.dom.lobbyPingBadge.style.color = 'var(--color-status-danger)';
      }
    });

    this.networkClient.on('pong', ({ latency }) => {
      if (this.dom.lobbyPingBadge) {
        this.dom.lobbyPingBadge.textContent = `${latency}ms`;
        this.dom.lobbyPingBadge.style.color = latency < 80 ? 'var(--color-status-success)' : 'var(--color-status-warning)';
      }
    });

    this.networkClient.on('lobbyState', (state) => {
      this.resetAllActionButtons();
      this.renderLobbyState(state);
    });

    this.networkClient.on('roomsList', (rooms) => {
      this.renderRooms(rooms);
    });

    this.networkClient.on('matchInit', (matchInitPayload) => {
      this.resetAllActionButtons();
      this.stopRoomsPoll();
      if (typeof this.onMatchStart === 'function') {
        this.onMatchStart(matchInitPayload);
      }
    });

    this.networkClient.on('errorPacket', (errorPayload) => {
      this.resetAllActionButtons();
      this.showError(`${errorPayload.code || 'ПОМИЛКА'}: ${errorPayload.message || 'Дію відхилено сервером'}`);
      if (errorPayload.code === 'PASSWORD_REQUIRED' || errorPayload.code === 'INVALID_PASSWORD') {
        if (this.dom.roomPasswordInput) {
          this.dom.roomPasswordInput.style.borderColor = '#ff4757';
          this.dom.roomPasswordInput.focus();
          setTimeout(() => {
            if (this.dom.roomPasswordInput) this.dom.roomPasswordInput.style.borderColor = '';
          }, 3500);
        }
        if (this.dom.homeRoomPasswordInput) {
          this.dom.homeRoomPasswordInput.style.borderColor = '#ff4757';
          setTimeout(() => {
            if (this.dom.homeRoomPasswordInput) this.dom.homeRoomPasswordInput.style.borderColor = '';
          }, 3500);
        }
      }
    });
  }

  setButtonBusy(btn, busyText) {
    if (!btn) return;
    if (!btn._origText) btn._origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyText;
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
  }

  resetButtonBusy(btn, fallbackText = null) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = btn._origText || fallbackText || btn.textContent;
    btn.style.opacity = '1.0';
    btn.style.pointerEvents = 'auto';
    btn._origText = null;
  }

  resetAllActionButtons() {
    this.resetButtonBusy(this.dom.btnStartMatch, '⚔ Почати бій');
    this.resetButtonBusy(this.dom.btnCreateRoom, '⚙ Створити кімнату');
    this.resetButtonBusy(this.dom.btnHomeCreateRoom, '⚙ Створити');
    this.resetButtonBusy(this.dom.btnJoinRoom, '⚡ Приєднатися');
    this.resetButtonBusy(this.dom.btnHomeJoinRoom, '⚡ Приєднатися');
  }

  async fetchCommunityMaps() {
    try {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const apiBase = isLocal ? '' : 'https://steamstrike-server.onrender.com';
      const res = await fetch(`${apiBase}/api/community-maps/published`);
      if (res.ok) {
        const data = await res.json();
        if (data.maps && Array.isArray(data.maps)) {
          for (const m of data.maps) {
            this.publishedCommunityMaps.set(m.id, m.map);
          }
          this.populateMapList();
        }
      }
    } catch (_) {}
  }

  populateMapList() {
    const selects = [this.dom.lobbyMapSelect, this.dom.homeMapSelect].filter(Boolean);
    if (selects.length === 0) return;

    for (const select of selects) {
      const currentVal = select.value;
      select.innerHTML = '';

      for (const preset of PRESET_MAPS) {
        const opt = document.createElement('option');
        opt.value = preset.id;
        opt.textContent = `${preset.name}`;
        select.appendChild(opt);
      }

      // Look for maps saved in localStorage
      try {
        const savedMapRaw = localStorage.getItem(STORAGE_KEY_CUSTOM_MAP) || localStorage.getItem('steampunk_tactical_custom_map_v1') || localStorage.getItem('steampunk_tactical_custom_map');
        if (savedMapRaw) {
          const savedMap = JSON.parse(savedMapRaw);
          const opt = document.createElement('option');
          opt.value = '__saved__';
          opt.textContent = `🛠 Власна: ${savedMap.name || 'Saved Arena'} (${savedMap.width}x${savedMap.height})`;
          select.appendChild(opt);
        }
      } catch (_) {}

      // Approved community maps
      if (this.publishedCommunityMaps && this.publishedCommunityMaps.size > 0) {
        for (const [id, mapData] of this.publishedCommunityMaps.entries()) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = `🌟 Спільнота: ${mapData.name || 'Community Arena'} (${mapData.width || 20}x${mapData.height || 20})`;
          select.appendChild(opt);
        }
      }

      if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
      }
    }
  }

  getSelectedMap() {
    const val = this.dom.lobbyMapSelect ? this.dom.lobbyMapSelect.value : (this.dom.homeMapSelect ? this.dom.homeMapSelect.value : 'foundry');
    if (val === '__saved__') {
      try {
        const savedRaw = localStorage.getItem(STORAGE_KEY_CUSTOM_MAP) || localStorage.getItem('steampunk_tactical_custom_map_v1') || localStorage.getItem('steampunk_tactical_custom_map');
        if (savedRaw) return JSON.parse(savedRaw);
      } catch (_) {}
    }

    if (this.publishedCommunityMaps && this.publishedCommunityMaps.has(val)) {
      return this.publishedCommunityMaps.get(val);
    }

    const preset = getPresetMap(val);
    if (preset) return preset;

    if (this.options.onRequestCustomMap) {
      const activeMap = this.options.onRequestCustomMap();
      if (activeMap) return activeMap;
    }

    return createDefaultMap();
  }

  ensureConnected() {
    if (!this.networkClient.isSocketReady) {
      const token = this.options.progressionManager?.getToken ? this.options.progressionManager.getToken() : (this.options.progressionManager?.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('clockwork_auth_token_v1') : null));
      if (token && typeof window !== 'undefined' && window.location) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        this.networkClient.connect(`${protocol}//${host}/?token=${encodeURIComponent(token)}`);
      } else {
        this.networkClient.connect();
      }
    }
  }

  startRoomsPoll() {
    this.stopRoomsPoll();
    this.roomsPollInterval = setInterval(() => {
      if (typeof document !== 'undefined') {
        const activeView = document.querySelector('.view-container.active')?.id;
        if (activeView !== 'view-lobby' && activeView !== 'view-home') {
          return;
        }
      }
      this.fetchAndRenderRooms();
    }, 4000);
  }

  stopRoomsPoll() {
    if (this.roomsPollInterval) {
      clearInterval(this.roomsPollInterval);
      this.roomsPollInterval = null;
    }
  }

  async fetchAndRenderRooms() {
    try {
      const rooms = await this.networkClient.fetchRooms();
      this.renderRooms(rooms);
    } catch (_) {}
  }

  renderRooms(rooms = []) {
    const list = Array.isArray(rooms) ? rooms : [];
    const sig = JSON.stringify(list.map(r => `${r.id}:${r.playerCount}:${r.maxPlayers}:${r.state}:${r.mapName}:${r.isLocked}`));
    if (this._lastRoomsSig === sig) return;
    this._lastRoomsSig = sig;

    const containers = [
      this.dom.lobbyRoomsList,
      this.dom.homeRoomsList || document.getElementById('homeRoomsList')
    ];

    containers.forEach(container => {
      if (!container) return;
      container.innerHTML = '';

      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-rooms-msg';
        empty.textContent = 'Зараз немає відкритих кімнат. Створіть свою кімнату та запросіть друзів!';
        container.appendChild(empty);
        return;
      }

      list.forEach(room => {
        const card = this.buildRoomCard(room);
        container.appendChild(card);
      });
    });
  }

  buildRoomCard(room) {
    const card = document.createElement('div');
    card.className = 'room-card';

    const info = document.createElement('div');
    info.className = 'room-card-info';

    const isLocked = Boolean(room.isLocked || room.hasPassword);
    const name = document.createElement('div');
    name.className = 'room-card-name';
    if (isLocked) {
      name.innerHTML = `⚙ ${room.id} <span title="Захищено кодовим шифром" style="color: #ff6b81; font-size: 13px; margin-left: 4px;">🔒</span>`;
    } else {
      name.textContent = `⚙ ${room.id}`;
    }

    const sub = document.createElement('div');
    sub.className = 'room-card-sub';
    const lockNote = isLocked ? '<span style="color: #ff6b81; font-size: 11px;">🔒 Пароль</span>' : '';
    sub.innerHTML = `<span>🗺️ ${room.mapName || 'Стандартна арена'}</span><span>👥 ${room.playerCount}/${room.maxPlayers}</span>${lockNote}`;

    info.appendChild(name);
    info.appendChild(sub);

    const rightSide = document.createElement('div');
    rightSide.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const badge = document.createElement('span');
    badge.className = 'room-badge';

    const isInProgress = room.state === 'IN_PROGRESS';
    const isFull = room.playerCount >= room.maxPlayers;
    const isCurrent = this.currentLobbyState && this.currentLobbyState.roomId === room.id;

    if (isInProgress) {
      badge.classList.add('battle');
      badge.textContent = 'У БОЮ';
    } else if (isFull) {
      badge.classList.add('full');
      badge.textContent = 'ЗАПОВНЕНО';
    } else {
      badge.classList.add('open');
      badge.textContent = 'В ЛОБІ';
    }
    rightSide.appendChild(badge);

    const btn = document.createElement('button');
    btn.type = 'button';

    if (isCurrent) {
      btn.className = 'btn-steampunk btn-copper';
      btn.style.cssText = 'font-size: 11px; padding: 4px 8px;';
      btn.textContent = 'Ви тут ✓';
      btn.disabled = true;
    } else if (isInProgress) {
      btn.className = 'btn-steampunk btn-iron';
      btn.style.cssText = 'font-size: 11px; padding: 4px 8px; opacity: 0.6;';
      btn.textContent = 'Бій іде';
      btn.disabled = true;
    } else if (isFull) {
      btn.className = 'btn-steampunk btn-iron';
      btn.style.cssText = 'font-size: 11px; padding: 4px 8px; opacity: 0.6;';
      btn.textContent = 'Заповнено';
      btn.disabled = true;
    } else {
      btn.className = 'btn-steampunk btn-brass';
      btn.style.cssText = 'font-size: 11px; padding: 4px 10px; cursor: pointer;';
      btn.textContent = isLocked ? '🔒 Приєднатися' : '⚡ Приєднатися';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        let pass = (this.dom.roomPasswordInput?.value || this.dom.homeRoomPasswordInput?.value || '').trim();
        if (isLocked && !pass) {
          const promptVal = window.prompt(`Введіть шифр доступу для парової кімнати "${room.id}":`);
          if (promptVal === null) return;
          pass = promptVal.trim();
          if (this.dom.roomPasswordInput) this.dom.roomPasswordInput.value = pass;
          if (this.dom.homeRoomPasswordInput) this.dom.homeRoomPasswordInput.value = pass;
        }
        this.handleJoinRoom(room.id, pass);
        if (typeof this.options.onSwitchToLobby === 'function') {
          this.options.onSwitchToLobby();
        }
      });
    }

    rightSide.appendChild(btn);
    card.appendChild(info);
    card.appendChild(rightSide);

    return card;
  }

  handleCopyRoomCode() {
    const roomId = this.currentLobbyState?.roomId || this.dom.roomInput?.value || 'Sector_Omega';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(roomId).then(() => {
        this.showCopyToast('Код кімнати скопійовано! ✓');
      }).catch(() => {
        this.showCopyToast(`Код: ${roomId}`);
      });
    } else {
      this.showCopyToast(`Код: ${roomId}`);
    }
  }

  handleCopyRoomLink() {
    const roomId = this.currentLobbyState?.roomId || this.dom.roomInput?.value || 'Sector_Omega';
    let url = roomId;
    if (typeof window !== 'undefined' && window.location) {
      let pwdParam = '';
      const pwd = (this.dom.roomPasswordInput?.value || this.dom.homeRoomPasswordInput?.value || document.getElementById('homeRoomPasswordInput')?.value || '').trim();
      if (pwd) {
        pwdParam = `&pwd=${encodeURIComponent(pwd)}`;
      }
      url = `${window.location.origin}/?room=${encodeURIComponent(roomId)}${pwdParam}`;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showCopyToast('Посилання для друга скопійовано! ✓');
      }).catch(() => {
        this.showCopyToast(url);
      });
    } else {
      this.showCopyToast(url);
    }
  }

  showCopyToast(msg) {
    if (this.dom.lobbyCopyToast) {
      this.dom.lobbyCopyToast.textContent = msg;
      this.dom.lobbyCopyToast.style.display = 'block';
      clearTimeout(this._copyToastTimer);
      this._copyToastTimer = setTimeout(() => {
        if (this.dom.lobbyCopyToast) {
          this.dom.lobbyCopyToast.style.display = 'none';
        }
      }, 2500);
    }
  }

  handleJoinRoom(targetRoomId = null, candidatePassword = null) {
    if (typeof this.options.onSwitchToLobby === 'function') {
      this.options.onSwitchToLobby();
    }

    const homeInput = document.getElementById('homeRoomInput');
    const homePlayerInput = document.getElementById('homePlayerNameInput');
    const homePwdInput = this.dom.homeRoomPasswordInput || document.getElementById('homeRoomPasswordInput');

    let roomId = (targetRoomId || this.dom.roomInput?.value || homeInput?.value || 'Sector_Omega').trim();
    if (!roomId) roomId = 'Sector_Omega';
    if (this.dom.roomInput) this.dom.roomInput.value = roomId;
    if (homeInput) homeInput.value = roomId;

    let password = (candidatePassword !== null ? candidatePassword : (this.dom.roomPasswordInput?.value || homePwdInput?.value || '')).trim();
    if (this.dom.roomPasswordInput && candidatePassword !== null) this.dom.roomPasswordInput.value = password;
    if (homePwdInput && candidatePassword !== null) homePwdInput.value = password;

    const playerName = (this.dom.playerNameInput?.value || homePlayerInput?.value || 'FoundryRanger_1').trim();
    if (this.dom.playerNameInput) this.dom.playerNameInput.value = playerName;
    if (homePlayerInput) homePlayerInput.value = playerName;

    this.showError('');
    this.setButtonBusy(this.dom.btnJoinRoom, '⚡ Приєднання...');
    this.setButtonBusy(this.dom.btnHomeJoinRoom, '⚡ Приєднання...');

    const doJoin = () => {
      const prof = this.options.progressionManager?.getProfile();
      if (prof) {
        this.networkClient.setLoadout({
          weaponId: prof.equippedWeapon,
          classId: prof.equippedClass,
          profile: prof
        });
      }
      this.networkClient.joinLobby(roomId, playerName, {
        equippedWeapon: prof?.equippedWeapon || 'revolver',
        equippedClass: prof?.equippedClass || 'vanguard',
        profile: prof,
        password: password || null
      });
    };

    if (this.networkClient.isSocketReady) {
      doJoin();
    } else {
      this.showError('Підключення до парового сервера...');
      this.ensureConnected();

      let timeoutTimer = null;
      const onOpen = () => {
        clearTimeout(timeoutTimer);
        this.networkClient.off('open', onOpen);
        this.showError('');
        doJoin();
      };

      timeoutTimer = setTimeout(() => {
        this.networkClient.off('open', onOpen);
        this.resetAllActionButtons();
        this.showError('Не вдалося з\'єднатися з паровим сервером. Перевірте статус сервера.');
      }, 5000);

      this.networkClient.on('open', onOpen);
    }
  }

  isHost() {
    const myId = this.networkClient.playerId || this.currentLobbyState?.yourPlayerId;
    return Boolean(this.currentLobbyState?.hostId && (this.currentLobbyState.hostId === myId || this.currentLobbyState.players?.find(p => p.id === myId)?.isHost));
  }

  handleCreateRoom(targetRoomId = null, candidatePassword = null) {
    if (typeof this.options.onSwitchToLobby === 'function') {
      this.options.onSwitchToLobby();
    }

    const homeInput = document.getElementById('homeRoomInput');
    const homePlayerInput = document.getElementById('homePlayerNameInput');
    const homeModeSelect = document.getElementById('homeGameModeSelect');
    const homePwdInput = this.dom.homeRoomPasswordInput || document.getElementById('homeRoomPasswordInput');

    let roomId = (targetRoomId || this.dom.roomInput?.value || homeInput?.value || '').trim();
    if (!roomId) {
      roomId = `Sector_${Math.floor(1000 + Math.random() * 9000)}`;
    }
    if (this.dom.roomInput) this.dom.roomInput.value = roomId;
    if (homeInput) homeInput.value = roomId;

    let password = (candidatePassword !== null ? candidatePassword : (this.dom.roomPasswordInput?.value || homePwdInput?.value || '')).trim();
    if (this.dom.roomPasswordInput && candidatePassword !== null) this.dom.roomPasswordInput.value = password;
    if (homePwdInput && candidatePassword !== null) homePwdInput.value = password;

    const playerName = (this.dom.playerNameInput?.value || homePlayerInput?.value || 'HostEngineer').trim();
    if (this.dom.playerNameInput) this.dom.playerNameInput.value = playerName;
    if (homePlayerInput) homePlayerInput.value = playerName;

    const selectedMap = this.getSelectedMap();

    const isHomeContext = (typeof window !== 'undefined' && window.app && window.app.currentView === 'home');
    const gameMode = isHomeContext
      ? (homeModeSelect?.value || this.dom.lobbyGameModeSelect?.value || 'ffa_dm')
      : (this.dom.lobbyGameModeSelect?.value || homeModeSelect?.value || 'ffa_dm');
    if (this.dom.lobbyGameModeSelect) this.dom.lobbyGameModeSelect.value = gameMode;
    if (homeModeSelect) homeModeSelect.value = gameMode;

    const fillWithBots = isHomeContext
      ? (this.dom.homeBotFillSelect?.value !== 'false')
      : (this.dom.lobbyBotFillSelect?.value !== 'false');
    const botDifficulty = isHomeContext
      ? (this.dom.homeBotDifficultySelect?.value || 'normal')
      : (this.dom.lobbyBotDifficultySelect?.value || 'normal');

    const isDm = gameMode === 'ffa_dm' || gameMode === 'team_dm';
    let targetKills = 30;
    if (isHomeContext) {
      const val = parseInt(this.dom.homeTargetKillsInput?.value || this.dom.homeTargetKillsSelect?.value, 10);
      if (Number.isFinite(val) && val > 0) targetKills = val;
    } else {
      const val = parseInt(this.dom.lobbyTargetKillsInput?.value || this.dom.lobbyTargetKillsSelect?.value, 10);
      if (Number.isFinite(val) && val > 0) targetKills = val;
    }
    if (!isDm) targetKills = 0;

    this.showError('');
    this.setButtonBusy(this.dom.btnCreateRoom, '⚙ Створення...');
    this.setButtonBusy(this.dom.btnHomeCreateRoom, '⚙ Створення...');

    const doCreate = () => {
      const prof = this.options.progressionManager?.getProfile();
      if (prof) {
        this.networkClient.setLoadout({
          weaponId: prof.equippedWeapon,
          classId: prof.equippedClass,
          profile: prof
        });
      }
      this.networkClient.createLobby({
        roomId,
        playerName,
        mapName: selectedMap.name || 'The Clockwork Foundry',
        maxPlayers: 4,
        map: selectedMap,
        gameMode,
        targetKills,
        fillWithBots,
        botDifficulty,
        equippedWeapon: prof?.equippedWeapon || 'revolver',
        equippedClass: prof?.equippedClass || 'vanguard',
        profile: prof,
        password: password || null
      });
    };

    if (this.networkClient.isSocketReady) {
      doCreate();
    } else {
      this.showError('Підключення до парового сервера...');
      this.ensureConnected();

      let timeoutTimer = null;
      const onOpen = () => {
        clearTimeout(timeoutTimer);
        this.networkClient.off('open', onOpen);
        this.showError('');
        doCreate();
      };

      timeoutTimer = setTimeout(() => {
        this.networkClient.off('open', onOpen);
        this.resetAllActionButtons();
        this.showError('Не вдалося з\'єднатися з паровим сервером. Перевірте статус сервера.');
      }, 5000);

      this.networkClient.on('open', onOpen);
    }
  }

  handleToggleReady() {
    this.isReady = !this.isReady;
    this.networkClient.setReady(this.isReady);
    if (this.dom.btnToggleReady) {
      this.dom.btnToggleReady.textContent = this.isReady ? 'Скасувати готовність' : 'Готовий';
      this.dom.btnToggleReady.className = this.isReady ? 'btn-steampunk btn-copper' : 'btn-steampunk btn-iron';
    }
  }

  handleStartMatch() {
    if (this.dom.btnStartMatch) {
      this.setButtonBusy(this.dom.btnStartMatch, '⚙ Запуск бою...');
    }
    if (typeof this.options.onRequestLandscape === 'function') {
      this.options.onRequestLandscape();
    }
    const fillBots = this.currentLobbyState?.fillWithBots !== undefined
      ? Boolean(this.currentLobbyState.fillWithBots)
      : (this.dom.lobbyBotFillSelect?.value !== 'false');
    const botDifficulty = this.currentLobbyState?.botDifficulty || this.dom.lobbyBotDifficultySelect?.value || 'normal';
    this.networkClient.startMatch({ fillBots, botDifficulty });
  }

  renderLobbyState(state) {
    this.currentLobbyState = state;

    if (this.dom.lobbyStatusCard) {
      this.dom.lobbyStatusCard.style.display = 'block';
    }

    if (this.dom.lobbyRoomTitle) {
      this.dom.lobbyRoomTitle.textContent = state.roomId || 'Chamber';
    }

    if (this.dom.lobbyMapTitle) {
      this.dom.lobbyMapTitle.textContent = state.mapName || 'The Clockwork Foundry';
    }

    if (this.dom.lobbyLockBadge) {
      this.dom.lobbyLockBadge.style.display = (state.isLocked || state.hasPassword) ? 'inline-block' : 'none';
    }

    // Update Bot Badge
    if (this.dom.lobbyBotBadge) {
      const hasBots = state.fillWithBots !== false;
      const diffMap = {
        easy: 'Рекрут',
        normal: 'Ветеран',
        hard: 'Еліта',
        nightmare: 'Титан'
      };
      const diffName = diffMap[state.botDifficulty || 'normal'] || 'Ветеран';
      if (hasBots) {
        this.dom.lobbyBotBadge.textContent = `🤖 Боти: ${diffName}`;
        this.dom.lobbyBotBadge.style.background = 'rgba(46, 196, 182, 0.2)';
        this.dom.lobbyBotBadge.style.color = '#2ec4b6';
        this.dom.lobbyBotBadge.style.border = '1px solid #2ec4b6';
      } else {
        this.dom.lobbyBotBadge.textContent = '👥 Лише гравці (Без ботів)';
        this.dom.lobbyBotBadge.style.background = 'rgba(255, 71, 87, 0.2)';
        this.dom.lobbyBotBadge.style.color = '#ff6b81';
        this.dom.lobbyBotBadge.style.border = '1px solid #ff4757';
      }
    }

    // Update Mode Badge
    if (this.dom.lobbyModeBadge && state.gameMode) {
      const modeNames = {
        solo_elim: '⚔️ ВИЖИВАННЯ (СОЛО)',
        team_elim: '👥 КОМАНДНЕ ВИЖИВАННЯ',
        ffa_dm: `⚡ FFA DM (${state.targetKills || 10} КІЛІВ)`,
        team_dm: `🐺 vs 🦊 КОМАНДНИЙ DM (${state.targetKills || 15} КІЛІВ)`
      };
      this.dom.lobbyModeBadge.textContent = modeNames[state.gameMode] || state.gameMode.toUpperCase();
    }

    // Sync mode select if host
    if (this.dom.lobbyGameModeSelect && state.gameMode) {
      this.dom.lobbyGameModeSelect.value = state.gameMode;
      const isDm = state.gameMode === 'ffa_dm' || state.gameMode === 'team_dm';
      if (this.dom.lobbyTargetKillsGroup) {
        this.dom.lobbyTargetKillsGroup.style.display = isDm ? 'block' : 'none';
      }
      if (this.dom.lobbyTargetKillsInput && state.targetKills) {
        this.dom.lobbyTargetKillsInput.value = state.targetKills;
      }
    }

    // Host live room config (target kills / bots / difficulty)
    if (this.dom.lobbyHostConfigRow) {
      this.dom.lobbyHostConfigRow.style.display = this.isHost() ? 'block' : 'none';
    }
    if (this.dom.roomActiveTargetKillsInput && state.targetKills) {
      this.dom.roomActiveTargetKillsInput.value = state.targetKills;
    }
    if (this.dom.roomActiveBotFillSelect && state.fillWithBots !== undefined) {
      this.dom.roomActiveBotFillSelect.value = state.fillWithBots ? 'true' : 'false';
    }
    if (this.dom.roomActiveBotDifficultySelect && state.botDifficulty) {
      this.dom.roomActiveBotDifficultySelect.value = state.botDifficulty;
    }

    // Show team selection buttons if in team mode
    const isTeamMode = state.gameMode === 'team_dm' || state.gameMode === 'team_elim';
    if (this.dom.lobbyTeamSelectGroup) {
      this.dom.lobbyTeamSelectGroup.style.display = isTeamMode ? 'block' : 'none';
    }

    // Highlight current player team button
    const myId = this.networkClient.playerId || state.yourPlayerId;
    const me = (state.players || []).find(p => p.id === myId);
    if (this.dom.btnSelectTeam1 && this.dom.btnSelectTeam2) {
      this.dom.btnSelectTeam1.style.background = me?.team === 'team1' ? '#2575fc' : '#1c202a';
      this.dom.btnSelectTeam1.style.color = me?.team === 'team1' ? '#fff' : '#80b5ff';
      this.dom.btnSelectTeam2.style.background = me?.team === 'team2' ? '#ff4757' : '#1c202a';
      this.dom.btnSelectTeam2.style.color = me?.team === 'team2' ? '#fff' : '#ffa4ad';
    }

    // Render players with team tags, heraldic emblems, and status
    const playerSig = JSON.stringify((state.players || []).map(p => `${p.id}:${p.name}:${p.ready}:${p.isHost}:${p.team}:${p.emblem}`));
    if (this._lastPlayersSig !== playerSig && this.dom.lobbyPlayerList) {
      this._lastPlayersSig = playerSig;
      this.dom.lobbyPlayerList.innerHTML = '';
      (state.players || []).forEach(player => {
        const item = document.createElement('li');
        item.className = 'lobby-player-item';
        item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #161a22; border: 1px solid #333a46; border-radius: 3px; margin-bottom: 6px;';

        const nameSpan = document.createElement('span');
        let teamTag = '';
        if (isTeamMode && player.team) {
          teamTag = player.team === 'team1'
            ? '<span style="color: #80b5ff; margin-right: 6px; font-weight: bold;">[🐺 Вовки]</span>'
            : '<span style="color: #ffa4ad; margin-right: 6px; font-weight: bold;">[🦊 Лиси]</span>';
        }

        const emblemDef = getEmblemDefinition(player.emblem);
        const emblemIcon = emblemDef ? emblemDef.icon : '⚙️';
        const emblemTooltip = emblemDef ? `${emblemDef.name} — «${emblemDef.motto}»` : 'Бойовий герб';

        nameSpan.innerHTML = `${teamTag}${player.isHost ? '<span style="color: #ffcf48; margin-right: 4px;">★ (Хост)</span>' : ''}<span style="margin-right: 6px; font-size: 13px;" title="${emblemTooltip}">${emblemIcon}</span>${player.name}`;
        nameSpan.style.color = player.isHost ? 'var(--color-brass-bright)' : 'var(--color-text-brass)';

        const statusBadge = document.createElement('span');
        statusBadge.textContent = player.ready ? 'ГОТОВИЙ' : 'ОЧІКУВАННЯ';
        statusBadge.style.cssText = `font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 3px; background: ${player.ready ? '#1b4332' : '#2b2d42'}; color: ${player.ready ? '#2ec4b6' : '#9d9685'};`;

        item.appendChild(nameSpan);
        item.appendChild(statusBadge);
        this.dom.lobbyPlayerList.appendChild(item);
      });
    }

    // Enable Start Match button only if local client is host
    const isHost = state.hostId && (state.hostId === myId || state.players?.find(p => p.id === myId)?.isHost);

    if (this.dom.btnStartMatch) {
      if (isHost) {
        this.dom.btnStartMatch.style.display = 'block';
      } else {
        this.dom.btnStartMatch.style.display = 'none';
      }
    }
  }

  showError(msg) {
    if (this.dom.lobbyErrorMsg) {
      if (msg) {
        this.dom.lobbyErrorMsg.textContent = msg;
        this.dom.lobbyErrorMsg.style.display = 'block';
      } else {
        this.dom.lobbyErrorMsg.textContent = '';
        this.dom.lobbyErrorMsg.style.display = 'none';
      }
    }
  }
}

export default LobbyUI;
