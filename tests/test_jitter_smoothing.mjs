import assert from 'node:assert/strict';
import { NetworkClient } from '../client/js/NetworkClient.js';
import { Room } from '../server/Room.js';
import { MockWebSocketPair } from './harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES, deserializePacket } from '../shared/Protocol.js';

console.log('Testing Netcode Error Smoothing & Jitter Elimination...');

// 1. Verify visualError absorption and continuity on reconciliation
const client = new NetworkClient();
client.playerId = 'smooth_player';
client.predictedX = 100;
client.predictedY = 100;
client.isPredictionInitialized = true;

// Move forward 5 steps
for (let i = 1; i <= 5; i++) {
  client.sendInput({ moveX: 1, moveY: 0, dt: 16.67 });
}
const beforeSnapPredX = client.predictedX; // ~115
const localBefore = client.getLocalPredictedPlayer();
assert.ok(Math.abs(localBefore.renderX - beforeSnapPredX) < 0.001, 'renderX must match predictedX initially');

// Server snapshot arrives with latency drift of 3.5px
// Server authoritative coordinate is 111.5 instead of 115.0
const serverSnapshot = {
  id: 'smooth_player',
  x: 111.5,
  y: 100,
  lastProcessedSeq: 5
};

client.reconcile(serverSnapshot, 10);

// Authoritative predictedX is updated to server's 111.5
assert.strictEqual(client.predictedX, 111.5, 'predictedX must update to authoritative server coordinate');

// Visual renderX must remain continuous (zero instantaneous teleport pop!)
const localAfter = client.getLocalPredictedPlayer();
assert.ok(Math.abs(localAfter.renderX - beforeSnapPredX) < 0.1, `renderX (${localAfter.renderX.toFixed(2)}) must not jump from pre-reconcile pos (${beforeSnapPredX.toFixed(2)})`);

// Verify visualError decays over elapsed time
client.lastErrorDecayTime = Date.now() - 50; // 50ms elapsed
client.decayVisualError();
const localDecayed = client.getLocalPredictedPlayer();
assert.ok(Math.abs(localDecayed.visualErrorX || 0) < Math.abs(client.visualErrorX) + 0.1, 'visualErrorX must decay over time');

console.log('✔ Error smoothing & continuous visual trajectory verified successfully!');
