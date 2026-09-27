// Procedural town generator for Cedar Hollow.
import { Rng, fbm, hash01 } from '../../core/rng';
import {
  G, S, MAP_W, MAP_H, createWorld, inB, type World,
  MARK_CENTER_H, MARK_CENTER_V, MARK_EDGE_N, MARK_EDGE_S, MARK_EDGE_W, MARK_EDGE_E, MARK_CROSS, MARK_STALL,
  ZONE_RES, ZONE_COM, ZONE_IND, ZONE_FARM, ZONE_FOREST, ZONE_HIGHWAY, ZONE_PARK, ZONE_WILD,
} from '../world';
import type { Gen, VehicleSpawn } from './builder';
import { nearDoor, placeFurn } from './builder';
import {
  genApartment, genAutoRepair, genBar, genBarn, genCabin, genChurch, genClinic, genDiner, genFactory, genGasStation,
  genGrocery, genHardware, genHouse, genMotel, genOffice, genPharmacy, genPolice, genShed, genTent, genWarehouse, hideKey, outdoor,
} from './buildings';

export const VX = [40, 92, 144, 196, 248];
export const HY = [52, 100, 148, 196, 244];
const RW = 7;
const V_NAMES = ['Ash Street', 'Birch Street', 'Cedar Street', 'Dogwood Street', 'Elm Street'];
const H_NAMES = ['North Road', 'Hill Avenue', 'Main Street', 'Lake Avenue', 'Mill Road'];
export const TOWN = { x0: 36, y0: 48, x1: 258, y1: 256 };
export const HIGHWAY = { x0: 12, x1: 22 };

export interface GenResult {
  world: World;
  vehicles: VehicleSpawn[];
  houses: number[];
  quietHouses: number[];
  nextUid: number;
}

export function generateWorld(seed: number): GenResult {
  const w = createWorld(MAP_W, MAP_H, seed);
  const g: Gen = { w, rng: new Rng(seed ^ 0x51f15e), vehicles: [], uid: { nextUid: 1 } };
  const houses: number[] = [];
  const quiet: number[] = [];

  terrain(g);
  river(g);
  roads(g);
  blocks(g, houses, quiet);
  countryside(g);
  forest(g);
  streetVehicles(g);
  lamps(g);
  for (const b of w.buildings) {
    if (b.kind !== 'house' && b.kind !== 'shed') {
      w.landmarks.push({ name: b.name, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, bld: b.id });
    }
  }
  return { world: w, vehicles: g.vehicles, houses, quietHouses: quiet, nextUid: g.uid.nextUid };
}

// ------------------------------------------------------------------ helpers

function setG(w: World, x: number, y: number, gr: G, zone?: number): void {
  if (!inB(w, x, y)) return;
  const i = y * w.w + x;
  w.ground[i] = gr;
  if (zone !== undefined) w.zone[i] = zone;
}

function clearStruct(w: World, x: number, y: number): void {
  if (!inB(w, x, y)) return;
  const i = y * w.w + x;
  if (w.bld[i] >= 0) return;
  if (w.struct[i] === S.Tree || w.struct[i] === S.Bush || w.struct[i] === S.FenceLow || w.struct[i] === S.FenceHigh) {
    w.struct[i] = S.None;
  }
}

function fill(w: World, x0: number, y0: number, x1: number, y1: number, gr: G, zone?: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setG(w, x, y, gr, zone);
}

/** Fence styles (stored in structRef): 0 wood privacy, 1 chain-link, 2 picket, 3 rail, 4 bridge railing. */
function fence(w: World, x0: number, y0: number, x1: number, y1: number, kind: S.FenceLow | S.FenceHigh, gaps: [number, number][] = [], style = kind === S.FenceHigh ? 0 : 2): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (!inB(w, x, y)) continue;
      if (gaps.some(([gx, gy]) => gx === x && gy === y)) continue;
      const i = y * w.w + x;
      if (w.bld[i] >= 0 || w.struct[i] !== S.None || w.furn[i] >= 0) continue;
      const gr = w.ground[i];
      if (gr === G.Road || gr === G.Sidewalk || gr === G.Water || gr === G.Parking) continue;
      w.struct[i] = kind;
      w.structRef[i] = style;
    }
  }
}

// ------------------------------------------------------------------ terrain

function terrain(g: Gen): void {
  const w = g.w;
  for (let y = 0; y < w.h; y++) {
    for (let x = 0; x < w.w; x++) {
      const i = y * w.w + x;
      w.ground[i] = G.Grass;
      w.groundVar[i] = (hash01(x, y, w.seed) * 255) | 0;
      const inTown = x >= TOWN.x0 && x <= TOWN.x1 && y >= TOWN.y0 && y <= TOWN.y1;
      w.zone[i] = inTown ? ZONE_RES : ZONE_WILD;
    }
  }
}

function riverY(x: number, seed: number): number {
  return 298 + 4 * Math.sin(x / 21 + seed * 0.001) + 2 * Math.sin(x / 7.3);
}

function river(g: Gen): void {
  const w = g.w;
  for (let x = 0; x < w.w; x++) {
    const yc = riverY(x, w.seed);
    for (let y = Math.floor(yc - 6); y <= Math.ceil(yc + 6); y++) {
      if (!inB(w, x, y)) continue;
      const d = Math.abs(y - yc);
      if (d <= 3.2) setG(w, x, y, G.Water, ZONE_WILD);
      else if (d <= 4.6) setG(w, x, y, G.Sand, ZONE_WILD);
    }
  }
}

// ------------------------------------------------------------------ roads

