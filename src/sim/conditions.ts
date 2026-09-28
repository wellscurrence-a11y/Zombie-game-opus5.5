// Status conditions shown on the HUD. They tell the player what's wrong, why, and exactly what it does to
// them right now. The effect lines are worked out from the same numbers the simulation uses.
import { effectiveBleed } from './body';
import { ambient, tileLight } from './lighting';
import type { Runtime } from './runtime';
import { ENC_NAMES, encumbranceLevel, handFactor, legFactor, pain } from './stats';
import type { GameState } from './types';
import { BORED_CUTS, UNHAPPY_CUTS, workMult } from './mood';

export interface Condition {
  id: string;
  label: string;
  level: number;
  tone: 'bad' | 'warn' | 'info' | 'good';
  /** What to do about it. */
  tip: string;
  /** What it is doing to you right now, in plain numbers. */
  effects: string[];
}

function lv(v: number, cuts: number[]): number {
  let l = 0;
  for (let i = 0; i < cuts.length; i++) if (v >= cuts[i]) l = i + 1;
  return l;
}

/** Whole-number percentage. */
const pc = (x: number): string => `${Math.round(Math.abs(x) * 100)}%`;
/** One decimal, for per-hour rates. */
const f1 = (x: number): string => (Math.round(x * 10) / 10).toString();

