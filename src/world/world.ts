// World data model: a tile grid plus object tables for doors, windows, furniture and buildings.
// Everything here is plain data so the whole world can be structured-cloned into IndexedDB.

export const MAP_W = 320;
export const MAP_H = 320;

/** Ground layer. */
export const enum G {
  Grass = 0,
  TallGrass = 1,
  Dirt = 2,
  Road = 3,
  Sidewalk = 4,
  Parking = 5,
  Gravel = 6,
  Field = 7,
  Forest = 8,
  Water = 9,
  Sand = 10,
  FloorWood = 11,
  FloorTile = 12,
  FloorCarpet = 13,
  FloorConcrete = 14,
  FloorLino = 15,
  Burnt = 16,
  Furrow = 17,
  Rubble = 18,
  Bridge = 19,
  DirtRoad = 20,
}

/** Structure layer (one per tile). */
export const enum S {
  None = 0,
  Wall = 1,
  Door = 2,
  Window = 3,
  FenceLow = 4,
  FenceHigh = 5,
  Tree = 6,
  Bush = 7,
  BuiltWall = 8,
}

/** Road marking bits stored in groundVar for road tiles. */
export const MARK_CENTER_H = 1;
export const MARK_CENTER_V = 2;
export const MARK_EDGE_N = 4;
export const MARK_EDGE_S = 8;
export const MARK_EDGE_W = 16;
export const MARK_EDGE_E = 32;
export const MARK_CROSS = 64;
export const MARK_STALL = 128;

export type Zone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ZONE_WILD = 0;
export const ZONE_RES = 1;
export const ZONE_COM = 2;
export const ZONE_IND = 3;
export const ZONE_FARM = 4;
export const ZONE_FOREST = 5;
export const ZONE_HIGHWAY = 6;
export const ZONE_PARK = 7;

export type DoorKind = 'wood' | 'metal' | 'glass' | 'garage' | 'gate' | 'cell' | 'built';

export interface Door {
  id: number;
  x: number;
  y: number;
  /** True when the door sits in a wall running north-south (leaf spans y). */
  vertical: boolean;
  open: boolean;
  locked: boolean;
  /** Whether the player knows the current lock state. */
  lockKnown: boolean;
  hp: number;
  maxHp: number;
  planks: number;
  barricadeHp: number;
  broken: boolean;
  ext: boolean;
  bld: number;
  kind: DoorKind;
  keyId: number;
}

export const WIN_CLOSED = 0;
export const WIN_OPEN = 1;
export const WIN_BROKEN = 2; // glass shards still in the frame
export const WIN_CLEARED = 3; // frame cleared of glass

export interface Win {
  id: number;
  x: number;
  y: number;
  vertical: boolean;
  state: number;
  curtains: boolean;
  curtainsClosed: boolean;
  planks: number;
  barricadeHp: number;
  bld: number;
  big: boolean;
  /** Sheet hung by the player (acts as curtains). */
  sheet: boolean;
}

export type ContainerKind =
  | 'fridge' | 'freezer' | 'counter' | 'wardrobe' | 'dresser' | 'nightstand' | 'medicine' | 'shelf'
  | 'bookshelf' | 'desk' | 'filing' | 'crate' | 'locker' | 'toolchest' | 'workbench' | 'register'
  | 'cooler' | 'trash' | 'dumpster' | 'trunk' | 'glovebox' | 'oven' | 'washer' | 'mailbox' | 'rack'
  | 'barcounter' | 'medcab' | 'hay' | 'corpse' | 'floor' | 'woodcrate' | 'barrel' | 'stove';

export interface Container {
  id: number;
  kind: ContainerKind;
  capacity: number;
  /** null until first searched: contents are generated lazily from the loot table. */
  items: import('../sim/items').Item[] | null;
  loot: string;
  x: number;
  y: number;
  searched: boolean;
}

export type FurnKind =
  | 'bed' | 'bed2' | 'couch' | 'armchair' | 'table' | 'dtable' | 'chair' | 'counter' | 'sinkCounter'
  | 'stove' | 'fridge' | 'freezer' | 'toilet' | 'tub' | 'bathSink' | 'wardrobe' | 'dresser' | 'nightstand'
  | 'bookshelf' | 'tv' | 'desk' | 'filing' | 'shelf' | 'rack' | 'cooler' | 'checkout' | 'workbench'
  | 'toolchest' | 'crate' | 'pallet' | 'locker' | 'medbed' | 'medcab' | 'pump' | 'dumpster' | 'trash'
  | 'bench' | 'lamp' | 'mailbox' | 'hydrant' | 'hay' | 'washer' | 'barcounter' | 'booth' | 'pew'
  | 'generator' | 'rainbarrel' | 'campfire' | 'sleepbag' | 'woodcrate' | 'bbq' | 'well' | 'machine'
  | 'bunk' | 'sandbags' | 'alarmtrap' | 'lumber' | 'tractor' | 'silo' | 'cashbox' | 'lamptable';

export interface Furniture {
  id: number;
  kind: FurnKind;
  x: number;
  y: number;
  /** 0 = front faces south, 1 = west, 2 = north, 3 = east. */
  rot: number;
  containerId: number;
  hp: number;
  bld: number;
  /** Generic per-object state (stove on, generator fuel, barrel water, etc.). */
  on?: boolean;
  fuel?: number;
  water?: number;
  tainted?: boolean;
  cookItems?: import('../sim/items').Item[];
  cookHeat?: number;
  cookTimer?: number;
  color?: number;
  gone?: boolean;
}

