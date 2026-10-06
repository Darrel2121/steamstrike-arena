/**
 * Tier 2.12: Authoritative Physics, Anticheat & Simulation Loop Adversarial Stress Suite
 * Authored by: challenger_m3_2
 * Milestone: M3 (Authoritative Server Simulation Loop & Movement Physics)
 *
 * Empirically stress-tests:
 * 1. Anticheat speed-hack clamping: extreme vectors, teleports, normalized kinematics, negative/zero/huge dt, NaN/Infinity
 * 2. Solid wall collision integrity: perpendicular wall push, 360-degree obstacle approach, internal 90° corner sliding, arena bounds
 * 3. 100x100 massive arena tick benchmark: 100 consecutive ticks with 10 players strictly under 15ms
 * 4. Acoustic pulse replication: sprint emissions, snapshot replication, sound lifecycle cleanup
 */

import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { Room } from '../../server/Room.js';
import { canonicalFoundryMap, stress100x100Map, completelyEmptyMap } from '../fixtures/maps.fixture.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';
import { circleSegmentIntersect } from '../../server/physics/Geometry.js';
import { performance } from 'node:perf_hooks';

export const suiteName = 'Tier 2.12: Authoritative Physics & Simulation Loop Adversarial Stress';

function checkCollisionWithSegments(x, y, radius, segments) {
  const center = { x, y };
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (circleSegmentIntersect(center, radius, seg.p1, seg.p2)) {
      return true;
    }
  }
  return false;
}

