// Cars: incredibly useful, loud, and dangerous. Fuel, keys, batteries, engines, tires and crashes.
import { clamp } from '../core/math';
import { FURN } from '../world/furniture';
import { G, S } from '../world/world';
import { addInjury, killPlayer } from './body';
import { def, hasTool, makeItem } from './items';
import { carried, consume, countItem, ensureLoot, useCharge } from './inventory';
import { chronicle, log, note } from './log';
import { emitNoise } from './noise';
import type { PathFinder } from './path';
import { PLAYER_R } from './player';
import type { Runtime } from './runtime';
import { zombiesNear } from './runtime';
import { addXp, lvl } from './skills';
import { realToGame } from './structures';
import type { GameState, Vehicle, Zombie } from './types';
import { startAction, type Ctx } from './use';
import { colorName, driverDoor, inVehicle, VEH, vehClosest, vehCorners } from './vehicleSpecs';
import { collides, setVehicleGrid } from './worldq';
import { hitZombie } from './combat';
import { trySleep, type Option } from './interact';

export interface DriveInput {
  throttle: number;
  steer: number;
  brake: boolean;
}

const tmpZ: Zombie[] = [];

export function vehicleName(v: Vehicle): string {
  return `${colorName(v.color)} ${VEH[v.type].name.toLowerCase()}`;
}

/** Tiles (approx.) covered by a vehicle, for zombie pathfinding. */
export function refreshVehOcc(s: GameState, pf: PathFinder): void {
  const occ = pf.vehOcc;
  occ.fill(0);
  const w = s.world;
  setVehicleGrid(occ, w.w);
  for (const v of s.vehicles) {
    const spec = VEH[v.type];
    const c = Math.cos(v.heading);
    const sn = Math.sin(v.heading);
    for (let a = -spec.l / 2 + 0.3; a <= spec.l / 2 - 0.3; a += 0.5) {
      for (let b = -spec.w / 2 + 0.3; b <= spec.w / 2 - 0.3; b += 0.5) {
        const x = Math.floor(v.x + c * a - sn * b);
        const y = Math.floor(v.y + sn * a + c * b);
        if (x >= 0 && y >= 0 && x < w.w && y < w.h) occ[y * w.w + x] = 1;
      }
    }
  }
}

function tileBlocksCar(s: GameState, x: number, y: number): 'wall' | 'fence' | 'tree' | 'furn' | 'water' | null {
  const w = s.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 'wall';
  const i = y * w.w + x;
  const st = w.struct[i];
  if (st === S.Wall || st === S.BuiltWall || st === S.Window) return 'wall';
  if (st === S.Door) {
    const d = w.doors[w.structRef[i]];
    return d.open || d.broken ? null : 'wall';
  }
  if (st === S.FenceHigh || st === S.FenceLow) return 'fence';
  if (st === S.Tree) return 'tree';
  if (w.ground[i] === G.Water) return 'water';
  const f = w.furn[i];
  if (f >= 0 && FURN[w.furniture[f].kind].solid && FURN[w.furniture[f].kind].h > 0.3) return 'furn';
  return null;
}

function obbOverlap(a: Vehicle, b: Vehicle): boolean {
  for (const [x, y] of vehCorners(a)) if (inVehicle(b, x, y)) return true;
  for (const [x, y] of vehCorners(b)) if (inVehicle(a, x, y)) return true;
  return false;
}

function samplePoints(v: Vehicle): [number, number][] {
  const s = VEH[v.type];
  const c = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  const pts: [number, number][] = [];
  for (const a of [-s.l / 2, -s.l / 4, 0, s.l / 4, s.l / 2]) {
    for (const b of [-s.w / 2, 0, s.w / 2]) {
      if (a !== -s.l / 2 && a !== s.l / 2 && b === 0) continue;
      pts.push([v.x + c * a - sn * b, v.y + sn * a + c * b]);
    }
  }
  return pts;
}

