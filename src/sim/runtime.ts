import { Rng } from '../core/rng';
import type { GameState, Zombie } from './types';

export interface NoiseEvent {
  x: number;
  y: number;
  radius: number;
  kind: string;
  src: 'player' | 'zombie' | 'world' | 'vehicle';
  /** Description used when the player hears it. */
  label?: string;
}

export interface SoundCue {
  x: number;
  y: number;
  t: number;
  label: string;
  loud: number;
}

export interface Effect {
  kind: 'ring' | 'blood' | 'flash' | 'spark' | 'text' | 'tracer' | 'smoke' | 'glass';
  x: number;
  y: number;
  z?: number;
  x2?: number;
  y2?: number;
  t: number;
  dur: number;
  r?: number;
  text?: string;
  color?: number;
}

export interface TimedAction {
  label: string;
  dur: number;
  t: number;
  onDone: () => void;
  onTick?: (dt: number) => void;
  onCancel?: () => void;
  /** Cancel when the player moves. */
  cancelOnMove: boolean;
  anim: 'kneel' | 'work' | 'hammer' | 'search' | 'use' | 'read' | 'eat' | 'climb' | 'none';
  /** Noise emitted periodically while working. */
  noise?: { radius: number; every: number; acc: number; kind: string };
  /** Allows fast-forward while it runs. */
  ffwd?: boolean;
  /** Game-time based duration (hours) rather than real seconds. */
  gameHours?: number;
  startT?: number;
}

export class Runtime {
  rng: Rng;
  vis: Uint8Array;
  visList: number[] = [];
  light: Float32Array;
  lightColor: Float32Array;
  lightDirty = true;
  lightVersion = 0;
  fireLightT = 0;
  noises: NoiseEvent[] = [];
  cues: SoundCue[] = [];
  effects: Effect[] = [];
  action: TimedAction | null = null;
  /** Time multiplier chosen by the player (1, 2, 4...). */
  speed = 1;
  paused = false;
  realTime = 0;
  fovT = 0;
  fovX = -1;
  fovY = -1;
  fovF = 0;
  fovDirty = true;
  /** Spatial hash of zombies (bucket = 8x8 tiles). */
  zgrid: Map<number, Zombie[]> = new Map();
  aimX = 0;
  aimY = 0;
  aimValid = false;
  /** Renderer invalidation flags. */
  dirty = { walls: true, doors: true, furn: true, ground: true, corpses: true, floor: true };
  pathBudget = 0;
  /** Zombies currently in view (ids). */
  seenZombies = new Set<number>();
  /** Nearby zombie count used for panic, updated with vision. */
  threat = 0;
  closestZombie = 99;
  heard: { t: number; x: number; y: number; label: string; loud: number }[] = [];
  toast: { text: string; t: number }[] = [];
  lastSave = 0;
  sleepBlocked = '';
  deathHandled = false;
  flash = 0;
  shake = 0;
  hurtFlash = 0;
  helicopterSound = 0;
  alarmSound = 0;
  constructor(s: GameState) {
    this.rng = new Rng(s.rng);
    const n = s.world.w * s.world.h;
    this.vis = new Uint8Array(n);
    this.light = new Float32Array(n);
    this.lightColor = new Float32Array(n * 3);
  }
}

export const ZCELL = 8;
export function rebuildZGrid(s: GameState, rt: Runtime): void {
  rt.zgrid.clear();
  const cw = Math.ceil(s.world.w / ZCELL);
  for (const z of s.zombies) {
    const k = Math.floor(z.y / ZCELL) * cw + Math.floor(z.x / ZCELL);
    let b = rt.zgrid.get(k);
    if (!b) {
      b = [];
      rt.zgrid.set(k, b);
    }
    b.push(z);
  }
}

export function zombiesNear(s: GameState, rt: Runtime, x: number, y: number, r: number, out: Zombie[] = []): Zombie[] {
  out.length = 0;
  const cw = Math.ceil(s.world.w / ZCELL);
  const x0 = Math.max(0, Math.floor((x - r) / ZCELL));
  const x1 = Math.floor((x + r) / ZCELL);
  const y0 = Math.max(0, Math.floor((y - r) / ZCELL));
  const y1 = Math.floor((y + r) / ZCELL);
  const r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const b = rt.zgrid.get(cy * cw + cx);
      if (!b) continue;
      for (const z of b) {
        const dx = z.x - x;
        const dy = z.y - y;
        if (dx * dx + dy * dy <= r2) out.push(z);
      }
    }
  }
  return out;
}
