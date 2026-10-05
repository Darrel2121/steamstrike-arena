/**
 * Authoritative Game Room & Simulation Loop
 * Manages 30Hz tick execution, players, bots, physics collisions, anticheat, and snapshot broadcasts.
 */

import { createDefaultMap, getPresetMap, TILE_TYPES } from '../shared/MapSchema.js';
import { PROTOCOL_MSG_TYPES, serializePacket } from '../shared/Protocol.js';
import { extractSegmentsFromMap, circleSegmentIntersect } from './physics/Geometry.js';
import { TILE_SIZE, PROJECTILE_SPEED, LANTERN_RANGE, SOUND_CONFIGS, GAME_MODES, GAME_MODE_CONFIGS } from '../shared/Constants.js';
import { Player } from './entities/Player.js';
import { Bot } from './entities/Bot.js';
import { Projectile } from './entities/Projectile.js';
import { Pickup } from './entities/Pickup.js';
import { solveProjectileHit } from './physics/Collision.js';
import { createProjectileSpecs, getWeapon } from './combat/WeaponDefinitions.js';
import { profileStore } from './db/ProfileStore.js';
import { calculateMatchRewards, calculateCharacterStats, calculateEffectiveCharacterStats, calculateEffectiveWeaponStats } from '../shared/ProgressionSchema.js';
import { getClassDefinition } from '../shared/CharacterClasses.js';
import { tacticalNeuralAgent } from './ai/TacticalNeuralAgent.js';

export class Room {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {Object|string} [options.map]
   * @param {string} [options.mapName]
   * @param {number} [options.maxPlayers=4]
   * @param {number} [options.tickRate=30]
   * @param {boolean} [options.autoTick=false]
   * @param {string} [options.gameMode]
   * @param {number} [options.targetKills]
   */
  constructor(options = {}) {
    this.id = options.id || ('room_' + Date.now());
    let resolvedMap = options.map || options.mapName;
    if (typeof resolvedMap === 'string') {
      resolvedMap = getPresetMap(resolvedMap);
    }
    this.map = resolvedMap || createDefaultMap();
    this.maxPlayers = options.maxPlayers || 4;
    this.tickRate = options.tickRate || 30;
    this.autoTick = options.autoTick ?? false;
    this.autoFillBots = options.autoFillBots ?? (options.fillBots === true || options.fillWithBots === true);
    this.botDifficulty = options.botDifficulty || 'normal';

    // Game Mode & Ruleset
    this.gameMode = options.gameMode || GAME_MODES.SOLO_ELIM;
    this.targetKills = options.targetKills ?? (this.gameMode === GAME_MODES.TEAM_DM ? 15 : (this.gameMode === GAME_MODES.FFA_DM ? 10 : 0));
    this.teamScores = { team1: 0, team2: 0 };
    this.password = options.password ? String(options.password).trim() : null;

    this.state = 'LOBBY'; // 'LOBBY', 'IN_PROGRESS', 'GAME_OVER'
    this.players = new Map();
    this.bots = new Map();
    this.projectiles = [];
    this.soundEvents = [];
    this.hitEvents = [];
    this.smokeZones = [];
    this.pickups = [];
    this.tickNumber = 0;
    this.intervalId = null;
    this.matchStartTime = 0;
    this.matchStats = new Map();
    this.eliminatedCount = 0;

    this.geometrySegments = [];
    this.compileGeometry();
    this.initPickups();

    if (this.autoTick) {
      this.startLoop();
    }
  }

  isTeamMode() {
    return this.gameMode === GAME_MODES.TEAM_DM || this.gameMode === GAME_MODES.TEAM_ELIM;
  }

  isRespawnMode() {
    return this.gameMode === GAME_MODES.TEAM_DM || this.gameMode === GAME_MODES.FFA_DM;
  }

  setGameMode(gameMode, targetKills = null, fillWithBots = null, botDifficulty = null) {
    if (gameMode && Object.values(GAME_MODES).includes(gameMode)) {
      this.gameMode = gameMode;
    }
    if (typeof targetKills === 'number' && targetKills > 0) {
      this.targetKills = targetKills;
    } else if (gameMode) {
      const cfg = GAME_MODE_CONFIGS[gameMode];
      this.targetKills = cfg?.defaultTargetKills || 0;
    }
    if (fillWithBots !== null && fillWithBots !== undefined) {
      this.autoFillBots = Boolean(fillWithBots);
    }
    if (botDifficulty) {
      this.botDifficulty = botDifficulty;
    }
    // Rebalance existing players if entering team mode
    if (this.isTeamMode()) {
      let idx = 0;
      for (const p of this.players.values()) {
        p.team = (idx % 2 === 0) ? 'team1' : 'team2';
        idx++;
      }
    }
    this.broadcastLobbyState();
    return true;
  }

  setRoomConfig(config = {}) {
    if (config.gameMode && Object.values(GAME_MODES).includes(config.gameMode)) {
      this.gameMode = config.gameMode;
    }
    if (typeof config.targetKills === 'number' && config.targetKills > 0) {
      this.targetKills = config.targetKills;
    }
    if (config.fillWithBots !== undefined) {
      this.autoFillBots = Boolean(config.fillWithBots);
    }
    if (config.botDifficulty) {
      this.botDifficulty = config.botDifficulty;
    }
    this.broadcastLobbyState();
    return true;
  }

  setPlayerTeam(id, team) {
    const player = this.players.get(id);
    if (!player) return false;
    if (team === 'team1' || team === 'team2') {
      player.team = team;
      this.broadcastLobbyState();
      return true;
    }
    return false;
  }

  /**
   * Pre-compiles exterior boundaries of walls and obstacles into optimized line segments.
   */
  compileGeometry() {
    if (this.map) {
      this.geometrySegments = extractSegmentsFromMap(this.map) || [];
    } else {
      this.geometrySegments = [];
    }
    return this.geometrySegments;
  }

  /**
   * Initializes pickups from map definition.
   */
  initPickups() {
    this.pickups = [];
    if (this.map && Array.isArray(this.map.pickups)) {
      const tileSize = this.map.tileSize || TILE_SIZE || 40;
      this.map.pickups.forEach((p, idx) => {
        this.pickups.push(new Pickup({
          id: `pk_${p.type}_${idx}`,
          type: p.type,
          col: p.col,
          row: p.row,
          tileSize
        }));
      });
    }
  }

