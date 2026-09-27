// Full-screen UI: main menu, survivor creation, death report, pause, help.
import { clockString, daylight, dayNumber, formatDuration } from '../core/time';
import { NOTES } from '../sim/log';
import { DEFAULT_SETTINGS, type SurvivorSpec } from '../sim/newgame';
import type { WorldSummary } from '../sim/save';
import { OCCUPATIONS, TRAITS } from '../sim/traits';
import type { DeadRecord, GameState, WorldSettings } from '../sim/types';
import { encumbranceLevel } from '../sim/stats';
import { esc } from './dom';

const FIRST = ['Alex', 'Sam', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie', 'Robin', 'Dana', 'Avery', 'Quinn', 'Harper', 'Rowan', 'Emery', 'Reese', 'Skyler', 'Frankie', 'Charlie', 'Parker'];
const LAST = ['Hollis', 'Mercer', 'Reyes', 'Novak', 'Brennan', 'Okafor', 'Lindqvist', 'Haddad', 'Moreau', 'Kowalski', 'Tanaka', 'Duarte', 'Walsh', 'Petrov', 'Adeyemi', 'Sullivan', 'Castillo', 'Byrne', 'Whitlock', 'Varga'];
export const randomName = (): string => `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;

export function screen(root: HTMLElement, cls = ''): HTMLElement {
  const e = document.createElement('div');
  e.className = `screen ${cls}`;
  root.appendChild(e);
  return e;
}

// ------------------------------------------------------------------ main menu

export interface MenuHandlers {
  onContinue?: () => void;
  onNew: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onHelp: () => void;
  onRecords: () => void;
  onSettings: () => void;
}

export function mainMenu(root: HTMLElement, worlds: WorldSummary[], current: string | undefined, h: MenuHandlers): HTMLElement {
  const sc = screen(root);
  const cur = worlds.find((w) => w.id === current);
  const rows = worlds
    .slice(0, 6)
    .map((w) => `<tr><td>${esc(w.survivor)}</td><td class="dim">${w.alive ? `alive · ${w.days.toFixed(1)} days` : 'dead'}</td><td class="dim">world day ${w.worldDay} · ${w.survivors} survivor${w.survivors > 1 ? 's' : ''}</td><td><button data-load="${w.id}">${w.alive ? 'Continue' : 'Next survivor'}</button></td><td><button class="ghost" data-del="${w.id}" title="Delete this world">✕</button></td></tr>`)
    .join('');
  sc.innerHTML = `<div class="menu">
    <div class="brand">QUIET HOURS</div>
    <div class="brand-sub">Cedar Hollow · one life · the dead are listening</div>
    <div class="grid2">
      <div class="buttons">
        ${cur ? `<button class="primary" data-a="continue">${cur.alive ? `Continue — ${esc(cur.survivor)}` : 'Continue with a new survivor'}</button>` : ''}
        <button data-a="new">New world</button>
        <button data-a="help">How to survive</button>
        <button data-a="records">Hall of the dead</button>
        <button data-a="settings">Settings</button>
      </div>
      <div>
        <p>There are no missions. There is no cure. Supplies run out, the power fails, the water stops. The dead are slow, but they hear everything, and they never stop coming once they know where you are.</p>
        <p>You will die. Try to understand why.</p>
      </div>
    </div>
    ${rows ? `<h3 style="margin:22px 0 8px;color:var(--accent)">Worlds</h3><table class="records">${rows}</table>` : ''}
  </div>`;
  sc.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.a === 'continue') h.onContinue?.();
    else if (b.dataset.a === 'new') h.onNew();
    else if (b.dataset.a === 'help') h.onHelp();
    else if (b.dataset.a === 'records') h.onRecords();
    else if (b.dataset.a === 'settings') h.onSettings();
    else if (b.dataset.load) h.onLoad(b.dataset.load);
    else if (b.dataset.del && confirm('Delete this world and everyone in it?')) h.onDelete(b.dataset.del);
  });
  return sc;
}

// ------------------------------------------------------------------ survivor creation

export function survivorCreation(root: HTMLElement, opts: { newWorld: boolean; title?: string }, onStart: (spec: SurvivorSpec, settings: WorldSettings, seed: number) => void, onBack: () => void): HTMLElement {
  const sc = screen(root);
  let occ = OCCUPATIONS[0].id;
  const chosen = new Set<string>();
  const settings: WorldSettings = { ...DEFAULT_SETTINGS };
  let name = randomName();
  const render = (): void => {
    const o = OCCUPATIONS.find((x) => x.id === occ)!;
    let pts = o.points;
    for (const t of chosen) pts -= TRAITS.find((x) => x.id === t)!.cost;
    const excluded = new Set<string>();
    for (const t of chosen) for (const ex of TRAITS.find((x) => x.id === t)!.excludes ?? []) excluded.add(ex);
    sc.innerHTML = `<div class="menu">
      <h1 style="font-size:32px;color:#e7dcc4">${esc(opts.title ?? (opts.newWorld ? 'A new survivor in a new world' : 'Another survivor'))}</h1>
      <p style="margin:6px 0 16px">Choose who you were before. It won't save you — but it changes what you're good at.</p>
      <div class="grid2">
        <div>
          <div class="field"><label>Name</label><input id="nm" value="${esc(name)}" maxlength="32"></div>
          <div class="field"><label>Occupation</label>${OCCUPATIONS.map((x) => `<div class="occ ${x.id === occ ? 'on' : ''}" data-occ="${x.id}"><b>${esc(x.name)}</b> <span class="dim">(${x.points >= 0 ? '+' : ''}${x.points} pts)</span><div class="d">${esc(x.desc)}</div></div>`).join('')}</div>
        </div>
        <div>
          <div class="field"><label>Traits — points left: <span class="pts ${pts < 0 ? 'bad' : 'good'}">${pts}</span></label>
          <div class="traits">${TRAITS.map((t) => {
            const on = chosen.has(t.id);
            const off = !on && excluded.has(t.id);
            return `<div class="trait ${t.cost > 0 ? 'pos' : 'neg'} ${on ? 'on' : ''} ${off ? 'off' : ''}" data-tr="${t.id}" title="${esc(t.desc)}"><span>${esc(t.name)}</span><span class="c">${t.cost > 0 ? '−' : '+'}${Math.abs(t.cost)}</span></div>`;
          }).join('')}</div></div>
          ${opts.newWorld ? `<div class="field"><label>World</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <select id="pop"><option value="0.6">Sparse dead</option><option value="1" selected>Normal population</option><option value="1.4">Crowded</option></select>
              <select id="loot"><option value="0.6">Scarce loot</option><option value="1" selected>Normal loot</option><option value="1.5">Plentiful loot</option></select>
              <select id="day"><option value="30">30-minute days</option><option value="45" selected>45-minute days</option><option value="60">60-minute days</option><option value="90">90-minute days</option></select>
              <select id="util"><option value="early">Utilities fail early</option><option value="normal" selected>Utilities fail in 1–2 weeks</option><option value="late">Utilities last longer</option></select>
            </div>
            <input id="seed" placeholder="Seed (optional)" style="margin-top:8px"></div>` : ''}
          <div style="display:flex;gap:8px;margin-top:14px"><button class="primary" id="go" ${pts < 0 ? 'disabled' : ''}>Begin</button><button id="back">Back</button><button id="rnd" class="ghost">Random name</button></div>
        </div>
      </div></div>`;
  };
  render();
  sc.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).id === 'nm') name = (e.target as HTMLInputElement).value;
  });
  sc.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.id === 'pop') settings.population = Number(t.value);
    if (t.id === 'loot') settings.loot = Number(t.value);
    if (t.id === 'day') settings.dayLength = Number(t.value);
    if (t.id === 'util') {
      settings.powerDays = t.value === 'early' ? [2, 5] : t.value === 'late' ? [14, 28] : [5, 12];
      settings.waterDays = t.value === 'early' ? [3, 7] : t.value === 'late' ? [18, 35] : [7, 16];
    }
  });
  sc.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const occEl = t.closest('[data-occ]') as HTMLElement | null;
    const trEl = t.closest('[data-tr]') as HTMLElement | null;
    const keep = (): void => {
      const pop = sc.querySelector('#pop') as HTMLSelectElement | null;
      const vals = pop ? { pop: pop.value, loot: (sc.querySelector('#loot') as HTMLSelectElement).value, day: (sc.querySelector('#day') as HTMLSelectElement).value, util: (sc.querySelector('#util') as HTMLSelectElement).value, seed: (sc.querySelector('#seed') as HTMLInputElement).value } : null;
      render();
      if (vals) {
        (sc.querySelector('#pop') as HTMLSelectElement).value = vals.pop;
        (sc.querySelector('#loot') as HTMLSelectElement).value = vals.loot;
        (sc.querySelector('#day') as HTMLSelectElement).value = vals.day;
        (sc.querySelector('#util') as HTMLSelectElement).value = vals.util;
        (sc.querySelector('#seed') as HTMLInputElement).value = vals.seed;
      }
    };
    if (occEl) {
      occ = occEl.dataset.occ!;
      keep();
    } else if (trEl && !trEl.classList.contains('off')) {
      const id = trEl.dataset.tr!;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      keep();
    } else if (t.id === 'rnd') {
      name = randomName();
      keep();
    } else if (t.id === 'back') onBack();
    else if (t.id === 'go') {
      const seedStr = (sc.querySelector('#seed') as HTMLInputElement | null)?.value.trim();
      let seed = Math.floor(Math.random() * 1e9);
      if (seedStr) {
        seed = Number(seedStr);
        if (!Number.isFinite(seed)) seed = [...seedStr].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      }
      onStart({ name: name.trim() || randomName(), occupation: occ, traits: [...chosen] }, settings, seed >>> 0);
    }
  });
  return sc;
}

// ------------------------------------------------------------------ death report

export function contributingFactors(s: GameState, nearZombies: number): string[] {
  const p = s.player;
  const n = p.needs;
  const f: string[] = [];
  if (nearZombies >= 3) f.push(`Surrounded by ${nearZombies}`);
  else if (nearZombies === 2) f.push('Fighting two at once');
  if (n.endurance < 0.25) f.push('Exhausted — no stamina left');
  if (n.fatigue > 0.8) f.push('Hadn\'t slept');
  if (encumbranceLevel(p) >= 2) f.push('Carrying too much');
  if (daylight(s.time) < 0.15) f.push('In the dark');
  if (s.weather.kind === 'fog') f.push('Fog');
  if (s.weather.kind === 'storm') f.push('Storm');
  if (n.panic > 0.6) f.push('Panicking');
  if (p.body.fever) f.push('Bitten');
  if (p.body.injuries.some((i) => i.infection > 0.4)) f.push('Infected wound left untreated');
  if (p.body.injuries.some((i) => !i.bandaged && i.bleed > 0.03)) f.push('Unbandaged bleeding');
  if (n.hunger > 0.75) f.push('Starving');
  if (n.thirst > 0.75) f.push('Dehydrated');
  if (n.drunk > 0.3) f.push('Drunk');
  const recent = s.chronicle.filter((c) => s.time - c.t < 3);
  if (recent.some((c) => /alarm/i.test(c.text))) f.push('Set off an alarm');
  if (recent.some((c) => /Fired a/.test(c.text))) f.push('Gunfire drew them in');
  if (recent.some((c) => /broke mid-fight/.test(c.text))) f.push('Weapon broke');
  if (recent.some((c) => /Crashed/.test(c.text))) f.push('Car crash');
  if (recent.some((c) => /Fell while/.test(c.text))) f.push('Fell while climbing');
  if (recent.some((c) => /Grabbed/.test(c.text))) f.push('Grabbed');
  if (recent.some((c) => /wasn't secured/.test(c.text))) f.push('Slept somewhere unsafe');
  if (recent.some((c) => /unlocked door/.test(c.text))) f.push('Unlocked door');
  if (recent.some((c) => /racket/.test(c.text))) f.push('Noisy searching');
  return f;
}

export function deathScreen(root: HTMLElement, s: GameState, rec: DeadRecord, factors: string[], h: { onNext: () => void; onNewWorld: () => void; onMenu: () => void }): HTMLElement {
  const sc = screen(root, 'clear');
  const p = s.player;
  const line = s.chronicle.filter((c) => c.t >= p.startT).slice(-14);
  const tl = line.map((c) => `<div class="sev${c.severity >= 5 ? 5 : c.severity >= 3 ? 3 : 1}"><span class="t">Day ${dayNumber(c.t)} ${clockString(c.t)}</span>${esc(c.text)}</div>`).join('');
  const learned = s.notes.slice(-4).map((id) => `<div class="note">${esc(NOTES[id] ?? '')}</div>`).join('');
  sc.innerHTML = `<div class="menu death">
    <h1>YOU DIED</h1>
    <div class="big">${esc(p.name)} survived ${formatDuration(rec.days * 24)}.</div>
    <div class="dim">${esc(p.deathCause)} · Day ${dayNumber(s.time)}, ${clockString(s.time)} · ${p.kills} killed</div>
    <div class="grid2" style="margin-top:14px">
      <div><h3 style="color:var(--accent)">What led here</h3><div class="timeline">${tl || '<div>It happened fast.</div>'}</div></div>
      <div><h3 style="color:var(--accent)">Contributing factors</h3><div style="margin:10px 0">${factors.map((f) => `<span class="factor">${esc(f)}</span>`).join('') || '<span class="dim">None obvious. Sometimes it just goes wrong.</span>'}</div>
      ${learned ? `<h3 style="color:var(--accent);margin-top:12px">Lessons</h3>${learned}` : ''}</div>
    </div>
    <p class="dim" style="margin-top:14px">The world goes on. ${esc(p.name)}'s body — and everything they carried — lies where they fell${p.body.fever ? ', though it may not stay down' : ''}. A new survivor can find it.</p>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="primary" data-a="next">Continue with a new survivor</button><button data-a="world">New world</button><button data-a="menu">Main menu</button></div>
  </div>`;
  sc.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'next') h.onNext();
    else if (a === 'world') h.onNewWorld();
    else if (a === 'menu') h.onMenu();
  });
  return sc;
}

// ------------------------------------------------------------------ help & records & settings

export function helpScreen(root: HTMLElement, onClose: () => void): HTMLElement {
  const sc = screen(root);
  sc.innerHTML = `<div class="menu"><h1 style="font-size:32px;color:#e7dcc4">How to survive</h1>
  <div class="grid2" style="margin-top:14px"><div><h3 style="color:var(--accent);margin-bottom:8px">Controls</h3><div class="keys">
    <span class="k">W A S D</span><span>Move (relative to the screen)</span>
    <span class="k">Mouse</span><span>Look / aim — you face the cursor</span>
    <span class="k">Shift</span><span>Run (loud, tiring)</span>
    <span class="k">C</span><span>Crouch / sneak</span>
    <span class="k">Left click</span><span>Attack; hold & release to aim and fire guns</span>
    <span class="k">Space</span><span>Shove (break grabs, knock them down)</span>
    <span class="k">Right click</span><span>Options for doors, windows, furniture, cars, ground</span>
    <span class="k">E</span><span>Open doors, climb, vault; exit a car</span>
    <span class="k">F</span><span>Flashlight (headlights in a car)</span>
    <span class="k">R</span><span>Reload (start engine in a car)</span>
    <span class="k">L</span><span>Room lights</span>
    <span class="k">1–6</span><span>Equip weapons</span>
    <span class="k">Tab / I</span><span>Inventory & looting</span>
    <span class="k">H K B M J</span><span>Health, Skills, Craft, Map, Journal</span>
    <span class="k">T</span><span>Speed up time (only when it's quiet)</span>
    <span class="k">Z / X</span><span>Rotate camera · wheel to zoom</span>
    <span class="k">Esc</span><span>Close / pause</span>
  </div></div>
  <div><h3 style="color:var(--accent);margin-bottom:8px">What experienced survivors know</h3>
    <div class="note">They don't know where you are. They see movement (worse in the dark, fog, rain — better if you carry a light), and they hear noise. Walls muffle sound.</div>
    <div class="note">One is manageable. Two needs care. Three can kill you. Shove them down and stomp them.</div>
    <div class="note">Running drains stamina fast. Fighting exhausted means slow swings, weak shoves, and grabs.</div>
    <div class="note">Breaking glass is loud, and the glass stays in the frame. Many buildings have alarms while the power's on.</div>
    <div class="note">Bleeding needs a bandage now. Dirty wounds go bad in hours. Bites carry a fever with no cure.</div>
    <div class="note">Lock doors, close curtains, board windows. Sleep somewhere secured.</div>
    <div class="note">The power and water will fail. Store water. A generator must run outdoors.</div>
    <div class="note">Every extra room you search is more noise and more time. Know when to leave.</div>
  </div></div>
  <div style="margin-top:14px"><button class="primary" id="close">Back</button></div></div>`;
  sc.querySelector('#close')!.addEventListener('click', onClose);
  return sc;
}

export function recordsScreen(root: HTMLElement, recs: DeadRecord[], onClose: () => void): HTMLElement {
  const sc = screen(root);
  const rows = recs.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.days.toFixed(1)} days</td><td class="dim">${esc(OCCUPATIONS.find((o) => o.id === r.occupation)?.name ?? r.occupation)}</td><td class="dim">${esc(r.cause)}</td><td class="dim">${r.kills} killed</td><td class="faint">${r.when}</td></tr>`).join('');
  const best = recs.length ? recs[0].days : 0;
  const milestones = [3, 10, 30, 100].map((m) => `<span class="factor" style="border-color:${best >= m ? 'var(--good)' : 'var(--line-2)'};color:${best >= m ? '#cfe0c2' : 'var(--faint)'}">${m} days</span>`).join('');
  sc.innerHTML = `<div class="menu"><h1 style="font-size:32px;color:#e7dcc4">Hall of the dead</h1><div style="margin:12px 0">${milestones}</div>${rows ? `<table class="records">${rows}</table>` : '<p>No one has died yet. Give it time.</p>'}<div style="margin-top:14px"><button class="primary" id="close">Back</button></div></div>`;
  sc.querySelector('#close')!.addEventListener('click', onClose);
  return sc;
}

