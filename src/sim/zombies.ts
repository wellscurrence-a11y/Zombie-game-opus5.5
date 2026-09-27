// Zombie AI. They see (cone, light, weather, stance), hear (sound muffled by walls), and remember
// where they last saw you. They never know where you are unless one of those senses told them.
import { angleDiff, clamp, smoothstep, turnToward } from '../core/math';
import { G, S, type World, WIN_BROKEN, WIN_CLEARED, WIN_OPEN } from '../world/world';
import { walkLine } from './fov';
import { tileLight, ambient } from './lighting';
import { emitNoise } from './noise';
import { isObstacle, PathFinder, zombieCost } from './path';
import type { NoiseEvent, Runtime } from './runtime';
import { zombiesNear } from './runtime';
import type { GameState, Zombie } from './types';
import { collides, lineOfSight, moveCircle, soundCost, Shape, tileShape } from './worldq';
import { damageObstacle } from './structures';
import { zombieAttack, zombieAttackVehicle } from './combat';
import { lvl } from './skills';
import { vehClosest } from './vehicleSpecs';
import { note } from './log';

export const ZOMBIE_R = 0.25;
const PERCEIVE_EVERY = 0.2;
const scratch: Zombie[] = [];

function playerTarget(s: GameState): { x: number; y: number; inVehicle: boolean } {
  const p = s.player;
  if (p.inVehicle >= 0) {
    const v = s.vehicles[p.inVehicle];
    return { x: v.x, y: v.y, inVehicle: true };
  }
  return { x: p.x, y: p.y, inVehicle: false };
}

/** How far this zombie could spot the survivor right now (0 = can't). */
export function spotRange(s: GameState, rt: Runtime, z: Zombie, amb: number): number {
  const p = s.player;
  const w = s.world;
  const pt = playerTarget(s);
  const px = Math.floor(pt.x);
  const py = Math.floor(pt.y);
  let L = tileLight(s, rt, px, py, amb);
  const fl = p.flashlight && p.inventory.some((i) => i.id === 'flashlight' && (i.charge ?? 0) > 0);
  if (fl && !pt.inVehicle) L += 0.9;
  if (pt.inVehicle && s.vehicles[p.inVehicle].lights) L += 1;
  let range = 17 * z.sight * (0.2 + 0.8 * smoothstep(0.03, 0.5, L));
  if (fl && L < 0.3) range = Math.max(range, 26 * z.sight);
  range *= 1 - s.weather.fog * 0.55 - s.weather.rain * 0.22;
  if (!pt.inVehicle) {
    const moving = Math.hypot(p.vx, p.vy);
    if (p.stance === 'crouch') range *= 0.55 * (1 - lvl(p, 'sneaking') * 0.03);
    if (moving < 0.1) range *= 0.6;
    else if (p.running) range *= 1.25;
    const ti = py * w.w + px;
    if (p.stance === 'crouch' && (w.struct[ti] === S.Bush || w.ground[ti] === G.TallGrass)) range *= 0.45;
    if (p.sleeping) range *= 0.5;
  } else range *= 1.5;
  return range;
}

export function updateZombies(s: GameState, rt: Runtime, pf: PathFinder, dt: number): void {
  const w = s.world;
  const p = s.player;
  const pt = playerTarget(s);
  const amb = ambient(s);
  rt.pathBudget = 3;
  // ---- hearing: process this step's noises
  for (const n of rt.noises) hear(s, rt, n);
  rt.noises.length = 0;

  let threat = 0;
  let closest = 99;
  const dead: Zombie[] = [];
  for (const z of s.zombies) {
    if (z.hp <= 0) {
      dead.push(z);
      continue;
    }
    const dx = pt.x - z.x;
    const dy = pt.y - z.y;
    const d = Math.hypot(dx, dy);
    let zdt = dt;
    if (d > 70) {
      z.lodAcc += dt;
      if (z.lodAcc < 0.9) continue;
      zdt = Math.min(z.lodAcc, 2);
      z.lodAcc = 0;
    }
    if (d < closest && !p.dead) closest = d;
    tickZombie(s, rt, pf, z, zdt, d, amb, pt);
    if (d < 10 && rt.vis[Math.floor(z.y) * w.w + Math.floor(z.x)] && z.state !== 'down') {
      threat += (1 - d / 10) * (z.state === 'chase' || z.state === 'attack' ? 1.6 : 0.8);
    }
  }
  rt.threat = threat;
  rt.closestZombie = closest;
  if (dead.length) s.zombies = s.zombies.filter((z) => z.hp > 0);
}

