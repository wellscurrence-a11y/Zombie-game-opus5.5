// Characters (player + instanced zombies), corpses, vehicles and dropped items.
import * as THREE from 'three';
import { GeoBuilder } from './geom';
import { patchMaterial } from './shaderPatch';
import type { Corpse, GameState, Vehicle, Zombie, ZKind } from '../sim/types';
import { VEH } from '../sim/vehicleSpecs';
import { def } from '../sim/items';
import { hash01 } from '../core/rng';

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/** Convert a world facing (tile coords, radians) to a three.js Y rotation for +z-forward models. */
export const facingToY = (f: number): number => Math.PI / 2 - f;

// ------------------------------------------------------------------ humanoid part geometry (pivot at joint)

function partGeo(sx: number, sy: number, sz: number, yOff: number, color = 0xffffff): THREE.BufferGeometry {
  return new GeoBuilder().box(0, yOff, 0, sx, sy, sz, color).build();
}

const HIP_Y = 0.86;
const SHOULDER_Y = 1.44;

export const PART_GEOS = {
  leg: partGeo(0.17, 0.84, 0.19, -0.42),
  torso: new GeoBuilder().box(0, 0.31, 0, 0.46, 0.62, 0.26, 0xffffff).build(),
  head: new GeoBuilder().box(0, 0.14, 0.01, 0.25, 0.28, 0.27, 0xffffff).box(0, 0.26, -0.02, 0.27, 0.07, 0.29, 0xb8b8b8).build(),
  arm: partGeo(0.12, 0.66, 0.13, -0.31),
};

const SKIN_Z = [0x8c9a86, 0x9aa493, 0x7d8a78, 0xa09a88, 0x8a8472, 0x6f7a6c];
const SHIRTS: Record<ZKind, number[]> = {
  civ: [0x6b5a4a, 0x4a5a6b, 0x7a3e3a, 0x55634a, 0x8a7d62, 0x3e3e44, 0x6a6a72, 0x7c5a7a, 0x9a8a6a, 0x2f4a5a],
  cop: [0x2a3548],
  soldier: [0x4f5838, 0x5a5f3e],
  medic: [0x6aa0a0, 0xd8d8d0],
  worker: [0xc8702a, 0x6a6e70, 0xb8a040],
  farmer: [0x7a3a32, 0x4a5a78],
  survivor: [0x5a4a3a],
  hazmat: [0xd0c040],
};
const PANTS: Record<ZKind, number[]> = {
  civ: [0x3a4458, 0x4a4238, 0x2e2e32, 0x5a5448, 0x3c4a3c],
  cop: [0x232c3a],
  soldier: [0x4a5234],
  medic: [0x6aa0a0, 0xd8d8d0],
  worker: [0x3e4650, 0x5a5040],
  farmer: [0x3a4a6a],
  survivor: [0x3a3a3a],
  hazmat: [0xd0c040],
};

export function outfitColors(kind: ZKind, outfit: number): { skin: number; shirt: number; pants: number } {
  const sh = SHIRTS[kind] ?? SHIRTS.civ;
  const pa = PANTS[kind] ?? PANTS.civ;
  return { skin: SKIN_Z[outfit % SKIN_Z.length], shirt: sh[(outfit >> 4) % sh.length], pants: pa[(outfit >> 8) % pa.length] };
}

export interface Pose {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  armSpread: number;
  torsoLean: number;
  lift: number;
  /** Whole-body tilt (lying down = PI/2). */
  tilt: number;
  crouch: number;
  headTurn: number;
  roll: number;
}

export const REST: Pose = { legL: 0, legR: 0, armL: 0, armR: 0, armSpread: 0, torsoLean: 0, lift: 0, tilt: 0, crouch: 0, headTurn: 0, roll: 0 };

