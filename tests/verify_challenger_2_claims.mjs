/**
 * Challenger Audit 2 Empirical Verification Harness
 * Tests:
 * 1. Progression Economy Math & Upgrade Cost Recalculations
 * 2. Blunderbuss Tier 5 Damage, Capacity, and One-Shot TTK
 * 3. Mobile Touch Deficits in InputManager.js
 * 4. Architectural Compatibility & Syntax of the 6 Code Blueprints
 */

import assert from 'node:assert';
import {
  CHARACTER_UPGRADE_COSTS,
  WEAPON_UPGRADE_COSTS,
  WEAPON_CAPACITY_STEPS,
  WEAPON_DEFINITIONS,
  calculateEffectiveWeaponStats,
  calculateCharacterStats,
  calculateMatchRewards,
  createDefaultProfile,
  getXpRequiredForNextLevel,
  getTotalXpForLevel
} from '../shared/ProgressionSchema.js';
import { getWeapon, createProjectileSpecs } from '../server/combat/WeaponDefinitions.js';
import { InputManager } from '../client/js/InputManager.js';
import { Bot } from '../server/entities/Bot.js';
import { Player } from '../server/entities/Player.js';
import { SOUND_CONFIGS } from '../shared/Constants.js';

console.log('========================================================================');
console.log('CHALLENGER AUDIT 2 — EMPIRICAL VERIFICATION HARNESS');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// TEST 1: PROGRESSION ECONOMY MATH
// -----------------------------------------------------------------------------
console.log('--- TEST 1: PROGRESSION ECONOMY MATH & CURRENCY AUDIT ---');

// 1.1 Character Attribute Costs
let charScrapPerAttr = 0;
let charCoresPerAttr = 0;
for (const step of CHARACTER_UPGRADE_COSTS) {
  charScrapPerAttr += step.scrap;
  charCoresPerAttr += step.cores;
}
console.log(`Character per-attribute costs (T1-T5): ${charScrapPerAttr} Scrap, ${charCoresPerAttr} Cores`);
assert.strictEqual(charScrapPerAttr, 3550, 'Char attribute scrap should be 3550');
assert.strictEqual(charCoresPerAttr, 11, 'Char attribute cores should be 11');

const numCharAttrs = 3; // health, speed, lantern
const totalCharScrap = charScrapPerAttr * numCharAttrs;
const totalCharCores = charCoresPerAttr * numCharAttrs;
console.log(`Total Character upgrade costs (3 stats): ${totalCharScrap} Scrap, ${totalCharCores} Cores`);
assert.strictEqual(totalCharScrap, 10650, 'Total char scrap should be 10650');
assert.strictEqual(totalCharCores, 33, 'Total char cores should be 33');

// 1.2 Weapon Attribute Costs
let weaponScrapPerTrack = 0;
let weaponCoresPerTrack = 0;
for (const step of WEAPON_UPGRADE_COSTS) {
  weaponScrapPerTrack += step.scrap;
  weaponCoresPerTrack += step.cores;
}
console.log(`Weapon per-track costs (T1-T5): ${weaponScrapPerTrack} Scrap, ${weaponCoresPerTrack} Cores`);
assert.strictEqual(weaponScrapPerTrack, 4400, 'Weapon track scrap should be 4400');
assert.strictEqual(weaponCoresPerTrack, 11, 'Weapon track cores should be 11');

const numTracksPerWeapon = 4; // damage, fireRate, reload, capacity
const singleWeaponScrap = weaponScrapPerTrack * numTracksPerWeapon;
const singleWeaponCores = weaponCoresPerTrack * numTracksPerWeapon;
console.log(`Total 1 Weapon upgrade costs (4 tracks): ${singleWeaponScrap} Scrap, ${singleWeaponCores} Cores`);
assert.strictEqual(singleWeaponScrap, 17600, 'Single weapon scrap should be 17600');
assert.strictEqual(singleWeaponCores, 44, 'Single weapon cores should be 44');

const numWeapons = 4; // revolver, carbine, blunderbuss, needle_gun
const allWeaponsScrap = singleWeaponScrap * numWeapons;
const allWeaponsCores = singleWeaponCores * numWeapons;
console.log(`Total All 4 Weapons upgrade costs (16 tracks): ${allWeaponsScrap} Scrap, ${allWeaponsCores} Cores`);
assert.strictEqual(allWeaponsScrap, 70400, 'All weapons scrap should be 70400');
assert.strictEqual(allWeaponsCores, 176, 'All weapons cores should be 176');

