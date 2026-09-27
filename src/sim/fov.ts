// Symmetric-ish recursive shadowcasting over the tile grid.
const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

export function shadowcast(
  ox: number, oy: number, radius: number,
  blocks: (x: number, y: number) => boolean,
  visit: (x: number, y: number) => void,
): void {
  visit(ox, oy);
  for (let oct = 0; oct < 8; oct++) {
    cast(ox, oy, 1, 1.0, 0.0, radius, MULT[0][oct], MULT[1][oct], MULT[2][oct], MULT[3][oct], blocks, visit);
  }
}

function cast(
  cx: number, cy: number, row: number, start: number, end: number, radius: number,
  xx: number, xy: number, yx: number, yy: number,
  blocks: (x: number, y: number) => boolean, visit: (x: number, y: number) => void,
): void {
  if (start < end) return;
  const r2 = (radius + 0.5) * (radius + 0.5);
  let newStart = 0;
  for (let j = row; j <= radius; j++) {
    let dx = -j - 1;
    const dy = -j;
    let blocked = false;
    while (dx <= 0) {
      dx += 1;
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (end > lSlope) break;
      if (dx * dx + dy * dy < r2) visit(X, Y);
      const b = blocks(X, Y);
      if (blocked) {
        if (b) {
          newStart = rSlope;
          continue;
        }
        blocked = false;
        start = newStart;
      } else if (b && j < radius) {
        blocked = true;
        cast(cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, blocks, visit);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}

/** Bresenham line walk; returns false if the callback returns false. */
export function walkLine(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number) => boolean): boolean {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 400; guard++) {
    if (!cb(x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return true;
}
