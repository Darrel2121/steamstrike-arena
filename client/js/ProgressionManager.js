/**
 * ProgressionManager.js
 * Client-Side Single Source of Truth for Player Profile, Upgrades & Economy.
 * Handles LocalStorage caching, REST API sync, and in-game combat attribute calculations.
 */

import {
  MAX_UPGRADE_TIER,
  BASE_CHARACTER_STATS,
  CHARACTER_TIER_MODIFIERS,
  CHARACTER_UPGRADE_COSTS,
  WEAPON_UPGRADE_COSTS,
  WEAPON_UNLOCK_COSTS,
  WEAPON_DEFINITIONS,
  calculateCharacterStats,
  calculateEffectiveCharacterStats,
  calculateEffectiveWeaponStats,
  calculateLevelFromTotalXp,
  createDefaultProfile,
  SCRAP_TO_CORE_EXCHANGE_RATE,
  transmuteScrapToCores,
  STEAMPUNK_EMBLEMS,
  DEFAULT_EMBLEM_ID,
  getEmblemDefinition
} from '../../shared/ProgressionSchema.js';

export { STEAMPUNK_EMBLEMS, DEFAULT_EMBLEM_ID, getEmblemDefinition };

export const STORAGE_KEY_PROFILE = 'clockwork_player_profile_v1';
export const STORAGE_KEY_TOKEN = 'clockwork_auth_token_v1';

export const UPGRADE_TIERS = {
  character: {
    maxHp: {
      base: BASE_CHARACTER_STATS.maxHp,
      perLevel: CHARACTER_TIER_MODIFIERS.health.step,
      maxLevel: MAX_UPGRADE_TIER,
      costs: CHARACTER_UPGRADE_COSTS
    },
    speed: {
      base: BASE_CHARACTER_STATS.moveSpeed,
      perLevel: CHARACTER_TIER_MODIFIERS.speed.step,
      maxLevel: MAX_UPGRADE_TIER,
      costs: CHARACTER_UPGRADE_COSTS
    },
    lantern: {
      base: BASE_CHARACTER_STATS.lanternRange,
      perLevel: CHARACTER_TIER_MODIFIERS.lantern.step,
      maxLevel: MAX_UPGRADE_TIER,
      costs: CHARACTER_UPGRADE_COSTS
    }
  },
  weapons: {
    damage: { bonusPerLevel: 0.08, maxLevel: MAX_UPGRADE_TIER, costs: WEAPON_UPGRADE_COSTS },
    fireRate: { bonusPerLevel: 0.10, maxLevel: MAX_UPGRADE_TIER, costs: WEAPON_UPGRADE_COSTS },
    reload: { bonusPerLevel: 0.10, maxLevel: MAX_UPGRADE_TIER, costs: WEAPON_UPGRADE_COSTS },
    capacity: { bonusPerLevel: 1, maxLevel: MAX_UPGRADE_TIER, costs: WEAPON_UPGRADE_COSTS }
  },
  unlockCosts: WEAPON_UNLOCK_COSTS
};

/**
 * Generates an evocative steampunk callsign.
 * @returns {string}
 */
export function generateSteampunkCallsign() {
  const prefixes = ['Латунний', 'Паровий', 'Годинниковий', 'Ефірний', 'Ливарний', 'Мідний', 'Залізний', 'Поршневий', 'Шестеренний', 'Котельний'];
  const titles = ['Рейнджер', 'Механік', 'Артизан', 'Коваль', 'Авангард', 'Стрілець', 'Інженер', 'Вартовий', 'Пілот', 'Сапер'];
  const num = Math.floor(100 + Math.random() * 900);
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  const t = titles[Math.floor(Math.random() * titles.length)];
  return `${p}${t}_${num}`;
}

