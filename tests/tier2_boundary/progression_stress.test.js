/**
 * Tier 2: Progression & Economy Stress Tests
 * Empirically stress-tests progression mathematics, XP curves (0 to 10M), upgrade clamping (tier 5),
 * character/weapon modifier formulas, reward edge-cases, and ProfileStore concurrency invariants.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import {
  MAX_UPGRADE_TIER,
  BASE_CHARACTER_STATS,
  CHARACTER_TIER_MODIFIERS,
  CHARACTER_UPGRADE_COSTS,
  WEAPON_UPGRADE_COSTS,
  WEAPON_UNLOCK_COSTS,
  WEAPON_CAPACITY_STEPS,
  WEAPON_DEFINITIONS,
  getXpRequiredForNextLevel,
  getTotalXpForLevel,
  calculateLevelFromTotalXp,
  calculateLevelFromXp,
  calculateCharacterStats,
  getModifiedPlayerStats,
  calculateEffectiveWeaponStats,
  getModifiedWeaponStats,
  calculateMatchRewards,
  createDefaultProfile
} from '../../shared/ProgressionSchema.js';
import { ProfileStore } from '../../server/db/ProfileStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DATA_DIR = path.join(__dirname, 'temp_prog_stress_' + Date.now());

export const suiteName = 'Tier 2: Progression, Economy & Reward Stress Cases';

export const tests = [
  {
    id: 'T2.P1',
    name: 'XP Curve Boundary Fuzzing & Monotonicity (0 to 10,000,000 XP)',
    fn: async () => {
      let prevLevel = 1;
      const xpCheckpoints = [];
      // Fine-grained 0..2000
      for (let x = 0; x <= 2000; x++) xpCheckpoints.push(x);
      // Medium 2000..50000
      for (let x = 2001; x <= 50000; x += 47) xpCheckpoints.push(x);
      // Coarse up to 10,000,000
      for (let x = 50001; x <= 10000000; x += 11317) xpCheckpoints.push(x);
      xpCheckpoints.push(10000000);

      for (const xp of xpCheckpoints) {
        const res = calculateLevelFromTotalXp(xp);

        // Monotonic level progression
        assert.ok(res.level >= prevLevel, `Level must not decrease: xp=${xp}, level=${res.level}, prev=${prevLevel}`);
        prevLevel = res.level;

        // Ratio bounds
        assert.ok(res.progressRatio >= 0.0 && res.progressRatio <= 1.0, `progressRatio out of bounds: ${res.progressRatio}`);

        // Arithmetic invariants
        assert.strictEqual(res.currentLevelBaseXp + res.currentXpIntoLevel, xp, `currentLevelBaseXp + currentXpIntoLevel must equal totalXp`);
        assert.strictEqual(res.nextLevelTargetXp - res.currentLevelBaseXp, res.xpRequiredForNext, `Target - Base must equal required`);
      }

      // Edge cases: 0, negative, null, undefined, NaN, float
      assert.strictEqual(calculateLevelFromTotalXp(0).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(-1000).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(null).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(undefined).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(NaN).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(150.9).level, 2);

      // Alias exact equivalence
      assert.deepStrictEqual(calculateLevelFromXp(12345), calculateLevelFromTotalXp(12345));
    }
  },

  {
    id: 'T2.P2',
    name: 'XP Level Bidirectional Invertibility & Boundary Math Invariants',
    fn: async () => {
      // Test levels 1 to 200
      for (let l = 1; l <= 200; l++) {
        const threshold = getTotalXpForLevel(l);
        const atThreshold = calculateLevelFromTotalXp(threshold);

        assert.strictEqual(atThreshold.level, l, `Level at exact threshold ${threshold} must be ${l}`);
        assert.strictEqual(atThreshold.currentXpIntoLevel, 0, `XP into level must be 0 at exact threshold`);
        assert.strictEqual(atThreshold.currentLevelBaseXp, threshold, `currentLevelBaseXp must equal threshold`);

        if (l > 1) {
          const justBelow = calculateLevelFromTotalXp(threshold - 1);
          assert.strictEqual(justBelow.level, l - 1, `Level at threshold - 1 must be ${l - 1}`);
          assert.strictEqual(justBelow.nextLevelTargetXp, threshold, `nextLevelTargetXp must match next threshold`);
        }
      }
    }
  },

  {
    id: 'T2.P3',
    name: 'Upgrade Tier Clamping at MAX_UPGRADE_TIER = 5 & Non-Deduction Invariance',
    fn: async () => {
      const store = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: path.join(TEMP_DATA_DIR, 'profiles.json') });
      await store.init();

      const profileId = 'clamp_test_user';
      await store.createProfile({
        id: profileId,
        currency: { scrap: 100000, cores: 500 }
      });

      // Character upgrades: max out health, speed, lantern
      for (const attr of ['health', 'speed', 'lantern']) {
        for (let t = 0; t < 5; t++) {
          const res = await store.upgradeCharacter(profileId, attr);
          assert.strictEqual(res.ok, true, `Upgrade ${attr} tier ${t + 1} should succeed`);
        }

        let prof = await store.getProfile(profileId);
        assert.strictEqual(prof.characterStats[`${attr}Tier`], 5, `${attr}Tier must equal 5`);

        const scrapBefore = prof.currency.scrap;
        const coresBefore = prof.currency.cores;

        // Attempt 6th upgrade
        const overRes = await store.upgradeCharacter(profileId, attr);
        assert.strictEqual(overRes.ok, false, `Over-tier upgrade for ${attr} must fail`);
        assert.ok(overRes.error.includes('already at maximum tier'), 'Error must specify maximum tier reached');

        prof = await store.getProfile(profileId);
        assert.strictEqual(prof.characterStats[`${attr}Tier`], 5, `${attr}Tier must remain strictly 5`);
        assert.strictEqual(prof.currency.scrap, scrapBefore, 'Scrap must not be deducted on over-tier attempt');
        assert.strictEqual(prof.currency.cores, coresBefore, 'Cores must not be deducted on over-tier attempt');
      }

      // Weapon upgrades: max out all 4 stats on revolver
      for (const stat of ['damage', 'fireRate', 'reload', 'capacity']) {
        for (let t = 0; t < 5; t++) {
          const res = await store.upgradeWeapon(profileId, 'revolver', stat);
          assert.strictEqual(res.ok, true, `Upgrade revolver ${stat} tier ${t + 1} should succeed`);
        }

        let prof = await store.getProfile(profileId);
        assert.strictEqual(prof.weapons.revolver[`${stat}Tier`], 5, `Revolver ${stat}Tier must equal 5`);

        const scrapBefore = prof.currency.scrap;
        const coresBefore = prof.currency.cores;

        const overRes = await store.upgradeWeapon(profileId, 'revolver', stat);
        assert.strictEqual(overRes.ok, false, `Over-tier upgrade for revolver ${stat} must fail`);
        assert.ok(overRes.error.includes('already at maximum tier'), 'Error must specify maximum tier');

        prof = await store.getProfile(profileId);
        assert.strictEqual(prof.weapons.revolver[`${stat}Tier`], 5, `Revolver ${stat}Tier must remain strictly 5`);
        assert.strictEqual(prof.currency.scrap, scrapBefore, 'Zero scrap deducted on over-tier weapon attempt');
        assert.strictEqual(prof.currency.cores, coresBefore, 'Zero cores deducted on over-tier weapon attempt');
      }
    }
  },

  {
    id: 'T2.P4',
    name: 'Character & Weapon Stat Modifier Mathematical Verifications Across All 4 Weapons',
    fn: async () => {
      // 1. Character Stats: Health (100 + 5/tier), Speed (180 + 4/tier), Lantern (420 + 15/tier)
      for (let t = 0; t <= 5; t++) {
        const stats = calculateCharacterStats({ healthTier: t, speedTier: t, lanternTier: t });
        assert.strictEqual(stats.maxHp, 100 + t * 5, `Health tier ${t}`);
        assert.strictEqual(stats.moveSpeed, 180 + t * 4, `Speed tier ${t}`);
        assert.strictEqual(stats.lanternRange, 420 + t * 15, `Lantern tier ${t}`);

        // Alias maxHpLevel, speedLevel, lanternLevel
        const altStats = calculateCharacterStats({ maxHpLevel: t, speedLevel: t, lanternLevel: t });
        assert.deepStrictEqual(altStats, stats, `Alternate naming tier ${t}`);
      }

      // Clamping of character stats
      const overChar = calculateCharacterStats({ healthTier: 99, speedTier: 99, lanternTier: 99 });
      assert.strictEqual(overChar.maxHp, 125);
      assert.strictEqual(overChar.moveSpeed, 200);
      assert.strictEqual(overChar.lanternRange, 495);

      const underChar = calculateCharacterStats({ healthTier: -5, speedTier: -5, lanternTier: -5 });
      assert.strictEqual(underChar.maxHp, 100);
      assert.strictEqual(underChar.moveSpeed, 180);
      assert.strictEqual(underChar.lanternRange, 420);

      // 2. Weapon Stats across all 4 weapons
      const weapons = ['revolver', 'steam_carbine', 'blunderbuss', 'needle_gun'];
      const capSteps = { revolver: 1, steam_carbine: 2, blunderbuss: 1, needle_gun: 2 };

      for (const wId of weapons) {
        const base = WEAPON_DEFINITIONS[wId];
        assert.ok(base, `Weapon ${wId} exists`);

        for (let t = 0; t <= 5; t++) {
          const eff = calculateEffectiveWeaponStats(base, {
            damageTier: t,
            fireRateTier: t,
            reloadTier: t,
            capacityTier: t
          });

          const expDmg = Math.round(base.damage * (1 + 0.08 * t));
          const expFire = Number((base.fireRate * (1 + 0.10 * t)).toFixed(2));
          const expReload = Math.max(0.4, Number((base.reload * (1 - 0.10 * t)).toFixed(2)));
          const expMag = base.magazine + t * capSteps[wId];

          assert.strictEqual(eff.damage, expDmg, `${wId} tier ${t} damage`);
          assert.strictEqual(eff.fireRate, expFire, `${wId} tier ${t} fireRate`);
          assert.strictEqual(eff.reload, expReload, `${wId} tier ${t} reload`);
          assert.strictEqual(eff.magazine, expMag, `${wId} tier ${t} magazine`);
          assert.strictEqual(eff.maxAmmo, expMag, `${wId} tier ${t} maxAmmo`);
        }

        // Clamping beyond tier 5
        const overW = calculateEffectiveWeaponStats(base, { damageTier: 10, fireRateTier: 10, reloadTier: 10, capacityTier: 10 });
        const maxW = calculateEffectiveWeaponStats(base, { damageTier: 5, fireRateTier: 5, reloadTier: 5, capacityTier: 5 });
        assert.deepStrictEqual(overW, maxW, `${wId} must strictly clamp at tier 5`);
      }

      // Minimum reload speed limit (0.4s floor)
      const mockFast = { id: 'fast_gun', damage: 10, fireRate: 5, reload: 0.5, magazine: 10 };
      const effFast = calculateEffectiveWeaponStats(mockFast, { reloadTier: 5 });
      assert.strictEqual(effFast.reload, 0.4, 'Reload floor must clamp at 0.4s');
    }
  },

  {
    id: 'T2.P5',
    name: 'Insufficient Currency Refusal & Atomic Rejection (Zero-Leakage Invariance)',
    fn: async () => {
      const store = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: path.join(TEMP_DATA_DIR, 'profiles.json') });
      await store.init();

      const profileId = 'broke_user';
      await store.createProfile({
        id: profileId,
        currency: { scrap: 50, cores: 0 } // Cannot afford any tier 1 upgrade (requires 150+ scrap)
      });

      // 1. Character upgrade failure
      const charRes = await store.upgradeCharacter(profileId, 'health');
      assert.strictEqual(charRes.ok, false);
      assert.ok(charRes.error.includes('Insufficient currency'));

      let prof = await store.getProfile(profileId);
      assert.strictEqual(prof.characterStats.healthTier, 0);
      assert.strictEqual(prof.currency.scrap, 50, 'Scrap untouched after failed character upgrade');
      assert.strictEqual(prof.currency.cores, 0, 'Cores untouched after failed character upgrade');

      // 2. Weapon upgrade failure
      const wepRes = await store.upgradeWeapon(profileId, 'revolver', 'damage');
      assert.strictEqual(wepRes.ok, false);
      assert.ok(wepRes.error.includes('Insufficient currency'));

      prof = await store.getProfile(profileId);
      assert.strictEqual(prof.weapons.revolver.damageTier, 0);
      assert.strictEqual(prof.currency.scrap, 50, 'Scrap untouched after failed weapon upgrade');

      // 3. Locked weapon unlock failure
      prof.weapons.blunderbuss.unlocked = false;
      await store.save(prof);

      const unlockRes = await store.unlockWeapon(profileId, 'blunderbuss');
      assert.strictEqual(unlockRes.ok, false);
      assert.ok(unlockRes.error.includes('Insufficient currency'));

      prof = await store.getProfile(profileId);
      assert.strictEqual(prof.weapons.blunderbuss.unlocked, false);
      assert.strictEqual(prof.currency.scrap, 50);
      assert.strictEqual(prof.currency.cores, 0);
    }
  },

  {
    id: 'T2.P6',
    name: 'Match Reward Formula Stress (Extreme Outliers, Negatives, Floats, Suicide & Determinism)',
    fn: async () => {
      // 1. Early suicide / 0 score
      const suicide = calculateMatchRewards({ placement: 4, kills: 0, damageDealt: 0, survivalSeconds: 0 });
      assert.strictEqual(suicide.xp, 70); // 50 base + 20 placement
      assert.strictEqual(suicide.scrap, 40); // 25 base + 15 placement
      assert.strictEqual(suicide.cores, 0);

      // 2. 1st place victory
      const win = calculateMatchRewards({ placement: 1, kills: 10, damageDealt: 5000, survivalSeconds: 180 });
      assert.strictEqual(win.cores, 1);
      assert.strictEqual(win.xp, 3520);
      assert.strictEqual(win.scrap, 1765);

      // 3. High kills loss (>= 5 kills earns 1 core)
      const highKillLoss = calculateMatchRewards({ placement: 4, kills: 5, damageDealt: 100, survivalSeconds: 20 });
      assert.strictEqual(highKillLoss.cores, 1);

      // 4. Extreme outlier inputs
      const extreme = calculateMatchRewards({ placement: 1, kills: 1000, damageDealt: 10000000, survivalSeconds: 7200 });
      assert.ok(Number.isInteger(extreme.xp));
      assert.ok(Number.isInteger(extreme.scrap));
      assert.ok(Number.isInteger(extreme.cores));
      assert.ok(extreme.xp > 0 && extreme.scrap > 0);

      // 5. Negative & float inputs
      const neg = calculateMatchRewards({ placement: -2, kills: -10, damageDealt: -500, survivalSeconds: -99 });
      assert.ok(neg.xp >= 0 && neg.scrap >= 0 && neg.cores >= 0);
      assert.ok(Number.isInteger(neg.xp) && Number.isInteger(neg.scrap));

      const float = calculateMatchRewards({ placement: 2.5, kills: 3.7, damageDealt: 450.9, survivalSeconds: 32.1 });
      assert.ok(Number.isInteger(float.xp) && Number.isInteger(float.scrap));

      // 6. Determinism check
      const p = { placement: 2, kills: 4, damageDealt: 850, survivalSeconds: 120 };
      const baseRes = calculateMatchRewards(p);
      for (let i = 0; i < 1000; i++) {
        assert.deepStrictEqual(calculateMatchRewards(p), baseRes);
      }
    }
  },

  {
    id: 'T2.P7',
    name: 'ProfileStore High-Concurrency Mutex & Atomic File Persistence Serialization',
    fn: async () => {
      const store = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: path.join(TEMP_DATA_DIR, 'profiles.json') });
      await store.init();

      const profileId = 'concurrency_stress_user';
      await store.createProfile({
        id: profileId,
        currency: { scrap: 1000, cores: 10 }
      });

      // 40 concurrent operations (mix of match rewards and stats updates)
      const tasks = [];
      for (let i = 0; i < 40; i++) {
        tasks.push(store.recordMatchResult(profileId, {
          matchId: `match_${i}`,
          placement: (i % 4) + 1,
          kills: i % 3,
          damageDealt: 150,
          survivalSeconds: 45
        }));
      }

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, 40);
      assert.ok(results.every(r => r.ok === true));

      const finalProfile = await store.getProfile(profileId);
      assert.strictEqual(finalProfile.careerStats.matchesPlayed, 40);
      assert.ok(finalProfile.matchHistory.length <= 30);
      assert.ok(finalProfile.xp > 0);

      // Verify file on disk is valid JSON
      const diskContent = await fs.promises.readFile(path.join(TEMP_DATA_DIR, 'profiles.json'), 'utf8');
      const parsed = JSON.parse(diskContent);
      assert.ok(parsed[profileId]);
      assert.strictEqual(parsed[profileId].careerStats.matchesPlayed, 40);

      // Clean up temp directory
      try {
        await fs.promises.rm(TEMP_DATA_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