export function crash(s: GameState, rt: Runtime, v: Vehicle, impact: number, what: string, front: boolean): void {
  const rng = rt.rng;
  const kmh = impact * 3.6;
  v.body = Math.max(0, v.body - impact * 2.2);
  if (front) {
    v.front = Math.min(100, v.front + impact * 4);
    v.engine = Math.max(0, v.engine - impact * rng.range(1.2, 2.6));
  } else v.rear = Math.min(100, v.rear + impact * 4);
  if (kmh > 30 && rng.chance(0.5)) v.windows[front ? 0 : 3] = Math.min(2, v.windows[front ? 0 : 3] + 1);
  if (kmh > 25 && rng.chance(0.3)) v.tires[rng.int(0, 3)] = Math.max(0, v.tires[rng.int(0, 3)] - rng.range(20, 100));
  emitNoise(s, rt, { x: v.x, y: v.y, radius: 10 + impact * 1.6, kind: 'crash', src: s.player.inVehicle === v.id ? 'player' : 'vehicle', label: 'Metal crunches — a car crash' });
  if (s.player.inVehicle !== v.id) return;
  rt.shake = Math.max(rt.shake, Math.min(3, impact / 5));
  if (kmh < 12) {
    log(s, `You bump into the ${what}.`, 'warn');
    return;
  }
  log(s, `You crash into the ${what} at ${Math.round(kmh)} km/h!`, 'danger');
  chronicle(s, `Crashed a ${vehicleName(v)} into a ${what} at ${Math.round(kmh)} km/h.`, kmh > 45 ? 5 : 3);
  note(s, 'crash');
  const k = (kmh - 12) / 55;
  addInjury(s, rt, rng.pick(['torso', 'head'] as const), 'bruise', clamp(0.3 + k, 0.2, 1), 'car crash');
  if (kmh > 28 && rng.chance(0.5 + k * 0.3)) {
    const inj = addInjury(s, rt, rng.pick(['head', 'lArm', 'rArm', 'lHand', 'rHand'] as const), 'cut', clamp(0.3 + k * 0.5, 0.2, 1), 'car crash');
    if (v.windows[0] >= 1 && rng.chance(0.4)) inj.glass = true;
  }
  if (kmh > 30 && rng.chance(0.3)) addInjury(s, rt, rng.pick(['neck', 'lLeg', 'rLeg', 'lFoot', 'rFoot'] as const), 'sprain', clamp(0.4 + k * 0.4, 0.3, 1), 'car crash');
  if (kmh > 45 && rng.chance(0.25 + (kmh - 45) * 0.015)) addInjury(s, rt, rng.pick(['lArm', 'rArm', 'lLeg', 'rLeg'] as const), 'fracture', 0.8, 'car crash');
  if (kmh > 45 && rng.chance(0.3)) addInjury(s, rt, rng.pick(['torso', 'lLeg', 'rLeg', 'head'] as const), 'deep', 0.6, 'car crash');
  if (kmh > 50) s.player.body.health -= (kmh - 50) * 1.1;
  if (kmh > 78 && rng.chance((kmh - 78) * 0.04)) killPlayer(s, rt, `Killed in a car crash at ${Math.round(kmh)} km/h`);
  if (v.engine < 25 && v.engineOn && rng.chance(0.4)) {
    v.engineOn = false;
    log(s, 'The engine sputters and dies.', 'danger');
  }
}

