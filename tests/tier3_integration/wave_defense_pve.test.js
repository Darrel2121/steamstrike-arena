/**
 * Tier 3: PvE Wave Defense (Steam Core Defense) Integration Tests
 * Validates Steam Core initialization, progressive wave spawning,
 * invader bot AI core targeting, core destruction defeat condition,
 * wave clearance repair and final victory condition.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';
import { GAME_MODES, STEAM_CORE_MAX_HP, STEAM_CORE_RADIUS } from '../../shared/Constants.js';
import { Room } from '../../server/Room.js';
import { Bot } from '../../server/entities/Bot.js';

export const suiteName = 'Tier 3: PvE Wave Defense & Steam Core Mechanics';

export const tests = [
  {
    id: 'T3.PVE1',
    name: 'Wave Defense Initialization: Steam Core Placed with Full HP and Preparation Phase',
    fn: async () => {
      const room = new Room({
        id: 'pve_init_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      assert.strictEqual(room.isWaveDefense(), true, 'Must identify as Wave Defense mode');
      assert.strictEqual(room.isTeamMode(), true, 'Wave Defense must be team mode');
      assert.strictEqual(room.isRespawnMode(), true, 'Defenders respawn in Wave Defense');

      const p1 = room.addPlayer('p1', 'Defender_1');
      room.startMatch();

      assert.strictEqual(p1.team, 'defenders', 'All human players must be on defenders team');
      assert.ok(room.steamCore, 'Steam Core must be initialized at arena center');
      assert.strictEqual(room.steamCore.hp, STEAM_CORE_MAX_HP, `Core HP must be ${STEAM_CORE_MAX_HP}`);
      assert.strictEqual(room.steamCore.radius, STEAM_CORE_RADIUS, `Core radius must be ${STEAM_CORE_RADIUS}`);
      assert.strictEqual(room.waveState, 'PREPARATION', 'Initial wave state must be PREPARATION');
      assert.strictEqual(room.currentWave, 0, 'Current wave should start at 0');
    }
  },

  {
    id: 'T3.PVE2',
    name: 'Progressive Wave Spawning: Queue Composition & Invader Spawns',
    fn: async () => {
      const room = new Room({
        id: 'pve_wave_spawning',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      room.addPlayer('p1', 'Defender_1');
      room.startMatch();

      // Start Wave 1
      room.startWave(1);
      assert.strictEqual(room.currentWave, 1);
      assert.strictEqual(room.waveState, 'WAVE_ACTIVE');
      assert.strictEqual(room.waveSpawnQueue.length, 5, 'Wave 1 must queue 5 enemies');

      // Tick through to spawn an enemy
      for (let i = 0; i < 30; i++) {
        room.tick();
      }
      assert.ok(room.bots.size > 0, 'Invader bot must be spawned from queue');
      const invader = Array.from(room.bots.values())[0];
      assert.strictEqual(invader.team, 'invaders', 'Wave enemy must have team invaders');

      // Test Wave 5 Colossus Boss queue
      room.startWave(5);
      assert.strictEqual(room.currentWave, 5);
      const bossSpec = room.waveSpawnQueue.find(s => s.isBoss);
      assert.ok(bossSpec, 'Wave 5 must contain a Colossus Boss');
      assert.strictEqual(bossSpec.hp, 600, 'Boss must have 600 HP');
    }
  },

  {
    id: 'T3.PVE3',
    name: 'Invader AI & Steam Core Projectile Damage',
    fn: async () => {
      const room = new Room({
        id: 'pve_core_damage',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      room.addPlayer('p1', 'Defender_1');
      room.startMatch();
      room.startWave(1);

      const initialCoreHp = room.steamCore.hp;
      room.damageSteamCore(75, 'invader_test');

      assert.strictEqual(room.steamCore.hp, initialCoreHp - 75, 'Steam Core must take exact damage');
      assert.strictEqual(room.steamCore.isAlive, true);
    }
  },

  {
    id: 'T3.PVE4',
    name: 'Core Destruction & Defeat Outcome Resolution',
    fn: async () => {
      const room = new Room({
        id: 'pve_defeat_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      room.addPlayer('p1', 'Defender_1');
      room.startMatch();

      // Destroy core completely
      room.damageSteamCore(STEAM_CORE_MAX_HP, 'invader_boss');

      assert.strictEqual(room.steamCore.hp, 0, 'Core HP must reach 0');
      assert.strictEqual(room.steamCore.isAlive, false, 'Core must be dead');
      assert.strictEqual(room.state, 'GAME_OVER', 'Room state must transition to GAME_OVER');
      assert.strictEqual(room.lastMatchOutcome.winningTeam, 'invaders', 'Invaders must win when core is destroyed');
    }
  },

  {
    id: 'T3.PVE5',
    name: 'Wave Clearance, Steam Core Repair & Final Victory Outcome',
    fn: async () => {
      const room = new Room({
        id: 'pve_victory_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      const p1 = room.addPlayer('p1', 'Hero_Defender');
      room.startMatch();

      // Damage core slightly
      room.damageSteamCore(200, 'invader_1');
      assert.strictEqual(room.steamCore.hp, 800);

      // Complete wave 1
      room.currentWave = 1;
      room.completeWave();
      assert.ok(room.steamCore.hp > 800, 'Steam core must receive repairs after wave completion');
      assert.strictEqual(room.waveState, 'PREPARATION', 'State must enter PREPARATION for next wave');

      // Complete wave 5 (final wave)
      room.currentWave = 5;
      room.completeWave();
      assert.strictEqual(room.waveState, 'CLEARED');
      assert.strictEqual(room.state, 'GAME_OVER');
      assert.strictEqual(room.lastMatchOutcome.winningTeam, 'defenders', 'Defenders must win after clearing 5 waves');
    }
  },

  {
    id: 'T3.PVE6',
    name: 'Snapshot Serialization: Transmits Steam Core & Wave Info for HUD',
    fn: async () => {
      const room = new Room({
        id: 'pve_snapshot_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      room.addPlayer('p1', 'Defender_1');
      room.startMatch();
      room.startWave(2);

      let broadcastedPayload = null;
      room.broadcast = (type, payload) => {
        broadcastedPayload = payload;
      };

      room.broadcastSnapshot();

      assert.ok(broadcastedPayload, 'Snapshot must be broadcasted');
      assert.strictEqual(broadcastedPayload.gameMode, GAME_MODES.WAVE_DEFENSE);
      assert.ok(broadcastedPayload.steamCore, 'Snapshot must contain steamCore');
      assert.strictEqual(broadcastedPayload.steamCore.hp, STEAM_CORE_MAX_HP);
      assert.ok(broadcastedPayload.waveInfo, 'Snapshot must contain waveInfo');
      assert.strictEqual(broadcastedPayload.waveInfo.currentWave, 2);
      assert.strictEqual(broadcastedPayload.waveInfo.maxWaves, 5);
      assert.strictEqual(broadcastedPayload.waveInfo.waveState, 'WAVE_ACTIVE');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}

if (process.argv[1]?.endsWith('wave_defense_pve.test.js')) {
  runSuiteHelper(suiteName, tests);
}
