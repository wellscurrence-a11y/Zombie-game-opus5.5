// Stoves, campfires, generators, pumps, rain barrels, wells, traps, foraging, farming, trees and building.
import { clamp } from '../core/math';
import { hourOfDay } from '../core/time';
import { FURN } from '../world/furniture';
import { G, S, type Furniture } from '../world/world';
import { addInjury } from './body';
import { def, hasTool, itemName, makeItem, type Item } from './items';
import { addItem, carried, consume, countItem, useCharge } from './inventory';
import type { Option } from './interact';
import { chronicle, log, note } from './log';
import { buildingPowered } from './lighting';
import { emitNoise } from './noise';
import { addXp, lvl } from './skills';
import type { GameState } from './types';
import { drinkFromSource, fillContainers, startAction, watchTV, type Ctx } from './use';
import { placeFurn } from '../world/gen/builder';
import { VEH } from './vehicleSpecs';

// ================================================================== cooking

export function isCookable(it: Item): boolean {
  const d = def(it.id);
  if (d.food?.needsCooking && !it.cooked && it.id !== 'rice' && it.id !== 'pasta') return true;
  if (it.id === 'pot' && (it.fill ?? 0) > 0.1) return true;
  return false;
}

function heatSourceOk(s: GameState, f: Furniture): boolean {
  if (f.kind === 'stove') return buildingPowered(s, f.bld);
  return (f.fuel ?? 0) > 0;
}

function cookingOptions(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const out: Option[] = [];
  f.cookItems ??= [];
  const ok = heatSourceOk(s, f);
  if (f.kind === 'stove') {
    out.push({
      label: f.on ? 'Turn the stove off' : 'Turn the stove on', enabled: ok || f.on, reason: ok ? undefined : 'No power',
      run: () => {
        f.on = !f.on;
        log(s, f.on ? 'The burner clicks on.' : 'You turn the stove off.', 'info');
      },
    });
  } else {
    const lighter = hasTool(carried(s), 'lighter');
    if (!f.on) {
      const hasFuel = (f.fuel ?? 0) > 0;
      out.push({
        label: 'Light the fire', enabled: !!lighter && hasFuel, reason: !lighter ? 'Need a lighter or matches' : !hasFuel ? 'Add fuel first' : undefined,
        run: () => startAction(c, {
          label: 'Lighting the fire', dur: 3, cancelOnMove: true, anim: 'kneel',
          onDone: () => {
            if (!lighter) return;
            useCharge(s, lighter);
            f.on = true;
            c.rt.lightDirty = true;
            log(s, 'The fire catches.', 'good');
          },
        }),
      });
    } else {
      out.push({ label: 'Put out the fire', run: () => {
        f.on = false;
        c.rt.lightDirty = true;
        log(s, 'You smother the flames.', 'info');
      } });
    }
    const fuels = carried(s).filter((i) => def(i.id).fuelValue);
    const seen = new Set<string>();
    for (const it of fuels) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ label: `Add fuel: ${def(it.id).name.toLowerCase()} (+${def(it.id).fuelValue} h)`, run: () => {
        if (!consume(s, it.id, 1)) return;
        f.fuel = (f.fuel ?? 0) + def(it.id).fuelValue!;
        log(s, `Fuel: about ${Math.round(f.fuel ?? 0)} hours.`, 'info');
      } });
    }
  }
  if (f.on) out.push(...stewOption(c, f));
  if (f.on && f.kind !== 'stove') out.push(...smokeOption(c, f));
  // put food on
  for (const it of carried(s)) {
    if (!isCookable(it)) continue;
    out.push({ label: `Cook: ${itemName(it)}`, run: () => {
      const where = s.player.inventory.includes(it) ? s.player.inventory : s.player.bag?.contents ?? [];
      const i = where.indexOf(it);
      if (i < 0) return;
      where.splice(i, 1);
      it.heat = it.heat ?? 0;
      f.cookItems!.push(it);
      if (s.player.primary === it.uid) s.player.primary = 0;
      log(s, `You put the ${def(it.id).name.toLowerCase()} on. Don't forget about it.`, 'info');
    } });
  }
  for (const it of f.cookItems) {
    const st = it.burnt ? 'burnt' : it.cooked || (it.id === 'pot' && (it.heat ?? 0) >= 1) ? 'ready' : 'cooking';
    out.push({ label: `Take off: ${itemName(it)} (${st})`, run: () => {
      f.cookItems = f.cookItems!.filter((o) => o !== it);
      addItem(s, { kind: 'player' }, it, true);
    } });
  }
  return out;
}