function setState(z: Zombie, st: Zombie['state'], timer = 0): void {
  z.state = st;
  z.timer = timer;
  if (st !== 'bang') z.bangIdx = -1;
}

function tickZombie(s: GameState, rt: Runtime, pf: PathFinder, z: Zombie, dt: number, d: number, amb: number, pt: { x: number; y: number; inVehicle: boolean }): void {
  const p = s.player;
  const rng = rt.rng;
  z.timer -= dt;
  z.moanT -= dt;
  z.sinceSeen += dt;
  z.anim += dt * (Math.hypot(z.vx, z.vy) * 4.2 + 0.3);
  if (z.attackT > 0 && z.state !== 'attack') z.attackT = 0;

  // ---- incapacitated states
  if (z.state === 'down') {
    z.downT -= dt;
    z.vx = z.vy = 0;
    if (z.downT <= 0) {
      setState(z, z.awareness >= 1 ? 'chase' : z.lastSeenT > 0 ? 'search' : 'idle', 20);
    }
    return;
  }
  if (z.state === 'stagger') {
    z.staggerT -= dt;
    moveCircle(s, z, z.vx * dt, z.vy * dt, ZOMBIE_R);
    z.vx *= Math.max(0, 1 - dt * 5);
    z.vy *= Math.max(0, 1 - dt * 5);
    if (z.staggerT <= 0) setState(z, z.awareness >= 1 ? 'chase' : 'investigate', 10);
    return;
  }
  if (z.state === 'climb') {
    z.climbT -= dt;
    if (z.climbT <= 0) {
      z.x = z.tx;
      z.y = z.ty;
      z.state = 'down';
      z.downT = 0.8;
      z.path = null;
    }
    return;
  }
  if (z.state === 'eat') {
    if (z.timer <= 0 || (d < 6 && z.awareness > 0.3)) setState(z, 'idle', 5);
    perceive(s, rt, z, dt, d, amb, pt);
    return;
  }

  // ---- senses
  z.pathT += dt;
  if ((rt.realTime + z.id * 0.037) % PERCEIVE_EVERY < dt || dt > PERCEIVE_EVERY) perceive(s, rt, z, Math.max(dt, PERCEIVE_EVERY), d, amb, pt);

  // ---- behaviour
  switch (z.state) {
    case 'idle': {
      z.vx = z.vy = 0;
      if (z.timer <= 0) {
        if (rng.chance(0.35)) {
          // shuffle somewhere nearby
          for (let t = 0; t < 6; t++) {
            const tx = Math.floor(z.x + rng.range(-6, 6));
            const ty = Math.floor(z.y + rng.range(-6, 6));
            if (tx < 1 || ty < 1 || tx >= s.world.w - 1 || ty >= s.world.h - 1) continue;
            if (zombieCost(s.world, ty * s.world.w + tx, pf.vehOcc) > 2) continue;
            // stay on the same side of walls: indoor zombies wander indoors
            if ((s.world.room[ty * s.world.w + tx] >= 0) !== (s.world.room[Math.floor(z.y) * s.world.w + Math.floor(z.x)] >= 0)) continue;
            z.tx = tx + 0.5;
            z.ty = ty + 0.5;
            z.path = null;
            setState(z, 'wander', 20);
            break;
          }
        } else {
          z.facing += rng.range(-1, 1);
          z.timer = rng.range(6, 25);
        }
      }
      break;
    }
    case 'wander':
      if (walkTo(s, rt, pf, z, dt, z.speed * 0.45) || z.timer <= 0) setState(z, 'idle', rng.range(8, 30));
      break;
    case 'investigate':
      z.interest -= dt;
      if (walkTo(s, rt, pf, z, dt, z.speed * 0.85)) {
        setState(z, 'search', rng.range(10, 22));
      } else if (z.interest <= 0) setState(z, 'idle', rng.range(5, 15));
      break;
    case 'search':
      if (z.timer <= 0) {
        z.targetPri = 0;
        setState(z, 'idle', rng.range(5, 20));
        break;
      }
      if (walkTo(s, rt, pf, z, dt, z.speed * 0.5)) {
        z.tx = z.lastSeenT > 0 ? z.lastSeenX + rng.range(-3, 3) : z.x + rng.range(-3, 3);
        z.ty = z.lastSeenT > 0 ? z.lastSeenY + rng.range(-3, 3) : z.y + rng.range(-3, 3);
        z.path = null;
      }
      break;
    case 'chase': {
      if (p.dead) {
        setState(z, 'search', 15);
        break;
      }
      const seeNow = z.sinceSeen < 0.45;
      z.tx = z.lastSeenX;
      z.ty = z.lastSeenY;
      z.interest -= dt;
      if (pt.inVehicle) {
        const v = s.vehicles[p.inVehicle];
        const c = vehClosest(v, z.x, z.y);
        const dv = Math.hypot(c.x - z.x, c.y - z.y);
        if (dv < 0.55 && Math.abs(v.speed) < 3) {
          z.vx = z.vy = 0;
          z.facing = turnToward(z.facing, Math.atan2(v.y - z.y, v.x - z.x), dt * 6);
          z.attackT += dt;
          if (z.attackT > 1.5) {
            z.attackT = 0;
            zombieAttackVehicle(s, rt, z, v);
          }
          break;
        }
      }
      if (seeNow && d < 0.95 && !pt.inVehicle && p.climbT <= 0) {
        const off = Math.abs(angleDiff(z.facing, Math.atan2(pt.y - z.y, pt.x - z.x)));
        z.facing = turnToward(z.facing, Math.atan2(pt.y - z.y, pt.x - z.x), dt * 8);
        if (off < 1.0) {
          setState(z, 'attack', 0);
          z.attackT = 0;
          break;
        }
      }
      const arrived = walkTo(s, rt, pf, z, dt, z.speed * (d < 3 ? 1.18 : 1.08));
      if (arrived && !seeNow) {
        setState(z, 'search', rng.range(18, 40));
        note(s, 'lostThem');
      }
      if (z.interest <= 0 && !seeNow) setState(z, 'search', 15);
      break;
    }
    case 'attack': {
      z.vx = z.vy = 0;
      const windup = 0.65 / (z.speed > 1.1 ? 1.2 : 1);
      z.attackT += dt / windup;
      z.facing = turnToward(z.facing, Math.atan2(pt.y - z.y, pt.x - z.x), dt * 4);
      if (z.attackT >= 1) {
        z.attackT = 0;
        if (d < 1.15 && !pt.inVehicle && !p.dead) zombieAttack(s, rt, z);
        setState(z, 'chase', 0);
        z.moanT = Math.min(z.moanT, 1);
      }
      break;
    }
    case 'bang': {
      z.vx = z.vy = 0;
      z.interest -= dt;
      const i = z.bangIdx;
      if (i < 0 || !isObstacle(s.world, i) || zombieCost(s.world, i, pf.vehOcc) <= 5.5) {
        // obstacle gone or now passable
        setState(z, z.awareness >= 1 ? 'chase' : 'investigate', 10);
        z.path = null;
        break;
      }
      const bx = (i % s.world.w) + 0.5;
      const by = Math.floor(i / s.world.w) + 0.5;
      z.facing = turnToward(z.facing, Math.atan2(by - z.y, bx - z.x), dt * 5);
      z.bangT -= dt;
      if (z.bangT <= 0) {
        z.bangT = rng.range(1.3, 2.0);
        damageObstacle(s, rt, i, rng.range(1.5, 3.2), true);
        emitNoise(s, rt, { x: bx, y: by, radius: 9, kind: 'bang', src: 'zombie', label: 'Something is pounding on a door or window' });
      }
      if (z.interest <= 0) setState(z, 'idle', rng.range(10, 30));
      break;
    }
    default:
      break;
  }

  // moans: when aware, they groan — and others nearby come to see
  if (z.moanT <= 0) {
    z.moanT = rng.range(6, 16);
    if (z.state === 'chase' && z.awareness >= 1) {
      emitNoise(s, rt, { x: z.x, y: z.y, radius: 7, kind: 'moan', src: 'zombie' });
    }
  }
  z.facing = z.state === 'attack' || z.state === 'bang' ? z.facing : Math.hypot(z.vx, z.vy) > 0.05 ? turnToward(z.facing, Math.atan2(z.vy, z.vx), dt * 5) : z.facing;
}