function roadH(w: World, y0: number, xa: number, xb: number, sidewalk: boolean, zone: number, dirt = false): void {
  for (let x = xa; x <= xb; x++) {
    if (sidewalk) {
      for (const dy of [-2, -1, RW, RW + 1]) {
        const i = (y0 + dy) * w.w + x;
        if (inB(w, x, y0 + dy) && w.ground[i] !== G.Road && w.ground[i] !== G.Water && w.ground[i] !== G.Bridge) setG(w, x, y0 + dy, G.Sidewalk, zone);
      }
    }
    for (let dy = 0; dy < RW; dy++) {
      const y = y0 + dy;
      if (!inB(w, x, y)) continue;
      const i = y * w.w + x;
      const water = w.ground[i] === G.Water || w.ground[i] === G.Bridge;
      w.ground[i] = water ? G.Bridge : dirt ? G.DirtRoad : G.Road;
      w.zone[i] = zone;
      if (!dirt) {
        let m = w.groundVar[i] & ~0xff;
        m = 0;
        if (dy === 0) m |= MARK_EDGE_N;
        if (dy === RW - 1) m |= MARK_EDGE_S;
        if (dy === 3) m |= MARK_CENTER_H;
        w.groundVar[i] = m;
      }
    }
  }
}

function roadV(w: World, x0: number, ya: number, yb: number, sidewalk: boolean, zone: number, width = RW, dirt = false): void {
  for (let y = ya; y <= yb; y++) {
    if (sidewalk) {
      for (const dx of [-2, -1, width, width + 1]) {
        const i = y * w.w + x0 + dx;
        if (inB(w, x0 + dx, y) && w.ground[i] !== G.Road && w.ground[i] !== G.Water && w.ground[i] !== G.Bridge) setG(w, x0 + dx, y, G.Sidewalk, zone);
      }
    }
    for (let dx = 0; dx < width; dx++) {
      const x = x0 + dx;
      if (!inB(w, x, y)) continue;
      const i = y * w.w + x;
      const water = w.ground[i] === G.Water || w.ground[i] === G.Bridge;
      w.ground[i] = water ? G.Bridge : dirt ? G.DirtRoad : G.Road;
      w.zone[i] = zone;
      if (!dirt) {
        let m = 0;
        if (dx === 0) m |= MARK_EDGE_W;
        if (dx === width - 1) m |= MARK_EDGE_E;
        if (dx === Math.floor(width / 2)) m |= MARK_CENTER_V;
        w.groundVar[i] = m;
      }
    }
  }
}

function roads(g: Gen): void {
  const w = g.w;
  // Highway (north-south), with bridge railings over the river.
  roadV(w, HIGHWAY.x0, 0, w.h - 1, false, ZONE_HIGHWAY, HIGHWAY.x1 - HIGHWAY.x0 + 1);
  for (let y = 0; y < w.h; y++) {
    for (const x of [HIGHWAY.x0 - 1, HIGHWAY.x1 + 1]) {
      if (w.ground[y * w.w + x] === G.Water || w.ground[y * w.w + x] === G.Sand) {
        const yc = riverY(x, w.seed);
        if (Math.abs(y - yc) <= 3.2) {
          w.ground[y * w.w + x] = G.Bridge;
          w.struct[y * w.w + x] = S.FenceLow;
          w.structRef[y * w.w + x] = 4;
        }
      }
      if (w.ground[y * w.w + x] === G.Grass) setG(w, x, y, G.Gravel);
    }
  }
  // Town grid
  for (let j = 0; j < HY.length; j++) {
    const zone = j === 2 ? ZONE_COM : j === 4 ? ZONE_IND : ZONE_RES;
    roadH(w, HY[j], VX[0] - 2, VX[VX.length - 1] + RW + 1, true, zone);
  }
  for (let i = 0; i < VX.length; i++) roadV(w, VX[i], HY[0] - 2, HY[HY.length - 1] + RW + 1, true, ZONE_RES);
  // Main Street west to the highway and east as a county road.
  roadH(w, HY[2], HIGHWAY.x1 + 1, VX[0] - 3, false, ZONE_COM);
  roadH(w, HY[2], VX[VX.length - 1] + RW + 2, 304, false, ZONE_WILD);
  // Intersections: clear markings, paint crosswalks.
  const clearMarks = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.ground[y * w.w + x] === G.Road) w.groundVar[y * w.w + x] = 0;
  };
  for (const vx of VX) {
    for (const hy of HY) {
      clearMarks(vx, hy, vx + RW - 1, hy + RW - 1);
      for (const cy of [hy - 2, hy - 1, hy + RW, hy + RW + 1]) {
        for (let x = vx; x < vx + RW; x++) if (w.ground[cy * w.w + x] === G.Road) w.groundVar[cy * w.w + x] = MARK_CROSS | MARK_CENTER_V;
      }
      for (const cx of [vx - 2, vx - 1, vx + RW, vx + RW + 1]) {
        for (let y = hy; y < hy + RW; y++) if (w.ground[y * w.w + cx] === G.Road) w.groundVar[y * w.w + cx] = MARK_CROSS | MARK_CENTER_H;
      }
    }
  }
  clearMarks(HIGHWAY.x0, HY[2], HIGHWAY.x1, HY[2] + RW - 1);
  // corners of the grid ends
  clearMarks(VX[0], HY[0], VX[0] + RW - 1, HY[0] + RW - 1);
}

// ------------------------------------------------------------------ blocks

interface BlockRect { x0: number; y0: number; x1: number; y1: number }
function blockRect(i: number, j: number): BlockRect {
  return { x0: VX[i] + RW + 2, x1: VX[i + 1] - 3, y0: HY[j] + RW + 2, y1: HY[j + 1] - 3 };
}