export function conditions(s: GameState, rt: Runtime): Condition[] {
  const p = s.player;
  const n = p.needs;
  const b = p.body;
  const out: Condition[] = [];
  const add = (id: string, labels: string[], level: number, tip: string, effects: string[], tone?: Condition['tone']): void => {
    if (level <= 0) return;
    out.push({ id, label: labels[Math.min(labels.length, level) - 1], level, tone: tone ?? (level >= 3 ? 'bad' : level === 2 ? 'warn' : 'info'), tip, effects });
  };

  if (p.grabbedBy.length) {
    add('grabbed', ['Grabbed!'], 4, 'Press Space to shove free. Every second you\'re held, others can bite.', [
      'You can\'t move while held',
      `Held by ${p.grabbedBy.length}: +30% chance for any zombie to hit you, and bites become far more likely`,
      p.inVehicle >= 0 ? 'Drive off to break their grip; two sets of hands on a stopped car can drag you out' : 'Space tries to break free (harder when tired, panicked, or held by more than one)',
    ], 'bad');
  }

  let bleed = 0;
  for (const i of b.injuries) bleed += effectiveBleed(i);
  add('bleed', ['Bleeding', 'Bleeding', 'Bleeding badly', 'Hemorrhaging'], bleed > 0.004 ? lv(bleed, [0, 0.03, 0.08, 0.15]) : 0, 'Open the Health panel (H) and bandage it now.', [
    `Losing ${pc(bleed)} of your blood per game hour`,
    `Blood ${pc(b.blood)}: health starts draining below 72%, death at 22%`,
    'Blood won\'t regenerate while you\'re bleeding',
  ]);

  const lost = 1 - b.blood;
  const bloodFx: string[] = [];
  if (b.blood < 0.8) bloodFx.push(`Physical strength −${pc(1 - (0.6 + (b.blood - 0.3) * 0.8))}`);
  if (b.blood < 0.72) bloodFx.push(`Losing ${f1((0.72 - b.blood) * 90)} health per game hour`);
  bloodFx.push(`Blood at ${pc(b.blood)} (death at 22%). It slowly returns if you're not bleeding, hungry or thirsty`);
  add('blood', ['Pale', 'Lightheaded', 'Blood loss', 'Critical blood loss'], lv(lost, [0.12, 0.28, 0.45, 0.6]), 'You\'ve lost blood. Stop the bleeding, rest, eat and drink.', bloodFx);

  if (b.feverLevel > 0) {
    add('fever', ['Feverish', 'Fever', 'High fever', 'Burning up'], lv(b.feverLevel, [0.01, 0.3, 0.6, 0.85]), 'The bite is taking hold. There is no cure.', [
      `Losing ${f1(b.feverLevel * b.feverLevel * 20)} health per game hour, and rising`,
      `Fits of vomiting (${pc(Math.min(1, 0.5 * b.feverLevel))} chance an hour): noisy, and each one leaves you thirstier`,
      `Adds ${pc(b.feverLevel * 0.3)} pain`,
    ], 'bad');
  }

  let inf = 0;
  for (const i of b.injuries) inf = Math.max(inf, i.infection);
  const infFx: string[] = [];
  if (inf > 0.3) infFx.push('That wound heals 80% slower and hurts 40% more');
  if (inf > 0.45) infFx.push(`Losing ${f1((inf - 0.45) * 22 + (inf >= 1 ? 25 : 0))} health per game hour`);
  else infFx.push('Not draining health yet — treat it before it does');
  add('infect', ['Wound swelling', 'Infected wound', 'Badly infected', 'Sepsis'], lv(inf, [0.15, 0.35, 0.6, 0.85]), 'Disinfect it, keep it clean, take antibiotics.', infFx);

  const hungerFx: string[] = [];
  if (n.hunger > 0.6) hungerFx.push('Stamina recovers 30% slower', 'Stress creeps up');
  if (n.hunger > 0.7) hungerFx.push('Physical strength −15%', 'Wounds heal 60% slower');
  if (n.hunger > 0.8) hungerFx.push('Lost blood no longer comes back');
  if (n.hunger >= 0.95) hungerFx.push('Losing 1.5 health per game hour (starving)');
  if (!hungerFx.length) hungerFx.push('No penalties yet. At "Very hungry" stamina and healing suffer');
  add('hunger', ['Peckish', 'Hungry', 'Very hungry', 'Starving'], lv(n.hunger, [0.25, 0.45, 0.65, 0.85]), 'Eat something.', hungerFx);

  const thirstFx: string[] = [];
  if (n.thirst > 0.6) thirstFx.push('Stamina recovers 30% slower');
  if (n.thirst > 0.7) thirstFx.push('Physical strength −15%', 'Wounds heal 60% slower');
  if (n.thirst > 0.8) thirstFx.push('Lost blood no longer comes back');
  if (n.thirst >= 0.95) thirstFx.push('Losing 3.5 health per game hour (dehydrated)');
  if (!thirstFx.length) thirstFx.push('No penalties yet. At "Parched" stamina and healing suffer');
  add('thirst', ['Thirsty', 'Thirsty', 'Parched', 'Dehydrated'], lv(n.thirst, [0.2, 0.4, 0.6, 0.85]), 'Drink clean water. Untreated water can make you sick.', thirstFx);

  const fat = n.fatigue;
  const fatFx: string[] = [];
  if (fat > 0.6) fatFx.push(`Maximum stamina capped at ${pc(Math.max(0.25, 1 - (fat - 0.6) * 1.1))}`);
  if (fat > 0.7) fatFx.push(`Physical strength −${pc((fat - 0.7) * 0.8)}`);
  if (fat > 0.75) fatFx.push('Stamina recovers 40% slower');
  if (fat > 0.8) fatFx.push('Swings 15% slower; +8% chance for zombies to hit you', 'Aim spread +30%; +8% chance to fall climbing fences');
  if (fat > 0.85) fatFx.push('Sight range −15%', 'You may nod off at the wheel');
  if (fat >= 0.93) fatFx.push('Push on much longer and you\'ll collapse asleep wherever you are');
  if (!fatFx.length) fatFx.push('No penalties yet. Sleep before it starts to bite');
  add('fatigue', ['Drowsy', 'Tired', 'Very tired', 'Exhausted'], lv(fat, [0.5, 0.65, 0.8, 0.93]), 'You need sleep. Somewhere safe.', fatFx);

  const e = n.endurance;
  const endFx: string[] = [];
  if (e < 0.5) endFx.push(`Swings ${pc((0.5 - e) * 1.4)} slower`, `Physical strength −${pc(1 - (0.55 + e * 0.9))}`);
  endFx.push(`+${pc((1 - e) * 0.28)} chance for zombies to hit you${e < 0.75 ? ', and they grab you more' : ''}`);
  if (e < 0.3) endFx.push('+12% chance to fall climbing fences');
  if (e < 0.2) endFx.push('−20% chance to land your own hits');
  add('endurance', ['Winded', 'Out of breath', 'Gasping', 'Spent'], lv(1 - e, [0.3, 0.55, 0.75, 0.9]), 'Stop running. Walk or stand still to get your breath back.', endFx);

  const pn = n.calm > 0 ? n.panic * 0.4 : n.panic;
  const panicFx: string[] = [
    `Field of view narrowed by ${Math.round(pn * 57)}°`,
    `−${pc(pn * 0.25)} chance to land melee hits`,
    `Aim spread +${pc(pn * 1.6)}`,
    `+${pc(n.panic * 0.1)} chance for zombies to hit you`,
  ];
  if (n.panic > 0.4) panicFx.push(`Bandaging, crafting and other hand work takes ${pc(n.panic * 0.6)} longer`);
  if (n.panic > 0.45) panicFx.push('Too wired to sleep');
  if (n.panic > 0.5) panicFx.push('Reloading 30% slower');
  if (n.panic > 0.6) panicFx.push('Stamina recovers 30% slower');
  if (n.calm > 0) panicFx.push('Beta blockers are dulling these effects by 60%');
  add('panic', ['Nervous', 'Scared', 'Panicked', 'Terrified'], lv(pn, [0.2, 0.4, 0.6, 0.85]), 'Get distance and break line of sight. It fades once nothing is close.', panicFx);

  const stressFx = [`Sleep quality −${pc(Math.min(0.6, n.stress * 0.3))}`];
  if (n.stress > 0.7) stressFx.push('Panic never fully fades (it stays at 10% or more)');
  add('stress', ['Stressed', 'Anxious', 'Breaking down'], lv(n.stress, [0.45, 0.65, 0.85]), 'Rest, eat well (hot food and chocolate help), read, sleep somewhere safe.', stressFx);

  const pa = pain(p);
  add('pain', ['Aching', 'In pain', 'Severe pain', 'Agony'], lv(pa, [0.1, 0.3, 0.55, 0.8]), 'Painkillers help (pain drops by 65% for a few hours).', [
    `Physical strength −${pc(pa * 0.35)}`,
    n.painkiller > 0 ? `Painkillers active for another ${f1(n.painkiller)} h` : 'No painkillers in your system',
  ]);

  const tmp = n.temp;
  const coldFx: string[] = [`Body temperature ${tmp.toFixed(1)}°C (normal is 37)`];
  if (tmp < 35.5) coldFx.push('Physical strength −20%');
  if (tmp < 35) coldFx.push(`Losing ${f1((35 - tmp) * 9)} health per game hour (hypothermia)`);
  else coldFx.push('Below 35°C you start losing health');
  if (tmp < 36 && n.wet > 0.3) coldFx.push('Cold and wet: you\'re catching a cold');
  add('cold', ['Chilly', 'Cold', 'Freezing', 'Hypothermic'], lv(37 - tmp, [0.5, 1, 1.5, 2]), 'Get dry, get warm: clothes, shelter, fire — or a car with the engine running.', coldFx);

  const hotFx: string[] = [`Body temperature ${tmp.toFixed(1)}°C (normal is 37)`];
  if (tmp > 39) hotFx.push('Physical strength −20%');
  if (tmp > 39.5) hotFx.push(`Losing ${f1((tmp - 39.5) * 9)} health per game hour`);
  add('hot', ['Warm', 'Overheating', 'Heatstroke'], lv(tmp - 37, [1, 1.7, 2.3]), 'Shed layers, drink water, get out of the sun.', hotFx);

  add('wet', ['Damp', 'Wet', 'Soaked'], lv(n.wet, [0.15, 0.4, 0.7]), 'Get indoors and let your clothes dry, or sit by a fire.', [
    `Your body feels ${Math.round(n.wet * 10)}°C colder`,
    'Chilled and wet for long enough, you catch a cold (coughing gives you away)',
  ]);

  const sickFx: string[] = [];
  if (n.sick > 0.3) sickFx.push('Thirst builds 30% faster');
  if (n.sick > 0.4) sickFx.push(`Physical strength −${pc((n.sick - 0.4) * 0.6)}`);
  if (n.sick > 0.5) sickFx.push('You cough now and then — heard about 7 tiles away');
  if (n.sick > 0.7) sickFx.push(`Losing ${f1((n.sick - 0.6) * 18)} health per game hour`);
  if (!sickFx.length) sickFx.push('Mild for now. It fades with rest and clean water');
  add('sick', ['Queasy', 'Nauseous', 'Very sick', 'Deathly ill'], lv(n.sick, [0.15, 0.4, 0.65, 0.85]), n.sickCause ? `From ${n.sickCause}. Rest and drink clean water.` : 'Rest and drink clean water.', sickFx);

  const coldIllFx: string[] = [];
  if (n.cold > 0.3) coldIllFx.push('You cough now and then — heard about 7 tiles away, even by the dead');
  if (n.cold > 0.6) coldIllFx.push('Losing 1 health per game hour');
  if (!coldIllFx.length) coldIllFx.push('Just sniffles. Stay warm and dry and it clears up');
  add('coldIll', ['Sniffles', 'Head cold', 'Flu'], lv(n.cold, [0.2, 0.45, 0.7]), 'Stay warm and dry.', coldIllFx);

  add('co', ['Headache', 'Dizzy', 'Suffocating'], lv(n.co, [0.15, 0.35, 0.6]), 'Carbon monoxide! Get out into fresh air — and move that generator outside.', [
    n.co > 0.4 ? `Losing ${f1((n.co - 0.3) * 60)} health per game hour` : 'Above "Dizzy" it starts costing health fast',
    'It clears quickly once you breathe fresh air',
  ], 'bad');

  const enc = encumbranceLevel(p);
  if (enc) {
    out.push({
      id: 'enc', label: ENC_NAMES[enc], level: enc, tone: enc >= 2 ? 'bad' : 'warn', tip: 'Drop or stash something, or find a bigger bag.', effects: [
        `Move speed −${[0, 14, 30, 52][enc]}%`,
        `Running burns stamina ${enc * 40}% faster; stamina recovers ${[0, 25, 50, 70][enc]}% slower`,
        'Walking while loaded wears you down',
        `Footsteps louder; +${enc * 7}% chance to fall vaulting a low fence, +${enc * 11}% over a tall one`,
        ...(enc >= 2 ? ['Risk of a fall climbing through windows'] : []),
      ],
    });
  }

  const drunkFx: string[] = [];
  if (n.drunk > 0.3) drunkFx.push('−10% chance to land melee hits; aim spread +50%', 'Hand work 30% slower; physical strength −10%', '+15% chance to fall climbing fences');
  if (n.drunk > 0.4) drunkFx.push('Sight range −20%');
  if (!drunkFx.length) drunkFx.push('A pleasant buzz. More and your aim and balance go');
  add('drunk', ['Tipsy', 'Drunk', 'Wasted'], lv(n.drunk, [0.2, 0.45, 0.7]), 'Wait it off somewhere safe.', drunkFx);

  const bored = n.boredom ?? 0;
  const sad = n.unhappy ?? 0;
  const boredFx: string[] = [];
  if (bored > 0.5) boredFx.push(`You learn skills ${pc(Math.max(0, bored - 0.5) * 0.8)} slower`);
  if (bored > 0.4) boredFx.push('Staying this bored is making you unhappy');
  if (bored >= 0.75) boredFx.push('Restless: you pace, mutter and kick things when idle indoors — the dead can hear it');
  if (!boredFx.length) boredFx.push('No effect yet. Much more and it starts to wear on your mood');
  boredFx.push('Fighting and health are not affected');
  add('bored', ['Bored', 'Very bored', 'Extremely bored', 'Mind-numbingly bored'], lv(bored, BORED_CUTS), 'Get outside, keep busy, read a comic, play cards, do a crossword, watch TV or listen to the radio. Treats help; the same thing over and over doesn\'t.', boredFx);
  const sadFx: string[] = [`Chores (crafting, building, searching, barricading) take ${Math.round((workMult(p) - 1) * 100)}% longer`];
  sadFx.push(`You learn skills ${pc(sad * 0.7)} slower`);
  if (sad >= 0.75) sadFx.push('You break down crying at times — quietly, but not silently');
  sadFx.push('Fighting and health are not affected');
  add('unhappy', ['Sad', 'Unhappy', 'Depressed', 'Severely depressed'], lv(sad, UNHAPPY_CUTS), 'Fix the boredom first. Good food, a drink, a smoke, comics, TV and a good night\'s sleep help. Bland rations, dog food and stale food make it worse.', sadFx);

  if (n.craving > 0.5) add('craving', ['Craving a smoke'], 1, 'A cigarette would take the edge off.', ['Stress keeps rising until you smoke']);

  if (b.injuries.length) {
    const leg = legFactor(p);
    const hand = handFactor(p);
    const injFx: string[] = [];
    if (leg < 0.99) injFx.push(`Legs and feet: movement −${pc(0.5 * (1 - leg))}, more falls climbing fences`);
    if (hand < 0.99) injFx.push(`Hands and arms: swings ${pc(1 / (0.6 + 0.4 * hand) - 1)} slower, hits weaker, hand work ${pc(1 / (0.45 + 0.55 * hand) - 1)} slower`);
    injFx.push('Open the Health panel (H) to see and treat each wound');
    out.push({ id: 'injured', label: `Injured (${b.injuries.length})`, level: 1, tone: 'info', tip: 'Clean, bandage and rest.', effects: injFx });
  }

  const spotted = s.zombies.some((z) => z.state === 'chase' && z.sinceSeen < 1.5 && Math.hypot(z.x - p.x, z.y - p.y) < 25);
  if (spotted) out.push({ id: 'spotted', label: 'Spotted', level: 2, tone: 'warn', tip: 'Something has seen you. Break line of sight.', effects: ['A zombie has eyes on you and is coming', 'Out of sight, it walks to where it last saw you and searches'] });

  if (p.stance === 'crouch' && p.inVehicle < 0) {
    out.push({
      id: 'sneak', label: 'Sneaking', level: 1, tone: 'good', tip: 'C to stand up.', effects: [
        'Move about 40% slower',
        'Footsteps much quieter (heard ~1.4 tiles away instead of ~3)',
        'Zombies spot you from 45% closer; in bushes or tall grass, much closer still',
      ],
    });
  }
  if (n.painkiller > 0) out.push({ id: 'pk', label: 'Painkillers', level: 1, tone: 'good', tip: 'Pain dulled for a few hours.', effects: ['Pain reduced by 65%', `Wears off in ${f1(n.painkiller)} h`] });
  if (n.calm > 0) out.push({ id: 'calm', label: 'Steady', level: 1, tone: 'good', tip: 'Beta blockers are keeping panic down.', effects: ['Panic builds 65% slower', 'Panic\'s effects are 60% weaker', `Wears off in ${f1(n.calm)} h`] });

  const L = tileLight(s, rt, Math.floor(p.x), Math.floor(p.y), ambient(s));
  if (L < 0.12 && !p.flashlight && p.inVehicle < 0) {
    out.push({ id: 'dark', label: 'Dark', level: 1, tone: 'info', tip: 'A light would help — and give you away.', effects: ['You can only see a short way', 'Zombies can\'t see you well either', 'A flashlight (F) lets you see — and lets them spot you from much farther'] });
  }
  return out;
}
