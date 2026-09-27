// Interacting with the world: doors, windows, fences, containers, furniture, beds, sinks and lights.
import { clamp } from '../core/math';
import { FURN, furnTiles } from '../world/furniture';
import { S, G, WIN_BROKEN, WIN_CLEARED, WIN_CLOSED, WIN_OPEN, type Door, type Furniture, type Win } from '../world/world';
import { addInjury } from './body';
import { def, hasTool, makeItem } from './items';
import { carried, consume, countItem, ensureCorpseLoot, ensureLoot, useCharge } from './inventory';
import { chronicle, log, note } from './log';
import { emitNoise } from './noise';
import { PLAYER_R } from './player';
import { zombiesNear } from './runtime';
import { addXp, lvl } from './skills';
import { encumbranceLevel, heldItem, legFactor, vigor } from './stats';
import { breakWindow, doorName, PLANK_HP, triggerAlarm } from './structures';
import { hasTrait } from './traits';
import type { GameState } from './types';
import { drinkFromSource, fillContainers, startAction, type Ctx } from './use';
import { collides } from './worldq';
import { buildingPowered } from './lighting';
import { vehicleActions } from './vehicles';
import { furnitureUtilityActions, groundActions, treeActions } from './world-actions';

export interface Option {
  label: string;
  run: () => void;
  enabled?: boolean;
  reason?: string;
}

export const REACH = 1.25;

/** Distance from the player to the closest point of tile (x, y). */
export function tileDist(s: GameState, x: number, y: number): number {
  const p = s.player;
  const cx = Math.max(x, Math.min(p.x, x + 1));
  const cy = Math.max(y, Math.min(p.y, y + 1));
  return Math.hypot(p.x - cx, p.y - cy);
}

export function furnDist(s: GameState, f: Furniture): number {
  let d = 99;
  for (const [x, y] of furnTiles(f.kind, f.x, f.y, f.rot)) d = Math.min(d, tileDist(s, x, y));
  return d;
}

function playerInside(s: GameState, bld: number): boolean {
  const w = s.world;
  const i = Math.floor(s.player.y) * w.w + Math.floor(s.player.x);
  return w.room[i] >= 0 && w.bld[i] === bld;
}

function hasKey(s: GameState, keyId: number): boolean {
  return carried(s).some((i) => i.keyId === keyId);
}

function quietFactor(s: GameState): number {
  const p = s.player;
  let k = p.stance === 'crouch' ? 0.6 : 1;
  if (hasTrait(p.traits, 'graceful')) k *= 0.8;
  if (hasTrait(p.traits, 'clumsy')) k *= 1.3;
  return k;
}

// ================================================================== doors

function garageGroup(s: GameState, d: Door): Door[] {
  const w = s.world;
  if (d.kind !== 'garage') return [d];
  const out = [d];
  for (const dx of [-1, 1]) {
    for (let k = 1; k < 4; k++) {
      const nx = d.vertical ? d.x : d.x + dx * k;
      const ny = d.vertical ? d.y + dx * k : d.y;
      const i = ny * w.w + nx;
      if (w.struct[i] !== S.Door) break;
      const o = w.doors[w.structRef[i]];
      if (o.kind !== 'garage' || o.bld !== d.bld) break;
      out.push(o);
    }
  }
  return out;
}

export function toggleDoor(c: Ctx, d: Door): void {
  const s = c.s;
  const rt = c.rt;
  const w = s.world;
  if (d.planks > 0) {
    log(s, `The ${doorName(d)} is barricaded.`, 'info');
    return;
  }
  if (d.broken) {
    log(s, 'The door is broken off its hinges.', 'info');
    return;
  }
  const group = garageGroup(s, d);
  if (d.open) {
    // don't close on yourself
    const pi = Math.floor(s.player.y) * w.w + Math.floor(s.player.x);
    if (group.some((g) => g.y * w.w + g.x === pi)) return;
    for (const g of group) g.open = false;
    emitNoise(s, rt, { x: d.x + 0.5, y: d.y + 0.5, radius: (d.kind === 'garage' ? 9 : d.kind === 'metal' ? 4.5 : 3.5) * quietFactor(s), kind: 'door', src: 'player' });
  } else {
    if (d.locked) {
      d.lockKnown = true;
      if (playerInside(s, d.bld) || !d.ext || d.kind === 'built') {
        for (const g of group) g.locked = false;
        log(s, `You unlock the ${doorName(d)}.`, 'info');
      } else if (hasKey(s, d.keyId)) {
        for (const g of group) g.locked = false;
        log(s, 'You unlock it with your key.', 'good');
      } else {
        log(s, `Locked. You'll need a key${d.kind === 'glass' ? ' — or break the glass' : ', a crowbar, or another way in'}.`, 'warn');
        emitNoise(s, rt, { x: d.x + 0.5, y: d.y + 0.5, radius: 2, kind: 'rattle', src: 'player' });
        return;
      }
    }
    for (const g of group) {
      g.open = true;
      g.lockKnown = true;
    }
    const running = s.player.running;
    emitNoise(s, rt, { x: d.x + 0.5, y: d.y + 0.5, radius: (d.kind === 'garage' ? 10 : running ? 6.5 : d.kind === 'metal' ? 4.5 : 3.5) * quietFactor(s), kind: 'door', src: 'player' });
  }
  w.rev.doors++;
  rt.fovDirty = true;
  rt.lightDirty = true;
}