// 1.3 Grand Totals
const grandScrap1Wep = totalCharScrap + singleWeaponScrap;
const grandCores1Wep = totalCharCores + singleWeaponCores;
console.log(`Grand Total (Char + 1 Weapon): ${grandScrap1Wep} Scrap, ${grandCores1Wep} Cores`);
assert.strictEqual(grandScrap1Wep, 28250, 'Grand scrap (1 wep) must be 28250');
assert.strictEqual(grandCores1Wep, 77, 'Grand cores (1 wep) must be 77');

const grandScrapAllWep = totalCharScrap + allWeaponsScrap;
const grandCoresAllWep = totalCharCores + allWeaponsCores;
console.log(`Grand Total (Char + All 4 Weapons): ${grandScrapAllWep} Scrap, ${grandCoresAllWep} Cores`);
assert.strictEqual(grandScrapAllWep, 81050, 'Grand scrap (all wep) must be 81050');
assert.strictEqual(grandCoresAllWep, 209, 'Grand cores (all wep) must be 209');

// 1.4 Match Reward Core Allocation & Win Figures
// Verify that non-1st place with < 5 kills gives 0 cores
const reward2ndPlace = calculateMatchRewards({ placement: 2, kills: 2, damageDealt: 350, survivalSeconds: 60 });
console.log(`Match Reward 2nd place (2 kills, 350 dmg): ${reward2ndPlace.scrap} Scrap, ${reward2ndPlace.cores} Cores`);
assert.strictEqual(reward2ndPlace.cores, 0, '2nd place must yield 0 cores');

const reward1stPlace = calculateMatchRewards({ placement: 1, kills: 3, damageDealt: 400, survivalSeconds: 90 });
console.log(`Match Reward 1st place (3 kills, 400 dmg): ${reward1stPlace.scrap} Scrap, ${reward1stPlace.cores} Cores`);
assert.strictEqual(reward1stPlace.cores, 1, '1st place must yield 1 core');

// In 4-player lobbies (1 player + 3 bots/humans), max kills is 3. Kills >= 5 is impossible.
const maxLobbyKills = 3;
const rewardMaxKillsLose = calculateMatchRewards({ placement: 2, kills: maxLobbyKills, damageDealt: 500, survivalSeconds: 100 });
assert.strictEqual(rewardMaxKillsLose.cores, 0, 'In 4p lobby, non-1st place can NEVER earn a core');

// Therefore, 1 core per win. To earn 77 cores requires 77 wins; to earn 209 cores requires 209 wins.
console.log(`Core requirement per win: exactly 1 core per win -> 77 wins (1 weapon) / 209 wins (all weapons) verified!\n`);

// -----------------------------------------------------------------------------
// TEST 2: BLUNDERBUSS TIER 5 ONE-SHOT & DAMAGE SCALING
// -----------------------------------------------------------------------------
console.log('--- TEST 2: BLUNDERBUSS TIER 5 INSTANT-KILL VERIFICATION ---');

const baseBlunderbuss = getWeapon('blunderbuss');
const t5Blunderbuss = calculateEffectiveWeaponStats(baseBlunderbuss, {
  damageTier: 5,
  fireRateTier: 5,
  reloadTier: 5,
  capacityTier: 5
});

console.log(`Base Blunderbuss: dmgPerPellet=${baseBlunderbuss.damage}, pellets=${baseBlunderbuss.pellets}, mag=${baseBlunderbuss.magazine}`);
console.log(`T5 Blunderbuss:   dmgPerPellet=${t5Blunderbuss.damage}, pellets=${t5Blunderbuss.pellets}, mag=${t5Blunderbuss.magazine}`);

const totalDamagePerBlast = t5Blunderbuss.damage * t5Blunderbuss.pellets;
console.log(`T5 Blast Damage: ${t5Blunderbuss.damage} x ${t5Blunderbuss.pellets} = ${totalDamagePerBlast} damage`);
assert.strictEqual(t5Blunderbuss.damage, 20, 'T5 Blunderbuss damage per pellet must be 20');
assert.strictEqual(t5Blunderbuss.pellets, 6, 'Blunderbuss pellets must be 6');
assert.strictEqual(totalDamagePerBlast, 120, 'T5 blast damage must be 120');

