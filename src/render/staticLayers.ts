import * as THREE from 'three';
import { FURN, furnCenter } from '../world/furniture';
import { G, S, type FurnKind, type World, type Building, type RoofPart } from '../world/world';
import { hash01 } from '../core/rng';
import { bushGeometry, furnitureGeometry, pineCanopyGeometry, treeCanopyGeometry, treeTrunkGeometry } from './geom';
import { patchMaterial, U } from './shaderPatch';
import { WALL_H } from './walls';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _y = new THREE.Vector3(0, 1, 0);

export const ROT_ANGLE = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

// ------------------------------------------------------------------ ground

export class Ground {
  mesh: THREE.Mesh;
  tex: THREE.DataTexture;
  data: Uint8Array;
  constructor(w: World) {
    this.data = new Uint8Array(w.w * w.h * 4);
    this.tex = new THREE.DataTexture(this.data, w.w, w.h, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    U.uTiles.value = this.tex;
    this.refresh(w);
    const geo = new THREE.PlaneGeometry(w.w, w.h, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w.w / 2, 0, w.h / 2);
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), { ground: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    // extend beyond the map so the edges fade into forest darkness
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(w.w * 3, w.h * 3).rotateX(-Math.PI / 2).translate(w.w / 2, -0.02, w.h / 2), new THREE.MeshBasicMaterial({ color: 0x0b0d0c }));
    this.mesh.add(skirt);
  }
  refresh(w: World): void {
    const d = this.data;
    for (let i = 0; i < w.w * w.h; i++) {
      d[i * 4] = w.ground[i];
      d[i * 4 + 1] = w.groundVar[i];
      d[i * 4 + 2] = w.decal[i];
      let walls = 0;
      if (w.room[i] >= 0 || w.struct[i] === S.Wall || w.struct[i] === S.Door || w.struct[i] === S.Window) walls |= 16;
      if (w.room[i] >= 0) {
        const x = i % w.w;
        const y = (i / w.w) | 0;
        const isW = (j: number): boolean => {
          const s = w.struct[j];
          return s === S.Wall || s === S.Window || s === S.BuiltWall;
        };
        if (y > 0 && isW(i - w.w)) walls |= 1;
        if (x < w.w - 1 && isW(i + 1)) walls |= 2;
        if (y < w.h - 1 && isW(i + w.w)) walls |= 4;
        if (x > 0 && isW(i - 1)) walls |= 8;
      }
      d[i * 4 + 3] = walls;
    }
    this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ furniture

interface FurnInst {
  mesh: THREE.InstancedMesh;
  idx: number;
  id: number;
  tile: number;
  x: number;
  z: number;
  ang: number;
  h: number;
}

const FCH = 48;

export class FurnitureLayer {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];
  geos = new Map<FurnKind, THREE.BufferGeometry>();
  mat: THREE.MeshLambertMaterial;
  tall: FurnInst[] = [];
  byId = new Map<number, FurnInst>();
  private w: World;
  constructor(w: World) {
    this.w = w;
    this.mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { ao: true });
    this.rebuild();
  }
  rebuild(): void {
    const w = this.w;
    // bucket by (render chunk, kind) so off-screen furniture is culled
    const buckets = new Map<string, number[]>();
    for (const f of w.furniture) {
      if (f.gone) continue;
      const key = `${Math.floor(f.y / FCH) * 100 + Math.floor(f.x / FCH)}|${f.kind}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(f.id);
    }
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.meshes = [];
    this.tall = [];
    this.byId.clear();
    for (const [key, ids] of buckets) {
      const kind = key.split('|')[1] as FurnKind;
      let geo = this.geos.get(kind);
      if (!geo) {
        geo = furnitureGeometry(kind);
        this.geos.set(kind, geo);
      }
      const mesh = new THREE.InstancedMesh(geo, this.mat, ids.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const def = FURN[kind];
      ids.forEach((id, k) => {
        const f = w.furniture[id];
        const [cx, cz] = furnCenter(f);
        const ang = ROT_ANGLE[f.rot];
        _p.set(cx, 0, cz);
        _q.setFromAxisAngle(_y, ang);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(k, _m);
        const v = 0.88 + hash01(f.x, f.y, 11) * 0.2;
        mesh.setColorAt(k, _c.setRGB(v, v, v));
        const inst: FurnInst = { mesh, idx: k, id, tile: f.y * w.w + f.x, x: cx, z: cz, ang, h: def.h };
        this.byId.set(id, inst);
        if (def.h > 1.3 && kind !== 'lamp' && kind !== 'silo') this.tall.push(inst);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }
  /** Shrink tall furniture where walls are cut so it doesn't hide the player. */
  applyCut(cut: Float32Array): void {
    const touched = new Set<THREE.InstancedMesh>();
    for (const t of this.tall) {
      const k = cut[t.tile];
      const sy = k > 0 ? 1 - k * (1 - 0.45 / t.h) : 1;
      _p.set(t.x, 0, t.z);
      _q.setFromAxisAngle(_y, t.ang);
      _s.set(1, sy, 1);
      _m.compose(_p, _q, _s);
      t.mesh.setMatrixAt(t.idx, _m);
      touched.add(t.mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ trees & bushes

interface TreeChunk {
  trunks: THREE.InstancedMesh;
  canopy: THREE.InstancedMesh;
  pines: THREE.InstancedMesh;
  bushes: THREE.InstancedMesh;
  tiles: number[];
  kinds: number[];
  mats: THREE.Matrix4[];
}

export class NatureLayer {
  group = new THREE.Group();
  chunks: TreeChunk[] = [];
  private w: World;
  private trunkGeo = treeTrunkGeometry();
  private canopyGeo = treeCanopyGeometry();
  private pineGeo = pineCanopyGeometry();
  private bushGeo = bushGeometry();
  private mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {});
  private hidden = new Set<string>();
  season = 0;
  constructor(w: World) {
    this.w = w;
    this.rebuild();
  }
  rebuild(): void {
    for (const c of this.chunks) {
      this.group.remove(c.trunks, c.canopy, c.pines, c.bushes);
      c.trunks.dispose();
      c.canopy.dispose();
      c.pines.dispose();
      c.bushes.dispose();
    }
    this.chunks = [];
    const w = this.w;
    const CH = 48;
    for (let cy = 0; cy < w.h; cy += CH) {
      for (let cx = 0; cx < w.w; cx += CH) {
        const trees: number[] = [];
        const bushes: number[] = [];
        for (let y = cy; y < Math.min(w.h, cy + CH); y++) {
          for (let x = cx; x < Math.min(w.w, cx + CH); x++) {
            const s = w.struct[y * w.w + x];
            if (s === S.Tree) trees.push(y * w.w + x);
            else if (s === S.Bush) bushes.push(y * w.w + x);
          }
        }
        if (!trees.length && !bushes.length) continue;
        const pinesIdx = trees.filter((i) => w.ground[i] === G.Forest && hash01(i % w.w, (i / w.w) | 0, 5) < 0.55);
        const decid = trees.filter((i) => !pinesIdx.includes(i));
        const trunks = new THREE.InstancedMesh(this.trunkGeo, this.mat, Math.max(1, trees.length));
        const canopy = new THREE.InstancedMesh(this.canopyGeo, this.mat, Math.max(1, decid.length));
        const pines = new THREE.InstancedMesh(this.pineGeo, this.mat, Math.max(1, pinesIdx.length));
        const bm = new THREE.InstancedMesh(this.bushGeo, this.mat, Math.max(1, bushes.length));
        for (const m of [trunks, canopy, pines, bm]) {
          m.castShadow = true;
          m.receiveShadow = true;
          m.count = 0;
        }
        const chunk: TreeChunk = { trunks, canopy, pines, bushes: bm, tiles: [], kinds: [], mats: [] };
        const place = (i: number): [number, number, number, number] => {
          const x = i % w.w;
          const y = (i / w.w) | 0;
          const jx = (hash01(x, y, 1) - 0.5) * 0.35;
          const jz = (hash01(x, y, 2) - 0.5) * 0.35;
          const sc = 0.8 + hash01(x, y, 3) * 0.6;
          return [x + 0.5 + jx, y + 0.5 + jz, sc, hash01(x, y, 4) * Math.PI * 2];
        };
        for (const i of trees) {
          const [x, z, sc, rot] = place(i);
          _p.set(x, 0, z);
          _q.setFromAxisAngle(_y, rot);
          _s.set(sc, sc * (0.9 + hash01(i, 1, 6) * 0.5), sc);
          _m.compose(_p, _q, _s);
          trunks.setMatrixAt(trunks.count++, _m);
          trunks.setColorAt(trunks.count - 1, _c.setRGB(1, 1, 1));
        }
        for (const i of decid) {
          const [x, z, sc, rot] = place(i);
          _p.set(x, 2.3 * sc + 0.8, z);
          _q.setFromAxisAngle(_y, rot);
          _s.set(sc * 1.35, sc * 1.25, sc * 1.35);
          _m.compose(_p, _q, _s);
          const k = canopy.count++;
          canopy.setMatrixAt(k, _m);
          chunk.tiles.push(i);
          chunk.kinds.push(0);
          chunk.mats.push(_m.clone());
        }
        for (const i of pinesIdx) {
          const [x, z, sc, rot] = place(i);
          _p.set(x, 2.2 * sc + 0.6, z);
          _q.setFromAxisAngle(_y, rot);
          _s.set(sc * 1.1, sc * 1.9, sc * 1.1);
          _m.compose(_p, _q, _s);
          const k = pines.count++;
          pines.setMatrixAt(k, _m);
          pines.setColorAt(k, this.pineColor(i));
          chunk.tiles.push(i);
          chunk.kinds.push(1);
          chunk.mats.push(_m.clone());
        }
        for (const i of bushes) {
          const [x, z, sc, rot] = place(i);
          _p.set(x, 0, z);
          _q.setFromAxisAngle(_y, rot);
          _s.set(sc * 1.1, sc, sc * 1.1);
          _m.compose(_p, _q, _s);
          const k = bm.count++;
          bm.setMatrixAt(k, _m);
          bm.setColorAt(k, _c.setRGB(0.3 + hash01(i, 2, 8) * 0.06, 0.4, 0.22));
        }
        this.chunks.push(chunk);
        this.applySeason(chunk);
        for (const m of [trunks, canopy, pines, bm]) {
          m.instanceMatrix.needsUpdate = true;
          m.computeBoundingSphere();
          this.group.add(m);
        }
      }
    }
  }
  private pineColor(i: number): THREE.Color {
    const v = hash01(i, 7, 7);
    return _c.setRGB(0.16 + v * 0.05, 0.26 + v * 0.05, 0.17);
  }
  /** Leaves turn with the season: 0 = late summer, 1 = deep autumn, 2 = bare winter. */
  setSeason(season: number): void {
    if (Math.abs(season - this.season) < 0.02) return;
    this.season = season;
    for (const c of this.chunks) this.applySeason(c);
  }
  private applySeason(c: TreeChunk): void {
    let k = 0;
    for (let n = 0; n < c.tiles.length; n++) {
      if (c.kinds[n] !== 0) continue;
      const i = c.tiles[n];
      const v = hash01(i, 3, 3);
      const turn = Math.min(1, Math.max(0, this.season * 1.3 - v * 0.5));
      const summer = new THREE.Color().setRGB(0.28 + v * 0.08, 0.38 + v * 0.06, 0.2);
      const autumn = new THREE.Color().setRGB(0.62 + v * 0.15, 0.36 + v * 0.18, 0.13);
      summer.lerp(autumn, turn);
      c.canopy.setColorAt(k++, summer);
    }
    if (c.canopy.instanceColor) c.canopy.instanceColor.needsUpdate = true;
  }
  /** Hide canopies that would cover the player. */
  applyCut(test: (x: number, y: number) => boolean): void {
    const w = this.w;
    for (const c of this.chunks) {
      let kc = 0;
      let kp = 0;
      let dirtyC = false;
      let dirtyP = false;
      for (let n = 0; n < c.tiles.length; n++) {
        const i = c.tiles[n];
        const x = i % w.w;
        const y = (i / w.w) | 0;
        const kind = c.kinds[n];
        const key = `${i}`;
        const hide = test(x, y);
        const idx = kind === 0 ? kc++ : kp++;
        const was = this.hidden.has(key);
        if (hide === was) continue;
        const mesh = kind === 0 ? c.canopy : c.pines;
        if (hide) {
          _m.copy(c.mats[n]);
          _m.decompose(_p, _q, _s);
          _s.multiplyScalar(0.001);
          _m.compose(_p, _q, _s);
          mesh.setMatrixAt(idx, _m);
          this.hidden.add(key);
        } else {
          mesh.setMatrixAt(idx, c.mats[n]);
          this.hidden.delete(key);
        }
        if (kind === 0) dirtyC = true;
        else dirtyP = true;
      }
      if (dirtyC) c.canopy.instanceMatrix.needsUpdate = true;
      if (dirtyP) c.pines.instanceMatrix.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ roofs

function roofGeometry(p: RoofPart, color: number): THREE.BufferGeometry {
  const o = 0.3;
  const x0 = p.x0 - o;
  const x1 = p.x1 + 1 + o;
  const z0 = p.y0 - o;
  const z1 = p.y1 + 1 + o;
  const base = WALL_H;
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    pos.push(...a, ...b, ...c);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    tri(a, b, c);
    tri(a, c, d);
  };
  if (p.style === 'flat') {
    const g = new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0);
    g.translate((x0 + x1) / 2, base + 0.15, (z0 + z1) / 2);
    const parapet = new THREE.BoxGeometry(x1 - x0, 0.35, z1 - z0);
    parapet.translate((x0 + x1) / 2, base + 0.2, (z0 + z1) / 2);
    return colorGeo(g.toNonIndexed(), color);
  }
  if (p.style === 'gable') {
    if (p.ridgeX) {
      const zm = (z0 + z1) / 2;
      const rise = Math.min(2.4, (z1 - z0) * 0.32);
      const top = base + rise;
      quad([x0, base, z1], [x1, base, z1], [x1, top, zm], [x0, top, zm]);
      quad([x1, base, z0], [x0, base, z0], [x0, top, zm], [x1, top, zm]);
      tri([x0 + o, base, z0 + o], [x0 + o, base, z1 - o], [x0 + o, top - 0.1, zm]);
      tri([x1 - o, base, z1 - o], [x1 - o, base, z0 + o], [x1 - o, top - 0.1, zm]);
    } else {
      const xm = (x0 + x1) / 2;
      const rise = Math.min(2.4, (x1 - x0) * 0.32);
      const top = base + rise;
      quad([x1, base, z1], [x1, base, z0], [xm, top, z0], [xm, top, z1]);
      quad([x0, base, z0], [x0, base, z1], [xm, top, z1], [xm, top, z0]);
      tri([x1 - o, base, z0 + o], [x0 + o, base, z0 + o], [xm, top - 0.1, z0 + o]);
      tri([x0 + o, base, z1 - o], [x1 - o, base, z1 - o], [xm, top - 0.1, z1 - o]);
    }
  } else {
    // hip roof
    const xm = (x0 + x1) / 2;
    const zm = (z0 + z1) / 2;
    const rise = Math.min(2.2, Math.min(x1 - x0, z1 - z0) * 0.32);
    const top = base + rise;
    const inset = Math.min(x1 - x0, z1 - z0) / 2;
    const alongX = x1 - x0 >= z1 - z0;
    const r0 = alongX ? [x0 + inset, top, zm] : [xm, top, z0 + inset];
    const r1 = alongX ? [x1 - inset, top, zm] : [xm, top, z1 - inset];
    if (alongX) {
      quad([x0, base, z1], [x1, base, z1], r1, r0);
      quad([x1, base, z0], [x0, base, z0], r0, r1);
      tri([x0, base, z0], [x0, base, z1], r0);
      tri([x1, base, z1], [x1, base, z0], r1);
    } else {
      quad([x1, base, z1], [x1, base, z0], r0, r1);
      quad([x0, base, z0], [x0, base, z1], r1, r0);
      tri([x1, base, z0], [x0, base, z0], r0);
      tri([x0, base, z1], [x1, base, z1], r1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return colorGeo(g, color);
}

function colorGeo(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const nor = g.getAttribute('normal');
  const cols = new Float32Array(n * 3);
  _c.setHex(color);
  for (let i = 0; i < n; i++) {
    // gable ends (vertical faces) slightly lighter
    const vert = nor ? Math.abs(nor.getY(i)) < 0.3 : false;
    const k = vert ? 1.35 : 1;
    cols[i * 3] = _c.r * k;
    cols[i * 3 + 1] = _c.g * k;
    cols[i * 3 + 2] = _c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

export interface RoofEntry {
  b: Building;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  fade: number;
  target: number;
}

export class RoofLayer {
  group = new THREE.Group();
  roofs: RoofEntry[] = [];
  constructor(w: World) {
    const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const b of w.buildings) {
      const geos = b.roofs.map((p) => roofGeometry(p, b.roofColor));
      const geo = geos.length === 1 ? geos[0] : mergeAll(geos);
      const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 1, side: THREE.DoubleSide }), { minVis: 0.55 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      const shadow = new THREE.Mesh(geo, shadowMat);
      shadow.castShadow = true;
      this.group.add(mesh, shadow);
      this.roofs.push({ b, mesh, shadow, mat, fade: 1, target: 1 });
    }
  }
  update(dt: number): void {
    for (const r of this.roofs) {
      if (r.fade === r.target) continue;
      const step = dt * 4;
      r.fade = r.target > r.fade ? Math.min(r.target, r.fade + step) : Math.max(r.target, r.fade - step);
      r.mat.opacity = r.fade;
      r.mesh.visible = r.fade > 0.01;
      r.mat.depthWrite = r.fade > 0.99;
    }
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const c = g.getAttribute('color');
    pos.set(p.array as Float32Array, o * 3);
    nor.set(n.array as Float32Array, o * 3);
    col.set(c.array as Float32Array, o * 3);
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
