import assert from 'assert';
import { Room } from '../server/Room.js';
import { Player } from '../server/entities/Player.js';
import { Bot } from '../server/entities/Bot.js';
import {
  createDefaultMap,
  validateMap,
  serializeMap,
  deserializeMap,
  DECOR_TYPES,
  TILE_TYPES
} from '../shared/MapSchema.js';

console.log('Testing decor validation and serialization...');
const map = createDefaultMap();
assert.ok(map.decorations.some(d => d.type === 'crack'), 'Should contain crack decor');
assert.ok(map.decorations.some(d => d.type === 'sign'), 'Should contain sign decor');
assert.ok(map.decorations.some(d => d.type === 'bush'), 'Should contain bush decor');

const validation = validateMap(map);
assert.strictEqual(validation.valid, true, 'Default map with new decors must be valid');

// Test serialization round-trip
const serialized = serializeMap(map);
const deserialized = deserializeMap(serialized);
assert.strictEqual(deserialized.decorations.length, map.decorations.length, 'Decors should survive roundtrip');

console.log('Testing map dimensions (30x30, 40x40, 50x50)...');
for (const dim of [30, 40, 50]) {
  const customMap = {
    ...createDefaultMap(),
    width: dim,
    height: dim,
    tiles: new Array(dim * dim).fill(TILE_TYPES.FLOOR)
  };
  // Add perimeter walls
  for (let c = 0; c < dim; c++) {
    customMap.tiles[0 * dim + c] = TILE_TYPES.WALL;
    customMap.tiles[(dim - 1) * dim + c] = TILE_TYPES.WALL;
  }
  for (let r = 0; r < dim; r++) {
    customMap.tiles[r * dim + 0] = TILE_TYPES.WALL;
    customMap.tiles[r * dim + (dim - 1)] = TILE_TYPES.WALL;
  }
  const v = validateMap(customMap);
  assert.strictEqual(v.valid, true, `Map ${dim}x${dim} should be valid`);
}

console.log('Testing safe bot spawning and distance from player...');
const room = new Room({ id: 'test_safe_spawns', autoFillBots: true, maxPlayers: 4 });
const player = room.addPlayer('human_1', 'Ranger');
room.startMatch();

assert.strictEqual(player.hp, 100, 'Player must start with 100 HP');
assert.strictEqual(player.isAlive, true, 'Player must be alive at match start');
assert.strictEqual(room.bots.size, 3, 'Must have 3 bots in match');

for (const bot of room.bots.values()) {
  const dist = Math.hypot(bot.x - player.x, bot.y - player.y);
  console.log(`Bot ${bot.id} spawn distance to player: ${Math.round(dist)}px`);
  assert.ok(dist >= 200, `Bot ${bot.id} must spawn at least 200px from player (actual: ${dist}px)`);
  assert.ok(bot.fireCooldown >= 1.0, `Bot ${bot.id} must have initial fireCooldown >= 1.0`);
  assert.strictEqual(bot.aimTime, -1.0, `Bot ${bot.id} must have aimTime = -1.0`);
}

console.log('Testing Player fireCooldown and auto-reload on firing when empty...');
const testPlayer = new Player({ id: 'p_test', ammo: 6, maxAmmo: 6 });
// Fire 1st shot
const f1 = testPlayer.fire(true);
assert.strictEqual(f1, true, 'First shot must succeed');
assert.ok(testPlayer.fireCooldown > 0, 'Fire cooldown must be active after shot');
// 2nd shot with checkCooldown=true should fail
const f2 = testPlayer.fire(true);
assert.strictEqual(f2, false, 'Shot during cooldown must fail');
// Update dt = 0.6s
testPlayer.update(0.6);
assert.strictEqual(testPlayer.fireCooldown, 0, 'Cooldown should elapse');
const f3 = testPlayer.fire(true);
assert.strictEqual(f3, true, 'Shot after cooldown must succeed');

console.log('All verification assertions passed successfully!');
