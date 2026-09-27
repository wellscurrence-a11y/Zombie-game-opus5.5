import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/world/gen';
import { S, G } from '../src/world/world';
import { FURN } from '../src/world/furniture';

describe('world generation', () => {
  const res = generateWorld(12345);
  const w = res.world;

  it('is deterministic for a seed', () => {
    const b = generateWorld(12345).world;
    expect(b.buildings.length).toBe(w.buildings.length);
    expect(Buffer.from(b.struct).equals(Buffer.from(w.struct))).toBe(true);
  });

  it('creates a believable town', () => {
    const kinds = new Set(w.buildings.map((b) => b.kind));
    for (const k of ['house', 'grocery', 'pharmacy', 'hardware', 'police', 'clinic', 'gas', 'warehouse', 'farmhouse', 'barn', 'cabin', 'motel', 'apartment']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    expect(res.houses.length).toBeGreaterThan(25);
    expect(res.vehicles.length).toBeGreaterThan(40);
  });

  it('gives every building at least one exterior door', () => {
    for (const b of w.buildings) {
      const ext = b.doors.map((d) => w.doors[d]).filter((d) => d.ext);
      expect(ext.length, `${b.name} #${b.id}`).toBeGreaterThan(0);
    }
  });

  it('keeps every door passable on both sides', () => {
    let bad = 0;
    for (const d of w.doors) {
      const a = d.vertical ? [d.x - 1, d.y] : [d.x, d.y - 1];
      const c = d.vertical ? [d.x + 1, d.y] : [d.x, d.y + 1];
      for (const [x, y] of [a, c]) {
        const i = y * w.w + x;
        const s = w.struct[i];
        const f = w.furn[i];
        if (s === S.Wall || s === S.Window || (f >= 0 && FURN[w.furniture[f].kind].solid)) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('connects every room to the outside', () => {
    // flood from outside through open floor and doors
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
    const unreachable = w.rooms.filter((r) => {
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (w.room[y * w.w + x] === r.id && seen[y * w.w + x]) return false;
      return true;
    });
    expect(unreachable.map((r) => `${w.buildings[r.bld].name}:${r.type}`)).toEqual([]);
  });

  it('dumps an ASCII map when requested', () => {
    if (!process.env.DUMP_MAP) return;
    const ch: string[] = [];
    for (let y = 0; y < w.h; y++) {
      let line = '';
      for (let x = 0; x < w.w; x++) {
        const i = y * w.w + x;
        const s = w.struct[i];
        const f = w.furn[i];
        let c = '.';
        const gr = w.ground[i];
        if (gr === G.Road) c = '=';
        else if (gr === G.DirtRoad) c = ':';
        else if (gr === G.Sidewalk) c = '-';
        else if (gr === G.Parking) c = '_';
        else if (gr === G.Water) c = '~';
        else if (gr === G.Bridge) c = '#';
        else if (gr === G.Forest) c = ',';
        else if (gr === G.TallGrass) c = '"';
        else if (gr === G.Furrow) c = 'm';
        else if (w.room[i] >= 0) c = ' ';
        if (s === S.Wall) c = 'X';
        else if (s === S.Door) c = w.doors[w.structRef[i]].ext ? 'D' : 'd';
        else if (s === S.Window) c = 'o';
        else if (s === S.FenceLow) c = '+';
        else if (s === S.FenceHigh) c = '|';
        else if (s === S.Tree) c = 'T';
        else if (s === S.Bush) c = '*';
        else if (f >= 0) c = 'f';
        line += c;
      }
      ch.push(line);
    }
    writeFileSync(process.env.DUMP_MAP, ch.join('\n'));
  });
});
