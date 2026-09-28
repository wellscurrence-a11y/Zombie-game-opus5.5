// Injuries, bleeding, infection, the fever, needs and overall health.
import { clamp } from '../core/math';
import { hourOfDay } from '../core/time';
import type { BodyPart, Item } from './items';
import { chronicle, log, note } from './log';
import type { Runtime } from './runtime';
import { hasTrait } from './traits';
import type { GameState, Injury, InjuryType, Player } from './types';
import { buildingPowered } from './lighting';
import { emitNoise } from './noise';
import { def } from './items';

export const PART_NAMES: Record<BodyPart, string> = {
  head: 'head', neck: 'neck', torso: 'torso', lArm: 'left arm', rArm: 'right arm', lHand: 'left hand', rHand: 'right hand',
  lLeg: 'left leg', rLeg: 'right leg', lFoot: 'left foot', rFoot: 'right foot',
};

export const INJURY_NAMES: Record<InjuryType, string> = {
  scratch: 'Scratch', cut: 'Laceration', deep: 'Deep wound', burn: 'Burn', sprain: 'Sprain', fracture: 'Fracture', bite: 'Bite', bruise: 'Bruise',
};

/** Blood loss per game hour at severity 1. */
const BLEED: Record<InjuryType, number> = { scratch: 0.03, cut: 0.09, deep: 0.26, burn: 0, sprain: 0, fracture: 0.02, bite: 0.15, bruise: 0 };
/** Immediate health damage. */
const HIT: Record<InjuryType, number> = { scratch: 2, cut: 5, deep: 12, burn: 7, sprain: 3, fracture: 14, bite: 10, bruise: 2 };
/** Days to heal (treated). */
const HEAL_DAYS: Record<InjuryType, number> = { scratch: 1, cut: 3, deep: 6, burn: 6, sprain: 4, fracture: 21, bite: 7, bruise: 2 };

export const OPEN_WOUNDS: InjuryType[] = ['scratch', 'cut', 'deep', 'bite', 'burn'];

export function addInjury(s: GameState, rt: Runtime | null, part: BodyPart, type: InjuryType, severity: number, cause: string): Injury {
  const p = s.player;
  const b = p.body;
  const inj: Injury = {
    id: b.nextInjuryId++, part, type, severity: clamp(severity, 0.05, 1),
    bleed: BLEED[type] * clamp(severity, 0.05, 1), bandaged: false, dirtyBandage: false, bandageAge: 0, disinfected: false, infection: 0,
    glass: false, stitched: false, splinted: false, heal: 0, t: s.time, cause,
  };
  b.injuries.push(inj);
  b.health -= HIT[type] * (0.5 + inj.severity);
  s.stats.hitsTaken++;
  p.lastHitT = s.time;
  const n = p.needs;
  n.panic = clamp(n.panic + (type === 'bite' ? 0.5 : 0.2) * (hasTrait(p.traits, 'brave') ? 0.5 : 1), 0, 1);
  n.stress = clamp(n.stress + 0.05, 0, 1);
  if (rt) {
    rt.hurtFlash = 1;
    rt.shake = Math.max(rt.shake, 0.6);
    if (inj.bleed > 0) {
      rt.effects.push({ kind: 'blood', x: p.x, y: p.y, t: rt.realTime, dur: 0.6 });
      const i = Math.floor(p.y) * s.world.w + Math.floor(p.x);
      s.world.decal[i] |= 1;
      s.world.rev.ground++;
    }
  }
  if (hasTrait(p.traits, 'hemophobic') && inj.bleed > 0) n.panic = clamp(n.panic + 0.25, 0, 1);
  if (inj.bleed > 0.05) note(s, 'bleeding');
  chronicle(s, `${INJURY_NAMES[type]} to the ${PART_NAMES[part]} (${cause}).`, type === 'bite' ? 5 : type === 'fracture' || type === 'deep' ? 3 : 2);
  return inj;
}

