// The world keeps turning: weather, utilities failing, fires, generators, alarms and events.
// Nothing here ever creates danger right next to the survivor — events happen elsewhere and
// travel to you as sound, or as a crowd that heard it.
import { clamp } from '../core/math';
import { dayNumber, dayOfYear, hourOfDay } from '../core/time';
import { FURN } from '../world/furniture';
import { G, S, WIN_BROKEN } from '../world/world';
import { addInjury } from './body';
import { def, freshness } from './items';
import { chronicle, log, note } from './log';
import { buildingPowered } from './lighting';
import { emitNoise, describeDirection } from './noise';
import { newZombie } from './population';
import type { Runtime } from './runtime';
import { zombiesNear } from './runtime';
import { realToGame, triggerAlarm } from './structures';
import type { GameState, WeatherState } from './types';
import { startFire, updateCooking, updateCrops } from './world-actions';
import { zombieDies } from './zombies';
import { HY, VX } from '../world/gen';
import { createVehicle } from './vehicleSpecs';
import { makeItem } from './items';

// ================================================================== weather

function seasonalTemp(s: GameState): number {
  const doy = dayOfYear(s.time);
  const days = (doy - 248 + 365) % 365;
  const base = 19 - Math.min(days, 110) * 0.21;
  const h = hourOfDay(s.time);
  const diurnal = Math.cos(((h - 15) / 24) * Math.PI * 2) * 5.5;
  return base + diurnal;
}

function pickWeather(s: GameState, rt: Runtime): WeatherState['kind'] {
  const cold = seasonalTemp(s) < 3;
  const w = s.weather.kind;
  const opts: [WeatherState['kind'], number][] = [
    ['clear', w === 'clear' ? 2 : 4],
    ['cloudy', 4],
    ['rain', w === 'cloudy' ? 4 : 2],
    ['storm', w === 'rain' ? 1.5 : 0.4],
    ['fog', hourOfDay(s.time) < 10 ? 2 : 0.6],
  ];
  if (cold) opts.push(['snow', 2.5]);
  return rt.rng.weighted(opts);
}

export function updateWeather(s: GameState, rt: Runtime, hours: number): void {
  const wx = s.weather;
  if (s.time >= wx.nextChange) {
    wx.kind = wx.forecast;
    wx.forecast = pickWeather(s, rt);
    wx.nextChange = s.time + rt.rng.range(wx.kind === 'storm' ? 2 : 4, wx.kind === 'clear' ? 16 : 10);
    const msgs: Record<string, string> = {
      rain: 'It starts to rain.', storm: 'A storm rolls in. Thunder rumbles overhead.', fog: 'Fog creeps in. You can barely see down the street.',
      clear: 'The sky clears.', cloudy: 'Clouds gather overhead.', snow: 'Snow begins to fall.',
    };
    log(s, msgs[wx.kind], wx.kind === 'storm' || wx.kind === 'fog' ? 'warn' : 'info');
    if (wx.kind === 'fog') chronicle(s, 'Fog rolled in.', 1);
  }
  const target = {
    rain: wx.kind === 'rain' ? 0.55 : wx.kind === 'storm' ? 1 : wx.kind === 'snow' ? 0.4 : 0,
    fog: wx.kind === 'fog' ? 0.85 : wx.kind === 'storm' ? 0.2 : wx.kind === 'rain' ? 0.1 : 0,
    cloud: wx.kind === 'clear' ? 0.1 : wx.kind === 'cloudy' ? 0.6 : 0.95,
    wind: wx.kind === 'storm' ? 0.9 : wx.kind === 'rain' ? 0.4 : 0.2,
  };
  const k = Math.min(1, hours * 1.5);
  wx.rain += (target.rain - wx.rain) * k;
  wx.fog += (target.fog - wx.fog) * k;
  wx.cloud += (target.cloud - wx.cloud) * k;
  wx.wind += (target.wind - wx.wind) * k;
  const t = seasonalTemp(s) - wx.rain * 3 - wx.cloud * 1.5 - (wx.kind === 'storm' ? 2 : 0);
  wx.temp += (t - wx.temp) * Math.min(1, hours * 0.8);
  // snow settles when it's cold enough and melts when it isn't
  if (wx.kind === 'snow' && wx.temp < 2) wx.snow = Math.min(1, (wx.snow ?? 0) + hours * 0.25);
  else if (wx.temp > 1) wx.snow = Math.max(0, (wx.snow ?? 0) - hours * 0.08 * (wx.temp - 0.5));
  // thunder: loud, far away, and it pulls the dead around
  if (wx.kind === 'storm') {
    wx.lightningT -= hours;
    if (wx.lightningT <= 0) {
      wx.lightningT = rt.rng.range(0.15, 0.6);
      const p = s.player;
      const a = rt.rng.range(0, Math.PI * 2);
      const d = rt.rng.range(35, 90);
      emitNoise(s, rt, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, radius: 40, kind: 'thunder', src: 'world', label: 'Thunder' });
      rt.flash = 1;
    }
  }
}

