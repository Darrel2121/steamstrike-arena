/**
 * Steampunk Tactical Input Manager
 * Captures WASD keyboard movement, Shift sprint, R reload, mouse aim angle, and primary weapon fire.
 */

export class InputManager {
  /**
   * @param {HTMLCanvasElement|HTMLElement} [targetElement=window]
   */
  constructor(targetElement = null) {
    this.targetElement = targetElement || (typeof window !== 'undefined' ? window : null);

    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.isMouseDown = false;
    this.isSpaceDown = false;
    this.reloadRequested = false;
    this.abilityRequested = false;
    this.lanternRequested = false;
    this.lastPollTime = performance.now();

    // Mobile touch controls & dual thumbsticks
    this.touchMoveId = null;
    this.touchMoveOrigin = null;
    this.touchMoveVector = { x: 0, y: 0 };
    this.touchAimId = null;
    this.isTouchSprint = false;
    this.isTouchDevice = Boolean(
      typeof window !== 'undefined' && (
        ('ontouchstart' in window) ||
        (navigator && navigator.maxTouchPoints > 0) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      )
    );
    this.isTouchFiring = false;
    this.lastFacingAngle = 0;
    this.lastPlayerScreenX = 400;
    this.lastPlayerScreenY = 400;

    this.joystickBase = typeof document !== 'undefined' ? document.getElementById('touchJoystickBase') : null;
    this.joystickThumb = typeof document !== 'undefined' ? document.getElementById('touchJoystickThumb') : null;
    this.joystickZone = typeof document !== 'undefined' ? document.getElementById('touchJoystickZone') : null;
    this.mobileControlsContainer = typeof document !== 'undefined' ? document.getElementById('mobileTouchControls') : null;

    if (this.isTouchDevice && this.mobileControlsContainer) {
      this.mobileControlsContainer.classList.add('touch-active');
    }

    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundKeyUp = this.onKeyUp.bind(this);
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);
    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);
    this.boundContextMenu = (e) => e.preventDefault();

    this.attach();
    this.attachTouchActionButtons();
  }

  attachTouchActionButtons() {
    if (typeof document === 'undefined') return;

    // Primary FIRE Button
    const btnFire = document.getElementById('btnTouchFire');
    if (btnFire) {
      const startFire = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        this.isTouchFiring = true;
        btnFire.classList.add('active');
      };
      const stopFire = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        this.isTouchFiring = false;
        btnFire.classList.remove('active');
      };

      btnFire.addEventListener('pointerdown', startFire);
      btnFire.addEventListener('pointerup', stopFire);
      btnFire.addEventListener('pointercancel', stopFire);
      btnFire.addEventListener('touchstart', startFire, { passive: false });
      btnFire.addEventListener('touchend', stopFire);
      btnFire.addEventListener('touchcancel', stopFire);
    }

    // RELOAD Button
    const btnReload = document.getElementById('btnTouchReload');
    if (btnReload) {
      let lastReloadTime = 0;
      const handleReload = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastReloadTime < 250) return;
        lastReloadTime = now;
        this.triggerReload();
        btnReload.classList.add('active');
        setTimeout(() => btnReload.classList.remove('active'), 250);
      };
      btnReload.addEventListener('pointerdown', handleReload);
      btnReload.addEventListener('touchstart', handleReload, { passive: false });
    }

    // SPRINT Button (Shift)
    const btnSprint = document.getElementById('btnTouchSprint');
    if (btnSprint) {
      let lastSprintTime = 0;
      const handleSprint = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastSprintTime < 250) return;
        lastSprintTime = now;
        const active = this.toggleSprint();
        btnSprint.classList.toggle('active', active);
      };
      btnSprint.addEventListener('pointerdown', handleSprint);
      btnSprint.addEventListener('touchstart', handleSprint, { passive: false });
    }

    // ABILITY Button [E]
    const btnAbility = document.getElementById('btnTouchAbility');
    if (btnAbility) {
      let lastAbilityTime = 0;
      const handleAbility = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastAbilityTime < 250) return;
        lastAbilityTime = now;
        this.triggerAbility();
        btnAbility.classList.add('active');
        setTimeout(() => btnAbility.classList.remove('active'), 250);
      };
      btnAbility.addEventListener('pointerdown', handleAbility);
      btnAbility.addEventListener('touchstart', handleAbility, { passive: false });
    }

    // LANTERN Button [F]
    const btnLantern = document.getElementById('btnTouchLantern');
    if (btnLantern) {
      let lastLanternTime = 0;
      const handleLantern = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastLanternTime < 250) return;
        lastLanternTime = now;
        this.triggerLanternToggle();
        btnLantern.classList.add('active');
        setTimeout(() => btnLantern.classList.remove('active'), 250);
      };
      btnLantern.addEventListener('pointerdown', handleLantern);
      btnLantern.addEventListener('touchstart', handleLantern, { passive: false });
    }

    // FULLSCREEN / LANDSCAPE Utility Button
    const btnFs = document.getElementById('btnTouchFullscreen');
    if (btnFs) {
      let lastFsTime = 0;
      const handleFs = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastFsTime < 350) return;
        lastFsTime = now;
        if (typeof window !== 'undefined' && window.app) {
          window.app.toggleFullscreen();
          window.app.requestLandscapeOrientation();
        }
      };
      btnFs.addEventListener('pointerdown', handleFs);
      btnFs.addEventListener('touchstart', handleFs, { passive: false });
    }

    // EXIT TO LOBBY Utility Button
    const btnExit = document.getElementById('btnTouchExitMatch');
    if (btnExit) {
      let lastExitTime = 0;
      const handleExit = (e) => {
        if (e.cancelable) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastExitTime < 350) return;
        lastExitTime = now;
        if (typeof window !== 'undefined' && window.app) {
          window.app.returnToLobbyFromMatch();
        }
      };
      btnExit.addEventListener('pointerdown', handleExit);
      btnExit.addEventListener('touchstart', handleExit, { passive: false });
    }
  }

  triggerReload() {
    this.reloadRequested = true;
  }

  triggerAbility() {
    this.abilityRequested = true;
  }

  triggerLanternToggle() {
    this.lanternRequested = true;
  }

  setSprint(active) {
    this.isTouchSprint = Boolean(active);
  }

  toggleSprint() {
    this.isTouchSprint = !this.isTouchSprint;
    return this.isTouchSprint;
  }

  attach() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);

    // Global touch listeners on window capture touches anywhere in the viewport,
    // including #touchJoystickZone and overlay siblings, with passive: false to stop gesture hijacking.
    window.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    window.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    window.addEventListener('touchend', this.boundTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.boundTouchEnd, { passive: false });

    // Also attach to targetElement if provided (e.g. for headless mock test environments)
    if (this.targetElement && this.targetElement !== window && this.targetElement.addEventListener) {
      this.targetElement.addEventListener('touchstart', this.boundTouchStart, { passive: false });
      this.targetElement.addEventListener('touchmove', this.boundTouchMove, { passive: false });
      this.targetElement.addEventListener('touchend', this.boundTouchEnd, { passive: false });
      this.targetElement.addEventListener('touchcancel', this.boundTouchEnd, { passive: false });
      this.targetElement.addEventListener('contextmenu', this.boundContextMenu);
    }
  }

  detach() {
    if (typeof window === 'undefined') return;

    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);

    window.removeEventListener('touchstart', this.boundTouchStart);
    window.removeEventListener('touchmove', this.boundTouchMove);
    window.removeEventListener('touchend', this.boundTouchEnd);
    window.removeEventListener('touchcancel', this.boundTouchEnd);

    if (this.targetElement && this.targetElement !== window && this.targetElement.removeEventListener) {
      this.targetElement.removeEventListener('touchstart', this.boundTouchStart);
      this.targetElement.removeEventListener('touchmove', this.boundTouchMove);
      this.targetElement.removeEventListener('touchend', this.boundTouchEnd);
      this.targetElement.removeEventListener('touchcancel', this.boundTouchEnd);
      this.targetElement.removeEventListener('contextmenu', this.boundContextMenu);
    }
  }

  onKeyDown(e) {
    this.keys.add(e.code);
    const keyLower = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (e.code === 'KeyR' || keyLower === 'r' || keyLower === 'к') {
      this.reloadRequested = true;
    }
    if (e.code === 'KeyE' || keyLower === 'e' || keyLower === 'у') {
      this.abilityRequested = true;
    }
    if (e.code === 'KeyQ' || keyLower === 'q' || keyLower === 'й' || e.code === 'KeyF' || keyLower === 'f' || keyLower === 'а') {
      this.triggerLanternToggle();
    }
    if (e.code === 'Space') {
      this.isSpaceDown = true;
    }
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
    if (e.code === 'Space') {
      this.isSpaceDown = false;
    }
  }

  updateMouseFromClient(clientX, clientY) {
    if (this.targetElement && this.targetElement.getBoundingClientRect) {
      const rect = this.targetElement.getBoundingClientRect();
      this.mouseX = clientX - rect.left;
      this.mouseY = clientY - rect.top;
    } else {
      this.mouseX = clientX;
      this.mouseY = clientY;
    }
  }

  onTouchStart(e) {
    if (typeof window !== 'undefined' && window.app && window.app.currentView && window.app.currentView !== 'game') {
      return;
    }

    this.isTouchDevice = true;
    if (this.mobileControlsContainer) {
      this.mobileControlsContainer.classList.add('touch-active');
    }
    if (!this.joystickBase && typeof document !== 'undefined') {
      this.joystickBase = document.getElementById('touchJoystickBase');
      this.joystickThumb = document.getElementById('touchJoystickThumb');
    }
    if (!this.joystickZone && typeof document !== 'undefined') {
      this.joystickZone = document.getElementById('touchJoystickZone');
    }

    const rect = (this.targetElement && this.targetElement.getBoundingClientRect)
      ? this.targetElement.getBoundingClientRect()
      : { left: 0, top: 0, width: typeof window !== 'undefined' ? window.innerWidth : 800, height: typeof window !== 'undefined' ? window.innerHeight : 800 };

    if (!e.touches) return;

    let handledGameTouch = false;

    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];

      // If the touch started on dedicated buttons or modals, don't hijack as joystick/aim
      if (t.target && t.target.closest && t.target.closest(
        '.touch-action-cluster, .touch-btn, .touch-top-bar, .touch-util-btn, .landscape-rotate-prompt, .modal-card, .modal-overlay, .steampunk-header, button, input, select, a'
      )) {
        continue;
      }

      const relX = t.clientX - rect.left;
      const isMovementTouch = Boolean((t.target && t.target.closest && t.target.closest('#touchJoystickZone')) || (relX < rect.width * 0.48));

      // Left 48% of screen or inside joystick zone -> Movement Joystick
      if (isMovementTouch && this.touchMoveId === null) {
        this.touchMoveId = t.identifier;
        this.touchMoveOrigin = { x: t.clientX, y: t.clientY };
        this.touchMoveVector = { x: 0, y: 0 };

        if (this.joystickBase) {
          const zoneRect = (this.joystickZone && this.joystickZone.getBoundingClientRect)
            ? this.joystickZone.getBoundingClientRect()
            : rect;
          const localX = t.clientX - zoneRect.left;
          const localY = t.clientY - zoneRect.top;
          this.joystickBase.style.left = `${localX}px`;
          this.joystickBase.style.top = `${localY}px`;
          this.joystickBase.style.display = 'block';
          if (this.joystickThumb) {
            this.joystickThumb.style.transform = 'translate3d(0, 0, 0)';
          }
        }
        handledGameTouch = true;
      } else if (!isMovementTouch && this.touchAimId === null) {
        // Right side of screen -> Aiming & Weapon Fire
        this.touchAimId = t.identifier;
        this.updateMouseFromClient(t.clientX, t.clientY);
        this.isMouseDown = true;
        this.lastFacingAngle = Math.atan2(this.mouseY - this.lastPlayerScreenY, this.mouseX - this.lastPlayerScreenX);
        handledGameTouch = true;
      }
    }

    if (handledGameTouch && e.cancelable) {
      e.preventDefault();
    }
  }

  onTouchMove(e) {
    if (typeof window !== 'undefined' && window.app && window.app.currentView && window.app.currentView !== 'game') {
      return;
    }

    if (!e.touches) return;

    let handledGameMove = false;

    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];

      if (t.identifier === this.touchMoveId && this.touchMoveOrigin) {
        const dx = t.clientX - this.touchMoveOrigin.x;
        const dy = t.clientY - this.touchMoveOrigin.y;
        const maxRadius = 45;
        const dist = Math.hypot(dx, dy);

        if (dist > 0) {
          const clamped = Math.min(dist, maxRadius);
          const ratio = clamped / maxRadius;
          this.touchMoveVector = {
            x: (dx / dist) * ratio,
            y: (dy / dist) * ratio
          };
          if (this.joystickThumb) {
            const thumbX = (dx / dist) * clamped;
            const thumbY = (dy / dist) * clamped;
            this.joystickThumb.style.transform = `translate3d(${thumbX}px, ${thumbY}px, 0)`;
          }

          // In mobile version: character turns together with movement
          if (dist > 5) {
            this.lastFacingAngle = Math.atan2(dy, dx);
          }
        } else {
          this.touchMoveVector = { x: 0, y: 0 };
        }
        handledGameMove = true;
      } else if (t.identifier === this.touchAimId) {
        this.updateMouseFromClient(t.clientX, t.clientY);
        this.lastFacingAngle = Math.atan2(this.mouseY - this.lastPlayerScreenY, this.mouseX - this.lastPlayerScreenX);
        handledGameMove = true;
      }
    }

    if (handledGameMove && e.cancelable) {
      e.preventDefault();
    }
  }

  onTouchEnd(e) {
    if (!e.touches || e.touches.length === 0) {
      this.isMouseDown = false;
      this.touchMoveId = null;
      this.touchMoveOrigin = null;
      this.touchMoveVector = { x: 0, y: 0 };
      this.touchAimId = null;
      if (this.joystickBase) this.joystickBase.style.display = 'none';
      if (this.joystickThumb) this.joystickThumb.style.transform = 'translate3d(0, 0, 0)';
      return;
    }

    const remainingIds = new Set();
    for (let i = 0; i < e.touches.length; i++) {
      remainingIds.add(e.touches[i].identifier);
    }

    if (this.touchMoveId !== null && !remainingIds.has(this.touchMoveId)) {
      this.touchMoveId = null;
      this.touchMoveOrigin = null;
      this.touchMoveVector = { x: 0, y: 0 };
      if (this.joystickBase) {
        this.joystickBase.style.display = 'none';
      }
      if (this.joystickThumb) {
        this.joystickThumb.style.transform = 'translate3d(0, 0, 0)';
      }
    }

    if (this.touchAimId !== null && !remainingIds.has(this.touchAimId)) {
      this.touchAimId = null;
      this.isMouseDown = false;
    }
  }

  onMouseMove(e) {
    this.updateMouseFromClient(e.clientX, e.clientY);
  }

  onMouseDown(e) {
    if (e.button === 0) { // Primary fire
      this.isMouseDown = true;
    }
  }

  onMouseUp(e) {
    if (e.button === 0) {
      this.isMouseDown = false;
    }
  }

  /**
   * Resets poll time to current timestamp (e.g. on match start).
   */
  resetPollTime() {
    this.lastPollTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /**
   * Polls and formats current input state for transmission to server.
   * @param {number} [playerScreenX=400]
   * @param {number} [playerScreenY=400]
   * @returns {{ moveX: number, moveY: number, sprint: boolean, aimAngle: number, firing: boolean, reload: boolean, dt: number }}
   */
  pollInput(playerScreenX = 400, playerScreenY = 400) {
    this.lastPlayerScreenX = playerScreenX;
    this.lastPlayerScreenY = playerScreenY;

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const elapsed = Math.max(1, Math.min(100, now - this.lastPollTime));
    const dt = Math.round(elapsed * 100) / 100;
    this.lastPollTime = now;

    let moveX = 0;
    let moveY = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;

    // Normalize diagonal movement
    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
      moveX /= len;
      moveY /= len;
    }

    // Blend or override with virtual touch joystick if active
    if (this.touchMoveVector && (this.touchMoveVector.x !== 0 || this.touchMoveVector.y !== 0)) {
      moveX = this.touchMoveVector.x;
      moveY = this.touchMoveVector.y;
    }

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.isTouchSprint;
    const firing = this.isMouseDown || this.isSpaceDown || this.isTouchFiring;
    const reload = this.reloadRequested;
    this.reloadRequested = false;
    const ability = this.abilityRequested;
    this.abilityRequested = false;
    const toggleLantern = this.lanternRequested;
    this.lanternRequested = false;

    // Calculate aim angle
    let aimAngle;
    if (this.touchAimId !== null) {
      // Direct touch aiming on right screen
      aimAngle = Math.atan2(this.mouseY - playerScreenY, this.mouseX - playerScreenX);
      this.lastFacingAngle = aimAngle;
    } else if (this.isTouchDevice && (Math.hypot(moveX, moveY) > 0.05)) {
      // In mobile version: character turns together with movement!
      aimAngle = Math.atan2(moveY, moveX);
      this.lastFacingAngle = aimAngle;
    } else if (this.isTouchDevice) {
      // In mobile version when stopped: preserve last facing angle
      aimAngle = this.lastFacingAngle;
    } else {
      // Desktop: aim towards mouse cursor
      aimAngle = Math.atan2(this.mouseY - playerScreenY, this.mouseX - playerScreenX);
      this.lastFacingAngle = aimAngle;
    }

    return {
      moveX: Math.round(moveX * 1000) / 1000,
      moveY: Math.round(moveY * 1000) / 1000,
      sprint,
      aimAngle: Math.round(aimAngle * 1000) / 1000,
      firing,
      reload,
      ability,
      toggleLantern,
      dt
    };
  }

  destroy() {
    this.detach();
    this.keys.clear();
  }
}

export default InputManager;
