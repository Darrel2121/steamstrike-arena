/**
 * Steampunk Tactical Visibility & Fog of War Renderer
 * HTML5 Canvas 2D composite darkness masking with directional steam-lantern punch-out,
 * raycast visibility polygon clipping, and 360-degree close proximity awareness.
 */

import {
  computeVisibilityPolygon,
  normalizeAngle
} from '../../../shared/RaycastMath.js';
import {
  LANTERN_FOV_RAD,
  LANTERN_FOV_HALF,
  LANTERN_RANGE,
  PROXIMITY_RADIUS,
  THEME_COLORS
} from '../../../shared/Constants.js';

export class VisibilityRenderer {
  /**
   * @param {Object} [options]
   * @param {string} [options.darknessColor] - Ambient fog color (default: 'rgba(10, 12, 16, 0.95)')
   * @param {HTMLCanvasElement} [options.fogCanvas] - Optional pre-allocated offscreen canvas
   */
  constructor(options = {}) {
    this.darknessColor = options.darknessColor || 'rgba(10, 12, 16, 0.95)';
    this.proximityRadius = options.proximityRadius || PROXIMITY_RADIUS || 45;
    this.lanternRange = options.lanternRange || LANTERN_RANGE || 420;
    this.lanternFov = options.lanternFov || LANTERN_FOV_RAD || (Math.PI * 80) / 180;

    this.fogCanvas = options.fogCanvas || null;
    this.fogCtx = null;
    this.lastPolygon = [];

    // Performance optimization caches & reusable scratch buffers (F40)
    this._scratchActiveOthers = [];
    this._scratchActiveMapLanterns = [];
    this._scratchOthersPassData = [];
    this._gradCache = new Map();

    this.initFogCanvas();
  }

  /**
   * Initializes or recreates the offscreen darkness canvas.
   */
  initFogCanvas() {
    if (typeof document !== 'undefined') {
      if (!this.fogCanvas) {
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = 800;
        this.fogCanvas.height = 600;
      }
      this.fogCtx = this.fogCanvas.getContext('2d');
    } else if (this.fogCanvas && typeof this.fogCanvas.getContext === 'function') {
      this.fogCtx = this.fogCanvas.getContext('2d');
    }
  }

