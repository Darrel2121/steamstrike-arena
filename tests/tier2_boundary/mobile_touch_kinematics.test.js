/**
 * Tier 2.16: Mobile Touch Controls, Kinematic Facing & Orientation Suite
 *
 * Validates:
 * 1. DOM Integrity: Ensures #mobileTouchControls, Bullet Echo action cluster, and #landscapeRotatePrompt exist in client/index.html.
 * 2. Mobile Kinematics: Character faces movement vector when moving via virtual joystick.
 * 3. Facing Persistence: Last facing angle is retained when movement stops, without snapping to 0,0.
 * 4. Dedicated Touch Buttons: Decoupled firing via #btnTouchFire, reload trigger, sprint toggle, ability trigger.
 * 5. Free Aim Touchpad: Dragging right screen aims without triggering runaway weapon fire.
 * 6. HUD Synchronization: updateMobileTouchUI updates ammo counter badge and ability cooldown overlay.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuiteHelper, assertAngleClose, assertEpsilon } from '../harnesses/assert_helpers.js';
import { InputManager } from '../../client/js/InputManager.js';
import { HUD } from '../../client/js/ui/HUD.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'client/index.html');

export const suiteName = 'Tier 2.16: Mobile Touch Controls, Kinematic Facing & Orientation';

export const tests = [
  {
    id: 'T2.16.1',
    name: 'DOM Integrity: Mobile Touch Controls & Orientation Prompt Elements Exist',
    fn: async () => {
      const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

      // Verify Mobile Touch Container and Joystick Zone
      assert.ok(html.includes('id="mobileTouchControls"'), 'index.html must include #mobileTouchControls');
      assert.ok(html.includes('id="touchJoystickZone"'), 'index.html must include #touchJoystickZone');
      assert.ok(html.includes('id="touchJoystickBase"'), 'index.html must include #touchJoystickBase');
      assert.ok(html.includes('id="touchJoystickThumb"'), 'index.html must include #touchJoystickThumb');

      // Verify Bullet Echo Action Cluster and Dedicated Buttons
      assert.ok(html.includes('class="touch-action-cluster"'), 'index.html must include .touch-action-cluster');
      assert.ok(html.includes('id="btnTouchFire"'), 'index.html must include #btnTouchFire');
      assert.ok(html.includes('id="btnTouchReload"'), 'index.html must include #btnTouchReload');
      assert.ok(html.includes('id="touchReloadAmmoCount"'), 'index.html must include #touchReloadAmmoCount');
      assert.ok(html.includes('id="btnTouchAbility"'), 'index.html must include #btnTouchAbility');
      assert.ok(html.includes('id="touchAbilityCooldownOverlay"'), 'index.html must include #touchAbilityCooldownOverlay');
      assert.ok(html.includes('id="btnTouchSprint"'), 'index.html must include #btnTouchSprint');
      assert.ok(html.includes('id="btnTouchFullscreen"'), 'index.html must include #btnTouchFullscreen');
      assert.ok(html.includes('id="btnTouchExitMatch"'), 'index.html must include #btnTouchExitMatch');

      // Verify Landscape Orientation Prompt Modal
      assert.ok(html.includes('id="landscapeRotatePrompt"'), 'index.html must include #landscapeRotatePrompt');
      assert.ok(html.includes('id="btnRotateFullscreen"'), 'index.html must include #btnRotateFullscreen');
      assert.ok(html.includes('id="btnDismissRotatePrompt"'), 'index.html must include #btnDismissRotatePrompt');
    }
  },

  {
    id: 'T2.16.2',
    name: 'Mobile Kinematics: Character Automatically Faces Movement Direction',
    fn: async () => {
      const input = new InputManager();
      input.isTouchDevice = true;

      // 1. Moving East (1, 0) -> Expected angle 0 radians
      input.touchMoveVector = { x: 1, y: 0 };
      const pollEast = input.pollInput(400, 400);
      assert.strictEqual(pollEast.moveX, 1);
      assert.strictEqual(pollEast.moveY, 0);
      assertAngleClose(pollEast.aimAngle, 0, 0.01, 'Character must face East (0 rad) when moving right');

      // 2. Moving South (0, 1) -> Expected angle PI/2 (~1.571 radians)
      input.touchMoveVector = { x: 0, y: 1 };
      const pollSouth = input.pollInput(400, 400);
      assertAngleClose(pollSouth.aimAngle, Math.PI / 2, 0.01, 'Character must face South (PI/2) when moving down');

      // 3. Moving West (-1, 0) -> Expected angle PI (~3.142 radians)
      input.touchMoveVector = { x: -1, y: 0 };
      const pollWest = input.pollInput(400, 400);
      assertAngleClose(Math.abs(pollWest.aimAngle), Math.PI, 0.01, 'Character must face West (PI) when moving left');

      // 4. Moving North-West (-0.707, -0.707) -> Expected angle -3*PI/4 (~ -2.356 radians)
      input.touchMoveVector = { x: -0.707, y: -0.707 };
      const pollNW = input.pollInput(400, 400);
      assertAngleClose(pollNW.aimAngle, -3 * Math.PI / 4, 0.02, 'Character must face North-West when moving diagonally');
    }
  },

  {
    id: 'T2.16.3',
    name: 'Kinematic Persistence: Last Facing Direction Retained When Stopped on Mobile',
    fn: async () => {
      const input = new InputManager();
      input.isTouchDevice = true;

      // Move South-East (1, 1)
      input.touchMoveVector = { x: 0.707, y: 0.707 };
      const pollMoving = input.pollInput(400, 400);
      const expectedAngle = Math.PI / 4; // 45 degrees
      assertAngleClose(pollMoving.aimAngle, expectedAngle, 0.02);

      // Stop joystick movement
      input.touchMoveVector = { x: 0, y: 0 };
      const pollStopped = input.pollInput(400, 400);

      // Verify that character stays facing South-East, not resetting to 0 or cursor
      assert.strictEqual(pollStopped.moveX, 0);
      assert.strictEqual(pollStopped.moveY, 0);
      assertAngleClose(pollStopped.aimAngle, expectedAngle, 0.02, 'Stopped character must retain last facing angle');
    }
  },

  {
    id: 'T2.16.4',
    name: 'Touch Controls: Dedicated Fire Button Triggers Firing Without Uncontrolled Auto-Fire',
    fn: async () => {
      const input = new InputManager();
      input.isTouchDevice = true;

      // Stand still, no buttons pressed
      let poll = input.pollInput(400, 400);
      assert.strictEqual(poll.firing, false, 'Default input must not fire');

      // Press dedicated touch fire button
      input.isTouchFiring = true;
      poll = input.pollInput(400, 400);
      assert.strictEqual(poll.firing, true, 'isTouchFiring = true must set firing = true');

      // Release touch fire button
      input.isTouchFiring = false;
      poll = input.pollInput(400, 400);
      assert.strictEqual(poll.firing, false, 'Releasing fire button must stop firing');
    }
  },

  {
    id: 'T2.16.5',
    name: 'Touchpad Aiming: Right Screen Aiming Overrides Movement Heading',
    fn: async () => {
      const input = new InputManager();
      input.isTouchDevice = true;

      // Moving North (0, -1)
      input.touchMoveVector = { x: 0, y: -1 };

      // Free-aim touch targeting (500, 400) relative to player at (400, 400) -> East (angle 0)
      input.touchAimId = 999;
      input.mouseX = 500;
      input.mouseY = 400;

      const poll = input.pollInput(400, 400);
      assert.strictEqual(poll.moveY, -1, 'Player is moving North');
      assertAngleClose(poll.aimAngle, 0, 0.01, 'Aim angle must point to touch coordinates (East)');
    }
  },

  {
    id: 'T2.16.6',
    name: 'HUD Mobile Sync: updateMobileTouchUI Synchronizes Ammo and Ability Cooldown',
    fn: async () => {
      const hud = new HUD();

      // Mock DOM environment for HUD test
      const originalDoc = globalThis.document;
      const elements = {
        touchReloadAmmoCount: { textContent: '', style: {} },
        touchAbilityCooldownOverlay: { textContent: '', style: { display: 'none' } },
        btnTouchSprint: { classList: { toggle: (cls, val) => { elements.btnTouchSprint[cls] = val; } } }
      };

      globalThis.document = {
        getElementById: (id) => elements[id] || null
      };

      try {
        // 1. Normal state: 5/6 ammo, ability on cooldown 2.7s
        hud.updateMobileTouchUI({
          ammo: 5,
          maxAmmo: 6,
          isReloading: false,
          abilityCooldownRemaining: 2.7,
          isSprinting: true
        });

        assert.strictEqual(elements.touchReloadAmmoCount.textContent, '5/6');
        assert.strictEqual(elements.touchReloadAmmoCount.style.color, '#ffcf48');
        assert.strictEqual(elements.touchAbilityCooldownOverlay.textContent, '3s');
        assert.strictEqual(elements.touchAbilityCooldownOverlay.style.display, 'flex');
        assert.strictEqual(elements.btnTouchSprint.active, true);

        // 2. Reloading state
        hud.updateMobileTouchUI({
          ammo: 0,
          maxAmmo: 6,
          isReloading: true,
          abilityCooldownRemaining: 0,
          isSprinting: false
        });

        assert.strictEqual(elements.touchReloadAmmoCount.textContent, '...');
        assert.strictEqual(elements.touchReloadAmmoCount.style.color, '#ff9f1c');
        assert.strictEqual(elements.touchAbilityCooldownOverlay.style.display, 'none');
        assert.strictEqual(elements.btnTouchSprint.active, false);
      } finally {
        globalThis.document = originalDoc;
      }
    }
  },

  {
    id: 'T2.16.7',
    name: 'Mobile Website Architecture: Hamburger Menu, Single Column Responsive Rules & Non-Blocking Overlay',
    fn: async () => {
      const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
      const cssPath = path.join(ROOT_DIR, 'client/css/steampunk.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // 1. Verify Hamburger Button & Drawer in HTML
      assert.ok(html.includes('id="btnHamburgerToggle"'), 'index.html must include #btnHamburgerToggle');
      assert.ok(html.includes('id="mobileNavDrawer"'), 'index.html must include #mobileNavDrawer');
      assert.ok(html.includes('id="btnCloseMobileNav"'), 'index.html must include #btnCloseMobileNav');
      assert.ok(html.includes('id="mobileNavBackdrop"'), 'index.html must include #mobileNavBackdrop');
      assert.ok(html.includes('id="mNavBtnHome"'), 'index.html must include #mNavBtnHome');
      assert.ok(html.includes('id="mNavBtnLobby"'), 'index.html must include #mNavBtnLobby');
      assert.ok(html.includes('id="mNavBtnEditor"'), 'index.html must include #mNavBtnEditor');
      assert.ok(html.includes('id="mNavBtnWorkshop"'), 'index.html must include #mNavBtnWorkshop');
      assert.ok(html.includes('id="mNavBtnGame"'), 'index.html must include #mNavBtnGame');
      assert.ok(html.includes('id="mNavBtnAuth"'), 'index.html must include #mNavBtnAuth');

      // 2. Verify Game Loading Overlay in HTML
      assert.ok(html.includes('id="gameLoadingOverlay"'), 'index.html must include #gameLoadingOverlay');
      assert.ok(html.includes('id="gameLoadingTitle"'), 'index.html must include #gameLoadingTitle');
      assert.ok(html.includes('id="gameLoadingDesc"'), 'index.html must include #gameLoadingDesc');

      // 3. Verify CSS styling for hamburger, drawer, and single column layout
      assert.ok(css.includes('.btn-hamburger'), 'steampunk.css must style .btn-hamburger');
      assert.ok(css.includes('.mobile-nav-drawer'), 'steampunk.css must style .mobile-nav-drawer');
      assert.ok(css.includes('.mobile-nav-backdrop'), 'steampunk.css must style .mobile-nav-backdrop');
      assert.ok(css.includes('.game-loading-overlay'), 'steampunk.css must style .game-loading-overlay');
      assert.ok(css.includes('overflow-x: hidden !important'), 'steampunk.css must enforce zero horizontal scroll');
      assert.ok(css.includes('.mode-selector-grid'), 'steampunk.css must responsive format mode selector');
    }
  },

  {
    id: 'T2.16.8',
    name: 'Mobile Combat UX: In-Game Header Suppression, Non-Overlapping Touch Cluster & Elimination Details',
    fn: async () => {
      const cssPath = path.join(ROOT_DIR, 'client/css/steampunk.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // 1. In-game header suppression
      assert.ok(css.includes('body.in-game header.steampunk-header'), 'Must suppress site header when in-game');
      assert.ok(css.includes('body.in-game #view-game .steampunk-header'), 'Must suppress combat header on small screens');

      // 2. Non-overlapping cluster: .touch-util-btn-exit must exist
      assert.ok(css.includes('.touch-util-btn-exit'), 'Must include exit button styling for mobile touch bar');

      // 3. Elimination details payload in server Room.js
      const roomJsPath = path.join(ROOT_DIR, 'server/Room.js');
      const roomJs = fs.readFileSync(roomJsPath, 'utf8');
      assert.ok(roomJs.includes('victimName'), 'Room.js must broadcast victimName in elimination event');
      assert.ok(roomJs.includes('killerName'), 'Room.js must broadcast killerName in elimination event');
    }
  }
];

export async function run() {
  return await runSuiteHelper(suiteName, tests);
}
