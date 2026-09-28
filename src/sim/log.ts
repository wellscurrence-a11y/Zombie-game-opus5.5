import type { GameState, LogEntry } from './types';

export function log(s: GameState, text: string, kind: LogEntry['kind'] = 'info', dir?: number): void {
  s.log.push({ t: s.time, text, kind, dir });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

/** Record a significant moment for the death report. */
export function chronicle(s: GameState, text: string, severity = 1): void {
  const last = s.chronicle[s.chronicle.length - 1];
  if (last && last.text === text && s.time - last.t < 0.05) return;
  s.chronicle.push({ t: s.time, text, severity });
  if (s.chronicle.length > 400) s.chronicle.splice(0, s.chronicle.length - 400);
}

/** Field notes: lessons the survivor has learned. Shown once when unlocked and kept in the journal. */
export const NOTES: Record<string, string> = {
  hearing: 'The dead hear running, doors, breaking glass, engines and gunfire. Walls muffle sound; open ground carries it.',
  glass: 'Broken glass stays in the frame. Clear it out with a weapon before climbing through — or wear gloves and a jacket.',
  window: 'Breaking a window can be heard for a whole block. An open window is quieter.',
  alarm: 'Many buildings have an alarm panel by the door. Break in while the power is on and it will scream for minutes.',
  exhaustion: 'Fighting while exhausted means slower swings, weaker shoves — and hands that reach you.',
  infection: 'Dirty wounds fester. Disinfect before bandaging, and replace bandages once they soak through.',
  running: 'Running is loud and burns stamina fast. Walk when you can; run when you must.',
  unlocked: 'The dead can shoulder open an unlocked door. Lock doors behind you.',
  fence: 'Vaulting fences while tired or overloaded can put you face down in the dirt.',
  encumbered: 'Heavy loads slow you down, tire you out and make climbing dangerous.',
  gunshot: 'A gunshot carries for hundreds of meters. Everything that hears it will come to look.',
  engine: 'Engines are loud, and a damaged engine is louder. Horns are louder still.',
  crash: 'Crashes hurt. The faster you hit, the worse the injuries.',
  light: 'Light carries far at night. Close the curtains, or keep the lights off.',
  food: 'Spoiled food, raw meat, wild plants and untreated water can make you very sick.',
  bite: 'A bite carries the fever. There is no cure. Never let them get their teeth into you.',
  grabbed: 'Once one of them has hold of you, the others can bite. Shove free — or never let them close.',
  weapon: 'Weapons wear out. Check the condition of yours before you need it.',
  fire: 'Food left on the stove burns. A burning pot becomes a burning house.',
  generator: 'Generators must run outdoors. Exhaust fumes kill indoors.',
  cold: 'Wet clothes steal body heat. Get dry, get warm.',
  sleep: 'Sleep behind locked doors, curtained windows and barricades — or don’t sleep deeply.',
  panic: 'Panic narrows your vision and shakes your aim. Distance calms you down.',
  helicopter: 'The helicopter circles anything moving outdoors, dragging every zombie along. Get under a roof.',
  lostThem: 'Break line of sight and change direction. They go to where they last saw you.',
  darkness: 'At night a flashlight makes you visible from much farther away — but without one you are almost blind.',
  bleeding: 'Bleeding does not stop on its own. Bandage it immediately.',
  carSurrounded: 'A car full of hands is a coffin. Don’t stop moving when they close in.',
  greed: 'Every extra room searched is more noise and more time. Know when to leave.',
  sound: 'You can distract them: a thrown bottle or a ringing alarm clock pulls them away.',
  utilities: 'The power and water will not last. Store water and plan for the dark.',
  bored: 'Boredom creeps up when you sit indoors with nothing to do, and lasting boredom turns into unhappiness. Get outside, keep busy, find comics, cards, a crossword, a TV or a radio.',
  stomp: 'Shove them to the ground with Space, then press Space (or click) again to stomp while they\'re down. A downed zombie is far less dangerous.',
  crowd: 'Two is dangerous. Three or more is how people die. Use doors and fences to split them up.',
  fever: 'Fever, cold sweats, vomiting... the bite is taking hold.',
};

export function note(s: GameState, id: string): boolean {
  if (s.notes.includes(id)) return false;
  if (!NOTES[id]) return false;
  s.notes.push(id);
  log(s, `Field note — ${NOTES[id]}`, 'good');
  return true;
}
