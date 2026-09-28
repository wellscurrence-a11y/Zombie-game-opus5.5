import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import { daylight, dayOfYear, hourOfDay } from '../core/time';
import { FURN } from '../world/furniture';
import { S, type World } from '../world/world';
import type { Runtime } from '../sim/runtime';
import type { GameState, Zombie } from '../sim/types';
import { inVehicle } from '../sim/vehicleSpecs';
import { CorpseLayer, FloorItemLayer, PlayerModel, VehicleLayer, ZombieLayer } from './entities';
import { EffectsLayer } from './effects';
import { shaderOpts, U } from './shaderPatch';
import { profileFor, type Profile } from './quality';
import { FurnitureLayer, Ground, NatureLayer, RoofLayer } from './staticLayers';
import { WallLayer } from './walls';
import { playerPose, shirtColor, pantsColor, outerColor } from './poses';

export interface Hover {
  kind: 'ground' | 'wall' | 'door' | 'window' | 'furn' | 'vehicle' | 'tree' | 'fence' | 'zombie' | 'corpse';
  x: number;
  y: number;
  tile: number;
  id: number;
}

const ELEV = (36 * Math.PI) / 180;
// reused every frame to avoid garbage
const C = {
  sun: new THREE.Color(), dusk: new THREE.Color(0xff9a5a), moon: new THREE.Color(0x6a80b0),
  nightHemi: new THREE.Color(0x2a3548), dayHemi: new THREE.Color(), overcast: new THREE.Color(0x9aa0a8), groundNight: new THREE.Color(0x151515),
  fog: new THREE.Color(), fogDay: new THREE.Color(0x8a9096),
};
const AZ = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180);

export class Renderer {
  gl: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  flashlight: THREE.SpotLight;
  headL: THREE.SpotLight;
  headR: THREE.SpotLight;
  ground!: Ground;
  walls!: WallLayer;
  furn!: FurnitureLayer;
  nature!: NatureLayer;
  roofs!: RoofLayer;
  zombies = new ZombieLayer();
  player = new PlayerModel();
  corpses = new CorpseLayer();
  vehicles = new VehicleLayer();
  floor = new FloorItemLayer();
  fx = new EffectsLayer();
  visTex!: THREE.DataTexture;
  visData!: Uint8Array;
  visCur!: Float32Array;
  lit: number[] = [];
  lightTex!: THREE.DataTexture;
  lightData!: Uint8Array;
  camRot = 0;
  camAz = AZ[0];
  zoom = 12;
  target = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private w!: World;
  private lastRev = { walls: -1, doors: -1, furn: -1, ground: -1 };
  private cutT = 0;
  profile: Profile;
  /** Adaptive render scale (0.5..1) and the player's own resolution multiplier. */
  resScale = 1;
  userScale = 1;
  autoRes = true;
  private ftAvg = 16;
  private adaptT = 0;
  private visT = 0;
  private visStamp!: Uint32Array;
  private visGen = 0;
  private rowMin!: Int32Array;
  private rowMax!: Int32Array;

