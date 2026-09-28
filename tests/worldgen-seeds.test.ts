import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/gen';
import { G, S, type World } from '../src/world/world';
import { FURN } from '../src/world/furniture';

function unreachableRooms(w: World): string[] {
  const seen = new Uint8Array(w.w * w.h);
  const start = 150 * w.w + 17; // the highway
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w.w;
    const y = (i / w.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const j = ny * w.w + nx;
      if (seen[j]) continue;
      const s = w.struct[j];
      if (s === S.Wall || s === S.Window || s === S.Tree || w.ground[j] === G.Water) continue;
      const f = w.furn[j];
      if (f >= 0 && FURN[w.furniture[f].kind].solid && !FURN[w.furniture[f].kind].vault) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return w.rooms.filter((r) => {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (w.room[y * w.w + x] === r.id && seen[y * w.w + x]) return false;
    return true;
  }).map((r) => `${w.buildings[r.bld].name}:${r.type}`);
}

describe('every shuffled town', () => {
  const seeds = [1, 2, 3, 777, 4242, 99991, 31337, 123456];
  const worlds = seeds.map((seed) => ({ seed, ...generateWorld(seed) }));

  it('has every kind of place, including the new ones', () => {
    for (const { seed, world: w, houses } of worlds) {
      const kinds = new Set(w.buildings.map((b) => b.kind));
      for (const k of ['police', 'firestation', 'gunstore', 'sporting', 'hospital', 'school', 'military', 'grocery', 'hardware', 'pharmacy', 'clinic', 'gas', 'motel', 'church', 'apartment', 'warehouse', 'factory']) {
        expect(kinds.has(k as never), `${k} in world ${seed}`).toBe(true);
      }
      expect(houses.length, `houses in ${seed}`).toBeGreaterThan(30);
    }
  });

  it('puts places on different blocks in different worlds', () => {
    const where = worlds.map(({ world: w }) => {
      const b = w.buildings.find((x) => x.kind === 'police')!;
      return `${Math.round(b.x0 / 10)},${Math.round(b.y0 / 10)}`;
    });
    expect(new Set(where).size).toBeGreaterThan(3);
  });

  it('never overlaps buildings', () => {
    for (const { seed, world: w } of worlds) {
      for (const a of w.buildings) for (const b of w.buildings) {
        if (a.id >= b.id) continue;
        const overlap = a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
        expect(overlap, `${a.name} overlaps ${b.name} in ${seed}`).toBe(false);
      }
    }
  });

  it('connects every room to the outside and keeps doors usable', () => {
    for (const { seed, world: w } of worlds) {
      expect(unreachableRooms(w), `world ${seed}`).toEqual([]);
      let bad = 0;
      for (const d of w.doors) {
        const a = d.vertical ? [d.x - 1, d.y] : [d.x, d.y - 1];
        const c = d.vertical ? [d.x + 1, d.y] : [d.x, d.y + 1];
        for (const [x, y] of [a, c]) {
          const i = y * w.w + x;
          const f = w.furn[i];
          if (w.struct[i] === S.Wall || w.struct[i] === S.Window || (f >= 0 && FURN[w.furniture[f].kind].solid)) bad++;
        }
      }
      expect(bad, `blocked doors in ${seed}`).toBe(0);
      for (const b of w.buildings) expect(b.doors.some((d) => w.doors[d].ext), `${b.name} exit in ${seed}`).toBe(true);
    }
  });

  it('parks cars where cars can be, and the fire engine in its bay', () => {
    for (const { seed, world: w, vehicles } of worlds) {
      for (const v of vehicles) {
        const i = Math.floor(v.y) * w.w + Math.floor(v.x);
        expect(w.struct[i] === S.Wall || w.struct[i] === S.Window || w.ground[i] === G.Water, `car in a wall at ${v.x},${v.y} in ${seed}`).toBe(false);
      }
      const fire = vehicles.find((v) => v.type === 'firetruck');
      expect(fire, `fire engine in ${seed}`).toBeTruthy();
      const bay = w.rooms[w.room[Math.floor(fire!.y) * w.w + Math.floor(fire!.x)]];
      expect(bay?.type, `fire engine location in ${seed}`).toBe('fireBay');
    }
  });
});
