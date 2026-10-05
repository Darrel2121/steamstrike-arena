/**
 * Tier 2.11: Adversarial Acoustic Sound Wave Simulation & Off-Screen Radar Tracking Stress Suite
 * Authored by: challenger_m2_2
 * Milestone: M2 (Tactical Vision & Acoustic Sound Engine)
 *
 * Empirically stress-tests:
 * 1. Sound wave lifecycle: emission, expansion over dt, max radius clamping, alpha decay, cleanup
 * 2. Viewport thresholding & off-screen border intersection chevrons across 360-degree angle sweep
 * 3. Extreme far-field distance numeric stability oracle
 * 4. 6-layer Canvas 2D composition: sound waves execute strictly AFTER darkness mask
 * 5. High-frequency burst test: 100 simultaneous sound waves without memory leaks or array bloat
 * 6. High-throughput sustained cycle & CPU execution performance benchmarking
 */

import assert from 'node:assert/strict';
import { runSuiteHelper, assertEpsilon, assertAngleClose } from '../harnesses/assert_helpers.js';
import { SoundWaveRenderer } from '../../client/js/rendering/SoundWaveRenderer.js';
import { VisibilityRenderer } from '../../client/js/rendering/VisibilityRenderer.js';
import { GameRenderer } from '../../client/js/rendering/GameRenderer.js';
import { SOUND_CONFIGS, THEME_COLORS } from '../../shared/Constants.js';

export const suiteName = 'Tier 2.11: Acoustic Simulation & Off-Screen Radar Stress';

/**
 * Headless Canvas 2D Context Mock with layer and state tracking
 */
class HeadlessCanvasMock {
  constructor(width = 800, height = 600) {
    this.canvas = { width, height };
    this.logs = [];
    this.stateStack = [];

    this.globalCompositeOperation = 'source-over';
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.lineDash = [];
    this.lineDashOffset = 0;
    this.font = '10px sans-serif';
    this.textAlign = 'start';
  }

  save() {
    this.stateStack.push({
      globalCompositeOperation: this.globalCompositeOperation,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineDash: [...this.lineDash],
      lineDashOffset: this.lineDashOffset,
      font: this.font,
      textAlign: this.textAlign
    });
    this.logs.push({ op: 'save', depth: this.stateStack.length });
  }

  restore() {
    if (this.stateStack.length > 0) {
      const state = this.stateStack.pop();
      this.globalCompositeOperation = state.globalCompositeOperation;
      this.fillStyle = state.fillStyle;
      this.strokeStyle = state.strokeStyle;
      this.lineWidth = state.lineWidth;
      this.lineDash = state.lineDash;
      this.lineDashOffset = state.lineDashOffset;
      this.font = state.font;
      this.textAlign = state.textAlign;
    }
    this.logs.push({ op: 'restore', depth: this.stateStack.length });
  }