// ================================================================== stews & soups

const STEW_INGREDIENTS = ['fish', 'steak', 'chicken', 'potato', 'carrot', 'tomato', 'cabbage', 'rice', 'pasta'];

/** Three ingredients and half a litre of water in a pot over a fire make a hot meal that goes further. */
function stewOption(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const pot = carried(s).find((it) => it.id === 'pot' && (it.fill ?? 0) >= 0.5 && (it.liquid === 'water' || it.liquid === 'tainted'));
  const ingredients = carried(s).filter((it) => STEW_INGREDIENTS.includes(it.id) && !it.burnt);
  const ok = !!pot && ingredients.length >= 3;
  const hasFish = ingredients.slice(0, 3).some((it) => it.id === 'fish');
  return [{
    label: `Cook ${hasFish ? 'a fish soup' : 'a stew'} (30 min)`, enabled: ok,
    reason: !pot ? 'Need a pot with 0.5 L of water' : 'Need 3 ingredients (meat, fish, vegetables, rice or pasta)',
    run: () => startAction(c, {
      label: hasFish ? 'Cooking fish soup' : 'Cooking a stew', dur: 999, gameHours: 0.5, ffwd: true, cancelOnMove: true, anim: 'use',
      onDone: () => {
        if (!f.on) return log(s, 'The fire went out before it was done.', 'warn');
        const potNow = carried(s).find((it) => it.id === 'pot' && (it.fill ?? 0) >= 0.5 && (it.liquid === 'water' || it.liquid === 'tainted'));
        const use = carried(s).filter((it) => STEW_INGREDIENTS.includes(it.id) && !it.burnt).slice(0, 3);
        if (!potNow || use.length < 3) return log(s, 'Something is missing.', 'warn');
        const fish = use.some((it) => it.id === 'fish');
        for (const it of use) consume(s, it.id, 1);
        potNow.fill = (potNow.fill ?? 0) - 0.5;
        if ((potNow.fill ?? 0) < 0.01) {
          potNow.fill = 0;
          potNow.liquid = undefined;
        }
        addItem(s, { kind: 'player' }, makeItem(s, fish ? 'fishSoup' : 'stew'), true);
        addXp(s.player, 'cooking', 10);
        log(s, fish ? 'A pot of fish soup. It smells like a normal evening.' : 'A pot of stew, hot and thick.', 'good');
      },
    }),
  }];
}

/** Slow smoke over a wood fire turns meat and fish that would rot in a day into jerky that keeps. */
function smokeOption(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const raw = carried(s).filter((it) => (it.id === 'steak' || it.id === 'chicken' || it.id === 'fish') && !it.burnt);
  if (!raw.length) return [];
  const yieldOf = (id: string): number => (id === 'fish' ? 1 : 2);
  const total = raw.reduce((a, it) => a + yieldOf(it.id), 0);
  return [{
    label: `Smoke meat and fish into jerky (2 h, makes ${total})`, enabled: (f.fuel ?? 0) >= 1.5, reason: 'The fire needs 2 hours of fuel',
    run: () => startAction(c, {
      label: 'Smoking meat', dur: 999, gameHours: 2, ffwd: true, cancelOnMove: true, anim: 'kneel',
      onDone: () => {
        if (!f.on) return log(s, 'The fire died. The meat is only half done.', 'warn');
        let n = 0;
        for (const it of carried(s).filter((i) => (i.id === 'steak' || i.id === 'chicken' || i.id === 'fish') && !i.burnt)) {
          if (!consume(s, it.id, 1)) continue;
          n += yieldOf(it.id);
        }
        for (let k = 0; k < n; k++) addItem(s, { kind: 'player' }, makeItem(s, 'jerky'), true);
        addXp(s.player, 'cooking', 8);
        log(s, n ? `${n} strips of jerky. It will keep for weeks.` : 'Nothing left to smoke.', n ? 'good' : 'info');
      },
    }),
  }];
}

