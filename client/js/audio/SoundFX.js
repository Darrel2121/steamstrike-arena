/**
 * Steampunk Tactical Audio Engine (Procedural Web Audio API)
 * Generates zero-dependency procedural steampunk sound effects:
 * - Gunfire (Revolver, Carbine, Blunderbuss, Needle Gun)
 * - Bullet ricochets (metallic ping) & impacts (wall debris vs entity armor)
 * - Mechanical reloads & footsteps
 * - Steam abilities & pressure releases
 * - Elimination brass gong, victory fanfare, and defeat chimes.
 */

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.volume = 0.6;
    this.initialized = false;
    this.listenerPos = { x: 400, y: 300 };

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
   * Initializes AudioContext upon user gesture.
   */
  init() {
    if (this.initialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.initialized = true;
    } catch (_) {}
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

    const falloff = Math.max(0.1, Math.min(1.0, 1.0 - (dist / maxDist)));
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
   * Plays a procedural noise burst (for gunfire, steam, impacts).
   */
  createNoiseBuffer(duration = 0.2) {
    if (!this.ctx) return null;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Weapon Gunshot SFX.
   */
  playGunshot(weaponId = 'revolver', worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.75);
    if (!out) return;

    if (weaponId === 'blunderbuss') {
      // Heavy deep cannon blast with wide dispersion noise
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.35);

      oscGain.gain.setValueAtTime(0.9, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(now);
      osc.stop(now + 0.36);

      const noiseBuf = this.createNoiseBuffer(0.38);
      if (noiseBuf) {
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(160, now + 0.38);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.8, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.38);

        noiseSource.connect(filter);
        filter.connect(nGain);
        nGain.connect(out);
        noiseSource.start(now);
      }
    } else if (weaponId === 'needle_gun') {
      // Supersonic sharp metallic needle crack
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.18);

      oscGain.gain.setValueAtTime(0.6, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(now);
      osc.stop(now + 0.19);
    } else if (weaponId === 'carbine') {
      // Rapid mechanical snap with steam release
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.14);

      oscGain.gain.setValueAtTime(0.5, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(now);
      osc.stop(now + 0.15);
    } else {
      // Classic Cylinder Revolver pop
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.22);

      oscGain.gain.setValueAtTime(0.8, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(now);
      osc.stop(now + 0.23);

      const noiseBuf = this.createNoiseBuffer(0.12);
      if (noiseBuf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.Q.setValueAtTime(2.0, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.6, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }
    }
  }

  /**
   * Wall Ricochet Ping SFX (High-Q resonant metallic clink).
   */
  playRicochet(worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.45);
    if (!out) return;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const baseFreq = 1800 + Math.random() * 600;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.65, now + 0.22);

    oscGain.gain.setValueAtTime(0.45, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + 0.23);
  }

  /**
   * Bullet Impact SFX (Wall concrete vs Entity metal/chassis).
   */
  playImpact(isEntity = false, worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, isEntity ? 0.65 : 0.4);
    if (!out) return;

    if (isEntity) {
      // Heavy metal chassis clank & hydraulic crunch
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.16);

      oscGain.gain.setValueAtTime(0.7, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);

      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(now);
      osc.stop(now + 0.17);
    } else {
      // Brick / masonry wall hit
      const buf = this.createNoiseBuffer(0.08);
      if (buf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = buf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(650, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.4, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }
    }
  }

  /**
   * Weapon Reload Ratchet SFX (Rapid double mechanical click).
   */
  playReload(worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.4);
    if (!out) return;

    [0, 0.09, 0.20].forEach(delay => {
      const clickTime = now + delay;
      const osc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800 + Math.random() * 300, clickTime);
      osc.frequency.exponentialRampToValueAtTime(250, clickTime + 0.035);

      clickGain.gain.setValueAtTime(0.3, clickTime);
      clickGain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.035);

      osc.connect(clickGain);
      clickGain.connect(out);
      osc.start(clickTime);
      osc.stop(clickTime + 0.04);
    });
  }

  /**
   * Footstep SFX (Soft metallic sole contact on stone).
   */
  playFootstep(worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.16);
    if (!out) return;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.07);

    oscGain.gain.setValueAtTime(0.25, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);

    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /**
   * Tactical Ability Activation SFX (High-pressure steam venting & power surge).
   */
  playAbility(classId = 'vanguard', worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.7);
    if (!out) return;

    // Sweeping bandpass steam plume hiss
    const buf = this.createNoiseBuffer(0.45);
    if (buf) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(2400, now + 0.2);
      filter.frequency.exponentialRampToValueAtTime(400, now + 0.45);
      filter.Q.setValueAtTime(3.5, now);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.7, now);
      nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(out);
      noise.start(now);
    }

    // Class specific tonal cue
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    const pitch = classId === 'sharpshooter' ? 880 : (classId === 'juggernaut' ? 220 : 550);
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, now + 0.25);

    oscGain.gain.setValueAtTime(0.4, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  /**
   * Resonant Steampunk Brass Elimination Gong.
   */
  playElimination() {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.masterGain;
    if (!out) return;

    // Harmonic bells for deep bronze gong
    const harmonics = [220, 440, 659, 880];
    harmonics.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const dur = 1.2 - idx * 0.2;
      gain.gain.setValueAtTime(0.3 / (idx + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(gain);
      gain.connect(out);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    });
  }

  /**
   * Victory Fanfare Brass Chime.
   */
  playVictory() {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.masterGain;
    if (!out) return;

    const notes = [
      { f: 261.63, t: 0.00, d: 0.16 }, // C4
      { f: 329.63, t: 0.15, d: 0.16 }, // E4
      { f: 392.00, t: 0.30, d: 0.20 }, // G4
      { f: 523.25, t: 0.48, d: 0.85 }  // C5
    ];

    notes.forEach(n => {
      const startT = now + n.t;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.f, startT);

      gain.gain.setValueAtTime(0.4, startT);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + n.d);

      osc.connect(gain);
      gain.connect(out);
      osc.start(startT);
      osc.stop(startT + n.d + 0.05);
    });
  }

  /**
   * Defeat Descending Minor Tone.
   */
  playDefeat() {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.masterGain;
    if (!out) return;

    const notes = [
      { f: 311.13, t: 0.00, d: 0.35 }, // Eb4
      { f: 293.66, t: 0.28, d: 0.35 }, // D4
      { f: 261.63, t: 0.56, d: 0.80 }  // C4
    ];

    notes.forEach(n => {
      const startT = now + n.t;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.f, startT);

      gain.gain.setValueAtTime(0.25, startT);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + n.d);

      osc.connect(gain);
      gain.connect(out);
      osc.start(startT);
      osc.stop(startT + n.d + 0.05);
    });
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
