import type { Game } from '../game';
import { optionsFor, type Target } from '../sim/interact';
import { log } from '../sim/log';
import { esc } from './dom';
import { Hud } from './hud';
import type { MenuItem } from './itemMenu';
import { drawMap, handleCraftClick, handleHealthClick, handleInventoryClick, renderCraft, renderHealth, renderInventory, renderJournal, renderSkills, type Tab } from './panels';

const TABS: [Tab, string][] = [['inventory', 'Inventory'], ['health', 'Health'], ['skills', 'Skills'], ['craft', 'Craft'], ['map', 'Map'], ['journal', 'Journal']];

export class UI {
  root: HTMLElement;
  g: Game;
  hud: Hud;
  panel: HTMLElement | null = null;
  tab: Tab | null = null;
  selected: string | null = null;
  ctx: HTMLElement | null = null;
  private refreshT = 0;
  private mapT = 0;
  onPause: () => void = () => {};
  private moveHandler: (e: MouseEvent) => void;

  constructor(root: HTMLElement, g: Game) {
    this.root = root;
    this.g = g;
    this.hud = new Hud(root, g, (t) => this.togglePanel(t as Tab));
    g.ui = this;
    g.openLoot = (key) => {
      g.rt.openContainers = [key, ...g.rt.openContainers.filter((k) => k !== key)].slice(0, 6);
      this.selected = key;
      this.openPanel('inventory');
    };
    g.showContext = (t, sx, sy) => this.showContext(t, sx, sy);
    this.moveHandler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      g.input.overUi = !!t.closest?.('.panel, .ctx, .interactive, .screen, button, .cond');
    };
    window.addEventListener('mousemove', this.moveHandler);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.moveHandler);
    this.root.innerHTML = '';
  }

  update(dt: number): void {
    this.handleKeys();
    this.hud.update(dt);
    if (this.panel) {
      this.refreshT -= dt;
      if (this.refreshT <= 0) {
        this.refreshT = this.tab === 'map' ? 99 : 0.35;
        this.renderPanel();
      }
      if (this.tab === 'map') {
        this.mapT -= dt;
        if (this.mapT <= 0) {
          this.mapT = 1.5;
          const cv = this.panel.querySelector('canvas');
          if (cv) drawMap(this.g, cv);
        }
      }
    }
  }

  private handleKeys(): void {
    const inp = this.g.input;
    if (this.g.uiBlocking) return;
    if (inp.hit('Escape')) {
      if (this.ctx) this.closeCtx();
      else if (this.g.rt.mode) {
        this.g.rt.mode = null;
      } else if (this.panel) this.closePanel();
      else this.onPause();
      return;
    }
    const map: [string, Tab][] = [['Tab', 'inventory'], ['KeyI', 'inventory'], ['KeyH', 'health'], ['KeyK', 'skills'], ['KeyB', 'craft'], ['KeyM', 'map'], ['KeyJ', 'journal']];
    for (const [k, t] of map) if (inp.hit(k)) this.togglePanel(t);
    if (inp.lmbPressed && this.ctx && !inp.overUi) this.closeCtx();
  }

  togglePanel(t: Tab): void {
    if (this.tab === t && this.panel) this.closePanel();
    else this.openPanel(t);
  }

  openPanel(t: string): void {
    const tab = t as Tab;
    this.tab = tab;
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.className = 'panel';
      this.root.appendChild(this.panel);
      this.panel.addEventListener('click', (e) => this.onPanelClick(e));
      this.panel.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.onPanelClick(e);
      });
    }
    this.panel.classList.toggle('narrow', tab === 'skills');
    this.refreshT = 0;
    this.mapT = 0;
    this.renderPanel();
  }

  closePanel(): void {
    this.panel?.remove();
    this.panel = null;
    this.tab = null;
    this.g.input.overUi = false;
  }

  private renderPanel(): void {
    if (!this.panel || !this.tab) return;
    const g = this.g;
    const scroll = this.panel.querySelector('.pbody')?.scrollTop ?? 0;
    const listScroll = [...this.panel.querySelectorAll('.list')].map((l) => l.scrollTop);
    let body = '';
    switch (this.tab) {
      case 'inventory': {
        const r = renderInventory(g, this.selected);
        this.selected = r.selected;
        body = r.html;
        break;
      }
      case 'health':
        body = renderHealth(g);
        break;
      case 'skills':
        body = renderSkills(g);
        break;
      case 'craft':
        body = renderCraft(g);
        break;
      case 'map':
        body = `<div class="mapwrap"><canvas style="cursor:crosshair"></canvas></div><p class="dim" style="text-align:center;font-size:11px">${g.s.hasMap ? 'Your map shows the town\'s layout.' : 'Only places you have seen are marked. A map of Cedar Hollow would show more.'} Click to add or remove a marker.</p>`;
        break;
      case 'journal':
        body = renderJournal(g);
        break;
    }
    const tabs = TABS.map(([id, n]) => `<button data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${n}</button>`).join('');
    this.panel.innerHTML = `<div class="tabs">${tabs}<button class="close" data-close="1">✕</button></div><div class="pbody">${body}</div>`;
    const pb = this.panel.querySelector('.pbody');
    if (pb) pb.scrollTop = scroll;
    [...this.panel.querySelectorAll('.list')].forEach((l, i) => (l.scrollTop = listScroll[i] ?? 0));
    if (this.tab === 'map') {
      const cv = this.panel.querySelector('canvas');
      if (cv) {
        drawMap(g, cv);
        cv.addEventListener('click', (e) => {
          const r = cv.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * g.s.world.w;
          const y = ((e.clientY - r.top) / r.height) * g.s.world.h;
          const near = g.s.mapMarkers.findIndex((m) => Math.hypot(m.x - x, m.y - y) < 4);
          if (near >= 0) g.s.mapMarkers.splice(near, 1);
          else {
            const label = prompt('Label this spot:', 'Base');
            if (label) g.s.mapMarkers.push({ x, y, label: label.slice(0, 24) });
          }
          drawMap(g, cv);
        });
      }
    }
  }

  private onPanelClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest('[data-act], [data-tab], [data-close]') as HTMLElement | null;
    if (!t) return;
    if (t.dataset.close) return this.closePanel();
    if (t.dataset.tab) return this.openPanel(t.dataset.tab);
    const g = this.g;
    if (this.tab === 'inventory') this.selected = handleInventoryClick(g, t, this.selected, (items, x, y, title) => this.showMenu(items, x, y, title), e);
    else if (this.tab === 'health') handleHealthClick(g, t);
    else if (this.tab === 'craft') handleCraftClick(g, t, () => this.closePanel());
    this.refreshT = 0.05;
  }

  showContext(t: Target, sx: number, sy: number): void {
    const g = this.g;
    const r = optionsFor(g, t, g.openLoot);
    const items: MenuItem[] = r.options.map((o) => ({ label: o.label, run: o.run, enabled: o.enabled, reason: o.reason }));
    this.showMenu(items, sx, sy, r.title, r.far);
  }

  showMenu(items: MenuItem[], sx: number, sy: number, title: string, far = false): void {
    const g = this.g;
    this.closeCtx();
    const c = document.createElement('div');
    c.className = 'ctx';
    const opts = items
      .map((o, i) => {
        const off = o.enabled === false || far;
        return `<div class="opt ${off ? 'off' : ''}" data-i="${i}"><span>${esc(o.label)}</span>${o.enabled === false && o.reason ? `<span class="why">${esc(o.reason)}</span>` : ''}</div>`;
      })
      .join('');
    c.innerHTML = `<div class="title">${esc(title)}</div>${far ? '<div class="far">Too far away — walk closer.</div>' : ''}${opts || '<div class="opt off">Nothing to do here.</div>'}`;
    this.root.appendChild(c);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rect = c.getBoundingClientRect();
    c.style.left = `${Math.min(sx, W - rect.width - 8)}px`;
    c.style.top = `${Math.min(sy, H - rect.height - 8)}px`;
    c.addEventListener('click', (e) => {
      const o = (e.target as HTMLElement).closest('.opt') as HTMLElement | null;
      if (!o || o.classList.contains('off')) return;
      const it = items[Number(o.dataset.i)];
      this.closeCtx();
      if (far) {
        log(g.s, 'Too far away.', 'warn');
        return;
      }
      it.run();
      this.refreshT = 0.05;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ctx = c;
  }

  closeCtx(): void {
    this.ctx?.remove();
    this.ctx = null;
  }
}
