import type { Game } from '../game';
import { clockString, dayNumber, formatDuration } from '../core/time';
import { INJURY_NAMES, PART_NAMES, effectiveBleed } from '../sim/body';
import { BUILDS, buildStatus } from '../sim/build';
import { furnDist } from '../sim/interact';
import { def, itemName, itemWeight, type BodyPart, type Item } from '../sim/items';
import { contCapacity, contName, contWeight, listItems, refKey, transfer, type ContRef } from '../sim/inventory';
import { log, NOTES } from '../sim/log';
import { describeInjury, treatments } from '../sim/medical';
import { levelFromXp, levelProgress, SKILL_NAMES, SKILLS } from '../sim/skills';
import { bagCapacity, capacity, carriedWeight, heldItem, pain } from '../sim/stats';
import { OCCUPATIONS, TRAITS } from '../sim/traits';
import { craft, describe, RECIPES, recipeStatus, takeOff } from '../sim/use';
import { G, S } from '../world/world';
import { CAT_COLORS, esc } from './dom';
import { itemActions } from './itemMenu';
import { VEH } from '../sim/vehicleSpecs';

export type Tab = 'inventory' | 'health' | 'skills' | 'craft' | 'map' | 'journal';

// ------------------------------------------------------------------ inventory

export function nearbyContainers(g: Game): ContRef[] {
  const s = g.s;
  const w = s.world;
  const p = s.player;
  const out: ContRef[] = [];
  const seen = new Set<string>();
  const push = (r: ContRef): void => {
    const k = refKey(r);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  // explicitly opened first
  for (const key of g.rt.openContainers) {
    const r = parseKey(key);
    if (r && inReach(g, r)) push(r);
  }
  const px = Math.floor(p.x);
  const py = Math.floor(p.y);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const i = y * w.w + x;
      const f = w.furn[i];
      if (f >= 0) {
        const ff = w.furniture[f];
        if (ff.containerId >= 0 && w.containers[ff.containerId].searched && furnDist(s, ff) <= 1.3) push({ kind: 'container', id: ff.containerId });
      }
      if (s.floor[i]?.length && Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) < 1.6) push({ kind: 'floor', tile: i });
    }
  }
  for (const c of s.corpses) if (c.items && Math.hypot(c.x - p.x, c.y - p.y) < 1.6) push({ kind: 'corpse', id: c.id });
  if (p.inVehicle >= 0) {
    const v = s.vehicles[p.inVehicle];
    if (w.containers[v.glovebox].items) push({ kind: 'container', id: v.glovebox });
  }
  // always offer the floor under your feet
  push({ kind: 'floor', tile: py * w.w + px });
  return out;
}

export function parseKey(k: string): ContRef | null {
  if (k === 'player') return { kind: 'player' };
  if (k === 'bag') return { kind: 'bag' };
  const n = Number(k.slice(1));
  if (k[0] === 'c') return { kind: 'container', id: n };
  if (k[0] === 'f') return { kind: 'floor', tile: n };
  if (k[0] === 'k') return { kind: 'corpse', id: n };
  return null;
}

function inReach(g: Game, r: ContRef): boolean {
  const s = g.s;
  const p = s.player;
  const w = s.world;
  if (r.kind === 'container') {
    const cont = w.containers[r.id];
    const f = w.furniture.find((ff) => ff.containerId === r.id && !ff.gone);
    if (f) return furnDist(s, f) <= 1.35;
    const v = s.vehicles.find((vv) => vv.trunk === r.id || vv.glovebox === r.id);
    if (v) {
      if (p.inVehicle === v.id) return v.glovebox === r.id;
      const back = { x: v.x - Math.cos(v.heading) * (VEH[v.type].l / 2), y: v.y - Math.sin(v.heading) * (VEH[v.type].l / 2) };
      return Math.hypot(back.x - p.x, back.y - p.y) < 2.4 || Math.hypot(v.x - p.x, v.y - p.y) < 3;
    }
    return Math.hypot(cont.x + 0.5 - p.x, cont.y + 0.5 - p.y) < 1.8;
  }
  if (r.kind === 'floor') return Math.hypot((r.tile % w.w) + 0.5 - p.x, Math.floor(r.tile / w.w) + 0.5 - p.y) < 1.7;
  if (r.kind === 'corpse') {
    const c = s.corpses.find((k) => k.id === r.id);
    return !!c && Math.hypot(c.x - p.x, c.y - p.y) < 1.8;
  }
  return true;
}