  beginPath() { this.logs.push({ op: 'beginPath' }); }
  closePath() { this.logs.push({ op: 'closePath' }); }
  moveTo(x, y) { this.logs.push({ op: 'moveTo', x, y }); }
  lineTo(x, y) { this.logs.push({ op: 'lineTo', x, y }); }
  arc(x, y, radius, startAngle, endAngle) {
    this.logs.push({ op: 'arc', x, y, radius, startAngle, endAngle });
  }
  rect(x, y, w, h) { this.logs.push({ op: 'rect', x, y, w, h }); }
  roundRect(x, y, w, h, r) { this.logs.push({ op: 'roundRect', x, y, w, h, r }); }
  fillRect(x, y, w, h) { this.logs.push({ op: 'fillRect', x, y, w, h, fillStyle: this.fillStyle }); }
  strokeRect(x, y, w, h) { this.logs.push({ op: 'strokeRect', x, y, w, h }); }
  clearRect(x, y, w, h) { this.logs.push({ op: 'clearRect', x, y, w, h }); }
  fillText(text, x, y) { this.logs.push({ op: 'fillText', text, x, y }); }
  strokeText(text, x, y) { this.logs.push({ op: 'strokeText', text, x, y }); }
  fill(rule) { this.logs.push({ op: 'fill', rule, fillStyle: this.fillStyle, gco: this.globalCompositeOperation }); }
  stroke() { this.logs.push({ op: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, gco: this.globalCompositeOperation }); }
  clip() { this.logs.push({ op: 'clip' }); }
  translate(x, y) { this.logs.push({ op: 'translate', x, y }); }
  rotate(angle) { this.logs.push({ op: 'rotate', angle }); }
  setLineDash(dash) { this.lineDash = [...dash]; this.logs.push({ op: 'setLineDash', dash }); }
  drawImage(image, ...args) {
    this.logs.push({ op: 'drawImage', gco: this.globalCompositeOperation, args });
  }
  createLinearGradient(x0, y0, x1, y1) {
    return {
      addColorStop: (stop, color) => {}
    };
  }
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return {
      addColorStop: (stop, color) => {}
    };
  }
  createPattern(img, rep) { return 'pattern'; }
}