/** Sight check toward the survivor. */
function perceive(s: GameState, rt: Runtime, z: Zombie, dt: number, d: number, amb: number, pt: { x: number; y: number; inVehicle: boolean }): void {
  const p = s.player;
  if (p.dead || d > 32) {
    z.awareness = Math.max(0, z.awareness - dt * 0.2);
    return;
  }
  const a = Math.atan2(pt.y - z.y, pt.x - z.x);
  const off = Math.abs(angleDiff(z.facing, a));
  let seen = false;
  if (off < 1.15 || d < 2.2 || z.state === 'chase') {
    const range = spotRange(s, rt, z, amb);
    if (d <= range && lineOfSight(s.world, z.x, z.y, pt.x, pt.y)) seen = true;
    if (seen) {
      const gain = d < 2.5 ? 10 : (0.55 + 2.8 * (1 - d / range)) * (z.state === 'chase' ? 3 : 1);
      z.awareness = Math.min(1.5, z.awareness + gain * dt);
    }
  }
  if (!seen) z.awareness = Math.max(0, z.awareness - dt * (z.state === 'chase' ? 0.04 : 0.15));
  if (seen && z.awareness >= 1) {
    const wasChasing = z.state === 'chase' || z.state === 'attack';
    z.lastSeenX = pt.x;
    z.lastSeenY = pt.y;
    z.lastSeenT = s.time;
    z.sinceSeen = 0;
    z.interest = 45;
    if (!wasChasing && z.state !== 'bang' && z.state !== 'climb') {
      setState(z, 'chase', 0);
      z.path = null;
      z.moanT = 0;
      if (rt.vis[Math.floor(z.y) * s.world.w + Math.floor(z.x)]) rt.effects.push({ kind: 'text', x: z.x, y: z.y, t: rt.realTime, dur: 1.2, text: '!' });
    } else if (z.state === 'bang') {
      z.interest = 45;
    }
  }
}