// ================================================================== utilities & radio

export function hasRadio(s: GameState): boolean {
  return s.player.inventory.some((i) => i.id === 'radio') || !!s.player.bag?.contents?.some((i) => i.id === 'radio');
}

const FLAVOR = [
  'Evacuation center at Fairmont High School is no longer accepting civilians.',
  'Residents are advised to remain indoors and avoid contact with the infected.',
  'Do not approach infected individuals. They are drawn by noise and light.',
  'National Guard units report heavy losses on Route 9.',
  'If someone in your household has been bitten, isolate them immediately.',
  'Supplies will be distributed... [static] ...pending further notice.',
  'Emergency services are overwhelmed. Do not call unless... [static]',
];

export function updateUtilities(s: GameState, rt: Runtime): void {
  const u = s.util;
  const radio = hasRadio(s);
  if (!u.powerWarned && s.time > u.powerOffAt - 24) {
    u.powerWarned = true;
    if (radio) log(s, 'RADIO: "...rolling blackouts expected across the county within the day. Prepare alternative power..."', 'radio');
  }
  if (!u.waterWarned && s.time > u.waterOffAt - 24) {
    u.waterWarned = true;
    if (radio) log(s, 'RADIO: "...the water treatment plant is unmanned. Store clean water now. Boil anything you drink..."', 'radio');
  }
  if (!u.powerOff && s.time >= u.powerOffAt) {
    u.powerOff = true;
    rt.lightDirty = true;
    log(s, 'The power goes out. Everywhere. It isn\'t coming back.', 'danger');
    chronicle(s, 'The power grid failed.', 3);
    note(s, 'utilities');
  }
  if (!u.waterOff && s.time >= u.waterOffAt) {
    u.waterOff = true;
    log(s, 'The water pressure sputters and dies. The taps are running dry.', 'danger');
    chronicle(s, 'The water supply failed.', 3);
    note(s, 'utilities');
  }
  // periodic broadcasts
  const ev = s.events;
  if (radio && s.time - ev.lastBroadcastT > 3.5) {
    ev.lastBroadcastT = s.time;
    if (s.time < u.radioEndsAt) {
      const fc: Record<string, string> = { clear: 'clear skies', cloudy: 'overcast', rain: 'rain', storm: 'severe storms', fog: 'dense fog', snow: 'snow' };
      const flavor = FLAVOR[Math.floor(rt.rng.next() * FLAVOR.length)];
      log(s, `RADIO: "Weather: ${fc[s.weather.forecast]} expected later. Temperatures around ${Math.round(s.weather.temp)}°C. ${flavor}"`, 'radio');
    } else if (s.time - u.radioEndsAt < 6) {
      log(s, 'RADIO: [static]... nothing but static now.', 'radio');
    }
  }
}

// ================================================================== fire

function flammability(s: GameState, i: number): number {
  const w = s.world;
  const st = w.struct[i];
  if (st === S.Wall) {
    const b = w.buildings[w.bld[i]];
    return !b ? 0.2 : ['house', 'farmhouse', 'cabin', 'shed', 'barn', 'motel', 'apartment'].includes(b.kind) ? 0.55 : 0.15;
  }
  if (st === S.BuiltWall) return 0.6;
  if (st === S.Door) return 0.5;
  if (st === S.Window) return 0.3;
  if (st === S.Tree) return 0.35;
  if (st === S.FenceLow || st === S.FenceHigh) return w.structRef[i] === 1 ? 0 : 0.5;
  const f = w.furn[i];
  let fl = f >= 0 ? FURN[w.furniture[f].kind].flammable : 0;
  const g = w.ground[i];
  const dry = s.weather.rain < 0.05 ? 1 : 0.2;
  const gfl = g === G.FloorWood || g === G.FloorCarpet ? 0.7 : g === G.FloorTile || g === G.FloorLino ? 0.25 : g === G.Grass ? 0.25 * dry : g === G.TallGrass || g === G.Forest ? 0.45 * dry : g === G.Field || g === G.Furrow ? 0.2 * dry : 0;
  fl = Math.max(fl, gfl);
  return fl;
}

