import { BB, type Gen, nearDoor, furnishAt, furnishCenter, furnishRoom, furnishWall, lootKey, placeFurn, isWallTile } from './builder';
import { FURN } from '../furniture';
import { G, S, type BuildingKind, type DoorKind, type FurnKind, type Room, type RoomType, type RoofPart, inB } from '../world';
import { makeItem } from '../../sim/items';

/** Local frame: local ly = 0 is the street-facing (front) wall. */
export class Frame {
  constructor(public bb: BB, public x0: number, public y0: number, public W: number, public H: number, public flip: boolean) {}
  X(lx: number): number {
    return this.x0 + lx;
  }
  Y(ly: number): number {
    return this.flip ? this.y0 + this.H - 1 - ly : this.y0 + ly;
  }
  rot(r: number): number {
    return this.flip ? (r === 0 ? 2 : r === 2 ? 0 : r) : r;
  }
  wallH(ly: number, a: number, b: number): void {
    this.bb.wallH(this.Y(ly), this.X(a), this.X(b));
  }
  wallV(lx: number, a: number, b: number): void {
    this.bb.wallV(this.X(lx), this.Y(a), this.Y(b));
  }
  room(type: RoomType, lx0: number, ly0: number, lx1: number, ly1: number): Room {
    const ya = this.Y(ly0);
    const yb = this.Y(ly1);
    return this.bb.room(type, this.X(lx0), Math.min(ya, yb), this.X(lx1), Math.max(ya, yb));
  }
  door(lx: number, ly: number, kind: DoorKind = 'wood', ext = false, locked?: boolean): number {
    return this.bb.door(this.X(lx), this.Y(ly), kind, ext, locked);
  }
  window(lx: number, ly: number, big = false): number {
    return this.bb.window(this.X(lx), this.Y(ly), big);
  }
  furn(room: Room | null, kind: FurnKind, lx: number, ly: number, rot: number): number {
    const r = this.rot(rot);
    let wx = this.X(lx);
    let wy = this.Y(ly);
    if (FURN[kind].len === 2 && (rot === 1 || rot === 3) && this.flip) wy = this.Y(ly + 1);
    const lk = room ? lootKey(this.bb.b, room) : `${this.bb.b.kind}|none`;
    return furnishAt(this.bb.g, room, kind, wx, wy, r, lk, this.bb.b.id);
  }
}

function roofFor(x0: number, y0: number, x1: number, y1: number, style: RoofPart['style']): RoofPart[] {
  return [{ x0, y0, x1, y1, style, ridgeX: x1 - x0 >= y1 - y0 }];
}

function makeFrame(g: Gen, kind: BuildingKind, name: string, x0: number, y0: number, W: number, H: number, flip: boolean, opts: ConstructorParameters<typeof BB>[7] = {}): Frame {
  const bb = new BB(g, kind, name, x0, y0, x0 + W - 1, y0 + H - 1, { roofs: roofFor(x0, y0, x0 + W - 1, y0 + H - 1, 'flat'), ...opts });
  return new Frame(bb, x0, y0, W, H, flip);
}

function frontWindows(f: Frame, skip: Set<number>, big: boolean, step = 1): void {
  for (let lx = 2; lx <= f.W - 3; lx += step) {
    if (skip.has(lx) || skip.has(lx - 1) || skip.has(lx + 1)) continue;
    const wx = f.X(lx);
    const wy = f.Y(0);
    const inY = f.Y(1);
    const w = f.bb.g.w;
    if (w.struct[wy * w.w + wx] !== S.Wall) continue;
    if (w.room[inY * w.w + wx] < 0) continue;
    f.window(lx, 0, big);
  }
}

function addExtra(g: Gen, containerId: number, id: string, opts: Parameters<typeof makeItem>[2] = {}): void {
  if (containerId < 0) return;
  (g.extras[containerId] ??= []).push(makeItem(g.uid, id, opts));
}

/** Put a building's key somewhere inside it (kitchen counter, desk, etc.). */
export function hideKey(g: Gen, bld: number, preferRooms: RoomType[], label: string, itemId = 'houseKey', keyId?: number): number {
  const w = g.w;
  const b = w.buildings[bld];
  const cands: number[] = [];
  for (const rid of b.rooms) {
    const r = w.rooms[rid];
    if (!preferRooms.includes(r.type)) continue;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const fi = w.furn[y * w.w + x];
        if (fi >= 0 && w.furniture[fi].containerId >= 0) cands.push(w.furniture[fi].containerId);
      }
    }
  }
  if (!cands.length) return -1;
  const cid = g.rng.pick(cands);
  addExtra(g, cid, itemId, { keyId: keyId ?? b.keyId, label });
  return cid;
}

// =================================================================== HOUSE

interface Rect { x0: number; y0: number; x1: number; y1: number }

