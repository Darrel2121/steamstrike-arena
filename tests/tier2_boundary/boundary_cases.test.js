/**
 * Tier 2: Boundary, Robustness & Edge Stress Tests
 * 8 comprehensive edge-case tests validating degenerate geometries, stress scale,
 * trigonometric singularities, socket concurrency bursts, and simultaneous deaths.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper, assertEpsilon } from '../harnesses/assert_helpers.js';
import { completelyEmptyMap, stress100x100Map } from '../fixtures/maps.fixture.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';

export const suiteName = 'Tier 2: Boundary & Edge Robustness Cases';

export const tests = [
  {
    id: 'T2.1',
    name: 'Empty Map Handling',
    fn: async () => {
      // 1. Validation of empty map
      let mapSchemaModule = await import('../../shared/MapSchema.js');
      const validation = mapSchemaModule.validateMap(completelyEmptyMap);
      assert.strictEqual(validation.valid, true, `Empty map should be valid: ${validation.errors.join(', ')}`);

      // 2. Raycast in empty room
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const observer = { x: 200, y: 200, angle: 0, fov: Math.PI / 2, range: 400 };
      const target = { x: 500, y: 200 };
      const noSegments = [];

      const visible = raycastModule.isPointVisible(observer, target, noSegments, observer.angle, observer.fov, observer.range);
      assert.strictEqual(visible, true, 'In an empty map, unoccluded target within range must be visible without errors');

      // Visibility polygon in empty space
      const poly = raycastModule.computeVisibilityPolygon(observer, noSegments, observer.angle, observer.fov, observer.range);
      assert.ok(poly, 'Visibility polygon must generate cleanly with 0 obstacle segments');
    }
  },

  {
    id: 'T2.2',
    name: 'Massive Arena Stress',
    fn: async () => {
      let mapSchemaModule = await import('../../shared/MapSchema.js');
      const validation = mapSchemaModule.validateMap(stress100x100Map);
      assert.strictEqual(validation.valid, true, '100x100 arena must validate cleanly');

      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'stress_room', map: stress100x100Map, maxPlayers: 10 });

      // Add 10 players
      for (let i = 0; i < 10; i++) {
        room.addPlayer(`p_${i}`, `StressPlayer_${i}`);
      }

      // Benchmark 30 ticks
      const tStart = performance.now();
      for (let t = 0; t < 30; t++) {
        room.tick();
      }
      const tElapsed = performance.now() - tStart;
      const avgTickMs = tElapsed / 30;

      // Each tick must comfortably run under 15ms to sustain 30Hz simulation loop
      assert.ok(
        avgTickMs < 15.0,
        `Average tick duration (${avgTickMs.toFixed(2)}ms) must be under 15ms for 100x100 stress arena`
      );
    }
  },

  {
    id: 'T2.3',
    name: 'Zero-Distance Raycast',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const origin = { x: 200, y: 200, angle: 0, fov: Math.PI / 2, range: 300 };
      const identicalTarget = { x: 200, y: 200 };

      // Observer looking directly at their own coordinates
      const visible = raycastModule.isPointVisible(origin, identicalTarget, [], origin.angle, origin.fov, origin.range);
      assert.strictEqual(visible, true, 'Zero-distance target should be visible and not produce NaN or loop');
    }
  },

  {
    id: 'T2.4',
    name: 'Extreme FOV Apertures',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const isVisible = raycastModule.isPointVisible;
      const obs = { x: 100, y: 100, angle: 0, range: 300 };

      // Case A: Laser beam FOV: 0.1 degrees = 0.001745 rad
      const laserFov = (0.1 * Math.PI) / 180;
      const directTarget = { x: 200, y: 100 }; // Exact 0 deg
      const slightOffsetTarget = { x: 200, y: 100.5 }; // ~0.28 deg off axis

      assert.strictEqual(
        isVisible(obs, directTarget, [], 0, laserFov, 300),
        true,
        'Direct laser line must see target at exact angle'
      );
      assert.strictEqual(
        isVisible(obs, slightOffsetTarget, [], 0, laserFov, 300),
        false,
        'Slight off-axis target must be excluded by narrow laser beam'
      );

      // Case B: Omnidirectional lantern: 360.0 degrees = 2 * PI rad
      const fullCircleFov = 2 * Math.PI;
      const behindTarget = { x: 50, y: 100 }; // Behind observer (180 deg)

      assert.strictEqual(
        isVisible(obs, behindTarget, [], 0, fullCircleFov, 300),
        true,
        'Omnidirectional 360 FOV must see targets in all directions'
      );
    }
  },

  {
    id: 'T2.5',
    name: 'Observer Touching Wall Edge',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      // Horizontal wall from (100, 100) to (200, 100)
      const wall = { p1: { x: 100, y: 100 }, p2: { x: 200, y: 100 } };
      // Observer positioned exactly on the segment at (150, 100)
      const observerOnWall = { x: 150, y: 100, angle: Math.PI / 2, fov: Math.PI / 2, range: 300 };
      const targetNorth = { x: 150, y: 200 }; // Looking north into open space

      // Raycaster must handle origin lying on obstacle boundary without self-occlusion
      const visible = raycastModule.isPointVisible(
        observerOnWall,
        targetNorth,
        [wall],
        observerOnWall.angle,
        observerOnWall.fov,
        observerOnWall.range
      );

      assert.strictEqual(typeof visible, 'boolean', 'Raycaster must return a valid boolean without division-by-zero');
    }
  },

  {
    id: 'T2.6',
    name: 'Burst Connection Throttling',
    fn: async () => {
      let gameServerModule;
      try {
        gameServerModule = await import('../../server/GameServer.js');
      } catch (_) {
        assert.fail('server/GameServer.js not found - awaiting Milestone M3 implementation');
      }

      const GameServer = gameServerModule.GameServer || gameServerModule.default;
      const server = new GameServer();
      const room = server.createRoom('burst_room', { maxPlayers: 4 });

      const pairs = [];
      // Attempt 20 concurrent connections in a single microtask burst
      for (let i = 0; i < 20; i++) {
        const p = new MockWebSocketPair();
        pairs.push(p);
        server.handleConnection(p.serverSide, { id: `burst_${i}` });
        p.clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
          payload: { roomId: 'burst_room', playerName: `BurstUser_${i}` }
        });
      }

      // Check results
      const responses = await Promise.all(
        pairs.map(p =>
          Promise.race([
            p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 500),
            p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 500)
          ]).catch(err => ({ type: 'TIMEOUT', error: err.message }))
        )
      );

      const accepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      const rejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR);

      assert.ok(accepted.length <= 4, `Room must enforce max capacity 4 (got ${accepted.length} accepted)`);
      assert.ok(rejected.length >= 16, `Excess clients must receive ERROR packet (got ${rejected.length} rejected)`);

      for (const p of pairs) p.clientSide.close();
    }
  },

  {
    id: 'T2.7',
    name: 'Ungraceful Socket Drop',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'drop_room' });
      const pair = new MockWebSocketPair();

      room.addPlayer('drop_p1', 'Dropper', pair.serverSide);
      assert.strictEqual(room.players.size, 1);

      // Abrupt socket termination without clean goodbye
      pair.clientSide.close(1006, 'Abnormal Termination');

      // Tick simulation to process disconnect cleanup
      room.tick();
      room.cleanupDisconnected();

      assert.strictEqual(room.players.size, 0, 'Dropped player must be safely removed without crashing simulation loop');
    }
  },

  {
    id: 'T2.8',
    name: 'Simultaneous Lethal Trade Hits',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M4 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'trade_room' });

      const pA = room.addPlayer('pA', 'Alpha');
      const pB = room.addPlayer('pB', 'Beta');

      pA.hp = 20;
      pB.hp = 20;

      // Spawn two lethal projectiles crossing paths and hitting both players in the exact same tick
      room.applyDamage('pA', 'pB', 50); // B kills A
      room.applyDamage('pB', 'pA', 50); // A kills B

      assert.strictEqual(pA.hp, 0, 'Player A must have 0 HP');
      assert.strictEqual(pB.hp, 0, 'Player B must have 0 HP');
      assert.strictEqual(pA.isAlive, false, 'Player A must be eliminated');
      assert.strictEqual(pB.isAlive, false, 'Player B must be eliminated');

      // Check match resolution
      const outcome = room.evaluateMatchOutcome();
      assert.ok(outcome, 'Room must resolve match outcome cleanly (Draw or mutual elimination)');
      assert.ok(outcome.isOver, 'Match must be marked over');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
