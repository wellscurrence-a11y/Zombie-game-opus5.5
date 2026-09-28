import { Rng } from '../../core/rng';
import { FURN, furnTiles } from '../furniture';
import {
  G, S, type Building, type BuildingKind, type DoorKind, type FurnKind, type RoofPart, type Room, type RoomType, type World,
  WIN_CLOSED, inB,
} from '../world';

export interface VehicleSpawn {
  x: number;
  y: number;
  heading: number;
  type?: string;
  crashed?: boolean;
  /** Key placement: 'ignition' | 'glovebox' | 'house' | 'none' */
  key?: string;
  bld?: number;
  police?: boolean;
  military?: boolean;
}

export interface Gen {
  w: World;
  rng: Rng;
  vehicles: VehicleSpawn[];
  uid: { nextUid: number };
}

export const FLOOR_FOR: Record<RoomType, G> = {
  living: G.FloorCarpet, kitchen: G.FloorTile, bedroom: G.FloorCarpet, bathroom: G.FloorTile, hallway: G.FloorWood,
  garage: G.FloorConcrete, office: G.FloorCarpet, storage: G.FloorConcrete, laundry: G.FloorTile, grocery: G.FloorLino,
  pharmacy: G.FloorLino, hardware: G.FloorConcrete, gasstore: G.FloorLino, diner: G.FloorTile, dinerKitchen: G.FloorTile,
  bar: G.FloorWood, policeLobby: G.FloorLino, policeOffice: G.FloorCarpet, lockers: G.FloorConcrete, armory: G.FloorConcrete,
  cells: G.FloorConcrete, waiting: G.FloorLino, exam: G.FloorLino, clinicPharmacy: G.FloorLino, warehouse: G.FloorConcrete,
  factory: G.FloorConcrete, barn: G.FloorConcrete, motelRoom: G.FloorCarpet, shed: G.FloorWood, church: G.FloorWood,
  breakroom: G.FloorLino, cabin: G.FloorWood, checkpoint: G.Dirt,
  gunshop: G.FloorLino, fireBay: G.FloorConcrete, gearRoom: G.FloorConcrete, dorm: G.FloorLino, classroom: G.FloorLino,
  cafeteria: G.FloorTile, nurse: G.FloorLino, ward: G.FloorLino, surgery: G.FloorTile, hospitalPharmacy: G.FloorLino,
  reception: G.FloorLino, sportshop: G.FloorLino, barracks: G.FloorConcrete, messHall: G.FloorConcrete, command: G.FloorWood,
};

const WALL_COLORS = [0xb8ab94, 0x9aa3a8, 0xc9b99a, 0x8f9a85, 0xa89684, 0xbfb8a8, 0x8c8577, 0xa6a08e, 0x7f8b93, 0xc2a78a];
const ROOF_COLORS = [0x4a4440, 0x5a3f36, 0x3f4a52, 0x524c3e, 0x3d3a38, 0x61493c, 0x45504a];