export interface Prefs {
  shadows: boolean;
  volume: number;
  pixelRatio: number;
}

export function settingsScreen(root: HTMLElement, prefs: Prefs, onSave: (p: Prefs) => void, onClose: () => void): HTMLElement {
  const sc = screen(root);
  sc.innerHTML = `<div class="menu"><h1 style="font-size:32px;color:#e7dcc4">Settings</h1>
  <div class="field" style="margin-top:14px"><label>Shadows</label><select id="sh"><option value="1">On</option><option value="0">Off (faster)</option></select></div>
  <div class="field"><label>Render resolution</label><select id="pr"><option value="1">Normal</option><option value="0.75">Reduced (faster)</option><option value="2">High (sharper)</option></select></div>
  <div class="field"><label>Volume</label><input id="vol" type="range" min="0" max="1" step="0.05" value="${prefs.volume}"></div>
  <div style="display:flex;gap:8px"><button class="primary" id="save">Save</button><button id="close">Back</button></div></div>`;
  (sc.querySelector('#sh') as HTMLSelectElement).value = prefs.shadows ? '1' : '0';
  (sc.querySelector('#pr') as HTMLSelectElement).value = String(prefs.pixelRatio);
  sc.querySelector('#save')!.addEventListener('click', () => {
    onSave({
      shadows: (sc.querySelector('#sh') as HTMLSelectElement).value === '1',
      pixelRatio: Number((sc.querySelector('#pr') as HTMLSelectElement).value),
      volume: Number((sc.querySelector('#vol') as HTMLInputElement).value),
    });
  });
  sc.querySelector('#close')!.addEventListener('click', onClose);
  return sc;
}

export function pauseScreen(root: HTMLElement, h: { onResume: () => void; onSaveQuit: () => void; onHelp: () => void; onSettings: () => void }): HTMLElement {
  const sc = screen(root, 'clear');
  sc.innerHTML = `<div class="menu" style="width:340px"><h1 style="font-size:30px;color:#e7dcc4;margin-bottom:14px">Paused</h1><div class="buttons">
    <button class="primary" data-a="resume">Resume</button><button data-a="help">How to survive</button><button data-a="settings">Settings</button><button data-a="quit">Save & quit to menu</button></div></div>`;
  sc.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'resume') h.onResume();
    else if (a === 'quit') h.onSaveQuit();
    else if (a === 'help') h.onHelp();
    else if (a === 'settings') h.onSettings();
  });
  return sc;
}
