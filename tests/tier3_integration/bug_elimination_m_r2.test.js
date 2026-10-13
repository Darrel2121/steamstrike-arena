/**
 * Tier 3: Full-Stack Bug Elimination & Regression Test Suite (Milestone M_R2)
 *
 * Dedicated regression test suite covering:
 * F34: Wave Defense Invader Bot Infinite Respawn Fix
 * F35: Snapshot Interpolation World State Preservation
 * F36: Tick Monotonicity & Anti-Rubber-Banding
 * F37: Symmetric Obstacle Sliding
 * F38: Bot AI Corner Stuck Recovery, Smooth Aiming & Velocity Tracking
 * F39: Room Lifecycle & Reconnect Hardening (10s Grace Period & Token Caching)
 */
import assert from 'node:assert/strict';
import { runSuiteHelper, assertEpsilon } from '../harnesses/assert_helpers.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { Room } from '../../server/Room.js';
import { GameServer } from '../../server/GameServer.js';
import { Player } from '../../server/entities/Player.js';
import { Bot } from '../../server/entities/Bot.js';
import { NetworkClient } from '../../client/js/NetworkClient.js';
import { tacticalNeuralAgent } from '../../server/ai/TacticalNeuralAgent.js';
import { PROTOCOL_MSG_TYPES, serializePacket } from '../../shared/Protocol.js';
import { GAME_MODES } from '../../shared/Constants.js';
import { circleSegmentIntersect } from '../../server/physics/Geometry.js';

export const suiteName = 'Tier 3: Milestone M_R2 Full-Stack Bug Remediation';