/** Called every game-time tick for stoves, grills and campfires. */
export function updateCooking(c: Ctx, hours: number): void {
  const s = c.s;
  const rt = c.rt;
  const w = s.world;
  for (const f of w.furniture) {
    if (f.gone) continue;
    if (f.kind !== 'stove' && f.kind !== 'campfire' && f.kind !== 'bbq') continue;
    // fuel burns
    if (f.kind !== 'stove' && f.on) {
      f.fuel = Math.max(0, (f.fuel ?? 0) - hours);
      if ((f.fuel ?? 0) <= 0) {
        f.on = false;
        rt.lightDirty = true;
      }
      // embers can jump from an indoor campfire
      const i = f.y * w.w + f.x;
      if (f.kind === 'campfire' && w.room[i] >= 0 && rt.rng.chance(hours * 0.15)) startFire(s, rt, i + (rt.rng.chance(0.5) ? 1 : w.w), 'embers from an indoor fire');
    }
    if (f.kind === 'stove' && f.on && !buildingPowered(s, f.bld)) f.on = false;
    if (!f.on || !f.cookItems?.length) continue;
    const near = Math.hypot(f.x + 0.5 - s.player.x, f.y + 0.5 - s.player.y) < 12;
    for (const it of f.cookItems) {
      const before = it.heat ?? 0;
      it.heat = before + hours / 0.33;
      if (it.id === 'pot') {
        if (before < 1 && it.heat >= 1 && it.liquid === 'tainted') {
          it.liquid = 'water';
          if (near) log(s, 'The water in the pot is boiling. It\'s safe now.', 'good');
        }
        if (it.heat > 3 && (it.fill ?? 0) > 0) {
          it.fill = Math.max(0, (it.fill ?? 0) - hours * 1.5);
          if ((it.fill ?? 0) <= 0) it.liquid = undefined;
        }
        continue;
      }
      if (before < 1 && it.heat >= 1) {
        it.cooked = true;
        if (near) log(s, `The ${def(it.id).name.replace('Raw ', '').toLowerCase()} is cooked.`, 'good');
        addXp(s.player, 'cooking', 6);
      }
      if (before < 1.8 && it.heat >= 1.8) {
        it.burnt = true;
        emitNoise(s, rt, { x: f.x + 0.5, y: f.y + 0.5, radius: 3, kind: 'sizzle', src: 'world', label: 'Something is burning' });
        if (near) log(s, 'Something is burning!', 'danger');
      }
      if (it.heat >= 2.8 && rt.rng.chance(hours * 6)) {
        startFire(s, rt, f.y * w.w + f.x, 'food left burning on the stove');
        f.cookItems = f.cookItems.filter((o) => o !== it);
        break;
      }
    }
  }
}

// ================================================================== fire

export function startFire(s: GameState, rt: { lightDirty: boolean; rng: { chance(p: number): boolean } }, i: number, cause: string): void {
  const w = s.world;
  if (i < 0 || i >= w.w * w.h) return;
  if (s.fires[i]) return;
  if (w.ground[i] === G.Water || w.ground[i] === G.Burnt) return;
  s.fires[i] = { heat: 0.35, fuel: 1, t: s.time };
  rt.lightDirty = true;
  const px = i % w.w;
  const py = Math.floor(i / w.w);
  if (Math.hypot(px - s.player.x, py - s.player.y) < 30) {
    log(s, `Fire! (${cause})`, 'danger');
    chronicle(s, `A fire started: ${cause}.`, 4);
    note(s, 'fire');
  }
}

// ================================================================== generators, pumps, water

function nearestBuilding(s: GameState, x: number, y: number): number {
  const w = s.world;
  let best = -1;
  let bd = 3.5;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
      const b = w.bld[ty * w.w + tx];
      if (b < 0) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
  }
  return best;
}

