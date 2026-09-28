import { Input } from './input';
import { Renderer, type Hover } from './render/Renderer';
import { startReload } from './sim/combat';
import { def } from './sim/items';
import { placeFurniture, toggleDoor, startClimb, toggleRoomLight, trySleep, type Target } from './sim/interact';
import { locate, removeItem } from './sim/inventory';
import { computeLights } from './sim/lighting';
import { chronicle, log, note } from './sim/log';
import { emitNoise } from './sim/noise';
import { PathFinder } from './sim/path';
import type { Controls } from './sim/player';
import { rebuildZGrid, Runtime } from './sim/runtime';
import { lvl } from './sim/skills';
import { breakWindow } from './sim/structures';
import type { GameState } from './sim/types';
import type { Ctx } from './sim/use';
import { exitVehicle, refreshVehOcc, startEngine, type DriveInput } from './sim/vehicles';
import { updateVision } from './sim/vision';
import { placeItem, startFire } from './sim/world-actions';
import { resetWorldSystems } from './sim/world-systems';
import { S, WIN_CLOSED } from './world/world';
import { angleDiff } from './core/math';
import { build } from './sim/build';
import { actionProgress, simStep, wake } from './sim/step';

export interface GameHooks {
  onDeath?: (g: Game) => void;
  onSave?: (g: Game) => void;
  onPause?: (g: Game) => void;
}

export class Game implements Ctx {
  s: GameState;
  rt: Runtime;
  input: Input;
  renderer: Renderer;
  pf: PathFinder;
  hooks: GameHooks = {};
  controls: Controls = { moveX: 0, moveY: 0, run: false, aimX: 0, aimY: 0, aimValid: false, attack: false, attackHeld: false, attackReleased: false, shove: false };
  drive: DriveInput = { throttle: 0, steer: 0, brake: false };
  hover: Hover | null = null;
  private hoverT = 0;
  private last = performance.now();
  running = true;
  uiBlocking = false;
  ui: { openPanel(t: string): void; closePanel(): void } | null = null;
  /** Called by the UI layer each frame. */
  onFrame: ((dt: number) => void) | null = null;
  /** Ask the UI to open the loot panel with a container key. */
  openLoot: (key: string) => void = () => {};
  /** Ask the UI to show a context menu. */
  showContext: (t: Target, sx: number, sy: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, s: GameState, renderer?: Renderer, input?: Input) {
    this.s = s;
    this.rt = new Runtime(s);
    this.input = input ?? new Input(canvas);
    this.renderer = renderer ?? new Renderer(canvas);
    this.renderer.init(s);
    this.pf = new PathFinder(s.world);
    refreshVehOcc(s, this.pf);
    resetWorldSystems();
    rebuildZGrid(s, this.rt);
    updateVision(s, this.rt, true);
    computeLights(s, this.rt);
  }