export function setDoorLock(c: Ctx, d: Door, lock: boolean): void {
  const s = c.s;
  if (d.open) {
    log(s, 'Close it first.', 'info');
    return;
  }
  if (!playerInside(s, d.bld) && d.ext && d.kind !== 'built' && !hasKey(s, d.keyId)) {
    log(s, 'You need the key to do that from outside.', 'warn');
    return;
  }
  for (const g of garageGroup(s, d)) {
    g.locked = lock;
    g.lockKnown = true;
  }
  emitNoise(s, c.rt, { x: d.x + 0.5, y: d.y + 0.5, radius: 1.5, kind: 'lock', src: 'player' });
  log(s, lock ? 'Locked.' : 'Unlocked.', 'info');
}

function listen(c: Ctx, x: number, y: number, vertical: boolean): void {
  const s = c.s;
  startAction(c, {
    label: 'Listening', dur: 2.5, cancelOnMove: true, anim: 'none',
    onDone: () => {
      const p = s.player;
      // the far side of the door from the player
      const fx = vertical ? x + 0.5 + Math.sign(x + 0.5 - p.x) * 3 : x + 0.5;
      const fy = vertical ? y + 0.5 : y + 0.5 + Math.sign(y + 0.5 - p.y) * 3;
      const n = zombiesNear(s, c.rt, fx, fy, 5.5, []).filter((z) => z.hp > 0).length;
      const keen = hasTrait(p.traits, 'keenHearing');
      const est = n === 0 ? 'Silence on the other side.' : n === 1 ? 'Shuffling footsteps. One of them, you think.' : n <= 3 ? (keen ? `Several of them — ${n}, maybe.` : 'Shuffling and low groans. More than one.') : 'Lots of movement. Too many to count.';
      log(s, est, n === 0 ? 'good' : 'warn');
    },
  });
}

function pryDoor(c: Ctx, d: Door): void {
  const s = c.s;
  const bar = hasTool(carried(s), 'crowbar');
  if (!bar) return;
  startAction(c, {
    label: 'Prying the door open', dur: 7 / clamp(vigor(s.player), 0.4, 1), cancelOnMove: true, anim: 'work',
    noise: { radius: 9, every: 1.8, acc: 0, kind: 'pry' },
    onDone: () => {
      d.locked = false;
      d.lockKnown = true;
      d.hp = Math.max(10, d.hp - 30);
      d.open = true;
      s.world.rev.doors++;
      c.rt.fovDirty = true;
      log(s, 'The lock gives with a crack.', 'info');
      if (d.ext) triggerAlarm(s, c.rt, d.bld, 'forced door');
      bar.cond = Math.max(0.05, bar.cond - 0.01);
      addXp(s.player, 'strength', 3);
    },
  });
}

export function barricadeOptions(c: Ctx, target: Door | Win, isDoor: boolean): Option[] {
  const s = c.s;
  const out: Option[] = [];
  const hammer = hasTool(carried(s), 'hammer');
  const planks = countItem(s, 'plank');
  const nails = countItem(s, 'nails');
  const carp = lvl(s.player, 'carpentry');
  if (target.planks < 4) {
    let reason: string | undefined;
    if (!hammer) reason = 'Need a hammer';
    else if (planks < 1) reason = 'Need a plank';
    else if (nails < 2) reason = 'Need 2 nails';
    else if (isDoor && (target as Door).open) reason = 'Close the door first';
    out.push({
      label: `Barricade (${target.planks}/4 planks)`, enabled: !reason, reason,
      run: () => startAction(c, {
        label: 'Nailing a plank', dur: 5.5 * (1 - carp * 0.06), cancelOnMove: true, anim: 'hammer',
        noise: { radius: 14, every: 1.1, acc: 0.8, kind: 'hammer' },
        onDone: () => {
          if (!consume(s, 'plank', 1) || !consume(s, 'nails', 2)) return;
          target.planks++;
          target.barricadeHp += PLANK_HP * (1 + carp * 0.06);
          s.world.rev.doors++;
          s.world.rev.windows++;
          c.rt.fovDirty = true;
          c.rt.lightDirty = true;
          addXp(s.player, 'carpentry', 8);
          log(s, 'Plank nailed in place.', 'good');
        },
      }),
    });
  }
  if (target.planks > 0) {
    const tool = hammer ?? hasTool(carried(s), 'crowbar');
    out.push({
      label: 'Remove a plank', enabled: !!tool, reason: tool ? undefined : 'Need a hammer or crowbar',
      run: () => startAction(c, {
        label: 'Prying off a plank', dur: 4, cancelOnMove: true, anim: 'work',
        noise: { radius: 8, every: 1.5, acc: 0, kind: 'pry' },
        onDone: () => {
          target.planks = Math.max(0, target.planks - 1);
          target.barricadeHp = Math.min(target.barricadeHp, target.planks * PLANK_HP * 1.3);
          if (c.rt.rng.chance(0.7)) s.player.inventory.push(makeItem(s, 'plank'));
          s.world.rev.doors++;
          c.rt.fovDirty = true;
        },
      }),
    });
  }
  return out;
}

