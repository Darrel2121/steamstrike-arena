/**
 * Tier 2.13: Bot AI Sensory Awareness, FSM State Priority & Labyrinth Grid Navigation Adversarial Stress Suite
 * Authored by: challenger_m4_2
 * Milestone: M4 (Bot Sensory Perception & Grid Navigation Stress)
 *
 * Empirically stress-tests:
 * 1. Labyrinth maze pathfinding: orthogonal traversal on floor tiles (tile === 0), zero wall cutting, reachability oracles
 * 2. Sensory priority interruption fuzzing: 100+ rapid alternations between sound & vision, visual override invariant (T3.5)
 * 3. Target elimination & memory reset: corpse ignoring, clean patrol resumption, mid-tick disconnect resilience
 * 4. 10-bot live simulation stress: crowded room 100 ticks benchmark (< 5ms/tick budget), crossfire kinematics
 */

import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { Bot, findPath } from '../../server/entities/Bot.js';
import { Player } from '../../server/entities/Player.js';
import { Room } from '../../server/Room.js';
import {
  canonicalFoundryMap,
  stress100x100Map,
  completelyEmptyMap,
  disconnectedMap
} from '../fixtures/maps.fixture.js';
import { performance } from 'node:perf_hooks';

export const suiteName = 'Tier 2.13: Bot AI Sensory Perception & Grid Navigation Stress';

/**
 * Independent Procedural Maze Generator (DFS Recursive Backtracker).
 * Generates perfect mazes with single-tile narrow corridors, loops, and dead ends.
 */
function generateMaze(width, height, braidChance = 0.1) {
  // Ensure odd dimensions for proper wall/corridor grid
  const w = width % 2 === 0 ? width + 1 : width;
  const h = height % 2 === 0 ? height + 1 : height;
  const tiles = new Array(w * h).fill(1); // 1 = solid wall

  function carve(cx, cy) {
    tiles[cy * w + cx] = 0;
    const dirs = [
      { dx: 0, dy: -2 },
      { dx: 2, dy: 0 },
      { dx: 0, dy: 2 },
      { dx: -2, dy: 0 }
    ].sort(() => Math.random() - 0.5);

    for (const d of dirs) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && tiles[ny * w + nx] === 1) {
        tiles[(cy + d.dy / 2) * w + (cx + d.dx / 2)] = 0;
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);

  // Add random loops (braiding)
  if (braidChance > 0) {
    for (let r = 2; r < h - 2; r += 2) {
      for (let c = 2; c < w - 2; c += 2) {
        if (tiles[r * w + c] === 1 && Math.random() < braidChance) {
          tiles[r * w + c] = 0;
        }
      }
    }
  }

  return {
    version: '1.0',
    name: 'Procedural Labyrinth',
    width: w,
    height: h,
    tileSize: 40,
    tiles,
    spawns: [
      { id: 'b1', type: 'bot', col: 1, row: 1 },
      { id: 'p1', type: 'player', col: w - 2, row: h - 2 }
    ]
  };
}

/**
 * Independent Ground-Truth BFS Shortest Path Length Oracle.
 */
function oracleShortestPathLength(map, sc, sr, gc, gr) {
  const w = map.width;
  const h = map.height;
  if (sc < 0 || sc >= w || sr < 0 || sr >= h) return -1;
  if (gc < 0 || gc >= w || gr < 0 || gr >= h) return -1;
  if (map.tiles[sr * w + sc] !== 0 || map.tiles[gr * w + gc] !== 0) return -1;
  if (sc === gc && sr === gr) return 1;

  const queue = [{ c: sc, r: sr, dist: 1 }];
  const visited = new Uint8Array(w * h);
  visited[sr * w + sc] = 1;

  const dirs = [
    { dc: 0, dr: -1 },
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 }
  ];

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    if (curr.c === gc && curr.r === gr) return curr.dist;

    for (const d of dirs) {
      const nc = curr.c + d.dc;
      const nr = curr.r + d.dr;
      if (nc >= 0 && nc < w && nr >= 0 && nr < h) {
        const idx = nr * w + nc;
        if (!visited[idx] && map.tiles[idx] === 0) {
          visited[idx] = 1;
          queue.push({ c: nc, r: nr, dist: curr.dist + 1 });
        }
      }
    }
  }

  return -1;
}

