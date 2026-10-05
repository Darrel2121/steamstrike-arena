/**
 * Tier 3: Player Identity & Steampunk Heraldic Emblems Integration Tests
 * Validates the heraldic emblems system, callsign mutations, default profiles,
 * snapshot propagation, and real-time lobby state updates.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import {
  STEAMPUNK_EMBLEMS,
  STEAMPUNK_EMBLEMS_MAP,
  DEFAULT_EMBLEM_ID,
  getEmblemDefinition,
  createDefaultProfile
} from '../../shared/ProgressionSchema.js';
import { ProfileStore } from '../../server/db/ProfileStore.js';
import { Room } from '../../server/Room.js';
import { Player } from '../../server/entities/Player.js';
import { GameServer } from '../../server/GameServer.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';
import { serializePacket } from '../../shared/Protocol.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';

export const suiteName = 'Tier 3: Player Identity & Heraldic Emblems';

export const tests = [
  {
    id: 'T3.EM1',
    name: 'Steampunk Heraldic Emblems Registry: 12 Emblems Defined with Valid Attributes and Fallback',
    fn: async () => {
      assert.strictEqual(Array.isArray(STEAMPUNK_EMBLEMS), true, 'STEAMPUNK_EMBLEMS must be an array');
      assert.strictEqual(STEAMPUNK_EMBLEMS.length, 12, 'Must provide exactly 12 heraldic steampunk emblems');

      const expectedIds = [
        'gear', 'falcon', 'wolf', 'fox', 'lightning', 'shield',
        'anchor', 'skull', 'dragon', 'flame', 'key', 'crown'
      ];

      for (const id of expectedIds) {
        const item = STEAMPUNK_EMBLEMS_MAP[id];
        assert.ok(item, `Emblem map must contain entry for "${id}"`);
        assert.strictEqual(item.id, id);
        assert.ok(item.icon && typeof item.icon === 'string', `Emblem "${id}" must have an icon string`);
        assert.ok(item.name && typeof item.name === 'string', `Emblem "${id}" must have a Ukrainian title`);
        assert.ok(item.motto && typeof item.motto === 'string', `Emblem "${id}" must have an evocative motto`);
        assert.ok(item.color && typeof item.color === 'string', `Emblem "${id}" must have a hex color`);
      }

      // Check fallback behavior
      const defaultEmblem = getEmblemDefinition();
      assert.strictEqual(defaultEmblem.id, DEFAULT_EMBLEM_ID);
      assert.strictEqual(defaultEmblem.id, 'gear');

      const unknownEmblem = getEmblemDefinition('invalid_emblem_xyz');
      assert.strictEqual(unknownEmblem.id, 'gear', 'Unknown emblem must safely fall back to gear');

      const falcon = getEmblemDefinition('falcon');
      assert.strictEqual(falcon.icon, '🦅');
      assert.strictEqual(falcon.name, 'Латунний Сокіл');
    }
  },

  {
    id: 'T3.EM2',
    name: 'Default Profile Generation Initializes Default Heraldic Emblem',
    fn: async () => {
      const defaultProfile = createDefaultProfile();
      assert.strictEqual(defaultProfile.emblem, 'gear', 'Default profile must have emblem initialized to gear');

      const customEmblemProfile = createDefaultProfile({ emblem: 'wolf' });
      assert.strictEqual(customEmblemProfile.emblem, 'wolf', 'Custom emblem must be preserved in profile initialization');
    }
  },

  {
    id: 'T3.EM3',
    name: 'ProfileStore updateIdentity Atomically Mutates Callsign and Emblem',
    fn: async () => {
      const store = new ProfileStore({ memoryOnly: true });
      const testId = 'prof_identity_test_' + Date.now();

      // Initial update
      const res1 = await store.updateIdentity(testId, {
        username: 'ЗалізнийВовк_77',
        emblem: 'wolf'
      });

      assert.strictEqual(res1.ok, true);
      assert.strictEqual(res1.username, 'ЗалізнийВовк_77');
      assert.strictEqual(res1.emblem, 'wolf');

      // Subsequent query
      const profile = await store.getProfile(testId);
      assert.strictEqual(profile.username, 'ЗалізнийВовк_77');
      assert.strictEqual(profile.emblem, 'wolf');

      // Partial update (only emblem)
      const res2 = await store.updateIdentity(testId, {
        emblem: 'dragon'
      });
      assert.strictEqual(res2.ok, true);
      assert.strictEqual(res2.username, 'ЗалізнийВовк_77', 'Callsign should remain intact on partial update');
      assert.strictEqual(res2.emblem, 'dragon', 'Emblem should be updated to dragon');
    }
  },

  {
    id: 'T3.EM4',
    name: 'Room and Player Kinematic Snapshots Carry Emblem and ClassId',
    fn: async () => {
      const room = new Room({
        id: 'chamber_emblem_test',
        map: canonicalFoundryMap,
        maxPlayers: 4
      });

      const player = room.addPlayer('p_emblem_1', 'ЕфірнийСокіл_1', null, {
        id: 'p_emblem_1',
        emblem: 'falcon',
        equippedClass: 'sharpshooter'
      });

      assert.strictEqual(player.emblem, 'falcon', 'Player instance must store emblem');
      assert.strictEqual(player.classId, 'sharpshooter', 'Player instance must store equipped class');

      // World snapshot
      const snapshot = player.toSnapshot();
      assert.strictEqual(snapshot.emblem, 'falcon', 'Player snapshot must serialize emblem');
      assert.strictEqual(snapshot.classId, 'sharpshooter', 'Player snapshot must serialize classId');

      // Lobby state
      const lobbyState = room.getLobbyStatePayload();
      const pData = lobbyState.players.find(p => p.id === 'p_emblem_1');
      assert.ok(pData, 'Player must be present in lobby state');
      assert.strictEqual(pData.emblem, 'falcon', 'Lobby state must include player emblem');
    }
  },

  {
    id: 'T3.EM5',
    name: 'Multiplayer Lobby Broadcasts Real-Time Identity Updates to Connected Sockets',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, {
        id: 'client_emblem_user',
        playerName: 'МіднийЛис_42',
        profile: {
          id: 'client_emblem_user',
          emblem: 'fox',
          equippedClass: 'infiltrator'
        }
      });

      const waitLobby = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Chamber_FoxHole',
        playerName: 'МіднийЛис_42',
        mapName: 'The Clockwork Foundry',
        maxPlayers: 4,
        map: canonicalFoundryMap
      }));

      const state1 = await waitLobby;
      assert.ok(state1, 'Client must receive S2C_LOBBY_STATE');
      const playerEntry = state1.payload.players[0];
      assert.strictEqual(playerEntry.name, 'МіднийЛис_42');
      assert.strictEqual(playerEntry.emblem, 'fox', 'Lobby payload must include fox emblem');

      // Live update identity in chamber
      const room = server.rooms.get('Chamber_FoxHole');
      assert.ok(room, 'Room must exist on server');

      const waitUpdate = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      const roomPlayer = room.players.get('client_emblem_user');
      roomPlayer.name = 'КоролівськийХронометр_99';
      roomPlayer.emblem = 'crown';
      room.broadcastLobbyState();

      const state2 = await waitUpdate;
      const updatedPlayerEntry = state2.payload.players[0];
      assert.strictEqual(updatedPlayerEntry.name, 'КоролівськийХронометр_99');
      assert.strictEqual(updatedPlayerEntry.emblem, 'crown', 'Updated emblem must be broadcast to client');
    }
  }
];

export async function run() {
  return await runSuiteHelper(suiteName, tests);
}
