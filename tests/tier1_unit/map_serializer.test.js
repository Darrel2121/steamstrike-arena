/**
 * Tier 1.1: Map Serializer & Schema Validation Tests
 * Covers R1 (Built-in Battle Map Editor) specifications and invariants.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import {
  validateMap,
  createDefaultMap,
  serializeMap,
  deserializeMap,
  floodFillReachable,
  PRESET_MAPS,
  getPresetMap,
  TILE_TYPES,
  SPAWN_TYPES
} from '../../shared/MapSchema.js';
import {
  canonicalFoundryMap,
  malformedMaps,
  legacyVersion1Map
} from '../fixtures/maps.fixture.js';

export const suiteName = 'Tier 1.1: Map Serializer & Schema Validation';

export const tests = [
  {
    id: 'T1.1.1',
    name: 'Standard Map Round-Trip Serialization',
    fn: async () => {
      const originalMap = createDefaultMap();
      const serialized = serializeMap(originalMap);

      assert.strictEqual(typeof serialized, 'string', 'Serialized output must be a string');
      assert.ok(serialized.length > 50, 'Serialized string should contain complete map data');

      const deserialized = deserializeMap(serialized);

      // Deep equality check
      assert.deepStrictEqual(deserialized, originalMap, 'Deserialized map must match original map exactly');

      // Validation check
      const validation = validateMap(deserialized);
      assert.strictEqual(validation.valid, true, `Deserialized map must be valid: ${validation.errors?.join(', ')}`);
      assert.strictEqual(validation.errors.length, 0, 'No validation errors expected for canonical map');
    }
  },

  {
    id: 'T1.1.2',
    name: 'Grid Wall Extraction to Line Segments',
    fn: async () => {
      // Attempt to load Geometry module from server/physics/Geometry.js or client/js/editor/SegmentExtractor.js
      let geometryModule = null;
      try {
        geometryModule = await import('../../server/physics/Geometry.js');
      } catch (_) {
        try {
          geometryModule = await import('../../client/js/editor/SegmentExtractor.js');
        } catch (_) {}
      }

      if (!geometryModule) {
        assert.fail('Geometry segment extraction module (server/physics/Geometry.js) not found');
      }

      const extractor = geometryModule.extractSegments || geometryModule.extractLineSegments;
      assert.strictEqual(typeof extractor, 'function', 'Geometry module must export an extraction function');

      // 4x4 mini-grid with a 2x2 solid wall block in the center:
      // F F F F
      // F W W F
      // F W W F
      // F F F F
      const width = 4;
      const height = 4;
      const tileSize = 40;
      const tiles = [
        0, 0, 0, 0,
        0, 1, 1, 0,
        0, 1, 1, 0,
        0, 0, 0, 0
      ];

      const segments = extractor(tiles, width, height, tileSize);
      assert.ok(Array.isArray(segments), 'Extracted segments must be an array');
      assert.ok(segments.length >= 4, `Extracted segments must represent the exterior boundary (got ${segments.length})`);

      // Verify segments have { p1: {x, y}, p2: {x, y} }
      for (const seg of segments) {
        assert.ok(seg.p1 && typeof seg.p1.x === 'number' && typeof seg.p1.y === 'number', 'Segment p1 is valid');
        assert.ok(seg.p2 && typeof seg.p2.x === 'number' && typeof seg.p2.y === 'number', 'Segment p2 is valid');
        // Segment length must be > 0
        const len = Math.hypot(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y);
        assert.ok(len > 0, 'Segment must have non-zero length');
      }
    }
  },

  {
    id: 'T1.1.3',
    name: 'Obstacle & Cover Bounds Calculation',
    fn: async () => {
      const map = createDefaultMap();
      const tileSize = map.tileSize || 40;

      // Find all obstacle tiles
      const obstacleIndices = [];
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] === TILE_TYPES.OBSTACLE) {
          obstacleIndices.push(i);
        }
      }

      assert.ok(obstacleIndices.length > 0, 'Canonical map must contain obstacle tiles for cover');

      for (const idx of obstacleIndices) {
        const col = idx % map.width;
        const row = Math.floor(idx / map.width);

        const bounds = {
          minX: col * tileSize,
          minY: row * tileSize,
          maxX: (col + 1) * tileSize,
          maxY: (row + 1) * tileSize
        };

        assert.strictEqual(bounds.maxX - bounds.minX, tileSize, 'Obstacle bounding width must equal tileSize');
        assert.strictEqual(bounds.maxY - bounds.minY, tileSize, 'Obstacle bounding height must equal tileSize');
        assert.ok(bounds.minX >= 0 && bounds.maxX <= map.width * tileSize, 'Obstacle bounds within arena');
      }
    }
  },

  {
    id: 'T1.1.4',
    name: 'Spawn Point Registration & Validation',
    fn: async () => {
      const map = canonicalFoundryMap;
      const validation = validateMap(map);

      assert.strictEqual(validation.valid, true, `Canonical foundry map should be valid: ${validation.errors.join(', ')}`);
      assert.ok(map.spawns.length >= 4, 'Should contain at least 4 registered spawns (2 players, 2 bots)');

      const playerSpawns = map.spawns.filter(s => s.type === SPAWN_TYPES.PLAYER);
      const botSpawns = map.spawns.filter(s => s.type === SPAWN_TYPES.BOT);

      assert.ok(playerSpawns.length >= 1, 'Must have at least 1 player spawn');
      assert.ok(botSpawns.length >= 1, 'Must have at least 1 bot spawn');

      for (const spawn of map.spawns) {
        assert.ok(spawn.col >= 0 && spawn.col < map.width, `Spawn col ${spawn.col} must be within grid width`);
        assert.ok(spawn.row >= 0 && spawn.row < map.height, `Spawn row ${spawn.row} must be within grid height`);
        const tile = map.tiles[spawn.row * map.width + spawn.col];
        assert.strictEqual(tile, TILE_TYPES.FLOOR, `Spawn must be placed on FLOOR tile (got ${tile})`);
      }
    }
  },

  {
    id: 'T1.1.5',
    name: 'Malformed Schema Rejection',
    fn: async () => {
      // 1. Missing dimensions
      const resMissingDims = validateMap(malformedMaps.missingDimensions);
      assert.strictEqual(resMissingDims.valid, false, 'Missing dimensions must fail validation');
      assert.ok(resMissingDims.errors.length > 0, 'Must report specific error messages');

      // 2. Tile length mismatch
      const resMismatch = validateMap(malformedMaps.tileLengthMismatch);
      assert.strictEqual(resMismatch.valid, false, 'Tile length mismatch must fail validation');

      // 3. Spawn on solid wall
      const resSpawnOnWall = validateMap(malformedMaps.spawnOnWall);
      assert.strictEqual(resSpawnOnWall.valid, false, 'Spawn on solid wall must fail validation');

      // 4. Missing player spawn
      const resNoPlayer = validateMap(malformedMaps.missingPlayerSpawn);
      assert.strictEqual(resNoPlayer.valid, false, 'Missing player spawn must fail validation');

      // 5. Missing bot spawn
      const resNoBot = validateMap(malformedMaps.missingBotSpawn);
      assert.strictEqual(resNoBot.valid, false, 'Missing bot spawn must fail validation');

      // 6. Duplicate spawn locations
      const resDuplicate = validateMap(malformedMaps.duplicateSpawnLocations);
      assert.strictEqual(resDuplicate.valid, false, 'Duplicate spawn coordinates must fail validation');
    }
  },

  {
    id: 'T1.1.6',
    name: 'Version Tagging & Migration Fallback',
    fn: async () => {
      // Serialize and deserialize legacy map
      const serialized = serializeMap(legacyVersion1Map);
      const parsed = deserializeMap(serialized);

      assert.strictEqual(parsed.version, '1.0', 'Version tag must be preserved as 1.0');

      const validation = validateMap(parsed);
      assert.strictEqual(validation.valid, true, `Legacy version 1.0 map should pass validation: ${validation.errors.join(', ')}`);

      // Verify deserializing corrupted JSON throws an informative error
      assert.throws(
        () => deserializeMap('{ invalid_json: true '),
        /Failed to parse map JSON/i,
        'Corrupted JSON must throw parsing error'
      );
    }
  },

  {
    id: 'T1.1.7',
    name: 'All Preset Battle Arenas Validation & Reachability',
    fn: async () => {
      assert.ok(Array.isArray(PRESET_MAPS), 'PRESET_MAPS must be an array');
      assert.ok(PRESET_MAPS.length >= 5, `Must have at least 5 preset maps (found ${PRESET_MAPS.length})`);

      for (const presetMeta of PRESET_MAPS) {
        assert.ok(presetMeta.id, 'Preset must have an id');
        assert.ok(presetMeta.name, 'Preset must have a name');
        assert.strictEqual(typeof presetMeta.factory, 'function', `Preset ${presetMeta.id} must have factory function`);

        const map = presetMeta.factory();
        assert.strictEqual(typeof map, 'object', `Factory for ${presetMeta.id} must return object`);
        assert.strictEqual(map.width, presetMeta.width, `${presetMeta.id} map width must match preset metadata`);
        assert.strictEqual(map.height, presetMeta.height, `${presetMeta.id} map height must match preset metadata`);
        assert.strictEqual(map.tiles.length, map.width * map.height, `${presetMeta.id} tile count must equal width * height`);

        const val = validateMap(map);
        assert.strictEqual(val.valid, true, `Preset arena ${presetMeta.name} must be 100% valid: ${val.errors?.join(', ')}`);
        assert.strictEqual(val.errors.length, 0, `Preset arena ${presetMeta.name} must have 0 validation errors`);

        // Spawns verification
        const playerSpawns = map.spawns.filter(s => s.type === SPAWN_TYPES.PLAYER);
        const botSpawns = map.spawns.filter(s => s.type === SPAWN_TYPES.BOT);
        assert.ok(playerSpawns.length >= 2, `${presetMeta.id} must have at least 2 player spawns`);
        assert.ok(botSpawns.length >= 2, `${presetMeta.id} must have at least 2 bot spawns`);
      }
    }
  },

  {
    id: 'T1.1.8',
    name: 'getPresetMap Resolver Invariants',
    fn: async () => {
      const defaultMap = getPresetMap('__default__');
      assert.ok(defaultMap && defaultMap.name, 'Fallback to default map for __default__');

      const docks = getPresetMap('zeppelin_docks');
      assert.strictEqual(docks.width, 32, 'zeppelin_docks must have width 32');
      assert.strictEqual(docks.height, 32, 'zeppelin_docks must have height 32');

      const catacombs = getPresetMap('ironworks_catacombs');
      assert.strictEqual(catacombs.width, 28, 'ironworks_catacombs must have width 28');

      const citadel = getPresetMap('alchemical_citadel');
      assert.strictEqual(citadel.width, 36, 'alchemical_citadel must have width 36');

      const terminal = getPresetMap('steam_terminal');
      assert.strictEqual(terminal.width, 40, 'steam_terminal must have width 40');
      assert.strictEqual(terminal.height, 24, 'steam_terminal must have height 24');

      // Fuzzy / alias resolution
      const fuzzyCitadel = getPresetMap('Citadel');
      assert.strictEqual(fuzzyCitadel.width, 36, 'Fuzzy match "Citadel" should resolve to 36x36 citadel');

      // Unknown returns default
      const unknown = getPresetMap('non_existent_map_id');
      assert.ok(unknown && unknown.width === 20, 'Unknown ID should fall back to 20x20 default map');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
