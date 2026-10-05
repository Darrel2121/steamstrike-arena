import assert from 'node:assert/strict';
import { HUD } from '../client/js/ui/HUD.js';
import { GameRenderer } from '../client/js/rendering/GameRenderer.js';
import { Room } from '../server/Room.js';
import { createDefaultMap } from '../shared/MapSchema.js';

// Minimal canvas mock context for headless testing
function createMockCanvas(width = 800, height = 600) {
  const calls = [];
  const ctx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x, y) => calls.push(`translate(${x},${y})`),
    rotate: (a) => calls.push(`rotate(${a})`),
    scale: (sx, sy) => calls.push(`scale(${sx},${sy})`),
    clearRect: () => calls.push('clearRect'),
    fillRect: (x, y, w, h) => calls.push(`fillRect(${x},${y},${w},${h})`),
    strokeRect: (x, y, w, h) => calls.push(`strokeRect(${x},${y},${w},${h})`),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: (x, y) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x, y) => calls.push(`lineTo(${x},${y})`),
    arc: (x, y, r, sa, ea) => calls.push(`arc(${x},${y},${r})`),
    ellipse: (x, y, rx, ry) => calls.push(`ellipse(${x},${y},${rx},${ry})`),
    rect: (x, y, w, h) => calls.push(`rect(${x},${y},${w},${h})`),
    roundRect: (x, y, w, h, r) => calls.push(`roundRect(${x},${y},${w},${h},${r})`),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillText: (text, x, y) => calls.push(`fillText("${text}",${x},${y})`),
    measureText: (text) => ({ width: (text || '').length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    clip: () => {}
  };

  return {
    width,
    height,
    getContext: () => ctx,
    calls
  };
}

console.log('--- TEST 1: HUD In-Canvas Notifications & Alpha Fade ---');
{
  const hud = new HUD();
  hud.addMessage('⚡ Ворога ліквідовано!', { type: 'kill', color: '#ffcf48', duration: 3.0 });
  assert.equal(hud.notifications.length, 1, 'Notification should be added to queue');
  assert.equal(hud.notifications[0].text, '⚡ Ворога ліквідовано!');
  assert.equal(hud.notifications[0].type, 'kill');

  // Update dt=0.1s -> Alpha should fade in
  hud.update(0.1);
  assert.ok(hud.notifications[0].alpha > 0, 'Alpha should be > 0 during fade-in');

  // Update dt=0.2s -> Alpha should reach 1.0
  hud.update(0.2);
  assert.equal(hud.notifications[0].alpha, 1.0, 'Alpha should be 1.0 during active display');

  // Render on mock canvas
  const canvas = createMockCanvas(800, 600);
  hud.render(canvas.getContext(), { hp: 100, maxHp: 100, stamina: 100, ammo: 6, maxAmmo: 6 }, 800, 600);
  const hasTextCall = canvas.calls.some(c => c.includes('⚡ Ворога ліквідовано!'));
  assert.ok(hasTextCall, 'Canvas must render notification text directly inside canvas context');
  console.log('✔ HUD In-Canvas notifications render directly to canvas context with alpha fading');
}

console.log('--- TEST 2: HUD In-Canvas Match Outcome & Button Hit Testing ---');
{
  const hud = new HUD();
  const outcome = {
    isOver: true,
    winnerId: 'player_hero',
    draw: false,
    results: [
      {
        playerId: 'player_hero',
        kills: 3,
        damageDealt: 280,
        survivalSeconds: 42,
        xpEarned: 200,
        scrapEarned: 100,
        coresEarned: 1
      }
    ]
  };

  hud.setMatchOutcome(outcome);
  const canvas = createMockCanvas(800, 600);
  hud.render(canvas.getContext(), { id: 'player_hero', hp: 80, maxHp: 100 }, 800, 600);

  // Check victory banner rendered on canvas
  const hasVictoryText = canvas.calls.some(c => c.includes('★ ПЕРЕМОГА: ВИ ВИЖИЛИ! ★'));
  assert.ok(hasVictoryText, 'Canvas must render victory header directly on canvas');

  // Check button bounds registered
  assert.ok(hud.buttonBounds.restart, 'Button bounds for restart must be defined');
  assert.ok(hud.buttonBounds.lobby, 'Button bounds for lobby must be defined');

  // Test button click collision
  const rBtn = hud.buttonBounds.restart;
  const lBtn = hud.buttonBounds.lobby;

  assert.equal(hud.checkButtonClick(rBtn.x + rBtn.w / 2, rBtn.y + rBtn.h / 2), 'restart');
  assert.equal(hud.checkButtonClick(lBtn.x + lBtn.w / 2, lBtn.y + lBtn.h / 2), 'lobby');
  assert.equal(hud.checkButtonClick(10, 10), null);
  console.log('✔ HUD In-Canvas Match Over modal renders with statistics, rewards and click detection');
}

