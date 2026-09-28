// Using items: eating, drinking, wearing, equipping, pills, reading, crafting basics.
import { clamp } from '../core/math';
import { addInjury } from './body';
import { def, freshness, hasTool, itemName, makeItem, type ClothingSlot, type Item } from './items';
import { addItem, carried, consume, countItem, locate, removeItem, transfer, useCharge, type ContRef } from './inventory';
import { chronicle, log, note } from './log';
import { emitNoise } from './noise';
import type { Runtime, TimedAction } from './runtime';
import { addXp, lvl } from './skills';
import { handFactor } from './stats';
import { hasTrait } from './traits';
import type { GameState } from './types';
import { cheer, useFun, workMult } from './mood';

export interface Ctx {
  s: GameState;
  rt: Runtime;
}

export function startAction(c: Ctx, a: Omit<TimedAction, 't'> & { t?: number }): void {
  const rt = c.rt;
  if (rt.action) {
    rt.action.onCancel?.();
  }
  rt.action = { t: 0, ...a };
  // an unhappy survivor drags their feet through chores (never through first aid, eating or play)
  if (!a.fun && !a.urgent && a.anim !== 'eat' && a.anim !== 'climb' && a.anim !== 'none') {
    const m = workMult(c.s.player);
    if (a.gameHours) rt.action.gameHours = a.gameHours * m;
    else if (a.dur < 900) rt.action.dur = a.dur * m;
  }
  if (a.gameHours) rt.action.startT = c.s.time;
}

/** Duration multiplier for fiddly hand work. */
export function handWork(c: Ctx): number {
  const p = c.s.player;
  let m = 1 / (0.45 + 0.55 * handFactor(p));
  if (p.needs.panic > 0.4) m *= 1 + p.needs.panic * 0.6;
  if (p.needs.drunk > 0.3) m *= 1.3;
  return m;
}

// ------------------------------------------------------------------ equipping

export function equip(c: Ctx, uid: number): void {
  const p = c.s.player;
  const where = locate(c.s, uid);
  if (!where) return;
  if (where.kind === 'bag') {
    const err = transfer(c.s, c.rt, where, { kind: 'player' }, uid);
    if (err) {
      log(c.s, err, 'warn');
      return;
    }
  }
  if (p.primary === uid) {
    p.primary = 0;
    return;
  }
  p.primary = uid;
  const it = p.inventory.find((i) => i.uid === uid)!;
  const d = def(it.id);
  if (d.weapon && it.cond < 0.25) log(c.s, `Your ${d.name.toLowerCase()} is in bad shape.`, 'warn');
  if (d.firearm) log(c.s, `${d.name}: ${it.ammo ?? 0}/${d.firearm.mag} loaded. Hold left mouse to aim, release to fire.`, 'info');
}

export function wear(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  const where = locate(s, uid);
  if (!where) return;
  const it = [...p.inventory, ...(p.bag?.contents ?? [])].find((i) => i.uid === uid)!;
  const d = def(it.id);
  if (d.bag) {
    startAction(c, {
      label: `Putting on ${d.name.toLowerCase()}`, dur: 1.5, cancelOnMove: false, anim: 'use',
      onDone: () => {
        removeItem(s, where, uid);
        if (p.bag) {
          const old = p.bag;
          p.bag = null;
          p.inventory.push(old);
        }
        it.contents ??= [];
        p.bag = it;
      },
    });
    return;
  }
  if (!d.clothing) return;
  const slot = d.clothing.slot;
  startAction(c, {
    label: `Putting on ${d.name.toLowerCase()}`, dur: slot === 'feet' || slot === 'legs' ? 4 : 2.5, cancelOnMove: true, anim: 'use',
    onDone: () => {
      removeItem(s, where, uid);
      const old = p.worn[slot];
      if (old) p.inventory.push(old);
      p.worn[slot] = it;
    },
  });
}

