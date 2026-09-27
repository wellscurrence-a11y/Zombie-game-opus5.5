import type { Runtime } from '../sim/runtime';
import type { GameState } from '../sim/types';
import { REST, type Pose } from './entities';
import { def } from '../sim/items';

const SHIRT: Record<string, number> = { tshirt: 0x7a8a6a, shirt: 0x8a9ab0, hoodie: 0x55606a, sweater: 0x7a5a4a };
const PANTS: Record<string, number> = { jeans: 0x3a4a6a, slacks: 0x4a4540, shorts: 0x6a6048, workPants: 0x5a5a48 };
const OUTER: Record<string, number> = { denimJacket: 0x4a6080, leatherJacket: 0x3a2a22, winterCoat: 0x6a3a2a, raincoat: 0xc8b040, vest: 0x2a2e30 };

export const shirtColor = (id?: string): number => (id ? SHIRT[id] ?? 0x7a7a6a : 0xc8a88a);
export const pantsColor = (id?: string): number => (id ? PANTS[id] ?? 0x4a4a4a : 0xc8a88a);
export const outerColor = (id: string): number => OUTER[id] ?? 0x555555;

export function playerPose(s: GameState, rt: Runtime): Pose {
  const p = s.player;
  const pose: Pose = { ...REST };
  const spd = Math.hypot(p.vx, p.vy);
  const t = rt.realTime;
  if (p.dead || p.downT > 0 || p.sleeping) {
    pose.tilt = -Math.PI / 2;
    pose.lift = 0.14;
    pose.armL = 0.3;
    pose.armR = 0.2;
    return pose;
  }
  const phase = t * (p.running ? 11 : 7.5);
  const stride = Math.min(1, spd / 1.6) * (p.running ? 0.8 : 0.5);
  pose.legL = Math.sin(phase) * stride;
  pose.legR = -Math.sin(phase) * stride;
  pose.armL = -Math.sin(phase) * stride * 0.8;
  pose.armR = Math.sin(phase) * stride * 0.8;
  if (p.running) pose.torsoLean = 0.18;
  if (p.stance === 'crouch') {
    pose.crouch = 1;
    pose.armL += 0.3;
    pose.armR += 0.3;
  }
  const held = p.primary ? p.inventory.find((i) => i.uid === p.primary) : null;
  const d = held ? def(held.id) : null;
  if (d?.firearm) {
    pose.armR = 1.45;
    pose.armL = 1.35;
    pose.armSpread = -0.25;
  } else if (d?.weapon) {
    pose.armR = Math.max(pose.armR, 0.5);
    if (d.weapon.twoHanded) pose.armL = Math.max(pose.armL, 0.5);
  }
  if (p.attackT > 0 && p.attackDur > 0) {
    const k = 1 - p.attackT / p.attackDur;
    const swing = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55;
    pose.armR = 0.4 + swing * 2.2;
    if (d?.weapon?.twoHanded) pose.armL = pose.armR - 0.2;
    pose.torsoLean = 0.1 + swing * 0.15;
  }
  if (p.shoveT > 0) {
    pose.armL = 1.5;
    pose.armR = 1.5;
    pose.torsoLean = 0.25;
  }
  if (p.grabbedBy.length) {
    pose.torsoLean = -0.2;
    pose.armL = 1.9;
    pose.armR = 1.7;
    pose.roll = Math.sin(t * 20) * 0.08;
  }
  const act = rt.action;
  if (act) {
    const ph = Math.sin(t * 8);
    if (act.anim === 'kneel' || act.anim === 'search') {
      pose.crouch = 1;
      pose.armL = 0.9 + ph * 0.2;
      pose.armR = 0.9 - ph * 0.2;
    } else if (act.anim === 'hammer' || act.anim === 'work') {
      pose.armR = 1.3 + Math.max(0, Math.sin(t * 10)) * 0.9;
      pose.armL = 1.0;
    } else if (act.anim === 'eat' || act.anim === 'use') {
      pose.armR = 1.9 + ph * 0.1;
    } else if (act.anim === 'read') {
      pose.armL = 1.1;
      pose.armR = 1.1;
      pose.headTurn = 0;
    }
  }
  if (p.climbT > 0) {
    pose.lift = 0.35;
    pose.torsoLean = 0.6;
    pose.legL = -0.8;
    pose.armL = 1.6;
    pose.armR = 1.6;
  }
  return pose;
}