function itemRow(it: Item, from: string, held: boolean): string {
  const d = def(it.id);
  const wt = itemWeight(it);
  const cond = d.weapon || d.firearm ? ` <span class="dim">${Math.round(it.cond * 100)}%</span>` : '';
  const spoil = d.food?.spoil ? freshTag(it) : '';
  const tip = esc(describe(it));
  return `<div class="row ${held ? 'held' : ''}" data-act="primary" data-from="${from}" data-uid="${it.uid}" title="${tip}"><span class="sw" style="background:${CAT_COLORS[d.cat] ?? '#888'}"></span><span class="nm">${esc(itemName(it))}${cond}${spoil}</span><span class="wt">${wt < 0.05 ? '·' : wt.toFixed(1)}</span><span class="more" data-act="menu" data-from="${from}" data-uid="${it.uid}">⋯</span></div>`;
}

function freshTag(it: Item): string {
  const d = def(it.id);
  if (!d.food?.spoil) return '';
  const days = it.age / 24;
  if (days < d.food.spoil) return '';
  if (days < d.food.spoil * 2) return ' <span class="warn">stale</span>';
  return ' <span class="bad">rotten</span>';
}

export function renderInventory(g: Game, selected: string | null): { html: string; selected: string | null } {
  const s = g.s;
  const p = s.player;
  const held = heldItem(p);
  const slots: [string, string][] = [['head', 'Head'], ['neck', 'Neck'], ['torso', 'Torso'], ['outer', 'Jacket'], ['hands', 'Hands'], ['legs', 'Legs'], ['feet', 'Feet']];
  const worn = slots
    .map(([k, n]) => {
      const it = p.worn[k as keyof typeof p.worn];
      return `<span class="s">${n}</span><span class="i" ${it ? `data-act="takeoff" data-slot="${k}" title="Click to take off"` : ''}>${it ? esc(itemName(it)) + (it.cond < 0.5 ? ' <span class="warn">worn</span>' : '') : '<span class="faint">—</span>'}</span>`;
    })
    .join('');
  const wt = carriedWeight(p);
  const cap = capacity(p);
  const pockets = p.inventory.map((it) => itemRow(it, 'player', it.uid === held?.uid)).join('') || '<div class="empty-note">Empty pockets.</div>';
  let bagHtml = '';
  if (p.bag) {
    const bw = contWeight(s, { kind: 'bag' });
    const bc = bagCapacity(p);
    bagHtml = `<h3>${esc(def(p.bag.id).name)} <small>${bw.toFixed(1)} / ${bc.toFixed(0)} kg · <a data-act="takeoff" data-slot="bag" style="cursor:pointer;color:var(--accent)">take off</a></small></h3><div class="list" style="flex:1">${(p.bag.contents ?? []).map((it) => itemRow(it, 'bag', false)).join('') || '<div class="empty-note">Empty.</div>'}</div>`;
  }
  const left = `<div class="col"><h3>You <small>${wt.toFixed(1)} / ${cap.toFixed(0)} kg${wt > cap ? ' <span class="warn">— over capacity</span>' : ''}</small></h3>
    <div class="worn">${worn}<span class="s">Holding</span><span>${held ? esc(itemName(held)) : '<span class="faint">nothing</span>'}</span></div>
    <h3>Pockets & hands</h3><div class="list" style="flex:1;max-height:${p.bag ? '38%' : 'none'}">${pockets}</div>${bagHtml}</div>`;
  const near = nearbyContainers(g);
  if (!selected || !near.some((r) => refKey(r) === selected)) selected = near.length ? refKey(near[0]) : null;
  const tabs = near.map((r) => `<button data-act="seltab" data-key="${refKey(r)}" class="${refKey(r) === selected ? 'on' : ''}">${esc(contName(s, r))}${r.kind === 'floor' ? '' : ` (${listItems(s, r).length})`}</button>`).join('');
  let right = '<div class="col"><h3>Nearby</h3>';
  right += `<div class="subtabs">${tabs}</div>`;
  if (selected) {
    const r = parseKey(selected)!;
    const items = listItems(s, r);
    const cw = contWeight(s, r);
    const cc = contCapacity(s, r);
    right += `<div class="meter">${esc(contName(s, r))}${cc < 9000 ? ` — ${cw.toFixed(1)} / ${cc} kg` : ''}</div>`;
    right += `<div class="list" style="flex:1">${items.map((it) => itemRow(it, selected!, false)).join('') || '<div class="empty-note">Nothing here.</div>'}</div>`;
    right += `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button data-act="takeall" data-from="${selected}">Take all</button><button data-act="searchmode">Search: ${g.rt.searchMode === 'quick' ? 'Quick (noisy)' : 'Careful (quiet)'}</button></div>`;
  }
  right += '<p class="dim" style="font-size:11px;margin:8px 0 0">Click an item to move it between you and the selected container. ⋯ for more actions. Hover for details.</p></div>';
  return { html: `<div class="cols">${left}${right}</div>`, selected };
}