export function isBleeding(inj: Injury): boolean {
  return effectiveBleed(inj) > 0.004;
}

export function effectiveBleed(inj: Injury): number {
  if (inj.bleed <= 0) return 0;
  let b = inj.bleed * (1 - inj.heal);
  if (inj.stitched) b *= 0.05;
  if (inj.bandaged) b *= inj.type === 'deep' && !inj.stitched ? 0.25 : 0.06;
  if (inj.glass) b = Math.max(b, 0.02);
  return b;
}

/**
 * Need change per game hour at rest. Roughly: hungry ~13 h after a full meal, starving after a day and a
 * half, dead of starvation after ~4 days; thirsty ~7 h after a drink, deadly dehydration after ~2 days;
 * tired after ~16 h awake, exhausted after ~20 h. Running and heat speed these up.
 */
const HUNGER_RATE = 0.026;
const THIRST_RATE = 0.04;
const FATIGUE_RATE = 0.036;

export function outsideTemp(s: GameState): number {
  return s.weather.temp;
}

function clothingInsulation(p: Player): { ins: number; water: number } {
  let ins = 0;
  let water = 0;
  for (const it of Object.values(p.worn)) {
    if (!it) continue;
    const c = def(it.id).clothing;
    if (!c) continue;
    ins += c.ins * (0.5 + 0.5 * it.cond);
    water = Math.max(water, c.water);
  }
  return { ins, water };
}

/** Is the player standing somewhere warm (near a fire / heated room)? */
function nearHeat(s: GameState): number {
  const p = s.player;
  const w = s.world;
  let heat = 0;
  const px = Math.floor(p.x);
  const py = Math.floor(p.y);
  for (let y = py - 4; y <= py + 4; y++) {
    for (let x = px - 4; x <= px + 4; x++) {
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const i = y * w.w + x;
      const fi = w.furn[i];
      if (fi >= 0) {
        const f = w.furniture[fi];
        if (f.on && (f.kind === 'campfire' || f.kind === 'bbq' || (f.kind === 'stove' && buildingPowered(s, f.bld)))) {
          const d = Math.hypot(f.x + 0.5 - p.x, f.y + 0.5 - p.y);
          if (d < 4) heat = Math.max(heat, (4 - d) * 3);
        }
      }
      if (s.fires[i]) {
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d < 5) heat = Math.max(heat, (5 - d) * 5);
      }
    }
  }
  return heat;
}

/**
 * Advance needs and body by `hours` of game time. `realDt` is the real-seconds slice, used for panic.
 */
