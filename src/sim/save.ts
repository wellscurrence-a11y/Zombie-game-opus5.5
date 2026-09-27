// Saves live in IndexedDB. One life per survivor; the world persists after death.
import { Rng } from '../core/rng';
import { makeItem, type Item } from './items';
import { chronicle, log } from './log';
import { resetThresholds } from './body';
import { createPlayer, pickStartHouse, SAVE_VERSION, secureHome, type SurvivorSpec } from './newgame';
import type { DeadRecord, GameState } from './types';

const DB_NAME = 'quiet-hours';
const DB_VER = 1;

let dbp: Promise<IDBDatabase> | null = null;
const memory = new Map<string, unknown>();

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbp;
}

async function put(store: string, key: string, value: unknown): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    memory.set(`${store}:${key}`, value);
  }
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = d.transaction(store, 'readonly');
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return memory.get(`${store}:${key}`) as T | undefined;
  }
}

async function del(store: string, key: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    memory.delete(`${store}:${key}`);
  }
}

export interface WorldSummary {
  id: string;
  seed: number;
  survivor: string;
  alive: boolean;
  days: number;
  worldDay: number;
  saved: number;
  survivors: number;
}

export async function saveGame(s: GameState): Promise<void> {
  await put('worlds', s.id, s);
  const list = (await get<WorldSummary[]>('meta', 'worlds')) ?? [];
  const summary: WorldSummary = {
    id: s.id, seed: s.seed, survivor: s.player.name, alive: !s.player.dead, days: (s.time - s.player.startT) / 24,
    worldDay: Math.floor(s.time / 24) + 1, saved: Date.now(), survivors: s.survivorIndex,
  };
  const i = list.findIndex((w) => w.id === s.id);
  if (i >= 0) list[i] = summary;
  else list.push(summary);
  await put('meta', 'worlds', list);
  await put('meta', 'current', s.id);
}

export async function loadGame(id: string): Promise<GameState | null> {
  const s = await get<GameState>('worlds', id);
  if (!s) return null;
  return migrate(s);
}

export async function listWorlds(): Promise<WorldSummary[]> {
  return ((await get<WorldSummary[]>('meta', 'worlds')) ?? []).sort((a, b) => b.saved - a.saved);
}

export async function currentWorldId(): Promise<string | undefined> {
  return get<string>('meta', 'current');
}

export async function deleteWorld(id: string): Promise<void> {
  await del('worlds', id);
  const list = (await get<WorldSummary[]>('meta', 'worlds')) ?? [];
  await put('meta', 'worlds', list.filter((w) => w.id !== id));
}

export async function records(): Promise<DeadRecord[]> {
  return (await get<DeadRecord[]>('meta', 'records')) ?? [];
}

export async function addRecord(r: DeadRecord): Promise<void> {
  const list = await records();
  list.push(r);
  list.sort((a, b) => b.days - a.days);
  await put('meta', 'records', list.slice(0, 50));
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  return (await get<T>('meta', `set:${key}`)) ?? fallback;
}

export async function setSetting(key: string, v: unknown): Promise<void> {
  await put('meta', `set:${key}`, v);
}

function migrate(s: GameState): GameState {
  if (s.version !== SAVE_VERSION) {
    // v1 is the only format so far
    s.version = SAVE_VERSION;
  }
  s.foraged ??= {};
  s.stationFuel ??= 1800;
  return s;
}

// ------------------------------------------------------------------ death & succession

/** Leave the dead survivor's body (and everything they carried) in the world. */
export function recordDeath(s: GameState): DeadRecord {
  const p = s.player;
  const days = (s.time - p.startT) / 24;
  const rec: DeadRecord = {
    name: p.name, occupation: p.occupation, days, cause: p.deathCause, kills: p.kills, worldSeed: s.seed,
    when: new Date().toISOString().slice(0, 10), survivorIndex: s.survivorIndex,
  };
  s.graveyard.push(rec);
  const items: Item[] = [...p.inventory];
  if (p.bag) items.push(p.bag);
  for (const it of Object.values(p.worn)) if (it) items.push(it);
  const rng = new Rng((s.seed + Math.floor(s.time * 100)) >>> 0);
  const infected = p.body.fever;
  if (p.inVehicle >= 0) {
    const v = s.vehicles[p.inVehicle];
    p.x = v.x;
    p.y = v.y;
    p.inVehicle = -1;
  }
  s.corpses.push({
    id: s.nextCorpseId++, x: p.x, y: p.y, rot: rng.range(0, Math.PI * 2), outfit: rng.int(0, 0xffffff), kind: 'survivor',
    items, t: s.time, name: p.name, wasPlayer: true, riseAt: infected ? s.time + rng.range(1, 6) : undefined,
  });
  p.inventory = [];
  p.bag = null;
  p.worn = {};
  p.primary = 0;
  return rec;
}

/** A new survivor arrives in the same world, somewhere else. */
export function newSurvivor(s: GameState, spec: SurvivorSpec): void {
  const old = s.player;
  const rng = new Rng((s.seed ^ (s.survivorIndex * 2654435761)) >>> 0);
  const w = s.world;
  // houses with no zombies inside
  const houses = w.buildings
    .filter((b) => b.kind === 'house')
    .filter((b) => !s.zombies.some((z) => z.x >= b.x0 && z.x <= b.x1 + 1 && z.y >= b.y0 && z.y <= b.y1 + 1))
    .map((b) => b.id);
  s.survivorIndex++;
  resetThresholds();
  const home = pickStartHouse(s, rng, houses, { x: old.x, y: old.y });
  s.player = createPlayer(s, spec, home.x, home.y, home.bld);
  s.player.startT = s.time;
  secureHome(s, home.bld);
  const b = w.buildings[home.bld];
  // the newcomer has been hiding here; a few leftovers
  s.player.inventory.push(makeItem(s, 'granola'));
  log(s, `${spec.name} has been hiding at ${b.address} since it began. The world outside has moved on without them.`, 'info');
  if (s.util.powerOff) log(s, 'The power is already out.', 'warn');
  if (s.util.waterOff) log(s, 'The taps have run dry.', 'warn');
  chronicle(s, `${spec.name} steps out into a world where ${old.name} is already dead.`, 1);
}
