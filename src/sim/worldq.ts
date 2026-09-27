// World queries shared by movement, vision, sound and pathfinding.
import { FURN } from '../world/furniture';
import { G, S, type World, WIN_BROKEN, WIN_CLEARED, WIN_OPEN } from '../world/world';
import type { GameState, Vehicle } from './types';
import { inVehicle, vehClosest } from './vehicleSpecs';

export function blocksSight(w: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return true;
  const i = y * w.w + x;
  const s = w.struct[i];
  switch (s) {
    case S.Wall:
    case S.BuiltWall:
    case S.Tree:
      return true;
    case S.Door: {
      const d = w.doors[w.structRef[i]];
      return !d.open && !d.broken && d.kind !== 'glass' && d.kind !== 'cell' && d.kind !== 'gate';
    }
    case S.Window: {
      const win = w.windows[w.structRef[i]];
      return win.curtainsClosed || win.sheet || win.planks >= 3;
    }
    case S.FenceHigh:
      return w.structRef[i] === 0;
    default:
      break;
  }
  const f = w.furn[i];
  if (f >= 0 && FURN[w.furniture[f].kind].tall) return true;
  return false;
}

/** Sound attenuation for a tile (extra "distance" sound pays to pass it). */
export function soundCost(w: World, i: number): number {
  const s = w.struct[i];
  if (s === S.Wall || s === S.BuiltWall) return 5;
  if (s === S.Door) {
    const d = w.doors[w.structRef[i]];
    return d.open || d.broken ? 0 : 3;
  }
  if (s === S.Window) {
    const win = w.windows[w.structRef[i]];
    if (win.state === WIN_OPEN || win.state === WIN_BROKEN || win.state === WIN_CLEARED) return 0.5;
    return 2.2 + win.planks * 0.3;
  }
  return 0;
}

export const enum Shape {
  None = 0,
  /** Blocks the whole tile but walls are thin, so walkers may approach the tile edge. */
  Thin = 1,
  Box = 2,
  Tree = 3,
}

export function tileShape(w: World, i: number): Shape {
  const s = w.struct[i];
  switch (s) {
    case S.Wall:
    case S.BuiltWall:
    case S.Window:
    case S.FenceLow:
    case S.FenceHigh:
      return Shape.Thin;
    case S.Door: {
      const d = w.doors[w.structRef[i]];
      return d.open || d.broken ? Shape.None : Shape.Thin;
    }
    case S.Tree:
      return Shape.Tree;
    default:
      break;
  }
  if (w.ground[i] === G.Water) return Shape.Thin;
  const f = w.furn[i];
  if (f >= 0 && FURN[w.furniture[f].kind].solid) return Shape.Box;
  return Shape.None;
}

const THIN_R = 0.05;

function circleBox(px: number, py: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const cx = px < x0 ? x0 : px > x1 ? x1 : px;
  const cy = py < y0 ? y0 : py > y1 ? y1 : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy < r * r;
}

export interface CollideOpts {
  /** Ignore this vehicle (the one being entered/exited). */
  ignoreVehicle?: number;
  /** Tiles that are passable regardless (e.g. the window being climbed). */
  passTile?: number;
}

/** Does a circle at (px,py) overlap anything solid? */
export function collides(s: GameState, px: number, py: number, r: number, opts: CollideOpts = {}): boolean {
  const w = s.world;
  const x0 = Math.floor(px - r - 0.5);
  const x1 = Math.floor(px + r + 0.5);
  const y0 = Math.floor(py - r - 0.5);
  const y1 = Math.floor(py + r + 0.5);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) {
        if (circleBox(px, py, r, x, y, x + 1, y + 1)) return true;
        continue;
      }
      const i = y * w.w + x;
      if (i === opts.passTile) continue;
      const sh = tileShape(w, i);
      if (sh === Shape.None) continue;
      if (sh === Shape.Thin) {
        if (circleBox(px, py, THIN_R, x, y, x + 1, y + 1)) return true;
      } else if (sh === Shape.Box) {
        if (circleBox(px, py, r, x + 0.08, y + 0.08, x + 0.92, y + 0.92)) return true;
      } else if (sh === Shape.Tree) {
        const dx = px - (x + 0.5);
        const dy = py - (y + 0.5);
        if (dx * dx + dy * dy < (r + 0.18) * (r + 0.18)) return true;
      }
    }
  }
  for (const v of s.vehicles) {
    if (v.id === opts.ignoreVehicle) continue;
    if (Math.abs(v.x - px) > 5 || Math.abs(v.y - py) > 5) continue;
    const c = vehClosest(v, px, py);
    if (c.inside) return true;
    const dx = px - c.x;
    const dy = py - c.y;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Move a circle with sliding collision; returns how far it actually moved. */
export function moveCircle(s: GameState, e: { x: number; y: number }, dx: number, dy: number, r: number, opts: CollideOpts = {}): { hitX: boolean; hitY: boolean } {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.08));
  const sx = dx / steps;
  const sy = dy / steps;
  let hitX = false;
  let hitY = false;
  for (let k = 0; k < steps; k++) {
    if (!hitX) {
      const nx = e.x + sx;
      if (!collides(s, nx, e.y, r, opts)) e.x = nx;
      else hitX = true;
    }
    if (!hitY) {
      const ny = e.y + sy;
      if (!collides(s, e.x, ny, r, opts)) e.y = ny;
      else hitY = true;
    }
  }
  return { hitX, hitY };
}

export function vehicleAt(s: GameState, x: number, y: number, pad = 0): Vehicle | null {
  for (const v of s.vehicles) if (inVehicle(v, x, y, pad)) return v;
  return null;
}

export function isOutdoorTile(w: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return true;
  return w.room[y * w.w + x] < 0;
}

/** Is there an unobstructed line of sight between two points (tile-level)? */
export function lineOfSight(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  let ax = Math.floor(x0);
  let ay = Math.floor(y0);
  const bx = Math.floor(x1);
  const by = Math.floor(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 300; guard++) {
    if (ax === bx && ay === by) return true;
    const e2 = 2 * err;
    const px = ax;
    const py = ay;
    let stepX = false;
    let stepY = false;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
      stepX = true;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
      stepY = true;
    }
    // no peeking through the diagonal gap between two walls
    if (stepX && stepY && blocksSight(w, px + sx, py) && blocksSight(w, px, py + sy)) return false;
    if (ax === bx && ay === by) return true;
    if (blocksSight(w, ax, ay)) return false;
  }
  return true;
}