export class BB {
  g: Gen;
  b: Building;
  constructor(g: Gen, kind: BuildingKind, name: string, x0: number, y0: number, x1: number, y1: number, opts: {
    wallColor?: number; roofColor?: number; roofs?: RoofPart[]; address?: string; alarm?: number;
  } = {}) {
    this.g = g;
    const w = g.w;
    const rng = g.rng;
    const id = w.buildings.length;
    this.b = {
      id, kind, name, x0, y0, x1, y1,
      roofs: opts.roofs ?? [{ x0, y0, x1, y1, style: 'flat', ridgeX: true }],
      roofColor: opts.roofColor ?? rng.pick(ROOF_COLORS),
      wallColor: opts.wallColor ?? rng.pick(WALL_COLORS),
      trimColor: 0xe8e2d4,
      alarm: rng.chance(opts.alarm ?? 0),
      alarmUntil: 0,
      alarmPanel: null,
      keyId: w.nextKeyId++,
      rooms: [], doors: [], windows: [], visited: false, generator: -1,
      address: opts.address ?? name,
    };
    w.buildings.push(this.b);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inB(w, x, y)) continue;
        const i = y * w.w + x;
        w.bld[i] = id;
        w.struct[i] = S.None;
        w.structRef[i] = -1;
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        if (edge) {
          w.struct[i] = S.Wall;
          w.ground[i] = G.FloorConcrete;
        }
      }
    }
  }

  wallH(y: number, xa: number, xb: number): void {
    const w = this.g.w;
    for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) {
      const i = y * w.w + x;
      if (w.struct[i] === S.Door || w.struct[i] === S.Window) continue;
      w.struct[i] = S.Wall;
      w.room[i] = -1;
    }
  }
  wallV(x: number, ya: number, yb: number): void {
    const w = this.g.w;
    for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) {
      const i = y * w.w + x;
      if (w.struct[i] === S.Door || w.struct[i] === S.Window) continue;
      w.struct[i] = S.Wall;
      w.room[i] = -1;
    }
  }

  room(type: RoomType, x0: number, y0: number, x1: number, y1: number): Room {
    const w = this.g.w;
    const r: Room = { id: w.rooms.length, bld: this.b.id, type, x0, y0, x1, y1, light: false };
    w.rooms.push(r);
    this.b.rooms.push(r.id);
    const floor = FLOOR_FOR[type];
    const variant = this.g.rng.int(0, 7);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w.w + x;
        if (w.struct[i] === S.Wall || w.struct[i] === S.Door || w.struct[i] === S.Window) continue;
        w.room[i] = r.id;
        w.ground[i] = floor;
        w.groundVar[i] = variant;
      }
    }
    return r;
  }

  /** Place a door in a wall tile. Orientation is inferred from neighbouring walls. */
  door(x: number, y: number, kind: DoorKind = 'wood', ext = false, locked?: boolean): number {
    const w = this.g.w;
    const i = y * w.w + x;
    const wallN = isWallTile(w, x, y - 1);
    const wallS = isWallTile(w, x, y + 1);
    const vertical = wallN || wallS;
    const maxHp = kind === 'metal' ? 420 : kind === 'garage' ? 300 : kind === 'glass' ? 70 : kind === 'cell' ? 600 : 150;
    const id = w.doors.length;
    const isLocked = locked ?? (ext ? this.g.rng.chance(kind === 'glass' ? 0.8 : 0.6) : false);
    w.doors.push({
      id, x, y, vertical, open: false, locked: isLocked, lockKnown: false, hp: maxHp, maxHp, planks: 0, barricadeHp: 0,
      broken: false, ext, bld: this.b.id, kind, keyId: this.b.keyId,
    });
    w.struct[i] = S.Door;
    w.structRef[i] = id;
    w.room[i] = -1;
    this.b.doors.push(id);
    return id;
  }

  window(x: number, y: number, big = false): number {
    const w = this.g.w;
    const i = y * w.w + x;
    const vertical = isWallTile(w, x, y - 1) || isWallTile(w, x, y + 1);
    const id = w.windows.length;
    const rng = this.g.rng;
    const curtains = !big && rng.chance(0.65);
    w.windows.push({
      id, x, y, vertical, state: !big && rng.chance(0.08) ? 1 : WIN_CLOSED, curtains,
      curtainsClosed: curtains && rng.chance(0.4), planks: 0, barricadeHp: 0, bld: this.b.id, big, sheet: false,
    });
    w.struct[i] = S.Window;
    w.structRef[i] = id;
    w.room[i] = -1;
    this.b.windows.push(id);
    return id;
  }

  /** Scatter windows along the building perimeter, avoiding corners, junctions and doors. */
  autoWindows(spacing = 3, big = false, sides: ('n' | 's' | 'e' | 'w')[] = ['n', 's', 'e', 'w'], chance = 0.85): void {
    const { x0, y0, x1, y1 } = this.b;
    const w = this.g.w;
    const tryAt = (x: number, y: number, inward: [number, number]): void => {
      const i = y * w.w + x;
      if (w.struct[i] !== S.Wall) return;
      // not a junction: the inward tile must be a room floor
      const ix = x + inward[0];
      const iy = y + inward[1];
      if (!inB(w, ix, iy) || w.room[iy * w.w + ix] < 0) return;
      // neighbours along the wall must be plain walls (no door/window adjacent)
      const alongX = inward[0] === 0;
      const n1 = alongX ? [x - 1, y] : [x, y - 1];
      const n2 = alongX ? [x + 1, y] : [x, y + 1];
      for (const [nx, ny] of [n1, n2]) {
        const s = w.struct[ny * w.w + nx];
        if (s !== S.Wall) return;
        // avoid junction with interior walls right next to the window
        const jx = nx + inward[0];
        const jy = ny + inward[1];
        if (w.struct[jy * w.w + jx] === S.Wall && !big) return;
      }
      if (this.g.rng.chance(chance)) this.window(x, y, big);
    };
    if (sides.includes('n')) for (let x = x0 + 2; x <= x1 - 2; x += spacing) tryAt(x, y0, [0, 1]);
    if (sides.includes('s')) for (let x = x0 + 2; x <= x1 - 2; x += spacing) tryAt(x, y1, [0, -1]);
    if (sides.includes('w')) for (let y = y0 + 2; y <= y1 - 2; y += spacing) tryAt(x0, y, [1, 0]);
    if (sides.includes('e')) for (let y = y0 + 2; y <= y1 - 2; y += spacing) tryAt(x1, y, [-1, 0]);
  }

  alarmPanelNear(doorId: number): void {
    const d = this.g.w.doors[doorId];
    this.b.alarmPanel = { x: d.x, y: d.y };
  }
}

