/**
 * Tier 1.2: Tactical FOV & Raycaster Line-of-Sight Tests
 * Covers R2, R4 (Tactical Vision & Fog of War, Directional Lantern Cone)
 */
import assert from 'node:assert/strict';
import { runSuiteHelper, assertPolygonClosed, assertPolygonNoSelfIntersection } from '../harnesses/assert_helpers.js';
import {
  RaycastFixtures,
  analyticalIsPointVisible,
  analyticalPointInCone,
  analyticalRaySegmentIntersection
} from '../fixtures/raycast.fixture.js';

export const suiteName = 'Tier 1.2: Tactical FOV & Raycaster Line-of-Sight';

export const tests = [
  {
    id: 'T1.2.1',
    name: 'Unobstructed Target Detection',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const isPointVisible = raycastModule.isPointVisible;
      assert.strictEqual(typeof isPointVisible, 'function', 'RaycastMath must export isPointVisible');

      const observer = { x: 100, y: 100, angle: 0, fov: Math.PI / 3, range: 300 };
      const target = { x: 200, y: 100 };
      const segments = []; // No walls

      // Authoritative expected output from analytical oracle
      const expected = analyticalIsPointVisible(observer, target, segments, observer.angle, observer.fov, observer.range);
      assert.strictEqual(expected, true, 'Oracle confirms clear LoS');

      const actual = isPointVisible(observer, target, segments, observer.angle, observer.fov, observer.range);
      assert.strictEqual(actual, true, 'Unobstructed target inside FOV cone must be visible');
    }
  },

  {
    id: 'T1.2.2',
    name: 'Solid Wall Line-of-Sight Occlusion',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const isPointVisible = raycastModule.isPointVisible;
      const observer = { x: 100, y: 100, angle: 0, fov: Math.PI / 3, range: 400 };
      const target = { x: 300, y: 100 };
      // Solid vertical wall at x = 200 between y = 50 and y = 150
      const segments = [
        { p1: { x: 200, y: 50 }, p2: { x: 200, y: 150 } }
      ];

      const expected = analyticalIsPointVisible(observer, target, segments, observer.angle, observer.fov, observer.range);
      assert.strictEqual(expected, false, 'Oracle confirms target is occluded by wall');

      const actual = isPointVisible(observer, target, segments, observer.angle, observer.fov, observer.range);
      assert.strictEqual(actual, false, 'Target behind solid wall must be occluded (invisible)');
    }
  },

  {
    id: 'T1.2.3',
    name: 'Angular Cone Bound Clipping',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const observer = { x: 100, y: 100, angle: 0, fov: Math.PI / 3, range: 300 }; // Half-cone is 30 deg (PI/6)
      // Target at 45 deg angle (PI/4 rad), distance 150px
      const dist = 150;
      const target = {
        x: 100 + dist * Math.cos(Math.PI / 4),
        y: 100 + dist * Math.sin(Math.PI / 4)
      };

      const expected = analyticalPointInCone(observer, target, observer.angle, observer.fov, observer.range);
      assert.strictEqual(expected, false, 'Oracle confirms target is outside cone arc');

      const isVisibleFn = raycastModule.isPointVisible;
      const actual = isVisibleFn(observer, target, [], observer.angle, observer.fov, observer.range);
      assert.strictEqual(actual, false, 'Target outside lantern cone angle must not be visible');
    }
  },

  {
    id: 'T1.2.4',
    name: 'Distance Attenuation Bound',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const range = 250;
      const observer = { x: 100, y: 100, angle: 0, fov: Math.PI / 2, range };
      // Target at distance 251px along beam axis (angle = 0)
      const targetOutside = { x: 100 + 251, y: 100 };
      const targetInside = { x: 100 + 249, y: 100 };

      const isVisibleFn = raycastModule.isPointVisible;

      assert.strictEqual(
        isVisibleFn(observer, targetOutside, [], observer.angle, observer.fov, observer.range),
        false,
        'Target beyond maximum lantern range must be invisible'
      );

      assert.strictEqual(
        isVisibleFn(observer, targetInside, [], observer.angle, observer.fov, observer.range),
        true,
        'Target within maximum lantern range must be visible'
      );
    }
  },

  {
    id: 'T1.2.5',
    name: 'Visibility Polygon Generation',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const computePoly = raycastModule.computeVisibilityPolygon;
      assert.strictEqual(typeof computePoly, 'function', 'RaycastMath must export computeVisibilityPolygon');

      const fixture = RaycastFixtures.roomWithPillar;
      const observer = { x: 100, y: 300, angle: 0, fov: (Math.PI * 80) / 180, range: 450 };

      const poly = computePoly(observer, fixture.walls, observer.angle, observer.fov, observer.range);

      assert.ok(poly, 'Visibility polygon must be returned');
      const vertices = Array.isArray(poly) ? poly : poly.vertices;
      assert.ok(Array.isArray(vertices), 'Vertices must be an array');
      assert.ok(vertices.length >= 3, `Polygon must have at least 3 vertices (got ${vertices.length})`);

      // Verify closed and non-self-intersecting
      assertPolygonClosed(vertices, 'Visibility polygon must be closed');
      assertPolygonNoSelfIntersection(vertices, 'Visibility polygon must not self-intersect');
    }
  },

  {
    id: 'T1.2.6',
    name: 'Shadow Volume Polygon Generation',
    fn: async () => {
      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const computeShadow = raycastModule.computeShadowVolume;
      assert.strictEqual(typeof computeShadow, 'function', 'RaycastMath must export computeShadowVolume');

      const lightPos = { x: 100, y: 200 };
      const segment = { p1: { x: 300, y: 150 }, p2: { x: 300, y: 250 } };
      const maxRange = 500;

      const shadowQuad = computeShadow(lightPos, segment, maxRange);
      assert.ok(Array.isArray(shadowQuad), 'Shadow volume must be an array of vertices');
      assert.ok(shadowQuad.length >= 4, `Shadow quad must have at least 4 vertices (got ${shadowQuad.length})`);

      assertPolygonClosed(shadowQuad, 'Shadow volume must form a valid closed polygon');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