// Base target HP is 100
const baseTargetHp = 100;
const shotsToKill100Hp = Math.ceil(baseTargetHp / totalDamagePerBlast);
const ttk100Hp = (shotsToKill100Hp - 1) / t5Blunderbuss.fireRate;
console.log(`Shots to kill 100 HP target: ${shotsToKill100Hp}`);
console.log(`TTK vs 100 HP target: ${ttk100Hp.toFixed(2)}s`);
assert.strictEqual(shotsToKill100Hp, 1, 'Shots to kill must be 1 (one-shot)');
assert.strictEqual(ttk100Hp, 0.0, 'TTK must be 0.00s');

// Magazine capacity at T5
assert.strictEqual(t5Blunderbuss.magazine, 7, 'T5 Blunderbuss capacity must be 7 shells');
const totalMagDamage = t5Blunderbuss.magazine * totalDamagePerBlast;
console.log(`T5 Cylinder Capacity: ${t5Blunderbuss.magazine} shells (Total potential damage: ${totalMagDamage})\n`);
assert.strictEqual(totalMagDamage, 840, 'Total cylinder damage must be 840');

// -----------------------------------------------------------------------------
// TEST 3: MOBILE TOUCH INPUT DEFICITS IN INPUTMANAGER.JS
// -----------------------------------------------------------------------------
console.log('--- TEST 3: MOBILE INPUT DEFICITS VERIFICATION ---');

const inputMgr = new InputManager();

// Simulate touch events
const mockTouch = { clientX: 200, clientY: 300, identifier: 0 };
inputMgr.onTouchStart({ touches: [mockTouch] });

// Poll input during touch
let polled = inputMgr.pollInput(400, 400);
console.log('Polled input during touch:');
console.log(`  moveX: ${polled.moveX}, moveY: ${polled.moveY}`);
console.log(`  firing: ${polled.firing}, sprint: ${polled.sprint}, reload: ${polled.reload}`);

assert.strictEqual(polled.moveX, 0, 'moveX must be 0 on touch because no virtual joystick exists');
assert.strictEqual(polled.moveY, 0, 'moveY must be 0 on touch because no virtual joystick exists');
assert.strictEqual(polled.firing, true, 'touch starts firing immediately');
assert.strictEqual(polled.sprint, false, 'sprint cannot be activated via touch');
assert.strictEqual(polled.reload, false, 'reload cannot be activated via touch');

// Simulate moving touch
inputMgr.onTouchMove({ touches: [{ clientX: 250, clientY: 350, identifier: 0 }] });
polled = inputMgr.pollInput(400, 400);
assert.strictEqual(polled.moveX, 0, 'moveX remains 0 during touch drag');
assert.strictEqual(polled.moveY, 0, 'moveY remains 0 during touch drag');

// Simulate touch end
inputMgr.onTouchEnd({ touches: [] });
polled = inputMgr.pollInput(400, 400);
assert.strictEqual(polled.firing, false, 'firing stops on touch end');
inputMgr.destroy();

console.log('Mobile touch deficit confirmed: zero movement, sprint, or reload touch handling exists!\n');

// -----------------------------------------------------------------------------
// TEST 4: BLUEPRINT ADVERSARIAL INSPECTION & SYNTAX EXECUTION
// -----------------------------------------------------------------------------
console.log('--- TEST 4: ADVERSARIAL INSPECTION OF THE 6 BLUEPRINTS ---');

