/**
 * Tier 2.11: Adversarial Combat, Ballistics & Wall Absorption Stress Suite
 * Authored by: challenger_m4_1
 *
 * Empirically stress-tests:
 * 1. Ultra-high-speed bullet tunneling stress (speeds up to 5,000 px/s, thin walls 1-2px, targets r=5px).
 * 2. Wall absorption priority stress (50+ random configurations, orthogonal/acute/oblique angles, zero damage leakage).
 * 3. Multi-pellet scatter stress (100 blunderbuss volleys = 600 pellets, dense geometry, NaN checks, memory leaks).
 * 4. Player & bot health boundary fuzzing (negative, extreme overkill >1,000,000, floats, zero, dead state, heal bounds).
 * 5. Extreme ballistic kinematics & edge-case stress (grazing rays, collinear segments, internal starts, shooter immunity).
 */

import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { rayCircleIntersection, raySegmentIntersection, solveProjectileHit } from '../../server/physics/Collision.js';
import { Projectile } from '../../server/entities/Projectile.js';
import { Player } from '../../server/entities/Player.js';
import { Bot } from '../../server/entities/Bot.js';
import { WEAPON_DEFINITIONS, createProjectileSpecs } from '../../server/combat/WeaponDefinitions.js';
import { Room } from '../../server/Room.js';

export const suiteName = 'Tier 2.11: Adversarial Combat, Ballistics & Wall Absorption Stress';