function bsp(bb: BB, r: Rect, depth: number, out: Rect[], maxDepth: number): void {
  const g = bb.g;
  const w = g.w;
  const rng = g.rng;
  const W = r.x1 - r.x0 + 1;
  const H = r.y1 - r.y0 + 1;
  const canX = W >= 7;
  const canY = H >= 7;
  const area = W * H;
  if ((!canX && !canY) || depth >= maxDepth || (area <= 22 && depth >= 1 && rng.chance(0.55))) {
    out.push(r);
    return;
  }
  const vertical = canX && (!canY || W > H || (W === H && rng.chance(0.5)));
  for (let t = 0; t < 12; t++) {
    if (vertical) {
      const sx = rng.int(r.x0 + 3, r.x1 - 3);
      const top = w.struct[(r.y0 - 1) * w.w + sx];
      const bot = w.struct[(r.y1 + 1) * w.w + sx];
      if (top !== S.Wall || bot !== S.Wall) continue;
      bb.wallV(sx, r.y0, r.y1);
      bb.door(sx, rng.int(r.y0, r.y1), 'wood', false, false);
      bsp(bb, { x0: r.x0, y0: r.y0, x1: sx - 1, y1: r.y1 }, depth + 1, out, maxDepth);
      bsp(bb, { x0: sx + 1, y0: r.y0, x1: r.x1, y1: r.y1 }, depth + 1, out, maxDepth);
      return;
    } else {
      const sy = rng.int(r.y0 + 3, r.y1 - 3);
      const l = w.struct[sy * w.w + r.x0 - 1];
      const rr = w.struct[sy * w.w + r.x1 + 1];
      if (l !== S.Wall || rr !== S.Wall) continue;
      bb.wallH(sy, r.x0, r.x1);
      bb.door(rng.int(r.x0, r.x1), sy, 'wood', false, false);
      bsp(bb, { x0: r.x0, y0: r.y0, x1: r.x1, y1: sy - 1 }, depth + 1, out, maxDepth);
      bsp(bb, { x0: r.x0, y0: sy + 1, x1: r.x1, y1: r.y1 }, depth + 1, out, maxDepth);
      return;
    }
  }
  out.push(r);
}

/** Find a wall tile on the given outer side adjacent to room r, suitable for an exterior door. */
function exteriorDoorSpot(bb: BB, r: Rect, side: 'n' | 's' | 'e' | 'w'): [number, number] | null {
  const w = bb.g.w;
  const { x0, y0, x1, y1 } = bb.b;
  const cands: [number, number][] = [];
  if (side === 'n' || side === 's') {
    const wy = side === 'n' ? y0 : y1;
    const iy = side === 'n' ? y0 + 1 : y1 - 1;
    if ((side === 'n' && r.y0 !== iy) || (side === 's' && r.y1 !== iy)) return null;
    for (let x = r.x0 + 1; x <= r.x1 - 1; x++) {
      if (w.struct[wy * w.w + x] !== S.Wall) continue;
      if (!isWallTile(w, x - 1, wy) || !isWallTile(w, x + 1, wy)) continue;
      if (w.struct[wy * w.w + x - 1] !== S.Wall || w.struct[wy * w.w + x + 1] !== S.Wall) continue;
      cands.push([x, wy]);
    }
  } else {
    const wx = side === 'w' ? x0 : x1;
    const ix = side === 'w' ? x0 + 1 : x1 - 1;
    if ((side === 'w' && r.x0 !== ix) || (side === 'e' && r.x1 !== ix)) return null;
    for (let y = r.y0 + 1; y <= r.y1 - 1; y++) {
      if (w.struct[y * w.w + wx] !== S.Wall) continue;
      if (w.struct[(y - 1) * w.w + wx] !== S.Wall || w.struct[(y + 1) * w.w + wx] !== S.Wall) continue;
      cands.push([wx, y]);
    }
  }
  if (!cands.length) return null;
  return bb.g.rng.pick(cands);
}

export interface HouseOpts {
  front: 'n' | 's';
  address: string;
  garage?: 'left' | 'right' | null;
  kind?: BuildingKind;
  name?: string;
}