export function isWallTile(w: World, x: number, y: number): boolean {
  if (!inB(w, x, y)) return false;
  const s = w.struct[y * w.w + x];
  return s === S.Wall || s === S.Door || s === S.Window;
}

// ------------------------------------------------------------------ furniture

export function canPlaceFurn(w: World, kind: FurnKind, x: number, y: number, rot: number, roomId: number): boolean {
  for (const [tx, ty] of furnTiles(kind, x, y, rot)) {
    if (!inB(w, tx, ty)) return false;
    const i = ty * w.w + tx;
    if (w.furn[i] >= 0) return false;
    if (w.struct[i] !== S.None) return false;
    if (roomId >= 0 && w.room[i] !== roomId) return false;
    // keep door approaches clear
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (inB(w, nx, ny) && w.struct[ny * w.w + nx] === S.Door) return false;
    }
  }
  return true;
}

export function nearDoor(w: World, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (inB(w, nx, ny) && w.struct[ny * w.w + nx] === S.Door) return true;
  }
  return false;
}

export function placeFurn(g: Gen, kind: FurnKind, x: number, y: number, rot: number, bld: number, lootKey?: string): number {
  const w = g.w;
  const def = FURN[kind];
  const id = w.furniture.length;
  let containerId = -1;
  if (def.container) {
    containerId = w.containers.length;
    w.containers.push({
      id: containerId, kind: def.container.kind, capacity: def.container.cap, items: null, loot: lootKey ?? '', x, y, searched: false,
    });
  }
  w.furniture.push({ id, kind, x, y, rot, containerId, hp: def.hp, bld });
  for (const [tx, ty] of furnTiles(kind, x, y, rot)) w.furn[ty * w.w + tx] = id;
  return id;
}

export function removeFurn(w: World, id: number): void {
  const f = w.furniture[id];
  for (const [tx, ty] of furnTiles(f.kind, f.x, f.y, f.rot)) {
    if (w.furn[ty * w.w + tx] === id) w.furn[ty * w.w + tx] = -1;
  }
  f.gone = true;
}