export function handleInventoryClick(g: Game, t: HTMLElement, selected: string | null, showMenu: (items: ReturnType<typeof itemActions>, x: number, y: number, title: string) => void, ev: MouseEvent): string | null {
  const s = g.s;
  const act = t.dataset.act;
  if (act === 'seltab') return t.dataset.key ?? selected;
  if (act === 'searchmode') {
    g.rt.searchMode = g.rt.searchMode === 'quick' ? 'careful' : 'quick';
    return selected;
  }
  if (act === 'takeoff') {
    takeOff(g, t.dataset.slot as never);
    return selected;
  }
  if (act === 'takeall') {
    const from = parseKey(t.dataset.from!)!;
    const items = listItems(s, from).slice();
    let failed = 0;
    for (const it of items) {
      let err = transfer(s, g.rt, from, { kind: 'player' }, it.uid);
      if (err && s.player.bag) err = transfer(s, g.rt, from, { kind: 'bag' }, it.uid);
      if (err) failed++;
    }
    if (failed) log(s, `You couldn't carry ${failed} item${failed > 1 ? 's' : ''}.`, 'warn');
    return selected;
  }
  const uid = Number(t.dataset.uid);
  const fromKey = t.dataset.from!;
  const from = parseKey(fromKey);
  if (!from) return selected;
  const it = listItems(s, from).find((i) => i.uid === uid);
  if (!it) return selected;
  if (act === 'menu' || ev.button === 2) {
    showMenu(itemActions(g, it, from), ev.clientX, ev.clientY, itemName(it));
    return selected;
  }
  if (act === 'primary') {
    const mine = from.kind === 'player' || from.kind === 'bag';
    if (mine) {
      if (selected) {
        const to = parseKey(selected)!;
        const err = transfer(s, g.rt, from, to, uid);
        if (err) log(s, err, 'warn');
      } else showMenu(itemActions(g, it, from), ev.clientX, ev.clientY, itemName(it));
    } else {
      let err = transfer(s, g.rt, from, ev.shiftKey && s.player.bag ? { kind: 'bag' } : { kind: 'player' }, uid);
      if (err && s.player.bag && !ev.shiftKey) err = transfer(s, g.rt, from, { kind: 'bag' }, uid);
      if (err) log(s, err, 'warn');
    }
  }
  return selected;
}

