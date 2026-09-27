// What the survivor can see: a view cone limited by walls, darkness, weather and panic.
import { angleDiff, smoothstep } from '../core/math';
import { shadowcast } from './fov';
import { ambient, tileLight } from './lighting';
import type { Runtime } from './runtime';
import type { GameState } from './types';
import { blocksSight } from './worldq';
import { VEH } from './vehicleSpecs';
import { hasTrait } from './traits';

export interface VisionParams {
  maxRange: number;
  halfCone: number;
  nearR: number;
  flash: boolean;
}

export function visionParams(s: GameState): VisionParams {
  const p = s.player;
  const t = p.traits;
  let maxRange = 38;
  if (hasTrait(t, 'eagleEyed')) maxRange *= 1.15;
  if (hasTrait(t, 'shortSighted')) maxRange *= 0.72;
  const wx = s.weather;
  maxRange *= 1 - wx.fog * 0.68 - wx.rain * 0.28;
  if (p.needs.fatigue > 0.85) maxRange *= 0.85;
  if (p.needs.drunk > 0.4) maxRange *= 0.8;
  let halfCone = (80 * Math.PI) / 180;
  if (hasTrait(t, 'eagleEyed')) halfCone += 0.12;
  const panic = p.needs.calm > 0 ? p.needs.panic * 0.4 : p.needs.panic;
  halfCone -= panic * 0.5;
  if (p.worn.head?.id === 'helmet') halfCone -= 0.14;
  if (p.inVehicle >= 0) halfCone = Math.PI;
  const nearR = hasTrait(t, 'keenHearing') ? 2.6 : hasTrait(t, 'hardOfHearing') ? 1.2 : 1.8;
  const light = p.inventory.find((i) => i.id === 'flashlight');
  const flash = p.flashlight && !!light && (light.charge ?? 0) > 0;
  return { maxRange: Math.max(6, maxRange), halfCone, nearR, flash };
}

export function updateVision(s: GameState, rt: Runtime, force = false): void {
  const p = s.player;
  const w = s.world;
  let ox = p.x;
  let oy = p.y;
  let facing = p.facing;
  if (p.inVehicle >= 0) {
    const v = s.vehicles[p.inVehicle];
    ox = v.x;
    oy = v.y;
    facing = v.heading;
  }
  const tx = Math.floor(ox);
  const ty = Math.floor(oy);
  const moved = Math.abs(ox - rt.fovX) > 0.25 || Math.abs(oy - rt.fovY) > 0.25 || Math.abs(angleDiff(facing, rt.fovF)) > 0.08;
  if (!force && !rt.fovDirty && !moved && rt.realTime - rt.fovT < 0.25) return;
  rt.fovT = rt.realTime;
  rt.fovX = ox;
  rt.fovY = oy;
  rt.fovF = facing;
  rt.fovDirty = false;
  for (const i of rt.visList) rt.vis[i] = 0;
  rt.visList.length = 0;
  const vp = visionParams(s);
  const amb = ambient(s);
  const headlights = p.inVehicle >= 0 && s.vehicles[p.inVehicle].lights;
  const vehLen = p.inVehicle >= 0 ? VEH[s.vehicles[p.inVehicle].type].l / 2 : 0;
  const mark = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) return;
    const i = y * w.w + x;
    if (rt.vis[i]) return;
    rt.vis[i] = 1;
    rt.visList.push(i);
    w.explored[i] = 1;
  };
  shadowcast(tx, ty, Math.ceil(vp.maxRange), (x, y) => {
    if (p.inVehicle >= 0 && Math.hypot(x + 0.5 - ox, y + 0.5 - oy) < vehLen) return false;
    return blocksSight(w, x, y);
  }, (x, y) => {
    const dx = x + 0.5 - ox;
    const dy = y + 0.5 - oy;
    const d = Math.hypot(dx, dy);
    if (d <= vp.nearR + vehLen) {
      mark(x, y);
      return;
    }
    const a = Math.atan2(dy, dx);
    const off = Math.abs(angleDiff(facing, a));
    if (off > vp.halfCone) return;
    let L = tileLight(s, rt, x, y, amb);
    if (vp.flash && off < 0.4 && d < 17) L += 0.75 * (1 - d / 17) * (1 - off / 0.4);
    if (headlights && off < 0.5 && d < 24) L += 0.9 * (1 - d / 24);
    const R = 3.2 + (vp.maxRange - 3.2) * smoothstep(0.03, 0.42, L);
    if (d <= R) mark(x, y);
  });
  mark(tx, ty);
}

/** Is a world position currently visible to the survivor? */
export function isVisible(s: GameState, rt: Runtime, x: number, y: number): boolean {
  const w = s.world;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= w.w || yi >= w.h) return false;
  return rt.vis[yi * w.w + xi] === 1;
}