function generatorOptions(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const p = s.player;
  const out: Option[] = [];
  f.fuel ??= 0;
  const connected = s.world.buildings.find((b) => b.generator === f.id);
  out.push({
    label: f.on ? 'Turn off' : 'Turn on', enabled: f.on || (f.fuel ?? 0) > 0, reason: (f.fuel ?? 0) > 0 ? undefined : 'No fuel',
    run: () => {
      f.on = !f.on;
      c.rt.lightDirty = true;
      if (f.on) {
        log(s, `The generator roars to life.${connected ? '' : ' It isn\'t connected to anything.'}`, 'info');
        emitNoise(s, c.rt, { x: f.x + 0.5, y: f.y + 0.5, radius: 20, kind: 'generator', src: 'player' });
        if (s.world.room[f.y * s.world.w + f.x] >= 0) {
          log(s, 'Exhaust fumes start filling the room...', 'danger');
        }
      }
    },
  });
  const can = carried(s).find((i) => i.liquid === 'fuel' && (i.fill ?? 0) > 0.1);
  out.push({
    label: `Refuel (${(f.fuel ?? 0).toFixed(1)}/10 L)`, enabled: !!can, reason: can ? undefined : 'Need a gas can with fuel',
    run: () => startAction(c, {
      label: 'Refuelling the generator', dur: 4, cancelOnMove: true, anim: 'use',
      onDone: () => {
        if (!can) return;
        const amt = Math.min(can.fill ?? 0, 10 - (f.fuel ?? 0));
        f.fuel = (f.fuel ?? 0) + amt;
        can.fill = (can.fill ?? 0) - amt;
        if ((can.fill ?? 0) < 0.01) {
          can.fill = 0;
          can.liquid = undefined;
        }
      },
    }),
  });
  const bld = nearestBuilding(s, f.x, f.y);
  if (bld >= 0 && !connected) {
    const knows = p.magazines.includes('generator') || lvl(p, 'electrical') >= 3;
    out.push({
      label: knows ? 'Connect to the building' : 'Try to connect it (no idea how)',
      run: () => startAction(c, {
        label: 'Wiring the generator', dur: 10, cancelOnMove: true, anim: 'work',
        onDone: () => {
          if (!knows && c.rt.rng.chance(0.6)) {
            addInjury(s, c.rt, 'rHand', 'burn', 0.4, 'electric shock wiring a generator');
            log(s, 'A jolt throws you back. That was stupid.', 'danger');
            return;
          }
          s.world.buildings[bld].generator = f.id;
          c.rt.lightDirty = true;
          addXp(p, 'electrical', 15);
          log(s, 'Connected. When it runs, the building has power.', 'good');
          note(s, 'generator');
        },
      }),
    });
  }
  if (!f.on) out.push({ label: 'Pick up (32 kg)', run: () => pickUpPlaceable(c, f, 'generatorItem') });
  return out;
}

function pickUpPlaceable(c: Ctx, f: Furniture, itemId: string): void {
  const s = c.s;
  const w = s.world;
  startAction(c, {
    label: `Picking up ${FURN[f.kind].name.toLowerCase()}`, dur: 2, cancelOnMove: true, anim: 'work',
    onDone: () => {
      w.furn[f.y * w.w + f.x] = -1;
      f.gone = true;
      for (const b of w.buildings) if (b.generator === f.id) b.generator = -1;
      const it = makeItem(s, itemId);
      s.player.inventory.push(it);
      w.rev.furn++;
      c.rt.lightDirty = true;
    },
  });
}

/** Place a placeable item from the inventory at a tile. */
export function placeItem(c: Ctx, uid: number, x: number, y: number): boolean {
  const s = c.s;
  const w = s.world;
  const it = carried(s).find((i) => i.uid === uid);
  if (!it) return false;
  const map: Record<string, Furniture['kind']> = {
    generatorItem: 'generator', sleepbagItem: 'sleepbag', rainbarrelItem: 'rainbarrel', woodcrateItem: 'woodcrate', alarmtrapItem: 'alarmtrap',
  };
  const kind = map[it.id];
  if (!kind) return false;
  const i = y * w.w + x;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h || w.struct[i] !== S.None || w.furn[i] >= 0 || w.ground[i] === G.Water) {
    log(s, 'You can\'t put it there.', 'warn');
    return false;
  }
  if (Math.hypot(x + 0.5 - s.player.x, y + 0.5 - s.player.y) > 2.2) {
    log(s, 'Too far away.', 'warn');
    return false;
  }
  if (kind !== 'sleepbag' && kind !== 'alarmtrap' && Math.floor(s.player.x) === x && Math.floor(s.player.y) === y) {
    log(s, 'You\'re standing there.', 'warn');
    return false;
  }
  if (!consume(s, it.id, 1)) return false;
  const g = { w, rng: c.rt.rng, vehicles: [], uid: s } as unknown as Parameters<typeof placeFurn>[0];
  const fid = placeFurn(g, kind, x, y, 0, w.bld[i], 'none|none');
  const f = w.furniture[fid];
  if (kind === 'woodcrate') {
    const cont = w.containers[f.containerId];
    cont.items = [];
    cont.searched = true;
  }
  if (kind === 'rainbarrel') {
    f.water = 0;
    f.tainted = true;
  }
  if (kind === 'generator') f.fuel = 0;
  w.rev.furn++;
  c.rt.fovDirty = true;
  log(s, `Placed ${FURN[kind].name.toLowerCase()}.`, 'good');
  if (kind === 'generator' && w.room[i] >= 0) log(s, 'You set the generator down indoors...', 'warn');
  return true;
}