/** Drive the player's vehicle and advance every vehicle's physics. */
export function updateVehicles(s: GameState, rt: Runtime, pf: PathFinder, input: DriveInput | null, dt: number): void {
  let moved = false;
  for (const v of s.vehicles) {
    const driven = s.player.inVehicle === v.id;
    const spec = VEH[v.type];
    // alarms
    if (v.alarmUntil > s.time) {
      v.noiseT -= dt;
      if (v.noiseT <= 0) {
        v.noiseT = 1.8;
        emitNoise(s, rt, { x: v.x, y: v.y, radius: 38, kind: 'caralarm', src: 'vehicle', label: 'A car alarm is blaring' });
      }
    }
    if (!driven && Math.abs(v.speed) < 0.01 && !v.engineOn) continue;
    const engineK = 0.35 + 0.65 * (v.engine / 100);
    let throttle = driven && input ? input.throttle : 0;
    const steerIn = driven && input ? input.steer : 0;
    if (driven && rt.exitPending) {
      if (throttle !== 0) rt.exitPending = false;
      else if (input) input.brake = true;
    }
    if (!v.engineOn) throttle = 0;
    // engine running: fuel, battery, noise
    if (v.engineOn) {
      const hours = realToGame(s, dt);
      v.fuel = Math.max(0, v.fuel - hours * 0.9 - Math.abs(v.speed) * dt * spec.burn);
      v.battery = Math.min(1, v.battery + hours * 0.3);
      if (v.fuel <= 0) {
        v.engineOn = false;
        if (driven) log(s, 'The engine coughs and dies. Out of fuel.', 'danger');
      }
      if (v.engine < 20 && rt.rng.chance(dt * 0.03)) {
        v.engineOn = false;
        if (driven) log(s, 'The damaged engine stalls.', 'danger');
      }
      v.noiseT -= dt;
      if (v.noiseT <= 0 && v.alarmUntil <= s.time) {
        v.noiseT = 0.8;
        const r = 11 + Math.abs(v.speed) * 0.55 + (100 - v.engine) * 0.18 + (v.horn ? 30 : 0);
        emitNoise(s, rt, { x: v.x, y: v.y, radius: r, kind: 'engine', src: driven ? 'player' : 'vehicle', label: 'An engine is running' });
        if (driven && v.engine < 50) note(s, 'engine');
      }
    } else if (v.lights && driven) {
      v.battery = Math.max(0, v.battery - realToGame(s, dt) * 0.08);
    }
    if (v.horn && driven) {
      v.noiseT -= dt;
      if (v.noiseT <= 0) {
        v.noiseT = 0.8;
        emitNoise(s, rt, { x: v.x, y: v.y, radius: 42, kind: 'horn', src: 'player' });
      }
    }
    // longitudinal
    const flat = v.tires.filter((t) => t <= 0).length;
    const maxF = spec.top * engineK * (flat ? 0.55 : 1);
    if (throttle > 0) {
      if (v.speed < -0.3) v.speed += 9 * dt;
      else if (v.speed < maxF) v.speed += spec.accel * engineK * throttle * dt;
    } else if (throttle < 0) {
      if (v.speed > 0.3) v.speed -= 9 * dt;
      else if (v.speed > -5) v.speed -= spec.accel * 0.6 * engineK * dt;
    }
    const drag = 0.7 + 0.0035 * v.speed * v.speed + (flat ? 1.2 : 0);
    if (Math.abs(v.speed) < drag * dt) v.speed = 0;
    else v.speed -= Math.sign(v.speed) * drag * dt;
    if (driven && input?.brake) v.speed *= Math.max(0, 1 - dt * 3.5);
    // nodding off at the wheel
    const fat = driven ? s.player.needs.fatigue : 0;
    if (fat > 0.85 && Math.abs(v.speed) > 4 && rt.rng.chance(dt * (fat - 0.85) * 0.6)) {
      v.steer = rt.rng.chance(0.5) ? 1 : -1;
      log(s, 'Your eyes close for a second — the car drifts!', 'danger');
      note(s, 'sleep');
    }
    // steering
    v.steer += (steerIn - v.steer) * Math.min(1, dt * 4);
    const ang = v.steer * 0.6 / (1 + Math.abs(v.speed) * 0.045);
    let dh = (v.speed / (spec.l * 0.6)) * Math.tan(ang) * dt;
    if (flat) dh += 0.02 * v.speed * dt * (v.tires[0] <= 0 || v.tires[2] <= 0 ? 1 : -1);
    if (Math.abs(v.speed) < 0.01) continue;
    const ox = v.x;
    const oy = v.y;
    const oh = v.heading;
    v.heading += dh;
    v.x += Math.cos(v.heading) * v.speed * dt;
    v.y += Math.sin(v.heading) * v.speed * dt;
    moved = true;
    // collisions with the world
    let hit: string | null = null;
    let front = v.speed > 0;
    for (const [px, py] of samplePoints(v)) {
      const b = tileBlocksCar(s, Math.floor(px), Math.floor(py));
      if (!b) continue;
      if (b === 'fence' && Math.abs(v.speed) > 4) {
        // plough through low and chain-link fences
        const i = Math.floor(py) * s.world.w + Math.floor(px);
        s.world.struct[i] = S.None;
        s.world.rev.walls++;
        v.speed *= 0.8;
        v.body -= 2;
        emitNoise(s, rt, { x: px, y: py, radius: 12, kind: 'crash', src: driven ? 'player' : 'vehicle', label: 'A fence is smashed' });
        continue;
      }
      hit = b === 'furn' ? 'obstacle' : b === 'water' ? 'water\'s edge' : b;
      break;
    }
    if (!hit) {
      for (const o of s.vehicles) {
        if (o === v) continue;
        if (Math.abs(o.x - v.x) > 8 || Math.abs(o.y - v.y) > 8) continue;
        if (obbOverlap(v, o)) {
          hit = 'car';
          const push = v.speed * VEH[v.type].mass / (VEH[o.type].mass * 3);
          o.speed = 0;
          o.x += Math.cos(v.heading) * push * 0.05;
          o.y += Math.sin(v.heading) * push * 0.05;
          crash(s, rt, o, Math.abs(v.speed) * 0.5, 'car', false);
          break;
        }
      }
    }
    if (!hit && driven) {
      // the player is inside, but other walkers still collide with the car via collides()
    }
    if (hit) {
      const impact = Math.abs(v.speed);
      v.x = ox;
      v.y = oy;
      v.heading = oh;
      front = v.speed > 0;
      v.speed = -v.speed * 0.15;
      if (impact > 1.5) crash(s, rt, v, impact, hit, front);
      continue;
    }
    // zombies
    const spd = Math.abs(v.speed);
    for (const z of zombiesNear(s, rt, v.x, v.y, spec.l / 2 + 1, tmpZ)) {
      if (z.hp <= 0) continue;
      const cl = vehClosest(v, z.x, z.y);
      const d = Math.hypot(z.x - cl.x, z.y - cl.y);
      if (!cl.inside && d > 0.3) continue;
      const nx = (z.x - v.x) / (Math.hypot(z.x - v.x, z.y - v.y) || 1);
      const ny = (z.y - v.y) / (Math.hypot(z.x - v.x, z.y - v.y) || 1);
      if (spd > 2.2) {
        const dmg = (spd / 7) ** 2 * spec.mass * 1.4;
        z.x += nx * 1.2;
        z.y += ny * 1.2;
        if (collides(s, z.x, z.y, 0.25)) {
          z.x -= nx * 1.2;
          z.y -= ny * 1.2;
        }
        if (driven) hitZombie(s, rt, z, dmg, 1, false, false);
        else z.hp -= dmg;
        if (z.hp > 0) {
          z.state = 'down';
          z.downT = 2 + spd * 0.1;
        }
        v.speed *= 0.9 - Math.min(0.3, 0.1 / spec.mass);
        v.front = Math.min(100, v.front + spd * 0.25);
        if (spd > 8 && rt.rng.chance(0.15)) v.engine = Math.max(0, v.engine - rt.rng.range(1, 5));
        if (spd > 12 && rt.rng.chance(0.2)) v.windows[0] = Math.min(2, v.windows[0] + 1);
        emitNoise(s, rt, { x: z.x, y: z.y, radius: 8, kind: 'thud', src: driven ? 'player' : 'vehicle' });
        rt.effects.push({ kind: 'blood', x: z.x, y: z.y, t: rt.realTime, dur: 0.6 });
        if (driven) rt.shake = Math.max(rt.shake, 0.4);
      } else {
        // slow: nudge them aside
        z.x += nx * 0.15;
        z.y += ny * 0.15;
        v.speed *= 0.8;
      }
    }
  }
  if (moved || rt.vehDirty) {
    refreshVehOcc(s, pf);
    rt.vehDirty = false;
  }
  const p = s.player;
  if (p.inVehicle >= 0) {
    const v = s.vehicles[p.inVehicle];
    // the survivor rides along
    p.x = v.x;
    p.y = v.y;
    // hands reaching through the windows lose their grip once the car gets going
    if (Math.abs(v.speed) > 1.5 && p.grabbedBy.length) {
      releaseCarGrabs(s);
      log(s, 'You pull away and the hands lose their grip.', 'good');
    }
  }
}