  /**
   * Resizes the offscreen darkness buffer to match current viewport dimensions.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (this.fogCanvas) {
      if (this.fogCanvas.width !== width || this.fogCanvas.height !== height) {
        this.fogCanvas.width = width;
        this.fogCanvas.height = height;
      }
    }
  }

  getLanternPunchGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `punch_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      g.addColorStop(0.65, 'rgba(255, 255, 255, 1.0)');
      g.addColorStop(0.85, 'rgba(255, 255, 255, 0.65)');
      g.addColorStop(0.95, 'rgba(255, 255, 255, 0.20)');
      g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getProxPunchGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `prox_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      g.addColorStop(0.70, 'rgba(255, 255, 255, 1.0)');
      g.addColorStop(0.88, 'rgba(255, 255, 255, 0.50)');
      g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getWreckPunchGradient(ctx, radius = 34) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `wreck_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 130, 50, 0.35)');
      g.addColorStop(0.60, 'rgba(180, 60, 20, 0.12)');
      g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
      this._gradCache.set(key, g);
    }
    return g;
  }

  getMapLanternPunchGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `map_punch_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      g.addColorStop(0.55, 'rgba(255, 255, 255, 0.95)');
      g.addColorStop(0.80, 'rgba(255, 255, 255, 0.60)');
      g.addColorStop(0.95, 'rgba(255, 255, 255, 0.15)');
      g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getLocalMistGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `local_mist_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 205, 80, 0.10)');
      g.addColorStop(0.35, 'rgba(215, 135, 45, 0.05)');
      g.addColorStop(0.70, 'rgba(160, 85, 20, 0.012)');
      g.addColorStop(1.0, 'rgba(100, 40, 10, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getLocalGlowGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `local_glow_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 220, 110, 0.18)');
      g.addColorStop(0.28, 'rgba(240, 165, 55, 0.10)');
      g.addColorStop(0.60, 'rgba(195, 105, 30, 0.035)');
      g.addColorStop(0.85, 'rgba(130, 55, 15, 0.006)');
      g.addColorStop(1.0, 'rgba(80, 30, 10, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getLocalCoreBloomGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `local_core_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 245, 185, 0.22)');
      g.addColorStop(0.35, 'rgba(255, 200, 75, 0.09)');
      g.addColorStop(0.70, 'rgba(200, 115, 35, 0.02)');
      g.addColorStop(1.0, 'rgba(120, 50, 15, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getAllyMistGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `ally_mist_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(100, 180, 255, 0.16)');
      g.addColorStop(0.45, 'rgba(60, 140, 240, 0.06)');
      g.addColorStop(1.0, 'rgba(20, 80, 210, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getAllyGlowGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `ally_glow_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(120, 200, 255, 0.28)');
      g.addColorStop(0.35, 'rgba(70, 150, 245, 0.12)');
      g.addColorStop(0.75, 'rgba(30, 90, 220, 0.025)');
      g.addColorStop(1.0, 'rgba(15, 50, 180, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getAllyLensGradient(ctx, radius = 20) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `ally_lens_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(210, 240, 255, 0.80)');
      g.addColorStop(0.45, 'rgba(74, 144, 226, 0.30)');
      g.addColorStop(1.0, 'rgba(74, 144, 226, 0.0)');
      this._gradCache.set(key, g);
    }
    return g;
  }

  getEnemyMistGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `enemy_mist_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 120, 40, 0.15)');
      g.addColorStop(0.45, 'rgba(220, 70, 20, 0.05)');
      g.addColorStop(1.0, 'rgba(150, 30, 10, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getEnemyGlowGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `enemy_glow_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 150, 60, 0.28)');
      g.addColorStop(0.35, 'rgba(255, 90, 30, 0.14)');
      g.addColorStop(0.70, 'rgba(200, 45, 15, 0.03)');
      g.addColorStop(1.0, 'rgba(120, 20, 5, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getEnemyLampGradient(ctx, radius = 18) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `enemy_lamp_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 240, 190, 0.90)');
      g.addColorStop(0.40, 'rgba(255, 110, 40, 0.40)');
      g.addColorStop(1.0, 'rgba(255, 60, 20, 0.0)');
      this._gradCache.set(key, g);
    }
    return g;
  }

  getMapAmbientGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `map_amb_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 195, 75, 0.22)');
      g.addColorStop(0.40, 'rgba(235, 145, 40, 0.10)');
      g.addColorStop(0.75, 'rgba(180, 80, 15, 0.03)');
      g.addColorStop(1.0, 'rgba(120, 40, 5, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getMapPoolGradient(ctx, radius) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `map_pool_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 230, 130, 0.35)');
      g.addColorStop(0.50, 'rgba(255, 175, 50, 0.15)');
      g.addColorStop(1.0, 'rgba(210, 110, 20, 0.0)');
      if (this._gradCache.size > 128) this._gradCache.clear();
      this._gradCache.set(key, g);
    }
    return g;
  }

  getMapBloomGradient(ctx, radius = 22) {
    if (!this._gradCache) this._gradCache = new Map();
    const key = `map_bloom_${Math.round(radius)}`;
    let g = this._gradCache.get(key);
    if (!g) {
      const r = Math.max(1, Math.round(radius));
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255, 255, 220, 0.95)');
      g.addColorStop(0.40, 'rgba(255, 210, 85, 0.60)');
      g.addColorStop(0.75, 'rgba(255, 150, 30, 0.18)');
      g.addColorStop(1.0, 'rgba(255, 100, 15, 0.0)');
      this._gradCache.set(key, g);
    }
    return g;
  }

  /**
   * Computes the line-of-sight visibility polygon for an observer in world coordinates.
   * @param {{x: number, y: number, renderX?: number, renderY?: number, angle?: number, fov?: number, range?: number}} observer
   * @param {Array<Object>} segments
   * @returns {Array<{x: number, y: number, angle: number}>}
   */
  computePolygon(observer, segments) {
    const obsX = observer.renderX ?? observer.x;
    const obsY = observer.renderY ?? observer.y;
    const obsAngle = observer.angle ?? 0;

    const obsFov = observer.fov ?? this.lanternFov;
    const obsRange = observer.range ?? this.lanternRange;

    // Temporal polygon caching: if observer position, angle, fov and range are unchanged, reuse cached polygon!
    if (
      observer._cachedPoly &&
      observer._cachedPolySegments === segments &&
      observer._cachedPolyX === obsX &&
      observer._cachedPolyY === obsY &&
      observer._cachedPolyAngle === obsAngle &&
      observer._cachedPolyFov === obsFov &&
      observer._cachedPolyRange === obsRange
    ) {
      this.lastPolygon = observer._cachedPoly;
      return observer._cachedPoly;
    }

    const obs = (obsX !== observer.x || obsY !== observer.y)
      ? { ...observer, x: obsX, y: obsY }
      : observer;

    const poly = computeVisibilityPolygon(
      obs,
      segments,
      obsAngle,
      obsFov,
      obsRange
    );

    observer._cachedPoly = poly;
    observer._cachedPolySegments = segments;
    observer._cachedPolyX = obsX;
    observer._cachedPolyY = obsY;
    observer._cachedPolyAngle = obsAngle;
    observer._cachedPolyFov = obsFov;
    observer._cachedPolyRange = obsRange;

    this.lastPolygon = poly;
    return poly;
  }

