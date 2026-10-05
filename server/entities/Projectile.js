/**
 * Authoritative Projectile Entity
 * Manages ballistic trajectory, range lifetime, and kinematic serialization.
 */
import { PROJECTILE_SPEED, PROJECTILE_RADIUS, LANTERN_RANGE } from '../../shared/Constants.js';

export class Projectile {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {string} [options.shooterId]
   * @param {number} [options.x=0]
   * @param {number} [options.y=0]
   * @param {number} [options.angle=0]
   * @param {number} [options.speed=750]
   * @param {number} [options.damage=35]
   * @param {number} [options.radius=3.5]
   * @param {number} [options.maxRange=600]
   */
  constructor(options = {}) {
    this.id = options.id || ('proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
    this.shooterId = options.shooterId || null;
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.prevX = this.x;
    this.prevY = this.y;
    this.angle = options.angle ?? 0;
    this.speed = options.speed ?? PROJECTILE_SPEED ?? 1800;
    this.damage = options.damage ?? 35;
    this.radius = options.radius ?? PROJECTILE_RADIUS ?? 3.5;
    this.maxRange = options.maxRange ?? 600;

    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;

    this.distanceTraveled = 0;
    this.isAlive = true;
    this.createdAt = Date.now();
  }

  /**
   * Advances bullet position over dt (seconds) along its kinematic vector.
   * @param {number} dt - Time delta in seconds
   * @returns {{ x: number, y: number }}
   */
  update(dt) {
    if (!this.isAlive) return { x: this.x, y: this.y };

    this.prevX = this.x;
    this.prevY = this.y;

    const step = this.speed * dt;
    this.x += Math.cos(this.angle) * step;
    this.y += Math.sin(this.angle) * step;
    this.distanceTraveled += step;

    if (this.distanceTraveled >= this.maxRange) {
      this.isAlive = false;
    }

    return { x: this.x, y: this.y };
  }

  /**
   * Serializes projectile state for S2C_WORLD_SNAPSHOT.
   */
  toJSON() {
    return {
      id: this.id,
      shooterId: this.shooterId,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      vx: Math.round(this.vx * 10) / 10,
      vy: Math.round(this.vy * 10) / 10,
      angle: Math.round(this.angle * 1000) / 1000
    };
  }
}

export default Projectile;
