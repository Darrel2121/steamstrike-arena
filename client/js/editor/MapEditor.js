/**
 * Battle Map Editor Engine
 * Interactive Canvas 2D grid, brush tools, pan/zoom, live BFS validation, and serialization
 */

import {
  TILE_TYPES,
  SPAWN_TYPES,
  PICKUP_TYPES,
  DECOR_TYPES,
  createDefaultMap,
  getPresetMap,
  PRESET_MAPS,
  validateMap,
  serializeMap,
  deserializeMap
} from '../../../shared/MapSchema.js';
import { TILE_SIZE, THEME_COLORS, STORAGE_KEY_CUSTOM_MAP } from '../../../shared/Constants.js';
import { extractSegmentsFromMap } from './SegmentExtractor.js';
import { EditorToolbar } from './EditorToolbar.js';
import { assetManager } from '../rendering/AssetManager.js';

export class MapEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;

    // Active map data model
    this.map = createDefaultMap();
    this.activeTool = 'wall';

    // Viewport transform
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.minZoom = 0.35;
    this.maxZoom = 2.8;

    // Interaction states
    this.isPainting = false;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.hoverCol = -1;
    this.hoverRow = -1;
    this.cachedSegments = [];
    this.lastValidation = { valid: true, errors: [] };
    this.toast = null;

    // Callback when match is launched
    this.onLaunch = options.onLaunch || null;

    // Initialize toolbar
    this.toolbar = new EditorToolbar(this);

    // Setup canvas sizing and listeners
    this.setupCanvas();
    this.attachEventListeners();

    // Initial calculation and render
    this.onMapChanged();
    this.resetView();
  }

  setupCanvas() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth || 800;
      this.canvas.height = parent.clientHeight || 800;
    } else {
      this.canvas.width = 800;
      this.canvas.height = 800;
    }

    window.addEventListener('resize', () => {
      if (parent) {
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.render();
      }
    });
  }

  attachEventListeners() {
    // Disable right click context menu on canvas
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  screenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = screenX - rect.left;
    const cy = screenY - rect.top;

    const worldTotalW = this.map.width * this.map.tileSize;
    const worldTotalH = this.map.height * this.map.tileSize;

    // Transform inverse
    const centerX = this.canvas.width / 2 + this.panX;
    const centerY = this.canvas.height / 2 + this.panY;

    const worldX = (cx - centerX) / this.zoom + worldTotalW / 2;
    const worldY = (cy - centerY) / this.zoom + worldTotalH / 2;

    return { worldX, worldY };
  }

  worldToGrid(worldX, worldY) {
    const col = Math.floor(worldX / this.map.tileSize);
    const row = Math.floor(worldY / this.map.tileSize);
    return { col, row };
  }

  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      return;
    }

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (e.button === 1 || e.button === 2) {
      // Middle click or Right click starts panning
      this.isPanning = true;
    } else if (e.button === 0) {
      // Left click starts painting
      this.isPainting = true;
      const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);
      const { col, row } = this.worldToGrid(worldX, worldY);
      this.applyTool(col, row);
    }
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const isInside = (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    );

    if (this.isPanning) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.panX += dx;
      this.panY += dy;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.render();
      return;
    }

    if (isInside) {
      const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);
      const { col, row } = this.worldToGrid(worldX, worldY);

      this.hoverCol = col;
      this.hoverRow = row;
      this.toolbar.updateCursor(col, row, worldX, worldY);

      if (this.isPainting) {
        this.applyTool(col, row);
      }
      this.render();
    } else {
      if (this.hoverCol !== -1 || this.hoverRow !== -1) {
        this.hoverCol = -1;
        this.hoverRow = -1;
        this.render();
      }
    }
  }

  onMouseUp(e) {
    if (e.button === 0) this.isPainting = false;
    if (e.button === 1 || e.button === 2) this.isPanning = false;
  }

  onWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    this.adjustZoom(zoomFactor - 1.0);
  }

  adjustZoom(delta) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
    this.toolbar.updateZoom(this.zoom);
    this.render();
  }

  resetView() {
    this.panX = 0;
    this.panY = 0;
    const parent = this.canvas.parentElement;
    const availableW = parent ? parent.clientWidth : 800;
    const availableH = parent ? parent.clientHeight : 800;
    const mapW = this.map.width * this.map.tileSize;
    const mapH = this.map.height * this.map.tileSize;

    const fitRatio = Math.min((availableW - 60) / mapW, (availableH - 60) / mapH);
    this.zoom = Math.max(this.minZoom, Math.min(1.5, fitRatio));
    this.toolbar.updateZoom(this.zoom);
    this.render();
  }

  setActiveTool(tool) {
    this.activeTool = tool;
  }

  setMapName(name) {
    this.map.name = name;
    this.onMapChanged();
  }

  resizeGrid(newWidth, newHeight) {
    const oldWidth = this.map.width;
    const oldHeight = this.map.height;
    const oldTiles = this.map.tiles;

    const newTiles = new Array(newWidth * newHeight).fill(TILE_TYPES.FLOOR);

    for (let r = 0; r < Math.min(oldHeight, newHeight); r++) {
      for (let c = 0; c < Math.min(oldWidth, newWidth); c++) {
        newTiles[r * newWidth + c] = oldTiles[r * oldWidth + c];
      }
    }

    this.map.width = newWidth;
    this.map.height = newHeight;
    this.map.tiles = newTiles;

    // Filter spawns, pickups, and decorations to remain inside new bounds
    this.map.spawns = this.map.spawns.filter(s => s.col < newWidth && s.row < newHeight);
    if (this.map.pickups) {
      this.map.pickups = this.map.pickups.filter(p => p.col < newWidth && p.row < newHeight);
    }
    if (this.map.decorations) {
      this.map.decorations = this.map.decorations.filter(d => d.col < newWidth && d.row < newHeight);
    }

    this.addBorderWalls();
    this.onMapChanged();
    this.resetView();
  }

  addBorderWalls() {
    const w = this.map.width;
    const h = this.map.height;
    for (let c = 0; c < w; c++) {
      this.map.tiles[0 * w + c] = TILE_TYPES.WALL;
      this.map.tiles[(h - 1) * w + c] = TILE_TYPES.WALL;
    }
    for (let r = 0; r < h; r++) {
      this.map.tiles[r * w + 0] = TILE_TYPES.WALL;
      this.map.tiles[r * w + (w - 1)] = TILE_TYPES.WALL;
    }

    // Clean up spawns or pickups on outer walls
    this.map.spawns = this.map.spawns.filter(s => s.col > 0 && s.col < w - 1 && s.row > 0 && s.row < h - 1);
    if (this.map.pickups) {
      this.map.pickups = this.map.pickups.filter(p => p.col > 0 && p.col < w - 1 && p.row > 0 && p.row < h - 1);
    }

    this.onMapChanged();
  }

  clearGrid() {
    const w = this.map.width;
    const h = this.map.height;
    this.map.tiles = new Array(w * h).fill(TILE_TYPES.FLOOR);
    this.onMapChanged();
  }

  loadDefaultMap() {
    this.map = createDefaultMap();
    if (this.toolbar) {
      if (this.toolbar.mapNameInput) this.toolbar.mapNameInput.value = this.map.name;
      if (this.toolbar.gridSizeSelect) this.toolbar.gridSizeSelect.value = String(this.map.width);
    }
    this.onMapChanged();
    this.resetView();
  }

  loadPresetMap(idOrName) {
    const preset = getPresetMap(idOrName);
    if (!preset) return;
    this.map = JSON.parse(JSON.stringify(preset));
    if (this.toolbar) {
      if (this.toolbar.mapNameInput) {
        this.toolbar.mapNameInput.value = this.map.name || 'Battle Arena';
      }
      if (this.toolbar.gridSizeSelect) {
        this.toolbar.gridSizeSelect.value = String(this.map.width);
      }
    }
    this.onMapChanged();
    this.resetView();
    this.showToast(`Шаблон: ${this.map.name}`, false);
  }

  applyTool(col, row) {
    if (col < 0 || col >= this.map.width || row < 0 || row >= this.map.height) {
      return;
    }

    const idx = row * this.map.width + col;

    switch (this.activeTool) {
      case 'wall':
        this.map.tiles[idx] = TILE_TYPES.WALL;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        break;

      case 'obstacle':
        this.map.tiles[idx] = TILE_TYPES.OBSTACLE;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        break;

      case 'floor':
        this.map.tiles[idx] = TILE_TYPES.FLOOR;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        this.removeDecorationAt(col, row);
        break;

      case 'player':
        this.map.tiles[idx] = TILE_TYPES.FLOOR;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        this.map.spawns.push({
          id: `player_${Date.now() % 10000}`,
          type: SPAWN_TYPES.PLAYER,
          col,
          row
        });
        break;

      case 'bot':
        this.map.tiles[idx] = TILE_TYPES.FLOOR;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        this.map.spawns.push({
          id: `bot_${Date.now() % 10000}`,
          type: SPAWN_TYPES.BOT,
          col,
          row
        });
        break;

      case 'ammo':
        this.map.tiles[idx] = TILE_TYPES.FLOOR;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        if (!this.map.pickups) this.map.pickups = [];
        this.map.pickups.push({
          type: PICKUP_TYPES.AMMO,
          col,
          row
        });
        break;

      case 'health':
        this.map.tiles[idx] = TILE_TYPES.FLOOR;
        this.removeSpawnAt(col, row);
        this.removePickupAt(col, row);
        if (!this.map.pickups) this.map.pickups = [];
        this.map.pickups.push({
          type: PICKUP_TYPES.HEALTH,
          col,
          row
        });
        break;

      case 'gear':
      case 'vent':
      case 'pipes':
      case 'lantern':
      case 'tank':
      case 'crate':
      case 'crack':
      case 'sign':
      case 'bush':
        this.removeDecorationAt(col, row);
        if (!this.map.decorations) this.map.decorations = [];
        this.map.decorations.push({
          type: this.activeTool,
          col,
          row
        });
        break;
    }

    this.onMapChanged();
  }

  removeSpawnAt(col, row) {
    this.map.spawns = this.map.spawns.filter(s => !(s.col === col && s.row === row));
  }

  removePickupAt(col, row) {
    if (this.map.pickups) {
      this.map.pickups = this.map.pickups.filter(p => !(p.col === col && p.row === row));
    }
  }

  removeDecorationAt(col, row) {
    if (this.map.decorations) {
      this.map.decorations = this.map.decorations.filter(d => !(d.col === col && d.row === row));
    }
  }

  onMapChanged() {
    this.lastValidation = validateMap(this.map);
    this.cachedSegments = extractSegmentsFromMap(this.map);

    let walls = 0;
    let obstacles = 0;
    for (let i = 0; i < this.map.tiles.length; i++) {
      if (this.map.tiles[i] === TILE_TYPES.WALL) walls++;
      else if (this.map.tiles[i] === TILE_TYPES.OBSTACLE) obstacles++;
    }

    const playerSpawns = this.map.spawns.filter(s => s.type === SPAWN_TYPES.PLAYER).length;
    const botSpawns = this.map.spawns.filter(s => s.type === SPAWN_TYPES.BOT).length;
    const decorations = this.map.decorations ? this.map.decorations.length : 0;

    const stats = {
      walls,
      obstacles,
      playerSpawns,
      botSpawns,
      decorations,
      segments: this.cachedSegments.length
    };

    this.toolbar.updateValidationUI(this.lastValidation, stats);
    this.render();
  }

  showToast(text, isError = false) {
    this.toast = {
      text,
      isError,
      expiresAt: Date.now() + 3200
    };
    this.render();
  }

  saveToLocalStorage() {
    try {
      const json = serializeMap(this.map);
      localStorage.setItem(STORAGE_KEY_CUSTOM_MAP, json);
      this.showToast(`Карту '${this.map.name}' успішно збережено!`, false);
    } catch (err) {
      this.showToast(`Помилка збереження: ${err.message}`, true);
    }
  }

  loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_MAP);
      if (!saved) {
        this.showToast('Не знайдено збереженої карти.', true);
        return;
      }
      this.importJsonString(saved);
      this.showToast('Карту завантажено!', false);
    } catch (err) {
      this.showToast(`Помилка завантаження: ${err.message}`, true);
    }
  }

  exportJsonFile() {
    try {
      const json = serializeMap(this.map);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (this.map.name || 'custom_map').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      a.href = url;
      a.download = `${safeName}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Файл JSON успішно експортовано!', false);
    } catch (err) {
      this.showToast(`Помилка експорту: ${err.message}`, true);
    }
  }

  importJsonString(jsonStr) {
    try {
      const imported = deserializeMap(jsonStr);
      const check = validateMap(imported);
      if (!check.valid) {
        this.showToast(`Увага: ${check.errors[0]}`, true);
      }
      this.map = imported;
      this.onMapChanged();
      this.resetView();
    } catch (err) {
      this.showToast(`Помилка парсингу JSON: ${err.message}`, true);
    }
  }

  autoFixSpawns() {
    if (!this.map.spawns) this.map.spawns = [];
    const hasPlayer = this.map.spawns.some(s => s.type === SPAWN_TYPES.PLAYER);
    const hasBot = this.map.spawns.some(s => s.type === SPAWN_TYPES.BOT);

    if (hasPlayer && hasBot) return;

    const w = this.map.width;
    const h = this.map.height;
    const taken = new Set(this.map.spawns.map(s => `${s.col},${s.row}`));

    for (let r = 1; r < h - 1; r++) {
      for (let c = 1; c < w - 1; c++) {
        const key = `${c},${r}`;
        if (this.map.tiles[r * w + c] === TILE_TYPES.FLOOR && !taken.has(key)) {
          if (!this.map.spawns.some(s => s.type === SPAWN_TYPES.PLAYER)) {
            this.map.spawns.push({ id: `player_auto_${Date.now() % 1000}`, type: SPAWN_TYPES.PLAYER, col: c, row: r });
            taken.add(key);
            continue;
          }
          if (!this.map.spawns.some(s => s.type === SPAWN_TYPES.BOT)) {
            this.map.spawns.push({ id: `bot_auto_${Date.now() % 1000}`, type: SPAWN_TYPES.BOT, col: c, row: r });
            taken.add(key);
            break;
          }
        }
      }
      if (this.map.spawns.some(s => s.type === SPAWN_TYPES.PLAYER) && this.map.spawns.some(s => s.type === SPAWN_TYPES.BOT)) {
        break;
      }
    }
    this.onMapChanged();
  }

  launchMatch(mode = 'solo') {
    this.autoFixSpawns();
    const val = validateMap(this.map);
    if (!val.valid) {
      this.showToast(`Помилка карти: ${val.errors[0]}`, true);
      return;
    }

    if (typeof this.onLaunch === 'function') {
      this.onLaunch(this.map, mode);
    } else {
      // Dispatch DOM custom event
      const evt = new CustomEvent('launchCustomMap', { detail: { map: this.map, mode } });
      window.dispatchEvent(evt);
    }
  }

  openSubmitMapModal() {
    this.autoFixSpawns();
    const val = validateMap(this.map);
    if (!val.valid) {
      this.showToast(`Карта не готова: ${val.errors[0]}`, true);
      return;
    }

    const modal = document.getElementById('modalSubmitCommunityMap');
    if (!modal) return;

    const nameInput = document.getElementById('submitMapNameInput');
    const authorInput = document.getElementById('submitMapAuthorInput');
    const descInput = document.getElementById('submitMapDescInput');
    const diagSummary = document.getElementById('submitMapDiagSummary');
    const notice = document.getElementById('submitMapStatusNotice');
    const form = document.getElementById('formSubmitCommunityMap');
    const btnClose = document.getElementById('btnCloseSubmitMapModal');
    const btnCancel = document.getElementById('btnCancelSubmitMap');

    if (nameInput) nameInput.value = this.map.name || 'Clockwork Arena';

    let authorName = 'FoundryEngineer';
    try {
      const stored = localStorage.getItem('steamstrike_profile_v1');
      if (stored) {
        const p = JSON.parse(stored);
        if (p.username) authorName = p.username;
      }
    } catch (_) {}
    if (authorInput) authorInput.value = authorName;

    if (descInput) descInput.value = '';
    if (notice) {
      notice.style.display = 'none';
      notice.textContent = '';
    }

    if (diagSummary) {
      const walls = this.map.tiles.filter(t => t === TILE_TYPES.WALL).length;
      const obstacles = this.map.tiles.filter(t => t === TILE_TYPES.OBSTACLE).length;
      const playerSpawns = this.map.spawns.filter(s => s.type === SPAWN_TYPES.PLAYER).length;
      const botSpawns = this.map.spawns.filter(s => s.type === SPAWN_TYPES.BOT).length;
      diagSummary.textContent = `🗺️ Розмір: ${this.map.width}x${this.map.height} (${this.map.tileSize}px) | Стіни: ${walls} | Укриття: ${obstacles} | Спавни: ${playerSpawns} гравців, ${botSpawns} ботів`;
    }

    modal.style.display = 'flex';

    const closeModal = () => {
      modal.style.display = 'none';
    };

    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;

    if (form && !form._boundSubmit) {
      form._boundSubmit = true;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btnConfirmSubmitMap');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '⏳ Відправка на сервер...';
        }

        try {
          const mapPayload = JSON.parse(JSON.stringify(this.map));
          mapPayload.name = nameInput?.value?.trim() || mapPayload.name;
          const author = authorInput?.value?.trim() || 'Анонімний Інженер';
          const description = descInput?.value?.trim() || '';

          const apiBase = '';

          const token = localStorage.getItem('clockwork_auth_token_v1');
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${apiBase}/api/community-maps/submit`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name: mapPayload.name,
              author,
              description,
              map: mapPayload
            })
          });

          const data = await res.json();
          if (res.ok && data.success) {
            if (notice) {
              notice.className = 'auth-notice notice-success';
              notice.style.display = 'block';
              notice.textContent = '🎉 ' + (data.message || 'Карту успішно надіслано на модерацію!');
            }
            this.showToast('Карту надіслано на розгляд адміністратора!', false);
            setTimeout(() => {
              closeModal();
            }, 1800);
          } else {
            throw new Error(data.error || 'Не вдалося надіслати карту на сервер');
          }
        } catch (err) {
          if (notice) {
            notice.className = 'auth-notice notice-error';
            notice.style.display = 'block';
            notice.textContent = '❌ ' + err.message;
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '🚀 Надіслати на модерацію';
          }
        }
      };
    }
  }

  returnHome() {
    if (typeof this.options?.onReturnHome === 'function') {
      this.options.onReturnHome();
    } else {
      window.dispatchEvent(new CustomEvent('editorReturnHome'));
    }
  }

  render() {
    const { ctx, canvas } = this;
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const worldTotalW = this.map.width * this.map.tileSize;
    const worldTotalH = this.map.height * this.map.tileSize;

    ctx.save();

    // Center and transform
    ctx.translate(canvas.width / 2 + this.panX, canvas.height / 2 + this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-worldTotalW / 2, -worldTotalH / 2);

    // 1. Arena Floor Base & Cobblestone / Grates
    const floorPattern = assetManager.getFloorPattern(ctx);
    if (floorPattern) {
      ctx.fillStyle = floorPattern;
    } else {
      ctx.fillStyle = THEME_COLORS.cobbleFloor;
    }
    ctx.fillRect(0, 0, worldTotalW, worldTotalH);

    const ts = this.map.tileSize;
    const w = this.map.width;
    const h = this.map.height;

    const wallImg = assetManager.wallImage;
    const obstacleImg = assetManager.obstacleImage;

    // 2. Render Tiles
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const x = c * ts;
        const y = r * ts;
        const tile = this.map.tiles[r * w + c];

        if (tile === TILE_TYPES.WALL) {
          if (wallImg) {
            ctx.drawImage(wallImg, x, y, ts, ts);
            ctx.fillStyle = 'rgba(255, 230, 160, 0.12)';
            ctx.fillRect(x, y, ts, 1.5);
            ctx.fillRect(x, y, 1.5, ts);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(x, y + ts - 1.5, ts, 1.5);
            ctx.fillRect(x + ts - 1.5, y, 1.5, ts);
          } else {
            // Solid Wall: Dark Iron Block with bevel and rivets
            ctx.fillStyle = THEME_COLORS.ironDark;
            ctx.fillRect(x, y, ts, ts);

            ctx.fillStyle = '#2d3440';
            ctx.fillRect(x + 2, y + 2, ts - 4, ts - 4);

            // Rivet dots
            ctx.fillStyle = THEME_COLORS.ironRivet;
            ctx.fillRect(x + 3, y + 3, 2, 2);
            ctx.fillRect(x + ts - 5, y + 3, 2, 2);
            ctx.fillRect(x + 3, y + ts - 5, 2, 2);
            ctx.fillRect(x + ts - 5, y + ts - 5, 2, 2);
          }
        } else if (tile === TILE_TYPES.OBSTACLE) {
          if (obstacleImg) {
            ctx.drawImage(obstacleImg, x, y, ts, ts);
          } else {
            // Obstacle: Copper / Industrial Boiler Block
            ctx.fillStyle = THEME_COLORS.copperDark;
            ctx.fillRect(x, y, ts, ts);

            ctx.fillStyle = THEME_COLORS.copperWarm;
            ctx.beginPath();
            ctx.arc(x + ts / 2, y + ts / 2, ts / 2 - 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = THEME_COLORS.brassPrimary;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Central bolt
            ctx.fillStyle = THEME_COLORS.brassGlow;
            ctx.beginPath();
            ctx.arc(x + ts / 2, y + ts / 2, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Walkable Floor: Subtle grid pattern
          ctx.strokeStyle = 'rgba(60, 67, 79, 0.35)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, ts, ts);
        }
      }
    }

    // 3. Render Pickups
    if (this.map.pickups) {
      const pickupImg = assetManager.pickupImage;
      for (const pickup of this.map.pickups) {
        const px = pickup.col * ts + ts / 2;
        const py = pickup.row * ts + ts / 2;

        if (pickupImg) {
          ctx.drawImage(pickupImg, px - ts * 0.35, py - ts * 0.35, ts * 0.7, ts * 0.7);
          ctx.fillStyle = pickup.type === PICKUP_TYPES.HEALTH ? '#2ec4b6' : '#ffcf48';
          ctx.beginPath();
          ctx.arc(px, py - ts * 0.28, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0b0d11';
          ctx.font = 'bold 6px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pickup.type === PICKUP_TYPES.HEALTH ? '+' : '•', px, py - ts * 0.28);
        } else if (pickup.type === PICKUP_TYPES.AMMO) {
          ctx.fillStyle = '#f39c12';
          ctx.fillRect(px - 10, py - 8, 20, 16);
          ctx.fillStyle = '#ffe685';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('AMMO', px, py);
        } else if (pickup.type === PICKUP_TYPES.HEALTH) {
          ctx.fillStyle = '#27ae60';
          ctx.beginPath();
          ctx.arc(px, py, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px - 6, py - 2, 12, 4);
          ctx.fillRect(px - 2, py - 6, 4, 12);
        }
      }
    }

    // 3.5. Render Steampunk Decorations
    if (this.map.decorations) {
      for (const decor of this.map.decorations) {
        const dx = decor.col * ts + ts / 2;
        const dy = decor.row * ts + ts / 2;
        this.renderDecorItem(ctx, decor.type, dx, dy, ts);
      }
    }

    // 4. Render Spawns
    if (this.map.spawns) {
      let pIdx = 1;
      let bIdx = 1;
      for (const spawn of this.map.spawns) {
        const sx = spawn.col * ts + ts / 2;
        const sy = spawn.row * ts + ts / 2;

        if (spawn.type === SPAWN_TYPES.PLAYER) {
          // Glowing Cyan Player Spawn Beacon
          ctx.fillStyle = 'rgba(46, 196, 182, 0.25)';
          ctx.beginPath();
          ctx.arc(sx, sy, 16, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = THEME_COLORS.healthFull;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`P${pIdx++}`, sx, sy);
        } else if (spawn.type === SPAWN_TYPES.BOT) {
          // Glowing Crimson Bot Spawn Beacon
          ctx.fillStyle = 'rgba(231, 29, 54, 0.25)';
          ctx.beginPath();
          ctx.arc(sx, sy, 16, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = THEME_COLORS.healthCritical;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`B${bIdx++}`, sx, sy);
        }
      }
    }

    // 5. Render Merged Collinear Raycast Segments Outline
    ctx.strokeStyle = 'rgba(255, 207, 72, 0.65)';
    ctx.lineWidth = 2;
    for (const seg of this.cachedSegments) {
      ctx.beginPath();
      ctx.moveTo(seg.p1.x, seg.p1.y);
      ctx.lineTo(seg.p2.x, seg.p2.y);
      ctx.stroke();

      // Vertex dots
      ctx.fillStyle = THEME_COLORS.brassGlow;
      ctx.beginPath();
      ctx.arc(seg.p1.x, seg.p1.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(seg.p2.x, seg.p2.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Render Hover Cursor Tile Highlight
    if (
      this.hoverCol >= 0 &&
      this.hoverCol < this.map.width &&
      this.hoverRow >= 0 &&
      this.hoverRow < this.map.height
    ) {
      const hx = this.hoverCol * ts;
      const hy = this.hoverRow * ts;

      ctx.fillStyle = 'rgba(255, 207, 72, 0.28)';
      ctx.fillRect(hx, hy, ts, ts);

      ctx.strokeStyle = THEME_COLORS.brassGlow;
      ctx.lineWidth = 2;
      ctx.strokeRect(hx, hy, ts, ts);
    }

    // Outer Arena Border
    ctx.strokeStyle = THEME_COLORS.brassPrimary;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, worldTotalW, worldTotalH);

    ctx.restore();

    // 7. In-Canvas Toast Notification (Screen Space)
    this.renderToast(ctx);
  }

  /**
   * Renders in-canvas toast notifications in editor view.
   * @param {CanvasRenderingContext2D} ctx
   */
  renderToast(ctx) {
    if (!this.toast || !this.toast.text) return;
    if (Date.now() > this.toast.expiresAt) {
      this.toast = null;
      return;
    }

    ctx.save();
    const width = this.canvas.width;
    ctx.font = 'bold 13px Georgia, serif';
    const textMetrics = ctx.measureText(this.toast.text);
    const boxW = Math.max(260, textMetrics.width + 48);
    const boxH = 34;
    const boxX = (width - boxW) / 2;
    const boxY = 24;

    ctx.fillStyle = 'rgba(15, 18, 25, 0.94)';
    ctx.strokeStyle = this.toast.isError ? '#e71d36' : '#ffcf48';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffcf48';
    ctx.beginPath();
    ctx.arc(boxX + 5, boxY + 5, 2, 0, Math.PI * 2);
    ctx.arc(boxX + boxW - 5, boxY + 5, 2, 0, Math.PI * 2);
    ctx.arc(boxX + 5, boxY + boxH - 5, 2, 0, Math.PI * 2);
    ctx.arc(boxX + boxW - 5, boxY + boxH - 5, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.toast.isError ? '#ff5a5f' : '#ffcf48';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.toast.text, width / 2, boxY + boxH / 2);
    ctx.restore();
  }

  /**
   * Renders a vector steampunk decorative item on the grid.
   */
  renderDecorItem(ctx, type, x, y, ts) {
    ctx.save();
    ctx.translate(x, y);

    switch (type) {
      case 'gear': {
        // Brass Cog with 8 teeth and axle
        ctx.fillStyle = '#b8860b';
        ctx.strokeStyle = '#ffcf48';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3, -ts * 0.38, 6, ts * 0.16);
        }
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.30, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#181b22';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.09, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'vent': {
        // Iron Steam Grate with steam glow
        ctx.fillStyle = '#1c202a';
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-ts * 0.35, -ts * 0.35, ts * 0.7, ts * 0.7);
        ctx.strokeRect(-ts * 0.35, -ts * 0.35, ts * 0.7, ts * 0.7);
        ctx.strokeStyle = '#5ffbf1';
        ctx.lineWidth = 1.2;
        for (let i = -ts * 0.22; i <= ts * 0.22; i += ts * 0.14) {
          ctx.beginPath();
          ctx.moveTo(-ts * 0.25, i);
          ctx.lineTo(ts * 0.25, i);
          ctx.stroke();
        }
        break;
      }

      case 'pipes': {
        // Interlocking copper pipes with brass wheel
        ctx.fillStyle = '#8e5428';
        ctx.strokeStyle = '#c97c36';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-ts * 0.44, -ts * 0.12, ts * 0.88, ts * 0.24);
        ctx.strokeRect(-ts * 0.44, -ts * 0.12, ts * 0.88, ts * 0.24);
        ctx.fillRect(-ts * 0.12, -ts * 0.44, ts * 0.24, ts * 0.88);
        ctx.strokeRect(-ts * 0.12, -ts * 0.44, ts * 0.24, ts * 0.88);
        ctx.fillStyle = '#ffcf48';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.14, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'lantern': {
        // Victorian street lantern with warm glow halo
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, ts * 0.48);
        grad.addColorStop(0, 'rgba(255, 207, 72, 0.4)');
        grad.addColorStop(1, 'rgba(255, 207, 72, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.48, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#1c202a';
        ctx.strokeStyle = '#c59b27';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -ts * 0.32);
        ctx.lineTo(ts * 0.2, -ts * 0.12);
        ctx.lineTo(ts * 0.14, ts * 0.22);
        ctx.lineTo(-ts * 0.14, ts * 0.22);
        ctx.lineTo(-ts * 0.2, -ts * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff4cc';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.08, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'tank': {
        // Boiler vessel with pressure gauge dial
        ctx.fillStyle = '#6b3e1c';
        ctx.strokeStyle = '#e09f3e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = '#c59b27';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.22, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#f0f3f6';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#e71d36';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ts * 0.07, -ts * 0.07);
        ctx.stroke();
        break;
      }

      case 'crate': {
        // Wood crate with iron corner plates and X bracing
        ctx.fillStyle = '#5c3a21';
        ctx.strokeStyle = '#2b1d12';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-ts * 0.34, -ts * 0.34, ts * 0.68, ts * 0.68);
        ctx.strokeRect(-ts * 0.34, -ts * 0.34, ts * 0.68, ts * 0.68);

        ctx.strokeStyle = '#8e5428';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-ts * 0.28, -ts * 0.28);
        ctx.lineTo(ts * 0.28, ts * 0.28);
        ctx.moveTo(ts * 0.28, -ts * 0.28);
        ctx.lineTo(-ts * 0.28, ts * 0.28);
        ctx.stroke();

        ctx.fillStyle = '#3a4454';
        const cSize = ts * 0.12;
        ctx.fillRect(-ts * 0.34, -ts * 0.34, cSize, cSize);
        ctx.fillRect(ts * 0.34 - cSize, -ts * 0.34, cSize, cSize);
        ctx.fillRect(-ts * 0.34, ts * 0.34 - cSize, cSize, cSize);
        ctx.fillRect(ts * 0.34 - cSize, ts * 0.34 - cSize, cSize, cSize);
        break;
      }

      case 'crack': {
        // Floor stone fracture / fissure lines
        ctx.strokeStyle = '#0e1117';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-ts * 0.35, -ts * 0.25);
        ctx.lineTo(-ts * 0.12, -ts * 0.05);
        ctx.lineTo(ts * 0.05, -ts * 0.18);
        ctx.lineTo(ts * 0.28, ts * 0.05);
        ctx.lineTo(ts * 0.38, ts * 0.32);
        ctx.moveTo(-ts * 0.12, -ts * 0.05);
        ctx.lineTo(-ts * 0.18, ts * 0.28);
        ctx.lineTo(-ts * 0.32, ts * 0.35);
        ctx.moveTo(ts * 0.05, -ts * 0.18);
        ctx.lineTo(ts * 0.22, -ts * 0.34);
        ctx.stroke();

        // Subtle dark dust/shadowing
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'sign': {
        // Brass hazard plate with warning stripes & danger stencil
        ctx.fillStyle = '#b8860b';
        ctx.fillRect(-ts * 0.38, -ts * 0.24, ts * 0.76, ts * 0.48);
        ctx.strokeStyle = '#2b1d12';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-ts * 0.38, -ts * 0.24, ts * 0.76, ts * 0.48);

        // Caution diagonal hazard stripes
        ctx.save();
        ctx.beginPath();
        ctx.rect(-ts * 0.36, -ts * 0.22, ts * 0.72, ts * 0.44);
        ctx.clip();
        ctx.strokeStyle = '#2b1d12';
        ctx.lineWidth = 3;
        for (let i = -ts * 0.6; i <= ts * 0.6; i += ts * 0.16) {
          ctx.beginPath();
          ctx.moveTo(i, -ts * 0.3);
          ctx.lineTo(i + ts * 0.3, ts * 0.3);
          ctx.stroke();
        }
        ctx.restore();

        // Inner stencil banner
        ctx.fillStyle = '#1c202a';
        ctx.fillRect(-ts * 0.28, -ts * 0.10, ts * 0.56, ts * 0.20);
        ctx.fillStyle = '#ffcf48';
        ctx.font = `bold ${Math.max(7, Math.floor(ts * 0.16))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DANGER', 0, 1);
        break;
      }

      case 'bush': {
        // Alchemical mechanical overgrown foliage / moss cluster
        const r = ts * 0.32;
        ctx.fillStyle = '#1b4d3e';
        ctx.beginPath();
        ctx.arc(-ts * 0.12, -ts * 0.08, r * 0.75, 0, Math.PI * 2);
        ctx.arc(ts * 0.12, -ts * 0.06, r * 0.70, 0, Math.PI * 2);
        ctx.arc(0, ts * 0.10, r * 0.85, 0, Math.PI * 2);
        ctx.arc(-ts * 0.18, ts * 0.12, r * 0.60, 0, Math.PI * 2);
        ctx.arc(ts * 0.16, ts * 0.14, r * 0.60, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#2e8b57';
        ctx.beginPath();
        ctx.arc(-ts * 0.06, -ts * 0.02, r * 0.55, 0, Math.PI * 2);
        ctx.arc(ts * 0.08, 0, r * 0.50, 0, Math.PI * 2);
        ctx.arc(0, ts * 0.08, r * 0.60, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#5ffbf1';
        ctx.beginPath();
        ctx.arc(-ts * 0.12, -ts * 0.06, 1.8, 0, Math.PI * 2);
        ctx.arc(ts * 0.10, ts * 0.04, 1.8, 0, Math.PI * 2);
        ctx.arc(0, -ts * 0.12, 1.8, 0, Math.PI * 2);
        ctx.arc(-ts * 0.04, ts * 0.14, 1.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }
}