export function updateFires(s: GameState, rt: Runtime, dt: number): void {
  const w = s.world;
  const keys = Object.keys(s.fires);
  if (!keys.length) return;
  const p = s.player;
  let changed = false;
  for (const k of keys) {
    const i = Number(k);
    const f = s.fires[i];
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    const outdoor = w.room[i] < 0 && w.struct[i] !== S.Wall;
    f.heat = clamp(f.heat + dt * 0.08 - (outdoor ? s.weather.rain * dt * 0.25 : 0), 0, 1);
    f.fuel -= dt / 110;
    // spread
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const j = ny * w.w + nx;
      if (s.fires[j] || w.ground[j] === G.Burnt) continue;
      const fl = flammability(s, j);
      if (fl > 0 && rt.rng.chance(dt * f.heat * fl * 0.09)) {
        s.fires[j] = { heat: 0.2, fuel: 0.6 + fl * 0.8, t: s.time };
        changed = true;
      }
    }
    // hurt things in the flames
    if (Math.hypot(p.x - (x + 0.5), p.y - (y + 0.5)) < 0.9 && p.inVehicle < 0 && rt.rng.chance(dt * f.heat * 0.9)) {
      addInjury(s, rt, rt.rng.pick(['lLeg', 'rLeg', 'lHand', 'rHand', 'torso'] as const), 'burn', 0.3 + f.heat * 0.4, 'caught in a fire');
      log(s, 'The flames burn you!', 'danger');
    }
    for (const z of zombiesNear(s, rt, x + 0.5, y + 0.5, 0.8, [])) {
      z.hp -= dt * f.heat * 0.6;
      if (z.hp <= 0) zombieDies(s, rt, z);
    }
    if (rt.rng.chance(dt * 0.3)) emitNoise(s, rt, { x: x + 0.5, y: y + 0.5, radius: 5, kind: 'fire', src: 'world', label: 'Fire crackles' });
    if (f.fuel <= 0 || f.heat <= 0.02) {
      delete s.fires[i];
      changed = true;
      burnTile(s, rt, i);
    }
  }
  if (changed) rt.lightDirty = true;
  rt.fireLightT += dt;
  if (rt.fireLightT > 0.6) {
    rt.fireLightT = 0;
    rt.lightDirty = true;
  }
  s.stats.hitsTaken += 0;
}

function burnTile(s: GameState, rt: Runtime, i: number): void {
  const w = s.world;
  const st = w.struct[i];
  if (st === S.Wall || st === S.BuiltWall || st === S.Door || st === S.Window || st === S.FenceLow || st === S.FenceHigh || st === S.Tree) {
    if (st === S.Wall && rt.rng.chance(0.35)) {
      // some walls survive as charred frames
    } else {
      w.struct[i] = S.None;
      delete w.builtWalls[i];
      w.rev.walls++;
      w.rev.doors++;
    }
  }
  const f = w.furn[i];
  if (f >= 0) {
    const ff = w.furniture[f];
    if (FURN[ff.kind].flammable > 0.3) {
      ff.gone = true;
      w.furn[i] = -1;
      if (ff.containerId >= 0) w.containers[ff.containerId].items = [];
      w.rev.furn++;
    }
  }
  if (s.floor[i]) {
    delete s.floor[i];
    rt.dirty.floor = true;
  }
  if (w.ground[i] !== G.Water && w.ground[i] !== G.Road && w.ground[i] !== G.Sidewalk) w.ground[i] = G.Burnt;
  w.decal[i] |= 4;
  w.rev.ground++;
  rt.fovDirty = true;
}

// ================================================================== periodic world simulation

let accum = 0;
let hourAccum = 0;
let trapCd: Record<number, number> = {};

export function resetWorldSystems(): void {
  accum = 0;
  hourAccum = 0;
  trapCd = {};
}