/** Flood fill within a room: are all free tiles connected to the door approaches? */
function roomConnected(w: World, room: Room): boolean {
  const free: number[] = [];
  const seeds: number[] = [];
  for (let y = room.y0; y <= room.y1; y++) {
    for (let x = room.x0; x <= room.x1; x++) {
      const i = y * w.w + x;
      if (w.room[i] !== room.id) continue;
      const f = w.furn[i];
      if (f >= 0 && FURN[w.furniture[f].kind].solid) continue;
      free.push(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s = w.struct[(y + dy) * w.w + (x + dx)];
        if (s === S.Door) seeds.push(i);
      }
    }
  }
  if (!free.length) return false;
  // Start from a single door approach so rooms split in two by furniture are rejected.
  const start = seeds.length ? seeds[0] : free[0];
  const freeSet = new Set(free);
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w.w;
    const y = (i / w.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * w.w + (x + dx);
      if (freeSet.has(j) && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === free.length;
}

interface WallSlot {
  x: number;
  y: number;
  rot: number;
  window: boolean;
}

/** Tiles along the room's walls, with the rotation that faces into the room. */
export function wallSlots(w: World, room: Room): WallSlot[] {
  const out: WallSlot[] = [];
  for (let y = room.y0; y <= room.y1; y++) {
    for (let x = room.x0; x <= room.x1; x++) {
      const i = y * w.w + x;
      if (w.room[i] !== room.id) continue;
      // rot: 0 faces south (wall to the north), 1 faces west (wall east), 2 faces north (wall south), 3 faces east (wall west)
      const checks: [number, number, number][] = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
      for (const [dx, dy, rot] of checks) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inB(w, nx, ny)) continue;
        const s = w.struct[ny * w.w + nx];
        if (s === S.Wall) out.push({ x, y, rot, window: false });
        else if (s === S.Window) out.push({ x, y, rot, window: true });
      }
    }
  }
  return out;
}

/** Try to place furniture against a wall of the room. Returns furniture id or -1. */
export function furnishWall(g: Gen, room: Room, kind: FurnKind, lootKey?: string, opts: { allowWindow?: boolean; tries?: number } = {}): number {
  const w = g.w;
  const def = FURN[kind];
  const slots = g.rng.shuffle(wallSlots(w, room));
  const allowWin = opts.allowWindow ?? def.h < 1.2;
  for (const s of slots) {
    if (s.window && !allowWin) continue;
    let ax = s.x;
    let ay = s.y;
    if (def.len === 2) {
      // the second tile must also be against the same wall
      const tiles = furnTiles(kind, ax, ay, s.rot);
      const [bx, by] = tiles[1];
      const hasWall = slots.some((o) => o.x === bx && o.y === by && o.rot === s.rot && (allowWin || !o.window));
      if (!hasWall) continue;
    }
    if (!canPlaceFurn(w, kind, ax, ay, s.rot, room.id)) continue;
    const id = placeFurn(g, kind, ax, ay, s.rot, room.bld, lootKey);
    if (roomConnected(w, room)) return id;
    undoFurn(w, id);
  }
  return -1;
}

/** Place furniture away from walls (tables, beds in the middle, aisles). */
export function furnishCenter(g: Gen, room: Room, kind: FurnKind, lootKey?: string, rot?: number): number {
  const w = g.w;
  const cands: [number, number][] = [];
  for (let y = room.y0 + 1; y <= room.y1 - 1; y++) {
    for (let x = room.x0 + 1; x <= room.x1 - 1; x++) cands.push([x, y]);
  }
  g.rng.shuffle(cands);
  for (const [x, y] of cands) {
    const r = rot ?? g.rng.int(0, 3);
    if (!canPlaceFurn(w, kind, x, y, r, room.id)) continue;
    const id = placeFurn(g, kind, x, y, r, room.bld, lootKey);
    if (roomConnected(w, room)) return id;
    undoFurn(w, id);
  }
  return -1;
}