export function genHouse(g: Gen, x0: number, y0: number, x1: number, y1: number, o: HouseOpts): BB {
  const rng = g.rng;
  const kind = o.kind ?? 'house';
  const bb = new BB(g, kind, o.name ?? 'House', x0, y0, x1, y1, {
    roofs: [{ x0, y0, x1, y1, style: rng.chance(0.3) ? 'hip' : 'gable', ridgeX: x1 - x0 >= y1 - y0 }],
    address: o.address,
    alarm: 0.12,
  });
  const w = g.w;
  let ix0 = x0 + 1;
  let ix1 = x1 - 1;
  const iy0 = y0 + 1;
  const iy1 = y1 - 1;
  let garageRoom: Room | null = null;
  let backRoom: Room | null = null;
  if (o.garage) {
    const gw = 4;
    const depth = Math.min(iy1 - iy0 + 1, 7);
    const gx0 = o.garage === 'left' ? ix0 : ix1 - gw + 1;
    const gx1 = gx0 + gw - 1;
    const wallX = o.garage === 'left' ? gx1 + 1 : gx0 - 1;
    const gy0 = o.front === 'n' ? iy0 : iy1 - depth + 1;
    const gy1 = gy0 + depth - 1;
    bb.wallV(wallX, iy0, iy1);
    const backWallY = o.front === 'n' ? gy1 + 1 : gy0 - 1;
    const fullDepth = depth === iy1 - iy0 + 1;
    if (!fullDepth) bb.wallH(backWallY, gx0, gx1);
    garageRoom = bb.room('garage', gx0, gy0, gx1, gy1);
    // storage behind the garage if it doesn't fill the depth
    if (!fullDepth) {
      const sy0 = o.front === 'n' ? gy1 + 2 : iy0;
      const sy1 = o.front === 'n' ? iy1 : gy0 - 2;
      if (sy1 >= sy0) {
        backRoom = bb.room(rng.chance(0.5) ? 'laundry' : 'storage', gx0, sy0, gx1, sy1);
        bb.door(wallX, rng.int(sy0, sy1), 'wood', false, false);
      }
    }
    // connecting door from garage into the house
    bb.door(wallX, o.front === 'n' ? gy1 - 1 : gy0 + 1, 'wood', false, rng.chance(0.3));
    // garage doors on the front wall (two tiles, grouped)
    const fy = o.front === 'n' ? y0 : y1;
    bb.door(gx0 + 1, fy, 'garage', true, rng.chance(0.7));
    bb.door(gx0 + 2, fy, 'garage', true, rng.chance(0.7));
    const gd1 = w.doors[w.doors.length - 2];
    const gd2 = w.doors[w.doors.length - 1];
    gd2.locked = gd1.locked;
    if (o.garage === 'left') ix0 = wallX + 1;
    else ix1 = wallX - 1;
  }
  const rects: Rect[] = [];
  const area = (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
  bsp(bb, { x0: ix0, y0: iy0, x1: ix1, y1: iy1 }, 0, rects, area > 90 ? 4 : 3);

  // ---- room typing
  const areaOf = (r: Rect): number => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const touchesFront = (r: Rect): boolean => (o.front === 'n' ? r.y0 === iy0 : r.y1 === iy1);
  const touchesBack = (r: Rect): boolean => (o.front === 'n' ? r.y1 === iy1 : r.y0 === iy0);
  const types = new Map<Rect, RoomType>();
  const fronts = rects.filter(touchesFront).sort((a, b) => areaOf(b) - areaOf(a));
  const living = fronts[0] ?? rects[0];
  types.set(living, 'living');
  const rest = rects.filter((r) => r !== living);
  // kitchen: prefer a back room of decent size
  rest.sort((a, b) => (touchesBack(b) ? 1 : 0) - (touchesBack(a) ? 1 : 0) || areaOf(b) - areaOf(a));
  const kitchen = rest.find((r) => areaOf(r) >= 9) ?? rest[0];
  if (kitchen) types.set(kitchen, 'kitchen');
  const rem = rest.filter((r) => r !== kitchen).sort((a, b) => areaOf(a) - areaOf(b));
  if (rem.length) types.set(rem[0], 'bathroom');
  let beds = 0;
  for (const r of rem.slice(1)) {
    if (beds >= 3 && areaOf(r) <= 12) types.set(r, rng.chance(0.5) ? 'office' : 'laundry');
    else {
      types.set(r, 'bedroom');
      beds++;
    }
  }
  if (!kitchen) {
    // tiny house: the living room doubles as kitchen
    types.set(living, 'kitchen');
  }
  const rooms: Room[] = [];
  for (const r of rects) rooms.push(bb.room(types.get(r)!, r.x0, r.y0, r.x1, r.y1));

  // ---- exterior doors
  const frontSpot = exteriorDoorSpot(bb, living, o.front) ?? fronts.map((r) => exteriorDoorSpot(bb, r, o.front)).find((s) => s);
  if (frontSpot) {
    const d = bb.door(frontSpot[0], frontSpot[1], 'wood', true);
    bb.alarmPanelNear(d);
  }
  const back: 'n' | 's' = o.front === 'n' ? 's' : 'n';
  if (rng.chance(0.7)) {
    const cand = [kitchen, ...rects].filter(Boolean).map((r) => exteriorDoorSpot(bb, r!, back)).find((s) => s);
    if (cand) bb.door(cand[0], cand[1], 'wood', true);
  }
  if (!frontSpot) {
    // fall back to a side door
    for (const r of rects) {
      const s = exteriorDoorSpot(bb, r, 'w') ?? exteriorDoorSpot(bb, r, 'e');
      if (s) {
        bb.door(s[0], s[1], 'wood', true);
        break;
      }
    }
  }
  bb.autoWindows(3);
  for (const r of rooms) furnishRoom(g, bb.b, r);
  if (garageRoom) furnishRoom(g, bb.b, garageRoom);
  if (backRoom) furnishRoom(g, bb.b, backRoom);
  hideKey(g, bb.b.id, ['kitchen', 'living', 'bedroom'], `House key (${o.address})`);
  if (!inB(w, x0, y0)) throw new Error('house out of bounds');
  return bb;
}

// =================================================================== APARTMENT

export function genApartment(g: Gen, x0: number, y0: number, W: number, H: number, flip: boolean, name: string): Frame {
  const f = makeFrame(g, 'apartment', name, x0, y0, W, H, flip, { alarm: 0.05, wallColor: g.rng.pick([0x9c8f80, 0x8d8a84, 0xa39383]) });
  const rng = g.rng;
  const cx = Math.floor(W / 2) - 1; // corridor lx = cx, cx+1
  f.wallV(cx - 1, 1, H - 2);
  f.wallV(cx + 2, 1, H - 2);
  f.room('hallway', cx, 1, cx + 1, H - 2);
  f.door(cx, 0, 'glass', true);
  f.door(cx + 1, 0, 'glass', true);
  f.door(cx, H - 1, 'metal', true);
  const midY = Math.floor(H / 2);
  const sides: [number, number][] = [[1, cx - 2], [cx + 3, W - 2]];
  for (const [ax, bx] of sides) {
    f.wallH(midY, ax, bx);
    for (const [ay, by] of [[1, midY - 1], [midY + 1, H - 2]] as [number, number][]) {
      // unit: main room (kitchen/living), bedroom, bathroom
      const unitW = bx - ax + 1;
      const splitX = ax + Math.floor(unitW * 0.55);
      f.wallV(splitX, ay, by);
      let main: Room;
      let bedArea: [number, number, number, number];
      if (ax === 1) {
        main = f.room('kitchen', splitX + 1, ay, bx, by);
        bedArea = [ax, ay, splitX - 1, by];
      } else {
        main = f.room('kitchen', ax, ay, splitX - 1, by);
        bedArea = [splitX + 1, ay, bx, by];
      }
      // door from corridor into main room
      const dy = rng.int(ay + 1, by - 1);
      f.door(ax === 1 ? cx - 1 : cx + 2, dy, 'wood', false, rng.chance(0.5));
      // bedroom + bathroom split
      const [bx0, by0, bx1, by1] = bedArea;
      const bathH = 2;
      const bathTop = ay === 1;
      const wallY = bathTop ? by0 + bathH : by1 - bathH;
      f.wallH(wallY, bx0, bx1);
      const bath = bathTop ? f.room('bathroom', bx0, by0, bx1, wallY - 1) : f.room('bathroom', bx0, wallY + 1, bx1, by1);
      const bed = bathTop ? f.room('bedroom', bx0, wallY + 1, bx1, by1) : f.room('bedroom', bx0, by0, bx1, wallY - 1);
      f.door(splitX, bathTop ? rng.int(wallY + 1, by1) : rng.int(by0, wallY - 1), 'wood', false, false);
      f.door(rng.int(bx0, bx1), wallY, 'wood', false, false);
      furnishRoom(g, f.bb.b, main);
      furnishWall(g, main, 'couch', lootKey(f.bb.b, main));
      furnishRoom(g, f.bb.b, bed);
      furnishRoom(g, f.bb.b, bath);
    }
  }
  f.bb.autoWindows(3, false, ['e', 'w', 'n', 's'], 0.9);
  return f;
}

// =================================================================== SHOPS

function shopFloor(f: Frame, type: RoomType, lx0: number, ly0: number, lx1: number, ly1: number): Room {
  return f.room(type, lx0, ly0, lx1, ly1);
}

function aisles(f: Frame, room: Room, lx0: number, lx1: number, ly0: number, ly1: number, every = 3, kind: FurnKind = 'shelf'): void {
  for (let lx = lx0; lx <= lx1; lx += every) {
    for (let ly = ly0; ly <= ly1; ly++) f.furn(room, kind, lx, ly, 1);
  }
}

export function genGrocery(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 26;
  const H = 18;
  const f = makeFrame(g, 'grocery', 'Fresh Market Grocery', x0, y0, W, H, flip, { alarm: 0.45, wallColor: 0xb7a78c });
  f.wallH(H - 7, 1, W - 2);
  f.wallV(6, H - 6, H - 2);
  const floor = shopFloor(f, 'grocery', 1, 1, W - 2, H - 8);
  const storage = f.room('storage', 7, H - 6, W - 2, H - 2);
  const office = f.room('office', 1, H - 6, 5, H - 2);
  const d1 = f.door(12, 0, 'glass', true);
  f.door(13, 0, 'glass', true);
  f.bb.alarmPanelNear(d1);
  f.door(W - 5, H - 7, 'wood', false, false);
  f.door(6, H - 4, 'wood', false, true);
  f.door(W - 7, H - 1, 'metal', true);
  frontWindows(f, new Set([12, 13]), true);
  aisles(f, floor, 3, W - 5, 5, H - 11, 3);
  for (let lx = 2; lx <= W - 3; lx++) f.furn(floor, 'cooler', lx, H - 8, 2);
  for (const lx of [4, 8, 17, 21]) f.furn(floor, 'checkout', lx, 2, 0);
  for (let i = 0; i < 6; i++) furnishWall(g, storage, i % 2 ? 'crate' : 'shelf', `grocery|grocery`);
  furnishWall(g, storage, 'pallet', 'grocery|grocery');
  furnishRoom(g, f.bb.b, office);
  // groceries in the back storage use the grocery shelf table
  return f;
}

export function genPharmacy(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 14;
  const H = 14;
  const f = makeFrame(g, 'pharmacy', 'Hollow Pharmacy', x0, y0, W, H, flip, { alarm: 0.75, wallColor: 0xc4c0b4 });
  f.wallH(9, 1, W - 2);
  const floor = shopFloor(f, 'pharmacy', 1, 1, W - 2, 8);
  const back = f.room('clinicPharmacy', 1, 10, W - 2, H - 2);
  const d = f.door(6, 0, 'glass', true);
  f.door(7, 0, 'glass', true);
  f.bb.alarmPanelNear(d);
  f.door(10, 9, 'metal', false, true);
  f.door(3, H - 1, 'metal', true, true);
  frontWindows(f, new Set([6, 7]), true);
  aisles(f, floor, 3, 10, 3, 6, 3);
  f.furn(floor, 'checkout', 2, 8, 0);
  f.furn(floor, 'checkout', 3, 8, 0);
  for (let i = 0; i < 5; i++) furnishWall(g, back, 'medcab', 'pharmacy|clinicPharmacy');
  furnishWall(g, back, 'shelf', 'pharmacy|clinicPharmacy');
  // pharmacy keys: behind the counter
  return f;
}

export function genHardware(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 20;
  const H = 16;
  const f = makeFrame(g, 'hardware', 'Kessler Hardware', x0, y0, W, H, flip, { alarm: 0.4, wallColor: 0xa08f75 });
  f.wallH(H - 6, 1, W - 2);
  const floor = shopFloor(f, 'hardware', 1, 1, W - 2, H - 7);
  const back = f.room('storage', 1, H - 5, W - 2, H - 2);
  const d = f.door(9, 0, 'glass', true);
  f.door(10, 0, 'glass', true);
  f.bb.alarmPanelNear(d);
  f.door(4, H - 6, 'wood', false, false);
  f.door(W - 4, H - 1, 'metal', true);
  frontWindows(f, new Set([9, 10]), true, 2);
  aisles(f, floor, 3, W - 6, 4, H - 9, 3);
  for (let ly = 3; ly <= H - 9; ly++) f.furn(floor, 'lumber', W - 3, ly, 1);
  f.furn(floor, 'checkout', 3, 2, 0);
  for (let i = 0; i < 6; i++) furnishWall(g, back, i % 3 === 0 ? 'lumber' : 'crate', 'hardware|hardware');
  for (const c of g.w.containers) if (c.loot === 'hardware|storage') c.loot = 'hardware|hardware';
  for (const c of g.w.containers) if (c.loot === 'hardware|hardware' && c.kind === 'crate') c.loot = 'hardware|hardware';
  return f;
}

export function genDiner(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 16;
  const H = 12;
  const f = makeFrame(g, 'diner', "Rosie's Diner", x0, y0, W, H, flip, { alarm: 0.2, wallColor: 0xb57e62 });
  f.wallH(7, 1, W - 2);
  f.wallV(4, 8, H - 2);
  const dining = shopFloor(f, 'diner', 1, 1, W - 2, 6);
  const kitchen = f.room('dinerKitchen', 5, 8, W - 2, H - 2);
  const bath = f.room('bathroom', 1, 8, 3, H - 2);
  f.door(7, 0, 'glass', true);
  f.door(11, 7, 'wood', false, false);
  f.door(2, 7, 'wood', false, false);
  f.door(W - 3, H - 1, 'metal', true);
  frontWindows(f, new Set([7]), true, 2);
  for (let lx = 3; lx <= 9; lx++) f.furn(dining, 'barcounter', lx, 5, 2);
  for (const lx of [2, 5, 10, 13]) f.furn(dining, 'booth', lx, 1, 0);
  for (const lx of [3, 11, 13]) f.furn(dining, 'table', lx, 3, 0);
  for (let i = 0; i < 2; i++) furnishWall(g, kitchen, 'stove', lootKey(f.bb.b, kitchen));
  furnishWall(g, kitchen, 'fridge', lootKey(f.bb.b, kitchen));
  furnishWall(g, kitchen, 'freezer', lootKey(f.bb.b, kitchen));
  for (let i = 0; i < 3; i++) furnishWall(g, kitchen, 'counter', lootKey(f.bb.b, kitchen));
  furnishWall(g, kitchen, 'sinkCounter', lootKey(f.bb.b, kitchen));
  furnishRoom(g, f.bb.b, bath);
  return f;
}

export function genBar(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 14;
  const H = 12;
  const f = makeFrame(g, 'bar', 'The Anchor Bar', x0, y0, W, H, flip, { alarm: 0.25, wallColor: 0x6e5a4b });
  f.wallH(8, 1, W - 2);
  f.wallV(4, 9, H - 2);
  const bar = f.room('bar', 1, 1, W - 2, 7);
  const bath = f.room('bathroom', 1, 9, 3, H - 2);
  const store = f.room('storage', 5, 9, W - 2, H - 2);
  f.door(3, 0, 'wood', true);
  f.door(2, 8, 'wood', false, false);
  f.door(9, 8, 'wood', false, false);
  f.door(W - 3, H - 1, 'metal', true);
  frontWindows(f, new Set([3]), false, 3);
  for (let ly = 2; ly <= 6; ly++) f.furn(bar, 'barcounter', W - 4, ly, 1);
  for (const [lx, ly] of [[3, 3], [6, 3], [3, 6], [6, 6]]) f.furn(bar, 'table', lx, ly, 0);
  for (let i = 0; i < 4; i++) furnishWall(g, store, 'crate', 'bar|bar');
  furnishRoom(g, f.bb.b, bath);
  return f;
}

export function genOffice(g: Gen, x0: number, y0: number, flip: boolean, name = 'First County Bank'): Frame {
  const W = 14;
  const H = 12;
  const f = makeFrame(g, 'office', name, x0, y0, W, H, flip, { alarm: 0.5, wallColor: 0xb2aa9c });
  f.wallH(6, 1, W - 2);
  f.wallV(6, 7, H - 2);
  const lobby = f.room('waiting', 1, 1, W - 2, 5);
  const o1 = f.room('office', 1, 7, 5, H - 2);
  const o2 = f.room('office', 7, 7, W - 2, H - 2);
  const d = f.door(6, 0, 'glass', true);
  f.bb.alarmPanelNear(d);
  f.door(3, 6, 'wood', false, false);
  f.door(10, 6, 'wood', false, true);
  frontWindows(f, new Set([6]), true, 2);
  furnishRoom(g, f.bb.b, lobby);
  furnishRoom(g, f.bb.b, o1);
  furnishRoom(g, f.bb.b, o2);
  return f;
}

// =================================================================== SERVICES

export function genPolice(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 22;
  const H = 18;
  const f = makeFrame(g, 'police', 'Cedar Hollow Police', x0, y0, W, H, flip, { alarm: 0.6, wallColor: 0x8e969c, roofColor: 0x3a3f44 });
  const rng = g.rng;
  // lobby
  f.wallH(6, 1, W - 2);
  const lobby = f.room('policeLobby', 1, 1, W - 2, 5);
  // corridor lx 9..10 from ly 7 to H-2
  f.wallV(8, 7, H - 2);
  f.wallV(11, 7, H - 2);
  f.room('hallway', 9, 7, 10, H - 2);
  // left: two offices
  f.wallH(11, 1, 7);
  const o1 = f.room('policeOffice', 1, 7, 7, 10);
  const o2 = f.room('policeOffice', 1, 12, 7, H - 2);
  // right: lockers, armory, cells
  f.wallH(10, 12, W - 2);
  const lockers = f.room('lockers', 12, 7, W - 2, 9);
  f.wallV(16, 11, H - 2);
  const armory = f.room('armory', 12, 11, 15, H - 2);
  const cells = f.room('cells', 17, 11, W - 2, H - 2);
  const front = f.door(10, 0, 'glass', true);
  f.door(11, 0, 'glass', true);
  f.bb.alarmPanelNear(front);
  f.door(9, 6, 'wood', false, rng.chance(0.3));
  f.door(8, 8, 'wood', false, false);
  f.door(8, 14, 'wood', false, rng.chance(0.4));
  f.door(11, 8, 'wood', false, false);
  const armoryDoor = f.door(11, 13, 'metal', false, true);
  f.door(18, 10, 'cell', false, rng.chance(0.5));
  f.door(10, H - 1, 'metal', true, true);
  frontWindows(f, new Set([10, 11]), false, 3);
  f.bb.autoWindows(4, false, ['e', 'w'], 0.8);
  furnishRoom(g, f.bb.b, lobby);
  furnishRoom(g, f.bb.b, o1);
  furnishRoom(g, f.bb.b, o2);
  furnishRoom(g, f.bb.b, lockers);
  furnishRoom(g, f.bb.b, armory);
  furnishRoom(g, f.bb.b, cells);
  // The armory has its own key, kept in the chief's desk.
  const w = g.w;
  const armoryKey = w.nextKeyId++;
  w.doors[armoryDoor].keyId = armoryKey;
  hideKey(g, f.bb.b.id, ['policeOffice'], 'Armory key', 'houseKey', armoryKey);
  hideKey(g, f.bb.b.id, ['policeOffice', 'lockers'], 'Police station key');
  return f;
}

export function genClinic(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 19;
  const H = 16;
  const f = makeFrame(g, 'clinic', 'Hollow Family Clinic', x0, y0, W, H, flip, { alarm: 0.5, wallColor: 0xcfcac0, roofColor: 0x5b5f63 });
  const rng = g.rng;
  f.wallH(5, 1, W - 2);
  const waiting = f.room('waiting', 1, 1, W - 2, 4);
  // corridor ly 6..7
  f.wallH(8, 1, W - 2);
  f.room('hallway', 1, 6, W - 2, 7);
  // exam rooms and pharmacy behind
  const cuts = [5, 10, 14];
  for (const c of cuts) f.wallV(c, 9, H - 2);
  const e1 = f.room('exam', 1, 9, 4, H - 2);
  const e2 = f.room('exam', 6, 9, 9, H - 2);
  const e3 = f.room('exam', 11, 9, 13, H - 2);
  const ph = f.room('clinicPharmacy', 15, 9, W - 2, H - 2);
  const d = f.door(9, 0, 'glass', true);
  f.door(10, 0, 'glass', true);
  f.bb.alarmPanelNear(d);
  f.door(4, 5, 'wood', false, false);
  f.door(15, 5, 'wood', false, false);
  f.door(3, 8, 'wood', false, false);
  f.door(8, 8, 'wood', false, false);
  f.door(12, 8, 'wood', false, rng.chance(0.3));
  f.door(16, 8, 'metal', false, true);
  f.door(W - 1, 7, 'metal', true, true);
  frontWindows(f, new Set([9, 10]), true, 2);
  furnishRoom(g, f.bb.b, waiting);
  for (const r of [e1, e2, e3, ph]) furnishRoom(g, f.bb.b, r);
  hideKey(g, f.bb.b.id, ['waiting'], 'Clinic key');
  return f;
}

export function genGasStation(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 12;
  const H = 9;
  const f = makeFrame(g, 'gas', 'Gas-N-Go', x0, y0, W, H, flip, { alarm: 0.5, wallColor: 0xc9c2b2, roofColor: 0x8a2d25 });
  f.wallV(8, 5, H - 2);
  f.wallH(5, 8, W - 2);
  const storeRoom = f.room('gasstore', 1, 1, W - 2, H - 2);
  // bathroom carved from the store corner
  const bath = f.room('bathroom', 9, 6, W - 2, H - 2);
  const d = f.door(4, 0, 'glass', true);
  f.bb.alarmPanelNear(d);
  f.door(9, 5, 'wood', false, false);
  f.door(2, H - 1, 'metal', true);
  frontWindows(f, new Set([4]), true);
  f.furn(storeRoom, 'checkout', 7, 2, 0);
  f.furn(storeRoom, 'checkout', 8, 2, 0);
  aisles(f, storeRoom, 3, 6, 4, 5, 3);
  for (let lx = 1; lx <= 7; lx++) f.furn(storeRoom, 'cooler', lx, H - 2, 2);
  furnishRoom(g, f.bb.b, bath);
  return f;
}

export function genAutoRepair(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 18;
  const H = 12;
  const f = makeFrame(g, 'garage', "Dale's Auto Repair", x0, y0, W, H, flip, { alarm: 0.3, wallColor: 0x8b8d86 });
  f.wallV(5, 1, 5);
  f.wallH(6, 1, 4);
  const office = f.room('office', 1, 1, 4, 5);
  const shop = f.room('garage', 5, 1, W - 2, H - 2);
  // the rest of the left column is shop too
  f.room('garage', 1, 7, 4, H - 2);
  f.door(2, 0, 'glass', true);
  f.door(5, 3, 'wood', false, false);
  f.door(2, 6, 'wood', false, false);
  for (const lx of [8, 9, 13, 14]) f.door(lx, 0, 'garage', true, true);
  f.door(W - 3, H - 1, 'metal', true);
  furnishRoom(g, f.bb.b, office);
  for (let i = 0; i < 3; i++) furnishWall(g, shop, 'workbench', 'house|garage');
  for (let i = 0; i < 3; i++) furnishWall(g, shop, 'toolchest', 'house|garage');
  for (let i = 0; i < 2; i++) furnishWall(g, shop, 'shelf', 'house|garage');
  g.vehicles.push({ x: f.X(11) + 0.5, y: f.Y(6) + 0.5, heading: Math.PI / 2, key: 'house', bld: f.bb.b.id });
  hideKey(g, f.bb.b.id, ['office'], "Dale's shop key");
  return f;
}

export function genMotel(g: Gen, x0: number, y0: number, flip: boolean, rooms = 6): Frame {
  const W = 1 + (rooms + 1) * 6;
  const H = 9;
  const f = makeFrame(g, 'motel', 'Pine Motel', x0, y0, W, H, flip, { alarm: 0.15, wallColor: 0xb89a74, roofColor: 0x4d3b30 });
  const rng = g.rng;
  for (let r = 0; r <= rooms; r++) {
    const sx = r * 6;
    if (r > 0) f.wallV(sx, 1, H - 2);
    if (r === 0) {
      const lobby = f.room('waiting', 1, 1, 5, H - 2);
      f.door(3, 0, 'glass', true);
      f.window(1 + 0 + 4, 0, false);
      furnishRoom(g, f.bb.b, lobby);
      hideKey(g, f.bb.b.id, ['waiting'], 'Motel master key');
      continue;
    }
    f.wallH(H - 4, sx + 1, sx + 5);
    const main = f.room('motelRoom', sx + 1, 1, sx + 5, H - 5);
    const bath = f.room('bathroom', sx + 1, H - 3, sx + 5, H - 2);
    f.door(sx + 2, 0, 'wood', true, rng.chance(0.55));
    f.window(sx + 4, 0, false);
    f.door(sx + 4, H - 4, 'wood', false, false);
    furnishRoom(g, f.bb.b, main);
    furnishRoom(g, f.bb.b, bath);
  }
  return f;
}

// =================================================================== INDUSTRIAL

export function genWarehouse(g: Gen, x0: number, y0: number, flip: boolean, name: string): Frame {
  const W = 32;
  const H = 20;
  const f = makeFrame(g, 'warehouse', name, x0, y0, W, H, flip, { alarm: 0.3, wallColor: 0x7d8584, roofColor: 0x50575a });
  f.wallH(6, 1, 15);
  f.wallV(8, 1, 5);
  f.wallV(16, 1, 6);
  const office = f.room('office', 1, 1, 7, 5);
  const brk = f.room('breakroom', 9, 1, 15, 5);
  const hall = f.room('warehouse', 1, 7, W - 2, H - 2);
  f.room('warehouse', 17, 1, W - 2, 6);
  f.door(4, 0, 'metal', true);
  f.door(4, 6, 'wood', false, false);
  f.door(12, 6, 'wood', false, false);
  for (const lx of [20, 21, 25, 26]) f.door(lx, 0, 'garage', true, true);
  for (const lx of [10, 11]) f.door(lx, H - 1, 'garage', true, true);
  f.window(2, 0);
  f.window(6, 0);
  f.window(13, 0);
  furnishRoom(g, f.bb.b, office);
  furnishRoom(g, f.bb.b, brk);
  for (const ly of [9, 13, H - 4]) {
    for (let lx = 3; lx <= W - 4; lx++) {
      if (lx === 10 || lx === 11 || lx === 20 || lx === 21) continue;
      f.furn(hall, 'rack', lx, ly, 0);
    }
  }
  for (let i = 0; i < 6; i++) furnishWall(g, hall, i % 2 ? 'pallet' : 'crate', lootKey(f.bb.b, hall));
  hideKey(g, f.bb.b.id, ['office'], `${name} key`);
  return f;
}

export function genFactory(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 28;
  const H = 18;
  const f = makeFrame(g, 'factory', 'Hollow Canning Co.', x0, y0, W, H, flip, { alarm: 0.25, wallColor: 0x8e7f6f, roofColor: 0x484442 });
  f.wallH(6, 1, 12);
  f.wallV(6, 1, 5);
  f.wallV(13, 1, 6);
  const office = f.room('office', 1, 1, 5, 5);
  const lockers = f.room('lockers', 7, 1, 12, 5);
  const floor = f.room('factory', 1, 7, W - 2, H - 2);
  f.room('factory', 14, 1, W - 2, 6);
  f.door(3, 0, 'metal', true);
  f.door(3, 6, 'wood', false, false);
  f.door(9, 6, 'wood', false, false);
  for (const lx of [18, 19]) f.door(lx, 0, 'garage', true, true);
  f.door(W - 1, 12, 'metal', true, true);
  f.bb.autoWindows(4, false, ['n', 'e', 'w'], 0.7);
  furnishRoom(g, f.bb.b, office);
  furnishRoom(g, f.bb.b, lockers);
  for (const ly of [9, 13]) {
    for (let lx = 3; lx <= W - 5; lx += 4) f.furn(floor, 'machine', lx, ly, 0);
  }
  for (let i = 0; i < 5; i++) furnishWall(g, floor, 'rack', lootKey(f.bb.b, floor));
  return f;
}

export function genChurch(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 16;
  const H = 24;
  const f = makeFrame(g, 'church', 'St. Brigid Church', x0, y0, W, H, flip, {
    wallColor: 0xd0c8b8, roofColor: 0x3c3a3e,
    roofs: [{ x0, y0, x1: x0 + W - 1, y1: y0 + H - 1, style: 'gable', ridgeX: false }],
  });
  f.wallH(H - 6, 1, W - 2);
  const hall = f.room('church', 1, 1, W - 2, H - 7);
  const back = f.room('office', 1, H - 5, W - 2, H - 2);
  f.door(7, 0, 'wood', true);
  f.door(8, 0, 'wood', true);
  f.door(4, H - 6, 'wood', false, false);
  f.door(W - 1, H - 3, 'wood', true);
  f.bb.autoWindows(3, false, ['e', 'w']);
  furnishRoom(g, f.bb.b, hall);
  furnishRoom(g, f.bb.b, back);
  return f;
}

// =================================================================== RURAL

export function genBarn(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 18;
  const H = 13;
  const f = makeFrame(g, 'barn', 'Hartley Barn', x0, y0, W, H, flip, {
    wallColor: 0x8a3a2e, roofColor: 0x3d3533,
    roofs: [{ x0, y0, x1: x0 + W - 1, y1: y0 + H - 1, style: 'gable', ridgeX: false }],
  });
  const barn = f.room('barn', 1, 1, W - 2, H - 2);
  for (const lx of [8, 9]) f.door(lx, 0, 'garage', true, false);
  f.door(2, H - 1, 'wood', true, false);
  f.bb.autoWindows(4, false, ['e', 'w'], 0.6);
  for (let i = 0; i < 5; i++) furnishWall(g, barn, 'hay', 'barn|barn');
  furnishWall(g, barn, 'workbench', 'barn|barn');
  for (let i = 0; i < 2; i++) furnishWall(g, barn, 'crate', 'barn|barn');
  furnishCenter(g, barn, 'tractor', 'barn|barn', 1);
  return f;
}

export function genCabin(g: Gen, x0: number, y0: number, flip: boolean, name: string): Frame {
  const W = 10;
  const H = 8;
  const f = makeFrame(g, 'cabin', name, x0, y0, W, H, flip, {
    wallColor: 0x6b4f38, roofColor: 0x3a3029,
    roofs: [{ x0, y0, x1: x0 + W - 1, y1: y0 + H - 1, style: 'gable', ridgeX: true }],
  });
  f.wallV(6, 1, H - 2);
  f.wallH(4, 7, W - 2);
  const main = f.room('cabin', 1, 1, 5, H - 2);
  const bed = f.room('bedroom', 7, 1, W - 2, 3);
  const bath = f.room('bathroom', 7, 5, W - 2, H - 2);
  f.door(3, 0, 'wood', true);
  f.door(6, 2, 'wood', false, false);
  f.door(6, 5, 'wood', false, false);
  f.bb.autoWindows(3);
  furnishRoom(g, f.bb.b, main);
  furnishWall(g, bed, 'bed', lootKey(f.bb.b, bed));
  furnishWall(g, bed, 'wardrobe', 'cabin|cabin');
  furnishRoom(g, f.bb.b, bath);
  // main room uses the cabin tables for its counters and wardrobe
  for (const c of g.w.containers.slice(-10)) {
    if (c.loot === 'cabin|cabin' && c.kind === 'counter') c.loot = 'cabin|cabin';
  }
  hideKey(g, f.bb.b.id, ['cabin'], `${name} key`);
  return f;
}

export function genShed(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const f = makeFrame(g, 'shed', 'Shed', x0, y0, 5, 5, flip, { wallColor: 0x7a6a55, roofColor: 0x3f3a33 });
  const r = f.room('shed', 1, 1, 3, 3);
  f.door(2, 0, 'wood', true, g.rng.chance(0.3));
  furnishRoom(g, f.bb.b, r);
  return f;
}

export function genTent(g: Gen, x0: number, y0: number, flip: boolean): Frame {
  const W = 7;
  const H = 5;
  const f = makeFrame(g, 'checkpoint', 'Checkpoint tent', x0, y0, W, H, flip, {
    wallColor: 0x5c6346, roofColor: 0x4e553b,
    roofs: [{ x0, y0, x1: x0 + W - 1, y1: y0 + H - 1, style: 'gable', ridgeX: true }],
  });
  const r = f.room('checkpoint', 1, 1, W - 2, H - 2);
  f.door(3, 0, 'wood', true, false);
  for (let i = 0; i < 3; i++) furnishWall(g, r, 'crate', 'checkpoint|checkpoint');
  furnishWall(g, r, 'bunk', 'checkpoint|checkpoint');
  return f;
}

/** Outdoor furniture helper (not in a room). */
export function outdoor(g: Gen, kind: FurnKind, x: number, y: number, rot = 0, loot = 'outdoor|none'): number {
  const w = g.w;
  if (!inB(w, x, y)) return -1;
  const i = y * w.w + x;
  if (w.struct[i] !== S.None || w.furn[i] >= 0 || w.ground[i] === G.Water || w.bld[i] >= 0) return -1;
  if (nearDoor(w, x, y)) return -1;
  if (FURN[kind].len === 2) {
    const j = rot === 0 || rot === 2 ? i + 1 : i + w.w;
    if (w.struct[j] !== S.None || w.furn[j] >= 0) return -1;
  }
  return placeFurn(g, kind, x, y, rot, -1, loot);
}