function blocks(g: Gen, houses: number[], quiet: number[]): void {
  const w = g.w;
  const rng = g.rng;
  const res = (i: number, j: number, halves: { top: boolean; bottom: boolean } = { top: true, bottom: true }, isQuiet = false): void => {
    const b = blockRect(i, j);
    const mid = b.y0 + Math.floor((b.y1 - b.y0 + 1) / 2);
    if (halves.top) resRow(g, b.x0, b.x1, b.y0, mid - 1, 'n', H_NAMES[j], houses, isQuiet ? quiet : null);
    if (halves.bottom) resRow(g, b.x0, b.x1, mid + 1, b.y1, 's', H_NAMES[j + 1], houses, isQuiet ? quiet : null);
    const kind = rng.chance(0.5) ? S.FenceHigh : S.FenceLow;
    if (halves.top && halves.bottom) {
      const gaps: [number, number][] = [];
      for (let x = b.x0; x <= b.x1; x++) if (rng.chance(0.04)) gaps.push([x, mid]);
      fence(w, b.x0, mid, b.x1, mid, kind, gaps);
    }
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) w.zone[y * w.w + x] = ZONE_RES;
  };

  res(0, 0, undefined, true);
  res(1, 0, undefined, true);
  park(g, blockRect(2, 0));
  res(3, 0, undefined, true);
  res(3, 2);
  res(0, 3, undefined, true);
  res(1, 3, undefined, true);

  // (0,1): gas station + auto repair on Main Street, houses on Hill Ave
  {
    const b = blockRect(0, 1);
    const mid = b.y0 + 18;
    resRow(g, b.x0, b.x1, b.y0, mid - 1, 'n', H_NAMES[1], houses, null);
    fill(w, b.x0, mid + 1, b.x0 + 21, b.y1, G.Parking, ZONE_COM);
    const gs = genGasStation(g, b.x0 + 3, mid + 1, true);
    for (const [px, py] of [[b.x0 + 5, b.y1 - 4], [b.x0 + 10, b.y1 - 4], [b.x0 + 15, b.y1 - 4]]) outdoor(g, 'pump', px, py, 0);
    outdoor(g, 'dumpster', b.x0 + 16, mid + 2, 0);
    void gs;
    genAutoRepair(g, b.x0 + 22, b.y1 - 11, true);
    fill(w, b.x0 + 22, mid + 1, b.x1, b.y1 - 12, G.Parking, ZONE_COM);
    g.vehicles.push({ x: b.x0 + 26, y: b.y1 - 14, heading: 0, crashed: false, key: rng.chance(0.3) ? 'glovebox' : 'none' });
    g.vehicles.push({ x: b.x0 + 34, y: b.y1 - 14, heading: Math.PI, crashed: false, key: 'none' });
    markZone(w, b, ZONE_COM);
  }
  // (1,1): grocery + pharmacy on Main, bank + parking on Hill Ave
  {
    const b = blockRect(1, 1);
    markZone(w, b, ZONE_COM);
    fill(w, b.x0, b.y0 + 12, b.x1, b.y1 - 18, G.Parking);
    genGrocery(g, b.x0, b.y1 - 17, true);
    genPharmacy(g, b.x0 + 27, b.y1 - 13, true);
    genOffice(g, b.x0 + 1, b.y0, false, 'First County Bank');
    parkingLot(g, b.x0 + 17, b.y0, b.x1, b.y0 + 17, 'h');
    outdoor(g, 'dumpster', b.x0 + 4, b.y1 - 19, 0);
    outdoor(g, 'dumpster', b.x0 + 29, b.y1 - 15, 0);
  }
  // (2,1): hardware + diner on Main, bar on Hill Ave
  {
    const b = blockRect(2, 1);
    markZone(w, b, ZONE_COM);
    fill(w, b.x0, b.y0 + 12, b.x1, b.y1 - 16, G.Parking);
    genHardware(g, b.x0, b.y1 - 15, true);
    genDiner(g, b.x0 + 22, b.y1 - 11, true);
    genBar(g, b.x0 + 2, b.y0, false);
    parkingLot(g, b.x0 + 18, b.y0, b.x1, b.y0 + 17, 'h');
    outdoor(g, 'dumpster', b.x0 + 3, b.y1 - 17, 0);
    outdoor(g, 'dumpster', b.x0 + 30, b.y1 - 13, 0);
  }
  // (3,1): apartments on Main, houses on Hill Ave
  {
    const b = blockRect(3, 1);
    const mid = b.y0 + 18;
    resRow(g, b.x0, b.x1, b.y0, mid - 1, 'n', H_NAMES[1], houses, null);
    genApartment(g, b.x0 + 1, b.y1 - 13, 23, 14, true, 'Maple Court Apartments');
    parkingLot(g, b.x0 + 25, mid + 1, b.x1, b.y1, 'v');
    markZone(w, b, ZONE_RES);
  }
  // (0,2): motel facing Main Street, houses on Lake Ave
  {
    const b = blockRect(0, 2);
    markZone(w, b, ZONE_COM);
    parkingLot(g, b.x0, b.y0, b.x1, b.y0 + 6, 'h');
    genMotel(g, b.x0 + 2, b.y0 + 7, false, 5);
    const mid = b.y0 + 19;
    resRow(g, b.x0, b.x1, mid + 1, b.y1, 's', H_NAMES[3], houses, null);
  }
  // (1,2): police + clinic
  {
    const b = blockRect(1, 2);
    markZone(w, b, ZONE_COM);
    genPolice(g, b.x0, b.y0, false);
    genClinic(g, b.x0 + 22, b.y0, false);
    parkingLot(g, b.x0, b.y0 + 19, b.x1, b.y1, 'h', true);
  }
  // (2,2): church + records office, houses on Lake Ave
  {
    const b = blockRect(2, 2);
    markZone(w, b, ZONE_COM);
    genChurch(g, b.x0 + 2, b.y0, false);
    genOffice(g, b.x0 + 22, b.y0, false, 'County Records Office');
    parkingLot(g, b.x0 + 20, b.y0 + 13, b.x1, b.y0 + 21, 'h');
    for (let k = 0; k < 8; k++) tree(g, rng.int(b.x0, b.x1), rng.int(b.y0 + 24, b.y1 - 2));
  }
  // (2,3) warehouse and (3,3) factory with fenced yards
  {
    const b = blockRect(2, 3);
    markZone(w, b, ZONE_IND);
    fill(w, b.x0, b.y0, b.x1, b.y1, G.Gravel);
    genWarehouse(g, b.x0 + 4, b.y0 + 3, false, 'Riverside Warehouse');
    industrialFence(g, b);
    g.vehicles.push({ x: b.x0 + 26.5, y: b.y1 - 8, heading: 0, type: 'truck', key: rng.chance(0.4) ? 'house' : 'none', bld: w.buildings.length - 1 });
    g.vehicles.push({ x: b.x0 + 12, y: b.y1 - 5, heading: Math.PI, type: 'van', key: 'none' });
    outdoor(g, 'dumpster', b.x0 + 2, b.y1 - 2, 0);
    for (let k = 0; k < 5; k++) outdoor(g, 'pallet', rng.int(b.x0 + 1, b.x1 - 1), rng.int(b.y1 - 4, b.y1 - 1), 0, 'warehouse|warehouse');
  }
  {
    const b = blockRect(3, 3);
    markZone(w, b, ZONE_IND);
    fill(w, b.x0, b.y0, b.x1, b.y1, G.Gravel);
    genFactory(g, b.x0 + 5, b.y0 + 3, false);
    industrialFence(g, b);
    g.vehicles.push({ x: b.x0 + 20, y: b.y1 - 8, heading: Math.PI, type: 'truck', key: 'none' });
    outdoor(g, 'dumpster', b.x1 - 3, b.y1 - 2, 0);
  }
}

