/**
 * Player Entity (Authoritative Server Representation)
 * Manages player kinematics, health, weapon state, ammo, reloading, and input synchronization.
 */

import { getWeapon } from '../combat/WeaponDefinitions.js';
import {
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_WALK_SPEED,
  PLAYER_STAMINA_MAX,
  PLAYER_STAMINA_DRAIN_RUN,
  PLAYER_STAMINA_RECOVER
} from '../../shared/Constants.js';

export class Player {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {string} [options.name]
   * @param {number} [options.x=100]
   * @param {number} [options.y=100]
   * @param {number} [options.angle=0]
   * @param {number} [options.hp=100]
   * @param {number} [options.maxHp=100]
   * @param {string} [options.weaponId='revolver']
   * @param {number} [options.ammo]
   * @param {number} [options.maxAmmo]
   * @param {number} [options.maxSpeed=180]
   * @param {number} [options.sprintMultiplier=1.5]
   * @param {number} [options.stamina=100]
   * @param {number} [options.radius=16]
   * @param {boolean} [options.isAlive=true]
   * @param {boolean} [options.isHost=false]
   * @param {boolean} [options.ready=false]
   * @param {Object} [options.socket=null]
   */
  constructor(options = {}) {
    this.id = options.id || ('player_' + Date.now());
    this.name = options.name || ('Player_' + this.id);
    this.socket = options.socket || null;
    this.isHost = options.isHost ?? false;
    this.ready = options.ready ?? false;

    // Kinematic Position & Geometry
    this.x = typeof options.x === 'number' ? options.x : 100;
    this.y = typeof options.y === 'number' ? options.y : 100;
    this.angle = typeof options.angle === 'number' ? options.angle : 0;
    this.radius = options.radius ?? PLAYER_RADIUS ?? 16;
    this.maxSpeed = options.maxSpeed ?? 180;
    this.sprintMultiplier = options.sprintMultiplier ?? 1.5;

    // Vitality & Stamina
    this.maxHp = options.maxHp ?? PLAYER_MAX_HP ?? 100;
    this.hp = typeof options.hp === 'number' ? Math.max(0, Math.min(this.maxHp, options.hp)) : this.maxHp;
    this.isAlive = options.isAlive !== undefined ? Boolean(options.isAlive && this.hp > 0) : (this.hp > 0);

    this.maxStamina = options.maxStamina ?? PLAYER_STAMINA_MAX ?? 100;
    this.stamina = options.stamina ?? this.maxStamina;
    this.isSprinting = options.isSprinting ?? false;
    this.lanternOn = options.lanternOn !== false;

    // Team & Competitive Stats
    this.team = options.team || null; // 'team1' | 'team2' | null
    this.kills = options.kills || 0;
    this.deaths = options.deaths || 0;
    this.respawnTimer = options.respawnTimer || 0;

    // Weapon & Arsenal
    this.weaponId = options.weaponId || 'revolver';
    this.weapon = getWeapon(this.weaponId);

    this.maxAmmo = options.maxAmmo ?? (this.weapon ? this.weapon.magazine : 6);
    this.ammo = typeof options.ammo === 'number' ? Math.max(0, Math.min(this.maxAmmo, options.ammo)) : this.maxAmmo;

    // Reload State Machine
    this.isReloading = options.isReloading ?? false;
    this.reloadDuration = options.reloadDuration ?? (this.weapon ? this.weapon.reload : 2.0);
    this.reloadTimer = options.reloadTimer ?? 0;
    this.fireCooldown = 0;
    this.invulnerableTimer = options.invulnerableTimer ?? 0;

    // Network Sync Metadata
    this.lastProcessedSeq = 0;
    this.pendingInputs = [];
  }

  /**
   * Compatibility alias for M3 Room.js simulation code.
   */
  get reloadTimeRemaining() {
    return this.reloadTimer;
  }

  set reloadTimeRemaining(val) {
    this.reloadTimer = Math.max(0, val);
  }

  get weaponName() {
    return this.weapon?.name || 'Clockwork Weapon';
  }

