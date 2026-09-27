// Base building: walls and gates the survivor constructs. They hold for a while — not forever.
import { G, S } from '../world/world';
import { def, hasTool } from './items';
import { carried, consume, countItem } from './inventory';
import { log } from './log';
import { zombiesNear } from './runtime';
import { addXp, lvl } from './skills';
import { startAction, type Ctx } from './use';

export interface BuildRecipe {
  id: string;
  name: string;
  needs: [string, number][];
  tools: string[];
  skill: number;
  dur: number;
  desc: string;
  kind: 'wall' | 'logwall' | 'door' | 'metalwall';
}

export const BUILDS: BuildRecipe[] = [
  { id: 'wall', name: 'Wooden wall', needs: [['plank', 3], ['nails', 4]], tools: ['hammer'], skill: 0, dur: 12, kind: 'wall', desc: 'Blocks movement and sight. The dead can batter it down eventually. Sturdier with Carpentry.' },
  { id: 'logwall', name: 'Log wall', needs: [['log', 3], ['twine', 1]], tools: [], skill: 2, dur: 16, kind: 'logwall', desc: 'Heavy and strong. Needs Carpentry 2.' },
  { id: 'metalwall', name: 'Scrap metal wall', needs: [['scrap', 4], ['nails', 4]], tools: ['hammer'], skill: 3, dur: 18, kind: 'metalwall', desc: 'The strongest wall you can make. Needs Carpentry 3.' },
  { id: 'door', name: 'Wooden gate', needs: [['plank', 4], ['nails', 6]], tools: ['hammer'], skill: 2, dur: 16, kind: 'door', desc: 'A door you can bar shut from either side. Needs Carpentry 2.' },
];

export function buildStatus(c: Ctx, r: BuildRecipe): string | null {
  const s = c.s;
  for (const [id, q] of r.needs) if (countItem(s, id) < q) return `Need ${q}× ${def(id).name}`;
  for (const t of r.tools) if (!hasTool(carried(s), t)) return `Need a ${t}`;
  if (lvl(s.player, 'carpentry') < r.skill) return `Needs Carpentry ${r.skill}`;
  return null;
}

export function build(c: Ctx, id: string, x: number, y: number): boolean {
  const s = c.s;
  const rt = c.rt;
  const w = s.world;
  const r = BUILDS.find((b) => b.id === id);
  if (!r) return false;
  const why = buildStatus(c, r);
  if (why) {
    log(s, why, 'warn');
    return true;
  }
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return false;
  const i = y * w.w + x;
  if (w.struct[i] !== S.None || w.furn[i] >= 0 || w.ground[i] === G.Water) {
    log(s, 'Something is in the way there.', 'warn');
    return false;
  }
  const p = s.player;
  if (Math.floor(p.x) === x && Math.floor(p.y) === y) {
    log(s, 'You\'re standing there.', 'warn');
    return false;
  }
  if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > 2.3) {
    log(s, 'Too far away — move closer.', 'warn');
    return false;
  }
  if (s.vehicles.some((v) => Math.hypot(v.x - (x + 0.5), v.y - (y + 0.5)) < 2.5)) {
    log(s, 'A vehicle is in the way.', 'warn');
    return false;
  }
  const carp = lvl(p, 'carpentry');
  startAction(c, {
    label: `Building: ${r.name.toLowerCase()}`, dur: r.dur * (1 - carp * 0.05), cancelOnMove: true, anim: 'hammer',
    noise: { radius: r.kind === 'logwall' ? 9 : 14, every: 1.1, acc: 0.6, kind: 'hammer' },
    onDone: () => {
      if (w.struct[i] !== S.None || w.furn[i] >= 0) return;
      if (zombiesNear(s, rt, x + 0.5, y + 0.5, 0.6, []).length) {
        log(s, 'Something is standing there now!', 'danger');
        return;
      }
      for (const [nid, q] of r.needs) if (!consume(s, nid, q)) return;
      if (r.kind === 'door') {
        const vertical = [S.Wall, S.BuiltWall, S.FenceHigh, S.FenceLow].includes(w.struct[i - w.w]) || [S.Wall, S.BuiltWall, S.FenceHigh, S.FenceLow].includes(w.struct[i + w.w]);
        const id2 = w.doors.length;
        const hp = 110 + carp * 15;
        w.doors.push({
          id: id2, x, y, vertical, open: false, locked: false, lockKnown: true, hp, maxHp: hp, planks: 0, barricadeHp: 0, broken: false,
          ext: true, bld: w.bld[i], kind: 'built', keyId: -1,
        });
        w.struct[i] = S.Door;
        w.structRef[i] = id2;
      } else {
        const base = r.kind === 'metalwall' ? 260 : r.kind === 'logwall' ? 170 : 60;
        const hp = base + carp * (r.kind === 'wall' ? 14 : 20);
        w.struct[i] = S.BuiltWall;
        w.builtWalls[i] = { x, y, hp, maxHp: hp, kind: r.kind === 'metalwall' ? 'metal' : r.kind === 'logwall' ? 'log' : 'plank' };
      }
      w.rev.walls++;
      w.rev.doors++;
      w.rev.ground++;
      rt.fovDirty = true;
      addXp(p, 'carpentry', 18);
      log(s, `${r.name} built.`, 'good');
    },
  });
  return true;
}
