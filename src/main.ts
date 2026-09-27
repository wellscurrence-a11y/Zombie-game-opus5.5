import './ui/styles.css';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './render/Renderer';
import { newGame, type SurvivorSpec } from './sim/newgame';
import { addRecord, currentWorldId, deleteWorld, getSetting, listWorlds, loadGame, newSurvivor, recordDeath, records, saveGame, setSetting } from './sim/save';
import type { GameState, WorldSettings } from './sim/types';
import { contributingFactors, deathScreen, helpScreen, mainMenu, pauseScreen, recordsScreen, settingsScreen, survivorCreation, type Prefs } from './ui/screens';
import { UI } from './ui/ui';
import { zombiesNear } from './sim/runtime';
import { AudioEngine } from './audio/audio';

class App {
  root = document.getElementById('ui')!;
  canvas = document.getElementById('view') as HTMLCanvasElement;
  renderer = new Renderer(this.canvas);
  input = new Input(this.canvas);
  audio = new AudioEngine();
  game: Game | null = null;
  ui: UI | null = null;
  screen: HTMLElement | null = null;
  prefs: Prefs = { shadows: true, volume: 0.7, pixelRatio: 1 };
  private saveTimer = 0;
  private saving = false;

  async boot(): Promise<void> {
    this.prefs = await getSetting<Prefs>('prefs', this.prefs);
    this.applyPrefs();
    const params = new URLSearchParams(location.search);
    if (params.has('lowgfx')) {
      this.prefs = { ...this.prefs, shadows: false, pixelRatio: 0.5 };
      this.applyPrefs();
    }
    if (params.has('quick')) {
      // developer shortcut: jump straight into a fresh world
      const seed = Number(params.get('seed') ?? 12345);
      const s = newGame(seed, { name: 'Test Survivor', occupation: params.get('occ') ?? 'unemployed', traits: [] });
      if (params.get('hour')) s.time = Number(params.get('hour'));
      this.play(s);
      return;
    }
    await this.menu();
    // the menu needs a backdrop: render an empty scene
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    window.addEventListener('beforeunload', () => this.save());
  }

