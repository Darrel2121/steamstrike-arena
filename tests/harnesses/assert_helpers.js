/**
 * Mathematical & Geometric Assertion Helpers for Steampunk Tactical Shooter
 * Zero external dependencies. Uses Node.js native assert where appropriate.
 */
import assert from 'node:assert/strict';

/**
 * Asserts that two numbers are within epsilon tolerance of each other.
 * @param {number} actual
 * @param {number} expected
 * @param {number} [epsilon=1e-4]
 * @param {string} [msg]
 */
export function assertEpsilon(actual, expected, epsilon = 1e-4, msg = '') {
  if (typeof actual !== 'number' || Number.isNaN(actual)) {
    assert.fail(`${msg} Expected a valid number for actual, but got ${actual}`);
  }
  if (typeof expected !== 'number' || Number.isNaN(expected)) {
    assert.fail(`${msg} Expected a valid number for expected, but got ${expected}`);
  }
  const diff = Math.abs(actual - expected);
  if (diff > epsilon) {
    assert.fail(
      `${msg} Expected ${actual} to be within ${epsilon} of ${expected} (difference: ${diff})`
    );
  }
}

/**
 * Asserts that two 2D vectors {x, y} are within epsilon tolerance.
 * @param {{x: number, y: number}} actual
 * @param {{x: number, y: number}} expected
 * @param {number} [epsilon=1e-4]
 * @param {string} [msg]
 */
export function assertVectorClose(actual, expected, epsilon = 1e-4, msg = '') {
  assert.ok(actual && typeof actual.x === 'number' && typeof actual.y === 'number', `${msg} Actual vector is invalid: ${JSON.stringify(actual)}`);
  assert.ok(expected && typeof expected.x === 'number' && typeof expected.y === 'number', `${msg} Expected vector is invalid: ${JSON.stringify(expected)}`);
  assertEpsilon(actual.x, expected.x, epsilon, `${msg} (Vector.x mismatch)`);
  assertEpsilon(actual.y, expected.y, epsilon, `${msg} (Vector.y mismatch)`);
}

/**
 * Asserts that two angles (in radians) are equivalent, accounting for modulo 2*PI wrap-around.
 * @param {number} actual
 * @param {number} expected
 * @param {number} [epsilon=1e-4]
 * @param {string} [msg]
 */
export function assertAngleClose(actual, expected, epsilon = 1e-4, msg = '') {
  const diff = Math.abs(((actual - expected + Math.PI) % (2 * Math.PI)) - Math.PI);
  if (diff > epsilon) {
    assert.fail(
      `${msg} Angular difference ${diff} exceeds epsilon ${epsilon} (actual: ${actual}, expected: ${expected})`
    );
  }
}

/**
 * Asserts that a value is within an inclusive [min, max] range.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @param {string} [msg]
 */
export function assertWithinRange(val, min, max, msg = '') {
  if (val < min || val > max) {
    assert.fail(`${msg} Value ${val} is outside expected range [${min}, ${max}]`);
  }
}

/**
 * Asserts that a polygon vertex array is valid and closed (or forms a closed loop).
 * @param {Array<{x: number, y: number}>} vertices
 * @param {string} [msg]
 */
export function assertPolygonClosed(vertices, msg = '') {
  assert.ok(Array.isArray(vertices), `${msg} Polygon vertices must be an array`);
  assert.ok(vertices.length >= 3, `${msg} Polygon must have at least 3 vertices, got ${vertices.length}`);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    assert.ok(
      v && typeof v.x === 'number' && typeof v.y === 'number' && !Number.isNaN(v.x) && !Number.isNaN(v.y),
      `${msg} Vertex at index ${i} is invalid: ${JSON.stringify(v)}`
    );
  }
}

/**
 * Asserts that non-adjacent edges of a polygon do not intersect (simple polygon check).
 * @param {Array<{x: number, y: number}>} vertices
 * @param {string} [msg]
 */
export function assertPolygonNoSelfIntersection(vertices, msg = '') {
  assertPolygonClosed(vertices, msg);
  const n = vertices.length;
  if (n <= 3) return; // Triangles cannot self-intersect

  function ccw(A, B, C) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }

  function intersect(p1, p2, p3, p4) {
    return (
      ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
      ccw(p1, p2, p3) !== ccw(p1, p2, p4)
    );
  }

  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if ((i === 0 && j === n - 1) || j === (i + 1) % n) continue; // Skip adjacent edges
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      if (intersect(a1, a2, b1, b2)) {
        assert.fail(`${msg} Polygon self-intersects between edge (${i},${(i+1)%n}) and (${j},${(j+1)%n})`);
      }
    }
  }
}

/**
 * Tests whether a point {x, y} is inside a polygon using ray casting (odd-even rule).
 * @param {{x: number, y: number}} pt
 * @param {Array<{x: number, y: number}>} polygon
 * @returns {boolean}
 */
export function isPointInPolygon(pt, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Asserts that a point is inside a polygon.
 * @param {{x: number, y: number}} pt
 * @param {Array<{x: number, y: number}>} polygon
 * @param {string} [msg]
 */
export function assertPointInPolygon(pt, polygon, msg = '') {
  assertPolygonClosed(polygon, msg);
  assert.ok(
    isPointInPolygon(pt, polygon),
    `${msg} Point (${pt.x}, ${pt.y}) is expected to be inside the polygon`
  );
}

/**
 * Standard test suite runner helper.
 * Executes an array of { id, name, fn } test cases and logs colorized status.
 * @param {string} suiteName
 * @param {Array<{ id: string, name: string, fn: Function }>} tests
 * @returns {Promise<{ suiteName: string, passed: number, failed: number, total: number, failures: Array }>}
 */
export async function runSuiteHelper(suiteName, tests) {
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const testCase of tests) {
    const start = performance.now();
    try {
      await testCase.fn();
      const elapsed = (performance.now() - start).toFixed(1);
      console.log(`    \x1b[32m✔\x1b[0m [${testCase.id}] ${testCase.name} \x1b[90m(${elapsed}ms)\x1b[0m`);
      passed++;
    } catch (err) {
      const elapsed = (performance.now() - start).toFixed(1);
      console.log(`    \x1b[31m✖\x1b[0m [${testCase.id}] ${testCase.name} \x1b[90m(${elapsed}ms)\x1b[0m`);
      console.log(`      \x1b[31m${err.message}\x1b[0m`);
      failed++;
      failures.push({
        id: testCase.id,
        name: `[${testCase.id}] ${testCase.name}`,
        error: err
      });
    }
  }

  return { suiteName, passed, failed, total: tests.length, failures };
}

export { assert };

