// Procedural sound: everything is synthesised with Web Audio, positioned relative to the camera.
import type { Game } from '../game';

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private reverb!: ConvolverNode;
  private volume = 0.7;
  private rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private alarm: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private heli: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private heartT = 0;
  private groanT = 2;
  private unlocked = false;

  unlockOnGesture(): void {
    if (this.unlocked) return;
    const go = (): void => {
      this.init();
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  private init(): void {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.unlocked = true;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // synthetic room reverb
    this.reverb = c.createConvolver();
    const ir = c.createBuffer(2, c.sampleRate * 1.8, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    this.reverb.buffer = ir;
    const rg = c.createGain();
    rg.gain.value = 0.25;
    this.reverb.connect(rg).connect(this.master);
    this.rain = this.loopNoise(1200, 'bandpass', 0);
    this.wind = this.loopNoise(300, 'lowpass', 0);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private loopNoise(freq: number, type: BiquadFilterType, vol: number): { src: AudioBufferSourceNode; gain: GainNode } {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, gain: g };
  }

  private out(pan: number, vol: number, wet = 0): AudioNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = vol;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master);
    if (wet > 0) {
      const w = c.createGain();
      w.gain.value = wet;
      p.connect(w).connect(this.reverb);
    }
    return g;
  }

  private noiseHit(dest: AudioNode, dur: number, freq: number, type: BiquadFilterType, q = 1, attack = 0.002, when = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol = 1, when = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private groan(pan: number, vol: number): void {
    const c = this.ctx!;
    const dest = this.out(pan, vol, 0.2);
    const t = c.currentTime;
    const dur = 0.9 + Math.random() * 1.1;
    const base = 70 + Math.random() * 60;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.2, t);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    const vib = c.createOscillator();
    vib.frequency.value = 5 + Math.random() * 4;
    const vg = c.createGain();
    vg.gain.value = 6;
    vib.connect(vg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420 + Math.random() * 300;
    f.Q.value = 4;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }

  private play(kind: string, pan: number, vol: number): void {
    if (vol < 0.01) return;
    switch (kind) {
      case 'step':
        this.noiseHit(this.out(pan, vol * 0.25), 0.05, 500, 'lowpass');
        break;
      case 'run':
        this.noiseHit(this.out(pan, vol * 0.4), 0.06, 700, 'lowpass');
        break;
      case 'door':
        this.tone(this.out(pan, vol * 0.25, 0.2), 'sawtooth', 240, 120, 0.35, 0.3);
        this.noiseHit(this.out(pan, vol * 0.6, 0.2), 0.15, 200, 'lowpass', 1, 0.002, 0.25);
        break;
      case 'glass':
        this.noiseHit(this.out(pan, vol * 0.8, 0.3), 0.45, 3500, 'highpass');
        for (let k = 0; k < 5; k++) this.tone(this.out(pan, vol * 0.15), 'sine', 2500 + Math.random() * 3000, 2000, 0.3, 0.5, 0.05 + k * 0.06);
        break;
      case 'gunshot':
        this.noiseHit(this.out(pan, vol * 1.3, 0.6), 0.35, 1800, 'lowpass', 0.7, 0.001);
        this.tone(this.out(pan, vol, 0.4), 'sine', 110, 40, 0.4, 1);
        break;
      case 'hit':
      case 'thud':
      case 'fall':
        this.tone(this.out(pan, vol * 0.8), 'sine', 110, 45, 0.18, 1);
        this.noiseHit(this.out(pan, vol * 0.4), 0.1, 800, 'lowpass');
        break;
      case 'shove':
        this.noiseHit(this.out(pan, vol * 0.4), 0.12, 400, 'lowpass');
        break;
      case 'bang':
      case 'knock':
        this.tone(this.out(pan, vol * 0.8, 0.3), 'sine', 90, 50, 0.25, 1);
        this.noiseHit(this.out(pan, vol * 0.5, 0.3), 0.2, 300, 'lowpass');
        break;
      case 'hammer':
      case 'pry':
      case 'chop':
        this.noiseHit(this.out(pan, vol * 0.7, 0.3), 0.08, 2000, 'bandpass', 2);
        this.tone(this.out(pan, vol * 0.4), 'square', 420, 300, 0.07, 0.4);
        break;
      case 'clatter':
      case 'cans':
        for (let k = 0; k < 7; k++) this.tone(this.out(pan, vol * 0.3, 0.2), 'triangle', 800 + Math.random() * 1600, 600, 0.12, 0.6, k * 0.05 + Math.random() * 0.04);
        break;
      case 'crash':
        this.noiseHit(this.out(pan, vol * 1.2, 0.5), 0.8, 900, 'lowpass', 0.5, 0.002);
        for (let k = 0; k < 4; k++) this.tone(this.out(pan, vol * 0.25), 'triangle', 300 + Math.random() * 500, 200, 0.6, 0.6, k * 0.07);
        break;
      case 'thunder':
        this.noiseHit(this.out(pan, vol * 1.4, 0.4), 3.5, 180, 'lowpass', 0.5, 0.05);
        break;
      case 'starter':
        for (let k = 0; k < 6; k++) this.noiseHit(this.out(pan, vol * 0.4), 0.08, 400, 'lowpass', 1, 0.002, k * 0.11);
        break;
      case 'horn':
        this.tone(this.out(pan, vol * 0.4), 'square', 400, 400, 0.5, 0.5);
        this.tone(this.out(pan, vol * 0.4), 'square', 500, 500, 0.5, 0.5);
        break;
      case 'click':
        this.tone(this.out(pan, vol * 0.5), 'square', 2000, 1500, 0.03, 0.4);
        break;
      case 'clock':
        for (let k = 0; k < 8; k++) this.tone(this.out(pan, vol * 0.3), 'square', 1400, 1400, 0.06, 0.4, k * 0.12);
        break;
      case 'cough':
      case 'vomit':
        this.noiseHit(this.out(pan, vol * 0.6), 0.25, 700, 'bandpass', 1.5, 0.01);
        break;
      case 'search':
      case 'rustle':
      case 'scrape':
        this.noiseHit(this.out(pan, vol * 0.2), 0.2, 2500, 'bandpass', 1, 0.02);
        break;
      case 'switch':
        this.tone(this.out(pan, vol * 0.3), 'square', 1800, 1200, 0.02, 0.3);
        break;
      default:
        break;
    }
  }

  update(g: Game, dt: number): void {
    const c = this.ctx;
    const rt = g.rt;
    if (!c) {
      rt.sfx.length = 0;
      return;
    }
    const s = g.s;
    const p = s.player;
    const px = p.inVehicle >= 0 ? s.vehicles[p.inVehicle].x : p.x;
    const py = p.inVehicle >= 0 ? s.vehicles[p.inVehicle].y : p.y;
    const { rightX, rightZ } = g.renderer.camVectors();
    for (const n of rt.sfx) {
      const dx = n.x - px;
      const dy = n.y - py;
      const d = Math.hypot(dx, dy);
      const pan = (dx * rightX + dy * rightZ) / 14;
      const heardR = Math.max(6, n.radius * 1.6);
      const vol = Math.max(0, 1 - d / heardR) * (n.src === 'player' ? 0.9 : 1);
      if (n.kind === 'moan') this.groan(pan, vol * 0.6);
      else this.play(n.kind, pan, vol);
    }
    rt.sfx.length = 0;
    // ambient zombie groans from nearby dead who know you're there
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 1.5 + Math.random() * 4;
      let best = null as null | { x: number; y: number; d: number };
      for (const z of s.zombies) {
        const d = Math.hypot(z.x - px, z.y - py);
        if (d < 16 && z.state !== 'down' && (!best || d < best.d)) best = { x: z.x, y: z.y, d };
      }
      if (best && Math.random() < 0.6) this.groan(((best.x - px) * rightX + (best.y - py) * rightZ) / 14, 0.25 * (1 - best.d / 16));
    }
    const t = c.currentTime;
    // weather beds
    const w = s.weather;
    this.rain?.gain.gain.setTargetAtTime(w.rain * 0.18, t, 0.5);
    this.wind?.gain.gain.setTargetAtTime(w.wind * 0.08, t, 0.8);
    // alarm siren
    if (rt.alarmSound > 0.01) {
      if (!this.alarm) {
        const osc = c.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 800;
        const lfo = c.createOscillator();
        lfo.frequency.value = 1.2;
        const lg = c.createGain();
        lg.gain.value = 220;
        lfo.connect(lg).connect(osc.frequency);
        const gain = c.createGain();
        gain.gain.value = 0;
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2200;
        osc.connect(f).connect(gain).connect(this.master);
        osc.start();
        lfo.start();
        this.alarm = { osc, gain, lfo };
      }
      this.alarm.gain.gain.setTargetAtTime(rt.alarmSound * 0.07, t, 0.2);
    } else if (this.alarm) {
      this.alarm.gain.gain.setTargetAtTime(0, t, 0.2);
      const a = this.alarm;
      setTimeout(() => {
        a.osc.stop();
        a.lfo.stop();
      }, 800);
      this.alarm = null;
    }
    // helicopter
    if (rt.helicopterSound > 0.01) {
      if (!this.heli) {
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 350;
        const am = c.createGain();
        am.gain.value = 0.5;
        const lfo = c.createOscillator();
        lfo.frequency.value = 13;
        const lg = c.createGain();
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(am.gain);
        const gain = c.createGain();
        gain.gain.value = 0;
        src.connect(f).connect(am).connect(gain).connect(this.master);
        src.start();
        lfo.start();
        this.heli = { src, gain, lfo };
      }
      this.heli.gain.gain.setTargetAtTime(rt.helicopterSound * 0.6, t, 0.3);
    } else if (this.heli) {
      const h = this.heli;
      h.gain.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => {
        h.src.stop();
        h.lfo.stop();
      }, 1200);
      this.heli = null;
    }
    // engine
    const v = p.inVehicle >= 0 ? s.vehicles[p.inVehicle] : null;
    if (v && v.engineOn) {
      if (!this.engine) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        const osc2 = c.createOscillator();
        osc2.type = 'square';
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        const gain = c.createGain();
        gain.gain.value = 0;
        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain).connect(this.master);
        osc.start();
        osc2.start();
        this.engine = { osc, osc2, gain, filter };
      }
      const rpm = 32 + Math.abs(v.speed) * 4.5;
      this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.1);
      this.engine.osc2.frequency.setTargetAtTime(rpm * 0.5 + (100 - v.engine) * 0.05 * Math.random(), t, 0.05);
      this.engine.filter.frequency.setTargetAtTime(250 + Math.abs(v.speed) * 30 + (100 - v.engine) * 4, t, 0.1);
      this.engine.gain.gain.setTargetAtTime(0.09, t, 0.2);
    } else if (this.engine) {
      const e = this.engine;
      e.gain.gain.setTargetAtTime(0, t, 0.15);
      setTimeout(() => {
        e.osc.stop();
        e.osc2.stop();
      }, 700);
      this.engine = null;
    }
    // heartbeat when panicked
    const panic = p.needs.calm > 0 ? p.needs.panic * 0.4 : p.needs.panic;
    if (panic > 0.45 && !p.dead) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.1 - panic * 0.55;
        const dest = this.out(0, 0.35 * panic);
        this.tone(dest, 'sine', 70, 40, 0.12, 1);
        this.tone(dest, 'sine', 65, 38, 0.1, 0.8, 0.18);
      }
    }
  }
}
