import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { updateVision } from '../src/sim/vision';
import { computeLights } from '../src/sim/lighting';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { Rng } from '../src/core/rng';

/** Walks any object graph and returns the path of the first non-finite number. */
function findNaN(o: unknown, path: string, seen = new Set<unknown>()): string | null {
  if (typeof o === 'number') return Number.isNaN(o) || o === -Infinity ? path : null;
  if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) return null;
  seen.add(o);
  for (const [k, v] of Object.entries(o)) {
    const r = findNaN(v, `${path}.${k}`, seen);
    if (r) return r;
  }
  return null;
}

// Several game days of a restless survivor with early utility failure and frequent world events.
// Slow, so it only runs with SOAK=1.
describe.runIf(process.env.SOAK)('soak', () => {
  for (const seed of [11, 12, 13]) {
    it(`runs days of world ${seed} without errors or NaNs`, () => {
      const s = newGame(seed, { name: 'Soak', occupation: 'unemployed', traits: [] });
      const rt = new Runtime(s);
      const pf = new PathFinder(s.world);
      refreshVehOcc(s, pf);
      resetWorldSystems();
      rebuildZGrid(s, rt);
      updateVision(s, rt, true);
      computeLights(s, rt);
      const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
      const rng = new Rng(seed);
      s.util.powerOffAt = s.time + 20;
      s.util.waterOffAt = s.time + 30;
      const dt = 0.25;
      let steps = 0;
      let deaths = 0;
      let firstDeath = 0;
      const causes: Record<string, number> = {};
      const endT = s.time + 24 * 4;
      while (s.time < endT) {
        if (steps % 40 === 0) {
          const a = rng.range(0, Math.PI * 2);
          c.controls.moveX = rng.chance(0.2) ? 0 : Math.cos(a);
          c.controls.moveY = rng.chance(0.2) ? 0 : Math.sin(a);
          c.controls.run = rng.chance(0.3);
          c.controls.aimX = s.player.x + Math.cos(a) * 3;
          c.controls.aimY = s.player.y + Math.sin(a) * 3;
          c.controls.aimValid = true;
        }
        c.controls.attack = rng.chance(0.02);
        c.controls.shove = rng.chance(0.01);
        if (s.events.nextEventT > s.time + 2) s.events.nextEventT = s.time + 2;
        simStep(c, dt, dt, steps === 0);
        steps++;
        if (s.player.dead) {
          deaths++;
          causes[s.player.deathCause] = (causes[s.player.deathCause] ?? 0) + 1;
          if (deaths === 1) firstDeath = s.time;
          // Keep the world running with a fresh body in the same spot.
          s.player.dead = false;
          Object.assign(s.player.body, { injuries: [], health: 100, blood: 1, fever: false, feverLevel: 0 });
          s.player.grabbedBy = [];
          s.player.downT = 0;
          s.player.needs.temp = 37;
          s.player.needs.co = 0;
          s.player.needs.hunger = 0;
          s.player.needs.thirst = 0;
          s.player.needs.fatigue = 0;
        }
        if (steps % 400 === 0) {
          const bad = findNaN(s.player, 'player') ?? findNaN(s.zombies, 'zombies') ?? findNaN(s.vehicles, 'vehicles') ?? findNaN(s.weather, 'weather') ?? findNaN(s.events, 'events');
          expect(bad).toBeNull();
        }
      }
      expect(() => structuredClone(s)).not.toThrow();
      expect(s.util.powerOff).toBe(true);
      expect(s.util.waterOff).toBe(true);
      console.log(`seed ${seed}: ${steps} steps, ${deaths} deaths, ${s.zombies.length} zombies, ${Object.keys(s.fires).length} fires, log ${s.log.length}, first death at ${firstDeath.toFixed(1)}h`, causes);
    }, 600000);
  }
});