export type BuildingKind =
  | 'house' | 'apartment' | 'grocery' | 'pharmacy' | 'hardware' | 'diner' | 'bar' | 'police' | 'clinic'
  | 'gas' | 'warehouse' | 'factory' | 'farmhouse' | 'barn' | 'cabin' | 'motel' | 'shed' | 'church'
  | 'office' | 'garage' | 'checkpoint';

export type RoomType =
  | 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'hallway' | 'garage' | 'office' | 'storage' | 'laundry'
  | 'grocery' | 'pharmacy' | 'hardware' | 'gasstore' | 'diner' | 'dinerKitchen' | 'bar' | 'policeLobby'
  | 'policeOffice' | 'lockers' | 'armory' | 'cells' | 'waiting' | 'exam' | 'clinicPharmacy' | 'warehouse'
  | 'factory' | 'barn' | 'motelRoom' | 'shed' | 'church' | 'breakroom' | 'cabin' | 'checkpoint';

export interface Room {
  id: number;
  bld: number;
  type: RoomType;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  light: boolean;
}

export interface RoofPart {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  style: 'gable' | 'flat' | 'hip';
  /** Gable ridge runs along x when true. */
  ridgeX: boolean;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  roofs: RoofPart[];
  roofColor: number;
  wallColor: number;
  trimColor: number;
  alarm: boolean;
  /** Game hour at which the alarm stops (0 = silent). */
  alarmUntil: number;
  alarmPanel: { x: number; y: number } | null;
  keyId: number;
  rooms: number[];
  doors: number[];
  windows: number[];
  visited: boolean;
  /** Generator furniture id powering this building (-1 none). */
  generator: number;
  address: string;
}

export interface BuiltWall {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  kind: 'plank' | 'log' | 'metal';
}

export interface Crop {
  type: string;
  /** 0..1 growth; >= 1 is harvestable. */
  growth: number;
  /** 0..1 soil moisture. */
  water: number;
  /** 0..1 plant health; 0 = dead. */
  health: number;
}

export interface World {
  w: number;
  h: number;
  seed: number;
  ground: Uint8Array;
  groundVar: Uint8Array;
  struct: Uint8Array;
  structRef: Int32Array;
  furn: Int32Array;
  bld: Int16Array;
  room: Int16Array;
  zone: Uint8Array;
  explored: Uint8Array;
  /** Tile flags for blood decals etc. (bit 0 = blood, bit 1 = glass shards on floor). */
  decal: Uint8Array;
  doors: Door[];
  windows: Win[];
  furniture: Furniture[];
  containers: Container[];
  buildings: Building[];
  rooms: Room[];
  builtWalls: Record<number, BuiltWall>;
  crops: Record<number, Crop>;
  lamps: { x: number; y: number }[];
  /** Named places revealed on the map. */
  landmarks: { name: string; x: number; y: number; bld: number }[];
  /** Incremented whenever static geometry changes (renderer rebuilds instanced meshes). */
  rev: { walls: number; doors: number; windows: number; furn: number; ground: number };
  nextKeyId: number;
}

export function createWorld(w: number, h: number, seed: number): World {
  const n = w * h;
  const furn = new Int32Array(n);
  furn.fill(-1);
  const bld = new Int16Array(n);
  bld.fill(-1);
  const room = new Int16Array(n);
  room.fill(-1);
  const structRef = new Int32Array(n);
  structRef.fill(-1);
  return {
    w,
    h,
    seed,
    ground: new Uint8Array(n),
    groundVar: new Uint8Array(n),
    struct: new Uint8Array(n),
    structRef,
    furn,
    bld,
    room,
    zone: new Uint8Array(n),
    explored: new Uint8Array(n),
    decal: new Uint8Array(n),
    doors: [],
    windows: [],
    furniture: [],
    containers: [],
    buildings: [],
    rooms: [],
    builtWalls: {},
    crops: {},
    lamps: [],
    landmarks: [],
    rev: { walls: 0, doors: 0, windows: 0, furn: 0, ground: 0 },
    nextKeyId: 1,
  };
}

export const inB = (w: World, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.w && y < w.h;
export const idx = (w: World, x: number, y: number): number => y * w.w + x;

export function doorAt(w: World, x: number, y: number): Door | null {
  if (!inB(w, x, y)) return null;
  const i = y * w.w + x;
  return w.struct[i] === S.Door ? w.doors[w.structRef[i]] : null;
}
export function windowAt(w: World, x: number, y: number): Win | null {
  if (!inB(w, x, y)) return null;
  const i = y * w.w + x;
  return w.struct[i] === S.Window ? w.windows[w.structRef[i]] : null;
}
export function furnAt(w: World, x: number, y: number): Furniture | null {
  if (!inB(w, x, y)) return null;
  const f = w.furn[y * w.w + x];
  return f >= 0 ? w.furniture[f] : null;
}

/** Is a tile a wall-like tile (for visual wall connections)? */
export function isWallish(w: World, x: number, y: number): boolean {
  if (!inB(w, x, y)) return false;
  const s = w.struct[y * w.w + x];
  return s === S.Wall || s === S.Door || s === S.Window || s === S.BuiltWall;
}

export function isFence(w: World, x: number, y: number): boolean {
  if (!inB(w, x, y)) return false;
  const s = w.struct[y * w.w + x];
  return s === S.FenceLow || s === S.FenceHigh;
}

/** Indoors = inside a building footprint that has a roof (not a wall tile). */
export function isIndoors(w: World, x: number, y: number): boolean {
  if (!inB(w, x, y)) return false;
  const i = y * w.w + x;
  return w.room[i] >= 0;
}
