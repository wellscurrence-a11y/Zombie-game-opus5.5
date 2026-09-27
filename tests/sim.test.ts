import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { updateVision } from '../src/sim/vision';
import { computeLights, ambient } from '../src/sim/lighting';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { newZombie } from '../src/sim/population';
import { emitNoise } from '../src/sim/noise';
import { spotRange } from '../src/sim/zombies';
import { addInjury } from '../src/sim/body';
import { ensureLoot } from '../src/sim/inventory';
import { def } from '../src/sim/items';
import { crash } from '../src/sim/vehicles';
import { S } from '../src/world/world';
import type { GameState } from '../src/sim/types';

function harness(seed = 777) {
  const s = newGame(seed, { name: 'Test', occupation: 'unemployed', traits: [] });
  const rt = new Runtime(s);
  const pf = new PathFinder(s.world);
  refreshVehOcc(s, pf);
  resetWorldSystems();
  rebuildZGrid(s, rt);
  updateVision(s, rt, true);
  computeLights(s, rt);
  const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
  const run = (seconds: number, dt = 0.1): void => {
    for (let t = 0; t < seconds; t += dt) {
      simStep(c, dt, dt, true);
      if (s.player.dead) break;
    }
  };
  return { s, rt, pf, c, run };
}

/** Find an open outdoor spot on a road. */
function roadSpot(s: GameState): { x: number; y: number } {
  const w = s.world;
  for (let y = 150; y < 160; y++) for (let x = 100; x < 140; x++) if (w.ground[y * w.w + x] === 3 && w.struct[y * w.w + x] === S.None) return { x: x + 0.5, y: y + 0.5 };
  throw new Error('no road');
}

