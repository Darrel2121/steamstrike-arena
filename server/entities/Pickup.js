/**
 * Ground Pickup Entity (Health Elixirs & Ammo Crates)
 * Manages item presence, 20px circle overlap detection, collection effects, and respawn cycle.
 */

import { PICKUP_TYPES } from '../../shared/MapSchema.js';
import { TILE_SIZE } from '../../shared/Constants.js';

export class Pickup {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {'health'|'ammo'} [options.type='health']
   * @param {number} [options.x] - Pixel position X
   * @param {number} [options.y] - Pixel position Y
   * @param {number} [options.col] - Tile column
   * @param {number} [options.row] - Tile row
   * @param {number} [options.tileSize=40]
   * @param {number} [options.radius=20] - Collection radius (default 20px)
   * @param {number} [options.healAmount=35] - Health restore amount (+35 HP)
   * @param {number} [options.respawnTime=15.0] - Respawn duration in seconds (0 = single-use)
   * @param {boolean} [options.isActive=true]
   */
  constructor(options = {}) {
    this.id = options.id || (`pickup_${options.type || 'item'}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`);
    this.type = options.type || PICKUP_TYPES.HEALTH;

    const tileSize = options.tileSize || TILE_SIZE || 40;
    if (typeof options.x === 'number') {
      this.x = options.x;
    } else if (typeof options.col === 'number') {
      this.x = options.col * tileSize + tileSize / 2;
    } else {
      this.x = 0;
    }

    if (typeof options.y === 'number') {
      this.y = options.y;
    } else if (typeof options.row === 'number') {
      this.y = options.row * tileSize + tileSize / 2;
    } else {
      this.y = 0;
    }

    this.col = options.col ?? Math.floor(this.x / tileSize);
    this.row = options.row ?? Math.floor(this.y / tileSize);

    this.radius = options.radius ?? 20; // 20px collection radius
    this.healAmount = options.healAmount ?? 35; // +35 HP for elixirs
    this.respawnTime = options.respawnTime ?? 15.0; // 15s respawn timer
    this.respawnTimer = 0;
    this.isActive = options.isActive ?? true;
  }

  /**
   * Tests whether an active player circle overlaps with this pickup.
   * Circle-circle intersection: distance <= pickup.radius + player.radius
   * @param {Object} entity
   * @returns {boolean}
   */
  checkOverlap(entity) {
    if (!this.isActive || !entity || !entity.isAlive) {
      return false;
    }

    const eRadius = entity.radius || 16;
    const maxDist = this.radius + eRadius;
    const dx = this.x - entity.x;
    const dy = this.y - entity.y;

    return (dx * dx + dy * dy) <= (maxDist * maxDist);
  }

  checkCollision(entity) {
    return this.checkOverlap(entity);
  }

  /**
   * Evaluates if the player is eligible to collect this pickup (e.g. not already full).
   * @param {Object} player
   * @returns {boolean}
   */
  canCollect(player) {
    if (!this.isActive || !player || !player.isAlive) {
      return false;
    }

    if (this.type === PICKUP_TYPES.HEALTH || this.type === 'health') {
      return player.hp < player.maxHp;
    }

    if (this.type === PICKUP_TYPES.AMMO || this.type === 'ammo') {
      return player.ammo < player.maxAmmo;
    }

    return true;
  }

  /**
   * Applies the pickup effect to the player, marks pickup inactive, and starts respawn timer.
   * @param {Object} player
   * @returns {{ collected: boolean, type: string, amount: number } | null}
   */
  collect(player) {
    if (!this.canCollect(player)) {
      return null;
    }

    this.isActive = false;
    this.respawnTimer = this.respawnTime;

    let amount = 0;
    if (this.type === PICKUP_TYPES.HEALTH || this.type === 'health') {
      amount = typeof player.heal === 'function'
        ? player.heal(this.healAmount)
        : (() => {
            const prev = player.hp;
            player.hp = Math.min(player.maxHp, player.hp + this.healAmount);
            return player.hp - prev;
          })();
    } else if (this.type === PICKUP_TYPES.AMMO || this.type === 'ammo') {
      amount = typeof player.refillAmmo === 'function'
        ? player.refillAmmo()
        : (() => {
            const prev = player.ammo;
            player.ammo = player.maxAmmo;
            return player.ammo - prev;
          })();
    }

    return {
      collected: true,
      type: this.type,
      amount
    };
  }

  applyTo(entity) {
    return this.collect(entity);
  }

  /**
   * Advances the respawn timer.
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    if (!this.isActive && this.respawnTime > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.isActive = true;
        this.respawnTimer = 0;
      }
    }
  }

  /**
   * Resets pickup to active state.
   */
  reset() {
    this.isActive = true;
    this.respawnTimer = 0;
  }

  /**
   * Returns network snapshot object matching GameRenderer expectations.
   * @returns {{ id: string, type: string, x: number, y: number, isActive: boolean }}
   */
  toSnapshot() {
    return {
      id: this.id,
      type: this.type,
      x: Math.round(this.x),
      y: Math.round(this.y),
      isActive: this.isActive
    };
  }
}

export default Pickup;
