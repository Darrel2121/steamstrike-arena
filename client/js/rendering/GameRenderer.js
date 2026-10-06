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

    // Viewport camera with closer tactical zoom
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
    this.gunfirePings = [];

    // Volumetric steam and mechanical exhaust particle system
    this.steamParticles = [];
    this.entityExhaustTimers = new Map();

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

          // Audio playback and mini-map ping for combat sound events
          if (snd.type === 'pickup') {
            soundFX.playPickup(snd.pickupType || 'ammo', snd.x, snd.y);
          } else if (localPlayer && snd.sourceId !== localPlayer.id) {
            if (snd.type === 'gunfire') {
              soundFX.playGunshot('revolver', snd.x, snd.y);
              // Register enemy gunfire acoustic ping for mini-map radar
              this.gunfirePings.push({
                x: snd.x,
                y: snd.y,
                sourceId: snd.sourceId,
                life: 2.0,
                maxLife: 2.0
              });
            } else if (snd.type === 'reload') {
              soundFX.playReload(snd.x, snd.y);
            } else if (snd.type === 'ability') {
              soundFX.playAbility('vanguard', snd.x, snd.y);
            }
          }
        }
      }
      if (this.processedSoundIds.size > 200) {
        this.processedSoundIds.clear();
      }
    }

    // 2.2 Update gunfire acoustic pings for mini-map
    if (this.gunfirePings && this.gunfirePings.length > 0) {
      for (let i = this.gunfirePings.length - 1; i >= 0; i--) {
        const ping = this.gunfirePings[i];
        ping.life -= dt;
        if (ping.life <= 0) {
          this.gunfirePings.splice(i, 1);
        }
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

    // 3.5 Update bullet impact micro-sparks & floating combat text
    if (this.impactParticles && this.impactParticles.length > 0) {
      for (let i = this.impactParticles.length - 1; i >= 0; i--) {
        const p = this.impactParticles[i];
        p.x += (p.vx || 0) * dt;
        p.y += (p.vy || 0) * dt;
        p.vx = (p.vx || 0) * 0.84;
        p.vy = ((p.vy || 0) + (p.isOil ? 80 : (p.isSpark ? 40 : -10))) * 0.84;
        if (p.isSmoke && typeof p.size === 'number' && typeof p.maxSize === 'number') {
          p.size += (p.maxSize - p.size) * dt * 7.0;
        }
        p.life -= dt;
        p.alpha = Math.max(0, p.life / p.maxLife);
        if (p.life <= 0) {
          this.impactParticles.splice(i, 1);
        }
      }
    }

    // 3.6 Update volumetric steam & exhaust particle engine
    if (this.steamParticles && this.steamParticles.length > 0) {
      for (let i = this.steamParticles.length - 1; i >= 0; i--) {
        const p = this.steamParticles[i];
        p.x += (p.vx || 0) * dt;
        p.y += (p.vy || 0) * dt;
        p.vx = (p.vx || 0) * 0.92;
        p.vy = ((p.vy || 0) - 22) * 0.92; // gentle thermal lift
        p.angle += (p.spin || 0) * dt;
        p.size += (p.maxSize - p.size) * dt * 3.8;
        p.life -= dt;
        const norm = Math.max(0, p.life / p.maxLife);
        // Smooth swell-in and organic fade-out curve
        p.alpha = Math.sin(norm * Math.PI) * (p.baseAlpha || 0.45);
        if (p.life <= 0) {
          this.steamParticles.splice(i, 1);
        }
      }
    }

    // 3.7 Emit continuous mechanical steam exhaust for bots and combatants
    const allCombatants = state.players || [];
    for (const pl of allCombatants) {
      if (!pl || !pl.isAlive || (pl.hp !== undefined && pl.hp <= 0)) continue;
      const isBot = Boolean(pl.isBot || pl.id?.startsWith('bot_'));
      const plAngle = pl.angle ?? pl.aimAngle ?? 0;
      const exX = (pl.renderX ?? pl.x) - Math.cos(plAngle) * 9;
      const exY = (pl.renderY ?? pl.y) - Math.sin(plAngle) * 9;

      let timer = this.entityExhaustTimers.get(pl.id) || 0;
      timer -= dt;

      const isSprinting = Boolean(pl.isSprinting);
      const isMoving = isSprinting || (Math.hypot(pl.vx || 0, pl.vy || 0) > 12);
      const interval = isSprinting ? 0.12 : (isMoving ? 0.22 : 0.65);

      if (timer <= 0) {
        timer = interval;
        const baseAngle = plAngle + Math.PI;
        const spread = (Math.random() - 0.5) * 0.6;
        const puffAngle = baseAngle + spread;
        const speed = isMoving ? (isSprinting ? 40 + Math.random() * 20 : 22 + Math.random() * 15) : (8 + Math.random() * 8);
        const isLowHp = (pl.hp !== undefined && pl.hp <= 35);

        this.steamParticles.push({
          x: exX + (Math.random() - 0.5) * 2,
          y: exY + (Math.random() - 0.5) * 2,
          vx: Math.cos(puffAngle) * speed,
          vy: Math.sin(puffAngle) * speed - 10,
          size: 2.2 + Math.random() * 1.5,
          maxSize: isMoving ? (isSprinting ? 14 + Math.random() * 4 : 10 + Math.random() * 3) : (8 + Math.random() * 3),
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 1.8,
          life: isMoving ? (0.45 + Math.random() * 0.25) : (0.75 + Math.random() * 0.25),
          maxLife: isMoving ? 0.7 : 1.0,
          baseAlpha: isMoving ? (isSprinting ? 0.35 : 0.28) : 0.18,
          isSoot: isLowHp,
          isBot
        });
      }
      this.entityExhaustTimers.set(pl.id, timer);
    }

    // Emit faint residual wisps of cooling steam from destroyed wrecks
    for (const wreck of this.wreckedEntities.values()) {
      if (Math.random() < dt * 1.2) {
        this.steamParticles.push({
          x: (wreck.renderX ?? wreck.x ?? 0) + (Math.random() - 0.5) * 8,
          y: (wreck.renderY ?? wreck.y ?? 0) + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 12,
          vy: -18 - Math.random() * 12,
          size: 3.0,
          maxSize: 18 + Math.random() * 8,
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 1.5,
          life: 0.85 + Math.random() * 0.35,
          maxLife: 1.2,
          baseAlpha: 0.22,
          isSoot: true
        });
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
   * Spawns rich bullet impact visual particles, floating combat numbers, and impact sound.
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

    // Audio cue for bullet impact
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
      // Wall Impact: High-velocity incandescent micro-sparks spray (no blurry smoke puffs)
      const bVx = hit.vx || 0;
      const bVy = hit.vy || 0;
      const baseAngle = Math.atan2(-bVy, -bVx);

      // 18 to 26 crisp incandescent micro-sparks
      const sparkCount = 18 + Math.floor(Math.random() * 8);
      for (let i = 0; i < sparkCount; i++) {
        const spread = (Math.random() - 0.5) * Math.PI * 1.2;
        const angle = baseAngle + spread;
        const speed = 55 + Math.random() * 110;
        this.impactParticles.push({
          x: hx,
          y: hy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 0.8 + Math.random() * 0.4, // Crisp 0.8-1.2px tiny spark needle
          alpha: 1.0,
          life: 0.12 + Math.random() * 0.14,
          maxLife: 0.26,
          isSpark: true
        });
      }
    } else {
      // Entity Impact: Copper automaton shrapnel & bright golden micro-sparks + machine oil
      const sparkCount = 22 + Math.floor(Math.random() * 10);
      for (let i = 0; i < sparkCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 45 + Math.random() * 95;
        this.impactParticles.push({
          x: hx,
          y: hy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 0.8 + Math.random() * 0.4, // Crisp 0.8-1.2px micro-sparks
          alpha: 1.0,
          life: 0.14 + Math.random() * 0.14,
          maxLife: 0.28,
          isSpark: true
        });
      }

      // Machine oil droplets
      for (let o = 0; o < 2; o++) {
        const oAngle = Math.random() * Math.PI * 2;
        const oSpeed = 20 + Math.random() * 45;
        this.impactParticles.push({
          x: hx,
          y: hy,
          vx: Math.cos(oAngle) * oSpeed,
          vy: Math.sin(oAngle) * oSpeed + 10,
          size: 0.9 + Math.random() * 0.4,
          color: '#161920',
          alpha: 0.85,
          life: 0.30 + Math.random() * 0.15,
          maxLife: 0.45,
          isOil: true
        });
      }

      // Floating damage number popup
      const dmg = hit.damage || 35;
      this.floatingDamageNumbers.push({
        x: hx + (Math.random() - 0.5) * 16,
        y: hy - 16,
        text: `-${dmg}`,
        vy: -60,
        alpha: 1.0,
        life: 1.20,
        maxLife: 1.20,
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
    state.map = this.map;
    state.gunfirePings = this.gunfirePings;
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

    // 3.5 Render Steam Core in Wave Defense mode
    if (state.steamCore) {
      this.renderSteamCore(ctx, state.steamCore);
    }

    // 4. Physical Infiltrator Smoke Zones (billowing steam & soot clouds)
    if (Array.isArray(state.smokeZones) && state.smokeZones.length > 0) {
      this.renderSmokeZones(ctx, state.smokeZones);
    }

    // 4.5 Volumetric Steam Engine Exhaust Particles (Automaton & Boiler plumes)
    this.renderSteamParticles(ctx);

    // 5. Living Players and Bots (rendered on top of floor wrecks & steam trails)
    for (const pl of players) {
      if (pl.isAlive && (pl.hp === undefined || pl.hp > 0)) {
        const isLocal = state.localPlayer && state.localPlayer.id === pl.id;
        this.renderPlayerAvatar(ctx, pl, isLocal);
      }
    }
  }

  /**
   * Renders the massive Steampunk Steam Core Reactor in Wave Defense mode.
   * Features heavy cast iron armor plates, brass gears, internal cyan energy core,
   * active steam exhaust venting, and overhead health bar with numerical readout.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} core
   */
  renderSteamCore(ctx, core) {
    if (!core) return;
    const cx = core.x;
    const cy = core.y;
    const radius = core.radius || 36;
    const hp = Math.max(0, core.hp || 0);
    const maxHp = core.maxHp || 1000;
    const isAlive = core.isAlive !== false && hp > 0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Drop shadow / industrial ground scorch
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(0, 4, radius + 8, 0, Math.PI * 2);
    ctx.fill();

    // 2. Outer Iron Base & Riveted Chassis
    const baseGrad = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, radius);
    baseGrad.addColorStop(0, '#3a414d');
    baseGrad.addColorStop(0.7, '#20242b');
    baseGrad.addColorStop(1, '#111418');

    ctx.fillStyle = baseGrad;
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Rotating Brass Gear Ring
    const gearTeeth = 10;
    const gearRot = isAlive ? (now * 0.001) : 0;
    ctx.fillStyle = '#b87333';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < gearTeeth; i++) {
      const a = gearRot + (i / gearTeeth) * Math.PI * 2;
      const gx = Math.cos(a) * (radius - 2);
      const gy = Math.sin(a) * (radius - 2);
      ctx.beginPath();
      ctx.arc(gx, gy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 4. Glowing Internal Steam Crystal Core
    if (isAlive) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
      const glowGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, radius * 0.65);
      glowGrad.addColorStop(0, '#ffffff');
      glowGrad.addColorStop(0.3, '#5ffbf1');
      glowGrad.addColorStop(0.8, 'rgba(46, 196, 182, 0.6)');
      glowGrad.addColorStop(1, 'rgba(46, 196, 182, 0)');

      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, radius * (0.60 + pulse * 0.08), 0, Math.PI * 2);
      ctx.fill();

      // Energy crystal lattice
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 6 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Extinguished dark smoking core
      ctx.fillStyle = '#14171d';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Four Cardinal Steam Vents
    ctx.fillStyle = '#c59b27';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const vx = Math.cos(a) * (radius - 6);
      const vy = Math.sin(a) * (radius - 6);
      ctx.beginPath();
      ctx.arc(vx, vy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Overhead Health Bar & Status
    const barW = 64;
    const barH = 7;
    const barY = -radius - 16;
    const fillRatio = maxHp > 0 ? (hp / maxHp) : 0;
    const barCol = fillRatio > 0.5 ? '#2ec4b6' : (fillRatio > 0.25 ? '#ffcf48' : '#e71d36');

    // Bar Background
    ctx.fillStyle = 'rgba(10, 13, 18, 0.9)';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-barW / 2, barY, barW, barH, 2);
    ctx.fill();
    ctx.stroke();

    // Bar Fill
    if (fillRatio > 0) {
      ctx.fillStyle = barCol;
      ctx.beginPath();
      ctx.roundRect(-barW / 2 + 1, barY + 1, (barW - 2) * fillRatio, barH - 2, 1.5);
      ctx.fill();
    }

    // Overhead Title
    ctx.fillStyle = '#ffcf48';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`РЕАКТОР [${Math.round(hp)}/${maxHp}]`, 0, barY - 2);

    ctx.restore();
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
   * Renders volumetric mechanical steam puffs emitted by moving/sprinting automatons and boilers.
   * Uses realistic soft Gaussian multi-lobe cloud gradients with aerodynamic dissipation.
   * @param {CanvasRenderingContext2D} ctx
   */
  renderSteamParticles(ctx) {
    if (!this.steamParticles || this.steamParticles.length === 0 || !ctx) return;

    for (const p of this.steamParticles) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const alpha = Math.max(0, Math.min(1, typeof p.alpha === 'number' ? p.alpha : 0));
      if (alpha <= 0.01) continue;

      ctx.save();
      ctx.translate(p.x, p.y);
      const angle = Number.isFinite(p.angle) ? p.angle : 0;
      ctx.rotate(angle);

      const r = Math.max(2.0, Number.isFinite(p.size) ? p.size : 6.0);

      // Multi-lobe organic steam cloud structure (3 slightly offset overlapping soft lobes)
      const lobes = [
        { x: 0, y: 0, r: r },
        { x: r * 0.35, y: -r * 0.22, r: Math.max(1.0, r * 0.72) },
        { x: -r * 0.32, y: r * 0.26, r: Math.max(1.0, r * 0.68) }
      ];

      for (const lobe of lobes) {
        const lr = Math.max(1.0, lobe.r);
        try {
          const grad = ctx.createRadialGradient(lobe.x, lobe.y, 0, lobe.x, lobe.y, lr);
          if (p.isSoot) {
            // Scorched/overheated dark industrial soot steam
            grad.addColorStop(0, `rgba(65, 70, 80, ${(alpha * 0.60).toFixed(3)})`);
            grad.addColorStop(0.45, `rgba(45, 50, 60, ${(alpha * 0.32).toFixed(3)})`);
            grad.addColorStop(1, 'rgba(25, 30, 38, 0)');
          } else {
            // Pure luminous steam vapor with soft atmospheric condensation
            grad.addColorStop(0, `rgba(240, 248, 255, ${(alpha * 0.52).toFixed(3)})`);
            grad.addColorStop(0.45, `rgba(215, 235, 252, ${(alpha * 0.28).toFixed(3)})`);
            grad.addColorStop(0.85, `rgba(180, 210, 235, ${(alpha * 0.08).toFixed(3)})`);
            grad.addColorStop(1, 'rgba(160, 195, 225, 0)');
          }

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(lobe.x, lobe.y, lr, 0, Math.PI * 2);
          ctx.fill();
        } catch (_) {}
      }

      ctx.restore();
    }
  }

  /**
   * Layer 4.8: Renders incandescent ricochet sparks, smoke puffs, and floating combat damage numbers.
   */
  renderImpactParticlesAndDamage(ctx) {
    if ((!this.impactParticles || this.impactParticles.length === 0) &&
        (!this.floatingDamageNumbers || this.floatingDamageNumbers.length === 0)) {
      return;
    }
    if (!ctx) return;

    const zoom = Number.isFinite(this.camera?.zoom) ? this.camera.zoom : 1.0;
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;

    ctx.save();
    if (typeof ctx.scale === 'function') {
      ctx.scale(zoom, zoom);
    }
    ctx.translate(-this.camera.x + shakeX, -this.camera.y + shakeY);

    // 1. Draw Impact Particles (micro-sparks, oil droplets & smoke puffs)
    for (const p of this.impactParticles) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const alpha = Math.max(0, Math.min(1, Number.isFinite(p.alpha) ? p.alpha : 0));
      if (alpha <= 0.01) continue;

      if (p.isSmoke) {
        ctx.fillStyle = p.color || '#b0b8c4';
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.45));
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size || 3), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.isOil) {
        ctx.fillStyle = p.color || '#161920';
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.9));
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.8, p.size || 1.2), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // High-velocity sharp incandescent micro-spark
        const maxLife = (p.maxLife && p.maxLife > 0) ? p.maxLife : 0.4;
        const life = Math.max(0, p.life || 0);
        const progress = Math.max(0, Math.min(1, 1 - (life / maxLife)));
        let strokeColor;
        if (progress < 0.22) {
          strokeColor = '#ffffff'; // White-hot
        } else if (progress < 0.50) {
          strokeColor = '#fff275'; // Incandescent gold
        } else if (progress < 0.78) {
          strokeColor = '#ff9f1c'; // Furnace orange
        } else {
          strokeColor = '#e71d36'; // Thermal red ember
        }

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(0.8, Math.min(1.8, p.size || 1.2));
        ctx.lineCap = 'round';
        const vx = Number.isFinite(p.vx) ? p.vx : 0;
        const vy = Number.isFinite(p.vy) ? p.vy : 0;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - vx * 0.015, p.y - vy * 0.015);
        ctx.stroke();

        // Tiny white-hot spark apex point
        if (progress < 0.35) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
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
  /**
   * Renders a glowing, high-speed bullet tracer cutting through air and fog.
   * Scaled down ~30% for ultra-crisp, tight, tactical ballistic visuals.
   */
  renderProjectile(ctx, b) {
    ctx.save();
    const vx = b.vx || 0;
    const vy = b.vy || 0;
    const speed = Math.hypot(vx, vy) || 1;
    // Tight aerodynamic tracer trail proportional to high bullet velocity
    const trailLen = Math.max(18, Math.min(38, speed * 0.018));

    const tailX = b.x - (vx / speed) * trailLen;
    const tailY = b.y - (vy / speed) * trailLen;

    // 1. Soft atmospheric outer heat glow streak (lineWidth 3.8px)
    const outerGrad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    outerGrad.addColorStop(0, 'rgba(255, 120, 20, 0.0)');
    outerGrad.addColorStop(0.5, 'rgba(255, 160, 40, 0.35)');
    outerGrad.addColorStop(1.0, 'rgba(255, 210, 80, 0.75)');

    ctx.strokeStyle = outerGrad;
    ctx.lineWidth = 3.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // 2. Bright incandescent core streak (lineWidth 1.5px)
    const coreGrad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    coreGrad.addColorStop(0, 'rgba(255, 207, 72, 0.0)');
    coreGrad.addColorStop(0.4, 'rgba(255, 235, 160, 0.85)');
    coreGrad.addColorStop(1.0, 'rgba(255, 255, 240, 1.0)');

    ctx.strokeStyle = coreGrad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // 3. Hot radiant projectile head with spark halo (radius 4.8px)
    const haloGrad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 4.8);
    haloGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    haloGrad.addColorStop(0.4, 'rgba(255, 200, 70, 0.60)');
    haloGrad.addColorStop(1.0, 'rgba(255, 140, 30, 0.0)');

    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4.8, 0, Math.PI * 2);
    ctx.fill();

    // 4. White-hot center pellet (radius 1.5px)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Renders a strict 90-degree top-down bird's-eye steampunk avatar with dynamic step kinematics,
   * anatomical shoulder/arm positioning, brass boiler backpack, and authentic top-down weapons.
   */
  renderPlayerAvatar(ctx, pl, isLocal) {
    if (!pl.isAlive || (pl.hp !== undefined && pl.hp <= 0)) {
      this.renderDestroyedAvatar(ctx, pl);
      return;
    }

    ctx.save();
    const px = pl.renderX ?? pl.x;
    const py = pl.renderY ?? pl.y;
    ctx.translate(px, py);

    const isStealth = Boolean(pl.smokeActive || (pl.classId === 'infiltrator' && pl.abilityActive));
    if (isStealth) {
      ctx.globalAlpha = isLocal ? 0.50 : 0.28;
    }

    const aimAngle = pl.angle ?? pl.aimAngle ?? 0;
    const isBot = pl.isBot || pl.id?.startsWith('bot_');
    const cId = pl.classId || 'vanguard';
    const wId = pl.weaponId || 'revolver';
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // 0. Soft directional contact shadow beneath character
    ctx.fillStyle = 'rgba(0, 0, 0, 0.50)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 17, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Soft ambient ground glow for team affiliation
    if (pl.team) {
      const teamGlow = ctx.createRadialGradient(0, 0, 4, 0, 0, 22);
      teamGlow.addColorStop(0, pl.team === 'team1' ? 'rgba(37, 117, 252, 0.40)' : 'rgba(255, 71, 87, 0.40)');
      teamGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = teamGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Local player tactical marker ring
    if (isLocal) {
      ctx.strokeStyle = 'rgba(46, 196, 182, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 19.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rotate entire avatar to precise aim direction (forward is +X)
    ctx.rotate(aimAngle);

    // Dynamic step animation cycle when moving
    const isMoving = Math.abs(pl.vx || 0) > 4 || Math.abs(pl.vy || 0) > 4 || Boolean(pl.isMoving);
    const walkCycle = isMoving ? Math.sin(now * 0.016) : 0;

    if (isBot) {
      // ════════════════════════════════════════════════════════════
      // 🤖 TOP-DOWN STEAMPUNK AUTOMATON (Вид строго зверху)
      // ════════════════════════════════════════════════════════════
      this.renderTopDownAutomaton(ctx, pl, walkCycle, now);
    } else {
      // ════════════════════════════════════════════════════════════
      // 🧑‍🏭 TOP-DOWN STEAMPUNK COMBATANT (Вид строго зверху)
      // ════════════════════════════════════════════════════════════
      this.renderTopDownHuman(ctx, pl, isLocal, cId, wId, walkCycle, now);
    }

    ctx.restore(); // Restore world translation & rotation

    // Mini health bar above avatar
    if (pl.hp !== undefined && pl.hp < 100) {
      const barW = 26;
      const barH = 3.5;
      const barX = px - barW / 2;
      const barY = py - 22;

      ctx.fillStyle = 'rgba(15, 18, 24, 0.85)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = '#1c2026';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = pl.hp > 25 ? '#2ec4b6' : '#e71d36';
      ctx.fillRect(barX, barY, (barW * Math.max(0, pl.hp)) / (pl.maxHp || 100), barH);
    }
  }

  /**
   * Renders a human combatant with rich layered shading, brass pauldrons,
   * realistic hands & weapon grip, detailed steam boiler, and glowing goggles.
   */
  renderTopDownHuman(ctx, pl, isLocal, cId, wId, walkCycle, now) {
    // 1. Walking Boots (Bottom Layer underneath torso)
    const bootW = 8.5;
    const bootH = 4.5;
    const leftBootX = -3 + walkCycle * 4.5;
    const rightBootX = -3 - walkCycle * 4.5;

    // Left boot with leather shading & brass toe armor
    ctx.fillStyle = '#14110d';
    ctx.fillRect(leftBootX - bootW / 2, -10.5 - bootH / 2, bootW, bootH);
    const lToeGrad = ctx.createLinearGradient(leftBootX, -10.5, leftBootX + bootW / 2, -10.5);
    lToeGrad.addColorStop(0, '#8a6210');
    lToeGrad.addColorStop(0.5, '#ffd152');
    lToeGrad.addColorStop(1, '#664508');
    ctx.fillStyle = lToeGrad;
    ctx.fillRect(leftBootX + bootW / 2 - 2.5, -10.5 - bootH / 2, 2.5, bootH);

    // Right boot with leather shading & brass toe armor
    ctx.fillStyle = '#14110d';
    ctx.fillRect(rightBootX - bootW / 2, 10.5 - bootH / 2, bootW, bootH);
    const rToeGrad = ctx.createLinearGradient(rightBootX, 10.5, rightBootX + bootW / 2, 10.5);
    rToeGrad.addColorStop(0, '#8a6210');
    rToeGrad.addColorStop(0.5, '#ffd152');
    rToeGrad.addColorStop(1, '#664508');
    ctx.fillStyle = rToeGrad;
    ctx.fillRect(rightBootX + bootW / 2 - 2.5, 10.5 - bootH / 2, 2.5, bootH);

    // 2. Arms & Hands gripping weapon with articulated sleeves & leather bracers
    let coatGradBase = '#4a2f18';
    let coatGradHighlight = '#6a4324';
    let trimColor = '#c59b27';

    if (pl.team === 'team1') {
      coatGradBase = '#152c48';
      coatGradHighlight = '#254e7d';
      trimColor = '#64a3e8';
    } else if (pl.team === 'team2') {
      coatGradBase = '#4f1414';
      coatGradHighlight = '#782222';
      trimColor = '#f2616d';
    } else if (cId === 'juggernaut') {
      coatGradBase = '#1f232b';
      coatGradHighlight = '#343b47';
      trimColor = '#ff7b00';
    } else if (cId === 'sharpshooter') {
      coatGradBase = '#17222c';
      coatGradHighlight = '#283c4f';
      trimColor = '#5ffbf1';
    } else if (cId === 'infiltrator') {
      coatGradBase = '#121418';
      coatGradHighlight = '#22262e';
      trimColor = '#b33939';
    }

    // Arm sleeves extending forward to grip points
    ctx.strokeStyle = coatGradBase;
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Right arm (trigger arm) -> shoulder (-1, 8.5) -> elbow (3.5, 7.5) -> right hand (8, 3.5)
    ctx.beginPath();
    ctx.moveTo(-1, 8.5);
    ctx.lineTo(3.5, 7.5);
    ctx.lineTo(8, 3.5);
    ctx.stroke();

    // Left arm (support arm) -> shoulder (-1, -8.5) -> elbow (4, -7) -> left hand (13, -2)
    ctx.beginPath();
    ctx.moveTo(-1, -8.5);
    ctx.lineTo(4, -7);
    ctx.lineTo(13, -2);
    ctx.stroke();

    // Brass buckles on forearm sleeves
    ctx.fillStyle = '#ffcf48';
    ctx.fillRect(2.5, 6.5, 2, 1.5);
    ctx.fillRect(3.0, -7.5, 2, 1.5);

    // Gloved hands with dark leather gradient
    const rHandGrad = ctx.createRadialGradient(8, 3.5, 0.5, 8, 3.5, 2.5);
    rHandGrad.addColorStop(0, '#3a3026');
    rHandGrad.addColorStop(1, '#16130f');
    ctx.fillStyle = rHandGrad;
    ctx.beginPath();
    ctx.arc(8, 3.5, 2.4, 0, Math.PI * 2);
    ctx.fill();

    const lHandGrad = ctx.createRadialGradient(13, -2, 0.5, 13, -2, 2.5);
    lHandGrad.addColorStop(0, '#3a3026');
    lHandGrad.addColorStop(1, '#16130f');
    ctx.fillStyle = lHandGrad;
    ctx.beginPath();
    ctx.arc(13, -2, 2.4, 0, Math.PI * 2);
    ctx.fill();

    // Brass knuckle rivets on gloves
    ctx.fillStyle = '#ffcf48';
    ctx.beginPath();
    ctx.arc(8.6, 3.5, 0.9, 0, Math.PI * 2);
    ctx.arc(13.6, -2, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // 3. Top-Down Steampunk Weapon
    this.renderTopDownWeapon(ctx, wId, now);

    // 4. Steam Boiler Backpack / Gas Reservoir (X < 0) with Rich Metallic Gradients
    if (cId === 'juggernaut') {
      // Dual heavy high-pressure iron boilers with glowing heat core
      const b1Grad = ctx.createRadialGradient(-8.5, -6, 1, -8.5, -6, 5.5);
      b1Grad.addColorStop(0, '#5a3818');
      b1Grad.addColorStop(0.7, '#2c1a0c');
      b1Grad.addColorStop(1, '#150c06');
      ctx.fillStyle = b1Grad;
      ctx.beginPath();
      ctx.arc(-8.5, -6, 5.2, 0, Math.PI * 2);
      ctx.arc(-8.5, 6, 5.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#c59b27';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Glowing firebox grates
      ctx.fillStyle = '#ff7b00';
      ctx.fillRect(-12.5, -7.5, 3, 3);
      ctx.fillRect(-12.5, 4.5, 3, 3);
      ctx.fillStyle = '#ffea75';
      ctx.fillRect(-11.5, -6.5, 1.5, 1.5);
      ctx.fillRect(-11.5, 5.5, 1.5, 1.5);
    } else if (cId === 'sharpshooter') {
      // Slim pressurized pneumatic canister with glowing cyan core
      const aetherGrad = ctx.createLinearGradient(-13, -3.5, -7, 3.5);
      aetherGrad.addColorStop(0, '#152533');
      aetherGrad.addColorStop(0.5, '#223c52');
      aetherGrad.addColorStop(1, '#0e1822');
      ctx.fillStyle = aetherGrad;
      ctx.fillRect(-12, -3.5, 6.5, 7);
      ctx.strokeStyle = '#5ffbf1';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-12, -3.5, 6.5, 7);

      // Glowing cyan fluid tube
      ctx.fillStyle = '#5ffbf1';
      ctx.fillRect(-10.5, -2, 3, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-9.5, -1, 1, 2);
    } else if (cId === 'infiltrator') {
      // Dual matte black smoke pods with red release valves
      ctx.fillStyle = '#14161b';
      ctx.fillRect(-11.5, -6, 5.5, 4.2);
      ctx.fillRect(-11.5, 1.8, 5.5, 4.2);
      ctx.strokeStyle = '#b33939';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-11.5, -6, 5.5, 4.2);
      ctx.strokeRect(-11.5, 1.8, 5.5, 4.2);
      ctx.fillStyle = '#ff4757';
      ctx.fillRect(-12.5, -4.5, 1.5, 1.5);
      ctx.fillRect(-12.5, 3.2, 1.5, 1.5);
    } else {
      // Vanguard: Polished cylindrical brass boiler with copper coils & pressure gauge
      const boilerGrad = ctx.createRadialGradient(-8, 0, 1, -8, 0, 7);
      boilerGrad.addColorStop(0, '#ffd866');
      boilerGrad.addColorStop(0.5, '#b87e1b');
      boilerGrad.addColorStop(1, '#573708');
      ctx.fillStyle = boilerGrad;
      ctx.beginPath();
      ctx.arc(-8, 0, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffcf48';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Mini pressure manometer dial
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-8, 0, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#181b22';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Gauge needle vibrating slightly
      const needleAngle = Math.sin(now * 0.01) * 0.5 - 0.5;
      ctx.strokeStyle = '#d63031';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-8 + Math.cos(needleAngle) * 2.0, Math.sin(needleAngle) * 2.0);
      ctx.stroke();

      // Dual exhaust ports
      ctx.fillStyle = '#3a2012';
      ctx.fillRect(-13.5, -5, 3.5, 2.5);
      ctx.fillRect(-13.5, 2.5, 3.5, 2.5);
    }

    // 5. Torso & Shoulder Pauldrons (Top-down anatomical span with convex shading)
    const torsoRadiusX = cId === 'juggernaut' ? 9.8 : 8.2;
    const torsoRadiusY = cId === 'juggernaut' ? 14.5 : 12.0;

    const torsoGrad = ctx.createRadialGradient(-1, 0, 2, -1, 0, torsoRadiusY);
    torsoGrad.addColorStop(0, coatGradHighlight);
    torsoGrad.addColorStop(0.8, coatGradBase);
    torsoGrad.addColorStop(1, '#0e1014');
    ctx.fillStyle = torsoGrad;
    ctx.beginPath();
    ctx.ellipse(-1, 0, torsoRadiusX, torsoRadiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    // Coat trim / armor edging
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Diagonal leather bandolier strap with individual brass cartridges
    ctx.strokeStyle = '#1c1510';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-4, -9);
    ctx.lineTo(2, 8);
    ctx.stroke();

    // Brass bullets in bandolier
    ctx.fillStyle = '#ffcf48';
    ctx.fillRect(-2.5, -6, 1.4, 2.2);
    ctx.fillRect(-1.0, -2, 1.4, 2.2);
    ctx.fillRect(0.5, 2, 1.4, 2.2);

    // Ornate Metallic Shoulder Pauldrons (Left & Right armor plates)
    const pauldronY = torsoRadiusY - 2.5;
    const pauldronRad = cId === 'juggernaut' ? 5.4 : 4.4;

    const renderPauldron = (py) => {
      const pGrad = ctx.createRadialGradient(-1, py, 1, -1, py, pauldronRad);
      pGrad.addColorStop(0, '#ffea85');
      pGrad.addColorStop(0.5, '#c59b27');
      pGrad.addColorStop(1, '#543b09');
      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(-1, py, pauldronRad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd866';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Center ornamental rivet
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-0.8, py - 0.5, 1.0, 0, Math.PI * 2);
      ctx.fill();
    };

    renderPauldron(-pauldronY);
    renderPauldron(pauldronY);

    // 6. Head & Headgear (Center top-down with seam shading)
    const headRad = 6.4;
    let capGradBase = '#3a2416';
    let capGradTop = '#5c3922';

    if (cId === 'juggernaut') {
      capGradBase = '#1f242d';
      capGradTop = '#3a4354';
    } else if (cId === 'sharpshooter') {
      capGradBase = '#182430';
      capGradTop = '#2a3e52';
    } else if (cId === 'infiltrator') {
      capGradBase = '#101216';
      capGradTop = '#1e222a';
    }

    const headGrad = ctx.createRadialGradient(1, 0, 1, 1, 0, headRad);
    headGrad.addColorStop(0, capGradTop);
    headGrad.addColorStop(1, capGradBase);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(1, 0, headRad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f1115';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Goggle leather strap encircling the head
    ctx.strokeStyle = '#120d09';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(1, 0, headRad - 0.4, -Math.PI * 0.72, Math.PI * 0.72);
    ctx.stroke();

    // 7. Luminous Forward-Facing Optical Goggles (Facing +X)
    let opticColor = '#5ffbf1'; // Cyan standard
    let opticGlow = 'rgba(95, 251, 241, 0.45)';
    if (cId === 'vanguard') {
      opticColor = '#ffcf48';
      opticGlow = 'rgba(255, 207, 72, 0.45)';
    } else if (cId === 'juggernaut') {
      opticColor = '#ff7b00';
      opticGlow = 'rgba(255, 123, 0, 0.50)';
    } else if (cId === 'infiltrator') {
      opticColor = '#ff4757';
      opticGlow = 'rgba(255, 71, 87, 0.50)';
    }

    const renderGoggle = (gy) => {
      // Brass outer housing with beveled metallic gradient
      const rimGrad = ctx.createRadialGradient(5.5, gy, 1, 5.5, gy, 2.7);
      rimGrad.addColorStop(0, '#ffea85');
      rimGrad.addColorStop(0.6, '#c59b27');
      rimGrad.addColorStop(1, '#543b09');
      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.arc(5.5, gy, 2.7, 0, Math.PI * 2);
      ctx.fill();

      // Glowing glass lens interior
      ctx.fillStyle = opticColor;
      ctx.beginPath();
      ctx.arc(5.5, gy, 1.9, 0, Math.PI * 2);
      ctx.fill();

      // Ambient lens glow
      ctx.fillStyle = opticGlow;
      ctx.beginPath();
      ctx.arc(6.0, gy, 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Specular white reflection dot for pristine glass glare
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(6.3, gy - 0.4, 0.7, 0, Math.PI * 2);
      ctx.fill();
    };

    renderGoggle(-3.2);
    renderGoggle(3.2);
  }

  /**
   * Renders a mechanical steampunk automaton bot from a strict 90-degree top-down perspective:
   * Heavy forged iron octagonal shell, oscillating tread units, interlocking rotating brass gears,
   * glowing Aether crystal power core, hydraulic manipulator arms, and sweeping robotic eye scanner.
   */
  renderTopDownAutomaton(ctx, pl, walkCycle, now) {
    const isElite = pl.difficulty === 'nightmare' || pl.difficulty === 'hard';

    // 1. Mechanical Tread Stabilizers with Drive Sprockets (Bottom layer)
    const treadW = 9.5;
    const treadH = 4.2;
    const osc = walkCycle * 2.8;

    const renderTread = (ty, o) => {
      ctx.fillStyle = '#14171d';
      ctx.fillRect(-4 + o, ty - treadH / 2, treadW, treadH);
      ctx.strokeStyle = '#3e4654';
      ctx.lineWidth = 1;
      ctx.strokeRect(-4 + o, ty - treadH / 2, treadW, treadH);

      // Brass drive links
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(-2 + o, ty - treadH / 2, 1.5, treadH);
      ctx.fillRect(2 + o, ty - treadH / 2, 1.5, treadH);
    };

    renderTread(-12.5, osc);
    renderTread(12.5, -osc);

    // 2. Hydraulic Manipulator Piston Arms -> holding weapon
    ctx.strokeStyle = '#2d3340';
    ctx.lineWidth = 3.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, -9);
    ctx.lineTo(5, -6);
    ctx.lineTo(10, -2);
    ctx.moveTo(-2, 9);
    ctx.lineTo(5, 6);
    ctx.lineTo(9, 3);
    ctx.stroke();

    // Chrome hydraulic piston shaft rods
    ctx.strokeStyle = '#c5d0e0';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(1, -7.5);
    ctx.lineTo(7, -4);
    ctx.moveTo(1, 7.5);
    ctx.lineTo(7, 4);
    ctx.stroke();

    // Brass claw manipulator hands
    ctx.fillStyle = '#ffd152';
    ctx.beginPath();
    ctx.arc(10, -2, 2.3, 0, Math.PI * 2);
    ctx.arc(9, 3, 2.3, 0, Math.PI * 2);
    ctx.fill();

    // 3. Top-Down Steampunk Weapon
    this.renderTopDownWeapon(ctx, pl.weaponId || 'revolver', now);

    // 4. Rear Brass Steam Exhaust Chimneys with Glowing Heat Interior (X < 0)
    const renderChimney = (cy) => {
      const cGrad = ctx.createRadialGradient(-8, cy, 1, -8, cy, 3.8);
      cGrad.addColorStop(0, '#ffd866');
      cGrad.addColorStop(0.6, '#b87e1b');
      cGrad.addColorStop(1, '#472d06');
      ctx.fillStyle = cGrad;
      ctx.beginPath();
      ctx.arc(-8, cy, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd866';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Glowing ember heat interior
      ctx.fillStyle = '#ff5722';
      ctx.beginPath();
      ctx.arc(-8, cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffea75';
      ctx.beginPath();
      ctx.arc(-8, cy, 0.8, 0, Math.PI * 2);
      ctx.fill();
    };

    renderChimney(-6.2);
    renderChimney(6.2);

    // 5. Main Heavy Automaton Shell (Strict top-down forged iron & brass rim)
    const hullRad = 13.5;

    // Outer cast iron hull with bevel
    const hullGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, hullRad);
    hullGrad.addColorStop(0, '#384252');
    hullGrad.addColorStop(0.7, '#202630');
    hullGrad.addColorStop(1, '#0e1117');
    ctx.fillStyle = hullGrad;
    ctx.beginPath();
    ctx.arc(0, 0, hullRad, 0, Math.PI * 2);
    ctx.fill();

    // Brass reinforcement ring
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // 8 Radial Hex Bolts on hull perimeter
    ctx.fillStyle = '#ffcf48';
    for (let i = 0; i < 8; i++) {
      const bAng = (i * Math.PI) / 4;
      const bx = Math.cos(bAng) * (hullRad - 1.5);
      const by = Math.sin(bAng) * (hullRad - 1.5);
      ctx.beginPath();
      ctx.arc(bx, by, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Inner clockwork mechanism chamber
    ctx.fillStyle = '#1c1308';
    ctx.beginPath();
    ctx.arc(0, 0, 9.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffcf48';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Animated Rotating Clockwork Cogwheel Core (Rotates continuously!)
    const rot = (now * 0.002) % (Math.PI * 2);
    const cogRad = 6.2;
    const teeth = 8;

    ctx.save();
    ctx.rotate(rot);
    ctx.fillStyle = '#ffd152';
    for (let t = 0; t < teeth; t++) {
      const tAng = (t * Math.PI * 2) / teeth;
      const tx = Math.cos(tAng) * cogRad;
      const ty = Math.sin(tAng) * cogRad;
      ctx.fillRect(tx - 1.2, ty - 1.2, 2.4, 2.4);
    }
    ctx.beginPath();
    ctx.arc(0, 0, cogRad - 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Central Pulsing Aether Energy Crystal Core
    const opticColor = isElite ? '#ff2a2a' : '#ff9f1c';
    const coreGrad = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 3.2);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.5, opticColor);
    coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // 6. Sweeping Robotic Optical Visor Scanner (Facing +X)
    const scanOffset = Math.sin(now * 0.005) * 3.0; // Sweeps left and right

    // Front curved visor casing
    ctx.fillStyle = '#101318';
    ctx.fillRect(7.5, -5.5, 4.5, 11);
    ctx.strokeStyle = '#ffd152';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(7.5, -5.5, 4.5, 11);

    // Glowing sweeping eye beam
    ctx.fillStyle = opticColor;
    ctx.fillRect(8.5, scanOffset - 1.5, 2.5, 3.0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(9.5, scanOffset - 0.6, 1.2, 1.2);
  }

  /**
   * Renders a steampunk firearm from a strict 90-degree top-down bird's-eye perspective along the +X axis.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} wId - Weapon Identifier
   * @param {number} now - Timestamp for animated effects
   */
  renderTopDownWeapon(ctx, wId, now) {
    ctx.lineWidth = 1.5;

    if (wId === 'blunderbuss') {
      // Distinct flared conical brass trumpet barrel with Damascus steel stock
      ctx.fillStyle = '#2b1b10'; // Walnut stock
      ctx.fillRect(3, -1.8, 6, 3.6);

      // Flared conical brass bell-mouth
      const bellGrad = ctx.createLinearGradient(8, 0, 22, 0);
      bellGrad.addColorStop(0, '#9e7315');
      bellGrad.addColorStop(0.5, '#ffd866');
      bellGrad.addColorStop(1, '#694a08');
      ctx.fillStyle = bellGrad;
      ctx.strokeStyle = '#ffe48a';
      ctx.beginPath();
      ctx.moveTo(8, -2);
      ctx.lineTo(20, -5.5);
      ctx.lineTo(22, -5.5);
      ctx.lineTo(22, 5.5);
      ctx.lineTo(20, 5.5);
      ctx.lineTo(8, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Heavy flared brass muzzle rim
      ctx.fillStyle = '#ffcf48';
      ctx.fillRect(21, -6, 2.5, 12);

      // Dark muzzle bore interior
      ctx.fillStyle = '#0f1115';
      ctx.fillRect(22, -4.5, 1.5, 9);

      // Steam hammer valve on side
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(9, 2.5, 3, 2.5);
    } else if (wId === 'needle_gun') {
      // Ultra-long precision sniper needle barrel with rail conduits & optic scope
      ctx.fillStyle = '#171d24';
      ctx.fillRect(5, -1.8, 6, 3.6);

      // Long needle rail barrel
      const railGrad = ctx.createLinearGradient(9, 0, 30, 0);
      railGrad.addColorStop(0, '#2d3745');
      railGrad.addColorStop(0.7, '#435368');
      railGrad.addColorStop(1, '#1b222b');
      ctx.fillStyle = railGrad;
      ctx.strokeStyle = '#5ffbf1';
      ctx.fillRect(9, -1.2, 21, 2.4);
      ctx.strokeRect(9, -1.2, 21, 2.4);

      // Glowing plasma spine
      ctx.fillStyle = '#5ffbf1';
      ctx.fillRect(11, -0.6, 18, 1.2);

      // Needle tip
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(30, -1.5);
      ctx.lineTo(35, 0);
      ctx.lineTo(30, 1.5);
      ctx.closePath();
      ctx.fill();

      // Optical telescopic scope mounted on top
      ctx.fillStyle = '#0f1318';
      ctx.strokeStyle = '#c59b27';
      ctx.fillRect(8, -4.5, 12, 2.5);
      ctx.strokeRect(8, -4.5, 12, 2.5);
      ctx.fillStyle = '#5ffbf1';
      ctx.fillRect(19, -4.5, 1.5, 2.5);
    } else if (wId === 'tesla_rifle') {
      // Dual copper Tesla induction coils & animated energy arc tube
      ctx.fillStyle = '#151a21';
      ctx.strokeStyle = '#00d4ff';
      ctx.fillRect(7, -3, 17, 6);
      ctx.strokeRect(7, -3, 17, 6);

      // Copper induction rings
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(13, -4.5, 2.5, 9);
      ctx.fillRect(19, -4.5, 2.5, 9);

      // Glowing electric arc energy core with animated spark
      ctx.fillStyle = '#00d4ff';
      ctx.fillRect(10, -1.2, 13, 2.4);
      ctx.fillStyle = '#ffffff';
      const sparkX = 10 + ((now * 0.03) % 12);
      ctx.fillRect(sparkX, -1.5, 2.5, 3.0);
      ctx.fillRect(24, -2, 3, 4);
    } else if (wId === 'steam_mortar') {
      // Massive reinforced cast-iron mortar cannon
      ctx.fillStyle = '#201812';
      ctx.strokeStyle = '#c59b27';
      ctx.fillRect(6, -4.5, 14, 9);
      ctx.strokeRect(6, -4.5, 14, 9);

      // Brass reinforcement bands
      ctx.fillStyle = '#ffd866';
      ctx.fillRect(11, -5.5, 2.5, 11);
      ctx.fillRect(17, -5.5, 2.5, 11);

      // Deep black muzzle bore
      ctx.fillStyle = '#080a0d';
      ctx.fillRect(20, -4, 2, 8);
    } else if (wId === 'aether_flamethrower') {
      // Dual brass fuel pipes & pilot burner with animated flame tip
      ctx.fillStyle = '#2f1a0e';
      ctx.strokeStyle = '#ff7b00';
      ctx.fillRect(7, -3.5, 16, 7);
      ctx.strokeRect(7, -3.5, 16, 7);

      // Dual fuel tubes
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(12, -2.5, 10, 1.5);
      ctx.fillRect(12, 1.0, 10, 1.5);

      // Flickering pilot burner flame
      const flameW = 3.0 + Math.sin(now * 0.02) * 1.0;
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      ctx.arc(25, 0, flameW, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe853';
      ctx.beginPath();
      ctx.arc(26, 0, flameW * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (wId === 'gatling_cannon') {
      // Multi-barrel rotary cluster with center hub
      ctx.fillStyle = '#161a22';
      ctx.strokeStyle = '#c59b27';
      ctx.fillRect(7, -4.5, 17, 9);
      ctx.strokeRect(7, -4.5, 17, 9);

      // Triple rotary barrels with steel shading
      ctx.fillStyle = '#7a8699';
      ctx.fillRect(24, -4, 4, 2.2);
      ctx.fillRect(24, -1.1, 4, 2.2);
      ctx.fillRect(24, 1.8, 4, 2.2);

      // Front brass retainer ring
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(27, -4.5, 1.5, 9);

      // Brass ammo belt feed casing
      ctx.fillStyle = '#ffcf48';
      ctx.fillRect(10, 4.5, 5, 2.5);
    } else if (wId === 'steam_carbine') {
      // Long rifled barrel, brass pneumatic bypass & wooden stock
      ctx.fillStyle = '#24180f'; // Stock
      ctx.fillRect(2, 0, 6, 2.5);

      ctx.fillStyle = '#1f242d'; // Receiver
      ctx.strokeStyle = '#c59b27';
      ctx.fillRect(7, -2.2, 17, 4.4);
      ctx.strokeRect(7, -2.2, 17, 4.4);

      // Brass muzzle brake
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(24, -3, 3, 6);

      // Pneumatic brass bypass pipe
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(10, -3.5, 10, 1.5);
    } else {
      // Clockwork Revolver: Compact steel receiver, 6-chamber cylinder & brass bead sight
      ctx.fillStyle = '#202630';
      ctx.strokeStyle = '#c59b27';
      ctx.fillRect(7, -1.8, 11, 3.6);
      ctx.strokeRect(7, -1.8, 11, 3.6);

      // 6-chamber cylinder with brass chambers
      const cylGrad = ctx.createRadialGradient(9.5, 0, 0.5, 9.5, 0, 3.2);
      cylGrad.addColorStop(0, '#ffd866');
      cylGrad.addColorStop(0.7, '#a87a19');
      cylGrad.addColorStop(1, '#543b08');
      ctx.fillStyle = cylGrad;
      ctx.beginPath();
      ctx.arc(9.5, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#12151b';
      ctx.beginPath();
      ctx.arc(9.5, 0, 1.2, 0, Math.PI * 2);
      ctx.fill();

      // Brass front bead sight
      ctx.fillStyle = '#ffd152';
      ctx.fillRect(17, -2.5, 2.5, 5);
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
