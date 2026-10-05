/**
 * Canonical Battle Map Fixtures for Steampunk Tactical Shooter
 * Contains valid, edge, stress, and intentionally invalid map schemas.
 */

// 1. Helper to construct a generic map grid
function buildGridMap({ name, width, height, tileSize = 40, wallFn, spawns, pickups = [] }) {
  const tiles = new Array(width * height).fill(0);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (wallFn) {
        const type = wallFn(c, r, width, height);
        if (type !== undefined) {
          tiles[r * width + c] = type;
        }
      }
    }
  }
  return {
    version: '1.0',
    name,
    width,
    height,
    tileSize,
    tiles,
    spawns,
    pickups
  };
}

// 2. Canonical Clockwork Foundry (20x20)
export const canonicalFoundryMap = buildGridMap({
  name: 'The Clockwork Foundry',
  width: 20,
  height: 20,
  wallFn: (c, r, w, h) => {
    // Perimeter walls
    if (c === 0 || c === w - 1 || r === 0 || r === h - 1) return 1;
    // Horizontal corridors
    if ((c >= 3 && c <= 7 && r === 6) || (c >= 12 && c <= 16 && r === 6)) return 1;
    if ((c >= 3 && c <= 7 && r === 13) || (c >= 12 && c <= 16 && r === 13)) return 1;
    // Vertical corridors
    if ((r >= 3 && r <= 5 && c === 6) || (r >= 14 && r <= 16 && c === 6)) return 1;
    if ((r >= 3 && r <= 5 && c === 13) || (r >= 14 && r <= 16 && c === 13)) return 1;
    // Center boiler obstacles
    if ((c === 9 || c === 10) && (r === 9 || r === 10)) return 2;
    // Quadrant obstacles
    if ((c === 3 || c === 16) && (r === 3 || r === 16)) return 2;
    return 0;
  },
  spawns: [
    { id: 'player_1', type: 'player', col: 2, row: 2 },
    { id: 'player_2', type: 'player', col: 17, row: 17 },
    { id: 'bot_1', type: 'bot', col: 17, row: 2 },
    { id: 'bot_2', type: 'bot', col: 2, row: 17 }
  ],
  pickups: [
    { type: 'ammo', col: 10, row: 5 },
    { type: 'health', col: 10, row: 14 }
  ]
});

// 3. Completely Empty Arena (20x20, 0 walls, 0 obstacles)
export const completelyEmptyMap = buildGridMap({
  name: 'Void Proving Grounds',
  width: 20,
  height: 20,
  wallFn: () => 0, // All floor
  spawns: [
    { id: 'player_1', type: 'player', col: 2, row: 2 },
    { id: 'bot_1', type: 'bot', col: 17, row: 17 }
  ]
});

// 4. Boundary-Only Empty Arena (20x20, only 4 outer walls)
export const emptyBoundaryArenaMap = buildGridMap({
  name: 'Empty Perimeter Arena',
  width: 20,
  height: 20,
  wallFn: (c, r, w, h) => {
    if (c === 0 || c === w - 1 || r === 0 || r === h - 1) return 1;
    return 0;
  },
  spawns: [
    { id: 'player_1', type: 'player', col: 2, row: 2 },
    { id: 'bot_1', type: 'bot', col: 17, row: 17 }
  ]
});

// 5. Disconnected Arena (Partition wall cutting map in half)
export const disconnectedMap = buildGridMap({
  name: 'Bisected Fortress',
  width: 20,
  height: 20,
  wallFn: (c, r, w, h) => {
    if (c === 0 || c === w - 1 || r === 0 || r === h - 1) return 1;
    // Complete solid wall from top to bottom at col 10
    if (c === 10) return 1;
    return 0;
  },
  spawns: [
    { id: 'player_1', type: 'player', col: 2, row: 2 },
    { id: 'bot_1', type: 'bot', col: 17, row: 17 }
  ]
});

