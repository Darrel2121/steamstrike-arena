/**
 * Battle Map Schema, Serialization, and Validation
 */

import {
  DEFAULT_GRID_WIDTH,
  DEFAULT_GRID_HEIGHT,
  MIN_GRID_DIMENSION,
  MAX_GRID_DIMENSION,
  TILE_SIZE
} from './Constants.js';

export const TILE_TYPES = {
  FLOOR: 0,
  WALL: 1,
  OBSTACLE: 2
};

export const SPAWN_TYPES = {
  PLAYER: 'player',
  BOT: 'bot'
};

export const PICKUP_TYPES = {
  AMMO: 'ammo',
  HEALTH: 'health'
};

export const DECOR_TYPES = {
  GEAR: 'gear',
  STEAM_VENT: 'vent',
  PIPES: 'pipes',
  LANTERN: 'lantern',
  TANK: 'tank',
  CRATE: 'crate',
  CRACK: 'crack',
  SIGN: 'sign',
  BUSH: 'bush'
};

/**
 * Validates a battle map object against structural, playability, and reachability rules.
 * @param {Object} map - The map object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMap(map) {
  const errors = [];

  if (!map || typeof map !== 'object') {
    return { valid: false, errors: ['Map data must be a valid non-null object'] };
  }

  // Version check
  if (!map.version || typeof map.version !== 'string') {
    errors.push('Map version string is missing or invalid');
  }

  // Name check
  if (!map.name || typeof map.name !== 'string' || map.name.trim().length === 0) {
    errors.push('Map name is required and must be a non-empty string');
  }

  // Dimensions check
  const width = map.width;
  const height = map.height;
  if (!Number.isInteger(width) || width < MIN_GRID_DIMENSION || width > MAX_GRID_DIMENSION) {
    errors.push(`Map width must be an integer between ${MIN_GRID_DIMENSION} and ${MAX_GRID_DIMENSION}`);
  }
  if (!Number.isInteger(height) || height < MIN_GRID_DIMENSION || height > MAX_GRID_DIMENSION) {
    errors.push(`Map height must be an integer between ${MIN_GRID_DIMENSION} and ${MAX_GRID_DIMENSION}`);
  }

  // Tile size check
  if (typeof map.tileSize !== 'number' || map.tileSize <= 0) {
    errors.push('Tile size must be a positive number');
  }

  // Tiles array check
  if (!Array.isArray(map.tiles)) {
    errors.push('Map tiles must be an array');
  } else if (Number.isInteger(width) && Number.isInteger(height)) {
    const expectedLength = width * height;
    if (map.tiles.length !== expectedLength) {
      errors.push(`Map tiles length mismatch: expected ${expectedLength} (${width}x${height}), got ${map.tiles.length}`);
    } else {
      const validTileValues = new Set([TILE_TYPES.FLOOR, TILE_TYPES.WALL, TILE_TYPES.OBSTACLE]);
      for (let i = 0; i < map.tiles.length; i++) {
        if (!validTileValues.has(map.tiles[i])) {
          errors.push(`Invalid tile value ${map.tiles[i]} at index ${i}`);
          break; // Avoid spamming errors
        }
      }
    }
  }

  // Spawns validation
  if (!Array.isArray(map.spawns)) {
    errors.push('Map spawns must be an array');
  } else {
    let playerCount = 0;
    let botCount = 0;
    const spawnLocations = new Set();

    for (let i = 0; i < map.spawns.length; i++) {
      const spawn = map.spawns[i];
      if (!spawn || typeof spawn !== 'object') {
        errors.push(`Spawn #${i} is invalid`);
        continue;
      }

      if (spawn.type === SPAWN_TYPES.PLAYER) {
        playerCount++;
      } else if (spawn.type === SPAWN_TYPES.BOT) {
        botCount++;
      } else {
        errors.push(`Spawn #${i} has unknown type '${spawn.type}'`);
      }

      const { col, row } = spawn;
      if (!Number.isInteger(col) || !Number.isInteger(row)) {
        errors.push(`Spawn #${i} (${spawn.id || 'unnamed'}) col and row must be integers`);
        continue;
      }

      if (Number.isInteger(width) && Number.isInteger(height)) {
        if (col < 0 || col >= width || row < 0 || row >= height) {
          errors.push(`Spawn #${i} at (${col}, ${row}) is outside grid bounds (${width}x${height})`);
          continue;
        }

        const locKey = `${col},${row}`;
        if (spawnLocations.has(locKey)) {
          errors.push(`Duplicate spawn location at (${col}, ${row})`);
        }
        spawnLocations.add(locKey);

        if (Array.isArray(map.tiles) && map.tiles.length === width * height) {
          const tile = map.tiles[row * width + col];
          if (tile !== TILE_TYPES.FLOOR) {
            errors.push(`Spawn #${i} at (${col}, ${row}) overlaps with solid ${tile === TILE_TYPES.WALL ? 'WALL' : 'OBSTACLE'}`);
          }
        }
      }
    }

    if (playerCount < 1) {
      errors.push('Map must contain at least 1 player spawn point');
    }
    if (botCount < 1) {
      errors.push('Map must contain at least 1 bot spawn point');
    }

    // BFS Reachability Check: All spawns must be mutually reachable across walkable floor
    if (
      errors.length === 0 &&
      Array.isArray(map.spawns) &&
      map.spawns.length >= 2 &&
      Array.isArray(map.tiles) &&
      map.tiles.length === width * height
    ) {
      const startSpawn = map.spawns[0];
      const reachableSet = floodFillReachable(map.tiles, width, height, startSpawn.col, startSpawn.row);

      for (let i = 1; i < map.spawns.length; i++) {
        const s = map.spawns[i];
        const key = `${s.col},${s.row}`;
        if (!reachableSet.has(key)) {
          errors.push(`Spawn '${s.id || s.type}' at (${s.col}, ${s.row}) is not reachable from spawn '${startSpawn.id || startSpawn.type}' at (${startSpawn.col}, ${startSpawn.row})`);
        }
      }
    }
  }

  // Pickups validation (optional)
  if (map.pickups !== undefined) {
    if (!Array.isArray(map.pickups)) {
      errors.push('Map pickups must be an array when provided');
    } else if (Number.isInteger(width) && Number.isInteger(height) && Array.isArray(map.tiles)) {
      const validPickupTypes = new Set([PICKUP_TYPES.AMMO, PICKUP_TYPES.HEALTH]);
      for (let i = 0; i < map.pickups.length; i++) {
        const pickup = map.pickups[i];
        if (!pickup || !validPickupTypes.has(pickup.type)) {
          errors.push(`Pickup #${i} has invalid type '${pickup?.type}'`);
          continue;
        }
        const { col, row } = pickup;
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= width || row < 0 || row >= height) {
          errors.push(`Pickup #${i} at (${col}, ${row}) is outside grid bounds`);
          continue;
        }
        if (map.tiles[row * width + col] !== TILE_TYPES.FLOOR) {
          errors.push(`Pickup #${i} at (${col}, ${row}) overlaps with solid tile`);
        }
      }
    }
  }

  // Decorations validation (optional)
  if (map.decorations !== undefined) {
    if (!Array.isArray(map.decorations)) {
      errors.push('Map decorations must be an array when provided');
    } else if (Number.isInteger(width) && Number.isInteger(height)) {
      const validDecorTypes = new Set(Object.values(DECOR_TYPES));
      for (let i = 0; i < map.decorations.length; i++) {
        const decor = map.decorations[i];
        if (!decor || !validDecorTypes.has(decor.type)) {
          errors.push(`Decoration #${i} has invalid type '${decor?.type}'`);
          continue;
        }
        const { col, row } = decor;
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= width || row < 0 || row >= height) {
          errors.push(`Decoration #${i} at (${col}, ${row}) is outside grid bounds`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Runs a BFS flood-fill from (startCol, startRow) across walkable FLOOR tiles (0).
 * @param {number[]} tiles - Flat tiles array
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} startCol - Origin column
 * @param {number} startRow - Origin row
 * @returns {Set<string>} Set of "col,row" strings reachable
 */