export function doorOptions(c: Ctx, d: Door): Option[] {
  const s = c.s;
  const out: Option[] = [];
  const inside = playerInside(s, d.bld) || !d.ext || d.kind === 'built';
  if (!d.broken) out.push({ label: d.open ? 'Close' : 'Open', run: () => toggleDoor(c, d) });
  if (!d.open && !d.broken && d.kind !== 'garage' && d.kind !== 'gate') {
    if (inside || hasKey(s, d.keyId)) out.push({ label: d.locked ? 'Unlock' : 'Lock', run: () => setDoorLock(c, d, !d.locked) });
    else out.push({ label: d.lockKnown ? (d.locked ? 'Locked' : 'Unlocked') : 'Check if locked', enabled: !d.lockKnown, run: () => toggleDoor(c, d) });
  }
  if (!d.open) {
    out.push({ label: 'Listen at the door', run: () => listen(c, d.x, d.y, d.vertical) });
    out.push({ label: 'Knock (attract attention)', run: () => {
      emitNoise(s, c.rt, { x: d.x + 0.5, y: d.y + 0.5, radius: 8, kind: 'knock', src: 'player' });
      log(s, 'You knock loudly.', 'info');
    } });
  }
  if (!d.open && d.locked && !inside && d.planks === 0 && d.kind !== 'cell') {
    const bar = hasTool(carried(s), 'crowbar');
    out.push({ label: 'Pry open (crowbar)', enabled: !!bar, reason: bar ? undefined : 'Need a crowbar', run: () => pryDoor(c, d) });
  }
  if (d.kind !== 'garage') out.push(...barricadeOptions(c, d, true));
  return out;
}

// ================================================================== windows

function clothingGuard(s: GameState, parts: string[]): number {
  let g = 0;
  for (const it of Object.values(s.player.worn)) {
    if (!it) continue;
    const cl = def(it.id).clothing;
    if (cl && cl.covers.some((p) => parts.includes(p))) g = Math.max(g, cl.scratch);
  }
  return g;
}

export function smashWindow(c: Ctx, win: Win): void {
  const s = c.s;
  const rt = c.rt;
  const held = heldItem(s.player);
  const weapon = held && def(held.id).weapon;
  startAction(c, {
    label: 'Smashing the window', dur: 0.8, cancelOnMove: true, anim: 'work',
    onDone: () => {
      breakWindow(s, rt, win, 'player');
      chronicle(s, 'Broke a window to get in.', 2);
      if (!weapon) {
        const guard = clothingGuard(s, ['lArm', 'rArm', 'lHand', 'rHand']);
        if (rt.rng.chance(0.55 * (1 - guard))) {
          const inj = addInjury(s, rt, rt.rng.chance(0.5) ? 'rHand' : 'rArm', 'cut', rt.rng.range(0.3, 0.65), 'punched through a window');
          if (rt.rng.chance(0.4)) inj.glass = true;
          log(s, 'Glass bites into your arm as it gives way.', 'danger');
        }
      }
    },
  });
}

export function climbOptions(c: Ctx, x: number, y: number, kind: 'window' | 'fence' | 'highfence', vertical: boolean | null): Option {
  return { label: kind === 'window' ? 'Climb through' : kind === 'fence' ? 'Vault over' : 'Climb over', run: () => startClimb(c, x, y, kind, vertical) };
}