/** React to a noise if it's loud enough after walls muffle it. */
function hear(s: GameState, rt: Runtime, n: NoiseEvent): void {
  const w = s.world;
  const near = zombiesNear(s, rt, n.x, n.y, n.radius + 1, scratch);
  const rng = rt.rng;
  for (const z of near) {
    if (z.state === 'down' || z.state === 'climb' || z.state === 'stagger') continue;
    const d = Math.hypot(z.x - n.x, z.y - n.y);
    if (d < 0.5 && n.src === 'zombie') continue;
    let muffle = 0;
    walkLine(Math.floor(n.x), Math.floor(n.y), Math.floor(z.x), Math.floor(z.y), (x, y) => {
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) return false;
      muffle += soundCost(w, y * w.w + x);
      return muffle < 40;
    });
    const eff = d + muffle;
    const thr = n.radius * z.hearing;
    if (eff > thr) continue;
    if (n.kind === 'moan') {
      // the herd follows the herd
      if (z.state === 'idle' || z.state === 'wander') {
        z.tx = n.x + rng.range(-1.5, 1.5);
        z.ty = n.y + rng.range(-1.5, 1.5);
        z.targetPri = 1;
        z.interest = 20;
        z.path = null;
        setState(z, 'investigate', 20);
      }
      continue;
    }
    const pri = n.radius - eff + (n.src === 'player' ? 4 : 0);
    const seesPlayer = z.sinceSeen < 0.45;
    if (z.state === 'chase' || z.state === 'attack') {
      if (seesPlayer) continue;
      if (n.src === 'player') {
        // tracking by sound
        z.lastSeenX = n.x + rng.range(-1, 1);
        z.lastSeenY = n.y + rng.range(-1, 1);
        z.interest = Math.max(z.interest, 30);
        z.path = null;
      }
      continue;
    }
    if (z.state === 'bang') {
      if (n.src === 'player' || n.radius > 12) z.interest = Math.max(z.interest, 40);
      continue;
    }
    if (z.state === 'investigate' && pri < z.targetPri - 2) continue;
    const err = (eff / thr) * 3;
    z.tx = n.x + rng.range(-err, err);
    z.ty = n.y + rng.range(-err, err);
    z.targetPri = pri;
    z.interest = 25 + n.radius * 1.5;
    z.path = null;
    setState(z, 'investigate', 0);
  }
}