/** Place at an exact tile if possible (checks connectivity). */
export function furnishAt(g: Gen, room: Room | null, kind: FurnKind, x: number, y: number, rot: number, lootKey?: string, bld = -1): number {
  const w = g.w;
  if (room && !canPlaceFurn(w, kind, x, y, rot, room.id)) return -1;
  if (!room) {
    for (const [tx, ty] of furnTiles(kind, x, y, rot)) {
      if (!inB(w, tx, ty)) return -1;
      const i = ty * w.w + tx;
      if (w.furn[i] >= 0 || w.struct[i] !== S.None) return -1;
    }
  }
  const id = placeFurn(g, kind, x, y, rot, room ? room.bld : bld, lootKey);
  if (room && !roomConnected(w, room)) {
    undoFurn(w, id);
    return -1;
  }
  return id;
}

function undoFurn(w: World, id: number): void {
  const f = w.furniture[id];
  for (const [tx, ty] of furnTiles(f.kind, f.x, f.y, f.rot)) w.furn[ty * w.w + tx] = -1;
  if (f.containerId >= 0 && f.containerId === w.containers.length - 1) w.containers.pop();
  if (id === w.furniture.length - 1) w.furniture.pop();
  else f.gone = true;
}

export function lootKey(b: Building, room: Room): string {
  return `${b.kind}|${room.type}`;
}

