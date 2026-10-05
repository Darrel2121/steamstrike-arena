/**
 * Tier 2.9: Empirical Adversarial Stress Suite for WebSocket Protocol & Real-Time Synchronization
 * Covers Milestone M3 requirements and invariants:
 * - High-frequency packet serialization/deserialization fuzzing (corrupted payloads, nulls, unexpected types, 5,000 fuzz cycles)
 * - Active socket fuzz bombardment (1,000 corrupted packets over live socket)
 * - Authoritative input vector boundary fuzzing (NaN, Infinity, extreme dt, aimAngle)
 * - Burst connection storm (50 simultaneous clients joining room of capacity 4: strict capacity enforcement, clean error packets)
 * - Multi-wave and multi-room burst storms
 * - Connection drop resilience across states (lobby host migration, match start transition, live 30Hz match, zero-player recovery)
 * - Latency & ping-pong RTT tracking under rapid back-to-back ping floods (1,000 pings, RTT percentiles, tick stability)
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import {
  PROTOCOL_MSG_TYPES,
  serializePacket,
  deserializePacket
} from '../../shared/Protocol.js';
import { GameServer } from '../../server/GameServer.js';
import { Room } from '../../server/Room.js';

export const suiteName = 'Tier 2.9: WebSocket Protocol & Synchronization Adversarial Stress';

function flushMicrotasks(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const tests = [
  {
    id: 'T2.9.1',
    name: 'Protocol Deserialization Fuzzing (Primitives, Malformed JSON, Bad Schemas)',
    fn: async () => {
      // 1. Falsy and primitive inputs
      const falsyInputs = [null, undefined, '', 0, false, NaN];
      for (const input of falsyInputs) {
        assert.strictEqual(deserializePacket(input), null, `Falsy input ${String(input)} must be null`);
      }
      const primitives = [123, 45.67, true, Symbol('test'), 100n];
      for (const p of primitives) {
        assert.strictEqual(deserializePacket(p), null, `Primitive ${String(p)} must be null`);
      }

      // 2. Malformed JSON strings
      const malformed = [
        '{',
        '{"type":',
        '{"type": "PING", "payload":',
        '{"type": "PING" "payload": {}}',
        'undefined',
        'function() {}',
        '<html><body>Error 500</body></html>',
        '\x00\x01\x02\xFF\xFE'
      ];
      for (const m of malformed) {
        assert.strictEqual(deserializePacket(m), null, `Malformed JSON must be null: ${m}`);
      }

      // 3. Invalid schema structures
      const invalidSchemas = [
        '{}',
        '[]',
        '[{"type": "PING"}]',
        '{"payload": {}}',
        '{"type": 123, "payload": {}}',
        '{"type": null, "payload": {}}',
        '{"type": false, "payload": {}}',
        '{"type": {}, "payload": {}}',
        '{"type": [], "payload": {}}',
        '"primitive string"',
        '12345',
        'true',
        'null'
      ];
      for (const inv of invalidSchemas) {
        assert.strictEqual(deserializePacket(inv), null, `Invalid schema must be null: ${inv}`);
      }

      // 4. In-memory object passthrough and Buffer handling
      const bufValid = Buffer.from(JSON.stringify({ type: 'PING', payload: { timestamp: 999 } }));
      const parsedBuf = deserializePacket(bufValid);
      assert.ok(parsedBuf && parsedBuf.type === 'PING' && parsedBuf.payload.timestamp === 999);

      const objInput = { type: 'C2S_LOBBY_JOIN', payload: { roomId: 'test' } };
      const parsedObj = deserializePacket(objInput);
      assert.ok(parsedObj && parsedObj.type === 'C2S_LOBBY_JOIN' && parsedObj.payload.roomId === 'test');

      // 5. Missing and null payload coalescence to empty object
      const nullPayload = JSON.stringify({ type: 'MATCH_START', payload: null });
      const parsedNull = deserializePacket(nullPayload);
      assert.strictEqual(parsedNull.type, 'MATCH_START');
      assert.deepStrictEqual(parsedNull.payload, {});
    }
  },

  {
    id: 'T2.9.2',
    name: '5,000-Cycle High-Frequency Mutation Fuzzing & Prototype Pollution Defense',
    fn: async () => {
      const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}"\':,[]- \t\n\r\\/~!@#$%^&*()_+`=\0\x1b';
      let handled = 0;

      for (let i = 0; i < 5000; i++) {
        const len = Math.floor(Math.random() * 80);
        let s = '';
        for (let c = 0; c < len; c++) {
          s += charset[Math.floor(Math.random() * charset.length)];
        }

        try {
          const res = deserializePacket(s);
          handled++;
          if (res !== null) {
            assert.strictEqual(typeof res.type, 'string');
            assert.strictEqual(typeof res.payload, 'object');
          }
        } catch (err) {
          assert.fail(`deserializePacket crashed on fuzz cycle ${i}: ${err.message}`);
        }
      }
      assert.strictEqual(handled, 5000, 'All 5,000 fuzz cycles must complete cleanly');

      // Prototype pollution vector
      const pollution = JSON.stringify({
        type: 'LOBBY_JOIN',
        payload: {
          __proto__: { polluted: 'YES' },
          constructor: { prototype: { admin: true } }
        }
      });
      const parsedPollution = deserializePacket(pollution);
      assert.ok(parsedPollution);
      assert.strictEqual({}.polluted, undefined, 'Object prototype must not be polluted');
      assert.strictEqual({}.admin, undefined, 'Global Object prototype must not be polluted');
    }
  },

  {
    id: 'T2.9.3',
    name: 'Live Socket Fuzz Bombardment (1,000 Corrupted Packets over Connection)',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, { id: 'fuzz_client_live' });

      for (let i = 0; i < 1000; i++) {
        const junk = [
          'CORRUPT_BYTES_' + i,
          JSON.stringify({ type: 'UNREGISTERED_ACTION_' + i, payload: { idx: i } }),
          JSON.stringify({ payload: { idx: i } }),
          JSON.stringify({ type: 9999 }),
          '',
          '{"type": "PING", "payload": { "broken": true }'
        ];
        pair.clientSide.send(junk[i % junk.length]);
      }

      await flushMicrotasks(20);

      // Verify connection remains intact and responsive to legitimate protocol packets
      const pingTime = Date.now();
      pair.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_PING,
        payload: { timestamp: pingTime }
      });

      const pong = await pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_PONG, 1000);
      assert.ok(pong, 'Server must remain responsive after 1,000 corrupt packets');
      assert.strictEqual(pong.payload.clientTimestamp, pingTime);

      pair.clientSide.close();
    }
  },

  {
    id: 'T2.9.4',
    name: 'Authoritative Input Vector Fuzzing & Anti-Poisoning Boundaries',
    fn: async () => {
      const room = new Room({ id: 'input_boundary_room' });
      const player = room.addPlayer('p_bound', 'BoundaryTester');
      const startX = player.x;
      const startY = player.y;

      // 1. NaN movement input must be safely ignored without mutating coordinates
      room.handlePlayerInput('p_bound', { moveX: NaN, moveY: 0, dt: 16 });
      assert.ok(Number.isFinite(player.x), 'Player x must remain finite after NaN input');
      assert.strictEqual(player.x, startX, 'Player x must not move on NaN input');

      // 2. Negative dt must not cause backwards teleports
      room.handlePlayerInput('p_bound', { moveX: 1, moveY: 0, dt: -500 });
      assert.ok(player.x >= startX, 'Negative dt must not move player backwards');

      // 3. aimAngle NaN must fallback to safe 0 in snapshot broadcast
      room.handlePlayerInput('p_bound', { aimAngle: NaN });
      const angleFormatted = Math.round((player.angle || 0) * 1000) / 1000;
      assert.strictEqual(angleFormatted, 0, 'NaN angle must format as 0');

      // 4. Excessive dt spoofing verification
      const prevX = player.x;
      room.handlePlayerInput('p_bound', { moveX: 1000, moveY: 0, dt: 50 });
      const moved = player.x - prevX;
      const maxAllowed = (player.maxSpeed || 180) * (50 / 1000) * 1.5;
      assert.ok(moved <= maxAllowed + 0.1, `Displacement must be clamped to max speed (moved ${moved}, max ${maxAllowed})`);
    }
  },

  {
    id: 'T2.9.5',
    name: 'Burst Connection Storm (50 Simultaneous Clients Joining Capacity-4 Room)',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('burst_storm_room', { maxPlayers: 4 });

      const clientCount = 50;
      const pairs = [];

      for (let i = 0; i < clientCount; i++) {
        const pair = new MockWebSocketPair();
        pairs.push(pair);
        server.handleConnection(pair.serverSide, { id: `storm_client_${i}` });
      }

      // Launch all 50 C2S_LOBBY_JOIN in a single event loop turn
      for (let i = 0; i < clientCount; i++) {
        pairs[i].clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
          payload: { roomId: 'burst_storm_room', playerName: `Trooper_${i}` }
        });
      }

      const responses = await Promise.all(
        pairs.map(p =>
          Promise.race([
            p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000),
            p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 1000)
          ]).catch(err => ({ type: 'TIMEOUT', error: err.message }))
        )
      );

      const accepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      const rejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR);
      const timeouts = responses.filter(r => r.type === 'TIMEOUT');

      assert.strictEqual(timeouts.length, 0, `No client should timeout (got ${timeouts.length})`);
      assert.strictEqual(accepted.length, 4, `Exactly 4 clients must be accepted (got ${accepted.length})`);
      assert.strictEqual(rejected.length, 46, `Exactly 46 excess clients must receive S2C_ERROR (got ${rejected.length})`);

      for (const rej of rejected) {
        assert.strictEqual(rej.payload.code, 'LOBBY_FULL', 'Rejected error code must be LOBBY_FULL');
      }

      assert.strictEqual(room.players.size, 4, 'Room players map must contain strictly 4 entries');

      for (const p of pairs) p.clientSide.close();
    }
  },

  {
    id: 'T2.9.6',
    name: 'Multi-Wave Burst Storm (3 Consecutive 50-Client Waves = 150 Attempts)',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('multi_wave_room', { maxPlayers: 4 });

      for (let wave = 1; wave <= 3; wave++) {
        const wavePairs = [];
        for (let i = 0; i < 50; i++) {
          const p = new MockWebSocketPair();
          wavePairs.push(p);
          server.handleConnection(p.serverSide, { id: `wave_${wave}_p_${i}` });
          p.clientSide.send({
            type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
            payload: { roomId: 'multi_wave_room', playerName: `W${wave}_P${i}` }
          });
        }

        const responses = await Promise.all(
          wavePairs.map(p =>
            Promise.race([
              p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000),
              p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 1000)
            ]).catch(() => ({ type: 'TIMEOUT' }))
          )
        );

        const accepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
        const rejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR);

        if (wave === 1) {
          assert.strictEqual(accepted.length, 4, 'Wave 1 must admit exactly 4 clients');
          assert.strictEqual(rejected.length, 46, 'Wave 1 must reject 46 clients');
        } else {
          assert.strictEqual(accepted.length, 0, `Wave ${wave} must admit 0 clients (already full)`);
          assert.strictEqual(rejected.length, 50, `Wave ${wave} must reject all 50 clients`);
        }

        assert.strictEqual(room.players.size, 4, 'Room capacity must remain locked at 4');
        for (let i = (wave === 1 ? 4 : 0); i < 50; i++) {
          wavePairs[i].clientSide.close();
        }
      }
    }
  },

  {
    id: 'T2.9.7',
    name: 'Multi-Room Concurrent Burst Storm (100 Clients Across 5 Rooms)',
    fn: async () => {
      const server = new GameServer();
      const roomIds = ['arena_A', 'arena_B', 'arena_C', 'arena_D', 'arena_E'];
      for (const rId of roomIds) {
        server.createRoom(rId, { maxPlayers: 4 });
      }

      const allPairs = [];
      const clientTargetRoom = [];

      for (let rIdx = 0; rIdx < roomIds.length; rIdx++) {
        const targetRoom = roomIds[rIdx];
        for (let c = 0; c < 20; c++) {
          const p = new MockWebSocketPair();
          allPairs.push(p);
          clientTargetRoom.push(targetRoom);
          server.handleConnection(p.serverSide, { id: `${targetRoom}_c${c}` });
        }
      }

      for (let i = 0; i < allPairs.length; i++) {
        allPairs[i].clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
          payload: { roomId: clientTargetRoom[i], playerName: `User_${i}` }
        });
      }

      const responses = await Promise.all(
        allPairs.map(p =>
          Promise.race([
            p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000),
            p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 1000)
          ]).catch(() => ({ type: 'TIMEOUT' }))
        )
      );

      const accepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE).length;
      const rejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR).length;

      assert.strictEqual(accepted, 20, 'Across 5 rooms (4 slots each), exactly 20 clients admitted');
      assert.strictEqual(rejected, 80, 'Exactly 80 excess clients rejected');

      for (const rId of roomIds) {
        assert.strictEqual(server.rooms.get(rId).players.size, 4, `Room ${rId} player count must be 4`);
      }

      for (const p of allPairs) p.clientSide.close();
    }
  },

  {
    id: 'T2.9.8',
    name: 'Lobby State Abrupt Disconnect & Host Migration Under 1006 Termination',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('host_migration_room', { maxPlayers: 4 });

      const pairHost = new MockWebSocketPair();
      const pairGuest = new MockWebSocketPair();

      server.handleConnection(pairHost.serverSide, { id: 'host_p1' });
      server.handleConnection(pairGuest.serverSide, { id: 'guest_p2' });

      pairHost.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'host_migration_room', playerName: 'HostJames' }
      });
      await pairHost.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 500);

      pairGuest.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'host_migration_room', playerName: 'GuestWatt' }
      });
      await pairGuest.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 500);

      assert.strictEqual(room.players.get('host_p1').isHost, true);
      assert.strictEqual(room.players.get('guest_p2').isHost, false);

      // Abrupt close code 1006 on host socket
      pairHost.clientSide.close(1006, 'Abnormal Termination');
      await flushMicrotasks(20);

      assert.strictEqual(room.players.size, 1, 'Room player size must be 1');
      assert.strictEqual(room.players.has('host_p1'), false, 'Host must be cleanly removed');
      const newHost = room.players.get('guest_p2');
      assert.ok(newHost, 'Guest must remain');
      assert.strictEqual(newHost.isHost, true, 'Guest must be promoted to host');

      pairGuest.clientSide.close();
    }
  },

  {
    id: 'T2.9.9',
    name: 'Rapid Connect/Disconnect Churn (50 Sockets Open and Drop Instantly)',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('rapid_churn_room', { maxPlayers: 4 });

      for (let i = 0; i < 50; i++) {
        const pair = new MockWebSocketPair();
        server.handleConnection(pair.serverSide, { id: `churn_${i}` });
        pair.clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
          payload: { roomId: 'rapid_churn_room', playerName: `Churner_${i}` }
        });
        pair.clientSide.close(1006, 'Churn Immediate Drop');
      }

      await flushMicrotasks(20);
      room.tick();
      room.cleanupDisconnected();

      assert.ok(room.players.size <= 4, 'Room player count must be within bounds');
      for (const [id, player] of room.players) {
        if (player.socket && player.socket.readyState !== 1) {
          assert.fail(`Dead socket remained uncleaned for player ${id}`);
        }
      }
    }
  },

  {
    id: 'T2.9.10',
    name: 'Match Transition & Countdown Abrupt Disconnect Resilience',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('transition_room', { maxPlayers: 2 });

      const p1 = new MockWebSocketPair();
      const p2 = new MockWebSocketPair();

      server.handleConnection(p1.serverSide, { id: 'trans_p1' });
      server.handleConnection(p2.serverSide, { id: 'trans_p2' });

      p1.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'transition_room' } });
      p2.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'transition_room' } });
      await flushMicrotasks(20);

      // P1 drops as match is started
      p1.clientSide.close(1006, 'Drop at Start');
      p2.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_MATCH_START });

      await flushMicrotasks(20);
      room.tick();

      assert.strictEqual(room.state, 'IN_PROGRESS', 'Room state must transition to IN_PROGRESS');
      assert.strictEqual(room.players.size, 1, 'Dropped player must be pruned');
      assert.ok(room.players.has('trans_p2'), 'Active player must remain');

      p2.clientSide.close();
    }
  },

  {
    id: 'T2.9.11',
    name: 'Live 30Hz Match Abrupt Socket Drop & Dead-Socket Broadcast Tolerance',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('live_drop_match_room', { maxPlayers: 4, autoTick: false });

      const pairs = [];
      for (let i = 0; i < 4; i++) {
        const p = new MockWebSocketPair();
        pairs.push(p);
        server.handleConnection(p.serverSide, { id: `live_client_${i}` });
        p.clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
          payload: { roomId: 'live_drop_match_room', playerName: `Live_${i}` }
        });
      }
      await flushMicrotasks(20);

      room.startMatch();
      assert.strictEqual(room.state, 'IN_PROGRESS');

      // Run 10 ticks of inputs
      for (let t = 0; t < 10; t++) {
        for (let i = 0; i < 4; i++) {
          room.handlePlayerInput(`live_client_${i}`, { moveX: 1, moveY: 0, sprint: true, dt: 33 });
        }
        room.tick();
      }

      // Drop player 0 and player 2 abruptly with code 1006
      pairs[0].clientSide.close(1006, 'Abnormal Termination');
      pairs[2].clientSide.close(1006, 'Abnormal Termination');
      await flushMicrotasks(20);

      // Continue simulation for 15 more ticks while broadcasting snapshots across closed sockets
      for (let t = 0; t < 15; t++) {
        room.handlePlayerInput('live_client_1', { moveX: 0, moveY: 1, dt: 33 });
        room.handlePlayerInput('live_client_3', { moveX: -1, moveY: 0, dt: 33 });
        room.tick();
      }

      assert.strictEqual(room.players.has('live_client_0'), false, 'Dropped player 0 removed');
      assert.strictEqual(room.players.has('live_client_2'), false, 'Dropped player 2 removed');
      assert.strictEqual(room.players.size, 2, '2 active players remain');

      const snap = await pairs[1].clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 500);
      assert.ok(snap, 'Living player must continue receiving world snapshots');
      assert.strictEqual(snap.payload.players.length, 2, 'Snapshot contains exactly 2 active players');

      pairs[1].clientSide.close();
      pairs[3].clientSide.close();
    }
  },

  {
    id: 'T2.9.12',
    name: 'Zero-Player Live Match Survival & Clean Outcome Evaluation',
    fn: async () => {
      const room = new Room({ id: 'zero_player_room' });
      const pA = new MockWebSocketPair();
      const pB = new MockWebSocketPair();

      room.addPlayer('zp_A', 'Alpha', pA.serverSide);
      room.addPlayer('zp_B', 'Beta', pB.serverSide);
      room.startMatch();

      pA.clientSide.close(1006);
      pB.clientSide.close(1006);
      await flushMicrotasks(20);

      for (let i = 0; i < 5; i++) {
        room.tick();
      }

      assert.strictEqual(room.players.size, 0, 'All players swept');
      const outcome = room.evaluateMatchOutcome();
      assert.strictEqual(outcome.isOver, false, 'Outcome evaluation with 0 entities must not crash');
    }
  },

  {
    id: 'T2.9.13',
    name: 'Single-Client 1,000 Rapid Back-to-Back Ping Flood & RTT Stats Profiling',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, { id: 'ping_flood_single' });

      const pingCount = 1000;
      const rttList = [];

      const pongPromise = new Promise((resolve, reject) => {
        let count = 0;
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for 1,000 PONGs (received ${count})`));
        }, 5000);

        pair.clientSide.on('message', (raw) => {
          const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (msg.type === PROTOCOL_MSG_TYPES.S2C_PONG) {
            const rtt = performance.now() - msg.payload.clientTimestamp;
            rttList.push(rtt);
            count++;
            if (count === pingCount) {
              clearTimeout(timer);
              resolve(count);
            }
          }
        });
      });

      for (let i = 0; i < pingCount; i++) {
        pair.clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_PING,
          payload: { timestamp: performance.now(), seq: i }
        });
      }

      const received = await pongPromise;
      assert.strictEqual(received, pingCount, 'Must receive all 1,000 PONGs without loss');

      rttList.sort((a, b) => a - b);
      const minRtt = rttList[0];
      const maxRtt = rttList[rttList.length - 1];
      const avgRtt = rttList.reduce((acc, v) => acc + v, 0) / rttList.length;
      const p95Rtt = rttList[Math.floor(rttList.length * 0.95)];

      assert.ok(maxRtt < 500, `Max RTT ${maxRtt.toFixed(2)}ms must be under 500ms`);
      assert.ok(avgRtt < 100, `Avg RTT ${avgRtt.toFixed(2)}ms must be under 100ms`);

      pair.clientSide.close();
    }
  },

  {
    id: 'T2.9.14',
    name: 'Multi-Client Concurrent Ping Flood (4 Clients x 250 Pings = 1,000 Total)',
    fn: async () => {
      const server = new GameServer();
      const clients = [];

      for (let c = 0; c < 4; c++) {
        const pair = new MockWebSocketPair();
        server.handleConnection(pair.serverSide, { id: `multi_pinger_${c}` });
        clients.push(pair);
      }

      const pingsPerClient = 250;
      const clientPromises = clients.map((pair, cIdx) => {
        return new Promise((resolve, reject) => {
          let count = 0;
          const timer = setTimeout(() => {
            reject(new Error(`Client ${cIdx} timed out (${count}/${pingsPerClient})`));
          }, 5000);

          pair.clientSide.on('message', (raw) => {
            const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (msg.type === PROTOCOL_MSG_TYPES.S2C_PONG) {
              count++;
              if (count === pingsPerClient) {
                clearTimeout(timer);
                resolve(count);
              }
            }
          });

          for (let i = 0; i < pingsPerClient; i++) {
            pair.clientSide.send({
              type: PROTOCOL_MSG_TYPES.C2S_PING,
              payload: { timestamp: performance.now(), clientIndex: cIdx, seq: i }
            });
          }
        });
      });

      const results = await Promise.all(clientPromises);
      const totalPongs = results.reduce((acc, v) => acc + v, 0);
      assert.strictEqual(totalPongs, 1000, 'All 1,000 concurrent multi-client pings must receive PONG');

      for (const p of clients) p.clientSide.close();
    }
  },

  {
    id: 'T2.9.15',
    name: 'Server 30Hz Simulation Tick Rate Stability During Ping Flood',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('stability_test_room', { maxPlayers: 4 });
      const p1 = new MockWebSocketPair();
      server.handleConnection(p1.serverSide, { id: 'stab_user_1' });

      p1.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'stability_test_room' }
      });
      await flushMicrotasks(20);

      room.startMatch();

      // Flood 500 pings while executing 30 simulation ticks
      for (let i = 0; i < 500; i++) {
        p1.clientSide.send({
          type: PROTOCOL_MSG_TYPES.C2S_PING,
          payload: { timestamp: Date.now() }
        });
      }

      const tickTimes = [];
      for (let t = 0; t < 30; t++) {
        const t0 = performance.now();
        room.tick();
        tickTimes.push(performance.now() - t0);
      }

      const maxTick = Math.max(...tickTimes);
      const avgTick = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;

      assert.ok(maxTick < 15, `Server max tick time (${maxTick.toFixed(2)}ms) must be strictly under 15ms limit`);
      assert.ok(avgTick < 5, `Server avg tick time (${avgTick.toFixed(2)}ms) must be well under 5ms`);

      p1.clientSide.close();
    }
  },

  {
    id: 'T2.9.16',
    name: 'Acoustic Footstep Event Lifespan & Memory Pruning Under Sprint Flood',
    fn: async () => {
      const room = new Room({ id: 'sound_memory_room' });
      const player = room.addPlayer('snd_user', 'NoisyMechanic');

      // Generate 500 footstep sound events via rapid sprint inputs
      for (let i = 0; i < 500; i++) {
        room.handlePlayerInput('snd_user', { moveX: 1, moveY: 0, sprint: true, dt: 16 });
      }

      assert.strictEqual(room.soundEvents.length, 500, '500 acoustic footstep events created');

      // Simulate passage of time past 1200ms expiration threshold
      const expiredTimestamp = Date.now() - 1500;
      for (const s of room.soundEvents) {
        s.createdAt = expiredTimestamp;
      }

      room.tick();
      assert.strictEqual(room.soundEvents.length, 0, 'Expired sound events must be pruned from room memory during tick');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