  applyPrefs(): void {
    this.renderer.gl.shadowMap.enabled = this.prefs.shadows;
    this.renderer.quality = this.prefs.shadows ? 'high' : 'low';
    this.renderer.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.prefs.pixelRatio);
    this.renderer.resize();
    this.audio.setVolume(this.prefs.volume);
  }

  clearScreen(): void {
    this.screen?.remove();
    this.screen = null;
  }

  async menu(): Promise<void> {
    this.stopGame();
    this.clearScreen();
    const worlds = await listWorlds();
    const cur = await currentWorldId();
    this.screen = mainMenu(this.root, worlds, cur, {
      onContinue: () => cur && this.load(cur),
      onNew: () => this.createFlow(true),
      onLoad: (id) => this.load(id),
      onDelete: async (id) => {
        await deleteWorld(id);
        this.menu();
      },
      onHelp: () => this.overlay((r, close) => helpScreen(r, close)),
      onRecords: async () => {
        const recs = await records();
        this.overlay((r, close) => recordsScreen(r, recs, close));
      },
      onSettings: () => this.overlay((r, close) => settingsScreen(r, this.prefs, async (p) => {
        this.prefs = p;
        this.applyPrefs();
        await setSetting('prefs', p);
        close();
      }, close)),
    });
    this.audio.unlockOnGesture();
  }

  overlay(make: (root: HTMLElement, close: () => void) => HTMLElement): void {
    let el: HTMLElement | null = null;
    const close = (): void => {
      el?.remove();
    };
    el = make(this.root, close);
  }

  createFlow(newWorld: boolean, existing?: GameState): void {
    this.clearScreen();
    this.screen = survivorCreation(this.root, { newWorld, title: existing ? 'Someone else is still alive out there' : undefined }, (spec: SurvivorSpec, settings: WorldSettings, seed: number) => {
      this.clearScreen();
      this.loading('Building Cedar Hollow...');
      setTimeout(() => {
        let s: GameState;
        if (existing) {
          s = existing;
          newSurvivor(s, spec);
        } else s = newGame(seed, spec, settings);
        this.clearScreen();
        this.play(s);
        this.save();
      }, 30);
    }, () => this.menu());
  }

  loading(text: string): void {
    this.clearScreen();
    const e = document.createElement('div');
    e.className = 'screen';
    e.innerHTML = `<div class="menu" style="width:420px;text-align:center"><div class="brand" style="font-size:34px">QUIET HOURS</div><p style="margin-top:14px">${text}</p></div>`;
    this.root.appendChild(e);
    this.screen = e;
  }

  async load(id: string): Promise<void> {
    this.loading('Loading...');
    const s = await loadGame(id);
    if (!s) {
      this.menu();
      return;
    }
    if (s.player.dead) {
      this.createFlow(false, s);
      return;
    }
    this.clearScreen();
    this.play(s);
  }

  stopGame(): void {
    if (this.game) this.game.stop();
    this.ui?.destroy();
    this.ui = null;
    this.game = null;
  }

  play(s: GameState): void {
    this.stopGame();
    const g = new Game(this.canvas, s, this.renderer, this.input);
    this.game = g;
    const ui = new UI(this.root, g);
    this.ui = ui;
    (window as unknown as { game: Game }).game = g;
    g.hooks.onSave = () => this.save();
    g.hooks.onDeath = () => this.onDeath();
    ui.onPause = () => this.pause();
    g.onFrame = (dt) => {
      ui.update(dt);
      this.audio.update(g, dt);
      this.saveTimer += dt;
      if (this.saveTimer > 60 && !g.s.player.dead) {
        this.saveTimer = 0;
        this.save();
      }
    };
    g.start();
    this.audio.unlockOnGesture();
  }

  async save(): Promise<void> {
    const g = this.game;
    if (!g || this.saving) return;
    this.saving = true;
    try {
      await saveGame(g.s);
    } catch (e) {
      console.warn('save failed', e);
    }
    this.saving = false;
  }

  pause(): void {
    const g = this.game;
    if (!g) return;
    g.rt.paused = true;
    g.uiBlocking = true;
    let sc: HTMLElement | null = null;
    const resume = (): void => {
      sc?.remove();
      g.rt.paused = false;
      g.uiBlocking = false;
    };
    sc = pauseScreen(this.root, {
      onResume: resume,
      onSaveQuit: async () => {
        sc?.remove();
        await this.save();
        this.menu();
      },
      onHelp: () => this.overlay((r, close) => helpScreen(r, close)),
      onSettings: () => this.overlay((r, close) => settingsScreen(r, this.prefs, async (p) => {
        this.prefs = p;
        this.applyPrefs();
        await setSetting('prefs', p);
        close();
      }, close)),
    });
    const esc = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && sc?.isConnected) {
        e.preventDefault();
        resume();
        window.removeEventListener('keydown', esc);
      }
    };
    setTimeout(() => window.addEventListener('keydown', esc), 50);
  }

  onDeath(): void {
    const g = this.game;
    if (!g) return;
    const s = g.s;
    const near = zombiesNear(s, g.rt, s.player.x, s.player.y, 4, []).filter((z) => z.hp > 0 && z.state !== 'down').length;
    const factors = contributingFactors(s, near);
    setTimeout(async () => {
      const rec = recordDeath(s);
      g.rt.dirty.corpses = true;
      g.rt.dirty.floor = true;
      await addRecord(rec);
      await this.save();
      g.uiBlocking = true;
      this.screen = deathScreen(this.root, s, rec, factors, {
        onNext: () => {
          this.clearScreen();
          this.stopGame();
          this.createFlow(false, s);
        },
        onNewWorld: () => {
          this.clearScreen();
          this.stopGame();
          this.createFlow(true);
        },
        onMenu: () => this.menu(),
      });
    }, 2600);
  }
}

const app = new App();
(window as unknown as { app: App }).app = app;
app.boot();
