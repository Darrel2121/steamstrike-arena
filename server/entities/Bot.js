/**
 * Autonomous AI Bot Entity & Sensory State Machine
 * Implements 4-state FSM (PATROL, INVESTIGATE, ENGAGE, RETREAT),
 * grid-based BFS pathfinding on walkable floor tiles,
 * lantern line-of-sight visual targeting (via RaycastMath),
 * acoustic perception, and weapon discharge.
 */

import { Player } from './Player.js';
import { Projectile } from './Projectile.js';
import {
  TILE_SIZE,
  PLAYER_RADIUS,
  LANTERN_FOV_RAD,
  LANTERN_RANGE,
  PROJECTILE_SPEED,
  PROJECTILE_RADIUS,
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_CONFIGS
} from '../../shared/Constants.js';
import { isPointVisible } from '../../shared/RaycastMath.js';
import { TILE_TYPES } from '../../shared/MapSchema.js';
import { tacticalNeuralAgent } from '../ai/TacticalNeuralAgent.js';

/**
 * Grid-based BFS pathfinder navigating strictly on walkable FLOOR tiles (0).
 * @param {Object} map - BattleMap object with tiles, width, height
 * @param {{ col?: number, row?: number, x?: number, y?: number }} startTile
 * @param {{ col?: number, row?: number, x?: number, y?: number }} goalTile
 * @returns {Array<{ col: number, row: number }>} Array of waypoints from start to goal
 */
export function findPath(map, startTile, goalTile) {
  if (!map || !map.tiles || !map.width || !map.height || !startTile || !goalTile) {
    return [];
  }

  const width = map.width;
  const height = map.height;
  const tileSize = map.tileSize || TILE_SIZE || 40;

  const sc = startTile.col !== undefined ? startTile.col : Math.floor(startTile.x / tileSize);
  const sr = startTile.row !== undefined ? startTile.row : Math.floor(startTile.y / tileSize);
  const gc = goalTile.col !== undefined ? goalTile.col : Math.floor(goalTile.x / tileSize);
  const gr = goalTile.row !== undefined ? goalTile.row : Math.floor(goalTile.y / tileSize);

  // Boundary validation
  if (sc < 0 || sc >= width || sr < 0 || sr >= height) return [];
  if (gc < 0 || gc >= width || gr < 0 || gr >= height) return [];

  // Start tile must be on walkable floor
  if (map.tiles[sr * width + sc] !== TILE_TYPES.FLOOR && map.tiles[sr * width + sc] !== 0) {
    return [];
  }

  // Trivial identical start and goal
  if (sc === gc && sr === gr) {
    return [{ col: sc, row: sr }];
  }

  // If goal tile is solid wall/obstacle, find closest walkable adjacent tile
  let targetCol = gc;
  let targetRow = gr;
  if (map.tiles[gr * width + gc] !== TILE_TYPES.FLOOR && map.tiles[gr * width + gc] !== 0) {
    let closestDistSq = Infinity;
    let foundWalkable = false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = gc + dc;
        const nr = gr + dr;
        if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
          if (map.tiles[nr * width + nc] === TILE_TYPES.FLOOR || map.tiles[nr * width + nc] === 0) {
            const dSq = (nc - sc) ** 2 + (nr - sr) ** 2;
            if (dSq < closestDistSq) {
              closestDistSq = dSq;
              targetCol = nc;
              targetRow = nr;
              foundWalkable = true;
            }
          }
        }
      }
    }
    if (!foundWalkable) return [];
  }

  // Orthogonal BFS queue
  const queue = [{ col: sc, row: sr }];
  const cameFrom = new Map();
  const visited = new Uint8Array(width * height);
  visited[sr * width + sc] = 1;

  const dirs = [
    { dc: 0, dr: -1 }, // North
    { dc: 1, dr: 0 },  // East
    { dc: 0, dr: 1 },  // South
    { dc: -1, dr: 0 }  // West
  ];

  let found = false;
  let head = 0;

  while (head < queue.length) {
    const curr = queue[head++];
    if (curr.col === targetCol && curr.row === targetRow) {
      found = true;
      break;
    }

    for (let i = 0; i < 4; i++) {
      const nc = curr.col + dirs[i].dc;
      const nr = curr.row + dirs[i].dr;

      if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
        const idx = nr * width + nc;
        if (!visited[idx] && (map.tiles[idx] === TILE_TYPES.FLOOR || map.tiles[idx] === 0)) {
          visited[idx] = 1;
          cameFrom.set(`${nc},${nr}`, curr);
          queue.push({ col: nc, row: nr });
        }
      }
    }
  }

  if (!found) return [];

  // Reconstruct path backward from target to start
  const path = [];
  let step = { col: targetCol, row: targetRow };
  while (step) {
    path.push(step);
    if (step.col === sc && step.row === sr) break;
    step = cameFrom.get(`${step.col},${step.row}`);
  }

  path.reverse();
  return path;
}

