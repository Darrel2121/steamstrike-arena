/**
 * Shared Progression Schema & Economy Engine
 * Single source of truth for XP level curves, attribute tiers, weapon workshop upgrades, and match reward math.
 */

import { CHARACTER_CLASSES, DEFAULT_CLASS_ID, getClassDefinition } from './CharacterClasses.js';
export { CHARACTER_CLASSES, DEFAULT_CLASS_ID, getClassDefinition };

export const MAX_UPGRADE_TIER = 5;

// Base Character Attributes
export const BASE_CHARACTER_STATS = {
  maxHp: 100,        // +5 HP per tier (100 -> 125)
  moveSpeed: 180,    // +4 px/s per tier (180 -> 200)
  lanternRange: 420  // +15 px per tier (420 -> 495)
};

export const CHARACTER_TIER_MODIFIERS = {
  health: { stat: 'maxHp', step: 5, base: 100 },
  speed: { stat: 'moveSpeed', step: 4, base: 180 },
  lantern: { stat: 'lanternRange', step: 15, base: 420 }
};

// Costs per tier upgrade (0->1, 1->2, 2->3, 3->4, 4->5)
export const CHARACTER_UPGRADE_COSTS = [
  { tier: 1, scrap: 150, cores: 0 },
  { tier: 2, scrap: 300, cores: 1 },
  { tier: 3, scrap: 600, cores: 2 },
  { tier: 4, scrap: 1000, cores: 3 },
  { tier: 5, scrap: 1500, cores: 5 }
];

export const WEAPON_UPGRADE_COSTS = [
  { tier: 1, scrap: 200, cores: 0 },
  { tier: 2, scrap: 450, cores: 1 },
  { tier: 3, scrap: 750, cores: 2 },
  { tier: 4, scrap: 1200, cores: 3 },
  { tier: 5, scrap: 1800, cores: 5 }
];

export const WEAPON_UNLOCK_COSTS = {
  revolver: { scrap: 0, cores: 0 },
  steam_carbine: { scrap: 200, cores: 1 },
  blunderbuss: { scrap: 350, cores: 2 },
  needle_gun: { scrap: 500, cores: 3 },
  tesla_rifle: { scrap: 1000, cores: 4 },
  steam_mortar: { scrap: 1300, cores: 5 },
  aether_flamethrower: { scrap: 1600, cores: 6 },
  gatling_cannon: { scrap: 2000, cores: 8 }
};

// Weapon capacity bonus step per weapon
export const WEAPON_CAPACITY_STEPS = {
  revolver: 1,           // 6 -> 11
  steam_carbine: 2,      // 20 -> 30
  blunderbuss: 1,        // 2 -> 7
  needle_gun: 2,         // 30 -> 40
  tesla_rifle: 1,        // 5 -> 10
  steam_mortar: 1,       // 3 -> 8
  aether_flamethrower: 4,// 40 -> 60
  gatling_cannon: 5      // 45 -> 70
};