export function updateWorld(s: GameState, rt: Runtime, dt: number, hours: number): void {
  updateWeather(s, rt, hours);
  updateFires(s, rt, dt);
  updateCrops(s, hours, s.weather.rain);
  accum += dt;
  hourAccum += hours;
  if (accum >= 1) {
    const step = accum;
    accum = 0;
    perSecond(s, rt, step);
  }
  if (hourAccum >= 0.25) {
    ageFood(s, hourAccum);
    hourAccum = 0;
    updateUtilities(s, rt);
    updateEvents(s, rt);
  }
}

function perSecond(s: GameState, rt: Runtime, dt: number): void {
  const w = s.world;
  const p = s.player;
  const hours = realToGame(s, dt);
  updateCooking({ s, rt }, hours);
  // building alarms
  rt.alarmSound = 0;
  for (const b of w.buildings) {
    if (b.alarmUntil <= s.time) continue;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    emitNoise(s, rt, { x: cx, y: cy, radius: 46, kind: 'alarm', src: 'world', label: 'An alarm is wailing' });
    const d = Math.hypot(cx - p.x, cy - p.y);
    rt.alarmSound = Math.max(rt.alarmSound, clamp(1 - d / 80, 0, 1));
  }
  // generators
  for (const f of w.furniture) {
    if (f.gone) continue;
    if (f.kind === 'generator' && f.on) {
      f.fuel = Math.max(0, (f.fuel ?? 0) - hours * 0.6);
      if ((f.fuel ?? 0) <= 0) {
        f.on = false;
        rt.lightDirty = true;
        if (Math.hypot(f.x - p.x, f.y - p.y) < 25) log(s, 'The generator sputters and dies. Out of fuel.', 'warn');
      }
      if (rt.rng.chance(dt / 3)) emitNoise(s, rt, { x: f.x + 0.5, y: f.y + 0.5, radius: 20, kind: 'generator', src: 'world', label: 'A generator is running' });
      const gi = f.y * w.w + f.x;
      const pi = Math.floor(p.y) * w.w + Math.floor(p.x);
      if (w.room[gi] >= 0 && w.bld[gi] === w.bld[pi] && w.room[pi] >= 0) {
        p.needs.co = clamp(p.needs.co + hours * 0.35, 0, 1);
        if (p.needs.co > 0.25 && rt.rng.chance(dt * 0.1)) log(s, 'Your head is pounding. The air feels thick.', 'danger');
      }
    }
    if (f.kind === 'rainbarrel' && s.weather.rain > 0.05 && w.room[f.y * w.w + f.x] < 0) {
      f.water = Math.min(40, (f.water ?? 0) + s.weather.rain * hours * 6);
    }
    if (f.kind === 'alarmtrap') {
      const cd = trapCd[f.id] ?? 0;
      if (cd > s.time) continue;
      const near = zombiesNear(s, rt, f.x + 0.5, f.y + 0.5, 0.7, []);
      if (near.length) {
        trapCd[f.id] = s.time + realToGame(s, 15);
        emitNoise(s, rt, { x: f.x + 0.5, y: f.y + 0.5, radius: 12, kind: 'cans', src: 'world', label: 'Tin cans rattle' });
        if (Math.hypot(f.x - p.x, f.y - p.y) < 25) {
          log(s, 'Your tin-can alarm rattles!', 'danger');
          if (p.sleeping) {
            p.sleeping = false;
            rt.wakeReason = 'The tin cans woke you.';
          }
        }
      }
    }
  }
  // flashlight battery
  if (p.flashlight) {
    const fl = p.inventory.find((i) => i.id === 'flashlight');
    if (fl) {
      fl.charge = Math.max(0, (fl.charge ?? 0) - hours * 0.05);
      if ((fl.charge ?? 0) <= 0) {
        p.flashlight = false;
        log(s, 'Your flashlight dies.', 'warn');
      }
    }
  }
  // alarm clocks on the floor
  for (const k of Object.keys(s.floor)) {
    for (const it of s.floor[Number(k)]) {
      if (it.id !== 'alarmClock' || it.timer === undefined || it.timer <= 0) continue;
      it.timer -= dt;
      if (it.timer <= 0) {
        const i = Number(k);
        for (let n = 0; n < 5; n++) emitNoise(s, rt, { x: (i % w.w) + 0.5, y: Math.floor(i / w.w) + 0.5, radius: 18, kind: 'clock', src: 'player', label: 'An alarm clock is ringing' });
        log(s, 'Your alarm clock starts ringing.', 'info');
      }
    }
  }
  // corpses rising (infected survivors)
  for (const cp of s.corpses) {
    if (cp.riseAt !== undefined && s.time >= cp.riseAt) {
      const z = newZombie(s, rt.rng, cp.x, cp.y, 'survivor');
      z.name = cp.name;
      z.formerPlayer = true;
      z.outfit = cp.outfit;
      z.items = cp.items ?? cp.extra ?? null;
      z.state = 'down';
      z.downT = 3;
      s.zombies.push(z);
      cp.riseAt = undefined;
      (cp as { gone?: boolean }).gone = true;
      if (Math.hypot(cp.x - p.x, cp.y - p.y) < 20) log(s, `${cp.name ?? 'The body'} twitches... and gets up.`, 'danger');
    }
  }
  if (s.corpses.some((cp) => (cp as { gone?: boolean }).gone)) {
    s.corpses = s.corpses.filter((cp) => !(cp as { gone?: boolean }).gone);
    rt.dirty.corpses = true;
  }
  // coughing when sick: a sick survivor is a noisy survivor
  if ((p.needs.cold > 0.3 || p.needs.sick > 0.5) && !p.dead && rt.rng.chance(dt * 0.025 * (p.needs.cold + p.needs.sick))) {
    emitNoise(s, rt, { x: p.x, y: p.y, radius: 7, kind: 'cough', src: 'player' });
    log(s, 'You cough loudly.', 'warn');
  }
  // helicopter & scripted-free event motion
  updateHelicopter(s, rt, dt);
  updateGunfire(s, rt, dt);
}

