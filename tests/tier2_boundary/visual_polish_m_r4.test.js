/**
 * Tier 2 Boundary & Regression Suite: Visual Polish & Top-Down Graphics Overhaul
 * Milestone: M_R4
 * Features:
 * - F42: Top-Down Class & Automaton Silhouettes (aliases, distinct boilers, lenses, pauldrons, automaton core)
 * - F43: Dynamic Combat Visual Polish (weapon recoil kickback, barrel-tip muzzle flashes, spinning brass casings)
 * - F44: Steampunk Arena Detailing & Occlusion (floor/wall detailing, zero light bleeding through solid walls)
 */

import assert from 'node:assert/strict';
import { runSuiteHelper, isPointInPolygon } from '../harnesses/assert_helpers.js';
import {
  GameRenderer,
  WEAPON_RECOIL_CONFIGS,
  WEAPON_BARREL_OFFSETS
} from '../../client/js/rendering/GameRenderer.js';
import { VisibilityRenderer } from '../../client/js/rendering/VisibilityRenderer.js';
import {
  CHARACTER_CLASSES,
  CLASS_ALIASES,
  normalizeClassId,
  getClassDefinition
} from '../../shared/CharacterClasses.js';
import { computeVisibilityPolygon } from '../../shared/RaycastMath.js';
import { TILE_TYPES } from '../../shared/MapSchema.js';

export const suiteName = 'Tier 2: Top-Down Graphics & Combat Visual Polish (Milestone M_R4)';

/**
 * Creates a comprehensive mock Canvas 2D rendering context for headless inspection.
 */
function createMockContext(width = 800, height = 600) {
  const operations = [];
  const fills = [];
  const strokes = [];
  const translations = [];

  const ctx = {
    canvas: { width, height },
    globalAlpha: 1.0,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1.0,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',

    save: () => operations.push({ op: 'save' }),
    restore: () => operations.push({ op: 'restore' }),
    translate: (x, y) => {
      operations.push({ op: 'translate', x, y });
      translations.push({ x, y });
    },
    rotate: (angle) => operations.push({ op: 'rotate', angle }),
    scale: (sx, sy) => operations.push({ op: 'scale', sx, sy }),
    beginPath: () => operations.push({ op: 'beginPath' }),
    closePath: () => operations.push({ op: 'closePath' }),
    moveTo: (x, y) => operations.push({ op: 'moveTo', x, y }),
    lineTo: (x, y) => operations.push({ op: 'lineTo', x, y }),
    arc: (x, y, r, sa, ea) => operations.push({ op: 'arc', x, y, r, sa, ea }),
    ellipse: (x, y, rx, ry, rot) => operations.push({ op: 'ellipse', x, y, rx, ry, rot }),
    rect: (x, y, w, h) => operations.push({ op: 'rect', x, y, w, h }),
    fillRect: (x, y, w, h) => {
      const record = { op: 'fillRect', x, y, w, h, fillStyle: ctx.fillStyle };
      operations.push(record);
      fills.push(record);
    },
    strokeRect: (x, y, w, h) => {
      const record = { op: 'strokeRect', x, y, w, h, strokeStyle: ctx.strokeStyle };
      operations.push(record);
      strokes.push(record);
    },
    clearRect: (x, y, w, h) => operations.push({ op: 'clearRect', x, y, w, h }),
    fill: (rule) => {
      const record = { op: 'fill', rule, fillStyle: ctx.fillStyle };
      operations.push(record);
      fills.push(record);
    },
    stroke: () => {
      const record = { op: 'stroke', strokeStyle: ctx.strokeStyle };
      operations.push(record);
      strokes.push(record);
    },
    clip: () => operations.push({ op: 'clip' }),
    drawImage: (img, ...args) => operations.push({ op: 'drawImage', img, args }),
    fillText: (text, x, y) => operations.push({ op: 'fillText', text, x, y }),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) => ({
      addColorStop: () => {}
    }),
    createLinearGradient: () => ({
      addColorStop: () => {}
    }),
    createPattern: () => null
  };

  return { ctx, operations, fills, strokes, translations };
}

