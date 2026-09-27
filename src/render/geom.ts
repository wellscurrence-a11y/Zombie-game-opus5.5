// Low-poly geometry assembled from coloured primitives (vertex colours, merged).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FurnKind } from '../world/world';

const tmpColor = new THREE.Color();

export class GeoBuilder {
  parts: THREE.BufferGeometry[] = [];

  private colorize(g: THREE.BufferGeometry, hex: number, shade = true): THREE.BufferGeometry {
    const ng = g.index ? g.toNonIndexed() : g;
    const pos = ng.getAttribute('position');
    const nor = ng.getAttribute('normal');
    const cols = new Float32Array(pos.count * 3);
    tmpColor.setHex(hex);
    for (let i = 0; i < pos.count; i++) {
      // subtle baked shading: tops lighter, undersides darker
      const k = shade && nor ? 0.92 + nor.getY(i) * 0.08 : 1;
      cols[i * 3] = tmpColor.r * k;
      cols[i * 3 + 1] = tmpColor.g * k;
      cols[i * 3 + 2] = tmpColor.b * k;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    ng.deleteAttribute('uv');
    return ng;
  }

  /** Box centred at (x, y, z) with size (sx, sy, sz). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, rotY = 0, rotX = 0, rotZ = 0): this {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rotX) g.rotateX(rotX);
    if (rotZ) g.rotateZ(rotZ);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    this.parts.push(this.colorize(g, color));
    return this;
  }

  /** Box by min corner and size (y from the floor). */
  boxAt(x0: number, y0: number, z0: number, sx: number, sy: number, sz: number, color: number): this {
    return this.box(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2, sx, sy, sz, color);
  }

  cyl(x: number, y: number, z: number, r: number, h: number, color: number, seg = 8, rTop = r): this {
    const g = new THREE.CylinderGeometry(rTop, r, h, seg);
    g.translate(x, y, z);
    this.parts.push(this.colorize(g, color));
    return this;
  }

  cylX(x: number, y: number, z: number, r: number, h: number, color: number, seg = 10): this {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    this.parts.push(this.colorize(g, color));
    return this;
  }

  ico(x: number, y: number, z: number, r: number, color: number, sy = 1, detail = 0): this {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    this.parts.push(this.colorize(g, color));
    return this;
  }

  sphere(x: number, y: number, z: number, r: number, color: number, sx = 1, sy = 1, sz = 1): this {
    const g = new THREE.SphereGeometry(r, 8, 6);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    this.parts.push(this.colorize(g, color));
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ------------------------------------------------------------------ furniture
// Local frame: x runs along the wall (length), +z is the front, footprint centred on the origin.

const WOOD = 0x7a5a3c;
const DARKWOOD = 0x4e3726;
const LIGHTWOOD = 0xa07e58;
const WHITE = 0xe4e1d8;
const STEEL = 0x8e959b;
const DARK = 0x2b2c2e;
const COUNTERTOP = 0x9a9890;

function products(b: GeoBuilder, x0: number, x1: number, y: number, z: number, depth: number, seed: number): void {
  const palette = [0xb84a3a, 0xd8b04a, 0x4a7ab8, 0x5f9a52, 0xe0dccf, 0x8f5a9a, 0xd87a3a, 0x3a3a3a];
  let s = seed;
  for (let x = x0; x < x1 - 0.1; x += 0.16) {
    s = (s * 16807) % 2147483647;
    if (s % 5 === 0) continue;
    const h = 0.1 + (s % 7) * 0.025;
    b.box(x + 0.07, y + h / 2, z, 0.13, h, depth, palette[s % palette.length]);
  }
}

export function furnitureGeometry(kind: FurnKind): THREE.BufferGeometry {
  const b = new GeoBuilder();
  switch (kind) {
    case 'bed':
    case 'bed2': {
      const w = kind === 'bed2' ? 0.98 : 0.8;
      b.box(0, 0.2, 0, 1.9, 0.3, w, DARKWOOD);
      b.box(0, 0.42, 0, 1.85, 0.16, w - 0.05, WHITE);
      b.box(-0.25, 0.52, 0, 1.3, 0.06, w - 0.02, kind === 'bed2' ? 0x6a7f95 : 0x8d6e5a);
      b.box(0.78, 0.55, 0, 0.3, 0.1, w - 0.25, 0xf2efe6);
      b.box(0.96, 0.5, 0, 0.07, 0.9, w, DARKWOOD);
      break;
    }
    case 'bunk':
      for (const y of [0.35, 1.25]) {
        b.box(0, y, 0, 1.9, 0.12, 0.8, DARKWOOD);
        b.box(0, y + 0.1, 0, 1.85, 0.1, 0.75, 0x6f7a55);
      }
      for (const x of [-0.93, 0.93]) for (const z of [-0.37, 0.37]) b.box(x, 0.8, z, 0.06, 1.6, 0.06, STEEL);
      break;
    case 'couch':
      b.box(0, 0.22, 0.05, 1.9, 0.3, 0.8, 0x6b5a4a);
      b.box(0, 0.42, 0.1, 1.7, 0.12, 0.65, 0x7d6a58);
      b.box(0, 0.6, -0.3, 1.9, 0.6, 0.2, 0x6b5a4a);
      b.box(-0.88, 0.45, 0.05, 0.16, 0.45, 0.8, 0x5f4f41);
      b.box(0.88, 0.45, 0.05, 0.16, 0.45, 0.8, 0x5f4f41);
      break;
    case 'armchair':
      b.box(0, 0.22, 0.05, 0.8, 0.3, 0.75, 0x5d6b52);
      b.box(0, 0.6, -0.28, 0.8, 0.6, 0.18, 0x55614b);
      b.box(-0.36, 0.45, 0.05, 0.12, 0.35, 0.75, 0x4f5a45);
      b.box(0.36, 0.45, 0.05, 0.12, 0.35, 0.75, 0x4f5a45);
      break;
    case 'table':
      b.box(0, 0.72, 0, 0.9, 0.06, 0.9, LIGHTWOOD);
      for (const x of [-0.38, 0.38]) for (const z of [-0.38, 0.38]) b.box(x, 0.36, z, 0.06, 0.72, 0.06, WOOD);
      break;
    case 'dtable':
      b.box(0, 0.72, 0, 1.8, 0.06, 0.9, LIGHTWOOD);
      for (const x of [-0.82, 0.82]) for (const z of [-0.38, 0.38]) b.box(x, 0.36, z, 0.07, 0.72, 0.07, WOOD);
      break;
    case 'chair':
      b.box(0, 0.45, 0, 0.45, 0.05, 0.45, WOOD);
      b.box(0, 0.72, -0.2, 0.45, 0.5, 0.05, WOOD);
      for (const x of [-0.19, 0.19]) for (const z of [-0.19, 0.19]) b.box(x, 0.22, z, 0.04, 0.45, 0.04, DARKWOOD);
      break;
    case 'counter':
      b.box(0, 0.42, -0.02, 1.0, 0.84, 0.66, 0x8b7a62);
      b.box(0, 0.87, 0, 1.0, 0.05, 0.72, COUNTERTOP);
      b.box(0, 0.45, 0.31, 0.02, 0.6, 0.02, DARK);
      break;
    case 'sinkCounter':
      b.box(0, 0.42, -0.02, 1.0, 0.84, 0.66, 0x8b7a62);
      b.box(0, 0.87, 0, 1.0, 0.05, 0.72, COUNTERTOP);
      b.box(0, 0.86, 0.02, 0.55, 0.06, 0.42, 0x6f7479);
      b.box(0, 1.02, -0.25, 0.05, 0.25, 0.05, STEEL);
      break;
    case 'stove':
      b.box(0, 0.44, 0, 0.8, 0.88, 0.68, WHITE);
      b.box(0, 0.89, 0, 0.8, 0.03, 0.68, DARK);
      b.box(0, 0.4, 0.345, 0.6, 0.4, 0.02, DARK);
      b.box(0, 1.0, -0.3, 0.8, 0.2, 0.06, WHITE);
      break;
    case 'fridge':
      b.box(0, 0.9, 0, 0.82, 1.8, 0.7, 0xd9d6cd);
      b.box(0, 1.25, 0.352, 0.8, 0.01, 0.01, 0x9a978f);
      b.box(-0.3, 1.0, 0.36, 0.04, 0.5, 0.03, STEEL);
      break;
    case 'freezer':
      b.box(0, 0.45, 0, 0.95, 0.9, 0.7, 0xdedad0);
      b.box(0, 0.91, 0, 0.95, 0.03, 0.7, 0xc5c1b8);
      break;
    case 'toilet':
      b.box(0, 0.22, 0.08, 0.38, 0.44, 0.5, WHITE);
      b.box(0, 0.62, -0.25, 0.42, 0.4, 0.18, WHITE);
      break;
    case 'tub':
      b.box(0, 0.3, 0, 1.9, 0.6, 0.8, WHITE);
      b.box(0, 0.58, 0, 1.7, 0.06, 0.6, 0xa9b6bb);
      break;
    case 'bathSink':
      b.box(0, 0.4, -0.05, 0.2, 0.8, 0.2, WHITE);
      b.box(0, 0.85, 0, 0.6, 0.12, 0.5, WHITE);
      b.box(0, 1.55, -0.38, 0.55, 0.65, 0.16, 0xc8c4bb);
      b.box(0, 1.55, -0.29, 0.45, 0.5, 0.01, 0x9fb3bb);
      break;
    case 'wardrobe':
      b.box(0, 0.95, -0.05, 0.95, 1.9, 0.55, DARKWOOD);
      b.box(0, 0.95, 0.23, 0.01, 1.7, 0.01, 0x2a1d13);
      b.box(-0.06, 1.0, 0.24, 0.02, 0.15, 0.02, STEEL);
      b.box(0.06, 1.0, 0.24, 0.02, 0.15, 0.02, STEEL);
      break;
    case 'dresser':
      b.box(0, 0.5, -0.1, 0.95, 1.0, 0.5, WOOD);
      for (const y of [0.25, 0.55, 0.85]) b.box(0, y, 0.155, 0.85, 0.22, 0.02, 0x6a4c33);
      break;
    case 'nightstand':
      b.box(0, 0.28, -0.1, 0.45, 0.55, 0.42, WOOD);
      b.cyl(0.08, 0.7, -0.15, 0.08, 0.3, 0xd9cfae, 8, 0.05);
      break;
    case 'bookshelf': {
      b.box(0, 0.95, -0.2, 0.95, 1.9, 0.35, DARKWOOD);
      let seed = 7;
      for (const y of [0.15, 0.6, 1.05, 1.5]) {
        seed += 13;
        products(b, -0.43, 0.43, y, -0.15, 0.25, seed);
      }
      break;
    }
    case 'tv':
      b.box(0, 0.25, -0.15, 1.0, 0.5, 0.45, DARKWOOD);
      b.box(0, 0.8, -0.2, 0.9, 0.55, 0.06, DARK);
      break;
    case 'desk':
      b.box(0, 0.73, -0.05, 1.0, 0.05, 0.62, LIGHTWOOD);
      b.box(-0.3, 0.36, -0.05, 0.36, 0.7, 0.58, WOOD);
      b.box(0.45, 0.36, -0.05, 0.05, 0.7, 0.58, WOOD);
      b.box(0.1, 0.95, -0.2, 0.4, 0.35, 0.05, DARK);
      break;
    case 'filing':
      b.box(0, 0.65, -0.05, 0.5, 1.3, 0.6, 0x7e8488);
      for (const y of [0.3, 0.7, 1.1]) b.box(0, y, 0.255, 0.4, 0.3, 0.01, 0x6b7074);
      break;
    case 'shelf':
      b.box(0, 0.08, 0, 0.98, 0.16, 0.8, 0x9ea3a6);
      b.box(0, 0.8, 0, 0.98, 1.6, 0.08, 0xb4b8ba);
      for (const y of [0.2, 0.62, 1.04]) {
        b.box(0, y, 0, 0.98, 0.03, 0.8, 0xa5aaad);
        products(b, -0.47, 0.47, y + 0.02, 0.22, 0.3, (y * 100) | 0);
        products(b, -0.47, 0.47, y + 0.02, -0.22, 0.3, ((y * 100) | 0) + 3);
      }
      break;
    case 'rack':
      for (const x of [-0.47, 0.47]) b.box(x, 1.1, 0, 0.06, 2.2, 0.85, 0x3a5a9a);
      for (const y of [0.15, 0.85, 1.55]) {
        b.box(0, y, 0, 1.0, 0.06, 0.85, 0xd08a2a);
        b.box(-0.2, y + 0.25, 0, 0.45, 0.45, 0.6, 0xa88a60);
        b.box(0.25, y + 0.2, 0.05, 0.35, 0.35, 0.5, 0x9c7e56);
      }
      break;
    case 'cooler':
      b.box(0, 1.0, -0.05, 0.98, 2.0, 0.7, 0xd6d4ce);
      b.box(0, 1.05, 0.31, 0.9, 1.7, 0.02, 0x9fc4cf);
      for (const y of [0.4, 0.9, 1.4]) products(b, -0.43, 0.43, y, 0.1, 0.35, (y * 50) | 0);
      break;
    case 'checkout':
    case 'cashbox':
      b.box(0, 0.5, 0, 1.0, 1.0, 0.7, kind === 'checkout' ? 0x8f8a80 : 0x7a6a58);
      b.box(0, 1.02, 0, 1.0, 0.04, 0.72, COUNTERTOP);
      b.box(0.2, 1.15, -0.05, 0.35, 0.22, 0.3, DARK);
      break;
    case 'workbench':
      b.box(0, 0.9, 0, 1.95, 0.08, 0.72, LIGHTWOOD);
      for (const x of [-0.9, 0.9]) for (const z of [-0.3, 0.3]) b.box(x, 0.45, z, 0.08, 0.9, 0.08, WOOD);
      b.box(0, 0.25, 0, 1.8, 0.04, 0.6, WOOD);
      b.box(0, 1.5, -0.34, 1.9, 1.1, 0.04, 0x8b7e68);
      b.box(-0.4, 0.99, 0.05, 0.3, 0.1, 0.12, 0xa84030);
      b.box(0.3, 0.97, -0.1, 0.4, 0.06, 0.08, STEEL);
      break;
    case 'toolchest':
      b.box(0, 0.55, -0.05, 0.75, 1.1, 0.5, 0xa4302a);
      for (const y of [0.25, 0.5, 0.75, 1.0]) b.box(0, y, 0.2, 0.68, 0.02, 0.02, 0xd8d8d8);
      break;
    case 'crate':
    case 'woodcrate':
      b.box(0, 0.4, 0, 0.8, 0.8, 0.8, kind === 'crate' ? 0x9c7a4e : 0x8e6c44);
      b.box(0, 0.4, 0.405, 0.8, 0.08, 0.01, 0x6e5434);
      b.box(0, 0.4, -0.405, 0.8, 0.08, 0.01, 0x6e5434);
      break;
    case 'pallet':
      b.box(0, 0.07, 0, 0.95, 0.14, 0.95, 0x9a7b50);
      b.box(-0.2, 0.45, 0.05, 0.5, 0.6, 0.7, 0xb09164);
      b.box(0.25, 0.4, -0.1, 0.4, 0.5, 0.6, 0xa4865a);
      b.box(0.05, 0.95, 0, 0.6, 0.4, 0.6, 0xb89a6d);
      break;
    case 'locker':
      b.box(0, 0.95, -0.1, 0.9, 1.9, 0.45, 0x5d6d7a);
      for (const x of [-0.3, 0, 0.3]) b.box(x, 0.95, 0.125, 0.01, 1.85, 0.01, 0x3e4a54);
      break;
    case 'medbed':
      b.box(0, 0.5, 0, 1.9, 0.12, 0.85, STEEL);
      b.box(0, 0.62, 0, 1.85, 0.12, 0.8, 0xe9ecef);
      b.box(0.9, 0.85, 0, 0.06, 0.6, 0.85, STEEL);
      for (const x of [-0.85, 0.85]) for (const z of [-0.37, 0.37]) b.box(x, 0.25, z, 0.05, 0.5, 0.05, STEEL);
      break;
    case 'medcab':
      b.box(0, 0.9, -0.1, 0.9, 1.8, 0.45, 0xe6e8e6);
      b.box(0, 1.25, 0.125, 0.8, 0.9, 0.01, 0xa7c3cc);
      break;
    case 'pump':
      b.box(0, 0.1, 0, 0.9, 0.2, 0.6, 0x9a9a95);
      b.box(0, 0.85, 0, 0.6, 1.3, 0.4, 0xc8412f);
      b.box(0, 1.2, 0.21, 0.4, 0.25, 0.02, DARK);
      b.box(0.33, 0.8, 0, 0.06, 0.3, 0.1, DARK);
      break;
    case 'dumpster':
      b.box(0, 0.6, 0, 1.9, 1.2, 0.95, 0x3b5b43);
      b.box(0, 1.24, -0.05, 1.95, 0.08, 1.0, 0x2f4a36);
      break;
    case 'trash':
      b.cyl(0, 0.42, 0, 0.26, 0.84, 0x55605a, 10, 0.28);
      b.cyl(0, 0.87, 0, 0.29, 0.05, 0x444c47, 10);
      break;
    case 'bench':
      b.box(0, 0.45, 0.05, 1.8, 0.06, 0.45, WOOD);
      b.box(0, 0.75, -0.18, 1.8, 0.35, 0.05, WOOD);
      for (const x of [-0.8, 0.8]) b.box(x, 0.22, 0, 0.08, 0.45, 0.45, DARK);
      break;
    case 'lamp':
      b.cyl(0, 2.1, 0, 0.07, 4.2, 0x3d4247, 6);
      b.box(0.35, 4.15, 0, 0.8, 0.08, 0.08, 0x3d4247);
      b.box(0.7, 4.08, 0, 0.35, 0.1, 0.22, 0xdad3b8);
      break;
    case 'mailbox':
      b.box(0, 0.5, 0, 0.08, 1.0, 0.08, WOOD);
      b.box(0, 1.08, 0, 0.25, 0.22, 0.45, 0x48525c);
      break;
    case 'hydrant':
      b.cyl(0, 0.3, 0, 0.13, 0.6, 0xb0302a, 8);
      b.sphere(0, 0.62, 0, 0.12, 0xb0302a);
      b.cylX(0, 0.4, 0, 0.06, 0.4, 0xb0302a);
      break;
    case 'hay':
      b.box(0, 0.25, 0.05, 0.95, 0.5, 0.8, 0xc8aa5a);
      b.box(0.05, 0.75, 0, 0.85, 0.5, 0.75, 0xbfa052);
      break;
    case 'washer':
      b.box(0, 0.45, -0.05, 0.7, 0.9, 0.65, WHITE);
      b.cylX(0, 0.45, 0.28, 0.2, 0.02, 0x7a8a95, 12);
      break;
    case 'barcounter':
      b.box(0, 0.52, 0, 1.0, 1.04, 0.62, 0x4a3223);
      b.box(0, 1.07, 0.05, 1.0, 0.05, 0.75, 0x6a4a33);
      break;
    case 'booth':
      b.box(0, 0.25, 0.05, 0.95, 0.45, 0.6, 0x8a2f2a);
      b.box(0, 0.75, -0.25, 0.95, 0.7, 0.15, 0x8a2f2a);
      break;
    case 'pew':
      b.box(0, 0.45, 0.05, 1.9, 0.06, 0.45, DARKWOOD);
      b.box(0, 0.75, -0.2, 1.9, 0.55, 0.06, DARKWOOD);
      for (const x of [-0.9, 0.9]) b.box(x, 0.45, 0, 0.06, 0.9, 0.5, DARKWOOD);
      break;
    case 'generator':
      b.box(0, 0.35, 0, 0.8, 0.5, 0.55, 0xc9a227);
      b.box(0, 0.2, 0, 0.85, 0.06, 0.6, DARK);
      for (const x of [-0.42, 0.42]) b.box(x, 0.45, 0, 0.04, 0.6, 0.6, DARK);
      b.box(0.15, 0.63, 0, 0.3, 0.08, 0.25, 0xa4302a);
      break;
    case 'rainbarrel':
      b.cyl(0, 0.5, 0, 0.36, 1.0, 0x3a5f8a, 12);
      b.cyl(0, 1.08, 0, 0.45, 0.16, 0x2e2e2e, 12, 0.55);
      break;
    case 'campfire':
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        b.box(Math.cos(a) * 0.35, 0.07, Math.sin(a) * 0.35, 0.16, 0.14, 0.16, 0x77736c);
      }
      b.box(0, 0.08, 0, 0.5, 0.08, 0.08, 0x5a4029, Math.PI / 4);
      b.box(0, 0.08, 0, 0.5, 0.08, 0.08, 0x5a4029, -Math.PI / 4);
      break;
    case 'sleepbag':
      b.box(0, 0.06, 0, 0.8, 0.12, 0.9, 0x4a6a4a);
      break;
    case 'bbq':
      b.sphere(0, 0.85, 0, 0.3, DARK, 1, 0.6, 1);
      for (const a of [0, 2.1, 4.2]) b.box(Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2, 0.04, 0.8, 0.04, DARK);
      break;
    case 'well':
      b.cyl(0, 0.4, 0, 0.5, 0.8, 0x7d776d, 10);
      b.cyl(0, 0.79, 0, 0.38, 0.03, 0x1a2a30, 10);
      for (const x of [-0.45, 0.45]) b.box(x, 1.2, 0, 0.08, 1.6, 0.08, WOOD);
      b.box(0, 2.05, 0, 1.2, 0.08, 0.9, 0x5a4029, 0, 0, 0);
      break;
    case 'machine':
      b.box(0, 0.8, 0, 1.9, 1.6, 0.9, 0x5f6a6f);
      b.box(-0.5, 1.7, 0, 0.6, 0.3, 0.6, 0x4a5357);
      b.box(0.5, 1.0, 0.46, 0.4, 0.3, 0.02, 0xd8a02a);
      break;
    case 'sandbags':
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 2; k++) b.box(-0.25 + k * 0.5 + (r % 2) * 0.1, 0.16 + r * 0.3, 0, 0.5, 0.3, 0.7, 0xa8986c);
      }
      break;
    case 'alarmtrap':
      b.box(-0.45, 0.3, 0, 0.04, 0.6, 0.04, WOOD);
      b.box(0.45, 0.3, 0, 0.04, 0.6, 0.04, WOOD);
      b.box(0, 0.35, 0, 0.9, 0.01, 0.01, 0xd0c8a0);
      for (const x of [-0.2, 0.05, 0.25]) b.cyl(x, 0.28, 0, 0.04, 0.1, 0xb0b4b8, 6);
      break;
    case 'lumber':
      for (let r = 0; r < 4; r++) b.box(0, 0.12 + r * 0.2, 0, 0.95, 0.18, 0.8, r % 2 ? 0xc49a64 : 0xb88d58);
      break;
    case 'tractor':
      b.box(0.1, 0.9, 0, 1.4, 0.8, 0.8, 0x3f6e3a);
      b.box(-0.55, 1.6, 0, 0.6, 0.8, 0.8, 0x2f5a2c);
      b.cylX(-0.6, 0.55, 0.5, 0.55, 0.3, DARK, 12);
      b.cylX(-0.6, 0.55, -0.5, 0.55, 0.3, DARK, 12);
      b.cylX(0.7, 0.35, 0.45, 0.35, 0.2, DARK, 10);
      b.cylX(0.7, 0.35, -0.45, 0.35, 0.2, DARK, 10);
      break;
    case 'silo':
      b.cyl(0, 3, 0, 1.3, 6, 0xa8adb0, 14);
      b.cyl(0, 6.4, 0, 0.05, 0.8, 0x8a8f92, 14, 1.35);
      break;
    case 'lamptable':
      b.box(0, 0.3, -0.1, 0.4, 0.6, 0.4, WOOD);
      b.cyl(0, 0.8, -0.1, 0.03, 0.4, DARK, 6);
      b.cyl(0, 1.12, -0.1, 0.22, 0.28, 0xd9cfae, 10, 0.14);
      break;
    default:
      b.box(0, 0.4, 0, 0.8, 0.8, 0.8, 0x888888);
  }
  return b.build();
}

// ------------------------------------------------------------------ nature

export function treeTrunkGeometry(): THREE.BufferGeometry {
  return new GeoBuilder().cyl(0, 1.1, 0, 0.16, 2.2, 0x4a3a2c, 6, 0.1).build();
}
export function treeCanopyGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(0, 0, 0, 1.0, 0xffffff, 0.85);
  b.ico(0.45, 0.35, 0.2, 0.62, 0xf0f0f0, 0.9);
  b.ico(-0.4, 0.3, -0.3, 0.58, 0xe6e6e6, 0.9);
  return b.build();
}
export function pineCanopyGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cyl(0, -0.2, 0, 1.0, 1.4, 0xffffff, 7, 0.1);
  b.cyl(0, 0.7, 0, 0.75, 1.2, 0xf2f2f2, 7, 0.05);
  return b.build();
}
export function bushGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(0, 0.35, 0, 0.5, 0xffffff, 0.75);
  b.ico(0.25, 0.3, 0.15, 0.35, 0xeeeeee, 0.8);
  return b.build();
}
