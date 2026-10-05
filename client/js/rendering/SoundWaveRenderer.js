/**
 * Steampunk Acoustic Sound Wave Engine
 * Simulates and renders mechanical acoustic shockwaves and vapor pulses.
 * Rendered OVER the fog layer to penetrate darkness and reveal hidden activity.
 * Includes gear-notched expanding acoustic rings and off-screen directional radar chevrons.
 */

import {
  SOUND_CONFIGS,
  SOUND_SPEED,
  THEME_COLORS
} from '../../../shared/Constants.js';

export class SoundWaveRenderer {
  /**
   * @param {Object} [options]
   */
  constructor(options = {}) {
    this.waves = [];
    this.maxWaves = options.maxWaves || 50;
    this.edgeMargin = options.edgeMargin || 28; // Margin from screen borders for radar chevrons
  }

  /**
   * Adds an acoustic sound event to the active wave simulation.
   * @param {Object} soundEvent
   * @param {number} soundEvent.x - World X coordinate
   * @param {number} soundEvent.y - World Y coordinate
   * @param {string} [soundEvent.type] - 'footstep', 'gunfire', 'reload'
   * @param {number} [soundEvent.intensity] - Intensity multiplier (default: 1.0)
   * @param {number} [soundEvent.duration] - Custom duration in seconds
   * @param {number} [soundEvent.maxRadius] - Custom max radius in pixels
   */
  addSound(soundEvent) {
    if (!soundEvent || typeof soundEvent.x !== 'number' || typeof soundEvent.y !== 'number') return;

    // Normalize type (handle 'step' as 'footstep')
    let type = soundEvent.type || 'footstep';
    if (type === 'step') type = 'footstep';

    const config = SOUND_CONFIGS[type] || SOUND_CONFIGS.footstep;

    const wave = {
      id: soundEvent.id || `snd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      x: soundEvent.x,
      y: soundEvent.y,
      type: type,
      intensity: soundEvent.intensity ?? config.intensity ?? 1.0,
      duration: soundEvent.duration ?? config.duration ?? 1.0,
      maxRadius: soundEvent.maxRadius ?? config.maxRadius ?? 100,
      baseColor: config.color || THEME_COLORS.soundFootstep,
      elapsed: 0,
      rotation: Math.random() * Math.PI * 2
    };

    this.waves.push(wave);

    // Limit active waves count
    if (this.waves.length > this.maxWaves) {
      this.waves.shift();
    }
  }

  /**
   * Updates all active sound waves by time delta.
   * @param {number} dt - Elapsed seconds
   */
  update(dt = 0.016) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.elapsed += dt;
      w.rotation += dt * 1.5; // Rotate steampunk gear teeth
      if (w.elapsed >= w.duration) {
        this.waves.splice(i, 1);
      }
    }
  }

  /**
   * Renders Layer 5: Visual Acoustic Sound Waves (penetrable through fog).
   * Renders on-screen expanding gear-teeth shockwaves and off-screen border radar chevrons.
   *
   * @param {CanvasRenderingContext2D} ctx - Main canvas context
   * @param {{x: number, y: number, width?: number, height?: number}} camera - Viewport camera
   * @param {number} [viewportWidth]
   * @param {number} [viewportHeight]
   */
  render(ctx, camera = { x: 0, y: 0 }, viewportWidth, viewportHeight) {
    if (!ctx || this.waves.length === 0) return;

    const width = viewportWidth || camera.width || ctx.canvas?.width || 800;
    const height = viewportHeight || camera.height || ctx.canvas?.height || 600;
    const camX = camera.x || 0;
    const camY = camera.y || 0;
    const zoom = camera.zoom || 1.0;

    const centerX = width / 2;
    const centerY = height / 2;

    ctx.save();

    for (const wave of this.waves) {
      const progress = Math.min(1.0, wave.elapsed / wave.duration);
      const alpha = Math.max(0, (1.0 - Math.pow(progress, 1.4)) * wave.intensity);
      const currentRadius = progress * wave.maxRadius * zoom;

      // Screen coordinates of sound emission source with zoom
      const screenX = (wave.x - camX) * zoom;
      const screenY = (wave.y - camY) * zoom;

      // Check if sound source or its expanding circle intersects screen viewport
      const isOnScreen =
        screenX + currentRadius >= 0 &&
        screenX - currentRadius <= width &&
        screenY + currentRadius >= 0 &&
        screenY - currentRadius <= height;

      if (isOnScreen) {
        this.renderOnScreenWave(ctx, screenX, screenY, currentRadius, alpha, wave, progress);
      } else {
        // Off-screen sound: draw directional radar chevron along screen borders
        this.renderOffScreenChevron(ctx, screenX, screenY, centerX, centerY, width, height, alpha, wave);
      }
    }

    ctx.restore();
  }

  /**
   * Renders expanding steampunk acoustic pulses on screen with gear teeth dashing.
   */
  renderOnScreenWave(ctx, sx, sy, radius, alpha, wave, progress) {
    ctx.save();

    // Color parsing and tinting
    let strokeRgba, coreFill;
    if (wave.type === 'gunfire') {
      strokeRgba = `rgba(255, 120, 40, ${alpha * 0.9})`;
      coreFill = `rgba(255, 200, 80, ${alpha * 0.5})`;
    } else if (wave.type === 'reload') {
      strokeRgba = `rgba(240, 205, 90, ${alpha * 0.85})`;
      coreFill = `rgba(212, 175, 55, ${alpha * 0.4})`;
    } else {
      // Footstep (cyan vapor pulse)
      strokeRgba = `rgba(80, 227, 230, ${alpha * 0.8})`;
      coreFill = `rgba(140, 245, 248, ${alpha * 0.35})`;
    }

    // 1. Primary outer pressure shockwave with Steampunk Gear Teeth ([8, 4] dash pattern)
    ctx.strokeStyle = strokeRgba;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 4]);
    ctx.lineDashOffset = wave.rotation * 10;

    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, radius), 0, Math.PI * 2);
    ctx.stroke();

    // 2. Secondary internal harmonic ring
    if (radius > 18) {
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -wave.rotation * 8;
      ctx.beginPath();
      ctx.arc(sx, sy, radius * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 3. Tertiary inner echo ripple
    if (radius > 35) {
      ctx.lineWidth = 1.0;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, radius * 0.32, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Origin mechanical impact ping
    if (progress < 0.4) {
      const pingAlpha = (1.0 - progress / 0.4) * alpha;
      ctx.setLineDash([]);
      ctx.fillStyle = coreFill;
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5 * (1 - progress), 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = strokeRgba;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renders off-screen directional radar chevrons along canvas borders.
   * Directs the player towards gunshots or footsteps occurring outside their current view.
   */
  renderOffScreenChevron(ctx, sx, sy, cx, cy, width, height, alpha, wave) {
    ctx.save();

    const dx = sx - cx;
    const dy = sy - cy;
    const angle = Math.atan2(dy, dx);

    // Inset rectangle bounds
    const m = this.edgeMargin;
    const halfW = width / 2 - m;
    const halfH = height / 2 - m;

    // Intersect vector from center with border box
    const scaleX = Math.abs(dx) > 1e-4 ? halfW / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 1e-4 ? halfH / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);

    const edgeX = cx + dx * scale;
    const edgeY = cy + dy * scale;

    // Chevron color palette
    let chevronColor;
    if (wave.type === 'gunfire') {
      chevronColor = `rgba(255, 110, 30, ${alpha * 0.95})`;
    } else if (wave.type === 'reload') {
      chevronColor = `rgba(240, 200, 80, ${alpha * 0.85})`;
    } else {
      chevronColor = `rgba(80, 227, 230, ${alpha * 0.85})`;
    }

    ctx.translate(edgeX, edgeY);
    ctx.rotate(angle);

    // Steampunk metallic chevron / arrow notch
    ctx.fillStyle = chevronColor;
    ctx.strokeStyle = '#1a1d24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);

    // Primary arrowhead chevron
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -9);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Secondary trailing chevron notch for gunfire shockwaves
    if (wave.type === 'gunfire') {
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-14, -7);
      ctx.lineTo(-10, 0);
      ctx.lineTo(-14, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Resets all active sound waves.
   */
  clear() {
    this.waves = [];
  }
}
