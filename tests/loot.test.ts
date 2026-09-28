import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ITEMS } from '../src/sim/items';
it('only lists items that exist in loot tables', () => {
  const src = readFileSync('src/sim/loot.ts', 'utf8');
  const ids = [...src.matchAll(/\['([a-zA-Z0-9]+)', [0-9.]+/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => !ITEMS[id]);
  expect(missing).toEqual([]);
});
