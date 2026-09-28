import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { updateVision } from '../src/sim/vision';
import { computeLights } from '../src/sim/lighting';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { collides } from '../src/sim/worldq';
import { G } from '../src/world/world';

function harness(seed: number) {
  const s = newGame(seed, { name: 'Test', occupation: 'unemployed', traits: [] });
  const rt = new Runtime(s);
  const pf = new PathFinder(s.world);
  refreshVehOcc(s, pf);
  resetWorldSystems();
  rebuildZGrid(s, rt);
  updateVision(s, rt, true);
  computeLights(s, rt);
  const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
  const run = (seconds: number, dt = 0.25): void => {
    for (let t = 0; t < seconds; t += dt) simStep(c, dt, dt, t === 0);
  };
  return { s, rt, pf, run };
}

/** Makes the next world event (checked every 15 game minutes, ~28 s) the given kind. */
function force(s: ReturnType<typeof harness>['s'], rt: Runtime, kind: string): void {
  const orig = rt.rng.weighted.bind(rt.rng);
  let used = false;
  rt.rng.weighted = (<T>(entries: readonly (readonly [T, number])[]): T => {
    if (!used && entries.some((e) => e[0] === kind)) {
      used = true;
      return kind as T;
    }
    return orig(entries);
  }) as typeof rt.rng.weighted;
  s.events.nextEventT = s.time;
}

describe('world events', () => {
  it('sets a distant building on fire, and the fire spreads and burns out', () => {
    const { s, rt, run } = harness(301);
    s.time = 24 * 4 + 12;
    s.weather.rain = 0;
    force(s, rt, 'fire');
    run(30);
    const started = Object.keys(s.fires).length;
    expect(started).toBeGreaterThan(0);
    const p = s.player;
    for (const k of Object.keys(s.fires)) {
      const i = Number(k);
      expect(Math.hypot((i % s.world.w) - p.x, Math.floor(i / s.world.w) - p.y)).toBeGreaterThan(30);
    }
    run(120);
    expect(Object.keys(s.fires).length + s.world.ground.filter((g) => g === G.Burnt).length).toBeGreaterThan(started);
  }, 60000);

  it('leaves a solid wreck and its dead driver after a crash', () => {
    const { s, rt, run } = harness(302);
    const before = s.vehicles.length;
    const zBefore = s.zombies.length;
    force(s, rt, 'crash');
    run(30);
    expect(s.vehicles.length).toBe(before + 1);
    expect(s.zombies.length).toBe(zBefore + 1);
    const v = s.vehicles[before];
    expect(Math.hypot(v.x - s.player.x, v.y - s.player.y)).toBeGreaterThan(40);
    // the new wreck blocks movement straight away
    expect(collides(s, v.x, v.y, 0.27)).toBe(true);
  });

  for (const seed of [303, 306, 309, 312]) it(`moves a group toward town without ever placing it near the survivor (${seed})`, () => {
    const { s, rt, run } = harness(seed);
    const ids = new Set(s.zombies.map((z) => z.id));
    const gid = s.nextGroupId;
    const start = new Map(s.zombies.map((z) => [z.id, Math.hypot(z.x - s.player.x, z.y - s.player.y)]));
    force(s, rt, 'migration');
    run(30);
    const group = s.zombies.filter((z) => z.group === gid);
    expect(group.length).toBeGreaterThan(0);
    for (const z of group) {
      // either walked in from the map edge, or was already far away and started to drift
      if (ids.has(z.id)) expect(start.get(z.id)).toBeGreaterThan(70);
      else expect(Math.hypot(z.x - s.player.x, z.y - s.player.y)).toBeGreaterThan(95);
    }
  });

  it('flies a helicopter over and draws the dead after it', () => {
    const { s, rt, run } = harness(304);
    s.time = 24 * 2 + 10;
    force(s, rt, 'helicopter');
    run(30);
    expect(s.events.heli?.active).toBe(true);
    expect(s.events.helicopterDone).toBe(true);
    // count the most zombies pulled along at any point during the flyover
    let drawn = 0;
    for (let k = 0; k < 20; k++) {
      run(10);
      drawn = Math.max(drawn, s.zombies.filter((z) => z.state === 'investigate' || z.state === 'search' || z.state === 'chase').length);
    }
    expect(drawn).toBeGreaterThan(5);
  }, 60000);

  for (const kind of ['gunfire', 'survivor', 'alarm']) {
    it(`runs a ${kind} event without errors`, () => {
      const { s, rt, run } = harness(305);
      s.time = 24 * 2 + 10;
      force(s, rt, kind);
      expect(() => run(60)).not.toThrow();
    }, 60000);
  }
});
