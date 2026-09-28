// Graphics quality tiers. Low-end machines (Chromebooks, older integrated GPUs) get no shadows, no MSAA,
// cheaper ground shading and a reduced render resolution that adapts to the frame rate.

export type Tier = 'low' | 'medium' | 'high';
export type QualityPref = 'auto' | Tier;

export interface Profile {
  tier: Tier;
  antialias: boolean;
  shadows: boolean;
  shadowSize: number;
  /** Highest device pixel ratio worth rendering at. */
  maxDpr: number;
  /** Initial render scale (the adaptive scaler moves it between 0.5 and 1). */
  startScale: number;
  /** Full procedural surface detail (several noise octaves per pixel). */
  detail: boolean;
  /** Shadow casting from the flashlight. */
  spotShadows: boolean;
}

const KEY = 'qh-quality';

export function readQualityPref(): QualityPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high' || v === 'auto') return v;
  } catch {
    // storage blocked: fall back to detection
  }
  return 'auto';
}

export function writeQualityPref(q: QualityPref): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // not fatal
  }
}

let detected: Tier | null = null;

/** Guess how capable this machine is from the platform, core count, memory and GPU name. */
export function detectTier(): Tier {
  if (detected) return detected;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = nav.userAgent || '';
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 8;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // no GPU info
  }
  const weakGpu = /SwiftShader|llvmpipe|Mali|PowerVR|Adreno|Intel.*(HD Graphics|UHD Graphics|Iris\(R\) Graphics [56])/i.test(gpu);
  if (/CrOS/.test(ua) || /Android|iPhone|iPad/.test(ua) || weakGpu || cores <= 4 || mem <= 4) detected = 'low';
  else if (/Intel/i.test(gpu) || cores <= 6) detected = 'medium';
  else detected = 'high';
  return detected;
}

export function resolveTier(pref: QualityPref): Tier {
  return pref === 'auto' ? detectTier() : pref;
}

export function profileFor(tier: Tier): Profile {
  switch (tier) {
    case 'low':
      return { tier, antialias: false, shadows: false, shadowSize: 1024, maxDpr: 1, startScale: 0.8, detail: false, spotShadows: false };
    case 'medium':
      return { tier, antialias: false, shadows: true, shadowSize: 1024, maxDpr: 1.25, startScale: 1, detail: true, spotShadows: false };
    default:
      return { tier, antialias: true, shadows: true, shadowSize: 2048, maxDpr: 2, startScale: 1, detail: true, spotShadows: true };
  }
}

export const TIER_NAMES: Record<QualityPref, string> = {
  auto: 'Auto',
  low: 'Low (Chromebooks, older laptops)',
  medium: 'Medium',
  high: 'High',
};