export function floodFillReachable(tiles, width, height, startCol, startRow) {
  const reachable = new Set();
  if (startCol < 0 || startCol >= width || startRow < 0 || startRow >= height) {
    return reachable;
  }
  if (tiles[startRow * width + startCol] !== TILE_TYPES.FLOOR) {
    return reachable;
  }

  const queue = [{ col: startCol, row: startRow }];
  reachable.add(`${startCol},${startRow}`);

  const directions = [
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 0, dr: -1 }
  ];

  let head = 0;
  while (head < queue.length) {
    const { col, row } = queue[head++];
    for (const { dc, dr } of directions) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
        const key = `${nc},${nr}`;
        if (!reachable.has(key)) {
          if (tiles[nr * width + nc] === TILE_TYPES.FLOOR) {
            reachable.add(key);
            queue.push({ col: nc, row: nr });
          }
        }
      }
    }
  }

  return reachable;
}

/**
 * Generates the canonical default 20x20 Steampunk Clockwork Foundry map.
 * Guaranteed to be 100% valid with outer walls, interior cover, corridors, 2 player spawns, 2 bot spawns.
 * @returns {Object} Canonical BattleMap object
 */
export function createDefaultMap() {
  const width = DEFAULT_GRID_WIDTH;
  const height = DEFAULT_GRID_HEIGHT;
  const tiles = new Array(width * height).fill(TILE_TYPES.FLOOR);

  // Helper to set tile at (col, row)
  const setTile = (col, row, type) => {
    if (col >= 0 && col < width && row >= 0 && row < height) {
      tiles[row * width + col] = type;
    }
  };

  // 1. Perimeter boundary walls
  for (let c = 0; c < width; c++) {
    setTile(c, 0, TILE_TYPES.WALL);
    setTile(c, height - 1, TILE_TYPES.WALL);
  }
  for (let r = 0; r < height; r++) {
    setTile(0, r, TILE_TYPES.WALL);
    setTile(width - 1, r, TILE_TYPES.WALL);
  }

  // 2. Interior partitioning walls with doorways (Clockwork Foundry layout)
  // Horizontal dividing walls with corridors
  for (let c = 3; c <= 7; c++) setTile(c, 6, TILE_TYPES.WALL);
  for (let c = 12; c <= 16; c++) setTile(c, 6, TILE_TYPES.WALL);

  for (let c = 3; c <= 7; c++) setTile(c, 13, TILE_TYPES.WALL);
  for (let c = 12; c <= 16; c++) setTile(c, 13, TILE_TYPES.WALL);

  // Vertical dividing walls with corridors
  for (let r = 3; r <= 5; r++) setTile(6, r, TILE_TYPES.WALL);
  for (let r = 14; r <= 16; r++) setTile(6, r, TILE_TYPES.WALL);

  for (let r = 3; r <= 5; r++) setTile(13, r, TILE_TYPES.WALL);
  for (let r = 14; r <= 16; r++) setTile(13, r, TILE_TYPES.WALL);

  // 3. Central Steam Boiler & Obstacles
  setTile(9, 9, TILE_TYPES.OBSTACLE);
  setTile(10, 9, TILE_TYPES.OBSTACLE);
  setTile(9, 10, TILE_TYPES.OBSTACLE);
  setTile(10, 10, TILE_TYPES.OBSTACLE);

  // Quadrant tactical cover obstacles
  setTile(3, 3, TILE_TYPES.OBSTACLE);
  setTile(16, 3, TILE_TYPES.OBSTACLE);
  setTile(3, 16, TILE_TYPES.OBSTACLE);
  setTile(16, 16, TILE_TYPES.OBSTACLE);

  // Machinery cover in corridors
  setTile(9, 3, TILE_TYPES.OBSTACLE);
  setTile(10, 3, TILE_TYPES.OBSTACLE);
  setTile(9, 16, TILE_TYPES.OBSTACLE);
  setTile(10, 16, TILE_TYPES.OBSTACLE);

  const spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
    { id: 'player_2', type: SPAWN_TYPES.PLAYER, col: 17, row: 17 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 17, row: 2 },
    { id: 'bot_2', type: SPAWN_TYPES.BOT, col: 2, row: 17 },
    { id: 'bot_3', type: SPAWN_TYPES.BOT, col: 10, row: 2 },
    { id: 'bot_4', type: SPAWN_TYPES.BOT, col: 10, row: 17 }
  ];

  const pickups = [
    { type: PICKUP_TYPES.AMMO, col: 10, row: 5 },
    { type: PICKUP_TYPES.HEALTH, col: 10, row: 14 },
    { type: PICKUP_TYPES.AMMO, col: 5, row: 10 },
    { type: PICKUP_TYPES.HEALTH, col: 14, row: 10 }
  ];

  const decorations = [
    { type: DECOR_TYPES.STEAM_VENT, col: 7, row: 7 },
    { type: DECOR_TYPES.STEAM_VENT, col: 12, row: 12 },
    { type: DECOR_TYPES.GEAR, col: 4, row: 4 },
    { type: DECOR_TYPES.GEAR, col: 15, row: 15 },
    { type: DECOR_TYPES.PIPES, col: 10, row: 3 },
    { type: DECOR_TYPES.PIPES, col: 10, row: 16 },
    { type: DECOR_TYPES.LANTERN, col: 3, row: 10 },
    { type: DECOR_TYPES.LANTERN, col: 16, row: 10 },
    { type: DECOR_TYPES.TANK, col: 6, row: 14 },
    { type: DECOR_TYPES.CRATE, col: 13, row: 5 },
    { type: DECOR_TYPES.CRACK, col: 8, row: 8 },
    { type: DECOR_TYPES.CRACK, col: 11, row: 11 },
    { type: DECOR_TYPES.SIGN, col: 9, row: 8 },
    { type: DECOR_TYPES.BUSH, col: 4, row: 15 },
    { type: DECOR_TYPES.BUSH, col: 15, row: 4 }
  ];

  return {
    version: '1.0',
    name: 'The Clockwork Foundry',
    theme: 'foundry',
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    spawns,
    pickups,
    decorations
  };
}

