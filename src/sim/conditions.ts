// Status conditions shown on the HUD. They tell the player what's wrong — and hint at why.
import { effectiveBleed } from './body';
import { ambient, tileLight } from './lighting';
import type { Runtime } from './runtime';
import { ENC_NAMES, encumbranceLevel, pain } from './stats';
import type { GameState } from './types';

export interface Condition {
  id: string;
  label: string;
  level: number;
  tone: 'bad' | 'warn' | 'info' | 'good';
  tip: string;
}

function lv(v: number, cuts: number[]): number {
  let l = 0;
  for (let i = 0; i < cuts.length; i++) if (v >= cuts[i]) l = i + 1;
  return l;
}

export function conditions(s: GameState, rt: Runtime): Condition[] {
  const p = s.player;
  const n = p.needs;
  const b = p.body;
  const out: Condition[] = [];
  const add = (id: string, labels: string[], level: number, tip: string, tone?: Condition['tone']): void => {
    if (level <= 0) return;
    out.push({ id, label: labels[Math.min(labels.length, level) - 1], level, tone: tone ?? (level >= 3 ? 'bad' : level === 2 ? 'warn' : 'info'), tip });
  };
  if (p.grabbedBy.length) add('grabbed', ['Grabbed!'], 4, 'Press Space to shove free. Every second you\'re held, others can bite.', 'bad');
  let bleed = 0;
  for (const i of b.injuries) bleed += effectiveBleed(i);
  add('bleed', ['Bleeding', 'Bleeding', 'Bleeding badly', 'Hemorrhaging'], bleed > 0.004 ? lv(bleed, [0, 0.03, 0.08, 0.15]) : 0, 'Open the Health panel (H) and bandage it now.');
  add('blood', ['Pale', 'Lightheaded', 'Blood loss', 'Critical blood loss'], lv(1 - b.blood, [0.12, 0.28, 0.45, 0.6]), 'You\'ve lost blood. Stop the bleeding, rest, eat and drink.');
  if (b.feverLevel > 0) add('fever', ['Feverish', 'Fever', 'High fever', 'Burning up'], lv(b.feverLevel, [0.01, 0.3, 0.6, 0.85]), 'The bite is taking hold. There is no cure.', 'bad');
  let inf = 0;
  for (const i of b.injuries) inf = Math.max(inf, i.infection);
  add('infect', ['Wound swelling', 'Infected wound', 'Badly infected', 'Sepsis'], lv(inf, [0.15, 0.35, 0.6, 0.85]), 'Disinfect it, keep it clean, take antibiotics.');
  add('hunger', ['Peckish', 'Hungry', 'Very hungry', 'Starving'], lv(n.hunger, [0.25, 0.45, 0.65, 0.85]), 'Eat something.');
  add('thirst', ['Thirsty', 'Thirsty', 'Parched', 'Dehydrated'], lv(n.thirst, [0.2, 0.4, 0.6, 0.85]), 'Drink clean water. Untreated water can make you sick.');
  add('fatigue', ['Drowsy', 'Tired', 'Very tired', 'Exhausted'], lv(n.fatigue, [0.5, 0.65, 0.8, 0.93]), 'You need sleep. Tired survivors see less, react slower and fall more.');
  add('endurance', ['Winded', 'Out of breath', 'Gasping', 'Spent'], lv(1 - n.endurance, [0.3, 0.55, 0.75, 0.9]), 'Stop running. Fighting like this is how people die.');
  const pn = n.calm > 0 ? n.panic * 0.4 : n.panic;
  add('panic', ['Nervous', 'Scared', 'Panicked', 'Terrified'], lv(pn, [0.2, 0.4, 0.6, 0.85]), 'Panic narrows your vision and ruins your aim. Get distance.');
  add('stress', ['Stressed', 'Anxious', 'Breaking down'], lv(n.stress, [0.45, 0.65, 0.85]), 'Rest, eat well, read, sleep somewhere safe.');
  add('pain', ['Aching', 'In pain', 'Severe pain', 'Agony'], lv(pain(p), [0.1, 0.3, 0.55, 0.8]), 'Painkillers help. Pain slows everything and ruins sleep.');
  add('cold', ['Chilly', 'Cold', 'Freezing', 'Hypothermic'], lv(37 - n.temp, [0.5, 1, 1.5, 2]), 'Get dry, get warm: clothes, shelter, fire.');
  add('hot', ['Warm', 'Overheating', 'Heatstroke'], lv(n.temp - 37, [0.8, 1.5, 2.2]), 'Shed layers, drink water, get out of the sun.');
  add('wet', ['Damp', 'Wet', 'Soaked'], lv(n.wet, [0.15, 0.4, 0.7]), 'Wet clothes steal your body heat.');
  add('sick', ['Queasy', 'Nauseous', 'Very sick', 'Deathly ill'], lv(n.sick, [0.15, 0.4, 0.65, 0.85]), n.sickCause ? `From ${n.sickCause}. Rest and drink clean water.` : 'Rest and drink clean water.');
  add('coldIll', ['Sniffles', 'Head cold', 'Flu'], lv(n.cold, [0.2, 0.45, 0.7]), 'Coughing and sneezing make noise. Stay warm and dry.');
  add('co', ['Headache', 'Dizzy', 'Suffocating'], lv(n.co, [0.15, 0.35, 0.6]), 'Carbon monoxide! Get out into fresh air — and move that generator outside.', 'bad');
  const enc = encumbranceLevel(p);
  if (enc) out.push({ id: 'enc', label: ENC_NAMES[enc], level: enc, tone: enc >= 2 ? 'bad' : 'warn', tip: 'Heavy loads slow you, tire you and make climbing dangerous.' });
  add('drunk', ['Tipsy', 'Drunk', 'Wasted'], lv(n.drunk, [0.2, 0.45, 0.7]), 'Your aim and balance are off.');
  if (n.craving > 0.5) add('craving', ['Craving a smoke'], 1, 'A cigarette would take the edge off.');
  if (b.injuries.length) out.push({ id: 'injured', label: `Injured (${b.injuries.length})`, level: 1, tone: 'info', tip: 'Open the Health panel (H).' });
  const spotted = s.zombies.some((z) => z.state === 'chase' && z.sinceSeen < 1.5 && Math.hypot(z.x - p.x, z.y - p.y) < 25);
  if (spotted) out.push({ id: 'spotted', label: 'Spotted', level: 2, tone: 'warn', tip: 'Something has seen you. Break line of sight.' });
  if (p.stance === 'crouch' && p.inVehicle < 0) out.push({ id: 'sneak', label: 'Sneaking', level: 1, tone: 'good', tip: 'Crouched: quieter and harder to see, but slow.' });
  if (n.painkiller > 0) out.push({ id: 'pk', label: 'Painkillers', level: 1, tone: 'good', tip: 'Pain dulled for a few hours.' });
  if (n.calm > 0) out.push({ id: 'calm', label: 'Steady', level: 1, tone: 'good', tip: 'Beta blockers are keeping panic down.' });
  const L = tileLight(s, rt, Math.floor(p.x), Math.floor(p.y), ambient(s));
  if (L < 0.12 && !p.flashlight && p.inVehicle < 0) out.push({ id: 'dark', label: 'Dark', level: 1, tone: 'info', tip: 'You can barely see. A light would help — and give you away.' });
  return out;
}
