/**
 * Tier 3: Room Creation & Host Lifecycle Integration Tests
 * Validates room creation, host persistence on re-creation/updates,
 * duplicate room collision rejection, and multi-player host identity.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { GameServer } from '../../server/GameServer.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';
import { serializePacket } from '../../shared/Protocol.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';

export const suiteName = 'Tier 3: Room Creation & Host Lifecycle';

export const tests = [
  {
    id: 'T3.RC1',
    name: 'Room Creation Grants Authoritative Host Status and Map Configuration',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, { id: 'client_host_1', playerName: 'ChiefEngineer' });

      // Client sends C2S_LOBBY_CREATE
      const waitState = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Alpha',
        playerName: 'ChiefEngineer',
        mapName: 'The Clockwork Foundry',
        maxPlayers: 4,
        map: canonicalFoundryMap,
        gameMode: 'team_dm',
        targetKills: 20
      }));

      const lobbyState = await waitState;

      assert.ok(lobbyState, 'Should receive S2C_LOBBY_STATE on room creation');
      assert.strictEqual(lobbyState.payload.roomId, 'Sector_Alpha');
      assert.strictEqual(lobbyState.payload.gameMode, 'team_dm');
      assert.strictEqual(lobbyState.payload.targetKills, 20);
      assert.strictEqual(lobbyState.payload.players.length, 1);
      assert.strictEqual(lobbyState.payload.players[0].isHost, true, 'Creator must be designated as host');
      assert.strictEqual(lobbyState.payload.hostId, 'client_host_1');
    }
  },

  {
    id: 'T3.RC2',
    name: 'Host Re-creating or Updating Chamber Preserves Host Status and Updates Config',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, { id: 'client_host_2', playerName: 'MasterSmith' });

      // Initial create
      const waitInit = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Beta',
        playerName: 'MasterSmith',
        gameMode: 'solo_elim',
        targetKills: 0
      }));
      await waitInit;

      // Host clicks Create again or updates with different game mode
      const waitUpdate = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Beta',
        playerName: 'MasterSmith_Updated',
        gameMode: 'ffa_dm',
        targetKills: 15
      }));

      const updatedState = await waitUpdate;

      assert.ok(updatedState, 'Should receive updated S2C_LOBBY_STATE');
      assert.strictEqual(updatedState.payload.gameMode, 'ffa_dm', 'Game mode should update');
      assert.strictEqual(updatedState.payload.targetKills, 15, 'Target kills should update');
      assert.strictEqual(updatedState.payload.players[0].isHost, true, 'Host rights must remain true');
      assert.strictEqual(updatedState.payload.hostId, 'client_host_2', 'hostId must remain client');
    }
  },

  {
    id: 'T3.RC3',
    name: 'Room Collision: Another Player Creating Occupied Room Receives ROOM_EXISTS Error',
    fn: async () => {
      const server = new GameServer();
      const hostPair = new MockWebSocketPair();
      server.handleConnection(hostPair.serverSide, { id: 'host_client', playerName: 'OriginalHost' });

      // Host creates room
      const waitHost = hostPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      hostPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Gamma',
        playerName: 'OriginalHost'
      }));
      await waitHost;

      // Second client attempts to CREATE the same chamber ID
      const intruderPair = new MockWebSocketPair();
      server.handleConnection(intruderPair.serverSide, { id: 'intruder_client', playerName: 'NewGuest' });

      const waitError = intruderPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR);
      intruderPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Gamma',
        playerName: 'NewGuest'
      }));

      const errorPacket = await waitError;

      assert.ok(errorPacket, 'Intruder should receive S2C_ERROR when attempting to overwrite room');
      assert.strictEqual(errorPacket.payload.code, 'ROOM_EXISTS');
    }
  },

  {
    id: 'T3.RC4',
    name: 'Multi-Client Lobby Distinguishes Host vs Guest Correctly',
    fn: async () => {
      const server = new GameServer();
      const hostPair = new MockWebSocketPair();
      server.handleConnection(hostPair.serverSide, { id: 'host_player', playerName: 'HostCaptain' });

      const waitHost = hostPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      hostPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Delta',
        playerName: 'HostCaptain'
      }));
      await waitHost;

      // Guest joins
      const guestPair = new MockWebSocketPair();
      server.handleConnection(guestPair.serverSide, { id: 'guest_player', playerName: 'RangerGuest' });

      const waitGuest = guestPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      guestPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
        roomId: 'Sector_Delta',
        playerName: 'RangerGuest'
      }));

      const guestState = await waitGuest;

      assert.ok(guestState, 'Guest should receive lobby state');
      assert.strictEqual(guestState.payload.players.length, 2);
      assert.strictEqual(guestState.payload.hostId, 'host_player');

      const hostEntry = guestState.payload.players.find(p => p.id === 'host_player');
      const guestEntry = guestState.payload.players.find(p => p.id === 'guest_player');

      assert.strictEqual(hostEntry.isHost, true, 'Host entry isHost must be true');
      assert.strictEqual(guestEntry.isHost, false, 'Guest entry isHost must be false');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
