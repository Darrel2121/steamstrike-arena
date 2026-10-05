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

  /**
   * Computes the line-of-sight visibility polygon for an observer in world coordinates.
   * @param {{x: number, y: number, renderX?: number, renderY?: number, angle?: number, fov?: number, range?: number}} observer
   * @param {Array<Object>} segments
   * @returns {Array<{x: number, y: number, angle: number}>}
   */
  computePolygon(observer, segments) {
    const obsX = observer.renderX ?? observer.x;
    const obsY = observer.renderY ?? observer.y;
    const obs = (obsX !== observer.x || obsY !== observer.y)
      ? { ...observer, x: obsX, y: obsY }
      : observer;

    this.lastPolygon = computeVisibilityPolygon(
      obs,
      segments,
      observer.angle ?? 0,
      observer.fov ?? this.lanternFov,
      observer.range ?? this.lanternRange
    );
    return this.lastPolygon;
  }

  /**
   * Renders Layer 4: The Darkness Fog of War and Directional Lantern Mask.
   * Punches out the lantern beam and proximity circle through the darkness mask,
   * clipped strictly to the raycast visibility polygon so solid walls cast realistic shadows.
   *
   * @param {CanvasRenderingContext2D} mainCtx - Main destination Canvas 2D context
   * @param {{x: number, y: number, renderX?: number, renderY?: number, angle?: number, fov?: number, range?: number}} player - Observer entity
   * @param {Array<Object>} segments - Map line segments for occlusion
   * @param {{x: number, y: number, width?: number, height?: number}} [camera] - Viewport camera
   */
  renderDarknessMask(mainCtx, player, segments = [], camera = { x: 0, y: 0 }, otherCombatants = []) {
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

    // Filter living other combatants with active lanterns
    const activeOthers = (otherCombatants || []).filter(c =>
      c && c.id !== player.id && c.isAlive && (c.hp === undefined || c.hp > 0) && c.lanternOn !== false
    );

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
    if (poly && poly.length >= 3) {
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

      // Pass 1: Broad soft penumbra (feathered outer halo to soften cone edges)
      const penumbraFovHalf = fovHalf * 1.22;
      const penumbraGrad = fCtx.createRadialGradient(px, py, 0, px, py, range * 0.98);
      penumbraGrad.addColorStop(0, 'rgba(255, 235, 180, 0.28)');
      penumbraGrad.addColorStop(0.30, 'rgba(255, 210, 80, 0.18)');
      penumbraGrad.addColorStop(0.60, 'rgba(200, 130, 50, 0.08)');
      penumbraGrad.addColorStop(0.85, 'rgba(140, 70, 20, 0.02)');
      penumbraGrad.addColorStop(1.0, 'rgba(100, 40, 10, 0.0)');
      fCtx.fillStyle = penumbraGrad;
      fCtx.beginPath();
      fCtx.moveTo(px, py);
      fCtx.arc(px, py, range * 0.98, aimAngle - penumbraFovHalf, aimAngle + penumbraFovHalf);
      fCtx.closePath();
      fCtx.fill();

      // Pass 2: Mid warm diffusion with very smooth natural falloff
      const midGrad = fCtx.createRadialGradient(px, py, 0, px, py, range);
      midGrad.addColorStop(0, 'rgba(255, 240, 190, 0.52)');
      midGrad.addColorStop(0.25, 'rgba(255, 215, 90, 0.40)');
      midGrad.addColorStop(0.50, 'rgba(220, 155, 60, 0.24)');
      midGrad.addColorStop(0.75, 'rgba(180, 105, 35, 0.10)');
      midGrad.addColorStop(0.90, 'rgba(140, 70, 20, 0.02)');
      midGrad.addColorStop(1.0, 'rgba(100, 40, 10, 0.0)');
      fCtx.fillStyle = midGrad;
      fCtx.beginPath();
      fCtx.moveTo(px, py);
      fCtx.arc(px, py, range, aimAngle - fovHalf, aimAngle + fovHalf);
      fCtx.closePath();
      fCtx.fill();

      // Pass 3: Concentrated core beam (warm alchemical lantern filament)
      const coreFovHalf = fovHalf * 0.72;
      const coreGrad = fCtx.createRadialGradient(px, py, 0, px, py, range * 0.94);
      coreGrad.addColorStop(0, 'rgba(255, 250, 220, 0.65)');
      coreGrad.addColorStop(0.25, 'rgba(255, 225, 120, 0.48)');
      coreGrad.addColorStop(0.50, 'rgba(230, 170, 70, 0.26)');
      coreGrad.addColorStop(0.75, 'rgba(190, 115, 40, 0.08)');
      coreGrad.addColorStop(0.90, 'rgba(140, 65, 20, 0.01)');
      coreGrad.addColorStop(1.0, 'rgba(100, 40, 10, 0.0)');
      fCtx.fillStyle = coreGrad;
      fCtx.beginPath();
      fCtx.moveTo(px, py);
      fCtx.arc(px, py, range * 0.94, aimAngle - coreFovHalf, aimAngle + coreFovHalf);
      fCtx.closePath();
      fCtx.fill();

      // Proximity awareness circle: soft ambient glow around the combatant
      const proxRadius = this.proximityRadius * 1.15;
      const proxGrad = fCtx.createRadialGradient(px, py, 0, px, py, proxRadius);
      proxGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      proxGrad.addColorStop(0.25, 'rgba(255, 248, 220, 0.88)');
      proxGrad.addColorStop(0.50, 'rgba(255, 235, 180, 0.52)');
      proxGrad.addColorStop(0.75, 'rgba(220, 180, 100, 0.18)');
      proxGrad.addColorStop(0.90, 'rgba(180, 130, 60, 0.04)');
      proxGrad.addColorStop(1.0, 'rgba(120, 80, 30, 0.0)');

      fCtx.fillStyle = proxGrad;
      fCtx.beginPath();
      fCtx.arc(px, py, proxRadius, 0, Math.PI * 2);
      fCtx.fill();
      fCtx.restore();
    }

    // Cache polygon and transform data for secondary lighter glow pass
    const othersPassData = [];

    // 3b. Punch out lantern beams for Allies and Enemies with soft feathered gradients
    for (const c of activeOthers) {
      const cPoly = this.computePolygon(c, segments);
      if (!cPoly || cPoly.length < 3) continue;

      const cx = c.renderX ?? c.x;
      const cy = c.renderY ?? c.y;
      const cAngle = c.angle !== undefined ? c.angle : (c.aimAngle ?? 0);
      const cFov = c.fov ?? this.lanternFov;
      const cFovHalf = cFov / 2;
      const cRange = c.range ?? c.lanternRange ?? this.lanternRange;
      const isAlly = Boolean(myTeam && c.team && c.team === myTeam);

      othersPassData.push({ c, cPoly, cx, cy, cAngle, cFov, cFovHalf, cRange, isAlly });

      fCtx.save();
      fCtx.beginPath();
      fCtx.moveTo(cPoly[0].x, cPoly[0].y);
      for (let i = 1; i < cPoly.length; i++) {
        fCtx.lineTo(cPoly[i].x, cPoly[i].y);
      }
      fCtx.closePath();
      fCtx.clip();

      if (isAlly) {
        // Ally: Soft multi-layered team vision
        const allyPenumbraHalf = cFovHalf * 1.22;
        const allyPenumbra = fCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange * 0.98);
        allyPenumbra.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
        allyPenumbra.addColorStop(0.50, 'rgba(255, 255, 255, 0.12)');
        allyPenumbra.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = allyPenumbra;
        fCtx.beginPath();
        fCtx.moveTo(cx, cy);
        fCtx.arc(cx, cy, cRange * 0.98, cAngle - allyPenumbraHalf, cAngle + allyPenumbraHalf);
        fCtx.closePath();
        fCtx.fill();

        const allyGrad = fCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange);
        allyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.90)');
        allyGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.65)');
        allyGrad.addColorStop(0.70, 'rgba(255, 255, 255, 0.25)');
        allyGrad.addColorStop(0.90, 'rgba(255, 255, 255, 0.05)');
        allyGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = allyGrad;
        fCtx.beginPath();
        fCtx.moveTo(cx, cy);
        fCtx.arc(cx, cy, cRange, cAngle - cFovHalf, cAngle + cFovHalf);
        fCtx.closePath();
        fCtx.fill();

        // Ally proximity circle
        const allyProx = fCtx.createRadialGradient(cx, cy, 0, cx, cy, 45);
        allyProx.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        allyProx.addColorStop(0.50, 'rgba(255, 255, 255, 0.45)');
        allyProx.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = allyProx;
        fCtx.beginPath();
        fCtx.arc(cx, cy, 45, 0, Math.PI * 2);
        fCtx.fill();
      } else {
        // Opponent / Enemy: Atmospheric illumination with soft feathered cone
        const enemyPenumbraHalf = cFovHalf * 1.20;
        const enemyPenumbra = fCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange * 0.96);
        enemyPenumbra.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
        enemyPenumbra.addColorStop(0.50, 'rgba(255, 255, 255, 0.08)');
        enemyPenumbra.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = enemyPenumbra;
        fCtx.beginPath();
        fCtx.moveTo(cx, cy);
        fCtx.arc(cx, cy, cRange * 0.96, cAngle - enemyPenumbraHalf, cAngle + enemyPenumbraHalf);
        fCtx.closePath();
        fCtx.fill();

        const enemyGrad = fCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange);
        enemyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
        enemyGrad.addColorStop(0.30, 'rgba(255, 255, 255, 0.45)');
        enemyGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0.18)');
        enemyGrad.addColorStop(0.88, 'rgba(255, 255, 255, 0.03)');
        enemyGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = enemyGrad;
        fCtx.beginPath();
        fCtx.moveTo(cx, cy);
        fCtx.arc(cx, cy, cRange, cAngle - cFovHalf, cAngle + cFovHalf);
        fCtx.closePath();
        fCtx.fill();

        // Glowing hostile lamp housing punched softly through fog
        const lampPunch = fCtx.createRadialGradient(cx, cy, 0, cx, cy, 28);
        lampPunch.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        lampPunch.addColorStop(0.50, 'rgba(255, 255, 255, 0.35)');
        lampPunch.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = lampPunch;
        fCtx.beginPath();
        fCtx.arc(cx, cy, 28, 0, Math.PI * 2);
        fCtx.fill();
      }
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
    if (poly && poly.length >= 3) {
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

      // Broad soft volumetric steam mist glow
      const mistFovHalf = fovHalf * 1.18;
      const mistGrad = mainCtx.createRadialGradient(px, py, 0, px, py, range * 0.98);
      mistGrad.addColorStop(0, 'rgba(255, 205, 80, 0.10)');
      mistGrad.addColorStop(0.35, 'rgba(215, 135, 45, 0.05)');
      mistGrad.addColorStop(0.70, 'rgba(160, 85, 20, 0.012)');
      mistGrad.addColorStop(1.0, 'rgba(100, 40, 10, 0.0)');
      mainCtx.fillStyle = mistGrad;
      mainCtx.beginPath();
      mainCtx.moveTo(px, py);
      mainCtx.arc(px, py, range * 0.98, aimAngle - mistFovHalf, aimAngle + mistFovHalf);
      mainCtx.closePath();
      mainCtx.fill();

      // Core focused warm steam cone with smooth natural falloff
      const glowGrad = mainCtx.createRadialGradient(px, py, 0, px, py, range * 0.94);
      glowGrad.addColorStop(0, 'rgba(255, 220, 110, 0.18)');
      glowGrad.addColorStop(0.28, 'rgba(240, 165, 55, 0.10)');
      glowGrad.addColorStop(0.60, 'rgba(195, 105, 30, 0.035)');
      glowGrad.addColorStop(0.85, 'rgba(130, 55, 15, 0.006)');
      glowGrad.addColorStop(1.0, 'rgba(80, 30, 10, 0.0)');
      mainCtx.fillStyle = glowGrad;
      mainCtx.beginPath();
      mainCtx.moveTo(px, py);
      mainCtx.arc(px, py, range * 0.94, aimAngle - fovHalf * 0.85, aimAngle + fovHalf * 0.85);
      mainCtx.closePath();
      mainCtx.fill();

      // Soft core lantern housing bloom
      const bloomRadius = this.proximityRadius * 0.9;
      const coreGrad = mainCtx.createRadialGradient(px, py, 0, px, py, bloomRadius);
      coreGrad.addColorStop(0, 'rgba(255, 245, 185, 0.22)');
      coreGrad.addColorStop(0.35, 'rgba(255, 200, 75, 0.09)');
      coreGrad.addColorStop(0.70, 'rgba(200, 115, 35, 0.02)');
      coreGrad.addColorStop(1.0, 'rgba(120, 50, 15, 0.0)');
      mainCtx.fillStyle = coreGrad;
      mainCtx.beginPath();
      mainCtx.arc(px, py, bloomRadius, 0, Math.PI * 2);
      mainCtx.fill();
      mainCtx.restore();
    }

    // 5b. Allies and Opponents' Volumetric Lantern Beams (Softened & No Hard Stroked Lines)
    for (const item of othersPassData) {
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

      if (isAlly) {
        // Ally: Soft Cool Cyan / Cobalt Steam-Lantern Beam
        const allyMistHalf = cFovHalf * 1.18;
        const allyMist = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange * 0.98);
        allyMist.addColorStop(0, 'rgba(100, 180, 255, 0.16)');
        allyMist.addColorStop(0.45, 'rgba(60, 140, 240, 0.06)');
        allyMist.addColorStop(1.0, 'rgba(20, 80, 210, 0.0)');
        mainCtx.fillStyle = allyMist;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.arc(cx, cy, cRange * 0.98, cAngle - allyMistHalf, cAngle + allyMistHalf);
        mainCtx.closePath();
        mainCtx.fill();

        const allyGlow = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange * 0.94);
        allyGlow.addColorStop(0, 'rgba(120, 200, 255, 0.28)');
        allyGlow.addColorStop(0.35, 'rgba(70, 150, 245, 0.12)');
        allyGlow.addColorStop(0.75, 'rgba(30, 90, 220, 0.025)');
        allyGlow.addColorStop(1.0, 'rgba(15, 50, 180, 0.0)');
        mainCtx.fillStyle = allyGlow;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.arc(cx, cy, cRange * 0.94, cAngle - cFovHalf * 0.85, cAngle + cFovHalf * 0.85);
        mainCtx.closePath();
        mainCtx.fill();

        // Friendly lens flare at ally origin
        const allyLens = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, 20);
        allyLens.addColorStop(0, 'rgba(210, 240, 255, 0.80)');
        allyLens.addColorStop(0.45, 'rgba(74, 144, 226, 0.30)');
        allyLens.addColorStop(1.0, 'rgba(74, 144, 226, 0.0)');
        mainCtx.fillStyle = allyLens;
        mainCtx.beginPath();
        mainCtx.arc(cx, cy, 20, 0, Math.PI * 2);
        mainCtx.fill();
      } else {
        // Opponent / Enemy: Soft Threatening Incandescent Ember / Hot Steam Searchlight
        const enemyMistHalf = cFovHalf * 1.18;
        const enemyMist = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange * 0.98);
        enemyMist.addColorStop(0, 'rgba(255, 120, 40, 0.15)');
        enemyMist.addColorStop(0.45, 'rgba(220, 70, 20, 0.05)');
        enemyMist.addColorStop(1.0, 'rgba(150, 30, 10, 0.0)');
        mainCtx.fillStyle = enemyMist;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.arc(cx, cy, cRange * 0.98, cAngle - enemyMistHalf, cAngle + enemyMistHalf);
        mainCtx.closePath();
        mainCtx.fill();

        const enemyGlow = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange * 0.94);
        enemyGlow.addColorStop(0, 'rgba(255, 150, 60, 0.28)');
        enemyGlow.addColorStop(0.35, 'rgba(255, 90, 30, 0.14)');
        enemyGlow.addColorStop(0.70, 'rgba(200, 45, 15, 0.03)');
        enemyGlow.addColorStop(1.0, 'rgba(120, 20, 5, 0.0)');
        mainCtx.fillStyle = enemyGlow;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.arc(cx, cy, cRange * 0.94, cAngle - cFovHalf * 0.85, cAngle + cFovHalf * 0.85);
        mainCtx.closePath();
        mainCtx.fill();

        // Hostile glowing lantern housing cutting softly through darkness
        const enemyLamp = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, 18);
        enemyLamp.addColorStop(0, 'rgba(255, 240, 190, 0.90)');
        enemyLamp.addColorStop(0.40, 'rgba(255, 110, 40, 0.40)');
        enemyLamp.addColorStop(1.0, 'rgba(255, 60, 20, 0.0)');
        mainCtx.fillStyle = enemyLamp;
        mainCtx.beginPath();
        mainCtx.arc(cx, cy, 18, 0, Math.PI * 2);
        mainCtx.fill();
      }
      mainCtx.restore();
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