function markZone(w: World, b: BlockRect, zone: number): void {
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) w.zone[y * w.w + x] = zone;
}

function industrialFence(g: Gen, b: BlockRect): void {
  const w = g.w;
  const gaps: [number, number][] = [];
  for (let x = b.x0 + 18; x <= b.x0 + 24; x++) gaps.push([x, b.y0]);
  fence(w, b.x0, b.y0, b.x1, b.y0, S.FenceHigh, gaps, 1);
  fence(w, b.x0, b.y1, b.x1, b.y1, S.FenceHigh, [], 1);
  fence(w, b.x0, b.y0, b.x0, b.y1, S.FenceHigh, [], 1);
  fence(w, b.x1, b.y0, b.x1, b.y1, S.FenceHigh, [], 1);
}

function parkingLot(g: Gen, x0: number, y0: number, x1: number, y1: number, dir: 'h' | 'v', police = false): void {
  const w = g.w;
  const rng = g.rng;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w.w + x;
      if (w.bld[i] >= 0 || w.struct[i] !== S.None) continue;
      w.ground[i] = G.Parking;
      w.groundVar[i] = 0;
    }
  }
  if (dir === 'h') {
    // rows of stalls facing north/south, 3 wide
    for (let y = y0 + 1; y + 4 <= y1; y += 7) {
      for (let x = x0 + 1; x + 2 <= x1; x += 3) {
        for (let dy = 0; dy < 5; dy++) {
          const i = (y + dy) * w.w + x;
          if (w.ground[i] === G.Parking) w.groundVar[i] = MARK_STALL;
        }
        if (rng.chance(police ? 0.5 : 0.35)) {
          g.vehicles.push({ x: x + 1.6, y: y + 2.5, heading: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, key: rng.chance(0.15) ? 'glovebox' : rng.chance(0.08) ? 'ignition' : 'none', police: police && rng.chance(0.6) });
        }
      }
    }
  } else {
    for (let x = x0 + 1; x + 4 <= x1; x += 7) {
      for (let y = y0 + 1; y + 2 <= y1; y += 3) {
        for (let dx = 0; dx < 5; dx++) {
          const i = y * w.w + x + dx;
          if (w.ground[i] === G.Parking) w.groundVar[i] = MARK_STALL | MARK_CENTER_H;
        }
        if (rng.chance(0.35)) {
          g.vehicles.push({ x: x + 2.5, y: y + 1.6, heading: rng.chance(0.5) ? 0 : Math.PI, key: rng.chance(0.15) ? 'glovebox' : 'none' });
        }
      }
    }
  }
}

function tree(g: Gen, x: number, y: number): void {
  const w = g.w;
  if (!inB(w, x, y)) return;
  const i = y * w.w + x;
  if (w.bld[i] >= 0 || w.struct[i] !== S.None || w.furn[i] >= 0) return;
  const gr = w.ground[i];
  if (gr !== G.Grass && gr !== G.Forest && gr !== G.TallGrass && gr !== G.Dirt) return;
  // keep a tile of clearance from buildings/doors
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const j = (y + dy) * w.w + x + dx;
    if (inB(w, x + dx, y + dy) && (w.bld[j] >= 0 || w.struct[j] === S.Door)) return;
  }
  w.struct[i] = S.Tree;
}

function bush(g: Gen, x: number, y: number): void {
  const w = g.w;
  if (!inB(w, x, y)) return;
  const i = y * w.w + x;
  if (w.bld[i] >= 0 || w.struct[i] !== S.None || w.furn[i] >= 0) return;
  const gr = w.ground[i];
  if (gr !== G.Grass && gr !== G.Forest && gr !== G.TallGrass) return;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const j = (y + dy) * w.w + x + dx;
    if (inB(w, x + dx, y + dy) && w.struct[j] === S.Door) return;
  }
  w.struct[i] = S.Bush;
}

