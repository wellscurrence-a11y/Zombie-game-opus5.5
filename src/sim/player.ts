// Survivor movement: walking, sneaking, running, stamina and footstep noise.
import { angleDiff, clamp, turnToward } from '../core/math';
import { G, S } from '../world/world';
import { addXp, lvl } from './skills';
import { emitNoise } from './noise';
import type { Runtime } from './runtime';
import { encumbranceLevel, hasFracture, legFactor, vigor } from './stats';
import { hasTrait } from './traits';
import type { GameState } from './types';
import { moveCircle } from './worldq';
import { log, note } from './log';

export interface Controls {
  moveX: number;
  moveY: number;
  run: boolean;
  aimX: number;
  aimY: number;
  aimValid: boolean;
  attack: boolean;
  attackHeld: boolean;
  attackReleased: boolean;
  shove: boolean;
}

export const PLAYER_R = 0.27;

export function canRun(s: GameState): string | null {
  const p = s.player;
  if (hasFracture(p, ['lLeg', 'rLeg', 'lFoot', 'rFoot'])) return 'You can\'t run on a broken leg.';
  if (encumbranceLevel(p) >= 3) return 'You\'re carrying far too much to run.';
  if (p.needs.endurance < 0.04) return 'You\'re too exhausted to run.';
  if (p.carrying >= 0) return 'You can\'t run while carrying furniture.';
  return null;
}

export function moveSpeed(s: GameState, running: boolean): number {
  const p = s.player;
  const t = p.traits;
  let sp = p.stance === 'crouch' ? 0.95 + lvl(p, 'sneaking') * 0.03 : 1.6;
  if (running) sp = hasTrait(t, 'athletic') ? 3.75 : hasTrait(t, 'unfit') ? 3.0 : 3.4;
  sp *= 0.5 + 0.5 * legFactor(p);
  sp *= [1, 0.86, 0.7, 0.48][encumbranceLevel(p)];
  sp *= clamp(0.55 + vigor(p) * 0.45, 0.4, 1);
  if (p.carrying >= 0) sp *= 0.55;
  return sp;
}