// ================================================================== entering, starting, actions

function hasCarKey(s: GameState, v: Vehicle): boolean {
  return carried(s).some((i) => i.keyId === v.keyId);
}

export function enterVehicle(c: Ctx, v: Vehicle): void {
  const s = c.s;
  const p = s.player;
  if (v.locked) {
    if (hasCarKey(s, v)) {
      v.locked = false;
      log(s, 'You unlock the car with the key.', 'good');
    } else {
      log(s, 'It\'s locked.', 'warn');
      return;
    }
  }
  if (p.carrying >= 0) {
    log(s, 'Put the furniture down first.', 'warn');
    return;
  }
  startAction(c, {
    label: 'Getting in', dur: 1, cancelOnMove: true, anim: 'use',
    onDone: () => {
      p.inVehicle = v.id;
      p.stance = 'stand';
      p.vx = p.vy = 0;
      c.rt.fovDirty = true;
      emitNoise(s, c.rt, { x: v.x, y: v.y, radius: 4, kind: 'door', src: 'player' });
      const keyed = v.keyInIgnition || v.hotwired || hasCarKey(s, v);
      log(s, `In the ${vehicleName(v)}. ${keyed ? 'R to start the engine.' : 'No key — you could try hotwiring it.'} WASD to drive, E to get out.`, 'info');
    },
  });
}

