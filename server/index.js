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
import { banStore } from './db/BanStore.js';
import { newsStore } from './db/NewsStore.js';
import { communityMapStore } from './db/CommunityMapStore.js';
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

// In-memory rate limiter for administrative auth
const adminFailedAttempts = new Map();

function checkAdminRateLimit(ip) {
  const now = Date.now();
  const entry = adminFailedAttempts.get(ip);
  if (entry && entry.blockedUntil && entry.blockedUntil > now) {
    const remainingSec = Math.ceil((entry.blockedUntil - now) / 1000);
    return { blocked: true, message: `Забагато невдалих спроб авторизації. Спробуйте через ${remainingSec} сек.` };
  }
  return { blocked: false };
}

function recordAdminFailure(ip) {
  const now = Date.now();
  const entry = adminFailedAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  entry.count++;
  if (entry.count >= 5) {
    entry.blockedUntil = now + (15 * 60 * 1000);
  } else if (entry.count >= 3) {
    entry.blockedUntil = now + (30 * 1000);
  }
  adminFailedAttempts.set(ip, entry);
}

function clearAdminFailure(ip) {
  adminFailedAttempts.delete(ip);
}

function sanitizeText(str, maxLen = 64) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>'"&]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Creates and starts the HTTP & WebSocket server.
 * @param {number} [port=3000]
 * @returns {{ server: http.Server, wss: WebSocketServer, gameServer: GameServer }}
 */
