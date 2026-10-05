/**
 * Server Physics & Continuous Collision Detection (CCD) Engine
 * Implements continuous ray-circle, ray-segment intersections,
 * and projectile hit prioritization against solid walls and combatants.
 */

import { PLAYER_RADIUS } from '../../shared/Constants.js';

/**
 * Continuous ray vs circle intersection test.
 * Ray from rayStart to rayEnd against circle (x, y, radius).
 *
 * @param {{ x: number, y: number }} rayStart
 * @param {{ x: number, y: number }} rayEnd
 * @param {{ x: number, y: number, radius?: number }} circle
 * @returns {{ hit: boolean, point?: { x: number, y: number }, distance?: number, t?: number }}
 */
export function rayCircleIntersection(rayStart, rayEnd, circle) {
  if (!rayStart || !rayEnd || !circle) return { hit: false };

  const dx = rayEnd.x - rayStart.x;
  const dy = rayEnd.y - rayStart.y;
  const lenSq = dx * dx + dy * dy;
  const radius = circle.radius ?? PLAYER_RADIUS ?? 16;

  // Vector from circle center to rayStart: m = rayStart - C
  const mx = rayStart.x - circle.x;
  const my = rayStart.y - circle.y;
  const startDistSq = mx * mx + my * my;

  // If ray starts inside the circle
  if (startDistSq <= radius * radius) {
    return {
      hit: true,
      point: { x: rayStart.x, y: rayStart.y },
      distance: 0,
      t: 0
    };
  }

  // Degenerate zero-length ray
  if (lenSq < 1e-9) {
    return { hit: false };
  }

  // Quadratic coefficients: A*t^2 + B*t + C = 0
  const A = lenSq;
  const B = 2 * (mx * dx + my * dy);
  const C = startDistSq - radius * radius;

  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) {
    return { hit: false };
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-B - sqrtDisc) / (2 * A);
  const t2 = (-B + sqrtDisc) / (2 * A);

  // If both intersection points lie outside [0, 1]
  if (t2 < 0 || t1 > 1) {
    return { hit: false };
  }

  // First contact parameter along segment [0, 1]
  const tHit = t1 >= 0 ? t1 : 0;
  const hitX = rayStart.x + tHit * dx;
  const hitY = rayStart.y + tHit * dy;
  const distance = tHit * Math.sqrt(lenSq);

  return {
    hit: true,
    point: { x: hitX, y: hitY },
    distance,
    t: tHit
  };
}

export const checkCircleCollision = rayCircleIntersection;

/**
 * Line segment vs Line segment intersection test.
 * Segment 1 (bullet path): p1 to p2.
 * Segment 2 (wall): segP1 to segP2.
 *
 * Supports flexible call patterns:
 * - (p1, p2, segP1, segP2)
 * - (rayObj, wallObj) where rayObj is { start, end } or { p1, p2 } and wallObj is { p1, p2 } or { a, b }
 *
 * @param {Object} p1
 * @param {Object} p2
 * @param {Object} [segP1]
 * @param {Object} [segP2]
 * @returns {{ hit: boolean, point?: { x: number, y: number }, distance?: number, t?: number, u?: number }}
 */
export function raySegmentIntersection(p1, p2, segP1, segP2) {
  let rayA, rayB, wallA, wallB;

  if (p1 && p1.start && p1.end) {
    rayA = p1.start;
    rayB = p1.end;
    const w = p2 || {};
    wallA = w.p1 || w.a || (Array.isArray(w) ? w[0] : null) || segP1;
    wallB = w.p2 || w.b || (Array.isArray(w) ? w[1] : null) || segP2;
  } else if (p1 && p1.p1 && p1.p2 && (!segP1 || !segP2)) {
    rayA = p1.p1;
    rayB = p1.p2;
    const w = p2 || {};
    wallA = w.p1 || w.a || (Array.isArray(w) ? w[0] : null) || segP1;
    wallB = w.p2 || w.b || (Array.isArray(w) ? w[1] : null) || segP2;
  } else {
    rayA = p1;
    rayB = p2;
    if (segP1 && (segP1.p1 || segP1.a)) {
      wallA = segP1.p1 || segP1.a;
      wallB = segP1.p2 || segP1.b;
    } else {
      wallA = segP1;
      wallB = segP2;
    }
  }

  if (!rayA || !rayB || !wallA || !wallB) return { hit: false };

  const dx1 = rayB.x - rayA.x;
  const dy1 = rayB.y - rayA.y;
  const dx2 = wallB.x - wallA.x;
  const dy2 = wallB.y - wallA.y;

  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < 1e-9) {
    return { hit: false }; // Parallel or collinear
  }

  const ox = wallA.x - rayA.x;
  const oy = wallA.y - rayA.y;

  const t = (ox * dy2 - oy * dx2) / det;
  const u = (ox * dy1 - oy * dx1) / det;

  const eps = 1e-6;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    const clampedT = Math.max(0, Math.min(1, t));
    const clampedU = Math.max(0, Math.min(1, u));

    const hitX = wallA.x + clampedU * dx2;
    const hitY = wallA.y + clampedU * dy2;
    const distance = clampedT * Math.hypot(dx1, dy1);

    return {
      hit: true,
      point: { x: hitX, y: hitY },
      distance,
      t: clampedT,
      u: clampedU
    };
  }

  return { hit: false };
}