export const WEAPON_DEFINITIONS = {
  revolver: {
    id: 'revolver',
    name: 'Годинниковий револьвер',
    englishName: 'Clockwork Revolver',
    damage: 35,
    speed: 1800,
    spread: 0.02,
    magazine: 6,
    maxAmmo: 6,
    reload: 1.5,
    reloadTime: 1.5,
    fireRate: 2.5,
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
    speed: 2100,
    spread: 0.05,
    magazine: 20,
    maxAmmo: 20,
    reload: 2.0,
    reloadTime: 2.0,
    fireRate: 7.0,
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
    damage: 14,
    speed: 1600,
    spread: 0.22,
    magazine: 2,
    maxAmmo: 2,
    reload: 2.2,
    reloadTime: 2.2,
    fireRate: 1.5,
    pellets: 6,
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
    speed: 2500,
    spread: 0.01,
    magazine: 30,
    maxAmmo: 30,
    reload: 1.8,
    reloadTime: 1.8,
    fireRate: 10.0,
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
 * Calculates XP required to advance from level L to L+1.
 * Formula: floor(100 * L^1.5)
 * @param {number} level - Current level (>= 1)
 * @returns {number}
 */
export function getXpRequiredForNextLevel(level) {
  const current = Math.max(1, Math.floor(level || 1));
  return Math.floor(100 * Math.pow(current, 1.5));
}

/**
 * Calculates cumulative total XP required to reach a target level from level 1.
 * @param {number} targetLevel (>= 1)
 * @returns {number}
 */
export function getTotalXpForLevel(targetLevel) {
  const target = Math.max(1, Math.floor(targetLevel || 1));
  let total = 0;
  for (let l = 1; l < target; l++) {
    total += Math.floor(100 * Math.pow(l, 1.5));
  }
  return total;
}

/**
 * Calculates level and progress metrics from lifetime cumulative XP.
 * @param {number} totalXp
 * @returns {{ level: number, currentLevelBaseXp: number, nextLevelTargetXp: number, currentXpIntoLevel: number, xpRequiredForNext: number, progressRatio: number }}
 */
export function calculateLevelFromTotalXp(totalXp) {
  const xp = (typeof totalXp === 'number' && Number.isFinite(totalXp)) ? Math.max(0, Math.floor(totalXp)) : 0;
  let level = 1;
  let cumulative = 0;

  while (true) {
    const nextStep = Math.floor(100 * Math.pow(level, 1.5));
    if (cumulative + nextStep > xp) {
      const currentLevelBaseXp = cumulative;
      const nextLevelTargetXp = cumulative + nextStep;
      const currentXpIntoLevel = xp - currentLevelBaseXp;
      const progressRatio = nextStep > 0 ? currentXpIntoLevel / nextStep : 0;
      return {
        level,
        currentLevelBaseXp,
        nextLevelTargetXp,
        currentXpIntoLevel,
        xpRequiredForNext: nextStep,
        progressRatio: Math.min(1.0, Math.max(0.0, progressRatio))
      };
    }
    cumulative += nextStep;
    level++;
  }
}

/**
 * Alias for calculateLevelFromTotalXp
 */
export function calculateLevelFromXp(totalXp) {
  return calculateLevelFromTotalXp(totalXp);
}

/**
 * Calculates effective character stats from upgrade tiers.
 * Supports both tier names ('healthTier', 'speedTier', 'lanternTier')
 * and level names ('maxHpLevel', 'speedLevel', 'lanternLevel').
 * @param {Object} tiers
 * @returns {{ maxHp: number, moveSpeed: number, lanternRange: number }}
 */
export function calculateCharacterStats(tiers = {}) {
  const hTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.healthTier ?? tiers.maxHpLevel ?? 0));
  const sTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.speedTier ?? tiers.speedLevel ?? 0));
  const lTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.lanternTier ?? tiers.lanternLevel ?? 0));

  return {
    maxHp: BASE_CHARACTER_STATS.maxHp + hTier * CHARACTER_TIER_MODIFIERS.health.step,
    moveSpeed: BASE_CHARACTER_STATS.moveSpeed + sTier * CHARACTER_TIER_MODIFIERS.speed.step,
    lanternRange: BASE_CHARACTER_STATS.lanternRange + lTier * CHARACTER_TIER_MODIFIERS.lantern.step
  };
}

/**
 * Calculates effective character stats factoring in the chosen Steampunk Class.
 * Preserves 100% backward compatibility when classId is vanguard or omitted.
 * @param {Object} tiers
 * @param {string} [classId='vanguard']
 * @returns {{ maxHp: number, moveSpeed: number, lanternRange: number, classId: string, className: string, classDef: Object }}
 */
export function calculateEffectiveCharacterStats(tiers = {}, classId = DEFAULT_CLASS_ID) {
  const baseStats = calculateCharacterStats(tiers);
  const cls = getClassDefinition(classId);
  return {
    maxHp: Math.round(baseStats.maxHp * cls.hpMultiplier),
    moveSpeed: Math.round(baseStats.moveSpeed * cls.speedMultiplier),
    lanternRange: Math.round(baseStats.lanternRange * cls.lanternMultiplier),
    classId: cls.id,
    className: cls.name,
    classDef: cls
  };
}

