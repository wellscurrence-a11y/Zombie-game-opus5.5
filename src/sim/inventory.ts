// Item containers: the survivor's pockets and bag, furniture, vehicles, corpses and the floor.
import { Rng } from '../core/rng';
import { def, itemName, itemWeight, makeItem, type Item } from './items';
import { generateLoot } from './loot';
import type { Runtime } from './runtime';
import { bagCapacity, capacity, carriedWeight } from './stats';
import type { Corpse, GameState } from './types';
import { buildingPowered } from './lighting';

export type ContRef =
  | { kind: 'player' }
  | { kind: 'bag' }
  | { kind: 'container'; id: number }
  | { kind: 'floor'; tile: number }
  | { kind: 'corpse'; id: number };

export function refKey(r: ContRef): string {
  switch (r.kind) {
    case 'container':
      return `c${r.id}`;
    case 'floor':
      return `f${r.tile}`;
    case 'corpse':
      return `k${r.id}`;
    default:
      return r.kind;
  }
}

function corpseById(s: GameState, id: number): Corpse | undefined {
  return s.corpses.find((c) => c.id === id);
}

/** Hours that fresh food in this container has effectively aged. */
function foodAgeFor(s: GameState, cid: number): number {
  const c = s.world.containers[cid];
  const cold = c.kind === 'fridge' || c.kind === 'freezer' || c.kind === 'cooler';
  if (!cold) return s.time;
  const powered = !s.util.powerOff;
  const offAt = powered ? s.time : s.util.powerOffAt;
  return Math.min(s.time, offAt) * (c.kind === 'freezer' ? 0.1 : 0.35) + Math.max(0, s.time - offAt);
}

/** Generate a container's contents the first time it's opened. */
export function ensureLoot(s: GameState, cid: number): Item[] {
  const c = s.world.containers[cid];
  if (c.items) return c.items;
  const [bldKind, roomType] = c.loot.split('|');
  const rng = new Rng((s.seed * 31 + cid * 7919 + 17) >>> 0);
  const items = generateLoot(s, rng, {
    bldKind: bldKind || 'none',
    roomType: roomType || 'none',
    containerKind: c.kind,
    foodAge: foodAgeFor(s, cid),
    abundance: s.settings.loot,
  });
  if (c.extra) {
    items.push(...c.extra);
    c.extra = undefined;
  }
  c.items = items;
  return items;
}

export function ensureCorpseLoot(s: GameState, corpse: Corpse): Item[] {
  if (corpse.items) return corpse.items;
  const rng = new Rng((s.seed * 13 + corpse.id * 104729) >>> 0);
  const items = corpse.wasPlayer ? [] : generateLoot(s, rng, { bldKind: 'none', roomType: 'none', containerKind: 'corpse', foodAge: s.time, abundance: s.settings.loot });
  const extra: [string, number, number?, number?][] = [];
  if (corpse.kind === 'cop') extra.push(['ammo9', 0.35, 4, 12], ['pistol', 0.05], ['baton', 0.12]);
  if (corpse.kind === 'soldier') extra.push(['ammo308', 0.3, 4, 10], ['mre', 0.3], ['bandage', 0.25, 1, 2], ['rifle', 0.04]);
  if (corpse.kind === 'medic') extra.push(['bandage', 0.35, 1, 3], ['painkillers', 0.2], ['wipes', 0.3, 2, 5]);
  if (corpse.kind === 'worker') extra.push(['lighter', 0.2], ['gloves', 0.12], ['screwdriver', 0.08]);
  if (corpse.kind === 'farmer') extra.push(['seedPotato', 0.2, 2, 5], ['seedCarrot', 0.15, 2, 6]);
  for (const [id, ch, a, b] of extra) {
    if (!rng.chance(ch * s.settings.loot)) continue;
    const d = def(id);
    const qty = a !== undefined ? rng.int(a, b ?? a) : 1;
    items.push(makeItem(s, id, d.stack ? { qty } : {}));
  }
  if (corpse.extra) {
    items.push(...corpse.extra);
    corpse.extra = undefined;
  }
  corpse.items = items;
  return items;
}