function pumpOptions(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const out: Option[] = [];
  const powered = !s.util.powerOff;
  const can = carried(s).find((i) => i.id === 'gasCan' && (!i.liquid || i.liquid === 'fuel') && (i.fill ?? 0) < 9.9);
  out.push({
    label: 'Fill gas can', enabled: powered && !!can && s.stationFuel > 0, reason: !powered ? 'The pumps need power' : !can ? 'Need an empty or partly filled gas can' : 'The tanks are dry',
    run: () => startAction(c, {
      label: 'Pumping gas', dur: 6, cancelOnMove: true, anim: 'use', noise: { radius: 4, every: 2, acc: 0, kind: 'pump' },
      onDone: () => {
        if (!can) return;
        const amt = Math.min(10 - (can.fill ?? 0), s.stationFuel);
        can.fill = (can.fill ?? 0) + amt;
        can.liquid = 'fuel';
        s.stationFuel -= amt;
        log(s, 'The can is full of gasoline.', 'good');
      },
    }),
  });
  const v = s.vehicles.find((vv) => Math.hypot(vv.x - (f.x + 0.5), vv.y - (f.y + 0.5)) < 4);
  if (v) {
    out.push({
      label: `Fuel the ${VEH[v.type].name.toLowerCase()}`, enabled: powered && s.stationFuel > 0, reason: powered ? undefined : 'The pumps need power',
      run: () => startAction(c, {
        label: 'Fuelling the car', dur: 10, cancelOnMove: true, anim: 'use', noise: { radius: 4, every: 2, acc: 0, kind: 'pump' },
        onDone: () => {
          const amt = Math.min(v.fuelCap - v.fuel, s.stationFuel);
          v.fuel += amt;
          s.stationFuel -= amt;
          log(s, `Filled the tank (+${amt.toFixed(0)} L).`, 'good');
        },
      }),
    });
  }
  return out;
}

export function furnitureUtilityActions(c: Ctx, f: Furniture): Option[] {
  const s = c.s;
  const out: Option[] = [];
  switch (f.kind) {
    case 'stove':
    case 'campfire':
    case 'bbq':
      out.push(...cookingOptions(c, f));
      break;
    case 'tv': {
      const powered = buildingPowered(s, f.bld);
      out.push({ label: 'Watch TV (1 h)', enabled: powered, reason: 'No power', run: () => watchTV(c, powered) });
      break;
    }
    case 'generator':
      out.push(...generatorOptions(c, f));
      break;
    case 'pump':
      out.push(...pumpOptions(c, f));
      break;
    case 'rainbarrel': {
      const litres = f.water ?? 0;
      out.push({ label: `Drink rainwater (${litres.toFixed(1)} L, untreated)`, enabled: litres > 0.3, run: () => {
        f.water = Math.max(0, litres - 0.5);
        drinkFromSource(c, 'tainted', 'Drinking rainwater');
      } });
      out.push({ label: 'Fill containers (untreated)', enabled: litres > 0.3, run: () => {
        fillContainers(c, 'tainted', 'Filling from the barrel', litres);
        f.water = 0;
      } });
      out.push({ label: 'Pick up (empty it first)', enabled: litres < 0.5, run: () => pickUpPlaceable(c, f, 'rainbarrelItem') });
      break;
    }
    case 'well':
      out.push({ label: 'Drink from the well', run: () => drinkFromSource(c, 'water', 'Drinking well water') });
      out.push({ label: 'Draw water', run: () => fillContainers(c, 'water', 'Drawing water') });
      break;
    case 'alarmtrap':
      out.push({ label: 'Pick up the alarm line', run: () => pickUpPlaceable(c, f, 'alarmtrapItem') });
      break;
    case 'sleepbag':
      out.push({ label: 'Roll up the sleeping bag', run: () => pickUpPlaceable(c, f, 'sleepbagItem') });
      break;
    default:
      break;
  }
  void clamp;
  void s;
  return out;
}

// ================================================================== trees, foraging, farming, building

export function treeActions(c: Ctx, x: number, y: number): Option[] {
  const s = c.s;
  const w = s.world;
  const out: Option[] = [];
  const axe = hasTool(carried(s), 'axe');
  out.push({
    label: 'Chop down', enabled: !!axe, reason: axe ? undefined : 'Need an axe or hatchet',
    run: () => startAction(c, {
      label: 'Chopping', dur: 22 / (0.6 + lvl(s.player, 'strength') * 0.08), cancelOnMove: true, anim: 'hammer',
      noise: { radius: 12, every: 1.4, acc: 0, kind: 'chop' },
      onDone: () => {
        const i = y * w.w + x;
        if (w.struct[i] !== S.Tree) return;
        w.struct[i] = S.None;
        w.rev.walls++;
        const pile = (s.floor[i] ??= []);
        pile.push(makeItem(s, 'log', { qty: 2 }), makeItem(s, 'stick', { qty: 3 }), makeItem(s, 'branch'));
        c.rt.dirty.floor = true;
        s.player.needs.endurance = Math.max(0, s.player.needs.endurance - 0.25);
        if (axe) axe.cond = Math.max(0.02, axe.cond - 0.02);
        addXp(s.player, 'strength', 10);
        log(s, 'Timber! Logs and branches drop to the ground.', 'good');
      },
    }),
  });
  out.push(...forageOption(c, x, y));
  return out;
}