/** Begin climbing over/through the obstacle at tile (x, y). */
export function startClimb(c: Ctx, x: number, y: number, kind: 'window' | 'fence' | 'highfence', verticalHint: boolean | null): void {
  const s = c.s;
  const p = s.player;
  const w = s.world;
  if (p.carrying >= 0) {
    log(s, 'Not while carrying furniture.', 'warn');
    return;
  }
  const enc = encumbranceLevel(p);
  if (kind === 'highfence') {
    if (enc >= 3) {
      log(s, 'You\'re carrying far too much to climb that.', 'warn');
      return;
    }
    if (p.needs.endurance < 0.12) {
      log(s, 'You don\'t have the strength left to climb.', 'warn');
      return;
    }
    if (p.body.injuries.some((i) => i.type === 'fracture' && (i.part === 'lArm' || i.part === 'rArm') && i.heal < 0.9)) {
      log(s, 'You can\'t climb with a broken arm.', 'warn');
      return;
    }
  }
  // decide which way to cross
  let vertical = verticalHint;
  if (vertical === null) {
    const dx = x + 0.5 - p.x;
    const dy = y + 0.5 - p.y;
    vertical = Math.abs(dx) > Math.abs(dy);
  }
  const dir = vertical ? Math.sign(x + 0.5 - p.x) || 1 : Math.sign(y + 0.5 - p.y) || 1;
  const tx = vertical ? x + 0.5 + dir : x + 0.5;
  const ty = vertical ? y + 0.5 : y + 0.5 + dir;
  const fromX = vertical ? x + 0.5 - dir * 0.75 : x + 0.5;
  const fromY = vertical ? y + 0.5 : y + 0.5 - dir * 0.75;
  if (collides(s, tx, ty, PLAYER_R, { passTile: y * w.w + x })) {
    log(s, 'There\'s no room on the other side.', 'warn');
    return;
  }
  const base = kind === 'fence' ? 0.8 : kind === 'window' ? 1.5 : 2.4;
  const dur = base * (1 + enc * 0.35) / (0.6 + 0.4 * legFactor(p));
  p.climbT = dur;
  p.climbDur = dur;
  p.climbFrom = [fromX, fromY];
  p.climbTo = [tx, ty];
  p.climbKind = kind;
  p.vx = 0;
  p.vy = 0;
  p.facing = Math.atan2(ty - fromY, tx - fromX);
  const cost = kind === 'highfence' ? 0.12 : kind === 'fence' ? 0.03 : 0.04;
  p.needs.endurance = Math.max(0, p.needs.endurance - cost * (1 + enc * 0.3));
  emitNoise(s, c.rt, { x: x + 0.5, y: y + 0.5, radius: (kind === 'highfence' ? 6 : 3.5) * quietFactor(s), kind: 'climb', src: 'player' });
  p.climbTile = y * w.w + x;
}

/** Advance a climb; handles falls and glass cuts at the end. */
export function updateClimb(c: Ctx, dt: number): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  if (p.climbT <= 0) return;
  p.climbT -= dt;
  const k = 1 - Math.max(0, p.climbT) / p.climbDur;
  p.x = p.climbFrom[0] + (p.climbTo[0] - p.climbFrom[0]) * k;
  p.y = p.climbFrom[1] + (p.climbTo[1] - p.climbFrom[1]) * k;
  if (p.climbT > 0) return;
  p.climbT = 0;
  p.x = p.climbTo[0];
  p.y = p.climbTo[1];
  rt.fovDirty = true;
  const n = p.needs;
  const enc = encumbranceLevel(p);
  const kind = p.climbKind;
  const w = s.world;
  const tile = p.climbTile;
  if (kind === 'window' && tile >= 0 && w.struct[tile] === S.Window) {
    const win = w.windows[w.structRef[tile]];
    if (win.state === WIN_BROKEN) {
      const guard = clothingGuard(s, ['lHand', 'rHand', 'lArm', 'rArm', 'torso']);
      if (rt.rng.chance(0.65 * (1 - guard * 0.8))) {
        const part = rt.rng.weighted([['lHand', 3], ['rHand', 3], ['lArm', 2], ['rArm', 2], ['torso', 1], ['lLeg', 1]] as const);
        const inj = addInjury(s, rt, part, rt.rng.chance(0.25) ? 'deep' : 'cut', rt.rng.range(0.3, 0.7), 'climbed through broken glass');
        if (rt.rng.chance(0.45)) inj.glass = true;
        log(s, 'Jagged glass slices into you as you climb through.', 'danger');
        note(s, 'glass');
      }
    }
  }
  let fall = 0;
  if (kind === 'fence' || kind === 'highfence') {
    fall = (kind === 'fence' ? 0.02 : 0.06) + enc * (kind === 'fence' ? 0.07 : 0.11);
    if (n.endurance < 0.3) fall += 0.12;
    if (n.fatigue > 0.8) fall += 0.08;
    if (hasTrait(p.traits, 'clumsy')) fall += 0.08;
    if (hasTrait(p.traits, 'graceful')) fall -= 0.04;
    fall -= lvl(p, 'fitness') * 0.004;
    fall += (1 - legFactor(p)) * 0.3;
    if (n.drunk > 0.3) fall += 0.15;
  } else if (kind === 'window') {
    fall = enc >= 2 ? 0.06 * enc : 0;
  }
  if (rt.rng.chance(Math.max(0, fall))) {
    p.downT = kind === 'highfence' ? 2.4 : 1.6;
    emitNoise(s, rt, { x: p.x, y: p.y, radius: 7, kind: 'fall', src: 'player' });
    log(s, kind === 'window' ? 'You tumble through and land hard.' : 'Your foot catches and you fall hard.', 'danger');
    const r = rt.rng.next();
    if (kind === 'highfence' && r < 0.05) addInjury(s, rt, rt.rng.chance(0.5) ? 'lArm' : 'rLeg', 'fracture', 0.8, 'fell from a fence');
    else if (r < 0.3) addInjury(s, rt, rt.rng.chance(0.5) ? 'lFoot' : 'rFoot', 'sprain', rt.rng.range(0.4, 0.8), 'landed badly after a fall');
    else if (r < 0.8) addInjury(s, rt, rt.rng.pick(['torso', 'lLeg', 'rLeg', 'head'] as const), 'bruise', 0.4, 'fell');
    chronicle(s, `Fell while climbing a ${kind === 'window' ? 'window' : 'fence'}${n.endurance < 0.3 ? ' while exhausted' : enc >= 2 ? ' under a heavy load' : ''}.`, 3);
    note(s, 'fence');
  } else if (kind !== 'window') addXp(p, 'fitness', 2);
}

