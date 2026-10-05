/**
 * Tier 2.9: Empirical Adversarial Geometry & Serialization Stress Suite
 * Stress-tests complex wall configurations:
 * - Checkerboard wall grids (collinear merging, non-overlapping, zero duplicates)
 * - Concentric hollow wall rectangles (exterior boundaries, hole isolation)
 * - Giant 100x100 arenas (10,000 tiles, BFS reachability scalability, minimal segment counts)
 * - Completely empty arenas (0 walls, empty segments)
 * - Serialization roundtrip fidelity under extreme layouts
 */

import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';

import {
  extractSegments as serverExtract,
  extractSegmentsFromGrid as serverExtractGrid,
  mergeIntervals,
  raySegmentIntersection,
  circleSegmentIntersect
} from '../../server/physics/Geometry.js';

import {
  extractSegmentsFromGrid as clientExtractGrid
} from '../../client/js/editor/SegmentExtractor.js';

import {
  validateMap,
  createDefaultMap,
  serializeMap,
  deserializeMap,
  floodFillReachable,
  TILE_TYPES,
  SPAWN_TYPES
} from '../../shared/MapSchema.js';

export const suiteName = 'Tier 2.9: Adversarial Geometry & Serialization Stress';

function verifySegmentsIntegrity(segments, label = '') {
  assert.ok(Array.isArray(segments), `${label}: segments must be an array`);
  const segKeys = new Set();

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    assert.ok(s && s.p1 && s.p2, `${label}: segment #${i} has p1 and p2`);
    assert.strictEqual(typeof s.p1.x, 'number', `${label}: p1.x is number`);
    assert.strictEqual(typeof s.p1.y, 'number', `${label}: p1.y is number`);
    assert.strictEqual(typeof s.p2.x, 'number', `${label}: p2.x is number`);
    assert.strictEqual(typeof s.p2.y, 'number', `${label}: p2.y is number`);

    const isH = s.p1.y === s.p2.y && s.p1.x !== s.p2.x;
    const isV = s.p1.x === s.p2.x && s.p1.y !== s.p2.y;
    assert.ok(isH || isV, `${label}: segment #${i} must be axis-aligned`);

    const len = Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y);
    assert.ok(len > 0, `${label}: segment #${i} length must be > 0`);

    if (isH) {
      assert.ok(s.p1.x < s.p2.x, `${label}: horizontal segment p1.x < p2.x`);
    } else {
      assert.ok(s.p1.y < s.p2.y, `${label}: vertical segment p1.y < p2.y`);
    }

    const key = `${s.p1.x},${s.p1.y}->${s.p2.x},${s.p2.y}`;
    assert.ok(!segKeys.has(key), `${label}: Duplicate segment detected: ${key}`);
    segKeys.add(key);
  }

  // Collinear overlap verification
  const hLines = new Map();
  const vLines = new Map();
  for (const s of segments) {
    if (s.p1.y === s.p2.y) {
      if (!hLines.has(s.p1.y)) hLines.set(s.p1.y, []);
      hLines.get(s.p1.y).push([s.p1.x, s.p2.x]);
    } else {
      if (!vLines.has(s.p1.x)) vLines.set(s.p1.x, []);
      vLines.get(s.p1.x).push([s.p1.y, s.p2.y]);
    }
  }

  for (const [y, intervals] of hLines.entries()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let j = 0; j < intervals.length - 1; j++) {
      assert.ok(intervals[j][1] < intervals[j + 1][0], `Collinear overlap at y=${y}`);
    }
  }

  for (const [x, intervals] of vLines.entries()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let j = 0; j < intervals.length - 1; j++) {
      assert.ok(intervals[j][1] < intervals[j + 1][0], `Collinear overlap at x=${x}`);
    }
  }
}