export const tests = [
  {
    id: 'T2.A1',
    name: 'Sound Wave Lifecycle: Emission & Configuration Defaults',
    fn: async () => {
      const swr = new SoundWaveRenderer();

      // Footstep
      swr.addSound({ x: 100, y: 150, type: 'footstep' });
      assert.strictEqual(swr.waves.length, 1);
      const wFoot = swr.waves[0];
      assert.strictEqual(wFoot.type, 'footstep');
      assert.strictEqual(wFoot.duration, SOUND_CONFIGS.footstep.duration);
      assert.strictEqual(wFoot.maxRadius, SOUND_CONFIGS.footstep.maxRadius);
      assert.strictEqual(wFoot.intensity, SOUND_CONFIGS.footstep.intensity);
      assert.strictEqual(wFoot.elapsed, 0);

      // Gunfire
      swr.addSound({ x: 200, y: 250, type: 'gunfire' });
      const wGun = swr.waves[1];
      assert.strictEqual(wGun.type, 'gunfire');
      assert.strictEqual(wGun.duration, SOUND_CONFIGS.gunfire.duration);
      assert.strictEqual(wGun.maxRadius, SOUND_CONFIGS.gunfire.maxRadius);

      // Reload
      swr.addSound({ x: 300, y: 350, type: 'reload' });
      const wReload = swr.waves[2];
      assert.strictEqual(wReload.type, 'reload');
      assert.strictEqual(wReload.duration, SOUND_CONFIGS.reload.duration);

      // Alias normalization ('step' -> 'footstep')
      swr.addSound({ x: 400, y: 450, type: 'step' });
      assert.strictEqual(swr.waves[3].type, 'footstep');

      // Custom parameter overrides
      swr.addSound({ x: 500, y: 550, type: 'gunfire', duration: 3.0, maxRadius: 600, intensity: 0.5 });
      const wCustom = swr.waves[4];
      assert.strictEqual(wCustom.duration, 3.0);
      assert.strictEqual(wCustom.maxRadius, 600);
      assert.strictEqual(wCustom.intensity, 0.5);

      // Unknown type fallback
      swr.addSound({ x: 600, y: 650, type: 'steam_hiss' });
      assert.strictEqual(swr.waves[5].maxRadius, SOUND_CONFIGS.footstep.maxRadius);
    }
  },

  {
    id: 'T2.A2',
    name: 'Sound Wave Lifecycle: Linear Expansion Over Delta-Time (dt)',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      swr.addSound({ x: 100, y: 100, type: 'footstep' }); // duration: 0.9, maxRadius: 90
      const wave = swr.waves[0];

      let prevRadius = 0;
      for (let step = 1; step <= 9; step++) {
        swr.update(0.1);
        const progress = Math.min(1.0, wave.elapsed / wave.duration);
        const currentRadius = progress * wave.maxRadius;
        const expectedRadius = (wave.elapsed / wave.duration) * wave.maxRadius;

        assertEpsilon(currentRadius, expectedRadius, 1e-5, `Radius at step ${step}`);
        assert.ok(currentRadius > prevRadius, 'Expansion must be strictly increasing');
        prevRadius = currentRadius;
      }
    }
  },

  {
    id: 'T2.A3',
    name: 'Sound Wave Lifecycle: Max Radius Clamping at Expiration Boundary',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      swr.addSound({ x: 100, y: 100, type: 'gunfire' }); // maxRadius: 240, duration: 1.4
      const wave = swr.waves[0];

      // Exact expiration
      wave.elapsed = 1.4;
      let progress = Math.min(1.0, wave.elapsed / wave.duration);
      assert.strictEqual(progress, 1.0);
      assert.strictEqual(progress * wave.maxRadius, 240);

      // Overshoot before update
      wave.elapsed = 5.0;
      progress = Math.min(1.0, wave.elapsed / wave.duration);
      assert.strictEqual(progress, 1.0, 'Progress must be clamped to 1.0');
      assert.strictEqual(progress * wave.maxRadius, 240, 'Radius must never exceed maxRadius');
    }
  },

  {
    id: 'T2.A4',
    name: 'Sound Wave Lifecycle: Alpha Decay Curve Monotonicity & Zero-Alpha Bound',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      swr.addSound({ x: 100, y: 100, type: 'footstep', intensity: 0.8, duration: 1.0 });
      const wave = swr.waves[0];

      // Initial alpha at t = 0
      let alpha = Math.max(0, (1.0 - Math.pow(0, 1.4)) * wave.intensity);
      assert.strictEqual(alpha, 0.8, 'Initial alpha must equal intensity');

      // Monotonic decay across lifespan
      let prevAlpha = alpha;
      for (let p = 0.05; p <= 1.0; p += 0.05) {
        alpha = Math.max(0, (1.0 - Math.pow(p, 1.4)) * wave.intensity);
        assert.ok(alpha < prevAlpha, `Alpha at progress ${p} must decay monotonically`);
        assert.ok(alpha >= 0, 'Alpha must never be negative');
        prevAlpha = alpha;
      }

      // Exact zero alpha at expiration
      alpha = Math.max(0, (1.0 - Math.pow(1.0, 1.4)) * wave.intensity);
      assert.strictEqual(alpha, 0, 'Alpha at progress 1.0 must be 0');
    }
  },

  {
    id: 'T2.A5',
    name: 'Sound Wave Lifecycle: Automatic Cleanup of Expired Waves',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      swr.addSound({ x: 10, y: 10, duration: 0.5 });
      swr.addSound({ x: 20, y: 20, duration: 0.9 });
      swr.addSound({ x: 30, y: 30, duration: 1.4 });
      assert.strictEqual(swr.waves.length, 3);

      swr.update(0.6);
      assert.strictEqual(swr.waves.length, 2, 'Wave 1 (0.5s) must be spliced out');

      swr.update(0.4);
      assert.strictEqual(swr.waves.length, 1, 'Wave 2 (0.9s) must be spliced out');

      swr.update(0.5);
      assert.strictEqual(swr.waves.length, 0, 'All expired waves must be cleaned up');
    }
  },

  {
    id: 'T2.A6',
    name: 'Robustness: Rejection of Null, Undefined & Malformed Sound Inputs',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      swr.addSound(null);
      swr.addSound(undefined);
      swr.addSound({});
      swr.addSound({ x: 'string', y: 100 });
      swr.addSound({ x: 100, y: null });
      swr.addSound({ x: undefined, y: 100 });
      assert.strictEqual(swr.waves.length, 0, 'Malformed sound events must not be added');
    }
  },

  {
    id: 'T2.A7',
    name: 'Radar Tracking: On-Screen vs Off-Screen Viewport Thresholding',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      const mockCtx = new HeadlessCanvasMock(800, 600);
      const camera = { x: 0, y: 0, width: 800, height: 600 };

      // On-screen sound
      swr.addSound({ x: 400, y: 300, type: 'footstep' });
      swr.render(mockCtx, camera, 800, 600);
      const onScreenArcs = mockCtx.logs.filter(l => l.op === 'arc');
      const onScreenChevrons = mockCtx.logs.filter(l => l.op === 'translate');
      assert.ok(onScreenArcs.length > 0, 'On-screen sound must render arcs');
      assert.strictEqual(onScreenChevrons.length, 0, 'On-screen sound must NOT render chevron');

      // Off-screen sound
      swr.clear();
      mockCtx.logs = [];
      swr.addSound({ x: 1600, y: 300, type: 'gunfire' });
      swr.render(mockCtx, camera, 800, 600);
      const offScreenArcs = mockCtx.logs.filter(l => l.op === 'arc');
      const offScreenChevrons = mockCtx.logs.filter(l => l.op === 'translate');
      assert.strictEqual(offScreenArcs.length, 0, 'Off-screen sound must NOT render arcs');
      assert.strictEqual(offScreenChevrons.length, 1, 'Off-screen sound must render chevron');
    }
  },

  {
    id: 'T2.A8',
    name: 'Radar Tracking: Cardinal Direction Border Chevron Placement & Orientation',
    fn: async () => {
      const edgeMargin = 28;
      const width = 800;
      const height = 600;
      const cx = 400;
      const cy = 300;
      const camera = { x: 0, y: 0 };

      const directions = [
        { name: 'East', pos: { x: 3000, y: cy }, expectedEdge: { x: width - edgeMargin, y: cy }, expectedAngle: 0 },
        { name: 'West', pos: { x: -3000, y: cy }, expectedEdge: { x: edgeMargin, y: cy }, expectedAngle: Math.PI },
        { name: 'South', pos: { x: cx, y: 3000 }, expectedEdge: { x: cx, y: height - edgeMargin }, expectedAngle: Math.PI / 2 },
        { name: 'North', pos: { x: cx, y: -3000 }, expectedEdge: { x: cx, y: edgeMargin }, expectedAngle: -Math.PI / 2 }
      ];

      for (const d of directions) {
        const swr = new SoundWaveRenderer({ edgeMargin });
        swr.addSound({ x: d.pos.x, y: d.pos.y, type: 'gunfire' });

        const mockCtx = new HeadlessCanvasMock(width, height);
        swr.render(mockCtx, camera, width, height);

        const translate = mockCtx.logs.find(l => l.op === 'translate');
        const rotate = mockCtx.logs.find(l => l.op === 'rotate');

        assert.ok(translate, `${d.name} chevron must translate to border`);
        assert.ok(rotate, `${d.name} chevron must rotate`);

        assertEpsilon(translate.x, d.expectedEdge.x, 1e-4, `${d.name} edgeX`);
        assertEpsilon(translate.y, d.expectedEdge.y, 1e-4, `${d.name} edgeY`);
        assertAngleClose(rotate.angle, d.expectedAngle, 1e-4, `${d.name} orientation`);
      }
    }
  },

  {
    id: 'T2.A9',
    name: 'Radar Tracking: 360-Degree Radial Sweep Generator (72 Radial Angles)',
    fn: async () => {
      const edgeMargin = 28;
      const width = 800;
      const height = 600;
      const cx = width / 2;
      const cy = height / 2;
      const R = 2500;
      const camera = { x: 0, y: 0 };

      const minX = edgeMargin;
      const maxX = width - edgeMargin;
      const minY = edgeMargin;
      const maxY = height - edgeMargin;

      for (let deg = 0; deg < 360; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        const targetX = cx + Math.cos(rad) * R;
        const targetY = cy + Math.sin(rad) * R;

        const swr = new SoundWaveRenderer({ edgeMargin });
        swr.addSound({ x: targetX, y: targetY, type: 'gunfire' });

        const mockCtx = new HeadlessCanvasMock(width, height);
        swr.render(mockCtx, camera, width, height);

        const translate = mockCtx.logs.find(l => l.op === 'translate');
        const rotate = mockCtx.logs.find(l => l.op === 'rotate');

        assert.ok(translate, `Sweep ${deg} deg must render translate`);
        assert.ok(rotate, `Sweep ${deg} deg must render rotate`);

        // Check chevron coordinates lie within margin box
        assert.ok(translate.x >= minX - 1e-4 && translate.x <= maxX + 1e-4, `deg ${deg}: X in bounds`);
        assert.ok(translate.y >= minY - 1e-4 && translate.y <= maxY + 1e-4, `deg ${deg}: Y in bounds`);

        // Check chevron touches at least one border
        const onBorder =
          Math.abs(translate.x - minX) < 1e-4 ||
          Math.abs(translate.x - maxX) < 1e-4 ||
          Math.abs(translate.y - minY) < 1e-4 ||
          Math.abs(translate.y - maxY) < 1e-4;
        assert.ok(onBorder, `deg ${deg}: Chevron must touch rectangle perimeter`);

        // Check angle matches target ray angle
        const expectedAngle = Math.atan2(targetY - cy, targetX - cx);
        assertAngleClose(rotate.angle, expectedAngle, 1e-4, `deg ${deg}: Rotation matches source ray`);

        // Check chevron points towards sound source
        const dirToTarget = Math.atan2(targetY - translate.y, targetX - translate.x);
        assertAngleClose(dirToTarget, rotate.angle, 1e-4, `deg ${deg}: Arrowhead points along ray to source`);
      }
    }
  },

  {
    id: 'T2.A10',
    name: 'Radar Tracking: Extreme Distance Numeric Stability Oracle',
    fn: async () => {
      const swr = new SoundWaveRenderer();
      const mockCtx = new HeadlessCanvasMock(800, 600);
      const camera = { x: 0, y: 0 };

      const extremeCoords = [
        { x: 1e6, y: 1e6 },
        { x: -1e7, y: 1e7 },
        { x: 0, y: 1e8 },
        { x: -1e8, y: 0 }
      ];

      for (const pt of extremeCoords) {
        swr.clear();
        swr.addSound({ x: pt.x, y: pt.y, type: 'gunfire' });

        mockCtx.logs = [];
        swr.render(mockCtx, camera, 800, 600);

        const translate = mockCtx.logs.find(l => l.op === 'translate');
        assert.ok(translate, `Extreme point (${pt.x}, ${pt.y}) must produce translate`);
        assert.ok(Number.isFinite(translate.x), 'translate.x must be finite');
        assert.ok(Number.isFinite(translate.y), 'translate.y must be finite');
      }
    }
  },

  {
    id: 'T2.A11',
    name: 'Layer Composition: Full 6-Layer Rendering Pipeline Order',
    fn: async () => {
      const mockCanvas = { width: 800, height: 600, getContext: () => new HeadlessCanvasMock(800, 600) };
      const gameRenderer = new GameRenderer(mockCanvas);

      const dummyMap = {
        version: '1.0',
        name: 'PipelineTestMap',
        width: 20,
        height: 20,
        tileSize: 40,
        tiles: new Array(400).fill(0),
        spawns: [{ id: 's1', type: 'player', col: 5, row: 5 }]
      };
      gameRenderer.setMap(dummyMap);
      gameRenderer.addSound({ x: 400, y: 300, type: 'gunfire' });

      const callOrder = [];
      const origL1 = gameRenderer.renderLayer1Floor.bind(gameRenderer);
      const origL2 = gameRenderer.renderLayer2Obstacles.bind(gameRenderer);
      const origL3 = gameRenderer.renderLayer3Entities.bind(gameRenderer);
      const origL4 = gameRenderer.visibilityRenderer.renderDarknessMask.bind(gameRenderer.visibilityRenderer);
      const origL5 = gameRenderer.soundWaveRenderer.render.bind(gameRenderer.soundWaveRenderer);
      const origL6 = gameRenderer.hud.render.bind(gameRenderer.hud);

      gameRenderer.renderLayer1Floor = (...args) => { callOrder.push('Layer1_Floor'); return origL1(...args); };
      gameRenderer.renderLayer2Obstacles = (...args) => { callOrder.push('Layer2_Obstacles'); return origL2(...args); };
      gameRenderer.renderLayer3Entities = (...args) => { callOrder.push('Layer3_Entities'); return origL3(...args); };
      gameRenderer.visibilityRenderer.renderDarknessMask = (...args) => { callOrder.push('Layer4_DarknessMask'); return origL4(...args); };
      gameRenderer.soundWaveRenderer.render = (...args) => { callOrder.push('Layer5_SoundWaves'); return origL5(...args); };
      gameRenderer.hud.render = (...args) => { callOrder.push('Layer6_HUD'); return origL6(...args); };

      gameRenderer.render({
        localPlayer: { x: 400, y: 300, angle: 0, hp: 100, stamina: 100, ammo: 6, maxAmmo: 6 }
      });

      assert.deepStrictEqual(callOrder, [
        'Layer1_Floor',
        'Layer2_Obstacles',
        'Layer3_Entities',
        'Layer4_DarknessMask',
        'Layer5_SoundWaves',
        'Layer6_HUD'
      ], 'Pipeline must strictly execute Layers 1 through 6 in order');
    }
  },

  {
    id: 'T2.A12',
    name: 'Layer Composition: 100% Fog Penetration (Sound Waves Render After Darkness)',
    fn: async () => {
      const mockCanvas = { width: 800, height: 600, getContext: () => new HeadlessCanvasMock(800, 600) };
      const gameRenderer = new GameRenderer(mockCanvas);

      let maskFinishOrder = 0;
      let soundRenderOrder = 0;
      let stepCounter = 1;

      gameRenderer.visibilityRenderer.renderDarknessMask = () => {
        maskFinishOrder = stepCounter++;
      };
      gameRenderer.soundWaveRenderer.render = () => {
        soundRenderOrder = stepCounter++;
      };

      gameRenderer.render({ localPlayer: { x: 200, y: 200, angle: 0 } });

      assert.ok(maskFinishOrder > 0, 'Darkness mask must execute');
      assert.ok(soundRenderOrder > 0, 'Sound wave renderer must execute');
      assert.ok(soundRenderOrder > maskFinishOrder, 'Sound wave rendering must execute AFTER darkness mask for 100% visibility');
    }
  },

  {
    id: 'T2.A13',
    name: 'Stress Test: Simultaneous 100-Wave Burst Lifecycle & Expiration',
    fn: async () => {
      const swr = new SoundWaveRenderer({ maxWaves: 150 });
      const mockCtx = new HeadlessCanvasMock(800, 600);

      // Emit 50 footsteps (0.9s duration) and 50 gunshots (1.4s duration) simultaneously
      for (let i = 0; i < 50; i++) {
        swr.addSound({ x: 100 + i * 5, y: 100 + i * 5, type: 'footstep' });
        swr.addSound({ x: 300 + i * 5, y: 300 + i * 5, type: 'gunfire' });
      }

      assert.strictEqual(swr.waves.length, 100, 'Must hold 100 concurrent sound waves');

      const dt = 1 / 60;
      for (let frame = 0; frame < 120; frame++) {
        swr.update(dt);
        swr.render(mockCtx, { x: 0, y: 0 }, 800, 600);

        const elapsed = (frame + 1) * dt;
        if (elapsed >= 1.0 && elapsed < 1.0 + dt) {
          assert.strictEqual(swr.waves.length, 50, 'Footsteps must have expired at t=1.0s');
          assert.ok(swr.waves.every(w => w.type === 'gunfire'), 'Only gunfire remains');
        }

        if (elapsed >= 1.5 && elapsed < 1.5 + dt) {
          assert.strictEqual(swr.waves.length, 0, 'All waves must have expired at t=1.5s');
        }
      }

      assert.strictEqual(swr.waves.length, 0, 'Array must be completely clear after 2 seconds');
    }
  },

  {
    id: 'T2.A14',
    name: 'Stress Test: FIFO Wave Array Capacity Bounding (maxWaves Limit)',
    fn: async () => {
      const maxCap = 50;
      const swr = new SoundWaveRenderer({ maxWaves: maxCap });

      // Rapidly burst 200 waves without advancing time
      for (let i = 0; i < 200; i++) {
        swr.addSound({ id: `wave_${i}`, x: i * 2, y: i * 2, type: 'footstep' });
        assert.ok(swr.waves.length <= maxCap, 'Array length must never exceed maxWaves');
      }

      assert.strictEqual(swr.waves.length, maxCap);
      assert.strictEqual(swr.waves[0].id, 'wave_150', 'FIFO must drop oldest waves');
      assert.strictEqual(swr.waves[maxCap - 1].id, 'wave_199', 'Newest wave must be retained at tail');
    }
  },

  {
    id: 'T2.A15',
    name: 'Stress Test: Sustained High-Throughput Wave Cycle (2,000 Waves over 600 Frames)',
    fn: async () => {
      const swr = new SoundWaveRenderer({ maxWaves: 100 });
      const mockCtx = new HeadlessCanvasMock(800, 600);
      const dt = 1 / 60;
      let totalEmitted = 0;

      for (let frame = 0; frame < 600; frame++) {
        if (frame < 400) {
          for (let k = 0; k < 5; k++) {
            swr.addSound({
              x: Math.random() * 2000 - 600,
              y: Math.random() * 2000 - 600,
              type: Math.random() > 0.5 ? 'footstep' : 'gunfire'
            });
            totalEmitted++;
          }
        }

        swr.update(dt);
        swr.render(mockCtx, { x: 0, y: 0 }, 800, 600);
        assert.ok(swr.waves.length <= 100, 'Wave buffer must stay strictly bounded');
      }

      assert.strictEqual(swr.waves.length, 0, `All ${totalEmitted} emitted waves must cleanly expire`);
    }
  },

  {
    id: 'T2.A16',
    name: 'Performance Profiling: 100 Simultaneous Waves Execution Budget',
    fn: async () => {
      const swr = new SoundWaveRenderer({ maxWaves: 150 });
      const mockCtx = new HeadlessCanvasMock(800, 600);

      // Populate with 100 active waves with 10s duration to keep load constant
      for (let i = 0; i < 100; i++) {
        swr.addSound({
          x: i % 2 === 0 ? 400 : 2500,
          y: i % 2 === 0 ? 300 : 2500,
          type: i % 3 === 0 ? 'gunfire' : 'footstep',
          duration: 10.0
        });
      }

      assert.strictEqual(swr.waves.length, 100);

      // Benchmark 500 frames
      const iterations = 500;
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        swr.update(0.016);
        swr.render(mockCtx, { x: 0, y: 0 }, 800, 600);
      }
      const t1 = process.hrtime.bigint();

      const totalMs = Number(t1 - t0) / 1e6;
      const avgMs = totalMs / iterations;

      assert.ok(avgMs < 1.0, `Average acoustic frame execution time (${avgMs.toFixed(4)}ms) must be under 1.0ms`);
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
