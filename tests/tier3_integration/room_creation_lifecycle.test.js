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
import { serializePacket, deserializePacket } from '../../shared/Protocol.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';
import { NetworkClient } from '../../client/js/NetworkClient.js';

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
  },

  {
    id: 'T3.RC5',
    name: 'Player Equipped Weapon Spawns and Live Updates with Exact Arsenal Stats (Blunderbuss -> Needle Gun)',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, { id: 'arsenal_client_1', playerName: 'Gunsmith' });

      // 1. Create chamber with equipped Blunderbuss (2-shot shotgun)
      const waitCreate = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Armory',
        playerName: 'Gunsmith',
        equippedWeapon: 'blunderbuss',
        equippedClass: 'demolitionist'
      }));
      await waitCreate;

      const room = server.rooms.get('Sector_Armory');
      assert.ok(room, 'Room Sector_Armory must exist');

      const player = room.players.get('arsenal_client_1');
      assert.ok(player, 'Player must be registered in chamber');
      assert.strictEqual(player.weaponId, 'blunderbuss', 'Equipped weapon must be blunderbuss');
      assert.strictEqual(player.weapon.magazine, 2, 'Blunderbuss magazine must be 2');
      assert.strictEqual(player.maxAmmo, 2, 'maxAmmo must match blunderbuss 2-shot capacity');
      assert.strictEqual(player.ammo, 2, 'Initial ammo must be 2');
      assert.strictEqual(player.classId, 'demolitionist', 'Hero class must be demolitionist');

      // 2. Client changes weapon to needle_gun via C2S_LOADOUT_UPDATE
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOADOUT_UPDATE, {
        weaponId: 'needle_gun',
        classId: 'sharpshooter'
      }));

      // Allow tick/event dispatch
      await new Promise(r => setTimeout(r, 10));

      assert.strictEqual(player.weaponId, 'needle_gun', 'Weapon should update to needle_gun');
      assert.strictEqual(player.weapon.magazine, 30, 'Needle gun magazine must be 30');
      assert.strictEqual(player.maxAmmo, 30, 'maxAmmo must update to 30');
      assert.strictEqual(player.ammo, 30, 'Ammo should refresh to 30');
      assert.strictEqual(player.classId, 'sharpshooter', 'Hero class should update to sharpshooter');

      // 3. Start match and verify snapshot reflects needle_gun
      room.startMatch();
      const snapshot = player.toSnapshot();
      assert.strictEqual(snapshot.weaponId, 'needle_gun');
      assert.strictEqual(snapshot.maxAmmo, 30);
      assert.strictEqual(snapshot.ammo, 30);
      assert.strictEqual(snapshot.classId, 'sharpshooter');
      assert.ok(snapshot.weaponName, 'weaponName must be present');
    }
  },

  {
    id: 'T3.RC6',
    name: 'Password Protected Chamber: Rejects Missing/Incorrect Passwords, Admits Correct Code & Does Not Leak Secret',
    fn: async () => {
      const server = new GameServer();
      const hostPair = new MockWebSocketPair();
      server.handleConnection(hostPair.serverSide, { id: 'host_secret', playerName: 'LocksmithHost' });

      // 1. Host creates password protected room
      const waitHostState = hostPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      hostPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Vault_77',
        playerName: 'LocksmithHost',
        password: 'SteamSecret42'
      }));

      const hostState = await waitHostState;
      assert.ok(hostState, 'Host must receive S2C_LOBBY_STATE');
      assert.strictEqual(hostState.payload.isLocked, true, 'isLocked must be true');
      assert.strictEqual(hostState.payload.hasPassword, true, 'hasPassword must be true');
      assert.strictEqual(hostState.payload.password, undefined, 'Plaintext password must NEVER leak in lobby state payload');

      // 2. Active rooms browser must mark room as locked without leaking plaintext
      const activeRooms = server.getActiveRooms();
      const vaultRoomInfo = activeRooms.find(r => r.id === 'Sector_Vault_77');
      assert.ok(vaultRoomInfo, 'Vault room must appear in active rooms list');
      assert.strictEqual(vaultRoomInfo.isLocked, true);
      assert.strictEqual(vaultRoomInfo.hasPassword, true);
      assert.strictEqual(vaultRoomInfo.password, undefined, 'Plaintext password must NEVER leak in room list');

      // 3. Intruder joins without password -> Rejected with PASSWORD_REQUIRED
      const intruderPair1 = new MockWebSocketPair();
      server.handleConnection(intruderPair1.serverSide, { id: 'intruder_1', playerName: 'NoPassIntruder' });

      const waitError1 = intruderPair1.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR);
      intruderPair1.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
        roomId: 'Sector_Vault_77',
        playerName: 'NoPassIntruder'
      }));

      const err1 = await waitError1;
      assert.ok(err1, 'Should reject joining protected room without password');
      assert.strictEqual(err1.payload.code, 'PASSWORD_REQUIRED');

      // 4. Intruder joins with incorrect password -> Rejected with INVALID_PASSWORD
      const intruderPair2 = new MockWebSocketPair();
      server.handleConnection(intruderPair2.serverSide, { id: 'intruder_2', playerName: 'WrongPassIntruder' });

      const waitError2 = intruderPair2.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR);
      intruderPair2.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
        roomId: 'Sector_Vault_77',
        playerName: 'WrongPassIntruder',
        password: 'WrongPassword123'
      }));

      const err2 = await waitError2;
      assert.ok(err2, 'Should reject joining protected room with invalid password');
      assert.strictEqual(err2.payload.code, 'INVALID_PASSWORD');

      // Verify no intruder was added
      const vaultRoom = server.rooms.get('Sector_Vault_77');
      assert.strictEqual(vaultRoom.players.size, 1, 'Only host should remain in chamber');

      // 5. Friend joins with exact matching password -> Admitted!
      const friendPair = new MockWebSocketPair();
      server.handleConnection(friendPair.serverSide, { id: 'friend_client', playerName: 'SteamFriend' });

      const waitFriendState = friendPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      friendPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
        roomId: 'Sector_Vault_77',
        playerName: 'SteamFriend',
        password: 'SteamSecret42'
      }));

      const friendState = await waitFriendState;
      assert.ok(friendState, 'Friend must receive S2C_LOBBY_STATE upon entering with correct password');
      assert.strictEqual(friendState.payload.players.length, 2, 'Room must now contain both host and friend');
      assert.strictEqual(vaultRoom.players.size, 2);
    }
  },

  {
    id: 'T3.RC7',
    name: 'Recreating Abandoned Room in IN_PROGRESS Grace Period Succeeds Without MATCH_IN_PROGRESS Error',
    fn: async () => {
      const server = new GameServer();
      const pair1 = new MockWebSocketPair();
      server.handleConnection(pair1.serverSide, { id: 'host_abandon_1', playerName: 'OldHost' });

      // 1. OldHost creates Sector_Omega and starts match
      const waitCreate1 = pair1.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair1.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Omega',
        playerName: 'OldHost'
      }));
      await waitCreate1;

      const oldRoom = server.rooms.get('Sector_Omega');
      assert.ok(oldRoom);
      oldRoom.startMatch();
      assert.strictEqual(oldRoom.state, 'IN_PROGRESS');

      // 2. OldHost disconnects -> room enters 10s teardown grace period with 0 players
      pair1.clientSide.close();
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(oldRoom.players.size, 0, 'Room should have 0 active players after disconnect');

      // 3. NewHost immediately creates Sector_Omega during the grace period
      const pair2 = new MockWebSocketPair();
      server.handleConnection(pair2.serverSide, { id: 'host_new_2', playerName: 'NewHost' });

      const waitCreate2 = pair2.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair2.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sector_Omega',
        playerName: 'NewHost'
      }));

      const newState = await waitCreate2;
      assert.ok(newState, 'NewHost must receive S2C_LOBBY_STATE instead of MATCH_IN_PROGRESS error');
      assert.strictEqual(newState.payload.roomId, 'Sector_Omega');
      assert.strictEqual(newState.payload.hostId, 'host_new_2');
      const newRoom = server.rooms.get('Sector_Omega');
      assert.strictEqual(newRoom.state, 'LOBBY');
      newRoom.stopLoop();
      if (server.teardownTimers?.has('Sector_Omega')) {
        clearTimeout(server.teardownTimers.get('Sector_Omega'));
      }
    }
  },

  {
    id: 'T3.RC8',
    name: 'NetworkClient Dispatches Only C2S_LOBBY_CREATE Without Spurious C2S_LOBBY_JOIN on Socket Open',
    fn: async () => {
      const sentPackets = [];
      let socketInstance = null;
      const origWebSocket = globalThis.WebSocket;

      class FakeSocket {
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          socketInstance = this;
        }
        send(raw) {
          sentPackets.push(deserializePacket(raw));
        }
        close() {
          this.readyState = 3;
        }
      }

      globalThis.WebSocket = FakeSocket;
      try {
        const client = new NetworkClient({
          url: 'ws://localhost:3999',
          autoReconnect: false
        });

        // Register an open listener (exactly as LobbyUI.handleCreateRoom does when socket is not yet open)
        client.on('open', () => {
          client.createLobby({
            roomId: 'Sector_Protected',
            playerName: 'VaultCreator',
            password: 'MySecretPassword',
            fillWithBots: true,
            botDifficulty: 'hard'
          });
        });

        client.connect();
        socketInstance.readyState = 1;
        socketInstance.onopen();

        if (client.pingInterval) clearInterval(client.pingInterval);

        const lobbyPackets = sentPackets.filter(
          p => p && (p.type === PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE || p.type === PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN)
        );
        assert.strictEqual(lobbyPackets.length, 1, 'Must send exactly 1 lobby packet (C2S_LOBBY_CREATE) and no spurious C2S_LOBBY_JOIN');
        assert.strictEqual(lobbyPackets[0].type, PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE);
        assert.strictEqual(lobbyPackets[0].payload.password, 'MySecretPassword');
        assert.strictEqual(lobbyPackets[0].payload.fillWithBots, true);
        assert.strictEqual(lobbyPackets[0].payload.botDifficulty, 'hard');
      } finally {
        globalThis.WebSocket = origWebSocket;
      }
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