export const tests = [
  {
    id: 'T2.9.1',
    name: 'Primitive Geometry & Minimal Segment Count Verification',
    fn: async () => {
      const ts = 40;

      // 1x1 single tile: 4 segments
      const segs1x1 = serverExtractGrid([1], 1, 1, ts);
      verifySegmentsIntegrity(segs1x1, '1x1');
      assert.strictEqual(segs1x1.length, 4, '1x1 tile must yield 4 segments');

      // 2x2 solid block: 4 exterior segments (interior boundaries eliminated)
      const segs2x2 = serverExtractGrid([1, 1, 1, 1], 2, 2, ts);
      verifySegmentsIntegrity(segs2x2, '2x2');
      assert.strictEqual(segs2x2.length, 4, '2x2 solid block must merge into 4 segments');
      assert.strictEqual(segs2x2[0].p2.x - segs2x2[0].p1.x, 80, 'Segment length must be 80px');

      // 1x10 solid line: 4 segments (2 long horizontal, 2 short vertical)
      const segs1x10 = serverExtractGrid(new Array(10).fill(1), 10, 1, ts);
      verifySegmentsIntegrity(segs1x10, '1x10');
      assert.strictEqual(segs1x10.length, 4, '1x10 solid line must yield 4 segments');
    }
  },

  {
    id: 'T2.9.2',
    name: 'Checkerboard Wall Grid Stress & Extraction Equivalence',
    fn: async () => {
      const ts = 40;
      const w = 4, h = 4;
      const tiles = [];
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          tiles.push((c + r) % 2 === 0 ? 1 : 0);
        }
      }

      const serverSegs = serverExtractGrid(tiles, w, h, ts);
      verifySegmentsIntegrity(serverSegs, '4x4 Checkerboard Server');
      assert.strictEqual(serverSegs.length, 14, '4x4 checkerboard must reduce 32 edges down to 14 segments');

      const clientSegs = clientExtractGrid(tiles, w, h, ts);
      verifySegmentsIntegrity(clientSegs, '4x4 Checkerboard Client');
      assert.deepStrictEqual(serverSegs, clientSegs, 'Client and Server extractors must produce bit-identical segments');
    }
  },

  {
    id: 'T2.9.3',
    name: 'Concentric Hollow Wall Rectangles (Interior/Exterior Boundaries)',
    fn: async () => {
      const ts = 40;
      const w = 20, h = 20;
      const tiles = new Array(w * h).fill(0);

      // Build 3 concentric hollow wall rings
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          // Ring 1 (outermost)
          if (c === 0 || c === w - 1 || r === 0 || r === h - 1) tiles[r * w + c] = 1;
          // Ring 2 (middle)
          if ((c >= 4 && c <= 15 && (r === 4 || r === 15)) || (r >= 4 && r <= 15 && (c === 4 || c === 15))) tiles[r * w + c] = 1;
          // Ring 3 (innermost)
          if ((c >= 8 && c <= 11 && (r === 8 || r === 11)) || (r >= 8 && r <= 11 && (c === 8 || c === 11))) tiles[r * w + c] = 1;
        }
      }

      const segs = serverExtractGrid(tiles, w, h, ts);
      verifySegmentsIntegrity(segs, 'Concentric Rings');
      // 3 hollow rings * 8 segments each = 24 segments
      assert.strictEqual(segs.length, 24, '3 concentric hollow wall rings must yield exactly 24 segments');
    }
  },

  {
    id: 'T2.9.4',
    name: 'Zero Walls / Completely Empty Arena Handling',
    fn: async () => {
      const ts = 40;
      const emptyTiles = new Array(400).fill(0);

      const serverSegs = serverExtractGrid(emptyTiles, 20, 20, ts);
      assert.strictEqual(serverSegs.length, 0, 'Empty arena must extract exactly 0 segments');

      const clientSegs = clientExtractGrid(emptyTiles, 20, 20, ts);
      assert.strictEqual(clientSegs.length, 0, 'Client extractor must return 0 segments');
    }
  },

  {
    id: 'T2.9.5',
    name: 'Giant 100x100 Arena (10,000 Tiles) BFS Scalability & Serialization',
    fn: async () => {
      const w = 100, h = 100, ts = 40;
      const tiles = new Array(w * h).fill(0);

      // Perimeter walls
      for (let c = 0; c < w; c++) {
        tiles[c] = 1;
        tiles[(h - 1) * w + c] = 1;
      }
      for (let r = 0; r < h; r++) {
        tiles[r * w] = 1;
        tiles[r * w + (w - 1)] = 1;
      }

      // Pillars
      for (let r = 8; r < h - 8; r += 8) {
        for (let c = 8; c < w - 8; c += 8) {
          tiles[r * w + c] = 2;
          tiles[r * w + c + 1] = 2;
          tiles[(r + 1) * w + c] = 2;
          tiles[(r + 1) * w + c + 1] = 2;
        }
      }

      const map100 = {
        version: '1.0',
        name: 'Megacity Undercroft 100x100',
        width: w,
        height: h,
        tileSize: ts,
        tiles,
        spawns: [
          { id: 'p1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
          { id: 'p2', type: SPAWN_TYPES.PLAYER, col: 97, row: 97 },
          { id: 'b1', type: SPAWN_TYPES.BOT, col: 97, row: 2 },
          { id: 'b2', type: SPAWN_TYPES.BOT, col: 2, row: 97 }
        ]
      };

      // 1. BFS Validation Performance
      const t0 = performance.now();
      const val = validateMap(map100);
      const bfsMs = performance.now() - t0;
      assert.strictEqual(val.valid, true, `100x100 map must pass validation: ${val.errors.join(', ')}`);
      assert.ok(bfsMs < 250, `100x100 BFS must execute in < 250ms (took ${bfsMs.toFixed(1)}ms)`);

      // 2. Serialization Roundtrip
      const serialized = serializeMap(map100);
      const deserialized = deserializeMap(serialized);
      assert.deepStrictEqual(deserialized, map100, 'Deserialized 100x100 map must match bit-for-bit');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
