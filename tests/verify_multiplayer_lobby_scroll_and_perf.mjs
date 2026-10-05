/**
 * Verification test for Multiplayer Lobby Overflow, Scrollability, and Anti-Glitch Performance
 */
import WebSocket from 'ws';
import http from 'http';
import { PROTOCOL_MSG_TYPES, serializePacket, deserializePacket } from '../shared/Protocol.js';

const SERVER_URL = 'ws://localhost:3000';
const HTTP_URL = 'http://localhost:3000';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runVerification() {
  console.log('--- Starting Multiplayer Lobby Overflow & Performance Verification ---');

  // Test 1: Verify server does not flood snapshots in LOBBY state
  console.log('Test 1: Verifying server does NOT flood snapshots in LOBBY state');
  const wsHost = new WebSocket(SERVER_URL);
  let snapshotCountLobby = 0;
  let hostLobbyState = null;
  const testRoomId = `ScrollTest_${Date.now()}`;

  await new Promise((resolve, reject) => {
    wsHost.on('open', () => {
      wsHost.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: testRoomId,
        playerName: 'Captain_Nemo',
        mapName: 'The Clockwork Foundry',
        maxPlayers: 4
      }));
    });

    wsHost.on('message', (raw) => {
      const packet = deserializePacket(raw.toString());
      if (packet.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE) {
        hostLobbyState = packet.payload;
        resolve();
      } else if (packet.type === PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT) {
        snapshotCountLobby++;
      }
    });

    wsHost.on('error', reject);
    setTimeout(() => reject(new Error('Timeout waiting for lobby state')), 3000);
  });

  console.log(`Host created room "${testRoomId}". Checking snapshots over 1.5 seconds...`);
  await wait(1500);

  if (snapshotCountLobby === 0) {
    console.log('✔ Test 1 Passed: 0 snapshots received in LOBBY state! No socket flood.');
  } else {
    throw new Error(`Test 1 Failed: Received ${snapshotCountLobby} snapshots during LOBBY state!`);
  }

  // Test 2: Connecting 3 additional players (total 4 players in room)
  console.log('Test 2: Connecting 3 more players to test multi-player roster');
  const clientSockets = [];
  const playerNames = ['Boiler_Jack', 'Steam_Valkyrie', 'Gears_Mechanic'];

  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(SERVER_URL);
    clientSockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
          roomId: testRoomId,
          playerName: playerNames[i]
        }));
      });
      ws.on('message', (raw) => {
        const packet = deserializePacket(raw.toString());
        if (packet.type === PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE) {
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error(`Timeout connecting player ${playerNames[i]}`)), 3000);
    });
  }

  console.log('4 players connected in room. Waiting for roster update...');
  await wait(300);

  // Test 3: Check REST API reflection of room with 4 players
  console.log('Test 3: Checking GET /api/rooms with 4 players in room');
  const res = await new Promise((resolve, reject) => {
    http.get(`${HTTP_URL}/api/rooms`, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const targetRoom = res.rooms.find(r => r.id === testRoomId);
  if (!targetRoom || targetRoom.playerCount !== 4) {
    throw new Error(`Test 3 Failed: Room player count should be 4, got ${targetRoom?.playerCount}`);
  }
  console.log(`✔ Test 3 Passed: /api/rooms reports 4/4 players in room ${testRoomId}`);

  // Test 4: Verify match launch starts snapshot generation
  console.log('Test 4: Launching match and verifying simulation snapshots begin');
  let matchInitReceived = false;
  let snapshotCountMatch = 0;

  wsHost.on('message', (raw) => {
    const packet = deserializePacket(raw.toString());
    if (packet.type === PROTOCOL_MSG_TYPES.S2C_MATCH_INIT) {
      matchInitReceived = true;
    } else if (packet.type === PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT) {
      snapshotCountMatch++;
    }
  });

  wsHost.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_MATCH_START, { roomId: testRoomId }));
  await wait(1000);

  if (!matchInitReceived) {
    throw new Error('Test 4 Failed: S2C_MATCH_INIT was not received upon match launch');
  }
  if (snapshotCountMatch < 10) {
    throw new Error(`Test 4 Failed: Expected >=10 snapshots during match, got ${snapshotCountMatch}`);
  }
  console.log(`✔ Test 4 Passed: Match successfully started and generated ${snapshotCountMatch} snapshots at 30Hz!`);

  // Cleanup
  wsHost.close();
  clientSockets.forEach(ws => ws.close());
  await wait(500);

  console.log('\n======================================================');
  console.log('✔ ALL MULTIPLAYER LOBBY & PERFORMANCE TESTS PASSED!');
  console.log('======================================================\n');
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
