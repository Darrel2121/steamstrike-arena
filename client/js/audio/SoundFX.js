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
   * Weapon Gunshot SFX - Visceral, punchy multi-layer acoustic synthesis.
   * Layer 1: Sub-bass concussive kick (sine pitch envelope)
   * Layer 2: Explosive gunpowder/steam blast (shaped noise burst with bandpass & sweep)
   * Layer 3: Mechanical chamber crack & hammer snap (high-frequency transient)
   * Layer 4: Arena reverberation tail (decaying diffuse room envelope)
   */
  playGunshot(weaponId = 'revolver', worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.85);
    if (!out) return;

    if (weaponId === 'blunderbuss') {
      // Massive concussive cannon blast + wide shrapnel roar
      // 1. Sub-bass shockwave
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(190, now);
      subOsc.frequency.exponentialRampToValueAtTime(26, now + 0.35);

      subGain.gain.setValueAtTime(1.0, now);
      subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      subOsc.connect(subGain);
      subGain.connect(out);
      subOsc.start(now);
      subOsc.stop(now + 0.36);

      // 2. Heavy explosive noise blast
      const noiseBuf = this.createNoiseBuffer(0.42);
      if (noiseBuf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuf;

        const lpFilter = this.ctx.createBiquadFilter();
        lpFilter.type = 'lowpass';
        lpFilter.frequency.setValueAtTime(1600, now);
        lpFilter.frequency.exponentialRampToValueAtTime(180, now + 0.42);

        const bpFilter = this.ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.frequency.setValueAtTime(800, now);
        bpFilter.Q.setValueAtTime(1.4, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(1.1, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.42);

        noise.connect(lpFilter);
        lpFilter.connect(bpFilter);
        bpFilter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }

      // 3. Resonant brass barrel ring
      const ringOsc = this.ctx.createOscillator();
      const ringGain = this.ctx.createGain();
      ringOsc.type = 'sine';
      ringOsc.frequency.setValueAtTime(460, now);
      ringOsc.frequency.exponentialRampToValueAtTime(120, now + 0.38);

      ringGain.gain.setValueAtTime(0.35, now);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      ringOsc.connect(ringGain);
      ringGain.connect(out);
      ringOsc.start(now);
      ringOsc.stop(now + 0.39);
    } else if (weaponId === 'needle_gun') {
      // Supersonic sniper whip crack + resonant whistle
      // 1. Ultra-sharp attack impulse
      const crackOsc = this.ctx.createOscillator();
      const crackGain = this.ctx.createGain();
      crackOsc.type = 'sawtooth';
      crackOsc.frequency.setValueAtTime(3200, now);
      crackOsc.frequency.exponentialRampToValueAtTime(220, now + 0.04);

      crackGain.gain.setValueAtTime(0.9, now);
      crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

      crackOsc.connect(crackGain);
      crackGain.connect(out);
      crackOsc.start(now);
      crackOsc.stop(now + 0.045);

      // 2. High-velocity pneumatic hiss & echo
      const noiseBuf = this.createNoiseBuffer(0.28);
      if (noiseBuf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuf;

        const bpFilter = this.ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.frequency.setValueAtTime(2600, now);
        bpFilter.Q.setValueAtTime(3.2, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.7, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

        noise.connect(bpFilter);
        bpFilter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }

      // 3. Crystalline harmonic ring
      const chimeOsc = this.ctx.createOscillator();
      const chimeGain = this.ctx.createGain();
      chimeOsc.type = 'sine';
      chimeOsc.frequency.setValueAtTime(1680, now);
      chimeOsc.frequency.exponentialRampToValueAtTime(840, now + 0.40);

      chimeGain.gain.setValueAtTime(0.3, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.40);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(out);
      chimeOsc.start(now);
      chimeOsc.stop(now + 0.41);
    } else if (weaponId === 'carbine') {
      // Rapid automatic steam carbine: punchy piston snap + metallic chamber slap
      // 1. Piston thump
      const punchOsc = this.ctx.createOscillator();
      const punchGain = this.ctx.createGain();
      punchOsc.type = 'triangle';
      punchOsc.frequency.setValueAtTime(320, now);
      punchOsc.frequency.exponentialRampToValueAtTime(45, now + 0.07);

      punchGain.gain.setValueAtTime(0.8, now);
      punchGain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);

      punchOsc.connect(punchGain);
      punchGain.connect(out);
      punchOsc.start(now);
      punchOsc.stop(now + 0.075);

      // 2. Sharp combustion crack
      const noiseBuf = this.createNoiseBuffer(0.14);
      if (noiseBuf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuf;

        const bpFilter = this.ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.frequency.setValueAtTime(1900, now);
        bpFilter.Q.setValueAtTime(2.0, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.85, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

        noise.connect(bpFilter);
        bpFilter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }
    } else {
      // Classic Steampunk Cylinder Revolver: heavy gunshot with solid punch & chamber crack
      // 1. Concussive Sub-Bass Kick
      const kickOsc = this.ctx.createOscillator();
      const kickGain = this.ctx.createGain();
      kickOsc.type = 'triangle';
      kickOsc.frequency.setValueAtTime(290, now);
      kickOsc.frequency.exponentialRampToValueAtTime(36, now + 0.10);

      kickGain.gain.setValueAtTime(1.0, now);
      kickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.10);

      kickOsc.connect(kickGain);
      kickGain.connect(out);
      kickOsc.start(now);
      kickOsc.stop(now + 0.11);

      // 2. Gunpowder Detonation Blast
      const noiseBuf = this.createNoiseBuffer(0.24);
      if (noiseBuf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuf;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2800, now);
        filter.frequency.exponentialRampToValueAtTime(320, now + 0.24);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.95, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.24);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }

      // 3. High-Frequency Hammer / Ignition Snap
      const snapOsc = this.ctx.createOscillator();
      const snapGain = this.ctx.createGain();
      snapOsc.type = 'sawtooth';
      snapOsc.frequency.setValueAtTime(1800, now);
      snapOsc.frequency.exponentialRampToValueAtTime(400, now + 0.025);

      snapGain.gain.setValueAtTime(0.5, now);
      snapGain.gain.exponentialRampToValueAtTime(0.01, now + 0.025);

      snapOsc.connect(snapGain);
      snapGain.connect(out);
      snapOsc.start(now);
      snapOsc.stop(now + 0.028);
    }
  }

  /**
   * Wall Ricochet Ping SFX - Metallic supersonic resonance.
   */
  playRicochet(worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.65);
    if (!out) return;

    // Resonant supersonic ping
    const baseFreq = 2200 + Math.random() * 800;
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, now + 0.20);

    oscGain.gain.setValueAtTime(0.6, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

    osc.connect(oscGain);
    oscGain.connect(out);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  /**
   * Bullet Impact SFX (Wall masonry crunch vs Entity automaton armor).
   */
  playImpact(isEntity = false, worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, isEntity ? 0.85 : 0.55);
    if (!out) return;

    if (isEntity) {
      // Automaton metal armor impact: Heavy metallic clang & kinetic crunch
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.12);

      oscGain.gain.setValueAtTime(0.7, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

      osc.connect(oscGain);
      oscGain.connect(out);
      osc.start(now);
      osc.stop(now + 0.13);

      const buf = this.createNoiseBuffer(0.14);
      if (buf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = buf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1100, now);
        filter.Q.setValueAtTime(2.5, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.75, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }
    } else {
      // Solid wall hit: kinetic impact thud + masonry crumble
      const thudOsc = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thudOsc.type = 'triangle';
      thudOsc.frequency.setValueAtTime(140, now);
      thudOsc.frequency.exponentialRampToValueAtTime(38, now + 0.08);

      thudGain.gain.setValueAtTime(0.65, now);
      thudGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

      thudOsc.connect(thudGain);
      thudGain.connect(out);
      thudOsc.start(now);
      thudOsc.stop(now + 0.085);

      const buf = this.createNoiseBuffer(0.10);
      if (buf) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = buf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.5, now);
        nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.10);

        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(out);
        noise.start(now);
      }
    }
  }

  /**
   * Weapon Reload SFX - Steampunk cylinder ratchet sequence.
   * Stage 1: Chamber slide out (metallic friction)
   * Stage 2: Brass shell insertion (resonant ping)
   * Stage 3: Heavy cylinder lock (tactical mechanical snap)
   */
  playReload(worldX = null, worldY = null) {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const now = this.ctx.currentTime;
    const out = this.createSpatialChain(worldX, worldY, 0.75);
    if (!out) return;

    // 1. Chamber slide out (t = 0.00s)
    const slideBuf = this.createNoiseBuffer(0.10);
    if (slideBuf) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = slideBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600, now);
      bp.frequency.exponentialRampToValueAtTime(650, now + 0.10);
      bp.Q.setValueAtTime(2.2, now);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.6, now);
      nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.10);

      noise.connect(bp);
      bp.connect(nGain);
      nGain.connect(out);
      noise.start(now);
    }

    // 2. Brass shell insertion chimes (t = 0.15s, 0.24s)
    [0.15, 0.24].forEach((delay, idx) => {
      const chimeTime = now + delay;
      const chimeOsc = this.ctx.createOscillator();
      const chimeGain = this.ctx.createGain();
      chimeOsc.type = 'sine';
      chimeOsc.frequency.setValueAtTime(1350 + idx * 280, chimeTime);

      chimeGain.gain.setValueAtTime(0.45, chimeTime);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, chimeTime + 0.07);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(out);
      chimeOsc.start(chimeTime);
      chimeOsc.stop(chimeTime + 0.075);
    });

    // 3. Heavy ratchet cylinder lock & snap (t = 0.36s)
    const lockTime = now + 0.36;
    const lockOsc = this.ctx.createOscillator();
    const lockGain = this.ctx.createGain();
    lockOsc.type = 'square';
    lockOsc.frequency.setValueAtTime(750, lockTime);
    lockOsc.frequency.exponentialRampToValueAtTime(180, lockTime + 0.06);

    lockGain.gain.setValueAtTime(0.7, lockTime);
    lockGain.gain.exponentialRampToValueAtTime(0.01, lockTime + 0.06);

    lockOsc.connect(lockGain);
    lockGain.connect(out);
    lockOsc.start(lockTime);
    lockOsc.stop(lockTime + 0.065);
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