/**
 * Alias for calculateCharacterStats
 */
export function getModifiedPlayerStats(tiers = {}) {
  return calculateCharacterStats(tiers);
}

/**
 * Calculates effective weapon stats from base stats and upgrade tiers.
 * @param {Object} baseWeapon - Base weapon definition
 * @param {Object} tiers - Upgrade tiers or levels
 * @returns {Object} Effective weapon stats
 */
export function calculateEffectiveWeaponStats(baseWeapon, tiers = {}) {
  if (!baseWeapon) return null;

  const dTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.damageTier ?? tiers.damageLevel ?? 0));
  const fTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.fireRateTier ?? tiers.fireRateLevel ?? 0));
  const rTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.reloadTier ?? tiers.reloadLevel ?? 0));
  const cTier = Math.min(MAX_UPGRADE_TIER, Math.max(0, tiers.capacityTier ?? tiers.capacityLevel ?? 0));

  const capacityStep = WEAPON_CAPACITY_STEPS[baseWeapon.id] || 1;

  // Damage: +8% per level
  const effectiveDamage = Math.round(baseWeapon.damage * (1 + 0.08 * dTier));

  // Fire Rate: +10% per level
  const effectiveFireRate = Number((baseWeapon.fireRate * (1 + 0.10 * fTier)).toFixed(2));

  // Reload Speed: -10% duration per level (clamped at minimum 0.4s)
  const effectiveReload = Math.max(0.4, Number((baseWeapon.reload * (1 - 0.10 * rTier)).toFixed(2)));

  // Magazine Capacity: base + step * tier
  const effectiveMagazine = baseWeapon.magazine + cTier * capacityStep;

  return {
    ...baseWeapon,
    damage: effectiveDamage,
    fireRate: effectiveFireRate,
    reload: effectiveReload,
    reloadTime: effectiveReload,
    magazine: effectiveMagazine,
    maxAmmo: effectiveMagazine,
    tiers: {
      damageTier: dTier,
      fireRateTier: fTier,
      reloadTier: rTier,
      capacityTier: cTier,
      damageLevel: dTier,
      fireRateLevel: fTier,
      reloadLevel: rTier,
      capacityLevel: cTier
    }
  };
}

/**
 * Alias for calculateEffectiveWeaponStats
 */
export function getModifiedWeaponStats(baseWeapon, tiers = {}) {
  return calculateEffectiveWeaponStats(baseWeapon, tiers);
}

/**
 * Calculates match end rewards in XP, Clockwork Scrap, and Aetherium Cores.
 * @param {Object} params
 * @param {number} [params.placement=4] - 1st, 2nd, 3rd, 4th, etc.
 * @param {number} [params.kills=0]
 * @param {number} [params.damageDealt=0]
 * @param {number} [params.survivalSeconds=0]
 * @returns {{ xp: number, scrap: number, cores: number, breakdown: Object }}
 */
export function calculateMatchRewards({ placement = 4, kills = 0, damageDealt = 0, survivalSeconds = 0 } = {}) {
  const safeKills = Math.max(0, Math.floor(kills || 0));
  const safeDamage = Math.max(0, Math.floor(damageDealt || 0));
  const safeSurvival = Math.max(0, Math.floor(survivalSeconds || 0));

  const PLACEMENT_XP = { 1: 200, 2: 100, 3: 50 };
  const PLACEMENT_SCRAP = { 1: 150, 2: 75, 3: 35 };

  const placementXp = PLACEMENT_XP[placement] || 20;
  const placementScrap = PLACEMENT_SCRAP[placement] || 15;

  const killXp = safeKills * 50;
  const damageXp = Math.floor(safeDamage * 0.5);
  const survivalXp = Math.floor(safeSurvival * 1.5);
  const baseXp = 50;
  const totalXp = baseXp + placementXp + killXp + damageXp + survivalXp;

  const killScrap = safeKills * 25;
  const damageScrap = Math.floor(safeDamage * 0.25);
  const survivalScrap = Math.floor(safeSurvival * 0.5);
  const baseScrap = 25;
  const totalScrap = baseScrap + placementScrap + killScrap + damageScrap + survivalScrap;

  // 1st place always earns 1 Aetherium Core; achieving >= 5 kills also grants 1 core
  const cores = placement === 1 ? 1 : (safeKills >= 5 ? 1 : 0);

  return {
    xp: totalXp,
    scrap: totalScrap,
    cores,
    breakdown: {
      placement,
      baseXp,
      placementXp,
      killXp,
      damageXp,
      survivalXp,
      baseScrap,
      placementScrap,
      killScrap,
      damageScrap,
      survivalScrap
    }
  };
}

