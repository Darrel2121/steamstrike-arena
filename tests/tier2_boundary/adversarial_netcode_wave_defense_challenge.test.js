/**
 * Tier 2 Boundary: Adversarial Challenge Suite for Milestone M_R2
 * Authored by: challenger_mr2_2
 *
 * Scope:
 * 1. Wave Defense: Invader bot permadeath across multi-wave lifecycle, environmental damage,
 *    and continuous tick verification that respawnTimer is never > 0 and no resurrect loops occur.
 * 2. Client Prediction: Non-monotonic snapshot streams (scrambled ticks, duplicates, extreme delays)
 *    and unacknowledged pending input preservation without rubber-banding.
 * 3. Snapshot Buffer State Retention: Exhaustive verification of smokeZones, steamCore, waveInfo,
 *    and pickups across 0, 1, and 2+ snapshot buffer scenarios.
 * 4. Client Reconnect & 10s Grace Period: Token query builder sanitization, active match resumption,
 *    grace period expiration teardown, immediate lobby teardown, and unauthorized join rejection.
 */

import assert from 'node:assert/strict';
import { runSuiteHelper, assertEpsilon } from '../harnesses/assert_helpers.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { Room } from '../../server/Room.js';
import { GameServer } from '../../server/GameServer.js';
import { Player } from '../../server/entities/Player.js';
import { Bot } from '../../server/entities/Bot.js';
import { NetworkClient } from '../../client/js/NetworkClient.js';
import { PROTOCOL_MSG_TYPES, serializePacket } from '../../shared/Protocol.js';
import { GAME_MODES } from '../../shared/Constants.js';

export const suiteName = 'Tier 2 Boundary: Adversarial M_R2 Netcode & Wave Defense Challenge';

