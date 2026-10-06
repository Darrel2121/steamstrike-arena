/**
 * Steampunk Tactical Shooter - Primary Server Entry Point
 * Hosts HTTP static asset server and WebSocket GameServer at port 3000 (or process.env.PORT)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameServer } from './GameServer.js';
import { authService } from './auth/AuthService.js';
import { profileStore } from './db/ProfileStore.js';
import { bugReportStore } from './db/BugReportStore.js';
import { gameConfigStore } from './db/GameConfigStore.js';
import { GAME_SETTING_CATEGORIES, GAME_SETTINGS_SCHEMA, GAME_SETTING_PRESETS } from '../shared/GameSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');
const SHARED_DIR = path.join(ROOT_DIR, 'shared');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

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

/**
 * Creates and starts the HTTP & WebSocket server.
 * @param {number} [port=3000]
 * @returns {{ server: http.Server, wss: WebSocketServer, gameServer: GameServer }}
 */
export function startServer(port = process.env.PORT || 3000) {
  const gameServer = new GameServer();

  const server = http.createServer(async (req, res) => {
    // Basic CORS & caching headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // REST API Routing
    if (pathname.startsWith('/api/')) {
      const sendJson = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      };

      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const userPayload = token ? authService.verifyToken(token) : null;

      try {
        // POST /api/auth/guest
        if (pathname === '/api/auth/guest' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const result = await authService.createOrRestoreGuestSession(body.guestId, body.preferredName);
          return sendJson(200, { success: true, ...result });
        }

        // POST /api/auth/google
        if (pathname === '/api/auth/google' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const result = await authService.authenticateGoogle(body.idToken);
          return sendJson(200, { success: true, ...result });
        }

        // POST /api/auth/link
        if (pathname === '/api/auth/link' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const accountId = userPayload?.accountId || body.guestId || body.guestProfile?.id;
          if (!accountId) {
            return sendJson(401, { success: false, error: 'Unauthorized or missing guest account ID' });
          }
          const result = await authService.linkGuestToGoogle(accountId, body.idToken, body.resolution || body.strategy || 'merge');
          return sendJson(200, { success: true, ...result });
        }

        // GET /api/auth/me or GET /api/profile
        if ((pathname === '/api/auth/me' || pathname === '/api/profile') && req.method === 'GET') {
          if (!userPayload) return sendJson(401, { success: false, error: 'Unauthorized' });
          const profile = await profileStore.getProfile(userPayload.accountId);
          if (!profile) return sendJson(404, { success: false, error: 'Profile not found' });
          return sendJson(200, { success: true, profile });
        }

        // POST /api/profile/upgrade/character
        if (pathname === '/api/profile/upgrade/character' && req.method === 'POST') {
          if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
          const profile = await profileStore.getProfile(userPayload.accountId);
          if (profile && profile.isGuest) {
            return sendJson(403, { success: false, error: 'Registration required: character upgrades are restricted to registered Google accounts' });
          }
          const body = await parseJsonBody(req);
          const accountId = userPayload.accountId;
          const result = await profileStore.upgradeCharacter(accountId, body.stat || body.attribute);
          return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
        }

        // POST /api/profile/upgrade/weapon
        if (pathname === '/api/profile/upgrade/weapon' && req.method === 'POST') {
          if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
          const profile = await profileStore.getProfile(userPayload.accountId);
          if (profile && profile.isGuest) {
            return sendJson(403, { success: false, error: 'Registration required: weapon upgrades are restricted to registered Google accounts' });
          }
          const body = await parseJsonBody(req);
          const accountId = userPayload.accountId;
          const result = await profileStore.upgradeWeapon(accountId, body.weaponId, body.stat || body.upgradeType);
          return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
        }

        // POST /api/profile/unlock/weapon
        if (pathname === '/api/profile/unlock/weapon' && req.method === 'POST') {
          if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
          const profile = await profileStore.getProfile(userPayload.accountId);
          if (profile && profile.isGuest) {
            return sendJson(403, { success: false, error: 'Registration required: weapon blueprints are restricted to registered Google accounts' });
          }
          const body = await parseJsonBody(req);
          const accountId = userPayload.accountId;
          const result = await profileStore.unlockWeapon(accountId, body.weaponId);
          return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
        }

        // POST /api/profile/upgrade (generic character or weapon upgrade)
        if (pathname === '/api/profile/upgrade' && req.method === 'POST') {
          if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
          const profile = await profileStore.getProfile(userPayload.accountId);
          if (profile && profile.isGuest) {
            return sendJson(403, { success: false, error: 'Registration required: upgrades are restricted to registered Google accounts' });
          }
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

        // POST /api/profile/transmute (Scrap-to-Core transmutation)
        if (pathname === '/api/profile/transmute' && req.method === 'POST') {
          if (!userPayload?.accountId) return sendJson(401, { success: false, error: 'Unauthorized: valid token required' });
          const profile = await profileStore.getProfile(userPayload.accountId);
          if (profile && profile.isGuest) {
            return sendJson(403, { success: false, error: 'Registration required: transmutation is restricted to registered Google accounts' });
          }
          const body = await parseJsonBody(req);
          const result = await profileStore.transmuteScrap(userPayload.accountId, body.coresToConvert || body.cores || 1);
          return sendJson(result.ok ? 200 : 400, { success: result.ok, ...result });
        }

        // POST /api/profile/equip (Equip weapon or hero class)
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

          // Also synchronize active WebSocket rooms if present
          if (accountId && gameServer) {
            for (const [, room] of gameServer.rooms) {
              for (const [, player] of room.players) {
                if (player.profile?.id === accountId || player.id === accountId) {
                  room.updatePlayerLoadout(player.id, {
                    weaponId,
                    classId,
                    profile: updatedProfile
                  });
                }
              }
            }
          }

          return sendJson(200, {
            success: true,
            equippedWeapon: weaponId,
            equippedClass: classId,
            profile: updatedProfile
          });
        }

        // POST /api/profile/identity (Update callsign and heraldic emblem)
        if (pathname === '/api/profile/identity' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const accountId = userPayload?.accountId || body.guestId || body.profileId;
          if (!accountId) return sendJson(400, { success: false, error: 'Missing profile ID' });

          const username = body.username ? String(body.username).trim().slice(0, 32) : undefined;
          const emblem = body.emblem ? String(body.emblem).trim() : undefined;

          const result = await profileStore.updateIdentity(accountId, { username, emblem });

          // Also synchronize active WebSocket rooms if present
          if (accountId && gameServer) {
            for (const [, room] of gameServer.rooms) {
              for (const [, player] of room.players) {
                if (player.profile?.id === accountId || player.id === accountId) {
                  if (username) player.name = username;
                  if (emblem) player.emblem = emblem;
                  player.profile = result.profile;
                  if (room.state === 'LOBBY') {
                    room.broadcastLobbyState();
                  }
                }
              }
            }
          }

          return sendJson(200, {
            success: true,
            username: result.username,
            emblem: result.emblem,
            profile: result.profile
          });
        }

        // POST /api/match/reward
        if (pathname === '/api/match/reward' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const accountId = userPayload?.accountId || body.profileId || body.playerId;
          if (!accountId) return sendJson(400, { success: false, error: 'Missing profile ID' });
          const result = await profileStore.recordMatchResult(accountId, body);
          return sendJson(200, { success: true, ...result });
        }

        // POST /api/feedback/bug
        if (pathname === '/api/feedback/bug' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!body.description || !String(body.description).trim()) {
            return sendJson(400, { success: false, error: 'Будь ласка, введіть опис проблеми' });
          }
          const clientInfo = {
            ...body.clientInfo,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            userId: userPayload?.accountId || null
          };
          const report = await bugReportStore.addReport({
            category: body.category,
            description: body.description,
            contact: body.contact,
            clientInfo
          });
          return sendJson(200, {
            success: true,
            reportId: report.id,
            message: 'Дякуємо! Ваш звіт успішно передано команді інженерів Steamstrike.'
          });
        }

        // GET /api/rooms
        if (pathname === '/api/rooms' && req.method === 'GET') {
          return sendJson(200, {
            success: true,
            rooms: gameServer.getActiveRooms()
          });
        }

        // ======================================================================
        // ADMIN PANEL & RUNTIME GAME SETTINGS API
        // ======================================================================

        const checkAdminAuth = (body = null) => {
          const adminKeyHeader = req.headers['x-admin-key'];
          if (adminKeyHeader && gameConfigStore.verifyAdminPassword(adminKeyHeader)) return true;
          
          const authHeader = req.headers['authorization'];
          if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            if (token === 'admin_authorized_token' || gameConfigStore.verifyAdminPassword(token)) return true;
            const payload = authService.verifyToken(token);
            if (payload?.isAdmin) return true;
          }

          if (body?.adminPassword && gameConfigStore.verifyAdminPassword(body.adminPassword)) return true;
          if (body?.adminKey && gameConfigStore.verifyAdminPassword(body.adminKey)) return true;
          if (body?.password && gameConfigStore.verifyAdminPassword(body.password)) return true;

          return false;
        };

        // POST /api/admin/auth
        if (pathname === '/api/admin/auth' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const password = body.password || body.adminKey || body.adminPassword;
          if (!gameConfigStore.verifyAdminPassword(password)) {
            return sendJson(401, { success: false, error: 'Невірний ключ або пароль адміністратора' });
          }
          return sendJson(200, {
            success: true,
            adminToken: 'admin_authorized_token',
            message: 'Успішна авторизація адміністратора Steamstrike',
            ...gameConfigStore.getFullAdminPayload()
          });
        }

        // GET /api/admin/config
        if (pathname === '/api/admin/config' && req.method === 'GET') {
          if (!checkAdminAuth()) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          return sendJson(200, {
            success: true,
            ...gameConfigStore.getFullAdminPayload()
          });
        }

        // POST /api/admin/config
        if (pathname === '/api/admin/config' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const payloadSettings = body.settings || body;
          const updated = gameConfigStore.updateSettings(payloadSettings);
          return sendJson(200, {
            success: true,
            message: 'Параметри гри успішно збережено та застосовано!',
            settings: updated
          });
        }

        // POST /api/admin/config/preset
        if (pathname === '/api/admin/config/preset' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          if (!body.presetId) {
            return sendJson(400, { success: false, error: 'Не вказано ідентифікатор пресету (presetId)' });
          }
          const updated = gameConfigStore.applyPreset(body.presetId);
          return sendJson(200, {
            success: true,
            message: `Пресет '${body.presetId}' успішно застосовано!`,
            settings: updated
          });
        }

        // POST /api/admin/config/reset
        if (pathname === '/api/admin/config/reset' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const defaults = gameConfigStore.resetToDefaults();
          return sendJson(200, {
            success: true,
            message: 'Параметри скинуто до заводських стандартних значень',
            settings: defaults
          });
        }

        // GET /api/config/public
        if (pathname === '/api/config/public' && req.method === 'GET') {
          return sendJson(200, {
            success: true,
            settings: gameConfigStore.getSettings(),
            categories: GAME_SETTING_CATEGORIES,
            schema: GAME_SETTINGS_SCHEMA,
            presets: GAME_SETTING_PRESETS
          });
        }

        return sendJson(404, { success: false, error: 'API endpoint not found' });
      } catch (err) {
        return sendJson(400, { success: false, error: err.message });
      }
    }

    if (pathname === '/') {
      pathname = '/index.html';
    }

    // Determine target local filesystem path
    let filePath;
    if (pathname.startsWith('/shared/')) {
      filePath = path.join(SHARED_DIR, pathname.slice(8));
    } else {
      filePath = path.join(CLIENT_DIR, pathname);
    }

    // Prevent directory traversal outside ROOT_DIR
    const safePath = path.resolve(filePath);
    if (!safePath.startsWith(ROOT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(safePath);
      stream.pipe(res);
    });
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', async (socket, req) => {
    let profile = null;
    let token = null;

    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      token = parsedUrl.searchParams.get('token');
      if (token) {
        const userPayload = authService.verifyToken(token);
        if (userPayload?.accountId) {
          profile = await profileStore.getProfile(userPayload.accountId);
        }
      }
    } catch (_) {}

    const meta = {
      ip: req.socket.remoteAddress,
      id: profile?.id || `client_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      profile,
      token
    };
    socket.meta = meta;
    socket.profile = profile;
    gameServer.handleConnection(socket, meta);
  });

  server.listen(port, () => {
    console.log(`[Steampunk Tactical Server] Listening on http://localhost:${port}`);
    console.log(`[Steampunk Tactical Server] WebSocket server active`);
  });

  return { server, wss, gameServer };
}

// Auto-start if run directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const PORT = process.env.PORT || 3000;
  startServer(PORT);
}

export default startServer;
