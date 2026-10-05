import assert from 'node:assert/strict';
import { Room } from '../server/Room.js';
import { canonicalFoundryMap } from './fixtures/maps.fixture.js';
import { MockWebSocketPair } from './harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from './fixtures/protocol.fixture.js';

async function testBulletSpeedAndLanterns() {
  console.log('--- Starting Live Room Bullet Speed & Multi-Lantern Test ---');

  const room = new Room({ id: 'lantern_test_chamber', map: canonicalFoundryMap, maxPlayers: 4 });
  const pair1 = new MockWebSocketPair();
  const pair2 = new MockWebSocketPair();
  const serverWs1 = pair1.serverSide;
  const serverWs2 = pair2.serverSide;

  // Add 2 players
  const p1 = room.addPlayer('p1', 'Player One', serverWs1, { team: 'blue' });
  const p2 = room.addPlayer('p2', 'Player Two', serverWs2, { team: 'red' });

  // Equip different weapons
  p1.setWeapon('revolver');
  p2.setWeapon('steam_carbine');

  room.startMatch();

  // Verify initial player lantern states
  assert.strictEqual(p1.lanternOn, true, 'Player 1 lantern should be active by default');
  assert.strictEqual(p2.lanternOn, true, 'Player 2 lantern should be active by default');

  // Player 1 fires revolver
  const p1Pos = { x: p1.x, y: p1.y };
  room.handlePlayerInput('p1', { firing: true, aimAngle: 0, seq: 1 });

  assert.ok(room.projectiles.length >= 1, 'Room should have registered a projectile fired by p1');
  const bullet1 = room.projectiles[0];
  const b1Speed = Math.hypot(bullet1.vx, bullet1.vy);
  console.log(`P1 Revolver Bullet Speed: ${b1Speed.toFixed(1)} px/s`);
  assert.ok(b1Speed >= 1800, `Revolver bullet speed must be >= 1800 px/s, got ${b1Speed}`);

  // Player 2 fires steam carbine
  room.handlePlayerInput('p2', { firing: true, aimAngle: Math.PI / 2, seq: 1 });
  const bullet2 = room.projectiles[room.projectiles.length - 1];
  const b2Speed = Math.hypot(bullet2.vx, bullet2.vy);
  console.log(`P2 Steam Carbine Bullet Speed: ${b2Speed.toFixed(1)} px/s`);
  assert.ok(b2Speed >= 2099.9, `Carbine bullet speed must be >= 2100 px/s, got ${b2Speed}`);

  // Advance simulation
  for (let i = 0; i < 3; i++) {
    room.tick();
  }
  await new Promise(r => setTimeout(r, 20));

  // Check state snapshot received by client 1
  const snapshotMsgs = pair1.clientSide.messageHistory
    .map(m => {
      try {
        return typeof m === 'string' ? JSON.parse(m) : m;
      } catch (_) {
        return m;
      }
    })
    .filter(m => m && m.type === PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT);
  assert.ok(snapshotMsgs.length >= 1, 'Client 1 must have received at least one world snapshot');

  const latestSnapshot = snapshotMsgs[snapshotMsgs.length - 1].payload;
  assert.ok(latestSnapshot.players.length >= 2, 'Snapshot should include both players');

  const snapOther = latestSnapshot.players.find(p => p.id === 'p2');
  assert.ok(snapOther, 'Snapshot must contain player 2');
  assert.strictEqual(snapOther.lanternOn, true, 'Snapshot must transmit lantern status for other players');

  console.log('Snapshot verified: other combatants lanternOn transmitted cleanly.');
  console.log('--- ALL TESTS PASSED FOR BULLET SPEED & MULTI-LANTERN ---');
  room.stopLoop();
}

testBulletSpeedAndLanterns().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
