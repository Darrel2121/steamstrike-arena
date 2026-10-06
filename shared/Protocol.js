/**
 * Steampunk Tactical Multiplayer Protocol Definitions & Serializer
 * Defines standard client-to-server (C2S) and server-to-client (S2C) packet contracts.
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
  C2S_LEAVE_ROOM: 'LEAVE_ROOM',

  // Server to Client
  S2C_LOBBY_STATE: 'LOBBY_STATE',
  S2C_MATCH_INIT: 'MATCH_INIT',
  S2C_WORLD_SNAPSHOT: 'WORLD_SNAPSHOT',
  S2C_DAMAGE_EVENT: 'DAMAGE_EVENT',
  S2C_ELIMINATION_EVENT: 'ELIMINATION_EVENT',
  S2C_RESPAWN_EVENT: 'RESPAWN_EVENT',
  S2C_MATCH_OVER: 'MATCH_OVER',
  S2C_PONG: 'PONG',
  S2C_ROOMS_LIST: 'ROOMS_LIST',
  S2C_ERROR: 'ERROR'
};

/**
 * Serializes a typed payload into a standardized JSON packet string.
 * @param {string} type - Protocol message type from PROTOCOL_MSG_TYPES
 * @param {Object} [payload={}] - Message payload
 * @returns {string} JSON formatted string
 */
export function serializePacket(type, payload = {}) {
  return JSON.stringify({
    type,
    payload: payload || {}
  });
}

/**
 * Safely parses raw incoming packet data into a typed message object.
 * @param {string|Buffer|Object} raw - Serialized JSON string, Buffer, or object
 * @returns {{ type: string, payload: Object } | null}
 */
export function deserializePacket(raw) {
  if (!raw) return null;

  if (typeof raw === 'object' && !(raw instanceof Buffer)) {
    if (raw.type && typeof raw.type === 'string') {
      return {
        type: raw.type,
        payload: raw.payload ?? {}
      };
    }
  }

  try {
    const str = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = JSON.parse(str);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return {
      type: parsed.type,
      payload: parsed.payload ?? {}
    };
  } catch (_) {
    return null;
  }
}