function park(g: Gen, b: BlockRect): void {
  const w = g.w;
  const rng = g.rng;
  markZone(w, b, ZONE_PARK);
  const cx = Math.floor((b.x0 + b.x1) / 2);
  const cy = Math.floor((b.y0 + b.y1) / 2);
  fill(w, cx - 1, b.y0, cx + 1, b.y1, G.Sidewalk);
  fill(w, b.x0, cy - 1, b.x1, cy + 1, G.Sidewalk);
  // pond
  for (let y = cy + 5; y <= cy + 11; y++) {
    for (let x = cx + 6; x <= cx + 15; x++) {
      const d = ((x - (cx + 10.5)) / 5) ** 2 + ((y - (cy + 8)) / 3.3) ** 2;
      if (d < 1) setG(w, x, y, G.Water);
      else if (d < 1.4) setG(w, x, y, G.Sand);
    }
  }
  for (let k = 0; k < 70; k++) tree(g, rng.int(b.x0, b.x1), rng.int(b.y0, b.y1));
  for (let k = 0; k < 30; k++) bush(g, rng.int(b.x0, b.x1), rng.int(b.y0, b.y1));
  for (const [x, y, r] of [[cx - 4, cy - 2, 0], [cx + 3, cy - 2, 0], [cx - 4, cy + 2, 2], [cx + 3, cy + 2, 2], [cx - 2, b.y0 + 5, 1]] as [number, number, number][]) {
    outdoor(g, 'bench', x, y, r);
  }
  outdoor(g, 'trash', cx + 2, cy - 3, 0);
  // gazebo-like picnic spot
  outdoor(g, 'table', cx - 10, cy - 8, 0);
  outdoor(g, 'bbq', cx - 12, cy - 8, 0, 'park|none');
}

/** A row of residential lots along one side of a block. */
function resRow(g: Gen, x0: number, x1: number, y0: number, y1: number, front: 'n' | 's', street: string, houses: number[], quiet: number[] | null): void {
  const w = g.w;
  const rng = g.rng;
  const total = x1 - x0 + 1;
  const patterns = total >= 40 ? [[13, 14, 14], [14, 13, 14], [20, 21], [14, 27]] : [[Math.floor(total / 2), total - Math.floor(total / 2)]];
  let widths = rng.pick(patterns).slice();
  const sum = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += total - sum;
  let lx = x0;
  const fenceKind = rng.chance(0.55) ? S.FenceHigh : S.FenceLow;
  for (let k = 0; k < widths.length; k++) {
    const lw = widths[k];
    const lot = { x0: lx, x1: lx + lw - 1, y0, y1 };
    const bid = lot.x1 - lot.x0 + 1 >= 22 && rng.chance(0.55)
      ? lotApartment(g, lot, front, street)
      : lotHouse(g, lot, front, street, fenceKind, k === widths.length - 1);
    if (bid >= 0 && w.buildings[bid].kind === 'house') {
      houses.push(bid);
      if (quiet) quiet.push(bid);
    }
    lx += lw;
  }
}

function lotApartment(g: Gen, lot: BlockRect, front: 'n' | 's', street: string): number {
  const W = Math.min(24, lot.x1 - lot.x0 - 1);
  const H = 14;
  const x0 = lot.x0 + 1;
  const y0 = front === 'n' ? lot.y0 + 2 : lot.y1 - 2 - H + 1;
  const f = genApartment(g, x0, y0, W, H, front === 's', `${street} Apartments`);
  f.bb.b.address = `${100 + (lot.x0 % 97) * 2} ${street}`;
  return f.bb.b.id;
}