const tests = [
  // ══════════════════════════════════════════════════════════════════════════
  // F42: Top-Down Class Silhouettes & Automaton Bot
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'M_R4.F42.1',
    name: 'Class Silhouette Aliases & Attribute Consistency (stalker, bruiser, vanguard, infiltrator)',
    fn: async () => {
      // 1. Alias normalization mapping verification
      assert.equal(normalizeClassId('stalker'), 'sharpshooter');
      assert.equal(normalizeClassId('STALKER'), 'sharpshooter');
      assert.equal(normalizeClassId('sharpshooter'), 'sharpshooter');
      assert.equal(normalizeClassId('bruiser'), 'juggernaut');
      assert.equal(normalizeClassId('BRUISER'), 'juggernaut');
      assert.equal(normalizeClassId('juggernaut'), 'juggernaut');
      assert.equal(normalizeClassId('vanguard'), 'vanguard');
      assert.equal(normalizeClassId('infiltrator'), 'infiltrator');
      assert.equal(normalizeClassId(''), 'vanguard');
      assert.equal(normalizeClassId(null), 'vanguard');

      // 2. getClassDefinition returns authentic stats for both canonical IDs and aliases
      const stalkerDef = getClassDefinition('stalker');
      const sharpshooterDef = getClassDefinition('sharpshooter');
      assert.equal(stalkerDef.id, 'sharpshooter');
      assert.equal(stalkerDef.baseHp, 80);
      assert.equal(stalkerDef.accentColor, '#5ffbf1');
      assert.equal(stalkerDef.lanternRange, 550);
      assert.deepEqual(stalkerDef, sharpshooterDef);

      const bruiserDef = getClassDefinition('bruiser');
      const juggernautDef = getClassDefinition('juggernaut');
      assert.equal(bruiserDef.id, 'juggernaut');
      assert.equal(bruiserDef.baseHp, 145);
      assert.equal(bruiserDef.accentColor, '#ff7b00');
      assert.equal(bruiserDef.lanternRange, 360);
      assert.deepEqual(bruiserDef, juggernautDef);

      const vanguardDef = getClassDefinition('vanguard');
      assert.equal(vanguardDef.baseHp, 100);
      assert.equal(vanguardDef.accentColor, '#ffcf48');

      const infiltratorDef = getClassDefinition('infiltrator');
      assert.equal(infiltratorDef.baseHp, 90);
      assert.equal(infiltratorDef.accentColor, '#b33939');

      // 3. GameRenderer top-down human rendering produces consistent silhouettes for aliases
      const { ctx: ctxStalker, operations: opsStalker, fills: fillsStalker } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctxStalker });

      const playerStalker = { id: 'p1', x: 200, y: 150, angle: 0, isAlive: true, classId: 'stalker', weaponId: 'needle_gun' };
      renderer.renderPlayerAvatar(ctxStalker, playerStalker, false);
      assert.ok(opsStalker.length > 20, 'renderPlayerAvatar produced drawing commands for stalker');

      const { ctx: ctxSharp, operations: opsSharp, fills: fillsSharp } = createMockContext();
      const playerSharp = { id: 'p1', x: 200, y: 150, angle: 0, isAlive: true, classId: 'sharpshooter', weaponId: 'needle_gun' };
      renderer.renderPlayerAvatar(ctxSharp, playerSharp, false);

      // Verify both alias and canonical ID generated identical lens colors and pneumatic tube features
      const hasCyanLensStalker = fillsStalker.some(f => f.fillStyle === '#5ffbf1');
      const hasCyanLensSharp = fillsSharp.some(f => f.fillStyle === '#5ffbf1');
      assert.ok(hasCyanLensStalker, 'Stalker renders with distinct cyan optical lens (#5ffbf1)');
      assert.ok(hasCyanLensSharp, 'Sharpshooter renders with distinct cyan optical lens (#5ffbf1)');

      // Verify bruiser renders with widened torso and furnace orange optics (#ff7b00)
      const { ctx: ctxBruiser, fills: fillsBruiser } = createMockContext();
      const playerBruiser = { id: 'p2', x: 200, y: 150, angle: 0, isAlive: true, classId: 'bruiser', weaponId: 'steam_mortar' };
      renderer.renderPlayerAvatar(ctxBruiser, playerBruiser, false);
      const hasOrangeOpticBruiser = fillsBruiser.some(f => f.fillStyle === '#ff7b00');
      assert.ok(hasOrangeOpticBruiser, 'Bruiser renders with distinct furnace orange optics (#ff7b00)');
    }
  },

  {
    id: 'M_R4.F42.2',
    name: 'Clockwork Automaton Bot Overhead Silhouette (hull bolts, cogwheel, treads, pistons, aether core, visor)',
    fn: async () => {
      const { ctx, operations, fills, translations } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctx });

      const bot = {
        id: 'bot_alpha_1',
        x: 300,
        y: 250,
        angle: 0,
        isAlive: true,
        isBot: true,
        weaponId: 'gatling_cannon',
        difficulty: 'normal'
      };

      const now = 2500;
      renderer.renderPlayerAvatar(ctx, bot, false);

      // 1. Forged iron hull (#222834) and brass rim (#c59b27)
      const hasIronHull = fills.some(f => f.fillStyle === '#222834');
      assert.ok(hasIronHull, 'Automaton renders with heavy forged iron hull (#222834)');

      // 2. Continuous rotating clockwork cogwheel core with 8 teeth (#ffd152)
      const hasBrassGears = fills.some(f => f.fillStyle === '#ffd152');
      assert.ok(hasBrassGears, 'Automaton renders with clockwork cogwheel core (#ffd152)');

      // 3. Sweeping robotic optical visor scanner
      const hasVisorCasing = fills.some(f => f.op === 'fillRect' && f.fillStyle === '#101318');
      assert.ok(hasVisorCasing, 'Automaton renders with sweeping optical visor casing (#101318)');

      // 4. Central pulsing Aether crystal core (#ff9f1c for normal, white highlight center)
      const hasAetherCore = fills.some(f => f.fillStyle === '#ff9f1c');
      assert.ok(hasAetherCore, 'Automaton renders with glowing Aether crystal core (#ff9f1c)');

      // 5. Elite/nightmare difficulty shifts Aether crystal core to red (#ff2a2a)
      const { ctx: ctxElite, fills: fillsElite } = createMockContext();
      const eliteBot = { ...bot, difficulty: 'nightmare' };
      renderer.renderPlayerAvatar(ctxElite, eliteBot, false);
      const hasRedEliteCore = fillsElite.some(f => f.fillStyle === '#ff2a2a');
      assert.ok(hasRedEliteCore, 'Elite automaton shifts Aether core to hostile red (#ff2a2a)');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F43: Dynamic Combat Visual Polish
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'M_R4.F43.1',
    name: 'Weapon Recoil Kickback Profiles & Smooth Decay Over 80-120ms',
    fn: async () => {
      const { ctx } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctx });

      // 1. Verify kickback profiles across all 8 weapons
      assert.equal(WEAPON_RECOIL_CONFIGS.revolver.kickback, 3.2);
      assert.equal(WEAPON_RECOIL_CONFIGS.steam_carbine.kickback, 3.6);
      assert.equal(WEAPON_RECOIL_CONFIGS.blunderbuss.kickback, 5.5);
      assert.equal(WEAPON_RECOIL_CONFIGS.needle_gun.kickback, 4.0);
      assert.equal(WEAPON_RECOIL_CONFIGS.tesla_rifle.kickback, 2.4);
      assert.equal(WEAPON_RECOIL_CONFIGS.steam_mortar.kickback, 6.0);
      assert.equal(WEAPON_RECOIL_CONFIGS.aether_flamethrower.kickback, 1.5);
      assert.equal(WEAPON_RECOIL_CONFIGS.gatling_cannon.kickback, 2.0);

      // Verify all durations fall within 80-120ms specification
      for (const [wId, cfg] of Object.entries(WEAPON_RECOIL_CONFIGS)) {
        assert.ok(
          cfg.duration >= 0.07 && cfg.duration <= 0.13,
          `${wId} recoil duration ${cfg.duration}s is within the 80-120ms window`
        );
      }

      // 2. Trigger recoil on Blunderbuss (5.5px kickback, 0.12s duration)
      renderer.triggerRecoil('player_1', 'blunderbuss');
      assert.equal(renderer.getRecoilDistance('player_1'), 5.5, 'Initial recoil equals max kickback');

      // 3. Advance time by 0.06s (50% elapsed) -> smooth linear/exponential decay
      renderer.update(0.06, {});
      const halfRecoil = renderer.getRecoilDistance('player_1');
      assert.ok(halfRecoil > 2.0 && halfRecoil < 3.5, `Recoil decayed to midpoint: ${halfRecoil}`);

      // 4. Advance time past duration (another 0.07s -> total 0.13s > 0.12s)
      renderer.update(0.07, {});
      assert.equal(renderer.getRecoilDistance('player_1'), 0, 'Recoil fully returns to resting position (0px)');
      assert.equal(renderer.entityRecoils.has('player_1'), false, 'Expired recoil cleaned from map');

      // 5. Verify recoil kickback applies backward translation to weapon render
      const { ctx: ctxWeapon, translations } = createMockContext();
      renderer.renderTopDownWeapon(ctxWeapon, 'blunderbuss', 1000, 4.5);
      const hasNegativeKickback = translations.some(t => t.x === -4.5 && t.y === 0);
      assert.ok(hasNegativeKickback, 'renderTopDownWeapon translated firearm backward by -4.5px');
    }
  },

  {
    id: 'M_R4.F43.2',
    name: 'Barrel-Tip Muzzle Flashes (positioning across weapon models, star polygon, 40-80ms lifespan)',
    fn: async () => {
      const { ctx } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctx });

      // 1. Verify barrel offsets for all weapons
      assert.equal(WEAPON_BARREL_OFFSETS.revolver.x, 20);
      assert.equal(WEAPON_BARREL_OFFSETS.steam_carbine.x, 27);
      assert.equal(WEAPON_BARREL_OFFSETS.blunderbuss.x, 23.5);
      assert.equal(WEAPON_BARREL_OFFSETS.needle_gun.x, 35);
      assert.equal(WEAPON_BARREL_OFFSETS.tesla_rifle.x, 26);
      assert.equal(WEAPON_BARREL_OFFSETS.steam_mortar.x, 22);
      assert.equal(WEAPON_BARREL_OFFSETS.aether_flamethrower.x, 26);
      assert.equal(WEAPON_BARREL_OFFSETS.gatling_cannon.x, 28);

      // 2. Generate muzzle flash at origin (100, 200) with angle = 0 for Revolver
      const flash = renderer.addMuzzleFlash({
        entityId: 'p1',
        x: 100,
        y: 200,
        angle: 0,
        weaponId: 'revolver'
      });

      assert.ok(flash, 'Muzzle flash created');
      assert.equal(flash.x, 120, 'Barrel tip positioned at x = 100 + 20');
      assert.equal(flash.y, 200, 'Barrel tip positioned at y = 200 + 0');
      assert.ok(flash.life >= 0.04 && flash.life <= 0.08, `Lifespan ${flash.life}s is within 40-80ms`);

      // 3. Test angle orientation (90 degrees / Math.PI/2) for Needle Gun (length 35)
      const flashNeedle = renderer.addMuzzleFlash({
        entityId: 'p2',
        x: 100,
        y: 200,
        angle: Math.PI / 2,
        weaponId: 'needle_gun'
      });
      assert.ok(Math.abs(flashNeedle.x - 100) < 1e-4, 'Needle tip x matches origin');
      assert.ok(Math.abs(flashNeedle.y - 235) < 1e-4, 'Needle tip y = 200 + 35 = 235');

      // 4. Verify star burst polygon rendering
      const { ctx: ctxFlash, fills: flashFills } = createMockContext();
      renderer.renderMuzzleFlashes(ctxFlash);
      const hasOrangeBurst = flashFills.some(f => f.fillStyle === '#ff7b00');
      const hasGoldBurst = flashFills.some(f => f.fillStyle === '#ffd152');
      const hasWhiteHotCore = flashFills.some(f => f.fillStyle === '#fffbf0');
      assert.ok(hasOrangeBurst, 'Muzzle flash renders incandescent fiery orange outer burst (#ff7b00)');
      assert.ok(hasGoldBurst, 'Muzzle flash renders incandescent gold mid burst (#ffd152)');
      assert.ok(hasWhiteHotCore, 'Muzzle flash renders incandescent white-hot core (#fffbf0)');

      // 5. Verify decay and removal over lifespan
      renderer.update(0.04, {});
      assert.ok(renderer.muzzleFlashes.length > 0, 'Flash persists during active lifespan');
      renderer.update(0.04, {});
      assert.equal(renderer.muzzleFlashes.length, 0, 'Flash decays and purges after 80ms lifespan');
    }
  },

  {
    id: 'M_R4.F43.3',
    name: 'Spinning Brass Cartridge Casing Particles & Zero-Allocation Pooling',
    fn: async () => {
      const { ctx } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctx });

      // 1. Firearms eject casings; energy weapons do not
      const casingRevolver = renderer.addEjectedCasing(100, 100, 0, 'revolver');
      assert.ok(casingRevolver, 'Revolver ejects brass casing');
      assert.ok(casingRevolver.length >= 3.5 && casingRevolver.length <= 5.2, 'Casing length ~3.5-5px');
      assert.ok(casingRevolver.width >= 1.5 && casingRevolver.width <= 2.2, 'Casing width ~1.5-2px');
      assert.ok(Math.abs(casingRevolver.spin) >= 15, 'Casing has active rotational spin');

      const casingTesla = renderer.addEjectedCasing(100, 100, 0, 'tesla_rifle');
      assert.equal(casingTesla, null, 'Tesla rifle does not eject brass cartridge casings');

      const casingFlame = renderer.addEjectedCasing(100, 100, 0, 'aether_flamethrower');
      assert.equal(casingFlame, null, 'Aether flamethrower does not eject brass cartridge casings');

      // 2. Physics update: drag deceleration, spin damping, position translation
      const initialVx = casingRevolver.vx;
      const initialVy = casingRevolver.vy;
      const initialSpin = casingRevolver.spin;
      const initialX = casingRevolver.x;
      const initialY = casingRevolver.y;

      renderer.update(0.05, {});
      assert.notEqual(casingRevolver.x, initialX, 'Casing moved along X');
      assert.notEqual(casingRevolver.y, initialY, 'Casing moved along Y');
      assert.ok(Math.abs(casingRevolver.vx) < Math.abs(initialVx), 'Air drag decelerated vx');
      assert.ok(Math.abs(casingRevolver.vy) < Math.abs(initialVy), 'Air drag decelerated vy');
      assert.ok(Math.abs(casingRevolver.spin) < Math.abs(initialSpin), 'Rotational drag damped spin');

      // 3. Rendering brass metallic palette
      const { ctx: ctxCasing, fills: casingFills } = createMockContext();
      renderer.renderCasingParticles(ctxCasing);
      const hasBrassBase = casingFills.some(f => f.fillStyle === '#c59b27');
      const hasBrassHighlight = casingFills.some(f => f.fillStyle === '#ffd152');
      assert.ok(hasBrassBase, 'Casing renders with burnished brass base (#c59b27)');
      assert.ok(hasBrassHighlight, 'Casing renders with specular highlight (#ffd152)');

      // 4. Zero-allocation pooling: expired casings recycled into casingPool
      assert.equal(renderer.casingPool.length, 0, 'Pool initially empty');
      renderer.update(0.80, {}); // Advance past casing life (~0.5-0.65s)
      assert.equal(renderer.casingParticles.length, 0, 'All active casings expired');
      assert.ok(renderer.casingPool.length >= 1, 'Expired casing recycled into casingPool');

      // Re-firing reuses the pooled object without fresh heap allocation
      const pooledCasingRef = renderer.casingPool[0];
      const newCasing = renderer.addEjectedCasing(150, 150, 0, 'steam_carbine');
      assert.equal(newCasing, pooledCasingRef, 'New casing recycled directly from pool');
      assert.equal(renderer.casingPool.length, 0, 'Pool depleted by recycled grab');
    }
  },

  {
    id: 'M_R4.F43.4',
    name: 'Burst Overflow (>48 Active Casings) Recycles Truncated Particles Without Pool Starvation',
    fn: async () => {
      const { ctx } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctx });

      renderer.casingPool = Array.from({ length: 64 }, () => ({}));
      const preAllocated = new Set(renderer.casingPool);
      const weapons = ['revolver', 'steam_carbine', 'blunderbuss', 'needle_gun', 'gatling_cannon'];
      let newAllocs = 0;

      for (let frame = 1; frame <= 200; frame++) {
        for (let c = 0; c < 8; c++) {
          if ((frame + c) % 4 === 0) {
            const casing = renderer.addEjectedCasing(100 + c * 50, 150 + c * 20, 0, weapons[c % weapons.length]);
            if (casing && !preAllocated.has(casing)) {
              preAllocated.add(casing);
              newAllocs++;
            }
          }
        }
        renderer.update(0.016, {});
      }

      assert.equal(newAllocs, 0, 'Zero new heap allocations during burst overflow (>48 active casings)');
      assert.ok(renderer.casingParticles.length <= 48, 'Active casings strictly bounded to <= 48');
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F44: Steampunk Arena Detailing & Occlusion
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'M_R4.F44.1',
    name: 'Steampunk Arena Procedural Detailing (floor rivets, steam vents, riveted walls, pressure gauges)',
    fn: async () => {
      const { ctx: ctxFloor, operations: opsFloor, fills: fillsFloor } = createMockContext();
      const renderer = new GameRenderer({ width: 800, height: 600, getContext: () => ctxFloor });

      renderer.setMap({
        width: 10,
        height: 10,
        tileSize: 40,
        tiles: new Array(100).fill(TILE_TYPES.FLOOR)
      });

      // 1. Procedural floor detailing
      renderer.renderLayer1Floor(ctxFloor);
      const hasFloorRivets = fillsFloor.some(f => f.fillStyle === '#c59b27');
      assert.ok(hasFloorRivets, 'Procedural floor renders with brass corner rivets (#c59b27)');
      const hasSteamVents = fillsFloor.some(f => f.fillStyle === '#101217');
      assert.ok(hasSteamVents, 'Procedural floor renders with steam drainage vents (#101217)');

      // 2. Procedural wall & obstacle detailing
      const { ctx: ctxWalls, fills: fillsWalls, strokes: strokesWalls } = createMockContext();
      renderer.setMap({
        width: 4,
        height: 4,
        tileSize: 40,
        tiles: [
          TILE_TYPES.WALL, TILE_TYPES.OBSTACLE, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR,
          TILE_TYPES.FLOOR, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR,
          TILE_TYPES.FLOOR, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR,
          TILE_TYPES.FLOOR, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR, TILE_TYPES.FLOOR
        ]
      });

      renderer.renderLayer2Obstacles(ctxWalls);

      // Verify Wall: Cast-iron plate (#22262d), center reinforcement band (#2d333c), brass corner rivets (#c59b27)
      const hasWallIronPlate = fillsWalls.some(f => f.fillStyle === '#22262d');
      const hasWallBand = fillsWalls.some(f => f.fillStyle === '#2d333c');
      const hasWallRivets = fillsWalls.some(f => f.fillStyle === '#c59b27');
      assert.ok(hasWallIronPlate, 'Solid wall renders with cast-iron armor plate (#22262d)');
      assert.ok(hasWallBand, 'Solid wall renders with center reinforcement band (#2d333c)');
      assert.ok(hasWallRivets, 'Solid wall renders with brass corner rivets (#c59b27)');

      // Verify Obstacle: Copper plate (#703816), border (#b87333), dial face (#ffffff), red needle (#d63031)
      const hasObstacleCopper = fillsWalls.some(f => f.fillStyle === '#703816');
      const hasObstacleDial = fillsWalls.some(f => f.fillStyle === '#ffffff');
      const hasRedNeedle = strokesWalls.some(s => s.strokeStyle === '#d63031');
      assert.ok(hasObstacleCopper, 'Cover obstacle renders with warm copper base (#703816)');
      assert.ok(hasObstacleDial, 'Cover obstacle renders with steam pressure gauge dial (#ffffff)');
      assert.ok(hasRedNeedle, 'Cover obstacle renders with indicator needle (#d63031)');
    }
  },

  {
    id: 'M_R4.F44.2',
    name: 'Volumetric Steam-Lantern Lighting Strictly Occluded (Zero Bleed Through Solid Walls)',
    fn: async () => {
      // 1. Analytical 2D raycasting occlusion test against a solid wall
      // Observer at (100, 150) casting lantern light towards East (aimAngle = 0, range = 300)
      const observer = { x: 100, y: 150, angle: 0, fov: Math.PI * 0.5, range: 300 };

      // Solid vertical wall at x = 200 spanning y from 50 to 250
      const wallSegment = {
        p1: { x: 200, y: 50 },
        p2: { x: 200, y: 250 }
      };
      const segments = [wallSegment];

      const poly = computeVisibilityPolygon(
        { x: observer.x, y: observer.y },
        segments,
        observer.angle,
        observer.fov,
        observer.range
      );

      assert.ok(poly && poly.length >= 3, 'Visibility polygon computed with valid vertices');

      // Assert that every ray hitting the wall strictly terminates at x <= 200
      for (const vertex of poly) {
        if (vertex.y >= 50 && vertex.y <= 250) {
          assert.ok(
            vertex.x <= 200 + 1e-4,
            `Visibility ray vertex (${vertex.x}, ${vertex.y}) strictly terminates at or in front of the wall (x <= 200)`
          );
        }
      }

      // Assert that any point directly behind the wall is in total darkness (outside visibility polygon)
      const pointBehindWall = { x: 250, y: 150 };
      const isLitBehindWall = isPointInPolygon(pointBehindWall, poly);
      assert.equal(
        isLitBehindWall,
        false,
        'Point behind solid wall (250, 150) receives ZERO light bleed (outside visibility polygon)'
      );

      // 2. VisibilityRenderer strictly applies canvas clip() for zero bleed
      const { ctx: mockMainCtx, operations: opsMain } = createMockContext();
      const { ctx: mockFogCtx, operations: opsFog } = createMockContext();
      const mockFogCanvas = {
        width: 800,
        height: 600,
        getContext: () => mockFogCtx
      };
      const visRenderer = new VisibilityRenderer({ fogCanvas: mockFogCanvas });

      const testPlayer = {
        id: 'player_lantern_test',
        x: 100,
        y: 150,
        angle: 0,
        isAlive: true,
        lanternOn: true
      };

      visRenderer.renderDarknessMask(
        mockMainCtx,
        testPlayer,
        segments,
        { x: 0, y: 0, width: 800, height: 600, zoom: 1.0 },
        [],
        []
      );

      // Verify that clip() was executed on the visibility polygon boundary
      const clipCallsMain = opsMain.filter(op => op.op === 'clip');
      const clipCallsFog = opsFog.filter(op => op.op === 'clip');
      assert.ok(
        clipCallsMain.length >= 1 && clipCallsFog.length >= 1,
        'VisibilityRenderer executes clip() strictly containing volumetric light and darkness punch within LoS polygon'
      );
    }
  }
];

export async function run() {
  return await runSuiteHelper(suiteName, tests);
}
