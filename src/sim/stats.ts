// Derived survivor stats: carrying capacity, encumbrance, and how injuries and needs degrade ability.
import { def, itemWeight, type BodyPart, type Item } from './items';
import { lvl } from './skills';
import { hasTrait } from './traits';
import type { Player } from './types';

export function capacity(p: Player): number {
  return 11 + (lvl(p, 'strength') - 5) * 1.1;
}

export function bagCapacity(p: Player): number {
  if (!p.bag) return 0;
  const b = def(p.bag.id).bag!;
  let cap = b.cap;
  if (hasTrait(p.traits, 'organized')) cap *= 1.3;
  if (hasTrait(p.traits, 'disorganized')) cap *= 0.7;
  return cap;
}

export function bagContentsWeight(p: Player): number {
  if (!p.bag?.contents) return 0;
  let w = 0;
  for (const c of p.bag.contents) w += itemWeight(c);
  return w;
}

export function wornWeight(p: Player): number {
  let w = 0;
  for (const it of Object.values(p.worn)) if (it) w += itemWeight(it);
  return w;
}

export function inventoryWeight(p: Player): number {
  let w = 0;
  for (const it of p.inventory) w += itemWeight(it);
  return w;
}

/** Effective carried weight (worn clothes count for less, bags reduce their contents). */
export function carriedWeight(p: Player): number {
  let w = inventoryWeight(p) + wornWeight(p) * 0.35;
  if (p.bag) w += itemWeight(p.bag);
  if (p.carrying >= 0) w += 25;
  return w;
}

export function encumbrance(p: Player): number {
  return carriedWeight(p) / capacity(p);
}

export function encumbranceLevel(p: Player): 0 | 1 | 2 | 3 {
  const e = encumbrance(p);
  if (e <= 1) return 0;
  if (e <= 1.3) return 1;
  if (e <= 1.65) return 2;
  return 3;
}

export const ENC_NAMES = ['', 'Heavy load', 'Very heavy load', 'Overloaded'];

/** Worst injury factor on a set of body parts (1 = fine, lower = impaired). */
export function partFactor(p: Player, parts: BodyPart[]): number {
  let f = 1;
  for (const inj of p.body.injuries) {
    if (!parts.includes(inj.part)) continue;
    let k = 1;
    switch (inj.type) {
      case 'fracture':
        k = inj.splinted ? 0.55 : 0.3;
        break;
      case 'sprain':
        k = 0.7;
        break;
      case 'deep':
      case 'bite':
        k = 0.75;
        break;
      case 'cut':
        k = 0.88;
        break;
      case 'burn':
        k = 0.8;
        break;
      case 'bruise':
        k = 0.95;
        break;
      default:
        k = 0.96;
    }
    k = 1 - (1 - k) * (1 - inj.heal * 0.8);
    if (inj.glass) k *= 0.85;
    f = Math.min(f, k);
  }
  return f;
}

export const legFactor = (p: Player): number => Math.min(partFactor(p, ['lLeg', 'rLeg']), 0.3 + 0.7 * partFactor(p, ['lFoot', 'rFoot']));
export const handFactor = (p: Player): number => Math.min(partFactor(p, ['rHand', 'rArm']), 0.4 + 0.6 * partFactor(p, ['lHand', 'lArm']));

export function hasFracture(p: Player, parts: BodyPart[]): boolean {
  return p.body.injuries.some((i) => i.type === 'fracture' && parts.includes(i.part) && i.heal < 0.9);
}

/** Pain 0..1 from injuries, reduced by painkillers. */
export function pain(p: Player): number {
  let sum = 0;
  for (const inj of p.body.injuries) {
    const base: Record<string, number> = { scratch: 0.04, cut: 0.1, deep: 0.22, burn: 0.2, sprain: 0.14, fracture: 0.4, bite: 0.25, bruise: 0.05 };
    sum += (base[inj.type] ?? 0.05) * inj.severity * (1 - inj.heal) * (inj.glass ? 1.4 : 1) * (inj.infection > 0.3 ? 1.4 : 1);
  }
  if (p.body.feverLevel > 0) sum += p.body.feverLevel * 0.3;
  if (p.needs.painkiller > 0) sum *= 0.35;
  return Math.min(1, sum);
}

export function heldItem(p: Player): Item | null {
  if (!p.primary) return null;
  return p.inventory.find((i) => i.uid === p.primary) ?? null;
}

/** General physical capability multiplier from exhaustion, fatigue, pain, sickness. */
export function vigor(p: Player): number {
  const n = p.needs;
  let v = 1;
  if (n.endurance < 0.5) v *= 0.55 + n.endurance * 0.9;
  if (n.fatigue > 0.7) v *= 1 - (n.fatigue - 0.7) * 0.8;
  v *= 1 - pain(p) * 0.35;
  if (n.sick > 0.4) v *= 1 - (n.sick - 0.4) * 0.6;
  if (n.hunger > 0.7) v *= 0.85;
  if (n.thirst > 0.7) v *= 0.85;
  if (p.body.blood < 0.8) v *= 0.6 + (p.body.blood - 0.3) * 0.8;
  if (n.drunk > 0.3) v *= 0.9;
  if (n.temp < 35.5 || n.temp > 39) v *= 0.8;
  return Math.max(0.15, v);
}
