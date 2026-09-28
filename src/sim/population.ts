// Initial zombie population. Zombies are placed where people would plausibly have been when it started —
// never near the survivor's starting point. After this, no zombie is ever conjured near the player.
import type { Rng } from '../core/rng';
import { S, G, type World, ZONE_RES, ZONE_COM, ZONE_IND, ZONE_PARK, ZONE_FOREST, ZONE_HIGHWAY, ZONE_FARM, ZONE_WILD } from '../world/world';
import { FURN } from '../world/furniture';
import type { GameState, Zombie, ZKind } from './types';
import { makeItem } from './items';
import { inVehicle } from './vehicleSpecs';

/**
 * Every zombie is the same kind of shambler: slower than a walking survivor, equally tough, equally keen.
 * Only tiny natural differences remain; clothes and pockets still show who they were.
 */
export const Z_SPEED = 0.88;
export const Z_HP = 2.4;

export function newZombie(s: GameState, rng: Rng, x: number, y: number, kind: ZKind = 'civ'): Zombie {
  const crawler = false;
  const speed = Math.max(0.82, Math.min(0.94, rng.gauss(Z_SPEED, 0.03)));
  const hp = Math.max(2.2, Math.min(2.6, rng.gauss(Z_HP, 0.1)));
  const z: Zombie = {
    id: s.nextZombieId++,
    x, y,
    facing: rng.range(-Math.PI, Math.PI),
    speed, hp, maxHp: hp,
    state: 'idle',
    timer: rng.range(0, 20),
    tx: x, ty: y, targetPri: 0,
    awareness: 0,
    lastSeenX: 0, lastSeenY: 0, lastSeenT: -1, sinceSeen: 999,
    path: null, pathI: 0, pathT: 0,
    downT: 0, staggerT: 0, attackT: 0,
    crawler,
    outfit: rng.int(0, 0xffffff),
    kind,
    bangIdx: -1, bangT: 0,
    hearing: rng.range(0.92, 1.08),
    sight: rng.range(0.92, 1.08),
    items: null,
    grabbing: false,
    vx: 0, vy: 0,
    anim: rng.range(0, 10),
    moanT: rng.range(5, 30),
    climbT: 0,
    lodAcc: 0,
    interest: 0,
    group: -1,
    stuckT: 0,
    lastX: x, lastY: y,
  };
  return z;
}

/** Older saves had crawlers and fast runners; bring them in line with everyone else. */
export function normalizeZombies(s: GameState): void {
  for (const z of s.zombies) {
    z.crawler = false;
    z.speed = Math.max(0.82, Math.min(0.94, z.speed));
    if (z.maxHp > 2.6 || z.maxHp < 2.2) {
      const k = z.hp / z.maxHp;
      z.maxHp = Math.max(2.2, Math.min(2.6, z.maxHp));
      z.hp = z.maxHp * k;
    }
    z.hearing = Math.max(0.92, Math.min(1.08, z.hearing));
    z.sight = Math.max(0.92, Math.min(1.08, z.sight));
  }
}

function isFreeTile(w: World, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) return false;
  const i = y * w.w + x;
  const st = w.struct[i];
  if (st !== S.None && st !== S.Bush) return false;
  if (w.ground[i] === G.Water) return false;
  const f = w.furn[i];
  if (f >= 0 && FURN[w.furniture[f].kind].solid) return false;
  return true;
}

