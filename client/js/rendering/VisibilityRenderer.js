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

    // 3a. Punch local player's vision (100% clarity)
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

      const lanternGrad = fCtx.createRadialGradient(px, py, 0, px, py, range);
      lanternGrad.addColorStop(0, 'rgba(255, 235, 180, 1.0)');
      lanternGrad.addColorStop(0.35, 'rgba(255, 207, 72, 0.95)');
      lanternGrad.addColorStop(0.70, 'rgba(184, 115, 51, 0.75)');
      lanternGrad.addColorStop(1.0, 'rgba(112, 56, 22, 0.0)');

      fCtx.fillStyle = lanternGrad;
      fCtx.beginPath();
      fCtx.moveTo(px, py);
      fCtx.arc(px, py, range, aimAngle - fovHalf, aimAngle + fovHalf);
      fCtx.closePath();
      fCtx.fill();

      // Proximity awareness circle
      const proxGrad = fCtx.createRadialGradient(px, py, 0, px, py, this.proximityRadius);
      proxGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      proxGrad.addColorStop(0.60, 'rgba(255, 240, 200, 0.90)');
      proxGrad.addColorStop(1.0, 'rgba(255, 240, 200, 0.0)');

      fCtx.fillStyle = proxGrad;
      fCtx.beginPath();
      fCtx.arc(px, py, this.proximityRadius, 0, Math.PI * 2);
      fCtx.fill();
      fCtx.restore();
    }

    // Cache polygon and transform data for secondary lighter glow pass
    const othersPassData = [];

    // 3b. Punch out lantern beams for Allies and Enemies
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
        // Ally: Clears fog for shared team vision
        const allyGrad = fCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange);
        allyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        allyGrad.addColorStop(0.40, 'rgba(255, 255, 255, 0.85)');
        allyGrad.addColorStop(0.75, 'rgba(255, 255, 255, 0.60)');
        allyGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

        fCtx.fillStyle = allyGrad;
        fCtx.beginPath();
        fCtx.moveTo(cx, cy);
        fCtx.arc(cx, cy, cRange, cAngle - cFovHalf, cAngle + cFovHalf);
        fCtx.closePath();
        fCtx.fill();

        // Ally proximity circle
        const allyProx = fCtx.createRadialGradient(cx, cy, 0, cx, cy, 40);
        allyProx.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        allyProx.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = allyProx;
        fCtx.beginPath();
        fCtx.arc(cx, cy, 40, 0, Math.PI * 2);
        fCtx.fill();
      } else {
        // Opponent / Enemy: Atmospheric illumination revealing floor/walls where their searchlight points
        const enemyGrad = fCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange);
        enemyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.70)');
        enemyGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
        enemyGrad.addColorStop(0.70, 'rgba(255, 255, 255, 0.35)');
        enemyGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

        fCtx.fillStyle = enemyGrad;
        fCtx.beginPath();
        fCtx.moveTo(cx, cy);
        fCtx.arc(cx, cy, cRange, cAngle - cFovHalf, cAngle + cFovHalf);
        fCtx.closePath();
        fCtx.fill();

        // Glowing hostile lamp housing punched through fog
        const lampPunch = fCtx.createRadialGradient(cx, cy, 0, cx, cy, 26);
        lampPunch.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        lampPunch.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        fCtx.fillStyle = lampPunch;
        fCtx.beginPath();
        fCtx.arc(cx, cy, 26, 0, Math.PI * 2);
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

    // 5a. Local Player Beam Glow
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

      const glowGrad = mainCtx.createRadialGradient(px, py, 0, px, py, range);
      glowGrad.addColorStop(0, 'rgba(255, 207, 72, 0.22)');
      glowGrad.addColorStop(0.50, 'rgba(184, 115, 51, 0.10)');
      glowGrad.addColorStop(1.0, 'rgba(184, 115, 51, 0.0)');

      mainCtx.fillStyle = glowGrad;
      mainCtx.beginPath();
      mainCtx.moveTo(px, py);
      mainCtx.arc(px, py, range, aimAngle - fovHalf, aimAngle + fovHalf);
      mainCtx.closePath();
      mainCtx.fill();

      const coreGrad = mainCtx.createRadialGradient(px, py, 0, px, py, this.proximityRadius * 0.8);
      coreGrad.addColorStop(0, 'rgba(255, 242, 178, 0.25)');
      coreGrad.addColorStop(1.0, 'rgba(255, 207, 72, 0.0)');

      mainCtx.fillStyle = coreGrad;
      mainCtx.beginPath();
      mainCtx.arc(px, py, this.proximityRadius * 0.8, 0, Math.PI * 2);
      mainCtx.fill();
      mainCtx.restore();
    }

    // 5b. Allies and Opponents' Volumetric Lantern Beams
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
        // Ally: Cool Cyan / Cobalt Steam-Lantern Beam
        const allyGlow = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange);
        allyGlow.addColorStop(0, 'rgba(100, 180, 255, 0.38)');
        allyGlow.addColorStop(0.40, 'rgba(60, 140, 240, 0.20)');
        allyGlow.addColorStop(1.0, 'rgba(30, 90, 220, 0.0)');

        mainCtx.fillStyle = allyGlow;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.arc(cx, cy, cRange, cAngle - cFovHalf, cAngle + cFovHalf);
        mainCtx.closePath();
        mainCtx.fill();

        // Friendly lens flare at ally origin
        const allyLens = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, 18);
        allyLens.addColorStop(0, 'rgba(200, 235, 255, 0.85)');
        allyLens.addColorStop(0.5, 'rgba(74, 144, 226, 0.40)');
        allyLens.addColorStop(1.0, 'rgba(74, 144, 226, 0.0)');
        mainCtx.fillStyle = allyLens;
        mainCtx.beginPath();
        mainCtx.arc(cx, cy, 18, 0, Math.PI * 2);
        mainCtx.fill();
      } else {
        // Opponent / Enemy: Threatening Incandescent Ember / Hot Steam-Brass Searchlight
        const enemyGlow = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, cRange);
        enemyGlow.addColorStop(0, 'rgba(255, 130, 50, 0.42)');
        enemyGlow.addColorStop(0.40, 'rgba(255, 80, 30, 0.22)');
        enemyGlow.addColorStop(1.0, 'rgba(200, 40, 15, 0.0)');

        mainCtx.fillStyle = enemyGlow;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.arc(cx, cy, cRange, cAngle - cFovHalf, cAngle + cFovHalf);
        mainCtx.closePath();
        mainCtx.fill();

        // Outer beam boundary guide lines for sharp searchlight aesthetic
        const leftEdgeX = cx + Math.cos(cAngle - cFovHalf) * cRange;
        const leftEdgeY = cy + Math.sin(cAngle - cFovHalf) * cRange;
        const rightEdgeX = cx + Math.cos(cAngle + cFovHalf) * cRange;
        const rightEdgeY = cy + Math.sin(cAngle + cFovHalf) * cRange;

        const edgeGrad1 = mainCtx.createLinearGradient(cx, cy, leftEdgeX, leftEdgeY);
        edgeGrad1.addColorStop(0, 'rgba(255, 160, 80, 0.45)');
        edgeGrad1.addColorStop(1, 'rgba(255, 80, 20, 0.0)');
        mainCtx.strokeStyle = edgeGrad1;
        mainCtx.lineWidth = 1.5;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.lineTo(leftEdgeX, leftEdgeY);
        mainCtx.stroke();

        const edgeGrad2 = mainCtx.createLinearGradient(cx, cy, rightEdgeX, rightEdgeY);
        edgeGrad2.addColorStop(0, 'rgba(255, 160, 80, 0.45)');
        edgeGrad2.addColorStop(1, 'rgba(255, 80, 20, 0.0)');
        mainCtx.strokeStyle = edgeGrad2;
        mainCtx.lineWidth = 1.5;
        mainCtx.beginPath();
        mainCtx.moveTo(cx, cy);
        mainCtx.lineTo(rightEdgeX, rightEdgeY);
        mainCtx.stroke();

        // Hostile glowing lantern housing cutting through darkness
        const enemyLamp = mainCtx.createRadialGradient(cx, cy, 0, cx, cy, 16);
        enemyLamp.addColorStop(0, 'rgba(255, 240, 190, 0.95)');
        enemyLamp.addColorStop(0.40, 'rgba(255, 110, 40, 0.50)');
        enemyLamp.addColorStop(1.0, 'rgba(255, 60, 20, 0.0)');
        mainCtx.fillStyle = enemyLamp;
        mainCtx.beginPath();
        mainCtx.arc(cx, cy, 16, 0, Math.PI * 2);
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