export function takeOff(c: Ctx, slot: ClothingSlot | 'bag'): void {
  const s = c.s;
  const p = s.player;
  if (slot === 'bag') {
    if (!p.bag) return;
    const b = p.bag;
    startAction(c, {
      label: 'Taking off your bag', dur: 1, cancelOnMove: false, anim: 'use',
      onDone: () => {
        p.bag = null;
        p.inventory.push(b);
      },
    });
    return;
  }
  const it = p.worn[slot];
  if (!it) return;
  startAction(c, {
    label: `Taking off ${def(it.id).name.toLowerCase()}`, dur: 2, cancelOnMove: true, anim: 'use',
    onDone: () => {
      delete p.worn[slot];
      p.inventory.push(it);
    },
  });
}

// ------------------------------------------------------------------ food & drink

function poisonChance(s: GameState, base: number): number {
  const t = s.player.traits;
  if (hasTrait(t, 'ironGut')) return base * 0.5;
  if (hasTrait(t, 'weakStomach')) return Math.min(1, base * 1.6);
  return base;
}

export function foodPoisoning(c: Ctx, amount: number, cause: string): void {
  const n = c.s.player.needs;
  n.sick = clamp(n.sick + amount, 0, 1);
  n.sickCause = cause;
  log(c.s, `Your stomach turns. (${cause})`, 'danger');
  chronicle(c.s, `Got sick from ${cause}.`, 3);
  note(c.s, 'food');
}

export function canOpeners(c: Ctx): { opener: Item | null; knife: Item | null; blunt: Item | null } {
  const items = carried(c.s);
  return {
    opener: hasTool(items, 'canopener'),
    knife: hasTool(items, 'knife'),
    blunt: hasTool(items, 'hammer') ?? hasTool(items, 'screwdriver'),
  };
}

export function eat(c: Ctx, uid: number, method: 'opener' | 'knife' | 'blunt' | 'none' = 'none'): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const where = locate(s, uid);
  if (!where) return;
  const it = [...p.inventory, ...(p.bag?.contents ?? [])].find((i) => i.uid === uid)!;
  const d = def(it.id);
  const f = d.food;
  if (!f) return;
  if (f.canned && method === 'none') {
    const o = canOpeners(c);
    method = o.opener ? 'opener' : 'none';
    if (method === 'none') {
      log(s, 'You need a can opener — or something to force it open.', 'warn');
      return;
    }
  }
  if (f.needsCooking && !it.cooked && (it.id === 'rice' || it.id === 'pasta')) {
    log(s, `You can't eat ${d.name.toLowerCase()} uncooked. Cook it in a pot of water.`, 'warn');
    return;
  }
  const dur = (d.cat === 'drink' ? 2.5 : 4) * (method === 'knife' || method === 'blunt' ? 1.6 : 1);
  startAction(c, {
    label: `${d.cat === 'drink' ? 'Drinking' : 'Eating'} ${d.name.toLowerCase()}`, dur, cancelOnMove: false, anim: 'eat',
    onDone: () => {
      if (method === 'knife' && rt.rng.chance(0.22 / (0.5 + handFactor(p) * 0.5))) {
        addInjury(s, rt, rt.rng.chance(0.5) ? 'lHand' : 'rHand', 'cut', rt.rng.range(0.25, 0.55), 'slipped opening a can with a knife');
        log(s, 'The knife slips off the lid and slices your hand.', 'danger');
      }
      if (method === 'blunt') emitNoise(s, rt, { x: p.x, y: p.y, radius: 7, kind: 'bang', src: 'player' });
      removeItem(s, where, uid);
      if (it.qty > 1) {
        it.qty -= 1;
        addItem(s, where, it, true);
      }
      const fr = freshness(it, d);
      let mult = fr === 'stale' ? 0.7 : fr === 'rotten' ? 0.4 : 1;
      if (it.cooked) mult *= 1.2;
      if (it.burnt) mult *= 0.5;
      const n = p.needs;
      n.hunger = clamp(n.hunger - f.hunger * mult, 0, 1);
      if (f.thirst) n.thirst = clamp(n.thirst - f.thirst, 0, 1);
      if (f.stress) n.stress = clamp(n.stress + f.stress, 0, 1);
      // treats and hot meals lift the mood; bland, stale or grim food drags it down
      let fun = (f.fun ?? 0) * mult + (it.cooked && !it.burnt ? 0.04 : 0);
      if (fr === 'stale') fun -= 0.05;
      if (fr === 'rotten') fun -= 0.15;
      if (it.burnt) fun -= 0.05;
      if (fun) cheer(p, fun, fun * 0.5);
      if (f.drunk) n.drunk = clamp(n.drunk + f.drunk, 0, 1);
      if (it.cooked && !it.burnt) n.stress = clamp(n.stress - 0.04, 0, 1);
      // food safety
      let poison = 0;
      if (f.needsCooking && !it.cooked) poison = f.poison ?? 0;
      if (fr === 'rotten') poison = Math.max(poison, 0.6);
      else if (fr === 'stale') poison = Math.max(poison, 0.08);
      if ((it.id === 'berries' || it.id === 'mushrooms') && it.safe === false) poison = 0.9;
      if (poison > 0 && rt.rng.chance(poisonChance(s, poison))) {
        const cause = f.needsCooking && !it.cooked ? `raw ${d.name.replace('Raw ', '').toLowerCase()}` : fr === 'rotten' ? 'rotten food' : d.name.toLowerCase();
        foodPoisoning(c, it.id === 'mushrooms' ? 0.75 : 0.45, cause);
      }
      if (f.leaves) p.inventory.push(makeItem(s, f.leaves));
      addXp(p, 'cooking', 0.5);
    },
  });
}