/**
 * Generates the 32x32 Grand Zeppelin Docks battle arena (1280x1280 px).
 * Features dual docking piers, heavy freight cranes, warehouse partitions, and wide corridors.
 * @returns {Object} BattleMap object
 */
export function createGrandZeppelinDocksMap() {
  const width = 32;
  const height = 32;
  const tiles = new Array(width * height).fill(TILE_TYPES.FLOOR);

  const setTile = (c, r, type) => {
    if (c >= 0 && c < width && r >= 0 && r < height) {
      tiles[r * width + c] = type;
    }
  };

  // Perimeter boundary
  for (let c = 0; c < width; c++) {
    setTile(c, 0, TILE_TYPES.WALL);
    setTile(c, height - 1, TILE_TYPES.WALL);
  }
  for (let r = 0; r < height; r++) {
    setTile(0, r, TILE_TYPES.WALL);
    setTile(width - 1, r, TILE_TYPES.WALL);
  }

  // Docks Piers (Horizontal dividing walls with wide central openings)
  for (let c = 6; c <= 25; c++) {
    if (c < 13 || c > 18) {
      setTile(c, 8, TILE_TYPES.WALL);
      setTile(c, 23, TILE_TYPES.WALL);
    }
  }

  // Cargo Warehouse Dividing Walls (Vertical with doorways)
  for (let r = 11; r <= 20; r++) {
    if (r !== 14 && r !== 17) {
      setTile(8, r, TILE_TYPES.WALL);
      setTile(23, r, TILE_TYPES.WALL);
    }
  }

  // Center Launchpad Heavy Pillars
  const centerPillars = [
    [12, 12], [13, 12], [12, 13], [13, 13],
    [18, 12], [19, 12], [18, 13], [19, 13],
    [12, 18], [13, 18], [12, 19], [13, 19],
    [18, 18], [19, 18], [18, 19], [19, 19]
  ];
  for (const [c, r] of centerPillars) {
    setTile(c, r, TILE_TYPES.OBSTACLE);
  }

  // Central Generator / Fuel Hub
  setTile(15, 15, TILE_TYPES.OBSTACLE);
  setTile(16, 15, TILE_TYPES.OBSTACLE);
  setTile(15, 16, TILE_TYPES.OBSTACLE);
  setTile(16, 16, TILE_TYPES.OBSTACLE);

  // Quadrant Cargo Stacks
  const cargoStacks = [
    [4, 4], [5, 4], [4, 5],
    [26, 4], [27, 4], [27, 5],
    [4, 26], [5, 27], [4, 27],
    [26, 27], [27, 26], [27, 27]
  ];
  for (const [c, r] of cargoStacks) {
    setTile(c, r, TILE_TYPES.OBSTACLE);
  }

  const spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 3, row: 3 },
    { id: 'player_2', type: SPAWN_TYPES.PLAYER, col: 28, row: 28 },
    { id: 'player_3', type: SPAWN_TYPES.PLAYER, col: 28, row: 3 },
    { id: 'player_4', type: SPAWN_TYPES.PLAYER, col: 3, row: 28 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 15, row: 4 },
    { id: 'bot_2', type: SPAWN_TYPES.BOT, col: 16, row: 27 },
    { id: 'bot_3', type: SPAWN_TYPES.BOT, col: 4, row: 15 },
    { id: 'bot_4', type: SPAWN_TYPES.BOT, col: 27, row: 16 }
  ];

  const pickups = [
    { type: PICKUP_TYPES.AMMO, col: 15, row: 12 },
    { type: PICKUP_TYPES.AMMO, col: 16, row: 19 },
    { type: PICKUP_TYPES.HEALTH, col: 12, row: 15 },
    { type: PICKUP_TYPES.HEALTH, col: 19, row: 16 },
    { type: PICKUP_TYPES.AMMO, col: 6, row: 6 },
    { type: PICKUP_TYPES.HEALTH, col: 25, row: 25 }
  ];

  const decorations = [
    { type: DECOR_TYPES.STEAM_VENT, col: 14, row: 14 },
    { type: DECOR_TYPES.STEAM_VENT, col: 17, row: 17 },
    { type: DECOR_TYPES.GEAR, col: 8, row: 10 },
    { type: DECOR_TYPES.GEAR, col: 23, row: 10 },
    { type: DECOR_TYPES.PIPES, col: 15, row: 8 },
    { type: DECOR_TYPES.PIPES, col: 16, row: 23 },
    { type: DECOR_TYPES.LANTERN, col: 12, row: 11 },
    { type: DECOR_TYPES.LANTERN, col: 19, row: 20 },
    { type: DECOR_TYPES.TANK, col: 10, row: 15 },
    { type: DECOR_TYPES.CRATE, col: 21, row: 16 },
    { type: DECOR_TYPES.CRACK, col: 15, row: 17 },
    { type: DECOR_TYPES.SIGN, col: 13, row: 8 }
  ];

  return {
    version: '1.0',
    name: 'The Grand Zeppelin Docks',
    theme: 'docks',
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    spawns,
    pickups,
    decorations
  };
}

