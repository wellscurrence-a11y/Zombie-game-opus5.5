import type { Game } from '../game';
import { clockString, dateString, dayNumber, formatDuration } from '../core/time';
import { conditions, type Condition } from '../sim/conditions';
import { def, itemName } from '../sim/items';
import { NOTES } from '../sim/log';
import { capacity, carriedWeight, heldItem } from '../sim/stats';
import { VEH } from '../sim/vehicleSpecs';
import { esc } from './dom';
import { FURN } from '../world/furniture';
import { WIN_BROKEN, WIN_CLEARED, WIN_CLOSED, WIN_OPEN, S } from '../world/world';
import { doorName } from '../sim/structures';
import { exitVehicle, startEngine, vehicleName } from '../sim/vehicles';
import { stompTarget } from '../sim/combat';

export class Hud {
  root: HTMLElement;
  tl = document.createElement('div');
  tr = document.createElement('div');
  bl = document.createElement('div');
  bc = document.createElement('div');
  br = document.createElement('div');
  action = document.createElement('div');
  tip = document.createElement('div');
  heard = document.createElement('div');
  vignette = document.createElement('div');
  hurt = document.createElement('div');
  flash = document.createElement('div');
  fog = document.createElement('div');
  sleep = document.createElement('div');
  toast = document.createElement('div');
  speedo = document.createElement('div');
  modehint = document.createElement('div');
  stompHint = document.createElement('div');
  condTip = document.createElement('div');
  private condById = new Map<string, Condition>();
  private hoverCond: string | null = null;
  vitals = document.createElement('div');
  conds = document.createElement('div');
  private g: Game;
  private slow = 0;
  private noteCount = 0;
  private toastT = 0;

