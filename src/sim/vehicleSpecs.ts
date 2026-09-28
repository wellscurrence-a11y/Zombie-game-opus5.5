import type { Rng } from '../core/rng';
import type { VehicleSpawn } from '../world/gen/builder';
import type { World } from '../world/world';
import { makeItem, type UidSource } from './items';
import type { Vehicle, VehType } from './types';

export interface VehSpec {
  name: string;
  w: number;
  l: number;
  /** Top speed m/s. */
  top: number;
  accel: number;
  mass: number;
  fuelCap: number;
  /** Litres per metre driven. */
  burn: number;
  trunk: number;
  seats: number;
  colors: number[];
  height: number;
}

export const VEH: Record<VehType, VehSpec> = {
  sedan: { name: 'Sedan', w: 2.0, l: 4.4, top: 28, accel: 4.2, mass: 1.0, fuelCap: 50, burn: 0.012, trunk: 40, seats: 4, height: 1.45, colors: [0x5a6b7a, 0x7c2f2a, 0x9aa0a4, 0x2d3a4a, 0xb8b2a2, 0x3f4a3b, 0x6e6259] },
  hatch: { name: 'Hatchback', w: 1.9, l: 3.8, top: 25, accel: 3.8, mass: 0.85, fuelCap: 40, burn: 0.009, trunk: 25, seats: 4, height: 1.45, colors: [0x8a3b2e, 0x4c6a5b, 0xc2b58f, 0x3c4f66, 0x7e7f84] },
  pickup: { name: 'Pickup truck', w: 2.1, l: 5.0, top: 26, accel: 4.0, mass: 1.4, fuelCap: 70, burn: 0.017, trunk: 60, seats: 2, height: 1.8, colors: [0x6a4b35, 0x3e4e5f, 0x8c8c86, 0x5b2724, 0x2f3b2c] },
  van: { name: 'Van', w: 2.2, l: 5.0, top: 24, accel: 3.3, mass: 1.6, fuelCap: 70, burn: 0.018, trunk: 90, seats: 2, height: 2.2, colors: [0xd8d4c8, 0x6f7b85, 0x4f5f4b, 0x9b8a6d] },
  police: { name: 'Police cruiser', w: 2.0, l: 4.6, top: 33, accel: 5.2, mass: 1.1, fuelCap: 60, burn: 0.014, trunk: 40, seats: 4, height: 1.5, colors: [0x1f2a38] },
  truck: { name: 'Box truck', w: 2.5, l: 7.0, top: 21, accel: 2.4, mass: 2.8, fuelCap: 150, burn: 0.03, trunk: 200, seats: 2, height: 3.0, colors: [0xcfcbc0, 0x7d6b4f, 0x4b5a66] },
  military: { name: 'Military truck', w: 2.5, l: 6.0, top: 23, accel: 3.0, mass: 2.6, fuelCap: 120, burn: 0.026, trunk: 150, seats: 2, height: 2.8, colors: [0x4c5536] },
  firetruck: { name: 'Fire engine', w: 2.5, l: 7.4, top: 22, accel: 2.6, mass: 3.0, fuelCap: 180, burn: 0.034, trunk: 120, seats: 2, height: 3.0, colors: [0xa3211c] },
  ambulance: { name: 'Ambulance', w: 2.3, l: 5.8, top: 27, accel: 3.4, mass: 1.8, fuelCap: 80, burn: 0.02, trunk: 70, seats: 2, height: 2.6, colors: [0xe4e0d6] },
  sports: { name: 'Sports car', w: 1.9, l: 4.2, top: 38, accel: 6.5, mass: 0.9, fuelCap: 45, burn: 0.015, trunk: 15, seats: 2, height: 1.2, colors: [0x9e1b1b, 0x1b3f9e, 0xd9b31a, 0x1d1d1d] },
};

