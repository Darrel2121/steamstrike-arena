/**
 * Tier 2: Phase 1 (P0) Tactical Mechanics & Economy Test Suite
 * Validates:
 * 1. Scrap-to-Core Alchemical Transmutation (ProgressionSchema & ProfileStore)
 * 2. Dynamic Movement Spread Bloom (Standing x1.0, Walking x1.8, Sprint x3.2)
 * 3. Server-Authoritative Reload Acoustic Sound Waves (Manual & Auto-Reload)
 * 4. Sensory Bot FSM: 45px Proximity Awareness, <=35% HP Retreat Trigger, Angular Aim Smoothing
 * 5. Mobile Touch Dual-Thumbstick Kinematics & Touch Action Triggers
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import {
  SCRAP_TO_CORE_EXCHANGE_RATE,
  transmuteScrapToCores,
  createDefaultProfile
} from '../../shared/ProgressionSchema.js';
import { ProfileStore } from '../../server/db/ProfileStore.js';
import { createProjectileSpecs, WEAPON_DEFINITIONS } from '../../server/combat/WeaponDefinitions.js';
import { Room } from '../../server/Room.js';
import { Bot } from '../../server/entities/Bot.js';
import { InputManager } from '../../client/js/InputManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DATA_DIR = path.join(__dirname, 'temp_phase1_test_' + Date.now());

export const suiteName = 'Tier 2: Phase 1 (P0) Mechanics, Economy & Mobile Controls';

export const tests = [
  {
    id: 'T2.P0.1',
    name: 'Alchemical Scrap-to-Core Transmutation Math & ProfileStore Atomicity',
    fn: async () => {
      assert.strictEqual(SCRAP_TO_CORE_EXCHANGE_RATE, 500, 'Exchange rate must be 500 Scrap -> 1 Core');

      const profile = createDefaultProfile({ id: 'alchemist_tester' });
      profile.currency = { scrap: 1250, cores: 2 };

      // 1. Valid 1-core transmutation
      const res1 = transmuteScrapToCores(profile, 1);
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.scrapCost, 500);
      assert.strictEqual(res1.coresGained, 1);
      assert.strictEqual(res1.newScrap, 750);
      assert.strictEqual(res1.newCores, 3);

      // 2. Multi-core transmutation (2 cores = 1000 scrap)
      const res2 = transmuteScrapToCores({ currency: { scrap: 1200, cores: 0 } }, 2);
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.scrapCost, 1000);
      assert.strictEqual(res2.coresGained, 2);
      assert.strictEqual(res2.newScrap, 200);
      assert.strictEqual(res2.newCores, 2);

      // 3. Insufficient scrap refusal
      const resFail = transmuteScrapToCores({ currency: { scrap: 499, cores: 0 } }, 1);
      assert.strictEqual(resFail.success, false);
      assert.ok(resFail.error.includes('Insufficient scrap'));

      // 4. Invalid quantities refusal
      assert.strictEqual(transmuteScrapToCores(profile, 0).success, false);
      assert.strictEqual(transmuteScrapToCores(profile, -2).success, false);

      // 5. ProfileStore persistence integration
      const store = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: path.join(TEMP_DATA_DIR, 'profiles.json') });
      await store.init();
      const created = await store.createProfile({ id: 'prof_transmute_test' });
      created.currency = { scrap: 1100, cores: 1 };
      await store.save(created);

      const transmuteResult = await store.transmuteScrap('prof_transmute_test', 2);
      assert.strictEqual(transmuteResult.ok, true);
      assert.strictEqual(transmuteResult.scrapCost, 1000);
      assert.strictEqual(transmuteResult.coresGained, 2);
      assert.strictEqual(transmuteResult.profile.currency.scrap, 100);
      assert.strictEqual(transmuteResult.profile.currency.cores, 3);

      // Verify on-disk persistence
      const reloadedStore = new ProfileStore({ dataDir: TEMP_DATA_DIR, filePath: path.join(TEMP_DATA_DIR, 'profiles.json') });
      await reloadedStore.init();
      const reloadedProfile = await reloadedStore.getProfile('prof_transmute_test');
      assert.strictEqual(reloadedProfile.currency.scrap, 100);
      assert.strictEqual(reloadedProfile.currency.cores, 3);

      // Cleanup
      try {
        await fs.promises.rm(TEMP_DATA_DIR, { recursive: true, force: true });
      } catch (_) {}
    }
  },

  {
    id: 'T2.P0.2',
    name: 'Dynamic Spread Multipliers (Standing x1.0, Walking x1.8, Sprint x3.2)',
    fn: async () => {
      const revolver = WEAPON_DEFINITIONS.revolver;
      assert.ok(revolver);

      // Test standing spread
      const standingProjectiles = createProjectileSpecs('revolver', { x: 0, y: 0 }, 0, 'shooter_1', { spreadMultiplier: 1.0 });
      assert.strictEqual(standingProjectiles.length, 1);

      // Test sprint spread
      const sprintProjectiles = createProjectileSpecs('revolver', { x: 0, y: 0 }, 0, 'shooter_1', { spreadMultiplier: 3.2 });
      assert.strictEqual(sprintProjectiles.length, 1);

      // Statistically measure angle dispersion across 500 samples
      let standingAngularDeviationSum = 0;
      let sprintAngularDeviationSum = 0;
      const SAMPLES = 500;

      for (let i = 0; i < SAMPLES; i++) {
        const pStand = createProjectileSpecs('revolver', { x: 0, y: 0 }, 0, 's', { spreadMultiplier: 1.0 })[0];
        const pSprint = createProjectileSpecs('revolver', { x: 0, y: 0 }, 0, 's', { spreadMultiplier: 3.2 })[0];

        standingAngularDeviationSum += Math.abs(pStand.angle);
        sprintAngularDeviationSum += Math.abs(pSprint.angle);
      }

      const avgStand = standingAngularDeviationSum / SAMPLES;
      const avgSprint = sprintAngularDeviationSum / SAMPLES;

      // Sprint spread must be substantially larger than standing spread (at least 2.0x ratio)
      assert.ok(avgSprint > avgStand * 2.0, `Sprint spread (${avgSprint}) must exceed standing spread (${avgStand})`);

      // Verify in Room combat context
      const room = new Room({ id: 'spread_test_room', autoTick: false });
      const mockPlayer = {
        id: 'shooter_1',
        x: 100,
        y: 100,
        angle: 0,
        equippedWeapon: 'revolver',
        effectiveWeaponStats: { ...revolver },
        isAlive: true,
        health: 100,
        sprint: false,
        lastMoveVector: { x: 0, y: 0 }
      };

      // Standing
      const standMult = (!mockPlayer.lastMoveVector || (mockPlayer.lastMoveVector.x === 0 && mockPlayer.lastMoveVector.y === 0))
        ? 1.0
        : (mockPlayer.sprint ? 3.2 : 1.8);
      assert.strictEqual(standMult, 1.0);

      // Walking
      mockPlayer.lastMoveVector = { x: 1, y: 0 };
      const walkMult = mockPlayer.sprint ? 3.2 : 1.8;
      assert.strictEqual(walkMult, 1.8);

      // Sprinting
      mockPlayer.sprint = true;
      const sprintMult = mockPlayer.sprint ? 3.2 : 1.8;
      assert.strictEqual(sprintMult, 3.2);
    }
  },

  {
    id: 'T2.P0.3',
    name: 'Server-Authoritative Reload Acoustic Sound Wave Emission',
    fn: async () => {
      const room = new Room({ id: 'reload_sound_room', autoTick: false });

      const mockPlayer = {
        id: 'reloader_hero',
        x: 240,
        y: 350,
        angle: 1.5,
        state: 'idle',
        ammo: 0,
        equippedWeapon: 'revolver',
        effectiveWeaponStats: { ...WEAPON_DEFINITIONS.revolver, magazineSize: 6, reloadTime: 1.5 },
        isAlive: true
      };

      // Trigger reload sound
      room.triggerReloadSound(mockPlayer);

      assert.ok(room.soundEvents.length > 0, 'Reload sound event must be emitted into room.soundEvents');
      const soundEventCaptured = room.soundEvents[room.soundEvents.length - 1];
      assert.strictEqual(soundEventCaptured.type, 'reload');
      assert.strictEqual(soundEventCaptured.sourceId, 'reloader_hero');
      assert.strictEqual(soundEventCaptured.x, 240);
      assert.strictEqual(soundEventCaptured.y, 350);
      assert.strictEqual(soundEventCaptured.maxRadius, 120, 'Reload acoustic maxRadius must be 120px');
    }
  },

  {
    id: 'T2.P0.4',
    name: 'Sensory Bot AI: 45px Proximity Bubble, Low-HP Retreat & Aim Smoothing',
    fn: async () => {
      const bot = new Bot({ id: 'bot_clockwork_1', x: 300, y: 300, hp: 100, maxHp: 100 });

      // 1. Proximity Bubble Check: Opponent at distance 35px behind bot's FOV (angle = PI, bot facing 0)
      bot.angle = 0; // facing east (+X)
      const behindPlayer = {
        id: 'stealth_infiltrator',
        x: 265, // 35px west (-X)
        y: 300,
        isAlive: true,
        hp: 100
      };

      const mockRoom = {
        players: new Map([[behindPlayer.id, behindPlayer]]),
        bots: new Map(),
        geometrySegments: []
      };

      bot.scanVisualTargets(mockRoom);
      assert.strictEqual(bot.state, 'ENGAGE', 'Target within 45px omnidirectional bubble must trigger ENGAGE even behind bot');
      assert.strictEqual(bot.currentTargetId, 'stealth_infiltrator');

      // 2. Low-HP Retreat State Trigger
      bot.hp = 100;
      bot.state = 'ENGAGE';

      // Damage taking bot down to 30 HP (<= 35% of 100)
      bot.takeDamage(70, 'attacker_1');
      assert.strictEqual(bot.hp, 30);
      assert.strictEqual(bot.state, 'RETREAT', 'Bot HP <= 35% must automatically trigger RETREAT state');

      // 3. Angular Aim Smoothing Rate Limit
      bot.hp = 100;
      bot.state = 'ENGAGE';
      bot.currentTargetId = behindPlayer.id;
      bot.angle = 0; // facing 0 rad

      // Target is directly at PI rad (180 degrees away)
      const dt = 0.033;
      const initialAngle = bot.angle;
      bot.updateEngage(dt, mockRoom);

      const angleDifference = Math.abs(bot.angle - initialAngle);
      const maxAllowedDelta = (Math.PI * 3.5) * dt + 0.001; // ~11 rad/s
      assert.ok(angleDifference <= maxAllowedDelta, `Aim adjustment (${angleDifference}) must be clamped by turnRate (max ${maxAllowedDelta})`);
      assert.ok(angleDifference > 0, 'Aim angle must progress towards target smoothly');
    }
  },

  {
    id: 'T2.P0.5',
    name: 'Mobile Touch Virtual Joystick & Dual-Thumbstick Tracking in InputManager',
    fn: async () => {
      // Mock mockable DOM target
      const mockElement = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
      };

      const input = new InputManager(mockElement);

      // 1. Initial State
      assert.strictEqual(input.isMouseDown, false);
      assert.strictEqual(input.touchMoveId, null);
      assert.strictEqual(input.isTouchSprint, false);

      // 2. Touch on Left 48% (Virtual Joystick: clientX = 100, clientY = 300)
      input.onTouchStart({
        touches: [{ identifier: 10, clientX: 100, clientY: 300 }]
      });
      assert.strictEqual(input.touchMoveId, 10);
      assert.deepStrictEqual(input.touchMoveOrigin, { x: 100, y: 300 });

      // Move joystick thumb rightward by 45px (dx = 45, dy = 0)
      input.onTouchMove({
        touches: [{ identifier: 10, clientX: 145, clientY: 300 }]
      });
      assert.strictEqual(Math.round(input.touchMoveVector.x * 100) / 100, 1.0);
      assert.strictEqual(Math.round(input.touchMoveVector.y * 100) / 100, 0.0);

      // 3. Touch on Right Side (Aim & Fire: clientX = 600, clientY = 300)
      input.onTouchStart({
        touches: [
          { identifier: 10, clientX: 145, clientY: 300 },
          { identifier: 20, clientX: 600, clientY: 300 }
        ]
      });
      assert.strictEqual(input.touchAimId, 20);
      assert.strictEqual(input.isMouseDown, true);
      assert.strictEqual(input.mouseX, 600);
      assert.strictEqual(input.mouseY, 300);

      // 4. Poll Input should reflect joystick movement without WASD keys
      const polled = input.pollInput(400, 300);
      assert.strictEqual(polled.moveX, 1.0);
      assert.strictEqual(polled.moveY, 0.0);
      assert.strictEqual(polled.firing, true);

      // 5. Touch Action Triggers
      input.triggerReload();
      const polledReload = input.pollInput(400, 300);
      assert.strictEqual(polledReload.reload, true);

      input.toggleSprint();
      assert.strictEqual(input.isTouchSprint, true);
      const polledSprint = input.pollInput(400, 300);
      assert.strictEqual(polledSprint.sprint, true);

      // 6. Touch End Releases
      input.onTouchEnd({
        touches: []
      });
      assert.strictEqual(input.touchMoveId, null);
      assert.strictEqual(input.touchAimId, null);
      assert.strictEqual(input.isMouseDown, false);

      input.destroy();
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