export function windowOptions(c: Ctx, win: Win): Option[] {
  const s = c.s;
  const out: Option[] = [];
  const inside = playerInside(s, win.bld);
  if (win.planks === 0) {
    if (win.state === WIN_CLOSED && !win.big) {
      out.push({ label: 'Open window', run: () => startAction(c, {
        label: 'Opening the window', dur: 1.6, cancelOnMove: true, anim: 'use',
        onDone: () => {
          if (c.rt.rng.chance(0.15) && !inside) {
            log(s, 'It\'s latched from the inside.', 'warn');
            return;
          }
          win.state = WIN_OPEN;
          s.world.rev.doors++;
          c.rt.fovDirty = true;
          emitNoise(s, c.rt, { x: win.x + 0.5, y: win.y + 0.5, radius: 3 * quietFactor(s), kind: 'window', src: 'player' });
        },
      }) });
    }
    if (win.state === WIN_OPEN) out.push({ label: 'Close window', run: () => {
      win.state = WIN_CLOSED;
      s.world.rev.doors++;
      emitNoise(s, c.rt, { x: win.x + 0.5, y: win.y + 0.5, radius: 3 * quietFactor(s), kind: 'window', src: 'player' });
    } });
    if (win.state === WIN_OPEN || win.state === WIN_BROKEN || win.state === WIN_CLEARED) {
      out.push(climbOptions(c, win.x, win.y, 'window', win.vertical));
    }
    if (win.state === WIN_CLOSED || win.state === WIN_OPEN) out.push({ label: 'Smash the glass', run: () => smashWindow(c, win) });
    if (win.state === WIN_BROKEN) {
      const held = heldItem(s.player);
      const tool = (held && def(held.id).weapon) || s.player.worn.hands;
      out.push({
        label: tool ? 'Clear the broken glass' : 'Clear the glass (bare hands)',
        run: () => startAction(c, {
          label: 'Knocking out the glass', dur: 3, cancelOnMove: true, anim: 'work',
          noise: { radius: 5, every: 1, acc: 0, kind: 'glass' },
          onDone: () => {
            win.state = WIN_CLEARED;
            s.world.rev.doors++;
            if (!tool && c.rt.rng.chance(0.4)) addInjury(s, c.rt, c.rt.rng.chance(0.5) ? 'lHand' : 'rHand', 'cut', 0.3, 'cleared glass bare-handed');
            log(s, 'The frame is clear.', 'good');
          },
        }),
      });
    }
  }
  if (inside && (win.curtains || win.sheet)) {
    if (win.curtains) out.push({ label: win.curtainsClosed ? 'Open curtains' : 'Close curtains', run: () => {
      win.curtainsClosed = !win.curtainsClosed;
      s.world.rev.doors++;
      c.rt.fovDirty = true;
      c.rt.lightDirty = true;
    } });
    if (win.sheet) out.push({ label: 'Take down sheet', run: () => {
      win.sheet = false;
      s.player.inventory.push(makeItem(s, 'sheet'));
      s.world.rev.doors++;
      c.rt.fovDirty = true;
      c.rt.lightDirty = true;
    } });
  }
  if (inside && !win.curtains && !win.sheet) {
    const has = countItem(s, 'sheet') > 0;
    out.push({ label: 'Hang a sheet as a curtain', enabled: has, reason: has ? undefined : 'Need a bed sheet', run: () => {
      if (!consume(s, 'sheet', 1)) return;
      win.sheet = true;
      s.world.rev.doors++;
      c.rt.fovDirty = true;
      c.rt.lightDirty = true;
      log(s, 'No one will see in — or see your light.', 'good');
    } });
  }
  out.push(...barricadeOptions(c, win, false));
  return out;
}

// ================================================================== containers & furniture