// 6. Massive Stress Arena (100x100, 10,000 tiles, 1,200+ wall obstacles)
export const stress100x100Map = buildGridMap({
  name: 'Megacity Brass Undercroft',
  width: 100,
  height: 100,
  wallFn: (c, r, w, h) => {
    if (c === 0 || c === w - 1 || r === 0 || r === h - 1) return 1;
    // Grid of pillars spaced every 4 tiles leaving wide walkable corridors
    if (c % 4 === 0 && r % 4 === 0 && c > 1 && c < w - 2 && r > 1 && r < h - 2) return 1;
    return 0;
  },
  spawns: [
    { id: 'player_1', type: 'player', col: 2, row: 2 },
    { id: 'player_2', type: 'player', col: 97, row: 97 },
    { id: 'bot_1', type: 'bot', col: 97, row: 2 },
    { id: 'bot_2', type: 'bot', col: 2, row: 97 },
    { id: 'bot_3', type: 'bot', col: 50, row: 2 },
    { id: 'bot_4', type: 'bot', col: 50, row: 97 }
  ]
});

// 7. Malformed Schema Fixtures
export const malformedMaps = {
  missingDimensions: {
    version: '1.0',
    name: 'Broken Dimensions Map',
    tileSize: 40,
    tiles: [0, 0, 0, 0],
    spawns: [{ id: 'p1', type: 'player', col: 0, row: 0 }]
  },
  dimensionsOutOfBounds: {
    version: '1.0',
    name: 'Too Tiny Map',
    width: 4,
    height: 4,
    tileSize: 40,
    tiles: new Array(16).fill(0),
    spawns: [{ id: 'p1', type: 'player', col: 0, row: 0 }]
  },
  tileLengthMismatch: {
    version: '1.0',
    name: 'Mismatch Tiles Map',
    width: 20,
    height: 20,
    tileSize: 40,
    tiles: [0, 0, 1], // Expected 400
    spawns: [{ id: 'p1', type: 'player', col: 1, row: 1 }]
  },
  spawnOnWall: buildGridMap({
    name: 'Spawn on Wall Map',
    width: 20,
    height: 20,
    wallFn: (c, r) => (c === 2 && r === 2 ? 1 : 0),
    spawns: [
      { id: 'p1', type: 'player', col: 2, row: 2 }, // on wall
      { id: 'b1', type: 'bot', col: 10, row: 10 }
    ]
  }),
  missingPlayerSpawn: buildGridMap({
    name: 'No Player Spawn Map',
    width: 20,
    height: 20,
    wallFn: () => 0,
    spawns: [
      { id: 'b1', type: 'bot', col: 5, row: 5 },
      { id: 'b2', type: 'bot', col: 10, row: 10 }
    ]
  }),
  missingBotSpawn: buildGridMap({
    name: 'No Bot Spawn Map',
    width: 20,
    height: 20,
    wallFn: () => 0,
    spawns: [
      { id: 'p1', type: 'player', col: 5, row: 5 },
      { id: 'p2', type: 'player', col: 10, row: 10 }
    ]
  }),
  duplicateSpawnLocations: buildGridMap({
    name: 'Duplicate Spawns Map',
    width: 20,
    height: 20,
    wallFn: () => 0,
    spawns: [
      { id: 'p1', type: 'player', col: 5, row: 5 },
      { id: 'b1', type: 'bot', col: 5, row: 5 } // Same location
    ]
  })
};

// 8. Legacy Version Map (Version 1.0 with missing ambient tags)
export const legacyVersion1Map = {
  version: '1.0',
  name: 'Old Foundry Vault',
  width: 15,
  height: 15,
  tileSize: 40,
  tiles: new Array(225).fill(0),
  spawns: [
    { id: 'p1', type: 'player', col: 2, row: 2 },
    { id: 'b1', type: 'bot', col: 12, row: 12 }
  ]
};