export const computePath = findPath;

export class Bot extends Player {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    super(options);
    this.isBot = true;
    this.difficulty = options.difficulty || BOT_DIFFICULTIES.NORMAL;
    const diffCfg = BOT_DIFFICULTY_CONFIGS[this.difficulty] || BOT_DIFFICULTY_CONFIGS.normal;

    this.name = options.name || `Automaton_${this.id}`;
    this.maxSpeed = options.maxSpeed ?? diffCfg.maxSpeed ?? 140;

    // Tactical vision parameters
    this.fov = options.fov ?? LANTERN_FOV_RAD ?? (80 * Math.PI / 180);
    this.range = options.range ?? diffCfg.range ?? LANTERN_RANGE ?? 420;

    // Weapon parameters & cooldown
    this.fireCooldown = 0;
    this.fireInterval = options.fireInterval ?? diffCfg.fireInterval ?? 0.40;
    this.weaponDamage = options.weaponDamage ?? 35;
    this.weaponSpeed = options.weaponSpeed ?? PROJECTILE_SPEED ?? 750;

    // State machine: 'PATROL' | 'INVESTIGATE' | 'ENGAGE' | 'RETREAT'
    this.state = options.state || 'PATROL';
    this.currentTargetId = null;
    this.investigateTarget = null;
    this.reactionDelay = options.reactionDelay ?? diffCfg.reactionDelay ?? 0.50;
    this.aimTime = 0;
    this.turnRate = options.turnRate ?? diffCfg.turnRate ?? (Math.PI * 3.5);
    this.leadAim = options.leadAim ?? diffCfg.leadAim ?? true;
    this.abilityChance = options.abilityChance ?? diffCfg.abilityChance ?? 0.60;