export function populate(s: GameState, rng: Rng, avoid: { x: number; y: number; r: number; bld: number }): void {
  const w = s.world;
  const pop = s.settings.population;
  const place = (x: number, y: number, kind: ZKind): Zombie | null => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (!isFreeTile(w, xi, yi)) return null;
    if (Math.hypot(x - avoid.x, y - avoid.y) < avoid.r) return null;
    if (w.bld[yi * w.w + xi] === avoid.bld) return null;
    for (const v of s.vehicles) if (inVehicle(v, x, y, 0.4)) return null;
    const z = newZombie(s, rng, xi + 0.5, yi + 0.5, kind);
    s.zombies.push(z);
    return z;
  };
  const scaled = (n: number): number => {
    const f = n * pop;
    return Math.floor(f) + (rng.chance(f - Math.floor(f)) ? 1 : 0);
  };

  // --- inside buildings
  const per: Record<string, [number, number, ZKind]> = {
    house: [0, 2, 'civ'], apartment: [3, 7, 'civ'], grocery: [3, 7, 'civ'], pharmacy: [1, 3, 'civ'], hardware: [1, 3, 'worker'],
    diner: [2, 5, 'civ'], bar: [3, 6, 'civ'], police: [3, 6, 'cop'], clinic: [4, 8, 'medic'], gas: [1, 2, 'civ'],
    garage: [1, 2, 'worker'], motel: [3, 6, 'civ'], warehouse: [3, 6, 'worker'], factory: [4, 8, 'worker'],
    church: [6, 11, 'civ'], office: [2, 4, 'civ'], farmhouse: [1, 3, 'farmer'], barn: [0, 2, 'farmer'], cabin: [0, 1, 'civ'],
    shed: [0, 0, 'civ'], checkpoint: [1, 2, 'soldier'],
  };
  for (const b of w.buildings) {
    const spec = per[b.kind];
    if (!spec || b.id === avoid.bld) continue;
    let n = rng.int(spec[0], spec[1]);
    if (b.kind === 'house' && rng.chance(0.3)) n = 0;
    n = scaled(n);
    const rooms = b.rooms.map((r) => w.rooms[r]);
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 20; tries++) {
        const r = rng.pick(rooms);
        const x = rng.int(r.x0, r.x1);
        const y = rng.int(r.y0, r.y1);
        if (w.room[y * w.w + x] !== r.id) continue;
        const kind: ZKind = spec[2] === 'medic' && rng.chance(0.5) ? 'civ' : spec[2];
        const z = place(x, y, kind);
        if (z) {
          // residents sometimes still carry their house keys
          if (b.kind === 'house' && rng.chance(0.35)) z.items = [makeItem(s, 'houseKey', { keyId: b.keyId, label: `House key (${b.address})` })];
          break;
        }
      }
    }
  }

  // --- outdoors, by zone
  const zoneTarget: Record<number, number> = {
    [ZONE_RES]: 95, [ZONE_COM]: 85, [ZONE_IND]: 30, [ZONE_PARK]: 12, [ZONE_FOREST]: 22, [ZONE_HIGHWAY]: 14, [ZONE_FARM]: 7, [ZONE_WILD]: 10,
  };
  const byZone: Record<number, number[]> = {};
  for (let i = 0; i < w.w * w.h; i++) {
    if (w.bld[i] >= 0) continue;
    const z = w.zone[i];
    if (!(z in zoneTarget)) continue;
    // sample sparsely to keep memory small
    if ((i * 2654435761) % 7 !== 0) continue;
    (byZone[z] ??= []).push(i);
  }
  for (const zs of Object.keys(zoneTarget)) {
    const zone = Number(zs);
    const tiles = byZone[zone];
    if (!tiles?.length) continue;
    let n = scaled(zoneTarget[zone]);
    while (n > 0) {
      const i = rng.pick(tiles);
      const cx = i % w.w;
      const cy = Math.floor(i / w.w);
      // groups of 1-4 stand together; the lone wanderer is common
      const size = Math.min(n, rng.weighted([[1, 5], [2, 3], [3, 2], [4, 1]]));
      let placed = 0;
      for (let k = 0; k < size * 4 && placed < size; k++) {
        const kind: ZKind = zone === ZONE_IND ? (rng.chance(0.6) ? 'worker' : 'civ') : zone === ZONE_FARM ? 'farmer' : 'civ';
        if (place(cx + rng.int(-2, 2), cy + rng.int(-2, 2), kind)) placed++;
      }
      n -= Math.max(1, placed);
    }
  }

  // --- special clusters
  for (let k = 0; k < scaled(9); k++) place(rng.range(24, 40), rng.range(22, 44), 'soldier');
  for (let k = 0; k < scaled(12); k++) place(rng.range(12, 23), rng.range(200, 240), 'civ');
  // cops loitering outside the station
  for (let k = 0; k < scaled(4); k++) place(rng.range(101, 142), rng.range(174, 192), 'cop');

  // A few carry the keys to nearby parked cars.
  for (const v of s.vehicles) {
    if (v.keyInIgnition || rng.chance(0.85)) continue;
    let best: Zombie | null = null;
    let bd = 12;
    for (const z of s.zombies) {
      const d = Math.hypot(z.x - v.x, z.y - v.y);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    if (best) (best.items ??= []).push(makeItem(s, 'carKey', { keyId: v.keyId, label: 'Car key' }));
  }
}