  /**
   * Computes or retrieves cached 360-degree visibility polygon for stationary map lantern.
   * @param {Object} lantern
   * @param {number} lx
   * @param {number} ly
   * @param {number} radius
   * @param {Array<Object>} segments
   * @returns {Array<{x: number, y: number}>}
   */
  computeMapLanternPolygon(lantern, lx, ly, radius, segments) {
    if (
      lantern._cachedPoly &&
      lantern._cachedSegments === segments &&
      lantern._cachedX === lx &&
      lantern._cachedY === ly &&
      lantern._cachedRadius === radius
    ) {
      return lantern._cachedPoly;
    }

    const poly = computeVisibilityPolygon(
      { x: lx, y: ly },
      segments,
      0,
      Math.PI * 2,
      radius
    );

    lantern._cachedPoly = poly;
    lantern._cachedSegments = segments;
    lantern._cachedX = lx;
    lantern._cachedY = ly;
    lantern._cachedRadius = radius;

    return poly;
  }

  /**
   * Renders Layer 4: The Darkness Fog of War and Directional Lantern Mask.
   * Punches out the lantern beam, proximity circle, and stationary map lanterns through darkness,
   * clipped strictly to the raycast visibility polygon so solid walls cast realistic shadows.
   *
   * @param {CanvasRenderingContext2D} mainCtx - Main destination Canvas 2D context
   * @param {{x: number, y: number, renderX?: number, renderY?: number, angle?: number, fov?: number, range?: number}} player - Observer entity
   * @param {Array<Object>} segments - Map line segments for occlusion
   * @param {{x: number, y: number, width?: number, height?: number}} [camera] - Viewport camera
   * @param {Array<Object>} [otherCombatants] - Other player entities
   * @param {Array<Object>} [mapLanterns] - Stationary map lanterns / decorations
   */
  renderDarknessMask(mainCtx, player, segments = [], camera = { x: 0, y: 0 }, otherCombatants = [], mapLanterns = []) {
    if (!mainCtx || !player) return;

    const width = camera.width || mainCtx.canvas?.width || 800;
    const height = camera.height || mainCtx.canvas?.height || 600;

    this.resize(width, height);

    // If no offscreen canvas available (e.g. headless fallback), draw directly with save/restore
    const fCtx = this.fogCtx;
    if (!fCtx || !this.fogCanvas) {
      this.renderDirectMask(mainCtx, player, segments, camera, width, height, otherCombatants);
      return;
    }

    const zoom = camera.zoom || 1.0;
    const camX = camera.x || 0;
    const camY = camera.y || 0;
    const myTeam = player.team || null;
    const viewWorldW = width / zoom;
    const viewWorldH = height / zoom;
    const maxLanternReach = this.lanternRange * 1.05;

    // Filter living other combatants with active lanterns intersecting the camera viewport
    if (!this._scratchActiveOthers) this._scratchActiveOthers = [];
    this._scratchActiveOthers.length = 0;
    if (Array.isArray(otherCombatants)) {
      for (let i = 0; i < otherCombatants.length; i++) {
        const c = otherCombatants[i];
        if (!c || c.id === player.id || !c.isAlive || (c.hp !== undefined && c.hp <= 0) || c.lanternOn === false) {
          continue;
        }
        const cx = c.renderX ?? c.x;
        const cy = c.renderY ?? c.y;
        const cRange = c.range ?? c.lanternRange ?? maxLanternReach;
        if (
          cx >= camX - cRange &&
          cx <= camX + viewWorldW + cRange &&
          cy >= camY - cRange &&
          cy <= camY + viewWorldH + cRange
        ) {
          this._scratchActiveOthers.push(c);
        }
      }
    }
    const activeOthers = this._scratchActiveOthers;

    // Filter stationary map lanterns (Victorian street lamps / wall fixtures) intersecting viewport
    if (!this._scratchActiveMapLanterns) this._scratchActiveMapLanterns = [];
    this._scratchActiveMapLanterns.length = 0;
    const ts = 40;
    const defaultMapLanternRadius = 115;
    if (Array.isArray(mapLanterns)) {
      for (let i = 0; i < mapLanterns.length; i++) {
        const l = mapLanterns[i];
        if (!l) continue;
        if (l.type && l.type !== 'lantern' && l.type !== 'lamp' && l.type !== 'street_lamp') {
          continue;
        }
        const lx = l.x !== undefined ? l.x : (l.col !== undefined ? l.col * ts + ts / 2 : 0);
        const ly = l.y !== undefined ? l.y : (l.row !== undefined ? l.row * ts + ts / 2 : 0);
        const lr = l.radius || defaultMapLanternRadius;
        if (
          lx >= camX - lr &&
          lx <= camX + viewWorldW + lr &&
          ly >= camY - lr &&
          ly <= camY + viewWorldH + lr
        ) {
          this._scratchActiveMapLanterns.push(l);
        }
      }
    }
    const activeMapLanterns = this._scratchActiveMapLanterns;

    // 1. Fill offscreen fog canvas with ambient darkness
    fCtx.save();
    fCtx.clearRect(0, 0, width, height);
    fCtx.globalCompositeOperation = 'source-over';
    fCtx.fillStyle = this.darknessColor;
    fCtx.fillRect(0, 0, width, height);

    // 2. Compute visibility polygon for local player
    const poly = this.computePolygon(player, segments);
    this.lastPolygon = poly;

    // 3. Destination-out punch: clears darkness where lanterns shine in world coordinates
    fCtx.save();
    fCtx.globalCompositeOperation = 'destination-out';
    if (typeof fCtx.scale === 'function') {
      fCtx.scale(zoom, zoom);
    }
    fCtx.translate(-camX, -camY);

    // 3a. Punch local player's vision with smooth feathered lantern falloff
    const isPlayerAlive = player.isAlive !== false && (player.hp === undefined || player.hp > 0);
    if (isPlayerAlive && poly && poly.length >= 3) {
      const px = player.renderX ?? player.x;
      const py = player.renderY ?? player.y;

      const aimAngle = player.angle !== undefined ? player.angle : (player.aimAngle ?? 0);
      const fov = player.fov ?? this.lanternFov;
      const fovHalf = fov / 2;
      const range = player.range ?? player.lanternRange ?? this.lanternRange;

      fCtx.save();
      fCtx.beginPath();
      fCtx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        fCtx.lineTo(poly[i].x, poly[i].y);
      }
      fCtx.closePath();
      fCtx.clip();

      fCtx.translate(px, py);
      if (player.lanternOn !== false) {
        // High-efficiency unified feathered lantern beam (destination-out requires solid alpha 1.0 to clear darkness)
        const penumbraFovHalf = fovHalf * 1.18;
        fCtx.fillStyle = this.getLanternPunchGradient(fCtx, range);
        fCtx.beginPath();
        fCtx.moveTo(0, 0);
        fCtx.arc(0, 0, range, aimAngle - penumbraFovHalf, aimAngle + penumbraFovHalf);
        fCtx.closePath();
        fCtx.fill();

        // Proximity awareness circle: soft ambient glow around the combatant
        const proxRadius = this.proximityRadius * 1.15;
        fCtx.fillStyle = this.getProxPunchGradient(fCtx, proxRadius);
        fCtx.beginPath();
        fCtx.arc(0, 0, proxRadius, 0, Math.PI * 2);
        fCtx.fill();
      } else {
        const proxRadius = this.proximityRadius * 0.70;
        fCtx.fillStyle = this.getProxPunchGradient(fCtx, proxRadius);
        fCtx.beginPath();
        fCtx.arc(0, 0, proxRadius, 0, Math.PI * 2);
        fCtx.fill();
      }
      fCtx.restore();
    } else if (!isPlayerAlive && player) {
      // Dead player: lantern extinguished, soft dying ember glow around wreck only (34px)
      const px = player.renderX ?? player.x;
      const py = player.renderY ?? player.y;
      fCtx.save();
      fCtx.translate(px, py);
      fCtx.fillStyle = this.getWreckPunchGradient(fCtx, 34);
      fCtx.beginPath();
      fCtx.arc(0, 0, 34, 0, Math.PI * 2);
      fCtx.fill();
      fCtx.restore();
    }