/**
 * Generates the 28x28 Ironworks Catacombs battle arena (1120x1120 px).
 * Subterranean brick vault with multiple mining halls, steam pipes, and ambush corners.
 * @returns {Object} BattleMap object
 */
export function createIronworksCatacombsMap() {
  const width = 28;
  const height = 28;
  const tiles = new Array(width * height).fill(TILE_TYPES.FLOOR);

  const setTile = (c, r, type) => {
    if (c >= 0 && c < width && r >= 0 && r < height) {
      tiles[r * width + c] = type;
    }
  };

  // Perimeter boundary
  for (let c = 0; c < width; c++) {
    setTile(c, 0, TILE_TYPES.WALL);
    setTile(c, height - 1, TILE_TYPES.WALL);
  }
  for (let r = 0; r < height; r++) {
    setTile(0, r, TILE_TYPES.WALL);
    setTile(width - 1, r, TILE_TYPES.WALL);
  }

  // Cross dividing walls with 4-tile wide archways
  for (let c = 3; c <= 24; c++) {
    if ((c < 6 || c > 9) && (c < 18 || c > 21) && (c < 12 || c > 15)) {
      setTile(c, 13, TILE_TYPES.WALL);
      setTile(c, 14, TILE_TYPES.WALL);
    }
  }

  for (let r = 3; r <= 24; r++) {
    if ((r < 6 || r > 9) && (r < 18 || r > 21) && (r < 12 || r > 15)) {
      setTile(13, r, TILE_TYPES.WALL);
      setTile(14, r, TILE_TYPES.WALL);
    }
  }

  // Chamber interior pillars
  const pillars = [
    [6, 6], [7, 6], [6, 7], [7, 7],
    [20, 6], [21, 6], [20, 7], [21, 7],
    [6, 20], [7, 20], [6, 21], [7, 21],
    [20, 20], [21, 20], [20, 21], [21, 21]
  ];
  for (const [c, r] of pillars) {
    setTile(c, r, TILE_TYPES.OBSTACLE);
  }

  // Center crossing obstacles
  setTile(11, 11, TILE_TYPES.OBSTACLE);
  setTile(16, 11, TILE_TYPES.OBSTACLE);
  setTile(11, 16, TILE_TYPES.OBSTACLE);
  setTile(16, 16, TILE_TYPES.OBSTACLE);

  const spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 3, row: 3 },
    { id: 'player_2', type: SPAWN_TYPES.PLAYER, col: 24, row: 24 },
    { id: 'player_3', type: SPAWN_TYPES.PLAYER, col: 24, row: 3 },
    { id: 'player_4', type: SPAWN_TYPES.PLAYER, col: 3, row: 24 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 10, row: 4 },
    { id: 'bot_2', type: SPAWN_TYPES.BOT, col: 17, row: 23 },
    { id: 'bot_3', type: SPAWN_TYPES.BOT, col: 4, row: 10 },
    { id: 'bot_4', type: SPAWN_TYPES.BOT, col: 23, row: 17 }
  ];

  const pickups = [
    { type: PICKUP_TYPES.AMMO, col: 8, row: 13 },
    { type: PICKUP_TYPES.AMMO, col: 19, row: 14 },
    { type: PICKUP_TYPES.HEALTH, col: 13, row: 8 },
    { type: PICKUP_TYPES.HEALTH, col: 14, row: 19 },
    { type: PICKUP_TYPES.AMMO, col: 3, row: 10 },
    { type: PICKUP_TYPES.HEALTH, col: 24, row: 17 }
  ];

  const decorations = [
    { type: DECOR_TYPES.STEAM_VENT, col: 10, row: 10 },
    { type: DECOR_TYPES.STEAM_VENT, col: 17, row: 17 },
    { type: DECOR_TYPES.GEAR, col: 13, row: 2 },
    { type: DECOR_TYPES.PIPES, col: 2, row: 13 },
    { type: DECOR_TYPES.LANTERN, col: 12, row: 12 },
    { type: DECOR_TYPES.LANTERN, col: 15, row: 15 },
    { type: DECOR_TYPES.CRACK, col: 8, row: 15 },
    { type: DECOR_TYPES.CRACK, col: 19, row: 12 },
    { type: DECOR_TYPES.BUSH, col: 4, row: 23 },
    { type: DECOR_TYPES.BUSH, col: 23, row: 4 }
  ];

  return {
    version: '1.0',
    name: 'The Ironworks Catacombs',
    theme: 'catacombs',
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    spawns,
    pickups,
    decorations
  };
}

