// Sound: every noise has a position and a radius. Zombies within earshot (after walls muffle it) react.
import { compass } from '../core/math';
import type { NoiseEvent, Runtime } from './runtime';
import type { GameState } from './types';
import { hasTrait } from './traits';

export function emitNoise(s: GameState, rt: Runtime, n: NoiseEvent): void {
  // rain and storms mask sound
  const mask = 1 - s.weather.rain * 0.28 - (s.weather.kind === 'storm' ? 0.1 : 0);
  const radius = n.radius * mask;
  if (radius <= 0.3) return;
  rt.noises.push({ ...n, radius });
  if (Math.hypot(n.x - s.player.x, n.y - s.player.y) < 90 && rt.sfx.length < 64) rt.sfx.push({ ...n, radius });
  if (n.src === 'player') {
    s.stats.noisesMade++;
    if (radius >= 3) rt.effects.push({ kind: 'ring', x: n.x, y: n.y, t: rt.realTime, dur: 0.9, r: radius, color: radius > 15 ? 0xf0a060 : 0xe8e0c8 });
  } else if (n.label) {
    // Did the survivor hear it?
    const p = s.player;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    let hear = radius * 1.6 + 6;
    if (hasTrait(p.traits, 'keenHearing')) hear *= 1.3;
    if (hasTrait(p.traits, 'hardOfHearing')) hear *= 0.6;
    if (p.sleeping) hear *= 0.5;
    if (d < hear && d > 2.5) {
      const recent = rt.heard.find((h) => h.label === n.label && rt.realTime - h.t < 3 && Math.hypot(h.x - n.x, h.y - n.y) < 8);
      if (!recent) {
        rt.heard.push({ t: rt.realTime, x: n.x, y: n.y, label: n.label, loud: radius });
        if (rt.heard.length > 30) rt.heard.shift();
      }
    }
  }
}

export function describeDirection(s: GameState, x: number, y: number): string {
  const p = s.player;
  const d = Math.hypot(x - p.x, y - p.y);
  const dist = d < 12 ? 'nearby' : d < 35 ? 'close' : d < 80 ? 'in the distance' : 'far away';
  return `${dist}, to the ${compass(x - p.x, y - p.y)}`;
}
