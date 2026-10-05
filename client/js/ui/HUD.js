/**
 * Steampunk Tactical Heads-Up Display (HUD)
 * Layer 6 in the rendering pipeline: Screen-space instrumentation.
 * Features:
 * 1. Brass Steam Pressure Gauge (Stamina / Sprint)
 * 2. Alchemical Glass Health Vial (HP & Vitality)
 * 3. Revolving Ammo Cylinder (Loaded cartridges & Reload animation)
 */

import {
  PLAYER_MAX_HP,
  PLAYER_STAMINA_MAX,
  THEME_COLORS
} from '../../../shared/Constants.js';
import { WEAPON_DEFINITIONS, getEmblemDefinition } from '../../../shared/ProgressionSchema.js';

export class HUD {
  /**
   * @param {Object} [options]
   */
  constructor(options = {}) {
    this.reloadRotation = 0;
    this.lastReloadTime = 0;
    this.pulseTimer = 0;
    this.notifications = [];
    this.killFeed = [];
    this.matchOutcome = null;
    this.buttonBounds = {};
    this.hoveredButton = null;
  }

  /**
   * Adds an elimination event to the top-right Kill Feed list.
   * @param {Object} data
   * @param {string} data.killerName
   * @param {string} data.victimName
   * @param {boolean} [data.isKillerLocal=false]
   * @param {boolean} [data.isVictimLocal=false]
   * @param {string} [data.type='elimination'] - 'kill' | 'death' | 'elimination'
   * @param {number} [data.duration=5.0]
   */
  addKillFeed(data = {}) {
    const killerName = data.killerName || 'Супротивник';
    const victimName = data.victimName || 'Боєць';
    const isKillerLocal = Boolean(data.isKillerLocal);
    const isVictimLocal = Boolean(data.isVictimLocal);
    const type = data.type || (isVictimLocal ? 'death' : (isKillerLocal ? 'kill' : 'elimination'));
    const duration = data.duration || 5.0;

    this.killFeed.push({
      id: Date.now() + Math.random(),
      killerName,
      victimName,
      isKillerLocal,
      isVictimLocal,
      type,
      duration,
      elapsed: 0,
      alpha: 0
    });

    if (this.killFeed.length > 6) {
      this.killFeed.shift();
    }
  }

  /**
   * Adds an in-canvas message notification (e.g. elimination, pickup, status).
   * Elimination messages are routed to the top-right Kill Feed list.
   * Other tactical messages are rendered as central alert toasts.
   * @param {string} text - Message text
   * @param {Object} [options]
   */
  addMessage(text, options = {}) {
    if (!text) return;
    const type = options.type || 'info';

    // Route elimination messages to top-right Kill Feed list
    if (type === 'kill' || type === 'death' || type === 'elimination' || text.includes('ліквідував')) {
      let killerName = options.killerName;
      let victimName = options.victimName;
      let isKillerLocal = Boolean(options.isKillerLocal);
      let isVictimLocal = Boolean(options.isVictimLocal);

      if (!killerName || !victimName) {
        if (type === 'death' || text.includes('Вас ліквідував')) {
          victimName = 'Ви';
          isVictimLocal = true;
          const match = text.match(/ліквідував\s+([^!]+)/);
          killerName = match ? match[1].trim() : 'Супротивник';
        } else if (type === 'kill' || text.includes('Ви ліквідували')) {
          killerName = 'Ви';
          isKillerLocal = true;
          const match = text.match(/ліквідували\s+([^!]+)/);
          victimName = match ? match[1].trim() : 'Супротивник';
        } else {
          // General "X ліквідував Y"
          const clean = text.replace(/^[☠⚡⚠️\s]+/, '');
          const parts = clean.split(' ліквідував ');
          killerName = parts[0] ? parts[0].trim() : 'Боєць';
          victimName = parts[1] ? parts[1].trim() : 'Супротивник';
        }
      }

      this.addKillFeed({
        killerName,
        victimName,
        isKillerLocal,
        isVictimLocal,
        type,
        duration: options.duration || 5.0
      });
      return;
    }

    let defaultColor = '#ffcf48';
    if (type === 'pickup') defaultColor = '#2ec4b6';
    else if (type === 'warn') defaultColor = '#ff9f1c';

    this.notifications.push({
      id: Date.now() + Math.random(),
      text,
      type,
      color: options.color || defaultColor,
      duration: options.duration || 3.5,
      elapsed: 0,
      alpha: 0
    });

    if (this.notifications.length > 5) {
      this.notifications.shift();
    }
  }

  /**
   * Sets the authoritative match outcome for canvas overlay rendering.
   * @param {Object} outcome
   */
  setMatchOutcome(outcome) {
    this.matchOutcome = outcome;
  }

  /**
   * Clears the match outcome overlay and clears match-specific HUD state.
   */
  clearMatchOutcome() {
    this.matchOutcome = null;
    this.buttonBounds = {};
    this.hoveredButton = null;
    this.killFeed = [];
    this.notifications = [];
  }

  /**
   * Updates animations and state for HUD instruments.
   * @param {number} dt - Elapsed seconds
   * @param {Object} player
   */
  update(dt = 0.016, player = {}) {
    this.pulseTimer += dt;
    if (player.isReloading || player.state === 'reloading') {
      this.reloadRotation += dt * Math.PI * 4; // Fast cylinder revolution during reload
    }

    // Update general notifications alpha and lifespans
    for (let i = this.notifications.length - 1; i >= 0; i--) {
      const n = this.notifications[i];
      n.elapsed += dt;
      if (n.elapsed >= n.duration) {
        this.notifications.splice(i, 1);
        continue;
      }

      // Smooth fade-in (0.2s) and fade-out (last 0.4s)
      if (n.elapsed < 0.2) {
        n.alpha = n.elapsed / 0.2;
      } else if (n.elapsed > (n.duration - 0.4)) {
        n.alpha = Math.max(0, (n.duration - n.elapsed) / 0.4);
      } else {
        n.alpha = 1.0;
      }
    }

    // Update top-right killfeed alpha and lifespans
    if (this.killFeed) {
      for (let i = this.killFeed.length - 1; i >= 0; i--) {
        const k = this.killFeed[i];
        k.elapsed += dt;
        if (k.elapsed >= k.duration) {
          this.killFeed.splice(i, 1);
          continue;
        }

        if (k.elapsed < 0.2) {
          k.alpha = k.elapsed / 0.2;
        } else if (k.elapsed > (k.duration - 0.5)) {
          k.alpha = Math.max(0, (k.duration - k.elapsed) / 0.5);
        } else {
          k.alpha = 1.0;
        }
      }
    }
  }

