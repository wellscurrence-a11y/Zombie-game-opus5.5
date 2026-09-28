// Boredom and unhappiness, after Project Zomboid. Sitting indoors with nothing to do slowly bores you;
// staying bored makes you unhappy. Neither touches your health or how well you fight. Instead a miserable
// survivor works slower, learns slower, and gets restless — pacing, muttering, crying — which the dead can
// hear. Indoor distractions wear thin with repetition, the TV dies with the power and the radio falls
// silent, so in the end the cure is outside.
import { clamp } from '../core/math';
import { log, note } from './log';
import { emitNoise } from './noise';
import type { Runtime } from './runtime';
import type { GameState, Player } from './types';

export const BORED_CUTS = [0.25, 0.5, 0.75, 0.9];
export const UNHAPPY_CUTS = [0.25, 0.5, 0.75, 0.9];

export function level(v: number, cuts: number[]): number {
  let l = 0;
  for (let i = 0; i < cuts.length; i++) if (v >= cuts[i]) l = i + 1;
  return l;
}

/** How much longer chores take (crafting, building, searching, barricading...). */
export function workMult(p: Player): number {
  return 1 + [0, 0.1, 0.2, 0.4, 0.6][level(p.needs.unhappy ?? 0, UNHAPPY_CUTS)];
}

/** Skill experience multiplier: a wandering mind learns little. */
export function learnMult(p: Player): number {
  const n = p.needs;
  const bored = 1 - Math.max(0, (n.boredom ?? 0) - 0.5) * 0.8;
  const sad = 1 - (n.unhappy ?? 0) * 0.7;
  return Math.max(0.2, bored * sad);
}

/**
 * Doing the same thing for fun gets old: each repeat within about a day counts for less. Returns the
 * multiplier for this activity and records the use.
 */
export function useFun(p: Player, kind: string): number {
  p.funUsed ??= {};
  const used = p.funUsed[kind] ?? 0;
  p.funUsed[kind] = used + 1;
  return 1 / (1 + used * 0.7);
}

/** Apply some relief (positive) or misery (negative) to boredom and unhappiness. */
export function cheer(p: Player, boredom: number, unhappy: number): void {
  const n = p.needs;
  n.boredom = clamp((n.boredom ?? 0) - boredom, 0, 1);
  n.unhappy = clamp((n.unhappy ?? 0) - unhappy, 0, 1);
}

const RESTLESS = [
  'You pace the room, muttering to yourself.',
  'You drum on the furniture just to hear something.',
  'You kick the wall in frustration.',
  'You catch yourself talking out loud to nobody.',
];

export function updateMood(s: GameState, rt: Runtime, hours: number): void {
  const p = s.player;
  if (p.dead || hours <= 0) return;
  const n = p.needs;
  n.boredom ??= 0;
  n.unhappy ??= 0;
  // repeated amusements recover over about a day
  if (p.funUsed) for (const k of Object.keys(p.funUsed)) {
    p.funUsed[k] = Math.max(0, p.funUsed[k] - hours / 24);
    if (p.funUsed[k] <= 0) delete p.funUsed[k];
  }
  if (p.sleeping) {
    // a decent night's sleep lifts the mood a little
    if (p.sleepQuality > 0.7) n.unhappy = clamp(n.unhappy - hours * 0.008, 0, 1);
    return;
  }
  const w = s.world;
  const i = Math.floor(p.y) * w.w + Math.floor(p.x);
  const car = p.inVehicle >= 0 ? s.vehicles[p.inVehicle] : null;
  const driving = !!car && Math.abs(car.speed) > 3;
  const indoors = (w.room[i] >= 0 && p.inVehicle < 0) || (!!car && !driving);
  const busy = !!rt.action && !rt.action.fun;

  // ---- boredom
  let db: number;
  if (rt.threat > 0) db = -0.15; // nothing like the dead nearby to keep you awake
  else if (driving) db = -0.06;
  else if (indoors) db = busy ? 0.012 : 0.03;
  else db = busy ? -0.08 : -0.05;
  if (rt.action?.fun) db = Math.min(db, 0);
  n.boredom = clamp(n.boredom + db * hours, 0, 1);

  // ---- unhappiness follows lasting boredom, and eases when life is bearable
  let du = 0;
  if (n.boredom > 0.4) du += (n.boredom - 0.4) * 0.05;
  else if (n.boredom < 0.3) du -= 0.015;
  if (n.wet > 0.5 && !indoors) du += 0.004;
  n.unhappy = clamp(n.unhappy + du * hours, 0, 1);

  // ---- restlessness: noise the dead can hear
  if (indoors && !busy && rt.threat === 0 && n.boredom >= 0.75 && rt.rng.chance(hours * (n.boredom - 0.6) * 1.6)) {
    const k = rt.rng.int(0, RESTLESS.length - 1);
    log(s, RESTLESS[k], 'warn');
    emitNoise(s, rt, { x: p.x, y: p.y, radius: k === 2 ? 10 : 6, kind: k === 2 ? 'thud' : 'mutter', src: 'player' });
    note(s, 'bored');
  }
  if (!busy && rt.threat === 0 && n.unhappy >= 0.75 && rt.rng.chance(hours * (n.unhappy - 0.6) * 1.2)) {
    log(s, 'You break down and sob into your hands.', 'warn');
    emitNoise(s, rt, { x: p.x, y: p.y, radius: 5, kind: 'sob', src: 'player' });
    note(s, 'bored');
  }
}
