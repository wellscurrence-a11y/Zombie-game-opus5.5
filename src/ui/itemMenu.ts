// What you can do with an item.
import type { Game } from '../game';
import { def, type Item } from '../sim/items';
import { addItem, dropItem, locate, transfer, type ContRef } from '../sim/inventory';
import { log } from '../sim/log';
import { canOpeners, describe, drinkFrom, eat, equip, insertBattery, pourOut, purify, read, smoke, takePill, wear } from '../sim/use';
import { heldItem } from '../sim/stats';

export interface MenuItem {
  label: string;
  run: () => void;
  enabled?: boolean;
  reason?: string;
}

export function itemActions(g: Game, it: Item, where: ContRef): MenuItem[] {
  const s = g.s;
  const p = s.player;
  const d = def(it.id);
  const out: MenuItem[] = [];
  const mine = where.kind === 'player' || where.kind === 'bag';
  if (!mine) {
    out.push({ label: 'Take', run: () => {
      const err = transfer(s, g.rt, where, { kind: 'player' }, it.uid);
      if (err) log(s, err, 'warn');
    } });
    if (p.bag) out.push({ label: 'Take to bag', run: () => {
      const err = transfer(s, g.rt, where, { kind: 'bag' }, it.uid);
      if (err) log(s, err, 'warn');
    } });
  }
  // food & drink
  if (d.food) {
    const verb = d.cat === 'drink' ? 'Drink' : 'Eat';
    if (d.food.canned) {
      const o = canOpeners(g);
      if (o.opener) out.push({ label: `${verb} (can opener)`, run: () => eat(g, it.uid, 'opener') });
      else {
        out.push({ label: `${verb} — pry it open with a knife (risky)`, enabled: !!o.knife, reason: o.knife ? undefined : 'Need a knife', run: () => eat(g, it.uid, 'knife') });
        out.push({ label: `${verb} — bash it open (noisy)`, enabled: !!o.blunt, reason: o.blunt ? undefined : 'Need a hammer or screwdriver', run: () => eat(g, it.uid, 'blunt') });
      }
    } else {
      out.push({ label: verb, run: () => eat(g, it.uid) });
    }
  }
  if (d.liquid && (it.fill ?? 0) > 0) {
    if (it.liquid !== 'fuel') out.push({ label: it.liquid === 'tainted' ? 'Drink (untreated!)' : 'Drink', run: () => drinkFrom(g, it.uid) });
    if (it.liquid === 'tainted') out.push({ label: 'Purify (tablets/bleach)', run: () => purify(g, it.uid) });
    out.push({ label: 'Pour out', run: () => pourOut(g, it.uid) });
  }
  // equipment
  if (d.weapon || d.firearm || d.light || d.tools) {
    const held = heldItem(p)?.uid === it.uid;
    if (d.weapon || d.firearm) out.push({ label: held ? 'Unequip' : 'Equip (hold)', run: () => equip(g, it.uid) });
    if (d.firearm && (it.ammo ?? 0) > 0) out.push({ label: `Unload (${it.ammo})`, run: () => {
      const n = it.ammo ?? 0;
      it.ammo = 0;
      addItem(s, { kind: 'player' }, { uid: s.nextUid++, id: d.firearm!.ammo, qty: n, cond: 1, age: 0 }, true);
    } });
  }
  if (d.clothing || d.bag) {
    const worn = Object.values(p.worn).some((w) => w?.uid === it.uid) || p.bag?.uid === it.uid;
    if (!worn) out.push({ label: d.bag ? 'Wear bag' : 'Wear', run: () => {
      if (!mine) {
        const err = transfer(s, g.rt, where, { kind: 'player' }, it.uid);
        if (err) return log(s, err, 'warn');
      }
      wear(g, it.uid);
    } });
  }
  if (d.medical === 'painkiller' || d.medical === 'antibiotic' || d.medical === 'betablocker') out.push({ label: 'Take a dose', run: () => takePill(g, it.uid) });
  if (d.medical && ['bandage', 'rag', 'disinfect', 'wipe', 'splint', 'suture', 'tweezers'].includes(d.medical)) out.push({ label: 'Treat wounds (Health panel)', run: () => g.ui?.openPanel('health') });
  if (d.book || d.magazine || it.id === 'comics' || it.id === 'newspaper' || it.id === 'map') out.push({ label: 'Read', run: () => read(g, it.uid) });
  if (it.id === 'cigarettes') out.push({ label: 'Smoke', run: () => smoke(g, it.uid) });
  if (d.light) {
    out.push({ label: 'Insert new battery', enabled: s.player.inventory.some((i) => i.id === 'battery') || !!p.bag?.contents?.some((i) => i.id === 'battery'), reason: 'Need a battery', run: () => insertBattery(g, it.uid) });
    if (mine) out.push({ label: p.flashlight ? 'Turn off (F)' : 'Turn on (F)', run: () => {
      if (!p.inventory.includes(it)) transfer(s, g.rt, where, { kind: 'player' }, it.uid);
      p.flashlight = !p.flashlight;
      g.rt.fovDirty = true;
    } });
  }
  if (d.cat === 'placeable') out.push({ label: 'Place', run: () => {
    if (!mine) {
      const err = transfer(s, g.rt, where, { kind: 'player' }, it.uid);
      if (err) return log(s, err, 'warn');
    }
    g.ui?.closePanel();
    g.beginPlace(it.uid);
  } });
  if (d.throwNoise && mine) {
    const label = it.id === 'alarmClock' ? 'Set it and throw (rings in 8 s)' : it.id === 'molotov' ? 'Light and throw' : 'Throw (distraction)';
    out.push({ label, run: () => {
      if (it.id === 'molotov' && !s.player.inventory.concat(p.bag?.contents ?? []).some((i) => def(i.id).tools?.includes('lighter'))) return log(s, 'You need a lighter to light it.', 'warn');
      g.ui?.closePanel();
      g.beginThrow(it.uid);
    } });
  }
  if (it.id === 'radio') out.push({ label: 'Listen (broadcasts come in while you carry it)', run: () => log(s, s.time < s.util.radioEndsAt ? 'You tune in. Broadcasts will appear in your log.' : 'Static. Nobody is broadcasting anymore.', 'radio') });
  if (it.id === 'watch') out.push({ label: 'Check the time', run: () => log(s, 'Keep it on you and the exact time shows in the corner.', 'info') });
  if (mine) out.push({ label: 'Drop', run: () => dropItem(s, g.rt, it.uid, locate(s, it.uid) ?? where) });
  if (mine && where.kind === 'player' && p.bag) out.push({ label: 'Put in bag', run: () => {
    const err = transfer(s, g.rt, where, { kind: 'bag' }, it.uid);
    if (err) log(s, err, 'warn');
  } });
  if (mine && where.kind === 'bag') out.push({ label: 'Move to pockets', run: () => {
    const err = transfer(s, g.rt, where, { kind: 'player' }, it.uid);
    if (err) log(s, err, 'warn');
  } });
  out.push({ label: 'Inspect', run: () => log(s, `${d.name}: ${describe(it).replace(/\n/g, ' · ')}`, 'info') });
  return out;
}
