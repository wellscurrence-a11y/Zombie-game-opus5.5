// Transient visuals: noise rings, blood, muzzle flashes, rain, fire, smoke, helicopter.
import * as THREE from 'three';
import type { Effect } from '../sim/runtime';
import type { GameState } from '../sim/types';
import { GeoBuilder } from './geom';
import { patchMaterial } from './shaderPatch';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class EffectsLayer {
  group = new THREE.Group();
  rings: THREE.Mesh[] = [];
  ringGeo = new THREE.RingGeometry(0.96, 1.0, 64).rotateX(-Math.PI / 2);
  blood: THREE.InstancedMesh;
  rain: THREE.InstancedMesh;
  rainDrops: Float32Array;
  fire: THREE.InstancedMesh;
  smoke: THREE.InstancedMesh;
  flash: THREE.PointLight;
  tracer: THREE.Line;
  heli: THREE.Group;
  heliLight: THREE.SpotLight;
  rotor: THREE.Mesh;
  constructor() {
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xe8e0c8, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 5;
      this.rings.push(m);
      this.group.add(m);
    }
    const bloodGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    this.blood = new THREE.InstancedMesh(bloodGeo, new THREE.MeshLambertMaterial({ color: 0x6a0c0a }), 400);
    this.blood.count = 0;
    this.blood.frustumCulled = false;
    this.group.add(this.blood);
    this.rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.7, 0.02), new THREE.MeshBasicMaterial({ color: 0x9fb2c0, transparent: true, opacity: 0.45, depthWrite: false }), 1400);
    this.rain.frustumCulled = false;
    this.rain.count = 0;
    this.rainDrops = new Float32Array(1400 * 3);
    for (let i = 0; i < 1400; i++) {
      this.rainDrops[i * 3] = Math.random() * 60 - 30;
      this.rainDrops[i * 3 + 1] = Math.random() * 14;
      this.rainDrops[i * 3 + 2] = Math.random() * 60 - 30;
    }
    this.group.add(this.rain);
    const flameGeo = new GeoBuilder().cyl(0, 0.5, 0, 0.35, 1.0, 0xffffff, 6, 0.02).build();
    this.fire = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, depthWrite: false }), 600);
    this.fire.count = 0;
    this.fire.frustumCulled = false;
    this.group.add(this.fire);
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.35, depthWrite: false }), 600);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
    this.flash = new THREE.PointLight(0xffd8a0, 0, 14, 1.5);
    this.group.add(this.flash);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.tracer = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8 }));
    this.tracer.visible = false;
    this.group.add(this.tracer);
    // helicopter
    this.heli = new THREE.Group();
    const body = new GeoBuilder()
      .box(0, 0, 0, 3.2, 1.2, 1.3, 0x2f3a33)
      .box(-2.6, 0.2, 0, 2.6, 0.3, 0.3, 0x2f3a33)
      .box(-3.8, 0.7, 0, 0.3, 1.1, 0.1, 0x2f3a33)
      .box(1.2, 0.05, 0, 0.8, 0.8, 1.1, 0x1d2830)
      .box(0, -0.8, 0.6, 2.4, 0.08, 0.08, 0x222222)
      .box(0, -0.8, -0.6, 2.4, 0.08, 0.08, 0x222222)
      .build();
    this.heli.add(new THREE.Mesh(body, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { noFog: true })));
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.25), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }));
    this.rotor.position.y = 0.75;
    this.heli.add(this.rotor);
    this.heliLight = new THREE.SpotLight(0xf4f0e0, 0, 40, 0.28, 0.5, 1);
    this.heliLight.position.set(0, -0.6, 0);
    this.heli.add(this.heliLight);
    this.heli.add(this.heliLight.target);
    this.heli.visible = false;
    this.heli.scale.setScalar(1.2);
    this.group.add(this.heli);
  }

  update(s: GameState, effects: Effect[], now: number, dt: number, center: THREE.Vector3, rain: number): void {
    // noise rings
    let ri = 0;
    let bi = 0;
    for (const e of effects) {
      const k = (now - e.t) / e.dur;
      if (k < 0 || k > 1) continue;
      if (e.kind === 'ring' && ri < this.rings.length) {
        const m = this.rings[ri++];
        m.visible = true;
        m.position.set(e.x, 0.06, e.y);
        const r = Math.max(0.3, (e.r ?? 1) * (0.25 + 0.75 * Math.sqrt(k)));
        m.scale.set(r, 1, r);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.5 * (1 - k);
        mat.color.setHex(e.color ?? 0xe8e0c8);
      } else if (e.kind === 'blood' && bi < 400) {
        // droplets arc outward and fall
        for (let j = 0; j < 6 && bi < 400; j++) {
          const a = (j / 6) * Math.PI * 2 + e.x * 7;
          const sp = 0.8 + ((j * 37) % 5) * 0.2;
          _p.set(e.x + Math.cos(a) * sp * k, Math.max(0.03, 1.1 + 2.2 * k - 6 * k * k), e.y + Math.sin(a) * sp * k);
          _m.compose(_p, _q.identity(), _s.set(1, 1, 1));
          this.blood.setMatrixAt(bi++, _m);
        }
      } else if (e.kind === 'flash') {
        this.flash.position.set(e.x, 1.3, e.y);
        this.flash.intensity = 40 * (1 - k);
      } else if (e.kind === 'tracer' && e.x2 !== undefined && e.y2 !== undefined) {
        const pos = this.tracer.geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, e.x, 1.3, e.y);
        pos.setXYZ(1, e.x2, 1.1, e.y2);
        pos.needsUpdate = true;
        this.tracer.visible = true;
        (this.tracer.material as THREE.LineBasicMaterial).opacity = 0.8 * (1 - k);
      }
    }
    for (; ri < this.rings.length; ri++) this.rings[ri].visible = false;
    this.blood.count = bi;
    this.blood.instanceMatrix.needsUpdate = true;
    if (!effects.some((e) => e.kind === 'flash' && now - e.t < e.dur)) this.flash.intensity = 0;
    if (!effects.some((e) => e.kind === 'tracer' && now - e.t < e.dur)) this.tracer.visible = false;

    // rain around the camera target
    const n = Math.floor(1400 * Math.min(1, rain * 1.2));
    this.rain.count = n;
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        let y = this.rainDrops[i * 3 + 1] - dt * 16;
        if (y < 0) y += 14;
        this.rainDrops[i * 3 + 1] = y;
        _p.set(center.x + this.rainDrops[i * 3], y, center.z + this.rainDrops[i * 3 + 2]);
        _m.compose(_p, _q.identity(), _s.set(1, 1, 1));
        this.rain.setMatrixAt(i, _m);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }

    // fires & smoke
    let fi = 0;
    let si = 0;
    const w = s.world;
    const addFlame = (x: number, y: number, heat: number, seed: number): void => {
      for (let j = 0; j < 3 && fi < 600; j++) {
        const fl = 0.6 + 0.4 * Math.sin(now * 9 + seed * 13 + j * 2.1);
        _p.set(x + 0.2 + ((seed * 7 + j * 3) % 6) / 10, 0, y + 0.2 + ((seed * 3 + j * 5) % 6) / 10);
        _m.compose(_p, _q.identity(), _s.set(0.6 + heat * 0.8, (0.6 + heat * 1.8) * fl, 0.6 + heat * 0.8));
        this.fire.setMatrixAt(fi, _m);
        this.fire.setColorAt(fi, _c.setHSL(0.06 + 0.04 * fl, 1, 0.5 + 0.1 * fl));
        fi++;
      }
      if (si < 600) {
        const k = (now * 0.3 + seed * 0.37) % 1;
        _p.set(x + 0.5, 1.5 + k * 6, y + 0.5 + k * 1.5);
        _m.compose(_p, _q.identity(), _s.setScalar(0.6 + k * 2.2));
        this.smoke.setMatrixAt(si++, _m);
      }
    };
    for (const k of Object.keys(s.fires)) {
      const i = Number(k);
      if (Math.abs((i % w.w) - center.x) > 40 || Math.abs(i / w.w - center.z) > 40) continue;
      addFlame(i % w.w, Math.floor(i / w.w), s.fires[i].heat, i);
    }
    for (const f of w.furniture) {
      if (f.gone || !f.on) continue;
      if (f.kind === 'campfire') addFlame(f.x - 0.15, f.y - 0.15, 0.25, f.id);
      if (f.kind === 'generator' && Math.abs(f.x - center.x) < 40 && Math.abs(f.y - center.z) < 40 && si < 600) {
        const k = (now * 0.8 + f.id * 0.3) % 1;
        _p.set(f.x + 0.8, 0.8 + k * 2, f.y + 0.5);
        _m.compose(_p, _q.identity(), _s.setScalar(0.2 + k * 0.6));
        this.smoke.setMatrixAt(si++, _m);
      }
    }
    this.fire.count = fi;
    this.smoke.count = si;
    this.fire.instanceMatrix.needsUpdate = true;
    if (this.fire.instanceColor) this.fire.instanceColor.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;

    // helicopter
    const h = s.events.heli;
    if (h && h.active) {
      this.heli.visible = true;
      this.heli.position.set(h.x, 14, h.y);
      this.heli.rotation.y = -Math.atan2(h.vy, h.vx);
      this.rotor.rotation.y += dt * 30;
      this.heliLight.intensity = 120;
      this.heliLight.target.position.set(0, -14, 0);
    } else {
      this.heli.visible = false;
      this.heliLight.intensity = 0;
    }
  }
}