/**
 * Generates the 36x36 Alchemical Citadel battle arena (1440x1440 px).
 * Epic fortified fortress with 4 bastion battlements, a central courtyard, and moat galleries.
 * @returns {Object} BattleMap object
 */
export function createAlchemicalCitadelMap() {
  const width = 36;
  const height = 36;
  const tiles = new Array(width * height).fill(TILE_TYPES.FLOOR);

  const setTile = (c, r, type) => {
    if (c >= 0 && c < width && r >= 0 && r < height) {
      tiles[r * width + c] = type;
    }
  };

  // Perimeter boundary
  for (let c = 0; c < width; c++) {
    setTile(c, 0, TILE_TYPES.WALL);
    setTile(c, height - 1, TILE_TYPES.WALL);
  }
  for (let r = 0; r < height; r++) {
    setTile(0, r, TILE_TYPES.WALL);
    setTile(width - 1, r, TILE_TYPES.WALL);
  }

  // Inner Fortress Gallery (Bordering Center Courtyard c=10..25, r=10..25)
  for (let c = 7; c <= 28; c++) {
    if (c < 15 || c > 20) {
      setTile(c, 10, TILE_TYPES.WALL);
      setTile(c, 25, TILE_TYPES.WALL);
    }
  }

  for (let r = 7; r <= 28; r++) {
    if (r < 15 || r > 20) {
      setTile(10, r, TILE_TYPES.WALL);
      setTile(25, r, TILE_TYPES.WALL);
    }
  }

  // 4 Corner Bastion Fortress partitions
  for (let c = 3; c <= 7; c++) setTile(c, 5, TILE_TYPES.OBSTACLE);
  for (let c = 28; c <= 32; c++) setTile(c, 5, TILE_TYPES.OBSTACLE);
  for (let c = 3; c <= 7; c++) setTile(c, 30, TILE_TYPES.OBSTACLE);
  for (let c = 28; c <= 32; c++) setTile(c, 30, TILE_TYPES.OBSTACLE);

  // Central Alchemical Chamber
  setTile(17, 17, TILE_TYPES.OBSTACLE);
  setTile(18, 17, TILE_TYPES.OBSTACLE);
  setTile(17, 18, TILE_TYPES.OBSTACLE);
  setTile(18, 18, TILE_TYPES.OBSTACLE);

  // Courtyard Condenser Columns
  setTile(13, 13, TILE_TYPES.OBSTACLE);
  setTile(22, 13, TILE_TYPES.OBSTACLE);
  setTile(13, 22, TILE_TYPES.OBSTACLE);
  setTile(22, 22, TILE_TYPES.OBSTACLE);

  const spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 3, row: 3 },
    { id: 'player_2', type: SPAWN_TYPES.PLAYER, col: 32, row: 32 },
    { id: 'player_3', type: SPAWN_TYPES.PLAYER, col: 32, row: 3 },
    { id: 'player_4', type: SPAWN_TYPES.PLAYER, col: 3, row: 32 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 17, row: 4 },
    { id: 'bot_2', type: SPAWN_TYPES.BOT, col: 18, row: 31 },
    { id: 'bot_3', type: SPAWN_TYPES.BOT, col: 4, row: 18 },
    { id: 'bot_4', type: SPAWN_TYPES.BOT, col: 31, row: 17 }
  ];

  const pickups = [
    { type: PICKUP_TYPES.AMMO, col: 17, row: 12 },
    { type: PICKUP_TYPES.AMMO, col: 18, row: 23 },
    { type: PICKUP_TYPES.HEALTH, col: 12, row: 17 },
    { type: PICKUP_TYPES.HEALTH, col: 23, row: 18 },
    { type: PICKUP_TYPES.AMMO, col: 5, row: 8 },
    { type: PICKUP_TYPES.HEALTH, col: 30, row: 27 },
    { type: PICKUP_TYPES.AMMO, col: 30, row: 8 },
    { type: PICKUP_TYPES.HEALTH, col: 5, row: 27 }
  ];

  const decorations = [
    { type: DECOR_TYPES.STEAM_VENT, col: 16, row: 16 },
    { type: DECOR_TYPES.STEAM_VENT, col: 19, row: 19 },
    { type: DECOR_TYPES.LANTERN, col: 10, row: 15 },
    { type: DECOR_TYPES.LANTERN, col: 25, row: 20 },
    { type: DECOR_TYPES.TANK, col: 15, row: 13 },
    { type: DECOR_TYPES.TANK, col: 20, row: 22 },
    { type: DECOR_TYPES.BUSH, col: 13, row: 18 },
    { type: DECOR_TYPES.BUSH, col: 22, row: 17 }
  ];

  return {
    version: '1.0',
    name: 'The Alchemical Citadel',
    theme: 'citadel',
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    spawns,
    pickups,
    decorations
  };
}

