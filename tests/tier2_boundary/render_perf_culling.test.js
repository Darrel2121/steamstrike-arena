/**
 * Tier 2 Boundary & Regression Suite: Render Performance & Spatial Entity Viewport Culling
 * Features: F40 (Canvas 2D Gradient & GC Optimization) & F41 (Spatial Entity Viewport Culling)
 *
 * Validates:
 * 1. Camera viewport culling boundary calculations and AABB tests.
 * 2. Spatial entity culling: Projectiles, Pickups, Wrecks, and Remote Combatants.
 * 3. Fullscreen cinematic vignette radial gradient caching across frames and resize invalidation.
 * 4. Volumetric steam exhaust and smoke zone gradient caching and lobe template reuse.
 * 5. VisibilityRenderer scratch array reuse (_scratchActiveOthers, _scratchActiveMapLanterns, _scratchOthersPassData).
 * 6. NetworkClient zero-allocation predicted player object reuse and interpolation GC reduction.
 */

import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { GameRenderer } from '../../client/js/rendering/GameRenderer.js';
import { VisibilityRenderer } from '../../client/js/rendering/VisibilityRenderer.js';
import { NetworkClient } from '../../client/js/NetworkClient.js';

export const suiteName = 'Tier 2: Render Performance, GC Optimization & Spatial Viewport Culling';

function createMockContext(width = 800, height = 600) {
  let radialGradCount = 0;
  const createdGradients = [];

  const ctx = {
    canvas: { width, height },
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    clip: () => {},
    drawImage: () => {},
    createPattern: () => null,
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) => {
      radialGradCount++;
      const grad = {
        _id: radialGradCount,
        x0, y0, r0, x1, y1, r1,
        colorStops: [],
        addColorStop(offset, color) {
          this.colorStops.push({ offset, color });
        }
      };
      createdGradients.push(grad);
      return grad;
    },
    fillText: () => {},
    strokeText: () => {},
    setLineDash: () => {},
    globalAlpha: 1.0,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    getRadialGradCount: () => radialGradCount,
    getCreatedGradients: () => createdGradients
  };

  return ctx;
}

function createMockCanvas(width = 800, height = 600) {
  const ctx = createMockContext(width, height);
  return {
    width,
    height,
    getContext: (type) => (type === '2d' ? ctx : null),
    _ctx: ctx
  };
}