export function searchTime(c: Ctx, cap: number): number {
  const quick = c.rt.searchMode === 'quick';
  return (1.2 + cap * 0.06) * (quick ? 0.45 : 1.3);
}

export function openContainer(c: Ctx, cid: number, onOpen: () => void): void {
  const s = c.s;
  const rt = c.rt;
  const cont = s.world.containers[cid];
  if (cont.searched) {
    ensureLoot(s, cid);
    onOpen();
    return;
  }
  const quick = rt.searchMode === 'quick';
  startAction(c, {
    label: `Searching ${quick ? 'quickly' : 'carefully'}`, dur: searchTime(c, cont.capacity), cancelOnMove: true, anim: 'search',
    noise: { radius: quick ? 5.5 : 1.8, every: 1.2, acc: 0, kind: 'search' },
    onDone: () => {
      cont.searched = true;
      ensureLoot(s, cid);
      if (quick && rt.rng.chance(0.12)) {
        emitNoise(s, rt, { x: s.player.x, y: s.player.y, radius: 11, kind: 'clatter', src: 'player' });
        log(s, 'You knock something over with a clatter!', 'danger');
        chronicle(s, 'Made a racket searching in a hurry.', 2);
        note(s, 'greed');
      }
      onOpen();
    },
  });
}

export function openCorpse(c: Ctx, id: number, onOpen: () => void): void {
  const s = c.s;
  const corpse = s.corpses.find((k) => k.id === id);
  if (!corpse) return;
  if (corpse.items) {
    onOpen();
    return;
  }
  startAction(c, {
    label: 'Searching the body', dur: 2.5, cancelOnMove: true, anim: 'search',
    onDone: () => {
      ensureCorpseLoot(s, corpse);
      s.player.needs.stress = clamp(s.player.needs.stress + 0.03, 0, 1);
      onOpen();
    },
  });
}

export function sleepQuality(kind: string | null): number {
  switch (kind) {
    case 'bed2':
      return 1;
    case 'bed':
      return 0.9;
    case 'medbed':
      return 0.8;
    case 'bunk':
      return 0.7;
    case 'couch':
      return 0.6;
    case 'sleepbag':
      return 0.6;
    case 'car':
      return 0.35;
    default:
      return 0.35;
  }
}

export function trySleep(c: Ctx, where: string | null): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const n = p.needs;
  if (n.fatigue < 0.3) {
    log(s, 'You\'re not tired enough to sleep.', 'info');
    return;
  }
  if (rt.threat > 0 || rt.closestZombie < 8) {
    log(s, 'Not with them this close.', 'warn');
    return;
  }
  if (n.panic > 0.45) {
    log(s, 'You\'re too wired to sleep.', 'warn');
    return;
  }
  let q = sleepQuality(where);
  q *= 1 - Math.min(0.6, (p.body.injuries.length ? 0.1 : 0) + n.stress * 0.3);
  if (n.hunger > 0.7 || n.thirst > 0.7) q *= 0.7;
  p.sleeping = true;
  p.sleepQuality = q;
  p.vx = p.vy = 0;
  rt.action = null;
  rt.wakeReason = '';
  // was it safe?
  const w = s.world;
  const pi = Math.floor(p.y) * w.w + Math.floor(p.x);
  const bld = w.bld[pi];
  let unsafe = bld < 0 && p.inVehicle < 0;
  if (bld >= 0) {
    const b = w.buildings[bld];
    for (const di of b.doors) {
      const d = w.doors[di];
      if (d.ext && (d.open || d.broken || !d.locked) && d.planks === 0) unsafe = true;
    }
    for (const wi of b.windows) {
      const win = w.windows[wi];
      if (win.planks === 0 && win.state !== WIN_CLOSED) unsafe = true;
    }
  }
  if (unsafe) {
    chronicle(s, 'Went to sleep somewhere that wasn\'t secured.', 2);
    note(s, 'sleep');
  }
  log(s, `You lie down and sleep${where === null ? ' on the floor' : ''}.`, 'info');
}

export function toggleRoomLight(c: Ctx): void {
  const s = c.s;
  const w = s.world;
  const p = s.player;
  const ri = w.room[Math.floor(p.y) * w.w + Math.floor(p.x)];
  if (ri < 0) {
    log(s, 'There\'s no light switch out here.', 'info');
    return;
  }
  const room = w.rooms[ri];
  if (!buildingPowered(s, room.bld)) {
    log(s, 'You flick the switch. Nothing. The power\'s out.', 'warn');
    note(s, 'utilities');
    return;
  }
  room.light = !room.light;
  c.rt.lightDirty = true;
  c.rt.fovDirty = true;
  emitNoise(s, c.rt, { x: p.x, y: p.y, radius: 1, kind: 'switch', src: 'player' });
  if (room.light) {
    log(s, 'The lights flicker on.', 'info');
    note(s, 'light');
  }
}