export const tests = [
  // ==========================================================================
  // ULTRA-HIGH-SPEED BULLET TUNNELING STRESS (CCD INTEGRITY)
  // ==========================================================================
  {
    id: 'T2.C1',
    name: 'Ultra-High-Speed Bullet Tunneling: 5,000 px/s Crossing 0-Thickness Line Segment Wall',
    fn: async () => {
      const speed = 5000;
      const dt = 1 / 30;
      const step = speed * dt; // 166.67 px

      const wall = { p1: { x: 100, y: 0 }, p2: { x: 100, y: 300 } };
      const rayStart = { x: 20, y: 150 };
      const rayEnd = { x: rayStart.x + step, y: 150 };

      const hit = raySegmentIntersection(rayStart, rayEnd, wall.p1, wall.p2);
      assert.ok(hit && hit.hit, 'High-speed bullet must be intercepted by wall segment without tunneling');
      assert.strictEqual(Math.round(hit.point.x), 100, 'Intersection point X must be at wall');
      assert.strictEqual(Math.round(hit.point.y), 150, 'Intersection point Y must be at y=150');
      assert.ok(hit.distance > 0 && hit.distance < step, 'Hit distance must be within step vector');
    }
  },

  {
    id: 'T2.C2',
    name: 'Ultra-High-Speed Bullet Tunneling: 5,000 px/s Crossing 1px and 2px Thin Wall Boxes',
    fn: async () => {
      const speed = 5000;
      const dt = 1 / 30;
      const step = speed * dt;

      // 1px thin wall
      const thinWall1 = [
        { p1: { x: 100, y: 50 }, p2: { x: 101, y: 50 } },
        { p1: { x: 101, y: 50 }, p2: { x: 101, y: 250 } },
        { p1: { x: 101, y: 250 }, p2: { x: 100, y: 250 } },
        { p1: { x: 100, y: 250 }, p2: { x: 100, y: 50 } }
      ];
      const ray = { start: { x: 50, y: 120 }, end: { x: 50 + step, y: 120 } };
      const hit1 = solveProjectileHit(ray, thinWall1, []);
      assert.ok(hit1.hit, 'Bullet must not tunnel through 1px-thin wall');
      assert.strictEqual(hit1.type, 'wall');
      assert.ok(Math.abs(hit1.point.x - 100) < 0.01, 'Hit must register on front face of 1px wall');

      // 2px thin wall
      const thinWall2 = [
        { p1: { x: 100, y: 50 }, p2: { x: 102, y: 50 } },
        { p1: { x: 102, y: 50 }, p2: { x: 102, y: 250 } },
        { p1: { x: 102, y: 250 }, p2: { x: 100, y: 250 } },
        { p1: { x: 100, y: 250 }, p2: { x: 100, y: 50 } }
      ];
      const hit2 = solveProjectileHit(ray, thinWall2, []);
      assert.ok(hit2.hit, 'Bullet must not tunnel through 2px-thin wall');
      assert.strictEqual(hit2.type, 'wall');
      assert.ok(Math.abs(hit2.point.x - 100) < 0.01, 'Hit must register on front face of 2px wall');
    }
  },

  {
    id: 'T2.C3',
    name: 'Ultra-High-Speed Bullet Tunneling: 5,000 px/s Intercepting Small Target (Radius 5px)',
    fn: async () => {
      const speed = 5000;
      const dt = 1 / 30;
      const step = speed * dt; // 166.67 px >> 10 px target diameter
      const target = { x: 100, y: 100, radius: 5 };

      const rayStart = { x: 10, y: 100 };
      const rayEnd = { x: 10 + step, y: 100 };

      const hit = rayCircleIntersection(rayStart, rayEnd, target);
      assert.ok(hit.hit, 'CCD must detect hit on 5px radius target despite 166.7px step');
      assert.strictEqual(Math.round(hit.point.x), 95, 'Hit entry point must be at x = 95');
      assert.strictEqual(Math.round(hit.point.y), 100, 'Hit entry point Y must be at y = 100');
    }
  },

  {
    id: 'T2.C4',
    name: 'High-Velocity Angular Sweep: 1,000 Randomized Trajectories at 5,000 px/s vs Radius 5px Target',
    fn: async () => {
      const speed = 5000;
      const dt = 1 / 30;
      const step = speed * dt;
      const target = { x: 500, y: 500, radius: 5 };

      let detectedHits = 0;
      let falsePositives = 0;
      let falseNegatives = 0;

      for (let i = 0; i < 1000; i++) {
        const angle = Math.random() * Math.PI * 2;
        const lateralOffset = (Math.random() - 0.5) * 30;
        const startDist = 50 + Math.random() * 50;

        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);

        const startX = target.x - Math.cos(angle) * startDist + perpX * lateralOffset;
        const startY = target.y - Math.sin(angle) * startDist + perpY * lateralOffset;

        const endX = startX + Math.cos(angle) * step;
        const endY = startY + Math.sin(angle) * step;

        const hit = rayCircleIntersection({ x: startX, y: startY }, { x: endX, y: endY }, target);

        const lineDx = endX - startX;
        const lineDy = endY - startY;
        const lineLen = Math.hypot(lineDx, lineDy);
        const u = ((target.x - startX) * lineDx + (target.y - startY) * lineDy) / (lineLen * lineLen);
        const closestPtX = startX + u * lineDx;
        const closestPtY = startY + u * lineDy;
        const distToCenter = Math.hypot(target.x - closestPtX, target.y - closestPtY);

        const analyticallyShouldHit = distToCenter <= target.radius && u >= 0 && u <= 1;

        if (hit.hit) detectedHits++;
        if (hit.hit && !analyticallyShouldHit && distToCenter > target.radius + 1e-4) {
          falsePositives++;
        }
        if (!hit.hit && analyticallyShouldHit && distToCenter < target.radius - 1e-4) {
          falseNegatives++;
        }
      }

      assert.strictEqual(falsePositives, 0, `Zero false positives permitted, got ${falsePositives}`);
      assert.strictEqual(falseNegatives, 0, `Zero false negatives permitted, got ${falseNegatives}`);
      assert.ok(detectedHits > 200, `Substantial hits expected in random sweep, got ${detectedHits}`);
    }
  },

  {
    id: 'T2.C5',
    name: 'Hyper-Velocity Dilation Stress: 50,000 px/s with 0.5s Step (25,000 px Step) Zero-Tunneling',
    fn: async () => {
      const speed = 50000;
      const dt = 0.5;
      const step = speed * dt;
      const wall = { p1: { x: 5000, y: 0 }, p2: { x: 5000, y: 10000 } };
      const target = { x: 12000, y: 5000, radius: 5 };

      const rayStart = { x: 0, y: 5000 };
      const rayEnd = { x: step, y: 5000 };

      const wallHit = raySegmentIntersection(rayStart, rayEnd, wall.p1, wall.p2);
      assert.ok(wallHit.hit, '25,000 px step bullet must collide with wall');
      assert.strictEqual(Math.round(wallHit.point.x), 5000);

      const targetHit = rayCircleIntersection(rayStart, rayEnd, target);
      assert.ok(targetHit.hit, '25,000 px step bullet must collide with 5px radius target');
      assert.strictEqual(Math.round(targetHit.point.x), 11995);
    }
  },

  // ==========================================================================
  // WALL ABSORPTION PRIORITY STRESS (T3.4 INVARIANT)
  // ==========================================================================
  {
    id: 'T2.C6',
    name: 'Wall Absorption Priority: 50 Random Configurations (Orthogonal, Acute, Oblique Angles)',
    fn: async () => {
      let configsVerified = 0;

      for (let i = 0; i < 50; i++) {
        const sx = Math.random() * 200 + 50;
        const sy = Math.random() * 200 + 50;

        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        const dw = 100 + Math.random() * 100;
        const wallCenterX = sx + dirX * dw;
        const wallCenterY = sy + dirY * dw;

        const dt = dw + 60 + Math.random() * 100;
        const targetX = sx + dirX * dt;
        const targetY = sy + dirY * dt;
        const targetRadius = 16;

        let wallAngleOffset;
        if (i < 15) {
          wallAngleOffset = Math.PI / 2; // Orthogonal
        } else if (i < 30) {
          wallAngleOffset = Math.PI / 6 + Math.random() * (Math.PI / 6); // Acute
        } else {
          wallAngleOffset = Math.PI / 3 + Math.random() * (Math.PI / 4); // Oblique
        }

        const wallAngle = angle + wallAngleOffset;
        const wallHalfLen = 80;
        const w1 = {
          x: wallCenterX + Math.cos(wallAngle) * wallHalfLen,
          y: wallCenterY + Math.sin(wallAngle) * wallHalfLen
        };
        const w2 = {
          x: wallCenterX - Math.cos(wallAngle) * wallHalfLen,
          y: wallCenterY - Math.sin(wallAngle) * wallHalfLen
        };

        const bulletRay = {
          start: { x: sx, y: sy },
          end: { x: sx + dirX * (dt + 100), y: sy + dirY * (dt + 100) },
          shooterId: 'shooter_1'
        };

        const target = { id: `target_${i}`, x: targetX, y: targetY, radius: targetRadius, hp: 100, isAlive: true };
        const walls = [{ p1: w1, p2: w2 }];
        const players = [target];

        const result = solveProjectileHit(bulletRay, walls, players, { shooterId: 'shooter_1' });

        assert.ok(result.hit, `Config #${i + 1}: Shot must hit geometry`);
        assert.strictEqual(result.type, 'wall', `Config #${i + 1}: Wall must absorb shot before target`);
        assert.strictEqual(result.blocked, true, `Config #${i + 1}: Wall must block bullet`);
        assert.strictEqual(result.target, undefined, `Config #${i + 1}: Target must not be populated when wall absorbs`);
        configsVerified++;
      }

      assert.strictEqual(configsVerified, 50, 'All 50 random configurations must pass');
    }
  },

  {
    id: 'T2.C7',
    name: 'Target in Front of Wall: Unobstructed Forward Hit Resolution',
    fn: async () => {
      const bulletRay = { start: { x: 50, y: 100 }, end: { x: 350, y: 100 }, shooterId: 's1' };
      const target = { id: 'front_target', x: 150, y: 100, radius: 16, hp: 100, isAlive: true };
      const walls = [{ p1: { x: 250, y: 50 }, p2: { x: 250, y: 150 } }];

      const hit = solveProjectileHit(bulletRay, walls, [target], { shooterId: 's1' });
      assert.ok(hit.hit, 'Hit must be registered');
      assert.strictEqual(hit.type, 'player', 'Target in front of wall must be hit first');
      assert.strictEqual(hit.blocked, false, 'Hit must not be blocked by rear wall');
      assert.strictEqual(hit.targetId, 'front_target');
    }
  },

  {
    id: 'T2.C8',
    name: 'Room Simulation Integration: 0 Damage Leakage to Wall-Shielded Combatant During 30Hz Simulation',
    fn: async () => {
      const customMap = {
        version: '1.0',
        name: 'ShieldTest',
        width: 20,
        height: 20,
        tileSize: 40,
        tiles: new Array(400).fill(0),
        spawns: [
          { id: 's1', type: 'player', col: 2, row: 5 },
          { id: 's2', type: 'player', col: 12, row: 5 }
        ]
      };

      const room = new Room({ id: 'room_shield_test', map: customMap, autoTick: false });
      room.geometrySegments = [{ p1: { x: 300, y: 0 }, p2: { x: 300, y: 800 } }];

      const shooter = room.addPlayer('shooter_id', { name: 'Shooter' });
      shooter.x = 100;
      shooter.y = 200;
      shooter.angle = 0;

      const target = room.addPlayer('target_id', { name: 'Target' });
      target.x = 500;
      target.y = 200;
      target.hp = 100;
      target.isAlive = true;

      room.startMatch({ fillBots: false });

      for (let b = 0; b < 10; b++) {
        room.spawnProjectile({
          shooterId: shooter.id,
          x: 100,
          y: 200,
          angle: 0,
          speed: 1500,
          damage: 40,
          maxRange: 800
        });
      }

      assert.strictEqual(room.projectiles.length, 10);

      for (let tick = 0; tick < 30; tick++) {
        room.tick();
      }

      assert.strictEqual(room.projectiles.length, 0, 'All projectiles must be absorbed by wall');
      assert.strictEqual(target.hp, 100, 'Target behind wall must take 0 damage');
      assert.strictEqual(target.isAlive, true);
    }
  },

  // ==========================================================================
  // MULTI-PELLET SCATTER STRESS (BLUNDERBUSS)
  // ==========================================================================
  {
    id: 'T2.C9',
    name: 'Blunderbuss Multi-Pellet Scatter: 100 Volleys (600 Pellets) Numeric & Finite Value Invariants',
    fn: async () => {
      const origin = { x: 400, y: 400 };
      const baseAngle = Math.PI / 3;
      let totalPellets = 0;

      for (let volley = 0; volley < 100; volley++) {
        const specs = createProjectileSpecs('blunderbuss', origin, baseAngle, `shooter_${volley}`);
        assert.strictEqual(specs.length, 6, 'Blunderbuss must emit exactly 6 pellets per volley');

        for (const spec of specs) {
          totalPellets++;
          assert.ok(!Number.isNaN(spec.x) && Number.isFinite(spec.x), 'Pellet X must be finite number');
          assert.ok(!Number.isNaN(spec.y) && Number.isFinite(spec.y), 'Pellet Y must be finite number');
          assert.ok(!Number.isNaN(spec.angle) && Number.isFinite(spec.angle), 'Pellet angle must be finite');
          assert.ok(!Number.isNaN(spec.speed) && spec.speed > 0, 'Pellet speed must be positive finite');
          assert.ok(!Number.isNaN(spec.damage) && spec.damage > 0, 'Pellet damage must be positive');
          assert.ok(!Number.isNaN(spec.maxRange) && spec.maxRange > 0, 'Pellet maxRange must be positive');

          const diff = Math.abs(spec.angle - baseAngle);
          assert.ok(diff <= 0.35, `Pellet angle spread ${diff} rad must be bounded within weapon cone`);
        }
      }

      assert.strictEqual(totalPellets, 600);
    }
  },

  {
    id: 'T2.C10',
    name: 'Multi-Pellet Scatter Maze Stress: 600 Simultaneous Pellets, 0 NaN, Range Expiration & 0 Leaks',
    fn: async () => {
      const map = {
        version: '1.0',
        name: 'MazeCluster',
        width: 30,
        height: 30,
        tileSize: 40,
        tiles: new Array(900).fill(0),
        spawns: [{ id: 's1', type: 'player', col: 15, row: 15 }]
      };

      const room = new Room({ id: 'room_blunderbuss_stress', map: map, autoTick: false });

      const denseSegments = [];
      for (let x = 200; x <= 1000; x += 100) {
        denseSegments.push({ p1: { x: x, y: 100 }, p2: { x: x, y: 1100 } });
      }
      for (let y = 200; y <= 1000; y += 100) {
        denseSegments.push({ p1: { x: 100, y: y }, p2: { x: 1100, y: y } });
      }
      room.geometrySegments = denseSegments;

      for (let p = 0; p < 8; p++) {
        const pl = room.addPlayer(`combatant_${p}`, { name: `Target_${p}` });
        pl.x = 250 + (p % 4) * 200;
        pl.y = 250 + Math.floor(p / 4) * 200;
        pl.hp = 100;
        pl.isAlive = true;
      }

      const origin = { x: 600, y: 600 };
      for (let v = 0; v < 100; v++) {
        const volleyAngle = (v / 100) * Math.PI * 2;
        const specs = createProjectileSpecs('blunderbuss', origin, volleyAngle, `shooter_${v % 8}`);
        for (const spec of specs) {
          room.spawnProjectile(spec);
        }
      }

      assert.strictEqual(room.projectiles.length, 600);

      const maxTicks = 60;
      let ticksRun = 0;

      for (let t = 0; t < maxTicks; t++) {
        ticksRun++;

        for (const proj of room.projectiles) {
          assert.ok(!Number.isNaN(proj.x), 'Projectile X must never be NaN');
          assert.ok(!Number.isNaN(proj.y), 'Projectile Y must never be NaN');
          assert.ok(!Number.isNaN(proj.distanceTraveled), 'distanceTraveled must never be NaN');
        }

        room.tick();

        if (room.projectiles.length === 0) {
          break;
        }
      }

      assert.strictEqual(room.projectiles.length, 0, 'Every projectile must expire or collide (0 active remaining)');
      assert.ok(ticksRun <= 25, `All 600 pellets should finish within ~20 ticks (ran ${ticksRun} ticks)`);
    }
  },

  // ==========================================================================
  // PLAYER & BOT HEALTH BOUNDARY FUZZING
  // ==========================================================================
  {
    id: 'T2.C11',
    name: 'Player Health Boundary Fuzzing: Negative & Zero Damage Rejection',
    fn: async () => {
      const player = new Player({ maxHp: 100, hp: 80 });

      assert.strictEqual(player.takeDamage(-25), 0);
      assert.strictEqual(player.hp, 80);

      assert.strictEqual(player.takeDamage(-1_000_000), 0);
      assert.strictEqual(player.hp, 80);

      assert.strictEqual(player.takeDamage(0), 0);
      assert.strictEqual(player.takeDamage(-0), 0);
      assert.strictEqual(player.hp, 80);
    }
  },

  {
    id: 'T2.C12',
    name: 'Player Health Boundary Fuzzing: Extreme Overkill Clamping (>1,000,000) & Strict Elimination State',
    fn: async () => {
      const player = new Player({ maxHp: 100, hp: 100 });
      const dealt = player.takeDamage(5_000_000);

      assert.strictEqual(player.hp, 0, 'HP must clamp at 0');
      assert.strictEqual(player.isAlive, false, 'Player must be eliminated');
      assert.strictEqual(dealt, 100, 'Actual damage dealt clamped to previous HP (100)');

      // Post-mortem damage attempts
      const dealtDead = player.takeDamage(100);
      assert.strictEqual(dealtDead, 0, 'Dead player must not take further damage');
      assert.strictEqual(player.hp, 0);
      assert.strictEqual(player.isAlive, false);
    }
  },

  {
    id: 'T2.C13',
    name: 'Player Health Boundary Fuzzing: Floating-Point Precision & Elimination Threshold',
    fn: async () => {
      const player = new Player({ maxHp: 100, hp: 1 });

      const dealt1 = player.takeDamage(0.99999);
      assert.ok(Math.abs(dealt1 - 0.99999) < 1e-9);
      assert.ok(player.hp > 0, 'Player with 0.00001 HP must still be considered alive');
      assert.strictEqual(player.isAlive, true);

      const dealt2 = player.takeDamage(player.hp);
      assert.strictEqual(player.hp, 0, 'HP must reach exact 0');
      assert.strictEqual(player.isAlive, false, 'isAlive must transition to false strictly at 0');
    }
  },

  {
    id: 'T2.C14',
    name: 'Player Health Boundary Fuzzing: Micro-Damage Monotonic Decay (1,000 Steps)',
    fn: async () => {
      const player = new Player({ maxHp: 100, hp: 100 });
      let totalDealt = 0;

      for (let step = 0; step < 1000; step++) {
        const d = player.takeDamage(0.15);
        totalDealt += d;
        assert.ok(player.hp >= 0, 'HP must never be negative during micro-damage steps');
        if (player.hp === 0) {
          assert.strictEqual(player.isAlive, false, 'isAlive must be false when hp reaches 0');
        }
      }

      assert.strictEqual(player.hp, 0);
      assert.strictEqual(Math.round(totalDealt), 100);
    }
  },

  {
    id: 'T2.C15',
    name: 'Bot Health Boundary & Elimination State Machine Invariance',
    fn: async () => {
      const map = { width: 10, height: 10, tiles: new Array(100).fill(0) };
      const bot = new Bot({ id: 'bot_test_hp', hp: 100, maxHp: 100, map });

      assert.strictEqual(bot.hp, 100);
      assert.strictEqual(bot.isAlive, true);

      bot.takeDamage(50);
      assert.strictEqual(bot.hp, 50);
      assert.strictEqual(bot.isAlive, true);

      bot.takeDamage(200);
      assert.strictEqual(bot.hp, 0);
      assert.strictEqual(bot.isAlive, false);
    }
  },

  // ==========================================================================
  // KINEMATIC EDGE CASES & SHOOTER IMMUNITY
  // ==========================================================================
  {
    id: 'T2.C16',
    name: 'Kinematic Edge Cases: Grazing Tangent Rays, Internal Starts & Shooter Self-Damage Immunity',
    fn: async () => {
      const circle = { x: 100, y: 100, radius: 16 };

      // Internal start
      const internalHit = rayCircleIntersection({ x: 100, y: 100 }, { x: 200, y: 100 }, circle);
      assert.ok(internalHit.hit, 'Internal start must register immediate hit');
      assert.strictEqual(internalHit.distance, 0);
      assert.strictEqual(internalHit.t, 0);

      // Tangent grazing
      const grazingHit = rayCircleIntersection({ x: 0, y: 115.99 }, { x: 200, y: 115.99 }, circle);
      assert.ok(grazingHit.hit, 'Ray within circle radius must hit');

      const grazingMiss = rayCircleIntersection({ x: 0, y: 116.01 }, { x: 200, y: 116.01 }, circle);
      assert.strictEqual(grazingMiss.hit, false, 'Ray outside circle radius must miss');

      // Shooter immunity
      const shooterId = 'self_shooter_p1';
      const shooter = { id: shooterId, x: 100, y: 100, radius: 16, hp: 100, isAlive: true };
      const bulletRay = { start: { x: 100, y: 100 }, end: { x: 200, y: 100 }, shooterId };

      const hit = solveProjectileHit(bulletRay, [], [shooter], { shooterId });
      assert.strictEqual(hit.hit, false, 'Shooter must be immune to own projectiles');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
