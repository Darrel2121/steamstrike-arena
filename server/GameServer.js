/**
 * GameServer Connection & Lobby Manager
 * Manages WebSocket client connections, rooms, lobby joins, heartbeats, and packet routing.
 */

import { Room } from './Room.js';
import { getPresetMap } from '../shared/MapSchema.js';
import { PROTOCOL_MSG_TYPES, serializePacket, deserializePacket } from '../shared/Protocol.js';

export class GameServer {
  /**
   * @param {Object} [options]
   */
  constructor(options = {}) {
    this.options = options;
    this.rooms = new Map();

    // Initialize canonical default room
    this.createRoom('default', { maxPlayers: 4 });
  }

  /**
   * Returns a sanitized list of active public/multiplayer chambers.
   * Excludes solo bot matches.
   * @returns {Array<{ id: string, mapName: string, playerCount: number, maxPlayers: number, state: string }>}
   */
  getActiveRooms() {
    const list = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (roomId.startsWith('solo_')) continue;
      list.push({
        id: room.id,
        mapName: room.map?.name || 'The Clockwork Foundry',
        playerCount: room.players ? room.players.size : 0,
        maxPlayers: room.maxPlayers || 4,
        gameMode: room.gameMode || 'solo_elim',
        targetKills: room.targetKills || 0,
        state: room.state || 'LOBBY'
      });
    }
    return list;
  }

  /**
   * Creates a new match room or retrieves an existing one.
   * @param {string} roomId
   * @param {Object} [options]
   * @returns {Room}
   */
  createRoom(roomId, options = {}) {
    if (this.rooms.has(roomId)) {
      const existing = this.rooms.get(roomId);
      if (options.map && existing.state === 'LOBBY' && (!existing.players || existing.players.size === 0)) {
        existing.map = options.map;
        existing.compileGeometry();
        existing.initPickups();
      }
      if (options.gameMode && existing.state === 'LOBBY') {
        existing.setGameMode(options.gameMode, options.targetKills);
      }
      return existing;
    }
    const room = new Room({
      id: roomId,
      map: options.map,
      maxPlayers: options.maxPlayers || 4,
      tickRate: options.tickRate || 30,
      autoTick: options.autoTick ?? false,
      gameMode: options.gameMode,
      targetKills: options.targetKills
    });
    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * Attaches connection event listeners for a connected WebSocket.
   * @param {Object} socket - WebSocket or MockWebSocket
   * @param {Object} [meta] - Connection metadata
   */
  handleConnection(socket, meta = {}) {
    socket.meta = meta;
    socket.profile = meta.profile;
    const clientId = meta.id || (`client_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);
    let currentRoom = null;

    const cleanupEmptyRoom = (room) => {
      if (room && room.id !== 'default' && room.players.size === 0) {
        room.stopLoop();
        this.rooms.delete(room.id);
      }
    };

    const onMessage = (raw) => {
      const packet = deserializePacket(raw);
      if (!packet) return;

      const { type, payload } = packet;

      switch (type) {
        case PROTOCOL_MSG_TYPES.C2S_PING: {
          const clientTimestamp = payload?.timestamp || Date.now();
          const pongPayload = {
            clientTimestamp,
            serverTimestamp: Date.now()
          };
          if (socket.readyState === 1) {
            socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_PONG, pongPayload));
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_ROOMS_LIST: {
          if (socket.readyState === 1) {
            socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_ROOMS_LIST, {
              rooms: this.getActiveRooms()
            }));
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN: {
          const roomId = payload?.roomId || 'default';
          const playerName = payload?.playerName || meta.playerName || `Mechanic_${clientId.slice(-4)}`;

          let room = this.rooms.get(roomId);
          if (!room) {
            room = this.createRoom(roomId, { autoTick: true });
          }

          // Capacity check
          if (room.players.size >= room.maxPlayers) {
            if (socket.readyState === 1) {
              socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_ERROR, {
                code: 'LOBBY_FULL',
                message: 'Парова кімната вже заповнена'
              }));
            }
            return;
          }

          // Match in progress check
          if (room.state === 'IN_PROGRESS') {
            if (socket.readyState === 1) {
              socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_ERROR, {
                code: 'MATCH_IN_PROGRESS',
                message: 'У цій паровій кімнаті вже йде бій'
              }));
            }
            return;
          }

          // Leave existing room if switching
          if (currentRoom && currentRoom !== room) {
            currentRoom.removePlayer(clientId);
            cleanupEmptyRoom(currentRoom);
          }

          const playerProfile = payload?.profile || socket.profile || meta.profile || null;
          const equippedWeapon = payload?.equippedWeapon || playerProfile?.equippedWeapon || 'revolver';
          const equippedClass = payload?.equippedClass || playerProfile?.equippedClass || 'vanguard';
          if (!socket.profile) {
            socket.profile = playerProfile ? { ...playerProfile } : { id: clientId, isGuest: true };
          }
          socket.profile.equippedWeapon = equippedWeapon;
          socket.profile.equippedClass = equippedClass;
          if (payload?.profile?.weapons) {
            socket.profile.weapons = payload.profile.weapons;
          }
          if (payload?.profile?.characterStats) {
            socket.profile.characterStats = payload.profile.characterStats;
          }

          currentRoom = room;
          room.addPlayer(clientId, playerName, socket, socket.profile);
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE: {
          const roomId = payload?.roomId || (`room_${Date.now().toString(36)}`);
          let room = this.rooms.get(roomId);

          if (room) {
            const isClientHost = room.players.get(clientId)?.isHost;
            const hasOtherHost = Array.from(room.players.values()).some(p => p.isHost && p.id !== clientId);

            if (hasOtherHost && !isClientHost && room.players.size > 0) {
              if (socket.readyState === 1) {
                socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_ERROR, {
                  code: 'ROOM_EXISTS',
                  message: `Парова кімната "${roomId}" вже створена іншим гравцем. Введіть іншу назву або приєднайтеся.`
                }));
              }
              return;
            }

            if (room.players.size >= room.maxPlayers && !room.players.has(clientId)) {
              if (socket.readyState === 1) {
                socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_ERROR, {
                  code: 'LOBBY_FULL',
                  message: 'Парова кімната вже заповнена'
                }));
              }
              return;
            }
            if (room.state === 'IN_PROGRESS') {
              if (socket.readyState === 1) {
                socket.send(serializePacket(PROTOCOL_MSG_TYPES.S2C_ERROR, {
                  code: 'MATCH_IN_PROGRESS',
                  message: 'У цій паровій кімнаті вже йде бій'
                }));
              }
              return;
            }

            // Update room config with payload if host or empty
            if (payload?.map || payload?.mapName) {
              const resolved = typeof payload.map === 'string' ? getPresetMap(payload.map) : (payload.map || (payload.mapName ? getPresetMap(payload.mapName) : null));
              if (resolved) {
                room.map = resolved;
                room.compileGeometry();
                room.initPickups();
              }
            }
            if (payload?.gameMode) {
              room.setGameMode(payload.gameMode, payload.targetKills);
            }
            if (payload?.maxPlayers) {
              room.maxPlayers = payload.maxPlayers;
            }
          } else {
            room = this.createRoom(roomId, {
              map: payload?.map,
              mapName: payload?.mapName,
              maxPlayers: payload?.maxPlayers || 4,
              gameMode: payload?.gameMode,
              targetKills: payload?.targetKills,
              autoFillBots: payload?.autoFillBots ?? false,
              autoTick: true
            });
          }

          if (currentRoom && currentRoom !== room) {
            currentRoom.removePlayer(clientId);
            cleanupEmptyRoom(currentRoom);
          }

          const playerProfile = payload?.profile || socket.profile || meta.profile || null;
          const equippedWeapon = payload?.equippedWeapon || playerProfile?.equippedWeapon || 'revolver';
          const equippedClass = payload?.equippedClass || playerProfile?.equippedClass || 'vanguard';
          if (!socket.profile) {
            socket.profile = playerProfile ? { ...playerProfile } : { id: clientId, isGuest: true };
          }
          socket.profile.equippedWeapon = equippedWeapon;
          socket.profile.equippedClass = equippedClass;
          if (payload?.profile?.weapons) {
            socket.profile.weapons = payload.profile.weapons;
          }
          if (payload?.profile?.characterStats) {
            socket.profile.characterStats = payload.profile.characterStats;
          }

          currentRoom = room;
          const playerName = payload?.playerName || `Host_${clientId.slice(-4)}`;
          room.addPlayer(clientId, playerName, socket, socket.profile);
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_LOADOUT_UPDATE: {
          if (payload) {
            if (!socket.profile) socket.profile = {};
            if (payload.weaponId) socket.profile.equippedWeapon = payload.weaponId;
            if (payload.classId) socket.profile.equippedClass = payload.classId;
            if (payload.profile) {
              socket.profile = { ...socket.profile, ...payload.profile };
            }
            if (currentRoom) {
              currentRoom.updatePlayerLoadout(clientId, {
                weaponId: payload.weaponId,
                classId: payload.classId,
                profile: socket.profile
              });
            }
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_CHANGE_GAME_MODE: {
          if (currentRoom) {
            const player = currentRoom.players.get(clientId);
            if (player && player.isHost) {
              currentRoom.setGameMode(payload?.gameMode, payload?.targetKills);
            }
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_CHANGE_TEAM: {
          if (currentRoom) {
            currentRoom.setPlayerTeam(clientId, payload?.team);
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_LOBBY_READY: {
          if (currentRoom) {
            const player = currentRoom.players.get(clientId);
            if (player) {
              player.ready = payload?.ready !== undefined ? !!payload.ready : !player.ready;
              currentRoom.broadcastLobbyState();
            }
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_MATCH_START: {
          if (currentRoom) {
            currentRoom.startMatch({ fillBots: payload?.fillBots });
          }
          break;
        }

        case PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT: {
          if (currentRoom && payload) {
            currentRoom.handlePlayerInput(clientId, payload);
          }
          break;
        }

        default:
          break;
      }
    };

    const onClose = () => {
      if (currentRoom) {
        currentRoom.removePlayer(clientId);
        cleanupEmptyRoom(currentRoom);
        currentRoom = null;
      }
    };

    const onError = () => {
      if (currentRoom) {
        currentRoom.removePlayer(clientId);
        cleanupEmptyRoom(currentRoom);
        currentRoom = null;
      }
    };

    if (typeof socket.on === 'function') {
      socket.on('message', onMessage);
      socket.on('close', onClose);
      socket.on('error', onError);
    }
  }
}

export default GameServer;
