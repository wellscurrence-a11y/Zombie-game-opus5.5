// Treating wounds takes time, supplies and a steady hand.
import { clamp } from '../core/math';
import { INJURY_NAMES, isBleeding, OPEN_WOUNDS, PART_NAMES } from './body';
import { def, hasTool, type Item } from './items';
import { carried, useCharge } from './inventory';
import { log } from './log';
import { addXp, lvl } from './skills';
import { hasTrait } from './traits';
import type { Injury } from './types';
import { handWork, startAction, type Ctx } from './use';

export interface Treatment {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
  run: () => void;
}

function medTime(c: Ctx, base: number, inj: Injury): number {
  const p = c.s.player;
  let t = base * (1 - lvl(p, 'medicine') * 0.06) * handWork(c);
  // treating your own good hand is awkward
  if (inj.part === 'rHand' || inj.part === 'rArm') t *= 1.25;
  return t;
}

function afterTreat(c: Ctx, xp: number): void {
  const p = c.s.player;
  addXp(p, 'medicine', xp);
  if (hasTrait(p.traits, 'hemophobic')) {
    p.needs.stress = clamp(p.needs.stress + 0.08, 0, 1);
    p.needs.panic = clamp(p.needs.panic + 0.1, 0, 1);
  }
}

function find(c: Ctx, pred: (it: Item) => boolean): Item | null {
  return carried(c.s).find(pred) ?? null;
}