function waterSource(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const def0 = FURN[f.kind];
  const out: Option[] = [];
  if (def0.sink) {
    if (!s.util.waterOff) {
      out.push({ label: 'Drink from the tap', run: () => drinkFromSource(c, 'water', 'Drinking from the tap') });
      out.push({ label: 'Fill water containers', run: () => fillContainers(c, 'water', 'Filling from the tap') });
    } else {
      f.water ??= c.rt.rng.range(0, 1.2);
      if ((f.water ?? 0) > 0.05) {
        out.push({ label: `Drain the last water from the pipes (${f.water.toFixed(1)} L)`, run: () => {
          const before = f.water ?? 0;
          fillContainers(c, 'water', 'Draining the pipes', before);
          f.water = 0;
        } });
      } else out.push({ label: 'The taps are dry', enabled: false, run: () => {} });
    }
  }
  if (def0.toilet) {
    f.water ??= 4;
    if ((f.water ?? 0) > 0.1) {
      out.push({ label: `Drink from the toilet tank (untreated)`, run: () => {
        f.water = Math.max(0, (f.water ?? 0) - 0.5);
        drinkFromSource(c, 'tainted', 'Drinking tank water');
      } });
      out.push({ label: `Fill from the toilet tank (${f.water.toFixed(1)} L, untreated)`, run: () => {
        const got = f.water ?? 0;
        fillContainers(c, 'tainted', 'Filling from the tank', got);
        f.water = 0;
      } });
    }
  }
  return out;
}

export function furnitureOptions(c: Ctx, f: Furniture, openLoot: (cid: number) => void): Option[] {
  const s = c.s;
  const p = s.player;
  const out: Option[] = [];
  const fd = FURN[f.kind];
  if (f.containerId >= 0) {
    const cont = s.world.containers[f.containerId];
    out.push({ label: cont.searched ? `Open ${fd.name.toLowerCase()}` : `Search ${fd.name.toLowerCase()}`, run: () => openContainer(c, f.containerId, () => openLoot(f.containerId)) });
  }
  if (fd.bed) {
    out.push({ label: 'Sleep', enabled: p.needs.fatigue >= 0.3, reason: p.needs.fatigue < 0.3 ? 'Not tired' : undefined, run: () => trySleep(c, f.kind) });
  }
  out.push(...waterSource(c, f));
  if (f.kind === 'lamptable') out.push({ label: 'Switch the lights', run: () => toggleRoomLight(c) });
  out.push(...furnitureUtilityActions(c, f));
  if (fd.weight > 0 && p.carrying < 0) {
    const items = f.containerId >= 0 ? ensureLootMaybe(s, f.containerId) : 0;
    const heavy = fd.weight > 30 && lvl(p, 'strength') < 4;
    out.push({
      label: `Pick up ${fd.name.toLowerCase()} (${fd.weight} kg)`, enabled: items === 0 && !heavy,
      reason: items > 0 ? 'Empty it first' : heavy ? 'Too heavy for you' : undefined,
      run: () => pickUpFurniture(c, f),
    });
  }
  return out;
}

function ensureLootMaybe(s: GameState, cid: number): number {
  const c = s.world.containers[cid];
  if (!c.items) return c.searched ? 0 : 1;
  return c.items.length;
}

export function pickUpFurniture(c: Ctx, f: Furniture): void {
  const s = c.s;
  const w = s.world;
  startAction(c, {
    label: `Lifting ${FURN[f.kind].name.toLowerCase()}`, dur: 2, cancelOnMove: true, anim: 'work',
    onDone: () => {
      for (const [x, y] of furnTiles(f.kind, f.x, f.y, f.rot)) if (w.furn[y * w.w + x] === f.id) w.furn[y * w.w + x] = -1;
      f.gone = true;
      s.player.carrying = f.id;
      w.rev.furn++;
      c.rt.fovDirty = true;
      emitNoise(s, c.rt, { x: s.player.x, y: s.player.y, radius: 4, kind: 'scrape', src: 'player' });
      log(s, 'You heave it up. Click a spot to set it down (R to rotate is not needed — it faces you).', 'info');
    },
  });
}

