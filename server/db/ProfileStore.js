/**
 * Atomic Server-Side Profile Store
 * Provides concurrency-safe in-memory caching, queue-serialized mutations,
 * and crash-resilient atomic file persistence (temp write + rename with Windows exponential backoff).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_UPGRADE_TIER,
  CHARACTER_UPGRADE_COSTS,
  WEAPON_UPGRADE_COSTS,
  WEAPON_UNLOCK_COSTS,
  calculateLevelFromTotalXp,
  calculateMatchRewards,
  createDefaultProfile,
  transmuteScrapToCores
} from '../../shared/ProgressionSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DEFAULT_PROFILES_FILE = path.join(DEFAULT_DATA_DIR, 'profiles.json');

export class ProfileStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.dataDir]
   * @param {string} [options.filePath]
   * @param {boolean} [options.memoryOnly]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.filePath = options.filePath || DEFAULT_PROFILES_FILE;
    this.memoryOnly = options.memoryOnly ?? false;
    this.cache = new Map(); // profileId -> profile object
    this.googleIndex = new Map(); // googleId -> profileId
    this.writeQueues = new Map(); // profileId -> Promise chain
    this.isLoaded = false;

    if (!this.memoryOnly) {
      this.initSync();
    }
  }

  /**
   * Synchronous initial load for fast server startup.
   */
  initSync() {
    if (this.isLoaded || this.memoryOnly) return;
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const items = Array.isArray(parsed) ? parsed : Object.values(parsed);
          for (const item of items) {
            if (item && item.id) {
              this.cache.set(item.id, item);
              if (item.googleId) this.googleIndex.set(item.googleId, item.id);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[ProfileStore] Failed to read ${this.filePath}, initializing fresh:`, err.message);
    }
    this.isLoaded = true;
  }

  /**
   * Asynchronous initialization.
   */
  async init() {
    if (this.isLoaded) return;
    this.initSync();
    this.isLoaded = true;
  }

  /**
   * Serializes mutations on a specific profile ID to eliminate race conditions.
   * @param {string} profileId
   * @param {Function} taskFn - async function returning result
   * @returns {Promise<any>}
   */
  async enqueue(profileId, taskFn) {
    await this.init();
    const queueKey = profileId || '__global__';
    const current = this.writeQueues.get(queueKey) || Promise.resolve();

    const next = current.then(async () => {
      return await taskFn();
    });

    this.writeQueues.set(queueKey, next.catch(() => {}));
    return await next;
  }

  /**
   * Atomically writes data to disk using temporary file + rename.
   * Windows-resilient with exponential backoff and copy+unlink fallback.
   * @param {string} targetPath
   * @param {Object} data
   */
  async atomicWriteFile(targetPath, data) {
    if (this.memoryOnly || !targetPath) return;

    const dir = path.dirname(targetPath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    const payload = JSON.stringify(data, null, 2);

    await fs.promises.writeFile(tmpPath, payload, 'utf8');

    let attempts = 0;
    while (attempts < 5) {
      try {
        await fs.promises.rename(tmpPath, targetPath);
        return;
      } catch (err) {
        attempts++;
        if (attempts >= 5) {
          try {
            await fs.promises.copyFile(tmpPath, targetPath);
            await fs.promises.unlink(tmpPath).catch(() => {});
            return;
          } catch (copyErr) {
            await fs.promises.unlink(tmpPath).catch(() => {});
            throw err;
          }
        }
        await new Promise(res => setTimeout(res, attempts * 15));
      }
    }
  }

  /**
   * Flushes in-memory cache to disk atomically.
   */
  async flush() {
    if (this.memoryOnly) return;
    const dump = {};
    for (const [id, profile] of this.cache.entries()) {
      dump[id] = profile;
    }
    await this.atomicWriteFile(this.filePath, dump);
  }

  /**
   * Retrieves profile by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getProfile(id) {
    await this.init();
    if (!id) return null;
    return this.cache.get(id) || null;
  }

  async get(id) {
    return this.getProfile(id);
  }

  /**
   * Finds profile by linked Google ID.
   * @param {string} googleId
   * @returns {Promise<Object|null>}
   */
  async findByGoogleId(googleId) {
    await this.init();
    if (!googleId) return null;
    const id = this.googleIndex.get(googleId);
    return id ? (this.cache.get(id) || null) : null;
  }

  /**
   * Persists or updates a profile in cache and disk.
   * @param {Object} profile
   * @returns {Promise<Object>}
   */
  async save(profile) {
    if (!profile || !profile.id) throw new Error('Profile must have an ID');
    return this.enqueue(profile.id, async () => {
      this.cache.set(profile.id, profile);
      if (profile.googleId) {
        this.googleIndex.set(profile.googleId, profile.id);
      }
      await this.flush();
      return profile;
    });
  }

  /**
   * Creates a new profile and saves it.
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async createProfile(options = {}) {
    return this.enqueue(options.id || '__create__', async () => {
      const profile = createDefaultProfile(options);
      this.cache.set(profile.id, profile);
      if (profile.googleId) {
        this.googleIndex.set(profile.googleId, profile.id);
      }
      await this.flush();
      return profile;
    });
  }

  /**
   * Deletes a profile from store.
   * @param {string} id
   */
  async delete(id) {
    return this.enqueue(id, async () => {
      const existing = this.cache.get(id);
      if (existing && existing.googleId) {
        this.googleIndex.delete(existing.googleId);
      }
      this.cache.delete(id);
      await this.flush();
    });
  }

  /**
   * Upgrades a character attribute tier.
   * @param {string} profileId
   * @param {'health'|'speed'|'lantern'|'maxHp'} attribute
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string, upgraded?: Object }>}
   */
  async upgradeCharacter(profileId, attribute) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };

      let canonicalAttr = attribute;
      if (attribute === 'maxHp' || attribute === 'health') canonicalAttr = 'health';
      if (attribute === 'speed') canonicalAttr = 'speed';
      if (attribute === 'lantern') canonicalAttr = 'lantern';

      const tierKey = `${canonicalAttr}Tier`;
      const levelKey = canonicalAttr === 'health' ? 'maxHpLevel' : `${canonicalAttr}Level`;

      profile.characterStats = profile.characterStats || {};
      const currentTier = profile.characterStats[tierKey] ?? profile.characterStats[levelKey] ?? 0;

      if (currentTier >= MAX_UPGRADE_TIER) {
        return { ok: false, error: `Attribute ${attribute} is already at maximum tier (${MAX_UPGRADE_TIER})` };
      }

      const cost = CHARACTER_UPGRADE_COSTS[currentTier];
      if (!cost) {
        return { ok: false, error: 'Cost calculation error' };
      }

      profile.currency = profile.currency || { scrap: 0, cores: 0 };
      if (profile.currency.scrap < cost.scrap || (cost.cores && profile.currency.cores < cost.cores)) {
        return {
          ok: false,
          error: 'Insufficient currency',
          required: cost,
          current: profile.currency
        };
      }

      // Deduct currency & advance tier
      profile.currency.scrap -= cost.scrap;
      profile.currency.cores = Math.max(0, (profile.currency.cores || 0) - (cost.cores || 0));

      const newTier = currentTier + 1;
      profile.characterStats[tierKey] = newTier;
      profile.characterStats[levelKey] = newTier;
      profile.updatedAt = Date.now();

      await this.flush();

      return {
        ok: true,
        profile,
        upgraded: {
          attribute: canonicalAttr,
          newTier,
          cost
        }
      };
    });
  }

  async upgradeCharacterStat(profileId, attribute) {
    return this.upgradeCharacter(profileId, attribute);
  }

  /**
   * Upgrades a weapon stat tier.
   * @param {string} profileId
   * @param {string} weaponId
   * @param {'damage'|'fireRate'|'reload'|'capacity'} stat
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string, upgraded?: Object }>}
   */
  async upgradeWeapon(profileId, weaponId, stat) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };

      if (!profile.weapons || !profile.weapons[weaponId]) {
        return { ok: false, error: `Invalid weapon ID: ${weaponId}` };
      }

      const weaponTiers = profile.weapons[weaponId];
      if (!weaponTiers.unlocked) {
        return { ok: false, error: `Weapon ${weaponId} is locked` };
      }

      const tierKey = `${stat}Tier`;
      const levelKey = `${stat}Level`;
      const currentTier = weaponTiers[tierKey] ?? weaponTiers[levelKey] ?? 0;

      if (currentTier >= MAX_UPGRADE_TIER) {
        return { ok: false, error: `Weapon stat ${stat} is already at maximum tier (${MAX_UPGRADE_TIER})` };
      }

      const cost = WEAPON_UPGRADE_COSTS[currentTier];
      if (!cost) {
        return { ok: false, error: 'Cost calculation error' };
      }

      profile.currency = profile.currency || { scrap: 0, cores: 0 };
      if (profile.currency.scrap < cost.scrap || (cost.cores && profile.currency.cores < cost.cores)) {
        return {
          ok: false,
          error: 'Insufficient currency',
          required: cost,
          current: profile.currency
        };
      }

      // Deduct currency & advance tier
      profile.currency.scrap -= cost.scrap;
      profile.currency.cores = Math.max(0, (profile.currency.cores || 0) - (cost.cores || 0));

      const newTier = currentTier + 1;
      weaponTiers[tierKey] = newTier;
      weaponTiers[levelKey] = newTier;
      profile.updatedAt = Date.now();

      await this.flush();

      return {
        ok: true,
        profile,
        upgraded: {
          weaponId,
          stat,
          newTier,
          cost
        }
      };
    });
  }

  async upgradeWeaponStat(profileId, weaponId, stat) {
    return this.upgradeWeapon(profileId, weaponId, stat);
  }

  /**
   * Unlocks a weapon.
   * @param {string} profileId
   * @param {string} weaponId
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string }>}
   */
  async unlockWeapon(profileId, weaponId) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };

      if (!profile.weapons || !profile.weapons[weaponId]) {
        return { ok: false, error: `Invalid weapon ID: ${weaponId}` };
      }

      const weapon = profile.weapons[weaponId];
      if (weapon.unlocked) {
        return { ok: true, profile, message: 'Already unlocked' };
      }

      const cost = WEAPON_UNLOCK_COSTS[weaponId] || { scrap: 300, cores: 1 };
      profile.currency = profile.currency || { scrap: 0, cores: 0 };

      if (profile.currency.scrap < cost.scrap || profile.currency.cores < cost.cores) {
        return {
          ok: false,
          error: 'Insufficient currency to unlock weapon',
          required: cost,
          current: profile.currency
        };
      }

      profile.currency.scrap -= cost.scrap;
      profile.currency.cores -= cost.cores;
      weapon.unlocked = true;
      profile.updatedAt = Date.now();

      await this.flush();
      return { ok: true, profile, unlockedWeaponId: weaponId };
    });
  }

  /**
   * Sets the currently equipped weapon on a profile.
   * @param {string} profileId
   * @param {string} weaponId
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string, equippedWeapon?: string }>}
   */
  async setEquippedWeapon(profileId, weaponId) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };

      if (!profile.weapons || !profile.weapons[weaponId]) {
        return { ok: false, error: `Invalid weapon ID: ${weaponId}` };
      }

      if (!profile.weapons[weaponId].unlocked) {
        return { ok: false, error: `Weapon ${weaponId} is locked` };
      }

      profile.equippedWeapon = weaponId;
      profile.updatedAt = Date.now();
      await this.flush();

      return { ok: true, profile, equippedWeapon: weaponId };
    });
  }

  /**
   * Sets the currently equipped hero class on a profile.
   * @param {string} profileId
   * @param {string} classId
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string, equippedClass?: string }>}
   */
  async setEquippedClass(profileId, classId) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };

      profile.equippedClass = classId || 'vanguard';
      profile.updatedAt = Date.now();
      await this.flush();

      return { ok: true, profile, equippedClass: profile.equippedClass };
    });
  }

  /**
   * Updates player identity attributes (callsign and heraldic emblem).
   * @param {string} profileId
   * @param {Object} identity
   * @param {string} [identity.username]
   * @param {string} [identity.emblem]
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string, username?: string, emblem?: string }>}
   */
  async updateIdentity(profileId, identity = {}) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) {
        profile = createDefaultProfile({ id: profileId });
        this.cache.set(profileId, profile);
      }

      if (typeof identity.username === 'string' && identity.username.trim().length > 0) {
        profile.username = identity.username.trim().slice(0, 32);
      }
      if (typeof identity.emblem === 'string' && identity.emblem.trim().length > 0) {
        profile.emblem = identity.emblem.trim();
      }

      profile.updatedAt = Date.now();
      await this.flush();

      return {
        ok: true,
        profile,
        username: profile.username,
        emblem: profile.emblem || 'gear'
      };
    });
  }

  /**
   * Transmutes clockwork scrap into aetherium cores.
   * @param {string} profileId
   * @param {number} [coresToConvert=1]
   * @returns {Promise<{ ok: boolean, profile?: Object, error?: string, scrapCost?: number, coresGained?: number, current?: Object }>}
   */
  async transmuteScrap(profileId, coresToConvert = 1) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };

      const result = transmuteScrapToCores(profile, coresToConvert);
      if (!result.success) {
        return {
          ok: false,
          error: result.error,
          current: profile.currency
        };
      }

      profile.currency.scrap = result.newScrap;
      profile.currency.cores = result.newCores;
      profile.updatedAt = Date.now();

      await this.flush();

      return {
        ok: true,
        profile,
        scrapCost: result.scrapCost,
        coresGained: result.coresGained,
        current: profile.currency
      };
    });
  }

  /**
   * Records match outcome, computes rewards, updates XP/level and currency, and flushes to disk.
   * @param {string} profileId
   * @param {Object} matchResult
   * @returns {Promise<{ ok: boolean, profile?: Object, rewards?: Object }>}
   */
  async recordMatchResult(profileId, matchResult = {}) {
    return this.enqueue(profileId, async () => {
      let profile = this.cache.get(profileId);
      if (!profile) {
        profile = createDefaultProfile({ id: profileId });
        this.cache.set(profileId, profile);
      }

      let placement = matchResult.placement;
      if (placement === undefined && matchResult.won !== undefined) {
        placement = matchResult.won ? 1 : 4;
      }
      placement = placement || 4;

      const rewards = calculateMatchRewards({
        placement,
        kills: matchResult.kills || 0,
        damageDealt: matchResult.damageDealt || 0,
        survivalSeconds: matchResult.survivalSeconds || 0
      });

      const oldLevel = profile.level || 1;
      profile.xp = (profile.xp || 0) + rewards.xp;

      const levelInfo = calculateLevelFromTotalXp(profile.xp);
      profile.level = levelInfo.level;
      const leveledUp = profile.level > oldLevel;

      profile.currency = profile.currency || { scrap: 0, cores: 0 };
      profile.currency.scrap = (profile.currency.scrap || 0) + rewards.scrap;
      profile.currency.cores = (profile.currency.cores || 0) + rewards.cores;

      // Update match history
      profile.matchHistory = profile.matchHistory || [];
      profile.matchHistory.unshift({
        matchId: matchResult.matchId || matchResult.roomId || ('match_' + Date.now()),
        date: new Date().toISOString(),
        placement,
        kills: matchResult.kills || 0,
        damageDealt: matchResult.damageDealt || 0,
        survivalSeconds: matchResult.survivalSeconds || 0,
        xpEarned: rewards.xp,
        scrapEarned: rewards.scrap,
        coresEarned: rewards.cores
      });

      if (profile.matchHistory.length > 30) {
        profile.matchHistory = profile.matchHistory.slice(0, 30);
      }

      // Update career stats
      profile.careerStats = profile.careerStats || { matchesPlayed: 0, wins: 0, kills: 0, damageDealt: 0 };
      profile.careerStats.matchesPlayed++;
      if (placement === 1) profile.careerStats.wins++;
      profile.careerStats.kills += (matchResult.kills || 0);
      profile.careerStats.damageDealt += (matchResult.damageDealt || 0);
      profile.updatedAt = Date.now();

      await this.flush();

      return {
        ok: true,
        profile,
        rewards,
        levelInfo,
        leveledUp
      };
    });
  }

  async recordMatchReward(profileId, matchResult = {}) {
    return this.recordMatchResult(profileId, matchResult);
  }

  /**
   * Returns list of all stored profiles (for administration and analytics)
   */
  async getAllProfiles() {
    await this.init();
    const list = [];
    for (const [, prof] of this.cache) {
      list.push({ ...prof });
    }
    return list;
  }
}

// Singleton export
export const profileStore = new ProfileStore();
export default profileStore;
