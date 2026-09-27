// A* over the tile grid for zombies. Closed doors, windows and barricades are "passable" at a high
// cost: the zombie walks up to them and bangs until it gets through (or loses interest).
import { FURN } from '../world/furniture';
import { G, S, type World, WIN_BROKEN, WIN_CLEARED, WIN_OPEN } from '../world/world';

export const INF = 1e9;

/** Cost for a zombie to enter tile i (INF = impassable). */
export function zombieCost(w: World, i: number, vehOcc: Uint8Array): number {
  if (vehOcc[i]) return INF;
  const gr = w.ground[i];
  if (gr === G.Water) return INF;
  const s = w.struct[i];
  switch (s) {
    case S.Wall:
    case S.Tree:
    case S.FenceHigh:
      return INF;
    case S.BuiltWall:
      return 45;
    case S.Door: {
      const d = w.doors[w.structRef[i]];
      if (d.open || d.broken) return d.planks > 0 ? 20 + d.planks * 8 : 1;
      return 14 + d.planks * 8;
    }
    case S.Window: {
      const win = w.windows[w.structRef[i]];
      if (win.planks > 0) return 22 + win.planks * 8;
      if (win.state === WIN_OPEN || win.state === WIN_BROKEN || win.state === WIN_CLEARED) return 5;
      return 12;
    }
    case S.FenceLow:
      return 6;
    case S.Bush:
      return 1.6;
    default:
      break;
  }
  const f = w.furn[i];
  if (f >= 0 && FURN[w.furniture[f].kind].solid) return INF;
  return gr === G.TallGrass ? 1.1 : 1;
}

/** Tiles that need to be broken through or climbed (a zombie can't cut corners past them). */
export function isObstacle(w: World, i: number): boolean {
  const s = w.struct[i];
  if (s === S.Door) {
    const d = w.doors[w.structRef[i]];
    return !(d.open || d.broken) || d.planks > 0;
  }
  return s === S.Window || s === S.BuiltWall || s === S.FenceLow;
}

export class PathFinder {
  private w: World;
  private g: Float32Array;
  private par: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heapI: Int32Array;
  private heapF: Float32Array;
  private hn = 0;
  vehOcc: Uint8Array;

  constructor(w: World) {
    this.w = w;
    const n = w.w * w.h;
    this.g = new Float32Array(n);
    this.par = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heapI = new Int32Array(n);
    this.heapF = new Float32Array(n);
    this.vehOcc = new Uint8Array(n);
  }

  private push(i: number, f: number): void {
    let k = this.hn++;
    const hi = this.heapI;
    const hf = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      hi[k] = hi[p];
      hf[k] = hf[p];
      k = p;
    }
    hi[k] = i;
    hf[k] = f;
  }

  private pop(): number {
    const hi = this.heapI;
    const hf = this.heapF;
    const top = hi[0];
    const n = --this.hn;
    if (n > 0) {
      const li = hi[n];
      const lf = hf[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hi[k] = hi[c];
        hf[k] = hf[c];
        k = c;
      }
      hi[k] = li;
      hf[k] = lf;
    }
    return top;
  }

  /**
   * Find a path of tile indices from (sx,sy) to (tx,ty). Returns null if nothing useful was found.
   * If the goal is unreachable within the budget, returns a path to the closest explored tile.
   */
  find(sx: number, sy: number, tx: number, ty: number, maxNodes = 2500): number[] | null {
    const w = this.w;
    const W = w.w;
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0 || sx >= W || tx >= W || sy >= w.h || ty >= w.h) return null;
    const start = sy * W + sx;
    const goal = ty * W + tx;
    if (start === goal) return [goal];
    this.gen++;
    const gen = this.gen;
    this.hn = 0;
    const h = (i: number): number => {
      const dx = Math.abs((i % W) - tx);
      const dy = Math.abs(((i / W) | 0) - ty);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.par[start] = -1;
    this.push(start, h(start));
    let best = start;
    let bestH = h(start);
    let expanded = 0;
    const vo = this.vehOcc;
    while (this.hn > 0 && expanded < maxNodes) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      expanded++;
      if (cur === goal) {
        best = goal;
        break;
      }
      const ch = h(cur);
      if (ch < bestH) {
        bestH = ch;
        best = cur;
      }
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const curObstacle = cur !== start && isObstacle(w, cur);
      for (let d = 0; d < 8; d++) {
        const dx = d < 3 ? d - 1 : d < 5 ? (d === 3 ? -1 : 1) : d - 6;
        const dy = d < 3 ? -1 : d < 5 ? 0 : 1;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= w.h) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const cost = zombieCost(w, ni, vo);
        if (cost >= INF) continue;
        const diag = dx !== 0 && dy !== 0;
        if (diag) {
          // no corner cutting, and never diagonally through doors/windows
          if (curObstacle || isObstacle(w, ni)) continue;
          const a = cy * W + nx;
          const b = ny * W + cx;
          if (zombieCost(w, a, vo) >= INF || zombieCost(w, b, vo) >= INF) continue;
          if (isObstacle(w, a) || isObstacle(w, b)) continue;
        }
        const ng = this.g[cur] + cost * (diag ? 1.414 : 1);
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.par[ni] = cur;
        this.push(ni, ng + h(ni));
      }
    }
    if (best === start) return null;
    const path: number[] = [];
    for (let i = best; i !== -1 && i !== start; i = this.par[i]) path.push(i);
    path.reverse();
    return path;
  }
}
