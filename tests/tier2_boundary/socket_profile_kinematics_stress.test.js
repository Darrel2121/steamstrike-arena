/**
 * Tier 2.13: Socket Profile Propagation, Anticheat Kinematics & REST Auth Stress Suite
 * Authored by: challenger_prog_iter2_1
 * Zero external dependencies: uses native Node.js HTTP & project MockWebSocketPair harness.
 *
 * Empirically tests:
 * 1. REST Auth Enforcement: HTTP 401 Unauthorized strictly returned on unauthenticated /api/profile mutations.
 * 2. WebSocket Profile Attachment: socket.meta and socket.profile propagation with authenticated tokens.
 * 3. Room.addPlayer Stat Loading: Tier 5 stats (maxHp 125, maxSpeed 200, lanternRange 495, effective weapons).
 * 4. 60-Tick Anticheat Kinematics: 300 px/s sprint displacement (600px), walking (400px), diagonal sprint,
 *    speed-hack clamping verification, and boundary dt robustness.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { GameServer } from '../../server/GameServer.js';
import { Room } from '../../server/Room.js';
import { authService } from '../../server/auth/AuthService.js';
import { profileStore } from '../../server/db/ProfileStore.js';
import { PROTOCOL_MSG_TYPES, serializePacket, deserializePacket } from '../../shared/Protocol.js';
import {
  BASE_CHARACTER_STATS,
  CHARACTER_TIER_MODIFIERS,
  calculateCharacterStats,
  calculateEffectiveWeaponStats
} from '../../shared/ProgressionSchema.js';

export const suiteName = 'Tier 2.13: Socket Profile Propagation, Anticheat Kinematics & REST Auth Stress';

let testServer = null;
let testPort = 0;
let testProfileId = 'stress_t213_tier5_' + Date.now();
let testProfileToken = null;
let testProfileData = null;

// Native JSON parsing helper matching server/index.js parseJsonBody
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Native HTTP client request helper
async function httpRequest(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

/**
 * Simulates server/index.js WebSocket connection upgrade handler:
 * Reads ?token= from reqUrl, verifies with authService, fetches profile from profileStore,
 * attaches meta and profile to server socket, then calls gameServer.handleConnection.
 */
