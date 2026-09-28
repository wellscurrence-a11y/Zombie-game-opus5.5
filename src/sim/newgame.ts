import { Rng } from '../core/rng';
import { START_HOUR } from '../core/time';
import { generateWorld } from '../world/gen';
import { FURN } from '../world/furniture';
import { S, type World } from '../world/world';
import { makeItem } from './items';
import { populate } from './population';
import { blankXp, XP_T, lvl } from './skills';
import { OCCUPATIONS } from './traits';
import type { Body, GameState, Needs, Player, WorldSettings } from './types';
import { createVehicle } from './vehicleSpecs';
import { log } from './log';

export const SAVE_VERSION = 1;

export interface SurvivorSpec {
  name: string;
  occupation: string;
  traits: string[];
}

export const DEFAULT_SETTINGS: WorldSettings = {
  population: 1,
  loot: 1,
  dayLength: 45,
  powerDays: [5, 12],
  waterDays: [7, 16],
};

export function blankBody(): Body {
  return { injuries: [], health: 100, blood: 1, fever: false, feverT: 0, feverLevel: 0, nextInjuryId: 1 };
}

export function blankNeeds(): Needs {
  return {
    hunger: 0.12, thirst: 0.1, fatigue: 0.15, endurance: 1, temp: 37, wet: 0, stress: 0.15, panic: 0, sick: 0, sickCause: '',
    cold: 0, drunk: 0, painkiller: 0, calm: 0, antibiotic: 0, co: 0, craving: 0, boredom: 0, unhappy: 0,
  };
}

export function createPlayer(s: GameState, spec: SurvivorSpec, x: number, y: number, homeBld: number): Player {
  const occ = OCCUPATIONS.find((o) => o.id === spec.occupation) ?? OCCUPATIONS[0];
  const xp = blankXp();
  for (const [sk, l] of Object.entries(occ.skills)) {
    const cur = lvlFromXpRecord(xp, sk as keyof typeof xp);
    xp[sk as keyof typeof xp] = XP_T[Math.min(10, cur + (l ?? 0))];
  }
  const traits = [...new Set([...spec.traits, ...(occ.traits ?? [])])];
  const adj = (sk: 'strength' | 'fitness', d: number): void => {
    xp[sk] = XP_T[Math.max(0, Math.min(10, lvlFromXpRecord(xp, sk) + d))];
  };
  if (traits.includes('athletic')) adj('fitness', 2);
  if (traits.includes('unfit')) adj('fitness', -2);
  if (traits.includes('strong')) adj('strength', 2);
  if (traits.includes('weak')) adj('strength', -2);
  const p: Player = {
    name: spec.name, occupation: occ.id, traits,
    x, y, facing: Math.PI / 2, vx: 0, vy: 0, stance: 'stand', running: false, inVehicle: -1,
    body: blankBody(), needs: blankNeeds(), xp, bookBoost: {}, magazines: [...(occ.mags ?? [])],
    inventory: [], primary: 0, worn: {}, bag: null, flashlight: false,
    attackT: 0, attackDur: 0, attackHit: false, shoveT: 0, downT: 0, climbT: 0, climbDur: 0, climbFrom: [0, 0], climbTo: [0, 0], climbKind: '', climbTile: -1,
    aimT: 0, reloadT: 0, grabbedBy: [], sleeping: false, sleepQuality: 0, sleepUntil: 0,
    startT: s.time, kills: 0, dead: false, deathCause: '', lastHitT: -99, stepNoiseT: 0, carrying: -1, readingUid: 0,
  };
  const rng = new Rng(s.seed ^ (s.survivorIndex * 7919));
  p.worn.torso = makeItem(s, rng.pick(['tshirt', 'shirt', 'hoodie', 'sweater']));
  p.worn.legs = makeItem(s, rng.pick(['jeans', 'jeans', 'slacks']));
  p.worn.feet = makeItem(s, rng.pick(['sneakers', 'sneakers', 'dressShoes']));
  if (homeBld >= 0) {
    const b = s.world.buildings[homeBld];
    p.inventory.push(makeItem(s, 'houseKey', { keyId: b.keyId, label: `House key (${b.address})` }));
  }
  const bottle = makeItem(s, 'waterBottle');
  bottle.fill = 0.5;
  bottle.liquid = 'water';
  p.inventory.push(bottle);
  for (const id of occ.items) p.inventory.push(makeItem(s, id, id === 'bandage' ? { qty: 2 } : id === 'wipes' ? { qty: 3 } : {}));
  if (occ.id === 'guard') {
    const fl = p.inventory.find((i) => i.id === 'flashlight');
    if (fl) fl.charge = 0.8;
  }
  if (traits.includes('smoker')) {
    p.inventory.push(makeItem(s, 'cigarettes', { usesLeft: 6 }));
    p.inventory.push(makeItem(s, 'lighter'));
  }
  return p;
}

function lvlFromXpRecord(xp: Record<string, number>, sk: string): number {
  let l = 0;
  while (l < 10 && xp[sk] >= XP_T[l + 1]) l++;
  return l;
}