export function createVehicle(w: World, rng: Rng, uid: UidSource, id: number, sp: VehicleSpawn): Vehicle {
  let type: VehType = (sp.type as VehType) ?? rng.weighted<VehType>([['sedan', 35], ['hatch', 20], ['pickup', 20], ['van', 10], ['sports', 4]]);
  if (sp.police) type = 'police';
  if (sp.military) type = 'military';
  const spec = VEH[type];
  const crashed = !!sp.crashed;
  const trunk = w.containers.length;
  w.containers.push({ id: trunk, kind: 'trunk', capacity: spec.trunk, items: null, loot: `vehicle|${type}`, x: Math.floor(sp.x), y: Math.floor(sp.y), searched: false });
  const glove = w.containers.length;
  w.containers.push({ id: glove, kind: 'glovebox', capacity: 4, items: null, loot: `vehicle|${type}`, x: Math.floor(sp.x), y: Math.floor(sp.y), searched: false });
  const keyId = w.nextKeyId++;
  const v: Vehicle = {
    id, type, x: sp.x, y: sp.y, heading: sp.heading, speed: 0, steer: 0,
    color: rng.pick(spec.colors),
    engineOn: false,
    engine: crashed ? rng.range(0, 30) : rng.range(35, 100),
    battery: crashed ? rng.range(0, 0.5) : rng.range(0.15, 1),
    fuel: spec.fuelCap * (rng.chance(0.25) ? 0 : rng.range(0.02, rng.chance(0.2) ? 0.8 : 0.3)),
    fuelCap: spec.fuelCap,
    tires: [0, 1, 2, 3].map(() => (rng.chance(crashed ? 0.3 : 0.06) ? 0 : rng.range(55, 100))),
    body: crashed ? rng.range(10, 50) : rng.range(55, 100),
    front: crashed ? rng.range(40, 100) : rng.range(0, 15),
    rear: crashed ? rng.range(0, 40) : rng.range(0, 10),
    windows: crashed ? [rng.int(1, 2), rng.int(0, 2), rng.int(0, 1), rng.int(0, 1)] : [0, 0, 0, 0],
    locked: rng.chance(crashed ? 0.2 : 0.6),
    keyId,
    hotwired: false,
    keyInIgnition: sp.key === 'ignition',
    hasAlarm: !crashed && type !== 'military' && rng.chance(0.2),
    alarmUntil: 0,
    lights: false,
    trunk,
    glovebox: glove,
    wrecked: crashed && rng.chance(0.55),
    horn: false,
    noiseT: 0,
    stallT: 0,
  };
  if (v.keyInIgnition) v.locked = false;
  const label = `Car key (${colorName(v.color)} ${spec.name.toLowerCase()})`;
  if (sp.key === 'glovebox') {
    (w.containers[glove].extra ??= []).push(makeItem(uid, 'carKey', { keyId, label }));
    v.locked = false;
  } else if (sp.key === 'house' && sp.bld !== undefined) {
    const b = w.buildings[sp.bld];
    const cands: number[] = [];
    for (const rid of b.rooms) {
      const r = w.rooms[rid];
      if (!['kitchen', 'living', 'bedroom', 'office', 'garage', 'cabin', 'waiting', 'command', 'reception', 'gearRoom'].includes(r.type)) continue;
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          const fi = w.furn[y * w.w + x];
          if (fi >= 0 && w.furniture[fi].containerId >= 0) cands.push(w.furniture[fi].containerId);
        }
      }
    }
    if (cands.length) (w.containers[rng.pick(cands)].extra ??= []).push(makeItem(uid, 'carKey', { keyId, label }));
  }
  return v;
}

export function colorName(c: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 50) return 'black';
  if (max - min < 25) return max > 180 ? 'white' : max > 110 ? 'grey' : 'dark grey';
  if (r >= g && r >= b) return g > 150 ? 'yellow' : g > b + 20 && r - g < 50 ? 'brown' : 'red';
  if (g >= r && g >= b) return 'green';
  return 'blue';
}

/** The four corners of a vehicle's footprint (tile coordinates). */
export function vehCorners(v: Vehicle, pad = 0): [number, number][] {
  const s = VEH[v.type];
  const hl = s.l / 2 + pad;
  const hw = s.w / 2 + pad;
  const c = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  return [
    [v.x + c * hl - sn * hw, v.y + sn * hl + c * hw],
    [v.x + c * hl + sn * hw, v.y + sn * hl - c * hw],
    [v.x - c * hl + sn * hw, v.y - sn * hl - c * hw],
    [v.x - c * hl - sn * hw, v.y - sn * hl + c * hw],
  ];
}

/** Is point (px,py) inside the vehicle footprint (with padding)? */
export function inVehicle(v: Vehicle, px: number, py: number, pad = 0): boolean {
  const s = VEH[v.type];
  const dx = px - v.x;
  const dy = py - v.y;
  const c = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  const lx = dx * c + dy * sn;
  const ly = -dx * sn + dy * c;
  return Math.abs(lx) <= s.l / 2 + pad && Math.abs(ly) <= s.w / 2 + pad;
}

/** Closest point on the vehicle footprint to (px,py), and whether the point is inside. */
export function vehClosest(v: Vehicle, px: number, py: number): { x: number; y: number; inside: boolean } {
  const s = VEH[v.type];
  const dx = px - v.x;
  const dy = py - v.y;
  const c = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  let lx = dx * c + dy * sn;
  let ly = -dx * sn + dy * c;
  const inside = Math.abs(lx) <= s.l / 2 && Math.abs(ly) <= s.w / 2;
  lx = Math.max(-s.l / 2, Math.min(s.l / 2, lx));
  ly = Math.max(-s.w / 2, Math.min(s.w / 2, ly));
  return { x: v.x + lx * c - ly * sn, y: v.y + lx * sn + ly * c, inside };
}

/** Driver-side door position (left side, facing forward). */
export function driverDoor(v: Vehicle): [number, number] {
  const s = VEH[v.type];
  const c = Math.cos(v.heading);
  const sn = Math.sin(v.heading);
  // left of heading in a y-down world: (sin, -cos)
  const off = s.w / 2 + 0.55;
  return [v.x + c * 0.4 + sn * off, v.y + sn * 0.4 - c * off];
}