/**
 * Generates the 40x24 Steam Rail Terminal battle arena (1600x960 px).
 * Expansive train terminal with dual parallel railway tracks, passenger carriages, and luggage halls.
 * @returns {Object} BattleMap object
 */
export function createSteamRailTerminalMap() {
  const width = 40;
  const height = 24;
  const tiles = new Array(width * height).fill(TILE_TYPES.FLOOR);

  const setTile = (c, r, type) => {
    if (c >= 0 && c < width && r >= 0 && r < height) {
      tiles[r * width + c] = type;
    }
  };

  // Perimeter boundary
  for (let c = 0; c < width; c++) {
    setTile(c, 0, TILE_TYPES.WALL);
    setTile(c, height - 1, TILE_TYPES.WALL);
  }
  for (let r = 0; r < height; r++) {
    setTile(0, r, TILE_TYPES.WALL);
    setTile(width - 1, r, TILE_TYPES.WALL);
  }

  // Train 1 on North Track (r=9)
  const train1Cars = [
    [6, 9], [7, 9], [8, 9], [9, 9],
    [13, 9], [14, 9], [15, 9], [16, 9],
    [23, 9], [24, 9], [25, 9], [26, 9],
    [30, 9], [31, 9], [32, 9], [33, 9]
  ];
  for (const [c, r] of train1Cars) {
    setTile(c, r, TILE_TYPES.OBSTACLE);
  }

  // Train 2 on South Track (r=14)
  const train2Cars = [
    [6, 14], [7, 14], [8, 14], [9, 14],
    [13, 14], [14, 14], [15, 14], [16, 14],
    [23, 14], [24, 14], [25, 14], [26, 14],
    [30, 14], [31, 14], [32, 14], [33, 14]
  ];
  for (const [c, r] of train2Cars) {
    setTile(c, r, TILE_TYPES.OBSTACLE);
  }

  // Platform Passenger Benches & Station Columns (North Platform r=4, South Platform r=19)
  for (let c = 8; c <= 32; c += 6) {
    setTile(c, 4, TILE_TYPES.WALL);
    setTile(c, 19, TILE_TYPES.WALL);
  }

  // Ticket Offices / Luggage Depot (East and West ends)
  setTile(3, 8, TILE_TYPES.OBSTACLE);
  setTile(3, 9, TILE_TYPES.OBSTACLE);
  setTile(3, 14, TILE_TYPES.OBSTACLE);
  setTile(3, 15, TILE_TYPES.OBSTACLE);

  setTile(36, 8, TILE_TYPES.OBSTACLE);
  setTile(36, 9, TILE_TYPES.OBSTACLE);
  setTile(36, 14, TILE_TYPES.OBSTACLE);
  setTile(36, 15, TILE_TYPES.OBSTACLE);

  const spawns = [
    { id: 'player_1', type: SPAWN_TYPES.PLAYER, col: 2, row: 2 },
    { id: 'player_2', type: SPAWN_TYPES.PLAYER, col: 37, row: 21 },
    { id: 'player_3', type: SPAWN_TYPES.PLAYER, col: 37, row: 2 },
    { id: 'player_4', type: SPAWN_TYPES.PLAYER, col: 2, row: 21 },
    { id: 'bot_1', type: SPAWN_TYPES.BOT, col: 19, row: 3 },
    { id: 'bot_2', type: SPAWN_TYPES.BOT, col: 20, row: 20 },
    { id: 'bot_3', type: SPAWN_TYPES.BOT, col: 19, row: 11 },
    { id: 'bot_4', type: SPAWN_TYPES.BOT, col: 20, row: 12 }
  ];

  const pickups = [
    { type: PICKUP_TYPES.AMMO, col: 19, row: 9 },
    { type: PICKUP_TYPES.HEALTH, col: 20, row: 14 },
    { type: PICKUP_TYPES.AMMO, col: 11, row: 4 },
    { type: PICKUP_TYPES.HEALTH, col: 28, row: 19 },
    { type: PICKUP_TYPES.AMMO, col: 28, row: 4 },
    { type: PICKUP_TYPES.HEALTH, col: 11, row: 19 }
  ];

  const decorations = [
    { type: DECOR_TYPES.STEAM_VENT, col: 12, row: 11 },
    { type: DECOR_TYPES.STEAM_VENT, col: 27, row: 12 },
    { type: DECOR_TYPES.LANTERN, col: 6, row: 3 },
    { type: DECOR_TYPES.LANTERN, col: 33, row: 20 },
    { type: DECOR_TYPES.CRATE, col: 5, row: 7 },
    { type: DECOR_TYPES.CRATE, col: 34, row: 16 },
    { type: DECOR_TYPES.SIGN, col: 20, row: 2 }
  ];

  return {
    version: '1.0',
    name: 'The Steam Rail Terminal',
    theme: 'terminal',
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    spawns,
    pickups,
    decorations
  };
}

