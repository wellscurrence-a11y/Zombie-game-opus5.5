export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const CAT_COLORS: Record<string, string> = {
  food: '#c8a050', drink: '#5a8ac8', weapon: '#9aa0a6', firearm: '#5a5f63', medical: '#e8e8e8', tool: '#b0574a', material: '#9a7a52',
  clothing: '#6a7a9a', bag: '#5f7a4a', misc: '#b0a890', book: '#9a4a4a', container: '#7aa0b0', ammo: '#b09a40', key: '#d8c050',
  part: '#707070', seed: '#7a9a50', placeable: '#8a7a6a',
};
