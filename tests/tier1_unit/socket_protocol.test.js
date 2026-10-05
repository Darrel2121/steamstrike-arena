/**
 * Tier 1.3: WebSocket Client-Server Messaging & State Sync Tests
 * Covers R3 (Real-Time Multiplayer Networking) specifications and invariants.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { MockWebSocketPair, MockSwarm } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES, validPackets, malformedPackets } from '../fixtures/protocol.fixture.js';

export const suiteName = 'Tier 1.3: WebSocket Client-Server Protocol & State Sync';

export const tests = [
  {
    id: 'T1.3.1',
    name: 'Handshake & Room Join Sync',
    fn: async () => {
      let gameServerModule;
      try {
        gameServerModule = await import('../../server/GameServer.js');
      } catch (_) {
        assert.fail('server/GameServer.js not found - awaiting Milestone M3 implementation');
      }

      const GameServer = gameServerModule.GameServer || gameServerModule.default;
      assert.ok(GameServer, 'GameServer class must be exported');

      const server = new GameServer();
      const pair = new MockWebSocketPair();

      server.handleConnection(pair.serverSide, { id: 'client_101' });

      // Client sends join request
      pair.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'default', playerName: 'BrassHero' }
      });

      // Wait for server's lobby state response
      const response = await pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000);
      assert.ok(response, 'Server must respond with LOBBY_STATE');
      assert.strictEqual(response.type, PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      assert.ok(response.payload, 'Payload must be present');

      pair.clientSide.close();
    }
  },

  {
    id: 'T1.3.2',
    name: 'Authoritative Input Vector Processing',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      assert.ok(Room, 'Room class must be exported');

      const room = new Room({ id: 'test_room' });
      const pair = new MockWebSocketPair();
      const player = room.addPlayer('p1', 'SpeedRunner', pair.serverSide);

      const initialX = player.x;
      const initialY = player.y;

      // Client sends movement input to the right (moveX: 1, dt: 100ms)
      room.handlePlayerInput('p1', {
        moveX: 1,
        moveY: 0,
        sprint: false,
        aimAngle: 0,
        dt: 100
      });

      room.tick(); // Simulate 1 tick

      assert.ok(player.x > initialX, 'Player position x must advance authoritatively');
      assert.strictEqual(player.y, initialY, 'Player y position should remain unchanged');

      pair.clientSide.close();
    }
  },

  {
    id: 'T1.3.3',
    name: 'High-Frequency Snapshot Broadcast',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'snapshot_room' });

      const pairA = new MockWebSocketPair();
      const pairB = new MockWebSocketPair();
      const pairC = new MockWebSocketPair();

      room.addPlayer('pA', 'Alpha', pairA.serverSide);
      room.addPlayer('pB', 'Beta', pairB.serverSide);
      room.addPlayer('pC', 'Gamma', pairC.serverSide);

      room.startMatch();
      room.broadcastSnapshot();

      // All 3 clients must receive the snapshot
      const [snapA, snapB, snapC] = await Promise.all([
        pairA.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 1000),
        pairB.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 1000),
        pairC.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 1000)
      ]);

      assert.ok(snapA && snapB && snapC, 'All 3 clients must receive world snapshot');
      assert.strictEqual(snapA.type, PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT);
      assert.ok(Array.isArray(snapA.payload.players), 'Snapshot payload must contain players array');
      assert.strictEqual(snapA.payload.players.length, 3, 'Snapshot must include all 3 active players');

      pairA.clientSide.close();
      pairB.clientSide.close();
      pairC.clientSide.close();
    }
  },

  {
    id: 'T1.3.4',
    name: 'Latency Tracking & Keepalive Heartbeat',
    fn: async () => {
      let gameServerModule;
      try {
        gameServerModule = await import('../../server/GameServer.js');
      } catch (_) {
        assert.fail('server/GameServer.js not found - awaiting Milestone M3 implementation');
      }

      const GameServer = gameServerModule.GameServer || gameServerModule.default;
      const server = new GameServer();
      const pair = new MockWebSocketPair();

      server.handleConnection(pair.serverSide, { id: 'ping_client' });

      const clientPingTimestamp = Date.now();
      pair.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_PING,
        payload: { timestamp: clientPingTimestamp }
      });

      const pong = await pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_PONG, 1000);
      assert.ok(pong, 'Server must reply with PONG message');
      assert.strictEqual(pong.payload.clientTimestamp, clientPingTimestamp, 'PONG must echo client timestamp for RTT calculation');
      assert.ok(typeof pong.payload.serverTimestamp === 'number', 'PONG must include server timestamp');

      pair.clientSide.close();
    }
  },

  {
    id: 'T1.3.5',
    name: 'Clean Disconnection Cleanup',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'disconnect_room' });

      const pairA = new MockWebSocketPair();
      const pairB = new MockWebSocketPair();

      room.addPlayer('pA', 'Alpha', pairA.serverSide);
      room.addPlayer('pB', 'Beta', pairB.serverSide);

      assert.strictEqual(room.players.size, 2, 'Initial room must have 2 players');

      // Client A disconnects cleanly
      pairA.clientSide.close();

      // Trigger cleanup
      room.removePlayer('pA');

      assert.strictEqual(room.players.size, 1, 'Room must have 1 player remaining');
      assert.ok(!room.players.has('pA'), 'Disconnected player must be removed from room state');

      pairB.clientSide.close();
    }
  },

  {
    id: 'T1.3.6',
    name: 'Spoofed Input / Speed-Hack Clamping',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const room = new Room({ id: 'anticheat_room' });
      const pair = new MockWebSocketPair();

      const player = room.addPlayer('hacker_1', 'Flash', pair.serverSide);
      const startX = player.x;

      // Send impossible speed hack input: 10,000 pixels in 16ms
      room.handlePlayerInput('hacker_1', {
        moveX: 10000,
        moveY: 0,
        sprint: true,
        dt: 16
      });

      room.tick();

      const maxAllowedDisplacement = (player.maxSpeed || 250) * (16 / 1000) * 1.5;
      const actualDisplacement = Math.abs(player.x - startX);

      assert.ok(
        actualDisplacement <= maxAllowedDisplacement,
        `Movement must be clamped against speed hacks (actual: ${actualDisplacement}, max allowed: ${maxAllowedDisplacement})`
      );

      pair.clientSide.close();
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