/** Is the straight line between two points walkable for a zombie (no obstacles)? */
function straightWalkable(w: World, x0: number, y0: number, x1: number, y1: number, vehOcc: Uint8Array): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / 0.35);
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const x = Math.floor(x0 + (x1 - x0) * t);
    const y = Math.floor(y0 + (y1 - y0) * t);
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) return false;
    const i = y * w.w + x;
    if (tileShape(w, i) !== Shape.None || vehOcc[i]) return false;
  }
  return true;
}

/** Move toward (z.tx, z.ty). Returns true on arrival. */
function walkTo(s: GameState, rt: Runtime, pf: PathFinder, z: Zombie, dt: number, speed: number): boolean {
  const w = s.world;
  const dx = z.tx - z.x;
  const dy = z.ty - z.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.45) {
    z.vx = z.vy = 0;
    return true;
  }
  let gx = z.tx;
  let gy = z.ty;
  // far away: just head that way; plan a proper route once closer
  const zz = z as Zombie & { dT?: number; dOk?: boolean; dTx?: number; dTy?: number };
  if (zz.dT === undefined || rt.realTime - zz.dT > 0.3 || Math.abs((zz.dTx ?? 0) - z.tx) > 0.5 || Math.abs((zz.dTy ?? 0) - z.ty) > 0.5) {
    zz.dT = rt.realTime;
    zz.dTx = z.tx;
    zz.dTy = z.ty;
    zz.dOk = dist < 14 && straightWalkable(w, z.x, z.y, z.tx, z.ty, pf.vehOcc);
  }
  const direct = dist > 30 || !!zz.dOk;
  if (!direct) {
    const goalTile = Math.floor(z.ty) * w.w + Math.floor(z.tx);
    const pathGoal = z.path && z.path.length ? z.path[z.path.length - 1] : -1;
    const stale = !z.path || z.pathI >= z.path.length || (pathGoal !== goalTile && z.pathT > 1.5) || z.pathT > 6;
    if (stale && rt.pathBudget > 0) {
      rt.pathBudget--;
      const path = pf.find(Math.floor(z.x), Math.floor(z.y), Math.floor(z.tx), Math.floor(z.ty), 2200);
      z.path = path;
      z.pathI = 0;
      z.pathT = 0;
      if (!path) {
        // unreachable: give up this target
        z.vx = z.vy = 0;
        return true;
      }
    }
    if (z.path && z.pathI < z.path.length) {
      // skip waypoints we've reached
      while (z.pathI < z.path.length) {
        const i = z.path[z.pathI];
        const cx = (i % w.w) + 0.5;
        const cy = Math.floor(i / w.w) + 0.5;
        if (Math.hypot(cx - z.x, cy - z.y) < 0.4) z.pathI++;
        else break;
      }
      if (z.pathI < z.path.length) {
        const i = z.path[z.pathI];
        const cx = (i % w.w) + 0.5;
        const cy = Math.floor(i / w.w) + 0.5;
        // obstacle ahead?
        if (isObstacle(w, i) && Math.hypot(cx - z.x, cy - z.y) < 1.15) {
          if (handleObstacle(s, rt, z, i)) return false;
        }
        gx = cx;
        gy = cy;
      } else if (!z.path.length) return true;
    } else if (!z.path) {
      z.vx = z.vy = 0;
      return false;
    }
  }
  const ax = gx - z.x;
  const ay = gy - z.y;
  const al = Math.hypot(ax, ay) || 1;
  let vx = (ax / al) * speed;
  let vy = (ay / al) * speed;
  // separation
  const near = zombiesNear(s, rt, z.x, z.y, 0.7, scratch);
  for (const o of near) {
    if (o === z) continue;
    const ox = z.x - o.x;
    const oy = z.y - o.y;
    const od = Math.hypot(ox, oy);
    if (od < 0.55 && od > 0.001) {
      vx += (ox / od) * (0.55 - od) * 3;
      vy += (oy / od) * (0.55 - od) * 3;
    }
  }
  const tile = Math.floor(z.y) * w.w + Math.floor(z.x);
  if (w.struct[tile] === S.Bush) {
    vx *= 0.7;
    vy *= 0.7;
  }
  z.vx = vx;
  z.vy = vy;
  const bx = z.x;
  const by = z.y;
  moveCircle(s, z, vx * dt, vy * dt, ZOMBIE_R);
  // stuck?
  const moved = Math.hypot(z.x - bx, z.y - by);
  if (moved < speed * dt * 0.2) {
    z.stuckT += dt;
    if (z.stuckT > 1.5) {
      z.stuckT = 0;
      z.path = null;
      z.pathT = 99;
      // nudge
      const a = rt.rng.range(-Math.PI, Math.PI);
      moveCircle(s, z, Math.cos(a) * 0.3, Math.sin(a) * 0.3, ZOMBIE_R);
    }
  } else z.stuckT = 0;
  return false;
}

