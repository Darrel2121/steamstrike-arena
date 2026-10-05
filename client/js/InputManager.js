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
    this.lastPollTime = performance.now();

    // Mobile touch controls & dual thumbsticks
    this.touchMoveId = null;
    this.touchMoveOrigin = null;
    this.touchMoveVector = { x: 0, y: 0 };
    this.touchAimId = null;
    this.isTouchSprint = false;
    this.isTouchDevice = false;

    this.joystickBase = typeof document !== 'undefined' ? document.getElementById('touchJoystickBase') : null;
    this.joystickThumb = typeof document !== 'undefined' ? document.getElementById('touchJoystickThumb') : null;
    this.mobileControlsContainer = typeof document !== 'undefined' ? document.getElementById('mobileTouchControls') : null;

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
    const btnReload = document.getElementById('btnTouchReload');
    const btnSprint = document.getElementById('btnTouchSprint');
    const btnAbility = document.getElementById('btnTouchAbility');

    if (btnReload) {
      const handleReload = (e) => {
        if (e.stopPropagation) e.stopPropagation();
        this.triggerReload();
      };
      btnReload.addEventListener('pointerdown', handleReload);
      btnReload.addEventListener('click', handleReload);
    }

    if (btnSprint) {
      const handleSprint = (e) => {
        if (e.stopPropagation) e.stopPropagation();
        const active = this.toggleSprint();
        btnSprint.classList.toggle('active', active);
      };
      btnSprint.addEventListener('pointerdown', handleSprint);
      btnSprint.addEventListener('click', handleSprint);
    }

    if (btnAbility) {
      const handleAbility = (e) => {
        if (e.stopPropagation) e.stopPropagation();
        this.triggerAbility();
      };
      btnAbility.addEventListener('pointerdown', handleAbility);
      btnAbility.addEventListener('click', handleAbility);
    }
  }

  triggerReload() {
    this.reloadRequested = true;
  }

  triggerAbility() {
    this.abilityRequested = true;
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

    const el = this.targetElement || window;
    el.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    el.addEventListener('touchmove', this.boundTouchMove, { passive: true });
    el.addEventListener('touchend', this.boundTouchEnd, { passive: true });
    el.addEventListener('touchcancel', this.boundTouchEnd, { passive: true });

    if (this.targetElement && this.targetElement.addEventListener) {
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

    const el = this.targetElement || window;
    el.removeEventListener('touchstart', this.boundTouchStart);
    el.removeEventListener('touchmove', this.boundTouchMove);
    el.removeEventListener('touchend', this.boundTouchEnd);
    el.removeEventListener('touchcancel', this.boundTouchEnd);

    if (this.targetElement && this.targetElement.removeEventListener) {
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
    this.isTouchDevice = true;
    if (this.mobileControlsContainer) {
      this.mobileControlsContainer.classList.add('touch-active');
    }
    if (!this.joystickBase && typeof document !== 'undefined') {
      this.joystickBase = document.getElementById('touchJoystickBase');
      this.joystickThumb = document.getElementById('touchJoystickThumb');
    }

    const rect = (this.targetElement && this.targetElement.getBoundingClientRect)
      ? this.targetElement.getBoundingClientRect()
      : { left: 0, top: 0, width: typeof window !== 'undefined' ? window.innerWidth : 800, height: typeof window !== 'undefined' ? window.innerHeight : 800 };

    if (!e.touches) return;

    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      const relX = t.clientX - rect.left;

      // Left 48% of screen -> Movement Joystick
      if (relX < rect.width * 0.48 && this.touchMoveId === null) {
        this.touchMoveId = t.identifier;
        this.touchMoveOrigin = { x: t.clientX, y: t.clientY };
        this.touchMoveVector = { x: 0, y: 0 };

        if (this.joystickBase) {
          this.joystickBase.style.left = `${t.clientX}px`;
          this.joystickBase.style.top = `${t.clientY}px`;
          this.joystickBase.style.display = 'block';
          if (this.joystickThumb) {
            this.joystickThumb.style.transform = 'translate3d(0, 0, 0)';
          }
        }
      } else if (relX >= rect.width * 0.48) {
        // Right side of screen -> Aiming & Primary Weapon Fire
        this.touchAimId = t.identifier;
        this.updateMouseFromClient(t.clientX, t.clientY);
        this.isMouseDown = true;
      }
    }
  }

  onTouchMove(e) {
    if (!e.touches) return;

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
        } else {
          this.touchMoveVector = { x: 0, y: 0 };
        }
      } else if (t.identifier === this.touchAimId) {
        this.updateMouseFromClient(t.clientX, t.clientY);
      }
    }
  }

  onTouchEnd(e) {
    if (!e.touches) {
      this.isMouseDown = false;
      this.touchMoveId = null;
      this.touchMoveOrigin = null;
      this.touchMoveVector = { x: 0, y: 0 };
      if (this.joystickBase) this.joystickBase.style.display = 'none';
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
    const firing = this.isMouseDown || this.isSpaceDown;
    const reload = this.reloadRequested;
    this.reloadRequested = false;
    const ability = this.abilityRequested;
    this.abilityRequested = false;

    // Calculate aim angle from player screen position to mouse cursor
    const aimAngle = Math.atan2(this.mouseY - playerScreenY, this.mouseX - playerScreenX);

    return {
      moveX: Math.round(moveX * 1000) / 1000,
      moveY: Math.round(moveY * 1000) / 1000,
      sprint,
      aimAngle: Math.round(aimAngle * 1000) / 1000,
      firing,
      reload,
      ability,
      dt
    };
  }

  destroy() {
    this.detach();
    this.keys.clear();
  }
}

export default InputManager;