// ------------------------------------------------------------------ health

const BODY_SHAPES: [BodyPart, string][] = [
  ['head', '<ellipse cx="85" cy="28" rx="18" ry="21"/>'],
  ['neck', '<rect x="77" y="49" width="16" height="12" rx="3"/>'],
  ['torso', '<rect x="58" y="62" width="54" height="92" rx="10"/>'],
  ['lArm', '<rect x="36" y="66" width="18" height="78" rx="8"/>'],
  ['rArm', '<rect x="116" y="66" width="18" height="78" rx="8"/>'],
  ['lHand', '<ellipse cx="45" cy="158" rx="10" ry="12"/>'],
  ['rHand', '<ellipse cx="125" cy="158" rx="10" ry="12"/>'],
  ['lLeg', '<rect x="61" y="158" width="22" height="120" rx="9"/>'],
  ['rLeg', '<rect x="87" y="158" width="22" height="120" rx="9"/>'],
  ['lFoot', '<ellipse cx="70" cy="290" rx="14" ry="9"/>'],
  ['rFoot', '<ellipse cx="100" cy="290" rx="14" ry="9"/>'],
];

function partColor(g: Game, part: BodyPart): string {
  const injs = g.s.player.body.injuries.filter((i) => i.part === part);
  if (!injs.length) return '#3a3e40';
  let worst = 0;
  for (const i of injs) {
    let v = i.severity * (1 - i.heal);
    if (effectiveBleed(i) > 0.004) v += 0.4;
    if (i.infection > 0.3) v += 0.3;
    if (i.type === 'bite') v += 0.5;
    worst = Math.max(worst, v);
  }
  if (worst > 0.8) return '#a33a2e';
  if (worst > 0.45) return '#b0663a';
  return '#9a8a4a';
}

export function renderHealth(g: Game): string {
  const s = g.s;
  const p = s.player;
  const b = p.body;
  const n = p.needs;
  const svg = `<svg viewBox="0 0 170 305">${BODY_SHAPES.map(([part, shape]) => shape.replace('/>', ` class="part" style="fill:${partColor(g, part)}"><title>${PART_NAMES[part]}</title></${shape.split(' ')[0].slice(1)}>`)).join('')}</svg>`;
  const stats = `<div class="stats">
    <span class="k">Health</span><span class="${b.health < 40 ? 'bad' : b.health < 70 ? 'warn' : ''}">${Math.round(b.health)}%</span>
    <span class="k">Blood</span><span class="${b.blood < 0.7 ? 'bad' : b.blood < 0.9 ? 'warn' : ''}">${Math.round(b.blood * 100)}%</span>
    <span class="k">Pain</span><span>${Math.round(pain(p) * 100)}%${n.painkiller > 0 ? ' (painkillers)' : ''}</span>
    <span class="k">Body temp</span><span class="${n.temp < 36 || n.temp > 38 ? 'warn' : ''}">${n.temp.toFixed(1)}°C</span>
    <span class="k">Stamina</span><span>${Math.round(n.endurance * 100)}%</span>
    <span class="k">Fatigue</span><span>${Math.round(n.fatigue * 100)}%</span>
    <span class="k">Hunger / thirst</span><span>${Math.round(n.hunger * 100)}% / ${Math.round(n.thirst * 100)}%</span>
    ${n.sick > 0.1 ? `<span class="k">Sickness</span><span class="warn">${Math.round(n.sick * 100)}%${n.sickCause ? ` (${esc(n.sickCause)})` : ''}</span>` : ''}
    ${n.antibiotic > 0 ? '<span class="k">Antibiotics</span><span class="good">active</span>' : ''}
    ${b.feverLevel > 0 ? `<span class="k">Fever</span><span class="bad">${Math.round(b.feverLevel * 100)}% — the bite is killing you</span>` : ''}
  </div>`;
  const injs = b.injuries
    .slice()
    .sort((a, c) => effectiveBleed(c) - effectiveBleed(a))
    .map((inj) => {
      const tr = treatments(g, inj);
      const buttons = tr.map((t, k) => `<button data-act="treat" data-inj="${inj.id}" data-k="${k}" ${t.enabled ? '' : 'disabled'} title="${esc(t.reason ?? '')}">${esc(t.label)}</button>`).join('');
      return `<div class="inj"><div class="t ${effectiveBleed(inj) > 0.004 ? 'bad' : ''}">${INJURY_NAMES[inj.type]} — ${PART_NAMES[inj.part]}</div><div class="d">${esc(describeInjury(inj))}${inj.cause ? ` · ${esc(inj.cause)}` : ''}</div><div class="acts">${buttons}</div></div>`;
    })
    .join('');
  return `<div class="health"><div class="body">${svg}</div><div>${stats}<h3 style="margin:4px 0 8px;color:var(--accent)">Injuries</h3>${injs || '<div class="empty-note">No injuries. Keep it that way.</div>'}
  <p class="dim" style="font-size:11px">Treatment takes time. Being grabbed or attacked interrupts it. Disinfect open wounds early — infection sets in within a few hours. Bites carry the fever; there is no cure.</p></div></div>`;
}