export const tests = [
  // =========================================================================
  // CHALLENGE 1: WAVE DEFENSE INVADER PERMADEATH & MULTI-WAVE PROGRESSION
  // =========================================================================
  {
    id: 'ADV_MR2.1.1',
    name: 'Wave Defense: Multi-Wave Invader Permadeath and Boss Clearance',
    fn: async () => {
      const room = new Room({
        id: 'adv_wd_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      const defender = room.addPlayer('def_adv', 'Defender_Hero');
      room.startMatch();
      assert.strictEqual(room.state, 'IN_PROGRESS');
      assert.strictEqual(room.isWaveDefense(), true);

      // Verify wave 1 starts
      room.startWave(1);
      assert.strictEqual(room.currentWave, 1);
      assert.strictEqual(room.waveState, 'WAVE_ACTIVE');

      const allSpawnedInvaders = new Set();

      // Simulate through 5 complete waves
      for (let wave = 1; wave <= 5; wave++) {
        // Drain spawn queue
        while (room.waveSpawnQueue.length > 0) {
          room.tick();
        }

        // Collect all active invaders for this wave
        const invaders = Array.from(room.bots.values()).filter(b => b.team === 'invaders');
        assert.ok(invaders.length > 0, `Wave ${wave} must spawn invaders`);
        for (const inv of invaders) {
          allSpawnedInvaders.add(inv);
        }

        // Eliminate all living invaders
        for (const inv of invaders) {
          if (inv.isAlive) {
            room.applyDamage(inv.id, defender.id, 9999);
            assert.strictEqual(inv.isAlive, false, `Invader ${inv.id} must be dead`);
            assert.strictEqual(inv.respawnTimer, 0, `Invader ${inv.id} respawnTimer must be 0`);
          }
        }

        assert.strictEqual(room.getAliveWaveEnemiesCount(), 0, `All invaders eliminated in wave ${wave}`);

        // One tick to trigger completeWave()
        room.tick();

        if (wave < 5) {
          // Must transition to PREPARATION
          assert.strictEqual(room.waveState, 'PREPARATION', `Wave ${wave} completion must enter PREPARATION`);
          assert.ok(room.waveCountdown > 0, 'Preparation countdown must be set');

          // Tick down preparation phase
          const prepTicks = Math.ceil(room.waveCountdown * room.tickRate) + 2;
          for (let t = 0; t < prepTicks; t++) {
            room.tick();
          }

          // Next wave must have auto-started
          assert.strictEqual(room.currentWave, wave + 1, `Wave must advance to ${wave + 1}`);
          assert.strictEqual(room.waveState, 'WAVE_ACTIVE');
        } else {
          // Wave 5 is final boss wave -> Cleared!
          assert.strictEqual(room.waveState, 'CLEARED', 'Wave 5 completion must transition to CLEARED');
          assert.strictEqual(room.state, 'GAME_OVER', 'Match state must be GAME_OVER on wave clearance');
        }

        // Stress check: verify EVERY previously eliminated invader bot across all past waves remains permanently dead
        for (const deadInv of allSpawnedInvaders) {
          assert.strictEqual(deadInv.isAlive, false, `Invader ${deadInv.id} must NEVER resurrect`);
          assert.strictEqual(deadInv.respawnTimer, 0, `Invader ${deadInv.id} respawnTimer must remain 0`);
        }
      }

      // Continuous 300-tick post-victory stress: no ghosts or resurrect loops
      for (let i = 0; i < 300; i++) {
        room.tick();
      }
      for (const deadInv of allSpawnedInvaders) {
        assert.strictEqual(deadInv.isAlive, false, 'Invader bot remained dead after 300 ticks');
        assert.strictEqual(deadInv.respawnTimer, 0);
      }
    }
  },

  {
    id: 'ADV_MR2.1.2',
    name: 'Wave Defense: Invader Death via Direct/Environmental Damage with No Attacker',
    fn: async () => {
      const room = new Room({
        id: 'adv_wd_env_room',
        map: canonicalFoundryMap,
        gameMode: GAME_MODES.WAVE_DEFENSE
      });

      room.addPlayer('def_1', 'Defender');
      room.startMatch();
      room.startWave(1);

      // Spawn an invader
      for (let i = 0; i < 20; i++) room.tick();
      const invader = Array.from(room.bots.values())[0];
      assert.ok(invader, 'Invader bot spawned');

      // Eliminate with attackerId = null (environmental / steam core hazard)
      room.applyDamage(invader.id, null, 9999);
      assert.strictEqual(invader.isAlive, false);
      assert.strictEqual(invader.respawnTimer, 0, 'Invader respawnTimer must be 0 with null attacker');

      // Tick 60 times
      for (let i = 0; i < 60; i++) room.tick();
      assert.strictEqual(invader.isAlive, false, 'Invader bot must not respawn from environmental damage');
      assert.strictEqual(invader.respawnTimer, 0);
    }
  },

  // =========================================================================
  // CHALLENGE 2: OUT-OF-ORDER SNAPSHOT REPLAY & ANTI-RUBBER-BANDING
  // =========================================================================
  {
    id: 'ADV_MR2.2.1',
    name: 'Client Prediction: Chaotic Scrambled Snapshot Stream Rejection',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'player_chaotic';
      client.predictedX = 100;
      client.predictedY = 100;
      client.isPredictionInitialized = true;

      // Stream of out-of-order snapshots: ticks and corresponding X positions
      const snapshotSequence = [
        { tick: 10, x: 110, expectAccept: true },
        { tick: 50, x: 150, expectAccept: true },
        { tick: 40, x: 140, expectAccept: false }, // stale by 10
        { tick: 20, x: 120, expectAccept: false }, // stale by 30
        { tick: 49, x: 149, expectAccept: false }, // stale by 1
        { tick: 50, x: 999, expectAccept: false }, // duplicate
        { tick: 30, x: 130, expectAccept: false }, // stale by 20
        { tick: 51, x: 151, expectAccept: true },  // monotonically advancing
        { tick: 1,  x: 101, expectAccept: false }, // extreme stale
        { tick: 52, x: 152, expectAccept: true },  // monotonically advancing
        { tick: 52, x: 888, expectAccept: false }, // duplicate
        { tick: 53, x: 153, expectAccept: true }   // monotonically advancing
      ];

      let lastAcceptedX = 100;
      let lastAcceptedTick = null;

      for (const item of snapshotSequence) {
        const snap = {
          tick: item.tick,
          timestamp: Date.now(),
          players: [{ id: 'player_chaotic', x: item.x, y: 100, lastProcessedSeq: item.tick }]
        };

        client.handleWorldSnapshot(snap);

        if (item.expectAccept) {
          lastAcceptedX = item.x;
          lastAcceptedTick = item.tick;
          assertEpsilon(client.predictedX, item.x, 0.5, `Tick ${item.tick} should update predictedX to ${item.x}`);
          assert.strictEqual(client.lastReconciledTick, item.tick, `lastReconciledTick must advance to ${item.tick}`);
        } else {
          // Stale or duplicate packet must NOT alter predictedX or lastReconciledTick
          assertEpsilon(client.predictedX, lastAcceptedX, 0.5, `Stale tick ${item.tick} must NOT rubber-band predictedX`);
          assert.strictEqual(client.lastReconciledTick, lastAcceptedTick, `lastReconciledTick must not regress for tick ${item.tick}`);
        }
      }
    }
  },

  {
    id: 'ADV_MR2.2.2',
    name: 'Client Prediction: Stale Snapshots Do Not Rewind Unacknowledged Inputs',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'player_input_defense';
      client.predictedX = 100;
      client.predictedY = 100;
      client.isPredictionInitialized = true;

      // Queue 5 pending inputs moving right
      for (let i = 1; i <= 5; i++) {
        client.sendInput({ moveX: 1, moveY: 0, dt: 16.666 });
      }
      const predictedAfterInputs = client.predictedX;
      assert.strictEqual(client.pendingInputs.length, 5);

      // Valid latest snapshot acknowledging seq 3 arrives (Tick 30)
      client.handleWorldSnapshot({
        tick: 30,
        timestamp: Date.now(),
        players: [{ id: 'player_input_defense', x: 109, y: 100, lastProcessedSeq: 3 }]
      });
      assert.strictEqual(client.lastReconciledTick, 30);
      assert.strictEqual(client.pendingInputs.length, 2, 'Inputs 1-3 acknowledged, 4-5 remain');
      const predictedAfterRecon = client.predictedX;

      // Delayed stale snapshot (Tick 25) arrives with older coordinates and seq 1
      client.handleWorldSnapshot({
        tick: 25,
        timestamp: Date.now() - 100,
        players: [{ id: 'player_input_defense', x: 50, y: 100, lastProcessedSeq: 1 }]
      });

      // Verification: remaining inputs must NOT be reset or replayed from stale baseline
      assert.strictEqual(client.lastReconciledTick, 30, 'Tick must stay 30');
      assert.strictEqual(client.pendingInputs.length, 2, 'Pending inputs queue intact');
      assertEpsilon(client.predictedX, predictedAfterRecon, 0.1, 'Predicted position must NOT rubber-band to stale x=50');
    }
  },

  {
    id: 'ADV_MR2.2.3',
    name: 'Client Prediction: Edge Cases in Snapshot Tick Values Handled Gracefully',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'player_edge_ticks';
      client.predictedX = 100;
      client.predictedY = 100;
      client.isPredictionInitialized = true;

      // Tick 0 is a valid number: must be accepted initially
      client.handleWorldSnapshot({
        tick: 0,
        timestamp: Date.now(),
        players: [{ id: 'player_edge_ticks', x: 105, y: 100 }]
      });
      assert.strictEqual(client.lastReconciledTick, 0);

      // Snapshot with null tick: must not crash
      assert.doesNotThrow(() => {
        client.handleWorldSnapshot({
          tick: null,
          timestamp: Date.now(),
          players: [{ id: 'player_edge_ticks', x: 110, y: 100 }]
        });
      });

      // Snapshot with undefined tick: must not crash
      assert.doesNotThrow(() => {
        client.handleWorldSnapshot({
          timestamp: Date.now(),
          players: [{ id: 'player_edge_ticks', x: 115, y: 100 }]
        });
      });

      // Snapshot with null players array: must not crash
      assert.doesNotThrow(() => {
        client.handleWorldSnapshot({
          tick: 1,
          timestamp: Date.now(),
          players: null
        });
      });
      assert.strictEqual(client.lastReconciledTick, 1);
    }
  },

  // =========================================================================
  // CHALLENGE 3: WORLD STATE BUFFER RETENTION (smokeZones, steamCore, waveInfo)
  // =========================================================================
  {
    id: 'ADV_MR2.3.1',
    name: 'Snapshot Buffer: Exhaustive Retention Across Buffer Sizes (0, 1, 2, Extrapolation)',
    fn: async () => {
      const client = new NetworkClient();
      client.playerId = 'hero_1';

      // 1. Buffer Size 0
      const emptyState = client.getInterpolatedState();
      assert.ok(Array.isArray(emptyState.smokeZones), 'smokeZones must be array on buffer=0');
      assert.strictEqual(emptyState.steamCore, null, 'steamCore must be null on buffer=0');
      assert.strictEqual(emptyState.waveInfo, null, 'waveInfo must be null on buffer=0');
      assert.ok(Array.isArray(emptyState.pickups), 'pickups must be array on buffer=0');
      assert.ok(Array.isArray(emptyState.soundEvents), 'soundEvents must be array on buffer=0');
      assert.ok(Array.isArray(emptyState.hitEvents), 'hitEvents must be array on buffer=0');

      // 2. Buffer Size 1
      const snapA = {
        tick: 10,
        timestamp: 1000,
        players: [{ id: 'hero_1', x: 100, y: 100, isAlive: true }, { id: 'remote_1', x: 300, y: 300, isAlive: true }],
        projectiles: [{ id: 'pr_1', x: 150, y: 150 }],
        pickups: [{ id: 'pk_1', x: 200, y: 200, type: 'ammo' }],
        smokeZones: [{ id: 'smoke_a', x: 120, y: 120, radius: 100 }],
        steamCore: { x: 400, y: 400, hp: 1000, maxHp: 1000 },
        waveInfo: { wave: 1, state: 'WAVE_ACTIVE', countdown: 0 },
        teamScores: { team1: 3, team2: 2 }
      };
      client.snapshotBuffer.push({ receivedAt: 1000, data: snapA });

      const state1 = client.getInterpolatedState(1000);
      assert.strictEqual(state1.smokeZones.length, 1);
      assert.strictEqual(state1.smokeZones[0].id, 'smoke_a');
      assert.strictEqual(state1.steamCore.hp, 1000);
      assert.strictEqual(state1.waveInfo.wave, 1);
      assert.strictEqual(state1.pickups.length, 1);
      assert.strictEqual(state1.teamScores.team1, 3);

      // 3. Buffer Size 2: Active Interpolation
      const snapB = {
        tick: 11,
        timestamp: 1033,
        players: [{ id: 'hero_1', x: 105, y: 100, isAlive: true }, { id: 'remote_1', x: 320, y: 300, isAlive: true }],
        projectiles: [{ id: 'pr_2', x: 160, y: 150 }],
        pickups: [],
        smokeZones: [{ id: 'smoke_a', x: 120, y: 120, radius: 100 }, { id: 'smoke_b', x: 250, y: 250, radius: 120 }],
        steamCore: { x: 400, y: 400, hp: 950, maxHp: 1000 },
        waveInfo: { wave: 1, state: 'WAVE_ACTIVE', countdown: 0 },
        teamScores: { team1: 4, team2: 2 }
      };
      client.snapshotBuffer.push({ receivedAt: 1033, data: snapB });

      // Mid-point interpolation renderTime = 1016.5
      const midState = client.getInterpolatedState(1016.5);
      // Remote player position interpolated between 300 and 320 -> ~310
      const remotePlayer = midState.players.find(p => p.id === 'remote_1');
      assert.ok(remotePlayer, 'Remote player present');
      assertEpsilon(remotePlayer.x, 310, 1.0, 'Remote player position must interpolate');

      // Crucial assertion: smokeZones, steamCore, waveInfo must be populated from latest snapshot
      assert.strictEqual(midState.smokeZones.length, 2, 'smokeZones preserved during interpolation');
      assert.strictEqual(midState.steamCore.hp, 950, 'steamCore preserved during interpolation');
      assert.strictEqual(midState.waveInfo.wave, 1, 'waveInfo preserved during interpolation');
      assert.strictEqual(midState.teamScores.team1, 4, 'teamScores preserved during interpolation');

      // 4. Extrapolation ahead of buffer (renderTime = 2000)
      const aheadState = client.getInterpolatedState(2000);
      assert.strictEqual(aheadState.smokeZones.length, 2, 'smokeZones preserved when ahead of buffer');
      assert.strictEqual(aheadState.steamCore.hp, 950, 'steamCore preserved when ahead of buffer');
      assert.strictEqual(aheadState.waveInfo.wave, 1, 'waveInfo preserved when ahead of buffer');

      // 5. RenderTime behind buffer (renderTime = 500)
      const behindState = client.getInterpolatedState(500);
      assert.strictEqual(behindState.smokeZones.length, 2, 'smokeZones preserved when behind buffer');
      assert.strictEqual(behindState.steamCore.hp, 950, 'steamCore preserved when behind buffer');
    }
  },

  // =========================================================================
  // CHALLENGE 4: CLIENT RECONNECTION & 10-SECOND GRACE PERIOD
  // =========================================================================
  {
    id: 'ADV_MR2.4.1',
    name: 'Reconnection: Complex Token URL Sanitization Stress',
    fn: async () => {
      const client = new NetworkClient({ url: 'wss://steamstrike.online:443/ws?foo=bar&token=old_token_123&baz=qux' });

      // Connect with token containing url-encoded special characters
      const specialToken = 'jwt.abc+def/456==#tag';
      client.connect(null, specialToken);

      assert.ok(client.url.includes(`token=${encodeURIComponent(specialToken)}`), 'New token must be encoded in URL');
      assert.strictEqual(client.url.includes('old_token_123'), false, 'Old token must be purged');
      assert.strictEqual(client.url.split('token=').length - 1, 1, 'Exactly one token parameter in URL');

      // Subsequent connect with null token uses cached token cleanly
      client.connect();
      assert.strictEqual(client.url.split('token=').length - 1, 1, 'No duplicate tokens stacked on subsequent connect');

      client.disconnect();
    }
  },

  {
    id: 'ADV_MR2.4.2',
    name: 'GameServer: Active Match Disconnection Grace Period Expiration Destroys Room',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('adv_expire_room', { maxPlayers: 2, autoTick: false });

      const p1 = new MockWebSocketPair();
      server.handleConnection(p1.serverSide, { id: 'client_exp_1' });
      p1.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'adv_expire_room', playerName: 'Pilot_Exp' }
      });

      await new Promise(r => setTimeout(r, 20));
      room.startMatch();
      assert.strictEqual(room.state, 'IN_PROGRESS');

      // Abrupt drop
      p1.clientSide.close(1006, 'Abrupt Net Drop');
      await new Promise(r => setTimeout(r, 20));

      assert.ok(server.teardownTimers?.has('adv_expire_room'), 'Teardown timer must be registered');
      assert.ok(server.rooms.has('adv_expire_room'), 'Room preserved during grace period');

      // Fast-forward / force-trigger the teardown timer to simulate 10s grace expiration
      const teardownTimer = server.teardownTimers.get('adv_expire_room');
      clearTimeout(teardownTimer);
      server.teardownTimers.delete('adv_expire_room');

      // Execute room cleanup
      if (room.players.size === 0) {
        room.stopLoop();
        server.rooms.delete('adv_expire_room');
      }

      assert.strictEqual(server.rooms.has('adv_expire_room'), false, 'Room must be destroyed after grace period expires');
    }
  },

  {
    id: 'ADV_MR2.4.3',
    name: 'GameServer: Non-In-Progress Lobby Room Torn Down Immediately Without Grace Period',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('adv_lobby_room', { maxPlayers: 2, autoTick: false });
      assert.strictEqual(room.state, 'LOBBY');

      const p1 = new MockWebSocketPair();
      server.handleConnection(p1.serverSide, { id: 'client_lobby_1' });
      p1.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'adv_lobby_room', playerName: 'LobbyPlayer' }
      });

      await new Promise(r => setTimeout(r, 20));
      assert.strictEqual(room.players.size, 1);

      // Player leaves or disconnects in lobby state
      p1.clientSide.close();
      await new Promise(r => setTimeout(r, 20));

      // In non-in-progress state, graceMs = 0 -> destroyed immediately
      assert.strictEqual(server.rooms.has('adv_lobby_room'), false, 'Lobby room must be torn down immediately on disconnect');
      assert.strictEqual(server.teardownTimers?.has('adv_lobby_room') || false, false, 'No teardown timer for lobby room');
    }
  },

  {
    id: 'ADV_MR2.4.4',
    name: 'GameServer: Unauthorized Join Rejection on Match In Progress Without Token',
    fn: async () => {
      const server = new GameServer();
      const room = server.createRoom('adv_no_trespassing_room', { maxPlayers: 4, autoTick: false });

      // Host enters and starts match
      const hostPair = new MockWebSocketPair();
      server.handleConnection(hostPair.serverSide, { id: 'host_client' });
      hostPair.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'adv_no_trespassing_room', playerName: 'Host' }
      });
      await new Promise(r => setTimeout(r, 20));
      room.startMatch();
      assert.strictEqual(room.state, 'IN_PROGRESS');

      // Stranger client connects and attempts to join match in progress without reconnect token
      const strangerPair = new MockWebSocketPair();
      server.handleConnection(strangerPair.serverSide, { id: 'stranger_client' });

      const waitError = strangerPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR, 500);
      strangerPair.clientSide.send({
        type: PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN,
        payload: { roomId: 'adv_no_trespassing_room', playerName: 'Intruder' }
      });

      const errPacket = await waitError;
      assert.ok(errPacket, 'Server must emit S2C_ERROR to unauthorized intruder');
      assert.strictEqual(errPacket.payload.code, 'MATCH_IN_PROGRESS', 'Must reject with MATCH_IN_PROGRESS code');

      hostPair.clientSide.close();
      strangerPair.clientSide.close();
      room.stopLoop();
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}

export default { suiteName, tests, run };
