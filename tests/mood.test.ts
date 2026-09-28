import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/newgame';
import { Runtime, rebuildZGrid } from '../src/sim/runtime';
import { PathFinder } from '../src/sim/path';
import { refreshVehOcc } from '../src/sim/vehicles';
import { resetWorldSystems } from '../src/sim/world-systems';
import { blankControls, simStep, type SimCtx } from '../src/sim/step';
import { makeItem } from '../src/sim/items';
import { addXp } from '../src/sim/skills';
import { craft, eat, playCards, RECIPES, watchTV } from '../src/sim/use';
import { learnMult, updateMood, workMult } from '../src/sim/mood';
import { swingTime } from '../src/sim/combat';
import { vigor } from '../src/sim/stats';
import { treatments } from '../src/sim/medical';
import { addInjury } from '../src/sim/body';

function harness(seed = 1500) {
  const s = newGame(seed, { name: 'Test', occupation: 'unemployed', traits: [] });
  const rt = new Runtime(s);
  const pf = new PathFinder(s.world);
  refreshVehOcc(s, pf);
  resetWorldSystems();
  s.zombies = [];
  const c: SimCtx = { s, rt, pf, controls: blankControls(), drive: { throttle: 0, steer: 0, brake: false } };
  const run = (seconds: number, dt = 0.25): void => {
    for (let t = 0; t < seconds; t += dt) {
      rebuildZGrid(s, rt);
      simStep(c, dt, dt, true);
      // keep the body out of the picture
      Object.assign(s.player.needs, { hunger: 0.1, thirst: 0.1, fatigue: 0.2 });
    }
  };
  const finish = (): void => {
    for (let k = 0; k < 4000 && rt.action; k++) run(0.25);
  };
  return { s, rt, c, run, finish };
}

const HOUR = 3600 / 32; // real seconds per game hour at the default day length

describe('boredom and unhappiness', () => {
  it('builds up sitting indoors with nothing to do, and turns into unhappiness', () => {
    const { s, run } = harness();
    const w = s.world;
    const p = s.player;
    expect(w.room[Math.floor(p.y) * w.w + Math.floor(p.x)]).toBeGreaterThanOrEqual(0);
    run(HOUR * 20);
    expect(p.needs.boredom).toBeGreaterThan(0.5);
    run(HOUR * 14);
    expect(p.needs.boredom).toBeGreaterThan(0.85);
    expect(p.needs.unhappy).toBeGreaterThan(0.1);
  }, 120000);

  it('falls when you get outside', () => {
    const { s, rt } = harness(1501);
    const p = s.player;
    const w = s.world;
    const out = w.room.findIndex((r, i) => r < 0 && w.struct[i] === 0 && w.ground[i] === 3);
    p.x = (out % w.w) + 0.5;
    p.y = Math.floor(out / w.w) + 0.5;
    p.needs.boredom = 0.8;
    updateMood(s, rt, 6);
    expect(p.needs.boredom).toBeLessThan(0.55);
  });

  it('slows chores and learning, but not first aid, fighting or health', () => {
    const { s, rt, c } = harness(1502);
    const p = s.player;
    const base = { swing: swingTime(s), vigor: vigor(p) };
    const xp0 = p.xp.carpentry ?? 0;
    addXp(p, 'carpentry', 10);
    const happyGain = (p.xp.carpentry ?? 0) - xp0;
    p.needs.boredom = 1;
    p.needs.unhappy = 0.95;
    // fighting and body strength are untouched by mood
    expect(swingTime(s)).toBe(base.swing);
    expect(vigor(p)).toBe(base.vigor);
    expect(workMult(p)).toBeCloseTo(1.6);
    expect(learnMult(p)).toBeLessThan(0.3);
    const xp1 = p.xp.carpentry ?? 0;
    addXp(p, 'carpentry', 10);
    expect((p.xp.carpentry ?? 0) - xp1).toBeLessThan(happyGain * 0.35);
    // a chore takes longer...
    p.inventory.push(makeItem(s, 'sheet'));
    craft(c, RECIPES.find((r) => r.id === 'rags')!);
    expect(rt.action!.dur).toBeCloseTo(4 * 1.6, 1);
    rt.action = null;
    // ...first aid does not
    addInjury(s, rt, 'lArm', 'cut', 0.5, 'test');
    p.inventory.push(makeItem(s, 'bandage'));
    const bandage = treatments(c, p.body.injuries[0]).find((t) => /andage/.test(t.label));
    bandage?.run();
    expect(rt.action).not.toBeNull();
    const unslowed = rt.action!.dur;
    p.needs.unhappy = 0;
    rt.action = null;
    bandage!.run();
    expect(rt.action!.dur).toBeCloseTo(unslowed, 5);
  });

  it('never costs health by itself', () => {
    const { s, run } = harness(1503);
    const p = s.player;
    p.needs.boredom = 1;
    p.needs.unhappy = 1;
    const hp = p.body.health;
    run(HOUR * 6);
    expect(p.body.health).toBeGreaterThanOrEqual(hp);
    expect(p.dead).toBe(false);
  }, 60000);

  it('makes a very bored survivor restless and noisy indoors', () => {
    const { s, rt } = harness(1504);
    const p = s.player;
    p.needs.boredom = 1;
    let noises = 0;
    for (let k = 0; k < 40; k++) {
      rt.noises.length = 0;
      updateMood(s, rt, 0.25);
      p.needs.boredom = 1;
      noises += rt.noises.filter((n) => n.src === 'player').length;
    }
    expect(noises).toBeGreaterThan(1);
  });

  it('is eased by cards and TV (less each repeat), and worsened by dog food', () => {
    const { s, rt, c, finish } = harness(1505);
    const p = s.player;
    const cards = makeItem(s, 'cards');
    p.inventory.push(cards);
    p.needs.boredom = 0.9;
    playCards(c, cards.uid);
    finish();
    const first = 0.9 - p.needs.boredom;
    p.needs.boredom = 0.9;
    playCards(c, cards.uid);
    finish();
    const second = 0.9 - p.needs.boredom;
    expect(first).toBeGreaterThan(0.25);
    expect(second).toBeLessThan(first);
    // no power, no TV
    watchTV(c, false);
    expect(rt.action).toBeNull();
    p.needs.boredom = 0.9;
    watchTV(c, true);
    finish();
    expect(p.needs.boredom).toBeLessThan(0.6);
    // dog food
    p.needs.boredom = 0.3;
    p.needs.unhappy = 0.3;
    const df = makeItem(s, 'dogfood');
    p.inventory.push(df, makeItem(s, 'canopener'));
    eat(c, df.uid, 'opener');
    finish();
    expect(p.needs.boredom).toBeGreaterThan(0.3);
    expect(p.needs.unhappy).toBeGreaterThan(0.3);
  });
});
