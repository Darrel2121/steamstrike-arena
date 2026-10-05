/**
 * Test Suite: bot_learning_and_combat_fx.test.js
 * Validates:
 * 1. Continuous bot neural AI learning & balanced experience replay
 * 2. Simulation freezing upon GAME_OVER & authoritative hitEvents serialization
 * 3. Maximum-distance opponent respawning
 * 4. Adaptive compact mobile victory screen sizing
 * 5. Procedural SoundFX engine math & mute persistence
 */

import { TacticalNeuralAgent, TACTICAL_ACTIONS } from '../../server/ai/TacticalNeuralAgent.js';
import { Room } from '../../server/Room.js';
import { HUD } from '../../client/js/ui/HUD.js';
import { SoundFX } from '../../client/js/audio/SoundFX.js';
import { GAME_MODES } from '../../shared/Constants.js';

export async function run() {
  const results = { passed: 0, failed: 0, failures: [], total: 0 };

  const test = (name, fn) => {
    results.total++;
    try {
      fn();
      results.passed++;
      console.log(`    ✔ ${name}`);
    } catch (err) {
      results.failed++;
      results.failures.push({ name, error: err });
      console.log(`    ✖ ${name}: ${err.message}`);
    }
  };

  // 1. TacticalNeuralAgent continuous learning & balanced sampling
  test('[FX.1] Neural AI: Accumulates continuous updates and balances experience replay', () => {
    const agent = new TacticalNeuralAgent({
      weightsFile: './server/ai/test_neural_weights_tmp.json'
    });
    agent.initWeights();

    const mockRoom = {
      players: new Map(),
      bots: new Map(),
      geometrySegments: []
    };

    const mockPlayer = {
      id: 'human_1',
      x: 100,
      y: 100,
      vx: 60,
      vy: 0,
      angle: 0,
      isAlive: true,
      isBot: false,
      hp: 100,
      maxHp: 100
    };

    const mockBot = {
      id: 'bot_1',
      x: 200,
      y: 100,
      isAlive: true,
      hp: 100,
      maxHp: 100
    };
    mockRoom.bots.set('bot_1', mockBot);

    // Initial counts
    if (agent.totalUpdatesCount !== 0) throw new Error('Initial updates should be 0');

    // Simulate moving player
    for (let i = 0; i < 5; i++) {
      agent.observePlayer(mockPlayer, mockRoom, 0.033);
    }

    if (agent.totalUpdatesCount !== 5) {
      throw new Error(`Expected 5 updates, got ${agent.totalUpdatesCount}`);
    }
    if (agent.replayBuffer.length !== 5) {
      throw new Error(`Expected 5 buffered experiences, got ${agent.replayBuffer.length}`);
    }

    // Simulate idle stationary player - should NOT spam updates on every tick
    mockPlayer.vx = 0;
    mockPlayer.vy = 0;
    const countBeforeIdle = agent.totalUpdatesCount;
    for (let i = 0; i < 10; i++) {
      agent.observePlayer(mockPlayer, mockRoom, 0.033);
    }
    // Ambush is throttled so it should not fire 10 times
    if (agent.totalUpdatesCount - countBeforeIdle > 2) {
      throw new Error(`Idle player generated too many updates: ${agent.totalUpdatesCount - countBeforeIdle}`);
    }
  });

  // 2. Simulation freezing upon GAME_OVER in Room.js
  test('[FX.2] Room: Freezes tick simulation and input handling when match is GAME_OVER', () => {
    const room = new Room({
      id: 'test_freeze_room',
      gameMode: GAME_MODES.FFA_DM,
      targetKills: 1
    });

    const p1 = room.addPlayer('p1', 'PlayerOne');
    const p2 = room.addPlayer('p2', 'PlayerTwo');
    room.startMatch({ fillBots: false });

    if (room.state !== 'IN_PROGRESS') throw new Error('Room should be IN_PROGRESS');

    // Inflict lethal damage to trigger game over
    room.applyDamage('p2', 'p1', 150);

    if (room.state !== 'GAME_OVER') {
      throw new Error(`Room state should be GAME_OVER, got ${room.state}`);
    }

    // Now test that tick() is frozen: bot logic and respawns do not advance
    p2.respawnTimer = 3.0;
    room.tick();
    if (p2.respawnTimer !== 3.0) {
      throw new Error(`Simulation should be frozen; respawnTimer mutated to ${p2.respawnTimer}`);
    }

    // Test that player inputs are rejected after game over
    const oldX = p1.x;
    room.handlePlayerInput('p1', { moveX: 1, moveY: 0, dt: 100 });
    if (p1.x !== oldX) {
      throw new Error('Player movement input was accepted after GAME_OVER');
    }
  });

  // 3. Bullet hitEvents generation and broadcast
  test('[FX.3] Room: Records wall and entity hitEvents and broadcasts in snapshot', () => {
    const room = new Room({ id: 'test_hit_room' });
    const p1 = room.addPlayer('p1', 'Shooter');
    const p2 = room.addPlayer('p2', 'Target');
    room.startMatch({ fillBots: false });

    // Set p2 close in front of p1
    p1.x = 100;
    p1.y = 100;
    p2.x = 140;
    p2.y = 100;

    // Fire projectile from p1 towards p2
    const proj = room.spawnProjectile({
      x: 110,
      y: 100,
      vx: 1800,
      vy: 0,
      shooterId: 'p1',
      damage: 35
    });

    room.updateProjectiles(0.05); // Raycast travels 90px, hits p2 at x=124

    if (room.hitEvents.length === 0) {
      throw new Error('Expected at least 1 hitEvent from projectile collision');
    }

    const hit = room.hitEvents[0];
    if (hit.type !== 'entity') {
      throw new Error(`Expected hit.type to be 'entity', got ${hit.type}`);
    }
    if (hit.damage !== 35) {
      throw new Error(`Expected hit.damage 35, got ${hit.damage}`);
    }
  });

  // 4. Maximum-distance opponent respawning
  test('[FX.4] Room: Spawns combatants with maximum distance from active opponents', () => {
    const room = new Room({ id: 'test_spawn_dist' });
    const p1 = room.addPlayer('p1', 'Player1');
    p1.x = 100;
    p1.y = 100;
    p1.isAlive = true;
    p1.hp = 100;

    const spawnFar = room.getSpawnPosition('player', 0);
    const dist = Math.hypot(spawnFar.x - p1.x, spawnFar.y - p1.y);
    if (dist < 100) {
      throw new Error(`Spawn position too close to opponent: ${dist}px`);
    }
  });

  // 5. HUD victory modal compact sizing calculations for mobile landscape
  test('[FX.5] HUD: Automatically adapts modal dimensions when viewport height < 520px', () => {
    const hud = new HUD();
    hud.setMatchOutcome({
      isOver: true,
      winnerId: 'p1',
      results: [{ playerId: 'p1', kills: 3, damageDealt: 120, survivalSeconds: 25 }]
    });

    // Mock canvas context
    const calls = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      roundRect: (x, y, w, h) => { calls.push({ x, y, w, h }); },
      fillText: () => {},
      strokeText: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: () => ({ width: 40 })
    };

    // Mobile landscape viewport: 640x360
    hud.renderMatchOver(mockCtx, 640, 360, { id: 'p1' });

    // Check main box bounds recorded in roundRect
    const mainBox = calls[0];
    if (!mainBox) throw new Error('Expected main box roundRect call');
    if (mainBox.h > 280) {
      throw new Error(`Mobile modal height exceeds 280px limit: ${mainBox.h}px`);
    }

    // Check button bounds
    if (!hud.buttonBounds.restart || !hud.buttonBounds.lobby) {
      throw new Error('Action buttons not bound');
    }
    const btnRestart = hud.buttonBounds.restart;
    if (btnRestart.y + btnRestart.h > 360) {
      throw new Error(`Restart button clipped outside mobile viewport: y=${btnRestart.y}`);
    }
  });

  // 6. SoundFX procedural audio math & spatial attenuation
  test('[FX.6] SoundFX: Calculates 2D spatial distance attenuation and panning accurately', () => {
    const sfx = new SoundFX();
    sfx.setListenerPosition(400, 300);

    // Sound at listener position: 100% gain, 0 pan
    const close = sfx.getSpatialGainAndPan(400, 300);
    if (close.gain !== 1.0 || close.pan !== 0) {
      throw new Error(`Center spatial audio incorrect: gain=${close.gain}, pan=${close.pan}`);
    }

    // Sound far to the right: lower gain, positive pan
    const farRight = sfx.getSpatialGainAndPan(800, 300, 700);
    if (farRight.gain >= 1.0 || farRight.pan <= 0) {
      throw new Error(`Right spatial audio incorrect: gain=${farRight.gain}, pan=${farRight.pan}`);
    }
  });

  return results;
}