    // Cache polygon and transform data for secondary lighter glow pass reusing scratch pool
    if (!this._scratchOthersPassData) this._scratchOthersPassData = [];
    let passDataCount = 0;

    // 3b. Punch out lantern beams for Allies (Enemies only punch lamp glow, beams drawn on mainCtx over darkness)
    for (let cIdx = 0; cIdx < activeOthers.length; cIdx++) {
      const c = activeOthers[cIdx];
      const cPoly = this.computePolygon(c, segments);
      if (!cPoly || cPoly.length < 3) continue;

      const cx = c.renderX ?? c.x;
      const cy = c.renderY ?? c.y;
      const cAngle = c.angle !== undefined ? c.angle : (c.aimAngle ?? 0);
      const cFov = c.fov ?? this.lanternFov;
      const cFovHalf = cFov / 2;
      const cRange = c.range ?? c.lanternRange ?? this.lanternRange;
      const isAlly = Boolean(myTeam && c.team && c.team === myTeam);

      let item = this._scratchOthersPassData[passDataCount];
      if (!item) {
        item = { c: null, cPoly: null, cx: 0, cy: 0, cAngle: 0, cFov: 0, cFovHalf: 0, cRange: 0, isAlly: false };
        this._scratchOthersPassData[passDataCount] = item;
      }
      item.c = c;
      item.cPoly = cPoly;
      item.cx = cx;
      item.cy = cy;
      item.cAngle = cAngle;
      item.cFov = cFov;
      item.cFovHalf = cFovHalf;
      item.cRange = cRange;
      item.isAlly = isAlly;
      passDataCount++;

      fCtx.save();
      fCtx.beginPath();
      fCtx.moveTo(cPoly[0].x, cPoly[0].y);
      for (let i = 1; i < cPoly.length; i++) {
        fCtx.lineTo(cPoly[i].x, cPoly[i].y);
      }
      fCtx.closePath();
      fCtx.clip();

      if (isAlly) {
        fCtx.translate(cx, cy);
        const allyPenumbraHalf = cFovHalf * 1.18;
        fCtx.fillStyle = this.getLanternPunchGradient(fCtx, cRange);
        fCtx.beginPath();
        fCtx.moveTo(0, 0);
        fCtx.arc(0, 0, cRange, cAngle - allyPenumbraHalf, cAngle + allyPenumbraHalf);
        fCtx.closePath();
        fCtx.fill();

        // Ally proximity circle
        fCtx.fillStyle = this.getProxPunchGradient(fCtx, 45);
        fCtx.beginPath();
        fCtx.arc(0, 0, 45, 0, Math.PI * 2);
        fCtx.fill();
      }
      fCtx.restore();
    }

