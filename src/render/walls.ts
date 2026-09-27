// Walls, doors, windows and fences as instanced boxes. Every piece belongs to a tile so it can be cut
// down (Sims-style cutaway) when it would hide the survivor.
import * as THREE from 'three';
import { S, type World, isWallish, WIN_BROKEN, WIN_CLEARED, WIN_OPEN, type Door, type Win } from '../world/world';
import { hash01 } from '../core/rng';
import { patchMaterial } from './shaderPatch';

export const WALL_H = 2.6;
export const WALL_T = 0.26;
export const CUT_H = 0.45;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** A set of instanced boxes; each piece remembers its layout so it can be re-cut. */
class PieceSet {
  mesh: THREE.InstancedMesh;
  n = 0;
  cap: number;
  // cx, cz, ang, sx, sz, yB, yT, roll
  d: Float32Array;
  tile: Int32Array;
  constructor(mat: THREE.Material, cap: number, shadows = true) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(unitBox, mat, cap);
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.d = new Float32Array(cap * 8);
    this.tile = new Int32Array(cap);
  }
  reset(): void {
    this.n = 0;
    this.mesh.count = 0;
  }
  add(cx: number, cz: number, sx: number, sz: number, yB: number, yT: number, color: number, tile: number, ang = 0, roll = 0): number {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    const o = i * 8;
    this.d[o] = cx;
    this.d[o + 1] = cz;
    this.d[o + 2] = ang;
    this.d[o + 3] = sx;
    this.d[o + 4] = sz;
    this.d[o + 5] = yB;
    this.d[o + 6] = yT;
    this.d[o + 7] = roll;
    this.tile[i] = tile;
    this.mesh.setColorAt(i, _c.setHex(color));
    this.write(i, 0);
    this.mesh.count = this.n;
    return i;
  }
  private grow(): void {
    const cap = this.cap * 2;
    const mesh = new THREE.InstancedMesh(unitBox, this.mesh.material, cap);
    mesh.castShadow = this.mesh.castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = this.mesh.frustumCulled;
    for (let i = 0; i < this.n; i++) {
      this.mesh.getMatrixAt(i, _m);
      mesh.setMatrixAt(i, _m);
      this.mesh.getColorAt(i, _c);
      mesh.setColorAt(i, _c);
    }
    const d = new Float32Array(cap * 8);
    d.set(this.d);
    const t = new Int32Array(cap);
    t.set(this.tile);
    const parent = this.mesh.parent;
    if (parent) {
      parent.remove(this.mesh);
      parent.add(mesh);
    }
    this.mesh.dispose();
    this.mesh = mesh;
    this.d = d;
    this.tile = t;
    this.cap = cap;
  }
  /** Write the matrix for piece i with cut factor k (0 = full height, 1 = cut down). */
  write(i: number, k: number): void {
    const o = i * 8;
    const yB = this.d[o + 5];
    const yT0 = this.d[o + 6];
    const yT = yT0 + (Math.min(yT0, CUT_H) - yT0) * k;
    if (yT <= yB + 0.01) {
      _m.makeScale(0, 0, 0);
    } else {
      _p.set(this.d[o], (yB + yT) / 2, this.d[o + 1]);
      _e.set(0, this.d[o + 2], this.d[o + 7]);
      _q.setFromEuler(_e);
      _s.set(this.d[o + 3], yT - yB, this.d[o + 4]);
      _m.compose(_p, _q, _s);
    }
    this.mesh.setMatrixAt(i, _m);
  }
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const INTERIOR = 0xd4cdbf;
const TRIM = 0xe6e0d2;
const FENCE_COLORS = [0x7d6a55, 0x8f969a, 0xe8e4da, 0x8a6a48, 0x7d8388];
const DOOR_WOOD = [0x6b4a32, 0x7a5638, 0x5a3f2c, 0x8a6a4a, 0x4f5b61, 0x6e2f28];
const CURTAINS = [0x7a4b4b, 0x5c6b7a, 0x8a7b5a, 0x6a7a5a, 0xa89a82, 0x4f4f5f];

const RCH = 32;

interface RenderChunk {
  solid: PieceSet;
  glass: PieceSet;
  chain: PieceSet;
}

