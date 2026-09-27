// Artificial light: street lamps, lit rooms, fires. Feeds both rendering and gameplay
// (you see — and are seen — much farther in light).
import { daylight, hourOfDay } from '../core/time';
import { S, type World } from '../world/world';
import { shadowcast } from './fov';
import type { Runtime } from './runtime';
import type { GameState } from './types';
import { blocksSight } from './worldq';

export function buildingPowered(s: GameState, bld: number): boolean {
  if (bld < 0) return false;
  if (!s.util.powerOff) return true;
  const b = s.world.buildings[bld];
  if (b.generator < 0) return false;
  const g = s.world.furniture[b.generator];
  return !!g && !g.gone && !!g.on && (g.fuel ?? 0) > 0;
}

function addLight(w: World, rt: Runtime, ox: number, oy: number, radius: number, intensity: number, r: number, g: number, b: number): void {
  shadowcast(ox, oy, radius, (x, y) => blocksSight(w, x, y), (x, y) => {
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) return;
    const d = Math.hypot(x - ox, y - oy);
    const k = intensity * Math.pow(Math.max(0, 1 - d / (radius + 0.5)), 1.4);
    if (k <= 0.005) return;
    const i = y * w.w + x;
    rt.light[i] += k;
    rt.lightColor[i * 3] += k * r;
    rt.lightColor[i * 3 + 1] += k * g;
    rt.lightColor[i * 3 + 2] += k * b;
  });
}

/** Recompute the static light map (lamps, rooms) plus current fires. */
export function computeLights(s: GameState, rt: Runtime): void {
  const w = s.world;
  rt.light.fill(0);
  rt.lightColor.fill(0);
  const h = hourOfDay(s.time);
  const dark = daylight(s.time) < 0.6 || h < 7 || h > 18;
  // street lamps run on the grid and switch on at dusk
  if (!s.util.powerOff && dark) {
    for (const l of w.lamps) {
      const f = w.furn[l.y * w.w + l.x];
      if (f < 0) continue;
      addLight(w, rt, l.x, l.y, 7, 0.55, 1.0, 0.82, 0.55);
    }
  }
  for (const room of w.rooms) {
    if (!room.light) continue;
    if (!buildingPowered(s, room.bld)) continue;
    for (let y = room.y0; y <= room.y1; y++) {
      for (let x = room.x0; x <= room.x1; x++) {
        const i = y * w.w + x;
        if (w.room[i] !== room.id) continue;
        rt.light[i] += 0.65;
        rt.lightColor[i * 3] += 0.65;
        rt.lightColor[i * 3 + 1] += 0.6;
        rt.lightColor[i * 3 + 2] += 0.5;
      }
    }
    // spill through windows and open doors
    for (let y = room.y0 - 1; y <= room.y1 + 1; y++) {
      for (let x = room.x0 - 1; x <= room.x1 + 1; x++) {
        if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
        const i = y * w.w + x;
        const st = w.struct[i];
        if (st !== S.Window && st !== S.Door) continue;
        if (st === S.Window) {
          const win = w.windows[w.structRef[i]];
          if (win.curtainsClosed || win.sheet || win.planks >= 3) continue;
        } else {
          const d = w.doors[w.structRef[i]];
          if (!d.open && !d.broken && d.kind !== 'glass') continue;
        }
        addLight(w, rt, x, y, 5, 0.35, 1, 0.9, 0.7);
      }
    }
  }
  // lamps inside powered rooms that the player switched on count as room light (handled above)
  addFires(s, rt);
  rt.lightDirty = false;
  rt.lightVersion++;
}

export function addFires(s: GameState, rt: Runtime): void {
  const w = s.world;
  for (const k of Object.keys(s.fires)) {
    const i = Number(k);
    const f = s.fires[i];
    addLight(w, rt, i % w.w, Math.floor(i / w.w), 6, 0.5 + f.heat * 0.5, 1, 0.55, 0.2);
  }
  for (const f of w.furniture) {
    if (f.gone || !f.on) continue;
    if (f.kind === 'campfire' || f.kind === 'bbq') addLight(w, rt, f.x, f.y, 5, 0.55, 1, 0.55, 0.2);
  }
}

/** Global ambient light level outdoors (0..1). */
export function ambient(s: GameState): number {
  const day = daylight(s.time);
  const wx = s.weather;
  const dim = 1 - wx.cloud * 0.3 - wx.rain * 0.25 - wx.fog * 0.15;
  const moon = 0.07 * (1 - wx.cloud * 0.6);
  return Math.max(moon, day * dim) + 0.01;
}

/** Light level at a tile for visibility purposes. */
export function tileLight(s: GameState, rt: Runtime, x: number, y: number, amb: number): number {
  const w = s.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  const i = y * w.w + x;
  const indoor = w.room[i] >= 0;
  return amb * (indoor ? 0.55 : 1) + rt.light[i];
}