/** Drink from a liquid container. */
export function drinkFrom(c: Ctx, uid: number): void {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const it = [...p.inventory, ...(p.bag?.contents ?? [])].find((i) => i.uid === uid);
  if (!it || !it.fill || it.fill <= 0) return;
  if (it.liquid === 'fuel') {
    log(s, 'You are not going to drink gasoline.', 'warn');
    return;
  }
  startAction(c, {
    label: 'Drinking', dur: 2.5, cancelOnMove: false, anim: 'eat',
    onDone: () => {
      const n = p.needs;
      const want = Math.max(0.1, Math.min(it.fill!, n.thirst / 1.2 + 0.05, 0.5));
      it.fill = Math.max(0, it.fill! - want);
      if (it.liquid === 'alcohol') {
        n.drunk = clamp(n.drunk + want * 1.2, 0, 1);
        n.stress = clamp(n.stress - 0.1, 0, 1);
        cheer(p, 0.12 * useFun(p, 'drink'), 0.08);
        n.thirst = clamp(n.thirst - want * 0.3, 0, 1);
      } else {
        n.thirst = clamp(n.thirst - want * 1.25, 0, 1);
        if (it.liquid === 'tainted' && rt.rng.chance(poisonChance(s, 0.35))) foodPoisoning(c, 0.35, 'untreated water');
      }
      if (it.fill <= 0.001) {
        it.fill = 0;
        it.liquid = undefined;
      }
    },
  });
}

export function drinkFromSource(c: Ctx, liquid: 'water' | 'tainted', label: string): void {
  const s = c.s;
  startAction(c, {
    label, dur: 3, cancelOnMove: true, anim: 'kneel',
    onDone: () => {
      const n = s.player.needs;
      n.thirst = clamp(n.thirst - 0.6, 0, 1);
      if (liquid === 'tainted' && c.rt.rng.chance(poisonChance(s, 0.35))) foodPoisoning(c, 0.35, 'untreated water');
    },
  });
}

export function fillContainers(c: Ctx, liquid: 'water' | 'tainted', label: string, limit = 999): number {
  const s = c.s;
  let filled = 0;
  const targets = carried(s).filter((i) => {
    const d = def(i.id);
    return d.liquid && d.id !== 'gasCan' && d.id !== 'whiskey' && (i.fill ?? 0) < d.liquid.cap - 0.01 && (!i.liquid || i.liquid === liquid || i.liquid === 'water' || i.liquid === 'tainted');
  });
  if (!targets.length) {
    log(s, 'You have nothing to fill.', 'warn');
    return 0;
  }
  startAction(c, {
    label, dur: 2 + targets.length * 1.5, cancelOnMove: true, anim: 'kneel',
    onDone: () => {
      let left = limit;
      for (const it of targets) {
        const cap = def(it.id).liquid!.cap;
        const add = Math.min(cap - (it.fill ?? 0), left);
        if (add <= 0) continue;
        const mixed = it.liquid === 'tainted' || liquid === 'tainted' ? 'tainted' : 'water';
        it.fill = (it.fill ?? 0) + add;
        it.liquid = (it.fill ?? 0) > 0 ? mixed : liquid;
        left -= add;
        filled += add;
      }
      log(s, liquid === 'tainted' ? 'Filled. This water isn\'t safe to drink untreated.' : 'Filled with clean water.', liquid === 'tainted' ? 'warn' : 'good');
    },
  });
  return filled;
}

