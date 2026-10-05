/**
 * Server Authentication & Identity Service
 * Pure Node.js zero-dependency authentication engine using node:crypto.
 * Manages guest sessions, HMAC-SHA256 signed tokens, Google ID token verification, and account linking.
 */

import crypto from 'node:crypto';
import { createDefaultProfile } from '../../shared/ProgressionSchema.js';
import { profileStore } from '../db/ProfileStore.js';

const STEAMPUNK_PREFIXES = [
  'Brass', 'Steam', 'Clockwork', 'Copper', 'Iron', 'Pneumatic', 'Boiler',
  'Cobalt', 'Gear', 'Aether', 'Arcane', 'Dynamo', 'Rust', 'Alchemical',
  'Valve', 'Sprocket', 'Gilded', 'Vapor', 'Tungsten', 'Piston'
];

const STEAMPUNK_CLASSES = [
  'Knight', 'Ranger', 'Mechanic', 'Tinker', 'Gunner', 'Pilot', 'Smith',
  'Automaton', 'Sapper', 'Marksman', 'Scout', 'Artificer', 'Warden',
  'Bombardier', 'Stoker', 'Operative', 'Machinist', 'Vanguard'
];

export class AuthService {
  /**
   * @param {Object} [options]
   * @param {string} [options.secret]
   * @param {Object} [options.profileStore]
   * @param {string} [options.googleClientId]
   * @param {number} [options.tokenTtlMs]
   */
  constructor(options = {}) {
    this.secret = options.secret || process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
    this.profileStore = options.profileStore || profileStore;
    this.googleClientId = options.googleClientId || process.env.GOOGLE_CLIENT_ID || null;
    this.tokenTtlMs = options.tokenTtlMs || 30 * 24 * 60 * 60 * 1000; // 30 days default
  }

  /**
   * Generates an evocative Steampunk Callsign (e.g. BrassKnight#482).
   * @returns {string}
   */
  generateSteampunkName() {
    const p = STEAMPUNK_PREFIXES[Math.floor(Math.random() * STEAMPUNK_PREFIXES.length)];
    const c = STEAMPUNK_CLASSES[Math.floor(Math.random() * STEAMPUNK_CLASSES.length)];
    const tag = Math.floor(100 + Math.random() * 900);
    return `${p}${c}#${tag}`;
  }

  generateSteampunkCallsign() {
    return this.generateSteampunkName();
  }

