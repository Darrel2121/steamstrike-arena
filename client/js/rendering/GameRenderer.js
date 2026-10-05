/**
 * Steampunk Tactical Game Renderer
 * Coordinates the full 6-Layer Canvas 2D Rendering Pipeline:
 * Layer 1: Arena Floor & Terrain
 * Layer 2: Arena Obstacles & Cover (2.5D beveled walls & drop shadows)
 * Layer 3: Dynamic Entities (Players, Bots, Pickups, Bullets) — Under Darkness
 * Layer 4: Darkness & Lantern Fog Mask (VisibilityRenderer)
 * Layer 5: Visual Acoustic Sound Waves (SoundWaveRenderer) — Over Darkness
 * Layer 6: Steampunk Tactical HUD (HUD)
 */

import { VisibilityRenderer } from './VisibilityRenderer.js';
import { SoundWaveRenderer } from './SoundWaveRenderer.js';
import { HUD } from '../ui/HUD.js';
import { extractSegmentsFromMap } from '../editor/SegmentExtractor.js';
import {
  TILE_SIZE,
  LANTERN_RANGE,
  LANTERN_FOV_RAD,
  THEME_COLORS
} from '../../../shared/Constants.js';
import { TILE_TYPES } from '../../../shared/MapSchema.js';
import { assetManager } from './AssetManager.js';
import { soundFX } from '../audio/SoundFX.js';

