import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { blankControls, simStep } from '../src/sim/step';
import { emitNoise } from '../src/sim/noise';

describe('performance', () => {
  it('keeps a simulation step cheap even when a gunshot pulls a crowd', () => {
    const s = newGame(555, { name: 'Perf', occupation: 'unemployed', traits: [] });
    const rt = new Runtime(s);
    const pf = new PathFinder(s.world);
    refreshVehOcc(s, pf);
    resetWorldSystems();
    rebuildZGrid(s, rt);
    const c = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
    // survivor stands in the middle of Main Street and fires
    s.player.x = 150.5;
    s.player.y = 151.5;
    emitNoise(s, rt, { x: s.player.x, y: s.player.y, radius: 60, kind: 'gunshot', src: 'player' });
    let worst = 0;
    const t0 = performance.now();
    let steps = 0;
    for (let t = 0; t < 30; t += 1 / 30) {
      const a = performance.now();
      simStep(c, 1 / 30, 1 / 30, true);
      worst = Math.max(worst, performance.now() - a);
      steps++;
      if (s.player.dead) break;
    }
    const avg = (performance.now() - t0) / steps;
    const drawn = s.zombies.filter((z) => z.state === 'investigate' || z.state === 'chase' || z.state === 'search').length;
    console.log(`avg ${avg.toFixed(2)} ms, worst ${worst.toFixed(1)} ms, ${drawn} zombies drawn in`);
    expect(drawn).toBeGreaterThan(15);
    expect(avg).toBeLessThan(6);
  });
});