export function pourOut(c: Ctx, uid: number): void {
  const it = carried(c.s).find((i) => i.uid === uid);
  if (!it) return;
  it.fill = 0;
  it.liquid = undefined;
}

export function purify(c: Ctx, uid: number): void {
  const s = c.s;
  const it = carried(s).find((i) => i.uid === uid);
  if (!it || it.liquid !== 'tainted') return;
  const tabs = carried(s).find((i) => i.id === 'purifyTabs');
  const bleach = carried(s).find((i) => i.id === 'bleach' && (i.usesLeft ?? 0) > 0);
  if (!tabs && !bleach) {
    log(s, 'You need purification tablets or bleach — or boil it.', 'warn');
    return;
  }
  startAction(c, {
    label: 'Treating water', dur: 3, cancelOnMove: false, anim: 'use',
    onDone: () => {
      if (tabs) {
        const need = Math.ceil(it.fill ?? 1);
        consume(s, 'purifyTabs', Math.min(need, countItem(s, 'purifyTabs')));
      } else if (bleach) useCharge(s, bleach);
      it.liquid = 'water';
      log(s, 'The water is safe to drink now.', 'good');
    },
  });
}

// ------------------------------------------------------------------ pills, smoking, reading

export function takePill(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  const it = carried(s).find((i) => i.uid === uid);
  if (!it) return;
  const m = def(it.id).medical;
  startAction(c, {
    label: `Taking ${def(it.id).name.toLowerCase()}`, dur: 2, cancelOnMove: false, anim: 'eat',
    onDone: () => {
      const n = p.needs;
      if (m === 'painkiller') {
        n.painkiller = 5;
        log(s, 'The pain dulls after a while.', 'good');
      } else if (m === 'antibiotic') {
        n.antibiotic = Math.max(n.antibiotic, 12);
        log(s, 'Antibiotics taken. Keep a regular course to beat an infection.', 'good');
      } else if (m === 'betablocker') {
        n.calm = 4;
        n.panic *= 0.6;
        log(s, 'Your heart slows. You feel steadier.', 'good');
      }
      useCharge(s, it);
    },
  });
}

export function smoke(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  const cig = carried(s).find((i) => i.uid === uid);
  const light = hasTool(carried(s), 'lighter');
  if (!cig) return;
  if (!light) {
    log(s, 'You need a lighter or matches.', 'warn');
    return;
  }
  startAction(c, {
    label: 'Smoking', dur: 6, cancelOnMove: false, anim: 'eat',
    onDone: () => {
      useCharge(s, cig);
      useCharge(s, light);
      p.needs.craving = 0;
      p.needs.stress = clamp(p.needs.stress - (hasTrait(p.traits, 'smoker') ? 0.25 : 0.05), 0, 1);
      if (hasTrait(p.traits, 'smoker')) cheer(p, 0.05, 0.08);
    },
  });
}

// ------------------------------------------------------------------ passing the time

function tooTense(c: Ctx): boolean {
  if (c.rt.threat > 0 || c.rt.closestZombie < 8) {
    log(c.s, 'Not with them this close.', 'warn');
    return true;
  }
  return false;
}

export function playCards(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  if (!carried(s).some((i) => i.uid === uid) || tooTense(c)) return;
  startAction(c, {
    label: 'Playing solitaire', dur: 999, gameHours: 1, ffwd: true, cancelOnMove: true, anim: 'use', fun: true,
    onDone: () => {
      const k = useFun(p, 'cards');
      cheer(p, 0.35 * k, 0.1 * k);
      log(s, k > 0.7 ? 'A few hands of solitaire. The hour slips by.' : 'Solitaire again. You know every card by now.', k > 0.7 ? 'good' : 'info');
    },
  });
}