    // 3c. Punch out stationary Map Lanterns (Victorian street lamps / wall fixtures)
    for (let lIdx = 0; lIdx < activeMapLanterns.length; lIdx++) {
      const l = activeMapLanterns[lIdx];
      const lx = l.x !== undefined ? l.x : (l.col !== undefined ? l.col * ts + ts / 2 : 0);
      const ly = l.y !== undefined ? l.y : (l.row !== undefined ? l.row * ts + ts / 2 : 0);
      const lr = l.radius || defaultMapLanternRadius;

      const lPoly = this.computeMapLanternPolygon(l, lx, ly, lr, segments);
      if (!lPoly || lPoly.length < 3) continue;

      fCtx.save();
      fCtx.beginPath();
      fCtx.moveTo(lPoly[0].x, lPoly[0].y);
      for (let i = 1; i < lPoly.length; i++) {
        fCtx.lineTo(lPoly[i].x, lPoly[i].y);
      }
      fCtx.closePath();
      fCtx.clip();

      fCtx.translate(lx, ly);
      fCtx.fillStyle = this.getMapLanternPunchGradient(fCtx, lr);
      fCtx.beginPath();
      fCtx.arc(0, 0, lr, 0, Math.PI * 2);
      fCtx.fill();
      fCtx.restore();
    }

