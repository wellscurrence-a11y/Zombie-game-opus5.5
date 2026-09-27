import type { Game } from '../game';
import { clockString, dateString, dayNumber, formatDuration } from '../core/time';
import { conditions } from '../sim/conditions';
import { def, itemName } from '../sim/items';
import { NOTES } from '../sim/log';
import { capacity, carriedWeight, heldItem } from '../sim/stats';
import { VEH } from '../sim/vehicleSpecs';
import { esc } from './dom';
import { FURN } from '../world/furniture';
import { WIN_BROKEN, WIN_CLEARED, WIN_CLOSED, WIN_OPEN, S } from '../world/world';
import { doorName } from '../sim/structures';
import { vehicleName } from '../sim/vehicles';

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
  sleep = document.createElement('div');
  toast = document.createElement('div');
  speedo = document.createElement('div');
  modehint = document.createElement('div');
  private g: Game;
  private slow = 0;
  private lastLog = -1;
  private noteCount = 0;
  private toastT = 0;

  constructor(root: HTMLElement, g: Game, onPanel: (tab: string) => void) {
    this.root = root;
    this.g = g;
    this.tl.className = 'hud-tl';
    this.tr.className = 'hud-tr';
    this.bl.className = 'hud-bl';
    this.bc.className = 'hud-bc';
    this.br.className = 'hud-br';
    this.action.className = 'actionbar';
    this.tip.className = 'tooltip';
    this.vignette.className = 'overlay vignette';
    this.hurt.className = 'overlay hurt';
    this.flash.className = 'overlay flashw';
    this.sleep.className = 'overlay sleep';
    this.toast.className = 'toast';
    this.speedo.className = 'speedo';
    this.modehint.className = 'modehint';
    this.heard.className = 'overlay';
    for (const e of [this.vignette, this.hurt, this.flash, this.heard, this.tl, this.tr, this.bl, this.bc, this.br, this.action, this.tip, this.speedo, this.modehint, this.toast, this.sleep]) root.appendChild(e);
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
    this.vignette.style.opacity = String(Math.min(1, 0.25 + pn * 0.9 + (1 - p.body.blood) * 0.8 + (p.needs.endurance < 0.2 ? 0.25 : 0)));
    this.hurt.style.opacity = String(Math.min(1, rt.hurtFlash * 0.9 + (p.grabbedBy.length ? 0.35 + Math.sin(rt.realTime * 12) * 0.15 : 0)));
    this.flash.style.opacity = String(rt.flash);
    this.sleep.style.display = p.sleeping ? 'flex' : 'none';
    if (p.sleeping) {
      const info = this.sleep.querySelector('#sleepinfo')!;
      info.textContent = `${hasWatch(g) ? clockString(s.time) : clockString(s.time, false)} — fatigue ${Math.round(p.needs.fatigue * 100)}%`;
    }
    // action bar
    const a = rt.action;
    if (a && !p.sleeping) {
      const { sx, sy } = g.renderer.project(p.x, 2.3, p.y);
      this.action.style.display = 'block';
      this.action.style.left = `${sx}px`;
      this.action.style.top = `${sy}px`;
      this.action.innerHTML = `${esc(a.label)}<div class="bar"><i style="width:${(g.actionProgress() * 100).toFixed(0)}%"></i></div>`;
    } else if (p.reloadT > 0) {
      const { sx, sy } = g.renderer.project(p.x, 2.3, p.y);
      this.action.style.display = 'block';
      this.action.style.left = `${sx}px`;
      this.action.style.top = `${sy}px`;
      this.action.textContent = 'Reloading...';
    } else if (p.climbT > 0) {
      const { sx, sy } = g.renderer.project(p.x, 2.3, p.y);
      this.action.style.display = 'block';
      this.action.style.left = `${sx}px`;
      this.action.style.top = `${sy}px`;
      this.action.textContent = p.climbKind === 'window' ? 'Climbing through...' : 'Climbing...';
    } else this.action.style.display = 'none';
    // tooltip
    this.updateTooltip();
    // heard sounds
    this.updateHeard();
    // speedometer
    if (p.inVehicle >= 0) {
      const v = s.vehicles[p.inVehicle];
      this.speedo.style.display = 'flex';
      this.speedo.innerHTML = `<span class="big">${Math.round(Math.abs(v.speed) * 3.6)} km/h</span><span>${v.engineOn ? '<span class="good">Engine on</span>' : '<span class="dim">Engine off (R)</span>'}<br><span class="dim">Fuel ${Math.round((v.fuel / v.fuelCap) * 100)}% · Battery ${Math.round(v.battery * 100)}%</span></span><span class="dim">Engine ${Math.round(v.engine)}%<br>${v.lights ? 'Lights on (F)' : 'Lights off (F)'} · G horn</span>`;
    } else this.speedo.style.display = 'none';
    const m = rt.mode;
    if (m || p.carrying >= 0) {
      this.modehint.style.display = 'block';
      this.modehint.textContent = p.carrying >= 0 ? `Carrying ${FURN[s.world.furniture[p.carrying].kind].name.toLowerCase()} — left-click a nearby spot to set it down.` : m?.kind === 'throw' ? 'Throw: left-click a target. Esc cancels.' : m?.kind === 'place' ? 'Place: left-click a nearby spot. Esc cancels.' : 'Build: left-click a nearby empty tile. Esc cancels.';
    } else this.modehint.style.display = 'none';
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
    const conds = conditions(s, rt);
    this.tl.innerHTML = conds
      .map((c) => `<div class="cond ${c.tone}" title="${esc(c.tip)}"><span>${esc(c.label)}</span>${c.level > 1 ? `<span class="dots">${'●'.repeat(Math.min(4, c.level))}</span>` : ''}</div>`)
      .join('');
    const watch = hasWatch(g);
    const wx = s.weather;
    const feel = wx.temp < 0 ? 'Freezing' : wx.temp < 7 ? 'Cold' : wx.temp < 13 ? 'Cool' : wx.temp < 22 ? 'Mild' : wx.temp < 28 ? 'Warm' : 'Hot';
    const wxName = { clear: 'Clear', cloudy: 'Overcast', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow' }[wx.kind];
    const survived = s.time - p.startT;
    const sp = rt.speed;
    this.tr.innerHTML = `<div class="clockbox"><div class="time">${watch ? clockString(s.time) : clockString(s.time, false)}</div><div class="date">Day ${dayNumber(s.time)} · ${dateString(s.time)}${watch ? '' : ' · no watch'}</div><div class="wx">${wxName} · ${feel} ${Math.round(wx.temp)}°C</div><div class="surv">Survived ${formatDuration(survived)}</div></div>
      <div class="speed interactive"><button data-speed="0" class="${rt.paused ? 'on' : ''}">❚❚</button><button data-speed="1" class="${!rt.paused && sp === 1 ? 'on' : ''}">1×</button><button data-speed="3" class="${sp === 3 ? 'on' : ''}">3×</button><button data-speed="8" class="${sp === 8 ? 'on' : ''}">8×</button></div>`;
    // log
    const recent = s.log.slice(-8);
    const key = s.log.length;
    if (key !== this.lastLog || true) {
      this.lastLog = key;
      this.bl.innerHTML = recent
        .map((l, i) => {
          const age = s.time - l.t;
          const op = Math.max(0.25, 1 - age / 1.2) * (0.55 + (i / recent.length) * 0.45);
          return `<div class="logline ${l.kind}" style="opacity:${op.toFixed(2)}"><span class="t">${watch ? clockString(l.t) : ''}</span>${esc(l.text)}</div>`;
        })
        .join('');
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
    this.bc.innerHTML = `<div class="hotbar">${slots.join('')}</div><div class="bars"><span>Stamina</span><div class="bar end"><i style="width:${Math.round(p.needs.endurance * 100)}%"></i></div><span class="${wt > cap ? 'warn' : 'dim'}">${wt.toFixed(1)} / ${cap.toFixed(0)} kg</span><span class="dim">${p.stance === 'crouch' ? 'Crouched' : p.running ? 'Running' : 'Walking'}${held ? ` · ${esc(itemName(held))}` : ' · Bare hands'}</span></div>`;
  }

  private updateTooltip(): void {
    const g = this.g;
    const s = g.s;
    const h = g.hover;
    const inp = g.input;
    if (!h || inp.overUi || h.kind === 'ground' || g.uiBlocking || s.player.dead || s.player.sleeping) {
      this.tip.style.display = 'none';
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
      this.tip.style.display = 'none';
      return;
    }
    this.tip.style.display = 'block';
    this.tip.style.left = `${inp.mouseX}px`;
    this.tip.style.top = `${inp.mouseY}px`;
    this.tip.innerHTML = text + '<br><span class="faint">Right-click for options</span>';
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
      html += `<div class="heard" style="left:${sx}px;top:${sy}px;opacity:${op.toFixed(2)}">${arrow}${esc(h.label)}</div>`;
    }
    this.heard.innerHTML = html;
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