export function doCrossword(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  const book = carried(s).find((i) => i.uid === uid);
  if (!book || tooTense(c)) return;
  startAction(c, {
    label: 'Doing a crossword', dur: 999, gameHours: 0.75, ffwd: true, cancelOnMove: true, anim: 'read', fun: true,
    onDone: () => {
      const k = useFun(p, 'crossword');
      cheer(p, 0.35 * k, 0.1 * k);
      const left = (book.usesLeft ?? 1) - 1;
      useCharge(s, book);
      log(s, left > 0 ? `Puzzle solved. ${left} left in the book.` : 'The last puzzle in the book.', 'good');
    },
  });
}

export function listenRadio(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  if (!carried(s).some((i) => i.uid === uid) || tooTense(c)) return;
  if (s.time >= s.util.radioEndsAt) {
    log(s, 'Nothing but static on every station.', 'info');
    return;
  }
  startAction(c, {
    label: 'Listening to the radio', dur: 999, gameHours: 0.5, ffwd: true, cancelOnMove: true, anim: 'use', fun: true,
    noise: { radius: 4, every: 3, acc: 0, kind: 'radio' },
    onDone: () => {
      const k = useFun(p, 'radio');
      cheer(p, 0.2 * k, 0.06 * k);
      log(s, 'A tired voice reads the same list of shelters, then music. For a while it almost feels normal.', 'radio');
    },
  });
}

/** Television while the power lasts: the best distraction there is, and loud enough to be heard outside. */
export function watchTV(c: Ctx, powered: boolean): void {
  const s = c.s;
  const p = s.player;
  if (tooTense(c)) return;
  if (!powered) {
    log(s, 'The screen stays dark. No power.', 'info');
    return;
  }
  startAction(c, {
    label: 'Watching TV', dur: 999, gameHours: 1, ffwd: true, cancelOnMove: true, anim: 'use', fun: true,
    noise: { radius: 7, every: 2.5, acc: 0, kind: 'tv' },
    onDone: () => {
      const k = useFun(p, 'tv');
      cheer(p, 0.45 * k, 0.12 * k);
      const shows = ['Reruns of a cooking show, between emergency bulletins.', 'A cartoon marathon. Nobody is running the station anymore.', 'The emergency broadcast loops. Then an old movie.'];
      log(s, shows[c.rt.rng.int(0, shows.length - 1)], 'good');
    },
  });
}

export function read(c: Ctx, uid: number): void {
  const s = c.s;
  const p = s.player;
  const it = carried(s).find((i) => i.uid === uid);
  if (!it) return;
  const d = def(it.id);
  const dark = c.rt.threat > 0;
  if (dark) {
    log(s, 'Not with them this close.', 'warn');
    return;
  }
  if (d.book) {
    if ((p.bookBoost[d.book.skill] ?? -1) >= d.book.maxLevel) {
      log(s, 'You\'ve already read this.', 'info');
      return;
    }
    startAction(c, {
      label: `Reading ${d.name}`, dur: 999, gameHours: d.book.hours, ffwd: true, cancelOnMove: true, anim: 'read',
      onDone: () => {
        p.bookBoost[d.book!.skill] = Math.max(p.bookBoost[d.book!.skill] ?? 0, d.book!.maxLevel);
        cheer(p, 0.3, 0.06);
        p.needs.stress = clamp(p.needs.stress - 0.1, 0, 1);
        log(s, `Finished ${d.name}. You'll learn ${d.book!.skill} much faster now.`, 'good');
      },
    });
  } else if (d.magazine) {
    if (p.magazines.includes(d.magazine)) {
      log(s, 'You already know this.', 'info');
      return;
    }
    startAction(c, {
      label: `Reading ${d.name}`, dur: 999, gameHours: 0.5, ffwd: true, cancelOnMove: true, anim: 'read',
      onDone: () => {
        p.magazines.push(d.magazine!);
        log(s, `You learned: ${d.desc}`, 'good');
      },
    });
  } else if (it.id === 'comics' || it.id === 'newspaper') {
    const comic = it.id === 'comics';
    startAction(c, {
      label: `Reading ${d.name.toLowerCase()}`, dur: 999, gameHours: comic ? 1 : 0.5, ffwd: true, cancelOnMove: true, anim: 'read', fun: true,
      onDone: () => {
        // you only laugh at the same comic once
        const fresh = (it.reads ?? 0) === 0 ? 1 : 0.25;
        it.reads = (it.reads ?? 0) + 1;
        const k = fresh * useFun(p, 'reading');
        p.needs.stress = clamp(p.needs.stress - (comic ? 0.15 : 0.05) * k, 0, 1);
        cheer(p, (comic ? 0.4 : 0.15) * k, (comic ? 0.15 : 0.03) * k);
        log(s, fresh < 1 ? 'You\'ve read this one before. It helps a little.' : comic ? 'That took your mind off things for a while.' : 'Old news, but it passed the time.', 'good');
      },
    });
  } else if (it.id === 'map') {
    s.hasMap = true;
    log(s, 'You study the map. Roads and buildings are now marked on your map (M).', 'good');
  }
}

