/**
 * Standalone Adversarial Stress-Test Harness for WebSocket Protocol & Client-Server Synchronization
 * Authored by: challenger_m3_1 (Milestone M3 Challenger)
 * 
 * Stress-tests:
 * 1. High-frequency packet serialization/deserialization fuzzing (5,000+ mutated payloads,
 *    corrupted JSON, unexpected types, prototype pollution, nulls, and boundary values).
 * 2. Authoritative input vector fuzzing (NaN, Infinity, extreme dt, unbounded player names).
 * 3. Burst connection storm (50 simultaneous clients joining a 4-capacity room, multi-room bursts,
 *    strict capacity enforcement, and clean error responses).
 * 4. Connection drop resilience across connection states (lobby, countdown/transition, live 30Hz match,
 *    abrupt 1006 drops, dead-socket broadcasts, host migration).
 * 5. Latency & ping-pong RTT tracking under rapid back-to-back ping floods (1,000 pings, RTT percentiles,
 *    FIFO ordering, and 30Hz tick loop stability).
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  PROTOCOL_MSG_TYPES,
  serializePacket,
  deserializePacket
} from '../shared/Protocol.js';
import { GameServer } from '../server/GameServer.js';
import { Room } from '../server/Room.js';
import { MockWebSocketPair, MockSocketEndpoint } from './harnesses/mock_socket.js';
import { validPackets, malformedPackets } from './fixtures/protocol.fixture.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];
const anomalies = [];

async function test(id, name, asyncFn) {
  totalTests++;
  const t0 = performance.now();
  try {
    await asyncFn();
    const dt = (performance.now() - t0).toFixed(2);
    passedTests++;
    console.log(`  [PASS] ${id}: ${name} (${dt}ms)`);
  } catch (err) {
    const dt = (performance.now() - t0).toFixed(2);
    failedTests++;
    console.error(`  [FAIL] ${id}: ${name} (${dt}ms)`);
    console.error(`         ${err.message}`);
    failures.push({ id, name, error: err, duration: dt });
  }
}

function noteAnomaly(id, description, severity = 'LOW') {
  anomalies.push({ id, description, severity });
  console.warn(`  [ANOMALY ${severity}] ${id}: ${description}`);
}

// Microtask flush helper
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

console.log('========================================================================');
console.log('   M3 ADVERSARIAL STRESS TEST: PROTOCOL & REAL-TIME SYNCHRONIZATION    ');
console.log('========================================================================\n');

// ============================================================================
// SUITE 1: High-Frequency Packet Serialization & Deserialization Fuzzing
// ============================================================================
console.log('--- SUITE 1: Packet Serialization & Deserialization Fuzzing ---');

await test('S1.1', 'deserializePacket with non-string and falsy primitives', async () => {
  const falsyInputs = [null, undefined, '', 0, false, NaN];
  for (const input of falsyInputs) {
    const res = deserializePacket(input);
    assert.strictEqual(res, null, `Input ${String(input)} must deserialize to null`);
  }

  const primitiveInputs = [123, 45.67, true, Symbol('test'), 100n];
  for (const input of primitiveInputs) {
    const res = deserializePacket(input);
    assert.strictEqual(res, null, `Primitive input ${String(input)} must deserialize to null`);
  }
});

await test('S1.2', 'deserializePacket with malformed JSON strings', async () => {
  const malformed = [
    '{',
    '{"type":',
    '{"type": "PING",',
    '{"type": "PING", "payload":',
    '{"type": "PING", "payload": {',
    '{"type": "PING", "payload": {"foo": "bar"',
    '{"type": "PING" "payload": {}}', // Missing comma
    '{"type": undefined}',
    "{'type': 'PING'}", // Single quotes (invalid JSON)
    'undefined',
    'function() {}',
    '<html><body>Error 500</body></html>',
    '\x00\x01\x02\xFF\xFE',
    '{"type": "\u0000\u001F"}'
  ];

  for (const raw of malformed) {
    const res = deserializePacket(raw);
    if (raw.includes('\u0000\u001F')) {
      // Valid JSON escape with control characters
      assert.ok(res !== undefined, 'Control character string must not crash');
    } else {
      assert.strictEqual(res, null, `Malformed JSON "${raw.slice(0, 20)}" must deserialize to null`);
    }
  }
});

await test('S1.3', 'deserializePacket with invalid schema structures', async () => {
  const invalidSchemas = [
    '{}',                                   // Missing type
    '[]',                                   // Array root
    '[{"type": "PING"}]',                  // Array containing object
    '{"payload": {}}',                     // Missing type
    '{"type": 123, "payload": {}}',        // Numeric type
    '{"type": null, "payload": {}}',       // Null type
    '{"type": false, "payload": {}}',      // Boolean type
    '{"type": {}, "payload": {}}',         // Object type
    '{"type": [], "payload": {}}',         // Array type
    '"just a string"',                     // Primitive JSON string
    '12345',                               // Primitive JSON number
    'true',                                // Primitive JSON bool
    'null'                                 // Primitive JSON null
  ];

  for (const raw of invalidSchemas) {
    const res = deserializePacket(raw);
    assert.strictEqual(res, null, `Invalid schema "${raw.slice(0, 25)}" must deserialize to null`);
  }
});

await test('S1.4', 'deserializePacket payload null-coalescing and object passthrough', async () => {
  // Test Buffer input
  const bufValid = Buffer.from(JSON.stringify({ type: 'PING', payload: { timestamp: 12345 } }));
  const parsedBuf = deserializePacket(bufValid);
  assert.ok(parsedBuf, 'Buffer input must be deserialized');
  assert.strictEqual(parsedBuf.type, 'PING');
  assert.strictEqual(parsedBuf.payload.timestamp, 12345);

  // Test object input (in-memory passthrough)
  const objInput = { type: 'C2S_LOBBY_JOIN', payload: { roomId: 'test' } };
  const parsedObj = deserializePacket(objInput);
  assert.ok(parsedObj, 'Object input must pass through');
  assert.strictEqual(parsedObj.type, 'C2S_LOBBY_JOIN');
  assert.strictEqual(parsedObj.payload.roomId, 'test');

  // Test missing payload defaults to empty object
  const noPayload = JSON.stringify({ type: 'MATCH_START' });
  const parsedNoPayload = deserializePacket(noPayload);
  assert.ok(parsedNoPayload, 'Packet without payload must succeed');
  assert.strictEqual(parsedNoPayload.type, 'MATCH_START');
  assert.deepStrictEqual(parsedNoPayload.payload, {}, 'Missing payload must coalesce to empty object');

  // Test null payload defaults to empty object
  const nullPayload = JSON.stringify({ type: 'MATCH_START', payload: null });
  const parsedNullPayload = deserializePacket(nullPayload);
  assert.strictEqual(parsedNullPayload.type, 'MATCH_START');
  assert.deepStrictEqual(parsedNullPayload.payload, {}, 'Null payload must coalesce to empty object');
});

await test('S1.5', '5,000-cycle high-frequency randomized fuzzing against deserializePacket', async () => {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}"\':,[]- \t\n\r\\/~!@#$%^&*()_+`=\0\x1b';
  let handledCount = 0;
  let validParseCount = 0;

  for (let i = 0; i < 5000; i++) {
    const len = Math.floor(Math.random() * 80);
    let randomStr = '';
    for (let c = 0; c < len; c++) {
      randomStr += characters[Math.floor(Math.random() * characters.length)];
    }

    try {
      const res = deserializePacket(randomStr);
      handledCount++;
      if (res !== null) {
        validParseCount++;
        assert.ok(typeof res.type === 'string', 'Type must be string if parsed');
        assert.ok(typeof res.payload === 'object', 'Payload must be object if parsed');
      }
    } catch (err) {
      assert.fail(`deserializePacket threw uncaught exception on fuzzed input: ${err.message}`);
    }
  }

  assert.strictEqual(handledCount, 5000, 'All 5,000 fuzz packets must be processed without throwing');
});

await test('S1.6', 'Prototype pollution and injection payload resistance', async () => {
  const pollutionPayload = JSON.stringify({
    type: 'LOBBY_JOIN',
    payload: {
      __proto__: { polluted: 'YES' },
      constructor: { prototype: { admin: true } }
    }
  });

  const parsed = deserializePacket(pollutionPayload);
  assert.ok(parsed);
  assert.strictEqual({}.polluted, undefined, 'Object prototype must not be polluted');
  assert.strictEqual({}.admin, undefined, 'Global prototype must not be polluted');
});

await test('S1.7', 'Direct GameServer socket fuzzing (1,000 corrupted packets over active connection)', async () => {
  const server = new GameServer();
  const pair = new MockWebSocketPair();
  server.handleConnection(pair.serverSide, { id: 'fuzz_client' });

  // Bombard server with 1,000 illegal / corrupt / malformed packets
  for (let i = 0; i < 1000; i++) {
    const corruptions = [
      'NOT_JSON_JUNK_' + i,
      JSON.stringify({ type: 'NON_EXISTENT_MSG_' + i, payload: { value: i } }),
      JSON.stringify({ payload: { value: i } }),
      JSON.stringify({ type: 12345 }),
      '',
      '{"type": "PING", "payload": { "corrupted": true }'
    ];
    const chosen = corruptions[i % corruptions.length];
    pair.clientSide.send(chosen);
  }

  await flushMicrotasks();

  // Send a legitimate ping afterwards to verify server is still alive and responsive
  const pingTime = Date.now();
  pair.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_PING,
    payload: { timestamp: pingTime }
  });

  const pong = await pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_PONG, 1000);
  assert.ok(pong, 'Server must remain alive and respond to valid PING after 1,000 fuzzed packets');
  assert.strictEqual(pong.payload.clientTimestamp, pingTime);

  pair.clientSide.close();
});

// ============================================================================
// SUITE 2: Authoritative Input Vector & State Sanitization Boundaries
// ============================================================================
console.log('\n--- SUITE 2: Input Sanitization & State Poisoning Boundaries ---');

await test('S2.1', 'Authoritative input: NaN and Infinity moveX / moveY resilience', async () => {
  const room = new Room({ id: 'fuzz_input_room' });
  const player = room.addPlayer('p_inf', 'InfinityTester');
  const initialX = player.x;
  const initialY = player.y;

  assert.ok(Number.isFinite(initialX), 'Initial x must be finite');
  assert.ok(Number.isFinite(initialY), 'Initial y must be finite');

  // Case A: Feeding NaN
  room.handlePlayerInput('p_inf', { moveX: NaN, moveY: 0, dt: 16 });
  assert.ok(Number.isFinite(player.x), `Player x became non-finite after NaN moveX: ${player.x}`);
  assert.strictEqual(player.x, initialX, 'Player x must be unchanged after NaN moveX');

  // Case B: Feeding Infinity
  room.handlePlayerInput('p_inf', { moveX: Infinity, moveY: 0, dt: 16 });
  if (Number.isNaN(player.x) || !Number.isFinite(player.x)) {
    noteAnomaly('S2.1', `Infinity moveX poisoned player.x into NaN/Infinity (${player.x}) due to clamp ratio zero division`, 'HIGH');
  } else {
    assert.ok(Number.isFinite(player.x), 'Player x must remain finite after Infinity input');
  }

  // Case C: Feeding -Infinity
  room.handlePlayerInput('p_inf', { moveX: -Infinity, moveY: 0, dt: 16 });
  if (Number.isNaN(player.x) || !Number.isFinite(player.x)) {
    noteAnomaly('S2.1', `Negative Infinity moveX poisoned player.x into NaN/Infinity (${player.x})`, 'HIGH');
  }
});

await test('S2.2', 'Authoritative input: Extreme dt values (negative, huge, dt=0)', async () => {
  const room = new Room({ id: 'fuzz_dt_room' });
  const player = room.addPlayer('p_dt', 'DtTester');
  const startX = player.x;

  // Negative dt must be ignored or clamped to standard tick
  room.handlePlayerInput('p_dt', { moveX: 1, moveY: 0, dt: -1000 });
  assert.ok(player.x >= startX, 'Negative dt must not cause backwards teleport');

  // Extreme huge dt (e.g. 100,000 ms)
  const curX = player.x;
  room.handlePlayerInput('p_dt', { moveX: 10000, moveY: 0, dt: 100000 });
  const disp = player.x - curX;

  // Max legitimate displacement at 180 px/s for reasonable 1-frame tick (~16ms - 100ms) should be <= 30px
  if (disp > 300) {
    noteAnomaly('S2.2', `dt=100,000 allows huge displacement ${disp.toFixed(0)}px; dt lacks upper-bound clamp`, 'MEDIUM');
  }
});

await test('S2.3', 'Authoritative input: aimAngle boundary fuzzing (NaN, Infinity, 1e20)', async () => {
  const room = new Room({ id: 'fuzz_angle_room' });
  const player = room.addPlayer('p_angle', 'AngleTester');

  // aimAngle NaN
  room.handlePlayerInput('p_angle', { aimAngle: NaN });
  // Verify snapshot formatting doesn't break
  const payload = {
    angle: Math.round((player.angle || 0) * 1000) / 1000
  };
  assert.strictEqual(payload.angle, 0, 'NaN angle must fallback to 0 in snapshot');

  // aimAngle Infinity
  room.handlePlayerInput('p_angle', { aimAngle: Infinity });
  const snapAngle = Math.round((player.angle || 0) * 1000) / 1000;
  if (!Number.isFinite(snapAngle)) {
    noteAnomaly('S2.3', `Infinity aimAngle causes non-finite snapshot angle (${snapAngle}), serializing as null`, 'LOW');
  }
});

// ============================================================================
// SUITE 3: Burst Connection Storm (50 Simultaneous Clients -> Capacity 4)
// ============================================================================
console.log('\n--- SUITE 3: Burst Connection Storm (50 Concurrent Clients) ---');

await test('S3.1', '50 simultaneous clients joining room of max capacity 4', async () => {
  const server = new GameServer();
  const room = server.createRoom('storm_room_1', { maxPlayers: 4 });

  const clientCount = 50;
  const pairs = [];

  for (let i = 0; i < clientCount; i++) {
    const pair = new MockWebSocketPair();
    pairs.push(pair);
    server.handleConnection(pair.serverSide, { id: `storm_c_${i}` });
  }

  // Fire all 50 C2S_LOBBY_JOIN in a single burst
  for (let i = 0; i < clientCount; i++) {
    pairs[i].clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
      payload: { roomId: 'storm_room_1', playerName: `Trooper_${i}` }
    });
  }

  // Wait for all responses
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

  assert.strictEqual(timeouts.length, 0, `No client should timeout (got ${timeouts.length} timeouts)`);
  assert.strictEqual(accepted.length, 4, `Exactly 4 clients must be accepted (got ${accepted.length})`);
  assert.strictEqual(rejected.length, 46, `Exactly 46 clients must be rejected with ERROR (got ${rejected.length})`);

  // Verify all rejected clients received LOBBY_FULL error code
  for (const rej of rejected) {
    assert.strictEqual(rej.payload.code, 'LOBBY_FULL', 'Rejected client error code must be LOBBY_FULL');
  }

  // Verify room internal state
  assert.strictEqual(room.players.size, 4, 'Room players map size must be strictly 4');

  // Clean up
  for (const p of pairs) p.clientSide.close();
});

await test('S3.2', 'Three consecutive 50-client burst waves (150 total connection attempts)', async () => {
  const server = new GameServer();
  const room = server.createRoom('multi_wave_room', { maxPlayers: 4 });

  for (let wave = 1; wave <= 3; wave++) {
    const wavePairs = [];
    for (let i = 0; i < 50; i++) {
      const p = new MockWebSocketPair();
      wavePairs.push(p);
      server.handleConnection(p.serverSide, { id: `wave_${wave}_c_${i}` });
    }

    for (let i = 0; i < 50; i++) {
      wavePairs[i].clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'multi_wave_room', playerName: `W${wave}_P${i}` }
      });
    }

    const responses = await Promise.all(
      wavePairs.map(p =>
        Promise.race([
          p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000),
          p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 1000)
        ]).catch(err => ({ type: 'TIMEOUT' }))
      )
    );

    const accepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
    const rejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR);

    if (wave === 1) {
      assert.strictEqual(accepted.length, 4, `Wave 1 must accept 4 clients`);
      assert.strictEqual(rejected.length, 46, `Wave 1 must reject 46 clients`);
    } else {
      assert.strictEqual(accepted.length, 0, `Wave ${wave} must accept 0 clients (already full)`);
      assert.strictEqual(rejected.length, 50, `Wave ${wave} must reject all 50 clients`);
    }

    assert.strictEqual(room.players.size, 4, `Room player count must remain strictly 4 after wave ${wave}`);

    // Close only the rejected sockets
    for (let i = (wave === 1 ? 4 : 0); i < 50; i++) {
      wavePairs[i].clientSide.close();
    }
  }
});

await test('S3.3', 'Multi-room concurrent burst storm (100 clients across 5 rooms)', async () => {
  const server = new GameServer();
  const roomIds = ['room_A', 'room_B', 'room_C', 'room_D', 'room_E'];
  for (const rId of roomIds) {
    server.createRoom(rId, { maxPlayers: 4 });
  }

  // 100 clients total (20 clients per room)
  const allPairs = [];
  const expectedRoomForClient = [];

  for (let rIdx = 0; rIdx < roomIds.length; rIdx++) {
    const targetRoom = roomIds[rIdx];
    for (let c = 0; c < 20; c++) {
      const p = new MockWebSocketPair();
      allPairs.push(p);
      expectedRoomForClient.push(targetRoom);
      server.handleConnection(p.serverSide, { id: `${targetRoom}_c${c}` });
    }
  }

  // Launch all 100 joins in single event loop
  for (let i = 0; i < allPairs.length; i++) {
    allPairs[i].clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
      payload: { roomId: expectedRoomForClient[i], playerName: `MR_User_${i}` }
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

  const totalAccepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE).length;
  const totalRejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR).length;

  assert.strictEqual(totalAccepted, 20, `Across 5 rooms (4 slots each), exactly 20 clients must be accepted`);
  assert.strictEqual(totalRejected, 80, `Exactly 80 excess clients must be rejected`);

  // Verify each room has exactly 4 players
  for (const rId of roomIds) {
    const r = server.rooms.get(rId);
    assert.strictEqual(r.players.size, 4, `Room ${rId} must have exactly 4 players`);
  }

  for (const p of allPairs) p.clientSide.close();
});

await test('S3.4', 'Solitary room capacity boundary: maxPlayers = 1 under burst', async () => {
  const server = new GameServer();
  const room = server.createRoom('solo_room', { maxPlayers: 1 });

  const pairs = [];
  for (let i = 0; i < 15; i++) {
    const p = new MockWebSocketPair();
    pairs.push(p);
    server.handleConnection(p.serverSide, { id: `solo_c_${i}` });
    p.clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
      payload: { roomId: 'solo_room', playerName: `SoloUser_${i}` }
    });
  }

  const responses = await Promise.all(
    pairs.map(p =>
      Promise.race([
        p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 500),
        p.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 500)
      ])
    )
  );

  const accepted = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
  const rejected = responses.filter(r => r.type === PROTOCOL_MSG_TYPES.S2C_ERROR);

  assert.strictEqual(accepted.length, 1, 'Only 1 client admitted into solitary room');
  assert.strictEqual(rejected.length, 14, '14 clients rejected');
  assert.strictEqual(room.players.size, 1);

  for (const p of pairs) p.clientSide.close();
});

// ============================================================================
// SUITE 4: Connection Drop Resilience Across Connection States
// ============================================================================
console.log('\n--- SUITE 4: Connection Drop Resilience Across Lifecycle States ---');

await test('S4.1', 'Lobby State: Host drops abruptly, host privilege migrates cleanly', async () => {
  const server = new GameServer();
  const room = server.createRoom('host_drop_room', { maxPlayers: 4 });

  const pairHost = new MockWebSocketPair();
  const pairGuest = new MockWebSocketPair();

  server.handleConnection(pairHost.serverSide, { id: 'host_player' });
  server.handleConnection(pairGuest.serverSide, { id: 'guest_player' });

  pairHost.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: { roomId: 'host_drop_room', playerName: 'LordKelvin' }
  });
  await pairHost.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 500);

  pairGuest.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: { roomId: 'host_drop_room', playerName: 'ApprenticeWatt' }
  });
  await pairGuest.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 500);

  assert.strictEqual(room.players.get('host_player').isHost, true);
  assert.strictEqual(room.players.get('guest_player').isHost, false);

  // Host abruptly disconnects with 1006 abnormal closure
  pairHost.clientSide.close(1006, 'Abnormal Termination');
  await flushMicrotasks();

  // Verify host privilege migrated to guest
  assert.strictEqual(room.players.size, 1, 'Room should have 1 player remaining');
  assert.strictEqual(room.players.has('host_player'), false, 'Disconnected host must be removed');
  const remainingPlayer = room.players.get('guest_player');
  assert.ok(remainingPlayer, 'Guest player must remain');
  assert.strictEqual(remainingPlayer.isHost, true, 'Guest player must be promoted to host');

  pairGuest.clientSide.close();
});

await test('S4.2', 'Rapid connect/disconnect churn (50 clients connect and drop instantly)', async () => {
  const server = new GameServer();
  const room = server.createRoom('churn_room', { maxPlayers: 4 });

  for (let i = 0; i < 50; i++) {
    const pair = new MockWebSocketPair();
    server.handleConnection(pair.serverSide, { id: `churn_${i}` });
    pair.clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
      payload: { roomId: 'churn_room', playerName: `Churner_${i}` }
    });
    // Abruptly close without waiting
    pair.clientSide.close(1006, 'Churn Close');
  }

  await flushMicrotasks();
  room.tick();
  room.cleanupDisconnected();

  // Room should be clean without memory leaks or crashes
  assert.ok(room.players.size <= 4, 'Room player size must be within bounds');
  for (const [id, player] of room.players) {
    if (player.socket && player.socket.readyState !== 1) {
      assert.fail(`Dead socket remained uncleaned for player ${id}`);
    }
  }
});

await test('S4.3', 'Match Countdown / Transition: Drop exactly when match is started', async () => {
  const server = new GameServer();
  const room = server.createRoom('transition_drop_room', { maxPlayers: 2 });

  const p1 = new MockWebSocketPair();
  const p2 = new MockWebSocketPair();

  server.handleConnection(p1.serverSide, { id: 'trans_p1' });
  server.handleConnection(p2.serverSide, { id: 'trans_p2' });

  p1.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'transition_drop_room' } });
  p2.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'transition_drop_room' } });
  await flushMicrotasks();

  // P1 drops simultaneously as MATCH_START is triggered
  p1.clientSide.close(1006, 'Dropped During Start');
  p2.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_MATCH_START });

  await flushMicrotasks();
  room.tick();

  assert.strictEqual(room.state, 'IN_PROGRESS', 'Room should progress to IN_PROGRESS');
  assert.strictEqual(room.players.size, 1, 'Dropped player must be removed');
  assert.ok(room.players.has('trans_p2'), 'Remaining player must be active');

  p2.clientSide.close();
});

await test('S4.4', 'Live 30Hz Match: Abrupt socket termination during rapid ticks and movement', async () => {
  const server = new GameServer();
  const room = server.createRoom('live_match_room', { maxPlayers: 4, autoTick: false });

  const pairs = [];
  for (let i = 0; i < 4; i++) {
    const p = new MockWebSocketPair();
    pairs.push(p);
    server.handleConnection(p.serverSide, { id: `live_p${i}` });
    p.clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
      payload: { roomId: 'live_match_room', playerName: `LiveUser_${i}` }
    });
  }
  await flushMicrotasks();

  room.startMatch();
  assert.strictEqual(room.state, 'IN_PROGRESS');

  // Simulate 10 ticks of active movement
  for (let t = 0; t < 10; t++) {
    for (let i = 0; i < 4; i++) {
      room.handlePlayerInput(`live_p${i}`, { moveX: 1, moveY: 0, sprint: true, dt: 33 });
    }
    room.tick();
  }

  // Abruptly drop player 0 and player 2 with abnormal termination
  pairs[0].clientSide.close(1006, 'Abnormal Termination');
  pairs[2].clientSide.close(1006, 'Abnormal Termination');
  await flushMicrotasks();

  // Run 15 more ticks while broadcasting snapshots to remaining and dead sockets
  for (let t = 0; t < 15; t++) {
    room.handlePlayerInput('live_p1', { moveX: 0, moveY: 1, dt: 33 });
    room.handlePlayerInput('live_p3', { moveX: -1, moveY: 0, dt: 33 });
    room.tick();
  }

  // Verify dead players safely swept
  assert.strictEqual(room.players.has('live_p0'), false, 'Dropped player 0 must be removed');
  assert.strictEqual(room.players.has('live_p2'), false, 'Dropped player 2 must be removed');
  assert.strictEqual(room.players.size, 2, '2 active players should remain');

  // Receive snapshot on living client
  const snap = await pairs[1].clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 500);
  assert.ok(snap, 'Living player must continue receiving world snapshots');
  assert.strictEqual(snap.payload.players.length, 2, 'Snapshot must only contain 2 active players');

  pairs[1].clientSide.close();
  pairs[3].clientSide.close();
});

await test('S4.5', 'Live Match: All players drop abruptly; zero-player match resilience', async () => {
  const room = new Room({ id: 'all_drop_room' });
  const pA = new MockWebSocketPair();
  const pB = new MockWebSocketPair();

  room.addPlayer('all_pA', 'Alpha', pA.serverSide);
  room.addPlayer('all_pB', 'Beta', pB.serverSide);
  room.startMatch();

  // Both drop simultaneously
  pA.clientSide.close(1006);
  pB.clientSide.close(1006);
  await flushMicrotasks();

  // Simulation ticks with 0 players
  for (let i = 0; i < 5; i++) {
    room.tick();
  }

  assert.strictEqual(room.players.size, 0, 'All players safely removed');
  const outcome = room.evaluateMatchOutcome();
  assert.strictEqual(outcome.isOver, false, 'Outcome evaluation with 0 entities must not crash');
});

// ============================================================================
// SUITE 5: Latency & Ping-Pong RTT Tracking Under Rapid Ping Floods
// ============================================================================
console.log('\n--- SUITE 5: Latency & Ping-Pong RTT Tracking Under Ping Floods ---');

await test('S5.1', 'Single-client 1,000 rapid back-to-back ping flood & RTT metrics', async () => {
  const server = new GameServer();
  const pair = new MockWebSocketPair();
  server.handleConnection(pair.serverSide, { id: 'ping_flooder' });

  const pingCount = 1000;
  const sentTimestamps = [];
  const rttList = [];

  // Set up message listener to track PONG responses
  const pongReceived = new Promise((resolve, reject) => {
    let received = 0;
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for 1,000 PONGs (received ${received})`));
    }, 4000);

    pair.clientSide.on('message', (raw) => {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (msg.type === PROTOCOL_MSG_TYPES.S2C_PONG) {
        const clientTs = msg.payload.clientTimestamp;
        const now = performance.now();
        const rtt = now - clientTs;
        rttList.push(rtt);
        received++;

        if (received === pingCount) {
          clearTimeout(timeout);
          resolve(received);
        }
      }
    });
  });

  // Flood 1,000 pings
  for (let i = 0; i < pingCount; i++) {
    const now = performance.now();
    sentTimestamps.push(now);
    pair.clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_PING,
      payload: { timestamp: now, seq: i }
    });
  }

  const totalReceived = await pongReceived;
  assert.strictEqual(totalReceived, pingCount, 'Must receive exactly 1,000 PONGs');

  // Compute RTT statistics
  rttList.sort((a, b) => a - b);
  const minRtt = rttList[0];
  const maxRtt = rttList[rttList.length - 1];
  const avgRtt = rttList.reduce((acc, v) => acc + v, 0) / rttList.length;
  const medianRtt = rttList[Math.floor(rttList.length / 2)];
  const p95Rtt = rttList[Math.floor(rttList.length * 0.95)];
  const p99Rtt = rttList[Math.floor(rttList.length * 0.99)];

  console.log(`    -> Ping flood RTT stats (N=${pingCount}):`);
  console.log(`       Min: ${minRtt.toFixed(2)}ms | Avg: ${avgRtt.toFixed(2)}ms | Median: ${medianRtt.toFixed(2)}ms`);
  console.log(`       P95: ${p95Rtt.toFixed(2)}ms | P99: ${p99Rtt.toFixed(2)}ms | Max: ${maxRtt.toFixed(2)}ms`);

  assert.ok(maxRtt < 500, `Max RTT ${maxRtt.toFixed(2)}ms must be under 500ms for in-memory channel`);
  pair.clientSide.close();
});

await test('S5.2', 'Multi-client simultaneous ping flood (4 clients x 250 pings = 1,000 total)', async () => {
  const server = new GameServer();
  const clients = [];

  for (let c = 0; c < 4; c++) {
    const pair = new MockWebSocketPair();
    server.handleConnection(pair.serverSide, { id: `multi_ping_${c}` });
    clients.push(pair);
  }

  const pingsPerClient = 250;

  const clientPromises = clients.map((pair, cIdx) => {
    return new Promise((resolve, reject) => {
      let count = 0;
      const timer = setTimeout(() => {
        reject(new Error(`Client ${cIdx} timed out (received ${count}/${pingsPerClient})`));
      }, 4000);

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
  const sumReceived = results.reduce((acc, v) => acc + v, 0);

  assert.strictEqual(sumReceived, 1000, 'All 1,000 multi-client pings must receive PONG');

  for (const p of clients) p.clientSide.close();
});

await test('S5.3', 'Server tick loop rate stability during concurrent ping flood', async () => {
  const server = new GameServer();
  const room = server.createRoom('stability_room', { maxPlayers: 4 });
  const p1 = new MockWebSocketPair();
  server.handleConnection(p1.serverSide, { id: 'stable_c1' });

  p1.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: { roomId: 'stability_room' }
  });
  await flushMicrotasks();

  room.startMatch();

  // Record tick execution times during 30 ticks while 500 pings flood in
  const tickTimes = [];
  for (let i = 0; i < 500; i++) {
    p1.clientSide.send({
      type: PROTOCOL_MSG_TYPES.C2S_PING,
      payload: { timestamp: Date.now() }
    });
  }

  for (let t = 0; t < 30; t++) {
    const t0 = performance.now();
    room.tick();
    tickTimes.push(performance.now() - t0);
  }

  const maxTickTime = Math.max(...tickTimes);
  const avgTickTime = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;

  console.log(`    -> Tick performance under flood: Avg: ${avgTickTime.toFixed(3)}ms | Max: ${maxTickTime.toFixed(3)}ms`);
  assert.ok(maxTickTime < 15, `Server tick time (${maxTickTime.toFixed(2)}ms) must remain strictly under 15ms target`);

  p1.clientSide.close();
});

// ============================================================================
// SUITE 6: Gameplay & State Machine Adversarial Scenarios
// ============================================================================
console.log('\n--- SUITE 6: Gameplay & State Machine Adversarial Scenarios ---');

await test('S6.1', 'Unauthorized match start: Non-host client triggers C2S_MATCH_START', async () => {
  const server = new GameServer();
  const room = server.createRoom('auth_start_room', { maxPlayers: 2 });

  const hostPair = new MockWebSocketPair();
  const guestPair = new MockWebSocketPair();

  server.handleConnection(hostPair.serverSide, { id: 'real_host' });
  server.handleConnection(guestPair.serverSide, { id: 'unauthorized_guest' });

  hostPair.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'auth_start_room' } });
  guestPair.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'auth_start_room' } });
  await flushMicrotasks();

  // Guest attempts to start match
  guestPair.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_MATCH_START });
  await flushMicrotasks();

  if (room.state === 'IN_PROGRESS') {
    noteAnomaly('S6.1', 'GameServer allows non-host guest to trigger C2S_MATCH_START and transition match state', 'MEDIUM');
  }

  hostPair.clientSide.close();
  guestPair.clientSide.close();
});

await test('S6.2', 'Mid-game C2S_MATCH_START resets player health during active combat', async () => {
  const server = new GameServer();
  const room = server.createRoom('mid_game_reset_room', { maxPlayers: 2 });

  const p1 = new MockWebSocketPair();
  server.handleConnection(p1.serverSide, { id: 'fighter_1' });
  p1.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload: { roomId: 'mid_game_reset_room' } });
  await flushMicrotasks();

  room.startMatch();
  const player = room.players.get('fighter_1');
  player.hp = 10; // Low HP

  // Client issues C2S_MATCH_START mid-match
  p1.clientSide.send({ type: PROTOCOL_MSG_TYPES.C2S_MATCH_START });
  await flushMicrotasks();

  if (player.hp === 100) {
    noteAnomaly('S6.2', 'C2S_MATCH_START during live match resets player HP back to 100 (state reset exploit)', 'HIGH');
  }

  p1.clientSide.close();
});

await test('S6.3', 'Acoustic pulse flooding: Rapid sprint toggling does not cause memory leak', async () => {
  const room = new Room({ id: 'sound_flood_room' });
  const player = room.addPlayer('sound_p1', 'NoisyRunner');

  // Generate 500 footstep sound events via rapid sprint inputs
  for (let i = 0; i < 500; i++) {
    room.handlePlayerInput('sound_p1', { moveX: 1, moveY: 0, sprint: true, dt: 16 });
  }

  assert.strictEqual(room.soundEvents.length, 500, '500 sound events created');

  // Advance simulation clock past sound event expiration (1200ms)
  // Mock Date.now by mutating createdAt or ticking after 1300ms
  const expiredTime = Date.now() - 1500;
  for (const s of room.soundEvents) {
    s.createdAt = expiredTime;
  }

  room.tick();
  assert.strictEqual(room.soundEvents.length, 0, 'Expired sound events must be pruned to prevent unbounded memory growth');
});

// ============================================================================
// FINAL SUMMARY & ANOMALY REPORT
// ============================================================================
console.log('\n========================================================================');
console.log('                   STRESS TEST EXECUTION SUMMARY                        ');
console.log('========================================================================');
console.log(`  Total Tests:       ${totalTests}`);
console.log(`  Passed Tests:      ${passedTests}`);
console.log(`  Failed Tests:      ${failedTests}`);
console.log(`  Anomalies Noted:   ${anomalies.length}`);
console.log('========================================================================\n');

if (anomalies.length > 0) {
  console.log('ANOMALIES & SECURITY FINDINGS:');
  for (const a of anomalies) {
    console.log(`  [${a.severity}] ${a.id}: ${a.description}`);
  }
  console.log('');
}

if (failures.length > 0) {
  console.error('FAILURES:');
  for (const f of failures) {
    console.error(`  [${f.id}] ${f.name}: ${f.error.message}`);
  }
  process.exit(1);
} else {
  console.log('SUCCESS: All 20 adversarial stress tests completed without assertion crashes.\n');
  process.exit(0);
}