  constructor(root: HTMLElement, g: Game, onPanel: (tab: string) => void) {
    this.root = root;
    this.g = g;
    this.tl.className = 'hud-tl';
    this.vitals.className = 'vitals';
    this.conds.className = 'conds';
    this.tl.append(this.vitals, this.conds);
    this.tr.className = 'hud-tr';
    this.bl.className = 'hud-bl';
    this.bc.className = 'hud-bc';
    this.br.className = 'hud-br';
    this.action.className = 'actionbar';
    this.tip.className = 'tooltip';
    this.vignette.className = 'overlay vignette';
    this.hurt.className = 'overlay hurt';
    this.flash.className = 'overlay flashw';
    this.fog.className = 'overlay';
    this.fog.style.background = 'radial-gradient(ellipse at center, rgba(170,178,182,0.05) 20%, rgba(170,178,182,0.55) 85%)';
    this.sleep.className = 'overlay sleep';
    this.toast.className = 'toast';
    this.speedo.className = 'speedo';
    this.modehint.className = 'modehint';
    this.condTip.className = 'condtip';
    this.condTip.style.display = 'none';
    root.appendChild(this.condTip);
    // hover a condition badge to see exactly what it's doing to you
    this.conds.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest('.cond') as HTMLElement | null;
      if (!el?.dataset.id) return;
      this.hoverCond = el.dataset.id;
      this.showCondTip();
    });
    this.conds.addEventListener('mouseleave', () => {
      this.hoverCond = null;
      this.condTip.style.display = 'none';
    });
    this.stompHint.className = 'stomphint';
    this.stompHint.innerHTML = 'Stomp! <span class="k">Space</span> or <span class="k">click</span>';
    this.stompHint.style.display = 'none';
    root.appendChild(this.stompHint);
    this.heard.className = 'overlay';
    for (const e of [this.fog, this.vignette, this.hurt, this.flash, this.heard, this.tl, this.tr, this.bl, this.bc, this.br, this.action, this.tip, this.speedo, this.modehint, this.toast, this.sleep]) root.appendChild(e);
    this.sleep.style.display = 'none';
    this.toast.style.display = 'none';
    this.action.style.display = 'none';
    this.tip.style.display = 'none';
    this.speedo.style.display = 'none';
    this.modehint.style.display = 'none';
    const btns: [string, string, string][] = [['inventory', 'Inventory', 'Tab'], ['health', 'Health', 'H'], ['skills', 'Skills', 'K'], ['craft', 'Craft', 'B'], ['map', 'Map', 'M'], ['journal', 'Journal', 'J']];
    this.br.innerHTML = btns.map(([id, n, k]) => `<button data-panel="${id}">${n}<span class="k">${k}</span></button>`).join('');
    this.br.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.panel) onPanel(b.dataset.panel);
    });
    this.sleep.innerHTML = '<h2>Sleeping...</h2><div class="dim" id="sleepinfo"></div><button class="interactive" id="wakebtn">Wake up</button>';
    this.sleep.querySelector('#wakebtn')!.addEventListener('click', () => g.wake('You force yourself awake.'));
    this.tr.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b?.dataset.speed) return;
      const v = Number(b.dataset.speed);
      if (v === 0) g.rt.paused = !g.rt.paused;
      else if (v > 1 && (g.rt.threat > 0 || g.rt.closestZombie < 10)) {
        g.rt.speed = 1;
      } else {
        g.rt.paused = false;
        g.rt.speed = v;
      }
    });
    this.speedo.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.a === 'exit') exitVehicle(g);
      else if (b?.dataset.a === 'engine') startEngine(g);
    });
    this.bc.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
      if (b?.dataset.k) g.quickSlot(Number(b.dataset.k));
    });
  }

  update(dt: number): void {
    const g = this.g;
    const s = g.s;
    const rt = g.rt;
    const p = s.player;
    this.slow -= dt;
    // --- fast: overlays & positioned elements
    const pn = p.needs.calm > 0 ? p.needs.panic * 0.4 : p.needs.panic;
    setOverlay(this.vignette, Math.min(1, 0.25 + pn * 0.9 + (1 - p.body.blood) * 0.8 + (p.needs.endurance < 0.2 ? 0.25 : 0)));
    setOverlay(this.hurt, Math.min(1, rt.hurtFlash * 0.9 + (p.grabbedBy.length ? 0.35 + Math.sin(rt.realTime * 12) * 0.15 : 0)));
    setOverlay(this.flash, rt.flash);
    setOverlay(this.fog, Math.min(1, s.weather.fog * 1.1) * (0.35 + 0.65 * Math.max(0.15, 1 - (s.time % 24 < 6 || s.time % 24 > 20 ? 0.8 : 0))));
    setStyle(this.sleep, 'display', p.sleeping ? 'flex' : 'none');
    if (p.sleeping) {
      const info = this.sleep.querySelector('#sleepinfo')!;
      info.textContent = `${hasWatch(g) ? clockString(s.time) : clockString(s.time, false)} — fatigue ${Math.round(p.needs.fatigue * 100)}%`;
    }
    // action bar
    const a = rt.action;
    const actionText = a && !p.sleeping ? `${esc(a.label)}<div class="bar"><i style="width:${(g.actionProgress() * 100).toFixed(0)}%"></i></div>`
      : p.reloadT > 0 ? 'Reloading...' : p.climbT > 0 ? (p.climbKind === 'window' ? 'Climbing through...' : 'Climbing...') : '';
    if (actionText) {
      const { sx, sy } = g.renderer.project(p.x, 2.3, p.y);
      setStyle(this.action, 'display', 'block');
      setStyle(this.action, 'left', `${Math.round(sx)}px`);
      setStyle(this.action, 'top', `${Math.round(sy)}px`);
      setHTML(this.action, actionText);
    } else setStyle(this.action, 'display', 'none');
    // a zombie on the ground within reach: say how to finish it
    const st = !p.dead && !p.sleeping && p.inVehicle < 0 && !g.uiBlocking ? stompTarget(s, rt) : null;
    if (st) {
      const { sx, sy } = g.renderer.project(st.x, 0.5, st.y);
      setStyle(this.stompHint, 'display', 'block');
      setStyle(this.stompHint, 'left', `${Math.round(sx)}px`);
      setStyle(this.stompHint, 'top', `${Math.round(sy)}px`);
    } else setStyle(this.stompHint, 'display', 'none');
    // tooltip
    this.updateTooltip();
    // heard sounds
    this.updateHeard();
    // speedometer
    if (p.inVehicle >= 0) {
      const v = s.vehicles[p.inVehicle];
      const broken = v.windows.filter((x) => x >= 2).length;
      setStyle(this.speedo, 'display', 'flex');
      setHTML(this.speedo, `<span class="big">${Math.round(Math.abs(v.speed) * 3.6)} km/h</span><span>${v.engineOn ? '<span class="good">Engine on</span>' : '<span class="dim">Engine off</span>'}<br><span class="dim">Fuel ${Math.round((v.fuel / v.fuelCap) * 100)}% · Battery ${Math.round(v.battery * 100)}%</span></span><span class="dim">Engine ${Math.round(v.engine)}%${broken ? ` · <span class="bad">${broken} window${broken > 1 ? 's' : ''} broken</span>` : ''}<br>${v.lights ? 'Lights on (F)' : 'Lights off (F)'} · G horn</span><span class="btns"><button data-a="engine">${v.engineOn ? 'Stop engine' : 'Start engine'} <span class="k">R</span></button><button data-a="exit" class="${rt.exitPending ? 'on' : ''}">${rt.exitPending ? 'Stopping…' : 'Get out'} <span class="k">E</span></button></span>`);
    } else setStyle(this.speedo, 'display', 'none');
    const m = rt.mode;
    if (m || p.carrying >= 0) {
      setStyle(this.modehint, 'display', 'block');
      this.modehint.textContent = p.carrying >= 0 ? `Carrying ${FURN[s.world.furniture[p.carrying].kind].name.toLowerCase()} — left-click a nearby spot to set it down.` : m?.kind === 'throw' ? 'Throw: left-click a target. Esc cancels.' : m?.kind === 'place' ? 'Place: left-click a nearby spot. Esc cancels.' : 'Build: left-click a nearby empty tile. Esc cancels.';
    } else setStyle(this.modehint, 'display', 'none');
    // toast for new field notes
    if (s.notes.length > this.noteCount) {
      const id = s.notes[s.notes.length - 1];
      this.noteCount = s.notes.length;
      if (this.noteCount > 1 || id !== 'hearing') {
        this.toast.innerHTML = `<div class="h">FIELD NOTE</div>${esc(NOTES[id] ?? '')}`;
        this.toast.style.display = 'block';
        this.toastT = 7;
      }
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toast.style.display = 'none';
    }
    if (this.slow > 0) return;
    this.slow = 0.12;
    // --- slow: text panels
    setHTML(this.vitals, vitalsHtml(g));
    const conds = conditions(s, rt);
    this.condById = new Map(conds.map((c) => [c.id, c]));
    setHTML(this.conds, conds
      .map((c) => `<div class="cond ${c.tone}" data-id="${c.id}"><span>${esc(c.label)}</span>${c.level > 1 ? `<span class="dots">${'●'.repeat(Math.min(4, c.level))}</span>` : ''}</div>`)
      .join(''));
    if (this.hoverCond) this.showCondTip();
    const watch = hasWatch(g);
    const wx = s.weather;
    const feel = wx.temp < 0 ? 'Freezing' : wx.temp < 7 ? 'Cold' : wx.temp < 13 ? 'Cool' : wx.temp < 22 ? 'Mild' : wx.temp < 28 ? 'Warm' : 'Hot';
    const wxName = { clear: 'Clear', cloudy: 'Overcast', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow' }[wx.kind];
    const survived = s.time - p.startT;
    const sp = rt.speed;
    setHTML(this.tr, `<div class="clockbox"><div class="time">${watch ? clockString(s.time) : clockString(s.time, false)}</div><div class="date">Day ${dayNumber(s.time)} · ${dateString(s.time)}${watch ? '' : ' · no watch'}</div><div class="wx">${wxName} · ${feel} ${Math.round(wx.temp)}°C</div><div class="surv">Survived ${formatDuration(survived)}</div></div>
      <div class="speed interactive"><button data-speed="0" class="${rt.paused ? 'on' : ''}">❚❚</button><button data-speed="1" class="${!rt.paused && sp === 1 ? 'on' : ''}">1×</button><button data-speed="3" class="${sp === 3 ? 'on' : ''}">3×</button><button data-speed="8" class="${sp === 8 ? 'on' : ''}">8×</button></div>`);
    // log
    const recent = s.log.slice(-8);
    {
      setHTML(this.bl, recent
        .map((l, i) => {
          const age = s.time - l.t;
          const op = Math.max(0.25, 1 - age / 1.2) * (0.55 + (i / recent.length) * 0.45);
          return `<div class="logline ${l.kind}" style="opacity:${(Math.round(op * 10) / 10).toFixed(1)}"><span class="t">${watch ? clockString(l.t) : ''}</span>${esc(l.text)}</div>`;
        })
        .join(''));
    }
    // hotbar
    const held = heldItem(p);
    const quick = g.quickItems();
    const slots = [];
    for (let k = 0; k < 6; k++) {
      const uid = quick[k];
      const it = uid ? p.inventory.find((i) => i.uid === uid) : null;
      if (!it) {
        slots.push(`<div class="slot empty"><span class="k">${k + 1}</span></div>`);
        continue;
      }
      const d = def(it.id);
      const extra = d.firearm ? ` ${it.ammo ?? 0}/${d.firearm.mag}` : '';
      slots.push(`<div class="slot interactive ${held?.uid === it.uid ? 'held' : ''}" data-k="${k}"><span class="k">${k + 1}</span><span class="n">${esc(d.name)}${extra}</span><span class="c" style="width:${Math.round(it.cond * 100)}%;background:${it.cond < 0.25 ? 'var(--danger)' : it.cond < 0.5 ? 'var(--warn)' : 'var(--good)'}"></span></div>`);
    }
    const wt = carriedWeight(p);
    const cap = capacity(p);
    setHTML(this.bc, `<div class="hotbar" style="${p.inVehicle >= 0 ? 'visibility:hidden' : ''}">${slots.join('')}</div><div class="bars"><span class="${wt > cap ? 'warn' : 'dim'}">${wt.toFixed(1)} / ${cap.toFixed(0)} kg</span><span class="dim">${p.stance === 'crouch' ? 'Crouched' : p.running ? 'Running' : 'Walking'}${held ? ` · ${esc(itemName(held))}` : ' · Bare hands'}</span></div>`);
  }

  /** The effect panel beside a hovered condition badge (numbers refresh while you watch). */
  private showCondTip(): void {
    const c = this.hoverCond ? this.condById.get(this.hoverCond) : undefined;
    const el = this.hoverCond ? (this.conds.querySelector(`.cond[data-id="${this.hoverCond}"]`) as HTMLElement | null) : null;
    if (!c || !el) {
      this.hoverCond = null;
      this.condTip.style.display = 'none';
      return;
    }
    const strength = c.effects.some((x) => x.includes('Physical strength'));
    setHTML(this.condTip, `<div class="ct-h ${c.tone}">${esc(c.label)}</div><ul>${c.effects.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="ct-do">${esc(c.tip)}</div>${strength ? '<div class="ct-note">Physical strength sets how hard you hit and shove, and part of how fast you move.</div>' : ''}`);
    const r = el.getBoundingClientRect();
    this.condTip.style.display = 'block';
    this.condTip.style.left = `${Math.round(r.right + 8)}px`;
    this.condTip.style.top = `${Math.round(Math.min(r.top, window.innerHeight - this.condTip.offsetHeight - 8))}px`;
  }

  private updateTooltip(): void {
    const g = this.g;
    const s = g.s;
    const h = g.hover;
    const inp = g.input;
    if (!h || inp.overUi || h.kind === 'ground' || g.uiBlocking || s.player.dead || s.player.sleeping) {
      setStyle(this.tip, 'display', 'none');
      return;
    }
    const w = s.world;
    let text = '';
    switch (h.kind) {
      case 'door': {
        const d = w.doors[h.id];
        const st = d.broken ? 'broken' : d.open ? 'open' : d.lockKnown ? (d.locked ? 'locked' : 'unlocked') : 'closed — lock unknown';
        text = `<b>${esc(doorName(d)[0].toUpperCase() + doorName(d).slice(1))}</b>\n${st}${d.planks ? ` · ${d.planks} planks` : ''}`;
        const b = w.buildings[d.bld];
        if (b?.alarmPanel && b.alarm && d.ext && !s.util.powerOff && Math.hypot(d.x - s.player.x, d.y - s.player.y) < 6) text += '\nA small alarm panel by the door — its light is on.';
        break;
      }
      case 'window': {
        const win = w.windows[h.id];
        const st = win.state === WIN_CLOSED ? 'closed' : win.state === WIN_OPEN ? 'open' : win.state === WIN_BROKEN ? 'broken — jagged glass in the frame' : win.state === WIN_CLEARED ? 'broken, frame cleared' : '';
        text = `<b>${win.big ? 'Storefront window' : 'Window'}</b>\n${st}${win.planks ? ` · ${win.planks} planks` : ''}${win.curtainsClosed || win.sheet ? ' · covered' : ''}`;
        break;
      }
      case 'furn': {
        const f = w.furniture[h.id];
        const fd = FURN[f.kind];
        text = `<b>${esc(fd.name)}</b>`;
        if (f.containerId >= 0) text += `\n${w.containers[f.containerId].searched ? 'searched' : 'not searched'}`;
        if (f.kind === 'generator') text += `\n${f.on ? 'running' : 'off'} · fuel ${(f.fuel ?? 0).toFixed(1)} L`;
        if (f.kind === 'rainbarrel') text += `\n${(f.water ?? 0).toFixed(1)} L of rainwater`;
        if ((f.kind === 'stove' || f.kind === 'campfire') && f.on) text += '\nlit';
        break;
      }
      case 'vehicle': {
        const v = s.vehicles[h.id];
        text = `<b>${esc(vehicleName(v)[0].toUpperCase() + vehicleName(v).slice(1))}</b>${v.wrecked ? '\nwrecked' : ''}${v.windows.some((x) => x >= 2) ? '\nbroken windows' : ''}`;
        void VEH;
        break;
      }
      case 'zombie': {
        const z = s.zombies.find((zz) => zz.id === h.id);
        if (!z) return;
        const st = z.state === 'down' ? 'on the ground' : z.state === 'chase' || z.state === 'attack' ? 'coming for you' : z.state === 'bang' ? 'pounding on something' : z.state === 'investigate' ? 'drawn by something' : z.state === 'eat' ? 'feeding' : 'unaware';
        text = `<b>${z.name ? esc(z.name) : 'Zombie'}</b>\n${st}${z.crawler ? ' · crawler' : ''}`;
        break;
      }
      case 'corpse': {
        const c = s.corpses.find((k) => k.id === h.id);
        text = `<b>${c?.name ? esc(c.name) : 'Corpse'}</b>\n${c?.items ? 'searched' : 'not searched'}`;
        break;
      }
      case 'fence':
        text = w.struct[h.tile] === S.FenceHigh ? '<b>Tall fence</b>\nClimb over (E). Tiring, and a bad fall hurts.' : '<b>Low fence</b>\nVault over (E).';
        break;
      case 'tree':
        text = '<b>Tree</b>';
        break;
      case 'wall':
        text = w.struct[h.tile] === S.BuiltWall ? `<b>Your wall</b>\n${Math.round(w.builtWalls[h.tile]?.hp ?? 0)} HP` : '';
        break;
      default:
        break;
    }
    if (!text) {
      setStyle(this.tip, 'display', 'none');
      return;
    }
    setStyle(this.tip, 'display', 'block');
    setStyle(this.tip, 'left', `${Math.round(inp.mouseX)}px`);
    setStyle(this.tip, 'top', `${Math.round(inp.mouseY)}px`);
    setHTML(this.tip, text + '<br><span class="faint">Right-click for options</span>');
  }

  private updateHeard(): void {
    const g = this.g;
    const rt = g.rt;
    const s = g.s;
    const now = rt.realTime;
    const items = rt.heard.filter((h) => now - h.t < 4.5).slice(-6);
    const W = window.innerWidth;
    const H = window.innerHeight;
    let html = '';
    for (const h of items) {
      let { sx, sy } = g.renderer.project(h.x, 1, h.y);
      const off = sx < 40 || sy < 40 || sx > W - 40 || sy > H - 40;
      if (off) {
        const cx = W / 2;
        const cy = H / 2;
        const dx = sx - cx;
        const dy = sy - cy;
        const k = Math.min((W / 2 - 70) / Math.abs(dx || 1), (H / 2 - 50) / Math.abs(dy || 1));
        sx = cx + dx * k;
        sy = cy + dy * k;
      }
      const op = Math.max(0, 1 - (now - h.t) / 4.5);
      const arrow = off ? arrowFor(sx - W / 2, sy - H / 2) + ' ' : '';
      html += `<div class="heard" style="left:${Math.round(sx)}px;top:${Math.round(sy)}px;opacity:${op.toFixed(1)}">${arrow}${esc(h.label)}</div>`;
    }
    setHTML(this.heard, html);
    void s;
  }
}