/** Is the straight line from inside the car to (x,y) free of walls and fences? */
function clearPath(s: GameState, v: Vehicle, x0: number, y0: number, x: number, y: number): boolean {
  const d = Math.hypot(x - x0, y - y0);
  const n = Math.max(2, Math.ceil(d / 0.2));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (collides(s, x0 + (x - x0) * t, y0 + (y - y0) * t, 0.06, { ignoreVehicle: v.id })) return false;
  }
  return true;
}

/** Where the survivor can step out: a door if possible, otherwise squeezing out through a window. */
export function exitSpot(s: GameState, v: Vehicle): { x: number; y: number; squeeze: boolean } | null {
  const spec = VEH[v.type];
  const cs = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  // local (a along the car, b across; b < 0 is the driver's side)
  const at = (a: number, b: number): [number, number] => [v.x + cs * a - sn * b, v.y + sn * a + cs * b];
  const side = spec.w / 2 + 0.5;
  const end = spec.l / 2 + 0.55;
  const doors: [number, number][] = [driverDoor(v), at(0.4, side), at(-spec.l * 0.22, -side), at(-spec.l * 0.22, side), at(0.4, -side - 0.35), at(0.4, side + 0.35)];
  const ends: [number, number][] = [at(-end, 0), at(end, 0), at(-end, -spec.w * 0.35), at(-end, spec.w * 0.35), at(end, -spec.w * 0.35), at(end, spec.w * 0.35)];
  const ok = (x: number, y: number, fromA: number): boolean => {
    if (collides(s, x, y, PLAYER_R, { ignoreVehicle: v.id })) return false;
    const [ix, iy] = at(fromA, 0);
    return clearPath(s, v, ix, iy, x, y);
  };
  for (const [x, y] of doors) if (ok(x, y, 0.2)) return { x, y, squeeze: false };
  for (const [x, y] of ends) if (ok(x, y, Math.sign((x - v.x) * cs + (y - v.y) * sn) * spec.l * 0.3)) return { x, y, squeeze: true };
  // wedged in: any open spot close by that can be reached through a window
  for (let r = 0.3; r <= 2.2; r += 0.35) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const [x, y] = at(Math.cos(a) * (end + r), Math.sin(a) * (side + r));
      if (ok(x, y, 0)) return { x, y, squeeze: true };
    }
  }
  return null;
}