    fCtx.restore(); // Restore destination-out clipping & transform
    fCtx.restore(); // Restore fogCtx base state

    // 4. Composite the darkness mask over the main arena canvas
    mainCtx.save();
    mainCtx.drawImage(this.fogCanvas, 0, 0);

    // 5. Volumetric Light Beams and Atmospheric Steam Tint Pass ('lighter')
    mainCtx.globalCompositeOperation = 'lighter';
    mainCtx.save();
    if (typeof mainCtx.scale === 'function') {
      mainCtx.scale(zoom, zoom);
    }
    mainCtx.translate(-camX, -camY);

    // 5a. Local Player Soft Volumetric Beam Glow
    if (isPlayerAlive && poly && poly.length >= 3) {
      const px = player.renderX ?? player.x;
      const py = player.renderY ?? player.y;
      const aimAngle = player.angle !== undefined ? player.angle : (player.aimAngle ?? 0);
      const fov = player.fov ?? this.lanternFov;
      const fovHalf = fov / 2;
      const range = player.range ?? player.lanternRange ?? this.lanternRange;

      mainCtx.save();
      mainCtx.beginPath();
      mainCtx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        mainCtx.lineTo(poly[i].x, poly[i].y);
      }
      mainCtx.closePath();
      mainCtx.clip();