function forageOption(c: Ctx, x: number, y: number): Option[] {
  const s = c.s;
  const w = s.world;
  const i = y * w.w + x;
  const g = w.ground[i];
  if (g !== G.Forest && g !== G.TallGrass && g !== G.Grass && w.struct[i] !== S.Tree && w.struct[i] !== S.Bush) return [];
  return [{
    label: 'Forage', run: () => startAction(c, {
      label: 'Foraging', dur: 10, cancelOnMove: true, anim: 'search', noise: { radius: 1.5, every: 2, acc: 0, kind: 'rustle' },
      onDone: () => forage(c, x, y),
    }),
  }];
}

function forage(c: Ctx, x: number, y: number): void {
  const s = c.s;
  const rt = c.rt;
  const w = s.world;
  const p = s.player;
  const i = y * w.w + x;
  const g = w.ground[i];
  const skill = lvl(p, 'foraging');
  // depletion: recent foraging nearby yields less
  let depleted = 0;
  for (const k of Object.keys(s.foraged)) {
    const j = Number(k);
    if (s.time - s.foraged[j] > 48) {
      delete s.foraged[j];
      continue;
    }
    if (Math.hypot((j % w.w) - x, Math.floor(j / w.w) - y) < 6) depleted++;
  }
  s.foraged[i] = s.time;
  const forest = g === G.Forest || w.struct[i] === S.Tree;
  const base = (forest ? 0.8 : g === G.TallGrass ? 0.5 : 0.25) * (1 + skill * 0.12) / (1 + depleted * 0.6);
  const found: Item[] = [];
  const roll = (id: string, ch: number, qty = 1): void => {
    if (!rt.rng.chance(ch * base)) return;
    const it = makeItem(s, id, def(id).stack ? { qty } : {});
    if (id === 'berries' || id === 'mushrooms') {
      const poisonous = rt.rng.chance(id === 'mushrooms' ? 0.4 : 0.3);
      it.safe = !poisonous;
      it.known = skill >= 3;
      if (it.known) it.label = `${poisonous ? 'Poisonous' : 'Edible'} ${def(id).name.toLowerCase()}`;
    }
    found.push(it);
  };
  roll('berries', forest ? 0.5 : 0.3);
  roll('mushrooms', forest ? 0.35 : 0.05);
  roll('stick', 0.6, rt.rng.int(1, 3));
  if (forest) roll('branch', 0.12);
  if (g === G.Grass || g === G.TallGrass) roll('apple', 0.04);
  for (const it of found) addItem(s, { kind: 'player' }, it, true);
  addXp(p, 'foraging', 6);
  if (found.length) log(s, `You found: ${found.map((f) => itemName(f)).join(', ')}.`, 'good');
  else log(s, depleted > 1 ? 'Nothing. This area has been picked over.' : 'You find nothing useful.', 'info');
}

const CROP_YIELD: Record<string, [string, number]> = { potato: ['potato', 4], carrot: ['carrot', 4], tomato: ['tomato', 5], cabbage: ['cabbage', 1] };
const SEED_OF: Record<string, string> = { seedCarrot: 'carrot', seedPotato: 'potato', seedTomato: 'tomato', seedCabbage: 'cabbage' };

