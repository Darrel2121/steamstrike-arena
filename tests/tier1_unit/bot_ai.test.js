/**
 * Tier 1.5: Bot AI Sensory Awareness & State Machine Tests
 * Covers R5 (AI Bot Fill & Automated Verification) specifications and invariants.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { createDefaultMap } from '../../shared/MapSchema.js';

export const suiteName = 'Tier 1.5: Bot AI Senses & State Machine';

export const tests = [
  {
    id: 'T1.5.1',
    name: 'Bot Instantiation & Slot Auto-Fill',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M4 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const map = createDefaultMap();
      const room = new Room({ id: 'bot_room', map, maxPlayers: 4 });

      // Add 2 human players
      room.addPlayer('h1', 'Human1');
      room.addPlayer('h2', 'Human2');

      // Auto-fill bots to capacity
      room.fillWithBots();

      assert.strictEqual(room.bots.size, 2, 'Room must spawn 2 AI bots to fill 4-player capacity');

      for (const [botId, bot] of room.bots) {
        assert.ok(bot.isAlive, 'Spawned bot must be alive');
        assert.strictEqual(bot.hp, bot.maxHp, 'Bot should start with full HP matching its class');
        assert.ok(bot.hp >= 80, 'Bot should start with valid positive HP');
        assert.ok(bot.x > 0 && bot.y > 0, 'Bot must spawn at valid non-zero coordinates');
      }
    }
  },

  {
    id: 'T1.5.2',
    name: 'Waypoint Pathfinding on Custom Map',
    fn: async () => {
      let botModule;
      try {
        botModule = await import('../../server/entities/Bot.js');
      } catch (_) {
        assert.fail('server/entities/Bot.js not found - awaiting Milestone M4 implementation');
      }

      const findPath = botModule.findPath || botModule.computePath;
      if (typeof findPath !== 'function') {
        const Bot = botModule.Bot || botModule.default;
        const testBot = new Bot({ id: 'path_bot' });
        assert.strictEqual(typeof testBot.findPath, 'function', 'Bot or module must provide pathfinding function');
      }

      const map = createDefaultMap();
      const start = { col: 2, row: 2 };
      const goal = { col: 17, row: 17 };

      const path = botModule.findPath ? botModule.findPath(map, start, goal) : new (botModule.Bot || botModule.default)({ id: 'b' }).findPath(map, start, goal);

      assert.ok(Array.isArray(path), 'Pathfinder must return an array of waypoints');
      assert.ok(path.length >= 2, 'Path must have at least start and end waypoints');

      // Check that no waypoint is placed on a WALL tile
      for (const wp of path) {
        const tile = map.tiles[wp.row * map.width + wp.col];
        assert.strictEqual(tile, 0, `Path waypoint (${wp.col}, ${wp.row}) must be on FLOOR tile (tile is ${tile})`);
      }
    }
  },

  {
    id: 'T1.5.3',
    name: 'Acoustic Perception & State Transition',
    fn: async () => {
      let botModule;
      try {
        botModule = await import('../../server/entities/Bot.js');
      } catch (_) {
        assert.fail('server/entities/Bot.js not found - awaiting Milestone M4 implementation');
      }

      const Bot = botModule.Bot || botModule.default;
      const bot = new Bot({ id: 'bot_alpha', x: 200, y: 200 });

      assert.strictEqual(bot.state, 'PATROL', 'Initial bot state must be PATROL');

      // Emit sound pulse near bot (at 300, 200; distance = 100px)
      const soundEvent = {
        id: 'snd_footstep_1',
        x: 300,
        y: 200,
        type: 'footstep',
        radius: 90,
        maxRadius: 180,
        intensity: 0.8
      };

      bot.hearSound(soundEvent);

      assert.strictEqual(bot.state, 'INVESTIGATE', 'Bot hearing nearby sound must transition to INVESTIGATE');
      assert.strictEqual(bot.investigateTarget.x, 300, 'Investigation target X must match sound origin');
      assert.strictEqual(bot.investigateTarget.y, 200, 'Investigation target Y must match sound origin');
    }
  },

  {
    id: 'T1.5.4',
    name: 'Visual Target Acquisition & Lock-On',
    fn: async () => {
      let botModule;
      try {
        botModule = await import('../../server/entities/Bot.js');
      } catch (_) {
        assert.fail('server/entities/Bot.js not found - awaiting Milestone M4 implementation');
      }

      const Bot = botModule.Bot || botModule.default;
      const bot = new Bot({ id: 'bot_sentry', x: 200, y: 200, angle: 0 }); // Facing east

      // Target directly in front of bot lantern beam
      const enemy = { id: 'target_player', x: 350, y: 200, hp: 100, isAlive: true };

      bot.seeTarget(enemy);

      assert.strictEqual(bot.state, 'ENGAGE', 'Bot acquiring visual LoS must transition to ENGAGE');
      assert.strictEqual(bot.currentTargetId, 'target_player', 'Bot must lock onto target ID');
    }
  },

  {
    id: 'T1.5.5',
    name: 'Bot Weapon Firing & Elimination',
    fn: async () => {
      let botModule;
      try {
        botModule = await import('../../server/entities/Bot.js');
      } catch (_) {
        assert.fail('server/entities/Bot.js not found - awaiting Milestone M4 implementation');
      }

      const Bot = botModule.Bot || botModule.default;
      const bot = new Bot({ id: 'bot_gunner', x: 200, y: 200 });
      const target = { id: 'target_foe', x: 300, y: 200, hp: 30, isAlive: true };

      bot.seeTarget(target);
      assert.strictEqual(bot.state, 'ENGAGE');

      // Bot fires shot
      const firedProjectile = bot.attemptFire(0.016);
      assert.ok(firedProjectile, 'Bot with target in sight should emit a projectile when weapon is ready');

      // When target is eliminated, bot must cease firing and return to PATROL
      target.isAlive = false;
      target.hp = 0;
      bot.updateTargetStatus(target);

      assert.strictEqual(bot.state, 'PATROL', 'Bot must return to PATROL after target is eliminated');
      assert.strictEqual(bot.currentTargetId, null, 'Target lock must be cleared upon elimination');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