export function exitVehicle(c: Ctx): void {
  const s = c.s;
  const p = s.player;
  const v = s.vehicles[p.inVehicle];
  if (!v) return;
  if (Math.abs(v.speed) > 1.5) {
    // brake to a stop first; the step loop lets you out once it's slow enough
    if (!c.rt.exitPending) log(s, 'You brake to a stop to get out.', 'info');
    c.rt.exitPending = true;
    return;
  }
  c.rt.exitPending = false;
  const spot = exitSpot(s, v);
  if (!spot) {
    log(s, 'You can\'t get out here — every door and window is blocked. Drive somewhere with more room.', 'danger');
    return;
  }
  p.inVehicle = -1;
  p.x = spot.x;
  p.y = spot.y;
  p.vx = p.vy = 0;
  p.facing = Math.atan2(spot.y - v.y, spot.x - v.x);
  v.horn = false;
  c.rt.fovDirty = true;
  releaseCarGrabs(s);
  if (spot.squeeze) {
    log(s, 'The doors are blocked. You climb out through a window.', 'info');
    if (v.windows.some((w) => w >= 2) && c.rt.rng.chance(0.25)) addInjury(s, c.rt, c.rt.rng.pick(['lHand', 'rHand', 'lArm', 'rArm'] as const), 'cut', c.rt.rng.range(0.15, 0.35), 'glass in the car window');
  }
  emitNoise(s, c.rt, { x: spot.x, y: spot.y, radius: 4, kind: 'door', src: 'player' });
}

function releaseCarGrabs(s: GameState): void {
  const p = s.player;
  for (const id of p.grabbedBy) {
    const z = s.zombies.find((zz) => zz.id === id);
    if (z) z.grabbing = false;
  }
  p.grabbedBy = [];
}

export function startEngine(c: Ctx): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const v = s.vehicles[p.inVehicle];
  if (!v) return;
  if (v.engineOn) {
    v.engineOn = false;
    log(s, 'You switch off the engine.', 'info');
    return;
  }
  if (!(v.keyInIgnition || v.hotwired || hasCarKey(s, v))) {
    log(s, 'You need the key — or to hotwire it.', 'warn');
    return;
  }
  if (v.wrecked) {
    log(s, 'This car is wrecked. It\'s not going anywhere.', 'warn');
    return;
  }
  startAction(c, {
    label: 'Turning the key', dur: 1.3, cancelOnMove: false, anim: 'use',
    onDone: () => {
      if (v.battery < 0.08) {
        log(s, 'Nothing. The battery is dead.', 'warn');
        return;
      }
      emitNoise(s, rt, { x: v.x, y: v.y, radius: 12, kind: 'starter', src: 'player' });
      v.battery = Math.max(0, v.battery - 0.03);
      if (v.fuel <= 0.05) {
        log(s, 'The engine cranks but won\'t catch. No fuel.', 'warn');
        return;
      }
      const chance = 0.35 + v.engine / 110 + v.battery * 0.2;
      if (v.engine < 8 || !rt.rng.chance(chance)) {
        log(s, 'The engine grinds and sputters. Try again...', 'warn');
        return;
      }
      v.engineOn = true;
      log(s, v.engine < 40 ? 'The engine rattles to life — loudly.' : 'The engine starts.', 'good');
      if (!s.notes.includes('engine')) note(s, 'engine');
    },
  });
}