export function groundActions(c: Ctx, x: number, y: number): Option[] {
  const s = c.s;
  const w = s.world;
  const i = y * w.w + x;
  const out: Option[] = [];
  const g = w.ground[i];
  const crop = w.crops[i];
  if (w.struct[i] !== S.None && w.struct[i] !== S.Bush) return out;
  if (crop) {
    const stage = crop.health <= 0 ? 'dead' : crop.growth >= 1 ? 'ready to harvest' : crop.growth > 0.5 ? 'growing' : 'sprouting';
    if (crop.growth >= 1 && crop.health > 0) {
      out.push({ label: `Harvest ${crop.type} (${stage})`, run: () => startAction(c, {
        label: 'Harvesting', dur: 4, cancelOnMove: true, anim: 'kneel',
        onDone: () => {
          const [id, n] = CROP_YIELD[crop.type] ?? ['potato', 2];
          const qty = Math.max(1, Math.round(n * crop.health));
          for (let k = 0; k < qty; k++) addItem(s, { kind: 'player' }, makeItem(s, id), true);
          delete w.crops[i];
          addXp(s.player, 'farming', 8);
          log(s, `Harvested ${qty} ${def(id).name.toLowerCase()}${qty > 1 ? 's' : ''}.`, 'good');
        },
      }) });
    } else {
      const water = carried(s).find((it) => def(it.id).liquid && (it.fill ?? 0) >= 0.3 && it.liquid !== 'fuel' && it.liquid !== 'alcohol');
      out.push({ label: `Water the ${crop.type} (${stage}, soil ${crop.water < 0.3 ? 'dry' : 'damp'})`, enabled: !!water, reason: water ? undefined : 'Need water in a container', run: () => {
        if (!water) return;
        water.fill = (water.fill ?? 0) - 0.3;
        if ((water.fill ?? 0) < 0.01) {
          water.fill = 0;
          water.liquid = undefined;
        }
        crop.water = 1;
        log(s, 'Watered.', 'good');
      } });
      if (crop.health <= 0) out.push({ label: 'Clear the dead plant', run: () => {
        delete w.crops[i];
      } });
    }
  } else if (g === G.Furrow) {
    const seeds = carried(s).filter((it) => def(it.id).seed);
    for (const sd of seeds) {
      out.push({ label: `Plant ${def(sd.id).name.toLowerCase()}`, run: () => startAction(c, {
        label: 'Planting', dur: 3, cancelOnMove: true, anim: 'kneel',
        onDone: () => {
          if (!consume(s, sd.id, 1)) return;
          w.crops[i] = { type: SEED_OF[sd.id], growth: 0, water: 0.6, health: 1 };
          addXp(s.player, 'farming', 4);
          log(s, 'Planted. Keep it watered — or hope for rain.', 'good');
        },
      }) });
    }
  } else if ((g === G.Grass || g === G.Dirt || g === G.TallGrass) && w.bld[i] < 0) {
    const shovel = hasTool(carried(s), 'shovel');
    out.push({ label: 'Dig a furrow', enabled: !!shovel, reason: shovel ? undefined : 'Need a shovel', run: () => startAction(c, {
      label: 'Digging', dur: 6, cancelOnMove: true, anim: 'work', noise: { radius: 4, every: 1.5, acc: 0, kind: 'dig' },
      onDone: () => {
        w.ground[i] = G.Furrow;
        w.rev.ground++;
        s.player.needs.endurance = Math.max(0, s.player.needs.endurance - 0.06);
        addXp(s.player, 'farming', 3);
      },
    }) });
  }
  out.push(...forageOption(c, x, y));
  if (g === G.Water) out.push(...fishingOption(c, x, y));
  if ((g === G.Grass || g === G.Dirt || g === G.TallGrass || g === G.Forest) && w.bld[i] < 0) out.push(...wormOption(c, x, y));
  // campfire
  if (w.furn[i] < 0 && g !== G.Water) {
    const planks = countItem(s, 'plank');
    const sticks = countItem(s, 'stick');
    const ok = planks >= 2 || sticks >= 3;
    out.push({ label: w.room[i] >= 0 ? 'Build a campfire (indoors!)' : 'Build a campfire', enabled: ok, reason: ok ? undefined : 'Need 2 planks or 3 twigs', run: () => startAction(c, {
      label: 'Building a fire pit', dur: 6, cancelOnMove: true, anim: 'kneel',
      onDone: () => {
        if (planks >= 2) consume(s, 'plank', 2);
        else consume(s, 'stick', 3);
        const gg = { w, rng: c.rt.rng, vehicles: [], uid: s } as unknown as Parameters<typeof placeFurn>[0];
        const fid = placeFurn(gg, 'campfire', x, y, 0, w.bld[i], 'none|none');
        w.furniture[fid].fuel = 1.5;
        w.furniture[fid].cookItems = [];
        w.rev.furn++;
        if (w.room[i] >= 0) log(s, 'A fire indoors. Embers, smoke... be careful.', 'warn');
      },
    }) });
  }
  return out;
}

// ================================================================== fishing