export const tests = [
  // =========================================================================
  // 1. VIEWPORT BOUNDS CALCULATION & AABB TEST
  // =========================================================================
  {
    id: 'M_R3.F41.1',
    name: 'Viewport Culling Bounds & AABB Hit Testing',
    fn: async () => {
      const canvas = createMockCanvas(800, 600);
      const renderer = new GameRenderer(canvas, { zoom: 1.0 });

      renderer.camera.x = 200;
      renderer.camera.y = 150;
      renderer.camera.width = 800;
      renderer.camera.height = 600;
      renderer.camera.zoom = 1.0;

      // With default margin = 80
      const bounds = renderer.getViewportBounds(80);
      assert.strictEqual(bounds.left, 200 - 80, 'bounds.left must be camX - margin');
      assert.strictEqual(bounds.top, 150 - 80, 'bounds.top must be camY - margin');
      assert.strictEqual(bounds.right, 200 + 800 + 80, 'bounds.right must be camX + viewW + margin');
      assert.strictEqual(bounds.bottom, 150 + 600 + 80, 'bounds.bottom must be camY + viewH + margin');

      // Test memory reuse: repeated calls mutate the same bounds object without allocation
      const bounds2 = renderer.getViewportBounds(80);
      assert.strictEqual(bounds, bounds2, 'getViewportBounds must reuse internal bounds object');

      // Test entity presence inside and outside
      assert.strictEqual(renderer.isEntityInViewport(500, 400, 0, 80), true, 'Centered entity is in viewport');
      assert.strictEqual(renderer.isEntityInViewport(120, 100, 0, 80), true, 'Near edge entity is in viewport');
      assert.strictEqual(renderer.isEntityInViewport(50, 400, 0, 80), false, 'Entity beyond left bound is culled');
      assert.strictEqual(renderer.isEntityInViewport(50, 400, 80, 80), true, 'Entity with radius overlapping bound is in viewport');
      assert.strictEqual(renderer.isEntityInViewport(1200, 400, 0, 80), false, 'Entity beyond right bound is culled');
      assert.strictEqual(renderer.isEntityInViewport(500, 900, 0, 80), false, 'Entity beyond bottom bound is culled');
      assert.strictEqual(renderer.isEntityInViewport(500, 50, 0, 80), false, 'Entity beyond top bound is culled');
    }
  },

  // =========================================================================
  // 2. SPATIAL ENTITY VIEWPORT CULLING EXECUTION
  // =========================================================================
  {
    id: 'M_R3.F41.2',
    name: 'Spatial Entity Viewport Culling (Projectiles, Pickups, Wrecks, Remote Combatants)',
    fn: async () => {
      const canvas = createMockCanvas(800, 600);
      const renderer = new GameRenderer(canvas, { zoom: 1.0 });

      renderer.camera.x = 500;
      renderer.camera.y = 500;
      renderer.camera.width = 800;
      renderer.camera.height = 600;
      renderer.camera.zoom = 1.0;
      // Viewport bounds with 80px margin: [420, 420] to [1380, 1180]

      const renderedProjectiles = [];
      const renderedPickups = [];
      const renderedWrecks = [];
      const renderedAvatars = [];

      renderer.renderProjectile = (ctx, b) => renderedProjectiles.push(b.id);
      renderer.renderPickup = (ctx, p) => renderedPickups.push(p.id);
      renderer.renderDestroyedAvatar = (ctx, w) => renderedWrecks.push(w.id);
      renderer.renderPlayerAvatar = (ctx, pl, isLocal) => renderedAvatars.push({ id: pl.id, isLocal });

      const state = {
        localPlayer: { id: 'hero', x: 200, y: 200, isAlive: true, hp: 100 }, // local player is outside bounds
        players: [
          { id: 'hero', x: 200, y: 200, isAlive: true, hp: 100 }, // local player: MUST always be rendered
          { id: 'remote_in', x: 800, y: 700, isAlive: true, hp: 100 }, // in view
          { id: 'remote_out_left', x: 100, y: 700, isAlive: true, hp: 100 }, // outside left
          { id: 'remote_out_far', x: 3000, y: 3000, isAlive: true, hp: 100 } // outside far
        ],
        projectiles: [
          { id: 'proj_in', x: 700, y: 650 },
          { id: 'proj_out_top', x: 700, y: 200 },
          { id: 'proj_out_right', x: 2000, y: 700 }
        ],
        pickups: [
          { id: 'pickup_in', x: 900, y: 800 },
          { id: 'pickup_out_bottom', x: 900, y: 1500 },
          { id: 'pickup_out_left', x: -100, y: 800 }
        ]
      };

      // Add persistent wrecks
      renderer.registerWreck({ id: 'wreck_in', x: 850, y: 750, isAlive: false, hp: 0 });
      renderer.registerWreck({ id: 'wreck_out', x: 2500, y: 2500, isAlive: false, hp: 0 });

      const ctx = canvas._ctx;

      // 1. Render projectiles over darkness
      renderer.renderLayerProjectilesOverDarkness(ctx, state);
      assert.deepStrictEqual(renderedProjectiles, ['proj_in'], 'Only in-view projectiles must be rendered; offscreen culled');

      // 2. Render Layer 3 entities (pickups, wrecks, avatars)
      renderer.renderLayer3Entities(ctx, state);
      assert.deepStrictEqual(renderedPickups, ['pickup_in'], 'Only in-view pickups must be rendered; offscreen culled');
      assert.deepStrictEqual(renderedWrecks, ['wreck_in'], 'Only in-view wrecks must be rendered; offscreen culled');

      // Local player is always rendered; remote combatant outside viewport is culled
      const avatarIds = renderedAvatars.map(a => a.id);
      assert.ok(avatarIds.includes('hero'), 'Local player avatar must always be rendered even if off-center');
      assert.ok(avatarIds.includes('remote_in'), 'In-view remote player must be rendered');
      assert.ok(!avatarIds.includes('remote_out_left'), 'Offscreen remote player must be culled');
      assert.ok(!avatarIds.includes('remote_out_far'), 'Far offscreen remote player must be culled');
      assert.strictEqual(renderedAvatars.length, 2, 'Exactly 2 avatars rendered (local + in-view remote)');
    }
  },

  // =========================================================================
  // 3. FULLSCREEN VIGNETTE GRADIENT CACHING & RESIZE INVALIDATION
  // =========================================================================
  {
    id: 'M_R3.F40.1',
    name: 'Fullscreen Cinematic Vignette Gradient Caching & Resize Invalidation',
    fn: async () => {
      const canvas = createMockCanvas(800, 600);
      const renderer = new GameRenderer(canvas);
      const ctx = canvas._ctx;

      const initialCount = ctx.getRadialGradCount();

      // Frame 1
      renderer.renderAtmosphericVfx(ctx, 800, 600);
      assert.strictEqual(ctx.getRadialGradCount(), initialCount + 1, 'First frame creates vignette gradient');
      const cachedVignette = renderer._cachedVignette;
      assert.ok(cachedVignette, 'Cached vignette gradient is stored on renderer');
      assert.strictEqual(renderer._vignetteWidth, 800);
      assert.strictEqual(renderer._vignetteHeight, 600);

      // Frame 2 (same dimensions): MUST NOT allocate new gradient
      renderer.renderAtmosphericVfx(ctx, 800, 600);
      assert.strictEqual(ctx.getRadialGradCount(), initialCount + 1, 'Frame 2 must reuse cached vignette without reallocation');
      assert.strictEqual(renderer._cachedVignette, cachedVignette, 'Gradient object reference must be strictly identical');

      // Frame 3 (resize dimensions to 1024x768): MUST recreate gradient
      renderer.resize(1024, 768);
      assert.strictEqual(renderer._cachedVignette, null, 'resize() must invalidate cached vignette');

      renderer.renderAtmosphericVfx(ctx, 1024, 768);
      assert.strictEqual(ctx.getRadialGradCount(), initialCount + 2, 'Resized frame creates new vignette gradient for new dimensions');
      assert.notStrictEqual(renderer._cachedVignette, cachedVignette, 'New gradient instance must be created after resize');
      assert.strictEqual(renderer._vignetteWidth, 1024);
      assert.strictEqual(renderer._vignetteHeight, 768);
    }
  },

  // =========================================================================
  // 4. SMOKE ZONE & STEAM EXHAUST GRADIENT CACHING
  // =========================================================================
  {
    id: 'M_R3.F40.2',
    name: 'Smoke Zone & Steam Particle Gradient Caching & Lobe Reuse',
    fn: async () => {
      const canvas = createMockCanvas(800, 600);
      const renderer = new GameRenderer(canvas);
      const ctx = canvas._ctx;

      // 1. Smoke puff gradient caching
      const gradPuff1 = renderer.getSmokePuffGradient(ctx, 60);
      const gradPuff2 = renderer.getSmokePuffGradient(ctx, 60);
      assert.strictEqual(gradPuff1, gradPuff2, 'Smoke puff gradient of same radius must be cached and reused');

      const gradCore1 = renderer.getSmokeCoreGradient(ctx, 80);
      const gradCore2 = renderer.getSmokeCoreGradient(ctx, 80);
      assert.strictEqual(gradCore1, gradCore2, 'Smoke core gradient of same radius must be cached and reused');

      // 2. Steam particle lobe gradient caching
      const steamGrad1 = renderer.getSteamLobeGradient(ctx, 10, false);
      const steamGrad2 = renderer.getSteamLobeGradient(ctx, 10, false);
      assert.strictEqual(steamGrad1, steamGrad2, 'Pure steam lobe gradient of same radius must be cached and reused');

      const sootGrad1 = renderer.getSteamLobeGradient(ctx, 10, true);
      const sootGrad2 = renderer.getSteamLobeGradient(ctx, 10, true);
      assert.strictEqual(sootGrad1, sootGrad2, 'Soot steam lobe gradient of same radius must be cached and reused');
      assert.notStrictEqual(steamGrad1, sootGrad1, 'Steam vs soot gradients must have distinct profiles');

      // 3. Smoke zones multi-frame render without unbounded gradient allocation
      const beforeCount = ctx.getRadialGradCount();
      const smokeZones = [{ x: 300, y: 300, radius: 120 }];
      for (let frame = 0; frame < 10; frame++) {
        renderer.renderSmokeZones(ctx, smokeZones);
      }
      const totalCreated = ctx.getRadialGradCount() - beforeCount;
      // Over 10 frames with 14 puffs/frame = 140 puffs + 10 cores = 150 potential allocations without cache.
      // With caching, total unique radii created should be bounded (<= 25).
      assert.ok(totalCreated <= 25, `Gradient cache must bound allocations (actual: ${totalCreated} vs un-cached 150)`);
    }
  },

  // =========================================================================
  // 5. VISIBILITY RENDERER SCRATCH ARRAYS & GRADIENT CACHING
  // =========================================================================
  {
    id: 'M_R3.F40.3',
    name: 'VisibilityRenderer Scratch Arrays & Radial Gradient Caching',
    fn: async () => {
      const visRenderer = new VisibilityRenderer();
      const canvas = createMockCanvas(800, 600);
      const mainCtx = canvas._ctx;

      // Provide mock offscreen darkness context
      const fogCanvas = createMockCanvas(800, 600);
      visRenderer.fogCanvas = fogCanvas;
      visRenderer.fogCtx = fogCanvas._ctx;

      const player = { id: 'hero', x: 300, y: 300, angle: 0, isAlive: true, lanternOn: true, team: 'team1' };
      const others = [
        { id: 'ally_1', x: 350, y: 320, angle: 0, isAlive: true, lanternOn: true, team: 'team1' },
        { id: 'enemy_1', x: 500, y: 400, angle: Math.PI, isAlive: true, lanternOn: true, team: 'team2' }
      ];
      const lanterns = [
        { type: 'lantern', x: 400, y: 300, radius: 115 }
      ];
      const segments = [
        { p1: { x: 100, y: 100 }, p2: { x: 700, y: 100 } }
      ];
      const camera = { x: 0, y: 0, width: 800, height: 600, zoom: 1.0 };

      // Render Frame 1
      visRenderer.renderDarknessMask(mainCtx, player, segments, camera, others, lanterns);
      const scratchOthersRef = visRenderer._scratchActiveOthers;
      const scratchLanternsRef = visRenderer._scratchActiveMapLanterns;
      const scratchPassDataRef = visRenderer._scratchOthersPassData;

      assert.ok(Array.isArray(scratchOthersRef), '_scratchActiveOthers must be populated array');
      assert.ok(Array.isArray(scratchLanternsRef), '_scratchActiveMapLanterns must be populated array');
      assert.ok(Array.isArray(scratchPassDataRef), '_scratchOthersPassData must be populated array');
      assert.strictEqual(scratchOthersRef.length, 2, '2 active other combatants captured');
      assert.strictEqual(scratchLanternsRef.length, 1, '1 active map lantern captured');

      // Render Frame 2
      visRenderer.renderDarknessMask(mainCtx, player, segments, camera, others, lanterns);
      assert.strictEqual(visRenderer._scratchActiveOthers, scratchOthersRef, '_scratchActiveOthers array must be reused across frames');
      assert.strictEqual(visRenderer._scratchActiveMapLanterns, scratchLanternsRef, '_scratchActiveMapLanterns array must be reused across frames');
      assert.strictEqual(visRenderer._scratchOthersPassData, scratchPassDataRef, '_scratchOthersPassData array must be reused across frames');

      // Verify VisibilityRenderer radial gradient caching
      const punchGrad1 = visRenderer.getLanternPunchGradient(mainCtx, 260);
      const punchGrad2 = visRenderer.getLanternPunchGradient(mainCtx, 260);
      assert.strictEqual(punchGrad1, punchGrad2, 'Lantern punch gradient must be cached');

      const proxGrad1 = visRenderer.getProxPunchGradient(mainCtx, 45);
      const proxGrad2 = visRenderer.getProxPunchGradient(mainCtx, 45);
      assert.strictEqual(proxGrad1, proxGrad2, 'Proximity punch gradient must be cached');

      const mapGrad1 = visRenderer.getMapLanternPunchGradient(mainCtx, 115);
      const mapGrad2 = visRenderer.getMapLanternPunchGradient(mainCtx, 115);
      assert.strictEqual(mapGrad1, mapGrad2, 'Map lantern punch gradient must be cached');

      const mistGrad1 = visRenderer.getLocalMistGradient(mainCtx, 250);
      const mistGrad2 = visRenderer.getLocalMistGradient(mainCtx, 250);
      assert.strictEqual(mistGrad1, mistGrad2, 'Volumetric mist gradient must be cached');
    }
  },

  // =========================================================================
  // 6. NETWORK CLIENT PREDICTION & INTERPOLATION GC REDUCTION
  // =========================================================================
  {
    id: 'M_R3.F40.4',
    name: 'NetworkClient Zero-Allocation Predicted Player Object Reuse & Interpolation GC Reduction',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'player_hero';
      client.isPredictionInitialized = true;
      client.predictedX = 150;
      client.predictedY = 250;
      client.predictedAngle = 1.25;

      client.snapshotBuffer.push({
        receivedAt: 1000,
        data: {
          tick: 1,
          players: [
            { id: 'player_hero', x: 140, y: 240, hp: 100, isAlive: true }
          ]
        }
      });

      // Call getLocalPredictedPlayer consecutive times
      const p1 = client.getLocalPredictedPlayer();
      assert.ok(p1, 'Predicted player object returned');
      assert.strictEqual(p1.id, 'player_hero');
      assert.strictEqual(p1.x, 150);
      assert.strictEqual(p1.y, 250);

      // Mutate predicted position
      client.predictedX = 160;
      client.predictedY = 270;
      const p2 = client.getLocalPredictedPlayer();

      // Memory reference verification: MUST reuse internal object
      assert.strictEqual(p1, p2, 'getLocalPredictedPlayer must reuse _predictedPlayerObj without per-frame heap allocation');
      assert.strictEqual(p2.x, 160, 'Updated coordinates reflected in reused object');
      assert.strictEqual(p2.y, 270, 'Updated coordinates reflected in reused object');

      // Test getInterpolatedState without unnecessary allocations
      const state = client.getInterpolatedState(1000);
      assert.ok(state, 'Interpolated state generated');
      assert.strictEqual(state.players.length, 1);
      assert.strictEqual(state.players[0].id, 'player_hero');
      assert.strictEqual(state.aliveCount, 1);
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