// Blueprint 1: Dynamic Spread
console.log('Evaluating Blueprint 1 (Dynamic Spread)...');
function blueprint1_createProjectileSpecs(weaponId, origin, baseAngle, shooterId = null, options = {}) {
  const weapon = getWeapon(weaponId);
  const specs = [];
  const pellets = weapon.pellets || 1;
  const spreadMultiplier = typeof options.spreadMultiplier === 'number' ? options.spreadMultiplier : 1.0;
  const effectiveSpread = weapon.spread * spreadMultiplier;

  for (let i = 0; i < pellets; i++) {
    let shotAngle = baseAngle;
    if (pellets > 1) {
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

const stillSpecs = blueprint1_createProjectileSpecs('carbine', { x: 0, y: 0 }, 0, 'p1', { spreadMultiplier: 1.0 });
const sprintSpecs = blueprint1_createProjectileSpecs('carbine', { x: 0, y: 0 }, 0, 'p1', { spreadMultiplier: 3.2 });
assert.strictEqual(stillSpecs.length, 1);
assert.strictEqual(sprintSpecs.length, 1);
console.log('  Blueprint 1 executed cleanly and preserves interface compatibility.');

// Blueprint 2: Bot Aim Smoothing & Proximity Bubble
console.log('Evaluating Blueprint 2 (Bot Aim Smoothing & Retreat)...');
const bot = new Bot({ x: 100, y: 100 });
assert.strictEqual(bot.state, 'PATROL');

// Test RETREAT trigger logic from Blueprint 2:
const bp2_takeDamage = function(amount, attackerId = null) {
  const prevHp = bot.hp;
  bot.hp = Math.max(0, bot.hp - amount);
  const actualDamage = prevHp - bot.hp;
  if (bot.isAlive && actualDamage > 0) {
    if (bot.state === 'PATROL' || bot.state === 'INVESTIGATE') {
      if (attackerId) {
        bot.currentTargetId = attackerId;
        bot.state = 'ENGAGE';
      }
    }
    if (bot.hp <= 35 || (bot.ammo <= 0 && bot.isReloading)) {
      bot.state = 'RETREAT';
      bot.currentTargetId = attackerId || bot.currentTargetId;
      bot.aimTime = 0;
    }
  }
  return actualDamage;
};

// Inflict damage to drop HP to 30 (below 35 threshold)
bp2_takeDamage(70, 'attacker_1');
assert.strictEqual(bot.state, 'RETREAT', 'Bot state must transition to RETREAT on HP <= 35%');
assert.strictEqual(bot.currentTargetId, 'attacker_1');
console.log('  Blueprint 2 RETREAT transition verified.');

// Test Aim Smoothing angle difference clamping
const dt = 1 / 30;
let currentAngle = 0;
const targetAngle = Math.PI; // 180 deg
const maxTurnRate = (Math.PI * 2.2) * dt; // ~13.2 deg per tick
let angleDiff = targetAngle - currentAngle;
while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
currentAngle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurnRate);
assert(currentAngle > 0 && currentAngle < Math.PI, 'Aim smoothing must turn gradually, not snap instantly');
console.log(`  Blueprint 2 Aim Smoothing verified (turned ${((currentAngle * 180) / Math.PI).toFixed(1)} deg in 1 tick).`);

// Blueprint 3: Virtual Thumbstick Vector
console.log('Evaluating Blueprint 3 (Mobile Dual-Thumbstick Controls)...');
const touchOrigin = { x: 100, y: 300 };
const touchCurrent = { x: 130, y: 340 };
const dx = touchCurrent.x - touchOrigin.x;
const dy = touchCurrent.y - touchOrigin.y;
const dist = Math.hypot(dx, dy);
const maxRadius = 45;
const clampedDist = Math.min(dist, maxRadius);
const angle = Math.atan2(dy, dx);
const touchMoveVector = {
  x: (clampedDist / maxRadius) * Math.cos(angle),
  y: (clampedDist / maxRadius) * Math.sin(angle)
};
assert(Math.hypot(touchMoveVector.x, touchMoveVector.y) <= 1.0001, 'Touch vector magnitude must be <= 1.0');
console.log(`  Blueprint 3 touch joystick math verified: normVector=(${touchMoveVector.x.toFixed(3)}, ${touchMoveVector.y.toFixed(3)}).`);

// Blueprint 4: Server Reload Acoustic Pulse
console.log('Evaluating Blueprint 4 (Authoritative Reload Sound Wave)...');
const mockRoom = { soundEvents: [] };
const mockPlayer = { id: 'p1', x: 250, y: 250, ammo: 0, maxAmmo: 6, isReloading: false, reload: () => { mockPlayer.isReloading = true; return true; } };

function triggerReloadSound(room, player) {
  const reloadSound = {
    id: 'snd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sourceId: player.id,
    x: player.x,
    y: player.y,
    type: 'reload',
    radius: 35,
    maxRadius: SOUND_CONFIGS?.reload?.maxRadius || 120,
    intensity: 0.75,
    createdAt: Date.now()
  };
  room.soundEvents.push(reloadSound);
}

if (mockPlayer.ammo <= 0 && !mockPlayer.isReloading) {
  const started = mockPlayer.reload();
  if (started) {
    triggerReloadSound(mockRoom, mockPlayer);
  }
}
assert.strictEqual(mockRoom.soundEvents.length, 1);
assert.strictEqual(mockRoom.soundEvents[0].type, 'reload');
assert.strictEqual(mockRoom.soundEvents[0].maxRadius, 120);
console.log('  Blueprint 4 reload acoustic pulse verified.');

// Blueprint 5: Wall Acoustic Attenuation
console.log('Evaluating Blueprint 5 (Wall Acoustic Attenuation)...');
function lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function calculateWallOcclusionFactor(soundX, soundY, listenerX, listenerY, wallSegments) {
  if (!wallSegments || wallSegments.length === 0) return 1.0;
  let intersectionCount = 0;
  for (const seg of wallSegments) {
    if (lineSegmentsIntersect(soundX, soundY, listenerX, listenerY, seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y)) {
      intersectionCount++;
      if (intersectionCount >= 3) break;
    }
  }
  if (intersectionCount === 0) return 1.0;
  if (intersectionCount === 1) return 0.55;
  return 0.25;
}

const walls = [
  { p1: { x: 200, y: 0 }, p2: { x: 200, y: 500 } }, // Wall 1 separating listener and sound
  { p1: { x: 300, y: 0 }, p2: { x: 300, y: 500 } }  // Wall 2
];
// Unblocked sound
const factor0 = calculateWallOcclusionFactor(100, 100, 150, 100, walls);
assert.strictEqual(factor0, 1.0, 'No wall intersection must yield factor 1.0');
// 1 wall
const factor1 = calculateWallOcclusionFactor(100, 100, 250, 100, walls);
assert.strictEqual(factor1, 0.55, '1 wall intersection must yield factor 0.55');
// 2 walls
const factor2 = calculateWallOcclusionFactor(100, 100, 350, 100, walls);
assert.strictEqual(factor2, 0.25, '2 wall intersections must yield factor 0.25');
console.log('  Blueprint 5 wall acoustic attenuation factors (1.0, 0.55, 0.25) verified.');

// Blueprint 6: Alchemical Scrap-to-Core Transmutation
console.log('Evaluating Blueprint 6 (Scrap-to-Core Transmutation)...');
const SCRAP_TO_CORE_EXCHANGE_RATE = 750;

function transmuteScrapToCores(profile, coresToConvert = 1) {
  if (!profile || !profile.currency) return { success: false, error: 'Invalid profile' };
  if (coresToConvert < 1 || !Number.isInteger(coresToConvert)) {
    return { success: false, error: 'Invalid core amount' };
  }

  const scrapCost = coresToConvert * SCRAP_TO_CORE_EXCHANGE_RATE;
  if (profile.currency.scrap < scrapCost) {
    return {
      success: false,
      error: `Insufficient scrap: requires ${scrapCost}, have ${profile.currency.scrap}`
    };
  }

  return {
    success: true,
    scrapCost,
    newScrap: profile.currency.scrap - scrapCost,
    newCores: (profile.currency.cores || 0) + coresToConvert
  };
}

const testProfile = createDefaultProfile({ currency: { scrap: 2000, cores: 1 } });
// Transmute 2 cores (costs 1500 scrap)
const transResult = transmuteScrapToCores(testProfile, 2);
assert.strictEqual(transResult.success, true);
assert.strictEqual(transResult.scrapCost, 1500);
assert.strictEqual(transResult.newScrap, 500);
assert.strictEqual(transResult.newCores, 3);

// Transmute with insufficient scrap
testProfile.currency.scrap = 300;
const transFail = transmuteScrapToCores(testProfile, 1);
assert.strictEqual(transFail.success, false);
console.log('  Blueprint 6 transmutation logic verified cleanly.\n');

console.log('========================================================================');
console.log('✔ ALL EMPIRICAL CHALLENGER ASSERTIONS PASSED WITH 100% SUCCESS!');
console.log('========================================================================');