export function updatePlayerMovement(s: GameState, rt: Runtime, c: Controls, dt: number): void {
  const p = s.player;
  const n = p.needs;
  const w = s.world;
  if (p.dead || p.sleeping || p.inVehicle >= 0) {
    p.vx = 0;
    p.vy = 0;
    return;
  }
  if (p.downT > 0) {
    p.downT -= dt;
    p.vx = 0;
    p.vy = 0;
    return;
  }
  let mx = c.moveX;
  let my = c.moveY;
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }
  const moving = mag > 0.05;
  const busy = rt.action !== null;
  let running = c.run && moving && !busy;
  if (running) {
    const why = canRun(s);
    if (why) {
      running = false;
      if (rt.realTime % 3 < dt) log(s, why, 'warn');
    } else if (p.stance === 'crouch') p.stance = 'stand';
  }
  p.running = running;

  // facing: toward the cursor, or the direction of travel when running
  let want = p.facing;
  if (running) want = Math.atan2(my, mx);
  else if (c.aimValid && Math.hypot(c.aimX - p.x, c.aimY - p.y) > 0.3) want = Math.atan2(c.aimY - p.y, c.aimX - p.x);
  else if (moving) want = Math.atan2(my, mx);
  p.facing = turnToward(p.facing, want, dt * (running ? 8 : 11));

  let sp = moveSpeed(s, running);
  if (moving && !running) {
    const off = Math.abs(angleDiff(p.facing, Math.atan2(my, mx)));
    if (off > 2.1) sp *= 0.6;
    else if (off > 1.1) sp *= 0.82;
  }
  const ti = Math.floor(p.y) * w.w + Math.floor(p.x);
  const gr = w.ground[ti];
  if (w.struct[ti] === S.Bush) sp *= 0.62;
  else if (gr === G.TallGrass) sp *= 0.9;
  else if (gr === G.Furrow) sp *= 0.85;
  if (p.grabbedBy.length > 0 || p.attackT > 0 && p.attackDur > 0.9 || p.climbT > 0) sp = 0;
  if (busy && rt.action && !rt.action.cancelOnMove) sp *= 0.5;

  const tvx = moving ? mx * sp * Math.min(1, mag) : 0;
  const tvy = moving ? my * sp * Math.min(1, mag) : 0;
  const acc = Math.min(1, dt * 12);
  p.vx += (tvx - p.vx) * acc;
  p.vy += (tvy - p.vy) * acc;
  if (Math.abs(p.vx) < 0.01) p.vx = 0;
  if (Math.abs(p.vy) < 0.01) p.vy = 0;
  const ox = p.x;
  const oy = p.y;
  if (p.vx || p.vy) moveCircle(s, p, p.vx * dt, p.vy * dt, PLAYER_R);
  const moved = Math.hypot(p.x - ox, p.y - oy);
  s.stats.distance += moved;

  // ---- stamina
  const fit = lvl(p, 'fitness');
  const encL = encumbranceLevel(p);
  if (running && moved > 0) {
    let drain = 0.0105 * (1 + encL * 0.4) / (0.7 + fit * 0.06);
    if (hasTrait(p.traits, 'athletic')) drain *= 0.8;
    if (hasTrait(p.traits, 'unfit')) drain *= 1.3;
    n.endurance -= drain * dt;
    n.fatigue += drain * dt * 0.05;
    addXp(p, 'fitness', dt * 0.9);
    if (n.endurance < 0.3) note(s, 'running');
  } else {
    let rec = moving ? 0.011 : 0.022;
    if (p.stance === 'crouch' && moving) rec *= 0.8;
    rec *= [1, 0.75, 0.5, 0.3][encL];
    if (n.hunger > 0.6) rec *= 0.7;
    if (n.thirst > 0.6) rec *= 0.7;
    if (n.fatigue > 0.75) rec *= 0.6;
    if (n.panic > 0.6) rec *= 0.7;
    rec *= 0.8 + fit * 0.04;
    n.endurance += rec * dt;
  }
  if (moving && encL >= 1) {
    n.endurance -= 0.002 * encL * dt;
    addXp(p, 'strength', dt * 0.3 * encL);
    if (encL >= 2) note(s, 'encumbered');
  }
  const maxEnd = 1 - Math.max(0, n.fatigue - 0.6) * 1.1;
  n.endurance = clamp(n.endurance, 0, Math.max(0.25, maxEnd));

  // ---- footsteps
  if (moved > 0.001) {
    const interval = running ? 0.32 : p.stance === 'crouch' ? 0.7 : 0.5;
    p.stepNoiseT += dt;
    if (p.stepNoiseT >= interval) {
      p.stepNoiseT = 0;
      let r = running ? 8.5 : p.stance === 'crouch' ? 1.4 - lvl(p, 'sneaking') * 0.08 : 3.2;
      const hard = gr === G.FloorWood || gr === G.FloorTile || gr === G.FloorLino || gr === G.FloorConcrete;
      if (hard && p.worn.feet?.id === 'boots') r += 0.5;
      if (gr === G.FloorWood) r += 0.3;
      if (hasTrait(p.traits, 'clumsy')) r *= 1.3;
      if (hasTrait(p.traits, 'graceful')) r *= 0.72;
      r += encL * 0.6;
      if (w.decal[ti] & 2) {
        r += 4;
        if (rt.rng.chance(0.3)) log(s, 'Glass crunches under your feet.', 'sound');
      }
      emitNoise(s, rt, { x: p.x, y: p.y, radius: r, kind: running ? 'run' : 'step', src: 'player' });
      if (p.stance === 'crouch' && rt.closestZombie < 12) addXp(p, 'sneaking', 1.2);
    }
  }
}