    // Navigation & Waypoints
    this.map = options.map || null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.patrolTimer = 0;
    this.loseSightTimer = 0;
  }

  /**
   * Respawns bot and resets AI sensory and navigation state.
   */
  respawn(x, y, angle = 0) {
    super.respawn(x, y, angle);
    this.state = 'PATROL';
    this.currentTargetId = null;
    this.investigateTarget = null;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.fireCooldown = 1.0;
    this.aimTime = -1.0;
  }

  /**
   * Pathfinding instance method
   */
  findPath(map, startTile, goalTile) {
    return findPath(map || this.map, startTile, goalTile);
  }

  /**
   * Bot weapon firing logic: checks cooldown, ammo, reload, and returns projectile spec.
   * @param {number} [dt=0]
   * @returns {Projectile|null}
   */
  attemptFire(dt = 0) {
    if (!this.isAlive || this.isReloading) return null;
    if (this.fireCooldown > 0) return null;
    if (this.ammo <= 0) {
      this.reload();
      return null;
    }

    this.ammo--;
    this.fireCooldown = this.fireInterval;

    let shotAngle = this.angle;
    if (this.difficulty === BOT_DIFFICULTIES.EASY) {
      shotAngle += (Math.random() - 0.5) * 0.22;
    }

    return new Projectile({
      shooterId: this.id,
      x: this.x + Math.cos(this.angle) * 16,
      y: this.y + Math.sin(this.angle) * 16,
      angle: shotAngle,
      speed: this.weaponSpeed,
      damage: this.weaponDamage,
      maxRange: this.range,
      radius: PROJECTILE_RADIUS ?? 3.5
    });
  }

  /**
   * Sensory acoustic perception:
   * Hearing a sound event while in PATROL or INVESTIGATE transitions to INVESTIGATE
   * and sets investigation target coordinates.
   * @param {Object} soundEvent - { id, x, y, type, radius, maxRadius }
   */
  hearSound(soundEvent) {
    if (!soundEvent || !this.isAlive) return;
    if (this.state !== 'ENGAGE') {
      this.state = 'INVESTIGATE';
      this.investigateTarget = { x: soundEvent.x, y: soundEvent.y };
      this.waypoints = [];
      this.waypointIndex = 0;
    }
  }

  /**
   * Sensory visual perception:
   * Direct line-of-sight contact immediately transitions to ENGAGE and locks target ID.
   * CRITICAL: Must immediately interrupt and override INVESTIGATE mode (T3.5)!
   * @param {Object} enemy - { id, x, y, hp, isAlive }
   */
  seeTarget(enemy) {
    if (!enemy || !this.isAlive) return;
    this.state = 'ENGAGE';
    if (this.currentTargetId !== enemy.id) {
      this.aimTime = 0;
    }
    this.currentTargetId = enemy.id;
    if (typeof enemy.x === 'number' && typeof enemy.y === 'number') {
      this.angle = Math.atan2(enemy.y - this.y, enemy.x - this.x);
    }
    this.loseSightTimer = 0;
  }

  /**
   * Updates target status when target is damaged or eliminated.
   * Returns bot to PATROL and clears currentTargetId if target is eliminated.
   * @param {Object} target - { id, hp, isAlive }
   */
  updateTargetStatus(target) {
    if (!target || !target.isAlive || target.hp <= 0 || target.id === this.currentTargetId) {
      this.currentTargetId = null;
      this.state = 'PATROL';
      this.investigateTarget = null;
      this.waypoints = [];
      this.waypointIndex = 0;
      this.aimTime = 0;
    }
  }

  /**
   * Overrides damage intake to trigger RETREAT when HP falls below 35% or when vulnerable.
   * @param {number} amount
   * @param {string} [attackerId]
   * @returns {number} Actual damage dealt
   */
  takeDamage(amount, attackerId = null) {
    const actualDamage = super.takeDamage(amount);
    if (this.isAlive && actualDamage > 0) {
      if (this.state === 'PATROL' || this.state === 'INVESTIGATE') {
        if (attackerId) {
          this.currentTargetId = attackerId;
          this.state = 'ENGAGE';
        }
      }
      if (this.hp <= 35 || (this.ammo <= 0 && this.isReloading)) {
        this.state = 'RETREAT';
        if (attackerId) this.currentTargetId = attackerId;
        this.aimTime = 0;
      }
    }
    return actualDamage;
  }

  /**
   * Updates bot state, timers, navigation, LoS detection, and weapon firing.
   * @param {number} dt - Delta time in seconds
   * @param {Object} [room] - Reference to server Room instance
   */
  update(dt, room = null) {
    // Tick Player base timers (reload, fireCooldown, etc.)
    super.update(dt);

    if (!this.isAlive) return;

    if (room && room.map && !this.map) {
      this.map = room.map;
    }

    // Visual scan for potential targets in FOV
    if (room) {
      this.scanVisualTargets(room);
    }

    // State machine update
    switch (this.state) {
      case 'ENGAGE':
        this.updateEngage(dt, room);
        break;
      case 'INVESTIGATE':
        this.updateInvestigate(dt, room);
        break;
      case 'RETREAT':
        this.updateRetreat(dt, room);
        break;
      case 'PATROL':
      default:
        this.updatePatrol(dt, room);
        break;
    }
  }

  /**
   * Scans lantern line-of-sight against all living opponents in room.
   */
  scanVisualTargets(room) {
    if (!room) return;
    const segments = room.geometrySegments || [];

    const candidates = [];
    if (room.players) {
      for (const p of room.players.values()) {
        if (p.isAlive && p.hp > 0 && p.id !== this.id) {
          if (this.team && p.team && this.team === p.team) continue;
          candidates.push(p);
        }
      }
    }
    if (room.bots) {
      for (const b of room.bots.values()) {
        if (b.isAlive && b.hp > 0 && b.id !== this.id) {
          if (this.team && b.team && this.team === b.team) continue;
          candidates.push(b);
        }
      }
    }

    // Retain current target if already engaging and target remains visible within range
    if (this.state === 'ENGAGE' && this.currentTargetId) {
      const current = room.players?.get(this.currentTargetId) || room.bots?.get(this.currentTargetId);
      if (current && current.isAlive && current.hp > 0) {
        const dSq = (current.x - this.x) ** 2 + (current.y - this.y) ** 2;
        if (dSq <= this.range * this.range) {
          const inProx = dSq <= (45 * 45);
          const isVis = inProx || isPointVisible(
            { x: this.x, y: this.y, angle: this.angle },
            current,
            segments,
            this.angle,
            this.fov,
            this.range
          );
          if (isVis) return;
        }
      }
    }

    let nearestCandidate = null;
    let nearestDistSq = Infinity;
    const proximityDistSq = 45 * 45; // 45px omnidirectional close-proximity awareness bubble

    for (const cand of candidates) {
      const distSq = (cand.x - this.x) ** 2 + (cand.y - this.y) ** 2;
      if (distSq <= this.range * this.range) {
        const inProximity = distSq <= proximityDistSq;
        const visible = inProximity || isPointVisible(
          { x: this.x, y: this.y, angle: this.angle },
          cand,
          segments,
          this.angle,
          this.fov,
          this.range
        );
        if (visible && distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestCandidate = cand;
        }
      }
    }

    if (nearestCandidate) {
      this.seeTarget(nearestCandidate);
    }
  }

  /**
   * ENGAGE state update: aim, fire, and tactical movement
   */
  updateEngage(dt, room) {
    if (this.hp <= 35) {
      this.state = 'RETREAT';
      return;
    }

    let target = null;
    if (room) {
      target = room.players?.get(this.currentTargetId) || room.bots?.get(this.currentTargetId);
    }

    if (!target || !target.isAlive || target.hp <= 0) {
      this.updateTargetStatus(target);
      return;
    }

    // Rate-limited angular aim smoothing with predictive ballistic lead
    let desiredAngle = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.leadAim !== false && this.aimTime > 0.10 && typeof tacticalNeuralAgent?.predictLeadAim === 'function') {
      desiredAngle = tacticalNeuralAgent.predictLeadAim(this, target, this.weaponSpeed || 1800);
    }

    const maxTurnRate = (this.turnRate || (Math.PI * 3.5)) * dt;
    let angleDiff = desiredAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurnRate);

    // Verify line of sight (or close proximity)
    const distSq = (target.x - this.x) ** 2 + (target.y - this.y) ** 2;
    const inProximity = distSq <= (45 * 45);
    const segments = room?.geometrySegments || [];
    const visible = inProximity || isPointVisible(
      { x: this.x, y: this.y, angle: this.angle },
      target,
      segments,
      this.angle,
      this.fov,
      this.range
    );

    if (visible) {
      this.loseSightTimer = 0;
      this.aimTime += dt;

      // Weapon discharge check (requires reactionDelay lock-on)
      if (this.aimTime >= this.reactionDelay && this.fireCooldown <= 0 && !this.isReloading && this.ammo > 0) {
        const proj = this.attemptFire(dt);
        if (proj && room) {
          if (room.projectiles) room.projectiles.push(proj);
          if (room.soundEvents) {
            room.soundEvents.push({
              id: 'snd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              sourceId: this.id,
              x: this.x,
              y: this.y,
              type: 'gunfire',
              radius: 60,
              maxRadius: 240,
              intensity: 1.0,
              createdAt: Date.now()
            });
          }
        }
      } else if (this.ammo <= 0 && !this.isReloading) {
        this.reload();
      }

      // Maintain combat engagement distance (100px - 250px)
      const dist = Math.hypot(target.x - this.x, target.y - this.y);

      // Tactical decision from behavioral policy neural agent
      const decision = tacticalNeuralAgent.evaluateBot(this, target, room, dt);

      // Tactical ability deployment during active engagement
      if (this.abilityCooldownTimer <= 0 && (this.hp < this.maxHp * 0.70 || this.isReloading || dist < 140)) {
        if (Math.random() < (this.abilityChance ?? 0.60)) {
          const act = this.activateAbility();
          if (act && act.ok && this.classId === 'infiltrator' && room && Array.isArray(room.smokeZones)) {
            room.smokeZones.push({
              id: 'smoke_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
              x: this.x,
              y: this.y,
              radius: 180,
              createdAt: Date.now(),
              duration: 5.0,
              ownerId: this.id
            });
          }
        }
      }
      let moveDir = 0;
      if (dist > 250) {
        moveDir = 1; // Advance
      } else if (dist < 100) {
        moveDir = -1; // Back away
      }

      // Base sightline movement
      let dx = Math.cos(this.angle) * this.maxSpeed * dt * moveDir;
      let dy = Math.sin(this.angle) * this.maxSpeed * dt * moveDir;

      // Blend lateral strafing & evasive maneuvers from neural network
      if (decision && (decision.strafeX !== 0 || decision.strafeY !== 0)) {
        const strafeWeight = 0.65;
        dx = dx * 0.70 + decision.strafeX * this.maxSpeed * dt * strafeWeight;
        dy = dy * 0.70 + decision.strafeY * this.maxSpeed * dt * strafeWeight;
      }

      if (dx !== 0 || dy !== 0) {
        if (room && typeof room.moveWithSliding === 'function') {
          room.moveWithSliding(this, dx, dy, this.radius);
        } else {
          this.x += dx;
          this.y += dy;
        }
      }
    } else {
      // Occluded behind obstacles: track countdown before returning to investigate
      this.loseSightTimer += dt;
      if (this.loseSightTimer > 2.0) {
        this.state = 'INVESTIGATE';
        this.investigateTarget = { x: target.x, y: target.y };
        this.currentTargetId = null;
        this.waypoints = [];
        this.waypointIndex = 0;
      }
    }
  }

  /**
   * INVESTIGATE state update: pathfollow to sound origin
   */
  updateInvestigate(dt, room) {
    if (!this.investigateTarget) {
      this.state = 'PATROL';
      return;
    }

    const distToTarget = Math.hypot(this.investigateTarget.x - this.x, this.investigateTarget.y - this.y);
    if (distToTarget < 25) {
      this.investigateTarget = null;
      this.state = 'PATROL';
      this.waypoints = [];
      this.waypointIndex = 0;
      return;
    }

    const map = room?.map || this.map;
    if (map && (!this.waypoints || this.waypoints.length === 0 || this.waypointIndex >= this.waypoints.length)) {
      const tileSize = map.tileSize || TILE_SIZE || 40;
      const startTile = { col: Math.floor(this.x / tileSize), row: Math.floor(this.y / tileSize) };
      const goalTile = { col: Math.floor(this.investigateTarget.x / tileSize), row: Math.floor(this.investigateTarget.y / tileSize) };
      this.waypoints = this.findPath(map, startTile, goalTile);
      this.waypointIndex = 0;
    }

    this.followWaypoints(dt, room);
  }

  /**
   * PATROL state update: wander between floor waypoints
   */
  updatePatrol(dt, room) {
    const map = room?.map || this.map;
    if (!map) return;

    const tileSize = map.tileSize || TILE_SIZE || 40;

    if (!this.waypoints || this.waypoints.length === 0 || this.waypointIndex >= this.waypoints.length) {
      this.patrolTimer -= dt;
      if (this.patrolTimer <= 0) {
        this.patrolTimer = 2.0 + Math.random() * 3.0;

        let goalCol, goalRow;
        const spawns = (map.spawns || []).filter(s => s.type === 'bot' || s.type === 'player');
        if (spawns.length > 0) {
          const sp = spawns[Math.floor(Math.random() * spawns.length)];
          goalCol = sp.col;
          goalRow = sp.row;
        } else {
          goalCol = Math.floor(this.x / tileSize);
          goalRow = Math.floor(this.y / tileSize);
        }

        const startTile = { col: Math.floor(this.x / tileSize), row: Math.floor(this.y / tileSize) };
        const path = this.findPath(map, startTile, { col: goalCol, row: goalRow });
        if (path && path.length > 1) {
          this.waypoints = path;
          this.waypointIndex = 1;
        }
      }
      return;
    }

    this.followWaypoints(dt, room);
  }

  /**
   * Follows active waypoint array
   */
  followWaypoints(dt, room) {
    if (!this.waypoints || this.waypointIndex >= this.waypoints.length) return;

    const map = room?.map || this.map;
    const tileSize = map?.tileSize || TILE_SIZE || 40;
    const wp = this.waypoints[this.waypointIndex];
    const targetX = wp.col * tileSize + tileSize / 2;
    const targetY = wp.row * tileSize + tileSize / 2;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 15) {
      this.waypointIndex++;
      return;
    }

    const angle = Math.atan2(dy, dx);
    this.angle = angle;
    const stepDist = this.maxSpeed * dt;
    const moveDx = Math.cos(angle) * stepDist;
    const moveDy = Math.sin(angle) * stepDist;

    if (room && typeof room.moveWithSliding === 'function') {
      room.moveWithSliding(this, moveDx, moveDy, this.radius);
    } else {
      this.x += moveDx;
      this.y += moveDy;
    }
  }

  /**
   * RETREAT state update: move away from threats while reloading
   */
  updateRetreat(dt, room) {
    if (!this.isReloading && this.hp > 40) {
      this.state = 'PATROL';
      return;
    }

    if (this.ammo <= 0 && !this.isReloading) {
      this.reload();
    }

    let threat = null;
    if (this.currentTargetId && room) {
      threat = room.players?.get(this.currentTargetId) || room.bots?.get(this.currentTargetId);
    }

    if (threat) {
      const awayAngle = Math.atan2(this.y - threat.y, this.x - threat.x);
      this.angle = awayAngle;
      const moveDx = Math.cos(awayAngle) * this.maxSpeed * dt;
      const moveDy = Math.sin(awayAngle) * this.maxSpeed * dt;
      if (room && typeof room.moveWithSliding === 'function') {
        room.moveWithSliding(this, moveDx, moveDy, this.radius);
      } else {
        this.x += moveDx;
        this.y += moveDy;
      }
    } else {
      this.state = 'PATROL';
    }
  }
}

export default Bot;