export function listItems(s: GameState, r: ContRef): Item[] {
  const p = s.player;
  switch (r.kind) {
    case 'player':
      return p.inventory;
    case 'bag':
      if (!p.bag) return [];
      return (p.bag.contents ??= []);
    case 'container':
      return ensureLoot(s, r.id);
    case 'floor':
      return (s.floor[r.tile] ??= []);
    case 'corpse': {
      const c = corpseById(s, r.id);
      return c ? ensureCorpseLoot(s, c) : [];
    }
  }
}

export function contCapacity(s: GameState, r: ContRef): number {
  switch (r.kind) {
    case 'player':
      return capacity(s.player) * 2.2;
    case 'bag':
      return bagCapacity(s.player);
    case 'container':
      return s.world.containers[r.id].capacity;
    default:
      return 9999;
  }
}

export function contWeight(s: GameState, r: ContRef): number {
  if (r.kind === 'player') return carriedWeight(s.player);
  let w = 0;
  for (const it of listItems(s, r)) w += itemWeight(it);
  return w;
}

export function contName(s: GameState, r: ContRef): string {
  switch (r.kind) {
    case 'player':
      return 'Inventory';
    case 'bag':
      return s.player.bag ? def(s.player.bag.id).name : 'Bag';
    case 'container': {
      const c = s.world.containers[r.id];
      const names: Record<string, string> = {
        fridge: 'Refrigerator', freezer: 'Freezer', counter: 'Counter', wardrobe: 'Wardrobe', dresser: 'Dresser', nightstand: 'Nightstand',
        medicine: 'Medicine cabinet', shelf: 'Shelf', bookshelf: 'Bookshelf', desk: 'Desk', filing: 'Filing cabinet', crate: 'Crate',
        locker: 'Locker', toolchest: 'Tool chest', workbench: 'Workbench', register: 'Counter', cooler: 'Display cooler', trash: 'Trash can',
        dumpster: 'Dumpster', trunk: 'Trunk', glovebox: 'Glovebox', oven: 'Oven', washer: 'Washing machine', mailbox: 'Mailbox', rack: 'Rack',
        barcounter: 'Bar', medcab: 'Medical cabinet', hay: 'Hay bales', woodcrate: 'Storage crate', stove: 'Grill',
      };
      return names[c.kind] ?? 'Container';
    }
    case 'floor':
      return 'Floor';
    case 'corpse': {
      const c = corpseById(s, r.id);
      return c?.name ? `${c.name} (body)` : c?.wasPlayer ? 'Your old body' : 'Corpse';
    }
  }
}

/** Add an item to a container, merging stacks. Returns false if it doesn't fit. */
export function addItem(s: GameState, r: ContRef, it: Item, force = false): boolean {
  const list = listItems(s, r);
  const cap = contCapacity(s, r);
  if (!force && contWeight(s, r) + itemWeight(it) > cap + 1e-6) return false;
  if (r.kind === 'bag' && it.uid === s.player.bag?.uid) return false;
  const d = def(it.id);
  if (d.stack) {
    const ex = list.find((o) => o.id === it.id && !o.keyId && o.qty < d.stack! && (o.label ?? '') === (it.label ?? ''));
    if (ex) {
      const room = d.stack - ex.qty;
      const move = Math.min(room, it.qty);
      ex.qty += move;
      it.qty -= move;
      if (it.qty <= 0) return true;
    }
  }
  list.push(it);
  return true;
}

export function removeItem(s: GameState, r: ContRef, uid: number): Item | null {
  const list = listItems(s, r);
  const i = list.findIndex((o) => o.uid === uid);
  if (i < 0) return null;
  const [it] = list.splice(i, 1);
  const p = s.player;
  if (r.kind === 'player' && p.primary === uid) p.primary = 0;
  if (r.kind === 'floor' && list.length === 0) delete s.floor[r.tile];
  return it;
}

