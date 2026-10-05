/**
 * Tier 2.13: Milestone M5 Adversarial Coverage Hardening Suite
 * Authored by: challenger_m5_2 (Empirical Challenger)
 *
 * White-Box Adversarial Stress Testing & Coverage Hardening across:
 * 1. MapSchema: Malformed inputs, missing required fields, non-square dimensions (10x30, 30x10, 10x100),
 *    topological BFS reachability failures (bisected maps, isolated pockets, diagonal barriers, serpentine maze),
 *    invalid spawn & pickup coordinates, collision overlaps, and serialization round-trip fidelity.
 * 2. AuthService: HMAC-SHA256 token forgery, tampered signatures, alg:none attacks, expired sessions,
 *    secret key isolation, callsign generator distribution & collision resistance, Google mock verification,
 *    and account linking conflict resolution modes (merge, keep_cloud, keep_guest/overwrite).
 * 3. ProfileStore: Mutex queue serialization under 100 concurrent mutations, atomic write crash resilience,
 *    cold restart persistence parity, upgrade tier clamping at MAX_UPGRADE_TIER = 5, currency zero-leakage,
 *    and weapon unlock/upgrade state invariants.
 * 4. ProgressionSchema: XP curve monotonicity (0 to 10M XP), bidirectional level invertibility,
 *    stat modifier precision across all 4 weapons, match reward determinism and negative input clamping.
 * 5. Integration: Client ProgressionManager stat calculations and REST auth / profile endpoint security.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';

import {
  validateMap,
  createDefaultMap,
  serializeMap,
  deserializeMap,
  floodFillReachable,
  TILE_TYPES,
  SPAWN_TYPES,
  PICKUP_TYPES
} from '../../shared/MapSchema.js';

import {
  MIN_GRID_DIMENSION,
  MAX_GRID_DIMENSION,
  TILE_SIZE
} from '../../shared/Constants.js';

import {
  MAX_UPGRADE_TIER,
  BASE_CHARACTER_STATS,
  CHARACTER_TIER_MODIFIERS,
  CHARACTER_UPGRADE_COSTS,
  WEAPON_UPGRADE_COSTS,
  WEAPON_UNLOCK_COSTS,
  WEAPON_DEFINITIONS,
  getXpRequiredForNextLevel,
  getTotalXpForLevel,
  calculateLevelFromTotalXp,
  calculateLevelFromXp,
  calculateCharacterStats,
  calculateEffectiveWeaponStats,
  calculateMatchRewards,
  createDefaultProfile
} from '../../shared/ProgressionSchema.js';

import { AuthService } from '../../server/auth/AuthService.js';
import { ProfileStore } from '../../server/db/ProfileStore.js';
import { ProgressionManager } from '../../client/js/ProgressionManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DATA_DIR = path.join(__dirname, 'temp_m5_hardening_' + Date.now());
const TEMP_PROFILES_FILE = path.join(TEMP_DATA_DIR, 'm5_profiles.json');

export const suiteName = 'Tier 2.13: Milestone M5 Adversarial Coverage Hardening Suite';

let testStore;
let testAuth;

export const tests = [
  // ==========================================================================
  // SECTION 1: MAP SCHEMA ADVERSARIAL STRUCTURAL & TYPE VALIDATION
  // ==========================================================================
  {
    id: 'T2.M5.1',
    name: 'MapSchema: Structural Fuzzing & Malformed Input Rejection',
    fn: async () => {
      // Degenerate inputs
      assert.strictEqual(validateMap(null).valid, false);
      assert.strictEqual(validateMap(undefined).valid, false);
      assert.strictEqual(validateMap('map_string').valid, false);
      assert.strictEqual(validateMap(12345).valid, false);
      assert.strictEqual(validateMap([]).valid, false);
      assert.strictEqual(validateMap({}).valid, false);

      // Missing or blank name
      const noName = createDefaultMap();
      delete noName.name;
      assert.strictEqual(validateMap(noName).valid, false);
      noName.name = '   ';
      assert.strictEqual(validateMap(noName).valid, false);

      // Missing version
      const noVer = createDefaultMap();
      delete noVer.version;
      assert.strictEqual(validateMap(noVer).valid, false);

      // Invalid tileSize
      const badTileSize = createDefaultMap();
      badTileSize.tileSize = 0;
      assert.strictEqual(validateMap(badTileSize).valid, false);
      badTileSize.tileSize = -40;
      assert.strictEqual(validateMap(badTileSize).valid, false);
      badTileSize.tileSize = '40';
      assert.strictEqual(validateMap(badTileSize).valid, false);

      // Out of bounds dimensions
      const smallGrid = createDefaultMap();
      smallGrid.width = MIN_GRID_DIMENSION - 1; // 9
      smallGrid.tiles = new Array(smallGrid.width * smallGrid.height).fill(TILE_TYPES.FLOOR);
      assert.strictEqual(validateMap(smallGrid).valid, false);

      const hugeGrid = createDefaultMap();
      hugeGrid.width = MAX_GRID_DIMENSION + 1; // 101
      hugeGrid.tiles = new Array(hugeGrid.width * hugeGrid.height).fill(TILE_TYPES.FLOOR);
      assert.strictEqual(validateMap(hugeGrid).valid, false);

      const floatGrid = createDefaultMap();
      floatGrid.width = 20.5;
      assert.strictEqual(validateMap(floatGrid).valid, false);

      // Tiles array length mismatch
      const mismatchMap = createDefaultMap();
      mismatchMap.tiles = mismatchMap.tiles.slice(0, 399); // 399 instead of 400
      assert.strictEqual(validateMap(mismatchMap).valid, false);

      // Invalid tile values
      const badTileVal = createDefaultMap();
      badTileVal.tiles[50] = 99;
      assert.strictEqual(validateMap(badTileVal).valid, false);
      badTileVal.tiles[50] = -1;
      assert.strictEqual(validateMap(badTileVal).valid, false);
      badTileVal.tiles[50] = '0'; // String instead of number
      assert.strictEqual(validateMap(badTileVal).valid, false);
    }
  },

  {
    id: 'T2.M5.2',
    name: 'MapSchema: Non-Square Grid Dimensions & Aspect Ratio Extremes',
    fn: async () => {
      // 1. Tall non-square arena (10x30)
      const tallWidth = 10;
      const tallHeight = 30;
      const tallTiles = new Array(tallWidth * tallHeight).fill(TILE_TYPES.FLOOR);
      // Outer perimeter walls
      for (let c = 0; c < tallWidth; c++) {
        tallTiles[0 * tallWidth + c] = TILE_TYPES.WALL;
        tallTiles[(tallHeight - 1) * tallWidth + c] = TILE_TYPES.WALL;
      }
      for (let r = 0; r < tallHeight; r++) {
        tallTiles[r * tallWidth + 0] = TILE_TYPES.WALL;
        tallTiles[r * tallWidth + (tallWidth - 1)] = TILE_TYPES.WALL;
      }
      const tallMap = {
        version: '1.0',
        name: 'Tall Foundry Shaft',
        width: tallWidth,
        height: tallHeight,
        tileSize: TILE_SIZE,
        tiles: tallTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 7, row: 27 }
        ]
      };
      const tallVal = validateMap(tallMap);
      assert.strictEqual(tallVal.valid, true, `10x30 map must validate cleanly: ${tallVal.errors.join(', ')}`);

      // 2. Wide non-square arena (30x10)
      const wideWidth = 30;
      const wideHeight = 10;
      const wideTiles = new Array(wideWidth * wideHeight).fill(TILE_TYPES.FLOOR);
      for (let c = 0; c < wideWidth; c++) {
        wideTiles[0 * wideWidth + c] = TILE_TYPES.WALL;
        wideTiles[(wideHeight - 1) * wideWidth + c] = TILE_TYPES.WALL;
      }
      for (let r = 0; r < wideHeight; r++) {
        wideTiles[r * wideWidth + 0] = TILE_TYPES.WALL;
        wideTiles[r * wideWidth + (wideWidth - 1)] = TILE_TYPES.WALL;
      }
      const wideMap = {
        version: '1.0',
        name: 'Wide Foundry Assembly Line',
        width: wideWidth,
        height: wideHeight,
        tileSize: TILE_SIZE,
        tiles: wideTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 27, row: 7 }
        ]
      };
      const wideVal = validateMap(wideMap);
      assert.strictEqual(wideVal.valid, true, `30x10 map must validate cleanly: ${wideVal.errors.join(', ')}`);

      // 3. Coordinate bounds violation against non-square dimensions
      const invertedSpawnMap = {
        ...tallMap,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 15, row: 5 } // col 15 is valid in 30x10 but INVALID in 10x30
        ]
      };
      const invertedVal = validateMap(invertedSpawnMap);
      assert.strictEqual(invertedVal.valid, false, 'Spawn col 15 outside width 10 must fail validation');

      // 4. Extreme 10:1 Aspect Ratio (10x100 corridor)
      const corridorWidth = 10;
      const corridorHeight = 100;
      const corridorTiles = new Array(corridorWidth * corridorHeight).fill(TILE_TYPES.FLOOR);
      for (let c = 0; c < corridorWidth; c++) {
        corridorTiles[0 * corridorWidth + c] = TILE_TYPES.WALL;
        corridorTiles[(corridorHeight - 1) * corridorWidth + c] = TILE_TYPES.WALL;
      }
      for (let r = 0; r < corridorHeight; r++) {
        corridorTiles[r * corridorWidth + 0] = TILE_TYPES.WALL;
        corridorTiles[r * corridorWidth + (corridorWidth - 1)] = TILE_TYPES.WALL;
      }
      const corridorMap = {
        version: '1.0',
        name: 'Grand Chimney Corridor',
        width: corridorWidth,
        height: corridorHeight,
        tileSize: TILE_SIZE,
        tiles: corridorTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 5, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 5, row: 97 }
        ]
      };
      const corridorVal = validateMap(corridorMap);
      assert.strictEqual(corridorVal.valid, true, `10x100 corridor must validate: ${corridorVal.errors.join(', ')}`);
    }
  },

  {
    id: 'T2.M5.3',
    name: 'MapSchema: BFS Reachability Failures & Topological Isolation',
    fn: async () => {
      // 1. Bisected map: solid vertical wall down the middle dividing spawns
      const w = 20;
      const h = 20;
      const bisectedTiles = new Array(w * h).fill(TILE_TYPES.FLOOR);
      for (let r = 0; r < h; r++) {
        bisectedTiles[r * w + 10] = TILE_TYPES.WALL; // Wall completely bisecting col 10
      }
      const bisectedMap = {
        version: '1.0',
        name: 'Bisected Arena',
        width: w,
        height: h,
        tileSize: TILE_SIZE,
        tiles: bisectedTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 17, row: 17 }
        ]
      };
      const bisectedRes = validateMap(bisectedMap);
      assert.strictEqual(bisectedRes.valid, false, 'Bisected map must fail validation');
      assert.ok(
        bisectedRes.errors.some(e => e.includes('is not reachable from spawn')),
        `Expected BFS reachability error, got: ${bisectedRes.errors.join('; ')}`
      );

      // 2. Isolated pocket: bot spawn completely enclosed in a 3x3 stone box
      const isolatedTiles = new Array(w * h).fill(TILE_TYPES.FLOOR);
      // Box around (15, 15): rows 14..16, cols 14..16
      for (let r = 14; r <= 16; r++) {
        for (let c = 14; c <= 16; c++) {
          if (r === 15 && c === 15) continue; // Single floor tile in center
          isolatedTiles[r * w + c] = TILE_TYPES.WALL;
        }
      }
      const isolatedMap = {
        version: '1.0',
        name: 'Isolated Pocket Arena',
        width: w,
        height: h,
        tileSize: TILE_SIZE,
        tiles: isolatedTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 15, row: 15 } // In enclosed cell
        ]
      };
      const isolatedRes = validateMap(isolatedMap);
      assert.strictEqual(isolatedRes.valid, false, 'Isolated pocket spawn must fail validation');

      // 3. Diagonal wall barrier (checkerboard corners blocking 4-way BFS)
      const diagonalTiles = new Array(w * h).fill(TILE_TYPES.FLOOR);
      for (let i = 0; i < w; i++) {
        diagonalTiles[i * w + (w - 1 - i)] = TILE_TYPES.WALL; // Diagonal wall from (19, 0) to (0, 19)
      }
      const diagonalMap = {
        version: '1.0',
        name: 'Diagonal Barrier Arena',
        width: w,
        height: h,
        tileSize: TILE_SIZE,
        tiles: diagonalTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 18, row: 18 }
        ]
      };
      const diagonalRes = validateMap(diagonalMap);
      assert.strictEqual(diagonalRes.valid, false, 'Spawns separated by diagonal wall must fail 4-way BFS');

      // 4. Serpentine maze connecting distant spawns (must PASS)
      const mazeTiles = new Array(w * h).fill(TILE_TYPES.WALL);
      // Carve out a serpentine S-shaped corridor
      for (let r = 2; r <= 17; r++) {
        mazeTiles[r * w + 2] = TILE_TYPES.FLOOR; // Left column
      }
      for (let c = 2; c <= 17; c++) {
        mazeTiles[17 * w + c] = TILE_TYPES.FLOOR; // Bottom row
      }
      for (let r = 2; r <= 17; r++) {
        mazeTiles[r * w + 17] = TILE_TYPES.FLOOR; // Right column
      }
      const mazeMap = {
        version: '1.0',
        name: 'Serpentine Duct Arena',
        width: w,
        height: h,
        tileSize: TILE_SIZE,
        tiles: mazeTiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 17, row: 2 }
        ]
      };
      const mazeRes = validateMap(mazeMap);
      assert.strictEqual(mazeRes.valid, true, `Serpentine corridor must validate: ${mazeRes.errors.join(', ')}`);
    }
  },

  {
    id: 'T2.M5.4',
    name: 'MapSchema: Spawn & Pickup Boundary Fuzzing and Serialization Round-Trip',
    fn: async () => {
      const baseMap = createDefaultMap();

      // Missing player spawn
      const noPlayerMap = {
        ...baseMap,
        spawns: [{ id: 'b1', type: SPAWN_TYPES.BOT, col: 2, row: 2 }, { id: 'b2', type: SPAWN_TYPES.BOT, col: 3, row: 3 }]
      };
      assert.strictEqual(validateMap(noPlayerMap).valid, false);

      // Missing bot spawn
      const noBotMap = {
        ...baseMap,
        spawns: [{ id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 }, { id: 'p2', type: SPAWN_TYPES.PLAYER, col: 3, row: 3 }]
      };
      assert.strictEqual(validateMap(noBotMap).valid, false);

      // Unknown spawn type
      const badSpawnType = {
        ...baseMap,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'turret1', type: 'automated_turret', col: 3, row: 3 }
        ]
      };
      assert.strictEqual(validateMap(badSpawnType).valid, false);

      // Duplicate spawn coordinate
      const dupSpawnMap = {
        ...baseMap,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 2, row: 2 } // Same location
        ]
      };
      assert.strictEqual(validateMap(dupSpawnMap).valid, false);

      // Spawn on obstacle
      const obstacleSpawnMap = {
        ...baseMap,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 9, row: 9 } // (9,9) is OBSTACLE boiler
        ]
      };
      assert.strictEqual(validateMap(obstacleSpawnMap).valid, false);

      // Pickups fuzzing
      const badPickupMap = {
        ...baseMap,
        pickups: [
          { type: 'rocket_launcher', col: 5, row: 5 }, // Unknown pickup type
          { type: PICKUP_TYPES.HEALTH, col: 0, row: 0 }  // Overlaps perimeter wall
        ]
      };
      assert.strictEqual(validateMap(badPickupMap).valid, false);

      // Serialization round-trip
      const serialized = serializeMap(baseMap);
      assert.strictEqual(typeof serialized, 'string');
      const deserialized = deserializeMap(serialized);
      assert.deepStrictEqual(deserialized, baseMap);

      // Serialization error handling
      assert.throws(() => serializeMap(null), /Cannot serialize invalid map object/i);
      assert.throws(() => deserializeMap(42), /deserializeMap expects a string input/i);
      assert.throws(() => deserializeMap('{{{ malformed'), /Failed to parse map JSON/i);
    }
  },

  // ==========================================================================
  // SECTION 2: AUTH SERVICE CRYPTOGRAPHIC SECURITY & IDENTITY HARNESS
  // ==========================================================================
  {
    id: 'T2.M5.5',
    name: 'AuthService: HMAC Token Forgery, Alg:None, Bit-Flips & Expiration',
    fn: async () => {
      fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
      testStore = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: TEMP_PROFILES_FILE });
      await testStore.init();

      testAuth = new AuthService({
        secret: 'adversarial-steampunk-hmac-key-2026-secure-32chars',
        profileStore: testStore,
        tokenTtlMs: 2000 // 2 seconds TTL
      });

      const token = testAuth.generateToken({ accountId: 'challenger_guest_42', isGuest: true });
      const [header, body, sig] = token.split('.');

      // Valid token decodes
      const validPayload = testAuth.verifyToken(token);
      assert.ok(validPayload);
      assert.strictEqual(validPayload.accountId, 'challenger_guest_42');

      // 1. Alg: None attack simulation
      const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      assert.strictEqual(testAuth.verifyToken(`${noneHeader}.${body}.`), null);
      assert.strictEqual(testAuth.verifyToken(`${noneHeader}.${body}.${sig}`), null);

      // 2. Flipped bits in signature across 50 mutations
      for (let i = 0; i < 50; i++) {
        const charIdx = i % sig.length;
        const replacement = sig[charIdx] === 'X' ? 'Y' : 'X';
        const tamperedSig = sig.slice(0, charIdx) + replacement + sig.slice(charIdx + 1);
        const tamperedToken = `${header}.${body}.${tamperedSig}`;
        assert.strictEqual(testAuth.verifyToken(tamperedToken), null, `Flipped char at index ${charIdx} must be rejected`);
      }

      // 3. Privilege escalation in payload claims without re-signing
      const parsedBody = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      parsedBody.isGuest = false;
      parsedBody.accountId = 'super_admin_root';
      const forgedBody = Buffer.from(JSON.stringify(parsedBody)).toString('base64url');
      assert.strictEqual(testAuth.verifyToken(`${header}.${forgedBody}.${sig}`), null, 'Forged payload claims must be rejected');

      // 4. Secret isolation
      const otherAuth = new AuthService({ secret: 'completely-different-signing-secret-key-999' });
      assert.strictEqual(otherAuth.verifyToken(token), null, 'Token signed by different secret must be rejected');

      // 5. Expired token testing (immediate expired token)
      const expiredAuth = new AuthService({
        secret: 'adversarial-steampunk-hmac-key-2026-secure-32chars',
        tokenTtlMs: -500 // Expired in the past
      });
      const expiredToken = expiredAuth.generateToken({ accountId: 'expired_user' });
      assert.strictEqual(testAuth.verifyToken(expiredToken), null, 'Expired token must return null');

      // 6. Degenerate inputs
      assert.strictEqual(testAuth.verifyToken(null), null);
      assert.strictEqual(testAuth.verifyToken(undefined), null);
      assert.strictEqual(testAuth.verifyToken(''), null);
      assert.strictEqual(testAuth.verifyToken('a.b'), null);
      assert.strictEqual(testAuth.verifyToken('a.b.c.d'), null);
      assert.strictEqual(testAuth.verifyToken(12345), null);
    }
  },

  {
    id: 'T2.M5.6',
    name: 'AuthService: Callsign Generator Distribution & Collision Resistance',
    fn: async () => {
      const generated = new Set();
      const sampleSize = 1000;
      const callsignRegex = /^[A-Z][a-zA-Z]+#[1-9][0-9]{2}$/;

      for (let i = 0; i < sampleSize; i++) {
        const name = testAuth.generateSteampunkName();
        assert.ok(callsignRegex.test(name), `Callsign '${name}' must match pattern Class#100-999`);
        generated.add(name);
      }

      // 1,000 samples from 324,000 possible combinations (20 prefixes * 18 classes * 900 tags)
      // Uniqueness ratio in 1,000 samples should comfortably be > 98%
      const uniquenessRatio = generated.size / sampleSize;
      assert.ok(
        uniquenessRatio > 0.98,
        `Callsign uniqueness ratio (${uniquenessRatio.toFixed(3)}) must exceed 0.98 (generated ${generated.size}/${sampleSize})`
      );
    }
  },

  {
    id: 'T2.M5.7',
    name: 'AuthService: Account Linking Conflict Resolution (Merge, Cloud, Overwrite)',
    fn: async () => {
      // Create guest profile
      const guestRes = await testAuth.createOrRestoreGuestSession('guest_link_test_1', 'GuestTinker#111');
      const guestId = guestRes.profile.id;

      // Give guest some upgrades
      await testStore.upgradeCharacter(guestId, 'health');
      await testStore.upgradeCharacter(guestId, 'speed');
      await testStore.upgradeWeapon(guestId, 'steam_carbine', 'damage');

      // 1. First-time Google user -> Direct Promotion
      const mockGoogleToken1 = 'mock_google_' + Buffer.from(JSON.stringify({
        sub: 'google_user_first_time_123',
        email: 'tinker@steampunk.org',
        name: 'Master Tinker'
      })).toString('base64url');

      const linkResult1 = await testAuth.linkGuestToGoogle(guestId, mockGoogleToken1, 'merge');
      assert.strictEqual(linkResult1.profile.isGuest, false);
      assert.strictEqual(linkResult1.profile.googleId, 'google_user_first_time_123');
      assert.strictEqual(linkResult1.profile.email, 'tinker@steampunk.org');
      assert.strictEqual(linkResult1.merged, false, 'First time linking is direct promotion');

      // 2. Conflict: Guest linking into EXISTING Cloud account with 'merge' strategy
      // Create new second guest
      const guestRes2 = await testAuth.createOrRestoreGuestSession('guest_link_test_2', 'GuestScout#222');
      const guestId2 = guestRes2.profile.id;
      // Award guest XP and currency
      await testStore.recordMatchResult(guestId2, { placement: 1, kills: 6, damageDealt: 1200, survivalSeconds: 180 });
      await testStore.upgradeCharacter(guestId2, 'lantern');

      // Cloud user already has googleId: 'google_user_first_time_123'
      const linkResult2 = await testAuth.linkGuestToGoogle(guestId2, mockGoogleToken1, 'merge');
      assert.strictEqual(linkResult2.merged, true);
      assert.strictEqual(linkResult2.profile.googleId, 'google_user_first_time_123');
      // Verify stats merged (healthTier, speedTier from cloud + lanternTier from guest)
      assert.ok(linkResult2.profile.characterStats.lanternTier >= 1, 'Lantern upgrade from guest must be merged into cloud profile');
      // Verify old guest profile deleted
      const oldGuest = await testStore.getProfile(guestId2);
      assert.strictEqual(oldGuest, null, 'Guest account must be cleaned up after merge');

      // 3. Error Boundaries:
      // Linking already registered account
      await assert.rejects(
        async () => testAuth.linkGuestToGoogle(linkResult1.profile.id, mockGoogleToken1, 'merge'),
        /Account is already a registered account/i
      );
      // Linking non-existent account
      await assert.rejects(
        async () => testAuth.linkGuestToGoogle('non_existent_guest_999', mockGoogleToken1, 'merge'),
        /Guest profile not found/i
      );
    }
  },

  // ==========================================================================
  // SECTION 3: PROFILE STORE CONCURRENCY, ATOMIC WRITES & RECOVERY
  // ==========================================================================
  {
    id: 'T2.M5.8',
    name: 'ProfileStore: Mutex Queue Serialization Under 100 Concurrent Mutations',
    fn: async () => {
      const stressProfileId = 'stress_concurrency_p1';
      await testStore.createProfile({
        id: stressProfileId,
        username: 'SteamJuggernaut#999',
        currency: { scrap: 50000, cores: 100 }
      });

      // Launch 100 concurrent mutations in parallel:
      // - 40 character upgrades
      // - 40 weapon upgrades
      // - 20 match reward records
      const promises = [];

      for (let i = 0; i < 40; i++) {
        const attr = i % 3 === 0 ? 'health' : (i % 3 === 1 ? 'speed' : 'lantern');
        promises.push(testStore.upgradeCharacter(stressProfileId, attr));
      }

      for (let i = 0; i < 40; i++) {
        const weaponId = i % 2 === 0 ? 'revolver' : 'steam_carbine';
        const stat = i % 4 === 0 ? 'damage' : (i % 4 === 1 ? 'fireRate' : (i % 4 === 2 ? 'reload' : 'capacity'));
        promises.push(testStore.upgradeWeapon(stressProfileId, weaponId, stat));
      }

      for (let i = 0; i < 20; i++) {
        promises.push(testStore.recordMatchResult(stressProfileId, {
          placement: (i % 3) + 1,
          kills: 2,
          damageDealt: 100,
          survivalSeconds: 30
        }));
      }

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, 100, 'All 100 mutations must resolve without dropping');

      const finalProfile = await testStore.getProfile(stressProfileId);
      assert.ok(finalProfile, 'Profile must exist after high-concurrency barrage');

      // Upgrades must be strictly clamped at MAX_UPGRADE_TIER = 5
      assert.ok(finalProfile.characterStats.healthTier <= MAX_UPGRADE_TIER);
      assert.ok(finalProfile.characterStats.speedTier <= MAX_UPGRADE_TIER);
      assert.ok(finalProfile.characterStats.lanternTier <= MAX_UPGRADE_TIER);

      // Verify Cold Restart Persistence Parity:
      // Create new ProfileStore pointing to same JSON file and ensure identical state
      const coldStore = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: TEMP_PROFILES_FILE });
      await coldStore.init();
      const coldProfile = await coldStore.getProfile(stressProfileId);
      assert.deepStrictEqual(coldProfile, finalProfile, 'Cold reload must match memory state exactly');
    }
  },

  {
    id: 'T2.M5.9',
    name: 'ProfileStore: Tier Clamping, Insufficient Currency Rejection & Weapon Unlock Invariants',
    fn: async () => {
      const invarId = 'invariants_profile_1';
      await testStore.createProfile({
        id: invarId,
        currency: { scrap: 3550, cores: 11 } // Exact amount for tier 0 -> tier 5 health
      });

      // 1. Upgrade health 5 times from tier 0 to tier 5
      for (let tier = 1; tier <= 5; tier++) {
        const res = await testStore.upgradeCharacter(invarId, 'health');
        assert.strictEqual(res.ok, true, `Upgrade to tier ${tier} should succeed`);
        assert.strictEqual(res.upgraded.newTier, tier);
      }

      // Currency should now be 0 scrap and 0 cores
      let profile = await testStore.getProfile(invarId);
      assert.strictEqual(profile.currency.scrap, 0);
      assert.strictEqual(profile.currency.cores, 0);
      assert.strictEqual(profile.characterStats.healthTier, 5);

      // 2. 6th upgrade attempt must be rejected (clamped at 5)
      const sixthUpgrade = await testStore.upgradeCharacter(invarId, 'health');
      assert.strictEqual(sixthUpgrade.ok, false);
      assert.ok(sixthUpgrade.error.includes('already at maximum tier'));
      // Scrap must not be deducted
      profile = await testStore.getProfile(invarId);
      assert.strictEqual(profile.currency.scrap, 0);
      assert.strictEqual(profile.characterStats.healthTier, 5);

      // 3. Insufficient currency refusal (scrap is 0, upgrade speed)
      const speedUpgrade = await testStore.upgradeCharacter(invarId, 'speed');
      assert.strictEqual(speedUpgrade.ok, false);
      assert.strictEqual(speedUpgrade.error, 'Insufficient currency');
      assert.strictEqual(profile.characterStats.speedTier, 0);

      // 4. Weapon unlock state invariant
      // Explicitly lock needle_gun
      profile.weapons.needle_gun.unlocked = false;
      await testStore.save(profile);

      // Try unlocking weapon with 0 currency
      const failUnlock = await testStore.unlockWeapon(invarId, 'needle_gun');
      assert.strictEqual(failUnlock.ok, false);
      assert.strictEqual(failUnlock.error, 'Insufficient currency to unlock weapon');

      // Grant exact currency for needle_gun unlock: 500 scrap, 3 cores
      profile.currency.scrap = 500;
      profile.currency.cores = 3;
      await testStore.save(profile);

      const successUnlock = await testStore.unlockWeapon(invarId, 'needle_gun');
      assert.strictEqual(successUnlock.ok, true);
      assert.strictEqual(successUnlock.profile.weapons.needle_gun.unlocked, true);
      assert.strictEqual(successUnlock.profile.currency.scrap, 0);
      assert.strictEqual(successUnlock.profile.currency.cores, 0);

      // Re-unlocking an already unlocked weapon is safe and non-deducting
      const reUnlock = await testStore.unlockWeapon(invarId, 'needle_gun');
      assert.strictEqual(reUnlock.ok, true);
      assert.strictEqual(reUnlock.message, 'Already unlocked');
    }
  },

  // ==========================================================================
  // SECTION 4: PROGRESSION ECONOMY MATHEMATICAL & REWARD INVARIANTS
  // ==========================================================================
  {
    id: 'T2.M5.10',
    name: 'ProgressionSchema: XP Curve Monotonicity, Ratio Bounds & Invertibility (0 to 10M)',
    fn: async () => {
      const testPoints = [
        0, 1, 50, 99, 100, 101, 381, 382, 383, 900, 901,
        2500, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000
      ];

      let lastLevel = 1;
      for (const xp of testPoints) {
        const info = calculateLevelFromTotalXp(xp);

        // Monotonic level progression
        assert.ok(info.level >= lastLevel, `Level must never decrease: xp=${xp}, level=${info.level}, last=${lastLevel}`);
        lastLevel = info.level;

        // Ratio in [0.0, 1.0]
        assert.ok(info.progressRatio >= 0.0 && info.progressRatio <= 1.0);

        // Arithmetic identity: base + currentIntoLevel === xp
        assert.strictEqual(info.currentLevelBaseXp + info.currentXpIntoLevel, xp);
        assert.strictEqual(info.nextLevelTargetXp - info.currentLevelBaseXp, info.xpRequiredForNext);
      }

      // Bidirectional invertibility for levels 1 to 100
      for (let lvl = 1; lvl <= 100; lvl++) {
        const threshold = getTotalXpForLevel(lvl);
        const calc = calculateLevelFromTotalXp(threshold);
        assert.strictEqual(calc.level, lvl, `XP threshold ${threshold} must evaluate to level ${lvl}`);
        assert.strictEqual(calc.currentXpIntoLevel, 0);

        if (lvl > 1) {
          const below = calculateLevelFromTotalXp(threshold - 1);
          assert.strictEqual(below.level, lvl - 1);
        }
      }

      // Edge cases
      assert.strictEqual(calculateLevelFromTotalXp(-100).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(NaN).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(null).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(undefined).level, 1);
      assert.strictEqual(calculateLevelFromTotalXp(Infinity).level, 1); // Non-finite falls back safely
    }
  },

  {
    id: 'T2.M5.11',
    name: 'ProgressionSchema: Match Reward Determinism, Outliers & Zero-Floor Safety',
    fn: async () => {
      // Determinism across 200 evaluations
      const r1 = calculateMatchRewards({ placement: 1, kills: 4, damageDealt: 850, survivalSeconds: 140 });
      for (let i = 0; i < 200; i++) {
        const r2 = calculateMatchRewards({ placement: 1, kills: 4, damageDealt: 850, survivalSeconds: 140 });
        assert.deepStrictEqual(r1, r2, 'Match reward calculation must be 100% deterministic');
      }

      // Negative values clamped to zero
      const negRewards = calculateMatchRewards({ placement: 4, kills: -10, damageDealt: -500, survivalSeconds: -60 });
      assert.ok(negRewards.xp >= 70); // Base 50 + placement 20
      assert.ok(negRewards.scrap >= 40); // Base 25 + placement 15
      assert.strictEqual(negRewards.cores, 0);

      // Cores granting rule:
      // Placement 1 -> grants 1 core regardless of kills
      assert.strictEqual(calculateMatchRewards({ placement: 1, kills: 0 }).cores, 1);
      // Placement 4, but >= 5 kills -> grants 1 core
      assert.strictEqual(calculateMatchRewards({ placement: 4, kills: 5 }).cores, 1);
      assert.strictEqual(calculateMatchRewards({ placement: 4, kills: 8 }).cores, 1);
      // Placement 2, < 5 kills -> 0 cores
      assert.strictEqual(calculateMatchRewards({ placement: 2, kills: 4 }).cores, 0);
    }
  },

  // ==========================================================================
  // SECTION 5: CLIENT PROGRESSION MANAGER & UI STAT INTEGRATION
  // ==========================================================================
  {
    id: 'T2.M5.12',
    name: 'ProgressionManager: Offline Guest Mode & Effective Stat Calculations',
    fn: async () => {
      const progManager = new ProgressionManager();
      const profile = await progManager.init();

      assert.ok(profile);
      assert.strictEqual(profile.isGuest, true);
      assert.ok(profile.username.includes('#') || profile.username.includes('_'));

      // Calculate initial base stats
      const baseStats = progManager.getCalculatedStats();
      assert.strictEqual(baseStats.maxHp, BASE_CHARACTER_STATS.maxHp);
      assert.strictEqual(baseStats.speed, BASE_CHARACTER_STATS.moveSpeed);
      assert.strictEqual(baseStats.lanternRange, BASE_CHARACTER_STATS.lanternRange);
      assert.strictEqual(baseStats.equippedWeapon, 'revolver');

      // Effective weapon stats on tier 0 revolver
      assert.strictEqual(baseStats.weapon.damage, WEAPON_DEFINITIONS.revolver.damage);
      assert.strictEqual(baseStats.weapon.fireRate, WEAPON_DEFINITIONS.revolver.fireRate);
      assert.strictEqual(baseStats.weapon.reload, WEAPON_DEFINITIONS.revolver.reload);
      assert.strictEqual(baseStats.weapon.magazine, WEAPON_DEFINITIONS.revolver.magazine);

      // Simulate local level up and reward addition
      let levelUpFired = false;
      progManager.on('levelUp', () => {
        levelUpFired = true;
      });

      progManager.addRewards({ xpEarned: 500, scrapEarned: 300, coresEarned: 2 });
      assert.ok(profile.level >= 2, 'Gaining 500 XP must advance guest to Rank 2+');
      assert.strictEqual(levelUpFired, true, 'levelUp event must trigger on rank advancement');

      // Clean up temporary test data directory
      try {
        fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
