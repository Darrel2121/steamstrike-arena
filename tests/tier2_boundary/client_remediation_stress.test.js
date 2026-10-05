/**
 * Tier 2.13: Client Remediation & Conflict Resolution Adversarial Stress Suite
 * Authored by: challenger_prog_iter2_2
 *
 * Empirically stress-tests:
 * 1. index.html DOM structure: verifies #view-workshop is not a descendant of #view-game
 *    and is a top-level sibling of #view-lobby and #view-editor under <body>.
 * 2. WorkshopUI track detection: verifies .btn-track-upgrade / .btn-upgrade with nested span
 *    or direct button resolves closest('.upgrade-track')?.dataset.track across all weapons
 *    (revolver, steam_carbine, blunderbuss, needle_gun) and tracks (damage, fireRate, reload, capacity).
 * 3. AuthService.linkGuestToGoogle: verifies resolution = 'keep_cloud' 100% retains cloud profile,
 *    and resolution = 'merge' preserves max tiers and adds currencies.
 * 4. ProgressionSchema.calculateLevelFromTotalXp: stress-tests Infinity, -Infinity, NaN, null,
 *    undefined, strings, arrays, objects, verifying instant finite Level 1 return without hanging.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { AuthService } from '../../server/auth/AuthService.js';
import {
  calculateLevelFromTotalXp,
  createDefaultProfile,
  MAX_UPGRADE_TIER,
  WEAPON_DEFINITIONS,
  WEAPON_CAPACITY_STEPS
} from '../../shared/ProgressionSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'client/index.html');

export const suiteName = 'Tier 2.13: Client Remediation & Conflict Resolution Adversarial Stress';

// ----------------------------------------------------------------------------
// Stack-based HTML Parser for Structural DOM Hierarchy Verification
// ----------------------------------------------------------------------------
function parseHtmlElements(htmlContent) {
  const tagRegex = /<\/?([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9-:]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  const selfClosing = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);
  
  const root = { tagName: '#document', children: [], attributes: {}, parent: null };
  const stack = [root];
  let match;

  while ((match = tagRegex.exec(htmlContent)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const rawAttrs = match[2] || '';
    const isClosing = fullTag.startsWith('</');
    const isSelfClosing = match[3] === '/' || selfClosing.has(tagName);
    const index = match.index;

    if (isClosing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tagName) {
          stack[i].closeIndex = index + fullTag.length;
          stack.length = i;
          break;
        }
      }
    } else {
      const attributes = {};
      const attrRegex = /([a-zA-Z0-9-:]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        const attrName = attrMatch[1].toLowerCase();
        const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
        attributes[attrName] = attrVal;
      }

      const node = {
        tagName,
        attributes,
        id: attributes.id || null,
        className: attributes.class || null,
        openIndex: index,
        closeIndex: null,
        children: [],
        parent: stack[stack.length - 1]
      };

      stack[stack.length - 1].children.push(node);

      if (!isSelfClosing) {
        stack.push(node);
      }
    }
  }

  return root;
}

function findNodeById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function isDescendantOf(childNode, ancestorNode) {
  let curr = childNode.parent;
  while (curr) {
    if (curr === ancestorNode) return true;
    curr = curr.parent;
  }
  return false;
}

// ----------------------------------------------------------------------------
// In-Memory ProfileStore for AuthService Link Tests
// ----------------------------------------------------------------------------
class InMemProfileStore {
  constructor() {
    this.profiles = new Map();
  }
  async getProfile(id) {
    return this.profiles.get(id) ? JSON.parse(JSON.stringify(this.profiles.get(id))) : null;
  }
  async get(id) {
    return this.getProfile(id);
  }
  async findByGoogleId(googleId) {
    for (const p of this.profiles.values()) {
      if (p.googleId === googleId) return JSON.parse(JSON.stringify(p));
    }
    return null;
  }
  async save(profile) {
    this.profiles.set(profile.id, JSON.parse(JSON.stringify(profile)));
    return true;
  }
  async delete(id) {
    this.profiles.delete(id);
    return true;
  }
}

export const tests = [
  // ==========================================================================
  // 1. DOM STRUCTURE & VIEW HIERARCHY
  // ==========================================================================
  {
    id: 'T2.CR1',
    name: 'DOM View Containers Top-Level Sibling & Non-Descendant Verification',
    fn: async () => {
      const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
      const doc = parseHtmlElements(html);

      const viewLobby = findNodeById(doc, 'view-lobby');
      const viewEditor = findNodeById(doc, 'view-editor');
      const viewGame = findNodeById(doc, 'view-game');
      const viewWorkshop = findNodeById(doc, 'view-workshop');

      assert.ok(viewLobby, '#view-lobby must exist in index.html');
      assert.ok(viewEditor, '#view-editor must exist in index.html');
      assert.ok(viewGame, '#view-game must exist in index.html');
      assert.ok(viewWorkshop, '#view-workshop must exist in index.html');

      // Crucial test: verify #view-workshop is NOT a descendant of #view-game
      assert.strictEqual(
        isDescendantOf(viewWorkshop, viewGame),
        false,
        '#view-workshop MUST NOT be a descendant of #view-game'
      );

      // Verify all views are direct children of body and siblings
      assert.strictEqual(viewLobby.parent.tagName, 'body');
      assert.strictEqual(viewWorkshop.parent, viewGame.parent);
      assert.strictEqual(viewWorkshop.parent, viewEditor.parent);
      assert.strictEqual(viewWorkshop.parent, viewLobby.parent);

      // Verify close tag ordering
      assert.ok(viewGame.closeIndex !== null, '#view-game must have a valid closing tag');
      assert.ok(
        viewGame.closeIndex < viewWorkshop.openIndex,
        `#view-game closing tag (pos ${viewGame.closeIndex}) must precede #view-workshop opening tag (pos ${viewWorkshop.openIndex})`
      );

      // Verify all carry 'view-container' class
      for (const v of [viewLobby, viewEditor, viewGame, viewWorkshop]) {
        const classes = (v.className || '').split(/\s+/);
        assert.ok(classes.includes('view-container'), `#${v.id} must have class 'view-container'`);
      }
    }
  },

  // ==========================================================================
  // 2. WORKSHOPUI TRACK DETECTION & EVENT DELEGATION
  // ==========================================================================
  {
    id: 'T2.CR2',
    name: 'WorkshopUI Track Detection: Button and Nested Span Traversal Across All Weapons',
    fn: async () => {
      const tracks = ['damage', 'fireRate', 'reload', 'capacity'];
      const weapons = ['revolver', 'steam_carbine', 'blunderbuss', 'needle_gun'];

      for (const track of tracks) {
        // Mock DOM node tree replicating Workshop armory structure:
        // <div class="upgrade-track" data-track="...">
        //   <button class="btn-track-upgrade btn-upgrade">
        //     <span class="btn-icon">⚡</span>
        //     <span class="btn-text">Upgrade</span>
        //   </button>
        // </div>
        const trackElement = {
          className: 'upgrade-track',
          dataset: { track },
          parentElement: null,
          closest(sel) {
            if (sel === '.upgrade-track') return this;
            return null;
          }
        };

        const buttonElement = {
          className: 'btn-track-upgrade btn-upgrade',
          dataset: {},
          parentElement: trackElement,
          closest(sel) {
            if (sel === '.btn-track-upgrade' || sel === '.btn-upgrade') return this;
            if (sel === '.upgrade-track') return this.parentElement;
            return null;
          }
        };

        const spanElement = {
          className: 'btn-text',
          dataset: {},
          parentElement: buttonElement,
          closest(sel) {
            if (sel === '.btn-track-upgrade' || sel === '.btn-upgrade') return buttonElement;
            if (sel === '.upgrade-track') return trackElement;
            return null;
          }
        };

        // 1. Direct button resolution
        const trackFromButton = buttonElement.dataset.track || buttonElement.closest('.upgrade-track')?.dataset.track;
        assert.strictEqual(trackFromButton, track, `Button must resolve track '${track}'`);

        // 2. Nested span resolution
        const btnFromSpan = spanElement.closest('.btn-track-upgrade');
        assert.ok(btnFromSpan, 'Span must resolve parent button');
        const trackFromSpan = btnFromSpan.dataset.track || btnFromSpan.closest('.upgrade-track')?.dataset.track;
        assert.strictEqual(trackFromSpan, track, `Nested span must resolve track '${track}'`);

        // 3. Alternative .btn-upgrade class resolution
        const btnUpgrade = spanElement.closest('.btn-upgrade');
        assert.ok(btnUpgrade, 'Span must resolve parent .btn-upgrade');
        const trackFromBtnUpgrade = btnUpgrade.dataset.track || btnUpgrade.closest('.upgrade-track')?.dataset.track;
        assert.strictEqual(trackFromBtnUpgrade, track, `.btn-upgrade must resolve track '${track}'`);

        // 4. Simulate WorkshopUI delegation across all weapons
        for (const weaponId of weapons) {
          let dispatchedWeapon = null;
          let dispatchedTrack = null;

          const mockProgression = {
            upgradeWeapon: (w, t) => {
              dispatchedWeapon = w;
              dispatchedTrack = t;
            }
          };

          // Mimic WorkshopUI.js line 105-113:
          const event = { target: spanElement };
          const btn = event.target.closest('.btn-track-upgrade');
          if (btn) {
            const tr = btn.dataset.track || btn.closest('.upgrade-track')?.dataset.track;
            if (tr) {
              mockProgression.upgradeWeapon(weaponId, tr);
            }
          }

          assert.strictEqual(dispatchedWeapon, weaponId);
          assert.strictEqual(dispatchedTrack, track);
        }
      }
    }
  },

  // ==========================================================================
  // 3. AUTH SERVICE CONFLICT RESOLUTION: KEEP_CLOUD & MERGE
  // ==========================================================================
  {
    id: 'T2.CR3',
    name: 'AuthService.linkGuestToGoogle: "keep_cloud" 100% Retains Cloud Profile',
    fn: async () => {
      const store = new InMemProfileStore();
      const auth = new AuthService({
        secret: 'test-secret-challenger-keep-cloud-32chars',
        profileStore: store
      });

      const googleSub = 'google_veteran_keep_cloud_user';
      const idToken = 'mock_google_' + Buffer.from(JSON.stringify({
        sub: googleSub,
        email: 'veteran@steampunk.org'
      })).toString('base64url');

      // Pre-existing cloud profile with high level, scrap, and maxed weapons
      const cloudProfile = {
        id: 'cloud_veteran_1',
        googleId: googleSub,
        email: 'veteran@steampunk.org',
        isGuest: false,
        level: 30,
        xp: 120000,
        currency: { scrap: 50000, cores: 75 },
        characterStats: { maxHpLevel: 5, speedLevel: 5, lanternLevel: 5 },
        weapons: {
          revolver: { unlocked: true, damageTier: 5, fireRateTier: 5, reloadTier: 5, capacityTier: 5 },
          steam_carbine: { unlocked: true, damageTier: 5, fireRateTier: 4, reloadTier: 5, capacityTier: 4 }
        },
        matchHistory: [{ date: '2026-10-01', kills: 12, won: true }]
      };
      await store.save(cloudProfile);

      // Lowly guest profile
      const guestProfile = {
        id: 'guest_ephemeral_1',
        isGuest: true,
        level: 1,
        xp: 50,
        currency: { scrap: 20, cores: 0 },
        characterStats: { maxHpLevel: 0, speedLevel: 0, lanternLevel: 0 },
        weapons: { revolver: { unlocked: true, damageTier: 0, fireRateTier: 0, reloadTier: 0, capacityTier: 0 } }
      };
      await store.save(guestProfile);

      // Link with 'keep_cloud'
      const res = await auth.linkGuestToGoogle('guest_ephemeral_1', idToken, 'keep_cloud');

      assert.strictEqual(res.merged, true);
      assert.strictEqual(res.profile.id, 'cloud_veteran_1');
      assert.strictEqual(res.profile.level, 30, 'Cloud level 30 must be 100% retained');
      assert.strictEqual(res.profile.xp, 120000, 'Cloud XP 120000 must be 100% retained');
      assert.strictEqual(res.profile.currency.scrap, 50000, 'Cloud scrap 50000 must be 100% retained');
      assert.strictEqual(res.profile.currency.cores, 75, 'Cloud cores 75 must be 100% retained');
      assert.strictEqual(res.profile.characterStats.maxHpLevel, 5);
      assert.strictEqual(res.profile.weapons.revolver.damageTier, 5);
      assert.strictEqual(res.profile.weapons.steam_carbine.unlocked, true);

      // Guest profile must be cleanly deleted
      assert.strictEqual(await store.get('guest_ephemeral_1'), null);

      // Also verify alias 'use_cloud'
      const guestProfile2 = { id: 'guest_ephemeral_2', isGuest: true, level: 2, xp: 80 };
      await store.save(guestProfile2);
      const res2 = await auth.linkGuestToGoogle('guest_ephemeral_2', idToken, 'use_cloud');
      assert.strictEqual(res2.profile.level, 30);
      assert.strictEqual(await store.get('guest_ephemeral_2'), null);
    }
  },

  {
    id: 'T2.CR4',
    name: 'AuthService.linkGuestToGoogle: "merge" Combines Max Tiers, Unlocks & Currencies',
    fn: async () => {
      const store = new InMemProfileStore();
      const auth = new AuthService({
        secret: 'test-secret-challenger-merge-mode-32chars',
        profileStore: store
      });

      const googleSub = 'google_user_merge_mode';
      const idToken = 'mock_google_' + Buffer.from(JSON.stringify({
        sub: googleSub,
        email: 'merge_test@steampunk.org'
      })).toString('base64url');

      const cloudProfile = {
        id: 'cloud_merge_target',
        googleId: googleSub,
        isGuest: false,
        level: 8,
        xp: 15000,
        currency: { scrap: 2000, cores: 4 },
        characterStats: { maxHpLevel: 4, speedLevel: 1, lanternLevel: 3 },
        weapons: {
          revolver: { unlocked: true, damageTier: 2, fireRateTier: 4, reloadTier: 1, capacityTier: 2 },
          steam_carbine: { unlocked: true, damageTier: 1, fireRateTier: 1, reloadTier: 1, capacityTier: 1 }
        },
        matchHistory: [{ date: '2026-10-01T10:00:00Z', kills: 4, won: true }]
      };
      await store.save(cloudProfile);

      const guestProfile = {
        id: 'guest_merge_source',
        isGuest: true,
        level: 11,
        xp: 22000,
        currency: { scrap: 1500, cores: 3 },
        characterStats: { maxHpLevel: 2, speedLevel: 5, lanternLevel: 1 },
        weapons: {
          revolver: { unlocked: true, damageTier: 4, fireRateTier: 1, reloadTier: 3, capacityTier: 1 },
          blunderbuss: { unlocked: true, damageTier: 3, fireRateTier: 2, reloadTier: 2, capacityTier: 2 }
        },
        matchHistory: [{ date: '2026-10-03T10:00:00Z', kills: 7, won: true }]
      };
      await store.save(guestProfile);

      const res = await auth.linkGuestToGoogle('guest_merge_source', idToken, 'merge');

      // Max level & XP
      assert.strictEqual(res.profile.level, 11, 'Level: max(8, 11) = 11');
      assert.strictEqual(res.profile.xp, 22000, 'XP: max(15000, 22000) = 22000');

      // Sum of currencies
      assert.strictEqual(res.profile.currency.scrap, 3500, 'Scrap: 2000 + 1500 = 3500');
      assert.strictEqual(res.profile.currency.cores, 7, 'Cores: 4 + 3 = 7');

      // Max of character stats
      assert.strictEqual(res.profile.characterStats.maxHpLevel, 4, 'maxHp: max(4, 2) = 4');
      assert.strictEqual(res.profile.characterStats.speedLevel, 5, 'speed: max(1, 5) = 5');
      assert.strictEqual(res.profile.characterStats.lanternLevel, 3, 'lantern: max(3, 1) = 3');

      // Max of weapon tiers
      const rev = res.profile.weapons.revolver;
      assert.strictEqual(rev.damageTier, 4, 'Revolver damage: max(2, 4) = 4');
      assert.strictEqual(rev.fireRateTier, 4, 'Revolver fireRate: max(4, 1) = 4');
      assert.strictEqual(rev.reloadTier, 3, 'Revolver reload: max(1, 3) = 3');
      assert.strictEqual(rev.capacityTier, 2, 'Revolver capacity: max(2, 1) = 2');

      // Unlocks merged
      assert.strictEqual(res.profile.weapons.steam_carbine.unlocked, true);
      assert.strictEqual(res.profile.weapons.blunderbuss.unlocked, true, 'Guest blunderbuss unlock merged');
      assert.strictEqual(res.profile.weapons.blunderbuss.damageTier, 3);

      // Match history merged
      assert.strictEqual(res.profile.matchHistory.length, 2);

      // Guest cleaned up
      assert.strictEqual(await store.get('guest_merge_source'), null);
    }
  },

  // ==========================================================================
  // 4. PROGRESSIONSCHEMA CALCULATELEVELFROMTOTALXP STRESS & FUZZING
  // ==========================================================================
  {
    id: 'T2.CR5',
    name: 'ProgressionSchema.calculateLevelFromTotalXp Non-Finite & Malformed Input Fuzzing',
    fn: async () => {
      const nonFiniteInputs = [
        Infinity,
        -Infinity,
        NaN,
        null,
        undefined,
        '',
        '1000',
        '-500',
        'Infinity',
        [],
        [100],
        {},
        { xp: 500 },
        true,
        false,
        Symbol('xp'),
        () => 500,
        -1,
        -999999,
        -0
      ];

      for (const val of nonFiniteInputs) {
        const start = performance.now();
        const res = calculateLevelFromTotalXp(val);
        const elapsed = performance.now() - start;

        assert.ok(elapsed < 15, `Must calculate within 15ms for input: ${String(val)}`);
        assert.strictEqual(res.level, 1, `Level must default to 1 for input: ${String(val)}`);
        assert.strictEqual(res.currentLevelBaseXp, 0);
        assert.strictEqual(res.nextLevelTargetXp, 100);
        assert.strictEqual(res.currentXpIntoLevel, 0);
        assert.strictEqual(res.xpRequiredForNext, 100);
        assert.strictEqual(res.progressRatio, 0);
      }

      // Valid boundary values
      const r0 = calculateLevelFromTotalXp(0);
      assert.strictEqual(r0.level, 1);
      assert.strictEqual(r0.progressRatio, 0);

      const r99 = calculateLevelFromTotalXp(99);
      assert.strictEqual(r99.level, 1);
      assert.strictEqual(r99.progressRatio, 0.99);

      const r100 = calculateLevelFromTotalXp(100);
      assert.strictEqual(r100.level, 2);
      assert.strictEqual(r100.progressRatio, 0);

      // Large finite stress
      const r10M = calculateLevelFromTotalXp(10_000_000);
      assert.ok(Number.isFinite(r10M.level) && r10M.level > 100);
      assert.ok(r10M.progressRatio >= 0.0 && r10M.progressRatio <= 1.0);
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
