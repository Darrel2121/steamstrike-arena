/**
 * Tier 3: Cross-Feature Integration Tests
 * 6 tests verifying subsystem coupling: custom map with bots, dynamic FOV movement,
 * sound pulse propagation through dark fog, projectile collision priority, and asymmetric vision.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper, assertPolygonClosed } from '../harnesses/assert_helpers.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';

export const suiteName = 'Tier 3: Subsystem Coupling & Cross-Feature Integration';

export const tests = [
  {
    id: 'T3.1',
    name: 'Custom Map Lobby with Active Bots',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3/M4 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'custom_bot_lobby', map: canonicalFoundryMap, maxPlayers: 4 });

      // Connect 1 human player
      room.addPlayer('human_1', 'Pioneer');

      // Auto-populate remaining 3 slots with bots
      room.fillWithBots();

      assert.strictEqual(room.bots.size, 3, 'Should populate exactly 3 bots');

      // Verify bots are mapped to valid spawn points from the custom map
      for (const [botId, bot] of room.bots) {
        assert.ok(bot.x > 0 && bot.y > 0, `Bot ${botId} must have non-zero spawn coordinates`);
        // Check bot is not inside a wall
        const col = Math.floor(bot.x / canonicalFoundryMap.tileSize);
        const row = Math.floor(bot.y / canonicalFoundryMap.tileSize);
        const tile = canonicalFoundryMap.tiles[row * canonicalFoundryMap.width + col];
        assert.strictEqual(tile, 0, `Bot ${botId} must spawn on walkable floor (col: ${col}, row: ${row}, tile: ${tile})`);
      }
    }
  },

  {
    id: 'T3.2',
    name: 'Dynamic FOV Occlusion While Moving',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      // Observer moves along corridor while rotating aim angle
      const segments = [
        { p1: { x: 0, y: 100 }, p2: { x: 500, y: 100 } }, // North wall
        { p1: { x: 0, y: 300 }, p2: { x: 500, y: 300 } }, // South wall
        { p1: { x: 250, y: 100 }, p2: { x: 250, y: 220 } } // Pillar sticking down
      ];

      const steps = [
        { x: 100, y: 200, angle: 0 },
        { x: 150, y: 200, angle: Math.PI / 4 },
        { x: 200, y: 200, angle: Math.PI / 2 },
        { x: 300, y: 200, angle: 0 }
      ];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const obs = { x: step.x, y: step.y, angle: step.angle, fov: Math.PI / 2, range: 350 };
        const poly = raycastModule.computeVisibilityPolygon(obs, segments, obs.angle, obs.fov, obs.range);

        assert.ok(poly, `Step ${i} must produce a visibility polygon`);
        const vertices = Array.isArray(poly) ? poly : poly.vertices;
        assertPolygonClosed(vertices, `Step ${i} polygon must be closed`);
      }
    }
  },

  {
    id: 'T3.3',
    name: 'Sound Wave Visibility in Darkness',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'stealth_room', map: canonicalFoundryMap });

      const pairA = new MockWebSocketPair();
      const pairB = new MockWebSocketPair();

      // Player A and Player B in separate rooms around a wall corner
      const pA = room.addPlayer('pA', 'Sprinter', pairA.serverSide);
      const pB = room.addPlayer('pB', 'Observer', pairB.serverSide);

      pA.x = 100; pA.y = 100;
      pB.x = 400; pB.y = 400;

      // Player A sprints, generating acoustic footstep shockwave
      room.handlePlayerInput('pA', {
        moveX: 1,
        moveY: 0,
        sprint: true,
        dt: 16
      });

      room.tick();

      // Player B must receive the sound wave event in their snapshot or direct event,
      // even though Player A is completely out of Player B's line of sight
      const snapshotB = await pairB.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 1000);
      assert.ok(snapshotB, 'Player B must receive world snapshot');

      const soundEvents = snapshotB.payload.soundEvents || [];
      assert.ok(soundEvents.length > 0, 'Sound events must be present in snapshot for hearing in darkness');

      const pulse = soundEvents.find(s => s.type === 'footstep');
      assert.ok(pulse, 'Footstep acoustic pulse must be replicated to remote clients');
      assert.strictEqual(pulse.x, pA.x, 'Pulse origin X must match sprinter location');

      pairA.clientSide.close();
      pairB.clientSide.close();
    }
  },

  {
    id: 'T3.4',
    name: 'Projectile Wall Collision Priority',
    fn: async () => {
      let collisionModule;
      try {
        collisionModule = await import('../../server/physics/Collision.js');
      } catch (_) {
        assert.fail('server/physics/Collision.js not found - awaiting Milestone M4 implementation');
      }

      const solveHits = collisionModule.solveProjectileHit || collisionModule.checkBulletHits;
      assert.strictEqual(typeof solveHits, 'function', 'Collision module must export solveProjectileHit');

      // Shooter fires bullet from (50, 100) towards (300, 100)
      // Solid wall at x = 150
      // Target player standing behind wall at (250, 100)
      const bulletRay = { start: { x: 50, y: 100 }, end: { x: 300, y: 100 } };
      const walls = [{ p1: { x: 150, y: 50 }, p2: { x: 150, y: 150 } }];
      const players = [{ id: 'behind_wall_target', x: 250, y: 100, radius: 16 }];

      const hit = solveHits(bulletRay, walls, players);

      assert.ok(hit, 'Collision must be detected');
      assert.strictEqual(hit.type, 'wall', 'Bullet must collide with wall before reaching target behind it');
      assert.strictEqual(hit.blocked, true, 'Target player must be shielded by the wall');
    }
  },

  {
    id: 'T3.5',
    name: 'Bot Sound-Vision Priority Interruption',
    fn: async () => {
      let botModule;
      try {
        botModule = await import('../../server/entities/Bot.js');
      } catch (_) {
        assert.fail('server/entities/Bot.js not found - awaiting Milestone M4 implementation');
      }

      const Bot = botModule.Bot || botModule.default;
      const bot = new Bot({ id: 'tactical_bot', x: 100, y: 100, angle: 0 });

      // Bot hears sound pulse at (400, 400)
      bot.hearSound({ id: 'snd_dist', x: 400, y: 400, type: 'gunfire' });
      assert.strictEqual(bot.state, 'INVESTIGATE', 'Bot should be in INVESTIGATE mode');

      // While moving, an enemy appears in lantern sightline at (180, 100)
      bot.seeTarget({ id: 'ambush_player', x: 180, y: 100, hp: 100, isAlive: true });

      assert.strictEqual(
        bot.state,
        'ENGAGE',
        'Direct visual contact must immediately interrupt and override acoustic investigation'
      );
      assert.strictEqual(bot.currentTargetId, 'ambush_player', 'Target must switch to acquired visible player');
    }
  },

  {
    id: 'T3.6',
    name: 'Multi-Player FOV Asymmetry',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      // Player A at (100, 100) facing East (0 rad)
      // Player B at (250, 100) facing North (-PI/2 rad)
      // Both have 80 deg FOV cones (LANTERN_FOV_RAD ~ 1.396 rad)
      const fov = (80 * Math.PI) / 180;
      const range = 400;

      const pA = { x: 100, y: 100, angle: 0 };
      const pB = { x: 250, y: 100, angle: -Math.PI / 2 };

      // 1. Can A see B?
      // B is directly East of A along A's aim vector -> YES
      const aSeesB = raycastModule.isPointVisible(pA, pB, [], pA.angle, fov, range);
      assert.strictEqual(aSeesB, true, 'Player A looking East must see Player B');

      // 2. Can B see A?
      // A is West of B (angle PI rad). B is facing North (-PI/2 rad).
      // Angle diff is 90 deg = PI/2 rad > FOV/2 (40 deg) -> NO
      const bSeesA = raycastModule.isPointVisible(pB, pA, [], pB.angle, fov, range);
      assert.strictEqual(bSeesA, false, 'Player B facing North must NOT see Player A behind their back');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
