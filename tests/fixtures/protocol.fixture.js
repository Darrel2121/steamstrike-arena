/**
 * Canonical Protocol Packet Fixtures for Steampunk Tactical Shooter
 * Defines valid client-to-server (C2S) and server-to-client (S2C) message contracts,
 * along with edge-case and invalid message schemas.
 */

export const PROTOCOL_MSG_TYPES = {
  // Client to Server
  C2S_LOBBY_CREATE: 'LOBBY_CREATE',
  C2S_LOBBY_JOIN: 'LOBBY_JOIN',
  C2S_LOBBY_READY: 'LOBBY_READY',
  C2S_MATCH_START: 'MATCH_START',
  C2S_PLAYER_INPUT: 'PLAYER_INPUT',
  C2S_PING: 'PING',
  C2S_ROOMS_LIST: 'ROOMS_LIST',
  C2S_CHANGE_GAME_MODE: 'CHANGE_GAME_MODE',
  C2S_CHANGE_TEAM: 'CHANGE_TEAM',
  C2S_LOADOUT_UPDATE: 'LOADOUT_UPDATE',

  // Server to Client
  S2C_LOBBY_STATE: 'LOBBY_STATE',
  S2C_MATCH_INIT: 'MATCH_INIT',
  S2C_WORLD_SNAPSHOT: 'WORLD_SNAPSHOT',
  S2C_DAMAGE_EVENT: 'DAMAGE_EVENT',
  S2C_ELIMINATION_EVENT: 'ELIMINATION_EVENT',
  S2C_MATCH_OVER: 'MATCH_OVER',
  S2C_PONG: 'PONG',
  S2C_ROOMS_LIST: 'ROOMS_LIST',
  S2C_ERROR: 'ERROR'
};

export const validPackets = {
  // C2S Messages
  lobbyCreate: {
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE,
    payload: {
      mapName: 'The Clockwork Foundry',
      maxPlayers: 4
    }
  },
  lobbyJoin: {
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
    payload: {
      roomId: 'room_101',
      playerName: 'AetherGunner'
    }
  },
  lobbyReady: {
    type: PROTOCOL_MSG_TYPES.C2S_LOBBY_READY,
    payload: {
      ready: true
    }
  },
  matchStart: {
    type: PROTOCOL_MSG_TYPES.C2S_MATCH_START,
    payload: {}
  },
  playerInputMove: {
    type: PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT,
    payload: {
      moveX: 1,
      moveY: 0,
      sprint: false,
      aimAngle: 0.785, // 45 deg
      firing: false,
      reload: false,
      dt: 16
    }
  },
  playerInputSprint: {
    type: PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT,
    payload: {
      moveX: 0,
      moveY: 1,
      sprint: true,
      aimAngle: 1.57,
      firing: false,
      reload: false,
      dt: 16
    }
  },
  playerInputFire: {
    type: PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT,
    payload: {
      moveX: 0,
      moveY: 0,
      sprint: false,
      aimAngle: 3.1415,
      firing: true,
      reload: false,
      dt: 16
    }
  },
  ping: {
    type: PROTOCOL_MSG_TYPES.C2S_PING,
    payload: {
      timestamp: 1728000000000
    }
  },

  // S2C Messages
  lobbyState: {
    type: PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE,
    payload: {
      roomId: 'room_101',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'AetherGunner', ready: true, isHost: true },
        { id: 'p2', name: 'ClockworkRanger', ready: false, isHost: false }
      ],
      maxPlayers: 4,
      mapName: 'The Clockwork Foundry'
    }
  },
  matchInit: {
    type: PROTOCOL_MSG_TYPES.S2C_MATCH_INIT,
    payload: {
      playerId: 'p1',
      roomId: 'room_101',
      mapWidth: 800,
      mapHeight: 800,
      spawn: { x: 80, y: 80, angle: 0 },
      tickRate: 30
    }
  },
  worldSnapshot: {
    type: PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT,
    payload: {
      tick: 42,
      timestamp: 1728000001400,
      players: [
        { id: 'p1', x: 120, y: 150, angle: 0.78, hp: 100, ammo: 6, isAlive: true },
        { id: 'bot_1', x: 300, y: 400, angle: 3.14, hp: 100, ammo: 6, isAlive: true }
      ],
      projectiles: [
        { id: 'proj_1', x: 150, y: 180, vx: 530, vy: 530 }
      ],
      soundEvents: [
        { id: 'snd_1', x: 120, y: 150, type: 'footstep', radius: 45, maxRadius: 90, intensity: 0.8 }
      ]
    }
  },
  damageEvent: {
    type: PROTOCOL_MSG_TYPES.S2C_DAMAGE_EVENT,
    payload: {
      targetId: 'p1',
      attackerId: 'bot_1',
      damage: 35,
      remainingHp: 65
    }
  },
  eliminationEvent: {
    type: PROTOCOL_MSG_TYPES.S2C_ELIMINATION_EVENT,
    payload: {
      victimId: 'p1',
      killerId: 'bot_1'
    }
  },
  matchOver: {
    type: PROTOCOL_MSG_TYPES.S2C_MATCH_OVER,
    payload: {
      winnerId: 'bot_1',
      durationSeconds: 78.4,
      stats: {
        totalKills: 3,
        shotsFired: 28
      }
    }
  },
  pong: {
    type: PROTOCOL_MSG_TYPES.S2C_PONG,
    payload: {
      clientTimestamp: 1728000000000,
      serverTimestamp: 1728000000005
    }
  },
  errorPacket: {
    type: PROTOCOL_MSG_TYPES.S2C_ERROR,
    payload: {
      code: 'LOBBY_FULL',
      message: 'Room has reached maximum player capacity'
    }
  }
};

export const malformedPackets = {
  missingType: {
    payload: { moveX: 1, moveY: 0 }
  },
  nullPayload: {
    type: PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT,
    payload: null
  },
  unknownAction: {
    type: 'CHEAT_NOCLIP_GODMODE',
    payload: {}
  },
  speedHackMovement: {
    type: PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT,
    payload: {
      moveX: 500, // Excessive teleport displacement in 16ms
      moveY: 0,
      dt: 16
    }
  }
};