      mainCtx.translate(px, py);
      if (player.lanternOn !== false) {
        // Broad soft volumetric steam mist glow
        const mistFovHalf = fovHalf * 1.18;
        mainCtx.fillStyle = this.getLocalMistGradient(mainCtx, range * 0.98);
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        mainCtx.arc(0, 0, range * 0.98, aimAngle - mistFovHalf, aimAngle + mistFovHalf);
        mainCtx.closePath();
        mainCtx.fill();

        // Core focused warm steam cone with smooth natural falloff
        mainCtx.fillStyle = this.getLocalGlowGradient(mainCtx, range * 0.94);
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        mainCtx.arc(0, 0, range * 0.94, aimAngle - fovHalf * 0.85, aimAngle + fovHalf * 0.85);
        mainCtx.closePath();
        mainCtx.fill();

        // Soft core lantern housing bloom
        const bloomRadius = this.proximityRadius * 0.9;
        mainCtx.fillStyle = this.getLocalCoreBloomGradient(mainCtx, bloomRadius);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, bloomRadius, 0, Math.PI * 2);
        mainCtx.fill();
      } else {
        const bloomRadius = this.proximityRadius * 0.45;
        mainCtx.fillStyle = this.getLocalCoreBloomGradient(mainCtx, bloomRadius);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, bloomRadius, 0, Math.PI * 2);
        mainCtx.fill();
      }
      mainCtx.restore();
    }

    // 5b. Allies and Opponents' Volumetric Lantern Beams (Softened & No Hard Stroked Lines)
    for (let idx = 0; idx < passDataCount; idx++) {
      const item = this._scratchOthersPassData[idx];
      const { cPoly, cx, cy, cAngle, cFovHalf, cRange, isAlly } = item;

      mainCtx.save();
      // Clip to obstacle visibility polygon so light beam stops realistically at walls
      mainCtx.beginPath();
      mainCtx.moveTo(cPoly[0].x, cPoly[0].y);
      for (let i = 1; i < cPoly.length; i++) {
        mainCtx.lineTo(cPoly[i].x, cPoly[i].y);
      }
      mainCtx.closePath();
      mainCtx.clip();
      mainCtx.translate(cx, cy);

      if (isAlly) {
        // Ally: Soft Cool Cyan / Cobalt Steam-Lantern Beam
        const allyMistHalf = cFovHalf * 1.18;
        mainCtx.fillStyle = this.getAllyMistGradient(mainCtx, cRange * 0.98);
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        mainCtx.arc(0, 0, cRange * 0.98, cAngle - allyMistHalf, cAngle + allyMistHalf);
        mainCtx.closePath();
        mainCtx.fill();

        mainCtx.fillStyle = this.getAllyGlowGradient(mainCtx, cRange * 0.94);
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        mainCtx.arc(0, 0, cRange * 0.94, cAngle - cFovHalf * 0.85, cAngle + cFovHalf * 0.85);
        mainCtx.closePath();
        mainCtx.fill();

        // Friendly lens flare at ally origin
        mainCtx.fillStyle = this.getAllyLensGradient(mainCtx, 20);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, 20, 0, Math.PI * 2);
        mainCtx.fill();
      } else {
        // Opponent / Enemy: Soft Threatening Incandescent Ember / Hot Steam Searchlight
        const enemyMistHalf = cFovHalf * 1.18;
        mainCtx.fillStyle = this.getEnemyMistGradient(mainCtx, cRange * 0.98);
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        mainCtx.arc(0, 0, cRange * 0.98, cAngle - enemyMistHalf, cAngle + enemyMistHalf);
        mainCtx.closePath();
        mainCtx.fill();

        mainCtx.fillStyle = this.getEnemyGlowGradient(mainCtx, cRange * 0.94);
        mainCtx.beginPath();
        mainCtx.moveTo(0, 0);
        mainCtx.arc(0, 0, cRange * 0.94, cAngle - cFovHalf * 0.85, cAngle + cFovHalf * 0.85);
        mainCtx.closePath();
        mainCtx.fill();

        // Hostile glowing lantern housing cutting softly through darkness
        mainCtx.fillStyle = this.getEnemyLampGradient(mainCtx, 18);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, 18, 0, Math.PI * 2);
        mainCtx.fill();
      }
      mainCtx.restore();
    }

    // 5c. Map Lanterns Atmospheric Volumetric Glow Pass ('lighter')
    for (let lIdx = 0; lIdx < activeMapLanterns.length; lIdx++) {
      const l = activeMapLanterns[lIdx];
      const lx = l.x !== undefined ? l.x : (l.col !== undefined ? l.col * ts + ts / 2 : 0);
      const ly = l.y !== undefined ? l.y : (l.row !== undefined ? l.row * ts + ts / 2 : 0);
      const lr = l.radius || defaultMapLanternRadius;
      const lPoly = l._cachedPoly;

      if (lPoly && lPoly.length >= 3) {
        mainCtx.save();
        mainCtx.beginPath();
        mainCtx.moveTo(lPoly[0].x, lPoly[0].y);
        for (let i = 1; i < lPoly.length; i++) {
          mainCtx.lineTo(lPoly[i].x, lPoly[i].y);
        }
        mainCtx.closePath();
        mainCtx.clip();
        mainCtx.translate(lx, ly);

        // 1. Broad soft amber/gold ambient pool
        mainCtx.fillStyle = this.getMapAmbientGradient(mainCtx, lr);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, lr, 0, Math.PI * 2);
        mainCtx.fill();

        // 2. Focused warm lantern light pool
        mainCtx.fillStyle = this.getMapPoolGradient(mainCtx, lr * 0.52);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, lr * 0.52, 0, Math.PI * 2);
        mainCtx.fill();

        // 3. Bright incandescent lamp filament core bloom (warm Victorian glow)
        mainCtx.fillStyle = this.getMapBloomGradient(mainCtx, 22);
        mainCtx.beginPath();
        mainCtx.arc(0, 0, 22, 0, Math.PI * 2);
        mainCtx.fill();

        mainCtx.restore();
      }
    }

    mainCtx.restore(); // Restore world transform on mainCtx
    mainCtx.restore(); // Restore mainCtx base state
  }

  /**
   * Fallback direct masking for environments without separate offscreen canvas support.
   */
  renderDirectMask(ctx, player, segments, camera, width, height, otherCombatants = []) {
    const camX = camera.x || 0;
    const camY = camera.y || 0;
    const zoom = camera.zoom || 1.0;
    const px = player.renderX ?? player.x;
    const py = player.renderY ?? player.y;

    const poly = this.computePolygon(player, segments);
    if (!poly || poly.length < 3) return;

    ctx.save();
    // Invert mask using even-odd fill rule: outer rectangle minus visibility polygon
    ctx.fillStyle = this.darknessColor;
    ctx.beginPath();
    ctx.rect(0, 0, width, height);

    ctx.moveTo((poly[0].x - camX) * zoom, (poly[0].y - camY) * zoom);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo((poly[i].x - camX) * zoom, (poly[i].y - camY) * zoom);
    }
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
  }
}