/** Try to place carried furniture at tile (x, y). */
export function placeFurniture(c: Ctx, x: number, y: number): boolean {
  const s = c.s;
  const w = s.world;
  const p = s.player;
  const f = w.furniture[p.carrying];
  if (!f) return false;
  if (tileDist(s, x, y) > 1.6) {
    log(s, 'Too far away.', 'warn');
    return false;
  }
  // face toward the player
  const dx = p.x - (x + 0.5);
  const dy = p.y - (y + 0.5);
  const rot = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : dy > 0 ? 0 : 2;
  for (const [tx, ty] of furnTiles(f.kind, x, y, rot)) {
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return false;
    const i = ty * w.w + tx;
    if (w.struct[i] !== S.None || w.furn[i] >= 0 || w.ground[i] === G.Water) {
      log(s, 'It won\'t fit there.', 'warn');
      return false;
    }
    if (Math.floor(p.x) === tx && Math.floor(p.y) === ty) {
      log(s, 'You\'re standing there.', 'warn');
      return false;
    }
  }
  f.x = x;
  f.y = y;
  f.rot = rot;
  f.gone = false;
  f.bld = w.bld[y * w.w + x];
  for (const [tx, ty] of furnTiles(f.kind, x, y, rot)) w.furn[ty * w.w + tx] = f.id;
  p.carrying = -1;
  w.rev.furn++;
  c.rt.fovDirty = true;
  emitNoise(s, c.rt, { x: x + 0.5, y: y + 0.5, radius: 5, kind: 'thud', src: 'player' });
  return true;
}

// ================================================================== dispatch

export interface Target {
  kind: 'door' | 'window' | 'furn' | 'fence' | 'tree' | 'ground' | 'vehicle' | 'corpse' | 'wall' | 'zombie';
  x: number;
  y: number;
  id: number;
}

export function optionsFor(c: Ctx, t: Target, openLoot: (key: string) => void): { title: string; options: Option[]; far: boolean } {
  const s = c.s;
  const w = s.world;
  const tx = Math.floor(t.x);
  const ty = Math.floor(t.y);
  switch (t.kind) {
    case 'door': {
      const d = w.doors[t.id];
      const far = tileDist(s, tx, ty) > REACH;
      const state = d.broken ? 'broken' : d.open ? 'open' : d.lockKnown ? (d.locked ? 'locked' : 'unlocked') : 'closed';
      return { title: `${doorName(d)[0].toUpperCase()}${doorName(d).slice(1)} (${state}${d.planks ? `, ${d.planks} planks` : ''})`, options: doorOptions(c, d), far };
    }
    case 'window': {
      const win = w.windows[t.id];
      const far = tileDist(s, tx, ty) > REACH;
      const st = win.state === WIN_CLOSED ? 'closed' : win.state === WIN_OPEN ? 'open' : win.state === WIN_BROKEN ? 'broken — glass in the frame' : 'broken, frame cleared';
      return { title: `Window (${st}${win.planks ? `, ${win.planks} planks` : ''})`, options: windowOptions(c, win), far };
    }
    case 'fence': {
      const high = w.struct[ty * w.w + tx] === S.FenceHigh;
      return { title: high ? 'Tall fence' : 'Low fence', options: [climbOptions(c, tx, ty, high ? 'highfence' : 'fence', null)], far: tileDist(s, tx, ty) > REACH };
    }
    case 'furn': {
      const f = w.furniture[t.id];
      return { title: FURN[f.kind].name, options: furnitureOptions(c, f, (cid) => openLoot(`c${cid}`)), far: furnDist(s, f) > REACH };
    }
    case 'tree':
      return { title: 'Tree', options: treeActions(c, tx, ty), far: tileDist(s, tx, ty) > REACH };
    case 'vehicle': {
      const v = s.vehicles[t.id];
      const r = vehicleActions(c, v, openLoot);
      return { title: r.title, options: r.options, far: r.far };
    }
    case 'corpse': {
      const corpse = s.corpses.find((k) => k.id === t.id);
      const far = !corpse || Math.hypot(corpse.x - s.player.x, corpse.y - s.player.y) > 1.6;
      return { title: corpse?.name ?? 'Corpse', options: [{ label: 'Search the body', run: () => openCorpse(c, t.id, () => openLoot(`k${t.id}`)) }], far };
    }
    case 'ground':
    case 'wall':
    default: {
      const far = tileDist(s, tx, ty) > 1.6;
      const opts: Option[] = [];
      const fl = s.floor[ty * w.w + tx];
      if (fl?.length) opts.push({ label: `Look at items on the ground (${fl.length})`, run: () => openLoot(`f${ty * w.w + tx}`) });
      opts.push(...groundActions(c, tx, ty));
      return { title: t.kind === 'wall' ? 'Wall' : groundName(s, tx, ty), options: opts, far };
    }
  }
}

function groundName(s: GameState, x: number, y: number): string {
  const g = s.world.ground[y * s.world.w + x];
  const names: Partial<Record<number, string>> = {
    [G.Grass]: 'Grass', [G.TallGrass]: 'Tall grass', [G.Forest]: 'Forest floor', [G.Road]: 'Road', [G.Sidewalk]: 'Sidewalk', [G.Parking]: 'Asphalt',
    [G.Dirt]: 'Dirt', [G.Furrow]: 'Plowed soil', [G.Water]: 'Water', [G.Sand]: 'Sand', [G.DirtRoad]: 'Dirt road', [G.Gravel]: 'Gravel',
  };
  return names[g] ?? 'Floor';
}

export { useCharge };
