/**
 * Tier 2.10: Adversarial 2D Raycasting, Line-of-Sight & Degenerate Geometry Stress Suite
 * Authored by: challenger_m2_1
 * 
 * Empirically stress-tests:
 * 1. Grazing ray intersections & knife-edge corners
 * 2. Zero-distance observer/target & observer touching or lying on wall segments
 * 3. Multiple collinear and overlapping wall segments
 * 4. Dense forest of thin obstacle pillars (64 to 128 segments within FOV)
 * 5. Full 360-degree omni vs narrow slit laser FOV (0.01 deg & 0.001 deg)
 * 6. Concave rooms and non-convex occlusion volumes (L-shape, U-shape, Star-shape)
 * 7. 1,000-iteration randomized geometric fuzzing
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import {
  lineIntersection,
  pointInCone,
  isPointVisible,
  computeVisibilityPolygon,
  computeShadowVolume,
  normalizeAngle,
  angleDifference
} from '../../shared/RaycastMath.js';

export const suiteName = 'Tier 2.10: Adversarial Raycast & Degenerate Geometry Stress';

// ============================================================================
// GEOMETRIC VALIDATION HELPERS & ORACLES
// ============================================================================

function segmentsIntersectStrict(p1, p2, p3, p4) {
  function ccw(A, B, C) {
    return (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x);
  }

  const ccw1 = ccw(p1, p3, p4);
  const ccw2 = ccw(p2, p3, p4);
  const ccw3 = ccw(p1, p2, p3);
  const ccw4 = ccw(p1, p2, p4);

  if (((ccw1 > 1e-7 && ccw2 < -1e-7) || (ccw1 < -1e-7 && ccw2 > 1e-7)) &&
      ((ccw3 > 1e-7 && ccw4 < -1e-7) || (ccw3 < -1e-7 && ccw4 > 1e-7))) {
    return true;
  }
  return false;
}

function polygonSignedArea(vertices) {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return area / 2;
}

function assertValidPolygon(poly, context = '') {
  assert.ok(poly, `${context}: Polygon must exist`);
  const vertices = Array.isArray(poly) ? poly : poly.vertices;
  assert.ok(Array.isArray(vertices), `${context}: Vertices must be an array`);
  assert.ok(vertices.length >= 3, `${context}: Polygon must have >= 3 vertices (got ${vertices.length})`);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    assert.ok(v && typeof v.x === 'number' && typeof v.y === 'number', `${context}: Vertex ${i} must have numerical x,y`);
    assert.ok(Number.isFinite(v.x), `${context}: Vertex ${i}.x must be finite (got ${v.x})`);
    assert.ok(Number.isFinite(v.y), `${context}: Vertex ${i}.y must be finite (got ${v.y})`);
    assert.ok(!Number.isNaN(v.x), `${context}: Vertex ${i}.x is NaN`);
    assert.ok(!Number.isNaN(v.y), `${context}: Vertex ${i}.y is NaN`);

    if (v.angle !== undefined) {
      assert.ok(Number.isFinite(v.angle), `${context}: Vertex ${i}.angle must be finite (got ${v.angle})`);
      assert.ok(v.angle >= -Math.PI - 1e-5 && v.angle <= Math.PI + 1e-5, `${context}: Vertex ${i}.angle ${v.angle} outside [-PI, PI]`);
    }
  }

  for (let i = 0; i < vertices.length - 1; i++) {
    if (vertices[i].angle !== undefined && vertices[i + 1].angle !== undefined) {
      assert.ok(
        vertices[i + 1].angle >= vertices[i].angle - 1e-7,
        `${context}: Vertices must be radially sorted (index ${i} angle: ${vertices[i].angle}, index ${i+1} angle: ${vertices[i+1].angle})`
      );
    }
  }

  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];

      const cross = segmentsIntersectStrict(a1, a2, b1, b2);
      assert.ok(!cross, `${context}: Polygon self-intersects between edge (${i}->${(i+1)%n}) and edge (${j}->${(j+1)%n})`);
    }
  }

  const area = polygonSignedArea(vertices);
  assert.ok(Math.abs(area) > 1e-3, `${context}: Polygon area must be non-zero (got ${area})`);
}

// ============================================================================
// TEST DEFINITIONS
// ============================================================================

export const tests = [
  // Category 1: Grazing Rays
  {
    id: 'T2.10.1',
    name: 'Grazing Ray Intersections & Endpoint Proximity',
    fn: async () => {
      const obs = { x: 100, y: 100, angle: 0, fov: Math.PI / 2, range: 400 };
      const wall = { p1: { x: 250, y: 50 }, p2: { x: 250, y: 100 } };
      const targetClear = { x: 350, y: 101 };
      const targetBlocked = { x: 350, y: 99 };

      const poly = computeVisibilityPolygon(obs, [wall], obs.angle, obs.fov, obs.range);
      assertValidPolygon(poly, 'Endpoint grazing polygon');

      const visClear = isPointVisible(obs, targetClear, [wall], obs.angle, obs.fov, obs.range);
      const visBlocked = isPointVisible(obs, targetBlocked, [wall], obs.angle, obs.fov, obs.range);
      assert.strictEqual(visClear, true, 'Ray passing 1px clear of endpoint must be visible');
      assert.strictEqual(visBlocked, false, 'Ray hitting wall 1px below endpoint must be occluded');

      // Sharp knife-edge corner (acute 5-degree wedge)
      const wedgeTop = { p1: { x: 200, y: 50 }, p2: { x: 300, y: 60 } };
      const wedgeBottom = { p1: { x: 200, y: 50 }, p2: { x: 300, y: 40 } };
      const wedgePoly = computeVisibilityPolygon(obs, [wedgeTop, wedgeBottom], obs.angle, obs.fov, obs.range);
      assertValidPolygon(wedgePoly, 'Acute wedge knife-edge polygon');
    }
  },

  // Category 2: Zero-Distance & Observer Touching / Lying on Walls
  {
    id: 'T2.10.2',
    name: 'Zero-Distance Observer & Touching Wall Segments',
    fn: async () => {
      // Observer and target identical
      const obs = { x: 123.456, y: 789.012, angle: 1.2, fov: Math.PI / 3, range: 300 };
      const target = { x: 123.456, y: 789.012 };
      const walls = [{ p1: { x: 50, y: 50 }, p2: { x: 50, y: 200 } }];
      assert.strictEqual(isPointVisible(obs, target, walls, obs.angle, obs.fov, obs.range), true);

      // Observer on wall endpoint
      const obsEndpoint = { x: 100, y: 100, angle: Math.PI / 2, fov: Math.PI / 2, range: 300 };
      const wallA = { p1: { x: 100, y: 100 }, p2: { x: 200, y: 100 } };
      const visNorth = isPointVisible(obsEndpoint, { x: 100, y: 200 }, [wallA], obsEndpoint.angle, obsEndpoint.fov, obsEndpoint.range);
      assert.strictEqual(visNorth, true);
      const polyEndpoint = computeVisibilityPolygon(obsEndpoint, [wallA], obsEndpoint.angle, obsEndpoint.fov, obsEndpoint.range);
      assertValidPolygon(polyEndpoint, 'Observer on endpoint polygon');

      // Observer on wall midpoint
      const obsMid = { x: 200, y: 100, angle: -Math.PI / 2, fov: Math.PI, range: 300 };
      const wallMid = { p1: { x: 100, y: 100 }, p2: { x: 300, y: 100 } };
      const visSouth = isPointVisible(obsMid, { x: 200, y: 50 }, [wallMid], obsMid.angle, obsMid.fov, obsMid.range);
      assert.strictEqual(visSouth, true);
      const polyMid = computeVisibilityPolygon(obsMid, [wallMid], obsMid.angle, obsMid.fov, obsMid.range);
      assertValidPolygon(polyMid, 'Observer on midpoint polygon');

      // Degenerate zero-length wall
      const pointWall = { p1: { x: 150, y: 50 }, p2: { x: 150, y: 50 } };
      const polyZeroLen = computeVisibilityPolygon(obs, [pointWall], obs.angle, obs.fov, obs.range);
      assertValidPolygon(polyZeroLen, 'Zero length segment polygon');
    }
  },

  // Category 3: Collinear and Overlapping Wall Segments
  {
    id: 'T2.10.3',
    name: 'Multiple Collinear & Overlapping Wall Segments',
    fn: async () => {
      const obs = { x: 100, y: 200, angle: 0, fov: Math.PI / 2, range: 400 };
      const seg = { p1: { x: 250, y: 100 }, p2: { x: 250, y: 300 } };
      const walls = [seg, { ...seg }, { ...seg }, { ...seg }, { ...seg }];

      assert.strictEqual(isPointVisible(obs, { x: 350, y: 200 }, walls, obs.angle, obs.fov, obs.range), false);
      const polyOverlapping = computeVisibilityPolygon(obs, walls, obs.angle, obs.fov, obs.range);
      assertValidPolygon(polyOverlapping, '5 overlapping segments polygon');

      // Segmented collinear walls
      const segmentedWalls = [
        { p1: { x: 200, y: 50 }, p2: { x: 200, y: 150 } },
        { p1: { x: 200, y: 120 }, p2: { x: 200, y: 280 } },
        { p1: { x: 200, y: 250 }, p2: { x: 200, y: 350 } }
      ];
      assert.strictEqual(isPointVisible(obs, { x: 300, y: 200 }, segmentedWalls, obs.angle, obs.fov, obs.range), false);
      const polySegmented = computeVisibilityPolygon(obs, segmentedWalls, obs.angle, obs.fov, obs.range);
      assertValidPolygon(polySegmented, 'Segmented collinear walls polygon');

      // Radial collinear walls
      const radialWalls = [
        { p1: { x: 150, y: 200 }, p2: { x: 250, y: 200 } },
        { p1: { x: 280, y: 200 }, p2: { x: 380, y: 200 } }
      ];
      const polyRadial = computeVisibilityPolygon(obs, radialWalls, obs.angle, obs.fov, obs.range);
      assertValidPolygon(polyRadial, 'Radial collinear walls polygon');
    }
  },

  // Category 4: Dense Forest of Thin Obstacle Pillars (64 to 128 segments)
  {
    id: 'T2.10.4',
    name: 'Dense Obstacle Forest (64 Pillars & 128 Segments Benchmark)',
    fn: async () => {
      const obs = { x: 100, y: 300, angle: 0, fov: (Math.PI * 80) / 180, range: 500 };
      const walls = [];

      for (let col = 0; col < 8; col++) {
        for (let row = 0; row < 8; row++) {
          const px = 200 + col * 35;
          const py = 180 + row * 30;
          walls.push({
            p1: { x: px, y: py - 4 },
            p2: { x: px, y: py + 4 }
          });
        }
      }
      assert.strictEqual(walls.length, 64);

      const tStart = performance.now();
      const poly = computeVisibilityPolygon(obs, walls, obs.angle, obs.fov, obs.range);
      const elapsed = performance.now() - tStart;

      assertValidPolygon(poly, '64 pillars dense forest polygon');
      assert.ok(elapsed < 30.0, `64-pillar calculation must be < 30ms (took ${elapsed.toFixed(2)}ms)`);
    }
  },

  // Category 5: Full 360-degree Omnidirectional vs Narrow Slit Laser FOV
  {
    id: 'T2.10.5',
    name: 'Extreme Apertures: 360 Omni vs 0.01 Deg Narrow Laser FOV',
    fn: async () => {
      // Full 360 omni
      const obsOmni = { x: 300, y: 300, angle: 0, fov: 2 * Math.PI, range: 400 };
      const boxWalls = [
        { p1: { x: 100, y: 100 }, p2: { x: 500, y: 100 } },
        { p1: { x: 500, y: 100 }, p2: { x: 500, y: 500 } },
        { p1: { x: 500, y: 500 }, p2: { x: 100, y: 500 } },
        { p1: { x: 100, y: 500 }, p2: { x: 100, y: 100 } },
        { p1: { x: 250, y: 250 }, p2: { x: 350, y: 250 } }
      ];
      const polyOmni = computeVisibilityPolygon(obsOmni, boxWalls, obsOmni.angle, obsOmni.fov, obsOmni.range);
      assertValidPolygon(polyOmni, '360 omni polygon');

      // Ultra-narrow laser: 0.01 degrees = 0.0001745 rad
      const laserFov = (0.01 * Math.PI) / 180;
      const obsLaser = { x: 100, y: 100, angle: 0, fov: laserFov, range: 500 };
      assert.strictEqual(isPointVisible(obsLaser, { x: 400, y: 100 }, [], 0, laserFov, 500), true);

      const offAxisAngle = (0.02 * Math.PI) / 180;
      const offAxisTarget = { x: 100 + 300 * Math.cos(offAxisAngle), y: 100 + 300 * Math.sin(offAxisAngle) };
      assert.strictEqual(isPointVisible(obsLaser, offAxisTarget, [], 0, laserFov, 500), false);

      const polyLaser = computeVisibilityPolygon(obsLaser, [], obsLaser.angle, laserFov, obsLaser.range);
      assertValidPolygon(polyLaser, '0.01 deg laser polygon');
    }
  },

  // Category 6: Concave Rooms and Non-Convex Occlusion Volumes
  {
    id: 'T2.10.6',
    name: 'Concave Rooms & Non-Convex Geometries (L-Room, U-Corridor, Star)',
    fn: async () => {
      // L-Room
      const lWalls = [
        { p1: { x: 0, y: 0 }, p2: { x: 400, y: 0 } },
        { p1: { x: 400, y: 0 }, p2: { x: 400, y: 200 } },
        { p1: { x: 400, y: 200 }, p2: { x: 200, y: 200 } },
        { p1: { x: 200, y: 200 }, p2: { x: 200, y: 400 } },
        { p1: { x: 200, y: 400 }, p2: { x: 0, y: 400 } },
        { p1: { x: 0, y: 400 }, p2: { x: 0, y: 0 } }
      ];
      const obsL = { x: 50, y: 50, angle: 0, fov: Math.PI, range: 600 };
      assert.strictEqual(isPointVisible(obsL, { x: 350, y: 100 }, lWalls, obsL.angle, obsL.fov, obsL.range), true);
      assert.strictEqual(isPointVisible(obsL, { x: 300, y: 300 }, lWalls, obsL.angle, obsL.fov, obsL.range), false);
      const polyL = computeVisibilityPolygon(obsL, lWalls, obsL.angle, obsL.fov, obsL.range);
      assertValidPolygon(polyL, 'L-room polygon');

      // U-channel horseshoe
      const uWalls = [
        { p1: { x: 0, y: 0 }, p2: { x: 600, y: 0 } },
        { p1: { x: 600, y: 0 }, p2: { x: 600, y: 500 } },
        { p1: { x: 600, y: 500 }, p2: { x: 0, y: 500 } },
        { p1: { x: 0, y: 500 }, p2: { x: 0, y: 0 } },
        { p1: { x: 250, y: 0 }, p2: { x: 250, y: 350 } },
        { p1: { x: 250, y: 350 }, p2: { x: 350, y: 350 } },
        { p1: { x: 350, y: 350 }, p2: { x: 350, y: 0 } }
      ];
      const obsU = { x: 150, y: 200, angle: 0, fov: Math.PI, range: 600 };
      assert.strictEqual(isPointVisible(obsU, { x: 450, y: 200 }, uWalls, obsU.angle, obsU.fov, obsU.range), false);
      const polyU = computeVisibilityPolygon(obsU, uWalls, obsU.angle, obsU.fov, obsU.range);
      assertValidPolygon(polyU, 'U-channel polygon');

      // 10-pointed star
      const cx = 300, cy = 300, outerR = 250, innerR = 90;
      const starPts = [];
      for (let i = 0; i < 20; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (i / 20) * Math.PI * 2;
        starPts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      const starWalls = starPts.map((pt, i) => ({ p1: pt, p2: starPts[(i + 1) % 20] }));
      const polyStar = computeVisibilityPolygon({ x: cx, y: cy }, starWalls, 0, Math.PI * 2, 500);
      assertValidPolygon(polyStar, 'Star arena polygon');
    }
  },

  // Category 7: 1,000-Iteration Randomized Fuzzing
  {
    id: 'T2.10.7',
    name: '1,000 Randomized Geometric Fuzzing Iterations',
    fn: async () => {
      let seed = 1234567;
      function rng() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }

      for (let iter = 0; iter < 1000; iter++) {
        const obsX = -200 + rng() * 400;
        const obsY = -200 + rng() * 400;
        const angle = -Math.PI + rng() * (2 * Math.PI);
        const fov = 0.001 + rng() * (2 * Math.PI - 0.001);
        const range = 50 + rng() * 500;
        const obs = { x: obsX, y: obsY, angle, fov, range };

        const numSegs = 5 + Math.floor(rng() * 15);
        const segments = [];
        for (let s = 0; s < numSegs; s++) {
          segments.push({
            p1: { x: obsX - 250 + rng() * 500, y: obsY - 250 + rng() * 500 },
            p2: { x: obsX - 250 + rng() * 500, y: obsY - 250 + rng() * 500 }
          });
        }

        const poly = computeVisibilityPolygon(obs, segments, angle, fov, range);
        assertValidPolygon(poly, `Fuzz #${iter}`);

        const tx = obsX - 200 + rng() * 400;
        const ty = obsY - 200 + rng() * 400;
        const vis = isPointVisible(obs, { x: tx, y: ty }, segments, angle, fov, range);
        assert.strictEqual(typeof vis, 'boolean');

        const quad = computeShadowVolume({ x: obsX, y: obsY }, segments[0], range);
        assert.strictEqual(quad.length, 4);
      }
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