  /**
   * Applies damage, clamps health >= 0, and eliminates entity when HP reaches 0.
   * @param {number} amount
   * @returns {number} Actual damage dealt
   */
  takeDamage(amount) {
    if (!this.isAlive || typeof amount !== 'number' || amount <= 0) {
      return 0;
    }
    if (this.invulnerableTimer > 0) {
      return 0;
    }

    const prevHp = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.isAlive = false;
    }
    return prevHp - this.hp;
  }

  /**
   * Restores health up to maxHp.
   * @param {number} amount
   * @returns {number} Health recovered
   */
  heal(amount) {
    if (!this.isAlive || typeof amount !== 'number' || amount <= 0) {
      return 0;
    }

    const prevHp = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - prevHp;
  }

  /**
   * Attempts to discharge weapon.
   * Checks magazine ammo and reload status, decrements ammo, and enforces cooldown.
   * @returns {boolean} True if a round was successfully fired
   */
  fire(checkCooldown = false) {
    if (!this.isAlive) return false;
    if (this.isReloading) return false;
    if (checkCooldown && this.fireCooldown > 0) return false;

    if (this.ammo <= 0) {
      return false;
    }

    this.ammo--;

    if (this.weapon && this.weapon.fireRate > 0) {
      this.fireCooldown = 1 / this.weapon.fireRate;
    } else {
      this.fireCooldown = 0.3;
    }

    return true;
  }

  /**
   * Initiates reload action with weapon-specific or custom duration.
   * @param {number} [duration]
   * @returns {boolean} True if reload was started
   */
  reload(duration) {
    if (!this.isAlive) return false;
    if (this.isReloading) return false;

    this.isReloading = true;
    if (typeof duration === 'number' && duration > 0) {
      this.reloadTimer = duration;
    } else {
      this.reloadTimer = this.reloadDuration || this.weapon?.reload || 2.0;
    }

    return true;
  }

  /**
   * Replenishes ammo immediately (e.g. from pickup crate).
   * @param {number} [amount]
   * @returns {number} Ammo replenished
   */
  refillAmmo(amount) {
    if (!this.isAlive) return 0;
    const needed = this.maxAmmo - this.ammo;
    const refill = typeof amount === 'number' ? Math.min(needed, amount) : needed;
    this.ammo = Math.min(this.maxAmmo, this.ammo + refill);

    if (this.isReloading) {
      this.isReloading = false;
      this.reloadTimer = 0;
    }

    return refill;
  }

  /**
   * Equips a new weapon, updating magazine bounds and weapon stats.
   * @param {string} weaponId
   */
  setWeapon(weaponId) {
    this.weaponId = weaponId;
    this.weapon = getWeapon(weaponId);
    this.maxAmmo = this.weapon.magazine;
    this.ammo = Math.min(this.ammo, this.maxAmmo);
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
  }

  /**
   * Advances reload timer, fire cooldown, and stamina regeneration.
   * @param {number} dt - Delta time in seconds
   * @param {boolean} [isSprinting=false]
   */
  update(dt, isSprinting = false) {
    if (typeof dt !== 'number' || dt <= 0) return;

    // 1. Advance reload timer
    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        this.reloadTimer = 0;
        this.ammo = this.maxAmmo;
      }
    }

    // 2. Advance weapon fire cooldown & invulnerability
    if (this.fireCooldown > 0) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    }

    // 3. Stamina drain / recovery
    const sprinting = isSprinting ?? this.isSprinting;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - (PLAYER_STAMINA_DRAIN_RUN ?? 30) * dt);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + (PLAYER_STAMINA_RECOVER ?? 20) * dt);
    }
  }

  /**
   * Respawns the player at the specified coordinate.
   * @param {number} x
   * @param {number} y
   * @param {number} [angle=0]
   */
  respawn(x, y, angle = 0) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.hp = this.maxHp;
    this.ammo = this.maxAmmo;
    this.stamina = this.maxStamina;
    this.isAlive = true;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.invulnerableTimer = 2.5;
    this.respawnTimer = 0;
  }

  /**
   * Serializes player state into a concise world snapshot payload.
   * @returns {Object}
   */
  toSnapshot() {
    return {
      id: this.id,
      name: this.name,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      angle: Math.round((this.angle || 0) * 1000) / 1000,
      hp: this.hp,
      maxHp: this.maxHp,
      stamina: Math.round(this.stamina ?? 100),
      maxStamina: this.maxStamina,
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      weaponId: this.weaponId,
      team: this.team || null,
      kills: this.kills || 0,
      respawnTimer: Math.round((this.respawnTimer || 0) * 10) / 10,
      isAlive: this.isAlive,
      isReloading: this.isReloading,
      isInvulnerable: this.invulnerableTimer > 0,
      isHost: this.isHost,
      isBot: Boolean(this.isBot),
      lanternOn: this.lanternOn !== false,
      lastProcessedSeq: this.lastProcessedSeq || 0
    };
  }
}

export default Player;