/** Compose the 6 part matrices of a humanoid. Returns them in order: legL, legR, torso, head, armL, armR. */
export function humanoidMatrices(x: number, z: number, facing: number, pose: Pose, out: THREE.Matrix4[]): void {
  _e.set(0, facingToY(facing), 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, pose.lift, z);
  _r.compose(_p, _q, _s);
  if (pose.tilt || pose.roll) {
    _e.set(pose.tilt, 0, pose.roll, 'XYZ');
    _l.makeRotationFromEuler(_e);
    _r.multiply(_l);
  }
  const crouch = pose.crouch;
  const hip = HIP_Y - crouch * 0.28;
  // legs
  const legBend = crouch * 0.9;
  _e.set(pose.legL - legBend * 0.6, 0, 0.02);
  _l.makeRotationFromEuler(_e).setPosition(-0.11, hip, 0);
  out[0].multiplyMatrices(_r, _l);
  _e.set(pose.legR - legBend * 0.6, 0, -0.02);
  _l.makeRotationFromEuler(_e).setPosition(0.11, hip, 0);
  out[1].multiplyMatrices(_r, _l);
  // torso
  _e.set(pose.torsoLean + crouch * 0.35, 0, 0);
  _l.makeRotationFromEuler(_e).setPosition(0, hip - 0.02, 0);
  out[2].multiplyMatrices(_r, _l);
  const torso = out[2];
  // head (relative to torso)
  _e.set(0.05, pose.headTurn, 0);
  _l.makeRotationFromEuler(_e).setPosition(0, 0.64, 0);
  out[3].multiplyMatrices(torso, _l);
  // arms (relative to torso, at shoulders)
  const sh = SHOULDER_Y - HIP_Y + 0.04;
  _e.set(-pose.armL, 0, pose.armSpread + 0.06);
  _l.makeRotationFromEuler(_e).setPosition(-0.3, sh, 0);
  out[4].multiplyMatrices(torso, _l);
  _e.set(-pose.armR, 0, -pose.armSpread - 0.06);
  _l.makeRotationFromEuler(_e).setPosition(0.3, sh, 0);
  out[5].multiplyMatrices(torso, _l);
}

// ------------------------------------------------------------------ zombies (instanced)

export class ZombieLayer {
  group = new THREE.Group();
  parts: THREE.InstancedMesh[];
  mats: THREE.Matrix4[] = [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix4());
  cap: number;
  constructor(cap = 1500) {
    this.cap = cap;
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {});
    const geos = [PART_GEOS.leg, PART_GEOS.leg, PART_GEOS.torso, PART_GEOS.head, PART_GEOS.arm, PART_GEOS.arm];
    this.parts = geos.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
      return m;
    });
  }
  update(zs: Zombie[], visible: (z: Zombie) => boolean, time: number): number {
    let n = 0;
    for (const z of zs) {
      if (n >= this.cap) break;
      if (!visible(z)) continue;
      const pose = zombiePose(z, time);
      humanoidMatrices(z.x, z.y, z.facing, pose, this.mats);
      const col = outfitColors(z.kind, z.outfit);
      for (let k = 0; k < 6; k++) {
        this.parts[k].setMatrixAt(n, this.mats[k]);
        const hex = k === 3 ? col.skin : k === 2 || k >= 4 ? col.shirt : col.pants;
        this.parts[k].setColorAt(n, _c.setHex(hex));
      }
      n++;
    }
    for (const p of this.parts) {
      p.count = n;
      p.instanceMatrix.needsUpdate = true;
      if (p.instanceColor) p.instanceColor.needsUpdate = true;
    }
    return n;
  }
}

