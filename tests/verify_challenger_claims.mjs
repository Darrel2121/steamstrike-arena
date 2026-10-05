/**
 * Challenger Verification Script: Empirical Stress-Test of Audit Claims
 * Validates:
 * 1. Ballistics & Weapon Math (T0 vs T5, Burst DPS, Sustained DPS, TTK, Tick Discretization, Travel Time, Spread Falloff)
 * 2. Bot AI Behavioral Vulnerabilities (RETREAT Dormancy, Oscillating Target aimTime Reset, Missing 360° Bubble)
 */

import { WEAPON_DEFINITIONS, getWeapon } from '../server/combat/WeaponDefinitions.js';
import { calculateEffectiveWeaponStats, calculateCharacterStats } from '../shared/ProgressionSchema.js';
import { Bot } from '../server/entities/Bot.js';
import { Player } from '../server/entities/Player.js';
import { Room } from '../server/Room.js';
import { isPointVisible } from '../shared/RaycastMath.js';

console.log('========================================================================');
console.log('CHALLENGER AUDIT EMPIRICAL VERIFICATION HARNESS');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// PART 1: WEAPON MATH & BALLISTICS VERIFICATION
// -----------------------------------------------------------------------------
console.log('--- PART 1: WEAPON MATH VERIFICATION ---\n');

const weapons = ['revolver', 'steam_carbine', 'blunderbuss', 'needle_gun'];

for (const wid of weapons) {
  const base = getWeapon(wid);
  const t5 = calculateEffectiveWeaponStats(base, {
    damageTier: 5,
    fireRateTier: 5,
    reloadTier: 5,
    capacityTier: 5
  });

  console.log(`[Weapon: ${base.name} (${wid})]`);
  console.log(`  Base: dmg=${base.damage}, rate=${base.fireRate}, mag=${base.magazine}, reload=${base.reload}, speed=${base.speed}`);
  console.log(`  T5:   dmg=${t5.damage}, rate=${t5.fireRate}, mag=${t5.magazine}, reload=${t5.reload}, speed=${t5.speed}`);

  // Base Calculations
  const baseBurstDps = (wid === 'blunderbuss' ? base.damage * base.pellets : base.damage) * base.fireRate;
  const baseMagEmptyTime = (base.magazine - 1) / base.fireRate;
  const baseMagDamage = (wid === 'blunderbuss' ? base.damage * base.pellets : base.damage) * base.magazine;
  const baseCycleTime = baseMagEmptyTime + base.reload;
  const baseSustainedDps = baseMagDamage / baseCycleTime;

  // T5 Calculations
  const t5BurstDps = (wid === 'blunderbuss' ? t5.damage * t5.pellets : t5.damage) * t5.fireRate;
  const t5MagEmptyTime = (t5.magazine - 1) / t5.fireRate;
  const t5MagDamage = (wid === 'blunderbuss' ? t5.damage * t5.pellets : t5.damage) * t5.magazine;
  const t5CycleTime = t5MagEmptyTime + t5.reload;
  const t5SustainedDps = t5MagDamage / t5CycleTime;

  console.log(`  Base Burst DPS:    ${baseBurstDps.toFixed(2)}`);
  console.log(`  Base Mag Empty:    ${baseMagEmptyTime.toFixed(3)}s (${baseMagDamage} dmg)`);
  console.log(`  Base Sustained DPS:${baseSustainedDps.toFixed(2)}`);
  console.log(`  T5 Burst DPS:      ${t5BurstDps.toFixed(2)}`);
  console.log(`  T5 Mag Empty:      ${t5MagEmptyTime.toFixed(3)}s (${t5MagDamage} dmg)`);
  console.log(`  T5 Sustained DPS:  ${t5SustainedDps.toFixed(2)}`);

  // TTK Calculations
  // 1. T0 Weapon vs 100 HP target
  const basePerShot = wid === 'blunderbuss' ? base.damage * base.pellets : base.damage;
  const baseShotsTo100 = Math.ceil(100 / basePerShot);
  const baseTtk100 = (baseShotsTo100 - 1) / base.fireRate;

  // 2. T5 Weapon vs 125 HP target
  const t5PerShot = wid === 'blunderbuss' ? t5.damage * t5.pellets : t5.damage;
  const t5ShotsTo125 = Math.ceil(125 / t5PerShot);
  const t5Ttk125 = (t5ShotsTo125 - 1) / t5.fireRate;

  // 3. T5 Weapon vs 100 HP target
  const t5ShotsTo100 = Math.ceil(100 / t5PerShot);
  const t5Ttk100 = (t5ShotsTo100 - 1) / t5.fireRate;

  // 4. T0 Weapon vs 125 HP target
  const baseShotsTo125 = Math.ceil(125 / basePerShot);
  const baseTtk125 = (baseShotsTo125 - 1) / base.fireRate;

  console.log(`  TTK (T0 vs 100 HP): ${baseTtk100.toFixed(3)}s (${baseShotsTo100} shots)`);
  console.log(`  TTK (T5 vs 125 HP): ${t5Ttk125.toFixed(3)}s (${t5ShotsTo125} shots)`);
  console.log(`  TTK (T5 vs 100 HP): ${t5Ttk100.toFixed(3)}s (${t5ShotsTo100} shots)`);
  console.log(`  TTK (T0 vs 125 HP): ${baseTtk125.toFixed(3)}s (${baseShotsTo125} shots)`);
  console.log('');
}

