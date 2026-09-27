// Doors, windows, barricades and alarms.
import { S, G, WIN_BROKEN, WIN_CLOSED, type Door, type Win } from '../world/world';
import { timeScale } from '../core/time';
import { chronicle, log, note } from './log';
import { emitNoise } from './noise';
import type { Runtime } from './runtime';
import type { GameState } from './types';

export const PLANK_HP = 45;

/** Game hours equivalent of `sec` real seconds. */
export function realToGame(s: GameState, sec: number): number {
  return (sec * timeScale(s.settings.dayLength)) / 3600;
}

export function alarmArmed(s: GameState, bld: number): boolean {
  const b = s.world.buildings[bld];
  if (!b || !b.alarm) return false;
  // battery backup keeps alarms alive for a day after the grid fails
  if (s.util.powerOff && s.time > s.util.powerOffAt + 24) return false;
  return true;
}

export function triggerAlarm(s: GameState, rt: Runtime, bld: number, why: string): void {
  if (!alarmArmed(s, bld)) return;
  const b = s.world.buildings[bld];
  if (b.alarmUntil > s.time) return;
  b.alarmUntil = s.time + realToGame(s, 100);
  b.alarm = false; // it only goes off once
  const p = s.player;
  const d = Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.y0 + b.y1) / 2 - p.y);
  if (d < 20) {
    log(s, `An alarm starts screaming! (${why})`, 'danger');
    chronicle(s, `Set off the alarm at ${b.name === 'House' ? b.address : b.name}.`, 4);
    note(s, 'alarm');
  }
}

export function doorName(d: Door): string {
  return d.kind === 'garage' ? 'garage door' : d.kind === 'glass' ? 'glass door' : d.kind === 'metal' ? 'metal door' : d.kind === 'cell' ? 'cell door' : d.kind === 'gate' ? 'gate' : 'door';
}

function nearPlayer(s: GameState, x: number, y: number, r: number): boolean {
  return Math.hypot(s.player.x - x, s.player.y - y) < r;
}

/** Zombies (or the player) hitting a door/window/built wall at tile i. */
export function damageObstacle(s: GameState, rt: Runtime, i: number, dmg: number, byZombie: boolean): void {
  const w = s.world;
  const st = w.struct[i];
  const x = i % w.w;
  const y = Math.floor(i / w.w);
  if (st === S.Door) {
    const d = w.doors[w.structRef[i]];
    if (d.planks > 0) {
      d.barricadeHp -= dmg;
      const before = d.planks;
      d.planks = Math.max(0, Math.ceil(d.barricadeHp / PLANK_HP));
      if (d.planks < before) {
        w.rev.doors++;
        if (nearPlayer(s, x, y, 25)) log(s, d.planks === 0 ? 'The door barricade gives way!' : 'A plank cracks loose from the door barricade.', 'danger');
      }
      return;
    }
    if (d.open || d.broken) return;
    if (!d.locked && byZombie && d.kind !== 'garage' && rt.rng.chance(0.2)) {
      d.open = true;
      w.rev.doors++;
      rt.fovDirty = true;
      if (nearPlayer(s, x, y, 30)) {
        log(s, 'A door bursts open — it wasn\'t locked.', 'danger');
        chronicle(s, 'The dead forced open an unlocked door.', 3);
        note(s, 'unlocked');
      }
      emitNoise(s, rt, { x: x + 0.5, y: y + 0.5, radius: 8, kind: 'door', src: 'zombie', label: 'A door slams open' });
      return;
    }
    d.hp -= dmg;
    if (d.hp <= 0) {
      d.broken = true;
      d.open = true;
      d.locked = false;
      w.rev.doors++;
      rt.fovDirty = true;
      emitNoise(s, rt, { x: x + 0.5, y: y + 0.5, radius: 12, kind: 'break', src: byZombie ? 'zombie' : 'player', label: 'Wood splinters as a door gives way' });
      if (nearPlayer(s, x, y, 30)) log(s, `A ${doorName(d)} splinters and gives way!`, 'danger');
      if (d.ext && byZombie === false) triggerAlarm(s, rt, d.bld, 'forced door');
      if (d.ext && byZombie) triggerAlarm(s, rt, d.bld, 'forced door');
    }
    return;
  }
  if (st === S.Window) {
    const win = w.windows[w.structRef[i]];
    if (win.planks > 0) {
      win.barricadeHp -= dmg;
      const before = win.planks;
      win.planks = Math.max(0, Math.ceil(win.barricadeHp / PLANK_HP));
      if (win.planks < before) {
        w.rev.windows++;
        w.rev.doors++;
        rt.fovDirty = true;
        if (nearPlayer(s, x, y, 25)) log(s, win.planks === 0 ? 'A window barricade is torn away!' : 'A plank splinters on a boarded window.', 'danger');
      }
      return;
    }
    if (win.state === WIN_CLOSED) breakWindow(s, rt, win, byZombie ? 'zombie' : 'player');
    return;
  }
  if (st === S.BuiltWall) {
    const bw = w.builtWalls[i];
    if (!bw) {
      w.struct[i] = S.None;
      return;
    }
    bw.hp -= dmg;
    if (bw.hp <= 0) {
      delete w.builtWalls[i];
      w.struct[i] = S.None;
      w.ground[i] = G.Rubble;
      w.rev.walls++;
      w.rev.ground++;
      rt.fovDirty = true;
      emitNoise(s, rt, { x: x + 0.5, y: y + 0.5, radius: 12, kind: 'break', src: 'zombie', label: 'Timber cracks and collapses' });
      if (nearPlayer(s, x, y, 30)) log(s, 'One of your walls collapses!', 'danger');
    }
  }
}

export function breakWindow(s: GameState, rt: Runtime, win: Win, by: 'zombie' | 'player' | 'world'): void {
  const w = s.world;
  win.state = WIN_BROKEN;
  win.curtainsClosed = false;
  w.rev.doors++;
  rt.fovDirty = true;
  const x = win.x;
  const y = win.y;
  // glass scatters on both sides
  const sides = win.vertical ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
  for (const [sx, sy] of sides) {
    if (sx >= 0 && sy >= 0 && sx < w.w && sy < w.h) w.decal[sy * w.w + sx] |= 2;
  }
  w.rev.ground++;
  rt.effects.push({ kind: 'glass', x: x + 0.5, y: y + 0.5, t: rt.realTime, dur: 0.6 });
  emitNoise(s, rt, { x: x + 0.5, y: y + 0.5, radius: 15, kind: 'glass', src: by === 'player' ? 'player' : 'zombie', label: 'Glass shatters' });
  if (by === 'player') note(s, 'window');
  triggerAlarm(s, rt, win.bld, 'broken window');
}

/** Tile index of the inside of a door/window (room side) and the outside, if any. */
export function sidesOf(w: GameState['world'], x: number, y: number, vertical: boolean): [number, number][] {
  return vertical ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
}
