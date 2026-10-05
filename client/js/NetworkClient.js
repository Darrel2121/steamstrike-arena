/**
 * Steampunk Tactical Multiplayer Network Client
 * Handles real-time WebSocket communication, client-side movement prediction,
 * server reconciliation, remote entity interpolation, and keepalive pings.
 */

import { PROTOCOL_MSG_TYPES, serializePacket, deserializePacket } from '../../shared/Protocol.js';
import { WEAPON_DEFINITIONS } from '../../shared/ProgressionSchema.js';

/**
 * Tests if a 2D circle intersects a line segment.
 * Matches server/physics/Geometry.js circleSegmentIntersect.
 */
function circleSegmentIntersect(center, radius, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = center.x - a.x;
  const apy = center.y - a.y;

  const segLengthSq = abx * abx + aby * aby;
  if (segLengthSq === 0) {
    return Math.hypot(center.x - a.x, center.y - a.y) <= radius;
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / segLengthSq));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;

  const distSq = (center.x - closestX) ** 2 + (center.y - closestY) ** 2;
  return distSq <= radius * radius;
}

export class NetworkClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.url]
   * @param {boolean} [options.autoReconnect=true]
   */
  constructor(options = {}) {
    this.url = options.url || null;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 8000;
    this.reconnectTimer = null;

    this.socket = null;
    this.isConnected = false;
    this.playerId = null;
    this.roomId = null;
    this.latency = 0;

    // Client-side prediction and sequence tracking
    this.sequenceNumber = 0;
    this.pendingInputs = [];
    this.predictedX = 0;
    this.predictedY = 0;
    this.predictedAngle = 0;
    this.predictedStamina = 100;
    this.gameMode = 'solo_elim';
    this.targetKills = 0;
    this.team = null;
    this.visualErrorX = 0;
    this.visualErrorY = 0;
    this.lastErrorDecayTime = 0;
    this.isPredictionInitialized = false;

    // Elimination and authoritative respawn countdown tracking
    this.isLocallyDead = false;
    this.clientRespawnTimer = 0;

    // Kinematic configuration matching server Room.js
    this.playerSpeed = 180; // pixels per second
    this.sprintMultiplier = 1.5;
    this.collisionRadius = 14; // pixels
    this.mapWidth = 800;
    this.mapHeight = 800;
    this.geometrySegments = [];

    // Snapshot buffer for remote entity interpolation
    this.snapshotBuffer = [];
    this.maxSnapshotBufferSize = 30;
    this.interpolationDelayMs = 60; // 2 ticks at 30Hz

    // Loadout configuration
    this.equippedWeapon = 'revolver';
    this.equippedClass = 'vanguard';
    this.cachedProfile = null;

    // Event listeners
    this.listeners = new Map();

    // Heartbeat ping timer
    this.pingInterval = null;
  }

  /**
   * Helper indicating if the underlying WebSocket is open and ready to transmit.
   * @returns {boolean}
   */
  get isSocketReady() {
    return Boolean(this.socket && this.socket.readyState === 1);
  }

  /**
   * Connects to the WebSocket server.
   * @param {string} [customUrl]
   * @param {string} [token]
   */
  connect(customUrl, token = null) {
    if (customUrl) this.url = customUrl;

    if (!this.url && typeof window !== 'undefined' && window.location) {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!isLocal) {
        this.url = 'wss://steamstrike-server.onrender.com';
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        this.url = `${protocol}//${host}`;
      }
    }

    if (!this.url) {
      this.url = 'ws://localhost:3000';
    }

    if (!token && typeof localStorage !== 'undefined') {
      try {
        token = localStorage.getItem('clockwork_auth_token_v1');
      } catch (_) {}
    }

    if (token && !this.url.includes('token=')) {
      const separator = this.url.includes('?') ? '&' : '?';
      this.url = `${this.url}${separator}token=${encodeURIComponent(token)}`;
    }

    // If socket is already open or currently connecting, do not re-create
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) {
      if (this.socket.readyState === 1) {
        this.isConnected = true;
        this.emit('open');
      }
      return;
    }

    try {
      this.socket = new WebSocket(this.url);
      this.setupSocketEvents();
    } catch (err) {
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  setupSocketEvents() {
    if (!this.socket) return;

    this.socket.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('open');
      this.startPingHeartbeat();
    };

    this.socket.onmessage = (event) => {
      const packet = deserializePacket(event.data);
      if (!packet) return;
      this.handlePacket(packet);
    };

    this.socket.onclose = (event) => {
      this.isConnected = false;
      this.stopPingHeartbeat();
      this.emit('close', event);
      if (this.autoReconnect && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (err) => {
      this.emit('error', err);
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startPingHeartbeat() {
    this.stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 2500);
  }

  stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Dispatches incoming server packets to subscribers and internal state.
   * @param {{ type: string, payload: Object }} packet
   */
  handlePacket(packet) {
    const { type, payload } = packet;

    switch (type) {
      case PROTOCOL_MSG_TYPES.S2C_PONG: {
        if (payload && payload.clientTimestamp) {
          this.latency = Math.max(0, Date.now() - payload.clientTimestamp);
        }
        this.emit('pong', { latency: this.latency, serverTimestamp: payload?.serverTimestamp });
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE: {
        if (payload?.yourPlayerId) {
          this.playerId = payload.yourPlayerId;
        }
        if (payload?.roomId) {
          this.roomId = payload.roomId;
        }
        this.emit('lobbyState', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_MATCH_INIT: {
        if (payload?.playerId) this.playerId = payload.playerId;
        if (payload?.roomId) this.roomId = payload.roomId;
        if (payload?.gameMode) this.gameMode = payload.gameMode;
        if (typeof payload?.targetKills === 'number') this.targetKills = payload.targetKills;
        if (payload?.team) this.team = payload.team;
        this.predictedStamina = 100;
        if (typeof payload?.maxSpeed === 'number') this.playerSpeed = payload.maxSpeed;
        if (typeof payload?.sprintMultiplier === 'number') this.sprintMultiplier = payload.sprintMultiplier;
        if (payload?.spawn) {
          this.predictedX = payload.spawn.x;
          this.predictedY = payload.spawn.y;
          this.predictedAngle = payload.spawn.angle || 0;
          this.visualErrorX = 0;
          this.visualErrorY = 0;
          this.lastErrorDecayTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          this.isPredictionInitialized = true;
        }
        if (payload?.mapWidth) this.mapWidth = payload.mapWidth;
        if (payload?.mapHeight) this.mapHeight = payload.mapHeight;
        this.snapshotBuffer = [];
        this.pendingInputs = [];
        this.emit('matchInit', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT: {
        this.handleWorldSnapshot(payload);
        this.emit('snapshot', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_DAMAGE_EVENT: {
        this.emit('damage', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_ELIMINATION_EVENT: {
        if (payload?.victimId === this.playerId) {
          this.isLocallyDead = true;
          this.clientRespawnTimer = (typeof payload?.respawnTimer === 'number' && payload.respawnTimer > 0)
            ? payload.respawnTimer
            : 0;
        }
        this.emit('elimination', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_RESPAWN_EVENT: {
        if (payload?.entityId === this.playerId) {
          this.isLocallyDead = false;
          this.clientRespawnTimer = 0;
          this.predictedX = payload.x;
          this.predictedY = payload.y;
          this.predictedAngle = payload.angle || 0;
          this.visualErrorX = 0;
          this.visualErrorY = 0;
          this.predictedStamina = 100;
          this.pendingInputs = [];
        }
        this.emit('respawn', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_MATCH_OVER: {
        this.emit('matchOver', payload);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_ROOMS_LIST: {
        this.emit('roomsList', payload?.rooms || []);
        break;
      }

      case PROTOCOL_MSG_TYPES.S2C_ERROR: {
        this.emit('errorPacket', payload);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Buffers world snapshots for interpolation and executes local reconciliation.
   * @param {Object} snapshot
   */
  handleWorldSnapshot(snapshot) {
    if (!snapshot) return;

    this.snapshotBuffer.push({
      receivedAt: Date.now(),
      data: snapshot
    });

    if (this.snapshotBuffer.length > this.maxSnapshotBufferSize) {
      this.snapshotBuffer.shift();
    }

    // Reconcile local player position and status if present in snapshot
    if (this.playerId && Array.isArray(snapshot.players)) {
      const serverPlayer = snapshot.players.find(p => p.id === this.playerId);
      if (serverPlayer) {
        if (serverPlayer.isAlive && (serverPlayer.hp === undefined || serverPlayer.hp > 0)) {
          this.isLocallyDead = false;
          this.clientRespawnTimer = 0;
        } else if (typeof serverPlayer.respawnTimer === 'number' && serverPlayer.respawnTimer > 0) {
          this.clientRespawnTimer = serverPlayer.respawnTimer;
        }
        this.reconcile(serverPlayer, snapshot.tick, snapshot.timestamp);
      }
    }
  }

  /**
   * Applies movement with wall sliding against pre-compiled line segments and arena bounds.
   * Identical to Room.moveWithSliding.
   */
  applyMovementWithSliding(currX, currY, dx, dy, radius = 14) {
    let targetX = currX + dx;
    let targetY = currY + dy;

    const checkCollision = (cx, cy) => {
      if (!this.geometrySegments || this.geometrySegments.length === 0) return false;
      const center = { x: cx, y: cy };
      for (let i = 0; i < this.geometrySegments.length; i++) {
        const seg = this.geometrySegments[i];
        const p1 = seg.p1 || seg.a;
        const p2 = seg.p2 || seg.b;
        if (circleSegmentIntersect(center, radius, p1, p2)) {
          return true;
        }
      }
      return false;
    };

    // 1. Try full diagonal step
    if (!checkCollision(targetX, targetY)) {
      currX = targetX;
      currY = targetY;
    } else {
      // 2. Try horizontal sliding
      if (Math.abs(dx) > 0.0001 && !checkCollision(targetX, currY)) {
        currX = targetX;
      }
      // 3. Try vertical sliding
      if (Math.abs(dy) > 0.0001 && !checkCollision(currX, targetY)) {
        currY = targetY;
      }
    }

    // 4. Clamp inside arena boundary
    currX = Math.max(radius, Math.min(this.mapWidth - radius, currX));
    currY = Math.max(radius, Math.min(this.mapHeight - radius, currY));

    return { x: currX, y: currY };
  }

  /**
   * Calculates a single kinematic movement step for a given input.
   */
  calculateStep(startX, startY, input) {
    const dtSec = (input.dt > 0 ? input.dt : 16.67) / 1000;
    let moveX = input.moveX || 0;
    let moveY = input.moveY || 0;
    const mag = Math.hypot(moveX, moveY);

    if (mag === 0) {
      return { x: startX, y: startY };
    }

    // Normalize if diagonal exceeds 1.0 (anticheat fidelity)
    if (mag > 1.0) {
      moveX /= mag;
      moveY /= mag;
    }

    const speed = this.playerSpeed * (input.sprint ? this.sprintMultiplier : 1.0);
    const dx = moveX * speed * dtSec;
    const dy = moveY * speed * dtSec;

    return this.applyMovementWithSliding(startX, startY, dx, dy, this.collisionRadius);
  }

  /**
   * Reconciles local predicted position against authoritative server snapshot.
   * Sets base coordinates to server state, purges acknowledged inputs, and replays unacknowledged inputs.
   * @param {Object} serverState - Authoritative player object from S2C_WORLD_SNAPSHOT
   * @param {number} [tick=0]
   * @param {number} [snapshotTimestamp=Date.now()]
   */
  reconcile(serverState, tick = 0, snapshotTimestamp = Date.now()) {
    if (!serverState) return;

    // Initialize prediction state if first time
    if (!this.isPredictionInitialized) {
      this.predictedX = serverState.x;
      this.predictedY = serverState.y;
      this.predictedAngle = serverState.angle || 0;
      this.isPredictionInitialized = true;
      return;
    }

    // 1. Determine acknowledged sequence number from server
    const ackSeq = serverState.lastProcessedSeq ?? serverState.lastSequenceNumber ?? serverState.seq ?? null;

    if (ackSeq !== null) {
      // Drop inputs acknowledged by the server up to ackSeq
      this.pendingInputs = this.pendingInputs.filter(item => item.sequenceNumber > ackSeq);
    } else {
      // Fallback if server does not echo seq: drop inputs older than snapshot timestamp minus half RTT
      const ackTime = snapshotTimestamp - Math.max(5, this.latency / 2);
      this.pendingInputs = this.pendingInputs.filter(item => item.timestamp > ackTime);
    }

    // 2. Set base position to authoritative server snapshot coordinate
    let reconX = serverState.x;
    let reconY = serverState.y;

    // Safety buffer clamp to avoid unbounded memory growth under packet loss
    // Advance base coordinates by dropped inputs first to prevent massive position deficit
    if (this.pendingInputs.length > 120) {
      const dropCount = this.pendingInputs.length - 60;
      for (let i = 0; i < dropCount; i++) {
        const step = this.calculateStep(reconX, reconY, this.pendingInputs[i]);
        reconX = step.x;
        reconY = step.y;
      }
      this.pendingInputs = this.pendingInputs.slice(dropCount);
    }

    // 3. Replay remaining unacknowledged inputs in chronological order
    for (let i = 0; i < this.pendingInputs.length; i++) {
      const unacked = this.pendingInputs[i];
      const nextPos = this.calculateStep(reconX, reconY, unacked);
      reconX = nextPos.x;
      reconY = nextPos.y;
    }

    // 4. Update predicted position and smooth visual discrepancy
    const deltaX = reconX - this.predictedX;
    const deltaY = reconY - this.predictedY;
    const errorDist = Math.hypot(deltaX, deltaY);

    if (errorDist > 0.05) {
      this.predictedX = reconX;
      this.predictedY = reconY;

      // Smooth visual corrections under 45px to eliminate visual jitter / stutter
      if (errorDist <= 45.0) {
        this.visualErrorX = Math.max(-50, Math.min(50, (this.visualErrorX || 0) - deltaX));
        this.visualErrorY = Math.max(-50, Math.min(50, (this.visualErrorY || 0) - deltaY));
      } else {
        // Hard snap for large teleports / respawns
        this.visualErrorX = 0;
        this.visualErrorY = 0;
      }
    }

    // Reconcile stamina with server authoritative value
    if (typeof serverState.stamina === 'number') {
      this.predictedStamina = serverState.stamina;
    }
    if (serverState.team) {
      this.team = serverState.team;
    }
  }

  /**
   * Sends formatted input packet to server and tracks in prediction queue.
   * @param {Object} input
   */
  sendInput(input) {
    if (!input) return;

    const dtMs = typeof input.dt === 'number' && input.dt > 0 ? input.dt : 16.67;
    const dtSec = dtMs / 1000;
    const moveX = typeof input.moveX === 'number' ? input.moveX : 0;
    const moveY = typeof input.moveY === 'number' ? input.moveY : 0;
    const mag = Math.hypot(moveX, moveY);
    const wantsSprint = Boolean(input.sprint && this.predictedStamina > 0);

    // Predict stamina drain / recovery
    if (wantsSprint && mag > 0) {
      this.predictedStamina = Math.max(0, this.predictedStamina - 30 * dtSec);
    } else {
      this.predictedStamina = Math.min(100, this.predictedStamina + 20 * dtSec);
    }

    this.sequenceNumber++;
    const inputEntry = {
      seq: this.sequenceNumber,
      sequenceNumber: this.sequenceNumber,
      moveX,
      moveY,
      sprint: wantsSprint,
      aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : this.predictedAngle,
      firing: !!input.firing,
      reload: !!input.reload,
      ability: Boolean(input.ability || input.useAbility),
      dt: dtMs,
      timestamp: Date.now()
    };

    // 1. Immediately apply displacement to local predicted position (Zero Latency)
    if (this.isPredictionInitialized) {
      this.predictedAngle = inputEntry.aimAngle;
      const { x, y } = this.calculateStep(this.predictedX, this.predictedY, inputEntry);
      this.predictedX = x;
      this.predictedY = y;
    }

    // 2. Queue into pending inputs for server reconciliation
    this.pendingInputs.push(inputEntry);

    // 3. Transmit packet over WebSocket wire
    if (this.isConnected && this.socket && this.socket.readyState === 1) {
      this.send(PROTOCOL_MSG_TYPES.C2S_PLAYER_INPUT, inputEntry);
    }
  }

  /**
   * Updates locally tracked loadout and broadcasts to server if connected.
   * @param {Object} loadout
   * @param {string} [loadout.weaponId]
   * @param {string} [loadout.classId]
   * @param {Object} [loadout.profile]
   */
  setLoadout(loadout = {}) {
    if (loadout.weaponId) this.equippedWeapon = loadout.weaponId;
    if (loadout.classId) this.equippedClass = loadout.classId;
    if (loadout.profile) this.cachedProfile = loadout.profile;

    if (this.isSocketReady) {
      this.send(PROTOCOL_MSG_TYPES.C2S_LOADOUT_UPDATE, {
        weaponId: this.equippedWeapon,
        classId: this.equippedClass,
        profile: this.cachedProfile || null
      });
    }
  }

  /**
   * Sends room join request.
   * @param {string} roomId
   * @param {string} playerName
   * @param {Object} [options]
   */
  joinLobby(roomId = 'default', playerName = 'Mechanic', options = {}) {
    this.roomId = roomId;
    const payload = {
      roomId,
      playerName,
      equippedWeapon: options.equippedWeapon || this.equippedWeapon || 'revolver',
      equippedClass: options.equippedClass || this.equippedClass || 'vanguard',
      profile: options.profile || this.cachedProfile || null,
      password: options.password || null,
      ...options
    };
    this.send(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, payload);
  }

  /**
   * Sends custom room creation request.
   * Supports both positional parameters and options object.
   * @param {string|Object} roomIdOrOptions
   * @param {string} [playerName]
   * @param {string} [mapName]
   * @param {number} [maxPlayers]
   * @param {Object} [map]
   * @param {boolean} [autoFillBots]
   * @param {string} [gameMode]
   * @param {number} [targetKills]
   * @param {string|null} [password]
   */
  createLobby(roomIdOrOptions = 'default', playerName = 'HostEngineer', mapName = 'The Clockwork Foundry', maxPlayers = 4, map = null, autoFillBots = false, gameMode = 'solo_elim', targetKills = 10, password = null) {
    let payload;
    if (typeof roomIdOrOptions === 'object' && roomIdOrOptions !== null) {
      payload = {
        roomId: roomIdOrOptions.roomId || 'default',
        playerName: roomIdOrOptions.playerName || 'HostEngineer',
        mapName: roomIdOrOptions.mapName || roomIdOrOptions.map?.name || 'The Clockwork Foundry',
        maxPlayers: roomIdOrOptions.maxPlayers || 4,
        map: roomIdOrOptions.map || null,
        autoFillBots: roomIdOrOptions.autoFillBots ?? false,
        gameMode: roomIdOrOptions.gameMode || 'solo_elim',
        targetKills: roomIdOrOptions.targetKills || 10,
        equippedWeapon: roomIdOrOptions.equippedWeapon || this.equippedWeapon || 'revolver',
        equippedClass: roomIdOrOptions.equippedClass || this.equippedClass || 'vanguard',
        profile: roomIdOrOptions.profile || this.cachedProfile || null,
        password: roomIdOrOptions.password || null
      };
    } else {
      payload = {
        roomId: roomIdOrOptions || 'default',
        playerName: playerName || 'HostEngineer',
        mapName: mapName || map?.name || 'The Clockwork Foundry',
        autoFillBots: autoFillBots !== undefined ? !!autoFillBots : true,
        fillWithBots: (roomIdOrOptions && typeof roomIdOrOptions === 'object') ? (roomIdOrOptions.fillWithBots !== undefined ? roomIdOrOptions.fillWithBots : roomIdOrOptions.autoFillBots) : true,
        botDifficulty: (roomIdOrOptions && typeof roomIdOrOptions === 'object' && roomIdOrOptions.botDifficulty) ? roomIdOrOptions.botDifficulty : 'normal',
        gameMode: gameMode || 'solo_elim',
        targetKills: targetKills || 10,
        equippedWeapon: this.equippedWeapon || 'revolver',
        equippedClass: this.equippedClass || 'vanguard',
        profile: this.cachedProfile || null,
        password: password || null
      };
    }
    this.roomId = payload.roomId;
    this.send(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, payload);
  }

  /**
   * Sends player ready toggle.
   * @param {boolean} ready
   */
  setReady(ready = true) {
    this.send(PROTOCOL_MSG_TYPES.C2S_LOBBY_READY, { ready });
  }

  /**
   * Sends match start request (host only).
   * @param {Object} [options]
   */
  startMatch(options = {}) {
    this.send(PROTOCOL_MSG_TYPES.C2S_MATCH_START, options);
  }

  /**
   * Fetches active public rooms from the server REST API.
   * @returns {Promise<Array<{ id: string, mapName: string, playerCount: number, maxPlayers: number, state: string }>>}
   */
  async fetchRooms() {
    try {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const apiHost = isLocal ? '' : 'https://steamstrike-server.onrender.com';
      const res = await fetch(`${apiHost}/api/rooms`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.rooms)) {
          return data.rooms;
        }
      }
    } catch (_) {}
    return [];
  }

  /**
   * Requests the latest rooms list over WebSocket connection.
   */
  requestRoomsList() {
    this.send(PROTOCOL_MSG_TYPES.C2S_ROOMS_LIST, {});
  }

  /**
   * Configures the active battle arena map and pre-compiles collision parameters.
   * @param {Object} map
   */
  setMap(map) {
    if (!map) return;
    const tileSize = map.tileSize || 40;
    this.mapWidth = (map.width || 20) * tileSize;
    this.mapHeight = (map.height || 20) * tileSize;
  }

  /**
   * Sets pre-compiled exterior line segments for obstacle sliding.
   * @param {Array<Object>} segments
   */
  setGeometrySegments(segments) {
    this.geometrySegments = segments || [];
  }

  /**
   * Sends keepalive ping packet.
   */
  sendPing() {
    if (!this.isConnected || !this.socket || this.socket.readyState !== 1) return;
    this.send(PROTOCOL_MSG_TYPES.C2S_PING, { timestamp: Date.now() });
  }

  /**
   * Serializes and transmits packet over socket wire.
   * @param {string} type
   * @param {Object} payload
   */
  send(type, payload) {
    if (this.socket && this.socket.readyState === 1) {
      try {
        this.socket.send(serializePacket(type, payload));
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  /**
   * Smoothly decays visual prediction error offsets towards zero.
   */
  decayVisualError() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!this.lastErrorDecayTime) {
      this.lastErrorDecayTime = now;
      return;
    }
    const elapsedSec = (now - this.lastErrorDecayTime) / 1000;
    if (elapsedSec <= 0.001) {
      return;
    }
    this.lastErrorDecayTime = now;
    const dt = Math.min(0.1, elapsedSec);

    if (this.visualErrorX !== 0 || this.visualErrorY !== 0) {
      const decay = Math.exp(-20.0 * dt);
      this.visualErrorX *= decay;
      this.visualErrorY *= decay;

      if (Math.abs(this.visualErrorX) < 0.02) this.visualErrorX = 0;
      if (Math.abs(this.visualErrorY) < 0.02) this.visualErrorY = 0;
    }

    if (this.clientRespawnTimer > 0) {
      this.clientRespawnTimer = Math.max(0, this.clientRespawnTimer - dt);
    }
  }

  /**
   * Returns the zero-latency locally predicted player entity.
   * @returns {Object|null}
   */
  getLocalPredictedPlayer() {
    this.decayVisualError();

    const latestSnapshot = this.snapshotBuffer.length > 0
      ? this.snapshotBuffer[this.snapshotBuffer.length - 1].data
      : null;
    const serverPlayer = latestSnapshot?.players?.find(p => p.id === this.playerId);

    if (!this.isPredictionInitialized && !serverPlayer) {
      return null;
    }

    const isAlive = !this.isLocallyDead && (serverPlayer ? serverPlayer.isAlive : true);
    const hp = this.isLocallyDead ? 0 : (serverPlayer?.hp ?? 100);
    const respawnTimer = this.isLocallyDead
      ? (this.clientRespawnTimer > 0 ? this.clientRespawnTimer : (serverPlayer?.respawnTimer || 0))
      : (serverPlayer?.respawnTimer || 0);

    return {
      id: this.playerId || 'local_player',
      name: serverPlayer?.name || 'LocalPlayer',
      x: this.predictedX,
      y: this.predictedY,
      renderX: this.predictedX + (this.visualErrorX || 0),
      renderY: this.predictedY + (this.visualErrorY || 0),
      angle: this.predictedAngle,
      hp,
      maxHp: serverPlayer?.maxHp ?? 100,
      stamina: Math.round(this.predictedStamina ?? serverPlayer?.stamina ?? 100),
      maxStamina: serverPlayer?.maxStamina ?? 100,
      team: serverPlayer?.team || this.team || null,
      kills: serverPlayer?.kills || 0,
      deaths: serverPlayer?.deaths || 0,
      respawnTimer,
      ammo: serverPlayer?.ammo ?? 6,
      maxAmmo: serverPlayer?.maxAmmo ?? 6,
      weaponId: serverPlayer?.weaponId || this.equippedWeapon || 'revolver',
      weaponName: serverPlayer?.weaponName || WEAPON_DEFINITIONS[serverPlayer?.weaponId || this.equippedWeapon]?.name || 'Годинниковий револьвер',
      isAlive,
      isReloading: serverPlayer?.isReloading ?? false,
      isInvulnerable: serverPlayer?.isInvulnerable ?? false,
      isHost: serverPlayer?.isHost ?? false,
      isLocal: true
    };
  }

  /**
   * Requests game mode change (host only).
   * @param {string} gameMode
   * @param {number} [targetKills]
   */
  changeGameMode(gameMode, targetKills = null, fillWithBots = null, botDifficulty = null) {
    const payload = {};
    if (gameMode) payload.gameMode = gameMode;
    if (targetKills !== null && targetKills !== undefined) payload.targetKills = targetKills;
    if (fillWithBots !== null && fillWithBots !== undefined) payload.fillWithBots = fillWithBots;
    if (botDifficulty) payload.botDifficulty = botDifficulty;
    this.send(PROTOCOL_MSG_TYPES.C2S_CHANGE_GAME_MODE, payload);
  }

  /**
   * Requests team assignment change.
   * @param {'team1'|'team2'} team
   */
  changeTeam(team) {
    this.send(PROTOCOL_MSG_TYPES.C2S_CHANGE_TEAM, { team });
  }

  /**
   * Retrieves linearly interpolated entities for the current render frame,
   * injecting the locally predicted player at zero latency.
   * @param {number} [renderTime]
   * @returns {{ localPlayer: Object|null, players: Array<Object>, projectiles: Array<Object>, soundEvents: Array<Object> }}
   */
  getInterpolatedState(renderTime = (Date.now() - this.interpolationDelayMs)) {
    const localPlayer = this.getLocalPredictedPlayer();

    if (this.snapshotBuffer.length === 0) {
      return {
        localPlayer,
        players: localPlayer ? [localPlayer] : [],
        projectiles: [],
        pickups: [],
        soundEvents: [],
        gameMode: this.gameMode,
        targetKills: this.targetKills,
        teamScores: { team1: 0, team2: 0 },
        aliveCount: localPlayer ? 1 : 0
      };
    }

    if (this.snapshotBuffer.length === 1) {
      const snap = this.snapshotBuffer[0].data;
      const players = (snap.players || []).map(p => (this.playerId && p.id === this.playerId && localPlayer) ? localPlayer : p);
      return {
        localPlayer,
        players,
        projectiles: snap.projectiles || [],
        pickups: snap.pickups || [],
        soundEvents: snap.soundEvents || [],
        gameMode: snap.gameMode || this.gameMode,
        targetKills: snap.targetKills || this.targetKills,
        teamScores: snap.teamScores || { team1: 0, team2: 0 },
        aliveCount: snap.aliveCount || players.filter(p => p.isAlive).length
      };
    }

    // Find the two snapshots surrounding renderTime
    let older = null;
    let newer = null;

    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      const snapA = this.snapshotBuffer[i];
      const snapB = this.snapshotBuffer[i + 1];

      if (snapA.receivedAt <= renderTime && renderTime <= snapB.receivedAt) {
        older = snapA;
        newer = snapB;
        break;
      }
    }

    // If renderTime is ahead of the buffer, use the latest snapshot
    if (!older || !newer) {
      const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1].data;
      const players = (latest.players || []).map(p => (this.playerId && p.id === this.playerId && localPlayer) ? localPlayer : p);
      return {
        localPlayer,
        players,
        projectiles: latest.projectiles || [],
        pickups: latest.pickups || [],
        soundEvents: latest.soundEvents || [],
        gameMode: latest.gameMode || this.gameMode,
        targetKills: latest.targetKills || this.targetKills,
        teamScores: latest.teamScores || { team1: 0, team2: 0 },
        aliveCount: latest.aliveCount || players.filter(p => p.isAlive).length
      };
    }

    // Calculate interpolation factor t [0, 1]
    const timeDelta = newer.receivedAt - older.receivedAt;
    const t = timeDelta > 0 ? Math.max(0, Math.min(1, (renderTime - older.receivedAt) / timeDelta)) : 1;

    // Interpolate player positions
    const olderPlayers = new Map((older.data.players || []).map(p => [p.id, p]));
    const interpolatedPlayers = [];

    for (const newP of (newer.data.players || [])) {
      // Inject zero-latency predicted local player
      if (this.playerId && newP.id === this.playerId && localPlayer) {
        interpolatedPlayers.push(localPlayer);
        continue;
      }

      const oldP = olderPlayers.get(newP.id);
      if (oldP) {
        interpolatedPlayers.push({
          ...newP,
          x: oldP.x + (newP.x - oldP.x) * t,
          y: oldP.y + (newP.y - oldP.y) * t,
          angle: this.lerpAngle(oldP.angle || 0, newP.angle || 0, t)
        });
      } else {
        interpolatedPlayers.push(newP);
      }
    }

    const latestSnap = newer.data || {};
    return {
      localPlayer,
      players: interpolatedPlayers,
      projectiles: latestSnap.projectiles || [],
      pickups: latestSnap.pickups || [],
      soundEvents: latestSnap.soundEvents || [],
      gameMode: latestSnap.gameMode || this.gameMode,
      targetKills: latestSnap.targetKills || this.targetKills,
      teamScores: latestSnap.teamScores || { team1: 0, team2: 0 },
      aliveCount: latestSnap.aliveCount || interpolatedPlayers.filter(p => p.isAlive).length
    };
  }

  /**
   * Shortest-path angular interpolation.
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   */
  lerpAngle(a, b, t) {
    let diff = (b - a) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  /**
   * Adds an event listener.
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  /**
   * Removes an event listener.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    if (!this.listeners.has(event)) return;
    const handlers = this.listeners.get(event).filter(h => h !== handler);
    this.listeners.set(event, handlers);
  }

  /**
   * Emits an internal event.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (let i = 0; i < handlers.length; i++) {
        try {
          handlers[i](data);
        } catch (err) {
          console.error(`Error in event listener "${event}":`, err);
        }
      }
    }
  }

  /**
   * Closes connection cleanly.
   */
  disconnect() {
    this.autoReconnect = false;
    this.stopPingHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close(1000, 'Client closed');
      this.socket = null;
    }
  }
}

export default NetworkClient;
