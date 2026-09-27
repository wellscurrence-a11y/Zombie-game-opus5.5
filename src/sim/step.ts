// One tick of the whole simulation, independent of rendering (used by the game and by tests).
import { timeScale } from '../core/time';
import { killPlayer, updateBody } from './body';
import { updateCombat } from './combat';
import { updateClimb } from './interact';
import { computeLights } from './lighting';
import { log } from './log';
import { emitNoise } from './noise';
import type { PathFinder } from './path';
import { updatePlayerMovement, type Controls } from './player';
import { rebuildZGrid, type Runtime } from './runtime';
import { hasTrait } from './traits';
import type { GameState } from './types';
import { updateVehicles, type DriveInput } from './vehicles';
import { updateVision } from './vision';
import { updateWorld } from './world-systems';
import { updateZombies } from './zombies';

export interface SimCtx {
  s: GameState;
  rt: Runtime;
  pf: PathFinder;
  controls: Controls;
  drive: DriveInput;
  onWake?: () => void;
}

export function blankControls(): Controls {
  return { moveX: 0, moveY: 0, run: false, aimX: 0, aimY: 0, aimValid: false, attack: false, attackHeld: false, attackReleased: false, shove: false };
}

export function simStep(c: SimCtx, dt: number, realDt: number, first: boolean, allowInput = true): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const hours = (dt * timeScale(s.settings.dayLength)) / 3600;
  s.time += hours;
  rebuildZGrid(s, rt);
  const heardBefore = rt.heard.length;
  if (!p.dead) {
    if (p.climbT > 0) updateClimb(c, dt);
    else updatePlayerMovement(s, rt, c.controls, dt);
    updateAction(c, dt);
  }
  updateVehicles(s, rt, c.pf, p.inVehicle >= 0 ? c.drive : null, dt);
  updateCombat(s, rt, c.controls, dt, first && allowInput);
  if (!first) {
    c.controls.attack = false;
    c.controls.attackReleased = false;
    c.controls.shove = false;
  }
  updateZombies(s, rt, c.pf, dt);
  updateBody(s, rt, hours, realDt);
  updateWorld(s, rt, dt, hours);
  updateVision(s, rt);
  if (rt.lightDirty) computeLights(s, rt);
  // danger drops time back to normal
  if (rt.speed > 1 && (rt.threat > 0 || rt.closestZombie < 8)) {
    rt.speed = 1;
    log(s, 'You sense movement nearby. Time slows back down.', 'warn');
  }
  if (p.sleeping) sleepChecks(c, heardBefore);
  else if (rt.heard.length > heardBefore && rt.speed > 1) {
    const h = rt.heard[rt.heard.length - 1];
    if (Math.hypot(h.x - p.x, h.y - p.y) < 30) rt.speed = 1;
  }
  if (p.body.health <= 0 && !p.dead) killPlayer(s, rt, 'Succumbed to injuries');
}

function sleepChecks(c: SimCtx, heardBefore: number): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const n = p.needs;
  if (n.fatigue <= 0.02) return wake(c, 'You wake up rested.');
  if (n.hunger > 0.9 || n.thirst > 0.9) return wake(c, 'Hunger and thirst wake you.');
  if (p.grabbedBy.length || p.lastHitT > s.time - 0.01) return wake(c, 'You wake to hands grabbing at you!');
  const light = hasTrait(p.traits, 'lightSleeper');
  const heavy = hasTrait(p.traits, 'heavySleeper');
  for (let k = heardBefore; k < rt.heard.length; k++) {
    const h = rt.heard[k];
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    const threshold = light ? 1.6 : heavy ? 0.45 : 1;
    if (d < h.loud * threshold) return wake(c, `${h.label} wakes you.`);
  }
  if (rt.wakeReason) return wake(c, rt.wakeReason);
  if (rt.closestZombie < (light ? 6 : heavy ? 1.5 : 3)) return wake(c, 'Something shuffles right next to you. You jolt awake.');
}

export function wake(c: SimCtx, reason: string): void {
  const p = c.s.player;
  if (!p.sleeping) return;
  p.sleeping = false;
  c.rt.wakeReason = '';
  c.rt.speed = 1;
  log(c.s, reason, reason.includes('rested') ? 'good' : 'warn');
  c.onWake?.();
}

function updateAction(c: SimCtx, dt: number): void {
  const rt = c.rt;
  const s = c.s;
  const a = rt.action;
  if (!a) return;
  const moving = Math.hypot(c.controls.moveX, c.controls.moveY) > 0.1;
  if (a.cancelOnMove && moving) {
    a.onCancel?.();
    rt.action = null;
    return;
  }
  if (s.player.grabbedBy.length || s.player.downT > 0) {
    a.onCancel?.();
    rt.action = null;
    return;
  }
  a.t += dt;
  a.onTick?.(dt);
  if (a.noise) {
    a.noise.acc += dt;
    if (a.noise.acc >= a.noise.every) {
      a.noise.acc = 0;
      emitNoise(s, rt, { x: s.player.x, y: s.player.y, radius: a.noise.radius, kind: a.noise.kind, src: 'player' });
    }
  }
  const done = a.gameHours ? s.time - (a.startT ?? s.time) >= a.gameHours : a.t >= a.dur;
  if (done) {
    rt.action = null;
    a.onDone();
  }
}

export function actionProgress(s: GameState, rt: Runtime): number {
  const a = rt.action;
  if (!a) return 0;
  if (a.gameHours) return Math.min(1, (s.time - (a.startT ?? s.time)) / a.gameHours);
  return Math.min(1, a.t / a.dur);
}
