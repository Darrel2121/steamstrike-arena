/**
 * Steampunk Tactical Audio Engine (Realistic Physical Acoustic DSP)
 * Generates zero-dependency HD physical acoustic audio buffers:
 * - Gunfire (Revolver, Carbine, Blunderbuss, Needle Gun) using multi-stage combustion modeling
 * - Bullet ricochets (metallic supersonic ping) & impacts (masonry wall vs automaton metal chassis)
 * - Mechanical cylinder reloads with tactile ratchet locks & brass casing chimes
 * - Steampunk steam abilities, footsteps, elimination bronze gong, victory fanfare, and defeat resonance.
 *
 * 100% Free of 8-bit synthesizer tones (no retro arcade oscillators).
 */

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.volume = 0.7;
    this.initialized = false;
    this.listenerPos = { x: 400, y: 300 };
    this.audioBuffers = new Map();

    try {
      if (typeof localStorage !== 'undefined') {
        const savedMute = localStorage.getItem('steamstrike_sound_muted');
        if (savedMute !== null) this.isMuted = savedMute === 'true';
        const savedVol = localStorage.getItem('steamstrike_sound_vol');
        if (savedVol !== null) this.volume = Math.max(0, Math.min(1, parseFloat(savedVol)));
      }
    } catch (_) {}
  }

  /**
   * Initializes AudioContext upon user gesture and pre-renders physical acoustic buffers.
   */
  init() {
    if (this.initialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Pre-compile physical acoustic PCM buffers
      this.compileAcousticBuffers();

      this.initialized = true;
    } catch (_) {}
  }

  /**
   * Generates a raw Float32Array into a Web Audio AudioBuffer.
   */
  createAudioBuffer(duration, generator) {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate || 44100;
    const len = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, len, sampleRate);
    const channelData = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let brown = 0;

    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;

      // Pink noise (Paul Kellet's filter approximation)
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;

      // Brownian noise (integrated acoustic displacement)
      brown = (brown + (0.03 * white)) / 1.03;

      const sample = generator(t, white, pink, brown, i, len);
      channelData[i] = Math.max(-1, Math.min(1, sample));
    }

    return buffer;
  }

  /**
   * Compiles all physical acoustic sound models into native AudioBuffers.
   */
  compileAcousticBuffers() {
    if (!this.ctx) return;

    // 1. Revolver (Годинниковий револьвер)
    this.audioBuffers.set('shot_revolver', this.createAudioBuffer(0.40, (t, w, p, br) => {
      const attack = Math.exp(-t * 120) * w * 2.4;
      const blast = Math.exp(-t * 24) * p * 2.6;
      const thud = Math.exp(-t * 15) * br * 9.5;
      const snap = (Math.abs(w) > 0.80 ? w * 1.8 : 0) * Math.exp(-t * 160);
      let s = attack + blast + thud + snap;
      s = Math.tanh(s * 1.9) * 0.95;
      return s * Math.exp(-t * 4.8);
    }));

    // 2. Carbine (Паровий автоматичний карабін)
    this.audioBuffers.set('shot_carbine', this.createAudioBuffer(0.25, (t, w, p, br) => {
      const attack = Math.exp(-t * 150) * w * 2.6;
      const piston = Math.exp(-t * 38) * p * 2.4;
      const punch = Math.exp(-t * 26) * br * 7.0;
      let s = attack + piston + punch;
      s = Math.tanh(s * 2.2) * 0.90;
      return s * Math.exp(-t * 7.0);
    }));

    // 3. Blunderbuss (Дробовик-картечниця)
    this.audioBuffers.set('shot_blunderbuss', this.createAudioBuffer(0.58, (t, w, p, br) => {
      const shockwave = Math.exp(-t * 85) * w * 3.2;
      const roar = Math.exp(-t * 15) * p * 3.4;
      const cannon = Math.exp(-t * 9.5) * br * 15.0;
      let s = shockwave + roar + cannon;
      s = Math.tanh(s * 1.6) * 1.0;
      return s * Math.exp(-t * 3.2);
    }));

    // 4. Needle Gun (Голчаста снайперська гвинтівка)
    this.audioBuffers.set('shot_needle_gun', this.createAudioBuffer(0.32, (t, w, p, br) => {
      const crack = Math.exp(-t * 320) * (Math.abs(w) > 0.38 ? w * 3.4 : 0);
      const hiss = Math.exp(-t * 30) * w * 1.9;
      const ring = Math.sin(2 * Math.PI * 1850 * t) * Math.exp(-t * 14) * 0.28;
      let s = crack + hiss + ring;
      return Math.tanh(s * 1.8) * 0.90 * Math.exp(-t * 5.5);
    }));

    // 5. Reload (3-Stage Steampunk Mechanical Ratchet Sequence)
    this.audioBuffers.set('reload', this.createAudioBuffer(0.52, (t, w, p, br) => {
      // Stage 1: Cylinder latch release (0.00 - 0.12s)
      let s1 = (t >= 0 && t < 0.12) ? Math.exp(-t * 22) * w * 1.1 : 0;
      // Stage 2: Brass shell insertion chimes (0.16s & 0.28s)
      let s2 = 0;
      if (t >= 0.16 && t < 0.24) {
        const dt1 = t - 0.16;
        s2 += Math.sin(2 * Math.PI * 1380 * dt1) * Math.exp(-dt1 * 48) * 0.50;
      }
      if (t >= 0.28 && t < 0.36) {
        const dt2 = t - 0.28;
        s2 += Math.sin(2 * Math.PI * 1640 * dt2) * Math.exp(-dt2 * 48) * 0.50;
      }
      // Stage 3: Heavy cylinder lock snap (0.38 - 0.52s)
      let s3 = 0;
      if (t >= 0.38) {
        const dt3 = t - 0.38;
        s3 = Math.exp(-dt3 * 95) * w * 2.0 + Math.exp(-dt3 * 38) * br * 4.0;
      }
      return Math.tanh((s1 + s2 + s3) * 1.6) * 0.88;
    }));

    // 6. Wall Impact (Masonry dust & stone fracturing thud)
    this.audioBuffers.set('impact_wall', this.createAudioBuffer(0.20, (t, w, p, br) => {
      const thud = Math.exp(-t * 70) * br * 8.0;
      const crunch = Math.exp(-t * 48) * p * 1.6;
      return Math.tanh((thud + crunch) * 1.6) * 0.80 * Math.exp(-t * 11);
    }));

    // 7. Entity Impact (Automaton copper armor plate crunch)
    this.audioBuffers.set('impact_entity', this.createAudioBuffer(0.24, (t, w, p, br) => {
      const armorClang = Math.sin(2 * Math.PI * 480 * t) * Math.exp(-t * 30) * 0.60
        + Math.sin(2 * Math.PI * 1120 * t) * Math.exp(-t * 38) * 0.40;
      const kineticPunch = Math.exp(-t * 55) * br * 8.5 + Math.exp(-t * 42) * w * 1.6;
      return Math.tanh((armorClang + kineticPunch) * 1.6) * 0.90 * Math.exp(-t * 7.5);
    }));

    // 8. Ricochet (Supersonic whistling wire ping)
    this.audioBuffers.set('ricochet', this.createAudioBuffer(0.28, (t, w, p, br) => {
      const freq = 3600 * Math.exp(-t * 7.5);
      const ping = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 16) * 0.70;
      const crack = Math.exp(-t * 240) * w * 1.3;
      return Math.tanh((ping + crack) * 1.4) * 0.75 * Math.exp(-t * 4.5);
    }));

    // 9. Footstep (Leather & iron boot sole on stone)
    this.audioBuffers.set('footstep', this.createAudioBuffer(0.12, (t, w, p, br) => {
      const thud = Math.exp(-t * 75) * br * 3.5;
      const scuff = Math.exp(-t * 60) * p * 0.7;
      return Math.tanh((thud + scuff) * 1.2) * 0.45 * Math.exp(-t * 14);
    }));

    // 10. Steam Ability Surge
    this.audioBuffers.set('ability', this.createAudioBuffer(0.48, (t, w, p, br) => {
      const steamWhoosh = Math.exp(-t * 6.5) * w * 1.6 * (1 - Math.exp(-t * 50));
      const pressurePuff = Math.exp(-t * 12) * p * 1.8;
      const deepRumble = Math.exp(-t * 8) * br * 4.0;
      return Math.tanh((steamWhoosh + pressurePuff + deepRumble) * 1.4) * 0.85;
    }));

    // 11. Elimination Bronze Gong
    this.audioBuffers.set('elimination', this.createAudioBuffer(1.40, (t, w, p, br) => {
      const gong1 = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 2.8) * 0.55;
      const gong2 = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 3.8) * 0.35;
      const gong3 = Math.sin(2 * Math.PI * 659 * t) * Math.exp(-t * 4.8) * 0.25;
      const gong4 = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 5.8) * 0.15;
      const initialStrike = Math.exp(-t * 120) * w * 1.2;
      return Math.tanh((gong1 + gong2 + gong3 + gong4 + initialStrike) * 1.5) * 0.90;
    }));

    // 12. Victory Fanfare
    this.audioBuffers.set('victory', this.createAudioBuffer(1.20, (t, w, p, br) => {
      let s = 0;
      const notes = [
        { f: 261.63, t0: 0.00, t1: 0.18 },
        { f: 329.63, t0: 0.16, t1: 0.34 },
        { f: 392.00, t0: 0.32, t1: 0.52 },
        { f: 523.25, t0: 0.50, t1: 1.15 }
      ];
      for (const n of notes) {
        if (t >= n.t0 && t <= n.t1) {
          const dt = t - n.t0;
          const env = Math.exp(-dt * 3.5);
          s += (Math.sin(2 * Math.PI * n.f * dt) * 0.6 + Math.sin(2 * Math.PI * (n.f * 2) * dt) * 0.3) * env;
        }
      }
      return Math.tanh(s * 1.5) * 0.85;
    }));

    // 13. Defeat Resonance
    this.audioBuffers.set('defeat', this.createAudioBuffer(1.20, (t, w, p, br) => {
      let s = 0;
      const notes = [
        { f: 311.13, t0: 0.00, t1: 0.35 },
        { f: 293.66, t0: 0.30, t1: 0.65 },
        { f: 261.63, t0: 0.60, t1: 1.15 }
      ];
      for (const n of notes) {
        if (t >= n.t0 && t <= n.t1) {
          const dt = t - n.t0;
          const env = Math.exp(-dt * 3.0);
          s += (Math.sin(2 * Math.PI * n.f * dt) * 0.5 + Math.sin(2 * Math.PI * (n.f * 1.5) * dt) * 0.25) * env;
        }
      }
      return Math.tanh(s * 1.4) * 0.75;
    }));

    // 14. Lantern Extinguish (Damper Snap & Steam Cutoff Hiss)
    this.audioBuffers.set('lantern_extinguish', this.createAudioBuffer(0.35, (t, w, p, br) => {
      const snap = Math.exp(-t * 90) * w * 0.75;
      const metalClick = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 60) * 0.35;
      const hiss = Math.exp(-t * 14) * p * 0.6;
      return Math.tanh((snap + metalClick + hiss) * 1.5) * 0.80;
    }));

    // 15. Lantern Ignite (Flint Strike & Gas Flare Whoosh)
    this.audioBuffers.set('lantern_ignite', this.createAudioBuffer(0.48, (t, w, p, br) => {
      const flintSpark = Math.exp(-t * 120) * w * 0.85;
      const flintPing = Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 80) * 0.40;
      const flareWhoosh = t > 0.04 ? Math.exp(-(t - 0.04) * 10) * p * 0.75 : 0;
      const warmHum = t > 0.04 ? Math.sin(2 * Math.PI * 180 * (t - 0.04)) * Math.exp(-(t - 0.04) * 6) * 0.3 : 0;
      return Math.tanh((flintSpark + flintPing + flareWhoosh + warmHum) * 1.5) * 0.85;
    }));
  }

  /**
   * Updates listener position for spatial attenuation.
   */
  setListenerPosition(x, y) {
    if (typeof x === 'number' && typeof y === 'number') {
      this.listenerPos.x = x;
      this.listenerPos.y = y;
    }
  }

  /**
   * Calculates volume attenuation and stereo panning based on world coordinate distance.
   */
  getSpatialGainAndPan(worldX, worldY, maxDist = 700) {
    if (typeof worldX !== 'number' || typeof worldY !== 'number') {
      return { gain: 1.0, pan: 0 };
    }
    const dx = worldX - this.listenerPos.x;
    const dy = worldY - this.listenerPos.y;
    const dist = Math.hypot(dx, dy);

    const falloff = Math.max(0.08, Math.min(1.0, 1.0 - (dist / maxDist)));
    const pan = Math.max(-0.85, Math.min(0.85, dx / (maxDist * 0.75)));
    return { gain: falloff * falloff, pan };
  }

  /**
   * Sets up a node routed through spatial panning and master gain.
   */
  createSpatialChain(worldX, worldY, baseGain = 1.0) {
    if (!this.ctx || this.isMuted) return null;
    const now = this.ctx.currentTime;
    const { gain: spatialGain, pan } = this.getSpatialGainAndPan(worldX, worldY);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(baseGain * spatialGain, now);

    if (this.ctx.createStereoPanner) {
      try {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, now);
        gainNode.connect(panner);
        panner.connect(this.masterGain);
        return gainNode;
      } catch (_) {}
    }

    gainNode.connect(this.masterGain);
    return gainNode;
  }

  /**
   * Plays a pre-rendered AudioBuffer with optional pitch variation and spatial panning.
   */
  playBuffer(bufferKey, worldX = null, worldY = null, baseVolume = 1.0, pitchVariation = 0.04) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const buf = this.audioBuffers.get(bufferKey);
    if (!buf) return;

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      if (pitchVariation > 0) {
        source.playbackRate.setValueAtTime(1.0 + (Math.random() - 0.5) * pitchVariation * 2, this.ctx.currentTime);
      }
      const out = this.createSpatialChain(worldX, worldY, baseVolume);
      if (!out) return;
      source.connect(out);
      source.start(this.ctx.currentTime);
    } catch (_) {}
  }

  /**
   * Weapon Gunshot SFX.
   */
  playGunshot(weaponId = 'revolver', worldX = null, worldY = null) {
    let key = 'shot_revolver';
    let baseVol = 0.95;

    if (weaponId === 'blunderbuss') {
      key = 'shot_blunderbuss';
      baseVol = 1.0;
    } else if (weaponId === 'needle_gun') {
      key = 'shot_needle_gun';
      baseVol = 0.90;
    } else if (weaponId === 'carbine') {
      key = 'shot_carbine';
      baseVol = 0.88;
    }

    this.playBuffer(key, worldX, worldY, baseVol, 0.05);
  }

  /**
   * Wall Ricochet Ping SFX.
   */
  playRicochet(worldX = null, worldY = null) {
    this.playBuffer('ricochet', worldX, worldY, 0.70, 0.08);
  }

  /**
   * Bullet Impact SFX.
   */
  playImpact(isEntity = false, worldX = null, worldY = null) {
    const key = isEntity ? 'impact_entity' : 'impact_wall';
    this.playBuffer(key, worldX, worldY, isEntity ? 0.90 : 0.75, 0.06);
  }

  /**
   * Weapon Reload Ratchet SFX.
   */
  playReload(worldX = null, worldY = null) {
    this.playBuffer('reload', worldX, worldY, 0.85, 0.02);
  }

  /**
   * Footstep SFX.
   */
  playFootstep(worldX = null, worldY = null) {
    this.playBuffer('footstep', worldX, worldY, 0.40, 0.08);
  }

  /**
   * Tactical Ability Activation SFX.
   */
  playAbility(classId = 'vanguard', worldX = null, worldY = null) {
    this.playBuffer('ability', worldX, worldY, 0.85, 0.03);
  }

  /**
   * Tactical Steampunk Lantern Damper Extinguish Hiss.
   */
  playLanternExtinguish(worldX = null, worldY = null) {
    this.playBuffer('lantern_extinguish', worldX, worldY, 0.85, 0.04);
  }

  /**
   * Tactical Steampunk Lantern Flint Ignite Flare Whoosh.
   */
  playLanternIgnite(worldX = null, worldY = null) {
    this.playBuffer('lantern_ignite', worldX, worldY, 0.90, 0.03);
  }

  /**
   * Resonant Steampunk Brass Elimination Gong.
   */
  playElimination() {
    this.playBuffer('elimination', null, null, 0.90, 0.0);
  }

  /**
   * Victory Fanfare Brass Chime.
   */
  playVictory() {
    this.playBuffer('victory', null, null, 0.85, 0.0);
  }

  /**
   * Defeat Descending Minor Tone.
   */
  playDefeat() {
    this.playBuffer('defeat', null, null, 0.80, 0.0);
  }

  /**
   * Toggles mute state.
   * @returns {boolean} New mute state
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('steamstrike_sound_muted', String(this.isMuted));
      }
    } catch (_) {}
    return this.isMuted;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('steamstrike_sound_vol', String(this.volume));
      }
    } catch (_) {}
  }
}

export const soundFX = new SoundFX();
export default soundFX;