  /**
   * Checks if screen coordinate falls inside any active HUD buttons (e.g. Match Over actions).
   * @param {number} x
   * @param {number} y
   * @returns {string|null} - 'restart' | 'lobby' | null
   */
  checkButtonClick(x, y) {
    if (!this.matchOutcome || !this.buttonBounds) return null;
    for (const [btnKey, rect] of Object.entries(this.buttonBounds)) {
      if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return btnKey;
      }
    }
    return null;
  }

  /**
   * Updates button hover state based on mouse coordinates.
   * @param {number} x
   * @param {number} y
   */
  handleMouseMove(x, y) {
    const clicked = this.checkButtonClick(x, y);
    this.hoveredButton = clicked;
  }

  /**
   * Renders Layer 6: Steampunk Tactical HUD onto the canvas in screen coordinates.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} player - Local player entity state
   * @param {number} width - Viewport width
   * @param {number} height - Viewport height
   */
  render(ctx, player = {}, width = 800, height = 600, matchContext = {}) {
    if (!ctx) return;

    ctx.save();
    // Enforce normal opaque composite operation (avoid bleed from visibility lighter pass)
    ctx.globalCompositeOperation = 'source-over';

    const maxHp = player.maxHp || PLAYER_MAX_HP || 100;
    const hp = Math.max(0, Math.min(maxHp, player.hp ?? maxHp));
    const stamina = Math.max(0, Math.min(PLAYER_STAMINA_MAX, player.stamina ?? PLAYER_STAMINA_MAX));
    const ammo = player.ammo ?? 6;
    const maxAmmo = player.maxAmmo ?? 6;
    const isReloading = Boolean(player.isReloading || player.state === 'reloading');

    // Update DOM-based mobile touch controls (ammo badge, ability cooldown)
    this.updateMobileTouchUI(player);

    // 1. Bottom-Left: Alchemical Health Vial
    this.renderHealthVial(ctx, 30, height - 120, hp, maxHp);

    // Optional Team Badge next to health vial
    if (player.team) {
      this.renderTeamBadge(ctx, 30, height - 145, player.team);
    }

    // 2. Bottom-Center: Brass Steam Pressure Gauge (Dynamic Manometer with Jitter & Low Pressure Warning)
    this.renderSteamGauge(ctx, width / 2, height - 55, stamina, PLAYER_STAMINA_MAX, Boolean(player.isSprinting));

    // Detect if touch controls are actively being used (skip canvas dial & cylinder to prevent overlap with DOM buttons)
    const isTouchActive = typeof document !== 'undefined' &&
      (document.getElementById('mobileTouchControls')?.classList.contains('touch-active') ||
       (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
       (typeof window !== 'undefined' && 'ontouchstart' in window && window.innerWidth <= 1024));

    if (!isTouchActive) {
      // 2.5 Bottom-Right: Steampunk Tactical Class Ability Dial
      this.renderAbilityDial(ctx, width - 175, height - 65, player);

      // 3. Bottom-Right: Revolving Ammo Cylinder
      this.renderAmmoCylinder(ctx, width - 85, height - 65, ammo, maxAmmo, isReloading);
    }

    const isTeam = matchContext && (matchContext.gameMode === 'team_dm' || matchContext.gameMode === 'team_elim');

    if (!isTeam) {
      // 4. Top-Left: FFA / Solo Leaderboard with Kill Counts
      const lbH = this.renderFFALeaderboard(ctx, 16, 16, player, matchContext);
      // Tactical Compass & Weapon Label sits neatly below the Leaderboard
      this.renderWeaponCard(ctx, 16, 16 + lbH + 8, player);
    } else {
      // 4. Top-Left: Tactical Compass & Weapon Label (Standard position in Team mode)
      this.renderWeaponCard(ctx, 16, 16, player);
    }

    // 5. Top-Center: Game Mode & Match Scoreboard (Global score in Team mode, compact target in FFA)
    this.renderGameModeScoreboard(ctx, width, height, player, matchContext);

    const isRespawnMode = matchContext && (matchContext.gameMode === 'ffa_dm' || matchContext.gameMode === 'team_dm');

    // 5.5 Spectator Banner when eliminated in permadeath mode
    if (!player.isAlive && !isRespawnMode && !this.matchOutcome) {
      this.renderSpectatorBanner(ctx, width, height);
    }

    // 6. Top-Right: Elimination Kill Feed List (Who killed whom)
    this.renderKillFeed(ctx, width, height);

    // 6.5 In-Canvas System Toast Notifications (e.g. Warnings, Pickups)
    this.renderNotifications(ctx, width, height, player);

    // 7. Respawn Countdown Overlay (when local player is waiting to respawn in deathmatch)
    if (!player.isAlive && isRespawnMode && !this.matchOutcome) {
      const displayTimer = Math.max(0, player.respawnTimer || 0);
      this.renderRespawnOverlay(ctx, width, height, displayTimer);
    }

    // 8. Authoritative Canvas Match Over Overlay (When match concludes)
    if (this.matchOutcome) {
      this.renderMatchOver(ctx, width, height, player);
    }

    ctx.restore();
  }

  /**
   * Renders the Alchemical Glass Health Vial.
   * Cylindrical test tube with brass fittings, teal liquid elixir, and liquid bubbles.
   */
  renderHealthVial(ctx, x, y, hp, maxHp) {
    ctx.save();

    const vialWidth = 28;
    const vialHeight = 90;
    const fillRatio = maxHp > 0 ? Math.min(1.0, Math.max(0.0, hp / maxHp)) : 0;
    const isCritical = fillRatio <= 0.25;

    // Outer brass bracket / mounting fixture
    ctx.fillStyle = '#22262d';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 4, y - 6, vialWidth + 8, vialHeight + 12, 6);
    ctx.fill();
    ctx.stroke();

    // Rivets on mounting plate
    ctx.fillStyle = '#ffcf48';
    ctx.beginPath();
    ctx.arc(x - 1, y - 2, 2, 0, Math.PI * 2);
    ctx.arc(x + vialWidth + 1, y - 2, 2, 0, Math.PI * 2);
    ctx.arc(x - 1, y + vialHeight + 2, 2, 0, Math.PI * 2);
    ctx.arc(x + vialWidth + 1, y + vialHeight + 2, 2, 0, Math.PI * 2);
    ctx.fill();

    // Glass tube inner background (dark alchemical chamber)
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(x, y, vialWidth, vialHeight);

    // Liquid fill
    const liquidHeight = vialHeight * fillRatio;
    const liquidY = y + vialHeight - liquidHeight;

    if (liquidHeight > 0) {
      // Color gradient: Teal alchemical elixir OR Pulsing crimson when critical
      const liquidGrad = ctx.createLinearGradient(x, liquidY, x + vialWidth, liquidY);
      if (isCritical) {
        const pulse = 0.5 + 0.5 * Math.sin(this.pulseTimer * 8);
        liquidGrad.addColorStop(0, `rgba(231, 29, 54, ${0.7 + pulse * 0.3})`);
        liquidGrad.addColorStop(0.5, `rgba(255, 90, 95, ${0.9 + pulse * 0.1})`);
        liquidGrad.addColorStop(1, `rgba(180, 20, 40, ${0.7 + pulse * 0.3})`);
      } else {
        liquidGrad.addColorStop(0, '#1b8a82');
        liquidGrad.addColorStop(0.5, '#2ec4b6');
        liquidGrad.addColorStop(1, '#156b64');
      }

      ctx.fillStyle = liquidGrad;
      ctx.fillRect(x + 1, liquidY, vialWidth - 2, liquidHeight);

      // Liquid meniscus surface highlight
      ctx.fillStyle = isCritical ? '#ff9999' : '#b2f5ea';
      ctx.fillRect(x + 2, liquidY, vialWidth - 4, 2);

      // Bubbles in liquid
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      const b1Y = liquidY + (liquidHeight * 0.4 + Math.sin(this.pulseTimer * 3) * 6) % liquidHeight;
      const b2Y = liquidY + (liquidHeight * 0.7 + Math.cos(this.pulseTimer * 2) * 8) % liquidHeight;
      ctx.beginPath();
      ctx.arc(x + 8, b1Y, 1.5, 0, Math.PI * 2);
      ctx.arc(x + 18, b2Y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Measurement ticks on glass
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const tickY = y + (vialHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x + 2, tickY);
      ctx.lineTo(x + 7, tickY);
      ctx.stroke();
    }

    // Glass specular reflection highlight
    const glassReflect = ctx.createLinearGradient(x, y, x + vialWidth, y);
    glassReflect.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    glassReflect.addColorStop(0.3, 'rgba(255, 255, 255, 0.05)');
    glassReflect.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
    ctx.fillStyle = glassReflect;
    ctx.fillRect(x, y, vialWidth, vialHeight);

    // HP Text Readout
    ctx.fillStyle = isCritical ? '#ff5a5f' : '#ffcf48';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(hp)} HP`, x + vialWidth + 8, y + vialHeight / 2 + 4);

    ctx.restore();
  }

  /**
   * Renders the Brass Steam Pressure Gauge for sprint stamina.
   * Semi-circular dial with brass bezel, graduated markings, dynamic pointer needle,
   * live PSI readout, needle vibration during sprint, and low pressure alarm.
   */
  renderSteamGauge(ctx, cx, cy, stamina, maxStamina, isSprinting = false) {
    ctx.save();

    const radius = 42;
    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const totalArc = endAngle - startAngle;
    const ratio = Math.max(0, Math.min(1.0, stamina / (maxStamina || 100)));
    const baseNeedleAngle = startAngle + totalArc * ratio;

    // Steam needle vibration when sprinting, and erratic jitter when pressure is critically low
    const isLow = stamina <= 20;
    const jitter = isSprinting
      ? (Math.sin(this.pulseTimer * 50) * 0.045 + (Math.random() - 0.5) * 0.02)
      : (isLow ? (Math.sin(this.pulseTimer * 25) * 0.02) : 0);
    const needleAngle = Math.max(startAngle, Math.min(endAngle, baseNeedleAngle + jitter));

    // 1. Heavy dark iron mounting plate
    ctx.fillStyle = '#1c2026';
    ctx.strokeStyle = '#22262d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 2. Outer brass bezel
    const brassGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    brassGrad.addColorStop(0, '#ffcf48');
    brassGrad.addColorStop(0.5, '#c59b27');
    brassGrad.addColorStop(1, '#703816');
    ctx.strokeStyle = brassGrad;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Dial face (dark parchment / bronze background)
    ctx.fillStyle = '#0f1318';
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.fill();

    // 3b. Low pressure alarm pulse
    if (isLow) {
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTimer * 10);
      ctx.fillStyle = `rgba(231, 29, 54, ${0.12 + pulse * 0.22})`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Steam pressure background arc (dim track)
    ctx.strokeStyle = 'rgba(255, 207, 72, 0.15)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 8, startAngle, endAngle);
    ctx.stroke();

    // 5. Active pressure steam arc (Cyan / Amber glow)
    const arcGrad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    arcGrad.addColorStop(0, '#e71d36');
    arcGrad.addColorStop(0.4, '#ffcf48');
    arcGrad.addColorStop(1, '#2ec4b6');
    ctx.strokeStyle = arcGrad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 8, startAngle, needleAngle);
    ctx.stroke();

    // 6. Gauge graduation ticks
    const numTicks = 8;
    ctx.strokeStyle = '#9d9685';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= numTicks; i++) {
      const a = startAngle + (totalArc / numTicks) * i;
      const x1 = cx + Math.cos(a) * (radius - 13);
      const y1 = cy + Math.sin(a) * (radius - 13);
      const x2 = cx + Math.cos(a) * (radius - 5);
      const y2 = cy + Math.sin(a) * (radius - 5);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 7. Central brass hub & Needle
    const nx = cx + Math.cos(needleAngle) * (radius - 10);
    const ny = cy + Math.sin(needleAngle) * (radius - 10);

    ctx.strokeStyle = isLow ? '#ff5a5f' : '#ffcf48';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    // Hub center nut
    ctx.fillStyle = '#c59b27';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c2026';
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    // Dial label & live numerical PSI readout
    ctx.fillStyle = isLow ? '#ff5a5f' : '#c59b27';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(stamina)} PSI`, cx, cy + 14);

    ctx.fillStyle = '#8e9aa8';
    ctx.font = '7px monospace';
    ctx.fillText(isLow ? 'LOW PRESSURE' : 'STEAM BOILER', cx, cy + 24);

    ctx.restore();
  }

  /**
   * Renders the Revolving Ammo Cylinder.
   * Six-chamber revolver wheel with loaded brass cartridges vs empty chambers.
   */
  renderAmmoCylinder(ctx, cx, cy, ammo, maxAmmo = 6, isReloading = false) {
    ctx.save();

    const cylinderRadius = 38;
    const numChambers = Math.max(1, maxAmmo);
    const orbitRadius = 21;
    const chamberRadius = Math.max(1.8, Math.min(7.5, (orbitRadius * Math.PI) / numChambers - 0.8));

    // Outer dark steel cylinder casing
    ctx.fillStyle = '#1a1d24';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, cylinderRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Fluted cylinder grooves (scallops on cylinder edge)
    ctx.fillStyle = '#0f1116';
    const numFlutes = Math.min(numChambers, 12);
    for (let i = 0; i < numFlutes; i++) {
      const a = (i / numFlutes) * Math.PI * 2 + this.reloadRotation;
      const gx = cx + Math.cos(a) * (cylinderRadius - 3);
      const gy = cy + Math.sin(a) * (cylinderRadius - 3);
      ctx.beginPath();
      ctx.arc(gx, gy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Revolver center ratchet pin
    ctx.fillStyle = '#703816';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffcf48';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Individual cartridge chambers
    for (let i = 0; i < numChambers; i++) {
      const a = (i / numChambers) * Math.PI * 2 + this.reloadRotation - Math.PI / 2;
      const chX = cx + Math.cos(a) * orbitRadius;
      const chY = cy + Math.sin(a) * orbitRadius;

      const isLoaded = i < ammo;

      if (isLoaded) {
        // Brass cartridge case & primer
        const brassGrad = ctx.createRadialGradient(chX - 2, chY - 2, 1, chX, chY, chamberRadius);
        brassGrad.addColorStop(0, '#ffe082');
        brassGrad.addColorStop(0.7, '#c59b27');
        brassGrad.addColorStop(1, '#8a6210');

        ctx.fillStyle = brassGrad;
        ctx.beginPath();
        ctx.arc(chX, chY, chamberRadius, 0, Math.PI * 2);
        ctx.fill();

        // Center percussion primer
        const primerRadius = Math.max(0.6, chamberRadius * 0.35);
        ctx.fillStyle = '#cf712b';
        ctx.beginPath();
        ctx.arc(chX, chY, primerRadius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Empty chamber: dark hollow bore
        ctx.fillStyle = '#0a0c10';
        ctx.strokeStyle = '#2d333f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(chX, chY, chamberRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Ammo readout label
    ctx.fillStyle = isReloading ? '#ffcf48' : '#e6e1d6';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    const text = isReloading ? 'ПЕРЕЗАРЯДКА' : `${ammo}/${maxAmmo}`;
    ctx.fillText(text, cx, cy + cylinderRadius + 16);

    ctx.restore();
  }

  /**
   * Renders Tactical Class Ability Dial with Steampunk Cog Bezel,
   * Radial Cooldown Sweep, and Active Glow Indicator.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx
   * @param {number} cy
   * @param {Object} player
   */
  renderAbilityDial(ctx, cx, cy, player) {
    ctx.save();

    const classId = player.classId || 'vanguard';
    const cooldown = typeof player.abilityCooldown === 'number' ? player.abilityCooldown : 0;
    const isActive = Boolean(player.abilityActive || player.overdriveActive || player.sonarActive || player.smokeActive || (player.shieldHp > 0));
    const shieldHp = player.shieldHp || 0;

    let icon = '⚡';
    let label = 'ФОРСАЖ';
    let baseCooldown = 12.0;

    if (classId === 'sharpshooter') {
      icon = '🎯';
      label = 'СОНАР';
      baseCooldown = 14.0;
    } else if (classId === 'juggernaut') {
      icon = '⚙️';
      label = 'БАСТІОН';
      baseCooldown = 16.0;
    } else if (classId === 'infiltrator') {
      icon = '🗡️';
      label = 'ДИМ';
      baseCooldown = 12.0;
    }

    const radius = 28;

    // 1. Outer brass cog / ring
    ctx.fillStyle = '#141820';
    ctx.strokeStyle = isActive ? '#2ec4b6' : (cooldown > 0 ? '#5a6270' : '#c59b27');
    ctx.lineWidth = 2.5;

    // Active pulse glow
    if (isActive) {
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTimer * 10);
      ctx.shadowColor = '#2ec4b6';
      ctx.shadowBlur = 10 + pulse * 6;
    } else if (cooldown <= 0) {
      ctx.shadowColor = 'rgba(197, 155, 39, 0.4)';
      ctx.shadowBlur = 6;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Cog teeth details (8 decorative notches around perimeter)
    const numCogs = 8;
    ctx.fillStyle = isActive ? '#2ec4b6' : (cooldown > 0 ? '#48505e' : '#c59b27');
    for (let i = 0; i < numCogs; i++) {
      const a = (i / numCogs) * Math.PI * 2 + (isActive ? this.pulseTimer * 2 : 0);
      const cogX = cx + Math.cos(a) * (radius + 2);
      const cogY = cy + Math.sin(a) * (radius + 2);
      ctx.beginPath();
      ctx.arc(cogX, cogY, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Ability Icon
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, cx, cy - 2);

    // 3. Cooldown Sweep (dark mask that recedes clockwise)
    if (cooldown > 0) {
      const maxCd = player.abilityDuration ? (baseCooldown || 12.0) : 12.0;
      const progress = Math.min(1.0, Math.max(0.0, cooldown / maxCd));
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (Math.PI * 2 * progress);

      ctx.fillStyle = 'rgba(10, 12, 16, 0.80)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius - 1, startAngle, endAngle, false);
      ctx.closePath();
      ctx.fill();

      // Cooldown seconds readout
      ctx.fillStyle = '#ffcf48';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`${cooldown.toFixed(1)}s`, cx, cy + 1);
    } else if (isActive) {
      // Active label overlay
      ctx.fillStyle = '#2ec4b6';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(shieldHp > 0 ? `🛡${Math.round(shieldHp)}` : 'АКТИВНО', cx, cy + 10);
    }

    // 4. Hotkey Badge [E]
    const badgeW = 22;
    const badgeH = 14;
    const badgeY = cy - radius - 6;

    ctx.fillStyle = cooldown > 0 ? '#1f242d' : (isActive ? '#1b8a82' : '#703816');
    ctx.strokeStyle = cooldown > 0 ? '#5a6270' : (isActive ? '#2ec4b6' : '#ffcf48');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(cx - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = cooldown > 0 ? '#8e9aa8' : '#ffcf48';
    ctx.font = 'bold 9px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('[E]', cx, badgeY);

    // 5. Ability Name Label below
    ctx.fillStyle = isActive ? '#2ec4b6' : (cooldown > 0 ? '#7a8594' : '#c59b27');
    ctx.font = 'bold 9px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, cy + radius + 4);

    ctx.restore();
  }

  /**
   * Renders the top-left FFA / Solo Leaderboard with player kill counts.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {Object} player - Local player entity
   * @param {Object} matchContext - State snapshot
   * @returns {number} - Rendered height in pixels
   */
  renderFFALeaderboard(ctx, x, y, player = {}, matchContext = {}) {
    ctx.save();

    const targetKills = matchContext.targetKills || player.targetKills || 0;

    // 1. Gather all combatants from snapshot
    const combatantsMap = new Map();
    if (Array.isArray(matchContext.players)) {
      for (const p of matchContext.players) {
        if (!p || !p.id) continue;
        combatantsMap.set(p.id, {
          id: p.id,
          name: p.name || (p.isBot ? 'Бот-боєць' : 'Боєць'),
          kills: p.kills || 0,
          isAlive: p.isAlive !== false && (p.hp === undefined || p.hp > 0),
          emblem: p.emblem,
          isBot: Boolean(p.isBot),
          isLocal: p.id === player.id
        });
      }
    }

    // Ensure local player is accurately represented
    if (player && player.id) {
      const existing = combatantsMap.get(player.id);
      combatantsMap.set(player.id, {
        id: player.id,
        name: player.name || existing?.name || 'Ви',
        kills: player.kills !== undefined ? player.kills : (existing?.kills || 0),
        isAlive: player.isAlive !== false && (player.hp === undefined || player.hp > 0),
        emblem: player.emblem || existing?.emblem,
        isBot: false,
        isLocal: true
      });
    }

    const combatants = Array.from(combatantsMap.values());
    if (combatants.length === 0) {
      combatants.push({
        id: player.id || 'local',
        name: player.name || 'Ви',
        kills: player.kills || 0,
        isAlive: player.isAlive !== false,
        emblem: player.emblem,
        isBot: false,
        isLocal: true
      });
    }

    // Sort descending by kills
    combatants.sort((a, b) => {
      if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
      if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Select entries to show (max 5 rows)
    const maxRows = 5;
    let displayList = combatants.slice(0, maxRows);

    // If local player is ranked beyond maxRows, guarantee local player visibility as row 5
    const localIndex = combatants.findIndex(c => c.isLocal);
    if (localIndex >= maxRows) {
      displayList = [
        ...combatants.slice(0, maxRows - 1),
        { ...combatants[localIndex], customRank: localIndex + 1 }
      ];
    }

    const boardW = 205;
    const headerH = 26;
    const rowH = 20;
    const boardH = headerH + displayList.length * rowH + 6;

    // 1. Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;

    // 2. Chassis (100% Solid Opaque Steampunk Chassis)
    ctx.fillStyle = '#0a0d13';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(x, y, boardW, boardH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Header background bar
    ctx.fillStyle = '#161b24';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, boardW - 2, headerH - 1, [5, 5, 0, 0]);
    ctx.fill();

    // Rivets on header
    ctx.fillStyle = '#ffcf48';
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 1.5, 0, Math.PI * 2);
    ctx.arc(x + boardW - 7, y + 7, 1.5, 0, Math.PI * 2);
    ctx.fill();

    const sansFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    // Header title
    ctx.fillStyle = '#ffcf48';
    ctx.font = `bold 11px ${sansFont}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 ЛІДЕРИ (КІЛИ)', x + 12, y + headerH / 2);

    // Header target kills
    if (targetKills > 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold 10px ${sansFont}`;
      ctx.textAlign = 'right';
      ctx.fillText(`Ціль: ${targetKills}`, x + boardW - 10, y + headerH / 2);
    }

    // Divider line below header
    ctx.strokeStyle = 'rgba(197, 155, 39, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + headerH);
    ctx.lineTo(x + boardW - 2, y + headerH);
    ctx.stroke();

    // Rows
    let rowY = y + headerH + 3;
    displayList.forEach((c, idx) => {
      const rank = c.customRank || (idx + 1);
      const isLocal = c.isLocal;

      if (isLocal) {
        ctx.fillStyle = 'rgba(197, 155, 39, 0.18)';
        ctx.fillRect(x + 2, rowY, boardW - 4, rowH);
      }

      ctx.textBaseline = 'middle';
      const centerY = rowY + rowH / 2;

      // Rank number
      ctx.textAlign = 'left';
      ctx.font = `bold 11px ${sansFont}`;
      ctx.fillStyle = rank === 1 ? '#ffcf48' : (rank === 2 ? '#cbd5e1' : (rank === 3 ? '#cd7f32' : '#64748b'));
      ctx.fillText(`${rank}.`, x + 8, centerY);

      // Emblem or icon
      const emblemDef = getEmblemDefinition(c.emblem);
      const icon = emblemDef ? emblemDef.icon : (c.isBot ? '🤖' : '⚙️');
      ctx.font = '10px sans-serif';
      ctx.fillText(icon, x + 24, centerY);

      // Name
      ctx.font = isLocal ? `bold 11px ${sansFont}` : `11px ${sansFont}`;
      ctx.fillStyle = isLocal ? '#ffcf48' : (c.isAlive ? '#e2e8f0' : '#64748b');
      const displayName = isLocal ? `${c.name} (Ви)` : c.name;
      const maxLen = isLocal ? 13 : 12;
      const truncName = displayName.length > maxLen ? displayName.slice(0, maxLen - 1) + '…' : displayName;
      ctx.fillText(truncName, x + 40, centerY);

      // Kills badge on right
      ctx.textAlign = 'right';
      ctx.font = `bold 11px ${sansFont}`;
      ctx.fillStyle = isLocal ? '#ffe082' : '#ffffff';
      ctx.fillText(`${c.kills || 0} ⚔️`, x + boardW - 8, centerY);

      rowY += rowH;
    });

    ctx.restore();
    return boardH;
  }

  /**
   * Renders Weapon Info & Callsign Badge in top-left corner.
   */
  renderWeaponCard(ctx, x, y, player) {
    ctx.save();

    const def = WEAPON_DEFINITIONS[player.weaponId];
    const wName = player.weaponName || def?.name || 'Годинниковий револьвер';
    const callSign = player.name || 'Механік-рейнджер';
    const emblemDef = getEmblemDefinition(player.emblem);
    const emblemIcon = emblemDef ? emblemDef.icon : '⚙️';

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = '#0e1219';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, 205, 46, 5);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Call-sign with heraldic emblem
    ctx.fillStyle = '#ffcf48';
    ctx.font = 'bold 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${emblemIcon} ${callSign}`, x + 10, y + 18);

    // Weapon title
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(wName, x + 10, y + 36);

    ctx.restore();
  }

  /**
   * Renders the Spectator Mode banner when the local player is eliminated in permadeath mode.
   */
  renderSpectatorBanner(ctx, width, height) {
    ctx.save();
    const bannerW = Math.min(460, width - 30);
    const bannerH = 34;
    const bx = (width - bannerW) / 2;
    const by = 72;

    // Solid dark plaque with crimson border
    ctx.fillStyle = 'rgba(22, 12, 14, 0.95)';
    ctx.strokeStyle = '#e71d36';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bannerW, bannerH, 6);
    ctx.fill();
    ctx.stroke();

    const sansFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.font = `bold 12px ${sansFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Left accent strip
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.roundRect(bx + 2, by + 3, 4, bannerH - 6, 2);
    ctx.fill();

    ctx.fillStyle = '#ff9999';
    ctx.fillText('☠ ВИ ВИБУЛИ З БОЮ • СПОСТЕРЕЖЕННЯ (Бій триває • Вийти: [✕ Лобі])', width / 2, by + bannerH / 2);

    ctx.restore();
  }

  /**
   * Renders the top-right Kill Feed list (who eliminated whom).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  renderKillFeed(ctx, width, height) {
    if (!this.killFeed || this.killFeed.length === 0) return;

    ctx.save();
    const isTouchActive = typeof document !== 'undefined' &&
      (document.getElementById('mobileTouchControls')?.classList.contains('touch-active') ||
       (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
       (typeof window !== 'undefined' && 'ontouchstart' in window && window.innerWidth <= 1024));

    const feedW = Math.min(250, Math.round(width * 0.35));
    const feedX = width - feedW - 16;
    let currentY = isTouchActive ? 56 : 16;

    const sansFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    for (const item of this.killFeed) {
      if (item.alpha <= 0.01) continue;

      ctx.save();
      ctx.globalAlpha = Math.min(1.0, item.alpha);

      const cardH = 26;

      // 1. Drop shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.90)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      // 2. Chassis (100% Solid Opaque Steampunk Chassis)
      const isDeath = item.isVictimLocal || item.type === 'death';
      const isKill = item.isKillerLocal || item.type === 'kill';

      ctx.fillStyle = isDeath ? '#1c0f12' : (isKill ? '#1f190e' : '#0e1219');
      ctx.strokeStyle = isDeath ? '#ef4444' : (isKill ? '#ffcf48' : '#475569');
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(feedX, currentY, feedW, cardH, 5);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 3. Colored accent strip on left
      const accent = isDeath ? '#ef4444' : (isKill ? '#ffcf48' : '#3b82f6');
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(feedX + 2, currentY + 3, 4, cardH - 6, 2);
      ctx.fill();

      // 4. Rivets on right
      ctx.fillStyle = isKill ? '#ffcf48' : '#94a3b8';
      ctx.beginPath();
      ctx.arc(feedX + feedW - 6, currentY + 6, 1.2, 0, Math.PI * 2);
      ctx.arc(feedX + feedW - 6, currentY + cardH - 6, 1.2, 0, Math.PI * 2);
      ctx.fill();

      // 5. Content text: Killer ⚔️ Victim
      ctx.textBaseline = 'middle';
      const textY = currentY + cardH / 2;

      const killer = item.killerName || 'Супротивник';
      const victim = item.victimName || 'Боєць';
      const icon = isDeath ? '☠️' : (isKill ? '⚡' : '⚔️');

      // Killer on the left
      ctx.textAlign = 'left';
      ctx.font = `bold 11px ${sansFont}`;
      ctx.fillStyle = item.isKillerLocal ? '#ffcf48' : '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.2;
      const baseKiller = killer;
      const kTrunc = item.isKillerLocal
        ? (baseKiller.length > 11 ? baseKiller.slice(0, 10) + '… (Ви)' : `${baseKiller} (Ви)`)
        : (baseKiller.length > 15 ? baseKiller.slice(0, 14) + '…' : baseKiller);
      ctx.strokeText(kTrunc, feedX + 11, textY);
      ctx.fillText(kTrunc, feedX + 11, textY);

      // Icon in the center
      ctx.textAlign = 'center';
      ctx.font = '10px sans-serif';
      ctx.fillText(icon, feedX + feedW / 2 + 10, textY);

      // Victim on the right
      ctx.textAlign = 'right';
      ctx.font = `bold 11px ${sansFont}`;
      ctx.fillStyle = item.isVictimLocal ? '#ef4444' : '#cbd5e1';
      const baseVictim = victim;
      const vTrunc = item.isVictimLocal
        ? (baseVictim.length > 11 ? baseVictim.slice(0, 10) + '… (Ви)' : `${baseVictim} (Ви)`)
        : (baseVictim.length > 15 ? baseVictim.slice(0, 14) + '…' : baseVictim);
      ctx.strokeText(vTrunc, feedX + feedW - 12, textY);
      ctx.fillText(vTrunc, feedX + feedW - 12, textY);

      ctx.restore();
      currentY += cardH + 5;
    }

    ctx.restore();
  }

  /**
   * Renders active in-canvas system notifications at top-center (warnings, pickups, announcements).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {Object} [player={}]
   */
  renderNotifications(ctx, width, height, player = {}) {
    if (!this.notifications || this.notifications.length === 0) return;

    ctx.save();
    const isSpectating = player && !player.isAlive && (!player.respawnTimer || player.respawnTimer <= 0) && !this.matchOutcome;
    let currentY = isSpectating ? 114 : 76;

    for (const notif of this.notifications) {
      if (notif.alpha <= 0.01) continue;

      ctx.save();
      ctx.globalAlpha = Math.min(1.0, notif.alpha);

      // Clean typography: Modern readable font without fuzzy shadow blur
      const font = 'bold 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.font = font;
      const textMetrics = ctx.measureText(notif.text);
      const toastHeight = 38;
      const toastWidth = Math.max(290, Math.min(width - 40, textMetrics.width + 56));
      const toastX = (width - toastWidth) / 2;

      // 1. Heavy drop shadow so it detaches cleanly from background/lights
      ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;

      // 2. 100% Solid Opaque Steampunk Backing Plate (NO light bleed-through!)
      const isDeath = notif.type === 'death';
      const isKill = notif.type === 'kill';
      ctx.fillStyle = isDeath ? '#1c0f12' : (isKill ? '#1f190e' : '#0f131a');
      ctx.strokeStyle = notif.color || (isDeath ? '#ff4d4d' : (isKill ? '#ffcf48' : '#c59b27'));
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(toastX, currentY, toastWidth, toastHeight, 6);
      ctx.fill();
      ctx.stroke();

      // Reset shadow for inner elements
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 3. Colored status accent strip on the left
      const accentColor = notif.color || (isDeath ? '#ff4d4d' : (isKill ? '#ffcf48' : '#2ec4b6'));
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.roundRect(toastX + 2, currentY + 3, 5, toastHeight - 6, 2);
      ctx.fill();

      // 4. Corner rivets in brass
      ctx.fillStyle = '#ffcf48';
      ctx.beginPath();
      ctx.arc(toastX + 11, currentY + 7, 1.5, 0, Math.PI * 2);
      ctx.arc(toastX + toastWidth - 7, currentY + 7, 1.5, 0, Math.PI * 2);
      ctx.arc(toastX + 11, currentY + toastHeight - 7, 1.5, 0, Math.PI * 2);
      ctx.arc(toastX + toastWidth - 7, currentY + toastHeight - 7, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // 5. Crisp, high-contrast text with dark stroke for maximum legibility
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Subtle crisp dark stroke outline
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5;
      ctx.strokeText(notif.text, width / 2, currentY + toastHeight / 2);

      // Bright white crisp text fill
      ctx.fillStyle = isDeath ? '#fff0f0' : (isKill ? '#fffbe8' : '#ffffff');
      ctx.fillText(notif.text, width / 2, currentY + toastHeight / 2);

      ctx.restore();
      currentY += toastHeight + 6;
    }

    ctx.restore();
  }

  /**
   * Renders the authoritative canvas Match Over modal with victory/defeat banners, stats, and buttons.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {Object} player
   */
  renderMatchOver(ctx, width, height, player) {
    const outcome = this.matchOutcome;
    if (!outcome) return;

    ctx.save();

    // 1. Darkened atmospheric vignette backdrop
    ctx.fillStyle = 'rgba(6, 8, 14, 0.82)';
    ctx.fillRect(0, 0, width, height);

    // 2. Central Steampunk Plaque Bounds
    const boxW = Math.min(540, Math.max(340, width - 40));
    const boxH = Math.min(440, Math.max(360, height - 40));
    const bx = (width - boxW) / 2;
    const by = (height - boxH) / 2;

    const isWinner = outcome.winnerId && outcome.winnerId === player?.id;
    const isDraw = Boolean(outcome.draw);

    // 3. Plaque Background & Ornate Steampunk Brass Borders
    ctx.fillStyle = '#12151c';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 8);
    ctx.fill();

    // Brass outer frame
    ctx.strokeStyle = isWinner ? '#ffcf48' : isDraw ? '#ff9f1c' : '#c59b27';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inset border
    ctx.strokeStyle = 'rgba(255, 207, 72, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 5, by + 5, boxW - 10, boxH - 10, 5);
    ctx.stroke();

    // Corner decorative rivets
    ctx.fillStyle = '#ffcf48';
    const rivetOffsets = [
      [bx + 12, by + 12],
      [bx + boxW - 12, by + 12],
      [bx + 12, by + boxH - 12],
      [bx + boxW - 12, by + boxH - 12]
    ];
    for (const [rx, ry] of rivetOffsets) {
      ctx.beginPath();
      ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#703816';
      ctx.beginPath();
      ctx.arc(rx, ry, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffcf48';
    }

    // 4. Header Banner Plate
    const headerH = 64;
    const headerGrad = ctx.createLinearGradient(bx, by, bx, by + headerH);
    if (isWinner) {
      headerGrad.addColorStop(0, '#36290f');
      headerGrad.addColorStop(1, '#1b1407');
    } else if (isDraw) {
      headerGrad.addColorStop(0, '#38250f');
      headerGrad.addColorStop(1, '#1c1308');
    } else {
      headerGrad.addColorStop(0, '#381216');
      headerGrad.addColorStop(1, '#1a090b');
    }

    ctx.fillStyle = headerGrad;
    ctx.beginPath();
    ctx.roundRect(bx + 8, by + 8, boxW - 16, headerH, 6);
    ctx.fill();
    ctx.strokeStyle = isWinner ? '#ffcf48' : isDraw ? '#ff9f1c' : '#e71d36';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Header Title
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isWinner) {
      ctx.shadowColor = '#ffcf48';
      ctx.fillStyle = '#ffcf48';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.fillText('★ ПЕРЕМОГА: ВИ ВИЖИЛИ! ★', width / 2, by + 32);

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ded7c4';
      ctx.font = '12px Georgia, serif';
      ctx.fillText('Арену зачищено • Ви єдиний вцілілий механік', width / 2, by + 54);
    } else if (isDraw) {
      ctx.shadowColor = '#ff9f1c';
      ctx.fillStyle = '#ff9f1c';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.fillText('⚔ НІЧИЯ: ВЗАЄМНЕ ЗНИЩЕННЯ ⚔', width / 2, by + 32);

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ded7c4';
      ctx.font = '12px Georgia, serif';
      ctx.fillText('Обидва супротивники полягли в бою', width / 2, by + 54);
    } else {
      ctx.shadowColor = '#e71d36';
      ctx.fillStyle = '#ff5a5f';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.fillText('☠ ПОРАЗКА: ВАС ЛІКВІДОВАНО ☠', width / 2, by + 32);

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f5c6cb';
      ctx.font = '12px Georgia, serif';
      ctx.fillText('Корпус автоматона розбито • Модернізуйте спорядження', width / 2, by + 54);
    }
    ctx.shadowBlur = 0;

    // 5. Combat Statistics Row
    let myResult = null;
    if (outcome.results && Array.isArray(outcome.results)) {
      myResult = outcome.results.find(r => r.playerId === player?.id);
    }
    const kills = myResult?.kills ?? (isWinner ? 1 : 0);
    const damage = myResult?.damageDealt ?? (isWinner ? 100 : 35);
    const survival = myResult?.survivalSeconds ?? 15;
    const xp = myResult?.xpEarned ?? (isWinner ? 200 : 80);
    const scrap = myResult?.scrapEarned ?? (isWinner ? 100 : 35);
    const cores = myResult?.coresEarned ?? (isWinner ? 1 : 0);

    const statsY = by + 90;
    const statBoxW = (boxW - 48) / 3;
    const statBoxH = 60;

    const statsData = [
      { label: '⚔ ЛІКВІДАЦІЇ', val: `${kills}`, col: '#ffcf48' },
      { label: '💥 ШКОДА', val: `${damage}`, col: '#ff9f1c' },
      { label: '⏱ ЧАС У БОЮ', val: `${survival} с`, col: '#2ec4b6' }
    ];

    statsData.forEach((st, idx) => {
      const sx = bx + 16 + idx * (statBoxW + 8);
      ctx.fillStyle = '#171b24';
      ctx.strokeStyle = '#2d3340';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(sx, statsY, statBoxW, statBoxH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#9d9685';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(st.label, sx + statBoxW / 2, statsY + 18);

      ctx.fillStyle = st.col;
      ctx.font = 'bold 20px monospace';
      ctx.fillText(st.val, sx + statBoxW / 2, statsY + 44);
    });

    // 6. Rewards Plate
    const rewY = statsY + statBoxH + 16;
    const rewW = boxW - 32;
    const rewH = 74;
    ctx.fillStyle = '#191d26';
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx + 16, rewY, rewW, rewH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#c59b27';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('★ НАГОРОДИ ЗА МАТЧ ★', width / 2, rewY + 20);

    // Currency Badges
    const badgeY = rewY + 45;
    const rewBadges = [
      { text: `⚡ +${xp} XP`, col: '#ffcf48', bg: '#2b230f' },
      { text: `⚙ +${scrap} Scrap`, col: '#e28743', bg: '#291b10' }
    ];
    if (cores > 0) {
      rewBadges.push({ text: `🔮 +${cores} Core`, col: '#2ec4b6', bg: '#0d2524' });
    }

    const totalBadgesWidth = rewBadges.length * 115;
    let badgeStartX = width / 2 - totalBadgesWidth / 2;

    rewBadges.forEach(b => {
      ctx.fillStyle = b.bg;
      ctx.strokeStyle = b.col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(badgeStartX, badgeY - 14, 105, 26, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = b.col;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, badgeStartX + 52, badgeY + 3);

      badgeStartX += 115;
    });

    // 7. Interactive Canvas Action Buttons
    const btnY = by + boxH - 72;
    const btnW = Math.min(210, (boxW - 48) / 2);
    const btnH = 40;

    const btnRestartX = width / 2 - btnW - 8;
    const btnLobbyX = width / 2 + 8;

    this.buttonBounds = {
      restart: { x: btnRestartX, y: btnY, w: btnW, h: btnH },
      lobby: { x: btnLobbyX, y: btnY, w: btnW, h: btnH }
    };

    // Button 1: Restart Match
    const isRestartHovered = this.hoveredButton === 'restart';
    ctx.fillStyle = isRestartHovered ? '#3b2f12' : '#261e0b';
    ctx.strokeStyle = isRestartHovered ? '#ffe082' : '#ffcf48';
    ctx.lineWidth = isRestartHovered ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.roundRect(btnRestartX, btnY, btnW, btnH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isRestartHovered ? '#fff' : '#ffcf48';
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔄 Грати знову (Space)', btnRestartX + btnW / 2, btnY + btnH / 2 + 1);

    // Button 2: Return to Lobby
    const isLobbyHovered = this.hoveredButton === 'lobby';
    ctx.fillStyle = isLobbyHovered ? '#2d3340' : '#1c202a';
    ctx.strokeStyle = isLobbyHovered ? '#c59b27' : '#5a6275';
    ctx.lineWidth = isLobbyHovered ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.roundRect(btnLobbyX, btnY, btnW, btnH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLobbyHovered ? '#fff' : '#ded7c4';
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏠 В лобі / Меню (Esc)', btnLobbyX + btnW / 2, btnY + btnH / 2 + 1);

    // Subtle hint below buttons
    ctx.fillStyle = '#7a828e';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Натисніть кнопку або клавішу для продовження', width / 2, by + boxH - 14);

    ctx.restore();
  }

  /**
   * Renders the top-center competitive game mode scoreboard.
   * Engineered with 100% solid opaque backing and high-contrast typography
   * to eliminate transparency artifacts and guarantee pristine legibility.
   */
  renderGameModeScoreboard(ctx, width, height, player, matchContext = {}) {
    ctx.save();

    const mode = matchContext.gameMode || player.gameMode || 'solo_elim';
    const targetKills = matchContext.targetKills || player.targetKills || (mode === 'team_dm' ? 15 : (mode === 'ffa_dm' ? 10 : 0));
    const teamScores = matchContext.teamScores || { team1: 0, team2: 0 };
    const players = matchContext.players || [];

    const sansFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    if (mode === 'team_dm') {
      // TEAM DEATHMATCH: Prominent Global Scoreboard at Top-Center
      const boardW = Math.min(380, width - 32);
      const boardH = 54;
      const bx = Math.round((width - boardW) / 2);
      const by = 12;

      // 1. Drop shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.90)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;

      // 2. Chassis (100% Solid Opaque Steampunk Chassis)
      ctx.fillStyle = '#0b0e14';
      ctx.strokeStyle = '#c59b27';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.roundRect(bx, by, boardW, boardH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Subtle inner golden bevel border
      ctx.strokeStyle = 'rgba(255, 207, 72, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx + 2, by + 2, boardW - 4, boardH - 4, 6);
      ctx.stroke();

      // Corner rivets
      ctx.fillStyle = '#ffcf48';
      ctx.beginPath();
      ctx.arc(bx + 7, by + 7, 2, 0, Math.PI * 2);
      ctx.arc(bx + boardW - 7, by + 7, 2, 0, Math.PI * 2);
      ctx.arc(bx + 7, by + boardH - 7, 2, 0, Math.PI * 2);
      ctx.arc(bx + boardW - 7, by + boardH - 7, 2, 0, Math.PI * 2);
      ctx.fill();

      const t1 = teamScores.team1 || 0;
      const t2 = teamScores.team2 || 0;

      // Team 1: Blue Team (Парові Вовки)
      ctx.fillStyle = '#3b82f6';
      ctx.font = `bold 20px ${sansFont}`;
      ctx.textAlign = 'left';
      ctx.fillText(`🐺 ${t1}`, bx + 16, by + 26);

      ctx.font = `bold 10px ${sansFont}`;
      ctx.fillStyle = '#93c5fd';
      ctx.fillText('Парові Вовки', bx + 16, by + 40);

      // Center: Global Target & Match Label
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 13px ${sansFont}`;
      ctx.textAlign = 'center';
      ctx.fillText(`ЦІЛЬ: ${targetKills}`, width / 2, by + 21);

      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold 10px ${sansFont}`;
      ctx.fillText('КОМАНДНИЙ РАХУНОК', width / 2, by + 37);

      // Team 2: Red Team (Мідні Лиси)
      ctx.fillStyle = '#ef4444';
      ctx.font = `bold 20px ${sansFont}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${t2} 🦊`, bx + boardW - 16, by + 26);

      ctx.font = `bold 10px ${sansFont}`;
      ctx.fillStyle = '#fca5a5';
      ctx.fillText('Мідні Лиси', bx + boardW - 16, by + 40);

      // Progress bars at bottom of board
      const barW = Math.min(105, (boardW - 160) / 2);
      const barH = 3;
      const ratio1 = Math.min(1.0, t1 / Math.max(1, targetKills));
      const ratio2 = Math.min(1.0, t2 / Math.max(1, targetKills));

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(bx + 16, by + boardH - 6, barW, barH);
      ctx.fillRect(bx + boardW - 16 - barW, by + boardH - 6, barW, barH);

      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(bx + 16, by + boardH - 6, barW * ratio1, barH);

      ctx.fillStyle = '#ef4444';
      ctx.fillRect(bx + boardW - 16 - barW * ratio2, by + boardH - 6, barW * ratio2, barH);

    } else if (mode === 'team_elim') {
      // TEAM ELIMINATION: Team 1 living vs Team 2 living
      const boardW = Math.min(380, width - 32);
      const boardH = 50;
      const bx = Math.round((width - boardW) / 2);
      const by = 14;

      ctx.fillStyle = '#0b0e14';
      ctx.strokeStyle = '#c59b27';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(bx, by, boardW, boardH, 7);
      ctx.fill();
      ctx.stroke();

      let t1Alive = 0;
      let t2Alive = 0;
      for (const p of players) {
        if (p.isAlive && (p.hp === undefined || p.hp > 0)) {
          if (p.team === 'team1') t1Alive++;
          else if (p.team === 'team2') t2Alive++;
        }
      }

      ctx.fillStyle = '#3b82f6';
      ctx.font = `bold 14px ${sansFont}`;
      ctx.textAlign = 'left';
      ctx.fillText(`🐺 Живих: ${t1Alive}`, bx + 16, by + 26);

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 13px ${sansFont}`;
      ctx.textAlign = 'center';
      ctx.fillText('КОМАНДНИЙ БІЙ', width / 2, by + 20);

      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold 10px ${sansFont}`;
      ctx.fillText('ОСТАННЯ КОМАНДА', width / 2, by + 35);

      ctx.fillStyle = '#ef4444';
      ctx.font = `bold 14px ${sansFont}`;
      ctx.textAlign = 'right';
      ctx.fillText(`Живих: ${t2Alive} 🦊`, bx + boardW - 16, by + 26);

    } else if (mode === 'ffa_dm') {
      // FFA DEATHMATCH: Sleek compact top banner (leaderboard is in top-left!)
      if (width >= 768) {
        const boardW = 230;
        const boardH = 32;
        const bx = Math.round((width - boardW) / 2);
        const by = 14;

        ctx.fillStyle = '#0b0e14';
        ctx.strokeStyle = '#c59b27';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(bx, by, boardW, boardH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 12px ${sansFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`⚔️ ВІЛЬНА БИТВА • ЦІЛЬ: ${targetKills}`, width / 2, by + boardH / 2);
      }
    } else {
      // SOLO ELIMINATION: Last Man Standing
      if (width >= 768) {
        const boardW = 210;
        const boardH = 32;
        const bx = Math.round((width - boardW) / 2);
        const by = 14;

        ctx.fillStyle = '#0b0e14';
        ctx.strokeStyle = '#c59b27';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(bx, by, boardW, boardH, 6);
        ctx.fill();
        ctx.stroke();

        let aliveCount = 0;
        for (const p of players) {
          if (p.isAlive && (p.hp === undefined || p.hp > 0)) aliveCount++;
        }
        if (aliveCount === 0 && matchContext.aliveCount) aliveCount = matchContext.aliveCount;
        if (aliveCount === 0) aliveCount = 1;

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 12px ${sansFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`💀 ЖИВИХ БІЙЦІВ: ${aliveCount}`, width / 2, by + boardH / 2);
      }
    }

    ctx.restore();
  }

  /**
   * Renders the Dramatic Steampunk Respawn Countdown Overlay.
   */
  renderRespawnOverlay(ctx, width, height, respawnTimer) {
    ctx.save();

    // Dark atmospheric vignette overlay
    ctx.fillStyle = 'rgba(10, 13, 18, 0.65)';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2 - 30;

    // Outer gear frame
    const gearRadius = 55;
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseTimer * 6);

    ctx.strokeStyle = `rgba(255, 207, 72, ${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, gearRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating gear teeth
    const numTeeth = 12;
    const rot = this.pulseTimer * 2;
    ctx.fillStyle = '#c59b27';
    for (let i = 0; i < numTeeth; i++) {
      const a = rot + (i / numTeeth) * Math.PI * 2;
      const tx = cx + Math.cos(a) * gearRadius;
      const ty = cy + Math.sin(a) * gearRadius;
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Countdown seconds text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${respawnTimer.toFixed(1)}с`, cx, cy);

    // Banner message
    ctx.fillStyle = '#ffcf48';
    ctx.font = 'bold 16px Georgia, serif';
    ctx.fillText('⚙ ВІДРОДЖЕННЯ АВТОМАТОНА...', cx, cy + gearRadius + 28);

    ctx.fillStyle = '#9d9685';
    ctx.font = '12px monospace';
    ctx.fillText('Підготовка парового тиску та боєзапасу', cx, cy + gearRadius + 48);

    ctx.restore();
  }

  /**
   * Renders team badge in bottom-left corner next to health vial.
   */
  renderTeamBadge(ctx, x, y, team) {
    ctx.save();
    const isTeam1 = team === 'team1';
    const text = isTeam1 ? '🐺 Парові Вовки' : '🦊 Мідні Лиси';
    const color = isTeam1 ? '#2575fc' : '#ff4757';
    const bg = isTeam1 ? 'rgba(37, 117, 252, 0.25)' : 'rgba(255, 71, 87, 0.25)';

    ctx.fillStyle = bg;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, 130, 22, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + 65, y + 15);
    ctx.restore();
  }

  /**
   * Synchronizes mobile touch action cluster UI with local player state.
   * Updates ammo count badge on reload button and ability cooldown overlay.
   * @param {Object} player
   */
  updateMobileTouchUI(player = {}) {
    if (typeof document === 'undefined') return;

    // Update Reload Button Ammo Count Badge
    const ammoEl = document.getElementById('touchReloadAmmoCount');
    if (ammoEl) {
      const ammo = player.ammo ?? 6;
      const maxAmmo = player.maxAmmo ?? 6;
      const isReloading = Boolean(player.isReloading || player.state === 'reloading');
      if (isReloading) {
        ammoEl.textContent = '...';
        ammoEl.style.color = '#ff9f1c';
      } else {
        ammoEl.textContent = `${ammo}/${maxAmmo}`;
        ammoEl.style.color = ammo === 0 ? '#e71d36' : (ammo <= 2 ? '#ff9f1c' : '#ffcf48');
      }
    }

    // Update Ability Button Cooldown Overlay
    const cdEl = document.getElementById('touchAbilityCooldownOverlay');
    if (cdEl) {
      const cd = player.abilityCooldownRemaining || 0;
      if (cd > 0) {
        cdEl.style.display = 'flex';
        cdEl.textContent = `${Math.ceil(cd)}s`;
      } else {
        cdEl.style.display = 'none';
      }
    }

    // Update Sprint Button visual toggle if active
    const sprintBtn = document.getElementById('btnTouchSprint');
    if (sprintBtn && player.isSprinting !== undefined) {
      sprintBtn.classList.toggle('active', Boolean(player.isSprinting));
    }
  }
}
