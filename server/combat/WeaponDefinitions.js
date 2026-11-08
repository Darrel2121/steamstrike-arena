/**
 * Steampunk Weapon Arsenal Definitions & Utilities
 * Re-exports canonical WEAPON_DEFINITIONS from shared/ProgressionSchema.js (Single Source of Truth)
 * and provides projectile kinematic factory utilities.
 */

import { WEAPON_DEFINITIONS } from '../../shared/ProgressionSchema.js';
export { WEAPON_DEFINITIONS };

/**
 * Retrieves a weapon definition by ID, defaulting to 'revolver' if unrecognized.
 * @param {string} weaponId
 * @returns {Object}
 */
export function getWeapon(weaponId = 'revolver') {
  return WEAPON_DEFINITIONS[weaponId] || WEAPON_DEFINITIONS.revolver;
}

/**
 * Generates an array of projectile initial conditions based on weapon spread and pellet count.
 * @param {string} weaponId
 * @param {{ x: number, y: number }} origin
 * @param {number} baseAngle - Aim direction in radians
 * @param {string} [shooterId=null]
 * @returns {Array<{ shooterId: string, x: number, y: number, angle: number, speed: number, damage: number, maxRange: number }>}
 */
export function createProjectileSpecs(weaponId, origin, baseAngle, shooterId = null, options = {}) {
  const weapon = getWeapon(weaponId);
  const specs = [];
  const pellets = weapon.pellets || 1;
  const spreadMultiplier = typeof options.spreadMultiplier === 'number' ? options.spreadMultiplier : 1.0;
  const effectiveSpread = weapon.spread * spreadMultiplier;

  for (let i = 0; i < pellets; i++) {
    let shotAngle = baseAngle;
    if (pellets > 1) {
      // Scatter pellets evenly across spread cone with slight random jitter
      const offset = ((i / (pellets - 1)) - 0.5) * 2 * effectiveSpread;
      const jitter = (Math.random() - 0.5) * (effectiveSpread * 0.2);
      shotAngle = baseAngle + offset + jitter;
    } else if (effectiveSpread > 0) {
      shotAngle = baseAngle + (Math.random() * 2 - 1) * effectiveSpread;
    }

    specs.push({
      shooterId,
      x: origin.x,
      y: origin.y,
      angle: shotAngle,
      speed: weapon.speed,
      damage: options.damage || weapon.damage,
      maxRange: options.range || weapon.range || 600
    });
  }

  return specs;
}

export default WEAPON_DEFINITIONS;