// -----------------------------------------------------------------------------
// PART 1B: DISCRETE TICK RATE SIMULATION VS CONTINUOUS FORMULA
// -----------------------------------------------------------------------------
console.log('--- PART 1B: 30 HZ TICK RATE DISCRETIZATION TEST ---');
for (const wid of weapons) {
  const base = getWeapon(wid);
  const player = new Player({ weaponId: wid });
  let tick = 0;
  let shotsFired = 0;
  const shotTicks = [];
  const dt = 1 / 30; // 30 Hz

  // Simulate holding fire trigger for 90 ticks (3 seconds)
  for (let t = 0; t < 90; t++) {
    if (player.fireCooldown <= 0 && player.ammo > 0) {
      if (player.fire(true)) {
        shotsFired++;
        shotTicks.push(t);
      }
    }
    player.update(dt, false);
  }

  const continuousInterval = 1 / base.fireRate;
  const tickInterval = shotTicks.length > 1 ? (shotTicks[1] - shotTicks[0]) * dt : 0;
  console.log(`[${wid}] Ideal Cooldown: ${continuousInterval.toFixed(4)}s (${(continuousInterval * 30).toFixed(2)} ticks) | Actual Tick Interval: ${tickInterval.toFixed(4)}s (${shotTicks[1] - shotTicks[0]} ticks)`);
}
console.log('');

// -----------------------------------------------------------------------------
// PART 2: BOT AI VERIFICATION
// -----------------------------------------------------------------------------
console.log('--- PART 2: BOT AI CLAIMS VERIFICATION ---\n');

// 2A: Is RETREAT Dead Code?
console.log('[Test 2A: RETREAT Dead Code Verification]');
const bot = new Bot({ id: 'bot_test', x: 200, y: 200, hp: 10, maxHp: 100 });
const roomMock = {
  map: { width: 800, height: 800, grid: [] },
  geometrySegments: [],
  players: new Map(),
  bots: new Map(),
  projectiles: [],
  soundEvents: []
};

// Attack the bot repeatedly, drain ammo, let it tick for 100 iterations
bot.ammo = 0;
let reachedRetreat = false;
for (let i = 0; i < 100; i++) {
  bot.takeDamage(1);
  bot.update(1 / 30, roomMock);
  if (bot.state === 'RETREAT') {
    reachedRetreat = true;
    break;
  }
}
console.log(`  Did Bot ever enter RETREAT state under low HP & 0 ammo? ${reachedRetreat ? 'YES' : 'NO (CONFIRMED DEAD CODE)'}`);

// 2B: Does Target Oscillating Proximity Reset aimTime?
console.log('\n[Test 2B: Oscillating Target Proximity & aimTime Reset]');
const testBot = new Bot({ id: 'aim_bot', x: 100, y: 100, angle: 0 }); // facing +X (angle 0)
const enemyA = new Player({ id: 'enemy_a', x: 200, y: 100, hp: 100 }); // directly ahead
const enemyB = new Player({ id: 'enemy_b', x: 201, y: 100, hp: 100 }); // slightly behind A

const dualRoom = {
  map: { width: 800, height: 800 },
  geometrySegments: [],
  players: new Map([['enemy_a', enemyA], ['enemy_b', enemyB]]),
  bots: new Map([['aim_bot', testBot]]),
  projectiles: [],
  soundEvents: []
};

let fired = false;
testBot.reactionDelay = 0.50; // 500ms

// Simulate 60 ticks (2.0 seconds) while oscillating which enemy is 1px closer each tick
for (let t = 0; t < 60; t++) {
  if (t % 2 === 0) {
    enemyA.x = 200;
    enemyB.x = 205;
  } else {
    enemyA.x = 205;
    enemyB.x = 200;
  }

  testBot.update(1 / 30, dualRoom);
  if (dualRoom.projectiles.length > 0) {
    fired = true;
    break;
  }
}
console.log(`  After 2.0s of target distance oscillation at tick rate:`);
console.log(`  Bot aimTime: ${testBot.aimTime.toFixed(4)}s (Reaction threshold needed: 0.50s)`);
console.log(`  Did Bot fire any shots? ${fired ? 'YES' : 'NO (CONFIRMED EXPLOIT: aimTime indefinitely locked at ~0.033s!)'}`);

// 2C: Missing 360° Proximity Bubble
console.log('\n[Test 2C: Bot Sensory 360° Proximity Awareness Check]');
const blindBot = new Bot({ id: 'blind_bot', x: 300, y: 300, angle: 0 }); // facing East (0 rad)
// Place enemy directly BEHIND bot (West, angle PI) at distance 20px (well within 45px proximity bubble)
const sneakPlayer = new Player({ id: 'sneaker', x: 280, y: 300, hp: 100 });

const sneakRoom = {
  map: { width: 800, height: 800 },
  geometrySegments: [],
  players: new Map([['sneaker', sneakPlayer]]),
  bots: new Map([['blind_bot', blindBot]]),
  projectiles: [],
  soundEvents: []
};

blindBot.scanVisualTargets(sneakRoom);
console.log(`  Sneak player at 20px behind bot (facing 0 rad, enemy at PI rad).`);
console.log(`  Did Bot detect player in close proximity? ${blindBot.currentTargetId === 'sneaker' ? 'YES' : 'NO (CONFIRMED: Bot has NO 360° proximity bubble, blind to rear)'}`);

console.log('\n========================================================================');
console.log('VERIFICATION COMPLETE');
console.log('========================================================================');