export function hotwire(c: Ctx): void {
  const s = c.s;
  const p = s.player;
  const v = s.vehicles[p.inVehicle];
  if (!v) return;
  const knows = p.magazines.includes('hotwire') || (lvl(p, 'electrical') >= 2 && lvl(p, 'mechanics') >= 1);
  const sd = hasTool(carried(s), 'screwdriver');
  if (!knows) {
    log(s, 'You don\'t know how. (Electrical 2 and Mechanics 1, or the right magazine.)', 'warn');
    return;
  }
  if (!sd) {
    log(s, 'You need a screwdriver.', 'warn');
    return;
  }
  startAction(c, {
    label: 'Hotwiring', dur: 12, cancelOnMove: false, anim: 'work',
    onDone: () => {
      if (c.rt.rng.chance(0.45 + lvl(p, 'electrical') * 0.1)) {
        v.hotwired = true;
        log(s, 'The wires spark and connect. Press R to start.', 'good');
        addXp(p, 'electrical', 15);
      } else {
        log(s, 'Sparks — and nothing. Try again.', 'warn');
        if (c.rt.rng.chance(0.1)) addInjury(s, c.rt, 'rHand', 'burn', 0.2, 'shocked while hotwiring');
        addXp(p, 'electrical', 5);
      }
    },
  });
}

