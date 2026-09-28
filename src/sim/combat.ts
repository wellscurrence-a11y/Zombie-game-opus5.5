// Melee, shoving, stomping, firearms — and what happens when they reach you.
import { angleDiff, clamp } from '../core/math';
import { S, WIN_CLOSED } from '../world/world';
import { addInjury, killPlayer, PART_NAMES } from './body';
import { def, itemName, makeItem, type BodyPart, type Item } from './items';
import { chronicle, log, note } from './log';
import { emitNoise } from './noise';
import type { Controls } from './player';
import type { Runtime } from './runtime';
import { zombiesNear } from './runtime';
import { addXp, lvl } from './skills';
import { handFactor, heldItem, vigor } from './stats';
import { breakWindow, damageObstacle } from './structures';
import { hasTrait } from './traits';
import type { GameState, Vehicle, Zombie } from './types';
import { blocksSight, collides, reachClear } from './worldq';
import { vehClosest } from './vehicleSpecs';
import { zombieDies } from './zombies';

const tmp: Zombie[] = [];

function collidesAt(s: GameState, x: number, y: number, ignoreVehicle: number): boolean {
  return collides(s, x, y, 0.27, { ignoreVehicle });
}

// ------------------------------------------------------------------ zombies hurting the survivor

function clothingProtection(s: GameState, part: BodyPart, kind: 'scratch' | 'bite'): { chance: number; item: Item | null } {
  let pass = 1;
  let best: Item | null = null;
  let bestV = 0;
  for (const it of Object.values(s.player.worn)) {
    if (!it) continue;
    const c = def(it.id).clothing;
    if (!c || !c.covers.includes(part)) continue;
    const v = (kind === 'bite' ? c.bite : c.scratch) * (0.4 + 0.6 * it.cond);
    pass *= 1 - v;
    if (v > bestV) {
      bestV = v;
      best = it;
    }
  }
  return { chance: 1 - pass, item: best };
}

function pickPart(rt: Runtime, behind: boolean, grabbed: boolean, crawler: boolean): BodyPart {
  if (crawler) return rt.rng.weighted<BodyPart>([['lFoot', 3], ['rFoot', 3], ['lLeg', 3], ['rLeg', 3], ['lHand', 1], ['rHand', 1]]);
  return rt.rng.weighted<BodyPart>([
    ['lHand', 3], ['rHand', 3], ['lArm', 4], ['rArm', 4], ['torso', 3], ['neck', grabbed || behind ? 4 : 1.1], ['head', 1.1], ['lLeg', 0.6], ['rLeg', 0.6],
  ]);
}