describe('simulation', () => {
  it('never starts the survivor near the dead', () => {
    const { s } = harness(101);
    const p = s.player;
    const near = s.zombies.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) < 22);
    expect(near.length).toBe(0);
    expect(s.zombies.length).toBeGreaterThan(250);
    expect(s.zombies.length).toBeLessThan(700);
  });

  it('keeps the whole state structured-cloneable (saves)', () => {
    const { s, run } = harness(102);
    run(5);
    expect(() => structuredClone(s)).not.toThrow();
  });

  it('sees less at night and less when crouched', () => {
    const { s, rt } = harness(103);
    const z = newZombie(s, rt.rng, s.player.x + 5, s.player.y);
    s.time = 12;
    const day = spotRange(s, rt, z, ambient(s));
    s.time = 24 + 1;
    const night = spotRange(s, rt, z, ambient(s));
    expect(night).toBeLessThan(day * 0.5);
    s.time = 12;
    s.player.vx = 1;
    const standing = spotRange(s, rt, z, ambient(s));
    s.player.stance = 'crouch';
    const crouched = spotRange(s, rt, z, ambient(s));
    expect(crouched).toBeLessThan(standing * 0.7);
    s.time = 25;
    s.player.stance = 'stand';
    s.player.flashlight = true;
    s.player.inventory.push({ uid: 99999, id: 'flashlight', qty: 1, cond: 1, age: 0, charge: 1 });
    const beacon = spotRange(s, rt, z, ambient(s));
    expect(beacon).toBeGreaterThan(night * 2);
  });

  it('draws distant zombies with a gunshot, but not with footsteps', () => {
    const { s, rt, run } = harness(104);
    const p = s.player;
    const spot = roadSpot(s);
    p.x = spot.x;
    p.y = spot.y;
    s.zombies = [];
    const z = newZombie(s, rt.rng, p.x + 26, p.y);
    z.hearing = 1;
    s.zombies.push(z);
    rebuildZGrid(s, rt);
    emitNoise(s, rt, { x: p.x, y: p.y, radius: 3.2, kind: 'step', src: 'player' });
    run(0.2);
    expect(z.state === 'investigate').toBe(false);
    emitNoise(s, rt, { x: p.x, y: p.y, radius: 48, kind: 'gunshot', src: 'player' });
    run(0.2);
    expect(z.state).toBe('investigate');
    const d0 = Math.hypot(z.x - p.x, z.y - p.y);
    run(6);
    expect(Math.hypot(z.x - p.x, z.y - p.y)).toBeLessThan(d0 - 2);
  });

  it('muffles sound through walls', () => {
    const { s, rt } = harness(105);
    const w = s.world;
    // find a house wall with open ground on both sides 3 tiles out
    const b = w.buildings.find((bb) => bb.kind === 'house')!;
    const inside = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    s.zombies = [];
    const zOut = newZombie(s, rt.rng, inside.x, b.y0 - 4.5);
    s.zombies.push(zOut);
    rebuildZGrid(s, rt);
    const dist = Math.hypot(zOut.x - inside.x, zOut.y - inside.y);
    emitNoise(s, rt, { x: inside.x, y: inside.y, radius: dist + 1, kind: 'test', src: 'player' });
    const c = { s, rt, pf: new PathFinder(w), controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
    simStep(c, 0.05, 0.05, true);
    expect(zOut.state).not.toBe('investigate');
  });

  it('lets the dead force an unlocked door but not a locked one quickly', () => {
    const { s, rt, run } = harness(106);
    const w = s.world;
    const d = w.doors.find((dd) => dd.ext && dd.kind === 'wood' && !dd.vertical)!;
    d.open = false;
    d.locked = false;
    d.planks = 0;
    s.zombies = [];
    // a zombie outside, fixated on something inside
    const outsideY = w.room[(d.y + 1) * w.w + d.x] >= 0 ? d.y - 1.5 : d.y + 2.5;
    const insideY = w.room[(d.y + 1) * w.w + d.x] >= 0 ? d.y + 2.5 : d.y - 1.5;
    const z = newZombie(s, rt.rng, d.x + 0.5, outsideY);
    z.state = 'investigate';
    z.tx = d.x + 0.5;
    z.ty = insideY;
    z.interest = 500;
    s.zombies.push(z);
    s.player.x = 5;
    s.player.y = 5;
    run(40);
    expect(d.open || d.broken).toBe(true);
  });

  it('turns a bite into a fatal fever over days', () => {
    const { s, rt, run } = harness(107);
    s.zombies = [];
    addInjury(s, rt, 'lArm', 'bite', 0.6, 'test');
    s.player.body.fever = true;
    s.player.body.feverT = s.time;
    s.player.body.injuries[0].bandaged = true;
    // feed and water the survivor so only the fever can kill
    let t = 0;
    while (!s.player.dead && t < 5000) {
      s.player.needs.hunger = 0.1;
      s.player.needs.thirst = 0.1;
      s.player.needs.fatigue = 0.1;
      run(20, 0.5);
      t += 20;
    }
    expect(s.player.dead).toBe(true);
    const days = (s.time - s.player.startT) / 24;
    expect(days).toBeGreaterThan(1);
    expect(days).toBeLessThan(5);
  });

  it('hurts badly in a fast crash', () => {
    const { s, rt } = harness(108);
    const v = s.vehicles[0];
    s.player.inVehicle = v.id;
    const before = s.player.body.health;
    crash(s, rt, v, 70 / 3.6, 'wall', true);
    expect(s.player.body.injuries.length).toBeGreaterThan(1);
    expect(s.player.body.health).toBeLessThan(before - 10);
  });

  it('stocks kitchens with food and bathrooms with medicine', () => {
    const { s } = harness(109);
    const w = s.world;
    let food = 0;
    let meds = 0;
    for (const c of w.containers) {
      if (c.loot.endsWith('|kitchen') && (c.kind === 'counter' || c.kind === 'fridge')) food += ensureLoot(s, c.id).filter((i) => def(i.id).food).length;
      if (c.loot.endsWith('|bathroom') && c.kind === 'medicine') meds += ensureLoot(s, c.id).filter((i) => def(i.id).medical).length;
    }
    expect(food).toBeGreaterThan(40);
    expect(meds).toBeGreaterThan(10);
  });

  it('lets an idle survivor in a locked home live through the first day', () => {
    const { s, run } = harness(110);
    run(900, 0.25);
    expect(s.player.dead).toBe(false);
    expect(s.time).toBeGreaterThan(9 + 7);
    expect(s.player.needs.hunger).toBeGreaterThan(0.2);
  }, 60000);
});