function ageFood(s: GameState, hours: number): void {
  const p = s.player;
  const tick = (it: { age: number; id: string }, rate: number): void => {
    if (def(it.id).food?.spoil) it.age += hours * rate;
  };
  for (const it of p.inventory) tick(it, 1);
  for (const it of p.bag?.contents ?? []) tick(it, 1);
  for (const cont of s.world.containers) {
    if (!cont.items || !cont.items.length) continue;
    const cold = cont.kind === 'fridge' || cont.kind === 'freezer' || cont.kind === 'cooler';
    let rate = 1;
    if (cold) {
      const f = s.world.furniture.find((ff) => ff.containerId === cont.id);
      if (f && buildingPowered(s, f.bld)) rate = cont.kind === 'freezer' ? 0.05 : 0.3;
    }
    for (const it of cont.items) tick(it, rate);
  }
  for (const k of Object.keys(s.floor)) for (const it of s.floor[Number(k)]) tick(it, 1);
  void freshness;
}

// ================================================================== events

function farPoint(s: GameState, rt: Runtime, min: number, max: number): { x: number; y: number } {
  const p = s.player;
  const w = s.world;
  for (let t = 0; t < 30; t++) {
    const a = rt.rng.range(0, Math.PI * 2);
    const d = rt.rng.range(min, max);
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    if (x > 5 && y > 5 && x < w.w - 5 && y < w.h - 5) return { x, y };
  }
  return { x: w.w / 2, y: w.h / 2 };
}