export function vehicleActions(c: Ctx, v: Vehicle, openLoot: (key: string) => void): { title: string; options: Option[]; far: boolean } {
  const s = c.s;
  const p = s.player;
  const cl = vehClosest(v, p.x, p.y);
  const far = p.inVehicle !== v.id && Math.hypot(cl.x - p.x, cl.y - p.y) > 1.3;
  const out: Option[] = [];
  const title = `${vehicleName(v)[0].toUpperCase()}${vehicleName(v).slice(1)}${v.wrecked ? ' (wrecked)' : ''}`;
  if (p.inVehicle === v.id) {
    out.push({ label: v.engineOn ? 'Stop engine' : 'Start engine', run: () => startEngine(c) });
    if (!v.keyInIgnition && !v.hotwired && !hasCarKey(s, v)) out.push({ label: 'Hotwire', run: () => hotwire(c) });
    out.push({ label: v.lights ? 'Headlights off' : 'Headlights on', run: () => {
      v.lights = !v.lights;
      c.rt.fovDirty = true;
    } });
    out.push({ label: 'Open glovebox', run: () => {
      ensureLoot(s, v.glovebox);
      openLoot(`c${v.glovebox}`);
    } });
    out.push({ label: 'Sleep in the seat', run: () => trySleep(c, 'car') });
    out.push({ label: 'Get out', run: () => exitVehicle(c) });
    return { title, options: out, far: false };
  }
  out.push({ label: 'Get in', run: () => enterVehicle(c, v) });
  if (v.locked && !hasCarKey(s, v)) {
    out.push({ label: 'Smash a window to get in', run: () => startAction(c, {
      label: 'Smashing the car window', dur: 1.2, cancelOnMove: true, anim: 'work',
      onDone: () => {
        v.windows[1] = 2;
        v.locked = false;
        emitNoise(s, c.rt, { x: v.x, y: v.y, radius: 13, kind: 'glass', src: 'player' });
        if (v.hasAlarm && v.battery > 0.1) {
          v.alarmUntil = s.time + realToGame(s, 40);
          v.hasAlarm = false;
          log(s, 'The car alarm goes off!', 'danger');
          chronicle(s, 'Set off a car alarm.', 4);
        }
      },
    }) });
  }
  const trunkOk = !v.locked || hasCarKey(s, v);
  out.push({ label: 'Search the trunk', enabled: trunkOk, reason: trunkOk ? undefined : 'Locked', run: () => {
    const cont = s.world.containers[v.trunk];
    if (!cont.searched) {
      startAction(c, {
        label: 'Searching the trunk', dur: 3, cancelOnMove: true, anim: 'search', noise: { radius: 3, every: 1.2, acc: 0, kind: 'search' },
        onDone: () => {
          cont.searched = true;
          ensureLoot(s, v.trunk);
          openLoot(`c${v.trunk}`);
        },
      });
    } else openLoot(`c${v.trunk}`);
  } });
  out.push({ label: 'Inspect condition', run: () => {
    const tires = v.tires.filter((t) => t > 0).length;
    log(s, `${title}: engine ${Math.round(v.engine)}%, body ${Math.round(v.body)}%, fuel ~${Math.round((v.fuel / v.fuelCap) * 100)}%, battery ${Math.round(v.battery * 100)}%, ${tires}/4 tires good${v.windows.some((w) => w >= 2) ? ', broken windows' : ''}.`, 'info');
  } });
  const can = carried(s).find((i) => i.id === 'gasCan');
  if (can) {
    if ((can.fill ?? 0) > 0.1 && can.liquid === 'fuel') {
      out.push({ label: 'Pour gas into the tank', run: () => startAction(c, {
        label: 'Refuelling', dur: 5, cancelOnMove: true, anim: 'use',
        onDone: () => {
          const amt = Math.min(can.fill ?? 0, v.fuelCap - v.fuel);
          v.fuel += amt;
          can.fill = (can.fill ?? 0) - amt;
          if ((can.fill ?? 0) <= 0.01) {
            can.fill = 0;
            can.liquid = undefined;
          }
          log(s, `Added ${amt.toFixed(1)} L.`, 'good');
        },
      }) });
    }
    if (v.fuel > 0.2 && (can.fill ?? 0) < 9.9 && (!can.liquid || can.liquid === 'fuel')) {
      out.push({ label: 'Siphon gas into the can', run: () => startAction(c, {
        label: 'Siphoning gas', dur: 9, cancelOnMove: true, anim: 'kneel',
        onDone: () => {
          const amt = Math.min(v.fuel, 10 - (can.fill ?? 0));
          v.fuel -= amt;
          can.fill = (can.fill ?? 0) + amt;
          can.liquid = 'fuel';
          log(s, `Siphoned ${amt.toFixed(1)} L. Your mouth tastes of gasoline.`, 'good');
        },
      }) });
    }
  }
  // repairs
  const wrench = hasTool(carried(s), 'wrench');
  if (v.engine < 95 && !v.wrecked) {
    const parts = countItem(s, 'engineParts');
    const ok = !!wrench && parts > 0;
    out.push({ label: 'Repair engine', enabled: ok, reason: ok ? undefined : 'Need a pipe wrench and engine parts', run: () => startAction(c, {
      label: 'Working on the engine', dur: 20 * (1 - lvl(p, 'mechanics') * 0.05), cancelOnMove: true, anim: 'work',
      noise: { radius: 7, every: 2, acc: 0, kind: 'tools' },
      onDone: () => {
        if (!consume(s, 'engineParts', 1)) return;
        const gain = 12 + lvl(p, 'mechanics') * 5;
        v.engine = Math.min(100, v.engine + gain);
        addXp(p, 'mechanics', 20);
        log(s, `Engine repaired to ${Math.round(v.engine)}%.`, 'good');
      },
    }) });
  }
  const bat = carried(s).find((i) => i.id === 'carBattery');
  if (bat) {
    out.push({ label: 'Swap the battery', enabled: !!wrench, reason: wrench ? undefined : 'Need a pipe wrench', run: () => startAction(c, {
      label: 'Swapping the battery', dur: 10, cancelOnMove: true, anim: 'work',
      onDone: () => {
        const old = v.battery;
        v.battery = bat.charge ?? 0.5;
        bat.charge = old;
        addXp(p, 'mechanics', 8);
        log(s, 'Battery swapped.', 'good');
      },
    }) });
  }
  const flatIdx = v.tires.findIndex((t) => t <= 0);
  if (flatIdx >= 0 && countItem(s, 'tire') > 0) {
    const ok = !!hasTool(carried(s), 'jack') && !!hasTool(carried(s), 'lugwrench');
    out.push({ label: 'Change the flat tire', enabled: ok, reason: ok ? undefined : 'Need a jack and lug wrench', run: () => startAction(c, {
      label: 'Changing a tire', dur: 25, cancelOnMove: true, anim: 'kneel',
      noise: { radius: 5, every: 2.5, acc: 0, kind: 'tools' },
      onDone: () => {
        if (!consume(s, 'tire', 1)) return;
        v.tires[flatIdx] = 100;
        addXp(p, 'mechanics', 10);
        log(s, 'Tire changed.', 'good');
      },
    }) });
  }
  void useCharge;
  void def;
  void makeItem;
  return { title, options: out, far };
}
