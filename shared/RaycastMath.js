/**
 * Steampunk Tactical FOV & Raycaster Line-of-Sight Math Engine
 * High-performance 2D raycasting, visibility polygon computation,
 * directional lantern line-of-sight checks, and acoustic line-segment math.
 */

import {
  LANTERN_FOV_RAD,
  LANTERN_FOV_HALF,
  LANTERN_RANGE,
  PROXIMITY_RADIUS
} from './Constants.js';

/**
 * Normalizes an angle into the [-PI, PI] range.
 * @param {number} angle
 * @returns {number}
 */
export function normalizeAngle(angle) {
  let a = (angle + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Calculates shortest angular difference between two angles in radians.
 * Result is in range [0, PI].
 * @param {number} a1
 * @param {number} a2
 * @returns {number}
 */
export function angleDifference(a1, a2) {
  return Math.abs(normalizeAngle(a1 - a2));
}

/**
 * Ray vs Line Segment intersection test using the 2D determinant method.
 * Supports both 8-scalar signature (rx, ry, rdx, rdy, ax, ay, bx, by)
 * and 4-object signature (origin, dir, p1, p2).
 * 
 * @param {number|Object} rx - Ray origin X or origin object {x, y}
 * @param {number|Object} ry - Ray origin Y or dir object {x, y}
 * @param {number|Object} rdx - Ray direction X or segment p1 {x, y}
 * @param {number|Object} rdy - Ray direction Y or segment p2 {x, y}
 * @param {number} [ax] - Segment start X
 * @param {number} [ay] - Segment start Y
 * @param {number} [bx] - Segment end X
 * @param {number} [by] - Segment end Y
 * @returns {{ hit: boolean, t: number, u: number, distance: number, x: number, y: number, point: { x: number, y: number } } | null}
 */
export function lineIntersection(rx, ry, rdx, rdy, ax, ay, bx, by) {
  let ox, oy, dx, dy, sx1, sy1, sx2, sy2;

  if (typeof rx === 'object' && rx !== null) {
    ox = rx.x;
    oy = rx.y;
    dx = ry.x;
    dy = ry.y;
    sx1 = rdx.x;
    sy1 = rdx.y;
    sx2 = rdy.x;
    sy2 = rdy.y;
  } else {
    ox = rx;
    oy = ry;
    dx = rdx;
    dy = rdy;
    sx1 = ax;
    sy1 = ay;
    sx2 = bx;
    sy2 = by;
  }

  const segDx = sx2 - sx1;
  const segDy = sy2 - sy1;

  // Determinant: cross product of direction and segment
  const det = dx * segDy - dy * segDx;
  if (Math.abs(det) < 1e-9) {
    return null; // Collinear or parallel
  }

  const oxDiff = sx1 - ox;
  const oyDiff = sy1 - oy;

  const t = (oxDiff * segDy - oyDiff * segDx) / det;
  const u = (oxDiff * dy - oyDiff * dx) / det;

  // Allow floating point tolerance
  if (t >= -1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    const clampedT = Math.max(0, t);
    const clampedU = Math.min(1, Math.max(0, u));
    const hitX = sx1 + clampedU * segDx;
    const hitY = sy1 + clampedU * segDy;
    return {
      hit: true,
      t: clampedT,
      u: clampedU,
      distance: clampedT,
      x: hitX,
      y: hitY,
      point: { x: hitX, y: hitY }
    };
  }

  return null;
}

/**
 * Checks whether a target point is within the observer's directional cone and maximum range.
 * Supports flexible call signatures:
 * (origin, target, aimAngle, fov, range) OR (origin, aimAngle, fovHalf, target, range).
 *
 * @param {{x: number, y: number}} origin
 * @param {any} arg2
 * @param {any} arg3
 * @param {any} arg4
 * @param {number} [arg5]
 * @returns {boolean}
 */
export function pointInCone(origin, arg2, arg3, arg4, arg5) {
  let target, aimAngle, fovHalf, range;

  if (arg2 && typeof arg2 === 'object' && typeof arg2.x === 'number') {
    // Signature: (origin, target, aimAngle, fov, range)
    target = arg2;
    aimAngle = arg3 ?? 0;
    const fov = arg4 ?? Math.PI * 2;
    fovHalf = fov / 2;
    range = arg5 ?? Infinity;
  } else {
    // Signature: (origin, aimAngle, fovHalf, target, range)
    aimAngle = arg2 ?? 0;
    fovHalf = arg3 ?? Math.PI;
    target = arg4;
    range = arg5 ?? Infinity;
  }

  if (!origin || !target) return false;

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distSq = dx * dx + dy * dy;

  if (distSq > range * range) return false;
  if (distSq < 1e-6) return true; // Observer is looking at exact self coordinate

  // 360-degree omnidirectional check
  if (fovHalf >= Math.PI - 1e-5) return true;

  const targetAngle = Math.atan2(dy, dx);
  const diff = angleDifference(targetAngle, aimAngle);

  return diff <= fovHalf + 1e-5;
}

/**
 * Analytical line-of-sight test determining whether an observer can see a target point.
 * Checks:
 * 1. Target distance <= range
 * 2. Target within directional FOV cone
 * 3. Line of sight between observer and target is unobstructed by intervening wall segments.
 *
 * @param {{x: number, y: number, angle?: number, fov?: number, range?: number}} observer
 * @param {{x: number, y: number}} target
 * @param {Array<Object>} segments - Array of segments {p1, p2} or {a, b}
 * @param {number} [aimAngle]
 * @param {number} [fov]
 * @param {number} [range]
 * @returns {boolean}
 */
export function isPointVisible(observer, target, segments = [], aimAngle, fov, range) {
  if (!observer || !target) return false;

  const effectiveAngle = aimAngle !== undefined ? aimAngle : (observer.angle ?? 0);
  const effectiveFov = fov !== undefined ? fov : (observer.fov ?? LANTERN_FOV_RAD);
  const effectiveRange = range !== undefined ? range : (observer.range ?? LANTERN_RANGE);

  // 1. Angular cone & range check
  if (!pointInCone(observer, target, effectiveAngle, effectiveFov, effectiveRange)) {
    return false;
  }

  // 2. Obstacle line-of-sight check
  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const dist = Math.hypot(dx, dy);

  // If observer and target are at identical position
  if (dist < 1e-4) return true;

  const dirX = dx / dist;
  const dirY = dy / dist;

  // Intersect ray with all segments
  for (const seg of segments) {
    const ax = seg.p1 ? seg.p1.x : (seg.a ? seg.a.x : seg[0].x);
    const ay = seg.p1 ? seg.p1.y : (seg.a ? seg.a.y : seg[0].y);
    const bx = seg.p2 ? seg.p2.x : (seg.b ? seg.b.x : seg[1].x);
    const by = seg.p2 ? seg.p2.y : (seg.b ? seg.b.y : seg[1].y);

    const hit = lineIntersection(observer.x, observer.y, dirX, dirY, ax, ay, bx, by);
    // If an intersection occurs strictly between observer and target
    if (hit && hit.t > 1e-4 && hit.t < dist - 1e-4) {
      return false; // Occluded
    }
  }

  return true;
}

/**
 * Computes a closed 2D visibility polygon representing the unoccluded vision area.
 * Casts rays to segment endpoints +/- epsilon (0.0001 rad), adds boundary rays,
 * finds nearest obstacle intersections, sorts vertices radially in [-PI, PI],
 * and returns the ordered polygon vertices.
 *
 * @param {{x: number, y: number, angle?: number, fov?: number, range?: number}} origin
 * @param {Array<Object>} segments
 * @param {Object|number} [options] - Options object OR aimAngle
 * @param {number} [fovArg]
 * @param {number} [rangeArg]
 * @returns {Array<{x: number, y: number, angle: number}>} Ordered polygon vertices
 */
export function computeVisibilityPolygon(origin, segments = [], options, fovArg, rangeArg) {
  const ox = origin.x;
  const oy = origin.y;

  let aimAngle, fov, maxRange;

  if (typeof options === 'object' && options !== null) {
    aimAngle = options.aimAngle ?? options.angle ?? origin.angle ?? 0;
    fov = options.fov ?? origin.fov ?? LANTERN_FOV_RAD;
    maxRange = options.range ?? options.maxRange ?? origin.range ?? LANTERN_RANGE;
  } else if (typeof options === 'number') {
    aimAngle = options;
    fov = fovArg ?? origin.fov ?? LANTERN_FOV_RAD;
    maxRange = rangeArg ?? origin.range ?? LANTERN_RANGE;
  } else {
    aimAngle = origin.angle ?? 0;
    fov = origin.fov ?? LANTERN_FOV_RAD;
    maxRange = origin.range ?? LANTERN_RANGE;
  }

  const eps = 0.0001; // Epsilon for grazing rays
  const uniqueAngles = new Set();

  // Create bounding box segments at maxRange around the observer
  const boundSegments = [];

  // Convert input segments into normalized { ax, ay, bx, by }
  for (const seg of segments) {
    const ax = seg.p1 ? seg.p1.x : (seg.a ? seg.a.x : seg[0].x);
    const ay = seg.p1 ? seg.p1.y : (seg.a ? seg.a.y : seg[0].y);
    const bx = seg.p2 ? seg.p2.x : (seg.b ? seg.b.x : seg[1].x);
    const by = seg.p2 ? seg.p2.y : (seg.b ? seg.b.y : seg[1].y);
    boundSegments.push({ ax, ay, bx, by });
  }

  // Bounding box segments enclosing maxRange
  const rBound = maxRange * 1.05;
  const bbTL = { x: ox - rBound, y: oy - rBound };
  const bbTR = { x: ox + rBound, y: oy - rBound };
  const bbBR = { x: ox + rBound, y: oy + rBound };
  const bbBL = { x: ox - rBound, y: oy + rBound };

  boundSegments.push(
    { ax: bbTL.x, ay: bbTL.y, bx: bbTR.x, by: bbTR.y },
    { ax: bbTR.x, ay: bbTR.y, bx: bbBR.x, by: bbBR.y },
    { ax: bbBR.x, ay: bbBR.y, bx: bbBL.x, by: bbBL.y },
    { ax: bbBL.x, ay: bbBL.y, bx: bbTL.x, by: bbTL.y }
  );

  // 1. Regular 360-degree circle rays to ensure smooth circular perimeter
  const numCircleRays = 36;
  for (let i = 0; i < numCircleRays; i++) {
    const a = -Math.PI + (i / numCircleRays) * (2 * Math.PI);
    uniqueAngles.add(normalizeAngle(a));
  }

  // 2. Add boundary cone rays
  const fovHalf = fov / 2;
  uniqueAngles.add(normalizeAngle(aimAngle - fovHalf - eps));
  uniqueAngles.add(normalizeAngle(aimAngle - fovHalf));
  uniqueAngles.add(normalizeAngle(aimAngle - fovHalf + eps));
  uniqueAngles.add(normalizeAngle(aimAngle));
  uniqueAngles.add(normalizeAngle(aimAngle + fovHalf - eps));
  uniqueAngles.add(normalizeAngle(aimAngle + fovHalf));
  uniqueAngles.add(normalizeAngle(aimAngle + fovHalf + eps));

  // 3. Rays towards segment endpoints within range (+/- epsilon)
  for (const seg of boundSegments) {
    for (const pt of [{ x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by }]) {
      const d = Math.hypot(pt.x - ox, pt.y - oy);
      if (d <= maxRange * 1.5) {
        const angle = Math.atan2(pt.y - oy, pt.x - ox);
        uniqueAngles.add(normalizeAngle(angle - eps));
        uniqueAngles.add(normalizeAngle(angle));
        uniqueAngles.add(normalizeAngle(angle + eps));
      }
    }
  }

  // Sort angles radially in ascending order [-PI, PI]
  const sortedAngles = Array.from(uniqueAngles).sort((a, b) => a - b);
  const polygonPoints = [];

  for (const angle of sortedAngles) {
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);
    let minT = maxRange;
    let hitPoint = { x: ox + maxRange * rdx, y: oy + maxRange * rdy };

    for (const seg of boundSegments) {
      const hit = lineIntersection(ox, oy, rdx, rdy, seg.ax, seg.ay, seg.bx, seg.by);
      if (hit && hit.t > 1e-4 && hit.t < minT) {
        minT = hit.t;
        hitPoint = { x: hit.x, y: hit.y };
      }
    }

    polygonPoints.push({
      x: hitPoint.x,
      y: hitPoint.y,
      angle
    });
  }

  // Filter redundant adjacent vertices that are virtually identical (< 0.05px)
  const filteredVertices = [];
  for (let i = 0; i < polygonPoints.length; i++) {
    const current = polygonPoints[i];
    const prev = filteredVertices[filteredVertices.length - 1];
    if (!prev || Math.hypot(current.x - prev.x, current.y - prev.y) > 0.05) {
      filteredVertices.push(current);
    }
  }

  // Ensure first and last are not duplicates
  if (
    filteredVertices.length > 2 &&
    Math.hypot(
      filteredVertices[0].x - filteredVertices[filteredVertices.length - 1].x,
      filteredVertices[0].y - filteredVertices[filteredVertices.length - 1].y
    ) <= 0.05
  ) {
    filteredVertices.pop();
  }

  // Attach vertices property for callers expecting { vertices: [...] }
  filteredVertices.vertices = filteredVertices;
  return filteredVertices;
}

/**
 * Computes a 2D shadow volume quad cast by a line segment blocker from a light point.
 * Vertices form a closed, non-self-intersecting quadrilateral extending to maxRange.
 *
 * @param {{x: number, y: number}} lightPos
 * @param {{p1?: {x: number, y: number}, p2?: {x: number, y: number}, a?: {x: number, y: number}, b?: {x: number, y: number}}} segment
 * @param {number} [maxRange=1000]
 * @returns {Array<{x: number, y: number}>} Quad vertices [P1, P2, P2_far, P1_far]
 */
export function computeShadowVolume(lightPos, segment, maxRange = 1000) {
  const p1 = segment.p1 || segment.a;
  const p2 = segment.p2 || segment.b;

  const d1x = p1.x - lightPos.x;
  const d1y = p1.y - lightPos.y;
  const dist1 = Math.hypot(d1x, d1y);
  const dir1 = dist1 > 1e-6 ? { x: d1x / dist1, y: d1y / dist1 } : { x: 1, y: 0 };
  const p1Far = {
    x: p1.x + dir1.x * maxRange,
    y: p1.y + dir1.y * maxRange
  };

  const d2x = p2.x - lightPos.x;
  const d2y = p2.y - lightPos.y;
  const dist2 = Math.hypot(d2x, d2y);
  const dir2 = dist2 > 1e-6 ? { x: d2x / dist2, y: d2y / dist2 } : { x: 1, y: 0 };
  const p2Far = {
    x: p2.x + dir2.x * maxRange,
    y: p2.y + dir2.y * maxRange
  };

  // Form closed loop: p1 -> p2 -> p2Far -> p1Far
  const quad = [
    { x: p1.x, y: p1.y },
    { x: p2.x, y: p2.y },
    { x: p2Far.x, y: p2Far.y },
    { x: p1Far.x, y: p1Far.y }
  ];

  quad.vertices = quad;
  return quad;
}