export const checkSegmentCollision = raySegmentIntersection;

/**
 * Solves bullet trajectory hit against wall segments and combatant hitboxes,
 * enforcing strict wall occlusion priority over players behind walls (T3.4).
 *
 * @param {{ start?: {x, y}, end?: {x, y}, p1?: {x, y}, p2?: {x, y} }} bulletRay
 * @param {Array<Object>|Iterable<Object>} walls - Wall line segments [{ p1, p2 }]
 * @param {Array<Object>|Iterable<Object>} players - Combatants [{ id, x, y, radius, hp, isAlive }]
 * @param {Object} [options]
 * @param {string} [options.shooterId]
 * @returns {{ hit: boolean, type: 'wall'|'player'|null, blocked: boolean, point?: Object, distance?: number, target?: Object, targetId?: string, wall?: Object }}
 */
export function solveProjectileHit(bulletRay, walls = [], players = [], options = {}) {
  const p1 = bulletRay.start || bulletRay.p1;
  const p2 = bulletRay.end || bulletRay.p2;
  const shooterId = options.shooterId || bulletRay.shooterId || null;

  if (!p1 || !p2) {
    return { hit: false, type: null, blocked: false };
  }

  // 1. Find closest wall collision
  let closestWall = null;
  let minWallDist = Infinity;

  const wallIterable = walls.values ? Array.from(walls.values()) : Array.from(walls);
  for (const wall of wallIterable) {
    const w1 = wall.p1 || wall.a || (Array.isArray(wall) ? wall[0] : null);
    const w2 = wall.p2 || wall.b || (Array.isArray(wall) ? wall[1] : null);
    if (!w1 || !w2) continue;

    const hit = raySegmentIntersection(p1, p2, w1, w2);
    if (hit && hit.hit && hit.distance < minWallDist) {
      minWallDist = hit.distance;
      closestWall = {
        hit,
        wall,
        distance: hit.distance,
        point: hit.point,
        t: hit.t
      };
    }
  }

  // 2. Find closest target collision (excluding shooter and dead entities)
  let closestPlayer = null;
  let minPlayerDist = Infinity;

  const playerIterable = players.values ? Array.from(players.values()) : Array.from(players);
  for (const player of playerIterable) {
    if (shooterId && player.id === shooterId) continue;
    if (player.isAlive === false || (typeof player.hp === 'number' && player.hp <= 0)) continue;

    const radius = player.radius ?? PLAYER_RADIUS ?? 16;
    const hit = rayCircleIntersection(p1, p2, { x: player.x, y: player.y, radius });
    if (hit && hit.hit && hit.distance < minPlayerDist) {
      minPlayerDist = hit.distance;
      closestPlayer = {
        hit,
        player,
        distance: hit.distance,
        point: hit.point,
        t: hit.t
      };
    }
  }

  // 3. Evaluate Priority: Solid walls block players behind them (T3.4)
  if (closestWall && closestPlayer) {
    if (closestWall.distance <= closestPlayer.distance) {
      return {
        hit: true,
        type: 'wall',
        blocked: true,
        point: closestWall.point,
        distance: closestWall.distance,
        t: closestWall.t,
        wall: closestWall.wall
      };
    } else {
      return {
        hit: true,
        type: 'player',
        blocked: false,
        point: closestPlayer.point,
        distance: closestPlayer.distance,
        t: closestPlayer.t,
        target: closestPlayer.player,
        targetId: closestPlayer.player.id
      };
    }
  }

  if (closestWall) {
    return {
      hit: true,
      type: 'wall',
      blocked: true,
      point: closestWall.point,
      distance: closestWall.distance,
      t: closestWall.t,
      wall: closestWall.wall
    };
  }

  if (closestPlayer) {
    return {
      hit: true,
      type: 'player',
      blocked: false,
      point: closestPlayer.point,
      distance: closestPlayer.distance,
      t: closestPlayer.t,
      target: closestPlayer.player,
      targetId: closestPlayer.player.id
    };
  }

  return { hit: false, type: null, blocked: false };
}

export const checkBulletHits = solveProjectileHit;
export default {
  rayCircleIntersection,
  checkCircleCollision,
  raySegmentIntersection,
  checkSegmentCollision,
  solveProjectileHit,
  checkBulletHits
};