export function zombieAttack(s: GameState, rt: Runtime, z: Zombie, throughWindow = false, reach = 1): void {
  const p = s.player;
  const n = p.needs;
  const rng = rt.rng;
  if (p.dead) return;
  const toZ = Math.atan2(z.y - p.y, z.x - p.x);
  const off = Math.abs(angleDiff(p.facing, toZ));
  const behind = off > 1.9 && p.inVehicle < 0;
  const grabbed = p.grabbedBy.length > 0;
  const crowd = zombiesNear(s, rt, p.x, p.y, 1.6, tmp).filter((o) => o.state !== 'down' && o.hp > 0).length;
  let hit = 0.46 + (behind ? 0.25 : 0) + (1 - n.endurance) * 0.28 + n.panic * 0.1 + (grabbed ? 0.3 : 0) + Math.max(0, crowd - 1) * 0.07;
  hit += p.downT > 0 ? 0.45 : 0;
  hit -= (lvl(p, 'fitness') - 5) * 0.02;
  if (n.fatigue > 0.8) hit += 0.08;
  if (rt.action) hit += 0.15;
  if (p.attackT > 0) hit += 0.05;
  if (z.crawler) hit -= 0.12;
  if (throughWindow) hit *= 0.6 * reach;
  if (!rng.chance(clamp(hit, 0.08, 0.96))) {
    if (rng.chance(0.3)) log(s, 'Fingers claw at you and slip away.', 'warn');
    n.panic = clamp(n.panic + 0.05, 0, 1);
    return;
  }
  if (rt.action) {
    log(s, `You're interrupted: ${rt.action.label.toLowerCase()}.`, 'danger');
    rt.action.onCancel?.();
    rt.action = null;
  }
  if (throughWindow) {
    // two sets of hands on you and the car standing still: out you come
    const v = s.vehicles[p.inVehicle];
    if (v && p.grabbedBy.includes(z.id) && p.grabbedBy.length >= 2 && Math.abs(v.speed) < 1 && rng.chance(0.25 + (1 - n.endurance) * 0.2)) {
      dragOutOfCar(s, rt, z, v);
      return;
    }
  }
  let outcome: 'grab' | 'scratch' | 'cut' | 'bite';
  if (grabbed && throughWindow && !p.grabbedBy.includes(z.id) && rng.chance(0.4)) {
    outcome = 'grab';
  } else if (grabbed) {
    outcome = rng.weighted([['bite', p.grabbedBy.includes(z.id) ? 0.55 : 0.45], ['cut', 0.25], ['scratch', 0.2]] as const);
  } else {
    outcome = rng.weighted([
      ['grab', 0.34 + (behind ? 0.1 : 0) + (1 - n.endurance) * 0.12],
      ['scratch', 0.36],
      ['cut', 0.2],
      ['bite', 0.1 + (behind ? 0.08 : 0)],
    ] as const);
  }
  if (throughWindow && outcome === 'grab') {
    if (!p.grabbedBy.includes(z.id)) p.grabbedBy.push(z.id);
    z.grabbing = true;
    n.panic = clamp(n.panic + 0.3, 0, 1);
    log(s, 'A hand reaches through the broken window and grabs you! Drive off to break free.', 'danger');
    chronicle(s, 'Grabbed through a broken car window.', 3);
    note(s, 'carSurrounded');
    return;
  }
  if (outcome === 'grab' && p.inVehicle < 0) {
    p.grabbedBy.push(z.id);
    z.grabbing = true;
    n.panic = clamp(n.panic + 0.3, 0, 1);
    log(s, z.crawler ? 'It grabs your ankle!' : 'It grabs hold of you! (Space to shove free)', 'danger');
    chronicle(s, behind ? 'Grabbed from behind.' : 'Grabbed by a zombie.', 3);
    note(s, 'grabbed');
    if (crowd >= 3 && (behind || n.endurance < 0.3) && rng.chance(0.25)) {
      p.downT = 1.8;
      log(s, 'You\'re dragged to the ground!', 'danger');
      chronicle(s, 'Dragged to the ground by the crowd.', 5);
    }
    return;
  }
  if (outcome === 'grab') outcome = 'scratch';
  const part = pickPart(rt, behind, grabbed, z.crawler);
  const prot = clothingProtection(s, part, outcome === 'bite' ? 'bite' : 'scratch');
  if (prot.item && rng.chance(prot.chance)) {
    prot.item.cond = Math.max(0, prot.item.cond - (outcome === 'bite' ? 0.08 : 0.04));
    log(s, `${outcome === 'bite' ? 'Teeth' : 'Nails'} catch on your ${def(prot.item.id).name.toLowerCase()} — it holds.`, 'warn');
    n.panic = clamp(n.panic + 0.08, 0, 1);
    return;
  }
  if (outcome === 'scratch' && hasTrait(p.traits, 'thickSkinned') && rng.chance(0.35)) {
    log(s, 'Nails rake across you but don\'t break the skin.', 'warn');
    return;
  }
  if (outcome === 'scratch' && hasTrait(p.traits, 'thinSkinned') && rng.chance(0.3)) outcome = 'cut';
  if (outcome === 'bite') {
    addInjury(s, rt, part, 'bite', rng.range(0.5, 0.95), 'bitten by a zombie');
    const b = p.body;
    if (!b.fever && (part === 'neck' || rng.chance(0.85))) {
      b.fever = true;
      b.feverT = s.time;
    }
    log(s, `It bites into your ${PART_NAMES[part]}!`, 'danger');
    note(s, 'bite');
    if (part === 'neck' && rng.chance(0.35)) {
      p.body.health -= 40;
      p.body.blood -= 0.25;
      log(s, 'Teeth tear into your throat.', 'danger');
    }
  } else if (outcome === 'cut') {
    addInjury(s, rt, part, 'cut', rng.range(0.35, 0.7), 'clawed by a zombie');
    log(s, `It tears a gash in your ${PART_NAMES[part]}.`, 'danger');
  } else {
    addInjury(s, rt, part, 'scratch', rng.range(0.2, 0.45), 'scratched by a zombie');
    log(s, `It scratches your ${PART_NAMES[part]}.`, 'danger');
  }
  if (n.endurance < 0.25) note(s, 'exhaustion');
  if (crowd >= 3) note(s, 'crowd');
  if (p.downT > 0 && crowd >= 3 && rng.chance(0.3)) killPlayer(s, rt, 'Pulled down and devoured by the dead');
}