export function handleHealthClick(g: Game, t: HTMLElement): void {
  if (t.dataset.act !== 'treat') return;
  const inj = g.s.player.body.injuries.find((i) => i.id === Number(t.dataset.inj));
  if (!inj) return;
  const tr = treatments(g, inj)[Number(t.dataset.k)];
  if (tr?.enabled) tr.run();
}

// ------------------------------------------------------------------ skills

export function renderSkills(g: Game): string {
  const p = g.s.player;
  const rows = SKILLS.map((sk) => {
    const xp = p.xp[sk] ?? 0;
    const l = levelFromXp(xp);
    const prog = levelProgress(xp);
    const pips = Array.from({ length: 10 }, (_, i) => (i < l ? '<i class="on"></i>' : i === l ? `<i class="part" style="--p:${Math.round(prog * 100)}%"></i>` : '<i></i>')).join('');
    const boost = p.bookBoost[sk] !== undefined && l < (p.bookBoost[sk] ?? 0) ? `<span class="boost">×3 (book)</span>` : '';
    return `<div class="skill"><span>${SKILL_NAMES[sk]}</span><span class="pips">${pips}</span><span>${l} ${boost}</span></div>`;
  }).join('');
  const occ = OCCUPATIONS.find((o) => o.id === p.occupation);
  const traits = p.traits.map((id) => TRAITS.find((t) => t.id === id)).filter(Boolean).map((t) => `<span title="${esc(t!.desc)}">${esc(t!.name)}</span>`).join(', ');
  const mags = p.magazines.length ? p.magazines.map((m) => ({ generator: 'Generator wiring', hotwire: 'Hotwiring', traps: 'Tin-can alarms' })[m] ?? m).join(', ') : 'none';
  return `<h3 style="color:var(--accent)">${esc(p.name)}</h3><p class="dim" style="margin:2px 0 10px">${esc(occ?.name ?? '')}${traits ? ' · ' + traits : ''}</p>${rows}
  <p class="dim" style="margin-top:12px">Known techniques: ${esc(mags)}</p>
  <p class="dim" style="font-size:11px">Skills improve by doing: fight to train weapons, build to train carpentry, treat wounds to train first aid. Skill books triple learning speed. No level makes you safe.</p>`;
}

// ------------------------------------------------------------------ craft & build