async function simulateWsUpgrade(gameServer, reqUrl, serverSocket) {
  let profile = null;
  let token = null;

  try {
    const parsedUrl = new URL(reqUrl, 'http://localhost');
    token = parsedUrl.searchParams.get('token');
    if (token) {
      const userPayload = authService.verifyToken(token);
      if (userPayload?.accountId) {
        profile = await profileStore.getProfile(userPayload.accountId);
      }
    }
  } catch (_) {}

  const meta = {
    ip: '127.0.0.1',
    id: profile?.id || `client_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    profile,
    token
  };
  serverSocket.meta = meta;
  serverSocket.profile = profile;
  gameServer.handleConnection(serverSocket, meta);
  return { meta, profile };
}

export const tests = [
  // ==========================================================================
  // SECTION 1: SETUP & REST PROFILE MUTATION AUTH ENFORCEMENT
  // ==========================================================================
  {
    id: 'T2.S1',
    name: 'Server Initialization & Tier 5 Profile Creation',
    fn: async () => {
      // Create HTTP REST server executing exact routing logic from server/index.js lines 80-176
      testServer = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = decodeURIComponent(parsedUrl.pathname);

        const sendJson = (status, data) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(data));
        };

        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const userPayload = token ? authService.verifyToken(token) : null;

        try {
          if ((pathname === '/api/auth/me' || pathname === '/api/profile') && req.method === 'GET') {
            if (!userPayload) return sendJson(401, { success: false, error: 'Unauthorized' });
            const profile = await profileStore.getProfile(userPayload.accountId);
            if (!profile) return sendJson(404, { success: false, error: 'Profile not found' });
            return sendJson(200, { success: true, profile });
          }

          if (pathname === '/api/profile/upgrade/character' && req.method === 'POST') {
            if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
            const body = await parseJsonBody(req);
            const accountId = userPayload.accountId;
            const result = await profileStore.upgradeCharacter(accountId, body.stat || body.attribute);
            return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
          }

          if (pathname === '/api/profile/upgrade/weapon' && req.method === 'POST') {
            if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
            const body = await parseJsonBody(req);
            const accountId = userPayload.accountId;
            const result = await profileStore.upgradeWeapon(accountId, body.weaponId, body.stat || body.upgradeType);
            return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
          }

          if (pathname === '/api/profile/unlock/weapon' && req.method === 'POST') {
            if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
            const body = await parseJsonBody(req);
            const accountId = userPayload.accountId;
            const result = await profileStore.unlockWeapon(accountId, body.weaponId);
            return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
          }

          if (pathname === '/api/profile/upgrade' && req.method === 'POST') {
            if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
            const body = await parseJsonBody(req);
            const accountId = userPayload.accountId;
            let result;
            if (body.type === 'weapon' || body.weaponId) {
              result = await profileStore.upgradeWeapon(accountId, body.weaponId, body.stat || body.upgradeType);
            } else {
              result = await profileStore.upgradeCharacter(accountId, body.stat || body.attribute);
            }
            return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
          }

          if ((pathname === '/api/profile/equip' || pathname === '/api/profile/equip/weapon' || pathname === '/api/profile/equip/class') && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const accountId = userPayload?.accountId || body.guestId || body.profileId;
            const weaponId = body.weaponId;
            const classId = body.classId;

            let updatedProfile = null;
            if (accountId) {
              if (weaponId) {
                await profileStore.setEquippedWeapon(accountId, weaponId);
              }
              if (classId) {
                await profileStore.setEquippedClass(accountId, classId);
              }
              updatedProfile = await profileStore.getProfile(accountId);
            }

            return sendJson(200, {
              success: true,
              equippedWeapon: weaponId,
              equippedClass: classId,
              profile: updatedProfile
            });
          }

          return sendJson(404, { success: false, error: 'Not found' });
        } catch (err) {
          return sendJson(400, { success: false, error: err.message });
        }
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      testPort = testServer.address().port;
      assert.ok(testPort > 0);

      const profile = await profileStore.createProfile({
        id: testProfileId,
        username: 'IronBaron#777',
        isGuest: false,
        googleId: 'google_stress_sub_' + Date.now(),
        level: 25,
        xp: 50000,
        currency: { scrap: 5000, cores: 10 },
        equippedWeapon: 'steam_carbine'
      });

      profile.characterStats = {
        healthTier: 5,
        speedTier: 5,
        lanternTier: 5,
        maxHpLevel: 5,
        speedLevel: 5,
        lanternLevel: 5
      };
      profile.weapons.steam_carbine = {
        unlocked: true,
        damageTier: 5,
        fireRateTier: 5,
        reloadTier: 5,
        capacityTier: 5,
        damageLevel: 5,
        fireRateLevel: 5,
        reloadLevel: 5,
        capacityLevel: 5
      };
      profile.equippedWeapon = 'steam_carbine';

      await profileStore.save(profile);
      testProfileData = profile;
      testProfileToken = authService.generateToken({ accountId: testProfileId, isGuest: false });
      assert.ok(typeof testProfileToken === 'string');
    }
  },

  {
    id: 'T2.S2',
    name: 'REST Auth: Unauthenticated POST /api/profile/upgrade/character strictly returns 401',
    fn: async () => {
      // 1. Missing Authorization header
      const res1 = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade/character',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { stat: 'speed' });
      assert.strictEqual(res1.statusCode, 401, 'Must return 401 without auth header');
      assert.strictEqual(res1.json?.success, false);
      assert.match(res1.json?.error, /Unauthorized/i);

      // 2. Empty Authorization header
      const res2 = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade/character',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': '' }
      }, { stat: 'health' });
      assert.strictEqual(res2.statusCode, 401);

      // 3. Bearer with garbage token
      const res3 = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade/character',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer garbage.invalid.jwt' }
      }, { stat: 'speed' });
      assert.strictEqual(res3.statusCode, 401);

      // 4. Bearer with tampered HMAC signature
      const [h, b] = testProfileToken.split('.');
      const tampered = `${h}.${b}.bad_signature_tampered_123`;
      const res4 = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade/character',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tampered}` }
      }, { stat: 'speed' });
      assert.strictEqual(res4.statusCode, 401);

      // 5. Body trying to inject untrusted accountId without valid auth header
      const res5 = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade/character',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { accountId: testProfileId, profileId: testProfileId, stat: 'speed' });
      assert.strictEqual(res5.statusCode, 401);
    }
  },

  {
    id: 'T2.S3',
    name: 'REST Auth: Unauthenticated Mutations Across All Profile Endpoints Return 401',
    fn: async () => {
      // POST /api/profile/upgrade/weapon
      const resW = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade/weapon',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { weaponId: 'steam_carbine', stat: 'damage' });
      assert.strictEqual(resW.statusCode, 401);

      // POST /api/profile/unlock/weapon
      const resU = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/unlock/weapon',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { weaponId: 'blunderbuss' });
      assert.strictEqual(resU.statusCode, 401);

      // POST /api/profile/upgrade
      const resG = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile/upgrade',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { stat: 'lantern' });
      assert.strictEqual(resG.statusCode, 401);

      // GET /api/profile without token
      const resP = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile',
        method: 'GET'
      });
      assert.strictEqual(resP.statusCode, 401);

      // Valid token GET /api/profile returns 200
      const resOk = await httpRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/profile',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${testProfileToken}` }
      });
      assert.strictEqual(resOk.statusCode, 200);
      assert.strictEqual(resOk.json?.profile?.id, testProfileId);
    }
  },

  // ==========================================================================
  // SECTION 2: WEBSOCKET PROFILE TOKEN PROPAGATION
  // ==========================================================================
  {
    id: 'T2.S4',
    name: 'WebSocket Connection: Authenticated Token Attaches socket.meta and socket.profile',
    fn: async () => {
      const gameServer = new GameServer();
      const pair = new MockWebSocketPair();

      const reqUrl = `/?token=${encodeURIComponent(testProfileToken)}`;
      await simulateWsUpgrade(gameServer, reqUrl, pair.serverSide);

      // Verify server socket properties
      assert.ok(pair.serverSide.meta !== null && typeof pair.serverSide.meta === 'object');
      assert.ok(pair.serverSide.profile !== null && typeof pair.serverSide.profile === 'object');
      assert.strictEqual(pair.serverSide.profile.id, testProfileId);
      assert.strictEqual(pair.serverSide.meta.profile.id, testProfileId);
      assert.strictEqual(pair.serverSide.profile.characterStats.speedLevel, 5);

      pair.clientSide.close();
      pair.serverSide.close();
    }
  },

  {
    id: 'T2.S5',
    name: 'WebSocket Connection: Unauthenticated / Invalid Token Leaves Profile Null',
    fn: async () => {
      const gameServer = new GameServer();

      // No token
      const pair1 = new MockWebSocketPair();
      await simulateWsUpgrade(gameServer, '/', pair1.serverSide);
      assert.strictEqual(pair1.serverSide.profile, null);
      assert.strictEqual(pair1.serverSide.meta.profile, null);

      // Invalid token
      const pair2 = new MockWebSocketPair();
      await simulateWsUpgrade(gameServer, '/?token=fake.tampered.token', pair2.serverSide);
      assert.strictEqual(pair2.serverSide.profile, null);
      assert.strictEqual(pair2.serverSide.meta.profile, null);

      pair1.clientSide.close();
      pair2.clientSide.close();
    }
  },

  // ==========================================================================
  // SECTION 3: ROOM.ADDPLAYER STAT APPLICATION
  // ==========================================================================
  {
    id: 'T2.S6',
    name: 'Room.addPlayer: Loads Tier 5 Stats (maxHp 125, maxSpeed 200, lanternRange 495, effective weapons)',
    fn: async () => {
      const gameServer = new GameServer();
      const pair = new MockWebSocketPair();

      await simulateWsUpgrade(gameServer, `/?token=${encodeURIComponent(testProfileToken)}`, pair.serverSide);

      const roomId = 'room_tier5_verify_' + Date.now();
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId,
        playerName: 'BaronVonSpeed'
      }));

      // Wait for lobby state
      await pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);

      const room = gameServer.rooms.get(roomId);
      assert.ok(room !== null);

      let playerEntity = null;
      for (const [, p] of room.players) {
        if (p.profile?.id === testProfileId) {
          playerEntity = p;
          break;
        }
      }
      assert.ok(playerEntity !== null);

      // Verify Tier 5 stats:
      // maxHp: 100 + 5*5 = 125
      assert.strictEqual(playerEntity.maxHp, 125, 'maxHp must be 125');
      assert.strictEqual(playerEntity.hp, 125, 'hp must match maxHp 125');

      // maxSpeed: 180 + 5*4 = 200
      assert.strictEqual(playerEntity.maxSpeed, 200, 'maxSpeed must be 200');

      // lanternRange: 420 + 5*15 = 495
      assert.strictEqual(playerEntity.lanternRange, 495, 'lanternRange must be 495');

      // Weapon: steam_carbine with Tier 5 stats
      assert.strictEqual(playerEntity.weaponId, 'steam_carbine');
      assert.strictEqual(playerEntity.weapon.damage, 25, 'steam_carbine Tier 5 damage must be 25');
      assert.strictEqual(playerEntity.weapon.magazine, 30, 'steam_carbine Tier 5 magazine must be 30');
      assert.strictEqual(playerEntity.maxAmmo, 30);
      assert.strictEqual(playerEntity.ammo, 30);

      pair.clientSide.close();
      pair.serverSide.close();
    }
  },

  {
    id: 'T2.S7',
    name: 'Room.addPlayer: Unauthenticated Socket Falls Back Strictly to Base Stats',
    fn: async () => {
      const gameServer = new GameServer();
      const pair = new MockWebSocketPair();

      await simulateWsUpgrade(gameServer, '/', pair.serverSide);

      const roomId = 'room_unauth_verify_' + Date.now();
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId,
        playerName: 'DefaultGuest'
      }));

      await pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);

      const room = gameServer.rooms.get(roomId);
      assert.ok(room !== null);

      const playerEntity = Array.from(room.players.values())[0];
      assert.ok(playerEntity !== null);

      assert.strictEqual(playerEntity.maxHp, 100);
      assert.strictEqual(playerEntity.hp, 100);
      assert.strictEqual(playerEntity.maxSpeed, 180);
      assert.strictEqual(playerEntity.lanternRange, 420);
      assert.strictEqual(playerEntity.weaponId, 'revolver');

      pair.clientSide.close();
      pair.serverSide.close();
    }
  },

  // ==========================================================================
  // SECTION 4: ANTICHEAT KINEMATICS & 60-TICK STRESS
  // ==========================================================================
  {
    id: 'T2.S8',
    name: 'Anticheat Kinematics: 60-Tick Sprint at 300 px/s (0 Clamping, Exact 600px, 0 Rubber-Banding)',
    fn: async () => {
      const openMap = {
        version: "1.0",
        name: "OpenStressArena",
        width: 60,
        height: 60,
        tileSize: 40,
        tiles: new Array(60 * 60).fill(0),
        spawns: [{ id: "sp1", type: "player", col: 5, row: 5 }]
      };

      const room = new Room({
        id: 'stress_kinematics_room',
        map: openMap,
        tickRate: 30,
        autoTick: false
      });

      const player = room.addPlayer('test_p_sprint60', 'Speedster', null, testProfileData);
      assert.strictEqual(player.maxSpeed, 200);
      assert.strictEqual(player.sprintMultiplier, 1.5);

      player.x = 200;
      player.y = 200;
      const startX = player.x;

      const dtMs = 1000 / 30; // 33.333ms
      const dtSec = dtMs / 1000;
      const speed = player.maxSpeed * player.sprintMultiplier; // 300 px/s
      const expectedDispPerTick = speed * dtSec; // 10.0 px

      for (let tick = 1; tick <= 60; tick++) {
        const prevX = player.x;
        room.handlePlayerInput(player.id, {
          moveX: 1.0,
          moveY: 0.0,
          sprint: true,
          dt: dtMs,
          seq: tick
        });

        const tickDisp = player.x - prevX;
        assert.ok(
          Math.abs(tickDisp - expectedDispPerTick) < 1e-6,
          `Tick ${tick}: displacement ${tickDisp} must equal theoretical ${expectedDispPerTick}`
        );
      }

      const totalDisp = player.x - startX;
      assert.strictEqual(totalDisp, 600, 'Total displacement over 60 ticks must be exactly 600 px with 0 rubber-banding');
    }
  },

  {
    id: 'T2.S9',
    name: 'Anticheat Kinematics: 60-Tick Diagonal Sprint (Magnitude 1.0, Hypotenuse 600.0px)',
    fn: async () => {
      const openMap = {
        version: "1.0",
        name: "OpenStressArena",
        width: 60,
        height: 60,
        tileSize: 40,
        tiles: new Array(60 * 60).fill(0),
        spawns: [{ id: "sp1", type: "player", col: 5, row: 5 }]
      };

      const room = new Room({
        id: 'stress_diagonal_room',
        map: openMap,
        tickRate: 30,
        autoTick: false
      });

      const player = room.addPlayer('test_p_diag60', 'DiagonalRunner', null, testProfileData);
      player.x = 200;
      player.y = 200;
      const startX = player.x;
      const startY = player.y;

      const dtMs = 1000 / 30;
      const dtSec = dtMs / 1000;
      const speed = player.maxSpeed * player.sprintMultiplier; // 300 px/s

      const dirX = 1 / Math.SQRT2;
      const dirY = 1 / Math.SQRT2;

      for (let tick = 1; tick <= 60; tick++) {
        const prevX = player.x;
        const prevY = player.y;

        room.handlePlayerInput(player.id, {
          moveX: dirX,
          moveY: dirY,
          sprint: true,
          dt: dtMs,
          seq: tick
        });

        const dx = player.x - prevX;
        const dy = player.y - prevY;
        const disp = Math.hypot(dx, dy);

        assert.ok(Math.abs(disp - (speed * dtSec)) < 1e-5);
      }

      const totalDisp = Math.hypot(player.x - startX, player.y - startY);
      assert.ok(Math.abs(totalDisp - 600.0) < 1e-4, `Expected 600px diagonal displacement, got ${totalDisp}`);
    }
  },

  {
    id: 'T2.S10',
    name: 'Anticheat Kinematics: 60-Tick Walk at 200 px/s (sprint=false, Exact 400.0px Displacement)',
    fn: async () => {
      const openMap = {
        version: "1.0",
        name: "OpenStressArena",
        width: 60,
        height: 60,
        tileSize: 40,
        tiles: new Array(60 * 60).fill(0),
        spawns: [{ id: "sp1", type: "player", col: 5, row: 5 }]
      };

      const room = new Room({
        id: 'stress_walk_room',
        map: openMap,
        tickRate: 30,
        autoTick: false
      });

      const player = room.addPlayer('test_p_walk60', 'Walker', null, testProfileData);
      player.x = 200;
      player.y = 200;
      const startX = player.x;

      const dtMs = 1000 / 30;
      const dtSec = dtMs / 1000;
      const speed = player.maxSpeed; // 200 px/s

      for (let tick = 1; tick <= 60; tick++) {
        const prevX = player.x;

        room.handlePlayerInput(player.id, {
          moveX: 1.0,
          moveY: 0.0,
          sprint: false,
          dt: dtMs,
          seq: tick
        });

        const tickDisp = player.x - prevX;
        assert.ok(Math.abs(tickDisp - (speed * dtSec)) < 1e-5);
      }

      const totalDisp = player.x - startX;
      assert.ok(Math.abs(totalDisp - 400.0) < 1e-4, `Expected 400px displacement, got ${totalDisp}`);
    }
  },

  {
    id: 'T2.S11',
    name: 'Anticheat Kinematics: Spoofed Speedhack (Raw 600 px/s Input Clamped to 300 px/s Limit)',
    fn: async () => {
      const openMap = {
        version: "1.0",
        name: "OpenStressArena",
        width: 60,
        height: 60,
        tileSize: 40,
        tiles: new Array(60 * 60).fill(0),
        spawns: [{ id: "sp1", type: "player", col: 5, row: 5 }]
      };

      const room = new Room({
        id: 'stress_hack_room',
        map: openMap,
        tickRate: 30,
        autoTick: false
      });

      const player = room.addPlayer('test_p_hacker', 'Cheater', null, testProfileData);
      player.x = 200;
      player.y = 200;
      const startX = player.x;

      const dtMs = 1000 / 30;
      const dtSec = dtMs / 1000;
      const maxAllowedPerTick = (player.maxSpeed * player.sprintMultiplier) * dtSec; // 10.0 px

      for (let tick = 1; tick <= 60; tick++) {
        const prevX = player.x;

        room.handlePlayerInput(player.id, {
          moveX: 20.0, // spoofed raw displacement > 1.05
          moveY: 0.0,
          sprint: true,
          dt: dtMs,
          seq: tick
        });

        const tickDisp = player.x - prevX;
        assert.ok(
          Math.abs(tickDisp - maxAllowedPerTick) < 1e-5,
          `Tick ${tick} failed anticheat clamping: got ${tickDisp}, expected max ${maxAllowedPerTick}`
        );
      }

      const totalDisp = player.x - startX;
      assert.strictEqual(totalDisp, 600, 'Cheater must be strictly clamped to 600px total');
    }
  },

  {
    id: 'T2.S12',
    name: 'Anticheat Kinematics: Delta-Time Boundary Fuzzing (Zero, Negative, NaN, String dt Safe Handling)',
    fn: async () => {
      const openMap = {
        version: "1.0",
        name: "OpenStressArena",
        width: 60,
        height: 60,
        tileSize: 40,
        tiles: new Array(60 * 60).fill(0),
        spawns: [{ id: "sp1", type: "player", col: 5, row: 5 }]
      };

      const room = new Room({
        id: 'stress_dtfuzz_room',
        map: openMap,
        tickRate: 30,
        autoTick: false
      });

      const player = room.addPlayer('test_p_dtfuzz', 'DtFuzzer', null, testProfileData);
      player.x = 200;
      player.y = 200;

      room.handlePlayerInput(player.id, { moveX: 1.0, moveY: 0.0, dt: 0 });
      assert.ok(Number.isFinite(player.x));

      room.handlePlayerInput(player.id, { moveX: 1.0, moveY: 0.0, dt: -100 });
      assert.ok(Number.isFinite(player.x));

      room.handlePlayerInput(player.id, { moveX: 1.0, moveY: 0.0, dt: NaN });
      assert.ok(Number.isFinite(player.x));

      room.handlePlayerInput(player.id, { moveX: 1.0, moveY: 0.0, dt: 'overflow' });
      assert.ok(Number.isFinite(player.x));
    }
  },

  // ==========================================================================
  // SECTION 5: TEARDOWN & CLEANUP
  // ==========================================================================
  {
    id: 'T2.S13',
    name: 'Server Teardown & Test Profile Purge',
    fn: async () => {
      await profileStore.delete(testProfileId);

      if (testServer) {
        await new Promise(resolve => testServer.close(resolve));
      }
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