export class ProgressionManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiBase]
   */
  constructor(options = {}) {
    this.apiBase = options.apiBase || '';
    this.token = null;
    this.profile = null;
    this.listeners = new Map();
  }

  /**
   * Initializes profile from LocalStorage or REST API.
   * @returns {Promise<Object>}
   */
  async init() {
    this.token = this.loadToken();
    const cached = this.loadLocalProfile();

    if (cached) {
      this.profile = cached;
    } else {
      this.profile = this.createDefaultGuestProfile();
      this.saveLocalProfile();
    }

    // Try background server synchronization
    if (this.token) {
      const fetched = await this.fetchProfile().catch(() => null);
      if (!fetched) {
        await this.syncProfileWithServer().catch(() => {});
      }
    } else {
      await this.syncProfileWithServer().catch(() => {});
    }

    this.emit('profileUpdated', this.profile);
    return this.profile;
  }

  createDefaultGuestProfile() {
    const profile = createDefaultProfile({
      username: generateSteampunkCallsign(),
      isGuest: true
    });
    profile.xpToNextLevel = 100;
    return profile;
  }

  loadLocalProfile() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  saveLocalProfile() {
    try {
      if (typeof localStorage === 'undefined' || !this.profile) return;
      localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(this.profile));
    } catch (_) {}
  }

  loadToken() {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(STORAGE_KEY_TOKEN) || null;
    } catch (_) {
      return null;
    }
  }

  getToken() {
    return this.token;
  }

  saveToken(token) {
    this.token = token;
    try {
      if (typeof localStorage === 'undefined') return;
      if (token) {
        localStorage.setItem(STORAGE_KEY_TOKEN, token);
      } else {
        localStorage.removeItem(STORAGE_KEY_TOKEN);
      }
    } catch (_) {}
  }

  getProfile() {
    return this.profile;
  }

  /**
   * Fetches profile from /api/profile
   */
  async fetchProfile() {
    if (!this.token) return null;
    try {
      const res = await fetch(`${this.apiBase}/api/profile`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.profile) {
          const localWeapon = this.profile?.equippedWeapon;
          const localClass = this.profile?.equippedClass;
          this.profile = { ...this.profile, ...data.profile };
          if (localWeapon && this.profile.weapons?.[localWeapon]?.unlocked && (!data.profile.equippedWeapon || data.profile.equippedWeapon === 'revolver')) {
            this.profile.equippedWeapon = localWeapon;
            this.syncEquippedLoadout();
          }
          if (localClass && (!data.profile.equippedClass || data.profile.equippedClass === 'vanguard')) {
            this.profile.equippedClass = localClass;
            this.syncEquippedLoadout();
          }
          this.saveLocalProfile();
          this.emit('profileUpdated', this.profile);
          return this.profile;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Synchronizes and registers profile with server database.
   */
  async syncProfileWithServer() {
    if (!this.profile) return null;
    try {
      const res = await fetch(`${this.apiBase}/api/profile/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify({ profile: this.profile })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) this.saveToken(data.token);
        if (data.profile) {
          this.profile = { ...this.profile, ...data.profile };
          this.saveLocalProfile();
          this.emit('profileUpdated', this.profile);
        }
      }
    } catch (_) {}
    return this.profile;
  }

  /**
   * Synchronizes guest with server.
   */
  async registerGuestOnServer() {
    return this.syncProfileWithServer();
  }

  /**
   * Links Google Account preserving guest progress.
   * @param {string} idToken
   * @param {string} [strategy='merge']
   */
  async linkGoogleAccount(idToken, strategy = 'merge') {
    try {
      const res = await fetch(`${this.apiBase}/api/auth/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify({
          idToken,
          guestId: this.profile.id,
          guestProfile: this.profile,
          resolution: strategy,
          strategy
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token) this.saveToken(data.token);
        if (data.profile) {
          this.profile = data.profile;
          this.saveLocalProfile();
          this.emit('profileUpdated', this.profile);
          return { success: true, profile: this.profile };
        }
      }
    } catch (_) {}

    // Offline / fallback mock linking
    this.profile.isGuest = false;
    this.profile.googleId = 'g_mock_' + Date.now();
    this.profile.email = this.profile.email || 'mechanic@clockwork.io';
    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);
    return { success: true, profile: this.profile, mock: true };
  }

  /**
   * Calculates in-game combat attributes.
   * @returns {{ maxHp: number, speed: number, sprintMultiplier: number, lanternRange: number, equippedWeapon: string, weapon: Object }}
   */
  getCalculatedStats() {
    const stats = this.profile?.characterStats || {};
    const equippedClass = this.profile?.equippedClass || 'vanguard';
    const charStats = calculateEffectiveCharacterStats(stats, equippedClass);
    const equipped = this.profile?.equippedWeapon || 'revolver';
    const weaponData = this.getCalculatedWeaponStats(equipped);

    return {
      maxHp: charStats.maxHp,
      speed: charStats.moveSpeed,
      walkSpeed: charStats.walkSpeed,
      sprintSpeed: charStats.sprintSpeed,
      sprintMultiplier: 1.5,
      lanternRange: charStats.lanternRange,
      lanternFov: charStats.lanternFov,
      lanternAngleDeg: charStats.lanternAngleDeg,
      proximityRadius: charStats.proximityRadius,
      maxSteam: charStats.maxSteam,
      steamDrainRate: charStats.steamDrainRate,
      steamVentRate: charStats.steamVentRate,
      equippedWeapon: equipped,
      equippedClass: equippedClass,
      classDef: charStats.classDef,
      weapon: weaponData
    };
  }

  getCalculatedWeaponStats(weaponId) {
    const base = WEAPON_DEFINITIONS[weaponId] || WEAPON_DEFINITIONS.revolver;
    const upgrades = this.profile?.weapons?.[weaponId] || {};
    return calculateEffectiveWeaponStats(base, upgrades);
  }

  canUpgradeCharacter(statKey) {
    if (!this.profile) return false;
    let canonical = statKey;
    if (statKey === 'maxHp' || statKey === 'health') canonical = 'health';
    if (statKey === 'speed') canonical = 'speed';
    if (statKey === 'lantern') canonical = 'lantern';

    const currentLvl = this.profile.characterStats?.[`${canonical}Tier`] ??
                       this.profile.characterStats?.[`${statKey}Level`] ?? 0;

    if (currentLvl >= MAX_UPGRADE_TIER) return false;
    const cost = CHARACTER_UPGRADE_COSTS[currentLvl];
    if (!cost) return false;

    const scrap = this.profile.currency?.scrap ?? 0;
    const cores = this.profile.currency?.cores ?? 0;
    return scrap >= cost.scrap && cores >= cost.cores;
  }

  upgradeCharacter(statKey) {
    if (!this.canUpgradeCharacter(statKey)) return false;

    let canonical = statKey;
    if (statKey === 'maxHp' || statKey === 'health') canonical = 'health';
    if (statKey === 'speed') canonical = 'speed';
    if (statKey === 'lantern') canonical = 'lantern';

    const currentLvl = this.profile.characterStats?.[`${canonical}Tier`] ??
                       this.profile.characterStats?.[`${statKey}Level`] ?? 0;
    const cost = CHARACTER_UPGRADE_COSTS[currentLvl];

    this.profile.currency.scrap -= cost.scrap;
    this.profile.currency.cores = Math.max(0, (this.profile.currency.cores || 0) - cost.cores);

    const nextLvl = currentLvl + 1;
    this.profile.characterStats[`${canonical}Tier`] = nextLvl;
    this.profile.characterStats[`${statKey}Level`] = nextLvl;
    this.profile.characterStats.maxHpLevel = this.profile.characterStats.healthTier;
    this.profile.characterStats.speedLevel = this.profile.characterStats.speedTier;
    this.profile.characterStats.lanternLevel = this.profile.characterStats.lanternTier;

    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);

    // REST sync if online
    fetch(`${this.apiBase}/api/profile/upgrade/character`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({ stat: canonical })
    }).catch(() => {});

    return true;
  }

  canUpgradeWeapon(weaponId, upgradeType) {
    if (!this.profile) return false;
    const w = this.profile.weapons?.[weaponId];
    if (!w || !w.unlocked) return false;

    const lvl = w[`${upgradeType}Tier`] ?? w[`${upgradeType}Level`] ?? 0;
    if (lvl >= MAX_UPGRADE_TIER) return false;

    const cost = WEAPON_UPGRADE_COSTS[lvl];
    if (!cost) return false;

    const scrap = this.profile.currency?.scrap ?? 0;
    const cores = this.profile.currency?.cores ?? 0;
    return scrap >= cost.scrap && cores >= cost.cores;
  }

  upgradeWeapon(weaponId, upgradeType) {
    if (!this.canUpgradeWeapon(weaponId, upgradeType)) return false;
    const w = this.profile.weapons[weaponId];
    const lvl = w[`${upgradeType}Tier`] ?? w[`${upgradeType}Level`] ?? 0;
    const cost = WEAPON_UPGRADE_COSTS[lvl];

    this.profile.currency.scrap -= cost.scrap;
    this.profile.currency.cores = Math.max(0, (this.profile.currency.cores || 0) - cost.cores);

    const nextLvl = lvl + 1;
    w[`${upgradeType}Tier`] = nextLvl;
    w[`${upgradeType}Level`] = nextLvl;

    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);

    fetch(`${this.apiBase}/api/profile/upgrade/weapon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({ weaponId, stat: upgradeType, upgradeType })
    }).catch(() => {});

    return true;
  }

  canUnlockWeapon(weaponId) {
    if (!this.profile) return false;
    const w = this.profile.weapons?.[weaponId];
    if (!w || w.unlocked) return false;

    const cost = WEAPON_UNLOCK_COSTS[weaponId];
    if (!cost) return false;

    const scrap = this.profile.currency?.scrap ?? 0;
    const cores = this.profile.currency?.cores ?? 0;
    return scrap >= cost.scrap && cores >= cost.cores;
  }

  unlockWeapon(weaponId) {
    if (!this.canUnlockWeapon(weaponId)) return false;
    const cost = WEAPON_UNLOCK_COSTS[weaponId];

    this.profile.currency.scrap -= cost.scrap;
    this.profile.currency.cores = Math.max(0, (this.profile.currency.cores || 0) - cost.cores);

    if (this.profile.weapons[weaponId]) {
      this.profile.weapons[weaponId].unlocked = true;
    }

    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);

    fetch(`${this.apiBase}/api/profile/unlock/weapon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({ weaponId })
    }).catch(() => {});

    return true;
  }

  /**
   * Checks whether player has enough scrap to transmute into cores.
   * @param {number} [cores=1]
   * @returns {boolean}
   */
  canTransmuteScrap(cores = 1) {
    if (!this.profile) return false;
    const count = Math.max(1, Math.floor(cores));
    const cost = count * SCRAP_TO_CORE_EXCHANGE_RATE;
    return (this.profile.currency?.scrap ?? 0) >= cost;
  }

  /**
   * Executes scrap-to-core transmutation locally and synchronizes with server.
   * @param {number} [cores=1]
   * @returns {Promise<boolean>}
   */
  async transmuteScrap(cores = 1) {
    if (!this.canTransmuteScrap(cores)) return false;
    const count = Math.max(1, Math.floor(cores));
    const result = transmuteScrapToCores(this.profile, count);
    if (!result.success) return false;

    this.profile.currency.scrap = result.newScrap;
    this.profile.currency.cores = result.newCores;

    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);

    try {
      await fetch(`${this.apiBase}/api/profile/transmute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify({ coresToConvert: count })
      });
    } catch (_) {}

    return true;
  }

  setEquippedWeapon(weaponId) {
    if (this.profile?.weapons?.[weaponId]?.unlocked) {
      this.profile.equippedWeapon = weaponId;
      this.saveLocalProfile();
      this.emit('profileUpdated', this.profile);
      this.syncEquippedLoadout();
      return true;
    }
    return false;
  }

  setEquippedClass(classId) {
    if (!this.profile) return false;
    this.profile.equippedClass = classId;
    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);
    this.syncEquippedLoadout();
    return true;
  }

  /**
   * Updates player identity (callsign and/or heraldic emblem) locally and on the server.
   * @param {Object} identity
   * @param {string} [identity.username]
   * @param {string} [identity.emblem]
   * @returns {Promise<boolean>}
   */
  async updateIdentity({ username, emblem } = {}) {
    if (!this.profile) return false;
    let changed = false;

    if (typeof username === 'string' && username.trim().length > 0) {
      this.profile.username = username.trim().slice(0, 32);
      changed = true;
    }

    if (typeof emblem === 'string' && emblem.trim().length > 0) {
      this.profile.emblem = emblem.trim();
      changed = true;
    }

    if (!changed) return false;

    this.profile.updatedAt = Date.now();
    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);

    try {
      await fetch(`${this.apiBase}/api/profile/identity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify({
          username: this.profile.username,
          emblem: this.profile.emblem || 'gear',
          profileId: this.profile.id,
          guestId: this.profile.id
        })
      });
    } catch (_) {}

    return true;
  }

  async syncEquippedLoadout() {
    if (!this.profile) return;
    try {
      await fetch(`${this.apiBase}/api/profile/equip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify({
          weaponId: this.profile.equippedWeapon,
          classId: this.profile.equippedClass,
          profileId: this.profile.id,
          guestId: this.profile.id
        })
      });
    } catch (_) {}
  }

  getEquippedClass() {
    return this.profile?.equippedClass || 'vanguard';
  }

  addRewards(rewards = {}) {
    if (!this.profile) return;
    const xp = rewards.xp ?? rewards.xpEarned ?? 0;
    const scrap = rewards.scrap ?? rewards.scrapEarned ?? 0;
    const cores = rewards.cores ?? rewards.coresEarned ?? 0;

    this.profile.currency = this.profile.currency || { scrap: 0, cores: 0 };
    this.profile.currency.scrap += scrap;
    this.profile.currency.cores += cores;

    this.profile.xp = (this.profile.xp || 0) + xp;
    const levelInfo = calculateLevelFromTotalXp(this.profile.xp);
    const leveledUp = levelInfo.level > this.profile.level;
    this.profile.level = levelInfo.level;
    this.profile.xpToNextLevel = levelInfo.xpRequiredForNext;

    this.saveLocalProfile();
    this.emit('profileUpdated', this.profile);
    if (leveledUp) {
      this.emit('levelUp', { level: this.profile.level });
    }
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  off(event, handler) {
    if (!this.listeners.has(event)) return;
    this.listeners.set(event, this.listeners.get(event).filter(h => h !== handler));
  }

  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) handlers.forEach(fn => fn(data));
  }
}

export default ProgressionManager;