function lotHouse(g: Gen, lot: BlockRect, front: 'n' | 's', street: string, fenceKind: S.FenceLow | S.FenceHigh, last: boolean): number {
  const w = g.w;
  const rng = g.rng;
  const lotW = lot.x1 - lot.x0 + 1;
  const lotD = lot.y1 - lot.y0 + 1;
  const setback = rng.int(4, 5);
  const depth = rng.int(8, Math.min(11, lotD - setback - 3));
  const hw = Math.max(9, Math.min(15, lotW - rng.int(2, 4)));
  let hx0 = lot.x0 + Math.floor((lotW - hw) / 2) + rng.int(-1, 1);
  hx0 = Math.max(lot.x0 + 1, Math.min(hx0, lot.x1 - hw));
  const hx1 = hx0 + hw - 1;
  const hy0 = front === 'n' ? lot.y0 + setback : lot.y1 - setback - depth + 1;
  const hy1 = hy0 + depth - 1;
  const garage = hw >= 11 && rng.chance(0.45) ? (rng.chance(0.5) ? 'left' : 'right') : null;
  const num = 100 + Math.floor((lot.x0 - 40) * 2.5) + (front === 'n' ? 1 : 0) * 1;
  const address = `${num} ${street}`;
  const bb = genHouse(g, hx0, hy0, hx1, hy1, { front, address, garage });
  const bid = bb.b.id;
  const frontY = front === 'n' ? hy0 : hy1;
  const lotFrontY = front === 'n' ? lot.y0 : lot.y1;
  const step = front === 'n' ? -1 : 1;
  // front path to the sidewalk
  const fdoor = bb.b.doors.map((d) => w.doors[d]).find((d) => d.ext && d.y === frontY && d.kind === 'wood');
  if (fdoor) {
    for (let y = frontY + step; front === 'n' ? y >= lotFrontY : y <= lotFrontY; y += step) setG(w, fdoor.x, y, G.Sidewalk);
    const mx = fdoor.x + (fdoor.x > lot.x0 + 2 ? -1 : 1);
    outdoor(g, 'mailbox', mx, lotFrontY, front === 'n' ? 2 : 0, 'house|none');
  }
  // driveway
  let dx0: number;
  if (garage) {
    const gd = bb.b.doors.map((d) => w.doors[d]).filter((d) => d.kind === 'garage').sort((a, b) => a.x - b.x)[0];
    dx0 = gd.x - 1;
  } else {
    const leftGap = hx0 - lot.x0;
    const rightGap = lot.x1 - hx1;
    dx0 = rightGap >= leftGap ? Math.min(hx1 - 2, lot.x1 - 3) : Math.max(hx0 - 0, lot.x0 + 1);
  }
  for (let y = frontY + step; front === 'n' ? y >= lotFrontY : y <= lotFrontY; y += step) {
    for (let x = dx0; x < dx0 + 3; x++) {
      const i = y * w.w + x;
      if (inB(w, x, y) && w.furn[i] < 0 && w.bld[i] < 0) setG(w, x, y, G.Parking);
    }
  }
  if (rng.chance(0.5)) {
    const cy = front === 'n' ? frontY - 2.6 : frontY + 3.6;
    g.vehicles.push({ x: dx0 + 1.5, y: cy, heading: front === 'n' ? Math.PI / 2 : -Math.PI / 2, key: rng.chance(0.55) ? 'house' : rng.chance(0.2) ? 'glovebox' : 'none', bld: bid });
  }
  // fences: left lot boundary behind the house front line, plus the far edge for the last lot
  const backY = front === 'n' ? lot.y1 : lot.y0;
  const fenceFrom = front === 'n' ? hy0 + 1 : hy1 - 1;
  const gateY = front === 'n' ? hy0 + 2 : hy1 - 2;
  fence(w, lot.x0, fenceFrom, lot.x0, backY, fenceKind, [[lot.x0, gateY]]);
  if (last) fence(w, lot.x1, fenceFrom, lot.x1, backY, fenceKind, [[lot.x1, gateY]]);
  // front hedges / picket fence
  if (rng.chance(0.25)) {
    const gaps: [number, number][] = [];
    for (let x = lot.x0; x <= lot.x1; x++) {
      const i = lotFrontY * w.w + x;
      if (w.ground[i] === G.Sidewalk || w.ground[i] === G.Parking) gaps.push([x, lotFrontY]);
    }
    fence(w, lot.x0, lotFrontY, lot.x1, lotFrontY, S.FenceLow, gaps);
  }
  for (let x = hx0; x <= hx1; x++) if (rng.chance(0.18)) bush(g, x, frontY + step);
  // yard trees
  for (let k = 0; k < rng.int(1, 3); k++) tree(g, rng.int(lot.x0 + 1, lot.x1 - 1), front === 'n' ? rng.int(hy1 + 2, lot.y1 - 1) : rng.int(lot.y0 + 1, hy0 - 2));
  if (rng.chance(0.5)) tree(g, rng.int(lot.x0 + 1, lot.x1 - 1), front === 'n' ? rng.int(lot.y0, hy0 - 2) : rng.int(hy1 + 2, lot.y1));
  // backyard features
  const byA = front === 'n' ? hy1 + 1 : lot.y0;
  const byB = front === 'n' ? lot.y1 - 1 : hy0 - 1;
  const backDepth = byB - byA + 1;
  if (backDepth >= 6 && rng.chance(0.35)) {
    const sx = rng.chance(0.5) ? lot.x0 + 1 : lot.x1 - 5;
    const sy = front === 'n' ? byB - 4 : byA;
    let ok = true;
    for (let y = sy; y < sy + 5; y++) for (let x = sx; x < sx + 5; x++) if (w.struct[y * w.w + x] !== S.None || w.furn[y * w.w + x] >= 0 || w.bld[y * w.w + x] >= 0) ok = false;
    if (ok) genShed(g, sx, sy, front === 's');
  }
  if (rng.chance(0.3)) outdoor(g, 'bbq', rng.int(hx0, hx1), front === 'n' ? hy1 + 2 : hy0 - 2, 0, 'house|none');
  if (rng.chance(0.5)) outdoor(g, 'trash', hx0 - 1 >= lot.x0 + 1 ? hx0 - 1 : hx1 + 1, front === 'n' ? hy1 - 1 : hy0 + 1, 0);
  if (rng.chance(0.12)) {
    // small vegetable patch
    const px = rng.int(lot.x0 + 2, lot.x1 - 5);
    const py = front === 'n' ? byB - 2 : byA + 1;
    for (let y = py; y < py + 2; y++) {
      for (let x = px; x < px + 3; x++) {
        const i = y * w.w + x;
        if (w.struct[i] === S.None && w.furn[i] < 0 && w.bld[i] < 0) {
          w.ground[i] = G.Furrow;
          if (rng.chance(0.7)) w.crops[i] = { type: rng.pick(['carrot', 'tomato', 'potato', 'cabbage']), growth: rng.range(0.2, 1), water: 0.5, health: 1 };
        }
      }
    }
  }
  return bid;
}

// ------------------------------------------------------------------ countryside