/** Which window a zombie at (x,y) is beating on: 0 windshield, 1 driver, 2 passenger, 3 rear. */
export function windowFacing(v: Vehicle, x: number, y: number): number {
  const c = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  const dx = x - v.x;
  const dy = y - v.y;
  const lx = dx * c + dy * sn;
  const ly = -dx * sn + dy * c;
  return Math.abs(lx) > Math.abs(ly) * 1.6 ? (lx > 0 ? 0 : 3) : ly < 0 ? 1 : 2;
}

export function zombieAttackVehicle(s: GameState, rt: Runtime, z: Zombie, v: Vehicle): void {
  const rng = rt.rng;
  const k = windowFacing(v, z.x, z.y);
  const inside = s.player.inVehicle === v.id;
  emitNoise(s, rt, { x: z.x, y: z.y, radius: 6, kind: 'bang', src: 'zombie' });
  if (v.windows[k] < 2 && rng.chance(0.2)) {
    v.windows[k]++;
    if (v.windows[k] === 2) {
      emitNoise(s, rt, { x: z.x, y: z.y, radius: 10, kind: 'glass', src: 'zombie', label: 'Car glass shatters' });
      if (inside) {
        log(s, k === 3 ? 'The rear window shatters!' : 'A car window shatters! They can reach you now.', 'danger');
        note(s, 'carSurrounded');
      }
    } else if (inside && rng.chance(0.5)) log(s, 'The glass cracks under their fists.', 'warn');
    return;
  }
  // through broken glass they reach in: the driver's window and windshield are closest, the passenger side is a stretch
  if (inside && v.windows[k] >= 2 && k !== 3) zombieAttack(s, rt, z, true, k === 2 ? 0.5 : 1);
}

/** Enough hands through the glass and they pull the survivor out onto the road. */
function dragOutOfCar(s: GameState, rt: Runtime, z: Zombie, v: Vehicle): void {
  const p = s.player;
  const a = Math.atan2(z.y - v.y, z.x - v.x);
  let x = z.x - Math.cos(a) * 0.45;
  let y = z.y - Math.sin(a) * 0.45;
  for (let r = 0; r < 2 && collidesAt(s, x, y, v.id); r += 0.25) {
    x = z.x + Math.cos(a) * r;
    y = z.y + Math.sin(a) * r;
  }
  p.inVehicle = -1;
  p.x = x;
  p.y = y;
  p.vx = p.vy = 0;
  p.facing = a;
  p.downT = 1.6;
  v.horn = false;
  rt.exitPending = false;
  rt.fovDirty = true;
  if (rt.rng.chance(0.6)) addInjury(s, rt, rt.rng.pick(['lArm', 'rArm', 'torso'] as const), 'cut', rt.rng.range(0.25, 0.5), 'dragged through broken glass');
  log(s, 'They drag you out through the window!', 'danger');
  chronicle(s, 'Dragged out of the car through a broken window.', 5);
  note(s, 'carSurrounded');
}

// ------------------------------------------------------------------ survivor attacks

export function weaponOf(s: GameState): { item: Item | null; stats: NonNullable<ReturnType<typeof def>['weapon']> | null } {
  const it = heldItem(s.player);
  if (!it) return { item: null, stats: null };
  const d = def(it.id);
  return { item: it, stats: d.weapon ?? null };
}

export function swingTime(s: GameState): number {
  const p = s.player;
  const { stats } = weaponOf(s);
  let t = stats ? stats.swing : 0.55;
  const skill = stats ? lvl(p, stats.skill) : 0;
  t /= 0.9 + skill * 0.025;
  if (p.needs.endurance < 0.5) t *= 1 + (0.5 - p.needs.endurance) * 1.4;
  t /= 0.6 + 0.4 * handFactor(p);
  if (stats && def(heldItem(p)!.id).weight > 1.5) t *= 1 + Math.max(0, def(heldItem(p)!.id).weight - lvl(p, 'strength') * 0.45) * 0.08;
  if (p.needs.fatigue > 0.8) t *= 1.15;
  if (stats?.twoHanded && brokenArm(s)) t *= 2;
  return t;
}

export function brokenArm(s: GameState): boolean {
  return s.player.body.injuries.some((i) => i.type === 'fracture' && (i.part === 'lArm' || i.part === 'rArm') && !i.splinted && i.heal < 0.9)
    || s.player.body.injuries.some((i) => i.type === 'fracture' && (i.part === 'lArm' || i.part === 'rArm') && i.heal < 0.6);
}