/**
 * Registry of all official built-in battle map presets.
 */
export const PRESET_MAPS = [
  {
    id: 'foundry',
    name: 'The Clockwork Foundry (20x20 Стандартна)',
    rawName: 'The Clockwork Foundry',
    description: 'Компактна індустріальна ливарня з центральним котлом',
    width: 20,
    height: 20,
    factory: createDefaultMap
  },
  {
    id: 'zeppelin_docks',
    name: 'The Grand Zeppelin Docks (32x32 Велика арена)',
    rawName: 'The Grand Zeppelin Docks',
    description: 'Масивний ангар дирижаблів з вантажними доками та контейнерами',
    width: 32,
    height: 32,
    factory: createGrandZeppelinDocksMap
  },
  {
    id: 'ironworks_catacombs',
    name: 'The Ironworks Catacombs (28x28 Катакомби)',
    rawName: 'The Ironworks Catacombs',
    description: 'Заплутана мережа підземних тунелів, парових труб і тактичних засідок',
    width: 28,
    height: 28,
    factory: createIronworksCatacombsMap
  },
  {
    id: 'alchemical_citadel',
    name: 'The Alchemical Citadel (36x36 Велетенська цитадель)',
    rawName: 'The Alchemical Citadel',
    description: 'Епічна фортеця з чотирма бастіонами та центральним алхімічним плацом',
    width: 36,
    height: 36,
    factory: createAlchemicalCitadelMap
  },
  {
    id: 'steam_terminal',
    name: 'The Steam Rail Terminal (40x24 Довгий вокзал)',
    rawName: 'The Steam Rail Terminal',
    description: 'Широкий залізничний вокзал з пасажирськими потягами та відкритими перонами',
    width: 40,
    height: 24,
    factory: createSteamRailTerminalMap
  }
];