  /**
   * Finds a distinct spawn coordinate for player or bot, maximizing distance from active opponents.
   * @param {'player'|'bot'} type
   * @param {number} slotIndex
   * @param {string|null} [candidateTeam=null]
   * @returns {{ x: number, y: number, angle: number }}
   */
  getSpawnPosition(type, slotIndex = 0, candidateTeam = null) {
    const tileSize = this.map.tileSize || TILE_SIZE || 40;
    const spawns = this.map.spawns || [];

    // Gather living opponents to calculate distance
    const livingOpponents = [];
    for (const p of this.players.values()) {
      if (p.isAlive && p.hp > 0) {
        if (!candidateTeam || !p.team || p.team !== candidateTeam) {
          livingOpponents.push({ x: p.x, y: p.y });
        }
      }
    }
    for (const b of this.bots.values()) {
      if (b.isAlive && b.hp > 0) {
        if (!candidateTeam || !b.team || b.team !== candidateTeam) {
          livingOpponents.push({ x: b.x, y: b.y });
        }
      }
    }

    // Candidate spawn positions
    const candidates = [];
    const getCoords = (sp) => {
      const sx = typeof sp.x === 'number' ? sp.x : (sp.col * tileSize + tileSize / 2);
      const sy = typeof sp.y === 'number' ? sp.y : (sp.row * tileSize + tileSize / 2);
      return { x: sx, y: sy, angle: sp.angle || 0 };
    };

    // Add matching typed spawns
    for (const sp of spawns) {
      if (sp.type === type) candidates.push(getCoords(sp));
    }
    // If not enough, add all spawns
    if (candidates.length === 0) {
      for (const sp of spawns) {
        candidates.push(getCoords(sp));
      }
    }

    // Also add distributed walkable floor tiles if needed
    if (this.map.tiles && this.map.width && this.map.height) {
      const step = Math.max(3, Math.floor(Math.min(this.map.width, this.map.height) / 4));
      for (let r = 1; r < this.map.height - 1; r += step) {
        for (let c = 1; c < this.map.width - 1; c += step) {
          if (this.map.tiles[r * this.map.width + c] === TILE_TYPES.FLOOR || this.map.tiles[r * this.map.width + c] === 0) {
            candidates.push({
              x: c * tileSize + tileSize / 2,
              y: r * tileSize + tileSize / 2,
              angle: 0
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return { x: 100 + slotIndex * 50, y: 100, angle: 0 };
    }

    // If no opponents on map yet, pick by slotIndex
    if (livingOpponents.length === 0) {
      return candidates[slotIndex % candidates.length];
    }

    // Select the candidate spawn that MAXIMIZES the minimum distance to any living opponent
    let bestCandidate = candidates[0];
    let maxMinDist = -1;

    for (const cand of candidates) {
      let minDistToEnemy = Infinity;
      for (const opp of livingOpponents) {
        const d = Math.hypot(cand.x - opp.x, cand.y - opp.y);
        if (d < minDistToEnemy) minDistToEnemy = d;
      }
      if (minDistToEnemy > maxMinDist) {
        maxMinDist = minDistToEnemy;
        bestCandidate = cand;
      }
    }

    return bestCandidate;
  }

  /**
   * Adds a player to the room state and sends current lobby state.
   * @param {string} id
   * @param {string} [name]
   * @param {Object} [socket]
   * @returns {Player} Created player entity
   */
  addPlayer(idOrOptions, name, socket = null, profile = null) {
    let id = idOrOptions;
    if (typeof idOrOptions === 'object' && idOrOptions !== null) {
      id = idOrOptions.id;
      name = idOrOptions.name || name;
      socket = idOrOptions.socket || socket;
      profile = idOrOptions.profile || profile;
    }
    const slotIndex = this.players.size;
    const spawn = this.getSpawnPosition('player', slotIndex);
    const existingPlayer = this.players.get(id);
    const hasHost = Array.from(this.players.values()).some(p => p.isHost && p.id !== id);
    const isHost = existingPlayer ? Boolean(existingPlayer.isHost) : (!hasHost || this.players.size === 0);

    let maxHp = 100;
    let maxSpeed = 180;
    let lanternRange = 420;
    let weaponId = 'revolver';
    let classId = 'vanguard';

    const playerProfile = profile || socket?.meta?.profile || socket?.profile || null;
    if (playerProfile) {
      classId = playerProfile.equippedClass || 'vanguard';
      const cStats = calculateEffectiveCharacterStats(playerProfile.characterStats || {}, classId);
      maxHp = cStats.maxHp;
      maxSpeed = cStats.moveSpeed;
      lanternRange = cStats.lanternRange;
      weaponId = playerProfile.equippedWeapon || 'revolver';
    }

    let team = null;
    if (this.isTeamMode()) {
      let t1 = 0;
      let t2 = 0;
      for (const p of this.players.values()) {
        if (p.team === 'team1') t1++;
        else if (p.team === 'team2') t2++;
      }
      team = t1 <= t2 ? 'team1' : 'team2';
    }

    const emblem = playerProfile?.emblem || 'gear';
    const player = new Player({
      id,
      name: name || `Player_${id}`,
      socket,
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle || 0,
      isHost,
      team,
      maxHp,
      maxSpeed,
      weaponId,
      classId,
      emblem
    });
    player.emblem = emblem;
    player.lanternRange = lanternRange;
    player.profile = playerProfile;

    const baseW = getWeapon(weaponId);
    if (baseW) {
      const upgradeTiers = playerProfile?.weapons?.[weaponId] || null;
      const effW = upgradeTiers ? calculateEffectiveWeaponStats(baseW, upgradeTiers) : baseW;
      player.weapon = effW;
      player.maxAmmo = effW.magazine;
      player.ammo = effW.magazine;
      player.reloadDuration = effW.reload;
    }

    this.players.set(id, player);

    // Broadcast updated lobby state with yourPlayerId to all connected clients
    this.broadcastLobbyState();

    return player;
  }

  /**
   * Updates player loadout (equipped weapon, hero class, character stats) in real time.
   * @param {string} id
   * @param {Object} loadout
   */
  updatePlayerLoadout(id, loadout = {}) {
    const player = this.players.get(id);
    if (!player) return;

    if (loadout.classId) {
      player.classId = loadout.classId;
      const clsDef = getClassDefinition(loadout.classId);
      player.classDef = clsDef;
      player.ability = clsDef.ability;
      player.passive = clsDef.passive;
    }

    if (loadout.weaponId) {
      player.weaponId = loadout.weaponId;
      const baseW = getWeapon(loadout.weaponId);
      if (baseW) {
        const upgradeTiers = loadout.profile?.weapons?.[loadout.weaponId] || player.profile?.weapons?.[loadout.weaponId] || null;
        const effW = upgradeTiers ? calculateEffectiveWeaponStats(baseW, upgradeTiers) : baseW;
        player.weapon = effW;
        player.maxAmmo = effW.magazine;
        player.ammo = effW.magazine;
        player.reloadDuration = effW.reload;
      }
    }

    if (loadout.profile) {
      player.profile = { ...(player.profile || {}), ...loadout.profile };
      const cStats = calculateEffectiveCharacterStats(player.profile.characterStats || {}, player.classId);
      player.maxHp = cStats.maxHp;
      player.hp = Math.min(player.hp, player.maxHp);
      player.maxSpeed = cStats.moveSpeed;
      player.lanternRange = cStats.lanternRange;
    }

    if (this.state === 'LOBBY') {
      this.broadcastLobbyState();
    }
  }

  /**
   * Removes a player from the room and notifies remaining clients.
   * @param {string} id
   */
  removePlayer(id) {
    if (!this.players.has(id)) return;
    const removed = this.players.get(id);
    this.players.delete(id);

    // Transfer host if host left
    if (removed.isHost && this.players.size > 0) {
      const nextHost = this.players.values().next().value;
      if (nextHost) nextHost.isHost = true;
    }

    // Broadcast updated lobby state if still in lobby
    if (this.state === 'LOBBY') {
      this.broadcastLobbyState();
    }
  }

  /**
   * Sweeps sockets with closed/closing states.
   */
  cleanupDisconnected() {
    for (const [id, player] of this.players) {
      if (player.socket && (player.socket.readyState === 2 || player.socket.readyState === 3 || player.socket.closed)) {
        this.removePlayer(id);
      }
    }
  }

  /**
   * Fills remaining vacant slots up to maxPlayers with AI bot entities.
   */
  fillWithBots(difficulty = null) {
    const targetCount = this.maxPlayers - this.players.size;
    const currentBots = this.bots.size;
    const needed = Math.max(0, targetCount - currentBots);

    const bSpawns = (this.map.spawns || []).filter(s => s.type === 'bot');
    const pSpawns = (this.map.spawns || []).filter(s => s.type === 'player');
    const tileSize = this.map.tileSize || TILE_SIZE || 40;

    // Track occupied positions to guarantee distance from human players and bots
    const occupied = [];
    for (const p of this.players.values()) {
      occupied.push({ x: p.x, y: p.y, isPlayer: true });
    }
    for (const b of this.bots.values()) {
      occupied.push({ x: b.x, y: b.y, isPlayer: false });
    }

    const isFarEnough = (x, y, playerMinDist = 250, botMinDist = 60) => {
      for (const occ of occupied) {
        const d = Math.hypot(x - occ.x, y - occ.y);
        if (occ.isPlayer && d < playerMinDist) return false;
        if (!occ.isPlayer && d < botMinDist) return false;
      }
      return true;
    };

    // Helper to get pixel coords from spawn
    const getSpawnCoords = (sp) => {
      const sx = typeof sp.x === 'number' ? sp.x : (sp.col * tileSize + tileSize / 2);
      const sy = typeof sp.y === 'number' ? sp.y : (sp.row * tileSize + tileSize / 2);
      return { x: sx, y: sy };
    };

    for (let i = 0; i < needed; i++) {
      const botIndex = this.bots.size;
      const botId = `bot_${botIndex + 1}`;

      let spawnX = null;
      let spawnY = null;

      // 1. Try designated bot spawns that are far enough from players
      for (const sp of bSpawns) {
        const c = getSpawnCoords(sp);
        if (isFarEnough(c.x, c.y, 220, 60)) {
          spawnX = c.x;
          spawnY = c.y;
          break;
        }
      }

      // 2. Try unused player spawns far enough from existing players
      if (spawnX === null) {
        for (const sp of pSpawns) {
          const c = getSpawnCoords(sp);
          if (isFarEnough(c.x, c.y, 250, 60)) {
            spawnX = c.x;
            spawnY = c.y;
            break;
          }
        }
      }

      // 3. Search open walkable floor tiles with safe clearance
      if (spawnX === null && this.map.tiles && this.map.width && this.map.height) {
        const w = this.map.width;
        const h = this.map.height;
        const candidates = [];

        for (let r = 1; r < h - 1; r++) {
          for (let c = 1; c < w - 1; c++) {
            const tile = this.map.tiles[r * w + c];
            if (tile === TILE_TYPES.FLOOR || tile === 0) {
              const fx = c * tileSize + tileSize / 2;
              const fy = r * tileSize + tileSize / 2;
              if (isFarEnough(fx, fy, 250, 60)) {
                candidates.push({ x: fx, y: fy });
              }
            }
          }
        }

        if (candidates.length > 0) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          spawnX = picked.x;
          spawnY = picked.y;
        }
      }

      // 4. Ultimate fallback: pick the floor tile with maximum distance from any human player
      if (spawnX === null) {
        let bestTile = null;
        let maxMinDist = -1;
        const w = this.map.width || 20;
        const h = this.map.height || 20;

        for (let r = 1; r < h - 1; r++) {
          for (let c = 1; c < w - 1; c++) {
            const tile = this.map.tiles ? this.map.tiles[r * w + c] : 0;
            if (tile === TILE_TYPES.FLOOR || tile === 0) {
              const fx = c * tileSize + tileSize / 2;
              const fy = r * tileSize + tileSize / 2;
              let minDistToPlayer = Infinity;
              for (const occ of occupied) {
                if (occ.isPlayer) {
                  const d = Math.hypot(fx - occ.x, fy - occ.y);
                  if (d < minDistToPlayer) minDistToPlayer = d;
                }
              }
              if (minDistToPlayer > maxMinDist) {
                maxMinDist = minDistToPlayer;
                bestTile = { x: fx, y: fy };
              }
            }
          }
        }

        if (bestTile) {
          spawnX = bestTile.x;
          spawnY = bestTile.y;
        } else {
          const fallback = this.getSpawnPosition('bot', botIndex);
          spawnX = fallback.x;
          spawnY = fallback.y;
        }
      }

      occupied.push({ x: spawnX, y: spawnY, isPlayer: false });

      let botTeam = null;
      if (this.isTeamMode()) {
        let t1 = 0;
        let t2 = 0;
        for (const p of this.players.values()) {
          if (p.team === 'team1') t1++;
          else if (p.team === 'team2') t2++;
        }
        for (const b of this.bots.values()) {
          if (b.team === 'team1') t1++;
          else if (b.team === 'team2') t2++;
        }
        botTeam = t1 <= t2 ? 'team1' : 'team2';
      }

      const botClasses = ['vanguard', 'sharpshooter', 'juggernaut', 'infiltrator'];
      const botClass = botClasses[botIndex % botClasses.length];
      const botDiff = difficulty || this.botDifficulty || 'normal';

      const bot = new Bot({
        id: botId,
        name: `Automaton_${botIndex + 1}`,
        x: spawnX,
        y: spawnY,
        angle: 0,
        team: botTeam,
        hp: 100,
        maxHp: 100,
        ammo: 6,
        maxAmmo: 6,
        map: this.map,
        classId: botClass,
        difficulty: botDiff
      });

      this.bots.set(botId, bot);
    }
  }

  /**
   * Helper to spawn and track a projectile in the room.
   * @param {Object} options
   * @returns {Projectile}
   */
  spawnProjectile(options = {}) {
    const proj = options instanceof Projectile ? options : new Projectile(options);
    this.projectiles.push(proj);
    return proj;
  }

  /**
   * Starts the match, sets entities alive and broadcasts S2C_MATCH_INIT.
   */
  startMatch(options = {}) {
    this.state = 'IN_PROGRESS';
    this.matchStartTime = Date.now();
    this.matchStats = new Map();
    this.eliminatedCount = 0;
    this.teamScores = { team1: 0, team2: 0 };
    this.matchResultsRecorded = false;
    this.lastMatchOutcome = null;

    if (options?.fillBots === false || options?.fillWithBots === false) {
      this.bots.clear();
    } else if (this.autoFillBots || options?.fillBots || options?.fillWithBots) {
      this.fillWithBots(options?.botDifficulty || this.botDifficulty);
    }

    // Ensure team assignments if in team mode
    if (this.isTeamMode()) {
      let t1 = 0;
      let t2 = 0;
      for (const p of this.players.values()) {
        if (!p.team) {
          p.team = t1 <= t2 ? 'team1' : 'team2';
        }
        if (p.team === 'team1') t1++; else t2++;
      }
      for (const b of this.bots.values()) {
        if (!b.team) {
          b.team = t1 <= t2 ? 'team1' : 'team2';
        }
        if (b.team === 'team1') t1++; else t2++;
      }
    }

    // Initialize stats tracking for all combatants
    for (const p of this.players.values()) {
      if (p.profile) {
        const wId = p.profile.equippedWeapon || p.weaponId || 'revolver';
        const baseW = getWeapon(wId);
        if (baseW) {
          const upgradeTiers = p.profile.weapons?.[wId] || null;
          const effW = upgradeTiers ? calculateEffectiveWeaponStats(baseW, upgradeTiers) : baseW;
          p.weaponId = wId;
          p.weapon = effW;
          p.maxAmmo = effW.magazine;
          p.ammo = effW.magazine;
          p.reloadDuration = effW.reload;
        }
      }
      p.kills = 0;
      p.deaths = 0;
      p.respawnTimer = 0;
      p.stamina = p.maxStamina || 100;
      this.matchStats.set(p.id, {
        id: p.id,
        name: p.name,
        team: p.team || null,
        isBot: false,
        kills: 0,
        damageDealt: 0,
        placement: 1,
        survivalSeconds: 0,
        eliminatedAt: null
      });
    }

    for (const b of this.bots.values()) {
      b.kills = 0;
      b.deaths = 0;
      b.respawnTimer = 0;
      b.stamina = b.maxStamina || 100;
      this.matchStats.set(b.id, {
        id: b.id,
        name: b.name,
        team: b.team || null,
        isBot: true,
        kills: 0,
        damageDealt: 0,
        placement: 1,
        survivalSeconds: 0,
        eliminatedAt: null
      });
    }

    // Ensure all players are full HP/ammo, alive, and have spawn protection
    for (const player of this.players.values()) {
      player.hp = player.maxHp || 100;
      player.ammo = player.maxAmmo || 6;
      player.isAlive = true;
      player.isReloading = false;
      player.reloadTimer = 0;
      player.invulnerableTimer = options?.spawnProtection ? 3.0 : 0;
    }

    // Ensure all bots are full HP/ammo, alive, with initial firing grace delay
    for (const bot of this.bots.values()) {
      bot.hp = bot.maxHp || 100;
      bot.ammo = bot.maxAmmo || 6;
      bot.isAlive = true;
      bot.isReloading = false;
      bot.reloadTimer = 0;
      bot.fireCooldown = 1.5; // Prevent instant frame-0 shooting at match start
      bot.aimTime = -1.0;
    }

    const mapWidth = this.map.width * (this.map.tileSize || TILE_SIZE || 40);
    const mapHeight = this.map.height * (this.map.tileSize || TILE_SIZE || 40);

    // Send S2C_MATCH_INIT to all player sockets
    for (const player of this.players.values()) {
      if (player.socket && player.socket.readyState === 1) {
        this.sendToSocket(player.socket, PROTOCOL_MSG_TYPES.S2C_MATCH_INIT, {
          playerId: player.id,
          roomId: this.id,
          gameMode: this.gameMode,
          targetKills: this.targetKills,
          team: player.team || null,
          mapWidth,
          mapHeight,
          spawn: { x: player.x, y: player.y, angle: player.angle },
          tickRate: this.tickRate,
          maxSpeed: player.maxSpeed,
          sprintMultiplier: player.sprintMultiplier
        });
      }
    }

    if (this.autoTick && !this.intervalId) {
      this.startLoop();
    }
  }

  /**
   * Broadcasts an acoustic sound pulse when a weapon reload is initiated.
   * @param {Object} player
   */
  triggerReloadSound(player) {
    if (!player) return;
    const reloadSound = {
      id: 'snd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      sourceId: player.id,
      x: player.x,
      y: player.y,
      type: 'reload',
      radius: 35,
      maxRadius: SOUND_CONFIGS?.reload?.maxRadius || 140,
      intensity: 0.8,
      createdAt: Date.now()
    };
    this.soundEvents.push(reloadSound);
  }

  /**
   * Processes player movement vector with anticheat clamping and sliding wall collision.
   * @param {string} id
   * @param {Object} input
   */
  handlePlayerInput(id, input) {
    if (this.state === 'GAME_OVER' || this.state === 'ENDED') return;
    const player = this.players.get(id);
    if (!player || !player.isAlive || !input) return;

    if (typeof input.seq === 'number' || typeof input.sequenceNumber === 'number') {
      player.lastProcessedSeq = input.seq ?? input.sequenceNumber;
    }

    if (typeof input.aimAngle === 'number') {
      player.angle = input.aimAngle;
    }

    if (input.reload && !player.isReloading && player.ammo < player.maxAmmo) {
      const started = player.reload();
      if (started) {
        this.triggerReloadSound(player);
      }
    }

    if (input.ability || input.useAbility) {
      if (typeof player.activateAbility === 'function') {
        const act = player.activateAbility();
        if (act && act.ok) {
          if (player.classId === 'infiltrator') {
            this.smokeZones.push({
              id: 'smoke_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
              x: player.x,
              y: player.y,
              radius: 180,
              createdAt: Date.now(),
              duration: 5.0,
              ownerId: player.id
            });
          } else if (player.classId === 'vanguard') {
            player.ammo = player.maxAmmo;
            player.isReloading = false;
          }
          const sndRadius = player.classId === 'infiltrator' ? 80 : 160;
          this.soundEvents.push({
            id: 'snd_abil_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            sourceId: player.id,
            x: player.x,
            y: player.y,
            type: 'ability',
            radius: 40,
            maxRadius: sndRadius,
            intensity: 0.9,
            createdAt: Date.now()
          });
        }
      }
    }

    if (input.toggleLantern || input.lantern !== undefined) {
      if (typeof player.toggleLantern === 'function') {
        const forceState = typeof input.lantern === 'boolean' ? input.lantern : null;
        player.toggleLantern(forceState);
      }
    }

    if (input.firing) {
      if (player.fireCooldown <= 0) {
        const shotFired = player.fire(true);
        if (shotFired) {
          // Dynamic movement spread bloom: standing x1.0, walking x1.8, sprinting x3.2
          // Overdrive active reduces spread bloom by 40%
          let spreadMult = 1.0;
          const inputMag = Math.hypot(input.moveX || 0, input.moveY || 0);
          const wantsSprint = Boolean(input.sprint && (player.stamina ?? 100) > 0);
          if (wantsSprint && inputMag > 0.1) {
            spreadMult = 3.2; // 320% spread bloom during sprint
          } else if (inputMag > 0.1) {
            spreadMult = 1.8; // 180% spread bloom while walking
          }
          if (player.overdriveActive) {
            spreadMult *= 0.6; // Reduced bloom during steam overdrive
          }

          const specs = createProjectileSpecs(
            player.weaponId || 'revolver',
            {
              x: player.x + Math.cos(player.angle) * 16,
              y: player.y + Math.sin(player.angle) * 16
            },
            player.angle,
            player.id,
            {
              damage: player.weapon?.damage,
              spreadMultiplier: spreadMult
            }
          );

          for (const spec of specs) {
            this.spawnProjectile(spec);
          }

          const gunfireSound = {
            id: 'snd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            sourceId: player.id,
            x: player.x,
            y: player.y,
            type: 'gunfire',
            radius: 60,
            maxRadius: SOUND_CONFIGS?.gunfire?.maxRadius || 240,
            intensity: 1.0,
            createdAt: Date.now()
          };
          this.soundEvents.push(gunfireSound);
        }
      } else if (player.ammo <= 0 && !player.isReloading) {
        const started = player.reload();
        if (started) {
          this.triggerReloadSound(player);
        }
      }
    }

    const dtMs = typeof input.dt === 'number' && input.dt > 0 ? input.dt : (1000 / this.tickRate);
    const dtSec = dtMs / 1000;

    let moveX = typeof input.moveX === 'number' ? input.moveX : 0;
    let moveY = typeof input.moveY === 'number' ? input.moveY : 0;
    const inputMagnitude = Math.hypot(moveX, moveY);

    const wantsSprint = Boolean(input.sprint && (player.stamina ?? 100) > 0);
    player.isSprinting = wantsSprint && inputMagnitude > 0;

    if (inputMagnitude > 0) {
      let intendedDx = 0;
      let intendedDy = 0;

      const abilitySpeedBoost = player.overdriveActive ? 1.5 : 1.0;
      const baseMaxSpeed = (player.maxSpeed || 180) * abilitySpeedBoost;

      // Check if input is a normalized direction vector (<= 1.05) or spoofed displacement
      if (inputMagnitude <= 1.05) {
        const speed = baseMaxSpeed * (wantsSprint ? (player.sprintMultiplier || 1.5) : 1.0);
        intendedDx = moveX * speed * dtSec;
        intendedDy = moveY * speed * dtSec;
      } else {
        intendedDx = moveX;
        intendedDy = moveY;
      }

      // Anticheat speed-hack clamping: clamp displacement against maxAllowedDisplacement
      const maxAllowedDisplacement = baseMaxSpeed * dtSec * (player.sprintMultiplier || 1.5);
      const dispLen = Math.hypot(intendedDx, intendedDy);

      if (dispLen > maxAllowedDisplacement) {
        const clampRatio = maxAllowedDisplacement / dispLen;
        intendedDx *= clampRatio;
        intendedDy *= clampRatio;
      }

      // Slide along wall line segments
      this.moveWithSliding(player, intendedDx, intendedDy, 14);

      // Register acoustic footstep event on sprint
      if (wantsSprint) {
        let stepRadius = 45;
        let stepMaxRadius = 90;
        if (player.classId === 'sharpshooter') {
          stepRadius = Math.round(stepRadius * 0.6);
          stepMaxRadius = Math.round(stepMaxRadius * 0.6);
        }
        const footstep = {
          id: 'snd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          sourceId: player.id,
          x: player.x,
          y: player.y,
          type: 'footstep',
          radius: stepRadius,
          maxRadius: stepMaxRadius,
          intensity: 0.8,
          createdAt: Date.now()
        };
        this.soundEvents.push(footstep);
      }
    } else {
      player.isSprinting = false;
    }
  }

  /**
   * Applies movement with wall sliding against pre-compiled line segments.
   * @param {Object} entity
   * @param {number} dx
   * @param {number} dy
   * @param {number} radius
   */
  moveWithSliding(entity, dx, dy, radius = 14) {
    const mapWidth = this.map.width * (this.map.tileSize || TILE_SIZE || 40);
    const mapHeight = this.map.height * (this.map.tileSize || TILE_SIZE || 40);

    const checkCollision = (cx, cy) => {
      const center = { x: cx, y: cy };
      for (let i = 0; i < this.geometrySegments.length; i++) {
        const seg = this.geometrySegments[i];
        if (circleSegmentIntersect(center, radius, seg.p1, seg.p2)) {
          return true;
        }
      }
      return false;
    };

    // 1. Try full diagonal step
    const targetX = entity.x + dx;
    const targetY = entity.y + dy;
    if (!checkCollision(targetX, targetY)) {
      entity.x = targetX;
      entity.y = targetY;
    } else {
      // 2. Try horizontal sliding
      if (Math.abs(dx) > 0.0001 && !checkCollision(targetX, entity.y)) {
        entity.x = targetX;
      }
      // 3. Try vertical sliding
      if (Math.abs(dy) > 0.0001 && !checkCollision(entity.x, targetY)) {
        entity.y = targetY;
      }
    }

    // Clamp inside arena boundary
    entity.x = Math.max(radius, Math.min(mapWidth - radius, entity.x));
    entity.y = Math.max(radius, Math.min(mapHeight - radius, entity.y));
  }

  /**
   * Updates projectile kinematic vectors and resolves continuous collision hits.
   * @param {number} dtSec
   */
  updateProjectiles(dtSec) {
    if (!this.projectiles || this.projectiles.length === 0) return;

    const livingTargets = this.getAliveCombatants();

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      if (!proj.isAlive) continue;

      const rayStart = { x: proj.x, y: proj.y };
      proj.update(dtSec);
      const rayEnd = { x: proj.x, y: proj.y };

      const bulletRay = { start: rayStart, end: rayEnd, shooterId: proj.shooterId };
      const targets = livingTargets.filter(c => c.id !== proj.shooterId);

      const hit = solveProjectileHit(bulletRay, this.geometrySegments, targets, { shooterId: proj.shooterId });

      if (hit && hit.hit) {
        proj.isAlive = false;
        proj.x = hit.point.x;
        proj.y = hit.point.y;

        const hitType = (hit.type === 'player' && hit.target) ? 'entity' : 'wall';
        const hitEvent = {
          id: 'hit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          x: Math.round(hit.point.x * 10) / 10,
          y: Math.round(hit.point.y * 10) / 10,
          type: hitType,
          damage: proj.damage || 35,
          shooterId: proj.shooterId,
          targetId: hit.target ? hit.target.id : null,
          vx: proj.vx || 0,
          vy: proj.vy || 0
        };
        this.hitEvents.push(hitEvent);

        if (hit.type === 'player' && hit.target) {
          this.applyDamage(hit.target.id, proj.shooterId, proj.damage || 35);
        }
      }
    }

    this.projectiles = this.projectiles.filter(p => p.isAlive);
  }

  /**
   * Authoritative 30Hz simulation step.
   */
  tick() {
    this.tickNumber++;
    const dtSec = 1 / this.tickRate;

    this.cleanupDisconnected();

    // If match has concluded, freeze simulation in background and broadcast final state
    if (this.state === 'GAME_OVER' || this.state === 'ENDED') {
      this.broadcastSnapshot();
      return;
    }

    // Advance player states and observe human combat maneuvers for neural AI imitation
    for (const player of this.players.values()) {
      player.update(dtSec, player.isSprinting);
      if (player.isAlive && !player.isBot && typeof tacticalNeuralAgent?.observePlayer === 'function') {
        tacticalNeuralAgent.observePlayer(player, this, dtSec);
      }
    }

    // Advance respawn timers for eliminated combatants in respawn modes
    if (this.isRespawnMode()) {
      for (const player of this.players.values()) {
        if (!player.isAlive && player.respawnTimer > 0) {
          player.respawnTimer -= dtSec;
          if (player.respawnTimer <= 0) {
            player.respawnTimer = 0;
            const spawn = this.getSpawnPosition('player', Math.floor(Math.random() * 8), player.team);
            player.respawn(spawn.x, spawn.y, spawn.angle);
            this.broadcast(PROTOCOL_MSG_TYPES.S2C_RESPAWN_EVENT, {
              entityId: player.id,
              isBot: false,
              x: player.x,
              y: player.y,
              angle: player.angle
            });
          }
        }
      }

      for (const bot of this.bots.values()) {
        if (!bot.isAlive && bot.respawnTimer > 0) {
          bot.respawnTimer -= dtSec;
          if (bot.respawnTimer <= 0) {
            bot.respawnTimer = 0;
            const spawn = this.getSpawnPosition('bot', Math.floor(Math.random() * 8), bot.team);
            bot.respawn(spawn.x, spawn.y, spawn.angle);
            this.broadcast(PROTOCOL_MSG_TYPES.S2C_RESPAWN_EVENT, {
              entityId: bot.id,
              isBot: true,
              x: bot.x,
              y: bot.y,
              angle: bot.angle
            });
          }
        }
      }
    }

    // Feed sound events to living bots
    if (this.soundEvents.length > 0) {
      for (const bot of this.bots.values()) {
        if (!bot.isAlive) continue;
        for (const sound of this.soundEvents) {
          if (sound.sourceId === bot.id) continue;
          const dist = Math.hypot(sound.x - bot.x, sound.y - bot.y);
          const hearingRadius = sound.maxRadius || sound.radius || 180;
          if (dist <= hearingRadius) {
            bot.hearSound(sound);
          }
        }
      }
    }

    // Advance bot states with room reference
    for (const bot of this.bots.values()) {
      bot.update(dtSec, this);
    }

    // Update projectiles & continuous collisions
    this.updateProjectiles(dtSec);

    // Update pickups & check collection overlap
    if (this.pickups && this.pickups.length > 0) {
      for (const pickup of this.pickups) {
        pickup.update(dtSec);
        if (pickup.isActive) {
          for (const player of this.players.values()) {
            if (player.isAlive && pickup.checkOverlap(player) && pickup.canCollect(player)) {
              pickup.collect(player);
            }
          }
          for (const bot of this.bots.values()) {
            if (bot.isAlive && pickup.checkOverlap(bot) && pickup.canCollect(bot)) {
              pickup.collect(bot);
            }
          }
        }
      }
    }

    // Advance sound events & remove expired
    const now = Date.now();
    this.soundEvents = this.soundEvents.filter(s => (now - (s.createdAt || now)) < 1200);

    // Advance smoke zones & remove expired
    if (this.smokeZones && this.smokeZones.length > 0) {
      this.smokeZones = this.smokeZones.filter(z => (now - (z.createdAt || now)) < ((z.duration || 5.0) * 1000));
    }

    // Check match conditions on every tick in respawn modes (e.g. target kills)
    if (this.isRespawnMode() && this.state === 'IN_PROGRESS') {
      this.evaluateMatchOutcome();
    }

    // Broadcast snapshot
    this.broadcastSnapshot();
  }

  /**
   * Sends S2C_WORLD_SNAPSHOT packet containing all active entities, projectiles, pickups, and sound events.
   */
  broadcastSnapshot() {
    const snapshotPlayers = [];

    for (const p of this.players.values()) {
      if (typeof p.toSnapshot === 'function') {
        snapshotPlayers.push(p.toSnapshot());
      } else {
        snapshotPlayers.push({
          id: p.id,
          name: p.name,
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          angle: Math.round((p.angle || 0) * 1000) / 1000,
          hp: p.hp,
          stamina: Math.round(p.stamina ?? 100),
          ammo: p.ammo,
          team: p.team || null,
          kills: p.kills || 0,
          respawnTimer: Math.round((p.respawnTimer || 0) * 10) / 10,
          isAlive: p.isAlive,
          isHost: p.isHost,
          lanternOn: p.lanternOn !== false,
          lastProcessedSeq: p.lastProcessedSeq || 0
        });
      }
    }

    for (const b of this.bots.values()) {
      if (typeof b.toSnapshot === 'function') {
        snapshotPlayers.push(b.toSnapshot());
      } else {
        snapshotPlayers.push({
          id: b.id,
          name: b.name,
          x: Math.round(b.x * 100) / 100,
          y: Math.round(b.y * 100) / 100,
          angle: Math.round((b.angle || 0) * 1000) / 1000,
          hp: b.hp,
          stamina: 100,
          ammo: b.ammo,
          team: b.team || null,
          kills: b.kills || 0,
          respawnTimer: Math.round((b.respawnTimer || 0) * 10) / 10,
          isAlive: b.isAlive,
          isBot: true,
          lanternOn: b.lanternOn !== false
        });
      }
    }

    const payload = {
      tick: this.tickNumber,
      timestamp: Date.now(),
      gameMode: this.gameMode,
      targetKills: this.targetKills,
      teamScores: { ...this.teamScores },
      aliveCount: this.getAliveCombatants().length,
      players: snapshotPlayers,
      projectiles: (this.projectiles || []).map(p => (typeof p.toJSON === 'function' ? p.toJSON() : p)),
      soundEvents: this.soundEvents || [],
      hitEvents: this.hitEvents || [],
      smokeZones: this.smokeZones || [],
      pickups: (this.pickups || []).filter(pk => pk.isActive).map(pk => (typeof pk.toSnapshot === 'function' ? pk.toSnapshot() : pk))
    };

    this.hitEvents = [];

    this.broadcast(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, payload);
  }

  /**
   * Applies damage to target player or bot, clamps >= 0, and broadcasts events.
   * @param {string} targetId
   * @param {string} attackerId
   * @param {number} damage
   */
  applyDamage(targetId, attackerId, damage) {
    const target = this.players.get(targetId) || this.bots.get(targetId);
    if (!target || !target.isAlive) return;

    const attacker = attackerId ? (this.players.get(attackerId) || this.bots.get(attackerId)) : null;

    // Friendly fire disabled in team modes
    if (this.isTeamMode() && attacker && target && attacker.id !== target.id) {
      if (attacker.team && target.team && attacker.team === target.team) {
        return;
      }
    }

    let actualDamage = damage;
    if (attacker && attacker.classId === 'infiltrator') {
      const toAttacker = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      let angleDiff = Math.abs(toAttacker - (target.angle || 0));
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      angleDiff = Math.abs(angleDiff);
      if (angleDiff > Math.PI * 0.5) {
        actualDamage = Math.round(damage * 1.25);
      }
    }

    if (attackerId && this.matchStats?.has(attackerId)) {
      const atkStats = this.matchStats.get(attackerId);
      atkStats.damageDealt += actualDamage;
    }

    if (typeof target.takeDamage === 'function') {
      target.takeDamage(actualDamage);
    } else {
      target.hp = Math.max(0, target.hp - actualDamage);
      if (target.hp === 0) {
        target.isAlive = false;
      }
    }

    this.broadcast(PROTOCOL_MSG_TYPES.S2C_DAMAGE_EVENT, {
      targetId,
      attackerId,
      damage: actualDamage,
      remainingHp: target.hp
    });

    if (target.hp === 0) {
      if (this.matchStats) {
        this.eliminatedCount = (this.eliminatedCount || 0) + 1;
        const totalEntities = this.matchStats.size;

        if (attackerId && this.matchStats.has(attackerId)) {
          this.matchStats.get(attackerId).kills++;
        }
        if (attacker) {
          attacker.kills = (attacker.kills || 0) + 1;
        }
        target.deaths = (target.deaths || 0) + 1;

        if (this.isTeamMode() && attacker && attacker.team) {
          this.teamScores[attacker.team] = (this.teamScores[attacker.team] || 0) + 1;
        }

        if (this.isRespawnMode()) {
          target.respawnTimer = 3.0;
        }

        if (this.matchStats.has(targetId)) {
          const victimStats = this.matchStats.get(targetId);
          victimStats.eliminatedAt = Date.now();
          const start = this.matchStartTime || Date.now();
          victimStats.survivalSeconds = Math.max(0, Math.floor((victimStats.eliminatedAt - start) / 1000));
          victimStats.placement = Math.max(2, totalEntities - this.eliminatedCount + 1);
        }
      }

      for (const bot of this.bots.values()) {
        if (bot.currentTargetId === targetId) {
          bot.updateTargetStatus(target);
        }
      }
      const victimName = target.name || (this.matchStats?.get(targetId)?.name) || 'Боєць';
      const killerName = attacker?.name || (attackerId ? this.matchStats?.get(attackerId)?.name : null) || null;

      this.broadcast(PROTOCOL_MSG_TYPES.S2C_ELIMINATION_EVENT, {
        victimId: targetId,
        killerId: attackerId,
        victimName,
        killerName,
        respawnTimer: target.respawnTimer || 0
      });
    }

    this.evaluateMatchOutcome();
  }

  /**
   * Returns an array of living combatants (players and bots with HP > 0).
   * @returns {Array<Object>}
   */
  getAliveCombatants() {
    const alive = [];
    for (const p of this.players.values()) {
      if (p.isAlive && p.hp > 0) alive.push(p);
    }
    for (const b of this.bots.values()) {
      if (b.isAlive && b.hp > 0) alive.push(b);
    }
    return alive;
  }

  /**
   * Evaluates if the match has concluded across all 4 game modes.
   * @returns {{ isOver: boolean, winnerId: string|null, draw?: boolean, results?: Array }}
   */
  evaluateMatchOutcome() {
    const totalEntities = this.players.size + this.bots.size;
    if (totalEntities === 0) {
      return { isOver: false, winnerId: null };
    }

    const durationSec = Math.max(0, Math.floor((Date.now() - (this.matchStartTime || Date.now())) / 1000));
    let isGameOver = false;
    let winnerId = null;
    let winningTeam = null;
    let draw = false;

    if (this.gameMode === GAME_MODES.TEAM_DM) {
      if (this.teamScores.team1 >= this.targetKills) {
        isGameOver = true;
        winningTeam = 'team1';
      } else if (this.teamScores.team2 >= this.targetKills) {
        isGameOver = true;
        winningTeam = 'team2';
      }
    } else if (this.gameMode === GAME_MODES.FFA_DM) {
      for (const p of this.players.values()) {
        if (p.kills >= this.targetKills) {
          isGameOver = true;
          winnerId = p.id;
          break;
        }
      }
      if (!isGameOver) {
        for (const b of this.bots.values()) {
          if (b.kills >= this.targetKills) {
            isGameOver = true;
            winnerId = b.id;
            break;
          }
        }
      }
    } else if (this.gameMode === GAME_MODES.TEAM_ELIM) {
      let team1Alive = 0;
      let team2Alive = 0;
      for (const p of this.players.values()) {
        if (p.isAlive && p.hp > 0) {
          if (p.team === 'team1') team1Alive++;
          else if (p.team === 'team2') team2Alive++;
        }
      }
      for (const b of this.bots.values()) {
        if (b.isAlive && b.hp > 0) {
          if (b.team === 'team1') team1Alive++;
          else if (b.team === 'team2') team2Alive++;
        }
      }

      if (team1Alive === 0 && team2Alive === 0) {
        isGameOver = true;
        draw = true;
      } else if (team1Alive === 0 && team2Alive > 0) {
        isGameOver = true;
        winningTeam = 'team2';
      } else if (team2Alive === 0 && team1Alive > 0) {
        isGameOver = true;
        winningTeam = 'team1';
      }
    } else {
      // SOLO_ELIM: Last man standing (permadeath)
      const alive = this.getAliveCombatants();
      const aliveHumans = Array.from(this.players.values()).filter(p => p.isAlive && p.hp > 0 && !p.isBot);

      if (alive.length === 0 || (alive.length === 1 && totalEntities > 1)) {
        isGameOver = true;
        draw = alive.length === 0;
        winnerId = alive.length === 1 ? alive[0].id : null;
      } else if (aliveHumans.length === 0 && this.players.size > 0) {
        // All human players eliminated: immediately resolve match so player is not stuck watching bots
        isGameOver = true;
        draw = false;
        winnerId = alive.length > 0 ? alive[0].id : null;
      }
    }

    if (!isGameOver) {
      return { isOver: false, winnerId: null };
    }

    const wasAlreadyGameOver = this.state === 'GAME_OVER';
    this.state = 'GAME_OVER';

    const results = [];
    for (const p of this.players.values()) {
      let isWinner = false;
      if (winningTeam) {
        isWinner = p.team === winningTeam;
      } else if (winnerId) {
        isWinner = p.id === winnerId;
      }

      const stats = this.matchStats?.get(p.id) || {
        placement: isWinner ? 1 : 2,
        kills: p.kills || 0,
        damageDealt: 0,
        survivalSeconds: durationSec
      };
      if (isWinner) {
        stats.placement = 1;
      }
      stats.kills = Math.max(stats.kills, p.kills || 0);

      const rewards = calculateMatchRewards({
        placement: stats.placement,
        kills: stats.kills,
        damageDealt: stats.damageDealt,
        survivalSeconds: stats.survivalSeconds || durationSec
      });

      results.push({
        playerId: p.id,
        name: p.name,
        team: p.team || null,
        placement: stats.placement,
        kills: stats.kills,
        damageDealt: stats.damageDealt,
        survivalSeconds: stats.survivalSeconds || durationSec,
        xpEarned: rewards.xp,
        scrapEarned: rewards.scrap,
        coresEarned: rewards.cores
      });

      if (!this.matchResultsRecorded) {
        profileStore.recordMatchResult(p.id, {
          matchId: this.id,
          placement: stats.placement,
          kills: stats.kills,
          damageDealt: stats.damageDealt,
          survivalSeconds: stats.survivalSeconds || durationSec
        }).catch(err => console.warn(`[Room] Failed to persist rewards for ${p.id}:`, err?.message));
      }
    }
    this.matchResultsRecorded = true;

    const outcome = {
      isOver: true,
      gameMode: this.gameMode,
      winnerId,
      winningTeam,
      teamScores: { ...this.teamScores },
      draw,
      results
    };

    if (!wasAlreadyGameOver || (this.lastMatchOutcome && this.lastMatchOutcome.draw !== draw)) {
      this.lastMatchOutcome = outcome;
      this.broadcast(PROTOCOL_MSG_TYPES.S2C_MATCH_OVER, outcome);
      if (typeof tacticalNeuralAgent?.saveWeights === 'function') {
        tacticalNeuralAgent.saveWeights();
      }
    }

    return outcome;
  }

  /**
   * Resets room state back to LOBBY.
   */
  reset() {
    this.state = 'LOBBY';
    this.matchStartTime = 0;
    this.matchStats = new Map();
    this.eliminatedCount = 0;
    this.teamScores = { team1: 0, team2: 0 };
    this.matchResultsRecorded = false;
    this.lastMatchOutcome = null;
    this.bots.clear();
    this.projectiles = [];
    this.soundEvents = [];
    this.tickNumber = 0;
    this.stopLoop();

    if (this.pickups) {
      for (const pk of this.pickups) {
        pk.reset();
      }
    }

    let slot = 0;
    for (const player of this.players.values()) {
      player.hp = player.maxHp || 100;
      player.ammo = player.maxAmmo || 6;
      player.isAlive = true;
      player.ready = false;
      player.kills = 0;
      player.deaths = 0;
      player.respawnTimer = 0;
      player.stamina = player.maxStamina || 100;
      player.isReloading = false;
      player.reloadTimer = 0;
      const spawn = this.getSpawnPosition('player', slot++);
      player.x = spawn.x;
      player.y = spawn.y;
      player.angle = spawn.angle || 0;
    }
  }

  /**
   * Returns true if room is protected by a password code.
   * @returns {boolean}
   */
  hasPassword() {
    return Boolean(this.password && this.password.length > 0);
  }

  /**
   * Verifies candidate password against room password.
   * If room has no password, always returns true.
   * @param {string} [candidate]
   * @returns {boolean}
   */
  verifyPassword(candidate) {
    if (!this.hasPassword()) return true;
    if (!candidate) return false;
    return String(candidate).trim() === this.password;
  }

  /**
   * Sets or clears room password.
   * @param {string|null} newPassword
   */
  setPassword(newPassword) {
    this.password = newPassword ? String(newPassword).trim() : null;
    if (this.state === 'LOBBY') {
      this.broadcastLobbyState();
    }
  }

  /**
   * Constructs the S2C_LOBBY_STATE payload, optionally personalized for a specific player.
   * @param {string} [forPlayerId]
   * @returns {Object}
   */
  getLobbyStatePayload(forPlayerId = null) {
    const hostPlayer = Array.from(this.players.values()).find(p => p.isHost);
    const payload = {
      roomId: this.id,
      hostId: hostPlayer ? hostPlayer.id : null,
      isLocked: this.hasPassword(),
      hasPassword: this.hasPassword(),
      gameMode: this.gameMode,
      targetKills: this.targetKills,
      fillWithBots: Boolean(this.autoFillBots),
      botDifficulty: this.botDifficulty || 'normal',
      gameModeConfig: GAME_MODE_CONFIGS[this.gameMode] || null,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        team: p.team || null,
        ready: !!p.ready,
        isHost: !!p.isHost,
        emblem: p.emblem || p.profile?.emblem || 'gear',
        classId: p.classId || 'vanguard'
      })),
      maxPlayers: this.maxPlayers,
      mapName: this.map?.name || 'The Clockwork Foundry'
    };
    if (forPlayerId) {
      payload.yourPlayerId = forPlayerId;
    }
    return payload;
  }

