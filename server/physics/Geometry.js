/**
 * 2D Geometry & Collision Utilities (Server Physics)
 * Includes exterior boundary segment extraction with collinear merging
 */

import { TILE_TYPES } from '../../shared/MapSchema.js';
import { TILE_SIZE } from '../../shared/Constants.js';

/**
 * Extracts optimized 2D line segments from a battle map, merging collinear edges.
 * Supports both extractSegments(tiles, width, height, tileSize) and extractSegments(map).
 * @param {Object|number[]} arg1 - BattleMap object or tiles array
 * @param {number} [width]
 * @param {number} [height]
 * @param {number} [tileSize]
 * @returns {Array<{ p1: { x: number, y: number }, p2: { x: number, y: number } }>}
 */
export function extractSegments(arg1, width, height, tileSize = TILE_SIZE) {
  if (Array.isArray(arg1)) {
    return extractSegmentsFromGrid(arg1, width, height, tileSize);
  }
  if (arg1 && typeof arg1 === 'object') {
    return extractSegmentsFromMap(arg1);
  }
  return [];
}

export const extractLineSegments = extractSegments;

/**
 * Extracts line segments from a BattleMap object.
 * @param {Object} map - BattleMap object
 * @returns {Array<{ p1: { x: number, y: number }, p2: { x: number, y: number } }>}
 */
export function extractSegmentsFromMap(map) {
  if (!map || !map.tiles) return [];
  const tileSize = map.tileSize || TILE_SIZE;
  return extractSegmentsFromGrid(map.tiles, map.width, map.height, tileSize);
}

/**
 * Extracts and merges exterior boundaries of solid tiles.
 * @param {number[]} tiles - Flat tiles array
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} tileSize - Pixel size of each tile
 * @returns {Array<{ p1: { x: number, y: number }, p2: { x: number, y: number } }>}
 */
export function extractSegmentsFromGrid(tiles, width, height, tileSize = TILE_SIZE) {
  const isSolid = (col, row) => {
    if (col < 0 || col >= width || row < 0 || row >= height) return false;
    const tile = tiles[row * width + col];
    return tile === TILE_TYPES.WALL || tile === TILE_TYPES.OBSTACLE;
  };

  // Group intervals by coordinate
  // horizontalEdges: Map<y, Array<[x1, x2]>>
  // verticalEdges: Map<x, Array<[y1, y2]>>
  const horizontalEdges = new Map();
  const verticalEdges = new Map();

  const addH = (y, x1, x2) => {
    if (!horizontalEdges.has(y)) horizontalEdges.set(y, []);
    horizontalEdges.get(y).push([Math.min(x1, x2), Math.max(x1, x2)]);
  };

  const addV = (x, y1, y2) => {
    if (!verticalEdges.has(x)) verticalEdges.set(x, []);
    verticalEdges.get(x).push([Math.min(y1, y2), Math.max(y1, y2)]);
  };

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!isSolid(c, r)) continue;

      const left = c * tileSize;
      const right = (c + 1) * tileSize;
      const top = r * tileSize;
      const bottom = (r + 1) * tileSize;

      // North edge
      if (!isSolid(c, r - 1)) {
        addH(top, left, right);
      }
      // South edge
      if (!isSolid(c, r + 1)) {
        addH(bottom, left, right);
      }
      // West edge
      if (!isSolid(c - 1, r)) {
        addV(left, top, bottom);
      }
      // East edge
      if (!isSolid(c + 1, r)) {
        addV(right, top, bottom);
      }
    }
  }

  const mergedSegments = [];

  // Merge horizontal edges with same Y
  for (const [y, intervals] of horizontalEdges.entries()) {
    const merged = mergeIntervals(intervals);
    for (const [x1, x2] of merged) {
      mergedSegments.push({
        p1: { x: x1, y },
        p2: { x: x2, y }
      });
    }
  }

  // Merge vertical edges with same X
  for (const [x, intervals] of verticalEdges.entries()) {
    const merged = mergeIntervals(intervals);
    for (const [y1, y2] of merged) {
      mergedSegments.push({
        p1: { x, y: y1 },
        p2: { x, y: y2 }
      });
    }
  }

  return mergedSegments;
}

/**
 * Merges overlapping or touching 1D intervals [a, b].
 * @param {Array<[number, number]>} intervals
 * @returns {Array<[number, number]>}
 */
export function mergeIntervals(intervals) {
  if (!intervals || intervals.length === 0) return [];
  // Sort intervals by start coordinate
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const result = [];
  let currentStart = intervals[0][0];
  let currentEnd = intervals[0][1];

  for (let i = 1; i < intervals.length; i++) {
    const [start, end] = intervals[i];
    // If intervals touch or overlap (within epsilon tolerance)
    if (start <= currentEnd + 0.001) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      result.push([currentStart, currentEnd]);
      currentStart = start;
      currentEnd = end;
    }
  }
  result.push([currentStart, currentEnd]);
  return result;
}

/**
 * Calculates Euclidean distance between two 2D points.
 */
export function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.hypot(dx, dy);
}

/**
 * Calculates squared Euclidean distance between two 2D points.
 */
export function distanceSquared(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

/**
 * Ray vs Line Segment intersection test.
 * Ray origin O, direction vector D = (dx, dy).
 * Segment from A to B.
 * @returns {{ hit: boolean, distance: number, point: { x: number, y: number } } | null}
 */
export function raySegmentIntersection(origin, dir, a, b) {
  const dx = dir.x;
  const dy = dir.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;

  const det = dx * sy - dy * sx;
  if (Math.abs(det) < 1e-9) return null; // Parallel or collinear

  const qx = a.x - origin.x;
  const qy = a.y - origin.y;

  const t = (qx * sy - qy * sx) / det;
  const u = (qx * dy - qy * dx) / det;

  if (t > 0 && u >= 0 && u <= 1) {
    return {
      hit: true,
      distance: t,
      point: {
        x: origin.x + t * dx,
        y: origin.y + t * dy
      }
    };
  }

  return null;
}

/**
 * Checks if a circle intersects a line segment.
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {boolean}
 */
export function circleSegmentIntersect(center, radius, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = center.x - a.x;
  const apy = center.y - a.y;

  const segLengthSq = abx * abx + aby * aby;
  if (segLengthSq === 0) {
    return Math.hypot(center.x - a.x, center.y - a.y) <= radius;
  }

  // Projection parameter t clamped to [0, 1]
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / segLengthSq));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;

  const distSq = (center.x - closestX) ** 2 + (center.y - closestY) ** 2;
  return distSq <= radius * radius;
}
