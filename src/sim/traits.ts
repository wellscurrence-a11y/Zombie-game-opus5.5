import type { Skill } from './items';

export interface TraitDef {
  id: string;
  name: string;
  cost: number;
  desc: string;
  excludes?: string[];
}

/** Positive traits cost points, negative traits give points. */
export const TRAITS: TraitDef[] = [
  { id: 'brave', name: 'Brave', cost: 4, desc: 'Panics far less around the dead.', excludes: ['cowardly'] },
  { id: 'athletic', name: 'Athletic', cost: 6, desc: 'Runs faster and longer. Fitness +2.', excludes: ['unfit'] },
  { id: 'strong', name: 'Strong', cost: 6, desc: 'Hits harder, carries more. Strength +2.', excludes: ['weak'] },
  { id: 'keenHearing', name: 'Keen hearing', cost: 4, desc: 'Hears noises from farther away and senses nearby movement behind you.', excludes: ['hardOfHearing'] },
  { id: 'eagleEyed', name: 'Eagle eyed', cost: 4, desc: 'Sees farther and has a wider field of view.', excludes: ['shortSighted'] },
  { id: 'graceful', name: 'Graceful', cost: 4, desc: 'Makes less noise and rarely trips on fences.', excludes: ['clumsy'] },
  { id: 'fastHealer', name: 'Fast healer', cost: 4, desc: 'Wounds heal quicker.', excludes: ['slowHealer'] },
  { id: 'ironGut', name: 'Iron gut', cost: 3, desc: 'Less likely to get food poisoning.', excludes: ['weakStomach'] },
  { id: 'lightSleeper', name: 'Light sleeper', cost: 2, desc: 'Wakes up at the slightest noise nearby.', excludes: ['heavySleeper'] },
  { id: 'organized', name: 'Organized', cost: 4, desc: 'Bags hold 30% more.', excludes: ['disorganized'] },
  { id: 'thickSkinned', name: 'Thick skinned', cost: 6, desc: 'Scratches are less likely to break the skin.', excludes: ['thinSkinned'] },
  { id: 'nightOwl', name: 'Night owl', cost: 2, desc: 'Needs less sleep.' },
  { id: 'cowardly', name: 'Cowardly', cost: -4, desc: 'Panics easily.', excludes: ['brave'] },
  { id: 'unfit', name: 'Out of shape', cost: -6, desc: 'Tires quickly. Fitness -2.', excludes: ['athletic'] },
  { id: 'weak', name: 'Weak', cost: -6, desc: 'Hits softer, carries less. Strength -2.', excludes: ['strong'] },
  { id: 'hardOfHearing', name: 'Hard of hearing', cost: -4, desc: 'Hears less, and later.', excludes: ['keenHearing'] },
  { id: 'shortSighted', name: 'Short sighted', cost: -3, desc: 'Sees less far.', excludes: ['eagleEyed'] },
  { id: 'clumsy', name: 'Clumsy', cost: -4, desc: 'Noisier, and trips over fences more often.', excludes: ['graceful'] },
  { id: 'slowHealer', name: 'Slow healer', cost: -4, desc: 'Wounds heal slowly.', excludes: ['fastHealer'] },
  { id: 'weakStomach', name: 'Weak stomach', cost: -3, desc: 'Gets food poisoning more easily.', excludes: ['ironGut'] },
  { id: 'heavySleeper', name: 'Heavy sleeper', cost: -2, desc: 'Sleeps through noise — including noise at the door.', excludes: ['lightSleeper'] },
  { id: 'disorganized', name: 'Disorganized', cost: -3, desc: 'Bags hold 30% less.', excludes: ['organized'] },
  { id: 'thinSkinned', name: 'Thin skinned', cost: -6, desc: 'Scratches break the skin more often.', excludes: ['thickSkinned'] },
  { id: 'smoker', name: 'Smoker', cost: -3, desc: 'Gets stressed without cigarettes.' },
  { id: 'hemophobic', name: 'Hemophobic', cost: -3, desc: 'Panics at the sight of their own blood. Treating wounds is stressful.' },
];

export interface OccupationDef {
  id: string;
  name: string;
  points: number;
  desc: string;
  skills: Partial<Record<Skill, number>>;
  items: string[];
  mags?: string[];
  traits?: string[];
}

export const OCCUPATIONS: OccupationDef[] = [
  { id: 'unemployed', name: 'Unemployed', points: 8, desc: 'No particular skills — but plenty of room to choose traits.', skills: {}, items: [] },
  { id: 'cook', name: 'Line Cook', points: 0, desc: 'Knows how to cook and handle a knife.', skills: { cooking: 3, blade: 1 }, items: ['knife'] },
  { id: 'paramedic', name: 'Paramedic', points: -2, desc: 'Treats wounds quickly and correctly.', skills: { medicine: 3, fitness: 1 }, items: ['bandage', 'wipes'] },
  { id: 'carpenter', name: 'Carpenter', points: 0, desc: 'Builds and barricades quickly and solidly.', skills: { carpentry: 3, blunt: 1 }, items: ['hammer'] },
  { id: 'mechanic', name: 'Mechanic', points: -2, desc: 'Repairs vehicles and can hotwire them.', skills: { mechanics: 3, electrical: 1 }, items: ['wrench'], mags: ['hotwire'] },
  { id: 'guard', name: 'Security Guard', points: 0, desc: 'Used to night shifts. Handy with a baton.', skills: { blunt: 2, sneaking: 1 }, items: ['flashlight'], traits: ['nightOwl'] },
  { id: 'ranger', name: 'Park Ranger', points: -2, desc: 'Knows the woods: foraging, trapping and moving quietly.', skills: { foraging: 3, carpentry: 1, sneaking: 1 }, items: [], mags: ['traps'] },
  { id: 'electrician', name: 'Electrician', points: -2, desc: 'Wires generators and hotwires cars.', skills: { electrical: 3, mechanics: 1 }, items: ['screwdriver'], mags: ['generator', 'hotwire'] },
  { id: 'farmer', name: 'Farmer', points: 0, desc: 'Grows food and knows wild plants.', skills: { farming: 3, foraging: 1 }, items: [] },
  { id: 'police', name: 'Police Officer', points: -4, desc: 'Trained with firearms. Knows every shot draws a crowd.', skills: { firearms: 3, blunt: 1, fitness: 1 }, items: [] },
  { id: 'burglar', name: 'Burglar', points: -2, desc: 'Quiet on their feet. Hotwires cars and pries doors.', skills: { sneaking: 3, electrical: 1 }, items: [], mags: ['hotwire'] },
  { id: 'athlete', name: 'Fitness Instructor', points: -4, desc: 'In excellent shape.', skills: { fitness: 3, strength: 1 }, items: [] },
];

export const hasTrait = (traits: string[], id: string): boolean => traits.includes(id);