export const tests = [
  // ==========================================================================
  // Suite 1: Labyrinth Maze Pathfinding Stress
  // ==========================================================================
  {
    id: 'T2.B1',
    name: 'Labyrinth Pathfinding: Strictly Orthogonal Floor Navigation & Zero Wall Penetration',
    fn: async () => {
      // Generate a 21x21 labyrinth with dead ends and 1-tile narrow corridors
      const maze = generateMaze(21, 21, 0); // Pure tree maze (no loops)
      const start = { col: 1, row: 1 };
      const goal = { col: maze.width - 2, row: maze.height - 2 };

      const path = findPath(maze, start, goal);
      assert.ok(Array.isArray(path), 'findPath must return an array');
      assert.ok(path.length >= 2, `Path must contain at least 2 waypoints, got ${path.length}`);

      // Verify start and end points
      assert.strictEqual(path[0].col, start.col, 'First waypoint col must match start');
      assert.strictEqual(path[0].row, start.row, 'First waypoint row must match start');
      assert.strictEqual(path[path.length - 1].col, goal.col, 'Last waypoint col must match goal');
      assert.strictEqual(path[path.length - 1].row, goal.row, 'Last waypoint row must match goal');

      // Verify each waypoint is strictly floor (0) and strictly orthogonal step from previous
      for (let i = 0; i < path.length; i++) {
        const wp = path[i];
        const tile = maze.tiles[wp.row * maze.width + wp.col];
        assert.strictEqual(tile, 0, `Waypoint ${i} at (${wp.col}, ${wp.row}) must be walkable floor (0), but was tile ${tile}`);

        if (i > 0) {
          const prev = path[i - 1];
          const manhattan = Math.abs(wp.col - prev.col) + Math.abs(wp.row - prev.row);
          assert.strictEqual(manhattan, 1, `Waypoints must be strictly orthogonal neighbors (Manhattan dist 1), but was ${manhattan} between step ${i - 1} and ${i}`);
        }
      }
    }
  },

  {
    id: 'T2.B2',
    name: 'Labyrinth Pathfinding: Shortest-Path Optimality Oracle on Braided 31x31 Maze',
    fn: async () => {
      // 31x31 maze with multiple alternative routes (loops)
      const maze = generateMaze(31, 31, 0.25);
      const start = { col: 1, row: 1 };
      const goal = { col: maze.width - 2, row: maze.height - 2 };

      const oracleDist = oracleShortestPathLength(maze, start.col, start.row, goal.col, goal.row);
      assert.ok(oracleDist > 0, 'Oracle must find valid path on generated maze');

      const path = findPath(maze, start, goal);
      assert.strictEqual(
        path.length,
        oracleDist,
        `findPath must return exact mathematical shortest path length (oracle: ${oracleDist}, bot: ${path.length})`
      );
    }
  },

  {
    id: 'T2.B3',
    name: 'Labyrinth Pathfinding: Disconnected & Partitioned Arena Reachability Oracle',
    fn: async () => {
      // disconnectedMap has a solid vertical wall at col 10 completely dividing left and right halves
      const start = { col: 2, row: 2 };
      const unreachableGoal = { col: 17, row: 17 };

      const path = findPath(disconnectedMap, start, unreachableGoal);
      assert.deepStrictEqual(path, [], 'findPath must return empty array [] for topologically unreachable target');

      // Enclosed vault: 3x3 solid wall surrounding a floor tile at (5, 5)
      const vaultMap = {
        version: '1.0',
        name: 'Vault Map',
        width: 15,
        height: 15,
        tileSize: 40,
        tiles: new Array(225).fill(0),
        spawns: [{ id: 'b', type: 'bot', col: 1, row: 1 }]
      };
      // Enclose (5, 5) with solid walls
      for (let r = 4; r <= 6; r++) {
        for (let c = 4; c <= 6; c++) {
          if (r !== 5 || c !== 5) {
            vaultMap.tiles[r * 15 + c] = 1;
          }
        }
      }

      const vaultPath = findPath(vaultMap, { col: 1, row: 1 }, { col: 5, row: 5 });
      assert.deepStrictEqual(vaultPath, [], 'findPath must return empty array [] for destination inside sealed vault');
    }
  },

  {
    id: 'T2.B4',
    name: 'Labyrinth Pathfinding: Solid Wall Destination Fallback to Adjacent Floor',
    fn: async () => {
      // In canonicalFoundryMap, center boiler obstacle is at col 9, row 9
      const wallGoal = { col: 9, row: 9 };
      assert.notStrictEqual(canonicalFoundryMap.tiles[9 * 20 + 9], 0, 'Target tile (9,9) must be an obstacle/wall');

      const path = findPath(canonicalFoundryMap, { col: 2, row: 2 }, wallGoal);
      assert.ok(path.length >= 2, 'findPath should successfully find path to closest adjacent floor tile');

      const endTile = path[path.length - 1];
      assert.strictEqual(
        canonicalFoundryMap.tiles[endTile.row * 20 + endTile.col],
        0,
        'Path must end on walkable floor tile adjacent to obstacle'
      );
      const distToWall = Math.max(Math.abs(endTile.col - 9), Math.abs(endTile.row - 9));
      assert.strictEqual(distToWall, 1, 'End tile must be adjacent to the obstacle (Chebyshev distance 1)');
    }
  },

  {
    id: 'T2.B5',
    name: 'Labyrinth Pathfinding: Degenerate Inputs, Boundary Coordinates & Map Invariants',
    fn: async () => {
      const map = canonicalFoundryMap;

      // 1. Trivial start === goal
      const trivial = findPath(map, { col: 2, row: 2 }, { col: 2, row: 2 });
      assert.strictEqual(trivial.length, 1, 'Identical start and goal should return 1-element path');
      assert.deepStrictEqual(trivial[0], { col: 2, row: 2 });

      // 2. Start tile on solid wall
      const wallStart = findPath(map, { col: 0, row: 0 }, { col: 2, row: 2 });
      assert.deepStrictEqual(wallStart, [], 'Start on wall must return empty array');

      // 3. Out-of-bounds start or goal
      assert.deepStrictEqual(findPath(map, { col: -5, row: 2 }, { col: 2, row: 2 }), []);
      assert.deepStrictEqual(findPath(map, { col: 2, row: -1 }, { col: 2, row: 2 }), []);
      assert.deepStrictEqual(findPath(map, { col: 2, row: 2 }, { col: 999, row: 2 }), []);
      assert.deepStrictEqual(findPath(map, { col: 2, row: 2 }, { col: 2, row: 999 }), []);

      // 4. Pixel-coordinate inputs { x, y }
      const pixelPath = findPath(map, { x: 85, y: 85 }, { x: 205, y: 85 });
      assert.ok(pixelPath.length >= 2, 'Pixel coordinates must be mapped accurately using tileSize');
      assert.strictEqual(pixelPath[0].col, 2);
      assert.strictEqual(pixelPath[0].row, 2);

      // 5. Malformed / null inputs
      assert.deepStrictEqual(findPath(null, { col: 1, row: 1 }, { col: 2, row: 2 }), []);
      assert.deepStrictEqual(findPath(map, null, { col: 2, row: 2 }), []);
      assert.deepStrictEqual(findPath(map, { col: 2, row: 2 }, null), []);
      assert.deepStrictEqual(findPath({}, { col: 2, row: 2 }, { col: 3, row: 3 }), []);
    }
  },

  // ==========================================================================
  // Suite 2: Sensory Priority Interruption Fuzzing
  // ==========================================================================
  {
    id: 'T2.B6',
    name: 'Sensory Priority: Visual Acquisition Unconditionally Interrupts Acoustic Investigation',
    fn: async () => {
      const bot = new Bot({ id: 'fuzz_bot', x: 200, y: 200, angle: 0 });
      assert.strictEqual(bot.state, 'PATROL');

      // 1. Acoustic pulse heard at (600, 600)
      bot.hearSound({ id: 'snd_1', x: 600, y: 600, type: 'gunfire', radius: 100, maxRadius: 500 });
      assert.strictEqual(bot.state, 'INVESTIGATE', 'Bot hearing sound must transition to INVESTIGATE');
      assert.deepStrictEqual(bot.investigateTarget, { x: 600, y: 600 });

      // 2. Direct visual contact with living enemy at (350, 200)
      const enemy = { id: 'target_human', x: 350, y: 200, hp: 100, isAlive: true };
      bot.seeTarget(enemy);

      assert.strictEqual(bot.state, 'ENGAGE', 'Direct visual contact must immediately override INVESTIGATE mode');
      assert.strictEqual(bot.currentTargetId, 'target_human', 'Bot must lock onto visible target');
      assert.strictEqual(bot.angle, 0, 'Bot aim angle must rotate directly towards target (atan2(0, 150) = 0)');
    }
  },

  {
    id: 'T2.B7',
    name: 'Sensory Priority: Acoustic Sound Immunity While in ENGAGE Combat Mode',
    fn: async () => {
      const bot = new Bot({ id: 'combat_bot', x: 200, y: 200 });
      const enemy = { id: 'target_enemy', x: 250, y: 200, hp: 100, isAlive: true };

      bot.seeTarget(enemy);
      assert.strictEqual(bot.state, 'ENGAGE');
      assert.strictEqual(bot.currentTargetId, 'target_enemy');

      // Bombard bot with 20 loud gunfire and footstep sounds from various directions
      for (let i = 0; i < 20; i++) {
        bot.hearSound({
          id: `distraction_${i}`,
          x: Math.random() * 800,
          y: Math.random() * 800,
          type: i % 2 === 0 ? 'gunfire' : 'footstep',
          radius: 120,
          maxRadius: 300
        });

        // Invariant: bot MUST NOT be knocked out of ENGAGE mode by acoustic distraction
        assert.strictEqual(
          bot.state,
          'ENGAGE',
          `Sound distraction #${i} must not disrupt ENGAGE mode`
        );
        assert.strictEqual(
          bot.currentTargetId,
          'target_enemy',
          `Target lock must not be corrupted by sound event #${i}`
        );
      }
    }
  },

  {
    id: 'T2.B8',
    name: 'Sensory Priority: 100-Cycle High-Frequency Alternating Fuzz Bombardment',
    fn: async () => {
      const bot = new Bot({ id: 'fuzz_bot_100', x: 300, y: 300 });

      // 100 randomized interleaved events: sound vs sight vs status updates
      for (let cycle = 0; cycle < 100; cycle++) {
        const rand = Math.random();

        if (rand < 0.4) {
          // Acoustic event
          const sound = {
            id: `snd_fuzz_${cycle}`,
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 400,
            type: Math.random() > 0.5 ? 'gunfire' : 'footstep',
            radius: 50,
            maxRadius: 200
          };
          const prevState = bot.state;
          bot.hearSound(sound);

          if (prevState === 'ENGAGE') {
            assert.strictEqual(bot.state, 'ENGAGE', `Cycle ${cycle}: hearSound must not disrupt ENGAGE`);
          } else {
            assert.strictEqual(bot.state, 'INVESTIGATE', `Cycle ${cycle}: hearSound should enter INVESTIGATE`);
            assert.ok(bot.investigateTarget, `Cycle ${cycle}: investigateTarget must be populated`);
          }
        } else if (rand < 0.8) {
          // Visual sighting event
          const enemy = {
            id: `enemy_${cycle % 3}`,
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 400,
            hp: 50 + Math.floor(Math.random() * 50),
            isAlive: true
          };
          bot.seeTarget(enemy);

          assert.strictEqual(bot.state, 'ENGAGE', `Cycle ${cycle}: seeTarget must guarantee ENGAGE state`);
          assert.strictEqual(bot.currentTargetId, enemy.id, `Cycle ${cycle}: currentTargetId must match acquired enemy`);
          assert.ok(Number.isFinite(bot.angle), `Cycle ${cycle}: aim angle must remain finite`);
        } else {
          // Enemy elimination / target update
          bot.updateTargetStatus({ id: bot.currentTargetId, isAlive: false, hp: 0 });
          assert.strictEqual(bot.state, 'PATROL', `Cycle ${cycle}: eliminated target must reset state to PATROL`);
          assert.strictEqual(bot.currentTargetId, null, `Cycle ${cycle}: currentTargetId must be cleared to null`);
        }

        // Global invariant check
        assert.ok(
          ['PATROL', 'INVESTIGATE', 'ENGAGE', 'RETREAT'].includes(bot.state),
          `Cycle ${cycle}: bot state must be one of the 4 valid FSM states, got ${bot.state}`
        );
        assert.ok(Array.isArray(bot.waypoints), `Cycle ${cycle}: waypoints must remain an array`);
      }
    }
  },

  {
    id: 'T2.B9',
    name: 'Sensory Priority: Target Occlusion & 2.0-Second Sight Loss Transition',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap });
      const bot = new Bot({ id: 'occlusion_bot', x: 200, y: 200, map: canonicalFoundryMap });
      room.bots.set(bot.id, bot);

      const player = new Player({ id: 'fleeing_target', x: 300, y: 200, hp: 100 });
      room.players.set(player.id, player);

      bot.seeTarget(player);
      assert.strictEqual(bot.state, 'ENGAGE');

      // Move player behind the horizontal wall (row 6: y=240..280, x=120..320)
      // Bot at (200, 200) looking at player at (200, 350) has line-of-sight fully blocked by the wall
      player.x = 200;
      player.y = 350;

      // Update 1.5 seconds: sight is blocked, but timer is <= 2.0s so bot maintains ENGAGE
      bot.update(1.5, room);
      assert.strictEqual(bot.state, 'ENGAGE', 'Bot should remain in ENGAGE during brief occlusion (< 2.0s)');

      // Update additional 0.6 seconds (total 2.1s occlusion)
      bot.update(0.6, room);
      assert.strictEqual(
        bot.state,
        'INVESTIGATE',
        'Bot must transition to INVESTIGATE after >2.0s of continuous target occlusion'
      );
      assert.strictEqual(bot.currentTargetId, null, 'Target lock must be released upon sight loss timeout');
      assert.deepStrictEqual(
        bot.investigateTarget,
        { x: player.x, y: player.y },
        'Investigation target must be set to target last known position'
      );
    }
  },

  // ==========================================================================
  // Suite 3: Target Elimination & Memory Reset Stress
  // ==========================================================================
  {
    id: 'T2.B10',
    name: 'Target Elimination: Clean Memory Reset & Immediate Patrol Resumption',
    fn: async () => {
      const bot = new Bot({ id: 'clean_bot', x: 200, y: 200 });
      const target = { id: 'victim_1', x: 300, y: 200, hp: 100, isAlive: true };

      bot.seeTarget(target);
      bot.waypoints = [{ col: 5, row: 5 }, { col: 6, row: 5 }];
      bot.waypointIndex = 1;
      assert.strictEqual(bot.state, 'ENGAGE');

      // Target takes lethal damage
      target.hp = 0;
      target.isAlive = false;

      bot.updateTargetStatus(target);

      // Verify thorough memory purge
      assert.strictEqual(bot.state, 'PATROL', 'State must reset to PATROL');
      assert.strictEqual(bot.currentTargetId, null, 'currentTargetId must be null');
      assert.strictEqual(bot.investigateTarget, null, 'investigateTarget must be null');
      assert.strictEqual(bot.waypoints.length, 0, 'Waypoints must be cleared');
      assert.strictEqual(bot.waypointIndex, 0, 'WaypointIndex must be reset to 0');
    }
  },

  {
    id: 'T2.B11',
    name: 'Target Elimination: Corpse Discrimination (Corpses Strictly Excluded from FOV)',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const bot = new Bot({ id: 'scout_bot', x: 100, y: 100, angle: 0, map: completelyEmptyMap });
      room.bots.set(bot.id, bot);

      // Add 3 eliminated corpses directly in front of the bot
      const corpse1 = new Player({ id: 'dead_1', x: 200, y: 100, hp: 0 });
      corpse1.isAlive = false;
      const corpse2 = new Player({ id: 'dead_2', x: 250, y: 100, hp: 0 });
      corpse2.isAlive = false;
      const corpse3 = new Player({ id: 'dead_3', x: 300, y: 100, hp: 0 });
      corpse3.isAlive = false;

      room.players.set(corpse1.id, corpse1);
      room.players.set(corpse2.id, corpse2);
      room.players.set(corpse3.id, corpse3);

      // Run visual scan
      bot.scanVisualTargets(room);
      assert.strictEqual(bot.state, 'PATROL', 'Bot must not acquire dead players as targets');
      assert.strictEqual(bot.currentTargetId, null, 'currentTargetId must remain null');

      // Now add 1 alive enemy at (350, 100)
      const alivePlayer = new Player({ id: 'living_foe', x: 350, y: 100, hp: 100 });
      alivePlayer.isAlive = true;
      room.players.set(alivePlayer.id, alivePlayer);

      bot.scanVisualTargets(room);
      assert.strictEqual(bot.state, 'ENGAGE', 'Bot must acquire living player');
      assert.strictEqual(bot.currentTargetId, 'living_foe', 'Bot must lock onto living player, ignoring all corpses');
    }
  },

  {
    id: 'T2.B12',
    name: 'Target Elimination: Mid-Tick Player Disconnect / Target Deletion Resilience',
    fn: async () => {
      const room = new Room({ map: completelyEmptyMap });
      const bot = new Bot({ id: 'resilient_bot', x: 100, y: 100, map: completelyEmptyMap });
      room.bots.set(bot.id, bot);

      const player = new Player({ id: 'disconnecting_player', x: 200, y: 100, hp: 100 });
      room.players.set(player.id, player);

      bot.seeTarget(player);
      assert.strictEqual(bot.state, 'ENGAGE');

      // Player ungracefully disconnects and is deleted from room.players map
      room.players.delete(player.id);

      // Bot tick execution must not throw TypeError or crash
      assert.doesNotThrow(() => {
        bot.update(0.033, room);
      }, 'Bot update must safely handle missing target without throwing');

      assert.strictEqual(bot.state, 'PATROL', 'Bot should revert to PATROL when locked target disappears');
      assert.strictEqual(bot.currentTargetId, null, 'Target lock must be cleared');
    }
  },

  // ==========================================================================
  // Suite 4: 10-Bot Live Simulation Stress in Crowded Room
  // ==========================================================================
  {
    id: 'T2.B13',
    name: '10-Bot Live Simulation: Crowded Room 100-Tick Execution Budget (< 5ms / Bot Tick)',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap, maxPlayers: 10 });

      // Spawn 10 active bots in the room
      for (let i = 1; i <= 10; i++) {
        const spawn = room.getSpawnPosition('bot', i);
        const bot = new Bot({
          id: `stress_bot_${i}`,
          x: spawn.x,
          y: spawn.y,
          hp: 100,
          map: canonicalFoundryMap
        });
        room.bots.set(bot.id, bot);
      }
      assert.strictEqual(room.bots.size, 10);

      // Run 100 simulation ticks measuring bot update duration
      const tickDurations = [];
      const totalTicks = 100;
      const dtSec = 1 / 30;

      for (let t = 0; t < totalTicks; t++) {
        const start = performance.now();

        // Feed occasional random gunfire sound events
        if (t % 10 === 0) {
          room.soundEvents.push({
            id: `snd_tick_${t}`,
            sourceId: 'stress_bot_1',
            x: 400,
            y: 400,
            type: 'gunfire',
            radius: 60,
            maxRadius: 240,
            createdAt: Date.now()
          });
        }

        // Execute room tick (updates sound propagation, 10 bots, LoS scans, kinematics)
        room.tick();

        const elapsed = performance.now() - start;
        tickDurations.push(elapsed);
      }

      const totalTime = tickDurations.reduce((a, b) => a + b, 0);
      const avgTickTime = totalTime / totalTicks;
      const avgPerBotTick = avgTickTime / 10;
      const maxTickTime = Math.max(...tickDurations);

      // Verify performance budget: avg bot tick must be strictly < 5.0ms
      assert.ok(
        avgPerBotTick < 5.0,
        `Average bot tick time (${avgPerBotTick.toFixed(3)}ms) must be strictly under 5.0ms budget`
      );

      // Verify all bots survived with finite coordinates inside map bounds
      const mapWidth = canonicalFoundryMap.width * canonicalFoundryMap.tileSize;
      const mapHeight = canonicalFoundryMap.height * canonicalFoundryMap.tileSize;

      for (const bot of room.bots.values()) {
        assert.ok(Number.isFinite(bot.x), `Bot ${bot.id} x coordinate must be finite, got ${bot.x}`);
        assert.ok(Number.isFinite(bot.y), `Bot ${bot.id} y coordinate must be finite, got ${bot.y}`);
        assert.ok(bot.x >= 0 && bot.x <= mapWidth, `Bot ${bot.id} x must be within arena`);
        assert.ok(bot.y >= 0 && bot.y <= mapHeight, `Bot ${bot.id} y must be within arena`);
      }
    }
  },

  {
    id: 'T2.B14',
    name: '10-Bot Live Simulation: Concurrent Crossfire & Projectile CCD Saturation',
    fn: async () => {
      const room = new Room({ map: canonicalFoundryMap, maxPlayers: 10 });

      // Place 10 bots arranged in opposing lines facing each other
      for (let i = 0; i < 10; i++) {
        const isLeft = i < 5;
        const x = isLeft ? 120 : 680;
        const y = 100 + (i % 5) * 120;
        const angle = isLeft ? 0 : Math.PI;

        const bot = new Bot({
          id: `gunner_${i}`,
          x,
          y,
          angle,
          hp: 100,
          ammo: 6,
          fireInterval: 0.05,
          map: canonicalFoundryMap
        });
        room.bots.set(bot.id, bot);
      }

      // Fire weapons across all 10 bots simultaneously
      for (const bot of room.bots.values()) {
        const proj = bot.attemptFire(0.016);
        assert.ok(proj, `Bot ${bot.id} must successfully fire projectile`);
        room.projectiles.push(proj);
      }
      assert.strictEqual(room.projectiles.length, 10, 'Room must have 10 active projectiles in flight');

      // Simulate 60 ticks of continuous projectile flight and collision detection
      for (let step = 0; step < 60; step++) {
        room.updateProjectiles(1 / 30);
      }

      // After 60 ticks (2.0s), all projectiles must have either collided or expired by maxRange
      assert.strictEqual(
        room.projectiles.length,
        0,
        'All 10 projectiles must be resolved/expired with zero hanging memory leaks'
      );
    }
  },

  {
    id: 'T2.B15',
    name: 'Massive Arena Navigation: 6-Bot Long-Distance Pathfinding on 100x100 Grid',
    fn: async () => {
      const start = performance.now();
      const bot = new Bot({ id: 'giant_bot', map: stress100x100Map });

      // 6 long-distance diagonal pathfinding queries across 10,000 tiles
      const queries = [
        { from: { col: 2, row: 2 }, to: { col: 97, row: 97 } },
        { from: { col: 97, row: 2 }, to: { col: 2, row: 97 } },
        { from: { col: 50, row: 2 }, to: { col: 50, row: 97 } },
        { from: { col: 2, row: 50 }, to: { col: 97, row: 50 } },
        { from: { col: 10, row: 10 }, to: { col: 80, row: 80 } },
        { from: { col: 80, row: 10 }, to: { col: 10, row: 80 } }
      ];

      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        const path = bot.findPath(stress100x100Map, q.from, q.to);
        assert.ok(path.length > 50, `Query ${i} must produce long-distance path across 100x100 arena, got length ${path.length}`);

        // Verify zero wall intersections
        for (const wp of path) {
          const tile = stress100x100Map.tiles[wp.row * 100 + wp.col];
          assert.strictEqual(tile, 0, `Query ${i}: Waypoint (${wp.col}, ${wp.row}) must be walkable floor (0)`);
        }
      }

      const duration = performance.now() - start;
      // 6 massive BFS queries across 10,000 tiles should execute comfortably within 100ms
      assert.ok(duration < 250, `6 massive 100x100 BFS queries took ${duration.toFixed(1)}ms, expected < 250ms`);
    }
  },

  {
    id: 'T2.B16',
    name: 'Bot Vitality Clamping & Lethal Elimination Boundary Invariants',
    fn: async () => {
      const bot = new Bot({ id: 'vitality_bot', hp: 100, maxHp: 100 });

      // 1. Partial damage
      bot.takeDamage(35);
      assert.strictEqual(bot.hp, 65);
      assert.strictEqual(bot.isAlive, true);

      // 2. Negative damage (healing spoof attempt) must not increase HP
      bot.takeDamage(-50);
      assert.strictEqual(bot.hp, 65, 'Negative damage must not increase HP');

      // 3. Floating-point damage
      bot.takeDamage(14.75);
      assert.strictEqual(bot.hp, 50.25);
      assert.strictEqual(bot.isAlive, true);

      // 4. Extreme overkill damage (> 1,000,000)
      bot.takeDamage(1000000);
      assert.strictEqual(bot.hp, 0, 'Health must clamp at 0 on extreme overkill');
      assert.strictEqual(bot.isAlive, false, 'Bot must transition to dead (isAlive === false)');

      // 5. Post-mortem damage attempts
      bot.takeDamage(100);
      assert.strictEqual(bot.hp, 0, 'Dead bot HP must remain clamped at 0');
      assert.strictEqual(bot.isAlive, false);
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
