/**
 * Adversarial Stress-Test Harness for Battle Map Schema & BFS Reachability
 * Executed by challenger_m1_2
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  validateMap,
  createDefaultMap,
  serializeMap,
  deserializeMap,
  floodFillReachable,
  TILE_TYPES,
  SPAWN_TYPES,
  PICKUP_TYPES
} from '../shared/MapSchema.js';
import {
  MIN_GRID_DIMENSION,
  MAX_GRID_DIMENSION,
  TILE_SIZE
} from '../shared/Constants.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];
const anomalies = [];

function test(id, name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${id}: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${id}: ${name}`);
    console.error(`         ${err.message}`);
    failures.push({ id, name, error: err });
  }
}

function createBaseArena(width = 20, height = 20) {
  const tiles = new Array(width * height).fill(TILE_TYPES.FLOOR);
  for (let c = 0; c < width; c++) {
    tiles[0 * width + c] = TILE_TYPES.WALL;
    tiles[(height - 1) * width + c] = TILE_TYPES.WALL;
  }
  for (let r = 0; r < height; r++) {
    tiles[r * width + 0] = TILE_TYPES.WALL;
    tiles[r * width + (width - 1)] = TILE_TYPES.WALL;
  }
  return {
    version: '1.0',
    name: 'Base Arena',
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    spawns: [
      { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 1, row: 1 },
      { id: 'bot_1', type: SPAWN_TYPES.BOT, col: width - 2, row: height - 2 }
    ]
  };
}

console.log('=== MAP SCHEMA & BFS REACHABILITY STRESS HARNESS ===\n');

// ----------------------------------------------------------------------------
// SUITE 1: BFS Topology & Obstacle Boundaries
// ----------------------------------------------------------------------------
console.log('--- SUITE 1: BFS Reachability Boundaries ---');

test('T1.1', 'Arena with orthogonal wall completely separating spawns (unreachable)', () => {
  const map = createBaseArena(20, 20);
  for (let r = 0; r < map.height; r++) {
    map.tiles[r * map.width + 10] = TILE_TYPES.WALL;
  }
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('not reachable')));
});

test('T1.2', 'Arena with orthogonal wall and single 1-tile doorway (reachable)', () => {
  const map = createBaseArena(20, 20);
  for (let r = 0; r < map.height; r++) {
    map.tiles[r * map.width + 10] = TILE_TYPES.WALL;
  }
  map.tiles[5 * map.width + 10] = TILE_TYPES.FLOOR; // Doorway
  const res = validateMap(map);
  assert.strictEqual(res.valid, true, `Errors: ${res.errors.join(', ')}`);
});

test('T1.3', 'Impenetrable diagonal wall (col == row) separating spawns (unreachable)', () => {
  const map = createBaseArena(20, 20);
  for (let i = 0; i < 20; i++) {
    map.tiles[i * map.width + i] = TILE_TYPES.WALL;
  }
  map.spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 1, row: 18 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 18, row: 1 }
  ];
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('not reachable')));
});

test('T1.4', 'Impenetrable anti-diagonal wall (col + row == 19) (unreachable)', () => {
  const map = createBaseArena(20, 20);
  for (let r = 0; r < 20; r++) {
    map.tiles[r * map.width + (19 - r)] = TILE_TYPES.WALL;
  }
  map.spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 1, row: 1 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 18, row: 18 }
  ];
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('not reachable')));
});

test('T1.5', 'Diagonal wall with 1-tile gap allows orthogonal traversal (reachable)', () => {
  const map = createBaseArena(20, 20);
  for (let i = 0; i < 20; i++) {
    map.tiles[i * map.width + i] = TILE_TYPES.WALL;
  }
  map.tiles[10 * map.width + 10] = TILE_TYPES.FLOOR; // Gap
  map.spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 1, row: 18 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 18, row: 1 }
  ];
  const res = validateMap(map);
  assert.strictEqual(res.valid, true, `Errors: ${res.errors.join(', ')}`);
});

test('T1.6', 'Convoluted 20x20 Spiral Labyrinth (reachable)', () => {
  const size = 20;
  const tiles = new Array(size * size).fill(TILE_TYPES.WALL);
  let top = 1, bottom = size - 2, left = 1, right = size - 2;
  const path = [];
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) path.push([c, top]);
    top += 2;
    for (let r = top - 1; r <= bottom; r++) path.push([right, r]);
    right -= 2;
    if (top <= bottom) {
      for (let c = right + 1; c >= left; c--) path.push([c, bottom]);
      bottom -= 2;
    }
    if (left <= right) {
      for (let r = bottom + 1; r >= top; r--) path.push([left, r]);
      left += 2;
    }
  }
  for (const [c, r] of path) {
    tiles[r * size + c] = TILE_TYPES.FLOOR;
  }
  const map = {
    version: '1.0',
    name: 'Spiral Labyrinth',
    width: size,
    height: size,
    tileSize: TILE_SIZE,
    tiles,
    spawns: [
      { id: 'p', type: SPAWN_TYPES.PLAYER, col: path[0][0], row: path[0][1] },
      { id: 'b', type: SPAWN_TYPES.BOT, col: path[path.length - 1][0], row: path[path.length - 1][1] }
    ]
  };
  const res = validateMap(map);
  assert.strictEqual(res.valid, true, `Errors: ${res.errors.join(', ')}`);
});

test('T1.7', 'Dead-end labyrinth blocked by single wall (unreachable)', () => {
  const size = 20;
  const tiles = new Array(size * size).fill(TILE_TYPES.WALL);
  const path = [];
  for (let c = 1; c < size - 1; c++) path.push([c, 1]);
  for (let r = 1; r < size - 1; r++) path.push([size - 2, r]);
  for (const [c, r] of path) tiles[r * size + c] = TILE_TYPES.FLOOR;
  const blocker = path[path.length - 2];
  tiles[blocker[1] * size + blocker[0]] = TILE_TYPES.WALL;
  const map = {
    version: '1.0',
    name: 'Blocked Labyrinth',
    width: size,
    height: size,
    tileSize: TILE_SIZE,
    tiles,
    spawns: [
      { id: 'p', type: SPAWN_TYPES.PLAYER, col: path[0][0], row: path[0][1] },
      { id: 'b', type: SPAWN_TYPES.BOT, col: path[path.length - 1][0], row: path[path.length - 1][1] }
    ]
  };
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('not reachable')));
});

test('T1.8', 'Obstacle barrier: Rooms separated by TILE_TYPES.OBSTACLE (unreachable)', () => {
  const map = createBaseArena(20, 20);
  for (let r = 0; r < map.height; r++) {
    map.tiles[r * map.width + 10] = TILE_TYPES.OBSTACLE;
  }
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('not reachable')));
});

test('T1.9', '4 Spawns with 1 isolated bot spawn (partial reachability failure)', () => {
  const map = createBaseArena(20, 20);
  map.tiles[1 * map.width + 17] = TILE_TYPES.WALL;
  map.tiles[2 * map.width + 17] = TILE_TYPES.WALL;
  map.tiles[2 * map.width + 18] = TILE_TYPES.WALL;
  map.spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 1, row: 1 },
    { id: 'player_2', type: SPAWN_TYPES.PLAYER, col: 2, row: 1 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 18, row: 1 },
    { id: 'bot_2', type: SPAWN_TYPES.BOT, col: 1, row: 18 }
  ];
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.errors.length, 1);
  assert.ok(res.errors[0].includes("Spawn 'bot_1' at (18, 1) is not reachable"));
});

// ----------------------------------------------------------------------------
// SUITE 2: Schema Integrity & Boundary Edge Cases
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 2: Schema Integrity & Edge Cases ---');

test('T2.1', 'Rejection of null, undefined, primitives', () => {
  for (const input of [null, undefined, 42, 'string', true, []]) {
    assert.strictEqual(validateMap(input).valid, false);
  }
});

test('T2.2', 'Rejection of missing required top-level properties', () => {
  const base = createBaseArena();
  for (const prop of ['version', 'name', 'width', 'height', 'tileSize', 'tiles', 'spawns']) {
    const clone = { ...base };
    delete clone[prop];
    assert.strictEqual(validateMap(clone).valid, false);
  }
});

test('T2.3', 'Rejection of empty/whitespace name', () => {
  assert.strictEqual(validateMap({ ...createBaseArena(), name: '' }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), name: '   \t  ' }).valid, false);
});

test('T2.4', 'Rejection of non-integer dimensions (float, NaN, Infinity, string)', () => {
  assert.strictEqual(validateMap({ ...createBaseArena(), width: 20.5 }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), height: 19.99 }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), width: NaN }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), width: Infinity }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), width: '20' }).valid, false);
});

test('T2.5', 'Grid dimension boundaries: MIN=10, MAX=100', () => {
  assert.strictEqual(validateMap(createBaseArena(9, 9)).valid, false);
  assert.strictEqual(validateMap(createBaseArena(10, 10)).valid, true);
  assert.strictEqual(validateMap(createBaseArena(100, 100)).valid, true);
  assert.strictEqual(validateMap(createBaseArena(101, 101)).valid, false);
});

test('T2.6', 'Tile size validation and NaN/Infinity anomaly detection', () => {
  assert.strictEqual(validateMap({ ...createBaseArena(), tileSize: 0 }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), tileSize: -40 }).valid, false);
  assert.strictEqual(validateMap({ ...createBaseArena(), tileSize: '40' }).valid, false);

  const resNaN = validateMap({ ...createBaseArena(), tileSize: NaN });
  if (resNaN.valid) {
    anomalies.push('tileSize: NaN is accepted by validateMap() because typeof NaN === "number" and !(NaN <= 0)');
  }
  const resInf = validateMap({ ...createBaseArena(), tileSize: Infinity });
  if (resInf.valid) {
    anomalies.push('tileSize: Infinity is accepted by validateMap()');
  }
});

test('T2.7', 'Tiles array corruptions (short, long, invalid value, negative, holes)', () => {
  const map = createBaseArena();
  assert.strictEqual(validateMap({ ...map, tiles: map.tiles.slice(0, 399) }).valid, false);
  assert.strictEqual(validateMap({ ...map, tiles: [...map.tiles, 0] }).valid, false);

  const badTile = [...map.tiles];
  badTile[50] = 99;
  assert.strictEqual(validateMap({ ...map, tiles: badTile }).valid, false);

  const negTile = [...map.tiles];
  negTile[50] = -1;
  assert.strictEqual(validateMap({ ...map, tiles: negTile }).valid, false);

  assert.strictEqual(validateMap({ ...map, tiles: new Array(400) }).valid, false);
});

test('T2.8', 'Reject spawn placed on WALL tile (1)', () => {
  const map = createBaseArena();
  map.spawns[0] = { id: 'p', type: SPAWN_TYPES.PLAYER, col: 0, row: 0 };
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('overlaps with solid WALL')));
});

test('T2.9', 'Reject spawn placed on OBSTACLE tile (2)', () => {
  const map = createBaseArena();
  map.tiles[5 * map.width + 5] = TILE_TYPES.OBSTACLE;
  map.spawns[0] = { id: 'p', type: SPAWN_TYPES.PLAYER, col: 5, row: 5 };
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('overlaps with solid OBSTACLE')));
});

test('T2.10', 'Reject duplicate spawn locations', () => {
  const map = createBaseArena();
  map.spawns = [
    { id: 'p', type: SPAWN_TYPES.PLAYER, col: 5, row: 5 },
    { id: 'b', type: SPAWN_TYPES.BOT, col: 5, row: 5 }
  ];
  const res = validateMap(map);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('Duplicate spawn location')));
});

test('T2.11', 'Reject out-of-bounds spawn coordinates', () => {
  const map = createBaseArena(20, 20);
  for (const c of [{ col: -1, row: 5 }, { col: 20, row: 5 }, { col: 5, row: -1 }, { col: 5, row: 20 }]) {
    const res = validateMap({ ...map, spawns: [{ id: 'p', type: SPAWN_TYPES.PLAYER, col: c.col, row: c.row }, { id: 'b', type: SPAWN_TYPES.BOT, col: 2, row: 2 }] });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('outside grid bounds')));
  }
});

test('T2.12', 'Reject non-integer spawn coordinates', () => {
  const map = createBaseArena();
  for (const c of [{ col: 1.5, row: 2 }, { col: NaN, row: 2 }, { col: 2, row: Infinity }]) {
    const res = validateMap({ ...map, spawns: [{ id: 'p', type: SPAWN_TYPES.PLAYER, col: c.col, row: c.row }, { id: 'b', type: SPAWN_TYPES.BOT, col: 2, row: 2 }] });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('must be integers')));
  }
});

test('T2.13', 'Enforce minimum 1 player and 1 bot spawn', () => {
  const map = createBaseArena();
  // No player
  assert.strictEqual(validateMap({ ...map, spawns: [{ id: 'b1', type: SPAWN_TYPES.BOT, col: 1, row: 1 }, { id: 'b2', type: SPAWN_TYPES.BOT, col: 2, row: 2 }] }).valid, false);
  // No bot
  assert.strictEqual(validateMap({ ...map, spawns: [{ id: 'p1', type: SPAWN_TYPES.PLAYER, col: 1, row: 1 }, { id: 'p2', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 }] }).valid, false);
});

test('T2.14', 'Pickups validation (invalid type, out-of-bounds, on wall)', () => {
  const map = createBaseArena();
  assert.strictEqual(validateMap({ ...map, pickups: [{ type: 'plasma', col: 5, row: 5 }] }).valid, false);
  assert.strictEqual(validateMap({ ...map, pickups: [{ type: PICKUP_TYPES.AMMO, col: -1, row: 5 }] }).valid, false);
  assert.strictEqual(validateMap({ ...map, pickups: [{ type: PICKUP_TYPES.HEALTH, col: 0, row: 0 }] }).valid, false);
});

test('T2.15', 'JSON Serialization & Deserialization', () => {
  const def = createDefaultMap();
  const json = serializeMap(def);
  assert.strictEqual(typeof json, 'string');
  const parsed = deserializeMap(json);
  assert.deepStrictEqual(parsed, def);
  assert.throws(() => deserializeMap('{ bad json'), /Failed to parse map JSON/);
  assert.throws(() => deserializeMap(123), /expects a string input/);
  assert.throws(() => serializeMap(null), /Cannot serialize invalid map object/);
});

// ----------------------------------------------------------------------------
// SUITE 3: Scale & Performance
// ----------------------------------------------------------------------------
console.log('\n--- SUITE 3: Scale & Performance Benchmarks ---');

test('T3.1', '100x100 Maximum Arena BFS Performance (< 100ms)', () => {
  const map = createBaseArena(100, 100);
  const t0 = performance.now();
  const res = validateMap(map);
  const elapsed = performance.now() - t0;
  assert.strictEqual(res.valid, true);
  console.log(`       [Perf] 100x100 (10,000 tiles) validated in ${elapsed.toFixed(2)}ms`);
  assert.ok(elapsed < 100);
});

test('T3.2', 'Canonical Clockwork Foundry Map Verification', () => {
  const map = createDefaultMap();
  const res = validateMap(map);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(map.spawns.length, 4);
  assert.strictEqual(map.pickups.length, 4);
});

console.log('\n====================================================');
console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
if (anomalies.length > 0) {
  console.log('DISCOVERED ANOMALIES:');
  for (const a of anomalies) console.log(` * ${a}`);
}
console.log('====================================================\n');

process.exit(failedTests > 0 ? 1 : 0);