export function renderCraft(g: Game): string {
  // what you can make right now first, then everything else in the usual order
  const rec = RECIPES.map((r) => ({ r, why: recipeStatus(g, r) })).sort((a, b) => (a.why ? 1 : 0) - (b.why ? 1 : 0)).map(({ r, why }) => {
    return `<div class="recipe"><div><div>${esc(r.name)}</div><div class="d">${r.needs.map(([id, q]) => `${q}× ${def(id).name}`).join(', ')}${r.tools?.length ? ' · tools: ' + r.tools.map((t) => t.replace('#', '')).join(', ') : ''}</div><div class="d">${esc(r.desc)}</div>${why ? `<div class="why">${esc(why)}</div>` : ''}</div><button data-act="craft" data-id="${r.id}" ${why ? 'disabled' : ''}>Make</button></div>`;
  }).join('');
  const b = BUILDS.map((r) => {
    const why = buildStatus(g, r);
    return `<div class="recipe"><div><div>${esc(r.name)}</div><div class="d">${r.needs.map(([id, q]) => `${q}× ${def(id).name}`).join(', ')}${r.tools.length ? ' · ' + r.tools.join(', ') : ''}</div><div class="d">${esc(r.desc)}</div>${why ? `<div class="why">${esc(why)}</div>` : ''}</div><button data-act="build" data-id="${r.id}" ${why ? 'disabled' : ''}>Place</button></div>`;
  }).join('');
  return `<div class="cols"><div class="col"><h3>Crafting</h3>${rec}</div><div class="col"><h3>Building</h3>${b}<p class="dim" style="font-size:11px">Barricade doors and windows from their right-click menu (hammer, planks, nails). Hammering is loud — heard for more than a block. Build campfires, dig for worms and fish from the ground menu; cook stews and smoke jerky from a lit fire's menu.</p></div></div>`;
}

export function handleCraftClick(g: Game, t: HTMLElement, close: () => void): void {
  if (t.dataset.act === 'craft') {
    const r = RECIPES.find((x) => x.id === t.dataset.id);
    if (r) craft(g, r);
  } else if (t.dataset.act === 'build') {
    g.rt.mode = { kind: 'build', recipe: t.dataset.id! };
    close();
  }
}

// ------------------------------------------------------------------ map

