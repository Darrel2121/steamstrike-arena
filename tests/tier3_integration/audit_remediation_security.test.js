/**
 * Tier 3: Comprehensive Audit Remediation & Security Verification Suite
 * Validates fixes for critical/high findings in AUDIT_REPORT.md:
 * - [ARCH-01] Static file sandboxing & Path Traversal prevention
 * - [ARCH-02] Signed JWT Admin Authentication (rejection of hardcoded tokens)
 * - [SEC-01] Profile Sync protection against account hijacking & currency inflation
 * - [SEC-02] Authoritative Loadout validation (rejection of spoofed client stats/upgrades)
 * - [SRV-03] Host-only Match Start authority enforcement
 * - [SRV-02] Input dt ceiling anticheat clamping
 * - [DB-01]/[DB-02] Concurrent ProfileStore mutex serialization & queue cleanup
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { startServer } from '../../server/index.js';
import { GameServer } from '../../server/GameServer.js';
import { Room } from '../../server/Room.js';
import { ProfileStore, profileStore } from '../../server/db/ProfileStore.js';
import { gameConfigStore } from '../../server/db/GameConfigStore.js';
import { authService } from '../../server/auth/AuthService.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';
import { serializePacket } from '../../shared/Protocol.js';
import { canonicalFoundryMap } from '../fixtures/maps.fixture.js';

export const suiteName = 'Tier 3: Audit Remediation & Security Hardening';

async function withTestHttpServer(fn) {
  const { server, wss, gameServer } = startServer(0);
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn({ baseUrl, server, wss, gameServer });
  } finally {
    try { gameServer.shutdown(); } catch (_) {}
    try { wss.close(); } catch (_) {}
    await new Promise((resolve) => server.close(resolve));
  }
}

export const tests = [
  {
    id: 'T3.SEC1',
    name: '[ARCH-01] Static Server Sandboxing: Blocks Access to /server, /data, and Path Traversal',
    fn: async () => {
      await withTestHttpServer(async ({ baseUrl }) => {
        const resServerFile = await fetch(`${baseUrl}/server/index.js`);
        assert.strictEqual(resServerFile.status, 403, 'GET /server/index.js must be blocked with 403');

        const resDataFile = await fetch(`${baseUrl}/data/profiles.json`);
        assert.strictEqual(resDataFile.status, 403, 'GET /data/profiles.json must be blocked with 403');

        const resTraversal = await fetch(`${baseUrl}/shared/%2e%2e/server/index.js`);
        assert.strictEqual(resTraversal.status, 403, 'Encoded path traversal must be blocked with 403');

        const resPkg = await fetch(`${baseUrl}/package.json`);
        assert.strictEqual(resPkg.status, 403, 'GET /package.json must be blocked with 403');

        const resClient = await fetch(`${baseUrl}/index.html`);
        assert.strictEqual(resClient.status, 200, 'GET /index.html in client directory must succeed');

        const resShared = await fetch(`${baseUrl}/shared/Constants.js`);
        assert.strictEqual(resShared.status, 200, 'GET /shared/Constants.js must succeed');
      });
    }
  },

  {
    id: 'T3.SEC2',
    name: '[ARCH-02] Admin API Security: Rejects Legacy Hardcoded Token and Requires Signed Admin JWT',
    fn: async () => {
      await withTestHttpServer(async ({ baseUrl }) => {
        // 1. Unauthenticated request must fail
        const resUnauth = await fetch(`${baseUrl}/api/admin/stats`);
        assert.strictEqual(resUnauth.status, 401, 'Unauthenticated admin stats must return 401');

        // 2. Legacy hardcoded token must fail
        const resLegacy = await fetch(`${baseUrl}/api/admin/stats`, {
          headers: { 'x-admin-key': 'admin_authorized_token' }
        });
        assert.strictEqual(resLegacy.status, 401, 'Legacy hardcoded admin_authorized_token must be rejected with 401');

        // 3. Regular player JWT must NOT grant admin access
        const playerToken = authService.generateToken({ accountId: 'acc_regular', isGuest: true });
        const resPlayerToken = await fetch(`${baseUrl}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${playerToken}` }
        });
        assert.strictEqual(resPlayerToken.status, 401, 'Regular player JWT must not grant admin stats access');

        // 4. Authenticate via POST /api/admin/auth to obtain signed admin JWT
        const adminPassword = gameConfigStore.adminPassword;
        const resAuth = await fetch(`${baseUrl}/api/admin/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword })
        });
        assert.strictEqual(resAuth.status, 200, 'Valid admin password must return 200');
        const authData = await resAuth.json();
        const adminToken = authData.adminToken || authData.token;
        assert.ok(authData.success && adminToken, 'Admin auth must issue a signed token');
        assert.notStrictEqual(adminToken, 'admin_authorized_token', 'Issued token must be a signed JWT');

        // 5. Signed admin JWT must grant access
        const resAuthorized = await fetch(`${baseUrl}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.strictEqual(resAuthorized.status, 200, 'Signed admin JWT must authorize /api/admin/stats');
      });
    }
  },

  {
    id: 'T3.SEC3',
    name: '[SEC-01] Profile Sync Hardening: Prevents Registered Account Hijack and Currency Inflation',
    fn: async () => {
      await withTestHttpServer(async ({ baseUrl }) => {
        // Create a linked (non-guest) profile in the store
        const linkedId = `acc_linked_${Date.now()}`;
        await profileStore.createProfile({
          id: linkedId,
          username: 'VerifiedCommander',
          isGuest: false,
          googleId: 'g_verified_123'
        });

        // 1. Unauthenticated attacker attempts to hijack/overwrite the linked profile via /api/profile/sync
        const hijackRes = await fetch(`${baseUrl}/api/profile/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: {
              id: linkedId,
              username: 'PwnedCommander',
              currency: { scrap: 999999, cores: 9999 }
            }
          })
        });
        assert.strictEqual(hijackRes.status, 401, 'Unauthenticated sync for registered account must return 401');

        // 2. Guest sync attempting to inject 999,999 scrap & level 50 must be stripped to safe defaults
        const guestId = `acc_guest_sync_${Date.now()}`;
        const guestRes = await fetch(`${baseUrl}/api/profile/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: {
              id: guestId,
              username: 'HonestMechanic',
              level: 50,
              xp: 500000,
              currency: { scrap: 999999, cores: 9999 },
              characterStats: { health: 5, speed: 5, lantern: 5 }
            }
          })
        });
        assert.strictEqual(guestRes.status, 200, 'Guest profile sync should succeed');
        const guestData = await guestRes.json();
        assert.strictEqual(guestData.profile.level, 1, 'Synced guest profile must not accept spoofed level 50');
        assert.strictEqual(guestData.profile.currency.scrap, 500, 'Synced guest profile must not accept spoofed 999,999 scrap');
        assert.strictEqual(guestData.profile.characterUpgrades?.health ?? 0, 0, 'Synced guest profile must not accept spoofed tier 5 health');
      });
    }
  },

  {
    id: 'T3.SEC4',
    name: '[SEC-02] Authoritative Loadout Validation: Ignores Spoofed Client Stat Tiers in C2S_LOADOUT_UPDATE',
    fn: async () => {
      const server = new GameServer();
      const pair = new MockWebSocketPair();
      server.handleConnection(pair.serverSide, { id: 'client_sec4', playerName: 'Tester' });

      const waitJoin = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'Sec4_Chamber',
        playerName: 'Tester',
        map: canonicalFoundryMap
      }));
      await waitJoin;

      const room = server.rooms.get('Sec4_Chamber');
      const player = room.players.get('client_sec4');
      assert.ok(player, 'Player must exist in room');
      const baseHp = player.maxHp;

      // Client sends C2S_LOADOUT_UPDATE with spoofed tier-99 health/speed and weapon damage
      const waitUpdate = pair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      pair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOADOUT_UPDATE, {
        weaponId: 'revolver',
        classId: 'vanguard',
        profile: {
          id: 'unverified_spoof_id',
          characterStats: { health: 99, speed: 99, lantern: 99 },
          weapons: {
            revolver: { unlocked: true, damage: 99, fireRate: 99, capacity: 99 }
          }
        }
      }));
      await waitUpdate;

      assert.strictEqual(player.maxHp, baseHp, 'Player maxHp must strictly match class baseHp, ignoring spoofed client tiers');
      assert.strictEqual(player.weapon.damage, 35, 'Revolver damage must remain canonical 35, ignoring spoofed tier 99');
    }
  },

  {
    id: 'T3.SEC5',
    name: '[SRV-03] Host-Only Match Start Authority: Non-Host C2S_MATCH_START Rejected with NOT_HOST',
    fn: async () => {
      const server = new GameServer();
      const hostPair = new MockWebSocketPair();
      const guestPair = new MockWebSocketPair();

      server.handleConnection(hostPair.serverSide, { id: 'host_p1', playerName: 'RoomHost' });
      server.handleConnection(guestPair.serverSide, { id: 'guest_p2', playerName: 'GuestIntruder' });

      // Host creates room
      const waitHost = hostPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      hostPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_CREATE, {
        roomId: 'HostAuth_Room',
        playerName: 'RoomHost',
        map: canonicalFoundryMap
      }));
      await waitHost;

      // Guest joins room
      const waitGuest = guestPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_LOBBY_STATE);
      guestPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_LOBBY_JOIN, {
        roomId: 'HostAuth_Room',
        playerName: 'GuestIntruder'
      }));
      await waitGuest;

      // Guest attempts to start match without being host
      const waitErr = guestPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_ERROR);
      guestPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_MATCH_START, {
        fillBots: true
      }));
      const errMsg = await waitErr;
      assert.strictEqual(errMsg.payload.code, 'NOT_HOST', 'Non-host match start must return NOT_HOST error');

      const room = server.rooms.get('HostAuth_Room');
      assert.strictEqual(room.state, 'LOBBY', 'Room state must remain LOBBY after unauthorized start attempt');

      // Host starts match legitimately
      const waitStart = hostPair.clientSide.waitFor(PROTOCOL_MSG_TYPES.S2C_MATCH_INIT);
      hostPair.clientSide.send(serializePacket(PROTOCOL_MSG_TYPES.C2S_MATCH_START, {
        fillBots: false
      }));
      const initMsg = await waitStart;
      assert.ok(initMsg, 'Host must be able to start the match');
      assert.strictEqual(room.state, 'IN_PROGRESS', 'Room state must transition to IN_PROGRESS for host');
      if (typeof room.stopLoop === 'function') room.stopLoop();
      hostPair.clientSide.close();
      guestPair.clientSide.close();
    }
  },

  {
    id: 'T3.SEC6',
    name: '[SRV-02] Anticheat Input dt Ceiling: Extreme dt=10000ms Clamped to <=100ms Step',
    fn: async () => {
      const room = new Room({ id: 'dt_ceil_room', map: canonicalFoundryMap });
      const player = room.addPlayer('p_dt_hacker', 'TimeTraveler');
      player.x = 200;
      player.y = 200;
      const startX = player.x;

      // Client sends a single input packet claiming 10,000ms (10 full seconds) elapsed
      room.handlePlayerInput('p_dt_hacker', {
        moveX: 1,
        moveY: 0,
        sprint: true,
        dt: 10000
      });

      const maxAllowedFor100ms = (player.maxSpeed || 180) * (player.sprintMultiplier || 1.5) * (100 / 1000);
      const actualMoved = player.x - startX;
      assert.ok(
        actualMoved <= maxAllowedFor100ms + 0.01,
        `Single-packet movement with dt=10000ms must be clamped to <=100ms ceiling (got ${actualMoved}, max ${maxAllowedFor100ms})`
      );
    }
  },

  {
    id: 'T3.SEC7',
    name: '[DB-01]/[DB-02] ProfileStore Global Flush Serialization & WriteQueue Memory Cleanup',
    fn: async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'steamstrike_db_test_'));
      const filePath = path.join(tmpDir, 'profiles.json');
      try {
        const store = new ProfileStore({ filePath, memoryOnly: false });
        await store.init();

        // Launch 15 concurrent profile creations & updates across different IDs
        const ids = Array.from({ length: 15 }, (_, i) => `concurrent_acc_${i}`);
        await Promise.all(ids.map(async (id, idx) => {
          await store.createProfile({ id, username: `User_${idx}` });
          await store.updateIdentity(id, { username: `Updated_${idx}`, emblem: 'tesla_coil' });
        }));

        // Verify writeQueues Map cleaned up all keys (.finally() memory leak fix)
        assert.strictEqual(store.writeQueues.size, 0, 'ProfileStore.writeQueues must be empty after concurrent tasks settle');

        // Reload from disk into a fresh store instance to verify zero lost updates
        const verifyStore = new ProfileStore({ filePath, memoryOnly: false });
        await verifyStore.init();
        for (let i = 0; i < ids.length; i++) {
          const loaded = await verifyStore.getProfile(ids[i]);
          assert.ok(loaded, `Profile ${ids[i]} must be persisted on disk`);
          assert.strictEqual(loaded.username, `Updated_${i}`, `Profile ${ids[i]} must retain its updated username`);
          assert.strictEqual(loaded.emblem, 'tesla_coil', `Profile ${ids[i]} must retain its updated emblem`);
        }
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    }
  }
];

export async function run() {
  return await runSuiteHelper(suiteName, tests);
}