  get sRef(): GameState {
    return this.s;
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  /** Current time multiplier. */
  multiplier(): number {
    const p = this.s.player;
    const rt = this.rt;
    if (p.dead) return 1;
    if (p.sleeping) return 45;
    if (rt.action?.ffwd && rt.threat === 0) return Math.max(rt.speed, 15);
    return rt.speed;
  }

  frame(dt: number): void {
    const rt = this.rt;
    const inp = this.input;
    rt.realTime += dt;
    rt.shake = Math.max(0, rt.shake - dt * 3);
    rt.hurtFlash = Math.max(0, rt.hurtFlash - dt * 1.5);
    rt.flash = Math.max(0, rt.flash - dt * 3);
    if (!this.uiBlocking) this.handleKeys();
    if (inp.wheel && !inp.overUi) this.renderer.setZoom(inp.wheel);
    this.buildControls();
    const mult = rt.paused ? 0 : this.multiplier();
    let sim = dt * mult;
    let first = true;
    // big multipliers use larger steps
    const maxStep = mult > 10 ? 0.25 : 0.05;
    let guard = 0;
    while (sim > 1e-6 && guard++ < 200) {
      const step = Math.min(sim, maxStep);
      this.step(step, dt * (step / (dt * mult || 1)), first);
      first = false;
      sim -= step;
      if (this.s.player.dead) break;
    }
    // hover picking (throttled)
    this.hoverT -= dt;
    if (this.hoverT <= 0) {
      this.hoverT = 0.08;
      this.hover = inp.overUi ? null : this.renderer.pick(this.s, rt, inp.ndcX, inp.ndcY);
    }
    this.renderer.update(this.s, rt, dt);
    this.renderer.render();
    this.renderer.adapt(dt);
    this.onFrame?.(dt);
    if (this.s.player.dead && !rt.deathHandled) {
      rt.deathHandled = true;
      this.hooks.onDeath?.(this);
    }
    // expire effects
    if (rt.effects.length > 200) rt.effects.splice(0, rt.effects.length - 200);
    rt.effects = rt.effects.filter((e) => rt.realTime - e.t < e.dur + 0.1);
    inp.endFrame();
  }

  private handleKeys(): void {
    const inp = this.input;
    const s = this.s;
    const p = s.player;
    const rt = this.rt;
    if (inp.hit('KeyZ')) this.renderer.rotate(-1);
    if (inp.hit('KeyX')) this.renderer.rotate(1);
    if (p.dead) return;
    if (p.sleeping) {
      if (inp.hit('Space') || inp.hit('Escape')) this.wake('You get up.');
      return;
    }
    if (p.inVehicle >= 0) {
      if (inp.hit('KeyE')) exitVehicle(this);
      if (inp.hit('KeyR')) startEngine(this);
      if (inp.hit('KeyF')) {
        const v = s.vehicles[p.inVehicle];
        v.lights = !v.lights;
        rt.fovDirty = true;
      }
      const v = s.vehicles[p.inVehicle];
      v.horn = inp.down('KeyG');
      // right-click anywhere while inside: the car's own options (engine, glovebox, get out...)
      if (inp.rmbPressed && !inp.overUi) this.showContext({ kind: 'vehicle', x: v.x, y: v.y, id: v.id }, inp.mouseX, inp.mouseY);
      return;
    }
    if (inp.hit('KeyC')) {
      p.stance = p.stance === 'crouch' ? 'stand' : 'crouch';
      rt.fovDirty = true;
    }
    if (inp.hit('KeyF')) {
      const fl = p.inventory.find((i) => i.id === 'flashlight') ?? p.bag?.contents?.find((i) => i.id === 'flashlight');
      if (!fl) log(s, 'You don\'t have a flashlight.', 'info');
      else if ((fl.charge ?? 0) <= 0) log(s, 'The flashlight is dead. You need batteries.', 'warn');
      else {
        if (!p.inventory.includes(fl)) {
          log(s, 'Take the flashlight out of your bag first.', 'info');
        } else {
          p.flashlight = !p.flashlight;
          rt.fovDirty = true;
          if (p.flashlight) note(s, 'darkness');
        }
      }
    }
    if (inp.hit('KeyR')) startReload(s, rt);
    if (inp.hit('KeyL')) toggleRoomLight(this);
    if (inp.hit('KeyE')) this.interactPrimary();
    if (inp.hit('KeyT')) this.cycleSpeed();
    for (let k = 1; k <= 6; k++) if (inp.hit(`Digit${k}`)) this.quickSlot(k - 1);
    // context menu
    if (inp.rmbPressed && !inp.overUi) {
      const h = this.renderer.pick(s, rt, inp.ndcX, inp.ndcY);
      if (h) this.showContext(hoverToTarget(h), inp.mouseX, inp.mouseY);
    }
    // modes capture left click
    if (rt.mode && inp.lmbPressed && !inp.overUi) {
      this.applyMode();
      inp.lmbPressed = false;
    }
    if (p.carrying >= 0 && inp.lmbPressed && !inp.overUi && this.hover) {
      const t = Math.floor(this.hover.x);
      const u = Math.floor(this.hover.y);
      placeFurniture(this, t, u);
      inp.lmbPressed = false;
    }
  }

  cycleSpeed(): void {
    const rt = this.rt;
    if (rt.threat > 0 || rt.closestZombie < 10) {
      log(this.s, 'Not with the dead this close.', 'warn');
      rt.speed = 1;
      return;
    }
    rt.speed = rt.speed === 1 ? 3 : rt.speed === 3 ? 8 : 1;
  }

  /** Hotbar: weapons & key tools in order of appearance. */
  quickItems(): number[] {
    const p = this.s.player;
    return p.inventory.filter((i) => def(i.id).weapon || def(i.id).firearm).slice(0, 6).map((i) => i.uid);
  }

  quickSlot(k: number): void {
    const uid = this.quickItems()[k];
    const p = this.s.player;
    if (!uid) return;
    p.primary = p.primary === uid ? 0 : uid;
  }

  private buildControls(): void {
    const inp = this.input;
    const c = this.controls;
    const s = this.s;
    const p = s.player;
    const block = this.uiBlocking || p.dead;
    const { toCamX, toCamZ, rightX, rightZ } = this.renderer.camVectors();
    let f = 0;
    let r = 0;
    if (!block) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) f += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) f -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) r += 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) r -= 1;
    }
    if (p.inVehicle >= 0) {
      this.drive.throttle = f;
      this.drive.steer = r;
      this.drive.brake = !block && inp.down('Space');
      c.moveX = 0;
      c.moveY = 0;
    } else {
      c.moveX = -toCamX * f + rightX * r;
      c.moveY = -toCamZ * f + rightZ * r;
    }
    c.run = !block && (inp.down('ShiftLeft') || inp.down('ShiftRight'));
    const aim = this.renderer.screenToPlane(inp.ndcX, inp.ndcY, 0.9);
    if (aim) {
      c.aimX = aim.x;
      c.aimY = aim.z;
      c.aimValid = !inp.overUi || this.rt.mode !== null;
    }
    const canAttack = !block && !this.rt.mode && p.carrying < 0 && !inp.overUi;
    c.attack = canAttack && inp.lmbPressed;
    c.attackHeld = canAttack && inp.lmb;
    c.attackReleased = inp.lmbReleased;
    c.shove = !block && p.inVehicle < 0 && inp.hit('Space');
  }

  step(dt: number, realDt: number, first: boolean): void {
    simStep(this, dt, realDt, first, !this.uiBlocking);
  }

  onWake = (): void => {
    this.hooks.onSave?.(this);
  };

  wake(reason: string): void {
    wake(this, reason);
  }

  /** Progress 0..1 of the current action. */
  actionProgress(): number {
    return actionProgress(this.s, this.rt);
  }

  /** E: do the obvious thing with what's under the cursor, or the nearest door/window. */
  interactPrimary(): void {
    const s = this.s;
    const p = s.player;
    const w = s.world;
    const h = this.hover;
    if (h) {
      const t = hoverToTarget(h);
      if (t.kind === 'door') {
        const d = w.doors[t.id];
        if (Math.hypot(d.x + 0.5 - p.x, d.y + 0.5 - p.y) < 1.8) return toggleDoor(this, d);
      }
      if (t.kind === 'window') {
        const win = w.windows[t.id];
        if (Math.hypot(win.x + 0.5 - p.x, win.y + 0.5 - p.y) < 1.8 && win.planks === 0 && win.state !== WIN_CLOSED) return startClimb(this, win.x, win.y, 'window', win.vertical);
      }
      if (t.kind === 'fence' && Math.hypot(t.x + 0.5 - p.x, t.y + 0.5 - p.y) < 1.6) {
        const high = w.struct[t.y * w.w + t.x] === S.FenceHigh;
        return startClimb(this, t.x, t.y, high ? 'highfence' : 'fence', null);
      }
      if (t.kind === 'vehicle' || t.kind === 'furn' || t.kind === 'corpse') {
        this.showContext(t, this.input.mouseX, this.input.mouseY);
        return;
      }
    }
    // nearest door, window or fence within reach, favouring the one you're facing
    let best: { i: number; d: number } | null = null;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
        const i = y * w.w + x;
        const st = w.struct[i];
        if (st !== S.Door && st !== S.FenceLow && st !== S.FenceHigh && st !== S.Window) continue;
        const cx = Math.max(x, Math.min(p.x, x + 1));
        const cy = Math.max(y, Math.min(p.y, y + 1));
        const dist = Math.hypot(p.x - cx, p.y - cy);
        if (dist > 1.1) continue;
        const ang = Math.abs(angleDiff(p.facing, Math.atan2(y + 0.5 - p.y, x + 0.5 - p.x)));
        const score = dist + ang * 0.35;
        if (!best || score < best.d) best = { i, d: score };
      }
    }
    if (!best) return;
    const x = best.i % w.w;
    const y = Math.floor(best.i / w.w);
    const st = w.struct[best.i];
    if (st === S.Door) toggleDoor(this, w.doors[w.structRef[best.i]]);
    else if (st === S.Window) {
      const win = w.windows[w.structRef[best.i]];
      if (win.planks === 0 && win.state !== WIN_CLOSED) startClimb(this, x, y, 'window', win.vertical);
    } else startClimb(this, x, y, st === S.FenceHigh ? 'highfence' : 'fence', null);
  }

  private applyMode(): void {
    const rt = this.rt;
    const s = this.s;
    const m = rt.mode;
    if (!m) return;
    const c = this.controls;
    if (m.kind === 'place') {
      const x = Math.floor(c.aimX);
      const y = Math.floor(c.aimY);
      if (placeItem(this, m.uid, x, y)) rt.mode = null;
    } else if (m.kind === 'throw') {
      this.throwItem(m.uid, c.aimX, c.aimY);
      rt.mode = null;
    } else if (m.kind === 'build') {
      if (build(this, m.recipe, Math.floor(c.aimX), Math.floor(c.aimY))) rt.mode = null;
    }
  }

  throwItem(uid: number, tx: number, ty: number): void {
    const s = this.s;
    const rt = this.rt;
    const p = s.player;
    const where = locate(s, uid);
    if (!where) return;
    const it = removeItem(s, where, uid);
    if (!it) return;
    const d = def(it.id);
    let dx = tx - p.x;
    let dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    const max = 9 + lvl(p, 'strength') * 0.4;
    if (dist > max) {
      dx *= max / dist;
      dy *= max / dist;
    }
    // stop at walls
    let lx = p.x;
    let ly = p.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / 0.25);
    const w = s.world;
    for (let k = 1; k <= steps; k++) {
      const nx = p.x + (dx * k) / steps;
      const ny = p.y + (dy * k) / steps;
      const i = Math.floor(ny) * w.w + Math.floor(nx);
      const st = w.struct[i];
      if (st === S.Wall || st === S.BuiltWall || (st === S.Door && !w.doors[w.structRef[i]].open)) break;
      if (st === S.Window) {
        const win = w.windows[w.structRef[i]];
        if (win.state === WIN_CLOSED && win.planks === 0) {
          breakWindow(s, rt, win, 'player');
          break;
        }
      }
      lx = nx;
      ly = ny;
    }
    p.facing = Math.atan2(dy, dx);
    p.attackT = 0.4;
    p.attackDur = 0.4;
    p.attackHit = true;
    const tile = Math.floor(ly) * w.w + Math.floor(lx);
    const noise = d.throwNoise ?? 4;
    if (it.id === 'emptyBottle') {
      w.decal[tile] |= 2;
      w.rev.ground++;
    } else if (it.id === 'molotov') {
      startFire(s, rt, tile, 'a Molotov cocktail');
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (rt.rng.chance(0.6)) startFire(s, rt, tile + ox + oy * w.w, 'a Molotov cocktail');
      chronicle(s, 'Threw a Molotov cocktail.', 3);
    } else {
      if (it.id === 'alarmClock') it.timer = 8;
      (s.floor[tile] ??= []).push(it);
      rt.dirty.floor = true;
    }
    emitNoise(s, rt, { x: lx, y: ly, radius: noise, kind: 'throw', src: 'player' });
    rt.effects.push({ kind: 'ring', x: lx, y: ly, t: rt.realTime, dur: 0.9, r: noise, color: 0x9ad0ff });
    if (it.id === 'emptyBottle') log(s, 'The bottle shatters where it lands.', 'info');
    note(s, 'sound');
  }

  /** Enter throw mode for an item. */
  beginThrow(uid: number): void {
    this.rt.mode = { kind: 'throw', uid };
    log(this.s, 'Click where you want to throw it. (Esc to cancel)', 'info');
  }

  beginPlace(uid: number): void {
    this.rt.mode = { kind: 'place', uid };
    log(this.s, 'Click a nearby spot to place it. (Esc to cancel)', 'info');
  }

  sleepHere(): void {
    const s = this.s;
    const p = s.player;
    const w = s.world;
    const f = w.furn[Math.floor(p.y) * w.w + Math.floor(p.x)];
    trySleep(this, f >= 0 ? w.furniture[f].kind : p.inVehicle >= 0 ? 'car' : null);
  }
}

export function hoverToTarget(h: Hover): Target {
  const kind = h.kind === 'wall' ? 'wall' : h.kind;
  return { kind: kind as Target['kind'], x: h.x, y: h.y, id: h.id };
}