/** The next tile is a door/window/fence/barricade: climb it or bang on it. Returns true if handled. */
function handleObstacle(s: GameState, rt: Runtime, z: Zombie, i: number): boolean {
  const w = s.world;
  const st = w.struct[i];
  const tx = i % w.w;
  const ty = Math.floor(i / w.w);
  // destination: the tile beyond the obstacle, continuing the zombie's approach direction
  const next = z.path && z.pathI + 1 < z.path.length ? z.path[z.pathI + 1] : -1;
  const climbTo = (): void => {
    let nx: number;
    let ny: number;
    if (next >= 0) {
      nx = (next % w.w) + 0.5;
      ny = Math.floor(next / w.w) + 0.5;
    } else {
      nx = tx + 0.5 + Math.sign(tx + 0.5 - z.x) * 1;
      ny = ty + 0.5 + Math.sign(ty + 0.5 - z.y) * 1;
    }
    if (collides(s, nx, ny, ZOMBIE_R)) return;
    z.tx = nx;
    z.ty = ny;
    z.x = tx + 0.5;
    z.y = ty + 0.5;
    z.state = 'climb';
    z.climbT = st === S.FenceLow ? 1.4 : 2.0;
    z.pathI += 2;
  };
  if (st === S.FenceLow) {
    climbTo();
    return true;
  }
  if (st === S.Window) {
    const win = w.windows[w.structRef[i]];
    if (win.planks === 0 && (win.state === WIN_OPEN || win.state === WIN_BROKEN || win.state === WIN_CLEARED)) {
      climbTo();
      return true;
    }
  }
  if (st === S.Door) {
    const dd = w.doors[w.structRef[i]];
    if ((dd.open || dd.broken) && dd.planks === 0) return false;
  }
  if (st !== S.Door && st !== S.Window && st !== S.BuiltWall) return false;
  z.bangIdx = i;
  z.bangT = rt.rng.range(0.3, 1.0);
  z.state = 'bang';
  if (z.interest < 20) z.interest = 20;
  return true;
}

/** Spawn a corpse from a killed zombie. */
export function zombieDies(s: GameState, rt: Runtime, z: Zombie): void {
  z.hp = 0;
  s.corpses.push({
    id: s.nextCorpseId++, x: z.x, y: z.y, rot: -z.facing + Math.PI / 2 + rt.rng.range(-0.4, 0.4), outfit: z.outfit, kind: z.kind,
    items: null, t: s.time, name: z.name, crawler: z.crawler,
  });
  const c = s.corpses[s.corpses.length - 1];
  if (z.items) c.extra = z.items;
  const i = Math.floor(z.y) * s.world.w + Math.floor(z.x);
  s.world.decal[i] |= 1;
  s.world.rev.ground++;
  rt.dirty.corpses = true;
}