function stomTarget(s: GameState, rt: Runtime): Zombie | null {
  const p = s.player;
  let best: Zombie | null = null;
  let bd = 1.15;
  for (const z of zombiesNear(s, rt, p.x, p.y, 1.3, tmp)) {
    if (z.state !== 'down' && !z.crawler) continue;
    const d = Math.hypot(z.x - p.x, z.y - p.y);
    const off = Math.abs(angleDiff(p.facing, Math.atan2(z.y - p.y, z.x - p.x)));
    if (off < 1.0 && d < bd) {
      bd = d;
      best = z;
    }
  }
  return best;
}

let stompPending: number | null = null;

export function startMelee(s: GameState, rt: Runtime): void {
  const p = s.player;
  if (p.attackT > 0 || p.shoveT > 0 || p.grabbedBy.length || p.downT > 0 || p.climbT > 0) return;
  const { stats } = weaponOf(s);
  const ground = stomTarget(s, rt);
  if (!stats && !ground) {
    playerShove(s, rt);
    return;
  }
  const t = ground && !stats ? 0.55 : swingTime(s);
  p.attackT = t;
  p.attackDur = t;
  p.attackHit = false;
  stompPending = ground ? ground.id : null;
  const cost = (stats ? stats.stam : 0.025) * (1.3 - lvl(p, 'fitness') * 0.04);
  p.needs.endurance = Math.max(0, p.needs.endurance - cost);
  p.needs.fatigue += cost * 0.04;
  if (rt.action) {
    rt.action.onCancel?.();
    rt.action = null;
  }
}