// ------------------------------------------------------------------ simple crafting

export interface Recipe {
  id: string;
  name: string;
  needs: [string, number][];
  tools?: string[];
  skill?: [string, number];
  mag?: string;
  dur: number;
  noise?: number;
  out: [string, number][];
  desc: string;
}

export const RECIPES: Recipe[] = [
  { id: 'rags', name: 'Rip sheet into rags', needs: [['sheet', 1]], dur: 4, out: [['rag', 4]], desc: 'Rags stop bleeding but aren\'t sterile.' },
  { id: 'ragsShirt', name: 'Rip T-shirt into rags', needs: [['tshirt', 1]], dur: 4, out: [['rag', 2]], desc: 'Two rags from an old shirt.' },
  { id: 'sterile', name: 'Sterilize rags (disinfectant)', needs: [['rag', 2]], tools: ['#disinfect'], dur: 5, out: [['cleanRag', 2]], desc: 'Soak rags in disinfectant for clean dressings.' },
  { id: 'splint', name: 'Make a splint', needs: [['plank', 1], ['rag', 2]], dur: 6, out: [['splint', 1]], desc: 'Immobilises a broken bone.' },
  { id: 'splintStick', name: 'Make a splint (twigs)', needs: [['stick', 2], ['rag', 2]], dur: 6, out: [['splint', 1]], desc: 'A rough splint from branches.' },
  { id: 'spear', name: 'Carve a spear', needs: [['plank', 1]], tools: ['knife'], dur: 12, out: [['spear', 1]], desc: 'Long reach, poor durability.' },
  { id: 'planks', name: 'Saw log into planks', needs: [['log', 1]], tools: ['saw'], dur: 10, noise: 9, out: [['plank', 3]], desc: 'Noisy work.' },
  { id: 'molotov', name: 'Make a Molotov cocktail', needs: [['emptyBottle', 1], ['rag', 1]], tools: ['#fuel'], dur: 5, out: [['molotov', 1]], desc: 'Needs 0.5 L of gasoline. Fire spreads — carefully.' },
  { id: 'nailbat', name: 'Hammer nails into a bat', needs: [['bat', 1], ['nails', 8]], tools: ['hammer'], dur: 10, noise: 12, out: [['nailbat', 1]], desc: 'More damage than a plain bat. Hammering is loud.' },
  { id: 'nailplank', name: 'Hammer nails into a plank', needs: [['plank', 1], ['nails', 6]], tools: ['hammer'], dur: 8, noise: 12, out: [['nailplank', 1]], desc: 'A crude but real weapon.' },
  { id: 'rod', name: 'Make a fishing rod', needs: [['branch', 1], ['twine', 1], ['nails', 1]], tools: ['knife'], dur: 10, out: [['rodImprov', 1]], desc: 'Bend a nail into a hook. Fish at the river.' },
  { id: 'bow', name: 'Make a bow', needs: [['branch', 1], ['twine', 1]], tools: ['knife'], dur: 20, out: [['bow', 1]], desc: 'A quiet ranged weapon. Weak, but nobody hears it.' },
  { id: 'arrows', name: 'Whittle arrows', needs: [['stick', 2], ['nails', 3]], tools: ['knife'], dur: 10, out: [['arrow', 3]], desc: 'Three arrows from straight twigs and nails.' },
  { id: 'canAlarm', name: 'String a tin-can alarm', needs: [['emptyCan', 3], ['twine', 1]], mag: 'traps', dur: 8, out: [['alarmtrapItem', 1]], desc: 'Place it across a doorway. Rattles loudly when something passes.' },
  { id: 'crate', name: 'Build a storage crate kit', needs: [['plank', 3], ['nails', 6]], tools: ['hammer'], skill: ['carpentry', 1], dur: 14, noise: 14, out: [['woodcrateItem', 1]], desc: 'A crate that holds 40 kg.' },
  { id: 'barrel', name: 'Build a rain collector kit', needs: [['plank', 4], ['nails', 6], ['garbageBag', 4]], tools: ['hammer'], skill: ['carpentry', 2], dur: 18, noise: 14, out: [['rainbarrelItem', 1]], desc: 'Collects rainwater outdoors. Boil or treat before drinking.' },
];

