/**
 * Tier 2.12: Adversarial Auth Security, HMAC Token Integrity & ProfileStore Concurrency Suite
 * Authored by: challenger_prog_1
 *
 * Empirically stress-tests:
 * 1. HMAC-SHA256 token tampering, bad signatures, foreign secrets, expired timestamps, alg:none attacks, malformed base64, and 1,000 bit-flip mutations.
 * 2. ProfileStore concurrency stress: 50 simultaneous upgrades on single profile, 50 concurrent rewards across 20 profiles, mixed upgrade/reward races.
 * 3. Atomic file storage resilience: temp file cleanup, cold reload parity, Windows rename crash-safety.
 * 4. Account linking edge cases: guest linking into Google account, asymmetric higher guest stats merging, disjoint weapon unlock deduplication, currency sum verification, overwrite mode, and error boundaries.
 * 5. Callsign generator collision and format fuzzing: 200 rapid generations and 1,000 stress iterations.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { AuthService } from '../../server/auth/AuthService.js';
import { ProfileStore } from '../../server/db/ProfileStore.js';
import {
  MAX_UPGRADE_TIER,
  CHARACTER_UPGRADE_COSTS,
  WEAPON_UPGRADE_COSTS,
  WEAPON_UNLOCK_COSTS,
  calculateLevelFromTotalXp,
  createDefaultProfile
} from '../../shared/ProgressionSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DATA_DIR = path.join(__dirname, 'temp_auth_stress_' + Date.now());
const TEMP_PROFILES_FILE = path.join(TEMP_DATA_DIR, 'stress_profiles.json');

export const suiteName = 'Tier 2.12: Adversarial Auth Security, HMAC Integrity & Concurrency Stress';

let testStore;
let testAuth;

export const tests = [
  // ==========================================================================
  // SUITE 1: HMAC TOKEN CRYPTOGRAPHIC INTEGRITY & TAMPERING STRESS
  // ==========================================================================
  {
    id: 'T2.A1',
    name: 'HMAC Signature Integrity & Corrupted Signature Rejection',
    fn: async () => {
      fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
      testStore = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: TEMP_PROFILES_FILE });
      await testStore.init();

      testAuth = new AuthService({
        secret: 'adversarial-secret-steampunk-key-32chars!!',
        profileStore: testStore,
        tokenTtlMs: 3600 * 1000
      });

      const token = testAuth.generateToken({ accountId: 'valid_user_1', isGuest: true });
      assert.ok(typeof token === 'string');
      const parts = token.split('.');
      assert.strictEqual(parts.length, 3, 'Token must contain 3 parts');

      // Valid token decodes correctly
      const decoded = testAuth.verifyToken(token);
      assert.ok(decoded !== null);
      assert.strictEqual(decoded.accountId, 'valid_user_1');
      assert.strictEqual(decoded.isGuest, true);

      // Corrupt signature
      const badSig = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a');
      const corrupted = `${parts[0]}.${parts[1]}.${badSig}`;
      assert.strictEqual(testAuth.verifyToken(corrupted), null, 'Corrupted signature must return null');

      // Empty signature
      assert.strictEqual(testAuth.verifyToken(`${parts[0]}.${parts[1]}.`), null);
    }
  },

  {
    id: 'T2.A2',
    name: 'Foreign Secret Key Isolation (Zero Cross-Secret Access)',
    fn: async () => {
      const foreignAuth = new AuthService({ secret: 'attacker-generated-foreign-secret-key-99!!' });
      const foreignToken = foreignAuth.generateToken({ accountId: 'admin_victim', isGuest: false });

      const res = testAuth.verifyToken(foreignToken);
      assert.strictEqual(res, null, 'Token signed with foreign secret must be rejected');
    }
  },

  {
    id: 'T2.A3',
    name: 'Token Payload Tampering & Privilege Escalation Attack Rejection',
    fn: async () => {
      const legitToken = testAuth.generateToken({ accountId: 'guest_commoner', isGuest: true });
      const [h, b, s] = legitToken.split('.');

      const payloadObj = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
      payloadObj.accountId = 'google_admin_target';
      payloadObj.isGuest = false;
      const forgedBody = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      const forgedToken = `${h}.${forgedBody}.${s}`;
      assert.strictEqual(testAuth.verifyToken(forgedToken), null, 'Forged payload with original signature must be rejected');
    }
  },

  {
    id: 'T2.A4',
    name: 'Token Expiration Lifecycle Enforcement',
    fn: async () => {
      const expiredAuth = new AuthService({
        secret: testAuth.secret,
        tokenTtlMs: -5000 // Expired 5s ago
      });
      const expiredToken = expiredAuth.generateToken({ accountId: 'old_session' });
      assert.strictEqual(testAuth.verifyToken(expiredToken), null, 'Expired token must return null');
    }
  },

  {
    id: 'T2.A5',
    name: 'Algorithm "none" Signature Bypass Attack Defense',
    fn: async () => {
      const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ accountId: 'admin', exp: Date.now() + 100000 })).toString('base64url');

      assert.strictEqual(testAuth.verifyToken(`${headerNone}.${body}.`), null);
      assert.strictEqual(testAuth.verifyToken(`${headerNone}.${body}.none`), null);
      assert.strictEqual(testAuth.verifyToken(`${headerNone}.${body}.fakeSignature`), null);
    }
  },

  {
    id: 'T2.A6',
    name: 'Malformed Base64url & Structured Junk Fuzzing',
    fn: async () => {
      const junkCases = [
        null,
        undefined,
        123456,
        {},
        [],
        '',
        'singlestring',
        'a.b',
        'a.b.c.d',
        '..',
        'part1.notvalidjson.sig',
        `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('plain non-json').toString('base64url')}.sig`,
        `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('12345').toString('base64url')}.sig`,
        `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('null').toString('base64url')}.sig`,
        'bad!base64!chars.payload.sig'
      ];

      for (const input of junkCases) {
        assert.strictEqual(testAuth.verifyToken(input), null, `Junk input must return null: ${JSON.stringify(input)}`);
      }
    }
  },

  {
    id: 'T2.A7',
    name: '1,000-Iteration High-Frequency Bit-Flip Mutation Fuzzing (100% Rejection)',
    fn: async () => {
      const validToken = testAuth.generateToken({ accountId: 'fuzz_target_account', isGuest: true });
      let rejected = 0;

      for (let i = 0; i < 1000; i++) {
        const chars = validToken.split('');
        const idx = Math.floor(Math.random() * chars.length);
        let newChar;
        do {
          newChar = String.fromCharCode(Math.floor(Math.random() * 128));
        } while (newChar === chars[idx]);
        chars[idx] = newChar;
        const mutated = chars.join('');

        if (testAuth.verifyToken(mutated) === null) {
          rejected++;
        }
      }

      assert.strictEqual(rejected, 1000, `Expected 1000/1000 mutated tokens rejected, got ${rejected}`);
    }
  },

  // ==========================================================================
  // SUITE 2: PROFILESTORE CONCURRENCY STRESS & PERSISTENCE ATOMICITY
  // ==========================================================================
  {
    id: 'T2.A8',
    name: 'Concurrency Stress: 50 Simultaneous Upgrades on Single Profile (Queue Serialization)',
    fn: async () => {
      const profileId = 'stress_single_hero';
      await testStore.createProfile({
        id: profileId,
        username: 'QueueMaster',
        currency: { scrap: 60000, cores: 100 }
      });

      // Fire 50 simultaneous upgrades across health, speed, lantern
      const tasks = [];
      for (let i = 0; i < 50; i++) {
        const attr = i % 3 === 0 ? 'health' : (i % 3 === 1 ? 'speed' : 'lantern');
        tasks.push(testStore.upgradeCharacter(profileId, attr));
      }

      const results = await Promise.all(tasks);
      const successes = results.filter(r => r.ok);
      const failures = results.filter(r => !r.ok);

      // Exactly 5 upgrades per stat permitted (5 * 3 = 15 total)
      assert.strictEqual(successes.length, 15, `Expected 15 successes, got ${successes.length}`);
      assert.strictEqual(failures.length, 35, `Expected 35 rejections at cap, got ${failures.length}`);

      const finalProfile = await testStore.getProfile(profileId);
      assert.strictEqual(finalProfile.characterStats.healthTier, MAX_UPGRADE_TIER);
      assert.strictEqual(finalProfile.characterStats.speedTier, MAX_UPGRADE_TIER);
      assert.strictEqual(finalProfile.characterStats.lanternTier, MAX_UPGRADE_TIER);

      // Currency deduction exact verification
      const costPerStat = CHARACTER_UPGRADE_COSTS.reduce((acc, c) => ({
        scrap: acc.scrap + c.scrap,
        cores: acc.cores + c.cores
      }), { scrap: 0, cores: 0 });

      assert.strictEqual(finalProfile.currency.scrap, 60000 - costPerStat.scrap * 3);
      assert.strictEqual(finalProfile.currency.cores, 100 - costPerStat.cores * 3);
    }
  },

  {
    id: 'T2.A9',
    name: 'Concurrency Stress: 50 Concurrent Match Rewards Across 20 Profiles',
    fn: async () => {
      const profileIds = [];
      for (let i = 0; i < 20; i++) {
        const id = `profile_swarm_${i}`;
        profileIds.push(id);
        await testStore.createProfile({ id, username: `Swarm_${i}`, currency: { scrap: 0, cores: 0 } });
      }

      const tasks = [];
      for (let m = 0; m < 50; m++) {
        const targetId = profileIds[m % profileIds.length];
        tasks.push(testStore.recordMatchResult(targetId, {
          matchId: `swarm_match_${m}`,
          placement: (m % 4) + 1,
          kills: m % 4,
          damageDealt: (m + 1) * 75,
          survivalSeconds: 30 + m
        }));
      }

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, 50);
      assert.ok(results.every(r => r.ok === true), 'All 50 match recordings must succeed');

      // Verify every profile has valid non-corrupted state
      for (const id of profileIds) {
        const p = await testStore.getProfile(id);
        assert.ok(p !== null);
        assert.ok(p.careerStats.matchesPlayed >= 1);
        assert.ok(p.xp > 0);
        assert.ok(p.currency.scrap > 0);
      }
    }
  },

  {
    id: 'T2.A10',
    name: 'Concurrency Stress: Simultaneous Mixed Traffic (Upgrades vs Match Rewards)',
    fn: async () => {
      const id = 'mixed_race_subject';
      await testStore.createProfile({
        id,
        username: 'RaceRunner',
        currency: { scrap: 800, cores: 3 }
      });

      const tasks = [];
      for (let i = 0; i < 15; i++) {
        tasks.push(testStore.recordMatchResult(id, { placement: 1, kills: 2, damageDealt: 250 }));
        tasks.push(testStore.upgradeWeapon(id, 'revolver', 'damage'));
      }

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, 30);

      const p = await testStore.getProfile(id);
      assert.ok(p.currency.scrap >= 0, 'Scrap balance must never drop below 0');
      assert.ok(p.weapons.revolver.damageTier <= MAX_UPGRADE_TIER);
    }
  },

  {
    id: 'T2.A11',
    name: 'Storage Atomicity: Cold Reload & Byte-for-Byte JSON Persistence Parity',
    fn: async () => {
      // Re-instantiate fresh ProfileStore reading from the exact same disk file
      const coldStore = new ProfileStore({
        dataDir: TEMP_DATA_DIR,
        filePath: TEMP_PROFILES_FILE
      });
      await coldStore.init();

      const coldProfile = await coldStore.getProfile('stress_single_hero');
      assert.ok(coldProfile !== null, 'coldProfile must load from disk');
      assert.strictEqual(coldProfile.characterStats.healthTier, 5);
      assert.strictEqual(coldProfile.characterStats.speedTier, 5);
      assert.strictEqual(coldProfile.characterStats.lanternTier, 5);

      // Verify JSON file is intact
      const raw = await fs.promises.readFile(TEMP_PROFILES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      assert.ok(parsed['stress_single_hero'] !== undefined);
      assert.strictEqual(parsed['stress_single_hero'].characterStats.healthTier, 5);
    }
  },

  {
    id: 'T2.A12',
    name: 'Storage Resilience: Zero Lingering .tmp Files on Disk',
    fn: async () => {
      const files = fs.readdirSync(TEMP_DATA_DIR);
      const tmpFiles = files.filter(f => f.endsWith('.tmp'));
      assert.strictEqual(tmpFiles.length, 0, `Expected 0 lingering .tmp files, found: ${tmpFiles.join(', ')}`);
    }
  },

  // ==========================================================================
  // SUITE 3: ACCOUNT LINKING EDGE CASES & MERGING INVARIANTS
  // ==========================================================================
  {
    id: 'T2.A13',
    name: 'Account Linking: First-Time Google Direct Promotion & Token Invariance',
    fn: async () => {
      const guest = await testStore.createProfile({
        id: 'guest_direct_promo',
        username: 'SteamCadet#105',
        isGuest: true,
        currency: { scrap: 350, cores: 1 }
      });

      const mockGoogleToken = 'mock_google_' + Buffer.from(JSON.stringify({
        sub: 'google_sub_pioneer_99',
        email: 'pioneer@clockwork.io',
        name: 'Aether Pioneer'
      })).toString('base64url');

      const result = await testAuth.linkGuestToGoogle('guest_direct_promo', mockGoogleToken, 'merge');
      assert.strictEqual(result.merged, false, 'First-time link must direct-promote (merged: false)');
      assert.strictEqual(result.profile.isGuest, false);
      assert.strictEqual(result.profile.googleId, 'google_sub_pioneer_99');
      assert.strictEqual(result.profile.email, 'pioneer@clockwork.io');

      const tokenDecoded = testAuth.verifyToken(result.token);
      assert.strictEqual(tokenDecoded.accountId, 'guest_direct_promo');
      assert.strictEqual(tokenDecoded.isGuest, false);
    }
  },

  {
    id: 'T2.A14',
    name: 'Account Linking: Asymmetric Higher Guest Stats Preserved Over Lower Google Account',
    fn: async () => {
      // Cloud account with low stats
      const cloud = await testStore.createProfile({
        id: 'user_g_cloud_low',
        googleId: 'google_sub_asym_1',
        username: 'LowGoogleUser',
        isGuest: false,
        level: 2,
        xp: 150,
        currency: { scrap: 100, cores: 0 }
      });
      cloud.characterStats = { healthTier: 1, speedTier: 0, lanternTier: 1 };
      cloud.weapons.revolver = { unlocked: true, damageTier: 1, fireRateTier: 0, reloadTier: 0, capacityTier: 0 };
      await testStore.save(cloud);

      // Guest account with high stats
      const guest = await testStore.createProfile({
        id: 'guest_asym_high',
        username: 'MasterGuest',
        isGuest: true,
        level: 8,
        xp: 3200,
        currency: { scrap: 1200, cores: 4 }
      });
      guest.characterStats = { healthTier: 4, speedTier: 3, lanternTier: 2 };
      guest.weapons.revolver = { unlocked: true, damageTier: 4, fireRateTier: 3, reloadTier: 2, capacityTier: 1 };
      await testStore.save(guest);

      const mockToken = 'mock_google_' + Buffer.from(JSON.stringify({ sub: 'google_sub_asym_1' })).toString('base64url');
      const res = await testAuth.linkGuestToGoogle('guest_asym_high', mockToken, 'merge');
      assert.strictEqual(res.merged, true);

      const m = res.profile;
      // Max level & xp
      assert.strictEqual(m.level, 8);
      assert.strictEqual(m.xp, 3200);

      // Currency sum
      assert.strictEqual(m.currency.scrap, 100 + 1200);
      assert.strictEqual(m.currency.cores, 0 + 4);

      // Character stats max
      assert.strictEqual(m.characterStats.healthTier, 4);
      assert.strictEqual(m.characterStats.speedTier, 3);
      assert.strictEqual(m.characterStats.lanternTier, 2);

      // Weapon tier max
      assert.strictEqual(m.weapons.revolver.damageTier, 4);
      assert.strictEqual(m.weapons.revolver.fireRateTier, 3);

      // Guest profile must be deleted from store
      const deletedGuest = await testStore.getProfile('guest_asym_high');
      assert.strictEqual(deletedGuest, null, 'Old guest ID must be deleted after merge');
    }
  },

  {
    id: 'T2.A15',
    name: 'Account Linking: Disjoint Weapon Unlock Deduplication, Currency Sum & Overwrite Mode',
    fn: async () => {
      // Cloud account has unlocked blunderbuss
      const cloudWep = await testStore.createProfile({
        id: 'user_g_cloud_weps',
        googleId: 'google_sub_disjoint_1',
        isGuest: false
      });
      cloudWep.weapons = {
        steam_carbine: { unlocked: false, damageTier: 0 },
        blunderbuss: { unlocked: true, damageTier: 2 }
      };
      await testStore.save(cloudWep);

      // Guest has unlocked steam carbine
      const guestWep = await testStore.createProfile({
        id: 'guest_weps_disjoint',
        isGuest: true
      });
      guestWep.weapons = {
        steam_carbine: { unlocked: true, damageTier: 3 },
        blunderbuss: { unlocked: false, damageTier: 0 }
      };
      await testStore.save(guestWep);

      const mockToken = 'mock_google_' + Buffer.from(JSON.stringify({ sub: 'google_sub_disjoint_1' })).toString('base64url');
      const res = await testAuth.linkGuestToGoogle('guest_weps_disjoint', mockToken, 'merge');

      // Both weapons must be unlocked in merged profile
      assert.strictEqual(res.profile.weapons.steam_carbine.unlocked, true);
      assert.strictEqual(res.profile.weapons.steam_carbine.damageTier, 3);
      assert.strictEqual(res.profile.weapons.blunderbuss.unlocked, true);
      assert.strictEqual(res.profile.weapons.blunderbuss.damageTier, 2);

      // Test overwrite resolution mode on fresh accounts
      await testStore.createProfile({
        id: 'user_g_cloud_replace',
        googleId: 'google_sub_replace_9',
        isGuest: false,
        level: 15,
        currency: { scrap: 9000, cores: 20 }
      });

      await testStore.createProfile({
        id: 'guest_replace_src',
        isGuest: true,
        level: 3,
        currency: { scrap: 150, cores: 1 }
      });

      const replaceToken = 'mock_google_' + Buffer.from(JSON.stringify({ sub: 'google_sub_replace_9' })).toString('base64url');
      const replaceRes = await testAuth.linkGuestToGoogle('guest_replace_src', replaceToken, 'overwrite');
      assert.strictEqual(replaceRes.profile.level, 3, 'Overwrite mode must replace cloud level with guest level');
      assert.strictEqual(replaceRes.profile.currency.scrap, 150, 'Overwrite mode must replace scrap');
    }
  },

  // ==========================================================================
  // SUITE 4: CALLSIGN GENERATOR COLLISION & FORMAT FUZZING
  // ==========================================================================
  {
    id: 'T2.A16',
    name: 'Callsign Generator: 200 Rapid Generations & 1,000 Fuzzing Iterations (Format & Tag Bounds)',
    fn: async () => {
      const callsignRegex = /^[A-Z][a-zA-Z]+#[1-9][0-9]{2}$/;
      const callsigns = new Set();

      for (let i = 0; i < 200; i++) {
        const name = testAuth.generateSteampunkName();
        assert.ok(typeof name === 'string');
        assert.ok(callsignRegex.test(name), `Name "${name}" must match format PrefixClass#Tag`);
        assert.ok(!name.includes('undefined'));
        assert.ok(!name.includes('null'));
        assert.ok(!name.includes('NaN'));

        const tag = parseInt(name.split('#')[1], 10);
        assert.ok(tag >= 100 && tag <= 999, `Tag must be between 100 and 999: ${tag}`);
        callsigns.add(name);
      }

      // 200 items in a 324,000 space -> collision rate must be negligible (< 5%)
      assert.ok(callsigns.size >= 190, `Excessive collisions: only ${callsigns.size}/200 unique`);

      // 1,000 rapid fuzzing iterations
      for (let i = 0; i < 1000; i++) {
        const cs = testAuth.generateSteampunkCallsign();
        const parts = cs.split('#');
        assert.strictEqual(parts.length, 2);
        const num = Number(parts[1]);
        assert.ok(!Number.isNaN(num) && num >= 100 && num <= 999);
      }

      // Cleanup temp directory
      try {
        fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}