  /**
   * Generates an HMAC-SHA256 signed session token.
   * Format: base64url(header).base64url(payload).base64url(signature)
   * @param {Object} payload
   * @returns {string}
   */
  generateToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const enriched = {
      ...payload,
      iat: Date.now(),
      exp: Date.now() + this.tokenTtlMs
    };
    const body = Buffer.from(JSON.stringify(enriched)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  /**
   * Verifies and decodes a token. Returns payload or null if invalid/expired.
   * @param {string} token
   * @returns {Object|null}
   */
  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;

    const expectedSig = crypto.createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && Date.now() > payload.exp) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  /**
   * Creates a new guest profile or restores an existing session.
   * @param {string} [guestId]
   * @param {string} [preferredName]
   * @returns {Promise<{ token: string, profile: Object }>}
   */
  async createOrRestoreGuestSession(guestId = null, preferredName = null) {
    if (guestId && this.profileStore) {
      const existing = (await this.profileStore.getProfile?.(guestId)) || (await this.profileStore.get?.(guestId));
      if (existing) {
        const token = this.generateToken({ accountId: existing.id, isGuest: true });
        return { token, profile: existing };
      }
    }

    const newId = guestId || `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const username = preferredName || this.generateSteampunkName();
    const profile = createDefaultProfile({ id: newId, username, isGuest: true });

    if (this.profileStore) {
      if (typeof this.profileStore.save === 'function') {
        await this.profileStore.save(profile);
      } else if (typeof this.profileStore.createProfile === 'function') {
        await this.profileStore.createProfile(profile);
      }
    }

    const token = this.generateToken({ accountId: newId, isGuest: true });
    return { token, profile };
  }

  /**
   * Verifies Google ID token supporting mock tokens for offline/headless testing.
   * @param {string} idToken
   * @returns {Promise<{ googleId: string, email: string, name: string, avatar: string|null }>}
   */
  async verifyGoogleIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') throw new Error('Missing ID token');

    // Dual-mode mock token handler for headless tests and offline sandboxes
    if (idToken.startsWith('mock_google_') || idToken.startsWith('mock_jwt_')) {
      const prefix = idToken.startsWith('mock_google_') ? 'mock_google_' : 'mock_jwt_';
      const parts = idToken.slice(prefix.length);
      try {
        const parsed = JSON.parse(Buffer.from(parts, 'base64url').toString('utf8'));
        return {
          googleId: parsed.sub || parsed.googleId || `google_sub_${parts.slice(0, 8)}`,
          email: parsed.email || 'mechanic@steampunk.io',
          name: parsed.name || 'Master Tinker',
          avatar: parsed.picture || parsed.avatar || null
        };
      } catch (_) {
        return {
          googleId: `google_sub_${parts.slice(0, 10)}`,
          email: 'pilot@steampunk.io',
          name: 'Clockwork Pilot',
          avatar: null
        };
      }
    }

    // Production Google verification via TokenInfo endpoint
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Invalid Google token signature');
    const data = await res.json();
    return {
      googleId: data.sub,
      email: data.email,
      name: data.name,
      avatar: data.picture || null
    };
  }

  /**
   * Authenticates or creates account via Google OAuth token.
   * @param {string} idToken
   * @returns {Promise<{ token: string, profile: Object, isNewUser: boolean }>}
   */
  async authenticateGoogle(idToken) {
    const googleUser = await this.verifyGoogleIdToken(idToken);
    let profile = null;

    if (this.profileStore?.findByGoogleId) {
      profile = await this.profileStore.findByGoogleId(googleUser.googleId);
    }

    let isNewUser = false;
    if (!profile) {
      isNewUser = true;
      const accountId = `user_g_${googleUser.googleId}`;
      profile = createDefaultProfile({
        id: accountId,
        username: googleUser.name || this.generateSteampunkName(),
        isGuest: false,
        googleId: googleUser.googleId,
        email: googleUser.email,
        avatar: googleUser.avatar,
        avatarUrl: googleUser.avatar
      });

      if (this.profileStore) {
        if (typeof this.profileStore.save === 'function') {
          await this.profileStore.save(profile);
        } else if (typeof this.profileStore.createProfile === 'function') {
          await this.profileStore.createProfile(profile);
        }
      }
    }

    const token = this.generateToken({ accountId: profile.id, isGuest: false });
    return { token, profile, isNewUser };
  }

  /**
   * Links a guest account with Google identity, resolving conflicts via intelligent merge.
   * @param {string} guestAccountId
   * @param {string} idToken
   * @param {string} [resolution='merge']
   * @returns {Promise<{ token: string, profile: Object, merged: boolean }>}
   */
  async linkGuestToGoogle(guestAccountId, idToken, resolution = 'merge') {
    if (!this.profileStore) throw new Error('ProfileStore not configured');

    const guestProfile = (await this.profileStore.getProfile?.(guestAccountId)) || (await this.profileStore.get?.(guestAccountId));
    if (!guestProfile) throw new Error('Guest profile not found');
    if (!guestProfile.isGuest) throw new Error('Account is already a registered account');

    const googleUser = await this.verifyGoogleIdToken(idToken);
    let cloudProfile = await this.profileStore.findByGoogleId(googleUser.googleId);

    // Scenario A: First-time Google user -> Direct Promotion
    if (!cloudProfile) {
      guestProfile.isGuest = false;
      guestProfile.googleId = googleUser.googleId;
      guestProfile.email = googleUser.email;
      guestProfile.avatar = googleUser.avatar;
      guestProfile.avatarUrl = googleUser.avatar;
      guestProfile.updatedAt = Date.now();
      await this.profileStore.save(guestProfile);

      const token = this.generateToken({ accountId: guestProfile.id, isGuest: false });
      return { token, profile: guestProfile, merged: false };
    }

    // Scenario B: Existing Cloud Account -> Intelligent Merge or Overwrite
    let finalProfile = cloudProfile;
    if (resolution === 'merge') {
      finalProfile.level = Math.max(cloudProfile.level || 1, guestProfile.level || 1);
      finalProfile.xp = Math.max(cloudProfile.xp || 0, guestProfile.xp || 0);

      finalProfile.currency = finalProfile.currency || { scrap: 0, cores: 0 };
      guestProfile.currency = guestProfile.currency || { scrap: 0, cores: 0 };
      finalProfile.currency.scrap = (finalProfile.currency.scrap || 0) + (guestProfile.currency.scrap || 0);
      finalProfile.currency.cores = (finalProfile.currency.cores || 0) + (guestProfile.currency.cores || 0);

      // Character stats max merge
      finalProfile.characterStats = finalProfile.characterStats || {};
      guestProfile.characterStats = guestProfile.characterStats || {};
      for (const key of Object.keys(guestProfile.characterStats)) {
        finalProfile.characterStats[key] = Math.max(
          finalProfile.characterStats[key] ?? 0,
          guestProfile.characterStats[key] ?? 0
        );
      }

      // Weapons max merge
      finalProfile.weapons = finalProfile.weapons || {};
      guestProfile.weapons = guestProfile.weapons || {};
      for (const [wId, wData] of Object.entries(guestProfile.weapons)) {
        if (!finalProfile.weapons[wId]) {
          finalProfile.weapons[wId] = { ...wData };
        } else {
          finalProfile.weapons[wId].unlocked = finalProfile.weapons[wId].unlocked || wData.unlocked;
          finalProfile.weapons[wId].damageTier = Math.max(finalProfile.weapons[wId].damageTier ?? 0, wData.damageTier ?? 0);
          finalProfile.weapons[wId].fireRateTier = Math.max(finalProfile.weapons[wId].fireRateTier ?? 0, wData.fireRateTier ?? 0);
          finalProfile.weapons[wId].reloadTier = Math.max(finalProfile.weapons[wId].reloadTier ?? 0, wData.reloadTier ?? 0);
          finalProfile.weapons[wId].capacityTier = Math.max(finalProfile.weapons[wId].capacityTier ?? 0, wData.capacityTier ?? 0);

          finalProfile.weapons[wId].damageLevel = finalProfile.weapons[wId].damageTier;
          finalProfile.weapons[wId].fireRateLevel = finalProfile.weapons[wId].fireRateTier;
          finalProfile.weapons[wId].reloadLevel = finalProfile.weapons[wId].reloadTier;
          finalProfile.weapons[wId].capacityLevel = finalProfile.weapons[wId].capacityTier;
        }
      }

      // Merge & deduplicate match history
      finalProfile.matchHistory = [...(finalProfile.matchHistory || []), ...(guestProfile.matchHistory || [])]
        .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
        .slice(0, 50);

      finalProfile.updatedAt = Date.now();
      await this.profileStore.save(finalProfile);
      if (this.profileStore.delete) {
        await this.profileStore.delete(guestAccountId);
      }
    } else if (resolution === 'keep_cloud' || resolution === 'use_cloud') {
      finalProfile = cloudProfile;
      if (this.profileStore.delete) {
        await this.profileStore.delete(guestAccountId);
      }
    } else if (resolution === 'keep_guest' || resolution === 'overwrite') {
      cloudProfile.level = guestProfile.level;
      cloudProfile.xp = guestProfile.xp;
      cloudProfile.currency = { ...guestProfile.currency };
      cloudProfile.characterStats = { ...guestProfile.characterStats };
      cloudProfile.weapons = { ...guestProfile.weapons };
      cloudProfile.updatedAt = Date.now();
      await this.profileStore.save(cloudProfile);
      if (this.profileStore.delete) {
        await this.profileStore.delete(guestAccountId);
      }
      finalProfile = cloudProfile;
    }

    const token = this.generateToken({ accountId: finalProfile.id, isGuest: false });
    return { token, profile: finalProfile, merged: true };
  }
}

export const authService = new AuthService();
export default authService;