export const tests = [
  // =========================================================================
  // F34: Wave Defense Invader Bot Infinite Respawn Fix
  // =========================================================================
  {
    id: 'M_R2.F34.1',
    name: 'Wave Defense: Eliminated Invader Bot Receives Zero Respawn Timer and Stays Dead',
    fn: async () => {
      const room = new Room({
        id: 'wd_respawn_fix_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      const defender = room.addPlayer('def_1', 'Defender_Hero');
      room.startMatch();
      room.startWave(1);

      // Spawn an invader bot
      for (let i = 0; i < 30; i++) {
        room.tick();
      }
      assert.ok(room.bots.size > 0, 'Invader bot must be spawned');
      const invader = Array.from(room.bots.values())[0];
      assert.strictEqual(invader.team, 'invaders');
      assert.strictEqual(invader.isAlive, true);

      // Eliminate invader bot
      room.applyDamage(invader.id, defender.id, 9999);
      assert.strictEqual(invader.isAlive, false, 'Invader bot must be eliminated');
      assert.strictEqual(invader.respawnTimer, 0, 'Invader bot must have respawnTimer = 0 in Wave Defense');

      // Tick simulation for 5 simulated seconds (150 ticks at 30Hz)
      for (let i = 0; i < 150; i++) {
        room.tick();
      }

      // Invader bot must NOT have resurrected
      assert.strictEqual(invader.isAlive, false, 'Invader bot must stay permanently dead');
      assert.strictEqual(invader.respawnTimer, 0, 'Invader respawnTimer must remain 0');
    }
  },

  {
    id: 'M_R2.F34.2',
    name: 'Wave Defense: Defender Players Respawn While Invader Bots Remain Eliminated',
    fn: async () => {
      const room = new Room({
        id: 'wd_defender_respawn_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      const defender = room.addPlayer('def_p1', 'Defender_Vanguard');
      room.startMatch();
      room.startWave(1);

      for (let i = 0; i < 30; i++) {
        room.tick();
      }
      const invader = Array.from(room.bots.values())[0];

      // Eliminate defender
      room.applyDamage(defender.id, invader.id, 9999);
      assert.strictEqual(defender.isAlive, false);
      assert.strictEqual(defender.respawnTimer, 3.0, 'Defender player must receive 3.0s respawn timer');

      // Eliminate invader
      room.applyDamage(invader.id, defender.id, 9999);
      assert.strictEqual(invader.isAlive, false);
      assert.strictEqual(invader.respawnTimer, 0, 'Invader must not receive respawn timer');

      // Tick 3.5 seconds (105 ticks)
      for (let i = 0; i < 105; i++) {
        room.tick();
      }

      // Defender respawned, invader still dead
      assert.strictEqual(defender.isAlive, true, 'Defender player must have respawned');
      assert.strictEqual(invader.isAlive, false, 'Invader bot must remain dead');
    }
  },

  // =========================================================================
  // F35: Snapshot Interpolation World State Preservation
  // =========================================================================
  {
    id: 'M_R2.F35.1',
    name: 'Snapshot Interpolation: World State Preserved When Buffer Length <= 1',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'player_snap_test';

      // 1. Zero snapshots in buffer
      const state0 = client.getInterpolatedState();
      assert.ok(Array.isArray(state0.smokeZones), 'smokeZones must be array when buffer length is 0');
      assert.strictEqual(state0.steamCore, null, 'steamCore must be null when buffer length is 0');
      assert.strictEqual(state0.waveInfo, null, 'waveInfo must be null when buffer length is 0');
      assert.ok(Array.isArray(state0.pickups), 'pickups must be array when buffer length is 0');

      // 2. Exactly one snapshot in buffer
      const mockSnapshot = {
        tick: 1,
        timestamp: Date.now(),
        players: [{ id: 'player_snap_test', x: 200, y: 300, isAlive: true }],
        projectiles: [{ id: 'proj_1', x: 210, y: 300 }],
        pickups: [{ id: 'pk_1', x: 100, y: 100, type: 'ammo' }],
        smokeZones: [{ id: 'smoke_1', x: 150, y: 150, radius: 180 }],
        steamCore: { x: 400, y: 400, hp: 850, maxHp: 1000 },
        waveInfo: { wave: 2, state: 'WAVE_ACTIVE', countdown: 0 }
      };

      client.handleWorldSnapshot(mockSnapshot);
      assert.strictEqual(client.snapshotBuffer.length, 1);

      const state1 = client.getInterpolatedState();
      assert.ok(Array.isArray(state1.smokeZones), 'smokeZones must be array when buffer length is 1');
      assert.strictEqual(state1.smokeZones.length, 1, 'smokeZones must contain active zone');
      assert.strictEqual(state1.smokeZones[0].id, 'smoke_1');
      assert.ok(state1.steamCore, 'steamCore must not be undefined/null when buffer length is 1');
      assert.strictEqual(state1.steamCore.hp, 850);
      assert.ok(state1.waveInfo, 'waveInfo must not be undefined/null when buffer length is 1');
      assert.strictEqual(state1.waveInfo.wave, 2);
      assert.strictEqual(state1.pickups.length, 1, 'pickups must be preserved');
    }
  },

  // =========================================================================
  // F36: Tick Monotonicity & Anti-Rubber-Banding
  // =========================================================================
  {
    id: 'M_R2.F36.1',
    name: 'Tick Monotonicity: Stale Out-of-Order Snapshots Discarded Without Rubber-Banding',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'player_mono_test';
      client.predictedX = 100;
      client.predictedY = 100;
      client.isPredictionInitialized = true;

      // Newer snapshot tick 20 arrives first
      const snapTick20 = {
        tick: 20,
        timestamp: Date.now(),
        players: [{ id: 'player_mono_test', x: 250, y: 100, lastProcessedSeq: 20 }]
      };
      client.handleWorldSnapshot(snapTick20);
      assertEpsilon(client.predictedX, 250, 0.5, 'Predicted position must advance to tick 20');
      assert.strictEqual(client.lastReconciledTick, 20);

      // Stale snapshot tick 15 arrives later out-of-order over delayed socket
      const snapTick15 = {
        tick: 15,
        timestamp: Date.now() - 150,
        players: [{ id: 'player_mono_test', x: 180, y: 100, lastProcessedSeq: 15 }]
      };
      client.handleWorldSnapshot(snapTick15);

      // Must be safely rejected without rubber-banding backwards to x=180
      assertEpsilon(client.predictedX, 250, 0.5, 'Stale snapshot must NOT reset position to older coordinates');
      assert.strictEqual(client.lastReconciledTick, 20, 'lastReconciledTick must remain 20');

      // Monotonically advancing snapshot tick 21 must be accepted
      const snapTick21 = {
        tick: 21,
        timestamp: Date.now() + 33,
        players: [{ id: 'player_mono_test', x: 260, y: 100, lastProcessedSeq: 21 }]
      };
      client.handleWorldSnapshot(snapTick21);
      assertEpsilon(client.predictedX, 260, 0.5, 'Advancing snapshot must update position');
      assert.strictEqual(client.lastReconciledTick, 21);
    }
  },

  // =========================================================================
  // F37: Symmetric Obstacle Sliding
  // =========================================================================
  {
    id: 'M_R2.F37.1',
    name: 'Obstacle Sliding: Symmetric Evaluation Evaluates Both Axes Independently from origX/origY',
    fn: async () => {
      const room = new Room({
        id: 'sliding_test_room',
        map: canonicalFoundryMap
      });

      // Place entity near a vertical obstacle segment
      const entity = { x: 80, y: 80 };

      // Manually add horizontal and vertical segments to test sliding symmetry
      room.geometrySegments = [
        // Vertical wall at x = 100 from y = 60 to y = 140
        { p1: { x: 100, y: 60 }, p2: { x: 100, y: 140 } }
      ];

      // Entity radius 14. At x=80, moving dx=+15 puts candidate center at x=95 (distance to wall = 5 < 14, collides)
      // Moving dy=+10 has no vertical wall obstruction
      entity.x = 80;
      entity.y = 80;

      // Diagonal step: dx=+15 (blocked by vertical wall), dy=+10 (clear)
      room.moveWithSliding(entity, 15, 10, 14);

      // Horizontal step should be blocked, but vertical step must slide cleanly
      assert.strictEqual(entity.x, 80, 'Horizontal movement must be blocked by vertical wall');
      assert.strictEqual(entity.y, 90, 'Vertical sliding must execute successfully');

      // Now reverse: test horizontal wall at y = 100 from x = 60 to x = 140
      room.geometrySegments = [
        { p1: { x: 60, y: 100 }, p2: { x: 140, y: 100 } }
      ];
      entity.x = 80;
      entity.y = 80;

      // Diagonal step: dx=+10 (clear), dy=+15 (blocked by horizontal wall)
      room.moveWithSliding(entity, 10, 15, 14);
      assert.strictEqual(entity.x, 90, 'Horizontal sliding must execute successfully');
      assert.strictEqual(entity.y, 80, 'Vertical movement must be blocked by horizontal wall');

      // Test client-side NetworkClient mirror
      const client = new NetworkClient();
      client.geometrySegments = room.geometrySegments;
      const clientMoved = client.applyMovementWithSliding(80, 80, 10, 15, 14);
      assert.strictEqual(clientMoved.x, 90, 'Client horizontal sliding must match server');
      assert.strictEqual(clientMoved.y, 80, 'Client vertical collision must match server');
    }
  },

  {
    id: 'M_R2.F37.2',
    name: 'Obstacle Sliding: Convex Outside Corner Resolves to Dominant Axis Without Hull Penetration',
    fn: async () => {
      const room = new Room({
        id: 'corner_sliding_room',
        map: canonicalFoundryMap
      });

      // Outside convex corner at (100, 100) facing top-left
      room.geometrySegments = [
        { p1: { x: 100, y: 100 }, p2: { x: 200, y: 100 } },
        { p1: { x: 100, y: 100 }, p2: { x: 100, y: 200 } }
      ];

      const entity = { x: 85, y: 85 };
      const radius = 14;

      // Diagonal movement dx=12, dy=8: target (97, 93) collides with corner vertex (100, 100)
      // Since |dx| (12) >= |dy| (8), dominant axis is X.
      // Slide X candidate: (97, 85) - clear. Slide Y candidate: (85, 93) - clear.
      // Dominant-axis sliding must pick X: entity.x becomes 97, entity.y remains 85.
      room.moveWithSliding(entity, 12, 8, radius);

      assert.strictEqual(entity.x, 97, 'Dominant axis X must be applied');
      assert.strictEqual(entity.y, 85, 'Non-dominant axis Y must NOT be applied (preventing corner penetration)');

      // Verify no collision with geometry segments
      const collidingX = room.geometrySegments.some(seg =>
        circleSegmentIntersect(entity, radius, seg.p1, seg.p2)
      );
      assert.strictEqual(collidingX, false, 'Entity must not penetrate corner geometry on dominant X');

      // Now test dominant Y axis: dx=8, dy=12 from (85, 85)
      entity.x = 85;
      entity.y = 85;
      room.moveWithSliding(entity, 8, 12, radius);

      assert.strictEqual(entity.x, 85, 'Non-dominant axis X must NOT be applied');
      assert.strictEqual(entity.y, 97, 'Dominant axis Y must be applied');

      const collidingY = room.geometrySegments.some(seg =>
        circleSegmentIntersect(entity, radius, seg.p1, seg.p2)
      );
      assert.strictEqual(collidingY, false, 'Entity must not penetrate corner geometry on dominant Y');

      // Test client-side NetworkClient mirror
      const client = new NetworkClient();
      client.geometrySegments = room.geometrySegments;
      const clientResultX = client.applyMovementWithSliding(85, 85, 12, 8, radius);
      assert.strictEqual(clientResultX.x, 97, 'Client must apply dominant X axis');
      assert.strictEqual(clientResultX.y, 85, 'Client must maintain Y axis');
      assert.strictEqual(
        client.geometrySegments.some(s => circleSegmentIntersect(clientResultX, radius, s.p1, s.p2)),
        false,
        'Client prediction must not penetrate corner hull on dominant X'
      );

      const clientResultY = client.applyMovementWithSliding(85, 85, 8, 12, radius);
      assert.strictEqual(clientResultY.x, 85, 'Client must maintain X axis');
      assert.strictEqual(clientResultY.y, 97, 'Client must apply dominant Y axis');
      assert.strictEqual(
        client.geometrySegments.some(s => circleSegmentIntersect(clientResultY, radius, s.p1, s.p2)),
        false,
        'Client prediction must not penetrate corner hull on dominant Y'
      );
    }
  },

  // =========================================================================
  // F38: Bot AI Stuck Recovery, Smooth Aiming & Velocity Tracking
  // =========================================================================
  {
    id: 'M_R2.F38.1',
    name: 'Bot AI: Stuck Monitor Unfreezes Bot After 1.5s Progress Timeout',
    fn: async () => {
      const bot = new Bot({ id: 'bot_stuck_test', x: 20, y: 20 });
      bot.waypoints = [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 }
      ];
      bot.waypointIndex = 0;

      // Mock room with moveWithSliding that acts as an impassable corner barrier
      const blockedRoom = {
        map: { tileSize: 40 },
        moveWithSliding: (entity, dx, dy) => {
          // Corner prevents all motion
        }
      };

      // Tick 1.0 second in small steps
      for (let t = 0; t < 10; t++) {
        bot.followWaypoints(0.1, blockedRoom);
      }
      assert.strictEqual(bot.waypointIndex, 0, 'Waypoint should remain 0 before 1.5s timeout');
      assert.ok(bot.stuckTimer >= 0.99, 'stuckTimer must accumulate');

      // Tick another 0.5 seconds (total 1.5s) to trigger stuck recovery
      for (let t = 0; t < 5; t++) {
        bot.followWaypoints(0.1, blockedRoom);
      }

      // Bot must have advanced waypoint index to recover from corner stuck
      assert.strictEqual(bot.waypointIndex, 1, 'Stuck monitor must advance waypoint index after 1.5s');
      assert.strictEqual(bot.stuckTimer, 0, 'stuckTimer must reset after recovery');
    }
  },

  {
    id: 'M_R2.F38.2',
    name: 'Bot AI: Angular Turn Rate Clamping Eliminates Instant Snapping',
    fn: async () => {
      const bot = new Bot({ id: 'bot_turn_test', angle: 0 });
      bot.turnRate = Math.PI * 3.5; // ~10.99 rad/s

      // Request 180-degree turn (PI radians) over 0.016s frame
      const targetAngle = Math.PI;
      bot.rotateTowards(targetAngle, 0.016);

      const maxAllowedDelta = bot.turnRate * 0.016;
      assert.ok(bot.angle > 0 && bot.angle <= maxAllowedDelta + 0.001,
        `Angle turn must be clamped to max turn rate (~${maxAllowedDelta.toFixed(3)} rad), got ${bot.angle.toFixed(3)}`);
      assert.ok(bot.angle < Math.PI, 'Bot must NOT snap instantly to PI');

      // Sustained turns must keep angle bounded within [-Math.PI, Math.PI]
      for (let i = 0; i < 100; i++) {
        bot.rotateTowards(Math.PI, 0.1);
      }
      assert.ok(bot.angle >= -Math.PI && bot.angle <= Math.PI,
        `bot.angle must stay normalized within [-PI, PI], got ${bot.angle}`);
    }
  },

  {
    id: 'M_R2.F38.3',
    name: 'Entity Kinematics: Player and Bot Record Non-Zero vx, vy for Lead Aiming',
    fn: async () => {
      const player = new Player({ id: 'kin_player', x: 100, y: 100 });
      assert.strictEqual(player.vx, 0);
      assert.strictEqual(player.vy, 0);

      // Move player displacement
      player.x = 105;
      player.y = 100;
      player.update(0.033);

      assertEpsilon(player.vx, (5 / 0.033), 1.0, 'player.vx must record horizontal speed ~151 px/s');
      assert.strictEqual(player.vy, 0, 'player.vy must be 0 for pure horizontal movement');
      assert.strictEqual(player.lastX, 105, 'lastX must be updated');

      // Bot kinematics
      const bot = new Bot({ id: 'kin_bot', x: 200, y: 200 });
      bot.x = 200;
      bot.y = 204;
      bot.update(0.033);

      assert.strictEqual(bot.vx, 0);
      assertEpsilon(bot.vy, (4 / 0.033), 1.0, 'bot.vy must record vertical speed ~121 px/s');

      // Ballistic lead aiming receives non-zero velocity
      const shooter = { x: 50, y: 50 };
      const aimAngle = tacticalNeuralAgent.predictLeadAim(shooter, player, 1000);
      const directAngle = Math.atan2(player.y - shooter.y, player.x - shooter.x);

      // Lead aim angle should lead the target's positive X velocity
      assert.ok(aimAngle !== directAngle, 'Lead aim angle must differ from direct target angle when target has velocity');
    }
  },

  // =========================================================================
  // F39: Room Lifecycle & Reconnect Hardening
  // =========================================================================
  {
    id: 'M_R2.F39.1',
    name: 'NetworkClient Reconnect: Dynamic Token Query Builder Prevents Duplicate Token Stacking',
    fn: async () => {
      const client = new NetworkClient({ url: 'ws://localhost:3000' });

      // First connection with guest token
      client.connect(null, 'guest_jwt_token_123');
      assert.ok(client.url.includes('token=guest_jwt_token_123'));
      assert.strictEqual(client.url.split('token=').length - 1, 1, 'Exactly one token query parameter');

      // Re-connect with linked Google token
      client.connect(null, 'google_jwt_token_456');
      assert.ok(client.url.includes('token=google_jwt_token_456'), 'New token must replace old token in URL');
      assert.strictEqual(client.url.includes('guest_jwt_token_123'), false, 'Old guest token must be stripped');
      assert.strictEqual(client.url.split('token=').length - 1, 1, 'No duplicate token stacking');

      client.disconnect();
    }
  },

  {
    id: 'M_R2.F39.2',
    name: 'GameServer: Active Match Preserved Under 10s Disconnection Grace Period and Resumes on Rejoin',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('grace_match_room', { maxPlayers: 2, autoTick: false });

      const p1 = new MockWebSocketPair();
      server.handleConnection(p1.serverSide, { id: 'grace_p1' });
      p1.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'grace_match_room', playerName: 'Pilot_1' }
      });

      await new Promise(r => setTimeout(r, 20));
      room.startMatch();
      assert.strictEqual(room.state, 'IN_PROGRESS');

      // P1 drops socket abruptly during active match
      p1.clientSide.close(1006, 'Transient Drop');
      await new Promise(r => setTimeout(r, 30));

      // Active room must NOT be torn down immediately
      assert.ok(server.rooms.has('grace_match_room'), 'Active room must be preserved during 10s grace period');
      assert.ok(server.teardownTimers?.has('grace_match_room'), 'Teardown timer must be active');

      // Client reconnects within grace period
      const p1Reconnected = new MockWebSocketPair();
      server.handleConnection(p1Reconnected.serverSide, { id: 'grace_p1' });

      const waitInit = p1Reconnected.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_MATCH_INIT, 500);
      p1Reconnected.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'grace_match_room', playerName: 'Pilot_1', reconnectToken: 'mock_token' }
      });

      const initPacket = await waitInit;
      assert.ok(initPacket, 'Reconnecting client must receive S2C_MATCH_INIT without MATCH_IN_PROGRESS error');
      assert.strictEqual(initPacket.payload.roomId, 'grace_match_room');
      assert.strictEqual(server.teardownTimers?.has('grace_match_room'), false, 'Teardown timer must be cancelled');

      p1Reconnected.clientSide.close();
      room.stopLoop();
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
