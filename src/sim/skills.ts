import type { Skill } from './items';
import type { Player } from './types';

export const SKILLS: Skill[] = [
  'strength', 'fitness', 'blunt', 'blade', 'firearms', 'sneaking', 'carpentry', 'cooking', 'mechanics', 'medicine', 'electrical', 'farming', 'foraging',
];

export const SKILL_NAMES: Record<Skill, string> = {
  strength: 'Strength', fitness: 'Fitness', blunt: 'Blunt weapons', blade: 'Blades', firearms: 'Firearms', sneaking: 'Sneaking',
  carpentry: 'Carpentry', cooking: 'Cooking', mechanics: 'Mechanics', medicine: 'First aid', electrical: 'Electrical',
  farming: 'Farming', foraging: 'Foraging',
};

/** Cumulative XP needed for each level 0..10. */
export const XP_T = [0, 50, 150, 300, 550, 900, 1400, 2100, 3000, 4200, 6000];

export function levelFromXp(xp: number): number {
  let l = 0;
  while (l < 10 && xp >= XP_T[l + 1]) l++;
  return l;
}

export function lvl(p: Player, s: Skill): number {
  return levelFromXp(p.xp[s] ?? 0);
}

/** Progress 0..1 toward the next level. */
export function levelProgress(xp: number): number {
  const l = levelFromXp(xp);
  if (l >= 10) return 1;
  return (xp - XP_T[l]) / (XP_T[l + 1] - XP_T[l]);
}

export function blankXp(): Record<Skill, number> {
  const o = {} as Record<Skill, number>;
  for (const s of SKILLS) o[s] = 0;
  o.strength = XP_T[5];
  o.fitness = XP_T[5];
  return o;
}

/**
 * Grant XP. Returns the new level if the player levelled up (for a message), else -1.
 * Passive skills (strength/fitness) level slowly.
 */
export function addXp(p: Player, s: Skill, amount: number, traitMult = 1): number {
  const before = lvl(p, s);
  let mult = traitMult;
  const boost = p.bookBoost[s];
  if (boost !== undefined && before < boost) mult *= 3;
  if (s === 'strength' || s === 'fitness') mult *= 0.25;
  p.xp[s] = Math.min(XP_T[10], (p.xp[s] ?? 0) + amount * mult);
  const after = lvl(p, s);
  return after > before ? after : -1;
}
