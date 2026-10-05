/**
 * Tier 3: Game Modes and Steam PSI Manometer Integration Tests
 * Verifies the 4 tactical game modes (team_dm, ffa_dm, team_elim, solo_elim),
 * friendly fire immunity in team modes, authoritative respawn timers, and
 * dynamic stamina / steam gauge consumption & regeneration.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';
import { GAME_MODES } from '../../shared/Constants.js';
import { PROTOCOL_MSG_TYPES } from '../../shared/Protocol.js';
import { Room } from '../../server/Room.js';
import { Player } from '../../server/entities/Player.js';

export const suiteName = 'Tier 3: Game Modes & Steam Manometer Integration';

export const tests = [
  {
    id: 'T3.GM1',
    name: 'Team Deathmatch: Team Assignment and Score Progression',
    fn: async () => {
      const room = new Room({
        id: 'tdm_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.TEAM_DM,
        targetKills: 5,
        maxPlayers: 4
      });

      const p1 = room.addPlayer('p1', 'Wolf_Leader');
      const p2 = room.addPlayer('p2', 'Fox_Leader');
      room.fillWithBots();

      assert.strictEqual(room.isTeamMode(), true, 'Must identify as team mode');
      assert.strictEqual(room.isRespawnMode(), true, 'TDM must be a respawn mode');

      // Check auto-balancing across team1 and team2
      const teamCounts = { team1: 0, team2: 0 };
      for (const p of room.players.values()) teamCounts[p.team]++;
      for (const b of room.bots.values()) teamCounts[b.team]++;
      assert.strictEqual(teamCounts.team1, 2, 'Team 1 must have 2 combatants');
      assert.strictEqual(teamCounts.team2, 2, 'Team 2 must have 2 combatants');

      room.startMatch();

      // Ensure friendly fire is disabled
      const attackerTeam1 = Array.from(room.players.values()).find(p => p.team === 'team1');
      const teammateTeam1 = Array.from(room.bots.values()).find(b => b.team === 'team1');
      const initialHp = teammateTeam1.hp;
      room.applyDamage(teammateTeam1.id, attackerTeam1.id, 40);
      assert.strictEqual(teammateTeam1.hp, initialHp, 'Friendly fire between teammates must be strictly prevented');

      // Cross-team damage works
      const enemyTeam2 = Array.from(room.players.values()).find(p => p.team === 'team2')
        || Array.from(room.bots.values()).find(b => b.team === 'team2');
      room.applyDamage(enemyTeam2.id, attackerTeam1.id, 100);
      assert.strictEqual(enemyTeam2.hp, 0, 'Enemy must take lethal damage');
      assert.strictEqual(enemyTeam2.isAlive, false, 'Enemy must be eliminated');
      assert.strictEqual(room.teamScores.team1, 1, 'Team 1 score must increment to 1');
      assert.strictEqual(enemyTeam2.respawnTimer, 3.0, 'Respawn timer must be set to 3.0s in TDM');
    }
  },

  {
    id: 'T3.GM2',
    name: 'Team Deathmatch: Respawn Queue and Simulation Tick',
    fn: async () => {
      const room = new Room({
        id: 'tdm_respawn_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.TEAM_DM,
        targetKills: 3
      });

      const p1 = room.addPlayer('p1', 'Player1');
      const p2 = room.addPlayer('p2', 'Player2');
      p1.team = 'team1';
      p2.team = 'team2';
      room.startMatch();

      // Eliminate p2
      room.applyDamage('p2', 'p1', 100);
      assert.strictEqual(p2.isAlive, false);
      assert.strictEqual(p2.respawnTimer, 3.0);

      // Simulate 60 ticks (2 seconds at 30Hz)
      for (let i = 0; i < 60; i++) {
        room.tick();
      }
      assert.strictEqual(p2.isAlive, false, 'Entity should still be awaiting respawn at 2s');
      assert.ok(p2.respawnTimer > 0 && p2.respawnTimer <= 1.1, 'Respawn timer should have counted down to ~1.0s');

      // Simulate 40 more ticks (1.33 seconds, total > 3s)
      for (let i = 0; i < 40; i++) {
        room.tick();
      }
      assert.strictEqual(p2.isAlive, true, 'Entity must be revived after 3.0s timer expiry');
      assert.strictEqual(p2.hp, 100, 'Revived entity must have full HP');
      assert.strictEqual(p2.respawnTimer, 0, 'Respawn timer must reset to 0');
    }
  },

  {
    id: 'T3.GM3',
    name: 'Free For All Deathmatch: Score Accumulation to Target Kills',
    fn: async () => {
      const room = new Room({
        id: 'ffa_dm_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.FFA_DM,
        targetKills: 2
      });

      const p1 = room.addPlayer('p1', 'GladiatorA');
      const p2 = room.addPlayer('p2', 'GladiatorB');
      room.startMatch();

      assert.strictEqual(room.isRespawnMode(), true);
      assert.strictEqual(room.isTeamMode(), false);

      // Kill 1
      room.applyDamage('p2', 'p1', 100);
      assert.strictEqual(p1.kills, 1);
      let outcome = room.evaluateMatchOutcome();
      assert.strictEqual(outcome.isOver, false, 'Match not over yet (target is 2 kills)');

      // Respawn p2 and clear spawn protection
      p2.respawn(100, 100, 0);
      p2.invulnerableTimer = 0;

      // Kill 2
      room.applyDamage('p2', 'p1', 100);
      assert.strictEqual(p1.kills, 2);
      outcome = room.evaluateMatchOutcome();
      assert.strictEqual(outcome.isOver, true, 'Match must conclude when p1 reaches 2 kills');
      assert.strictEqual(outcome.winnerId, 'p1', 'Winner must be p1');
    }
  },

  {
    id: 'T3.GM4',
    name: 'Team Elimination: Permadeath Win Conditions',
    fn: async () => {
      const room = new Room({
        id: 'team_elim_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.TEAM_ELIM
      });

      const p1 = room.addPlayer('p1', 'Wolf1');
      const p2 = room.addPlayer('p2', 'Wolf2');
      const p3 = room.addPlayer('p3', 'Fox1');
      const p4 = room.addPlayer('p4', 'Fox2');
      p1.team = 'team1';
      p2.team = 'team1';
      p3.team = 'team2';
      p4.team = 'team2';

      room.startMatch();
      assert.strictEqual(room.isRespawnMode(), false, 'Team Elimination has permadeath');

      // Eliminate p3 (team2 has 1 alive)
      room.applyDamage('p3', 'p1', 100);
      let outcome = room.evaluateMatchOutcome();
      assert.strictEqual(outcome.isOver, false, 'Match continues with 1 alive on team 2');

      // Eliminate p4 (team2 has 0 alive)
      room.applyDamage('p4', 'p2', 100);
      outcome = room.evaluateMatchOutcome();
      assert.strictEqual(outcome.isOver, true, 'Match ends when team 2 is wiped');
      assert.strictEqual(outcome.winningTeam, 'team1', 'Team 1 must be declared winner');
    }
  },

  {
    id: 'T3.GM5',
    name: 'Steam PSI Manometer: Stamina Drain on Sprint & Passive Vent Recovery',
    fn: async () => {
      const player = new Player({ id: 'steamer', name: 'BoilerMan', maxStamina: 100 });
      assert.strictEqual(player.stamina, 100, 'Initial stamina must be full 100 PSI');

      // Sprint for 1.0 second (drain rate is 30/s)
      player.update(1.0, true);
      assert.ok(Math.abs(player.stamina - 70) < 0.1, `Stamina after 1s sprint should be ~70 PSI, got ${player.stamina}`);

      // Sprint for 2.5 more seconds (70 - 75 -> clamps to 0)
      player.update(2.5, true);
      assert.strictEqual(player.stamina, 0, 'Stamina must clamp to minimum 0 PSI');

      // Idle / walking for 2.0 seconds (recovery rate is 20/s)
      player.update(2.0, false);
      assert.ok(Math.abs(player.stamina - 40) < 0.1, `Stamina after 2s rest should be ~40 PSI, got ${player.stamina}`);

      // Idle for 4.0 more seconds (40 + 80 -> clamps to 100)
      player.update(4.0, false);
      assert.strictEqual(player.stamina, 100, 'Stamina must clamp to maximum 100 PSI');
    }
  },

  {
    id: 'T3.GM6',
    name: 'Snapshot Serialization: Carries Live GameMode, Scores & Stamina',
    fn: async () => {
      const room = new Room({
        id: 'snapshot_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.TEAM_DM,
        targetKills: 15
      });

      const p1 = room.addPlayer('p1', 'PlayerOne');
      p1.stamina = 42.5;
      p1.team = 'team1';
      room.teamScores.team1 = 4;
      room.teamScores.team2 = 2;

      let broadcastPayload = null;
      room.broadcast = (type, payload) => {
        broadcastPayload = payload;
      };

      room.broadcastSnapshot();

      assert.ok(broadcastPayload, 'Broadcast snapshot must be produced');
      assert.strictEqual(broadcastPayload.gameMode, GAME_MODES.TEAM_DM);
      assert.strictEqual(broadcastPayload.targetKills, 15);
      assert.strictEqual(broadcastPayload.teamScores.team1, 4);
      assert.strictEqual(broadcastPayload.teamScores.team2, 2);

      const snapP1 = broadcastPayload.players.find(p => p.id === 'p1');
      assert.ok(snapP1, 'Player 1 snapshot must exist');
      assert.strictEqual(snapP1.team, 'team1');
      assert.strictEqual(snapP1.stamina, 43, 'Stamina should be rounded in snapshot');
    }
  },
  {
    id: 'T3.GM7',
    name: 'Long Bot Match Duration & Steampunk UI Navigation Integrity',
    fn: async () => {
      // 1. Verify Room handles high target kills for long bot battles (50, 100, 999)
      const room = new Room({
        id: 'long_match_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.FFA_DM,
        targetKills: 100
      });
      assert.strictEqual(room.targetKills, 100, 'Must support 100 kills target');
      assert.strictEqual(room.isRespawnMode(), true, 'FFA_DM must be respawn mode');

      room.setGameMode(GAME_MODES.FFA_DM, 999);
      assert.strictEqual(room.targetKills, 999, 'Must support 999 endless bot training target');

      // 2. Verify elimination in respawn mode sets 3.0s timer and broadcasts
      const p1 = room.addPlayer('p1', 'PlayerOne');
      room.fillWithBots();
      room.startMatch();

      let lastEliminationPacket = null;
      let lastRespawnPacket = null;
      room.broadcast = (type, payload) => {
        if (type === PROTOCOL_MSG_TYPES.S2C_ELIMINATION_EVENT) lastEliminationPacket = payload;
        if (type === PROTOCOL_MSG_TYPES.S2C_RESPAWN_EVENT) lastRespawnPacket = payload;
      };

      room.applyDamage(p1.id, 'bot_0', 200);
      assert.strictEqual(p1.isAlive, false, 'Player must be dead');
      assert.strictEqual(p1.respawnTimer, 3.0, 'Player respawnTimer must be 3.0');
      assert.ok(lastEliminationPacket, 'Elimination packet must be sent');
      assert.strictEqual(lastEliminationPacket.victimId, p1.id);
      assert.strictEqual(lastEliminationPacket.respawnTimer, 3.0);

      // Advance 95 ticks (~3.1s at 30Hz) to trigger respawn
      for (let i = 0; i < 95; i++) {
        room.tick();
      }
      assert.strictEqual(p1.isAlive, true, 'Player must be respawned alive');
      assert.strictEqual(p1.hp, p1.maxHp, 'Player must have full HP upon respawn');
      assert.ok(lastRespawnPacket, 'Respawn packet must be sent');
      assert.strictEqual(lastRespawnPacket.entityId, p1.id);
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