function arrowFor(dx: number, dy: number): string {
  const a = Math.atan2(dy, dx);
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  return arrows[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
}

export function hasWatch(g: Game): boolean {
  const p = g.s.player;
  return p.inventory.some((i) => i.id === 'watch') || !!p.bag?.contents?.some((i) => i.id === 'watch');
}

// Writing to the DOM is costly on low-end machines; only touch it when something changed.
const htmlCache = new WeakMap<HTMLElement, string>();
function setHTML(el: HTMLElement, html: string): void {
  if (htmlCache.get(el) === html) return;
  htmlCache.set(el, html);
  el.innerHTML = html;
}
const styleCache = new WeakMap<HTMLElement, Record<string, string>>();
function setStyle(el: HTMLElement, prop: 'opacity' | 'display' | 'left' | 'top', v: string): void {
  let c = styleCache.get(el);
  if (!c) styleCache.set(el, (c = {}));
  if (c[prop] === v) return;
  c[prop] = v;
  el.style[prop] = v;
}
/** Full-screen overlays are hidden outright when invisible, so the compositor can skip them. */
function setOverlay(el: HTMLElement, opacity: number): void {
  const o = Math.round(opacity * 50) / 50;
  setStyle(el, 'display', o <= 0 ? 'none' : 'block');
  if (o > 0) setStyle(el, 'opacity', String(o));
}

function tone(frac: number): string {
  return frac > 0.5 ? 'good' : frac > 0.25 ? 'warn' : 'bad';
}

/** Always-on survivor vitals: health, food, water, rest, stamina and body temperature. */
export function vitalsHtml(g: Game): string {
  const p = g.s.player;
  const n = p.needs;
  const row = (label: string, frac: number, text: string, cls: string, tip: string): string =>
    `<div class="vrow" title="${tip}"><span class="vl">${label}</span><div class="vbar"><i class="${cls}" style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></div><span class="vv ${cls}">${text}</span></div>`;
  const pct = (f: number): string => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  const hp = Math.max(0, p.body.health) / 100;
  const food = 1 - n.hunger;
  const water = 1 - n.thirst;
  const rest = 1 - n.fatigue;
  const temp = n.temp;
  const tCls = temp < 35.3 || temp > 39 ? 'bad' : temp < 36.2 ? 'cold' : temp > 37.9 ? 'warn' : 'good';
  const tFrac = (temp - 34) / 6;
  return row('Health', hp, pct(hp), tone(hp), 'Overall health. Wounds, blood loss, infection, hunger and thirst wear it down.')
    + row('Food', food, pct(food), tone(food), 'How well fed you are. Eat before it runs low: starving makes you weak and slow to heal.')
    + row('Water', water, pct(water), tone(water), 'Hydration. Drops faster when running or in the heat. Dehydration kills within days.')
    + row('Rest', rest, pct(rest), tone(rest), 'How rested you are. Tiredness slows your swings and blurs your eyes. Sleep somewhere safe.')
    + row('Stamina', n.endurance, pct(n.endurance), tone(n.endurance), 'Short-term breath. Running, fighting and climbing use it up.')
    + row('Body', tFrac, `${temp.toFixed(1)}°`, tCls, 'Body temperature. Normal is about 37°C. Wet clothes, wind and cold nights pull it down.');
}