export function zombiePose(z: Zombie, time: number): Pose {
  const p: Pose = { ...REST };
  const spd = Math.hypot(z.vx, z.vy);
  const ph = z.anim;
  const sway = Math.sin(time * 1.3 + z.id) * 0.06;
  p.roll = sway * 0.6;
  if (z.state === 'down' || z.state === 'dead') {
    p.tilt = -Math.PI / 2;
    p.lift = 0.14;
    p.armL = 0.4 + Math.sin(time * 2 + z.id) * (z.state === 'down' ? 0.3 : 0);
    p.armR = 0.2;
    return p;
  }
  if (z.crawler) {
    p.tilt = Math.PI / 2 - 0.1;
    p.lift = 0.18;
    p.armL = 2.4 + Math.sin(ph) * 0.5;
    p.armR = 2.4 - Math.sin(ph) * 0.5;
    p.legL = 0.2;
    p.legR = 0.1;
    return p;
  }
  const stride = Math.min(1, spd / 1.1);
  p.legL = Math.sin(ph) * 0.5 * stride;
  p.legR = -Math.sin(ph) * 0.5 * stride;
  // arms reach forward when they know where you are
  const reaching = z.state === 'chase' || z.state === 'attack' || z.state === 'lunge' || z.state === 'bang';
  const baseArm = reaching ? 1.35 : 0.25 + Math.sin(time * 0.7 + z.id) * 0.1;
  p.armL = baseArm + Math.sin(ph + 1) * 0.12;
  p.armR = baseArm * (reaching ? 1 : 0.6) + Math.sin(ph) * 0.12;
  p.torsoLean = 0.12 + (reaching ? 0.15 : 0);
  p.headTurn = Math.sin(time * 0.5 + z.id * 3) * 0.25;
  if (z.state === 'attack' || z.state === 'lunge') {
    const k = Math.max(0, Math.min(1, z.attackT));
    p.torsoLean = 0.35 - k * 0.2;
    p.armL = 1.55;
    p.armR = 1.55;
  }
  if (z.state === 'bang') {
    const b = Math.max(0, Math.sin(time * 5 + z.id));
    p.armL = 1.2 + b * 0.8;
    p.armR = 1.2 + (1 - b) * 0.8;
    p.torsoLean = 0.25;
  }
  if (z.state === 'stagger') {
    p.torsoLean = -0.35;
    p.armL = 0.6;
    p.armR = 0.9;
  }
  if (z.state === 'climb') {
    p.lift = 0.25;
    p.torsoLean = 0.9;
    p.armL = 1.8;
    p.armR = 1.6;
  }
  if (z.state === 'eat') {
    p.crouch = 1;
    p.torsoLean = 0.8;
    p.armL = 1.4;
    p.armR = 1.3;
  }
  return p;
}

// ------------------------------------------------------------------ player