console.log('--- TEST 3: Destroyed Enemy Halting, Persistence & Decommissioned Avatar Rendering ---');
{
  const canvas = createMockCanvas(800, 600);
  const renderer = new GameRenderer(canvas);

  const botEntity = {
    id: 'bot_1',
    name: 'Automaton_1',
    x: 350,
    y: 280,
    angle: 1.2,
    hp: 0,
    isAlive: false,
    isBot: true
  };

  // Render state with destroyed bot
  renderer.render({
    localPlayer: { id: 'player_1', x: 200, y: 200, hp: 100, isAlive: true },
    players: [
      { id: 'player_1', x: 200, y: 200, hp: 100, isAlive: true },
      botEntity
    ],
    projectiles: [],
    soundEvents: []
  });

  // Verify wrecked entity is registered
  assert.ok(renderer.wreckedEntities.has('bot_1'), 'Destroyed bot must be registered in wreckedEntities');
  const wreck = renderer.wreckedEntities.get('bot_1');
  assert.equal(wreck.x, 350, 'Wreck X position must be frozen at death coordinate');
  assert.equal(wreck.y, 280, 'Wreck Y position must be frozen at death coordinate');

  // Verify that subsequent render WITHOUT botEntity in snapshot still renders the wreck (never vanishes)
  canvas.calls.length = 0;
  renderer.render({
    localPlayer: { id: 'player_1', x: 200, y: 200, hp: 100, isAlive: true },
    players: [
      { id: 'player_1', x: 200, y: 200, hp: 100, isAlive: true }
    ],
    projectiles: [],
    soundEvents: []
  });

  const hasDestroyedTag = canvas.calls.some(c => c.includes('☠ Automaton_1 (Знищено)'));
  assert.ok(hasDestroyedTag, 'Fallen automaton must remain permanently rendered on arena floor even if missing from snapshot');
  console.log('✔ Eliminated enemy is halted in place, never disappears, and renders as decommissioned wreck');
}

console.log('--- TEST 4: Authoritative Server Room Match Flow & Snapshot Persistence ---');
{
  const map = createDefaultMap();
  const room = new Room({ id: 'test_wreck_room', map, maxPlayers: 2, autoFillBots: true });
  room.addPlayer('player_hero', { name: 'HeroMechanic', isHost: true });
  room.startMatch({ fillBots: true });

  assert.equal(room.bots.size, 1, 'Room should have 1 bot');
  const [bot] = room.bots.values();
  const initialBotX = bot.x;
  const initialBotY = bot.y;

  // Apply fatal damage
  room.applyDamage(bot.id, 'player_hero', 100);
  assert.equal(bot.hp, 0, 'Bot HP must be 0');
  assert.equal(bot.isAlive, false, 'Bot isAlive must be false');
  assert.equal(bot.x, initialBotX, 'Bot X position must halt upon elimination');
  assert.equal(bot.y, initialBotY, 'Bot Y position must halt upon elimination');

  // Bot update should not move bot when dead
  bot.update(0.1, room);
  assert.equal(bot.x, initialBotX, 'Dead bot must not move during update');
  assert.equal(bot.y, initialBotY, 'Dead bot must not move during update');

  // Verify match outcome evaluated cleanly
  assert.equal(room.state, 'GAME_OVER', 'Match should evaluate to GAME_OVER');
  console.log('✔ Authoritative server halts destroyed bot, marks isAlive=false, and evaluates outcome');
}

console.log('\nAll in-canvas message and persistent wrecked enemy tests passed with 100% success!');