function updateEvents(s: GameState, rt: Runtime): void {
  const ev = s.events;
  if (s.time < ev.nextEventT) return;
  ev.nextEventT = s.time + rt.rng.range(4, 11);
  const day = dayNumber(s.time);
  const opts: [string, number][] = [
    ['gunfire', 3], ['survivor', day > 1 ? 2 : 0], ['alarm', s.util.powerOff ? 0.3 : 2.5], ['crash', 1.5], ['migration', day >= 2 ? 2 : 0.5],
    ['fire', day > 3 ? 0.8 : 0.2], ['helicopter', !ev.helicopterDone && day >= 2 && day <= 7 ? 3 : 0],
  ];
  const kind = rt.rng.weighted(opts);
  const p = s.player;
  switch (kind) {
    case 'gunfire': {
      const pt = farPoint(s, rt, 45, 110);
      ev.gunfire = { x: pt.x, y: pt.y, vx: 0, vy: 0, shotsLeft: rt.rng.int(3, 9), nextShot: 0 };
      break;
    }
    case 'survivor': {
      const pt = farPoint(s, rt, 50, 100);
      const a = rt.rng.range(0, Math.PI * 2);
      ev.gunfire = { x: pt.x, y: pt.y, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6, shotsLeft: rt.rng.int(8, 16), nextShot: 0 };
      break;
    }
    case 'alarm': {
      const cands = s.world.buildings.filter((b) => b.alarm && !b.visited && Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.y0 + b.y1) / 2 - p.y) > 40);
      if (cands.length) {
        const b = rt.rng.pick(cands);
        // a zombie inside blundered into a window
        const win = b.windows.map((i) => s.world.windows[i]).find((wi) => wi.state === 0);
        if (win) {
          win.state = WIN_BROKEN;
          s.world.rev.doors++;
        }
        triggerAlarm(s, rt, b.id, 'window');
        const d = Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.y0 + b.y1) / 2 - p.y);
        if (d < 120) log(s, `An alarm starts wailing ${describeDirection(s, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)}.`, 'sound');
      }
      break;
    }
    case 'crash': {
      const pt = roadPointFar(s, rt, 50, 110) ?? farPoint(s, rt, 50, 110);
      spawnWreck(s, rt, pt.x, pt.y);
      for (let k = 0; k < 3; k++) emitNoise(s, rt, { x: pt.x, y: pt.y, radius: 35, kind: 'crash', src: 'world', label: 'A distant car crash' });
      if (Math.hypot(pt.x - p.x, pt.y - p.y) < 110) log(s, `Tires screech and metal crunches ${describeDirection(s, pt.x, pt.y)}. Someone else is out there.`, 'sound');
      break;
    }
    case 'migration':
      startMigration(s, rt);
      break;
    case 'fire': {
      const cands = s.world.buildings.filter((b) => !b.visited && Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.y0 + b.y1) / 2 - p.y) > 50);
      if (cands.length) {
        const b = rt.rng.pick(cands);
        const r = s.world.rooms[rt.rng.pick(b.rooms)];
        if (r) {
          const i = Math.floor((r.y0 + r.y1) / 2) * s.world.w + Math.floor((r.x0 + r.x1) / 2);
          startFire(s, rt, i, 'a building is burning');
          log(s, `A column of smoke rises ${describeDirection(s, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)}.`, 'sound');
        }
      }
      break;
    }
    case 'helicopter': {
      ev.helicopterDone = true;
      const w = s.world;
      // fly across the map, passing near the survivor's area
      const fromLeft = rt.rng.chance(0.5);
      const y0 = clamp(p.y + rt.rng.range(-30, 30), 10, w.h - 10);
      const x = fromLeft ? -10 : w.w + 10;
      const dx = (p.x + rt.rng.range(-15, 15)) - x;
      const dy = (p.y + rt.rng.range(-15, 15)) - y0;
      const dl = Math.hypot(dx, dy);
      ev.heli = { x, y: y0, vx: (dx / dl) * 6, vy: (dy / dl) * 6, until: s.time + realToGame(s, 180), lingerT: 0, active: true };
      log(s, 'The thump of rotor blades grows louder. A helicopter is coming.', 'warn');
      chronicle(s, 'A helicopter flew over town.', 3);
      break;
    }
    default:
      break;
  }
}

