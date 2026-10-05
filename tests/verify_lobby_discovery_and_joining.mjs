/**
 * Verification test for Lobby Discovery, Active Rooms REST & Socket API, and Resilient Joining
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { GameServer } from '../server/GameServer.js';
import { startServer } from '../server/index.js';
import { MockWebSocketPair } from './harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES, serializePacket, deserializePacket } from '../shared/Protocol.js';

async function runTests() {
  console.log('--- Starting Lobby Discovery & Joining Verification ---');

  // Test 1: GameServer.getActiveRooms() basic functionality
  console.log('Test 1: GameServer.getActiveRooms() initial state');
  const gameServer = new GameServer();
  const initialRooms = gameServer.getActiveRooms();
  assert.ok(Array.isArray(initialRooms), 'initialRooms should be an array');
  const defaultRoom = initialRooms.find(r => r.id === 'default');
  assert.ok(defaultRoom, 'Default room should be listed in active rooms');
  assert.strictEqual(defaultRoom.playerCount, 0);
  assert.strictEqual(defaultRoom.state, 'LOBBY');
  console.log('✔ Test 1 Passed: Default room listed correctly');

  // Test 2: WebSocket C2S_ROOMS_LIST
  console.log('Test 2: Socket C2S_ROOMS_LIST packet');
  const pair1 = new MockWebSocketPair();
  gameServer.handleConnection(pair1.serverSide, { id: 'client_p1', playerName: 'Player1' });

  pair1.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_ROOMS_LIST,
    payload: {}
  });

  const roomsMsg = await pair1.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ROOMS_LIST, 1000);
  assert.ok(roomsMsg, 'Server should respond with S2C_ROOMS_LIST');
  assert.ok(Array.isArray(roomsMsg.payload?.rooms), 'Payload should contain rooms array');
  console.log('✔ Test 2 Passed: C2S_ROOMS_LIST returns active rooms list via WebSocket');

  // Test 3: Creating a chamber adds it to active rooms
  console.log('Test 3: Creating a custom chamber');
  pair1.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE,
    payload: {
      roomId: 'SteamChamber_77',
      playerName: 'HostCaptain',
      mapName: 'Foundry Arena',
      maxPlayers: 3
    }
  });

  const lobbyStateMsg1 = await pair1.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000);
  assert.ok(lobbyStateMsg1, 'Should receive LOBBY_STATE on create');
  assert.strictEqual(lobbyStateMsg1.payload.roomId, 'SteamChamber_77');
  assert.strictEqual(lobbyStateMsg1.payload.players.length, 1);

  const roomsAfterCreate = gameServer.getActiveRooms();
  const created = roomsAfterCreate.find(r => r.id === 'SteamChamber_77');
  assert.ok(created, 'SteamChamber_77 must be present in active rooms');
  assert.strictEqual(created.playerCount, 1);
  assert.strictEqual(created.maxPlayers, 3);
  assert.strictEqual(created.state, 'LOBBY');
  console.log('✔ Test 3 Passed: Custom chamber created and visible in active rooms list');

  // Test 4: Second player joins the chamber
  console.log('Test 4: Second player joining existing chamber');
  const pair2 = new MockWebSocketPair();
  gameServer.handleConnection(pair2.serverSide, { id: 'client_p2', playerName: 'GuestRanger' });

  pair2.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: {
      roomId: 'SteamChamber_77',
      playerName: 'GuestRanger'
    }
  });

  const lobbyStateMsg2 = await pair2.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000);
  assert.ok(lobbyStateMsg2, 'Player 2 should receive LOBBY_STATE');
  assert.strictEqual(lobbyStateMsg2.payload.roomId, 'SteamChamber_77');
  assert.strictEqual(lobbyStateMsg2.payload.players.length, 2);

  const roomsAfterJoin = gameServer.getActiveRooms();
  const chamberJoined = roomsAfterJoin.find(r => r.id === 'SteamChamber_77');
  assert.strictEqual(chamberJoined.playerCount, 2, 'Player count should be 2 after join');
  console.log('✔ Test 4 Passed: Second player successfully joined, playerCount updated');

  // Test 5: Third player and capacity limit check
  console.log('Test 5: Room capacity limit enforcement');
  const pair3 = new MockWebSocketPair();
  gameServer.handleConnection(pair3.serverSide, { id: 'client_p3', playerName: 'Player3' });
  pair3.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: { roomId: 'SteamChamber_77', playerName: 'Player3' }
  });
  await pair3.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE, 1000);

  const pair4 = new MockWebSocketPair();
  gameServer.handleConnection(pair4.serverSide, { id: 'client_p4', playerName: 'Player4' });
  pair4.clientSide.send({
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: { roomId: 'SteamChamber_77', playerName: 'Player4' }
  });
  const errorMsg = await pair4.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 1000);
  assert.ok(errorMsg, '4th player should receive error');
  assert.strictEqual(errorMsg.payload.code, 'LOBBY_FULL');
  console.log('✔ Test 5 Passed: Room capacity limit correctly enforced');

  // Test 6: Disconnection and clean dynamic room cleanup
  console.log('Test 6: Disconnecting all players cleans up dynamic room');
  pair1.clientSide.close();
  pair2.clientSide.close();
  pair3.clientSide.close();
  pair4.clientSide.close();

  const roomsAfterClose = gameServer.getActiveRooms();
  const chamberCleaned = roomsAfterClose.find(r => r.id === 'SteamChamber_77');
  assert.strictEqual(chamberCleaned, undefined, 'Empty dynamic room must be pruned');
  console.log('✔ Test 6 Passed: Dynamic room cleaned up cleanly upon disconnection');

  // Test 7: REST API GET /api/rooms on live HTTP server
  console.log('Test 7: Live HTTP server GET /api/rooms');
  const testPort = 3199;
  const { server: liveServer } = startServer(testPort);

  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${testPort}/api/rooms`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
      }).on('error', reject);
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.rooms));
    assert.ok(res.body.rooms.some(r => r.id === 'default'));
    console.log('✔ Test 7 Passed: GET /api/rooms returns 200 OK with active rooms');
  } finally {
    liveServer.close();
  }

  console.log('\n======================================================');
  console.log('✔ ALL LOBBY DISCOVERY & JOINING TESTS PASSED (7/7)!');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