export function recipeStatus(c: Ctx, r: Recipe): string | null {
  const s = c.s;
  const p = s.player;
  for (const [id, q] of r.needs) if (countItem(s, id) < q) return `Need ${q}× ${def(id).name}`;
  for (const t of r.tools ?? []) {
    if (t === '#disinfect') {
      if (!carried(s).some((i) => def(i.id).medical === 'disinfect' || (i.id === 'whiskey' && (i.fill ?? 0) >= 0.1))) return 'Need disinfectant or alcohol';
    } else if (t === '#fuel') {
      if (!carried(s).some((i) => i.liquid === 'fuel' && (i.fill ?? 0) >= 0.5)) return 'Need 0.5 L of gasoline';
    } else if (!hasTool(carried(s), t)) return `Need a ${t}`;
  }
  if (r.skill && lvl(p, r.skill[0] as never) < r.skill[1]) return `Needs ${r.skill[0]} level ${r.skill[1]}`;
  if (r.mag && !p.magazines.includes(r.mag)) return 'You don\'t know how';
  return null;
}

export function craft(c: Ctx, r: Recipe): void {
  const s = c.s;
  const why = recipeStatus(c, r);
  if (why) {
    log(s, why, 'warn');
    return;
  }
  const noise = r.noise;
  startAction(c, {
    label: r.name, dur: r.dur * handWork(c) * (r.skill ? 1 - lvl(s.player, r.skill[0] as never) * 0.05 : 1), cancelOnMove: true, anim: 'work',
    noise: noise ? { radius: noise, every: 1.5, acc: 0, kind: 'hammer' } : undefined,
    onDone: () => {
      if (recipeStatus(c, r)) return;
      for (const [id, q] of r.needs) consume(s, id, q);
      for (const t of r.tools ?? []) {
        if (t === '#disinfect') {
          const dis = carried(s).find((i) => def(i.id).medical === 'disinfect');
          if (dis) useCharge(s, dis);
          else {
            const wh = carried(s).find((i) => i.id === 'whiskey' && (i.fill ?? 0) >= 0.1);
            if (wh) wh.fill = (wh.fill ?? 0) - 0.1;
          }
        } else if (t === '#fuel') {
          const can = carried(s).find((i) => i.liquid === 'fuel' && (i.fill ?? 0) >= 0.5);
          if (can) can.fill = (can.fill ?? 0) - 0.5;
        }
      }
      for (const [id, q] of r.out) {
        const d = def(id);
        if (d.stack) s.player.inventory.push(makeItem(s, id, { qty: q }));
        else for (let k = 0; k < q; k++) s.player.inventory.push(makeItem(s, id));
      }
      if (r.skill) addXp(s.player, r.skill[0] as never, 10);
      if (r.id === 'crate' || r.id === 'barrel') addXp(s.player, 'carpentry', 12);
      log(s, `Made: ${r.out.map(([id, q]) => `${q > 1 ? q + '× ' : ''}${def(id).name}`).join(', ')}.`, 'good');
    },
  });
}

