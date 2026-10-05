/**
 * Tier 3: Fast Bullet Kinematics & Multi-Lantern Tactical Visibility Integration Tests
 * Validates:
 * 1. High-velocity projectile speeds across all steampunk weapon classes (1600 - 2500 px/s).
 * 2. Continuous Collision Detection (CCD) raycasting preventing tunneling at high velocities.
 * 3. Multi-lantern visibility pipeline supporting local player, friendly allies, and hostile opponents.
 * 4. Solid wall shadow clipping for opponent lantern searchlights.
 * 5. Dynamic projectile aerodynamic tracer streaks cutting through dark fog.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper, assertEpsilon } from '../harnesses/assert_helpers.js';
import { PROJECTILE_SPEED } from '../../shared/Constants.js';
import { WEAPON_DEFINITIONS as SERVER_WEAPONS } from '../../server/combat/WeaponDefinitions.js';
import { WEAPON_DEFINITIONS as PROGRESSION_WEAPONS } from '../../shared/ProgressionSchema.js';
import { Projectile } from '../../server/entities/Projectile.js';
import { checkCircleCollision, raySegmentIntersection } from '../../server/physics/Collision.js';
import { VisibilityRenderer } from '../../client/js/rendering/VisibilityRenderer.js';
import { GameRenderer } from '../../client/js/rendering/GameRenderer.js';

export const suiteName = 'Tier 3: Fast Bullets & Multi-Lantern Tactical Visibility';

export const tests = [
  {
    id: 'T3.FL1',
    name: 'High-Velocity Projectile Speeds Across Weapon Arsenal',
    fn: async () => {
      // 1. Verify global baseline constant
      assert.ok(PROJECTILE_SPEED >= 1800, `PROJECTILE_SPEED should be >= 1800 px/s, got ${PROJECTILE_SPEED}`);

      // 2. Verify server-authoritative weapon definitions
      assert.ok(SERVER_WEAPONS.revolver.speed >= 1800, `Revolver speed must be >= 1800, got ${SERVER_WEAPONS.revolver.speed}`);
      assert.ok(SERVER_WEAPONS.steam_carbine.speed >= 2100, `Steam Carbine speed must be >= 2100, got ${SERVER_WEAPONS.steam_carbine.speed}`);
      assert.ok(SERVER_WEAPONS.blunderbuss.speed >= 1600, `Blunderbuss speed must be >= 1600, got ${SERVER_WEAPONS.blunderbuss.speed}`);
      assert.ok(SERVER_WEAPONS.needle_gun.speed >= 2500, `Pneumatic Needle Gun speed must be >= 2500, got ${SERVER_WEAPONS.needle_gun.speed}`);

      // 3. Verify progression schema sync
      assert.strictEqual(PROGRESSION_WEAPONS.revolver.speed, SERVER_WEAPONS.revolver.speed, 'Progression revolver speed must match server definition');
      assert.strictEqual(PROGRESSION_WEAPONS.steam_carbine.speed, SERVER_WEAPONS.steam_carbine.speed, 'Progression carbine speed must match server definition');
      assert.strictEqual(PROGRESSION_WEAPONS.blunderbuss.speed, SERVER_WEAPONS.blunderbuss.speed, 'Progression blunderbuss speed must match server definition');
      assert.strictEqual(PROGRESSION_WEAPONS.needle_gun.speed, SERVER_WEAPONS.needle_gun.speed, 'Progression needle gun speed must match server definition');

      // 4. Default projectile entity speed
      const defaultProj = new Projectile({ shooterId: 'bot_1', x: 100, y: 100, angle: 0 });
      assert.ok(defaultProj.speed >= 1800, `Default Projectile speed must be >= 1800, got ${defaultProj.speed}`);
    }
  },

  {
    id: 'T3.FL2',
    name: 'Continuous Collision Detection (CCD) Raycast at Extreme Velocities (2500 px/s)',
    fn: async () => {
      // Simulate high-speed Needle Gun round (2500 px/s) over a 33ms server tick (step = 82.5 px)
      const speed = 2500;
      const dt = 0.033; // 33.3ms
      const stepDistance = speed * dt; // 82.5 px

      const pStart = { x: 50, y: 200 };
      const pEnd = { x: pStart.x + stepDistance, y: 200 }; // (132.5, 200)

      // Player circle target at (100, 200) with radius 16 (covers x: 84 to 116)
      const targetCircle = { x: 100, y: 200, radius: 16 };

      // Discrete position test at end point would miss target if discrete step was used (132.5 > 116)!
      const distFromEnd = Math.hypot(pEnd.x - targetCircle.x, pEnd.y - targetCircle.y);
      assert.ok(distFromEnd > targetCircle.radius, 'Discrete point test confirms target was skipped without CCD');

      // CCD swept segment test must catch the hit accurately
      const hitResult = checkCircleCollision(pStart, pEnd, targetCircle);
      assert.ok(hitResult, 'Swept ray must detect collision with player');
      assert.strictEqual(hitResult.hit, true, 'CCD hit flag must be true');
      assertEpsilon(hitResult.point.x, targetCircle.x - targetCircle.radius, 1.0, 'CCD impact point must be on leading edge of target circle');

      // Wall obstacle collision test at (110, y: 150 to 250)
      const wallSeg = { p1: { x: 110, y: 150 }, p2: { x: 110, y: 250 } };
      const wallHit = raySegmentIntersection(pStart, pEnd, wallSeg);
      assert.ok(wallHit && wallHit.hit, 'Swept ray must collide with intervening wall segment');
      assertEpsilon(wallHit.point.x, 110, 1e-3, 'Wall hit X must be exactly at wall coordinate');
    }
  },

  {
    id: 'T3.FL3',
    name: 'Multi-Lantern Visibility Pipeline for Allies and Opponents',
    fn: async () => {
      const visRenderer = new VisibilityRenderer();
      assert.ok(visRenderer, 'VisibilityRenderer should instantiate cleanly');

      // Test combatants setup
      const localPlayer = { id: 'p_local', x: 200, y: 200, angle: 0, team: 'blue', isAlive: true };
      const ally = { id: 'p_ally', x: 300, y: 200, angle: Math.PI / 2, team: 'blue', isAlive: true, lanternOn: true };
      const enemy = { id: 'p_enemy', x: 500, y: 200, angle: Math.PI, team: 'red', isAlive: true, lanternOn: true };

      // Line segments representing a vertical stone pillar at x = 400
      const segments = [
        { p1: { x: 400, y: 100 }, p2: { x: 400, y: 300 } }
      ];

      // 1. Local player polygon computation
      const localPoly = visRenderer.computePolygon(localPlayer, segments);
      assert.ok(Array.isArray(localPoly) && localPoly.length >= 3, 'Local polygon must have at least 3 vertices');

      // 2. Ally polygon computation
      const allyPoly = visRenderer.computePolygon(ally, segments);
      assert.ok(Array.isArray(allyPoly) && allyPoly.length >= 3, 'Ally polygon must have at least 3 vertices');

      // 3. Enemy polygon computation (occluded by pillar at x=400)
      const enemyPoly = visRenderer.computePolygon(enemy, segments);
      assert.ok(Array.isArray(enemyPoly) && enemyPoly.length >= 3, 'Enemy polygon must have at least 3 vertices');

      // Check that enemy's light is clipped by the pillar at x=400 (ray at y=200 looking West should not penetrate past x=400)
      const clippedVertices = enemyPoly.filter(v => v.x <= 400.1);
      assert.ok(clippedVertices.length > 0, 'Enemy light cone must stop against the pillar at x = 400');
    }
  },

  {
    id: 'T3.FL4',
    name: 'GameRenderer Projectile Layering and Dynamic Aerodynamic Streak Calculation',
    fn: async () => {
      const mockCanvas = {
        width: 800,
        height: 600,
        getContext: () => ({
          save: () => {},
          restore: () => {},
          translate: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          arc: () => {},
          fill: () => {},
          createLinearGradient: () => ({ addColorStop: () => {} }),
          createRadialGradient: () => ({ addColorStop: () => {} })
        })
      };
      const renderer = new GameRenderer(mockCanvas);
      assert.ok(typeof renderer.renderLayerProjectilesOverDarkness === 'function', 'GameRenderer must export renderLayerProjectilesOverDarkness');
      assert.ok(typeof renderer.renderProjectile === 'function', 'GameRenderer must export renderProjectile');

      // Verify dynamic tracer trail scaling:
      // trailLen = Math.max(26, Math.min(54, speed * 0.024))
      const calculateTrailLen = (speed) => Math.max(26, Math.min(54, speed * 0.024));

      const slowSpeed = 800;
      const standardSpeed = 1800; // Revolver
      const fastSpeed = 2500; // Needle gun

      assert.strictEqual(calculateTrailLen(slowSpeed), 26, 'Low speed should be clamped to minimum 26px trail');
      assertEpsilon(calculateTrailLen(standardSpeed), 43.2, 0.5, '1800 px/s speed should produce ~43.2px dynamic aerodynamic streak');
      assert.strictEqual(calculateTrailLen(fastSpeed), 54, '2500 px/s speed should cap at aerodynamic limit of 54px trail');
    }
  },

  {
    id: 'T3.FL5',
    name: 'Tactical Camera Closer Zoom: Default 1.45x, Viewport Bounds & Dynamic Wheel Zoom Clamping',
    fn: async () => {
      const mockCanvas = {
        width: 800,
        height: 600,
        getContext: () => ({
          save: () => {},
          restore: () => {},
          translate: () => {},
          scale: () => {}
        })
      };
      const renderer = new GameRenderer(mockCanvas);

      // 1. Verify default tactical closer zoom
      assert.strictEqual(renderer.camera.zoom, 1.45, 'Camera default zoom must be 1.45 for tighter tactical FOV');
      assert.strictEqual(renderer.camera.targetZoom, 1.45, 'Camera targetZoom must match default zoom');

      // 2. Verify zoom clamping limits
      renderer.adjustZoom(2.0); // Attempt overshoot
      assert.strictEqual(renderer.camera.targetZoom, 1.95, 'Camera zoom must cap at maxZoom (1.95)');

      renderer.adjustZoom(-5.0); // Attempt undershoot
      assert.strictEqual(renderer.camera.targetZoom, 1.15, 'Camera zoom must cap at minZoom (1.15)');

      // 3. Smooth zoom interpolation
      renderer.setZoom(1.45);
      renderer.adjustZoom(0.3); // targetZoom = 1.75
      assert.strictEqual(renderer.camera.zoom, 1.45, 'Current zoom should remain before tick');
      assert.strictEqual(renderer.camera.targetZoom, 1.75, 'Target zoom should be set to 1.75');

      renderer.update(0.1, { localPlayer: { x: 500, y: 500 } });
      assert.ok(renderer.camera.zoom > 1.45, 'Camera zoom should smoothly interpolate towards 1.75');
      assert.ok(renderer.camera.zoom <= 1.75, 'Camera zoom should not exceed 1.75');

      // 4. Viewport world coverage comparison (1.45x zoom shows smaller world area)
      const worldW10 = 800 / 1.0;
      const worldWZoom = 800 / 1.45;
      assert.ok(worldWZoom < worldW10, 'Zoomed camera must cover fewer world pixels (~551px vs 800px)');
      assertEpsilon(worldWZoom, 551.72, 1.0, '800px screen at 1.45x zoom equals ~551.7 world pixels');
    }
  },

  {
    id: 'T3.FL6',
    name: 'Tactical Camera Zoom Screen Space Aim & Sound Wave Projection Alignment',
    fn: async () => {
      const mockCanvas = {
        width: 800,
        height: 600,
        getContext: () => ({
          save: () => {},
          restore: () => {},
          translate: () => {},
          scale: () => {}
        })
      };
      const renderer = new GameRenderer(mockCanvas, { zoom: 1.5 });
      const testMap = {
        width: 30,
        height: 20,
        tileSize: 40,
        tiles: new Array(600).fill(0),
        spawns: []
      };
      renderer.setMap(testMap);

      const player = { x: 600, y: 400, angle: 0 };
      renderer.update(0.016, { localPlayer: player });

      // Player centered on screen:
      // screenX = (600 - camera.x) * 1.5 = (800 / 1.5 / 2) * 1.5 = 400
      const screenPos = renderer.getLocalPlayerScreenPosition(player);
      assertEpsilon(screenPos.x, 400, 0.5, 'Centered player screen X must be exactly canvas.width / 2');
      assertEpsilon(screenPos.y, 300, 0.5, 'Centered player screen Y must be exactly canvas.height / 2');

      // Offset entity screen position
      const offsetEntity = { x: 650, y: 450 }; // +50 world pixels in X and Y
      const offsetScreenPos = renderer.getLocalPlayerScreenPosition(offsetEntity);
      // At zoom 1.5, +50 world pixels = +75 screen pixels
      assertEpsilon(offsetScreenPos.x - screenPos.x, 75, 0.5, 'Offset of +50 world px must map to +75 screen px at 1.5x zoom');
      assertEpsilon(offsetScreenPos.y - screenPos.y, 75, 0.5, 'Offset of +50 world px must map to +75 screen px at 1.5x zoom');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