export function updateBody(s: GameState, rt: Runtime, hours: number, realDt: number): void {
  const p = s.player;
  if (p.dead) return;
  const n = p.needs;
  const b = p.body;
  const t = p.traits;
  const sleeping = p.sleeping;
  const activity = p.running ? 1.5 : Math.hypot(p.vx, p.vy) > 0.1 ? 1.1 : 1;

  // ---- core needs
  n.hunger += HUNGER_RATE * hours * (sleeping ? 0.6 : activity);
  n.thirst += THIRST_RATE * hours * (sleeping ? 0.6 : activity) * (s.weather.temp > 26 ? 1.4 : 1) * (n.sick > 0.3 ? 1.3 : 1);
  if (sleeping) {
    n.fatigue -= hours * 0.14 * p.sleepQuality;
  } else {
    n.fatigue += FATIGUE_RATE * hours * (hasTrait(t, 'nightOwl') ? 0.8 : 1) * (n.endurance < 0.3 ? 1.3 : 1);
  }
  n.hunger = clamp(n.hunger, 0, 1);
  n.thirst = clamp(n.thirst, 0, 1);
  n.fatigue = clamp(n.fatigue, 0, 1);

  // ---- temperature and wetness
  const w = s.world;
  const ti = Math.floor(p.y) * w.w + Math.floor(p.x);
  // a car keeps the rain off while the glass holds, but it's a tin box: little warmth unless the heater runs
  const car = p.inVehicle >= 0 ? s.vehicles[p.inVehicle] : null;
  const brokenGlass = car ? car.windows.filter((g) => g >= 2).length : 0;
  const indoors = w.room[ti] >= 0 || (car !== null && brokenGlass === 0);
  const exposure = car ? Math.min(1, brokenGlass * 0.3) : indoors ? 0 : 1;
  const { ins, water } = clothingInsulation(p);
  if (exposure > 0 && s.weather.rain > 0.05) n.wet += s.weather.rain * 0.7 * hours * (1 - water) * exposure;
  const heat = nearHeat(s);
  n.wet -= hours * (indoors || car ? 0.3 : 0.12) * (1 + heat * 0.3) * (s.weather.rain > 0.05 && exposure >= 1 ? 0 : 1);
  n.wet = clamp(n.wet, 0, 1);
  const shelter = car ? (brokenGlass ? 1 : 3) + (car.engineOn ? 8 : 0) : indoors ? 6 : 0;
  let eff = outsideTemp(s) + shelter + ins * 2 - n.wet * 10 + heat + (sleeping && p.sleepQuality > 0.6 ? 4 : 0) + (p.running ? 4 : 0);
  eff -= s.weather.wind * 4 * exposure;
  const target = 37 + clamp((eff - 25) * 0.08, -4.5, 2.8);
  n.temp += (target - n.temp) * Math.min(1, hours * 0.6);
  if (n.temp < 36 && n.wet > 0.3) {
    n.cold = clamp(n.cold + hours * 0.02, 0, 1);
    note(s, 'cold');
  } else n.cold = clamp(n.cold - hours * 0.012, 0, 1);

  // ---- mood
  if (rt.threat > 0) n.stress += hours * 0.25 * Math.min(3, rt.threat);
  else n.stress -= hours * 0.035 * (sleeping ? 2 : 1);
  if (n.hunger > 0.6) n.stress += hours * 0.02;
  if (hasTrait(t, 'smoker')) {
    n.craving = clamp(n.craving + hours * 0.035, 0, 1);
    if (n.craving > 0.5) n.stress += hours * 0.03;
  }
  n.stress = clamp(n.stress, 0, 1);

  // panic works in real seconds: it spikes fast and fades once you're clear
  const panicMult = (hasTrait(t, 'brave') ? 0.45 : hasTrait(t, 'cowardly') ? 1.6 : 1) * (n.calm > 0 ? 0.35 : 1);
  if (rt.threat > 0) n.panic += realDt * 0.045 * rt.threat * panicMult;
  if (p.grabbedBy.length) n.panic += realDt * 0.25 * panicMult;
  if (rt.threat === 0 && !p.grabbedBy.length) n.panic -= realDt * (0.05 + (1 - n.stress) * 0.04);
  n.panic = clamp(n.panic, n.stress > 0.7 ? 0.1 : 0, 1);
  if (n.panic > 0.6) note(s, 'panic');

  // ---- timers
  n.drunk = clamp(n.drunk - hours * 0.12, 0, 1);
  n.painkiller = Math.max(0, n.painkiller - hours);
  n.calm = Math.max(0, n.calm - hours);
  n.antibiotic = Math.max(0, n.antibiotic - hours);
  n.sick = clamp(n.sick - hours * (n.sick > 0.75 ? 0.01 : 0.025), 0, 1);

  // ---- injuries
  const healMult = (hasTrait(t, 'fastHealer') ? 1.45 : hasTrait(t, 'slowHealer') ? 0.65 : 1) * (sleeping ? 1.6 : 1) * (n.hunger > 0.7 || n.thirst > 0.7 ? 0.4 : 1);
  let bleedTotal = 0;
  for (const inj of b.injuries) {
    const bl = effectiveBleed(inj);
    bleedTotal += bl;
    // scratches clot by themselves
    if (inj.type === 'scratch' && s.time - inj.t > 0.6) inj.bleed *= Math.max(0, 1 - hours * 3);
    if (inj.bandaged) {
      inj.bandageAge += hours;
      if (bl > 0.001 && inj.bandageAge > 10 / (1 + inj.bleed * 25)) {
        if (!inj.dirtyBandage) log(s, `The bandage on your ${PART_NAMES[inj.part]} is soaked through. Change it.`, 'warn');
        inj.dirtyBandage = true;
      }
    }
    // infection risk for open wounds
    if (OPEN_WOUNDS.includes(inj.type) && inj.heal < 0.8) {
      const age = s.time - inj.t;
      let risk = 0;
      if (!inj.disinfected && age > 2) risk = inj.bandaged ? (inj.dirtyBandage ? 0.016 : 0.004) : 0.012;
      if (inj.glass) risk += 0.01;
      if (inj.type === 'bite') risk += 0.005;
      if (inj.disinfected && inj.dirtyBandage) risk = 0.006;
      if (risk > 0) inj.infection += risk * hours * (0.5 + inj.severity);
    }
    if (n.antibiotic > 0) inj.infection -= hours * 0.07;
    if (inj.disinfected && inj.infection < 0.3) inj.infection -= hours * 0.01;
    inj.infection = clamp(inj.infection, 0, 1);
    if (inj.infection > 0.35) note(s, 'infection');
    // healing
    let rate = 1 / (HEAL_DAYS[inj.type] * 24);
    if (OPEN_WOUNDS.includes(inj.type) && !inj.bandaged && inj.type !== 'scratch') rate *= 0.5;
    if (inj.type === 'deep' && !inj.stitched) rate *= 0.5;
    if (inj.type === 'fracture' && !inj.splinted) rate *= 0.35;
    if (inj.glass) rate = 0;
    if (inj.infection > 0.3) rate *= 0.2;
    inj.heal += rate * hours * healMult;
  }
  const healed = b.injuries.filter((i) => i.heal >= 1);
  for (const h of healed) log(s, `Your ${INJURY_NAMES[h.type].toLowerCase()} (${PART_NAMES[h.part]}) has healed.`, 'good');
  b.injuries = b.injuries.filter((i) => i.heal < 1);

  b.blood -= bleedTotal * hours;
  if (bleedTotal < 0.005 && n.hunger < 0.8 && n.thirst < 0.8) b.blood += hours * 0.02;
  b.blood = clamp(b.blood, 0, 1);

  // ---- the fever (from bites)
  if (b.fever) {
    const since = s.time - b.feverT;
    if (since > 14) {
      const before = b.feverLevel;
      b.feverLevel = clamp(b.feverLevel + hours / 40, 0, 1);
      if (before === 0) {
        log(s, 'You feel feverish. Your skin is clammy and grey around the bite.', 'danger');
        chronicle(s, 'Fever symptoms began.', 5);
        note(s, 'fever');
      }
      if (rt.rng.chance(hours * 0.5 * b.feverLevel)) {
        n.sick = clamp(n.sick + 0.12, 0, 0.65);
        n.thirst = clamp(n.thirst + 0.08, 0, 1);
        log(s, 'You retch violently.', 'danger');
        emitNoise(s, rt, { x: p.x, y: p.y, radius: 6, kind: 'vomit', src: 'player' });
      }
    }
  }

  // ---- carbon monoxide
  if (n.co > 0) n.co = clamp(n.co - hours * 0.5, 0, 1);

  // ---- health drains and regeneration
  let drain = 0;
  if (b.blood < 0.72) drain += (0.72 - b.blood) * 90;
  let maxInf = 0;
  for (const inj of b.injuries) maxInf = Math.max(maxInf, inj.infection);
  if (maxInf > 0.45) drain += (maxInf - 0.45) * 22 + (maxInf >= 1 ? 25 : 0);
  if (b.feverLevel > 0) drain += b.feverLevel * b.feverLevel * 20;
  if (n.hunger >= 0.95) drain += 1.5;
  if (n.thirst >= 0.95) drain += 3.5;
  if (n.temp < 35) drain += (35 - n.temp) * 9;
  if (n.temp > 39.5) drain += (n.temp - 39.5) * 9;
  if (n.sick > 0.7) drain += (n.sick - 0.6) * 18;
  if (n.co > 0.4) drain += (n.co - 0.3) * 60;
  if (n.cold > 0.6) drain += 1;
  if (drain > 0) b.health -= drain * hours;
  else if (n.hunger < 0.7 && n.thirst < 0.7) b.health += hours * (sleeping ? 3 : 1.2);
  const cap = 100 - b.injuries.reduce((a, i) => a + (i.type === 'fracture' ? 12 : i.type === 'deep' || i.type === 'bite' ? 6 : 1) * (1 - i.heal), 0);
  b.health = Math.min(b.health, Math.max(10, cap));

  // ---- messages at thresholds
  thresholdMessage(s, 'hunger', n.hunger, [[0.35, 'You\'re getting hungry.'], [0.6, 'You\'re very hungry.'], [0.85, 'You\'re starving.']]);
  thresholdMessage(s, 'thirst', n.thirst, [[0.3, 'You\'re thirsty.'], [0.6, 'You\'re very thirsty.'], [0.85, 'You\'re severely dehydrated.']]);
  thresholdMessage(s, 'fatigue', n.fatigue, [[0.6, 'You\'re tired.'], [0.8, 'You\'re exhausted. Your reactions are slowing.'], [0.95, 'You can barely keep your eyes open.']]);
  thresholdMessage(s, 'temp', 37 - n.temp, [[0.8, 'You\'re cold.'], [1.6, 'You\'re shivering badly.'], [2.2, 'Hypothermia is setting in.']]);
  thresholdMessage(s, 'blood', 1 - b.blood, [[0.2, 'You feel lightheaded from blood loss.'], [0.35, 'You\'re losing too much blood.']]);

  if (b.health <= 0 || b.blood <= 0.22) {
    const cause = b.blood <= 0.22 ? 'Bled out' : b.feverLevel > 0.8 ? 'Succumbed to the fever' : maxInf > 0.9 ? 'Died of an infected wound' : n.thirst >= 0.95 ? 'Died of dehydration' : n.hunger >= 0.95 ? 'Starved to death' : n.temp < 35 ? 'Died of hypothermia' : n.co > 0.4 ? 'Carbon monoxide poisoning' : n.sick > 0.7 ? 'Died of food poisoning' : 'Succumbed to injuries';
    killPlayer(s, rt, cause);
  }
  void hourOfDay;
}

let thresholdState: Record<string, number> = {};
export function resetThresholds(): void {
  thresholdState = {};
}
function thresholdMessage(s: GameState, key: string, v: number, levels: [number, string][]): void {
  let lvl = 0;
  for (let i = 0; i < levels.length; i++) if (v >= levels[i][0]) lvl = i + 1;
  const prev = thresholdState[key] ?? 0;
  if (lvl > prev) log(s, levels[lvl - 1][1], lvl >= 2 ? 'danger' : 'warn');
  thresholdState[key] = lvl;
}

export function killPlayer(s: GameState, rt: Runtime, cause: string): void {
  const p = s.player;
  if (p.dead) return;
  p.dead = true;
  p.deathCause = cause;
  p.sleeping = false;
  p.grabbedBy = [];
  rt.action = null;
  chronicle(s, `Died: ${cause}.`, 10);
  log(s, `You died. ${cause}.`, 'danger');
}

export function hasBandageItem(items: Item[]): Item | null {
  return items.find((i) => def(i.id).medical === 'bandage') ?? items.find((i) => def(i.id).medical === 'rag') ?? null;
}