function roadPointFar(s: GameState, rt: Runtime, min: number, max: number): { x: number; y: number } | null {
  const w = s.world;
  for (let t = 0; t < 60; t++) {
    const pt = farPoint(s, rt, min, max);
    const x = Math.floor(pt.x);
    const y = Math.floor(pt.y);
    if (w.ground[y * w.w + x] === G.Road && w.struct[y * w.w + x] === S.None) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

function spawnWreck(s: GameState, rt: Runtime, x: number, y: number): void {
  if (s.vehicles.some((v) => Math.hypot(v.x - x, v.y - y) < 6)) return;
  const v = createVehicle(s.world, rt.rng, s, s.vehicles.length, { x, y, heading: rt.rng.range(-Math.PI, Math.PI), crashed: true, key: rt.rng.chance(0.5) ? 'ignition' : 'none' });
  v.wrecked = rt.rng.chance(0.4);
  s.vehicles.push(v);
  // the driver didn't make it far
  const z = newZombie(s, rt.rng, x + rt.rng.range(-2, 2), y + rt.rng.range(-2, 2), 'survivor');
  z.items = [makeItem(s, 'carKey', { keyId: v.keyId, label: 'Car key' })];
  s.zombies.push(z);
}

function updateGunfire(s: GameState, rt: Runtime, dt: number): void {
  const g = s.events.gunfire;
  if (!g) return;
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.nextShot -= dt;
  if (g.nextShot <= 0) {
    g.nextShot = rt.rng.range(0.4, 3.5);
    g.shotsLeft--;
    emitNoise(s, rt, { x: g.x, y: g.y, radius: 50, kind: 'gunshot', src: 'world', label: 'Distant gunfire' });
    if (g.shotsLeft === 0 && g.vx) {
      const p = s.player;
      if (Math.hypot(g.x - p.x, g.y - p.y) < 130) log(s, 'The gunfire stops abruptly. Then a scream. Then nothing.', 'sound');
    }
  }
  if (g.shotsLeft <= 0) s.events.gunfire = null;
}

function updateHelicopter(s: GameState, rt: Runtime, dt: number): void {
  const h = s.events.heli;
  if (!h || !h.active) return;
  const p = s.player;
  const w = s.world;
  const pi = Math.floor(p.y) * w.w + Math.floor(p.x);
  const exposed = w.room[pi] < 0 && !p.dead;
  const d = Math.hypot(h.x - p.x, h.y - p.y);
  if (exposed && d < 22) {
    // circle the survivor
    h.lingerT += dt;
    const a = Math.atan2(h.y - p.y, h.x - p.x) + dt * 0.35;
    h.x = p.x + Math.cos(a) * 9;
    h.y = p.y + Math.sin(a) * 9;
    h.vx = -Math.sin(a);
    h.vy = Math.cos(a);
    if (h.lingerT < dt * 1.5) {
      log(s, 'The helicopter\'s spotlight finds you. It circles overhead — the whole town can hear it. Get under a roof!', 'danger');
      note(s, 'helicopter');
      chronicle(s, 'The helicopter circled overhead, dragging the dead along.', 4);
    }
  } else {
    h.lingerT = Math.max(0, h.lingerT - dt * 0.5);
    const sp = Math.hypot(h.vx, h.vy) || 1;
    if (sp < 3) {
      h.vx *= 6 / sp;
      h.vy *= 6 / sp;
    }
    h.x += h.vx * dt;
    h.y += h.vy * dt;
  }
  if (rt.rng.chance(dt / 1.5)) emitNoise(s, rt, { x: h.x, y: h.y, radius: 48, kind: 'heli', src: 'world', label: 'A helicopter' });
  rt.helicopterSound = clamp(1 - d / 90, 0, 1);
  if (h.x < -30 || h.y < -30 || h.x > w.w + 30 || h.y > w.h + 30 || s.time > h.until) {
    h.active = false;
    s.events.heli = null;
    rt.helicopterSound = 0;
  }
}

function startMigration(s: GameState, rt: Runtime): void {
  const w = s.world;
  const p = s.player;
  // A group arrives from outside town along a road, far from the survivor.
  const entries = [
    { x: 17, y: 2 }, { x: 17, y: w.h - 3 }, { x: 300, y: HY[2] + 3 }, { x: 286, y: HY[0] + 3 },
  ].filter((e) => Math.hypot(e.x - p.x, e.y - p.y) > 110);
  const useEdge = entries.length > 0 && rt.rng.chance(0.55);
  const target = { x: rt.rng.pick(VX) + 3, y: rt.rng.pick(HY) + 3 };
  const gid = s.nextGroupId++;
  if (useEdge) {
    const e = rt.rng.pick(entries);
    const n = rt.rng.int(6, 14);
    for (let k = 0; k < n; k++) {
      const z = newZombie(s, rt.rng, e.x + rt.rng.range(-3, 3), e.y + rt.rng.range(-3, 3));
      z.group = gid;
      z.state = 'investigate';
      z.tx = target.x + rt.rng.range(-4, 4);
      z.ty = target.y + rt.rng.range(-4, 4);
      z.interest = 900;
      z.targetPri = 5;
      s.zombies.push(z);
    }
    if (Math.hypot(e.x - p.x, e.y - p.y) < 160) log(s, `A low chorus of moans drifts in ${describeDirection(s, e.x, e.y)}. A crowd is moving into town.`, 'sound');
  } else {
    // a cluster somewhere far away starts to drift
    const far = s.zombies.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) > 70 && z.state === 'idle');
    if (!far.length) return;
    const seed = rt.rng.pick(far);
    const group = far.filter((z) => Math.hypot(z.x - seed.x, z.y - seed.y) < 18).slice(0, 20);
    for (const z of group) {
      z.group = gid;
      z.state = 'investigate';
      z.tx = target.x + rt.rng.range(-4, 4);
      z.ty = target.y + rt.rng.range(-4, 4);
      z.interest = 900;
      z.path = null;
    }
  }
}
