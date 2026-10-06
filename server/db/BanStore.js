/**
 * BanStore.js
 * Persistent moderation & player bans store for Steamstrike.
 * Persists to data/bans.json and enforces real-time network and REST restrictions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DEFAULT_BANS_FILE = path.join(DEFAULT_DATA_DIR, 'bans.json');

export class BanStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.dataDir]
   * @param {string} [options.filePath]
   * @param {boolean} [options.memoryOnly]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.filePath = options.filePath || DEFAULT_BANS_FILE;
    this.memoryOnly = options.memoryOnly ?? false;
    this.bans = []; // Array of ban records
    this.writeQueue = Promise.resolve();

    if (!this.memoryOnly) {
      this.initSync();
    }
  }

  initSync() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.bans = parsed;
        }
      }
    } catch (err) {
      console.warn('[BanStore] Failed to load existing bans:', err.message);
      this.bans = [];
    }
  }

  /**
   * Adds a ban record.
   * @param {Object} banData
   * @returns {Promise<Object>}
   */
  async addBan(banData = {}) {
    const id = `ban_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const record = {
      id,
      targetType: banData.targetType || 'profileId', // 'profileId' | 'ip' | 'callsign'
      targetValue: String(banData.targetValue || '').trim(),
      reason: String(banData.reason || 'Порушення правил гри / Чітерство').trim().slice(0, 500),
      bannedBy: String(banData.bannedBy || 'Адміністратор').trim(),
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      expiresAt: banData.expiresAt || null // null for permanent, or timestamp
    };

    if (!record.targetValue) {
      throw new Error('Необхідно вказати ID, IP або позивний для блокування');
    }

    // Remove existing ban with identical target to prevent duplicates
    this.bans = this.bans.filter(b => !(b.targetType === record.targetType && b.targetValue === record.targetValue));
    this.bans.unshift(record);

    if (!this.memoryOnly) {
      this.scheduleSave();
    }

    return record;
  }

  /**
   * Removes a ban by ID or targetValue.
   * @param {string} banIdOrTarget
   * @returns {Promise<boolean>}
   */
  async removeBan(banIdOrTarget) {
    const beforeLen = this.bans.length;
    this.bans = this.bans.filter(b => b.id !== banIdOrTarget && b.targetValue !== banIdOrTarget);
    const removed = this.bans.length < beforeLen;
    if (removed && !this.memoryOnly) {
      this.scheduleSave();
    }
    return removed;
  }

  /**
   * Checks if an identity, IP, or callsign is currently banned.
   * @param {Object} identity
   * @param {string} [identity.profileId]
   * @param {string} [identity.ip]
   * @param {string} [identity.callsign]
   * @returns {{ banned: boolean, reason?: string, expiresAt?: number }}
   */
  checkBanned({ profileId, ip, callsign } = {}) {
    const now = Date.now();
    for (const b of this.bans) {
      // Check expiration
      if (b.expiresAt && b.expiresAt <= now) {
        continue;
      }

      if (profileId && b.targetType === 'profileId' && b.targetValue === profileId) {
        return { banned: true, reason: b.reason, expiresAt: b.expiresAt, ban: b };
      }
      if (ip && b.targetType === 'ip' && (b.targetValue === ip || ip.includes(b.targetValue))) {
        return { banned: true, reason: b.reason, expiresAt: b.expiresAt, ban: b };
      }
      if (callsign && b.targetType === 'callsign' && b.targetValue.toLowerCase() === callsign.toLowerCase()) {
        return { banned: true, reason: b.reason, expiresAt: b.expiresAt, ban: b };
      }
    }
    return { banned: false };
  }

  /**
   * Returns list of all active bans.
   */
  getBans() {
    const now = Date.now();
    return this.bans.filter(b => !b.expiresAt || b.expiresAt > now);
  }

  scheduleSave() {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        if (!fs.existsSync(this.dataDir)) {
          await fs.promises.mkdir(this.dataDir, { recursive: true });
        }
        const tempPath = `${this.filePath}.${Date.now()}_${Math.random().toString(36).substr(2, 5)}.tmp`;
        const serialized = JSON.stringify(this.bans, null, 2);
        await fs.promises.writeFile(tempPath, serialized, 'utf8');
        await fs.promises.rename(tempPath, this.filePath);
      } catch (err) {
        console.error('[BanStore] Error saving bans to disk:', err.message);
      }
    }).catch(err => {
      console.error('[BanStore] Unhandled write error:', err);
    });
  }
}

export const banStore = new BanStore();
