/**
 * Tier 1.4: Combat Physics, Projectiles, Damage & Weapon Mechanics Tests
 * Covers R5 (Combat Mechanics & Automated Verification) specifications and invariants.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper, assertEpsilon } from '../harnesses/assert_helpers.js';

export const suiteName = 'Tier 1.4: Combat Physics & Weapon Mechanics';

export const tests = [
  {
    id: 'T1.4.1',
    name: 'Projectile Trajectory Calculation',
    fn: async () => {
      let projectileModule;
      try {
        projectileModule = await import('../../server/entities/Projectile.js');
      } catch (_) {
        assert.fail('server/entities/Projectile.js not found - awaiting Milestone M4 implementation');
      }

      const Projectile = projectileModule.Projectile || projectileModule.default;
      assert.ok(Projectile, 'Projectile class must be exported');

      const startPos = { x: 50, y: 50 };
      const angle = Math.PI / 4; // 45 deg
      const speed = 800; // px/s
      const proj = new Projectile({
        shooterId: 'p1',
        x: startPos.x,
        y: startPos.y,
        angle,
        speed
      });

      const dt = 0.05; // 50ms = 0.05s
      proj.update(dt);

      const expectedX = startPos.x + Math.cos(angle) * speed * dt;
      const expectedY = startPos.y + Math.sin(angle) * speed * dt;

      assertEpsilon(proj.x, expectedX, 1e-2, 'Projectile X coordinate must match kinematic trajectory');
      assertEpsilon(proj.y, expectedY, 1e-2, 'Projectile Y coordinate must match kinematic trajectory');
    }
  },

  {
    id: 'T1.4.2',
    name: 'Ray-Circle Hit Detection on Player',
    fn: async () => {
      let collisionModule;
      try {
        collisionModule = await import('../../server/physics/Collision.js');
      } catch (_) {
        assert.fail('server/physics/Collision.js not found - awaiting Milestone M4 implementation');
      }

      const checkHit = collisionModule.rayCircleIntersection || collisionModule.checkCircleCollision;
      assert.strictEqual(typeof checkHit, 'function', 'Collision module must export circle hit test function');

      const rayStart = { x: 0, y: 100 };
      const rayEnd = { x: 200, y: 100 };
      const playerCircle = { x: 100, y: 100, radius: 16 };

      const hitResult = checkHit(rayStart, rayEnd, playerCircle);
      assert.ok(hitResult, 'Ray intersecting player bounding circle must register a hit');
      assert.strictEqual(hitResult.hit, true, 'Hit flag must be true');

      // Miss check
      const playerMiss = { x: 100, y: 200, radius: 16 };
      const missResult = checkHit(rayStart, rayEnd, playerMiss);
      assert.strictEqual(missResult?.hit || false, false, 'Ray passing far from player must not register a hit');
    }
  },

  {
    id: 'T1.4.3',
    name: 'Projectile Absorption on Solid Wall',
    fn: async () => {
      let collisionModule;
      try {
        collisionModule = await import('../../server/physics/Collision.js');
      } catch (_) {
        assert.fail('server/physics/Collision.js not found - awaiting Milestone M4 implementation');
      }

      const checkSegmentHit = collisionModule.raySegmentIntersection || collisionModule.checkSegmentCollision;
      assert.strictEqual(typeof checkSegmentHit, 'function', 'Collision module must export segment collision check');

      const bulletPath = { p1: { x: 50, y: 100 }, p2: { x: 150, y: 100 } };
      const wallSegment = { p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } };

      const isect = checkSegmentHit(bulletPath.p1, bulletPath.p2, wallSegment.p1, wallSegment.p2);
      assert.ok(isect, 'Bullet intersecting wall segment must be detected');
      assert.strictEqual(isect.hit, true, 'Collision with wall must be confirmed');
      assertEpsilon(isect.point.x, 100, 1e-2, 'Intersection point x must be on wall');
      assertEpsilon(isect.point.y, 100, 1e-2, 'Intersection point y must be at y=100');
    }
  },

  {
    id: 'T1.4.4',
    name: 'Damage Application & Health Clamping',
    fn: async () => {
      let playerModule;
      try {
        playerModule = await import('../../server/entities/Player.js');
      } catch (_) {
        assert.fail('server/entities/Player.js not found - awaiting Milestone M4 implementation');
      }

      const Player = playerModule.Player || playerModule.default;
      const player = new Player({ id: 'target_p1', maxHp: 100, hp: 100 });

      // Deal moderate damage: 45
      player.takeDamage(45);
      assert.strictEqual(player.hp, 55, 'HP should reduce from 100 to 55');
      assert.strictEqual(player.isAlive, true, 'Player should remain alive with 55 HP');

      // Deal overkill damage: 150
      player.takeDamage(150);
      assert.strictEqual(player.hp, 0, 'HP must clamp at 0 and not go negative');
      assert.strictEqual(player.isAlive, false, 'Player must transition to eliminated status');
    }
  },

  {
    id: 'T1.4.5',
    name: 'Magazine Capacity & Reload Timer',
    fn: async () => {
      let playerModule;
      try {
        playerModule = await import('../../server/entities/Player.js');
      } catch (_) {
        assert.fail('server/entities/Player.js not found - awaiting Milestone M4 implementation');
      }

      const Player = playerModule.Player || playerModule.default;
      const player = new Player({ id: 'shooter_p1', ammo: 6, maxAmmo: 6 });

      // Fire 6 rounds
      for (let i = 0; i < 6; i++) {
        const fired = player.fire();
        assert.strictEqual(fired, true, `Shot #${i + 1} should succeed`);
      }

      assert.strictEqual(player.ammo, 0, 'Ammo should be 0 after 6 shots');

      // 7th shot should fail
      const seventhShot = player.fire();
      assert.strictEqual(seventhShot, false, 'Firing with 0 ammo must be rejected');

      // Initiate reload
      player.reload();
      assert.strictEqual(player.isReloading, true, 'Player must be in reload state');

      // Fire while reloading should fail
      assert.strictEqual(player.fire(), false, 'Firing while reloading must be blocked');

      // Fast-forward reload timer (e.g. 2.0s)
      player.update(2.1);

      assert.strictEqual(player.isReloading, false, 'Reload should complete after timer elapses');
      assert.strictEqual(player.ammo, 6, 'Ammo should be replenished to full magazine (6)');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