export class WallLayer {
  group = new THREE.Group();
  /** Static pieces are split into 32x32-tile render chunks so off-screen walls are culled. */
  rchunks: RenderChunk[] = [];
  private rchW: number;
  private mats: { solid: THREE.Material; glass: THREE.Material; chain: THREE.Material };
  /** The chunk currently being filled by rebuildStatic. */
  private solid!: PieceSet;
  private glass!: PieceSet;
  private chain!: PieceSet;
  dyn: PieceSet;
  dynGlass: PieceSet;
  /** Per-tile cut factor (0 = full, 1 = cut), animated. */
  cut: Float32Array;
  cutTarget: Uint8Array;
  /** Tiles that have static pieces, bucketed by 8x8 chunk. */
  private chunks: number[][] = [];
  private chunkW: number;
  /** For each tile: [start, count] into pieceRefs of the solid/chain sets. */
  private refStart: Int32Array;
  private refCount: Int16Array;
  private refs: number[] = [];
  private active = new Set<number>();
  dynDirty = true;
  private w: World;

  constructor(w: World) {
    this.w = w;
    const solidMat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), { ao: true });
    const glassMat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }), {});
    const chainMat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), {});
    this.mats = { solid: solidMat, glass: glassMat, chain: chainMat };
    this.rchW = Math.ceil(w.w / RCH);
    const nch = this.rchW * Math.ceil(w.h / RCH);
    for (let k = 0; k < nch; k++) {
      const ch: RenderChunk = { solid: new PieceSet(solidMat, 512), glass: new PieceSet(glassMat, 32, false), chain: new PieceSet(chainMat, 64, false) };
      for (const ps of [ch.solid, ch.glass, ch.chain]) {
        ps.mesh.frustumCulled = true;
        this.group.add(ps.mesh);
      }
      this.rchunks.push(ch);
    }
    this.dyn = new PieceSet(solidMat, 8000);
    this.dynGlass = new PieceSet(glassMat, 4000, false);
    this.group.add(this.dyn.mesh, this.dynGlass.mesh);
    this.cut = new Float32Array(w.w * w.h);
    this.cutTarget = new Uint8Array(w.w * w.h);
    this.chunkW = Math.ceil(w.w / 8);
    this.refStart = new Int32Array(w.w * w.h).fill(-1);
    this.refCount = new Int16Array(w.w * w.h);
    this.rebuildStatic();
  }

  private chunkOf(x: number, y: number): RenderChunk {
    return this.rchunks[Math.floor(y / RCH) * this.rchW + Math.floor(x / RCH)];
  }

  rebuildStatic(): void {
    const w = this.w;
    for (const ch of this.rchunks) {
      ch.solid.reset();
      ch.glass.reset();
      ch.chain.reset();
    }
    this.refs = [];
    this.refStart.fill(-1);
    this.refCount.fill(0);
    this.chunks = [];
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        const i = y * w.w + x;
        const s = w.struct[i];
        if (s === S.None || s === S.Tree || s === S.Bush) continue;
        const ch = this.chunkOf(x, y);
        this.solid = ch.solid;
        this.glass = ch.glass;
        this.chain = ch.chain;
        const startSolid = this.solid.n;
        const startChain = this.chain.n;
        const startGlass = this.glass.n;
        if (s === S.Wall || s === S.BuiltWall) this.addWall(x, y, i, s === S.BuiltWall);
        else if (s === S.Door) this.addDoorFrame(x, y, i, w.doors[w.structRef[i]]);
        else if (s === S.Window) this.addWindowFrame(x, y, i, w.windows[w.structRef[i]]);
        else if (s === S.FenceLow || s === S.FenceHigh) this.addFence(x, y, i, s);
        this.refStart[i] = this.refs.length;
        for (let k = startSolid; k < this.solid.n; k++) this.refs.push(k);
        for (let k = startChain; k < this.chain.n; k++) this.refs.push(100000 + k);
        for (let k = startGlass; k < this.glass.n; k++) this.refs.push(200000 + k);
        this.refCount[i] = this.refs.length - this.refStart[i];
        const ci = Math.floor(y / 8) * this.chunkW + Math.floor(x / 8);
        (this.chunks[ci] ??= []).push(i);
      }
    }
    // Re-apply existing cut state
    for (let i = 0; i < this.cut.length; i++) if (this.cut[i] > 0) this.applyTile(i);
    for (const ch of this.rchunks) {
      for (const ps of [ch.solid, ch.glass, ch.chain]) {
        ps.commit();
        ps.mesh.visible = ps.n > 0;
        if (ps.n > 0) ps.mesh.computeBoundingSphere();
        if (ps.mesh.boundingSphere) ps.mesh.boundingSphere.radius += 3;
      }
    }
    this.dynDirty = true;
  }

  private conn(x: number, y: number): [boolean, boolean, boolean, boolean] {
    const w = this.w;
    const f = (xx: number, yy: number): boolean => isWallish(w, xx, yy);
    return [f(x, y - 1), f(x + 1, y), f(x, y + 1), f(x - 1, y)];
  }

  private wallColor(x: number, y: number, i: number, built: boolean): number {
    const w = this.w;
    if (built) return 0x8a6c4a;
    const b = w.bld[i];
    if (b < 0) return INTERIOR;
    const bb = w.buildings[b];
    const edge = x === bb.x0 || x === bb.x1 || y === bb.y0 || y === bb.y1;
    return edge ? bb.wallColor : INTERIOR;
  }

  private addWall(x: number, y: number, i: number, built: boolean): void {
    const [n, e, s, wv] = this.conn(x, y);
    const col = this.wallColor(x, y, i, built);
    const cx = x + 0.5;
    const cz = y + 0.5;
    const T = built ? WALL_T + 0.06 : WALL_T;
    const H = built ? 2.2 : WALL_H;
    if (!n && !e && !s && !wv) {
      this.solid.add(cx, cz, 0.7, 0.7, 0, H, col, i);
      return;
    }
    this.solid.add(cx, cz, T, T, 0, H, col, i);
    if (e) this.solid.add(x + 0.75, cz, 0.5, T, 0, H, col, i);
    if (wv) this.solid.add(x + 0.25, cz, 0.5, T, 0, H, col, i);
    if (n) this.solid.add(cx, y + 0.25, T, 0.5, 0, H, col, i);
    if (s) this.solid.add(cx, y + 0.75, T, 0.5, 0, H, col, i);
  }

  private addDoorFrame(x: number, y: number, i: number, d: Door): void {
    const col = this.wallColor(x, y, i, d.kind === 'built');
    const cx = x + 0.5;
    const cz = y + 0.5;
    const top = d.kind === 'garage' ? 2.3 : 2.15;
    const H = d.kind === 'built' ? 2.2 : WALL_H;
    if (!d.vertical) {
      this.solid.add(cx, cz, 1.0, WALL_T, top, H, col, i);
      this.solid.add(x + 0.03, cz, 0.06, WALL_T + 0.05, 0, top, TRIM, i);
      this.solid.add(x + 0.97, cz, 0.06, WALL_T + 0.05, 0, top, TRIM, i);
    } else {
      this.solid.add(cx, cz, WALL_T, 1.0, top, H, col, i);
      this.solid.add(cx, y + 0.03, WALL_T + 0.05, 0.06, 0, top, TRIM, i);
      this.solid.add(cx, y + 0.97, WALL_T + 0.05, 0.06, 0, top, TRIM, i);
    }
  }

  private addWindowFrame(x: number, y: number, i: number, win: Win): void {
    const col = this.wallColor(x, y, i, false);
    const cx = x + 0.5;
    const cz = y + 0.5;
    const sill = win.big ? 0.35 : 0.85;
    const head = win.big ? 2.3 : 2.05;
    if (!win.vertical) {
      this.solid.add(cx, cz, 1.0, WALL_T, 0, sill, col, i);
      this.solid.add(cx, cz, 1.0, WALL_T, head, WALL_H, col, i);
      this.solid.add(cx, cz, 1.0, WALL_T + 0.12, sill, sill + 0.05, TRIM, i);
      this.solid.add(x + 0.03, cz, 0.06, WALL_T + 0.04, sill, head, TRIM, i);
      this.solid.add(x + 0.97, cz, 0.06, WALL_T + 0.04, sill, head, TRIM, i);
    } else {
      this.solid.add(cx, cz, WALL_T, 1.0, 0, sill, col, i);
      this.solid.add(cx, cz, WALL_T, 1.0, head, WALL_H, col, i);
      this.solid.add(cx, cz, WALL_T + 0.12, 1.0, sill, sill + 0.05, TRIM, i);
      this.solid.add(cx, y + 0.03, WALL_T + 0.04, 0.06, sill, head, TRIM, i);
      this.solid.add(cx, y + 0.97, WALL_T + 0.04, 0.06, sill, head, TRIM, i);
    }
  }

  private addFence(x: number, y: number, i: number, s: S): void {
    const w = this.w;
    const style = w.structRef[i] < 0 ? (s === S.FenceHigh ? 0 : 2) : w.structRef[i];
    const col = FENCE_COLORS[style] ?? 0x7d6a55;
    const f = (xx: number, yy: number): boolean => {
      if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) return false;
      const st = w.struct[yy * w.w + xx];
      return st === S.FenceLow || st === S.FenceHigh || st === S.Wall;
    };
    let n = f(x, y - 1);
    let e = f(x + 1, y);
    let so = f(x, y + 1);
    let wv = f(x - 1, y);
    if (!n && !e && !so && !wv) {
      e = true;
      wv = true;
    }
    const cx = x + 0.5;
    const cz = y + 0.5;
    const high = s === S.FenceHigh;
    const H = high ? 1.95 : style === 4 ? 1.05 : 0.95;
    const post = style === 1 || style === 4 ? 0x70777c : style === 2 ? 0xe8e4da : 0x5e4a36;
    this.solid.add(cx, cz, 0.11, 0.11, 0, H + 0.05, post, i);
    const arms: [number, number, number, number][] = [];
    if (e) arms.push([x + 0.75, cz, 0.5, 0]);
    if (wv) arms.push([x + 0.25, cz, 0.5, 0]);
    if (n) arms.push([cx, y + 0.25, 0.5, 1]);
    if (so) arms.push([cx, y + 0.75, 0.5, 1]);
    for (const [ax, az, len, vert] of arms) {
      const sx = vert ? 0.06 : len;
      const sz = vert ? len : 0.06;
      if (style === 0) {
        this.solid.add(ax, az, vert ? 0.07 : len, vert ? len : 0.07, 0.05, H, col, i);
      } else if (style === 1) {
        this.chain.add(ax, az, vert ? 0.03 : len, vert ? len : 0.03, 0.05, H, 0x9aa2a8, i);
        this.solid.add(ax, az, sx, sz, H - 0.05, H, post, i);
      } else if (style === 2) {
        this.solid.add(ax, az, vert ? 0.05 : len, vert ? len : 0.05, 0.1, 0.85, col, i);
      } else {
        this.solid.add(ax, az, sx, sz, 0.42, 0.52, col, i);
        this.solid.add(ax, az, sx, sz, H - 0.1, H, col, i);
      }
    }
  }

  // ---------------------------------------------------------------- dynamic parts

  private inward(x: number, y: number, vertical: boolean, bld: number): number {
    const w = this.w;
    if (!vertical) {
      const i = (y + 1) * w.w + x;
      return w.room[i] >= 0 && w.bld[i] === bld ? 1 : -1;
    }
    const i = y * w.w + x + 1;
    return w.room[i] >= 0 && w.bld[i] === bld ? 1 : -1;
  }

  rebuildDynamic(): void {
    const w = this.w;
    this.dyn.reset();
    this.dynGlass.reset();
    for (const d of w.doors) this.addDoor(d);
    for (const win of w.windows) this.addWindow(win);
    for (let i = 0; i < this.dyn.n; i++) {
      const k = this.cut[this.dyn.tile[i]];
      if (k > 0) this.dyn.write(i, k);
    }
    for (let i = 0; i < this.dynGlass.n; i++) {
      const k = this.cut[this.dynGlass.tile[i]];
      if (k > 0) this.dynGlass.write(i, k);
    }
    this.dyn.commit();
    this.dynGlass.commit();
    this.dynDirty = false;
  }

  private addDoor(d: Door): void {
    const w = this.w;
    const i = d.y * w.w + d.x;
    if (w.struct[i] !== S.Door) return;
    const x = d.x;
    const y = d.y;
    const cx = x + 0.5;
    const cz = y + 0.5;
    const inward = this.inward(x, y, d.vertical, d.bld);
    const hcol = d.kind === 'metal' ? 0x7b8288 : d.kind === 'garage' ? 0xb9b8b0 : d.kind === 'cell' ? 0x3b3e42 : d.kind === 'built' ? 0x7a5a3a : DOOR_WOOD[Math.floor(hash01(x, y, 3) * DOOR_WOOD.length)];
    if (!d.broken) {
      if (d.kind === 'garage') {
        if (!d.open) {
          if (!d.vertical) this.dyn.add(cx, cz, 1.0, 0.08, 0, 2.3, hcol, i);
          else this.dyn.add(cx, cz, 0.08, 1.0, 0, 2.3, hcol, i);
        } else if (!d.vertical) this.dyn.add(cx, cz, 1.0, 0.3, 2.12, 2.3, hcol, i);
        else this.dyn.add(cx, cz, 0.3, 1.0, 2.12, 2.3, hcol, i);
      } else {
        const glass = d.kind === 'glass';
        const set = glass ? this.dynGlass : this.dyn;
        const leafCol = glass ? 0xbfd6dd : hcol;
        const top = d.kind === 'built' ? 1.9 : 2.1;
        if (!d.open) {
          if (!d.vertical) set.add(cx, cz, 0.9, 0.06, 0.02, top, leafCol, i);
          else set.add(cx, cz, 0.06, 0.9, 0.02, top, leafCol, i);
          if (glass) {
            if (!d.vertical) this.dyn.add(cx, cz, 0.92, 0.07, 0.02, 0.2, 0x5a5f63, i);
            else this.dyn.add(cx, cz, 0.07, 0.92, 0.02, 0.2, 0x5a5f63, i);
          }
        } else if (!d.vertical) {
          set.add(x + 0.07, cz + inward * 0.46, 0.06, 0.9, 0.02, top, leafCol, i);
        } else {
          set.add(cx + inward * 0.46, y + 0.07, 0.9, 0.06, 0.02, top, leafCol, i);
        }
      }
    }
    this.addPlanks(x, y, d.vertical, d.planks, inward, i, 0.2, 2.0);
  }

  private addPlanks(x: number, y: number, vertical: boolean, planks: number, side: number, i: number, y0: number, y1: number): void {
    if (planks <= 0) return;
    const cx = x + 0.5;
    const cz = y + 0.5;
    const off = (WALL_T / 2 + 0.05) * side;
    const hs = [0.25, 0.75, 0.45, 0.6];
    const rolls = [0.28, -0.3, 0.12, -0.1];
    for (let k = 0; k < planks; k++) {
      const py = y0 + (y1 - y0) * hs[k];
      if (!vertical) this.dyn.add(cx, cz + off, 1.15, 0.05, py - 0.07, py + 0.07, 0x9a7a52, i, 0, rolls[k]);
      else this.dyn.add(cx + off, cz, 1.15, 0.05, py - 0.07, py + 0.07, 0x9a7a52, i, Math.PI / 2, rolls[k]);
    }
  }

  private addWindow(win: Win): void {
    const w = this.w;
    const x = win.x;
    const y = win.y;
    const i = y * w.w + x;
    if (w.struct[i] !== S.Window) return;
    const cx = x + 0.5;
    const cz = y + 0.5;
    const sill = win.big ? 0.4 : 0.9;
    const head = win.big ? 2.3 : 2.05;
    const inward = this.inward(x, y, win.vertical, win.bld);
    const pane = (y0: number, y1: number): void => {
      if (!win.vertical) this.dynGlass.add(cx, cz, 0.94, 0.03, y0, y1, 0xbfd6dd, i);
      else this.dynGlass.add(cx, cz, 0.03, 0.94, y0, y1, 0xbfd6dd, i);
    };
    if (win.state === 0) pane(sill, head);
    else if (win.state === WIN_OPEN) pane((sill + head) / 2, head);
    else if (win.state === WIN_BROKEN) {
      // jagged shards left in the frame
      const shards: [number, number, number, number][] = [[-0.38, sill + 0.12, 0.18, 0.5], [0.36, sill + 0.08, 0.2, -0.6], [0.3, head - 0.12, 0.22, 0.4], [-0.3, head - 0.1, 0.25, -0.3]];
      for (const [ox, py, len, roll] of shards) {
        if (!win.vertical) this.dynGlass.add(cx + ox, cz, len, 0.03, py - 0.08, py + 0.08, 0xcfe0e6, i, 0, roll);
        else this.dynGlass.add(cx, cz + ox, len, 0.03, py - 0.08, py + 0.08, 0xcfe0e6, i, Math.PI / 2, roll);
      }
    }
    void WIN_CLEARED;
    if (win.curtains || win.sheet) {
      const col = win.sheet ? 0xd8d4c8 : CURTAINS[Math.floor(hash01(x, y, 9) * CURTAINS.length)];
      const off = (WALL_T / 2 + 0.05) * inward;
      const closed = win.curtainsClosed || win.sheet;
      if (closed) {
        if (!win.vertical) this.dyn.add(cx, cz + off, 0.98, 0.03, sill - 0.05, head, col, i);
        else this.dyn.add(cx + off, cz, 0.03, 0.98, sill - 0.05, head, col, i);
      } else {
        for (const side of [-0.4, 0.4]) {
          if (!win.vertical) this.dyn.add(cx + side, cz + off, 0.18, 0.05, sill - 0.05, head, col, i);
          else this.dyn.add(cx + off, cz + side, 0.05, 0.18, sill - 0.05, head, col, i);
        }
      }
    }
    this.addPlanks(x, y, win.vertical, win.planks, -inward, i, sill - 0.1, head + 0.05);
  }

  // ---------------------------------------------------------------- cutaway

  /** Set desired cut state for tiles in a rectangle via a predicate; animate toward it. */
  updateCut(px: number, py: number, radius: number, want: (x: number, y: number, i: number) => boolean, dt: number): void {
    const w = this.w;
    const cx0 = Math.max(0, Math.floor((px - radius) / 8));
    const cx1 = Math.min(this.chunkW - 1, Math.floor((px + radius) / 8));
    const cy0 = Math.max(0, Math.floor((py - radius) / 8));
    const cy1 = Math.min(Math.ceil(w.h / 8) - 1, Math.floor((py + radius) / 8));
    const seen = new Set<number>();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.chunks[cy * this.chunkW + cx];
        if (!list) continue;
        for (const i of list) {
          const x = i % w.w;
          const y = (i / w.w) | 0;
          const t = want(x, y, i) ? 1 : 0;
          seen.add(i);
          if (this.cutTarget[i] !== t || this.cut[i] !== t) {
            this.cutTarget[i] = t;
            this.active.add(i);
          }
        }
      }
    }
    // tiles that left the region restore to full height
    for (const i of this.active) {
      if (!seen.has(i)) this.cutTarget[i] = 0;
    }
    let dynChanged = false;
    const step = dt * 5;
    for (const i of [...this.active]) {
      const t = this.cutTarget[i];
      const c = this.cut[i];
      const nc = t > c ? Math.min(t, c + step) : Math.max(t, c - step);
      this.cut[i] = nc;
      this.applyTile(i);
      dynChanged = true;
      if (nc === t) this.active.delete(i);
    }
    if (dynChanged) {
      for (const ch of this.touched) {
        ch.solid.commit();
        ch.chain.commit();
        ch.glass.commit();
      }
      this.touched.clear();
      this.dynDirty = true;
    }
  }

  private touched = new Set<RenderChunk>();

  private applyTile(i: number): void {
    const s = this.refStart[i];
    if (s < 0) return;
    const w = this.w;
    const ch = this.chunkOf(i % w.w, Math.floor(i / w.w));
    this.solid = ch.solid;
    this.glass = ch.glass;
    this.chain = ch.chain;
    this.touched.add(ch);
    const k = this.cut[i];
    for (let r = 0; r < this.refCount[i]; r++) {
      const ref = this.refs[s + r];
      if (ref >= 200000) this.glass.write(ref - 200000, k);
      else if (ref >= 100000) this.chain.write(ref - 100000, k);
      else this.solid.write(ref, k);
    }
  }

  frame(): void {
    if (this.dynDirty) this.rebuildDynamic();
  }
}