function fishingOption(c: Ctx, x: number, y: number): Option[] {
  const s = c.s;
  const rod = carried(s).find((it) => def(it.id).tools?.includes('fishing'));
  const worms = countItem(s, 'worms');
  return [{
    label: `Fish here (about an hour${worms ? `, ${worms} worms for bait` : ', no bait'})`, enabled: !!rod, reason: rod ? undefined : 'Need a fishing rod',
    run: () => startAction(c, {
      label: 'Fishing', dur: 999, gameHours: 1, ffwd: true, cancelOnMove: true, anim: 'use',
      onDone: () => fishCatch(c, x, y),
    }),
  }];
}

/** Two chances an hour. Skill, bait, dawn and dusk, and a bit of rain help; cold water and a bent-nail hook don't. */
export function fishCatch(c: Ctx, x: number, y: number): number {
  const s = c.s;
  const rt = c.rt;
  const p = s.player;
  const rod = carried(s).find((it) => def(it.id).tools?.includes('fishing'));
  if (!rod) return 0;
  const improvised = rod.id === 'rodImprov';
  const h = hourOfDay(s.time);
  let caught = 0;
  let baitUsed = 0;
  for (let k = 0; k < 2; k++) {
    const bait = countItem(s, 'worms') > 0;
    let ch = 0.22 + lvl(p, 'foraging') * 0.04 + (bait ? 0.28 : 0);
    if ((h >= 5 && h < 8.5) || (h >= 17 && h < 20.5)) ch += 0.15;
    if (s.weather.rain > 0.1 && s.weather.rain < 0.7) ch += 0.08;
    if (s.weather.temp < 5) ch -= 0.12;
    if (improvised) ch *= 0.7;
    if (bait) {
      consume(s, 'worms', 1);
      baitUsed++;
    }
    if (rt.rng.chance(clamp(ch, 0.05, 0.85))) caught++;
  }
  for (let k = 0; k < caught; k++) addItem(s, { kind: 'player' }, makeItem(s, 'fish'), true);
  addXp(p, 'foraging', 3 + caught * 5);
  rod.cond -= improvised ? 0.1 : 0.03;
  const baitNote = baitUsed ? ` (${baitUsed} worm${baitUsed > 1 ? 's' : ''} used)` : '';
  if (caught) log(s, `You land ${caught === 1 ? 'a fish' : `${caught} fish`}${baitNote}. Cook it soon; it won't keep.`, 'good');
  else log(s, `Nothing's biting${baitNote}.`, 'info');
  if (rod.cond <= 0) {
    consume(s, rod.id, 1);
    log(s, 'The line snaps and the rod is finished.', 'warn');
  }
  void x;
  void y;
  return caught;
}

function wormOption(c: Ctx, x: number, y: number): Option[] {
  const s = c.s;
  const shovel = hasTool(carried(s), 'shovel');
  return [{
    label: `Dig for worms (${shovel ? '10' : '20'} min)`,
    run: () => startAction(c, {
      label: 'Digging for worms', dur: 999, gameHours: shovel ? 0.17 : 0.33, ffwd: true, cancelOnMove: true, anim: 'kneel',
      onDone: () => {
        const wet = s.weather.rain > 0.1 || s.player.needs.wet > 0.3;
        const cold = s.weather.temp < 3;
        const n = cold ? 0 : c.rt.rng.int(0, wet ? 5 : 3);
        if (n) addItem(s, { kind: 'player' }, makeItem(s, 'worms', { qty: n }), true);
        addXp(s.player, 'foraging', 1);
        log(s, n ? `You find ${n} worm${n > 1 ? 's' : ''}.` : cold ? 'The ground is too cold. Nothing.' : 'No worms here.', n ? 'good' : 'info');
        void x;
        void y;
      },
    }),
  }];
}

export function updateCrops(s: GameState, hours: number, raining: number): void {
  const w = s.world;
  const cold = s.weather.temp < 3;
  for (const k of Object.keys(w.crops)) {
    const cr = w.crops[Number(k)];
    if (cr.health <= 0) continue;
    if (raining > 0.1) cr.water = Math.min(1, cr.water + raining * hours * 0.5);
    cr.water = Math.max(0, cr.water - hours * 0.018);
    if (cr.water < 0.1) cr.health -= hours * 0.02;
    if (cold) cr.health -= hours * 0.01;
    if (cr.growth < 1.2) cr.growth += (hours / (24 * 8)) * (cr.water > 0.2 ? 1 : 0.2);
    if (cr.growth > 1.6) cr.health -= hours * 0.01; // overripe
    cr.health = clamp(cr.health, 0, 1);
  }
}