export class GameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = (canvas && typeof canvas.getContext === 'function') ? canvas.getContext('2d') : null;

    this.map = null;
    this.segments = [];
    this.tileSize = TILE_SIZE;

    // Viewport camera with closer tactical zoom (Bullet Echo style)
    this.options = options;
    const baseZoom = options.zoom || 1.45;
    this.camera = {
      x: 0,
      y: 0,
      width: canvas ? canvas.width : 800,
      height: canvas ? canvas.height : 600,
      zoom: baseZoom,
      targetZoom: baseZoom,
      minZoom: options.minZoom || 1.15,
      maxZoom: options.maxZoom || (options.adaptiveZoom ? 4.5 : 1.95),
      smoothSpeed: options.cameraSmoothing || 0.15
    };
    this.userManuallyZoomed = false;

    // Tracking state for camera initialization, aiming, and sound event deduplication
    this.cameraInitialized = false;
    this.lastLocalPlayer = null;
    this.processedSoundIds = new Set();
    this.processedHitIds = new Set();
    this.wreckedEntities = new Map();

    // Bullet impact particles & floating damage numbers
    this.impactParticles = [];
    this.floatingDamageNumbers = [];
    this.screenShake = 0;

    // Subsystems
    this.visibilityRenderer = new VisibilityRenderer(options.visibility || {});
    this.soundWaveRenderer = new SoundWaveRenderer(options.sound || {});
    this.hud = new HUD(options.hud || {});

    // Ambient atmospheric particle system (drifting embers & steam motes)
    this.ambientParticles = [];
    const pCount = 36;
    const cW = canvas?.width || 800;
    const cH = canvas?.height || 600;
    for (let i = 0; i < pCount; i++) {
      this.ambientParticles.push({
        x: Math.random() * cW,
        y: Math.random() * cH,
        size: 1 + Math.random() * 2.2,
        speedX: -0.25 + Math.random() * 0.5,
        speedY: -0.35 - Math.random() * 0.65,
        alpha: 0.25 + Math.random() * 0.55,
        type: Math.random() > 0.4 ? 'ember' : 'steam',
        pulse: Math.random() * Math.PI * 2
      });
    }

    // Texture pattern caching
    this.floorPattern = null;
    this.floorImage = null;
    this.initTextures();
  }

  /**
   * Loads visual textures if running in a browser environment.
   */
  initTextures() {
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.src = '/assets/floor_steampunk.jpg';
      img.onload = () => {
        this.floorImage = img;
        if (this.ctx) {
          try {
            this.floorPattern = this.ctx.createPattern(img, 'repeat');
          } catch (_) {}
        }
      };
    }
  }

  /**
   * Configures the active battle arena map and extracts optimized wall segments.
   * @param {Object} map - BattleMap definition
   */
  setMap(map) {
    this.map = map;
    this.tileSize = map.tileSize || TILE_SIZE;
    this.segments = extractSegmentsFromMap(map);
    this.cameraInitialized = false;
  }

  /**
   * Calculates the on-screen pixel coordinates of the local player.
   * Used for mouse cursor aiming calculations in InputManager.
   * @param {Object} [player] - Optional player entity with world coordinates { x, y }
   * @returns {{ x: number, y: number }}
   */
  getLocalPlayerScreenPosition(player = null) {
    const target = player || this.lastLocalPlayer;
    if (!target) {
      return {
        x: this.camera.width / 2,
        y: this.camera.height / 2
      };
    }

    const tx = target.renderX ?? target.x;
    const ty = target.renderY ?? target.y;

    if (typeof tx !== 'number' || typeof ty !== 'number') {
      return {
        x: this.camera.width / 2,
        y: this.camera.height / 2
      };
    }

    const zoom = this.camera.zoom || 1.0;
    return {
      x: (tx - this.camera.x) * zoom,
      y: (ty - this.camera.y) * zoom
    };
  }

  /**
   * Sets absolute camera zoom level clamped between min and max.
   * @param {number} zoom
   */
  setZoom(zoom) {
    const minZ = this.camera.minZoom || 1.15;
    const maxZ = this.camera.maxZoom || 1.95;
    const clamped = Math.max(minZ, Math.min(maxZ, zoom));
    this.camera.zoom = clamped;
    this.camera.targetZoom = clamped;
  }

  /**
   * Adjusts target zoom level smoothly.
   * @param {number} delta
   */
  adjustZoom(delta) {
    this.userManuallyZoomed = true;
    const minZ = this.camera.minZoom || 1.15;
    const maxZ = this.camera.maxZoom || 1.95;
    const current = this.camera.targetZoom || this.camera.zoom || 1.45;
    this.camera.targetZoom = Math.max(minZ, Math.min(maxZ, current + delta));
  }

  /**
   * Calculates closer tactical zoom to maintain a consistent world field of view.
   * @param {number} width
   * @param {number} height
   * @returns {number}
   */
  calculateTacticalZoom(width, height) {
    const targetW = this.options?.targetWorldWidth || 560;
    const computed = (width || 800) / targetW;
    const minZ = this.camera.minZoom || 1.15;
    const maxZ = this.camera.maxZoom || 4.5;
    return Math.max(minZ, Math.min(maxZ, Math.round(computed * 100) / 100));
  }

  /**
   * Updates camera tracking, sound wave simulations, and UI state.
   * Supports both unified state object and legacy array.
   * @param {number} [dt=0.016] - Elapsed seconds
   * @param {Object|Array} [stateOrPlayers={}] - Game state snapshot or players array
   */
  update(dt = 0.016, stateOrPlayers = {}) {
    let state = stateOrPlayers;
    if (Array.isArray(stateOrPlayers)) {
      state = { players: stateOrPlayers };
    } else if (!state) {
      state = {};
    }

    // 0. Smooth zoom interpolation towards targetZoom
    if (typeof this.camera.targetZoom === 'number' && Math.abs(this.camera.targetZoom - this.camera.zoom) > 0.001) {
      const dtSafe = Math.max(0.001, Math.min(0.1, typeof dt === 'number' ? dt : 0.016));
      this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * (1 - Math.exp(-12.0 * dtSafe));
    }

    const zoom = this.camera.zoom || 1.0;
    const viewWorldW = this.camera.width / zoom;
    const viewWorldH = this.camera.height / zoom;

    // 1. Smooth camera tracking on local player
    const localPlayer = state.localPlayer || (state.players && state.players[0]);
    if (localPlayer) {
      this.lastLocalPlayer = localPlayer;
      const lx = localPlayer.renderX ?? localPlayer.x;
      const ly = localPlayer.renderY ?? localPlayer.y;
      const targetCamX = lx - viewWorldW / 2;
      const targetCamY = ly - viewWorldH / 2;

      // Clamp camera within map bounds if map is larger than viewport
      let clampedX = targetCamX;
      let clampedY = targetCamY;

      if (this.map) {
        const mapPixelWidth = this.map.width * this.tileSize;
        const mapPixelHeight = this.map.height * this.tileSize;

        if (mapPixelWidth > viewWorldW) {
          clampedX = Math.max(0, Math.min(mapPixelWidth - viewWorldW, targetCamX));
        } else {
          clampedX = -(viewWorldW - mapPixelWidth) / 2;
        }

        if (mapPixelHeight > viewWorldH) {
          clampedY = Math.max(0, Math.min(mapPixelHeight - viewWorldH, targetCamY));
        } else {
          clampedY = -(viewWorldH - mapPixelHeight) / 2;
        }
      }

      if (!this.cameraInitialized) {
        this.camera.x = clampedX;
        this.camera.y = clampedY;
        this.cameraInitialized = true;
      } else {
        const dtSafe = Math.max(0.001, Math.min(0.1, typeof dt === 'number' ? dt : 0.016));
        const camFactor = 1 - Math.exp(-14.0 * dtSafe);
        this.camera.x += (clampedX - this.camera.x) * camFactor;
        this.camera.y += (clampedY - this.camera.y) * camFactor;

        if (Math.abs(clampedX - this.camera.x) < 0.25) this.camera.x = clampedX;
        if (Math.abs(clampedY - this.camera.y) < 0.25) this.camera.y = clampedY;
      }

      // Update sound listener position for 2D spatial audio
      soundFX.setListenerPosition(localPlayer.renderX ?? localPlayer.x, localPlayer.renderY ?? localPlayer.y);
    }

    // 2. Ingest any new acoustic sound events from snapshot state
    if (Array.isArray(state.soundEvents)) {
      for (const snd of state.soundEvents) {
        if (!snd) continue;
        const sndId = snd.id || `${snd.x}_${snd.y}_${snd.createdAt || ''}`;
        if (!this.processedSoundIds.has(sndId)) {
          this.processedSoundIds.add(sndId);
          this.soundWaveRenderer.addSound(snd);
        }
      }
      if (this.processedSoundIds.size > 200) {
        this.processedSoundIds.clear();
      }
    }

    // 2.5 Ingest bullet impact events (wall ricochets vs combatant hits)
    if (Array.isArray(state.hitEvents)) {
      for (const hit of state.hitEvents) {
        this.addHitImpact(hit);
      }
    }

    // 3. Update acoustic sound waves simulation
    this.soundWaveRenderer.update(dt);

    // 3.5 Update bullet impact particles & floating combat text
    if (this.impactParticles && this.impactParticles.length > 0) {
      for (let i = this.impactParticles.length - 1; i >= 0; i--) {
        const p = this.impactParticles[i];
        p.x += (p.vx || 0) * dt;
        p.y += (p.vy || 0) * dt;
        p.vx = (p.vx || 0) * 0.91;
        p.vy = (p.vy || 0) * 0.91;
        if (p.isSmoke && typeof p.size === 'number' && typeof p.maxSize === 'number') {
          p.size += (p.maxSize - p.size) * dt * 8.0;
        }
        p.life -= dt;
        p.alpha = Math.max(0, p.life / p.maxLife);
        if (p.life <= 0) {
          this.impactParticles.splice(i, 1);
        }
      }
    }

    if (this.floatingDamageNumbers && this.floatingDamageNumbers.length > 0) {
      for (let i = this.floatingDamageNumbers.length - 1; i >= 0; i--) {
        const d = this.floatingDamageNumbers[i];
        d.y += (d.vy || 0) * dt;
        d.vy = (d.vy || 0) * 0.92;
        d.life -= dt;
        d.alpha = Math.max(0, d.life / d.maxLife);
        if (d.life <= 0) {
          this.floatingDamageNumbers.splice(i, 1);
        }
      }
    }

    // Camera screen shake decay
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 22);
    }

    // 4. Update tactical HUD animations
    if (localPlayer) {
      this.hud.update(dt, localPlayer);
    }

    // 5. Update ambient floating embers and steam motes
    if (Array.isArray(this.ambientParticles)) {
      const w = this.camera.width || 800;
      const h = this.camera.height || 600;
      for (const p of this.ambientParticles) {
        p.x += p.speedX;
        p.y += p.speedY;
        p.pulse += (dt || 0.016) * 3;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
      }
    }
  }

  /**
   * Spawns rich bullet impact visual particles and floating combat numbers.
   * @param {Object} hit - { id, x, y, type: 'wall'|'entity', damage, vx, vy, targetId, shooterId }
   */
  addHitImpact(hit) {
    if (!hit || typeof hit.x !== 'number' || typeof hit.y !== 'number') return;
    if (hit.id) {
      if (this.processedHitIds.has(hit.id)) return;
      this.processedHitIds.add(hit.id);
      if (this.processedHitIds.size > 300) {
        this.processedHitIds.clear();
      }
    }

    const hx = hit.x;
    const hy = hit.y;
    const isEntity = hit.type === 'entity';
    const isLocalTarget = Boolean(this.lastLocalPlayer && hit.targetId === this.lastLocalPlayer.id);
    const isLocalShooter = Boolean(this.lastLocalPlayer && hit.shooterId === this.lastLocalPlayer.id);

    // 1. Play spatial sound effect
    if (isEntity) {
      soundFX.playImpact(true, hx, hy);
    } else {
      soundFX.playRicochet(hx, hy);
      soundFX.playImpact(false, hx, hy);
    }

    // 2. Shake camera on local player damage
    if (isLocalTarget) {
      this.screenShake = Math.max(this.screenShake, 7.5);
    }

    if (!isEntity) {
      // Wall Impact: High-speed golden ricochet sparks + smoke puff
      const bVx = hit.vx || 0;
      const bVy = hit.vy || 0;
      const baseAngle = Math.atan2(-bVy, -bVx);

      const sparkCount = 14 + Math.floor(Math.random() * 6);
      for (let i = 0; i < sparkCount; i++) {
        const spread = (Math.random() - 0.5) * Math.PI * 0.9;
        const angle = baseAngle + spread;
        const speed = 80 + Math.random() * 240;
        const colors = ['#ffffff', '#ffcf48', '#ff9f1c', '#ffe082'];
        this.impactParticles.push({
          x: hx,
          y: hy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.2 + Math.random() * 2.2,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1.0,
          life: 0.22 + Math.random() * 0.20,
          maxLife: 0.42,
          isSpark: true
        });
      }

      // Expanding smoke puff
      this.impactParticles.push({
        x: hx,
        y: hy,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        size: 4,
        maxSize: 18 + Math.random() * 8,
        color: '#b0b8c4',
        alpha: 0.55,
        life: 0.35,
        maxLife: 0.35,
        isSmoke: true
      });
    } else {
      // Entity Impact: Copper automaton shrapnel + incandescent sparks + dark machine oil
      const sparkCount = 18 + Math.floor(Math.random() * 8);
      for (let i = 0; i < sparkCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 200;
        const colors = ['#ff5a5f', '#e28743', '#ffcf48', '#ff9f1c', '#1a1612'];
        this.impactParticles.push({
          x: hx,
          y: hy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.8 + Math.random() * 2.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1.0,
          life: 0.30 + Math.random() * 0.25,
          maxLife: 0.55,
          isSpark: true
        });
      }

      // Floating damage number popup
      const dmg = hit.damage || 35;
      this.floatingDamageNumbers.push({
        x: hx + (Math.random() - 0.5) * 14,
        y: hy - 14,
        text: `-${dmg}`,
        vy: -55,
        alpha: 1.0,
        life: 0.95,
        maxLife: 0.95,
        isLocalTarget,
        isLocalShooter
      });
    }
  }

  /**
   * Adds an acoustic sound event (footstep, gunfire, reload).
   * @param {Object} soundEvent
   */
  addSound(soundEvent) {
    if (soundEvent && soundEvent.id) {
      this.processedSoundIds.add(soundEvent.id);
    }
    this.soundWaveRenderer.addSound(soundEvent);
  }

  /**
   * Registers an eliminated combatant entity to persist permanently as a wrecked chassis.
   * @param {Object} entity
   */
  registerWreck(entity) {
    if (!entity || !entity.id) return;
    if (!this.wreckedEntities.has(entity.id)) {
      this.wreckedEntities.set(entity.id, {
        id: entity.id,
        name: entity.name || (entity.id.startsWith('bot_') ? 'Automaton' : 'Combatant'),
        x: entity.renderX ?? entity.x,
        y: entity.renderY ?? entity.y,
        renderX: entity.renderX ?? entity.x,
        renderY: entity.renderY ?? entity.y,
        angle: entity.angle ?? entity.aimAngle ?? 0,
        isBot: Boolean(entity.isBot || entity.id?.startsWith('bot_')),
        diedAt: Date.now()
      });
    }
  }

  /**
   * Registers a wreck by ID from a current snapshot or players array.
   * @param {string} id
   * @param {Array<Object>} [playersList]
   */
  registerWreckById(id, playersList = []) {
    if (!id) return;
    const found = playersList.find(p => p.id === id);
    if (found) {
      this.registerWreck(found);
    } else if (this.lastLocalPlayer && this.lastLocalPlayer.id === id) {
      this.registerWreck(this.lastLocalPlayer);
    }
  }

  /**
   * Clears registered wrecks for a new match session.
   */
  clearWrecks() {
    this.wreckedEntities.clear();
  }

  /**
   * Immediately removes a wreck by entity ID upon respawn.
   * @param {string} id
   */
  removeWreckById(id) {
    if (!id) return;
    this.wreckedEntities.delete(id);
  }

  /**
   * Centers the viewport camera immediately on a world coordinate (e.g. on respawn).
   * @param {number} x
   * @param {number} y
   */
  centerCameraOn(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const zoom = this.camera.zoom || 1.0;
    const viewWorldW = this.camera.width / zoom;
    const viewWorldH = this.camera.height / zoom;
    this.camera.x = x - viewWorldW / 2;
    this.camera.y = y - viewWorldH / 2;
  }

  /**
   * Forwards match outcome to HUD for in-canvas presentation.
   * @param {Object} outcome
   */
  setMatchOutcome(outcome) {
    if (this.hud && typeof this.hud.setMatchOutcome === 'function') {
      this.hud.setMatchOutcome(outcome);
    }
  }

  /**
   * Clears match outcome on HUD.
   */
  clearMatchOutcome() {
    if (this.hud && typeof this.hud.clearMatchOutcome === 'function') {
      this.hud.clearMatchOutcome();
    }
  }

  /**
   * Forwards in-game notification message to canvas HUD.
   * @param {string} text
   * @param {Object} [options]
   */
  addNotification(text, options) {
    if (this.hud && typeof this.hud.addMessage === 'function') {
      this.hud.addMessage(text, options);
    }
  }

  /**
   * Forwards elimination entry directly to top-right Kill Feed list.
   * @param {Object} entry
   */
  addKillFeed(entry) {
    if (this.hud && typeof this.hud.addKillFeed === 'function') {
      this.hud.addKillFeed(entry);
    }
  }

  /**
   * Executes the full 6-Layer Steampunk Tactical Rendering Pipeline.
   * Supports both unified state object: render({ localPlayer, players, projectiles, pickups, soundEvents })
   * and legacy positional arguments: render(players, projectiles, soundEvents, localPlayer).
   *
   * @param {Object|Array} stateOrPlayers
   * @param {Array} [projectilesArg]
   * @param {Array} [soundEventsArg]
   * @param {Object} [localPlayerArg]
   */
  render(stateOrPlayers = {}, projectilesArg, soundEventsArg, localPlayerArg) {
    const ctx = this.ctx;
    if (!ctx) return;

    // Normalize arguments: support both object options and legacy positional arguments
    let state;
    if (Array.isArray(stateOrPlayers)) {
      state = {
        players: stateOrPlayers,
        projectiles: projectilesArg || [],
        soundEvents: soundEventsArg || [],
        localPlayer: localPlayerArg || (stateOrPlayers.length > 0 ? stateOrPlayers[0] : null)
      };
    } else {
      state = stateOrPlayers || {};
    }

    const localPlayer = state.localPlayer || (state.players && state.players[0]) || { x: 400, y: 300, angle: 0 };
    if (state.localPlayer || (state.players && state.players.length > 0)) {
      this.lastLocalPlayer = localPlayer;
    }

    const width = this.camera.width;
    const height = this.camera.height;

    // Clear frame
    ctx.clearRect(0, 0, width, height);

    // Camera transform into World Coordinates with dynamic tactical zoom & screen shake
    const zoom = this.camera.zoom || 1.0;
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;

    ctx.save();
    if (typeof ctx.scale === 'function') {
      ctx.scale(zoom, zoom);
    }
    ctx.translate(-this.camera.x + shakeX, -this.camera.y + shakeY);

    // ========================================================================
    // LAYER 1: Arena Floor & Terrain
    // ========================================================================
    this.renderLayer1Floor(ctx);

    // ========================================================================
    // LAYER 2: Arena Obstacles & Cover (Beveled Walls & Shadows)
    // ========================================================================
    this.renderLayer2Obstacles(ctx);

    // ========================================================================
    // LAYER 3: Dynamic Entities (Pickups, Remote Players, Bots, Bullets)
    // Drawn BEFORE darkness so entities outside lantern cone are hidden by fog!
    // ========================================================================
    this.renderLayer3Entities(ctx, state);

    ctx.restore(); // Exit World Coordinates

    // ========================================================================
    // LAYER 4: Darkness & Lantern Fog Mask (Punched out in Screen Space)
    // ========================================================================
    const livingOthers = (state.players || []).filter(p => p.id !== localPlayer.id && p.isAlive && (p.hp === undefined || p.hp > 0));
    this.visibilityRenderer.renderDarknessMask(ctx, localPlayer, this.segments, this.camera, livingOthers);

    // ========================================================================
    // LAYER 4.5: Luminous Projectile Tracers (Shine through Darkness & Fog)
    // ========================================================================
    this.renderLayerProjectilesOverDarkness(ctx, state);

    // ========================================================================
    // LAYER 4.7: Tactical Ability FX & Sonar X-Ray Detection (Over Darkness)
    // ========================================================================
    this.renderTacticalAbilitiesOverDarkness(ctx, state);

    // ========================================================================
    // LAYER 4.8: Bullet Impact Sparks, Smoke Puffs & Damage Numbers
    // ========================================================================
    this.renderImpactParticlesAndDamage(ctx);

    // ========================================================================
    // LAYER 5: Visual Acoustic Sound Waves (Visible OVER Darkness)
    // ========================================================================
    this.soundWaveRenderer.render(ctx, this.camera, width, height);

    // ========================================================================
    // LAYER 5.5: Cinematic Vignette & Ambient Atmospheric Motes
    // ========================================================================
    this.renderAtmosphericVfx(ctx, width, height);

    // ========================================================================
    // LAYER 6: Steampunk Tactical HUD (Screen-Space UI)
    // ========================================================================
    this.hud.render(ctx, localPlayer, width, height, state);
  }

  /**
   * Layer 1: Wooden floorboards, iron grates, and brass piping.
   */
  renderLayer1Floor(ctx) {
    if (!this.map) return;
    const mapWidth = this.map.width * this.tileSize;
    const mapHeight = this.map.height * this.tileSize;

    const pattern = assetManager.getFloorPattern(ctx) || this.floorPattern;
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, mapWidth, mapHeight);
    } else {
      // Procedural Steampunk Floor (Cobblestone / Dark Wood Plank)
      ctx.fillStyle = '#181b22';
      ctx.fillRect(0, 0, mapWidth, mapHeight);

      // Floor plank lines
      ctx.strokeStyle = '#12141a';
      ctx.lineWidth = 1;
      for (let y = 0; y < mapHeight; y += this.tileSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mapWidth, y);
        ctx.stroke();
      }
      for (let x = 0; x < mapWidth; x += this.tileSize * 2) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapHeight);
        ctx.stroke();
      }
    }

    this.renderFloorDecorations(ctx);
  }

  /**
   * Layer 2: 2.5D beveled industrial walls, iron plating, drop shadows, and copper machinery.
   */
  renderLayer2Obstacles(ctx) {
    if (!this.map || !this.map.tiles) return;

    const ts = this.tileSize;
    const w = this.map.width;
    const h = this.map.height;

    // Drop shadows for depth
    ctx.fillStyle = 'rgba(5, 7, 10, 0.65)';
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const tile = this.map.tiles[r * w + c];
        if (tile === TILE_TYPES.WALL || tile === TILE_TYPES.OBSTACLE) {
          ctx.fillRect(c * ts + 4, r * ts + 6, ts, ts);
        }
      }
    }

    const wallImg = assetManager.wallImage;
    const obstacleImg = assetManager.obstacleImage;

    // Solid blocks
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const tile = this.map.tiles[r * w + c];
        const x = c * ts;
        const y = r * ts;

        if (tile === TILE_TYPES.WALL) {
          if (wallImg) {
            ctx.drawImage(wallImg, x, y, ts, ts);
            // Subtle 3D industrial bevel overlay
            ctx.fillStyle = 'rgba(255, 230, 160, 0.12)';
            ctx.fillRect(x, y, ts, 2);
            ctx.fillRect(x, y, 2, ts);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(x, y + ts - 2, ts, 2);
            ctx.fillRect(x + ts - 2, y, 2, ts);
          } else {
            // Solid Wall: Dark riveted iron plate
            ctx.fillStyle = '#22262d';
            ctx.fillRect(x, y, ts, ts);

            // Top highlight bevel
            ctx.fillStyle = '#3c434f';
            ctx.fillRect(x, y, ts, 3);
            ctx.fillRect(x, y, 3, ts);

            // Bottom shadow bevel
            ctx.fillStyle = '#14171c';
            ctx.fillRect(x, y + ts - 3, ts, 3);
            ctx.fillRect(x + ts - 3, y, 3, ts);

            // Corner brass rivets
            ctx.fillStyle = '#c59b27';
            ctx.beginPath();
            ctx.arc(x + 4, y + 4, 1.5, 0, Math.PI * 2);
            ctx.arc(x + ts - 4, y + 4, 1.5, 0, Math.PI * 2);
            ctx.arc(x + 4, y + ts - 4, 1.5, 0, Math.PI * 2);
            ctx.arc(x + ts - 4, y + ts - 4, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (tile === TILE_TYPES.OBSTACLE) {
          if (obstacleImg) {
            ctx.drawImage(obstacleImg, x, y, ts, ts);
          } else {
            // Cover / Steam Boiler: Copper warm cylinder / crate
            ctx.fillStyle = '#703816';
            ctx.fillRect(x + 2, y + 2, ts - 4, ts - 4);

            // Copper border
            ctx.strokeStyle = '#b87333';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4);

            // Machinery center dial
            ctx.fillStyle = '#ffcf48';
            ctx.beginPath();
            ctx.arc(x + ts / 2, y + ts / 2, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    this.renderStandingDecorations(ctx);
  }

  renderFloorDecorations(ctx) {
    if (!this.map?.decorations) return;
    const ts = this.tileSize;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;

    for (const decor of this.map.decorations) {
      const x = decor.col * ts + ts / 2;
      const y = decor.row * ts + ts / 2;

      if (decor.type === 'gear') {
        ctx.save();
        ctx.translate(x, y);
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
        ctx.restore();
      } else if (decor.type === 'vent') {
        ctx.save();
        ctx.translate(x, y);
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
        const steamPhase = (Math.sin(now * 0.003 + (x + y)) + 1) / 2;
        ctx.fillStyle = `rgba(220, 245, 255, ${0.1 + steamPhase * 0.25})`;
        ctx.beginPath();
        ctx.arc(0, 0, ts * (0.2 + steamPhase * 0.25), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (decor.type === 'pipes') {
        ctx.save();
        ctx.translate(x, y);
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
        ctx.restore();
      } else if (decor.type === 'crack') {
        ctx.save();
        ctx.translate(x, y);
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

        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (decor.type === 'sign') {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#b8860b';
        ctx.fillRect(-ts * 0.38, -ts * 0.24, ts * 0.76, ts * 0.48);
        ctx.strokeStyle = '#2b1d12';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-ts * 0.38, -ts * 0.24, ts * 0.76, ts * 0.48);

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

        ctx.fillStyle = '#1c202a';
        ctx.fillRect(-ts * 0.28, -ts * 0.10, ts * 0.56, ts * 0.20);
        ctx.fillStyle = '#ffcf48';
        ctx.font = `bold ${Math.max(7, Math.floor(ts * 0.16))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DANGER', 0, 1);
        ctx.restore();
      }
    }
  }

  renderStandingDecorations(ctx) {
    if (!this.map?.decorations) return;
    const ts = this.tileSize;

    for (const decor of this.map.decorations) {
      const x = decor.col * ts + ts / 2;
      const y = decor.row * ts + ts / 2;

      if (decor.type === 'lantern') {
        ctx.save();
        ctx.translate(x, y);
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, ts * 0.8);
        grad.addColorStop(0, 'rgba(255, 207, 72, 0.45)');
        grad.addColorStop(1, 'rgba(255, 207, 72, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, ts * 0.8, 0, Math.PI * 2);
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
        ctx.arc(0, 0, ts * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (decor.type === 'tank') {
        ctx.save();
        ctx.translate(x, y);
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
        ctx.restore();
      } else if (decor.type === 'crate') {
        ctx.save();
        ctx.translate(x, y);
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
        ctx.restore();
      } else if (decor.type === 'bush') {
        ctx.save();
        ctx.translate(x, y);
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
        ctx.restore();
      }
    }
  }

  /**
   * Layer 3: Dynamic entities (pickups, projectiles, remote players, bots, and local player).
   */
  renderLayer3Entities(ctx, state) {
    const players = state.players || [];
    const projectiles = state.projectiles || [];
    const pickups = state.pickups || [];

    // 1. Pickups (Alchemical Health Elixirs & Ammo Drums)
    for (const p of pickups) {
      this.renderPickup(ctx, p);
    }

    // 2. Register any eliminated combatants as persistent wrecks (or clear if respawned alive)
    for (const pl of players) {
      if (!pl.isAlive || (pl.hp !== undefined && pl.hp <= 0)) {
        this.registerWreck(pl);
      } else {
        if (this.wreckedEntities.has(pl.id)) {
          this.wreckedEntities.delete(pl.id);
        }
      }
    }

    // 3. Render all persistent wrecked automatons on the arena floor (stopped, never vanish)
    for (const wreck of this.wreckedEntities.values()) {
      this.renderDestroyedAvatar(ctx, wreck);
    }

    // 4. Physical Infiltrator Smoke Zones (billowing steam & soot clouds)
    if (Array.isArray(state.smokeZones) && state.smokeZones.length > 0) {
      this.renderSmokeZones(ctx, state.smokeZones);
    }

    // 5. Living Players and Bots (rendered on top of floor wrecks)
    for (const pl of players) {
      if (pl.isAlive && (pl.hp === undefined || pl.hp > 0)) {
        const isLocal = state.localPlayer && state.localPlayer.id === pl.id;
        this.renderPlayerAvatar(ctx, pl, isLocal);
      }
    }
  }

  /**
   * Layer 4.5: Renders luminous bullet tracers and incandescent sparks cutting through dark fog.
   */
  renderLayerProjectilesOverDarkness(ctx, state) {
    const projectiles = state.projectiles || [];
    if (!projectiles || projectiles.length === 0) return;

    const zoom = this.camera.zoom || 1.0;
    ctx.save();
    if (typeof ctx.scale === 'function') {
      ctx.scale(zoom, zoom);
    }
    ctx.translate(-this.camera.x, -this.camera.y);
    for (const b of projectiles) {
      this.renderProjectile(ctx, b);
    }
    ctx.restore();
  }

  /**
   * Layer 4.7: Renders active tactical ability visuals and holographic Sonar X-Ray reveals through darkness.
   */
  renderTacticalAbilitiesOverDarkness(ctx, state) {
    const localPlayer = state.localPlayer || (state.players && state.players[0]);
    const players = state.players || [];
    const zoom = this.camera.zoom || 1.0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    ctx.save();
    if (typeof ctx.scale === 'function') {
      ctx.scale(zoom, zoom);
    }
    ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Sharpshooter Sonar Pulses & Enemy X-Ray Detection
    const hasActiveSonar = players.some(p => p.sonarActive && (p.id === localPlayer?.id || (p.team && p.team === localPlayer?.team)));

    for (const pl of players) {
      if (pl.sonarActive && pl.isAlive) {
        const px = pl.renderX ?? pl.x;
        const py = pl.renderY ?? pl.y;
        for (let ring = 1; ring <= 3; ring++) {
          const ringPhase = ((now * 0.0015 + ring * 0.33) % 1);
          const r = ringPhase * 360;
          const alpha = (1 - ringPhase) * 0.75;
          ctx.strokeStyle = `rgba(95, 251, 241, ${alpha})`;
          ctx.lineWidth = 2.5 - ringPhase * 1.5;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Sonar Wallhack / X-Ray target indicators for enemies
    if (hasActiveSonar && localPlayer) {
      for (const pl of players) {
        const isEnemy = pl.id !== localPlayer.id && (!pl.team || pl.team !== localPlayer.team);
        if (isEnemy && pl.isAlive && (pl.hp === undefined || pl.hp > 0)) {
          const ex = pl.renderX ?? pl.x;
          const ey = pl.renderY ?? pl.y;

          ctx.save();
          ctx.translate(ex, ey);

          const scanPulse = (Math.sin(now * 0.008) + 1) / 2;
          ctx.strokeStyle = '#5ffbf1';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 18 + scanPulse * 4, 0, Math.PI * 2);
          ctx.stroke();

          // Tactical Target Brackets [ ]
          const bSize = 22;
          const bCorner = 6;
          ctx.strokeStyle = '#5ffbf1';
          ctx.lineWidth = 2;
          // Top-left
          ctx.beginPath();
          ctx.moveTo(-bSize, -bSize + bCorner);
          ctx.lineTo(-bSize, -bSize);
          ctx.lineTo(-bSize + bCorner, -bSize);
          ctx.stroke();
          // Top-right
          ctx.beginPath();
          ctx.moveTo(bSize - bCorner, -bSize);
          ctx.lineTo(bSize, -bSize);
          ctx.lineTo(bSize, -bSize + bCorner);
          ctx.stroke();
          // Bottom-left
          ctx.beginPath();
          ctx.moveTo(-bSize, bSize - bCorner);
          ctx.lineTo(-bSize, bSize);
          ctx.lineTo(-bSize + bCorner, bSize);
          ctx.stroke();
          // Bottom-right
          ctx.beginPath();
          ctx.moveTo(bSize - bCorner, bSize);
          ctx.lineTo(bSize, bSize);
          ctx.lineTo(bSize, bSize - bCorner);
          ctx.stroke();

          // X-Ray Silhouette
          ctx.fillStyle = 'rgba(95, 251, 241, 0.45)';
          ctx.beginPath();
          ctx.arc(0, 0, 13, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#5ffbf1';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`⌖ ${pl.name || 'TARGET'}`, 0, -bSize - 4);

          ctx.restore();
        }
      }
    }

    // 2. Juggernaut Bastion Force Barrier (curved 120° shield arc)
    for (const pl of players) {
      if (pl.isAlive && (pl.shieldHp > 0 || (pl.classId === 'juggernaut' && pl.abilityActive))) {
        const px = pl.renderX ?? pl.x;
        const py = pl.renderY ?? pl.y;
        const aimAngle = pl.angle ?? pl.aimAngle ?? 0;
        const sHp = pl.shieldHp || 80;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(aimAngle);

        const shieldRadius = 24;
        const arcSpread = Math.PI * 0.65;
        const startArc = -arcSpread / 2;
        const endArc = arcSpread / 2;

        ctx.strokeStyle = 'rgba(255, 207, 72, 0.45)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(0, 0, shieldRadius, startArc, endArc);
        ctx.stroke();

        ctx.strokeStyle = '#5ffbf1';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, shieldRadius, startArc, endArc);
        ctx.stroke();

        const segments = 5;
        ctx.fillStyle = 'rgba(95, 251, 241, 0.3)';
        for (let i = 0; i < segments; i++) {
          const a = startArc + (arcSpread / segments) * (i + 0.5);
          const hx = Math.cos(a) * shieldRadius;
          const hy = Math.sin(a) * shieldRadius;
          ctx.beginPath();
          ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.rotate(-aimAngle);
        ctx.fillStyle = '#1c202a';
        ctx.fillRect(-18, -shieldRadius - 14, 36, 6);
        ctx.fillStyle = '#5ffbf1';
        ctx.fillRect(-17, -shieldRadius - 13, (34 * Math.max(0, sHp)) / 80, 4);
        ctx.strokeStyle = '#c59b27';
        ctx.lineWidth = 1;
        ctx.strokeRect(-18, -shieldRadius - 14, 36, 6);

        ctx.restore();
      }
    }

    // 3. Vanguard Steam Overdrive Jet Plumes
    for (const pl of players) {
      if (pl.isAlive && (pl.overdriveActive || (pl.classId === 'vanguard' && pl.abilityActive))) {
        const px = pl.renderX ?? pl.x;
        const py = pl.renderY ?? pl.y;
        const aimAngle = pl.angle ?? pl.aimAngle ?? 0;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(aimAngle);

        const nozzleYs = [-4, 4];
        for (const ny of nozzleYs) {
          const plumeLen = 22 + Math.random() * 14;
          const pGrad = ctx.createLinearGradient(-8, ny, -8 - plumeLen, ny);
          pGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
          pGrad.addColorStop(0.3, 'rgba(255, 160, 40, 0.85)');
          pGrad.addColorStop(0.7, 'rgba(255, 80, 20, 0.45)');
          pGrad.addColorStop(1, 'rgba(100, 100, 100, 0)');

          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.moveTo(-8, ny - 2);
          ctx.lineTo(-8 - plumeLen, ny - 6);
          ctx.lineTo(-8 - plumeLen, ny + 6);
          ctx.lineTo(-8, ny + 2);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#ffcf48';
          ctx.beginPath();
          ctx.arc(-8 - plumeLen * 0.8, ny + (Math.random() - 0.5) * 6, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    ctx.restore();
  }

  /**
   * Layer 4.8: Renders incandescent ricochet sparks, smoke puffs, and floating combat damage numbers.
   */
  renderImpactParticlesAndDamage(ctx) {
    if ((!this.impactParticles || this.impactParticles.length === 0) &&
        (!this.floatingDamageNumbers || this.floatingDamageNumbers.length === 0)) {
      return;
    }

    const zoom = this.camera.zoom || 1.0;
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;

    ctx.save();
    if (typeof ctx.scale === 'function') {
      ctx.scale(zoom, zoom);
    }
    ctx.translate(-this.camera.x + shakeX, -this.camera.y + shakeY);

    // 1. Draw Impact Particles (sparks & smoke puffs)
    for (const p of this.impactParticles) {
      if (p.isSmoke) {
        ctx.fillStyle = p.color || '#b0b8c4';
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha * 0.6));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // High-velocity sparks with tail streak
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
        ctx.strokeStyle = p.color || '#ffcf48';
        ctx.lineWidth = Math.max(1, p.size);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx || 0) * 0.035, p.y - (p.vy || 0) * 0.035);
        ctx.stroke();

        // White core spark
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1.0;

    // 2. Draw Floating Damage Popups
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const d of this.floatingDamageNumbers) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, d.alpha));
      ctx.translate(d.x, d.y);

      // Pop-in scale bounce
      const progress = 1 - (d.life / d.maxLife);
      const scale = progress < 0.15 ? 1.0 + (progress / 0.15) * 0.35 : 1.35 - (progress - 0.15) * 0.35;
      ctx.scale(scale, scale);

      // Dark shadow stroke for high contrast readability
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3.2;
      ctx.strokeText(d.text, 0, 0);

      // Fill color: Red for local damage taken, Gold for damage dealt, Warm Orange for others
      if (d.isLocalTarget) {
        ctx.fillStyle = '#ff4757';
      } else if (d.isLocalShooter) {
        ctx.fillStyle = '#ffcf48';
      } else {
        ctx.fillStyle = '#ff9f1c';
      }
      ctx.fillText(d.text, 0, 0);

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Renders physical smoke zones created by Infiltrator smoke grenades.
   */
  renderSmokeZones(ctx, smokeZones = []) {
    if (!Array.isArray(smokeZones) || smokeZones.length === 0) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    for (const zone of smokeZones) {
      if (!zone || !zone.x || !zone.y) continue;
      const zx = zone.x;
      const zy = zone.y;
      const baseRadius = zone.radius || 140;

      ctx.save();
      const puffCount = 14;
      for (let i = 0; i < puffCount; i++) {
        const angle = (i / puffCount) * Math.PI * 2 + now * 0.0003;
        const dist = (baseRadius * 0.55) + Math.sin(i * 1.7 + now * 0.001) * (baseRadius * 0.35);
        const puffX = zx + Math.cos(angle) * dist;
        const puffY = zy + Math.sin(angle) * dist;
        const puffR = baseRadius * 0.45 + Math.cos(i * 2.3 + now * 0.0015) * 15;

        const smokeGrad = ctx.createRadialGradient(puffX, puffY, 4, puffX, puffY, puffR);
        smokeGrad.addColorStop(0, 'rgba(40, 45, 55, 0.75)');
        smokeGrad.addColorStop(0.5, 'rgba(28, 32, 40, 0.60)');
        smokeGrad.addColorStop(0.85, 'rgba(20, 24, 30, 0.35)');
        smokeGrad.addColorStop(1, 'rgba(15, 18, 22, 0)');

        ctx.fillStyle = smokeGrad;
        ctx.beginPath();
        ctx.arc(puffX, puffY, puffR, 0, Math.PI * 2);
        ctx.fill();
      }

      const coreGrad = ctx.createRadialGradient(zx, zy, 5, zx, zy, baseRadius * 0.6);
      coreGrad.addColorStop(0, 'rgba(25, 28, 35, 0.85)');
      coreGrad.addColorStop(0.6, 'rgba(20, 24, 30, 0.65)');
      coreGrad.addColorStop(1, 'rgba(15, 18, 22, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(zx, zy, baseRadius * 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  /**
   * Layer 5.5: Renders screen-space ambient embers, steam motes, and cinematic steampunk vignette.
   */
  renderAtmosphericVfx(ctx, width, height) {
    if (Array.isArray(this.ambientParticles)) {
      for (const p of this.ambientParticles) {
        const alpha = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));
        if (p.type === 'ember') {
          ctx.fillStyle = `rgba(255, 140, 30, ${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(220, 240, 255, ${alpha * 0.35})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Cinematic Steampunk Vignette
    const maxRadius = Math.hypot(width, height) / 2;
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, maxRadius * 0.45,
      width / 2, height / 2, maxRadius * 0.98
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.7, 'rgba(8, 10, 14, 0.35)');
    vignette.addColorStop(1, 'rgba(5, 6, 8, 0.78)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Renders an item pickup on the ground.
   */
  renderPickup(ctx, pickup) {
    ctx.save();
    const x = pickup.x;
    const y = pickup.y;
    const pickupImg = assetManager.pickupImage;

    if (pickupImg) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const pulse = Math.sin(now * 0.005);

      // Alchemical glow aura
      const glowGrad = ctx.createRadialGradient(x, y, 3, x, y, 18 + pulse * 4);
      if (pickup.type === 'health') {
        glowGrad.addColorStop(0, 'rgba(46, 196, 182, 0.45)');
        glowGrad.addColorStop(1, 'rgba(46, 196, 182, 0)');
      } else {
        glowGrad.addColorStop(0, 'rgba(255, 207, 72, 0.45)');
        glowGrad.addColorStop(1, 'rgba(255, 207, 72, 0)');
      }
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();

      // High-definition steampunk pickup chest
      ctx.drawImage(pickupImg, x - 15, y - 15, 30, 30);

      // Distinct floating icon badge (Health cross or Ammo shell)
      ctx.fillStyle = pickup.type === 'health' ? '#2ec4b6' : '#ffcf48';
      ctx.beginPath();
      ctx.arc(x, y - 13, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0d11';
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pickup.type === 'health' ? '+' : '•', x, y - 13);
    } else {
      if (pickup.type === 'health') {
        ctx.fillStyle = '#2ec4b6';
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Cross symbol
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 1.5, y - 5, 3, 10);
        ctx.fillRect(x - 5, y - 1.5, 10, 3);
      } else {
        // Ammo Drum
        ctx.fillStyle = '#ffcf48';
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#703816';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#703816';
        ctx.fillRect(x - 3, y - 5, 6, 10);
      }
    }

    ctx.restore();
  }

  /**
   * Renders a glowing, high-speed bullet tracer cutting through air and fog.
   */
  renderProjectile(ctx, b) {
    ctx.save();
    const vx = b.vx || 0;
    const vy = b.vy || 0;
    const speed = Math.hypot(vx, vy) || 1;
    // Aerodynamic tracer trail proportional to high bullet velocity (1600 - 2500 px/s)
    const trailLen = Math.max(26, Math.min(54, speed * 0.024));

    const tailX = b.x - (vx / speed) * trailLen;
    const tailY = b.y - (vy / speed) * trailLen;

    // 1. Soft atmospheric outer heat glow streak
    const outerGrad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    outerGrad.addColorStop(0, 'rgba(255, 120, 20, 0.0)');
    outerGrad.addColorStop(0.5, 'rgba(255, 160, 40, 0.35)');
    outerGrad.addColorStop(1.0, 'rgba(255, 210, 80, 0.75)');

    ctx.strokeStyle = outerGrad;
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // 2. Bright incandescent core streak
    const coreGrad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    coreGrad.addColorStop(0, 'rgba(255, 207, 72, 0.0)');
    coreGrad.addColorStop(0.4, 'rgba(255, 235, 160, 0.85)');
    coreGrad.addColorStop(1.0, 'rgba(255, 255, 240, 1.0)');

    ctx.strokeStyle = coreGrad;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // 3. Hot radiant projectile head with spark halo
    const haloGrad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 7);
    haloGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    haloGrad.addColorStop(0.4, 'rgba(255, 200, 70, 0.60)');
    haloGrad.addColorStop(1.0, 'rgba(255, 140, 30, 0.0)');

    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
    ctx.fill();

    // 4. White-hot center pellet
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Renders a top-down steampunk player/bot avatar with brass chassis and weapon.
   */
  renderPlayerAvatar(ctx, pl, isLocal) {
    if (!pl.isAlive || (pl.hp !== undefined && pl.hp <= 0)) {
      this.renderDestroyedAvatar(ctx, pl);
      return;
    }

    ctx.save();
    ctx.translate(pl.renderX ?? pl.x, pl.renderY ?? pl.y);

    const isStealth = Boolean(pl.smokeActive || (pl.classId === 'infiltrator' && pl.abilityActive));
    if (isStealth) {
      ctx.globalAlpha = isLocal ? 0.50 : 0.28;
    }

    const aimAngle = pl.angle ?? pl.aimAngle ?? 0;
    const isBot = pl.isBot || pl.id?.startsWith('bot_');

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(2, 3, 14, 0, Math.PI * 2);
    ctx.fill();

    // Check high-def sprites
    const sprite = isBot ? assetManager.botImage : assetManager.playerImage;

    let bodyColor = isLocal ? '#2ec4b6' : isBot ? '#e71d36' : '#ff9f1c';
    let ringColor = '#ffcf48';
    if (pl.team === 'team1') {
      bodyColor = '#2575fc'; // Blue team (Парові Вовки)
      ringColor = '#80b5ff';
    } else if (pl.team === 'team2') {
      bodyColor = '#ff4757'; // Red team (Мідні Лиси)
      ringColor = '#ffa4ad';
    }

    if (sprite) {
      // Tactical base ring under entity
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = isLocal ? 2.5 : 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.stroke();

      if (isLocal) {
        ctx.fillStyle = 'rgba(46, 196, 182, 0.18)';
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rotate to aim angle and draw high-definition sprite
      ctx.rotate(aimAngle);
      const sprSize = 38;
      ctx.drawImage(sprite, -sprSize / 2, -sprSize / 2, sprSize, sprSize);

      ctx.restore(); // Restore rotation & translation
    } else {
      // Rotate body to aim angle
      ctx.rotate(aimAngle);

      // 1. Weapon Barrel / Steampunk Weapon Model
      const wId = pl.weaponId || 'revolver';
      ctx.lineWidth = 1.5;

      if (wId === 'blunderbuss') {
        // Funnel-shaped flared muzzle
        ctx.fillStyle = '#1e2229';
        ctx.strokeStyle = '#c59b27';
        ctx.beginPath();
        ctx.moveTo(8, -2.5);
        ctx.lineTo(20, -6);
        ctx.lineTo(22, -6);
        ctx.lineTo(22, 6);
        ctx.lineTo(20, 6);
        ctx.lineTo(8, 2.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Brass muzzle rim
        ctx.fillStyle = '#ffcf48';
        ctx.fillRect(21, -6.5, 2.5, 13);
      } else if (wId === 'needle_gun') {
        // Ultra-slim elongated needle barrel
        ctx.fillStyle = '#2d333f';
        ctx.strokeStyle = '#2ec4b6';
        ctx.fillRect(8, -1.2, 22, 2.4);
        ctx.strokeRect(8, -1.2, 22, 2.4);
        // Needle tip
        ctx.fillStyle = '#2ec4b6';
        ctx.beginPath();
        ctx.moveTo(30, -2);
        ctx.lineTo(34, 0);
        ctx.lineTo(30, 2);
        ctx.fill();
      } else if (wId === 'tesla_rifle') {
        // Dual arc coils & capacitor
        ctx.fillStyle = '#1a1f26';
        ctx.strokeStyle = '#00d4ff';
        ctx.fillRect(8, -3, 18, 6);
        ctx.strokeRect(8, -3, 18, 6);
        // Energy arc rings
        ctx.fillStyle = '#00d4ff';
        ctx.fillRect(14, -4.5, 2.5, 9);
        ctx.fillRect(20, -4.5, 2.5, 9);
        ctx.fillRect(25, -2, 3, 4);
      } else if (wId === 'steam_mortar') {
        // Heavy artillery mortar
        ctx.fillStyle = '#261c14';
        ctx.strokeStyle = '#c59b27';
        ctx.fillRect(7, -5, 15, 10);
        ctx.strokeRect(7, -5, 15, 10);
        ctx.fillStyle = '#ff9f1c';
        ctx.fillRect(20, -6, 4, 12);
      } else if (wId === 'aether_flamethrower') {
        // Dual brass pipes & pilot flame
        ctx.fillStyle = '#331c12';
        ctx.strokeStyle = '#ff7b00';
        ctx.fillRect(8, -3.5, 17, 7);
        ctx.strokeRect(8, -3.5, 17, 7);
        ctx.fillStyle = '#ff7b00';
        ctx.beginPath();
        ctx.arc(26, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (wId === 'gatling_cannon') {
        // Multi-barrel rotary cluster
        ctx.fillStyle = '#161920';
        ctx.strokeStyle = '#c59b27';
        ctx.fillRect(8, -4.5, 18, 9);
        ctx.strokeRect(8, -4.5, 18, 9);
        ctx.fillStyle = '#7a8291';
        ctx.fillRect(24, -4, 4, 2.5);
        ctx.fillRect(24, -1, 4, 2.5);
        ctx.fillRect(24, 2, 4, 2.5);
      } else if (wId === 'steam_carbine') {
        // Extended pneumatic carbine with brass steam bypass
        ctx.fillStyle = '#22262d';
        ctx.strokeStyle = '#c59b27';
        ctx.fillRect(8, -2.5, 18, 5);
        ctx.strokeRect(8, -2.5, 18, 5);
        ctx.fillStyle = '#ffcf48';
        ctx.fillRect(24, -3.5, 3, 7);
        ctx.fillStyle = '#cf712b';
        ctx.fillRect(10, 2.5, 10, 2);
      } else {
        // Clockwork revolver: compact barrel and brass sight
        ctx.fillStyle = '#22262d';
        ctx.strokeStyle = '#c59b27';
        ctx.fillRect(8, -2, 12, 4);
        ctx.strokeRect(8, -2, 12, 4);
        ctx.fillStyle = '#ffcf48';
        ctx.fillRect(18, -3, 3, 6);
      }

      // 2. Brass Backpack / Steam Engine Boiler
      ctx.fillStyle = '#703816';
      ctx.beginPath();
      ctx.arc(-8, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c59b27';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 3. Main Player Chassis / Body
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();

      // Brass/Team outer ring
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Local player highlight ring inside
      if (isLocal) {
        ctx.strokeStyle = '#2ec4b6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 4. Steampunk Goggles / Eyepieces & Bot Optics
      if (isBot) {
        // High-intensity Glowing Automaton Optical Lenses
        const isElite = pl.difficulty === 'nightmare' || pl.difficulty === 'hard';
        const opticColor = isElite ? '#ff2a2a' : '#ff9f1c';
        const haloColor = isElite ? 'rgba(255, 42, 42, 0.45)' : 'rgba(255, 159, 28, 0.45)';

        ctx.fillStyle = haloColor;
        ctx.beginPath();
        ctx.arc(5, -4, 4.5, 0, Math.PI * 2);
        ctx.arc(5, 4, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = opticColor;
        ctx.beginPath();
        ctx.arc(5, -4, 2.5, 0, Math.PI * 2);
        ctx.arc(5, 4, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(6, -4, 1, 0, Math.PI * 2);
        ctx.arc(6, 4, 1, 0, Math.PI * 2);
        ctx.fill();
      } else if (pl.classId === 'sharpshooter') {
        // Cyan Binocular Optic Sensors
        ctx.fillStyle = '#5ffbf1';
        ctx.beginPath();
        ctx.arc(5, -4, 3, 0, Math.PI * 2);
        ctx.arc(5, 4, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f1318';
        ctx.beginPath();
        ctx.arc(5, -4, 1.2, 0, Math.PI * 2);
        ctx.arc(5, 4, 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Classic Brass Goggles
        ctx.fillStyle = '#ffcf48';
        ctx.beginPath();
        ctx.arc(5, -4, 3, 0, Math.PI * 2);
        ctx.arc(5, 4, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f1318';
        ctx.beginPath();
        ctx.arc(5, -4, 1.5, 0, Math.PI * 2);
        ctx.arc(5, 4, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore(); // Restore rotation & translation
    }

    // Mini health bar above avatar
    if (pl.hp !== undefined && pl.hp < 100) {
      const barW = 24;
      const barH = 3;
      const barX = pl.x - barW / 2;
      const barY = pl.y - 20;

      ctx.fillStyle = '#1c2026';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = pl.hp > 25 ? '#2ec4b6' : '#e71d36';
      ctx.fillRect(barX, barY, (barW * Math.max(0, pl.hp)) / 100, barH);
    }
  }

  /**
   * Renders an eliminated/destroyed steampunk automaton or fallen combatant on the floor.
   * Halts in place, never vanishes, with charred iron armor, dark oil stain, detached gears,
   * cracked lenses, and no health bar.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} pl - Destroyed entity state
   */
  renderDestroyedAvatar(ctx, pl) {
    ctx.save();
    const px = pl.renderX ?? pl.x ?? 0;
    const py = pl.renderY ?? pl.y ?? 0;
    ctx.translate(px, py);

    const aimAngle = pl.angle ?? pl.aimAngle ?? 0;

    // 1. Dark visceral oil puddle spreading irregularly on the floor beneath chassis
    ctx.fillStyle = 'rgba(12, 14, 18, 0.65)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 20, 15, Math.PI * 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Oil splatters
    ctx.fillStyle = 'rgba(8, 10, 14, 0.55)';
    ctx.beginPath();
    ctx.arc(-14, 12, 3, 0, Math.PI * 2);
    ctx.arc(16, -10, 2.5, 0, Math.PI * 2);
    ctx.arc(12, 14, 2, 0, Math.PI * 2);
    ctx.fill();

    // 2. Loose brass gears and iron rivets scattered on floor
    ctx.fillStyle = '#8a6210';
    ctx.strokeStyle = '#5a420b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-16, 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffcf48';
    ctx.beginPath();
    ctx.arc(-16, 2, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Rotated body elements
    ctx.rotate(aimAngle);

    // 3. Broken, crooked weapon dropped at an angle
    ctx.save();
    ctx.translate(6, 6);
    ctx.rotate(0.45);
    ctx.fillStyle = '#1c1f26';
    ctx.strokeStyle = '#5a4a24';
    ctx.lineWidth = 1.2;
    ctx.fillRect(4, -2, 14, 4);
    ctx.strokeRect(4, -2, 14, 4);
    // Cracked barrel tip
    ctx.fillStyle = '#3a4150';
    ctx.fillRect(16, -3, 3, 6);
    ctx.restore();

    // 4. Deactivated, charred steam engine boiler
    ctx.fillStyle = '#26170d';
    ctx.beginPath();
    ctx.arc(-8, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a2f1b';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 5. Main charred iron chassis (soot-blackened, scorched armor)
    ctx.fillStyle = '#15171d';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();

    // Tarnished, damaged brass ring
    ctx.strokeStyle = '#5a4a24';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Impact crack lines across armor
    ctx.strokeStyle = '#0a0c10';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(2, 1);
    ctx.lineTo(8, -5);
    ctx.moveTo(1, 2);
    ctx.lineTo(-2, 7);
    ctx.stroke();

    // 6. Extinguished & shattered goggles (no yellow glow, cracked lens)
    ctx.fillStyle = '#20252e';
    ctx.beginPath();
    ctx.arc(5, -4, 3, 0, Math.PI * 2);
    ctx.arc(5, 4, 3, 0, Math.PI * 2);
    ctx.fill();

    // Dark dead lenses
    ctx.fillStyle = '#0a0c10';
    ctx.beginPath();
    ctx.arc(5, -4, 1.5, 0, Math.PI * 2);
    ctx.arc(5, 4, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Glass fracture line on right lens
    ctx.strokeStyle = '#6c7a89';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(4, 2.5);
    ctx.lineTo(6, 5.5);
    ctx.stroke();

    ctx.restore(); // Restore body rotation & translation

    // 7. Subtle destroyed callsign marker
    ctx.fillStyle = '#6c757d';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const tag = `☠ ${pl.name || 'Automaton'} (Знищено)`;
    ctx.fillText(tag, px, py - 18);
  }

  /**
   * Resizes canvas and viewport camera.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.camera.width = width;
    this.camera.height = height;
    if (this.options?.adaptiveZoom && !this.userManuallyZoomed) {
      const opt = this.calculateTacticalZoom(width, height);
      this.camera.zoom = opt;
      this.camera.targetZoom = opt;
    }
    this.visibilityRenderer.resize(width, height);
  }
}