  /**
   * Broadcasts current lobby state to all players, providing each client with its yourPlayerId.
   */
  broadcastLobbyState() {
    for (const player of this.players.values()) {
      if (player.socket && player.socket.readyState === 1) {
        this.sendToSocket(
          player.socket,
          PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE,
          this.getLobbyStatePayload(player.id)
        );
      }
    }
  }

  /**
   * Sends packet to a specific socket safely.
   * @param {Object} socket
   * @param {string} type
   * @param {Object} payload
   */
  sendToSocket(socket, type, payload) {
    if (socket && socket.readyState === 1) {
      try {
        socket.send(serializePacket(type, payload));
      } catch (_) {
        // Socket error handled in cleanup
      }
    }
  }

  /**
   * Broadcasts packet to all connected player sockets in this room.
   * @param {string} type
   * @param {Object} payload
   */
  broadcast(type, payload) {
    const raw = serializePacket(type, payload);
    for (const player of this.players.values()) {
      if (player.socket && player.socket.readyState === 1) {
        try {
          player.socket.send(raw);
        } catch (_) {
          // Socket error handled in cleanup
        }
      }
    }
  }

  /**
   * Starts the 30Hz simulation loop timer.
   */
  startLoop() {
    if (this.intervalId) return;
    const intervalMs = Math.round(1000 / this.tickRate);
    this.intervalId = setInterval(() => {
      if (this.state === 'LOBBY') return;
      this.tick();
    }, intervalMs);
    if (typeof this.intervalId?.unref === 'function') {
      this.intervalId.unref();
    }
  }

  /**
   * Stops the simulation loop timer.
   */
  stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export default Room;