export class PlayerModel {
  group = new THREE.Group();
  meshes: THREE.Mesh[];
  mats: THREE.Matrix4[] = [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix4());
  weapon: THREE.Mesh;
  bag: THREE.Mesh;
  private weaponId = '';
  private materials: THREE.MeshLambertMaterial[];
  constructor() {
    const mk = (hex: number): THREE.MeshLambertMaterial => patchMaterial(new THREE.MeshLambertMaterial({ color: hex, vertexColors: true }), { noFog: true });
    this.materials = [mk(0x3a4458), mk(0x3a4458), mk(0x6a7a5a), mk(0xc8a88a), mk(0x6a7a5a), mk(0x6a7a5a)];
    const geos = [PART_GEOS.leg, PART_GEOS.leg, PART_GEOS.torso, PART_GEOS.head, PART_GEOS.arm, PART_GEOS.arm];
    this.meshes = geos.map((g, i) => {
      const m = new THREE.Mesh(g, this.materials[i]);
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    });
    this.weapon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), patchMaterial(new THREE.MeshLambertMaterial({ color: 0x6a4a30 }), { noFog: true }));
    this.weapon.castShadow = true;
    this.weapon.matrixAutoUpdate = false;
    this.group.add(this.weapon);
    this.bag = new THREE.Mesh(new GeoBuilder().box(0, 0.3, -0.19, 0.36, 0.44, 0.16, 0x4a5a3a).build(), patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { noFog: true }));
    this.bag.castShadow = true;
    this.bag.matrixAutoUpdate = false;
    this.group.add(this.bag);
  }
  setColors(shirt: number, pants: number, skin = 0xc8a88a, outer?: number): void {
    const top = outer ?? shirt;
    this.materials[2].color.setHex(top);
    this.materials[4].color.setHex(top);
    this.materials[5].color.setHex(top);
    this.materials[0].color.setHex(pants);
    this.materials[1].color.setHex(pants);
    this.materials[3].color.setHex(skin);
  }
  setWeapon(id: string | null): void {
    if (id === this.weaponId) return;
    this.weaponId = id ?? '';
    const mat = this.weapon.material as THREE.MeshLambertMaterial;
    if (!id) {
      this.weapon.visible = false;
      return;
    }
    this.weapon.visible = true;
    const d = def(id);
    const len = d.firearm ? (d.firearm.range > 20 ? 1.0 : d.firearm.pellets > 1 ? 0.95 : 0.3) : d.weapon ? Math.max(0.25, d.weapon.reach - 0.35) : 0.3;
    this.weapon.geometry.dispose();
    const b = new GeoBuilder();
    const metal = ['knife', 'huntknife', 'machete', 'crowbar', 'pipe', 'wrench', 'screwdriver', 'pan', 'golfclub'].includes(id) || !!d.firearm;
    const col = d.firearm ? 0x2c2c2e : metal ? 0x9aa0a6 : id === 'bat' ? 0xb08a58 : 0x6a4a30;
    b.box(0, 0, len / 2, 0.05, 0.05, len, col);
    if (id === 'axe' || id === 'hatchet') b.box(0.08, 0, len - 0.08, 0.16, 0.03, 0.14, 0x8a9096);
    if (id === 'sledge' || id === 'hammer') b.box(0, 0, len, 0.12, 0.12, 0.2, 0x55595e);
    if (id === 'shovel') b.box(0, 0, len, 0.22, 0.02, 0.26, 0x6a6e72);
    this.weapon.geometry = b.build();
    mat.color.setHex(0xffffff);
    mat.vertexColors = true;
    mat.needsUpdate = true;
  }
  apply(x: number, z: number, facing: number, pose: Pose, weaponAngle: number, showBag: boolean): void {
    humanoidMatrices(x, z, facing, pose, this.mats);
    for (let k = 0; k < 6; k++) this.meshes[k].matrix.copy(this.mats[k]);
    // weapon in right hand: end of right arm
    _l.makeRotationX(-Math.PI / 2 + weaponAngle).setPosition(0, -0.62, 0.04);
    this.weapon.matrix.multiplyMatrices(this.mats[5], _l);
    this.bag.visible = showBag;
    this.bag.matrix.copy(this.mats[2]);
  }
}

// ------------------------------------------------------------------ corpses

