/**
 * Tier 3: Admin Panel & Runtime Game Settings Integration Tests
 * Validates GameSettings schema integrity, bounds clamping, presets,
 * GameConfigStore persistent file IO, admin authentication, and REST API endpoints.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import {
  GAME_SETTINGS_SCHEMA,
  GAME_SETTING_CATEGORIES,
  GAME_SETTING_PRESETS,
  getDefaultGameSettings,
  sanitizeGameSettings
} from '../../shared/GameSettings.js';
import { GameConfigStore } from '../../server/db/GameConfigStore.js';
import { startServer } from '../../server/index.js';

export const suiteName = 'Tier 3: Admin Panel & Runtime Game Settings Configuration';

function doRequest(port, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);

    if (body !== null && body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

let runningServer = null;
let serverPort = 0;

export const tests = [
  {
    id: 'ADM.1',
    name: 'GameSettings Schema & Defaults Integrity',
    fn: async () => {
      assert.ok(Array.isArray(GAME_SETTINGS_SCHEMA), 'Schema must be an array');
      assert.ok(GAME_SETTINGS_SCHEMA.length >= 20, 'Schema must define at least 20 parameters');
      assert.ok(Object.keys(GAME_SETTING_CATEGORIES).length >= 5, 'Must have at least 5 setting categories');

      const defaults = getDefaultGameSettings();
      assert.strictEqual(typeof defaults.playerWalkSpeed, 'number');
      assert.strictEqual(typeof defaults.playerRunSpeed, 'number');
      assert.strictEqual(typeof defaults.lanternFovDeg, 'number');
      assert.strictEqual(typeof defaults.lanternRange, 'number');
      assert.strictEqual(typeof defaults.soundSpeed, 'number');
      assert.strictEqual(typeof defaults.projectileSpeed, 'number');
      assert.strictEqual(typeof defaults.damageMultiplier, 'number');
      assert.strictEqual(typeof defaults.rewardWinXp, 'number');
      assert.strictEqual(typeof defaults.serverTickRate, 'number');

      // Verify all items have required metadata
      for (const item of GAME_SETTINGS_SCHEMA) {
        assert.ok(item.key, 'Setting item must have key');
        assert.ok(item.category, 'Setting item must have category');
        assert.ok(item.label, 'Setting item must have label');
        assert.ok(item.unit, 'Setting item must have unit');
        assert.ok(item.min !== undefined, 'Setting item must have min bound');
        assert.ok(item.max !== undefined, 'Setting item must have max bound');
        assert.ok(item.default >= item.min && item.default <= item.max, `Default ${item.default} must be within [${item.min}, ${item.max}] for ${item.key}`);
      }
    }
  },

  {
    id: 'ADM.2',
    name: 'GameSettings Bounds Clamping & Sanitization',
    fn: async () => {
      const sanitized = sanitizeGameSettings({
        playerWalkSpeed: 99999, // Should clamp to max 350
        playerRunSpeed: -50,    // Should clamp to min 80
        lanternFovDeg: '120',   // Coerces string to number
        damageMultiplier: 2.5
      });

      assert.strictEqual(sanitized.playerWalkSpeed, 350, 'Out-of-bounds speed must clamp to max');
      assert.strictEqual(sanitized.playerRunSpeed, 80, 'Negative speed must clamp to min');
      assert.strictEqual(sanitized.lanternFovDeg, 120, 'String value must parse to float');
      assert.strictEqual(sanitized.damageMultiplier, 2.5, 'Valid float within range must be preserved');
    }
  },

  {
    id: 'ADM.3',
    name: 'GameSettings Presets Coverage & Correctness',
    fn: async () => {
      assert.ok(GAME_SETTING_PRESETS.standard, 'Standard preset must exist');
      assert.ok(GAME_SETTING_PRESETS.high_dynamism, 'High dynamism preset must exist');
      assert.ok(GAME_SETTING_PRESETS.hardcore_darkness, 'Hardcore darkness preset must exist');
      assert.ok(GAME_SETTING_PRESETS.snipers_arena, 'Snipers arena preset must exist');

      const highDyn = GAME_SETTING_PRESETS.high_dynamism.settings;
      assert.ok(highDyn.playerRunSpeed > 220, 'High dynamism must increase run speed');
      assert.ok(highDyn.projectileSpeed > 1800, 'High dynamism must increase projectile speed');

      const stealth = GAME_SETTING_PRESETS.hardcore_darkness.settings;
      assert.ok(stealth.lanternFovDeg < 80, 'Hardcore darkness must narrow lantern FOV');
      assert.ok(stealth.gunfireSoundRadius > 168, 'Hardcore darkness must increase gunfire acoustic detection');
    }
  },

  {
    id: 'ADM.4',
    name: 'GameConfigStore Persistence & Listener Notification',
    fn: async () => {
      const store = new GameConfigStore();
      let notified = false;
      let notifiedSettings = null;

      const listener = (settings) => {
        notified = true;
        notifiedSettings = settings;
      };

      store.onSettingsChange(listener);

      const updated = store.updateSettings({
        playerWalkSpeed: 155,
        lanternRange: 500
      });

      assert.strictEqual(updated.playerWalkSpeed, 155);
      assert.strictEqual(updated.lanternRange, 500);
      assert.strictEqual(notified, true, 'Listener must be called on update');
      assert.strictEqual(notifiedSettings.playerWalkSpeed, 155);

      // Verify reset to defaults
      const reset = store.resetToDefaults();
      assert.strictEqual(reset.playerWalkSpeed, 120);
      assert.strictEqual(reset.lanternRange, 420);

      store.offSettingsChange(listener);
    }
  },

  {
    id: 'ADM.5',
    name: 'Admin Password Authentication Verification',
    fn: async () => {
      const store = new GameConfigStore();
      assert.strictEqual(store.verifyAdminPassword('steamstrike2026'), true);
      assert.strictEqual(store.verifyAdminPassword('admin'), false, 'Trivial guess admin must be rejected');
      assert.strictEqual(store.verifyAdminPassword('wrong_password'), false);
      assert.strictEqual(store.verifyAdminPassword(''), false);
      assert.strictEqual(store.verifyAdminPassword(null), false);
    }
  },

  {
    id: 'ADM.6',
    name: 'Live REST API Admin Auth & Config Management',
    fn: async () => {
      // Start server on ephemeral port
      const randomPort = 3100 + Math.floor(Math.random() * 800);
      const appInstance = startServer(randomPort);
      runningServer = appInstance.server;
      serverPort = randomPort;

      // Wait a tick for server listen
      await new Promise(r => setTimeout(r, 100));

      // 1. Unauthenticated GET /api/admin/config should return 401
      const resUnauth = await doRequest(serverPort, { path: '/api/admin/config', method: 'GET' });
      assert.strictEqual(resUnauth.status, 401, 'Unauthenticated config request must return 401');

      // 2. POST /api/admin/auth with invalid password should return 401
      const resBadLogin = await doRequest(serverPort, {
        path: '/api/admin/auth',
        method: 'POST'
      }, { password: 'incorrect_pass' });
      assert.strictEqual(resBadLogin.status, 401, 'Invalid password must return 401');

      // 3. POST /api/admin/auth with valid password should return 200 and token
      const resGoodLogin = await doRequest(serverPort, {
        path: '/api/admin/auth',
        method: 'POST'
      }, { password: 'steamstrike2026' });
      assert.strictEqual(resGoodLogin.status, 200, 'Valid admin password must return 200');
      assert.strictEqual(resGoodLogin.body.success, true);
      assert.ok(resGoodLogin.body.adminToken, 'Must return adminToken');
      assert.ok(resGoodLogin.body.settings, 'Must return current settings');

      // 4. Authenticated GET /api/admin/config
      const resAuthGet = await doRequest(serverPort, {
        path: '/api/admin/config',
        method: 'GET',
        headers: { 'x-admin-key': 'steamstrike2026' }
      });
      assert.strictEqual(resAuthGet.status, 200);
      assert.strictEqual(resAuthGet.body.success, true);
      assert.ok(resAuthGet.body.settings);

      // 5. POST /api/admin/config updates settings
      const resUpdate = await doRequest(serverPort, {
        path: '/api/admin/config',
        method: 'POST',
        headers: { 'x-admin-key': 'steamstrike2026' }
      }, {
        settings: {
          playerWalkSpeed: 175,
          lanternRange: 550
        }
      });
      assert.strictEqual(resUpdate.status, 200);
      assert.strictEqual(resUpdate.body.success, true);
      assert.strictEqual(resUpdate.body.settings.playerWalkSpeed, 175);
      assert.strictEqual(resUpdate.body.settings.lanternRange, 550);

      // 6. Public endpoint GET /api/config/public returns the live updated values
      const resPub = await doRequest(serverPort, { path: '/api/config/public', method: 'GET' });
      assert.strictEqual(resPub.status, 200);
      assert.strictEqual(resPub.body.settings.playerWalkSpeed, 175);
      assert.strictEqual(resPub.body.settings.lanternRange, 550);

      // 7. POST /api/admin/config/preset applies preset
      const resPreset = await doRequest(serverPort, {
        path: '/api/admin/config/preset',
        method: 'POST',
        headers: { 'x-admin-key': 'steamstrike2026' }
      }, { presetId: 'high_dynamism' });
      assert.strictEqual(resPreset.status, 200);
      assert.strictEqual(resPreset.body.settings.playerRunSpeed, 300);

      // 8. POST /api/admin/config/reset restores factory defaults
      const resReset = await doRequest(serverPort, {
        path: '/api/admin/config/reset',
        method: 'POST',
        headers: { 'x-admin-key': 'steamstrike2026' }
      }, {});
      assert.strictEqual(resReset.status, 200);
      assert.strictEqual(resReset.body.settings.playerWalkSpeed, 120);

      // Clean teardown of server
      if (runningServer) {
        await new Promise((res) => runningServer.close(res));
      }
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}