export function startServer(port = process.env.PORT || 3000) {
  const gameServer = new GameServer();

  const server = http.createServer(async (req, res) => {
    // Security & CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

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
        // GET /api/health or GET /health (Wakeup & Liveness Check)
        if ((pathname === '/api/health' || pathname === '/health') && req.method === 'GET') {
          return sendJson(200, {
            status: 'ok',
            uptime: Math.round(process.uptime()),
            timestamp: Date.now(),
            service: 'Steamstrike Battle Server'
          });
        }

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
          const result = await authService.linkGuestToGoogle(accountId, body.idToken, body.resolution || body.strategy || 'merge', body.guestProfile);
          return sendJson(200, { success: true, ...result });
        }

        // POST /api/profile/sync (Sync & upsert client profile with server store)
        if (pathname === '/api/profile/sync' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          const rawProfile = body.profile;
          if (!rawProfile || !rawProfile.id) {
            return sendJson(400, { success: false, error: 'Missing profile payload' });
          }
          let existing = await profileStore.getProfile(rawProfile.id);
          if (existing) {
            existing.username = rawProfile.username || existing.username;
            existing.level = Math.max(existing.level || 1, rawProfile.level || 1);
            existing.xp = Math.max(existing.xp || 0, rawProfile.xp || 0);
            if (rawProfile.emblem) existing.emblem = rawProfile.emblem;
            if (rawProfile.equippedClass) existing.equippedClass = rawProfile.equippedClass;
            if (rawProfile.equippedWeapon) existing.equippedWeapon = rawProfile.equippedWeapon;
            if (rawProfile.isGuest !== undefined) existing.isGuest = Boolean(rawProfile.isGuest);
            if (rawProfile.email) existing.email = rawProfile.email;
            if (rawProfile.googleId) existing.googleId = rawProfile.googleId;
            if (rawProfile.currency) {
              existing.currency = {
                scrap: Math.max(existing.currency?.scrap || 0, rawProfile.currency?.scrap || 0),
                cores: Math.max(existing.currency?.cores || 0, rawProfile.currency?.cores || 0)
              };
            }
            if (rawProfile.careerStats) {
              existing.careerStats = {
                matchesPlayed: Math.max(existing.careerStats?.matchesPlayed || 0, rawProfile.careerStats?.matchesPlayed || 0),
                wins: Math.max(existing.careerStats?.wins || 0, rawProfile.careerStats?.wins || 0),
                kills: Math.max(existing.careerStats?.kills || 0, rawProfile.careerStats?.kills || 0),
                damageDealt: Math.max(existing.careerStats?.damageDealt || 0, rawProfile.careerStats?.damageDealt || 0)
              };
            }
            existing.updatedAt = Date.now();
            await profileStore.save(existing);
            const token = authService.generateToken({ accountId: existing.id, isGuest: Boolean(existing.isGuest) });
            return sendJson(200, { success: true, profile: existing, token });
          } else {
            const created = await profileStore.save(rawProfile);
            const token = authService.generateToken({ accountId: created.id, isGuest: Boolean(created.isGuest) });
            return sendJson(200, { success: true, profile: created, token });
          }
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

          const username = body.username ? sanitizeText(body.username, 32) : undefined;
          const emblem = body.emblem ? sanitizeText(body.emblem, 32) : undefined;

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
          const cleanDesc = sanitizeText(body.description, 4000);
          if (!cleanDesc) {
            return sendJson(400, { success: false, error: 'Будь ласка, введіть опис проблеми' });
          }
          const clientInfo = {
            ...body.clientInfo,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            userId: userPayload?.accountId || null
          };
          const report = await bugReportStore.addReport({
            category: sanitizeText(body.category, 50) || 'general',
            description: cleanDesc,
            contact: sanitizeText(body.contact, 100),
            clientInfo
          });
          return sendJson(200, {
            success: true,
            reportId: report.id,
            message: 'Дякуємо! Ваш звіт успішно передано команді інженерів Steamstrike.'
          });
        }

        // POST /api/community-maps/submit
        if (pathname === '/api/community-maps/submit' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          try {
            const author = sanitizeText(body.author || (userPayload?.preferredName || 'Анонімний Інженер'), 40);
            const name = sanitizeText(body.name || body.map?.name || 'Власна Арена', 50);
            const description = sanitizeText(body.description || '', 1000);
            const authorId = userPayload?.accountId || body.authorId || null;

            const record = await communityMapStore.submitMap({
              name,
              author,
              authorId,
              description,
              map: body.map
            });

            return sendJson(200, {
              success: true,
              mapId: record.id,
              record,
              message: 'Карту успішно надіслано на модерацію! Після схвалення адміністратором вона з\'явиться у відкритому доступі.'
            });
          } catch (err) {
            return sendJson(400, { success: false, error: err.message });
          }
        }

        // GET /api/community-maps/published
        if (pathname === '/api/community-maps/published' && req.method === 'GET') {
          return sendJson(200, {
            success: true,
            maps: communityMapStore.getPublishedMaps()
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
          const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
          const rateCheck = checkAdminRateLimit(clientIp);
          if (rateCheck.blocked) {
            return sendJson(429, { success: false, error: rateCheck.message });
          }

          const body = await parseJsonBody(req);
          const password = body.password || body.adminKey || body.adminPassword;
          if (!gameConfigStore.verifyAdminPassword(password)) {
            recordAdminFailure(clientIp);
            return sendJson(401, { success: false, error: 'Невірний ключ або пароль адміністратора' });
          }

          clearAdminFailure(clientIp);
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

        // GET /api/news (Public news list)
        if (pathname === '/api/news' && req.method === 'GET') {
          return sendJson(200, {
            success: true,
            news: newsStore.getNews()
          });
        }

        // ======================================================================
        // ADMIN DASHBOARD & ADVANCED MANAGEMENT ENDPOINTS
        // ======================================================================

        // GET /api/admin/stats
        if (pathname === '/api/admin/stats' && req.method === 'GET') {
          if (!checkAdminAuth()) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }

          let activePlayersCount = 0;
          let activeBotsCount = 0;
          const roomsSummary = [];

          if (gameServer) {
            for (const [rId, room] of gameServer.rooms) {
              const humanPlayers = Array.from(room.players.values()).filter(p => !p.isBot).length;
              const botCount = room.bots ? room.bots.size : 0;
              activePlayersCount += humanPlayers;
              activeBotsCount += botCount;
              roomsSummary.push({
                id: rId,
                map: room.map?.name || 'Standard Arena',
                mode: room.gameMode,
                state: room.state,
                humans: humanPlayers,
                bots: botCount,
                locked: Boolean(room.password)
              });
            }
          }

          const allProfiles = await profileStore.getAllProfiles();
          const leaderboard = [...allProfiles]
            .sort((a, b) => (b.xp || 0) - (a.xp || 0))
            .slice(0, 10)
            .map(p => ({
              id: p.id,
              username: p.username || 'Невідомий',
              level: p.level || 1,
              xp: p.xp || 0,
              emblem: p.emblem || 'gear',
              matches: p.careerStats?.matchesPlayed || 0,
              wins: p.careerStats?.wins || 0,
              kills: p.careerStats?.kills || 0
            }));

          const allBugs = bugReportStore.getAllReports();
          const bugStats = {
            total: allBugs.length,
            new: allBugs.filter(b => b.status === 'new').length,
            in_progress: allBugs.filter(b => b.status === 'in_progress').length,
            resolved: allBugs.filter(b => b.status === 'resolved').length
          };

          const allCommunityMaps = communityMapStore.getAllMaps();
          const mapStats = {
            total: allCommunityMaps.length,
            pending: allCommunityMaps.filter(m => m.status === 'pending').length,
            approved: allCommunityMaps.filter(m => m.status === 'approved').length,
            rejected: allCommunityMaps.filter(m => m.status === 'rejected').length
          };

          return sendJson(200, {
            success: true,
            stats: {
              activeRooms: gameServer ? gameServer.rooms.size : 0,
              activePlayers: activePlayersCount,
              activeBots: activeBotsCount,
              totalRegisteredProfiles: allProfiles.length,
              totalBans: banStore.getBans().length,
              uptimeSeconds: Math.floor(process.uptime()),
              memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
              nodeVersion: process.version,
              rooms: roomsSummary,
              leaderboard,
              bugs: bugStats,
              communityMaps: mapStats
            }
          });
        }

        // GET /api/admin/players
        if (pathname === '/api/admin/players' && req.method === 'GET') {
          if (!checkAdminAuth()) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }

          const allProfiles = await profileStore.getAllProfiles();
          const profilesMap = new Map();
          for (const p of allProfiles) {
            if (p && p.id) profilesMap.set(p.id, p);
          }

          // Check live active room players
          if (gameServer) {
            for (const [, room] of gameServer.rooms) {
              for (const [, player] of room.players) {
                if (player && !player.isBot && player.profile && player.profile.id) {
                  if (!profilesMap.has(player.profile.id)) {
                    profilesMap.set(player.profile.id, {
                      ...player.profile,
                      isLiveOnline: true,
                      currentRoom: room.id
                    });
                  } else {
                    const existing = profilesMap.get(player.profile.id);
                    existing.isLiveOnline = true;
                    existing.currentRoom = room.id;
                  }
                }
              }
            }
          }

          const combinedProfiles = Array.from(profilesMap.values());
          const activeBans = banStore.getBans();

          const playersWithBanInfo = combinedProfiles.map(p => {
            const isBanned = activeBans.some(b => 
              (b.targetType === 'profileId' && b.targetValue === p.id) ||
              (b.targetType === 'callsign' && p.username && b.targetValue.toLowerCase() === p.username.toLowerCase())
            );
            return {
              id: p.id,
              username: p.username || 'Cadet',
              level: p.level || 1,
              xp: p.xp || 0,
              emblem: p.emblem || 'gear',
              equippedClass: p.equippedClass || 'vanguard',
              equippedWeapon: p.equippedWeapon || 'revolver',
              isGuest: Boolean(p.isGuest),
              isLiveOnline: Boolean(p.isLiveOnline),
              currentRoom: p.currentRoom || null,
              createdAt: p.createdAt,
              updatedAt: p.updatedAt,
              career: p.careerStats || {},
              isBanned
            };
          });

          return sendJson(200, {
            success: true,
            players: playersWithBanInfo,
            bans: activeBans
          });
        }

        // POST /api/admin/players/ban
        if (pathname === '/api/admin/players/ban' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }

          const banRecord = await banStore.addBan({
            targetType: body.targetType || 'profileId',
            targetValue: body.targetValue,
            reason: body.reason || 'Блокування адміністратором',
            bannedBy: 'Admin',
            expiresAt: body.expiresAt || null
          });

          // Disconnect matching active sockets across all rooms
          if (gameServer) {
            for (const [, room] of gameServer.rooms) {
              for (const [pId, player] of room.players) {
                if (
                  (body.targetType === 'profileId' && (player.profile?.id === body.targetValue || pId === body.targetValue)) ||
                  (body.targetType === 'callsign' && player.name?.toLowerCase() === String(body.targetValue).toLowerCase()) ||
                  (body.targetType === 'ip' && player.socket?.meta?.ip === body.targetValue)
                ) {
                  player.socket?.send(JSON.stringify({
                    type: 's2c_banned',
                    reason: banRecord.reason
                  }));
                  try { player.socket?.close(4003, 'Banned'); } catch (_) {}
                  room.removePlayer(pId);
                }
              }
            }
          }

          return sendJson(200, {
            success: true,
            message: `Гравця '${body.targetValue}' успішно заблоковано`,
            ban: banRecord
          });
        }

        // POST /api/admin/players/unban
        if (pathname === '/api/admin/players/unban' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }

          const target = body.id || body.targetValue || body.profileId;
          const removed = await banStore.removeBan(target);
          return sendJson(200, {
            success: true,
            removed,
            message: removed ? 'Блокування успішно скасовано' : 'Блокування не знайдено'
          });
        }

        // POST /api/admin/players/kick
        if (pathname === '/api/admin/players/kick' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }

          const playerId = body.playerId || body.profileId;
          let kicked = false;

          if (gameServer && playerId) {
            for (const [, room] of gameServer.rooms) {
              for (const [pId, player] of room.players) {
                if (pId === playerId || player.profile?.id === playerId || player.name === playerId) {
                  player.socket?.send(JSON.stringify({
                    type: 's2c_error',
                    message: 'Вас було виключено з матчу адміністратором'
                  }));
                  try { player.socket?.close(4002, 'Kicked'); } catch (_) {}
                  room.removePlayer(pId);
                  kicked = true;
                }
              }
            }
          }

          return sendJson(200, {
            success: true,
            kicked,
            message: kicked ? 'Гравця успішно виключено з матчу' : 'Гравця не знайдено в активних кімнатах'
          });
        }

        // GET /api/admin/bugs
        if (pathname === '/api/admin/bugs' && req.method === 'GET') {
          if (!checkAdminAuth()) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          return sendJson(200, {
            success: true,
            reports: bugReportStore.getAllReports()
          });
        }

        // POST /api/admin/bugs/status
        if (pathname === '/api/admin/bugs/status' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const updated = await bugReportStore.updateReportStatus(body.id, body.status);
          if (!updated) return sendJson(404, { success: false, error: 'Звіт не знайдено' });
          return sendJson(200, {
            success: true,
            report: updated
          });
        }

        // POST /api/admin/bugs/delete
        if (pathname === '/api/admin/bugs/delete' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const removed = await bugReportStore.deleteReport(body.id);
          return sendJson(200, {
            success: true,
            removed
          });
        }

        // GET /api/admin/news
        if (pathname === '/api/admin/news' && req.method === 'GET') {
          if (!checkAdminAuth()) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          return sendJson(200, {
            success: true,
            news: newsStore.getNews(100)
          });
        }

        // POST /api/admin/news
        if (pathname === '/api/admin/news' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const article = await newsStore.createNews(body);
          return sendJson(200, {
            success: true,
            article,
            message: 'Новину успішно опубліковано'
          });
        }

        // POST /api/admin/news/update
        if (pathname === '/api/admin/news/update' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const updated = await newsStore.updateNews(body.id, body);
          if (!updated) return sendJson(404, { success: false, error: 'Новину не знайдено' });
          return sendJson(200, {
            success: true,
            article: updated,
            message: 'Новину успішно оновлено'
          });
        }

        // POST /api/admin/news/delete
        if (pathname === '/api/admin/news/delete' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const removed = await newsStore.deleteNews(body.id);
          return sendJson(200, {
            success: true,
            removed,
            message: removed ? 'Новину успішно видалено' : 'Новину не знайдено'
          });
        }

        // ======================================================================
        // COMMUNITY MAPS MODERATION API
        // ======================================================================

        // GET /api/admin/community-maps
        if (pathname === '/api/admin/community-maps' && req.method === 'GET') {
          if (!checkAdminAuth()) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          const status = parsedUrl.searchParams.get('status') || null;
          return sendJson(200, {
            success: true,
            maps: communityMapStore.getAllMaps(status)
          });
        }

        // POST /api/admin/community-maps/status
        if (pathname === '/api/admin/community-maps/status' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          if (!body.id || !body.status) {
            return sendJson(400, { success: false, error: 'Не вказано ID карти або новий статус' });
          }
          const updated = await communityMapStore.updateMapStatus(body.id, body.status, body.reviewNote || '');
          if (!updated) return sendJson(404, { success: false, error: 'Карту не знайдено' });
          return sendJson(200, {
            success: true,
            map: updated,
            message: `Статус карти успішно оновлено на '${body.status}'`
          });
        }

        // POST /api/admin/community-maps/delete
        if (pathname === '/api/admin/community-maps/delete' && req.method === 'POST') {
          const body = await parseJsonBody(req);
          if (!checkAdminAuth(body)) {
            return sendJson(401, { success: false, error: 'Потрібна авторизація адміністратора' });
          }
          if (!body.id) {
            return sendJson(400, { success: false, error: 'Не вказано ID карти' });
          }
          const removed = await communityMapStore.deleteMap(body.id);
          return sendJson(200, {
            success: true,
            removed,
            message: removed ? 'Карту успішно видалено' : 'Карту не знайдено'
          });
        }

        return sendJson(404, { success: false, error: 'API endpoint not found' });
      } catch (err) {
        return sendJson(400, { success: false, error: err.message });
      }
    }

    if (pathname === '/') {
      pathname = '/index.html';
    } else if (pathname === '/admin') {
      pathname = '/admin.html';
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

    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();

    // Check if player or IP is banned
    const banCheck = banStore.checkBanned({
      profileId: profile?.id,
      ip: clientIp,
      callsign: profile?.username
    });

    if (banCheck.banned) {
      try {
        socket.send(JSON.stringify({
          type: 's2c_banned',
          reason: banCheck.reason || 'Ваш акаунт заблоковано адміністрацією'
        }));
        socket.close(4003, 'Banned');
      } catch (_) {}
      return;
    }

    const meta = {
      ip: clientIp,
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
