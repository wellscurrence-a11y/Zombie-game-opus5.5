import type { ContainerKind, FurnKind, Furniture, World } from './world';

export interface FurnDef {
  name: string;
  /** Footprint length along the wall (1 or 2 tiles). */
  len: 1 | 2;
  solid: boolean;
  /** Blocks line of sight. */
  tall: boolean;
  /** Height used for rendering/cutaway. */
  h: number;
  container?: { kind: ContainerKind; cap: number };
  /** Kilograms when carried. 0 = cannot be moved. */
  weight: number;
  hp: number;
  flammable: number;
  bed?: number;
  seat?: boolean;
  stove?: boolean;
  sink?: boolean;
  fridge?: boolean;
  toilet?: boolean;
  vault?: boolean;
  /** Emits light when the building has power and the room light is on. */
  lamp?: boolean;
}

const D = (d: Partial<FurnDef> & { name: string }): FurnDef => ({
  len: 1,
  solid: true,
  tall: false,
  h: 0.9,
  weight: 20,
  hp: 60,
  flammable: 0.6,
  ...d,
});

export const FURN: Record<FurnKind, FurnDef> = {
  bed: D({ name: 'Bed', len: 2, h: 0.6, weight: 35, bed: 0.85, hp: 80, vault: true }),
  bed2: D({ name: 'Double bed', len: 2, h: 0.6, weight: 45, bed: 1, hp: 90, vault: true }),
  bunk: D({ name: 'Bunk bed', len: 2, h: 1.6, weight: 40, bed: 0.6, hp: 80, tall: false }),
  couch: D({ name: 'Couch', len: 2, h: 0.8, weight: 40, bed: 0.55, seat: true, hp: 80, vault: true }),
  armchair: D({ name: 'Armchair', h: 0.85, weight: 18, seat: true, vault: true }),
  table: D({ name: 'Table', h: 0.75, weight: 15, vault: true, hp: 40 }),
  dtable: D({ name: 'Dining table', len: 2, h: 0.75, weight: 25, vault: true, hp: 50 }),
  chair: D({ name: 'Chair', h: 0.9, weight: 5, solid: false, seat: true, hp: 20 }),
  counter: D({ name: 'Kitchen counter', h: 0.9, weight: 0, container: { kind: 'counter', cap: 18 }, vault: true, hp: 90 }),
  sinkCounter: D({ name: 'Sink', h: 0.9, weight: 0, container: { kind: 'counter', cap: 10 }, sink: true, vault: true, hp: 90 }),
  stove: D({ name: 'Stove', h: 0.9, weight: 0, container: { kind: 'oven', cap: 8 }, stove: true, flammable: 0.1, hp: 150 }),
  fridge: D({ name: 'Refrigerator', h: 1.8, tall: true, weight: 0, container: { kind: 'fridge', cap: 20 }, fridge: true, flammable: 0.1, hp: 150 }),
  freezer: D({ name: 'Chest freezer', h: 0.9, weight: 0, container: { kind: 'freezer', cap: 25 }, fridge: true, flammable: 0.1, hp: 150 }),
  toilet: D({ name: 'Toilet', h: 0.7, weight: 0, toilet: true, flammable: 0, hp: 100, vault: true }),
  tub: D({ name: 'Bathtub', len: 2, h: 0.6, weight: 0, flammable: 0, hp: 150, vault: true }),
  bathSink: D({ name: 'Bathroom sink', h: 0.9, weight: 0, container: { kind: 'medicine', cap: 5 }, sink: true, flammable: 0.1, hp: 80 }),
  wardrobe: D({ name: 'Wardrobe', h: 1.9, tall: true, weight: 45, container: { kind: 'wardrobe', cap: 30 }, hp: 100 }),
  dresser: D({ name: 'Dresser', h: 1.0, weight: 30, container: { kind: 'dresser', cap: 20 }, vault: true, hp: 80 }),
  nightstand: D({ name: 'Nightstand', h: 0.6, weight: 8, container: { kind: 'nightstand', cap: 5 }, hp: 30 }),
  bookshelf: D({ name: 'Bookshelf', h: 1.9, tall: true, weight: 35, container: { kind: 'bookshelf', cap: 18 }, hp: 70 }),
  tv: D({ name: 'TV stand', h: 1.0, weight: 20, hp: 40, vault: true }),
  desk: D({ name: 'Desk', h: 0.75, weight: 30, container: { kind: 'desk', cap: 10 }, vault: true, hp: 60 }),
  filing: D({ name: 'Filing cabinet', h: 1.3, weight: 40, container: { kind: 'filing', cap: 15 }, flammable: 0.1, hp: 120 }),
  shelf: D({ name: 'Store shelf', h: 1.6, tall: true, weight: 0, container: { kind: 'shelf', cap: 40 }, hp: 100 }),
  rack: D({ name: 'Metal rack', h: 2.2, tall: true, weight: 0, container: { kind: 'rack', cap: 60 }, flammable: 0.05, hp: 200 }),
  cooler: D({ name: 'Display cooler', h: 2.0, tall: true, weight: 0, container: { kind: 'cooler', cap: 30 }, fridge: true, flammable: 0.1, hp: 150 }),
  checkout: D({ name: 'Checkout counter', h: 1.0, weight: 0, container: { kind: 'register', cap: 6 }, vault: true, hp: 120 }),
  workbench: D({ name: 'Workbench', len: 2, h: 0.95, weight: 0, container: { kind: 'workbench', cap: 30 }, vault: true, hp: 120 }),
  toolchest: D({ name: 'Tool chest', h: 1.1, weight: 50, container: { kind: 'toolchest', cap: 25 }, flammable: 0.05, hp: 150 }),
  crate: D({ name: 'Crate', h: 0.9, weight: 25, container: { kind: 'crate', cap: 30 }, vault: true, hp: 60 }),
  pallet: D({ name: 'Pallet stack', h: 1.2, weight: 0, container: { kind: 'crate', cap: 40 }, hp: 80 }),
  locker: D({ name: 'Locker', h: 1.9, tall: true, weight: 35, container: { kind: 'locker', cap: 15 }, flammable: 0.05, hp: 150 }),
  medbed: D({ name: 'Hospital bed', len: 2, h: 0.8, weight: 50, bed: 0.8, hp: 80, vault: true }),
  medcab: D({ name: 'Medical cabinet', h: 1.8, tall: true, weight: 40, container: { kind: 'medcab', cap: 15 }, flammable: 0.1, hp: 120 }),
  pump: D({ name: 'Fuel pump', h: 1.7, tall: false, weight: 0, flammable: 0, hp: 300 }),
  dumpster: D({ name: 'Dumpster', len: 2, h: 1.3, weight: 0, container: { kind: 'dumpster', cap: 40 }, flammable: 0, hp: 300 }),
  trash: D({ name: 'Trash can', h: 0.9, weight: 6, container: { kind: 'trash', cap: 8 }, flammable: 0.2, hp: 30 }),
  bench: D({ name: 'Bench', len: 2, h: 0.5, weight: 0, seat: true, vault: true, hp: 50 }),
  lamp: D({ name: 'Street lamp', h: 4, weight: 0, flammable: 0, hp: 500 }),
  mailbox: D({ name: 'Mailbox', h: 1.1, weight: 0, container: { kind: 'mailbox', cap: 2 }, flammable: 0, hp: 60 }),
  hydrant: D({ name: 'Fire hydrant', h: 0.7, weight: 0, flammable: 0, hp: 500 }),
  hay: D({ name: 'Hay bales', h: 1.0, weight: 0, container: { kind: 'hay', cap: 20 }, flammable: 1, vault: true, hp: 60 }),
  washer: D({ name: 'Washing machine', h: 0.9, weight: 0, container: { kind: 'washer', cap: 10 }, flammable: 0.05, hp: 120 }),
  barcounter: D({ name: 'Bar counter', h: 1.1, weight: 0, container: { kind: 'barcounter', cap: 25 }, vault: true, hp: 120 }),
  booth: D({ name: 'Booth seat', h: 1.1, weight: 0, seat: true, hp: 60 }),
  pew: D({ name: 'Pew', len: 2, h: 0.9, weight: 0, seat: true, vault: true, hp: 70 }),
  generator: D({ name: 'Generator', h: 0.8, weight: 32, flammable: 0.3, hp: 150 }),
  rainbarrel: D({ name: 'Rain collector', h: 1.1, weight: 12, flammable: 0.4, hp: 80 }),
  campfire: D({ name: 'Campfire', h: 0.3, solid: false, weight: 0, flammable: 0, hp: 50 }),
  sleepbag: D({ name: 'Sleeping bag', h: 0.1, solid: false, weight: 2.5, bed: 0.5, hp: 10 }),
  woodcrate: D({ name: 'Wooden storage crate', h: 0.9, weight: 20, container: { kind: 'woodcrate', cap: 40 }, vault: true, hp: 100 }),
  bbq: D({ name: 'Barbecue grill', h: 1.0, weight: 18, container: { kind: 'stove', cap: 4 }, stove: true, flammable: 0, hp: 120 }),
  well: D({ name: 'Water well', h: 1.0, weight: 0, flammable: 0, hp: 500 }),
  machine: D({ name: 'Industrial machine', len: 2, h: 1.8, tall: true, weight: 0, flammable: 0, hp: 500 }),
  sandbags: D({ name: 'Sandbags', h: 1.0, weight: 0, flammable: 0, vault: true, hp: 250 }),
  alarmtrap: D({ name: 'Tin-can alarm line', h: 0.3, solid: false, weight: 1.5, flammable: 0.2, hp: 5 }),
  lumber: D({ name: 'Lumber stack', h: 1.0, weight: 0, container: { kind: 'crate', cap: 60 }, vault: true, hp: 150 }),
  tractor: D({ name: 'Old tractor', len: 2, h: 2.0, tall: false, weight: 0, flammable: 0.1, hp: 500 }),
  silo: D({ name: 'Grain silo', h: 6, tall: true, weight: 0, flammable: 0, hp: 1000 }),
  cashbox: D({ name: 'Service counter', h: 1.0, weight: 0, container: { kind: 'register', cap: 8 }, vault: true, hp: 100 }),
  lamptable: D({ name: 'Lamp', h: 1.4, solid: false, weight: 3, lamp: true, hp: 10 }),
};

/** Tiles covered by a furniture piece (1 or 2). */
export function furnTiles(kind: FurnKind, x: number, y: number, rot: number): [number, number][] {
  const def = FURN[kind];
  if (def.len === 1) return [[x, y]];
  // Length runs along the wall: for rot 0/2 (facing N/S) along +x, for 1/3 along +y.
  if (rot === 0 || rot === 2) return [[x, y], [x + 1, y]];
  return [[x, y], [x, y + 1]];
}

/** Centre of the furniture footprint in tile coordinates (tile centres at +0.5). */
export function furnCenter(f: Furniture): [number, number] {
  const tiles = furnTiles(f.kind, f.x, f.y, f.rot);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of tiles) {
    cx += x + 0.5;
    cy += y + 0.5;
  }
  return [cx / tiles.length, cy / tiles.length];
}

export function isFurnSolid(w: World, i: number): boolean {
  const f = w.furn[i];
  if (f < 0) return false;
  return FURN[w.furniture[f].kind].solid;
}
