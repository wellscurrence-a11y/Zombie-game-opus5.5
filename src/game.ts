import { timeScale } from './core/time';
import { Input } from './input';
import { Renderer } from './render/Renderer';
import { computeLights } from './sim/lighting';
import { updatePlayerMovement, type Controls } from './sim/player';
import { rebuildZGrid, Runtime } from './sim/runtime';
import type { GameState } from './sim/types';
import { updateVision } from './sim/vision';

export class Game {
  s: GameState;
  rt: Runtime;
  input: Input;
  renderer: Renderer;
  controls: Controls = { moveX: 0, moveY: 0, run: false, aimX: 0, aimY: 0, aimValid: false, attack: false, attackHeld: false, attackReleased: false, shove: false };
  private last = performance.now();
  running = true;

  constructor(canvas: HTMLCanvasElement, s: GameState) {
    this.s = s;
    this.rt = new Runtime(s);
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas);
    this.renderer.init(s);
    updateVision(s, this.rt, true);
    computeLights(s, this.rt);
  }

  start(): void {
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(dt: number): void {
    const rt = this.rt;
    const inp = this.input;
    rt.realTime += dt;
    if (inp.hit('KeyQ')) this.renderer.rotate(-1);
    if (inp.hit('KeyE') && false) this.renderer.rotate(1);
    if (inp.wheel) this.renderer.setZoom(inp.wheel);
    this.buildControls();
    let sim = rt.paused ? 0 : dt * rt.speed;
    while (sim > 1e-6) {
      const step = Math.min(sim, 0.05);
      this.step(step);
      sim -= step;
    }
    this.renderer.update(this.s, rt, dt);
    this.renderer.render();
    inp.endFrame();
  }

  buildControls(): void {
    const inp = this.input;
    const c = this.controls;
    const { toCamX, toCamZ, rightX, rightZ } = this.renderer.camVectors();
    let f = 0;
    let r = 0;
    if (inp.down('KeyW') || inp.down('ArrowUp')) f += 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) f -= 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) r += 1;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) r -= 1;
    c.moveX = -toCamX * f + rightX * r;
    c.moveY = -toCamZ * f + rightZ * r;
    c.run = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const aim = this.renderer.screenToPlane(inp.ndcX, inp.ndcY, 0.9);
    if (aim) {
      c.aimX = aim.x;
      c.aimY = aim.z;
      c.aimValid = true;
    }
    c.attack = inp.lmbPressed && !inp.overUi;
    c.attackHeld = inp.lmb && !inp.overUi;
    c.attackReleased = inp.lmbReleased;
    c.shove = inp.hit('Space');
  }

  step(dt: number): void {
    const s = this.s;
    const rt = this.rt;
    s.time += (dt * timeScale(s.settings.dayLength)) / 3600;
    rebuildZGrid(s, rt);
    updatePlayerMovement(s, rt, this.controls, dt);
    updateVision(s, rt);
    if (rt.lightDirty) computeLights(s, rt);
  }
}