function countryside(g: Gen): void {
  const w = g.w;
  const rng = g.rng;
  // --- farm (north-east)
  const farmZone = { x0: 260, y0: 6, x1: 316, y1: 72 };
  markZone(w, farmZone, ZONE_FARM);
  roadH(w, HY[0], VX[4] + RW + 2, 286, false, ZONE_FARM, true);
  roadV(w, 282, 36, HY[0] + RW - 1, false, ZONE_FARM, 5, true);
  fill(w, 266, 22, 312, 42, G.Dirt);
  const fh = genHouse(g, 268, 24, 281, 34, { front: 's', address: 'Hartley Farm', name: 'Hartley Farmhouse', kind: 'farmhouse' });
  void fh;
  genBarn(g, 290, 23, true);
  outdoor(g, 'silo', 311, 26, 0);
  outdoor(g, 'silo', 311, 29, 0);
  outdoor(g, 'well', 285, 38, 0);
  outdoor(g, 'tractor', 272, 38, 1);
  outdoor(g, 'hay', 288, 38, 0, 'barn|barn');
  outdoor(g, 'hay', 289, 38, 0, 'barn|barn');
  g.vehicles.push({ x: 276.5, y: 39.5, heading: 0, type: 'pickup', key: rng.chance(0.6) ? 'house' : 'ignition', bld: w.buildings.length - 2 });
  const fields: [number, number, number, number, string][] = [
    [290, 46, 313, 57, 'potato'], [290, 61, 313, 70, 'cabbage'], [262, 8, 280, 19, 'carrot'], [262, 61, 279, 70, 'tomato'],
  ];
  for (const [x0, y0, x1, y1, crop] of fields) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w.w + x;
        w.ground[i] = G.Furrow;
        w.struct[i] = S.None;
        if ((y - y0) % 2 === 0 && rng.chance(0.8)) w.crops[i] = { type: crop, growth: rng.range(0.55, 1.05), water: 0.6, health: rng.range(0.6, 1) };
      }
    }
    const gate: [number, number][] = [[Math.floor((x0 + x1) / 2), y0 - 1], [Math.floor((x0 + x1) / 2) + 1, y0 - 1]];
    fence(w, x0 - 1, y0 - 1, x1 + 1, y0 - 1, S.FenceLow, gate, 3);
    fence(w, x0 - 1, y1 + 1, x1 + 1, y1 + 1, S.FenceLow, [], 3);
    fence(w, x0 - 1, y0 - 1, x0 - 1, y1 + 1, S.FenceLow, [], 3);
    fence(w, x1 + 1, y0 - 1, x1 + 1, y1 + 1, S.FenceLow, [], 3);
  }
  // --- cabins
  roadV(w, 95, 24, HY[0] - 3, false, ZONE_FOREST, 3, true);
  clearArea(g, 82, 12, 104, 30);
  const c1 = genCabin(g, 88, 16, true, 'Hunting Cabin');
  outdoor(g, 'lumber', 99, 20, 1, 'cabin|cabin');
  g.vehicles.push({ x: 96.5, y: 27.5, heading: -Math.PI / 2, type: 'pickup', key: rng.chance(0.5) ? 'house' : 'none', bld: c1.bb.b.id });
  roadV(w, 147, HY[4] + RW + 2, 268, false, ZONE_FOREST, 3, true);
  clearArea(g, 138, 266, 160, 282);
  genCabin(g, 144, 270, false, 'Fishing Cabin');
  outdoor(g, 'campfire', 156, 276, 0);
  // --- highway checkpoint (north)
  clearArea(g, 24, 22, 40, 44);
  for (let x = HIGHWAY.x0; x <= HIGHWAY.x1; x++) if (x < 16 || x > 18) outdoor(g, 'sandbags', x, 34, 0);
  for (let x = HIGHWAY.x0; x <= HIGHWAY.x1; x++) if (x < 16 || x > 18) outdoor(g, 'sandbags', x, 35, 0);
  genTent(g, 26, 24, false);
  genTent(g, 26, 38, true);
  genTent(g, 34, 30, false);
  for (const [x, y] of [[25, 31], [26, 32], [33, 36], [34, 37]]) outdoor(g, 'crate', x, y, 0, 'checkpoint|checkpoint');
  g.vehicles.push({ x: 20, y: 29, heading: Math.PI / 2, type: 'military', military: true, key: rng.chance(0.4) ? 'ignition' : 'none' });
  g.vehicles.push({ x: 14.5, y: 41, heading: -Math.PI / 2, type: 'military', military: true, key: 'none', crashed: rng.chance(0.5) });
  // --- highway pile-up (south)
  for (let k = 0; k < 10; k++) {
    g.vehicles.push({ x: rng.range(13.5, 21.5), y: 205 + k * 3.2 + rng.range(-1, 1), heading: Math.PI / 2 + rng.range(-0.9, 0.9), crashed: rng.chance(0.7), key: rng.chance(0.25) ? 'ignition' : rng.chance(0.2) ? 'glovebox' : 'none' });
  }
  // stray vehicles along country roads
  g.vehicles.push({ x: 290, y: HY[2] + 1.6, heading: Math.PI, crashed: true, key: 'none' });
  g.vehicles.push({ x: 17.5, y: 120, heading: -Math.PI / 2, key: 'none' });
  g.vehicles.push({ x: 15.2, y: 260, heading: Math.PI / 2 + 0.3, crashed: true, key: 'glovebox' });
}

function clearArea(g: Gen, x0: number, y0: number, x1: number, y1: number): void {
  const w = g.w;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inB(w, x, y)) continue;
      const i = y * w.w + x;
      w.zone[i] = ZONE_FOREST;
      if (w.ground[i] === G.Forest || w.ground[i] === G.TallGrass) w.ground[i] = G.Grass;
      w.groundVar[i] = (w.groundVar[i] | 1) & 0xff;
      clearStruct(w, x, y);
      w.zone[i] = ZONE_WILD;
      w.groundVar[i] = 255; // protected from forest fill
    }
  }
}

