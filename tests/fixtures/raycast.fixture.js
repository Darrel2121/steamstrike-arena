/**
 * Canonical 2D Raycasting Fixtures & Analytical Ground Truth Oracle
 * Provides mathematical line-segment setups with verified LoS and visibility polygon expectations.
 */

/**
 * Analytical 2D ray-segment intersection calculation.
 * Ray: P(t) = O + t*D, t >= 0
 * Segment: S(u) = A + u*(B - A), 0 <= u <= 1
 * @param {{x: number, y: number}} origin
 * @param {{x: number, y: number}} dir - Normalized or unnormalized direction vector
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {{hit: boolean, t: number, u: number, point: {x: number, y: number}|null}}
 */
export function analyticalRaySegmentIntersection(origin, dir, p1, p2) {
  const dx = dir.x;
  const dy = dir.y;
  const segDx = p2.x - p1.x;
  const segDy = p2.y - p1.y;

  const denom = dx * segDy - dy * segDx;
  if (Math.abs(denom) < 1e-9) {
    return { hit: false, t: Infinity, u: 0, point: null }; // Parallel or collinear
  }

  const oxDiff = p1.x - origin.x;
  const oyDiff = p1.y - origin.y;

  const t = (oxDiff * segDy - oyDiff * segDx) / denom;
  const u = (oxDiff * dy - oyDiff * dx) / denom;

  if (t >= -1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return {
      hit: true,
      t: Math.max(0, t),
      u: Math.min(1, Math.max(0, u)),
      point: {
        x: p1.x + u * segDx,
        y: p1.y + u * segDy
      }
    };
  }

  return { hit: false, t: Infinity, u: 0, point: null };
}

/**
 * Analytical check for whether target is within directional angular cone and range.
 * @param {{x: number, y: number}} origin
 * @param {{x: number, y: number}} target
 * @param {number} aimAngle - In radians
 * @param {number} fov - Total cone angle in radians
 * @param {number} range - Max distance
 * @returns {boolean}
 */
export function analyticalPointInCone(origin, target, aimAngle, fov, range) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distSq = dx * dx + dy * dy;

  if (distSq > range * range) return false;
  if (distSq < 1e-6) return true; // At origin

  const targetAngle = Math.atan2(dy, dx);
  const angleDiff = Math.abs(((targetAngle - aimAngle + Math.PI) % (2 * Math.PI)) - Math.PI);

  return angleDiff <= fov / 2 + 1e-5;
}

/**
 * Analytical ground truth solver for whether target is visible to observer.
 * @param {{x: number, y: number}} origin
 * @param {{x: number, y: number}} target
 * @param {Array<{p1: {x: number, y: number}, p2: {x: number, y: number}}>} segments
 * @param {number} aimAngle
 * @param {number} fov
 * @param {number} range
 * @returns {boolean}
 */
export function analyticalIsPointVisible(origin, target, segments, aimAngle, fov, range) {
  // 1. Check cone and range
  if (!analyticalPointInCone(origin, target, aimAngle, fov, range)) {
    return false;
  }

  // 2. Check line-of-sight segment obstruction
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return true;

  const dir = { x: dx / dist, y: dy / dist };

  for (const seg of segments) {
    const isect = analyticalRaySegmentIntersection(origin, dir, seg.p1, seg.p2);
    // If an intersection occurs before target distance (with small epsilon)
    if (isect.hit && isect.t > 1e-4 && isect.t < dist - 1e-4) {
      return false; // Occluded by segment
    }
  }

  return true;
}

/**
 * Canonical Raycasting Fixture Suites
 */
export const RaycastFixtures = {
  // Scenario 1: Standard Room with Central Pillar (from TEST_INFRA.md and survey handoff 3)
  roomWithPillar: {
    bounds: { width: 800, height: 600 },
    walls: [
      // Outer boundaries
      { p1: { x: 0, y: 0 }, p2: { x: 800, y: 0 } },
      { p1: { x: 800, y: 0 }, p2: { x: 800, y: 600 } },
      { p1: { x: 800, y: 600 }, p2: { x: 0, y: 600 } },
      { p1: { x: 0, y: 600 }, p2: { x: 0, y: 0 } },
      // Central solid pillar (100x100)
      { p1: { x: 350, y: 250 }, p2: { x: 450, y: 250 } },
      { p1: { x: 450, y: 250 }, p2: { x: 450, y: 350 } },
      { p1: { x: 450, y: 350 }, p2: { x: 350, y: 350 } },
      { p1: { x: 350, y: 350 }, p2: { x: 350, y: 250 } }
    ],
    testCases: [
      {
        id: 'direct_los_clear',
        observer: { x: 100, y: 300, angle: 0, fov: Math.PI / 3, range: 400 },
        target: { x: 300, y: 300 },
        expectedVisible: true,
        reason: 'Unobstructed target inside FOV cone'
      },
      {
        id: 'target_behind_pillar_occluded',
        observer: { x: 100, y: 300, angle: 0, fov: Math.PI / 3, range: 600 },
        target: { x: 500, y: 300 },
        expectedVisible: false,
        reason: 'Pillar intersects line-of-sight between observer and target'
      },
      {
        id: 'target_outside_cone_angle',
        observer: { x: 100, y: 300, angle: 0, fov: Math.PI / 4, range: 400 },
        target: { x: 200, y: 500 }, // Angle ~ 63 deg > 22.5 deg half-cone
        expectedVisible: false,
        reason: 'Target is outside angular cone aperture'
      },
      {
        id: 'target_beyond_lantern_range',
        observer: { x: 100, y: 300, angle: 0, fov: Math.PI / 2, range: 150 },
        target: { x: 300, y: 300 }, // Distance = 200 > 150
        expectedVisible: false,
        reason: 'Target exceeds lantern beam maximum illumination distance'
      },
      {
        id: 'grazing_corner_sightline',
        observer: { x: 100, y: 200, angle: Math.atan2(50, 250), fov: Math.PI / 2, range: 500 },
        target: { x: 451, y: 249 }, // Just above pillar top-left corner
        expectedVisible: true,
        reason: 'Ray passes 1 pixel clear of corner vertex'
      }
    ]
  },

  // Scenario 2: L-Shaped Corridor
  corridorRoom: {
    bounds: { width: 600, height: 600 },
    walls: [
      { p1: { x: 0, y: 0 }, p2: { x: 600, y: 0 } },
      { p1: { x: 600, y: 0 }, p2: { x: 600, y: 600 } },
      { p1: { x: 600, y: 600 }, p2: { x: 0, y: 600 } },
      { p1: { x: 0, y: 600 }, p2: { x: 0, y: 0 } },
      // Interior corner dividing wall
      { p1: { x: 200, y: 0 }, p2: { x: 200, y: 400 } },
      { p1: { x: 200, y: 400 }, p2: { x: 400, y: 400 } }
    ]
  }
};