function resolveMelee(s: GameState, rt: Runtime): void {
  const p = s.player;
  const rng = rt.rng;
  const { item, stats } = weaponOf(s);
  const str = lvl(p, 'strength');
  const vig = vigor(p);
  const hf = handFactor(p);
  const panic = p.needs.calm > 0 ? p.needs.panic * 0.4 : p.needs.panic;
  // ---- ground strike / stomp
  if (stompPending !== null) {
    const z = s.zombies.find((zz) => zz.id === stompPending);
    stompPending = null;
    if (z && z.hp > 0 && Math.hypot(z.x - p.x, z.y - p.y) < 1.4 && reachClear(s.world, p.x, p.y, z.x, z.y)) {
      const base = stats ? stats.dmg * 1.5 : 0.85 + str * 0.06;
      const crit = rng.chance((stats ? stats.crit + 0.2 : 0.3) + (stats ? lvl(p, stats.skill) * 0.02 : 0));
      const dmg = base * (0.7 + 0.3 * vig) * (crit ? 2.3 : 1) * rng.range(0.85, 1.15);
      hitZombie(s, rt, z, dmg, 0, crit, true);
      emitNoise(s, rt, { x: z.x, y: z.y, radius: stats ? stats.noise : 5, kind: 'hit', src: 'player' });
      if (item && stats) wearWeapon(s, rt, item, stats.dur);
      addXp(p, stats ? stats.skill : 'strength', 3);
      return;
    }
  }
  const reach = (stats ? stats.reach : 0.9) + 0.25;
  const arc = stats?.stab ? 0.6 : 0.95;
  const maxTargets = stats ? stats.arc : 1;
  const cands = zombiesNear(s, rt, p.x, p.y, reach + 0.3, tmp)
    .filter((z) => z.hp > 0 && z.state !== 'climb')
    .map((z) => ({ z, d: Math.hypot(z.x - p.x, z.y - p.y), off: Math.abs(angleDiff(p.facing, Math.atan2(z.y - p.y, z.x - p.x))) }))
    .filter((c) => c.d <= reach && c.off <= arc && reachClear(s.world, p.x, p.y, c.z.x, c.z.y))
    .sort((a, b) => a.d - b.d)
    .slice(0, maxTargets);
  if (!cands.length) {
    // swinging at a door, window or barricade
    const fx = Math.floor(p.x + Math.cos(p.facing) * 0.9);
    const fy = Math.floor(p.y + Math.sin(p.facing) * 0.9);
    const w = s.world;
    if (fx >= 0 && fy >= 0 && fx < w.w && fy < w.h && stats) {
      const i = fy * w.w + fx;
      const st = w.struct[i];
      if (st === S.Window) {
        const win = w.windows[w.structRef[i]];
        if (win.planks === 0 && win.state === WIN_CLOSED) {
          breakWindow(s, rt, win, 'player');
          log(s, 'You smash the window.', 'warn');
          if (item) wearWeapon(s, rt, item, stats.dur);
          return;
        }
      }
      if (st === S.Door || st === S.Window || st === S.BuiltWall) {
        damageObstacle(s, rt, i, stats.dmg * (4 + str * 0.5), false);
        emitNoise(s, rt, { x: fx + 0.5, y: fy + 0.5, radius: 11, kind: 'bang', src: 'player' });
        if (item) wearWeapon(s, rt, item, stats.dur * 0.6);
        return;
      }
    }
    return;
  }
  for (const c of cands) {
    const z = c.z;
    // a zombie that hasn't noticed you, struck from behind, is a sitting target
    const unaware = (z.state === 'idle' || z.state === 'wander' || z.state === 'eat') && z.awareness < 0.6;
    const behindIt = Math.abs(angleDiff(z.facing, Math.atan2(z.y - p.y, z.x - p.x))) < 1.2;
    let chance = 0.9 - panic * 0.25 - (1 - hf) * 0.4 + (stats ? lvl(p, stats.skill) * 0.02 : 0) - (p.needs.endurance < 0.2 ? 0.2 : 0);
    if (z.state === 'down' || z.state === 'stagger') chance += 0.1;
    if (unaware) chance += 0.1;
    if (p.needs.drunk > 0.3) chance -= 0.1;
    if (!rng.chance(clamp(chance, 0.2, 0.97))) {
      if (rng.chance(0.4)) log(s, 'You miss.', 'warn');
      continue;
    }
    const skill = stats ? lvl(p, stats.skill) : 0;
    let dmg = (stats ? stats.dmg : 0.25) * (0.7 + str * 0.06) * (0.55 + 0.45 * vig) * hf * (0.85 + skill * 0.03) * rng.range(0.8, 1.2);
    if (stats?.twoHanded && brokenArm(s)) dmg *= 0.45;
    const sneak = unaware ? (behindIt ? 0.45 : 0.2) : 0;
    const crit = rng.chance((stats ? stats.crit : 0.05) + skill * 0.02 - panic * 0.05 + sneak);
    if (sneak && crit && stats) addXp(p, 'sneaking', 2);
    if (crit) dmg *= 2.2;
    const knock = (stats ? stats.knock : 0.4) * (0.6 + str * 0.06) * (0.5 + 0.5 * vig);
    hitZombie(s, rt, z, dmg, knock, crit, false);
    emitNoise(s, rt, { x: z.x, y: z.y, radius: stats ? stats.noise : 4, kind: 'hit', src: 'player' });
    if (item && stats) {
      if (wearWeapon(s, rt, item, stats.dur)) break;
    }
    addXp(p, stats ? stats.skill : 'strength', 4);
    if (stats && def(item!.id).weight > 1.5) addXp(p, 'strength', 1.5);
    addXp(p, 'fitness', 1);
  }
}

/** Returns true if the weapon broke. */
function wearWeapon(s: GameState, rt: Runtime, item: Item, dur: number): boolean {
  const p = s.player;
  const skill = lvl(p, def(item.id).weapon?.skill ?? 'blunt');
  item.cond -= (1 / dur) * rt.rng.range(0.5, 1.5) * (1 - skill * 0.03);
  if (item.cond <= 0) {
    const name = itemName(item);
    p.inventory = p.inventory.filter((i) => i.uid !== item.uid);
    if (p.primary === item.uid) p.primary = 0;
    log(s, `Your ${name.toLowerCase()} breaks!`, 'danger');
    chronicle(s, `${name} broke mid-fight.`, 3);
    note(s, 'weapon');
    return true;
  }
  if (item.cond < 0.2 && rt.rng.chance(0.1)) log(s, `Your ${itemName(item).toLowerCase()} is about to break.`, 'warn');
  return false;
}