function forest(g: Gen): void {
  const w = g.w;
  const rng = g.rng;
  for (let y = 0; y < w.h; y++) {
    for (let x = 0; x < w.w; x++) {
      const i = y * w.w + x;
      const inTown = x >= TOWN.x0 - 2 && x <= TOWN.x1 + 2 && y >= TOWN.y0 - 2 && y <= TOWN.y1 + 2;
      if (inTown) continue;
      if (w.zone[i] === ZONE_FARM || w.zone[i] === ZONE_HIGHWAY) continue;
      const gr = w.ground[i];
      if (gr !== G.Grass) continue;
      if (w.struct[i] !== S.None || w.bld[i] >= 0 || w.furn[i] >= 0) continue;
      if (w.groundVar[i] === 255) {
        w.groundVar[i] = (hash01(x, y, 7) * 254) | 0;
        continue;
      }
      if (x >= HIGHWAY.x0 - 4 && x <= HIGHWAY.x1 + 4) continue;
      const edge = Math.min(x, y, w.w - 1 - x, w.h - 1 - y);
      const n = fbm(x / 26, y / 26, w.seed & 0xffff, 4) + (edge < 30 ? (30 - edge) / 90 : 0);
      if (n > 0.5) {
        w.ground[i] = G.Forest;
        w.zone[i] = ZONE_FOREST;
        const dens = 0.18 + (n - 0.5) * 1.1;
        if (rng.chance(dens)) w.struct[i] = S.Tree;
        else if (rng.chance(0.07)) w.struct[i] = S.Bush;
        else if (rng.chance(0.15)) w.ground[i] = G.TallGrass;
      } else {
        const m = fbm(x / 13 + 40, y / 13 + 40, (w.seed + 99) & 0xffff, 3);
        if (m > 0.56) w.ground[i] = G.TallGrass;
        if (rng.chance(0.012)) w.struct[i] = S.Tree;
        else if (rng.chance(0.01)) w.struct[i] = S.Bush;
      }
    }
  }
}

// ------------------------------------------------------------------ street furniture & vehicles

function streetVehicles(g: Gen): void {
  const rng = g.rng;
  const w = g.w;
  // parked along curbs of town roads
  for (let j = 0; j < HY.length; j++) {
    const y = HY[j];
    for (let x = VX[0] + RW + 3; x < VX[VX.length - 1] - 3; x += rng.int(9, 22)) {
      if (VX.some((vx) => x > vx - 6 && x < vx + RW + 4)) continue;
      if (rng.chance(0.28)) g.vehicles.push({ x, y: y + 1.2, heading: Math.PI, key: rng.chance(0.1) ? 'glovebox' : 'none' });
      if (rng.chance(0.28)) g.vehicles.push({ x: x + 5, y: y + RW - 1.2, heading: 0, key: rng.chance(0.1) ? 'glovebox' : 'none' });
    }
  }
  for (let i = 0; i < VX.length; i++) {
    const x = VX[i];
    for (let y = HY[0] + RW + 3; y < HY[HY.length - 1] - 3; y += rng.int(9, 22)) {
      if (HY.some((hy) => y > hy - 6 && y < hy + RW + 4)) continue;
      if (rng.chance(0.25)) g.vehicles.push({ x: x + 1.2, y, heading: Math.PI / 2, key: rng.chance(0.1) ? 'glovebox' : 'none' });
      if (rng.chance(0.25)) g.vehicles.push({ x: x + RW - 1.2, y: y + 5, heading: -Math.PI / 2, key: rng.chance(0.1) ? 'glovebox' : 'none' });
    }
  }
  // crashes at intersections
  for (const vx of VX) {
    for (const hy of HY) {
      if (rng.chance(0.22)) {
        const n = rng.int(1, 2);
        for (let k = 0; k < n; k++) {
          g.vehicles.push({ x: vx + rng.range(2, RW - 2), y: hy + rng.range(2, RW - 2), heading: rng.range(-Math.PI, Math.PI), crashed: true, key: rng.chance(0.3) ? 'ignition' : 'none' });
        }
      }
    }
  }
  void w;
}

function lamps(g: Gen): void {
  const w = g.w;
  const rng = g.rng;
  const put = (x: number, y: number): void => {
    if (!inB(w, x, y)) return;
    const i = y * w.w + x;
    if (w.ground[i] !== G.Sidewalk || w.struct[i] !== S.None || w.furn[i] >= 0 || nearDoor(w, x, y)) return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * w.w + x + dx;
      if (w.ground[j] === G.Parking && w.bld[j] < 0) return;
    }
    placeFurn(g, 'lamp', x, y, 0, -1, '');
    w.lamps.push({ x, y });
  };
  for (let j = 0; j < HY.length; j++) {
    let side = 0;
    for (let x = VX[0] + 2; x < VX[VX.length - 1] + RW; x += 15) {
      put(x, side ? HY[j] + RW + 1 : HY[j] - 2);
      side ^= 1;
      if (rng.chance(0.12)) {
        const hx = x + 5;
        const hy = side ? HY[j] + RW + 1 : HY[j] - 2;
        const i = hy * w.w + hx;
        if (w.ground[i] === G.Sidewalk && w.struct[i] === S.None && w.furn[i] < 0 && !nearDoor(w, hx, hy)) placeFurn(g, rng.chance(0.5) ? 'hydrant' : 'trash', hx, hy, 0, -1, 'street|none');
      }
    }
  }
  for (let i = 0; i < VX.length; i++) {
    let side = 0;
    for (let y = HY[0] + 2; y < HY[HY.length - 1] + RW; y += 15) {
      put(side ? VX[i] + RW + 1 : VX[i] - 2, y);
      side ^= 1;
    }
  }
  // benches on Main Street
  for (let x = VX[1]; x < VX[3]; x += 11) {
    const y = HY[2] - 2;
    const i = y * w.w + x;
    if (w.ground[i] === G.Sidewalk && w.furn[i] < 0 && w.furn[i + 1] < 0 && w.struct[i] === S.None && w.struct[i + 1] === S.None && !nearDoor(w, x, y) && !nearDoor(w, x + 1, y)) placeFurn(g, 'bench', x, y, 0, -1, '');
  }
}

export { hideKey };