  constructor(canvas: HTMLCanvasElement, profile: Profile = profileFor('high')) {
    this.profile = profile;
    shaderOpts.detail = profile.detail;
    this.resScale = profile.startScale;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: profile.antialias, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxDpr) * this.resScale);
    this.gl.shadowMap.enabled = profile.shadows;
    // error checks force a synchronous stall on every shader compile
    this.gl.debug.checkShaderErrors = false;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.scene.background = new THREE.Color(0x0a0c0e);
    this.hemi = new THREE.HemisphereLight(0xb8c8d8, 0x4a4436, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.flashlight = new THREE.SpotLight(0xfff4dc, 0, 20, 0.42, 0.55, 1.3);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.bias = -0.002;
    this.scene.add(this.flashlight, this.flashlight.target);
    this.headL = new THREE.SpotLight(0xfff0d0, 0, 28, 0.38, 0.6, 1.2);
    this.headR = new THREE.SpotLight(0xfff0d0, 0, 28, 0.38, 0.6, 1.2);
    this.scene.add(this.headL, this.headL.target, this.headR, this.headR.target);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  init(s: GameState): void {
    this.w = s.world;
    const w = s.world;
    for (const c of [...this.scene.children]) if (c.userData.world) this.scene.remove(c);
    this.zombies = new ZombieLayer();
    this.player = new PlayerModel();
    this.corpses = new CorpseLayer();
    this.vehicles = new VehicleLayer();
    this.floor = new FloorItemLayer();
    this.fx = new EffectsLayer();
    this.walls?.group.clear();
    this.visData = new Uint8Array(w.w * w.h * 4);
    this.visCur = new Float32Array(w.w * w.h);
    for (let i = 0; i < w.w * w.h; i++) this.visData[i * 4 + 1] = w.explored[i] ? 255 : 0;
    this.visStamp = new Uint32Array(w.w * w.h);
    this.rowMin = new Int32Array(w.h).fill(w.w);
    this.rowMax = new Int32Array(w.h).fill(-1);
    this.visTex = new THREE.DataTexture(this.visData, w.w, w.h, THREE.RGBAFormat);
    this.visTex.magFilter = THREE.LinearFilter;
    this.visTex.minFilter = THREE.LinearFilter;
    this.visTex.needsUpdate = true;
    U.uVis.value = this.visTex;
    this.lightData = new Uint8Array(w.w * w.h * 4);
    this.lightTex = new THREE.DataTexture(this.lightData, w.w, w.h, THREE.RGBAFormat);
    this.lightTex.magFilter = THREE.LinearFilter;
    this.lightTex.minFilter = THREE.LinearFilter;
    this.lightTex.needsUpdate = true;
    U.uLight.value = this.lightTex;
    this.ground = new Ground(w);
    this.walls = new WallLayer(w);
    this.furn = new FurnitureLayer(w);
    this.nature = new NatureLayer(w);
    this.roofs = new RoofLayer(w);
    const add = (o: THREE.Object3D): void => {
      o.userData.world = true;
      this.scene.add(o);
    };
    add(this.ground.mesh);
    add(this.walls.group);
    add(this.furn.group);
    add(this.nature.group);
    add(this.roofs.group);
    add(this.zombies.group);
    add(this.player.group);
    add(this.corpses.group);
    add(this.vehicles.group);
    add(this.floor.mesh);
    add(this.fx.group);
    this.lastRev = { ...w.rev };
    this.target.set(s.player.x, 0, s.player.y);
    this.precompile();
  }

  /**
   * Compile every shader variant up front: switched-off lights are removed from the scene (cheaper per
   * pixel), which changes the light count, so each on/off combination needs its own programs.
   */
  private precompile(): void {
    const lights = [this.flashlight, this.headL, this.headR];
    const combos = [[true, false, false], [false, true, true], [false, false, false]];
    for (const c of combos) {
      lights.forEach((l, i) => (l.visible = c[i]));
      this.flashlight.castShadow = c[0] && this.profile.spotShadows;
      try {
        this.gl.compile(this.scene, this.camera);
      } catch {
        // compiled lazily instead
      }
    }
    this.flashlight.castShadow = false;
  }

  /** Switch tier at runtime (antialiasing and surface detail only change on the next page load). */
  setProfile(p: Profile): void {
    this.profile = { ...p, antialias: this.profile.antialias, detail: this.profile.detail };
    this.gl.shadowMap.enabled = p.shadows;
    if (this.sun.shadow.mapSize.x !== p.shadowSize) {
      this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resScale = Math.min(this.resScale, 1);
    this.applyResolution();
  }

  applyResolution(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.profile.maxDpr);
    this.gl.setPixelRatio(Math.max(0.3, dpr * this.resScale * this.userScale));
    this.resize();
  }

  /** Nudge the render resolution to keep the frame rate playable. Call once per frame with the real frame time. */
  adapt(dt: number): void {
    if (!this.autoRes || dt <= 0 || dt > 0.25) return;
    this.ftAvg += (dt * 1000 - this.ftAvg) * 0.05;
    this.adaptT += dt;
    if (this.adaptT < 1.5) return;
    if (this.ftAvg > 32 && this.resScale > 0.5) {
      this.resScale = Math.max(0.5, Math.round((this.resScale - 0.1) * 10) / 10);
      this.adaptT = 0;
      this.applyResolution();
    } else if (this.ftAvg < 18 && this.adaptT > 10 && this.resScale < 1) {
      this.resScale = Math.min(1, Math.round((this.resScale + 0.1) * 10) / 10);
      this.adaptT = 0;
      this.applyResolution();
    }
  }

  resize(): void {
    const el = this.gl.domElement;
    const wpx = el.clientWidth || window.innerWidth;
    const hpx = el.clientHeight || window.innerHeight;
    this.gl.setSize(wpx, hpx, false);
    this.updateProjection();
  }

  private updateProjection(): void {
    const el = this.gl.domElement;
    const aspect = (el.clientWidth || window.innerWidth) / (el.clientHeight || window.innerHeight);
    const h = this.zoom;
    this.camera.left = -h * aspect;
    this.camera.right = h * aspect;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  /** Unit vectors on the ground: toward the camera, and screen-right. */
  camVectors(): { toCamX: number; toCamZ: number; rightX: number; rightZ: number } {
    const a = this.camAz;
    return { toCamX: Math.sin(a), toCamZ: Math.cos(a), rightX: Math.cos(a), rightZ: -Math.sin(a) };
  }

  rotate(dir: number): void {
    this.camRot = (this.camRot + dir + 4) % 4;
  }

  setZoom(delta: number): void {
    this.zoom = clamp(this.zoom * (delta > 0 ? 1.12 : 1 / 1.12), 5, 32);
    this.updateProjection();
  }

  /** Project a world point (tile x, height, tile y) to CSS pixel coordinates. */
  project(x: number, h: number, y: number): { sx: number; sy: number } {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    const el = this.gl.domElement;
    const wpx = el.clientWidth || window.innerWidth;
    const hpx = el.clientHeight || window.innerHeight;
    return { sx: (v.x * 0.5 + 0.5) * wpx, sy: (-v.y * 0.5 + 0.5) * hpx };
  }

  /** Intersect the mouse ray with a horizontal plane. Returns world (x, z). */
  screenToPlane(ndcX: number, ndcY: number, planeY = 0): { x: number; z: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const r = this.raycaster.ray;
    if (Math.abs(r.direction.y) < 1e-4) return null;
    const t = (planeY - r.origin.y) / r.direction.y;
    return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t };
  }

  /** Find what's under the cursor by marching the ray down through object heights. */
  pick(s: GameState, rt: Runtime, ndcX: number, ndcY: number): Hover | null {
    const w = s.world;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const r = this.raycaster.ray;
    // zombies & corpses first (screen-space-ish test on the ray at torso height)
    const at = (y: number): { x: number; z: number } => {
      const t = (y - r.origin.y) / r.direction.y;
      return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t };
    };
    const torso = at(1.0);
    let best: Hover | null = null;
    let bd = 0.45;
    for (const z of s.zombies) {
      if (Math.abs(z.x - torso.x) > 2 || Math.abs(z.y - torso.z) > 2) continue;
      if (!rt.vis[Math.floor(z.y) * w.w + Math.floor(z.x)]) continue;
      const p = z.state === 'down' || z.crawler ? at(0.15) : torso;
      const d = Math.hypot(z.x - p.x, z.y - p.z);
      if (d < bd) {
        bd = d;
        best = { kind: 'zombie', x: z.x, y: z.y, tile: Math.floor(z.y) * w.w + Math.floor(z.x), id: z.id };
      }
    }
    if (best) return best;
    for (let y = 3.2; y >= 0; y -= 0.05) {
      const p = at(y);
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.z);
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
      const i = ty * w.w + tx;
      const cut = this.walls.cut[i];
      const st = w.struct[i];
      for (const v of s.vehicles) {
        if (y < 1.4 && inVehicle(v, p.x, p.z)) return { kind: 'vehicle', x: p.x, y: p.z, tile: i, id: v.id };
      }
      if (st === S.Wall || st === S.BuiltWall) {
        const h = cut > 0.5 ? 0.45 : 2.6;
        const fx = p.x - tx - 0.5;
        const fz = p.z - ty - 0.5;
        if (y <= h && Math.abs(fx) < 0.5 && Math.abs(fz) < 0.5) return { kind: 'wall', x: tx, y: ty, tile: i, id: w.structRef[i] };
      } else if (st === S.Door) {
        const h = cut > 0.5 ? 0.45 : 2.2;
        if (y <= h) return { kind: 'door', x: tx, y: ty, tile: i, id: w.structRef[i] };
      } else if (st === S.Window) {
        const h = cut > 0.5 ? 0.45 : 2.1;
        if (y <= h) return { kind: 'window', x: tx, y: ty, tile: i, id: w.structRef[i] };
      } else if (st === S.FenceLow || st === S.FenceHigh) {
        const h = st === S.FenceHigh ? (cut > 0.5 ? 0.45 : 2) : 1;
        if (y <= h) return { kind: 'fence', x: tx, y: ty, tile: i, id: -1 };
      } else if (st === S.Tree) {
        if (y <= 2 && Math.hypot(p.x - tx - 0.5, p.z - ty - 0.5) < 0.35) return { kind: 'tree', x: tx, y: ty, tile: i, id: -1 };
      }
      const f = w.furn[i];
      if (f >= 0) {
        const fd = FURN[w.furniture[f].kind];
        const h = fd.h > 1.3 && cut > 0.5 ? 0.45 : Math.min(2.2, Math.max(0.35, fd.h));
        if (y <= h) return { kind: 'furn', x: tx, y: ty, tile: i, id: f };
      }
      if (y <= 0.3) {
        for (const c of s.corpses) {
          if (Math.hypot(c.x - p.x, c.y - p.z) < 0.6) return { kind: 'corpse', x: c.x, y: c.y, tile: i, id: c.id };
        }
      }
    }
    const g = at(0);
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.z);
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return null;
    return { kind: 'ground', x: g.x, y: g.z, tile: ty * w.w + tx, id: -1 };
  }

  update(s: GameState, rt: Runtime, dt: number): void {
    const w = s.world;
    const p = s.player;
    U.uTime.value = rt.realTime;
    // ---- camera follow
    let fx = p.x;
    let fz = p.y;
    if (p.inVehicle >= 0) {
      const v = s.vehicles[p.inVehicle];
      fx = v.x + Math.cos(v.heading) * v.speed * 0.35;
      fz = v.y + Math.sin(v.heading) * v.speed * 0.35;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.target.x = lerp(this.target.x, fx, k);
    this.target.z = lerp(this.target.z, fz, k);
    const targetAz = AZ[this.camRot];
    let dAz = targetAz - this.camAz;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;
    this.camAz += dAz * Math.min(1, dt * 8);
    const dist = 120;
    const shake = rt.shake > 0 ? (Math.random() - 0.5) * rt.shake * 0.3 : 0;
    this.camera.position.set(
      this.target.x + Math.sin(this.camAz) * Math.cos(ELEV) * dist + shake,
      Math.sin(ELEV) * dist,
      this.target.z + Math.cos(this.camAz) * Math.cos(ELEV) * dist + shake,
    );
    this.camera.lookAt(this.target.x, 0, this.target.z);

    // ---- static layer revisions
    if (w.rev.walls !== this.lastRev.walls) {
      this.walls.rebuildStatic();
      this.ground.refresh(w);
      this.nature.rebuild();
      this.lastRev.walls = w.rev.walls;
    }
    if (w.rev.doors !== this.lastRev.doors) {
      this.walls.dynDirty = true;
      this.lastRev.doors = w.rev.doors;
    }
    if (w.rev.furn !== this.lastRev.furn) {
      this.furn.rebuild();
      this.lastRev.furn = w.rev.furn;
    }
    if (w.rev.ground !== this.lastRev.ground) {
      this.ground.refresh(w);
      this.lastRev.ground = w.rev.ground;
    }
    if (rt.dirty.corpses) {
      this.corpses.rebuild(s.corpses);
      rt.dirty.corpses = false;
    }
    if (rt.dirty.floor) {
      this.floor.rebuild(s);
      rt.dirty.floor = false;
    }

    // ---- cutaway & roofs
    this.updateCut(s, rt, dt);
    this.walls.frame();
    this.roofs.update(dt);

    // ---- visibility texture
    this.updateVisTexture(s, rt, dt);
    if (!rt.lightDirty && rt.lightVersion !== this.lightVersion) this.uploadLight(rt);

    // ---- lighting / sky
    this.updateSky(s, rt);

    // ---- entities
    const visibleZ = (z: Zombie): boolean => {
      const xi = Math.floor(z.x);
      const yi = Math.floor(z.y);
      if (xi < 0 || yi < 0 || xi >= w.w || yi >= w.h) return false;
      return this.visCur[yi * w.w + xi] > 0.35;
    };
    this.zombies.update(s.zombies, visibleZ, rt.realTime);
    this.updatePlayerModel(s, rt);
    this.vehicles.update(s.vehicles, (v) => {
      const xi = Math.floor(v.x);
      const yi = Math.floor(v.y);
      return w.explored[yi * w.w + xi] === 1 || v.id === p.inVehicle;
    });
    this.fx.update(s, rt.effects, rt.realTime, dt, this.target, s.weather.rain);
    this.nature.setSeason(clamp((dayOfYear(s.time) - 250) / 60, 0, 2));
  }

  private updatePlayerModel(s: GameState, rt: Runtime): void {
    const p = s.player;
    const pm = this.player;
    pm.group.visible = p.inVehicle < 0;
    if (p.inVehicle >= 0) return;
    const shirt = p.worn.torso ? 0x6a7a5a : 0xc8a88a;
    const outer = p.worn.outer ? outerColor(p.worn.outer.id) : undefined;
    pm.setColors(shirtColor(p.worn.torso?.id), pantsColor(p.worn.legs?.id), 0xc8a88a, outer);
    void shirt;
    const held = p.primary ? p.inventory.find((i) => i.uid === p.primary) : null;
    pm.setWeapon(held ? held.id : null);
    const pose = playerPose(s, rt);
    let weaponAng = 0;
    if (p.attackT > 0 && p.attackDur > 0) {
      const k = 1 - p.attackT / p.attackDur;
      weaponAng = -0.6 + k * 1.2;
    }
    pm.apply(p.x, p.y, p.facing, pose, weaponAng, !!p.bag);
  }

  lightVersion = -1;
  private uploadLight(rt: Runtime): void {
    const d = this.lightData;
    const c = rt.lightColor;
    for (let i = 0; i < rt.light.length; i++) {
      d[i * 4] = Math.min(255, c[i * 3] * 200);
      d[i * 4 + 1] = Math.min(255, c[i * 3 + 1] * 200);
      d[i * 4 + 2] = Math.min(255, c[i * 3 + 2] * 200);
    }
    this.lightTex.needsUpdate = true;
    this.lightVersion = rt.lightVersion;
  }

  private updateCut(s: GameState, rt: Runtime, dt: number): void {
    const w = s.world;
    const p = s.player;
    let px = p.x;
    let py = p.y;
    if (p.inVehicle >= 0) {
      px = s.vehicles[p.inVehicle].x;
      py = s.vehicles[p.inVehicle].y;
    }
    const pti = Math.floor(py) * w.w + Math.floor(px);
    const indoors = w.room[pti] >= 0 && p.inVehicle < 0;
    const inBld = indoors ? w.bld[pti] : -1;
    const { toCamX, toCamZ, rightX, rightZ } = this.camVectors();
    const want = (x: number, y: number): boolean => {
      const dx = x + 0.5 - px;
      const dy = y + 0.5 - py;
      const along = dx * toCamX + dy * toCamZ;
      if (along < -0.3) return false;
      const lat = Math.abs(dx * rightX + dy * rightZ);
      if (indoors) {
        if (w.bld[y * w.w + x] === inBld) return along < 20 && lat < 20;
        return along < 9 && lat < 1.8 + along * 0.5;
      }
      return along < 7 && lat < 1.6 + along * 0.45;
    };
    this.walls.updateCut(px, py, 22, want, dt);
    this.cutT += dt;
    if (this.cutT > 0.1) {
      this.cutT = 0;
      this.furn.applyCut(this.walls.cut);
      this.nature.applyCut((x, y) => {
        const dx = x + 0.5 - px;
        const dy = y + 0.5 - py;
        const along = dx * toCamX + dy * toCamZ;
        if (along < -1.5 || along > 7) return false;
        const lat = Math.abs(dx * rightX + dy * rightZ);
        return lat < 2.2 + along * 0.3;
      });
    }
    // roofs
    const hidden = new Set<number>();
    if (inBld >= 0) hidden.add(inBld);
    for (let kk = 0.5; kk <= 7; kk += 0.5) {
      const qx = Math.floor(px + toCamX * kk);
      const qy = Math.floor(py + toCamZ * kk);
      if (qx < 0 || qy < 0 || qx >= w.w || qy >= w.h) continue;
      const b = w.bld[qy * w.w + qx];
      if (b >= 0 && 1.6 + kk * Math.tan(ELEV) < 5) hidden.add(b);
      // also look slightly to either side so the whole body stays visible
      for (const side of [-0.8, 0.8]) {
        const sx = Math.floor(px + toCamX * kk + rightX * side);
        const sy = Math.floor(py + toCamZ * kk + rightZ * side);
        if (sx < 0 || sy < 0 || sx >= w.w || sy >= w.h) continue;
        const b2 = w.bld[sy * w.w + sx];
        if (b2 >= 0 && 1.6 + kk * Math.tan(ELEV) < 5) hidden.add(b2);
      }
    }
    for (const r of this.roofs.roofs) r.target = hidden.has(r.b.id) ? 0 : 1;
  }

  private updateVisTexture(s: GameState, rt: Runtime, dt: number): void {
    // low tier: the fade is smooth enough at ~30 updates a second
    this.visT += dt;
    if (!this.profile.detail && this.visT < 1 / 30) return;
    dt = this.visT;
    this.visT = 0;
    const w = s.world;
    const W = w.w;
    const cur = this.visCur;
    const d = this.visData;
    const kIn = 1 - Math.exp(-dt * 10);
    const kOut = 1 - Math.exp(-dt * 5);
    const next: number[] = [];
    const gen = ++this.visGen;
    const stamp = this.visStamp;
    const rowMin = this.rowMin;
    const rowMax = this.rowMax;
    let yMin = w.h;
    let yMax = -1;
    const proc = (i: number): void => {
      if (stamp[i] === gen) return;
      stamp[i] = gen;
      const t = rt.vis[i];
      const c = cur[i];
      const n = t ? c + (1 - c) * kIn : c - c * kOut;
      cur[i] = n < 0.004 ? 0 : n;
      d[i * 4] = cur[i] * 255;
      d[i * 4 + 1] = w.explored[i] ? 255 : 0;
      if (cur[i] > 0) next.push(i);
      const x = i % W;
      const y = (i - x) / W;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    };
    for (const i of rt.visList) proc(i);
    for (const i of this.lit) proc(i);
    this.lit = next;
    if (yMax < 0) return;
    // upload only the rows that changed
    for (let y = yMin; y <= yMax; y++) {
      if (rowMax[y] < 0) continue;
      this.visTex.addUpdateRange((y * W + rowMin[y]) * 4, (rowMax[y] - rowMin[y] + 1) * 4);
      rowMin[y] = W;
      rowMax[y] = -1;
    }
    this.visTex.needsUpdate = true;
  }

  private updateSky(s: GameState, rt: Runtime): void {
    const day = daylight(s.time);
    const h = hourOfDay(s.time);
    const wx = s.weather;
    const overcast = Math.min(1, wx.cloud * 0.6 + wx.rain * 0.5 + wx.fog * 0.4);
    const dusk = smoothstep(0.0, 0.5, day) * (1 - smoothstep(0.5, 1.0, day));
    // sun arcs from east to west
    const sunAng = ((h - 6) / 12) * Math.PI;
    const sx = Math.cos(sunAng) * 60;
    const sy = Math.max(12, Math.sin(sunAng) * 70);
    this.sun.position.set(this.target.x - sx, sy, this.target.z - 30);
    this.sun.target.position.copy(this.target);
    const sunCol = C.sun.set(0xfff2de).lerp(C.dusk, dusk * 0.8);
    const moonCol = C.moon;
    if (day > 0.02) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 2.4 * day * (1 - overcast * 0.75);
    } else {
      this.sun.color.copy(moonCol);
      this.sun.intensity = 0.28 * (1 - wx.cloud * 0.7);
      this.sun.position.set(this.target.x + 30, 60, this.target.z - 40);
    }
    const dayHemi = C.dayHemi.set(0xb8c8d8).lerp(C.overcast, overcast);
    this.hemi.color.copy(C.nightHemi).lerp(dayHemi, day);
    this.hemi.groundColor.set(0x3a342a).lerp(C.groundNight, 1 - day);
    this.hemi.intensity = lerp(0.35, 1.25, day) * (1 - overcast * 0.2);
    U.uNight.value = 1 - day;
    U.uWet.value = wx.rain > 0.1 && wx.kind !== 'snow' ? Math.min(1, wx.rain * 1.4) : 0;
    U.uSnow.value = wx.snow ?? 0;
    const fogCol = C.fog.set(0x0a0c10).lerp(C.fogDay, wx.fog * day * 0.9 + wx.fog * 0.15);
    U.uFogColor.value.copy(fogCol);
    U.uFogAmt.value = wx.fog;
    if (!(this.scene.background instanceof THREE.Color)) this.scene.background = new THREE.Color();
    (this.scene.background as THREE.Color).copy(fogCol).multiplyScalar(0.9);
    this.gl.toneMappingExposure = 1.0 + (1 - day) * 0.25;
    // flashlight
    const p = s.player;
    const fl = p.inventory.find((i) => i.id === 'flashlight');
    const on = p.flashlight && !!fl && (fl.charge ?? 0) > 0 && p.inVehicle < 0 && !p.dead;
    this.flashlight.intensity = on ? 38 * Math.min(1, 0.4 + (fl!.charge ?? 0)) : 0;
    this.flashlight.position.set(p.x + Math.cos(p.facing) * 0.3, 1.3, p.y + Math.sin(p.facing) * 0.3);
    this.flashlight.target.position.set(p.x + Math.cos(p.facing) * 8, 0, p.y + Math.sin(p.facing) * 8);
    this.flashlight.castShadow = on && this.profile.spotShadows;
    this.flashlight.visible = on;
    // headlights
    if (p.inVehicle >= 0) {
      const v = s.vehicles[p.inVehicle];
      const on2 = v.lights && v.battery > 0.02;
      const c = Math.cos(v.heading);
      const sn = Math.sin(v.heading);
      for (const [light, side] of [[this.headL, 0.6], [this.headR, -0.6]] as [THREE.SpotLight, number][]) {
        light.intensity = on2 ? 55 : 0;
        light.visible = on2;
        light.position.set(v.x + c * 2.2 - sn * side, 0.9, v.y + sn * 2.2 + c * side);
        light.target.position.set(v.x + c * 14 - sn * side, 0, v.y + sn * 14 + c * side);
      }
    } else {
      this.headL.intensity = 0;
      this.headR.intensity = 0;
      this.headL.visible = false;
      this.headR.visible = false;
    }
    void rt;
  }

  private frameNo = 0;
  render(): void {
    // medium tier: redraw the sun's shadow map every other frame
    const sm = this.gl.shadowMap;
    if (sm.enabled && this.profile.tier === 'medium') {
      sm.autoUpdate = false;
      if ((this.frameNo & 1) === 0) sm.needsUpdate = true;
    } else sm.autoUpdate = true;
    this.frameNo++;
    this.gl.render(this.scene, this.camera);
  }
}