export function hitZombie(s: GameState, rt: Runtime, z: Zombie, dmg: number, knock: number, crit: boolean, ground: boolean): void {
  const p = s.player;
  const rng = rt.rng;
  z.hp -= dmg;
  rt.effects.push({ kind: 'blood', x: z.x, y: z.y, t: rt.realTime, dur: 0.5 });
  z.awareness = Math.max(z.awareness, 1);
  z.lastSeenX = p.x;
  z.lastSeenY = p.y;
  z.lastSeenT = s.time;
  z.sinceSeen = 0;
  if (z.hp <= 0) {
    releaseGrab(s, z);
    zombieDies(s, rt, z);
    p.kills++;
    if (crit && rng.chance(0.5)) log(s, ground ? 'You crush its skull.' : 'A crushing blow to the head. It drops.', 'good');
    return;
  }
  if (crit && !ground) log(s, 'A solid hit to the head.', 'good');
  if (z.grabbing && dmg > 0.45 && rng.chance(0.55)) releaseGrab(s, z);
  if (z.state === 'down' || z.state === 'climb') return;
  const dx = z.x - p.x;
  const dy = z.y - p.y;
  const dl = Math.hypot(dx, dy) || 1;
  if (rng.chance(knock * 0.55)) {
    releaseGrab(s, z);
    z.state = 'down';
    z.downT = rng.range(2.0, 3.6);
    note(s, 'stomp');
  } else if (rng.chance(0.25 + knock)) {
    releaseGrab(s, z);
    z.state = 'stagger';
    z.staggerT = 0.55 + knock * 0.5;
    z.vx = (dx / dl) * (1.2 + knock * 2);
    z.vy = (dy / dl) * (1.2 + knock * 2);
  }
}

function releaseGrab(s: GameState, z: Zombie): void {
  const p = s.player;
  if (!z.grabbing) return;
  z.grabbing = false;
  p.grabbedBy = p.grabbedBy.filter((id) => id !== z.id);
}

