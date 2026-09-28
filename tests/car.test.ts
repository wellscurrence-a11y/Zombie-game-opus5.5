import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { exitVehicle, refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { newZombie } from '../src/sim/population';
import { createVehicle } from '../src/sim/vehicleSpecs';
import { Rng } from '../src/core/rng';
import { collides } from '../src/sim/worldq';
import { PLAYER_R } from '../src/sim/player';
import type { GameState, Vehicle } from '../src/sim/types';

function harness(seed = 1200) {
  const s = newGame(seed, { name: 'Test', occupation: 'unemployed', traits: [] });
  const rt = new Runtime(s);
  const pf = new PathFinder(s.world);
  refreshVehOcc(s, pf);
  resetWorldSystems();
  const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
  const run = (seconds: number, dt = 0.05): void => {
    for (let t = 0; t < seconds; t += dt) {
      rebuildZGrid(s, rt);
      simStep(c, dt, dt, true);
      if (s.player.dead) break;
    }
  };
  return { s, rt, pf, c, run };
}

/** A street-parked car, running straight along the road. */
function streetCar(s: GameState): Vehicle {
  const w = s.world;
  return s.vehicles.find((v) => !v.wrecked && (Math.abs(v.heading) < 0.01 || Math.abs(v.heading - Math.PI) < 0.01) && w.ground[Math.floor(v.y) * w.w + Math.floor(v.x)] === 3)!;
}

function sitIn(s: GameState, v: Vehicle): void {
  s.player.inVehicle = v.id;
  s.player.x = v.x;
  s.player.y = v.y;
}

describe('cars', () => {
  it('always lets you out, even when wedged between two cars', () => {
    const { s, rt, pf, c } = harness();
    const v = streetCar(s);
    const rng = new Rng(5);
    // box it in on both sides
    for (const side of [-1, 1]) {
      const o = createVehicle(s.world, rng, s, s.vehicles.length, { x: v.x - Math.sin(v.heading) * side * 1.95, y: v.y + Math.cos(v.heading) * side * 1.95, heading: v.heading, crashed: false, key: 'none' });
      s.vehicles.push(o);
    }
    refreshVehOcc(s, pf);
    sitIn(s, v);
    exitVehicle(c);
    expect(s.player.inVehicle).toBe(-1);
    expect(collides(s, s.player.x, s.player.y, PLAYER_R)).toBe(false);
    void rt;
  });

  it('brakes to a stop and then lets you out when you ask while moving', () => {
    const { s, c, run } = harness(1201);
    s.zombies = [];
    const v = streetCar(s);
    sitIn(s, v);
    v.speed = 9;
    exitVehicle(c);
    expect(s.player.inVehicle).toBe(v.id);
    run(2);
    expect(s.player.inVehicle).toBe(-1);
    expect(Math.abs(v.speed)).toBeLessThan(1.6);
  });

  it('is no safe haven: the dead break the glass and get at you', () => {
    const { s, run } = harness(1202);
    s.time = 24 + 12;
    const v = streetCar(s);
    sitIn(s, v);
    s.zombies = [];
    const rng = new Rng(9);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const z = newZombie(s, rng, v.x + Math.cos(a) * 3.2, v.y + Math.sin(a) * 3.2);
      z.state = 'chase';
      z.lastSeenX = v.x;
      z.lastSeenY = v.y;
      z.sinceSeen = 0;
      z.interest = 100;
      s.zombies.push(z);
    }
    const hp0 = s.player.body.health;
    run(150);
    expect(v.windows.some((g) => g >= 2)).toBe(true);
    const hurt = s.player.body.injuries.length > 0 || s.player.body.health < hp0 || s.player.inVehicle < 0 || s.player.dead;
    expect(hurt).toBe(true);
  }, 60000);
});