/** Move an item between containers. Returns an error message or null. */
export function transfer(s: GameState, rt: Runtime | null, from: ContRef, to: ContRef, uid: number): string | null {
  const list = listItems(s, from);
  const it = list.find((o) => o.uid === uid);
  if (!it) return 'It\'s gone.';
  if (to.kind === 'bag' && !s.player.bag) return 'You have no bag.';
  if (to.kind === 'bag' && def(it.id).bag) return 'You can\'t put a bag inside a bag.';
  const cap = contCapacity(s, to);
  if (contWeight(s, to) + itemWeight(it) > cap + 1e-6) {
    return to.kind === 'player' ? 'You can\'t carry any more.' : `${contName(s, to)} is full.`;
  }
  removeItem(s, from, uid);
  addItem(s, to, it, true);
  if (rt && (from.kind === 'floor' || to.kind === 'floor')) rt.dirty.floor = true;
  if (from.kind !== 'player' && from.kind !== 'bag' && (to.kind === 'player' || to.kind === 'bag')) s.stats.itemsLooted++;
  return null;
}

export function dropItem(s: GameState, rt: Runtime, uid: number, from: ContRef = { kind: 'player' }): void {
  const p = s.player;
  const tile = Math.floor(p.y) * s.world.w + Math.floor(p.x);
  transfer(s, rt, from, { kind: 'floor', tile }, uid);
  rt.dirty.floor = true;
}

/** All items the survivor carries (pockets + bag), for tool checks. */
export function carried(s: GameState): Item[] {
  const p = s.player;
  return [...p.inventory, ...(p.bag?.contents ?? [])];
}

/** Find where a carried item lives. */
export function locate(s: GameState, uid: number): ContRef | null {
  const p = s.player;
  if (p.inventory.some((i) => i.uid === uid)) return { kind: 'player' };
  if (p.bag?.contents?.some((i) => i.uid === uid)) return { kind: 'bag' };
  return null;
}

/** Remove `qty` of item type from carried items (for crafting). Returns false if not enough. */
export function consume(s: GameState, id: string, qty: number): boolean {
  const all = carried(s).filter((i) => i.id === id);
  let have = 0;
  for (const it of all) have += it.qty;
  if (have < qty) return false;
  let left = qty;
  for (const it of all) {
    const take = Math.min(left, it.qty);
    it.qty -= take;
    left -= take;
    if (left <= 0) break;
  }
  const p = s.player;
  p.inventory = p.inventory.filter((i) => i.qty > 0);
  if (p.bag?.contents) p.bag.contents = p.bag.contents.filter((i) => i.qty > 0);
  if (p.primary && !p.inventory.some((i) => i.uid === p.primary)) p.primary = 0;
  return true;
}

export function countItem(s: GameState, id: string): number {
  let n = 0;
  for (const it of carried(s)) if (it.id === id) n += it.qty;
  return n;
}

/** Use one charge of a multi-use item (lighter, disinfectant...). Removes it when empty. */
export function useCharge(s: GameState, it: Item): void {
  if (it.usesLeft === undefined) {
    it.qty -= 1;
  } else {
    it.usesLeft -= 1;
    if (it.usesLeft > 0) return;
    it.qty -= 1;
  }
  if (it.qty <= 0) {
    const p = s.player;
    p.inventory = p.inventory.filter((i) => i.uid !== it.uid);
    if (p.bag?.contents) p.bag.contents = p.bag.contents.filter((i) => i.uid !== it.uid);
    if (p.primary === it.uid) p.primary = 0;
  }
}

export function fridgePowered(s: GameState, cid: number): boolean {
  const c = s.world.containers[cid];
  const f = s.world.furniture.find((ff) => ff.containerId === cid);
  if (!f) return false;
  return (c.kind === 'fridge' || c.kind === 'freezer' || c.kind === 'cooler') && buildingPowered(s, f.bld);
}

export function describeItem(it: Item): string {
  return itemName(it);
}
