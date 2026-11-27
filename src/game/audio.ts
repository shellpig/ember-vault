export class DungeonAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = false;
  private unlocked = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public unlockAndEnable(): void {
    this.ensureContext();
    if (!this.ctx || !this.masterGain) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
    this.enabled = true;
    this.masterGain.gain.setTargetAtTime(0.42, this.ctx.currentTime, 0.06);
  }

  public setEnabled(on: boolean): void {
    if (on) {
      this.unlockAndEnable();
    } else {
      this.enabled = false;
      if (this.ctx && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      }
    }
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    // Pre-generate 2s white noise buffer for filtered bursts & ambient wind
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Ambient low dungeon rumble + hollow draft
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.22;
    droneGain.connect(master);

    const subOsc = ctx.createOscillator();
    subOsc.type = 'triangle';
    subOsc.frequency.value = 46;
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.value = 110;
    subOsc.connect(subFilter);
    subFilter.connect(droneGain);
    subOsc.start();

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buffer;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 180;
    windFilter.Q.value = 2.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.14;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(droneGain);
    windSrc.start();

    this.ctx = ctx;
    this.masterGain = master;
    this.droneGain = droneGain;
    this.noiseBuffer = buffer;
  }

  /** Set by the engine while a bot teammate acts: its sounds are not played. */
  public suppressed = false;

  private canPlay(): boolean {
    return !this.suppressed && this.enabled && this.unlocked && this.ctx !== null && this.masterGain !== null;
  }

  public playFootstep(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 280 + Math.random() * 140;
    filter.Q.value = 2.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 1.4, 0.06);
  }

  public playSwordSlash(isCleave = false): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isCleave ? 1600 : 1950, now);
    filter.frequency.exponentialRampToValueAtTime(isCleave ? 240 : 420, now + (isCleave ? 0.22 : 0.13));
    filter.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isCleave ? 0.36 : 0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isCleave ? 0.24 : 0.14));

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, 0, isCleave ? 0.25 : 0.15);

    // Subtle steel ring overtone
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isCleave ? 620 : 880, now);
    osc.frequency.exponentialRampToValueAtTime(isCleave ? 220 : 360, now + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.09, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playHit(heavy = false): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 160 : 210, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.11);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = heavy ? 680 : 900;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.34 : 0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playPlayerHurt(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.18);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playSkeletonDeath(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Cascading brittle bone clacks
    const freqs = [920, 680, 1140, 540, 810];
    freqs.forEach((f, i) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + i * 0.036;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.045);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.055);
    });
  }

  public playSlimePop(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.07);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.16);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  public playCrateBreak(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, 0.2, 0.15);
  }

  public playDash(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.16);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.19, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, 0.4, 0.18);
  }

  public playPommelStrike(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // 1. Heavy blunt pommel thud / low shockwave punch
    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(165, now);
    subOsc.frequency.exponentialRampToValueAtTime(44, now + 0.22);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.36, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.26);

    // 2. Metallic hilt knock transient
    const knockOsc = this.ctx.createOscillator();
    knockOsc.type = 'triangle';
    knockOsc.frequency.setValueAtTime(520, now);
    knockOsc.frequency.exponentialRampToValueAtTime(175, now + 0.085);

    const knockGain = this.ctx.createGain();
    knockGain.gain.setValueAtTime(0.24, now);
    knockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    knockOsc.connect(knockGain);
    knockGain.connect(this.masterGain);
    knockOsc.start(now);
    knockOsc.stop(now + 0.1);

    // 3. Compact radial air shockwave whoosh
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(680, now);
      filter.frequency.exponentialRampToValueAtTime(180, now + 0.19);
      filter.Q.value = 1.2;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.26, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      src.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      src.start(now, 0.12, 0.22);
    }
  }

  public playCoin(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.playTone(1318.5, 'sine', now, 0.08, 0.14);
    this.playTone(1760, 'sine', now + 0.055, 0.14, 0.14);
  }

  public playPotion(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((n, i) => this.playTone(n, 'triangle', now + i * 0.06, 0.16, 0.16));
  }

  public playKeyFound(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => this.playTone(n, 'square', now + i * 0.075, 0.2, 0.11));
  }

  /** Treasure room discovered (local only): a short rising shimmer. */
  public playTreasureFound(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [587.33, 739.99, 880, 1174.66, 1479.98].forEach((n, i) => this.playTone(n, 'triangle', now + i * 0.07, 0.3, 0.1));
  }

  /** Treasure chest opened: creaking lid, then a bright coin chord. */
  public playChestOpen(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.playTone(150, 'sawtooth', now, 0.22, 0.1);
    this.playTone(210, 'sawtooth', now + 0.08, 0.2, 0.08);
    this.playTone(783.99, 'sine', now + 0.2, 0.34, 0.13);
    this.playTone(987.77, 'sine', now + 0.26, 0.34, 0.12);
    this.playTone(1318.51, 'triangle', now + 0.32, 0.4, 0.12);
  }

  public playDoorUnlock(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.playTone(220, 'sawtooth', now, 0.18, 0.14);
    this.playTone(329.63, 'triangle', now + 0.09, 0.2, 0.16);
    this.playTone(440, 'triangle', now + 0.18, 0.24, 0.16);
    this.playTone(659.25, 'sine', now + 0.27, 0.34, 0.18);
  }

  public playPortal(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.28);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.45);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);

    this.playTone(587.33, 'triangle', now + 0.06, 0.24, 0.13);
    this.playTone(880, 'sine', now + 0.15, 0.32, 0.14);
  }

  public playAngelBlessing(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 987.77, 1318.51];
    notes.forEach((n, i) => {
      this.playTone(n, 'sine', now + i * 0.07, 0.34, 0.15);
      this.playTone(n * 2, 'triangle', now + i * 0.07, 0.18, 0.05);
    });
  }

  public playDescend(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [392.0, 329.63, 261.63, 196.0];
    notes.forEach((n, i) => this.playTone(n, 'triangle', now + i * 0.12, 0.36, 0.18));
  }

  public playBossTelegraph(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.42);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1100, now + 0.42);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playBossSlam(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // 1. Massive earth-shattering sub-bass drop
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(145, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.52);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.68, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.58);

    // 2. Heavy metallic warhammer / stone body thud
    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, now);
    body.frequency.exponentialRampToValueAtTime(48, now + 0.28);
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(0.42, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    body.connect(bg);
    bg.connect(this.masterGain);
    body.start(now);
    body.stop(now + 0.32);

    // 3. Sharp stone-crack transient + deep rubble rumble tail
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const cFilter = this.ctx.createBiquadFilter();
    cFilter.type = 'bandpass';
    cFilter.frequency.setValueAtTime(1900, now);
    cFilter.frequency.exponentialRampToValueAtTime(240, now + 0.16);
    cFilter.Q.value = 0.9;
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.54, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    crack.connect(cFilter);
    cFilter.connect(cg);
    cg.connect(this.masterGain);
    crack.start(now, 0.02, 0.2);

    const rumble = this.ctx.createBufferSource();
    rumble.buffer = this.noiseBuffer;
    const rFilter = this.ctx.createBiquadFilter();
    rFilter.type = 'lowpass';
    rFilter.frequency.setValueAtTime(680, now);
    rFilter.frequency.exponentialRampToValueAtTime(110, now + 0.56);
    const rg = this.ctx.createGain();
    rg.gain.setValueAtTime(0.45, now);
    rg.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    rumble.connect(rFilter);
    rFilter.connect(rg);
    rg.connect(this.masterGain);
    rumble.start(now, 0.12, 0.6);
  }

  public playBossLaserCharge(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.54);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(360, now);
    lp.frequency.exponentialRampToValueAtTime(2200, now + 0.54);
    lp.Q.value = 2.4;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.02, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.46);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  public playBossLaser(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // 1. Punchy sub-bass discharge ("BU!")
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(200, now);
    sub.frequency.exponentialRampToValueAtTime(46, now + 0.42);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.58, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.5);

    // 2. Iconic "BU!~~~~~~" dual-detuned resonant laser beam
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3400, now);
    lp.frequency.exponentialRampToValueAtTime(1250, now + 0.14);
    lp.frequency.exponentialRampToValueAtTime(760, now + 0.76);
    lp.Q.value = 3.2;

    const beamGain = this.ctx.createGain();
    beamGain.gain.setValueAtTime(0.42, now);
    beamGain.gain.linearRampToValueAtTime(0.32, now + 0.54);
    beamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    const beam1 = this.ctx.createOscillator();
    beam1.type = 'sawtooth';
    beam1.frequency.setValueAtTime(1680, now);
    beam1.frequency.exponentialRampToValueAtTime(430, now + 0.09);
    beam1.frequency.exponentialRampToValueAtTime(310, now + 0.76);

    const beam2 = this.ctx.createOscillator();
    beam2.type = 'square';
    beam2.frequency.setValueAtTime(1760, now);
    beam2.frequency.exponentialRampToValueAtTime(455, now + 0.09);
    beam2.frequency.exponentialRampToValueAtTime(328, now + 0.76);

    // Subtle 26 Hz energy flutter on the sustained beam
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.setValueAtTime(26, now);
    lfoGain.gain.setValueAtTime(18, now);
    lfo.connect(lfoGain);
    lfoGain.connect(beam1.frequency);

    beam1.connect(lp);
    beam2.connect(lp);
    lp.connect(beamGain);
    beamGain.connect(this.masterGain);
    lfo.start(now);
    beam1.start(now);
    beam2.start(now);
    lfo.stop(now + 0.82);
    beam1.stop(now + 0.82);
    beam2.stop(now + 0.82);

    // 3. Crisp plasma crackle / sizzle riding the beam tail
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2500, now);
    bp.frequency.exponentialRampToValueAtTime(1100, now + 0.76);
    bp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.28, now);
    ng.gain.linearRampToValueAtTime(0.18, now + 0.5);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.78);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.04, 0.8);
  }

  public playBossBlackHoleCharge(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Accelerating gravitational suction hum that cuts sharp right on the compression beat (0.88s)
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.55);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.84);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(140, now);
    bp.frequency.exponentialRampToValueAtTime(1600, now + 0.84);
    bp.Q.value = 3.2;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.02, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.65);
    g.gain.linearRampToValueAtTime(0.32, now + 0.82);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.88);

    osc.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.9);
  }

  public playBossBlackHole(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // 1. Massive gravitational implosion bass drop
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(320, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.55);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.68, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.64);

    // 2. Cosmic dissonant collapse chord
    for (const startFreq of [440, 554]) {
      const pad = this.ctx.createOscillator();
      pad.type = 'triangle';
      pad.frequency.setValueAtTime(startFreq, now);
      pad.frequency.exponentialRampToValueAtTime(startFreq * 0.24, now + 0.6);
      const pg = this.ctx.createGain();
      pg.gain.setValueAtTime(0.24, now);
      pg.gain.exponentialRampToValueAtTime(0.001, now + 0.64);
      pad.connect(pg);
      pg.connect(this.masterGain);
      pad.start(now);
      pad.stop(now + 0.66);
    }

    // 3. Void shockwave roar
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(1100, now);
    lp.frequency.exponentialRampToValueAtTime(160, now + 0.56);
    lp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.4, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.08, 0.62);
  }

  public playBossChargeImpact(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // 1. Seismic fissure tear + rising lava eruption roar
    const sub = this.ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(175, now);
    sub.frequency.exponentialRampToValueAtTime(36, now + 0.52);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + 0.55);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.55, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    sub.connect(lp);
    lp.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.6);

    // 2. Blazing fire-pillar whoosh eruption
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, now);
    bp.frequency.exponentialRampToValueAtTime(1450, now + 0.16);
    bp.frequency.exponentialRampToValueAtTime(260, now + 0.66);
    bp.Q.value = 0.85;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.56, now);
    ng.gain.linearRampToValueAtTime(0.42, now + 0.22);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.03, 0.7);
  }

  public playBossPrismShatter(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Crystalline shimmering chime burst (stained-glass prisms erupting & shattering)
    [1320, 1760, 2217, 2637].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.025);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + i * 0.025 + 0.34);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.22, now + i * 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.025 + 0.36);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(now + i * 0.025);
      osc.stop(now + i * 0.025 + 0.38);
    });

    // Crisp glass-shatter crackle
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2600, now);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.36, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.02, 0.44);
  }

  public playBossOrbitalStrike(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Sky-to-ground orbital beam thunderclap
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(220, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.42);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.55, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.48);

    const beam = this.ctx.createOscillator();
    beam.type = 'sawtooth';
    beam.frequency.setValueAtTime(1240, now);
    beam.frequency.exponentialRampToValueAtTime(240, now + 0.36);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(1500, now);
    lp.frequency.exponentialRampToValueAtTime(380, now + 0.38);
    lp.Q.value = 1.8;
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(0.3, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    beam.connect(lp);
    lp.connect(bg);
    bg.connect(this.masterGain);
    beam.start(now);
    beam.stop(now + 0.44);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1100, now);
    bp.frequency.exponentialRampToValueAtTime(220, now + 0.4);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.34, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.05, 0.46);
  }

  public playBossVolley(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Heavy electromagnetic cannon kick
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(190, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.3);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.5, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.36);

    // Crisp 3-pulse railgun discharge snaps
    [0, 0.04, 0.08].forEach((off, idx) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1420 - idx * 90, now + off);
      osc.frequency.exponentialRampToValueAtTime(220, now + off + 0.22);
      const lp = this.ctx!.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, now + off);
      lp.frequency.exponentialRampToValueAtTime(520, now + off + 0.22);
      lp.Q.value = 2.2;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.36, now + off);
      g.gain.exponentialRampToValueAtTime(0.001, now + off + 0.24);
      osc.connect(lp);
      lp.connect(g);
      g.connect(this.masterGain!);
      osc.start(now + off);
      osc.stop(now + off + 0.26);
    });

    // Supersonic crackle burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(2200, now);
    hp.frequency.exponentialRampToValueAtTime(750, now + 0.28);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.32, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.02, 0.32);
  }

  public playBossVictory(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25, 659.25];
    notes.forEach((n, i) => this.playTone(n, 'triangle', now + i * 0.085, 0.42, 0.19));
  }

  public playUpgrade(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 739.99, 880.0, 1174.66];
    notes.forEach((n, i) => this.playTone(n, 'sine', now + i * 0.055, 0.28, 0.16));
  }

  public playBowShot(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    // Crisp bowstring twang
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.16, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);

    // Arrow air zip
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + 0.08);
    filter.Q.value = 2.2;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.14, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(filter);
    filter.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.15, 0.1);
  }

  public playMageCast(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.11);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.22);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  // ---- Frost Mage ---------------------------------------------------------
  /** Crisp glassy "tsing" when an ice spike is fired. */
  public playIceCast(empowered = false): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const base = empowered ? 1250 : 1650;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.9, now + 0.07);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(empowered ? 0.12 : 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (empowered ? 0.2 : 0.13));
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  /** Shattering ice burst on spike impact. */
  public playIceShatter(empowered = false): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(empowered ? 3200 : 4200, now);
    filter.Q.setValueAtTime(2.2, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(empowered ? 0.26 : 0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (empowered ? 0.28 : 0.16));
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 0.5, 0.3);

    const ping = this.ctx.createOscillator();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(empowered ? 2100 : 2700, now);
    ping.frequency.exponentialRampToValueAtTime(empowered ? 900 : 1500, now + 0.12);
    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(0.06, now);
    pg.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    ping.connect(pg);
    pg.connect(this.masterGain);
    ping.start(now);
    ping.stop(now + 0.15);
  }

  /** Big icy whoomph + crystalline shimmer for Frost Nova. */
  public playFrostNova(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const boom = this.ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(160, now);
    boom.frequency.exponentialRampToValueAtTime(45, now + 0.45);
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(0.32, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    boom.connect(bg);
    bg.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.52);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(6000, now + 0.6);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.22, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    src.connect(filter);
    filter.connect(ng);
    ng.connect(this.masterGain);
    src.start(now, 0.1, 0.72);

    for (let i = 0; i < 4; i++) {
      const t = now + 0.05 + i * 0.07;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1800 + i * 420, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t);
      o.stop(t + 0.26);
    }
  }

  /** Airy shimmer for Blink. */
  public playBlink(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(2400, now + 0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  /** Soft icy chime when the shield is depleted (warning). */
  public playShieldBreak(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.setValueAtTime(4, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, 0.2, 0.36);
  }

  public playBlock(panBonk = false): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (panBonk) {
      // Hilarious resonant cast-iron frying pan clang
      this.playTone(720, 'triangle', now, 0.28, 0.22);
      this.playTone(1110, 'sine', now, 0.24, 0.16);
      this.playTone(1590, 'sine', now + 0.01, 0.18, 0.12);
    } else {
      // Crisp steel shield parry clang
      this.playTone(960, 'triangle', now, 0.12, 0.18);
      this.playTone(1440, 'sine', now + 0.015, 0.14, 0.14);
    }
  }

  public playRelicDrop(rarity: 'blue' | 'yellow' | 'orange' | 'green'): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (rarity === 'orange') {
      // Iconic legendary chord + deep gong
      this.playTone(196, 'triangle', now, 0.55, 0.22);
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((n, i) => this.playTone(n, 'sine', now + i * 0.065, 0.45, 0.17));
    } else if (rarity === 'green') {
      // Crystalline emerald set resonance
      this.playTone(220, 'triangle', now, 0.5, 0.2);
      const notes = [440, 554.37, 659.25, 880, 1108.73];
      notes.forEach((n, i) => this.playTone(n, 'triangle', now + i * 0.065, 0.42, 0.16));
    } else if (rarity === 'yellow') {
      this.playTone(659.25, 'triangle', now, 0.16, 0.14);
      this.playTone(987.77, 'sine', now + 0.06, 0.2, 0.14);
    } else {
      this.playTone(587.33, 'sine', now, 0.14, 0.11);
      this.playTone(783.99, 'sine', now + 0.05, 0.14, 0.11);
    }
  }

  public playRelicEquip(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.playTone(440, 'triangle', now, 0.1, 0.14);
    this.playTone(659.25, 'sine', now + 0.05, 0.16, 0.14);
  }

  public playRelicSell(): void {
    if (!this.canPlay() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.playTone(1046.5, 'sine', now, 0.09, 0.14);
    this.playTone(1318.5, 'sine', now + 0.05, 0.1, 0.14);
    this.playTone(1567.98, 'sine', now + 0.1, 0.15, 0.14);
  }

  private playTone(
    freq: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    volume: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  public dispose(): void {
    if (this.droneGain) {
      this.droneGain.disconnect();
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