/** Furnish a room according to its type. */
export function furnishRoom(g: Gen, b: Building, room: Room): void {
  const rng = g.rng;
  const lk = lootKey(b, room);
  const area = (room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1);
  const n = (a: number, c: number): number => rng.int(a, c);
  const wall = (k: FurnKind, count = 1): void => {
    for (let i = 0; i < count; i++) furnishWall(g, room, k, lk);
  };
  switch (room.type) {
    case 'kitchen':
      wall('fridge');
      wall('stove');
      wall('sinkCounter');
      wall('counter', n(2, 4));
      if (area >= 16) {
        const t = furnishCenter(g, room, 'dtable', lk, rng.pick([0, 1]));
        if (t >= 0) {
          const f = g.w.furniture[t];
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [2, 0]]) {
            if (rng.chance(0.6)) furnishAt(g, room, 'chair', f.x + dx, f.y + dy, 0, lk);
          }
        }
      }
      if (rng.chance(0.5)) wall('trash');
      if (rng.chance(0.25)) wall('freezer');
      break;
    case 'living':
      wall('couch');
      wall('tv');
      wall('armchair', n(0, 2));
      if (rng.chance(0.6)) wall('bookshelf');
      if (rng.chance(0.35)) wall('desk');
      if (rng.chance(0.5)) wall('lamptable');
      if (area > 20 && rng.chance(0.5)) furnishCenter(g, room, 'table', lk);
      break;
    case 'bedroom':
      wall(rng.chance(0.55) ? 'bed2' : 'bed');
      wall('wardrobe');
      if (rng.chance(0.7)) wall('dresser');
      wall('nightstand', n(1, 2));
      if (rng.chance(0.25)) wall('desk');
      if (rng.chance(0.3)) wall('lamptable');
      break;
    case 'bathroom':
      wall('toilet');
      wall('bathSink');
      if (area >= 6) wall('tub');
      break;
    case 'laundry':
      wall('washer', n(1, 2));
      if (rng.chance(0.5)) wall('shelf');
      break;
    case 'office':
    case 'policeOffice':
      wall('desk', n(1, 2));
      wall('filing');
      if (rng.chance(0.5)) wall('bookshelf');
      furnishCenter(g, room, 'chair', lk);
      break;
    case 'garage':
      wall('workbench');
      if (rng.chance(0.6)) wall('toolchest');
      wall('shelf', n(1, 2));
      break;
    case 'storage':
      wall('shelf', n(2, 4));
      wall('crate', n(1, 3));
      break;
    case 'shed':
      wall(rng.chance(0.5) ? 'workbench' : 'shelf');
      if (rng.chance(0.5)) wall('toolchest');
      break;
    case 'breakroom':
      wall('fridge');
      wall('counter', 2);
      furnishCenter(g, room, 'table', lk);
      furnishCenter(g, room, 'chair', lk);
      break;
    case 'lockers':
      wall('locker', n(3, 6));
      furnishCenter(g, room, 'bench', lk, 0);
      break;
    case 'armory':
      wall('locker', n(2, 4));
      wall('crate', n(1, 2));
      break;
    case 'exam':
      wall('medbed');
      wall('medcab');
      wall('bathSink');
      break;
    case 'clinicPharmacy':
      wall('medcab', n(2, 4));
      wall('shelf', n(1, 2));
      break;
    case 'waiting':
    case 'policeLobby':
      wall('cashbox');
      wall('chair', n(2, 5));
      if (rng.chance(0.5)) wall('trash');
      break;
    case 'motelRoom':
      wall('bed2');
      wall('nightstand');
      wall('dresser');
      if (rng.chance(0.6)) wall('tv');
      break;
    case 'cells':
      wall('bunk');
      if (rng.chance(0.5)) wall('toilet');
      break;
    case 'cabin':
      wall('stove');
      wall('counter', 2);
      wall('bed');
      wall('wardrobe');
      furnishCenter(g, room, 'table', lk);
      break;
    case 'dorm':
    case 'barracks':
      for (let k = 0; k < Math.max(2, Math.floor(area / 10)); k++) wall('bunk');
      wall('locker', n(2, 4));
      break;
    case 'gearRoom':
      wall('locker', n(3, 6));
      wall('shelf', n(1, 2));
      furnishCenter(g, room, 'bench', lk, 0);
      break;
    case 'classroom': {
      // rows of desks facing the teacher's desk and board
      for (let y = room.y0 + 2; y <= room.y1 - 1; y += 2) {
        for (let x = room.x0 + 1; x <= room.x1 - 1; x += 2) {
          if (g.w.furn[y * g.w.w + x] < 0 && !nearDoor(g.w, x, y)) furnishAt(g, room, 'desk', x, y, 0, lk);
        }
      }
      wall('bookshelf');
      break;
    }
    case 'cafeteria': {
      wall('fridge');
      wall('freezer');
      wall('counter', n(2, 3));
      wall('stove');
      for (let y = room.y0 + 2; y <= room.y1 - 2; y += 3) {
        for (let x = room.x0 + 2; x <= room.x1 - 2; x += 3) if (!nearDoor(g.w, x, y)) furnishAt(g, room, 'table', x, y, 0, lk);
      }
      break;
    }
    case 'nurse':
      wall('medbed');
      wall('medcab', n(1, 2));
      wall('desk');
      break;
    case 'ward':
      for (let k = 0; k < Math.max(2, Math.floor(area / 9)); k++) wall('medbed');
      wall('medcab', n(1, 2));
      wall('nightstand', n(1, 3));
      break;
    case 'surgery':
      furnishCenter(g, room, 'medbed', lk, 0);
      wall('medcab', n(2, 3));
      wall('counter', n(1, 2));
      break;
    case 'hospitalPharmacy':
      wall('medcab', n(3, 5));
      wall('shelf', n(1, 3));
      break;
    case 'reception':
      wall('cashbox');
      wall('chair', n(3, 6));
      wall('filing');
      if (rng.chance(0.6)) wall('trash');
      break;
    case 'messHall': {
      wall('fridge');
      wall('freezer');
      wall('counter', n(2, 3));
      wall('stove');
      for (let y = room.y0 + 2; y <= room.y1 - 2; y += 3) {
        for (let x = room.x0 + 2; x <= room.x1 - 2; x += 3) if (!nearDoor(g.w, x, y)) furnishAt(g, room, 'table', x, y, 0, lk);
      }
      break;
    }
    case 'command':
      wall('desk', n(1, 2));
      wall('filing', n(1, 2));
      wall('locker');
      break;
    case 'church':
      for (let y = room.y0 + 2; y <= room.y1 - 3; y += 2) {
        for (let x = room.x0 + 1; x <= room.x1 - 2; x += 3) {
          if (x + 1 <= room.x1 - 1 && Math.abs(x + 1 - (room.x0 + room.x1) / 2) > 1) furnishAt(g, room, 'pew', x, y, 2, lk);
        }
      }
      wall('bookshelf');
      break;
    default:
      break;
  }
}