/**
 * Creates a clean default profile structure.
 * @param {Object} options
 * @returns {Object}
 */
export function createDefaultProfile(options = {}) {
  const id = options.id || ('guest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  const username = options.username || ('BrassMechanic#' + Math.floor(100 + Math.random() * 900));

  return {
    id,
    username,
    isGuest: options.isGuest !== undefined ? options.isGuest : true,
    googleId: options.googleId || null,
    email: options.email || null,
    avatar: options.avatar || options.avatarUrl || null,
    avatarUrl: options.avatarUrl || options.avatar || null,
    createdAt: options.createdAt || Date.now(),
    updatedAt: options.updatedAt || Date.now(),
    xp: options.xp || 0,
    level: options.level || 1,
    currency: {
      scrap: options.currency?.scrap ?? 500,  // Initial testing allocation
      cores: options.currency?.cores ?? 2
    },
    characterStats: {
      healthTier: 0,
      speedTier: 0,
      lanternTier: 0,
      maxHpLevel: 0,
      speedLevel: 0,
      lanternLevel: 0
    },
    weapons: {
      revolver: { unlocked: true, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      steam_carbine: { unlocked: true, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      blunderbuss: { unlocked: true, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      needle_gun: { unlocked: true, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      tesla_rifle: { unlocked: false, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      steam_mortar: { unlocked: false, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      aether_flamethrower: { unlocked: false, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 },
      gatling_cannon: { unlocked: false, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0, damageLevel: 0, fireRateLevel: 0, reloadLevel: 0, capacityLevel: 0 }
    },
    equippedWeapon: options.equippedWeapon || 'revolver',
    equippedClass: options.equippedClass || DEFAULT_CLASS_ID,
    matchHistory: [],
    careerStats: {
      matchesPlayed: 0,
      wins: 0,
      kills: 0,
      damageDealt: 0
    }
  };
}

export const SCRAP_TO_CORE_EXCHANGE_RATE = 500; // 500 Clockwork Scrap -> 1 Aetherium Core

/**
 * Validates and executes scrap to core alchemical transmutation.
 * @param {Object} profile
 * @param {number} [coresToConvert=1]
 * @returns {{ success: boolean, error?: string, scrapCost?: number, coresGained?: number, newScrap?: number, newCores?: number }}
 */
export function transmuteScrapToCores(profile, coresToConvert = 1) {
  if (!profile || !profile.currency) {
    return { success: false, error: 'Invalid profile data' };
  }
  const count = typeof coresToConvert === 'number' ? Math.floor(coresToConvert) : 1;
  if (count < 1 || !Number.isFinite(count)) {
    return { success: false, error: 'Must transmute at least 1 core' };
  }

  const scrapCost = count * SCRAP_TO_CORE_EXCHANGE_RATE;
  const currentScrap = profile.currency.scrap || 0;
  if (currentScrap < scrapCost) {
    return {
      success: false,
      error: `Insufficient scrap: requires ${scrapCost}, have ${currentScrap}`
    };
  }

  const newScrap = currentScrap - scrapCost;
  const newCores = (profile.currency.cores || 0) + count;

  return {
    success: true,
    scrapCost,
    coresGained: count,
    newScrap,
    newCores
  };
}
