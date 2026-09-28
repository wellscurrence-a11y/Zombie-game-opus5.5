import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { makeItem } from '../src/sim/items';
import { countItem } from '../src/sim/inventory';
import { craft, RECIPES, repairWithTape } from '../src/sim/use';
import { fishCatch, furnitureUtilityActions, groundActions } from '../src/sim/world-actions';
import { G } from '../src/world/world';
import { fireWeapon } from '../src/sim/combat';
import { placeFurn } from '../src/world/gen/builder';

function harness(seed = 1400) {
  const s = newGame(seed, { name: 'Test', occupation: 'unemployed', traits: [] });
  const rt = new Runtime(s);
  const pf = new PathFinder(s.world);
  refreshVehOcc(s, pf);
  resetWorldSystems();
  s.zombies = [];
  const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
  const run = (seconds: number, dt = 0.1): void => {
    for (let t = 0; t < seconds; t += dt) {
      rebuildZGrid(s, rt);
      simStep(c, dt, dt, true);
      if (s.player.dead) break;
    }
  };
  /** Run until the current timed action (real or game-time) finishes. */
  const finish = (): void => {
    for (let k = 0; k < 4000 && rt.action; k++) run(0.25, 0.25);
  };
  return { s, rt, c, run, finish };
}

describe('new things to do', () => {
  it('catches fish at the river, better with bait, and wears the rod', () => {
    const { s, c } = harness();
    const w = s.world;
    const wi = w.ground.findIndex((g) => g === G.Water);
    expect(wi).toBeGreaterThan(0);
    const p = s.player;
    p.x = (wi % w.w) + 0.5;
    p.y = Math.floor(wi / w.w) - 0.5;
    expect(groundActions(c, wi % w.w, Math.floor(wi / w.w)).some((o) => o.label.startsWith('Fish here') && o.enabled === false)).toBe(true);
    p.inventory.push(makeItem(s, 'fishingRod'));
    let plain = 0;
    for (let k = 0; k < 35; k++) plain += fishCatch(c, 0, 0);
    // about 34 hours of fishing wears a rod out
    expect(p.inventory.some((i) => i.id === 'fishingRod')).toBe(false);
    const rod = makeItem(s, 'fishingRod');
    p.inventory.push(rod, makeItem(s, 'worms', { qty: 60 }));
    let baited = 0;
    for (let k = 0; k < 30; k++) baited += fishCatch(c, 0, 0);
    expect(rod.cond).toBeLessThan(0.2);
    expect(plain).toBeGreaterThan(5);
    expect(baited).toBeGreaterThan(plain);
    expect(countItem(s, 'worms')).toBe(0);
    expect(countItem(s, 'fish')).toBe(plain + baited);
  });

  it('cooks a stew over a campfire from a pot of water and three ingredients', () => {
    const { s, rt, c, finish } = harness(1401);
    const w = s.world;
    const p = s.player;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const gg = { w, rng: rt.rng, vehicles: [], uid: s } as unknown as Parameters<typeof placeFurn>[0];
    const fid = placeFurn(gg, 'campfire', x + 1, y, 0, w.bld[y * w.w + x + 1], 'none|none');
    const fire = w.furniture[fid];
    fire.fuel = 3;
    fire.on = true;
    fire.cookItems = [];
    p.inventory.push(makeItem(s, 'pot', { fill: 1, liquid: 'water' }), makeItem(s, 'potato'), makeItem(s, 'carrot'), makeItem(s, 'steak'));
    const opt = furnitureUtilityActions(c, fire).find((o) => o.label.startsWith('Cook a stew'));
    expect(opt?.enabled).not.toBe(false);
    opt!.run();
    finish();
    expect(countItem(s, 'stew')).toBe(1);
    expect(countItem(s, 'potato') + countItem(s, 'carrot') + countItem(s, 'steak')).toBe(0);
  });

  it('smokes raw meat and fish into jerky over a campfire', () => {
    const { s, rt, c, finish } = harness(1403);
    const w = s.world;
    const p = s.player;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const gg = { w, rng: rt.rng, vehicles: [], uid: s } as unknown as Parameters<typeof placeFurn>[0];
    const fire = w.furniture[placeFurn(gg, 'campfire', x + 1, y, 0, w.bld[y * w.w + x + 1], 'none|none')];
    fire.fuel = 4;
    fire.on = true;
    fire.cookItems = [];
    p.inventory.push(makeItem(s, 'steak'), makeItem(s, 'fish'));
    const jerky0 = countItem(s, 'jerky');
    furnitureUtilityActions(c, fire).find((o) => o.label.startsWith('Smoke'))!.run();
    finish();
    expect(countItem(s, 'jerky') - jerky0).toBe(3);
    expect(countItem(s, 'steak') + countItem(s, 'fish')).toBe(0);
  });

  it('shoots a crafted bow quietly and some arrows can be picked up', () => {
    const { s, rt, c, run, finish } = harness(1404);
    const p = s.player;
    p.inventory.push(makeItem(s, 'branch'), makeItem(s, 'twine'), makeItem(s, 'knife'), makeItem(s, 'stick', { qty: 10 }), makeItem(s, 'nails', { qty: 20 }));
    craft(c, RECIPES.find((r) => r.id === 'bow')!);
    finish();
    for (let k = 0; k < 3; k++) {
      craft(c, RECIPES.find((r) => r.id === 'arrows')!);
      finish();
    }
    const bow = p.inventory.find((i) => i.id === 'bow')!;
    expect(bow).toBeTruthy();
    expect(countItem(s, 'arrow')).toBe(9);
    p.primary = bow.uid;
    const floorArrows = (): number => Object.values(s.floor).flat().filter((i) => i.id === 'arrow').reduce((a, i) => a + i.qty, 0);
    const before = floorArrows();
    let loud = 0;
    for (let k = 0; k < 9; k++) {
      p.reloadT = 0;
      p.attackT = 0;
      bow.ammo = 1;
      c.controls.aimX = p.x + 3;
      c.controls.aimY = p.y + 0.2;
      rt.noises.length = 0;
      // fire directly (the input path is hold-to-aim, release-to-fire)
      fireWeapon(s, rt, p.x + 3, p.y + 0.2);
      loud = Math.max(loud, ...rt.noises.map((n) => n.radius));
      run(0.7);
    }
    expect(loud).toBeLessThanOrEqual(4);
    expect(floorArrows() - before).toBeGreaterThan(0);
  });

  it('turns a bat into a nail bat, and tape patches a worn weapon less each time', () => {
    const { s, c, finish } = harness(1402);
    const p = s.player;
    p.inventory.push(makeItem(s, 'bat'), makeItem(s, 'nails', { qty: 10 }), makeItem(s, 'hammer'));
    craft(c, RECIPES.find((r) => r.id === 'nailbat')!);
    finish();
    const nb = p.inventory.find((i) => i.id === 'nailbat')!;
    expect(nb).toBeTruthy();
    expect(countItem(s, 'nails')).toBe(2);
    nb.cond = 0.3;
    p.inventory.push(makeItem(s, 'ducttape'));
    repairWithTape(c, nb.uid);
    finish();
    const first = nb.cond - 0.3;
    repairWithTape(c, nb.uid);
    finish();
    const second = nb.cond - 0.3 - first;
    expect(first).toBeGreaterThan(0.25);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
  });
});
