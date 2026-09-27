import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc, startEngine } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { newZombie } from '../src/sim/population';
import { makeItem } from '../src/sim/items';
import { swingTime } from '../src/sim/combat';
import { S } from '../src/world/world';
import type { GameState } from '../src/sim/types';

function harness(seed = 900) {
  const s = newGame(seed, { name: 'Test', occupation: 'unemployed', traits: [] });
  const rt = new Runtime(s);
  const pf = new PathFinder(s.world);
  refreshVehOcc(s, pf);
  resetWorldSystems();
  const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
  const run = (seconds: number, dt = 0.05, each?: () => void): void => {
    for (let t = 0; t < seconds; t += dt) {
      each?.();
      rebuildZGrid(s, rt);
      simStep(c, dt, dt, true);
      if (s.player.dead) break;
    }
  };
  return { s, rt, pf, c, run };
}

function openRoad(s: GameState): { x: number; y: number } {
  const w = s.world;
  for (let y = 150; y < 160; y++) for (let x = 100; x < 140; x++) {
    let ok = true;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) if (w.struct[(y + dy) * w.w + x + dx] !== S.None) ok = false;
    if (ok) return { x: x + 0.5, y: y + 0.5 };
  }
  throw new Error('no open road');
}

describe('combat', () => {
  it('kills a single zombie with a bat in a few swings', () => {
    const { s, rt, c, run } = harness();
    const p = s.player;
    const spot = openRoad(s);
    p.x = spot.x;
    p.y = spot.y;
    p.facing = 0;
    s.zombies = [];
    s.vehicles = [];
    const bat = makeItem(s, 'bat');
    p.inventory.push(bat);
    p.primary = bat.uid;
    const z = newZombie(s, rt.rng, p.x + 1.1, p.y);
    z.facing = Math.PI;
    s.zombies.push(z);
    let swings = 0;
    run(12, 0.05, () => {
      p.facing = Math.atan2(z.y - p.y, z.x - p.x);
      c.controls.attack = p.attackT <= 0 && z.hp > 0;
      if (c.controls.attack) swings++;
      c.controls.aimX = z.x;
      c.controls.aimY = z.y;
      c.controls.aimValid = true;
    });
    expect(z.hp).toBeLessThanOrEqual(0);
    expect(swings).toBeLessThan(10);
    expect(s.corpses.length).toBe(1);
  });

  it('swings slower when exhausted', () => {
    const { s } = harness();
    const p = s.player;
    const bat = makeItem(s, 'bat');
    p.inventory.push(bat);
    p.primary = bat.uid;
    p.needs.endurance = 1;
    const fresh = swingTime(s);
    p.needs.endurance = 0.05;
    const tired = swingTime(s);
    expect(tired).toBeGreaterThan(fresh * 1.4);
  });

  it('gets you hurt if you stand still among three of them', () => {
    const { s, rt, run } = harness(901);
    const p = s.player;
    const spot = openRoad(s);
    p.x = spot.x;
    p.y = spot.y;
    s.zombies = [];
    s.vehicles = [];
    for (const [dx, dy] of [[1, 0], [-1, 0.3], [0.2, 1]]) {
      const z = newZombie(s, rt.rng, p.x + dx, p.y + dy);
      z.speed = 0.9;
      z.state = 'chase';
      z.awareness = 1.5;
      z.lastSeenX = p.x;
      z.lastSeenY = p.y;
      z.sinceSeen = 0;
      s.zombies.push(z);
    }
    run(25);
    expect(p.body.injuries.length + (p.dead ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe('vehicles', () => {
  it('drives when started with the key, and burns fuel', () => {
    const { s, rt, c, run } = harness(902);
    const p = s.player;
    s.zombies = [];
    const w = s.world;
    const v = s.vehicles.find((vv) => !vv.wrecked && (Math.abs(vv.heading) < 0.01 || Math.abs(vv.heading - Math.PI) < 0.01) && w.ground[Math.floor(vv.y) * w.w + Math.floor(vv.x)] === 3)!;
    v.fuel = 20;
    v.battery = 1;
    v.engine = 90;
    v.keyInIgnition = true;
    p.inVehicle = v.id;
    p.x = v.x;
    p.y = v.y;
    startEngine(c);
    // the key turn is a timed action; try a few times
    for (let k = 0; k < 6 && !v.engineOn; k++) {
      run(1.5);
      if (!v.engineOn && !rt.action) startEngine(c);
    }
    expect(v.engineOn).toBe(true);
    const x0 = v.x;
    const y0 = v.y;
    const fuel0 = v.fuel;
    c.drive.throttle = 1;
    run(1.5);
    c.drive.throttle = 0;
    expect(Math.hypot(v.x - x0, v.y - y0)).toBeGreaterThan(1);
    expect(v.fuel).toBeLessThan(fuel0);
  });
});