export function drawMap(g: Game, canvas: HTMLCanvasElement): void {
  const s = g.s;
  const w = s.world;
  const sc = 2;
  canvas.width = w.w * sc;
  canvas.height = w.h * sc;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w.w, w.h);
  const d = img.data;
  const known = s.hasMap;
  for (let i = 0; i < w.w * w.h; i++) {
    const ex = w.explored[i] === 1;
    const gr = w.ground[i];
    const st = w.struct[i];
    let c: [number, number, number] = [32, 40, 28];
    if (gr === G.Road || gr === G.Bridge) c = [70, 70, 72];
    else if (gr === G.Sidewalk) c = [110, 108, 100];
    else if (gr === G.Parking) c = [80, 80, 80];
    else if (gr === G.DirtRoad) c = [95, 80, 60];
    else if (gr === G.Water) c = [40, 70, 90];
    else if (gr === G.Forest) c = [26, 40, 24];
    else if (gr === G.Furrow || gr === G.Field) c = [80, 62, 42];
    else if (gr === G.Burnt) c = [20, 18, 16];
    if (w.room[i] >= 0) c = [150, 140, 120];
    if (st === S.Wall || st === S.BuiltWall) c = [200, 190, 170];
    if (st === S.Door) c = [180, 120, 60];
    if (st === S.Window) c = [120, 160, 180];
    if (st === S.Tree) c = [22, 34, 20];
    const structural = gr === G.Road || gr === G.Sidewalk || gr === G.Water || w.bld[i] >= 0 || gr === G.DirtRoad || gr === G.Bridge;
    const k = ex ? 1 : known && structural ? 0.45 : 0;
    d[i * 4] = c[0] * k;
    d[i * 4 + 1] = c[1] * k;
    d[i * 4 + 2] = c[2] * k;
    d[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = w.w;
  tmp.height = w.h;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, w.w * sc, w.h * sc);
  ctx.font = '10px IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  const campSeen = w.buildings.some((b) => b.kind === 'military' && (b.seen || b.visited));
  // labels: one per name, nudged apart so neighbours don't print over each other
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const names = new Set<string>();
  for (const lm of w.landmarks) {
    const b = w.buildings[lm.bld];
    const found = b.kind === 'military' ? campSeen : b.seen || b.visited;
    if ((!found && !known) || names.has(lm.name)) continue;
    const tw = ctx.measureText(lm.name).width;
    let pos: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (const dy of [0, 12, -12, 24, -24, 36]) {
      const r = { x0: lm.x * sc - tw / 2 - 2, y0: lm.y * sc - 8 + dy, x1: lm.x * sc + tw / 2 + 2, y1: lm.y * sc + 3 + dy };
      if (!placed.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1)) {
        pos = r;
        break;
      }
    }
    if (!pos) continue;
    names.add(lm.name);
    placed.push(pos);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(pos.x0, pos.y0, pos.x1 - pos.x0, pos.y1 - pos.y0);
    ctx.fillStyle = b.kind === 'house' ? '#bfb6a0' : '#e8dcc0';
    ctx.fillText(lm.name, lm.x * sc, pos.y1 - 3);
  }
  for (const v of s.vehicles) {
    if (!w.explored[Math.floor(v.y) * w.w + Math.floor(v.x)]) continue;
    ctx.fillStyle = '#8aa0b8';
    ctx.fillRect(v.x * sc - 2, v.y * sc - 2, 4, 4);
  }
  for (const m of s.mapMarkers) {
    ctx.fillStyle = '#d0a55a';
    ctx.beginPath();
    ctx.arc(m.x * sc, m.y * sc, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(m.label, m.x * sc, m.y * sc - 7);
  }
  const p = s.player;
  const px = (p.inVehicle >= 0 ? s.vehicles[p.inVehicle].x : p.x) * sc;
  const py = (p.inVehicle >= 0 ? s.vehicles[p.inVehicle].y : p.y) * sc;
  ctx.strokeStyle = '#ff5a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ff5a3a';
  ctx.beginPath();
  ctx.arc(px, py, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // compass
  ctx.fillStyle = '#d0a55a';
  ctx.font = '14px Oswald, sans-serif';
  ctx.fillText('N ↑', w.w * sc - 24, 20);
}

// ------------------------------------------------------------------ journal

export function renderJournal(g: Game): string {
  const s = g.s;
  const p = s.player;
  const notes = s.notes.map((id) => `<div class="note">${esc(NOTES[id] ?? id)}</div>`).join('') || '<div class="empty-note">Nothing learned yet. You will.</div>';
  const chron = s.chronicle.filter((c) => c.t >= p.startT).slice(-40).reverse().map((c) => `<div class="chron"><span class="t">Day ${dayNumber(c.t)} ${clockString(c.t)}</span>${esc(c.text)}</div>`).join('') || '<div class="empty-note">Quiet so far.</div>';
  const st = s.stats;
  const grave = s.graveyard.length
    ? `<h3 style="margin-top:14px;color:var(--accent)">Those who came before</h3><table class="records">${s.graveyard.map((r) => `<tr><td>${esc(r.name)}</td><td class="dim">${r.days.toFixed(1)} days</td><td class="dim">${esc(r.cause)}</td></tr>`).join('')}</table>`
    : '';
  return `<div class="cols"><div class="col"><h3>Field notes</h3>${notes}</div><div class="col"><h3>What happened <small>survived ${formatDuration(s.time - p.startT)}</small></h3>${chron}
  <h3 style="margin-top:14px">Tally</h3><div class="stats"><span class="k">Zombies killed</span><span>${p.kills}</span><span class="k">Distance travelled</span><span>${(st.distance / 1000).toFixed(2)} km</span><span class="k">Items looted</span><span>${st.itemsLooted}</span><span class="k">Hits taken</span><span>${st.hitsTaken}</span><span class="k">Noises made</span><span>${st.noisesMade}</span></div>${grave}</div></div>`;
}

export { furnDist };