export function playerShove(s: GameState, rt: Runtime): void {
  const p = s.player;
  const rng = rt.rng;
  if (p.shoveT > 0 || p.downT > 0 || p.climbT > 0 || p.inVehicle >= 0) return;
  p.shoveT = 0.55;
  const n = p.needs;
  n.endurance = Math.max(0, n.endurance - 0.035 * (1.2 - lvl(p, 'fitness') * 0.04));
  emitNoise(s, rt, { x: p.x, y: p.y, radius: 3, kind: 'shove', src: 'player' });
  if (rt.action) {
    rt.action.onCancel?.();
    rt.action = null;
  }
  const str = lvl(p, 'strength');
  const grabbers = p.grabbedBy.slice();
  let targets = zombiesNear(s, rt, p.x, p.y, 1.35, tmp)
    .filter((z) => z.hp > 0 && z.state !== 'down' && !z.crawler)
    .filter((z) => grabbers.includes(z.id) || (Math.abs(angleDiff(p.facing, Math.atan2(z.y - p.y, z.x - p.x))) < 1.15 && reachClear(s.world, p.x, p.y, z.x, z.y)))
    .sort((a, b) => (grabbers.includes(b.id) ? 1 : 0) - (grabbers.includes(a.id) ? 1 : 0) || Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  targets = targets.slice(0, 2);
  for (const z of targets) {
    if (z.grabbing) {
      const chance = 0.42 + (str - 5) * 0.05 + n.endurance * 0.3 - (grabbers.length - 1) * 0.15 - n.panic * 0.1;
      if (!rng.chance(clamp(chance, 0.08, 0.9))) {
        log(s, 'You can\'t shake it loose!', 'danger');
        continue;
      }
      releaseGrab(s, z);
      log(s, 'You wrench yourself free.', 'good');
    }
    const dx = z.x - p.x;
    const dy = z.y - p.y;
    const dl = Math.hypot(dx, dy) || 1;
    const force = 0.6 + vigor(p) * 0.4;
    if (rng.chance(clamp(0.22 + (str - 5) * 0.04 + n.endurance * 0.15, 0.05, 0.6))) {
      z.state = 'down';
      z.downT = rng.range(2.2, 3.6);
      note(s, 'stomp');
    } else {
      z.state = 'stagger';
      z.staggerT = 0.7;
      z.vx = (dx / dl) * 2.3 * force;
      z.vy = (dy / dl) * 2.3 * force;
    }
    z.attackT = 0;
    z.awareness = Math.max(1, z.awareness);
  }
  addXp(p, 'strength', 1);
}

// ------------------------------------------------------------------ firearms

export function fireWeapon(s: GameState, rt: Runtime, aimX: number, aimY: number): void {
  const p = s.player;
  const rng = rt.rng;
  const gun = heldItem(p);
  if (!gun) return;
  const f = def(gun.id).firearm;
  if (!f || p.attackT > 0 || p.reloadT > 0) return;
  if ((gun.ammo ?? 0) <= 0) {
    log(s, 'Click. Empty. (R to reload)', 'warn');
    emitNoise(s, rt, { x: p.x, y: p.y, radius: 1.5, kind: 'click', src: 'player' });
    p.attackT = 0.3;
    p.attackDur = 0.3;
    p.attackHit = true;
    return;
  }
  gun.ammo = (gun.ammo ?? 1) - 1;
  p.attackT = f.rate;
  p.attackDur = f.rate;
  p.attackHit = true;
  const aimK = clamp(p.aimT / 0.7, 0, 1);
  const panic = p.needs.calm > 0 ? p.needs.panic * 0.4 : p.needs.panic;
  const skill = lvl(p, 'firearms');
  let spread = f.spread * (1 + panic * 1.6) * (1.3 - aimK * 0.75) * (1.3 - skill * 0.05) / (0.5 + 0.5 * handFactor(p));
  if (p.needs.drunk > 0.3) spread *= 1.5;
  if (p.needs.fatigue > 0.8) spread *= 1.3;
  if (Math.hypot(p.vx, p.vy) > 0.3) spread *= 1.4;
  const base = Math.atan2(aimY - p.y, aimX - p.x);
  const w = s.world;
  let tracerEnd: [number, number] | null = null;
  for (let k = 0; k < f.pellets; k++) {
    const a = base + rng.gauss(0, spread);
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    let hit: Zombie | null = null;
    let endX = p.x + cx * f.range;
    let endY = p.y + cy * f.range;
    for (let t = 0.4; t <= f.range; t += 0.2) {
      const x = p.x + cx * t;
      const y = p.y + cy * t;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) break;
      const st = w.struct[ty * w.w + tx];
      if (blocksSight(w, tx, ty) && st !== S.Window) {
        endX = x;
        endY = y;
        break;
      }
      if (st === S.Window) {
        const win = w.windows[w.structRef[ty * w.w + tx]];
        if (win.state === WIN_CLOSED && win.planks === 0) breakWindow(s, rt, win, 'player');
      }
      for (const z of zombiesNear(s, rt, x, y, 0.45, tmp)) {
        const r = z.state === 'down' || z.crawler ? 0.24 : 0.34;
        if (Math.hypot(z.x - x, z.y - y) < r && z.hp > 0) {
          hit = z;
          break;
        }
      }
      if (hit) {
        endX = x;
        endY = y;
        break;
      }
    }
    if (!tracerEnd) tracerEnd = [endX, endY];
    if (hit) {
      const head = rng.chance(0.1 + skill * 0.035 + aimK * 0.12);
      const dist = Math.hypot(hit.x - p.x, hit.y - p.y);
      let dmg = f.dmg * rng.range(0.85, 1.15) * (f.pellets > 1 ? Math.max(0.3, 1 - dist / f.range) : 1);
      if (head) dmg *= 3.5;
      hitZombie(s, rt, hit, dmg, f.pellets > 1 ? 0.25 : 0.35, head, false);
    }
  }
  const [ex, ey] = tracerEnd ?? [p.x, p.y];
  if (f.bow) {
    // a soft twang, and about half the time the arrow can be picked up where it fell
    rt.effects.push({ kind: 'tracer', x: p.x + Math.cos(base) * 0.5, y: p.y + Math.sin(base) * 0.5, x2: ex, y2: ey, t: rt.realTime, dur: 0.18 });
    emitNoise(s, rt, { x: p.x, y: p.y, radius: f.noise, kind: 'twang', src: 'player' });
    const tx = Math.floor(ex - Math.cos(base) * 0.3);
    const ty = Math.floor(ey - Math.sin(base) * 0.3);
    if (rng.chance(0.55) && tx >= 0 && ty >= 0 && tx < w.w && ty < w.h && w.struct[ty * w.w + tx] === S.None) {
      const pile = (s.floor[ty * w.w + tx] ??= []);
      const stack = pile.find((i) => i.id === 'arrow');
      if (stack) stack.qty++;
      else pile.push(makeItem(s, 'arrow'));
      rt.dirty.floor = true;
    }
    gun.cond = Math.max(0.05, gun.cond - 0.004);
    addXp(p, 'firearms', 4);
    return;
  }
  rt.effects.push({ kind: 'flash', x: p.x + Math.cos(base) * 0.6, y: p.y + Math.sin(base) * 0.6, t: rt.realTime, dur: 0.12 });
  rt.effects.push({ kind: 'tracer', x: p.x + Math.cos(base) * 0.6, y: p.y + Math.sin(base) * 0.6, x2: ex, y2: ey, t: rt.realTime, dur: 0.1 });
  rt.shake = Math.max(rt.shake, f.pellets > 1 ? 1 : 0.6);
  emitNoise(s, rt, { x: p.x, y: p.y, radius: f.noise, kind: 'gunshot', src: 'player' });
  gun.cond = Math.max(0.05, gun.cond - 0.002);
  addXp(p, 'firearms', 5);
  p.needs.stress = clamp(p.needs.stress + 0.02, 0, 1);
  note(s, 'gunshot');
  const last = s.chronicle[s.chronicle.length - 1];
  if (!last || !last.text.startsWith('Fired') || s.time - last.t > 0.1) chronicle(s, `Fired a ${def(gun.id).name.toLowerCase()} — heard for hundreds of meters.`, 3);
}