export class CorpseLayer {
  group = new THREE.Group();
  body: THREE.InstancedMesh;
  skin: THREE.InstancedMesh;
  cap: number;
  constructor(cap = 2500) {
    this.cap = cap;
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {});
    const bodyGeo = new GeoBuilder()
      .box(0, 0.1, 0.0, 0.46, 0.2, 0.62, 0xffffff)
      .box(-0.12, 0.08, -0.72, 0.17, 0.16, 0.82, 0xd8d8d8)
      .box(0.14, 0.08, -0.7, 0.17, 0.16, 0.82, 0xd8d8d8, 0.12)
      .box(-0.4, 0.07, 0.25, 0.13, 0.13, 0.62, 0xffffff, 0.5)
      .box(0.38, 0.07, 0.15, 0.13, 0.13, 0.62, 0xffffff, -0.3)
      .build();
    const skinGeo = new GeoBuilder().box(0, 0.12, 0.48, 0.25, 0.24, 0.28, 0xffffff).box(0, 0.02, 0.0, 1.1, 0.01, 1.0, 0x551010).build();
    this.body = new THREE.InstancedMesh(bodyGeo, mat, cap);
    this.skin = new THREE.InstancedMesh(skinGeo, mat, cap);
    for (const m of [this.body, this.skin]) {
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
  }
  rebuild(corpses: Corpse[]): void {
    let n = 0;
    for (const c of corpses) {
      if (n >= this.cap) break;
      _e.set(0, c.rot, 0);
      _q.setFromEuler(_e);
      _p.set(c.x, 0, c.y);
      _m.compose(_p, _q, _s);
      this.body.setMatrixAt(n, _m);
      this.skin.setMatrixAt(n, _m);
      const col = outfitColors(c.kind, c.outfit);
      this.body.setColorAt(n, _c.setHex(col.shirt));
      this.skin.setColorAt(n, _c.setHex(c.wasPlayer ? 0xc8a88a : col.skin));
      n++;
    }
    this.body.count = n;
    this.skin.count = n;
    for (const m of [this.body, this.skin]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ vehicles

function vehicleGeometry(v: Vehicle): THREE.BufferGeometry {
  const s = VEH[v.type];
  const b = new GeoBuilder();
  const L = s.l;
  const W = s.w;
  const col = v.wrecked ? 0x3a3530 : v.color;
  const glass = 0x2a3a44;
  const brokenGlass = 0x151a1e;
  const win = (k: number): number => (v.windows[k] >= 2 ? brokenGlass : glass);
  const wheelY = 0.36;
  // wheels (local x = forward)
  const wheel = (fx: number, fz: number, idx: number): void => {
    const flat = v.tires[idx] <= 0;
    const g = new GeoBuilder().cyl(0, 0, 0, flat ? 0.3 : 0.36, 0.26, 0x1b1b1b, 10).build();
    g.rotateX(Math.PI / 2);
    g.translate(fx, flat ? 0.3 : wheelY, fz);
    b.parts.push(g);
  };
  wheel(L * 0.32, W / 2 - 0.15, 0);
  wheel(L * 0.32, -W / 2 + 0.15, 1);
  wheel(-L * 0.32, W / 2 - 0.15, 2);
  wheel(-L * 0.32, -W / 2 + 0.15, 3);
  if (v.type === 'pickup') {
    b.box(0, 0.72, 0, L, 0.55, W, col);
    b.box(L * 0.12, 1.25, 0, L * 0.34, 0.55, W * 0.92, win(1));
    b.box(L * 0.12, 1.55, 0, L * 0.32, 0.06, W * 0.9, col);
    b.box(-L * 0.28, 1.0, W / 2 - 0.05, L * 0.42, 0.25, 0.08, col);
    b.box(-L * 0.28, 1.0, -W / 2 + 0.05, L * 0.42, 0.25, 0.08, col);
    b.box(-L / 2 + 0.05, 1.0, 0, 0.08, 0.25, W, col);
  } else if (v.type === 'van' || v.type === 'truck' || v.type === 'military') {
    const cab = v.type === 'van' ? 0.3 : 0.25;
    b.box(0, 0.75, 0, L, 0.7, W, col);
    b.box(-L * (0.5 - (1 - cab) / 2), 1.9, 0, L * (1 - cab), 1.6, W, v.type === 'military' ? 0x5a6242 : v.type === 'truck' ? 0xd8d4c8 : col);
    b.box(L * (0.5 - cab / 2), 1.45, 0, L * cab, 0.75, W * 0.95, win(0));
    b.box(L * (0.5 - cab / 2), 1.88, 0, L * cab, 0.12, W, col);
  } else {
    const sports = v.type === 'sports';
    b.box(0, 0.68, 0, L, sports ? 0.46 : 0.56, W, col);
    const cabL = L * (sports ? 0.42 : 0.5);
    b.box(-L * 0.05, sports ? 1.12 : 1.22, 0, cabL, sports ? 0.4 : 0.52, W * 0.88, win(1));
    b.box(-L * 0.05, sports ? 1.34 : 1.5, 0, cabL * 0.92, 0.06, W * 0.86, col);
    b.box(L * 0.2, 1.1, 0, 0.05, 0.4, W * 0.8, win(0));
  }
  // lights
  b.box(L / 2 + 0.01, 0.8, W / 2 - 0.3, 0.03, 0.14, 0.3, 0xe8e2c8);
  b.box(L / 2 + 0.01, 0.8, -W / 2 + 0.3, 0.03, 0.14, 0.3, 0xe8e2c8);
  b.box(-L / 2 - 0.01, 0.8, W / 2 - 0.3, 0.03, 0.12, 0.25, 0x8a1a14);
  b.box(-L / 2 - 0.01, 0.8, -W / 2 + 0.3, 0.03, 0.12, 0.25, 0x8a1a14);
  if (v.type === 'police') {
    b.box(-L * 0.05, 1.6, 0.2, 0.25, 0.1, 0.3, 0x2a4ac8);
    b.box(-L * 0.05, 1.6, -0.2, 0.25, 0.1, 0.3, 0xc82a2a);
    b.box(0, 0.75, W / 2 + 0.005, L * 0.5, 0.2, 0.01, 0xe8e8e8);
    b.box(0, 0.75, -W / 2 - 0.005, L * 0.5, 0.2, 0.01, 0xe8e8e8);
  }
  if (v.front > 50) b.box(L / 2 - 0.2, 0.9, 0, 0.4, 0.25, W * 0.7, 0x2a2622, 0, 0, 0.3);
  return b.build();
}

export class VehicleLayer {
  group = new THREE.Group();
  meshes = new Map<number, { mesh: THREE.Mesh; key: string }>();
  mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {});
  update(vs: Vehicle[], visible: (v: Vehicle) => boolean): void {
    for (const v of vs) {
      const key = `${v.type}${v.windows.join('')}${v.tires.map((t) => (t > 0 ? 1 : 0)).join('')}${v.front > 50 ? 1 : 0}${v.wrecked ? 1 : 0}`;
      let e = this.meshes.get(v.id);
      if (!e || e.key !== key) {
        if (e) {
          this.group.remove(e.mesh);
          e.mesh.geometry.dispose();
        }
        const mesh = new THREE.Mesh(vehicleGeometry(v), this.mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        e = { mesh, key };
        this.meshes.set(v.id, e);
        this.group.add(mesh);
      }
      e.mesh.position.set(v.x, 0, v.y);
      e.mesh.rotation.set(0, -v.heading, 0);
      e.mesh.visible = visible(v);
    }
  }
}

// ------------------------------------------------------------------ floor items

export class FloorItemLayer {
  mesh: THREE.InstancedMesh;
  cap: number;
  constructor(cap = 3000) {
    this.cap = cap;
    const geo = new GeoBuilder().box(0, 0.07, 0, 0.22, 0.14, 0.16, 0xffffff).build();
    this.mesh = new THREE.InstancedMesh(geo, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {}), cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }
  rebuild(s: GameState): void {
    let n = 0;
    const w = s.world;
    const catCol: Record<string, number> = {
      food: 0xc8a050, drink: 0x5a8ac8, weapon: 0x8a8a8a, firearm: 0x2a2a2a, medical: 0xe8e8e8, tool: 0xa84a3a, material: 0x9a7a52,
      clothing: 0x6a7a9a, bag: 0x4a5a3a, misc: 0xb0a890, book: 0x8a3a3a, container: 0x7aa0b0, ammo: 0xb09a40, key: 0xd8c050, part: 0x5a5a5a,
    };
    for (const k of Object.keys(s.floor)) {
      const i = Number(k);
      const items = s.floor[i];
      if (!items?.length) continue;
      const x = i % w.w;
      const y = (i / w.w) | 0;
      for (let j = 0; j < Math.min(4, items.length); j++) {
        if (n >= this.cap) break;
        const it = items[j];
        const d = def(it.id);
        _p.set(x + 0.25 + hash01(i, j, 1) * 0.5, 0, y + 0.25 + hash01(i, j, 2) * 0.5);
        _e.set(0, hash01(i, j, 3) * 6.28, 0);
        _q.setFromEuler(_e);
        const sc = d.weight > 3 ? 1.8 : d.weight > 1 ? 1.3 : 1;
        _m.compose(_p, _q, new THREE.Vector3(sc, sc, sc));
        this.mesh.setMatrixAt(n, _m);
        this.mesh.setColorAt(n, _c.setHex(catCol[d.cat] ?? 0xaaaaaa));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