export function insertBattery(c: Ctx, uid: number): void {
  const s = c.s;
  const it = carried(s).find((i) => i.uid === uid);
  const bat = carried(s).find((i) => i.id === 'battery');
  if (!it || !bat) return;
  consume(s, 'battery', 1);
  it.charge = 1;
  log(s, `New battery in the ${itemName(it).toLowerCase()}.`, 'good');
}

/** How much a duct-tape patch would restore right now (each patch helps less). */
export function tapeRepairAmount(it: Item): number {
  return Math.max(0, Math.min(1 - it.cond, 0.3 * Math.pow(0.8, it.repairs ?? 0)));
}

export function repairWithTape(c: Ctx, uid: number): void {
  const s = c.s;
  const it = carried(s).find((i) => i.uid === uid);
  const tape = carried(s).find((i) => i.id === 'ducttape' && (i.usesLeft ?? 0) > 0);
  if (!it || !def(it.id).weapon) return;
  if (!tape) return log(s, 'You need duct tape.', 'warn');
  if (tapeRepairAmount(it) < 0.02) return log(s, 'Tape won\'t do any more for it.', 'info');
  startAction(c, {
    label: `Taping up the ${def(it.id).name.toLowerCase()}`, dur: 4, cancelOnMove: true, anim: 'work',
    onDone: () => {
      const tp = carried(s).find((i) => i.id === 'ducttape' && (i.usesLeft ?? 0) > 0);
      if (!tp || !carried(s).includes(it)) return;
      const gain = tapeRepairAmount(it);
      it.cond = Math.min(1, it.cond + gain);
      it.repairs = (it.repairs ?? 0) + 1;
      useCharge(s, tp);
      log(s, `You wrap the ${def(it.id).name.toLowerCase()} in tape (+${Math.round(gain * 100)}% condition).`, 'good');
    },
  });
}

export function describe(it: Item): string {
  const d = def(it.id);
  const parts: string[] = [];
  parts.push(`${d.weight * it.qty < 0.1 ? '<0.1' : (d.weight * it.qty).toFixed(1)} kg`);
  if (d.weapon) parts.push(`Damage ${d.weapon.dmg.toFixed(1)} · Reach ${d.weapon.reach.toFixed(1)} · Swing ${d.weapon.swing.toFixed(2)}s · Noise ${d.weapon.noise}${d.weapon.twoHanded ? ' · Two-handed' : ''} · Condition ${Math.round(it.cond * 100)}%`);
  if (d.firearm) parts.push(`${it.ammo ?? 0}/${d.firearm.mag} loaded · Range ${d.firearm.range} · Heard up to ~${d.firearm.noise} tiles away`);
  if (d.food) {
    const fr = freshness(it, d);
    parts.push(`Hunger −${Math.round(d.food.hunger * 100)}%${d.food.thirst ? ` · Thirst ${d.food.thirst > 0 ? '−' : '+'}${Math.round(Math.abs(d.food.thirst) * 100)}%` : ''}${fr !== 'none' ? ` · ${fr}` : ''}${d.food.canned ? ' · Canned' : ''}`);
  }
  if (d.clothing) parts.push(`Warmth ${d.clothing.ins} · Scratch ${Math.round(d.clothing.scratch * 100)}% · Bite ${Math.round(d.clothing.bite * 100)}%${d.clothing.water ? ` · Waterproof ${Math.round(d.clothing.water * 100)}%` : ''}`);
  if (d.bag) parts.push(`Holds ${d.bag.cap} kg, carried at ${Math.round((1 - d.bag.red) * 100)}% weight`);
  if (d.light) parts.push(`Battery ${Math.round((it.charge ?? 0) * 100)}%`);
  if (it.usesLeft !== undefined) parts.push(`${it.usesLeft} uses left`);
  if (d.desc) parts.push(d.desc);
  return parts.join('\n');
}

export type { ContRef };