export function treatments(c: Ctx, inj: Injury): Treatment[] {
  const s = c.s;
  const out: Treatment[] = [];
  const name = `${INJURY_NAMES[inj.type].toLowerCase()} (${PART_NAMES[inj.part]})`;
  const open = OPEN_WOUNDS.includes(inj.type);
  if (inj.glass) {
    const tw = find(c, (i) => def(i.id).medical === 'tweezers');
    out.push({
      id: 'glass', label: tw ? 'Remove glass (tweezers)' : 'Dig out glass (fingers)', enabled: true,
      run: () => startAction(c, {
          urgent: true,
        label: `Removing glass from ${name}`, dur: medTime(c, tw ? 6 : 10, inj), cancelOnMove: true, anim: 'kneel',
        onDone: () => {
          inj.glass = false;
          if (!tw && c.rt.rng.chance(0.35)) {
            inj.bleed += 0.04;
            inj.severity = Math.min(1, inj.severity + 0.1);
            log(s, 'You get it out, but tear the wound wider.', 'warn');
          } else log(s, 'You pull out the shard of glass.', 'good');
          afterTreat(c, 6);
        },
      }),
    });
  }
  if (open && !inj.disinfected) {
    const dis = find(c, (i) => def(i.id).medical === 'disinfect' || def(i.id).medical === 'wipe') ?? find(c, (i) => i.id === 'whiskey' && (i.fill ?? 0) >= 0.05);
    out.push({
      id: 'disinfect', label: 'Disinfect', enabled: !!dis, reason: dis ? undefined : 'Need disinfectant, alcohol wipes or alcohol',
      run: () => {
        if (!dis) return;
        startAction(c, {
          urgent: true,
          label: `Disinfecting ${name}`, dur: medTime(c, 3, inj), cancelOnMove: true, anim: 'kneel',
          onDone: () => {
            inj.disinfected = true;
            inj.infection = Math.max(0, inj.infection - 0.15);
            if (dis.id === 'whiskey') dis.fill = Math.max(0, (dis.fill ?? 0) - 0.05);
            else useCharge(s, dis);
            s.player.needs.panic = clamp(s.player.needs.panic + 0.03, 0, 1);
            log(s, 'It stings like hell. Clean, though.', 'good');
            afterTreat(c, 4);
          },
        });
      },
    });
  }
  if (open || inj.type === 'fracture') {
    const clean = find(c, (i) => def(i.id).medical === 'bandage');
    const rag = find(c, (i) => def(i.id).medical === 'rag');
    const b = clean ?? rag;
    const verb = inj.bandaged ? 'Change bandage' : 'Bandage';
    out.push({
      id: 'bandage', label: b ? `${verb} (${def(b.id).name.toLowerCase()})` : verb, enabled: !!b, reason: b ? undefined : 'Need a bandage or rag',
      run: () => {
        if (!b) return;
        startAction(c, {
          urgent: true,
          label: `Bandaging ${name}`, dur: medTime(c, 4.5, inj), cancelOnMove: true, anim: 'kneel',
          onDone: () => {
            inj.bandaged = true;
            inj.bandageAge = 0;
            inj.dirtyBandage = def(b.id).medical === 'rag';
            useCharge(s, b);
            log(s, inj.dirtyBandage ? 'Bandaged with a dirty rag. It\'ll hold, but watch for infection.' : 'Bandaged.', inj.dirtyBandage ? 'warn' : 'good');
            afterTreat(c, 5);
          },
        });
      },
    });
  }
  if ((inj.type === 'deep' || inj.type === 'bite' || (inj.type === 'cut' && inj.severity > 0.5)) && !inj.stitched) {
    const kit = find(c, (i) => def(i.id).medical === 'suture');
    out.push({
      id: 'stitch', label: 'Stitch wound', enabled: !!kit, reason: kit ? undefined : 'Need a suture kit',
      run: () => {
        if (!kit) return;
        startAction(c, {
          urgent: true,
          label: `Stitching ${name}`, dur: medTime(c, 14, inj), cancelOnMove: true, anim: 'kneel',
          onDone: () => {
            useCharge(s, kit);
            const skill = lvl(s.player, 'medicine');
            if (c.rt.rng.chance(0.45 + skill * 0.08 - s.player.needs.panic * 0.3)) {
              inj.stitched = true;
              log(s, 'The wound is closed.', 'good');
            } else {
              inj.severity = Math.min(1, inj.severity + 0.05);
              s.player.body.health -= 3;
              log(s, 'Your hands shake — the stitches don\'t hold. Try again when you\'re calmer.', 'warn');
            }
            afterTreat(c, 12);
          },
        });
      },
    });
  }
  if (inj.type === 'fracture' && !inj.splinted) {
    const sp = find(c, (i) => def(i.id).medical === 'splint');
    out.push({
      id: 'splint', label: 'Apply splint', enabled: !!sp, reason: sp ? undefined : 'Need a splint (craft one from a plank and rags)',
      run: () => {
        if (!sp) return;
        startAction(c, {
          urgent: true,
          label: `Splinting ${name}`, dur: medTime(c, 9, inj), cancelOnMove: true, anim: 'kneel',
          onDone: () => {
            inj.splinted = true;
            useCharge(s, sp);
            log(s, 'The splint holds the bone in place.', 'good');
            afterTreat(c, 10);
          },
        });
      },
    });
  }
  if (inj.bandaged) {
    out.push({
      id: 'unbandage', label: 'Remove bandage', enabled: true,
      run: () => {
        inj.bandaged = false;
        inj.dirtyBandage = false;
      },
    });
  }
  void isBleeding;
  void hasTool;
  return out;
}

export function describeInjury(inj: Injury): string {
  const bits: string[] = [];
  const sev = inj.severity > 0.7 ? 'Severe ' : inj.severity < 0.3 ? 'Minor ' : '';
  bits.push(`${sev}${INJURY_NAMES[inj.type].toLowerCase()}`);
  if (isBleeding(inj)) bits.push('bleeding');
  if (inj.glass) bits.push('glass in wound');
  if (inj.bandaged) bits.push(inj.dirtyBandage ? 'dirty bandage' : 'bandaged');
  if (inj.disinfected) bits.push('disinfected');
  if (inj.stitched) bits.push('stitched');
  if (inj.splinted) bits.push('splinted');
  if (inj.infection > 0.6) bits.push('badly infected');
  else if (inj.infection > 0.3) bits.push('infected');
  else if (inj.infection > 0.12) bits.push('red and swollen');
  bits.push(`${Math.round(inj.heal * 100)}% healed`);
  return bits.join(' · ');
}