/** Pick a safe house for a new survivor: quiet street, few zombies nearby, far from `avoid`. */
export function pickStartHouse(s: GameState, rng: Rng, candidates: number[], avoid?: { x: number; y: number }): { bld: number; x: number; y: number } {
  const w = s.world;
  let best: { bld: number; x: number; y: number; score: number } | null = null;
  const pool = rng.shuffle(candidates.slice());
  for (const bid of pool.slice(0, 40)) {
    const b = w.buildings[bid];
    const living = b.rooms.map((r) => w.rooms[r]).find((r) => r.type === 'living') ?? w.rooms[b.rooms[0]];
    if (!living) continue;
    const spot = freeTileIn(w, living.x0, living.y0, living.x1, living.y1);
    if (!spot) continue;
    const [x, y] = spot;
    let near = 0;
    for (const z of s.zombies) {
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < 18) near += 18 - d;
    }
    let score = -near + rng.range(0, 5);
    if (avoid) {
      const d = Math.hypot(avoid.x - x, avoid.y - y);
      if (d < 60) score -= 100;
    }
    if (!best || score > best.score) best = { bld: bid, x, y, score };
  }
  if (!best) throw new Error('no start house');
  return { bld: best.bld, x: best.x + 0.5, y: best.y + 0.5 };
}

function freeTileIn(w: World, x0: number, y0: number, x1: number, y1: number): [number, number] | null {
  const cx = Math.floor((x0 + x1) / 2);
  const cy = Math.floor((y0 + y1) / 2);
  let best: [number, number] | null = null;
  let bd = 1e9;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w.w + x;
      if (w.room[i] < 0 || w.struct[i] !== S.None) continue;
      const f = w.furn[i];
      if (f >= 0 && FURN[w.furniture[f].kind].solid) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
  }
  return best;
}

export function newGame(seed: number, spec: SurvivorSpec, settings: WorldSettings = DEFAULT_SETTINGS): GameState {
  const gen = generateWorld(seed);
  const rng = new Rng(seed ^ 0xa11ce);
  const s: GameState = {
    version: SAVE_VERSION,
    id: `w${seed.toString(36)}-${Date.now().toString(36)}`,
    seed,
    settings: { ...settings },
    world: gen.world,
    time: START_HOUR,
    weather: { kind: 'clear', rain: 0, fog: 0, wind: 0.2, temp: 19, cloud: 0.2, nextChange: START_HOUR + rng.range(6, 14), forecast: 'cloudy', lightningT: 0 },
    util: {
      powerOffAt: rng.range(settings.powerDays[0], settings.powerDays[1]) * 24,
      waterOffAt: rng.range(settings.waterDays[0], settings.waterDays[1]) * 24,
      powerWarned: false, waterWarned: false, powerOff: false, waterOff: false,
      radioEndsAt: rng.range(9, 14) * 24,
    },
    player: null as unknown as Player,
    zombies: [],
    corpses: [],
    vehicles: [],
    floor: {},
    fires: {},
    events: { nextEventT: START_HOUR + rng.range(3, 8), heli: null, migrations: [], gunfire: null, helicopterDone: false, lastBroadcastT: -99 },
    log: [],
    chronicle: [],
    notes: [],
    survivorIndex: 1,
    graveyard: [],
    nextUid: gen.nextUid,
    nextZombieId: 1,
    nextCorpseId: 1,
    nextGroupId: 1,
    rng: (seed ^ 0x5eed) >>> 0,
    stats: { hitsTaken: 0, itemsLooted: 0, distance: 0, noisesMade: 0 },
    mapMarkers: [],
    hasMap: false,
    foraged: {},
    stationFuel: 1800,
  };
  for (const sp of gen.vehicles) s.vehicles.push(createVehicle(s.world, rng, s, s.vehicles.length, sp));
  removeOverlappingVehicles(s);
  // choose home first so the population can avoid it
  const home = pickStartHouse(s, rng, gen.quietHouses.length ? gen.quietHouses : gen.houses);
  populate(s, rng, { x: home.x, y: home.y, r: 24, bld: home.bld });
  s.player = createPlayer(s, spec, home.x, home.y, home.bld);
  secureHome(s, home.bld);
  log(s, `${spec.name} wakes up at home. The radio said to stay indoors. That was two days ago.`, 'info');
  log(s, 'Survive for as long as you can.', 'warn');
  log(s, 'WASD to move · Right-click things for options · E to open doors · Tab for inventory · Esc for help.', 'info');
  return s;
}

/** Lock the start house and close its windows so the first moments are quiet. */
export function secureHome(s: GameState, bld: number): void {
  const w = s.world;
  const b = w.buildings[bld];
  b.visited = true;
  b.alarm = false;
  for (const d of b.doors) {
    const door = w.doors[d];
    door.open = false;
    if (door.ext) {
      door.locked = true;
      door.lockKnown = true;
    }
  }
  for (const wi of b.windows) {
    const win = w.windows[wi];
    win.state = 0;
  }
}

function removeOverlappingVehicles(s: GameState): void {
  const w = s.world;
  const keep = [];
  for (const v of s.vehicles) {
    let bad = false;
    for (const k of keep) {
      if (Math.hypot(k.x - v.x, k.y - v.y) < 4.2) bad = true;
    }
    // no vehicles on walls/fences/trees
    const c = Math.cos(v.heading);
    const sn = Math.sin(v.heading);
    for (let a = -2; a <= 2 && !bad; a += 0.5) {
      for (let b = -0.9; b <= 0.9; b += 0.6) {
        const x = Math.floor(v.x + c * a - sn * b);
        const y = Math.floor(v.y + sn * a + c * b);
        const i = y * w.w + x;
        if (x < 0 || y < 0 || x >= w.w || y >= w.h) {
          bad = true;
          break;
        }
        if (w.struct[i] !== S.None || w.furn[i] >= 0 || (w.bld[i] >= 0 && w.room[i] < 0)) bad = true;
      }
    }
    if (!bad) keep.push(v);
  }
  keep.forEach((v, i) => (v.id = i));
  s.vehicles = keep;
}

export { lvl };