/**
 * Retrieves a fresh instance of a preset map by id, name, or raw name.
 * @param {string} [idOrName]
 * @returns {Object} BattleMap object
 */
export function getPresetMap(idOrName) {
  if (!idOrName || idOrName === '__default__') {
    return createDefaultMap();
  }
  const needle = String(idOrName).toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = PRESET_MAPS.find(p => {
    const pid = p.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const praw = (p.rawName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pname = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return pid === needle || praw === needle || pname === needle ||
           needle.includes(pid) || pid.includes(needle) ||
           (praw && (needle.includes(praw) || praw.includes(needle)));
  });
  if (found && typeof found.factory === 'function') {
    return found.factory();
  }
  return createDefaultMap();
}

/**
 * Serializes a battle map object to a JSON string.
 * @param {Object} map - Map object
 * @returns {string} Formatted JSON string
 */
export function serializeMap(map) {
  if (!map || typeof map !== 'object') {
    throw new Error('Cannot serialize invalid map object');
  }
  return JSON.stringify(map, null, 2);
}

/**
 * Deserializes a JSON string into a battle map object.
 * @param {string} jsonStr - JSON string representation of a map
 * @returns {Object} Parsed map object
 */
export function deserializeMap(jsonStr) {
  if (typeof jsonStr !== 'string') {
    throw new Error('deserializeMap expects a string input');
  }
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse map JSON: ${err.message}`);
  }
}