export function startReload(s: GameState, rt: Runtime): void {
  const p = s.player;
  const gun = heldItem(p);
  if (!gun) return;
  const f = def(gun.id).firearm;
  if (!f || p.reloadT > 0) return;
  if ((gun.ammo ?? 0) >= f.mag) {
    log(s, 'It\'s already fully loaded.', 'info');
    return;
  }
  const all = [...p.inventory, ...(p.bag?.contents ?? [])];
  const ammo = all.find((i) => i.id === f.ammo && i.qty > 0);
  if (!ammo) {
    log(s, `You have no ${def(f.ammo).name.toLowerCase()}.`, 'warn');
    return;
  }
  p.reloadT = f.reload * (1.2 - lvl(p, 'firearms') * 0.04) * (p.needs.panic > 0.5 ? 1.3 : 1);
  log(s, 'Reloading...', 'info');
}

function finishReload(s: GameState, rt: Runtime): void {
  const p = s.player;
  const gun = heldItem(p);
  if (!gun) return;
  const f = def(gun.id).firearm;
  if (!f) return;
  const need = f.mag - (gun.ammo ?? 0);
  for (const list of [p.inventory, p.bag?.contents ?? []]) {
    for (const it of list) {
      if (it.id !== f.ammo || need <= 0) continue;
      const take = Math.min(it.qty, f.mag - (gun.ammo ?? 0));
      it.qty -= take;
      gun.ammo = (gun.ammo ?? 0) + take;
    }
  }
  p.inventory = p.inventory.filter((i) => i.qty > 0);
  if (p.bag?.contents) p.bag.contents = p.bag.contents.filter((i) => i.qty > 0);
  emitNoise(s, rt, { x: p.x, y: p.y, radius: 2, kind: 'reload', src: 'player' });
}

// ------------------------------------------------------------------ per-step combat update

export function updateCombat(s: GameState, rt: Runtime, c: Controls, dt: number, allowInput: boolean): void {
  const p = s.player;
  if (p.dead) return;
  // clean up grabs from zombies that are gone or far away
  if (p.grabbedBy.length) {
    p.grabbedBy = p.grabbedBy.filter((id) => {
      const z = s.zombies.find((zz) => zz.id === id);
      const v = p.inVehicle >= 0 ? s.vehicles[p.inVehicle] : null;
      const far = !z || (v ? (() => {
        const cl = vehClosest(v, z.x, z.y);
        return Math.hypot(cl.x - z.x, cl.y - z.y) > 0.9;
      })() : Math.hypot(z.x - p.x, z.y - p.y) > 1.3);
      if (!z || z.hp <= 0 || z.state === 'down' || z.state === 'stagger' || far) {
        if (z) z.grabbing = false;
        return false;
      }
      return true;
    });
  }
  if (p.shoveT > 0) p.shoveT -= dt;
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(s, rt);
  }
  if (p.attackT > 0) {
    p.attackT -= dt;
    if (!p.attackHit && p.attackDur - p.attackT >= p.attackDur * 0.45) {
      p.attackHit = true;
      resolveMelee(s, rt);
    }
  }
  if (!allowInput || p.inVehicle >= 0 || p.sleeping || p.downT > 0 || p.climbT > 0) {
    p.aimT = 0;
    return;
  }
  if (c.shove) playerShove(s, rt);
  const held = heldItem(p);
  const gun = held && def(held.id).firearm;
  if (gun) {
    if (c.attackHeld) p.aimT += dt;
    if (c.attackReleased && p.aimT > 0) {
      fireWeapon(s, rt, c.aimX, c.aimY);
      p.aimT = 0;
    }
  } else {
    p.aimT = 0;
    if (c.attack) {
      if (p.grabbedBy.length) playerShove(s, rt);
      else startMelee(s, rt);
    }
  }
}
