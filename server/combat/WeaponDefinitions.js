/**
 * Steampunk Weapon Arsenal Definitions & Utilities
 * Single source of truth for weapon stats, projectile kinematics, and sound profiles.
 */

export const WEAPON_DEFINITIONS = {
  revolver: {
    id: 'revolver',
    name: 'Годинниковий револьвер',
    englishName: 'Clockwork Revolver',
    damage: 35,
    speed: 1800,         // px/s - high-velocity precision sidearm
    spread: 0.02,        // radians (+/- ~1.15 deg)
    magazine: 6,
    maxAmmo: 6,
    reload: 1.5,         // seconds
    reloadTime: 1.5,
    fireRate: 2.5,       // shots/sec (cooldown: 0.40s)
    pellets: 1,
    range: 650,
    soundType: 'gunfire',
    soundRadius: 240,
    description: 'Надійний шестизарядний пістолет із прецизійним годинниковим механізмом.'
  },
  steam_carbine: {
    id: 'steam_carbine',
    name: 'Паровий карабін',
    englishName: 'Steam Carbine',
    damage: 18,
    speed: 2100,         // px/s - pneumatic rapid brass rounds
    spread: 0.05,        // radians (+/- ~2.86 deg)
    magazine: 20,
    maxAmmo: 20,
    reload: 2.0,         // seconds
    reloadTime: 2.0,
    fireRate: 7.0,       // shots/sec (cooldown: ~0.143s)
    pellets: 1,
    range: 750,
    soundType: 'gunfire',
    soundRadius: 240,
    description: 'Пневматичний карабін для швидкісної стрільби каліброваними латунними кулями.'
  },
  blunderbuss: {
    id: 'blunderbuss',
    name: 'Механічний мушкетон',
    englishName: 'Clockwork Blunderbuss',
    damage: 14,          // damage per pellet
    speed: 1600,         // px/s - fast shrapnel scatter
    spread: 0.22,        // radians (+/- ~12.6 deg cone)
    magazine: 2,
    maxAmmo: 2,
    reload: 2.2,         // seconds
    reloadTime: 2.2,
    fireRate: 1.5,       // shots/sec
    pellets: 6,          // 6 scatter pellets per discharge (total potential: 84 dmg)
    range: 450,
    soundType: 'gunfire',
    soundRadius: 300,
    description: 'Двоствольний картечник ближнього бою, що накриває ворога шквалом шрапнелі.'
  },
  needle_gun: {
    id: 'needle_gun',
    name: 'Пневматичний голкостріл',
    englishName: 'Pneumatic Needle Gun',
    damage: 10,
    speed: 2500,         // px/s - hyper-velocity flechette dart
    spread: 0.01,        // radians (+/- ~0.57 deg)
    magazine: 30,
    maxAmmo: 30,
    reload: 1.8,         // seconds
    reloadTime: 1.8,
    fireRate: 10.0,      // shots/sec (cooldown: 0.10s)
    pellets: 1,
    range: 800,
    soundType: 'gunfire',
    soundRadius: 180,
    description: 'Високострільний метач, що запускає смертоносні сталеві флешети з шаленою швидкістю.'
  },
  tesla_rifle: {
    id: 'tesla_rifle',
    name: 'Тесла-карабін "Зевс"',
    englishName: 'Tesla Arc Rifle',
    damage: 48,
    speed: 2800,
    spread: 0.015,
    magazine: 5,
    maxAmmo: 5,
    reload: 2.2,
    reloadTime: 2.2,
    fireRate: 1.8,
    pellets: 1,
    range: 850,
    soundType: 'gunfire',
    soundRadius: 280,
    description: 'Електро-дугова гвинтівка, що генерує надшвидкісні ланцюгові високовольтні розряди.'
  },
  steam_mortar: {
    id: 'steam_mortar',
    name: 'Паровий гранатомет "Молох"',
    englishName: 'Steam Mortar',
    damage: 65,
    speed: 1400,
    spread: 0.08,
    magazine: 3,
    maxAmmo: 3,
    reload: 2.6,
    reloadTime: 2.6,
    fireRate: 1.0,
    pellets: 1,
    range: 600,
    soundType: 'gunfire',
    soundRadius: 340,
    description: 'Важка пневматична мортира для пробивання броньованих автоматонів вибуховою паровою шрапнеллю.'
  },
  aether_flamethrower: {
    id: 'aether_flamethrower',
    name: 'Вогнемет "Дракон"',
    englishName: 'Aether Flamethrower',
    damage: 8,
    speed: 1300,
    spread: 0.28,
    magazine: 40,
    maxAmmo: 40,
    reload: 2.4,
    reloadTime: 2.4,
    fireRate: 14.0,
    pellets: 2,
    range: 380,
    soundType: 'gunfire',
    soundRadius: 210,
    description: 'Розпилювач палаючого алхімічного ефіру, що створює смертоносну вогняну завісу.'
  },
  gatling_cannon: {
    id: 'gatling_cannon',
    name: 'Картечниця Гатлінга',
    englishName: 'Gatling Cannon',
    damage: 16,
    speed: 2200,
    spread: 0.06,
    magazine: 45,
    maxAmmo: 45,
    reload: 3.0,
    reloadTime: 3.0,
    fireRate: 11.0,
    pellets: 1,
    range: 720,
    soundType: 'gunfire',
    soundRadius: 320,
    description: 'Шестиствольна роторна картечниця з паровим приводом та гігантським латунним барабаном.'
  }
};

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