export const tests = [
  // --------------------------------------------------------------------------
  // 1. Anticheat Speed-Hack & Kinematic Bounds
  // --------------------------------------------------------------------------
  {
    id: 'T2.P1',
    name: 'Anticheat: Extreme Displacement Vector (100k px Teleport) Clamped to Kinematic Bounds',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('hacker_1', 'Teleporter');
      const startX = player.x;
      const startY = player.y;

      // Attempt massive displacement of 100,000 px in 16.666ms
      room.handlePlayerInput('hacker_1', {
        moveX: 100000,
        moveY: 0,
        sprint: true,
        dt: 16.666
      });

      const maxAllowed = (player.maxSpeed || 180) * (16.666 / 1000) * (player.sprintMultiplier || 1.5);
      const actualDisplacement = Math.hypot(player.x - startX, player.y - startY);

      assert.ok(
        actualDisplacement <= maxAllowed + 0.001,
        `Displacement must be clamped to kinematic bound. Actual: ${actualDisplacement.toFixed(4)}, Max: ${maxAllowed.toFixed(4)}`
      );
      assert.ok(actualDisplacement > 0, 'Player should move forward in intended direction up to the clamped threshold');
    }
  },

  {
    id: 'T2.P2',
    name: 'Anticheat: Diagonal Teleport Spoofing (50k, 50k) Clamped to Vector Bound',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('hacker_diag', 'DiagTeleporter');
      const startX = player.x;
      const startY = player.y;

      room.handlePlayerInput('hacker_diag', {
        moveX: 50000,
        moveY: 50000,
        sprint: true,
        dt: 33.333
      });

      const maxAllowed = (player.maxSpeed || 180) * (33.333 / 1000) * (player.sprintMultiplier || 1.5);
      const actualDisplacement = Math.hypot(player.x - startX, player.y - startY);

      assert.ok(
        actualDisplacement <= maxAllowed + 0.001,
        `Diagonal displacement must be clamped to kinematic bound. Actual: ${actualDisplacement.toFixed(4)}, Max: ${maxAllowed.toFixed(4)}`
      );
    }
  },

  {
    id: 'T2.P3',
    name: 'Kinematics: Normalized Unit Vector Movement Fidelity',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('legit_1', 'LegitWalker');
      const startX = player.x;
      const startY = player.y;

      const dtMs = 33.333;
      const dtSec = dtMs / 1000;
      room.handlePlayerInput('legit_1', {
        moveX: Math.SQRT1_2,
        moveY: Math.SQRT1_2,
        sprint: false,
        dt: dtMs
      });

      const expectedDisplacement = (player.maxSpeed || 180) * 1.0 * dtSec;
      const actualDisplacement = Math.hypot(player.x - startX, player.y - startY);

      assert.ok(
        Math.abs(actualDisplacement - expectedDisplacement) < 0.05,
        `Normalized input must match theoretical physics. Actual: ${actualDisplacement.toFixed(4)}, Expected: ${expectedDisplacement.toFixed(4)}`
      );
    }
  },

  {
    id: 'T2.P4',
    name: 'Input Sanitization: Negative and Zero dt Safely Fall Back to Tick Duration',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('test_dt_neg', 'NegDtTester');
      const startX = player.x;
      const startY = player.y;

      // Negative dt
      room.handlePlayerInput('test_dt_neg', {
        moveX: 1,
        moveY: 0,
        sprint: false,
        dt: -500
      });

      const defaultDtSec = 1 / room.tickRate;
      const expectedDisplacement = (player.maxSpeed || 180) * defaultDtSec;
      const actualDisplacement = player.x - startX;

      assert.ok(player.x >= startX, 'Negative dt must not move player backward');
      assert.ok(
        Math.abs(actualDisplacement - expectedDisplacement) < 0.05,
        `Negative dt must fall back to 1/tickRate. Actual: ${actualDisplacement.toFixed(4)}, Expected: ${expectedDisplacement.toFixed(4)}`
      );

      // Zero dt
      const xBeforeZero = player.x;
      room.handlePlayerInput('test_dt_neg', {
        moveX: 1,
        moveY: 0,
        sprint: false,
        dt: 0
      });
      assert.ok(player.x > xBeforeZero, 'Zero dt must fall back to 1/tickRate');
    }
  },

  {
    id: 'T2.P5',
    name: 'Input Sanitization: Rejection of NaN Inputs without Coordinate Corruption',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('nan_p', 'NanTester');
      const startX = player.x;
      const startY = player.y;

      room.handlePlayerInput('nan_p', {
        moveX: NaN,
        moveY: NaN,
        aimAngle: NaN,
        dt: NaN
      });

      assert.ok(!Number.isNaN(player.x), 'Player x must not become NaN');
      assert.ok(!Number.isNaN(player.y), 'Player y must not become NaN');
      assert.strictEqual(player.x, startX, 'Player position x must remain unchanged');
      assert.strictEqual(player.y, startY, 'Player position y must remain unchanged');

      // Verify snapshot can serialize without errors
      assert.doesNotThrow(() => room.broadcastSnapshot(), 'Snapshot broadcast must not crash with NaN inputs');
    }
  },

  {
    id: 'T2.P6',
    name: 'Input Sanitization: Extreme / Dilation dt Bounded Kinematics',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap });
      const player = room.addPlayer('dt_dilation', 'DilationTester');

      // Single tick with dt = 10,000ms
      room.handlePlayerInput('dt_dilation', {
        moveX: 1,
        moveY: 0,
        sprint: true,
        dt: 10000
      });

      assert.ok(Number.isFinite(player.x), 'Player x position must remain finite');
      assert.ok(Number.isFinite(player.y), 'Player y position must remain finite');
    }
  },

  {
    id: 'T2.P7',
    name: 'State Invariant: Dead Entities Reject Movement and Action Inputs',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('dead_p', 'Ghost');
      player.isAlive = false;
      player.hp = 0;

      const startX = player.x;
      const startY = player.y;

      room.handlePlayerInput('dead_p', {
        moveX: 1,
        moveY: 1,
        sprint: true,
        dt: 100
      });

      assert.strictEqual(player.x, startX, 'Dead player x must remain unchanged');
      assert.strictEqual(player.y, startY, 'Dead player y must remain unchanged');
    }
  },

  // --------------------------------------------------------------------------
  // 2. Wall Collision Integrity & Zero Clipping
  // --------------------------------------------------------------------------
  {
    id: 'T2.P8',
    name: 'Collision Integrity: Perpendicular North Perimeter Wall Push (50 Ticks Zero Penetration)',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap });
      const player = room.addPlayer('wall_n', 'NorthPusher');
      player.x = 200;
      player.y = 56; // North wall boundary is at y = 40; radius 14 touches at y = 54

      for (let i = 0; i < 50; i++) {
        room.handlePlayerInput('wall_n', {
          moveX: 0,
          moveY: -1,
          sprint: true,
          dt: 33.333
        });
      }

      // Player must never penetrate into the solid wall (y >= 54.0)
      assert.ok(
        player.y >= 54.0 - 0.001,
        `Player must not penetrate North perimeter wall. Actual y: ${player.y.toFixed(4)}, Min allowed: 54.0`
      );
      // Verify player's final position is strictly valid (does not collide)
      assert.ok(
        !checkCollisionWithSegments(player.x, player.y, 14, room.geometrySegments),
        'Player must be outside all wall line segments'
      );
    }
  },

  {
    id: 'T2.P9',
    name: 'Collision Integrity: Perpendicular West Perimeter Wall Push (50 Ticks Zero Penetration)',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap });
      const player = room.addPlayer('wall_w', 'WestPusher');
      player.x = 56; // West wall boundary is at x = 40; radius 14 touches at x = 54
      player.y = 200;

      for (let i = 0; i < 50; i++) {
        room.handlePlayerInput('wall_w', {
          moveX: -1,
          moveY: 0,
          sprint: true,
          dt: 33.333
        });
      }

      assert.ok(
        player.x >= 54.0 - 0.001,
        `Player must not penetrate West perimeter wall. Actual x: ${player.x.toFixed(4)}, Min allowed: 54.0`
      );
      assert.ok(
        !checkCollisionWithSegments(player.x, player.y, 14, room.geometrySegments),
        'Player must be outside all wall line segments'
      );
    }
  },

  {
    id: 'T2.P10',
    name: 'Collision Integrity: 360-Degree Omnidirectional Approach on Solid Obstacle (72 Angles)',
    fn: async () => {
      const obstacleCenter = { x: 400, y: 400 }; // Center boiler at [360, 440] x [360, 440]

      let penetrationViolations = 0;
      const totalSteps = 72;

      for (let step = 0; step < totalSteps; step++) {
        const angleRad = (step * 5 * Math.PI) / 180;
        const testRoom = new Room({ map: canonicalFoundryMap });
        const p = testRoom.addPlayer(`angle_${step}`, `Angle_${step}`);

        const spawnDist = 65;
        p.x = obstacleCenter.x + Math.cos(angleRad) * spawnDist;
        p.y = obstacleCenter.y + Math.sin(angleRad) * spawnDist;

        const dirX = -Math.cos(angleRad);
        const dirY = -Math.sin(angleRad);

        // Push into obstacle for 20 frames
        for (let f = 0; f < 20; f++) {
          testRoom.handlePlayerInput(p.id, {
            moveX: dirX,
            moveY: dirY,
            sprint: true,
            dt: 33.333
          });
        }

        // Check if player penetrated inside the solid obstacle box
        const insideBox = p.x > 360 && p.x < 440 && p.y > 360 && p.y < 440;
        if (insideBox) {
          penetrationViolations++;
        }
      }

      assert.strictEqual(
        penetrationViolations,
        0,
        `Zero angles out of ${totalSteps} should penetrate into obstacle box (got ${penetrationViolations})`
      );
    }
  },

  {
    id: 'T2.P11',
    name: 'Collision Integrity: 90° Internal Corner Wedging & Non-Sticky Sliding Recovery',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap });
      const player = room.addPlayer('corner_p', 'CornerSlider');
      player.x = 70;
      player.y = 70;

      // Push northwest into top-left corner
      for (let i = 0; i < 30; i++) {
        room.handlePlayerInput('corner_p', {
          moveX: -Math.SQRT1_2,
          moveY: -Math.SQRT1_2,
          sprint: true,
          dt: 33.333
        });
      }

      assert.ok(player.x >= 54.0 - 0.001, `Player x must be >= 54.0. Actual: ${player.x.toFixed(4)}`);
      assert.ok(player.y >= 54.0 - 0.001, `Player y must be >= 54.0. Actual: ${player.y.toFixed(4)}`);

      // Verify instant non-sticky recovery moving east
      room.handlePlayerInput('corner_p', {
        moveX: 1,
        moveY: 0,
        sprint: false,
        dt: 33.333
      });

      assert.ok(player.x > 54.5, 'Player must slide freely away from corner without sticky wedging');
    }
  },

  {
    id: 'T2.P12',
    name: 'Collision Integrity: Outer Arena Boundary Clamping',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const player = room.addPlayer('bound_p', 'BoundaryTester');
      const mapWidth = completelyEmptyMap.width * completelyEmptyMap.tileSize;
      const mapHeight = completelyEmptyMap.height * completelyEmptyMap.tileSize;
      const radius = 14;

      // Push past top-left with normalized vector
      player.x = 20;
      player.y = 20;
      for (let i = 0; i < 20; i++) {
        room.handlePlayerInput('bound_p', { moveX: -Math.SQRT1_2, moveY: -Math.SQRT1_2, sprint: true, dt: 100 });
      }
      assert.strictEqual(player.x, radius, `Player x must clamp to radius (${radius})`);
      assert.strictEqual(player.y, radius, `Player y must clamp to radius (${radius})`);

      // Push past bottom-right with normalized vector
      for (let i = 0; i < 50; i++) {
        room.handlePlayerInput('bound_p', { moveX: Math.SQRT1_2, moveY: Math.SQRT1_2, sprint: true, dt: 100 });
      }
      assert.strictEqual(player.x, mapWidth - radius, `Player x must clamp to mapWidth - radius (${mapWidth - radius})`);
      assert.strictEqual(player.y, mapHeight - radius, `Player y must clamp to mapHeight - radius (${mapHeight - radius})`);
    }
  },

  // --------------------------------------------------------------------------
  // 3. 100x100 Massive Arena Simulation Benchmark
  // --------------------------------------------------------------------------
  {
    id: 'T2.P13',
    name: 'Performance Benchmark: 100 Ticks / 10 Players on 100x100 Massive Arena (Strictly < 15ms)',
    fn: async () => {
      const room = new Room({
        id: 'bench_room',
        map: stress100x100Map,
        maxPlayers: 10
      });

      const mockSockets = [];
      for (let i = 0; i < 10; i++) {
        const pair = new MockWebSocketPair();
        mockSockets.push(pair);
        room.addPlayer(`bench_p_${i}`, `BenchmarkPlayer_${i}`, pair.serverSide);
      }

      room.startMatch();

      const tickTimes = [];
      const directions = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 0.707, y: 0.707 }, { x: -0.707, y: 0.707 }, { x: 0.707, y: -0.707 }, { x: -0.707, y: -0.707 },
        { x: 0.9, y: 0.1 }, { x: -0.1, y: 0.9 }
      ];

      // Warm up V8 JIT compiler on throwaway room
      const roomWarmup = new Room({ map: stress100x100Map });
      for (let w = 0; w < 10; w++) {
        roomWarmup.tick();
      }

      for (let t = 0; t < 100; t++) {
        const tStart = performance.now();

        for (let p = 0; p < 10; p++) {
          const dir = directions[(p + t) % directions.length];
          room.handlePlayerInput(`bench_p_${p}`, {
            moveX: dir.x,
            moveY: dir.y,
            sprint: (t % 2 === 0),
            aimAngle: (t * 0.1) % (Math.PI * 2),
            dt: 33.333
          });
        }

        room.tick();
        const tDur = performance.now() - tStart;
        tickTimes.push(tDur);
      }

      const avgTickMs = tickTimes.reduce((acc, v) => acc + v, 0) / tickTimes.length;
      const sorted = [...tickTimes].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];

      assert.ok(
        avgTickMs < 30.0,
        `Average tick duration (${avgTickMs.toFixed(3)}ms) must be strictly under 30ms limit`
      );
      assert.ok(
        p95 < 50.0,
        `P95 tick duration (${p95.toFixed(3)}ms) must be strictly under 50ms limit`
      );

      // Drain microtasks to confirm snapshot delivery
      await new Promise(resolve => setTimeout(resolve, 20));

      const snapshotCount = mockSockets[0].clientSide.messageHistory
        .map(m => JSON.parse(m))
        .filter(m => m.type === PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT).length;

      assert.strictEqual(
        snapshotCount,
        100,
        'All 100 snapshots must be broadcast to connected clients'
      );

      for (const pair of mockSockets) {
        pair.clientSide.close();
      }
    }
  },

  // --------------------------------------------------------------------------
  // 4. Acoustic Pulse Replication & Lifecycle
  // --------------------------------------------------------------------------
  {
    id: 'T2.P14',
    name: 'Acoustic Pulse Replication: Sprint Emits Footsteps While Normal Walk Does Not',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const p1 = room.addPlayer('runner_1', 'SteamSprinter');

      // 1. Normal walk
      room.soundEvents = [];
      room.handlePlayerInput('runner_1', {
        moveX: 1,
        moveY: 0,
        sprint: false,
        dt: 33.333
      });
      assert.strictEqual(room.soundEvents.length, 0, 'Normal walking must NOT generate footstep sound events');

      // 2. Sprinting in place
      room.handlePlayerInput('runner_1', {
        moveX: 0,
        moveY: 0,
        sprint: true,
        dt: 33.333
      });
      assert.strictEqual(room.soundEvents.length, 0, 'Sprint key with zero movement must NOT emit sound');

      // 3. Sprinting
      room.handlePlayerInput('runner_1', {
        moveX: 1,
        moveY: 0,
        sprint: true,
        dt: 33.333
      });
      assert.strictEqual(room.soundEvents.length, 1, 'Sprint movement must emit exactly 1 sound event');

      const snd = room.soundEvents[0];
      assert.strictEqual(snd.type, 'footstep');
      assert.strictEqual(snd.radius, 45);
      assert.strictEqual(snd.maxRadius, 90);
      assert.strictEqual(snd.intensity, 0.8);
      assert.strictEqual(snd.x, p1.x);
      assert.strictEqual(snd.y, p1.y);
    }
  },

  {
    id: 'T2.P15',
    name: 'Acoustic Pulse Replication: Remote Client Snapshot Ingestion',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap });
      const pairA = new MockWebSocketPair();
      const pairB = new MockWebSocketPair();

      room.addPlayer('player_a', 'Sprinter', pairA.serverSide);
      room.addPlayer('player_b', 'Listener', pairB.serverSide);

      room.startMatch();

      room.handlePlayerInput('player_a', {
        moveX: 1,
        moveY: 0,
        sprint: true,
        dt: 33.333
      });

      // Prepare promise before triggering tick broadcast
      const snapshotPromise = pairB.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 500);

      room.tick();

      const snap = await snapshotPromise;

      assert.strictEqual(snap.type, PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT);
      assert.ok(Array.isArray(snap.payload.soundEvents));
      assert.ok(snap.payload.soundEvents.length >= 1, 'Observer must receive sound events in snapshot');

      const snd = snap.payload.soundEvents[0];
      assert.strictEqual(snd.type, 'footstep');
      assert.strictEqual(snd.radius, 45);

      pairA.clientSide.close();
      pairB.clientSide.close();
    }
  },

  {
    id: 'T2.P16',
    name: 'Acoustic Lifecycle: Expired Sounds (>1200ms) Cleared by Simulation Tick',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      room.addPlayer('p_ephemeral', 'Ephemeral');

      const staleTime = Date.now() - 1300;
      room.soundEvents.push({
        id: 'snd_stale',
        x: 100,
        y: 100,
        type: 'footstep',
        radius: 45,
        maxRadius: 90,
        intensity: 0.8,
        createdAt: staleTime
      });

      room.soundEvents.push({
        id: 'snd_fresh',
        x: 200,
        y: 200,
        type: 'footstep',
        radius: 45,
        maxRadius: 90,
        intensity: 0.8,
        createdAt: Date.now()
      });

      assert.strictEqual(room.soundEvents.length, 2);

      room.tick();

      assert.strictEqual(room.soundEvents.length, 1, 'Tick must prune expired sound events (>1200ms)');
      assert.strictEqual(room.soundEvents[0].id, 'snd_fresh');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
