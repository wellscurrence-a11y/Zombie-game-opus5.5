// Shared shader patch for every world material: fog-of-war (visibility/explored), baked lamp light,
// ambient occlusion near the floor, and (for the ground) a procedural tile painter.
import * as THREE from 'three';
import { MAP_H, MAP_W } from '../world/world';

export const U = {
  uVis: { value: null as THREE.Texture | null },
  uLight: { value: null as THREE.Texture | null },
  uTiles: { value: null as THREE.Texture | null },
  uMapSize: { value: new THREE.Vector2(MAP_W, MAP_H) },
  uFogColor: { value: new THREE.Color(0x0a0c10) },
  uFogAmt: { value: 0 },
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWet: { value: 0 },
};

const COMMON_FRAG = /* glsl */ `
uniform sampler2D uVis;
uniform sampler2D uLight;
uniform vec2 uMapSize;
uniform vec3 uFogColor;
uniform float uFogAmt;
uniform float uTime;
uniform float uNight;
uniform float uWet;
varying vec3 vWPos;
float qh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float qnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = qh21(i), b = qh21(i + vec2(1.0, 0.0)), c = qh21(i + vec2(0.0, 1.0)), d = qh21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float qfbm(vec2 p) { return qnoise(p) * 0.5 + qnoise(p * 2.13) * 0.3 + qnoise(p * 4.37) * 0.2; }
vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }
`;

const GROUND_FUNC = /* glsl */ `
uniform sampler2D uTiles;
vec3 groundColor(vec2 wp, out float aoEdge) {
  ivec2 t = clamp(ivec2(floor(wp)), ivec2(0), ivec2(uMapSize) - 1);
  vec4 td = texelFetch(uTiles, t, 0);
  int type = int(td.r * 255.0 + 0.5);
  int v = int(td.g * 255.0 + 0.5);
  int dec = int(td.b * 255.0 + 0.5);
  int walls = int(td.a * 255.0 + 0.5);
  vec2 f = fract(wp);
  float n = qfbm(wp * 1.7);
  float nf = qnoise(wp * 9.0);
  vec3 c = vec3(0.5);
  if (type == 0) {
    c = mix(vec3(0.36, 0.41, 0.24), vec3(0.28, 0.34, 0.19), n) * (0.9 + nf * 0.18);
    c = mix(c, vec3(0.44, 0.41, 0.28), smoothstep(0.6, 0.78, qfbm(wp * 0.21)) * 0.55);
  } else if (type == 1) {
    float blades = qnoise(vec2(wp.x * 16.0, wp.y * 3.0));
    c = mix(vec3(0.31, 0.37, 0.19), vec3(0.47, 0.47, 0.27), blades * 0.7 + n * 0.3);
  } else if (type == 2) {
    c = mix(vec3(0.43, 0.35, 0.25), vec3(0.35, 0.28, 0.2), n) * (0.9 + nf * 0.2);
  } else if (type == 3 || type == 5 || type == 19) {
    float base = type == 5 ? 0.28 : type == 19 ? 0.46 : 0.235;
    c = vec3(base, base, base + 0.01) * (0.84 + nf * 0.22 + n * 0.12);
    float crack = smoothstep(0.015, 0.0, abs(qnoise(wp * 0.9) - 0.5)) * step(0.55, qnoise(wp * 0.3));
    c *= 1.0 - crack * 0.35;
    if (type == 19 && fract(wp.y / 3.0) < 0.04) c *= 0.75;
    float paint = 0.0;
    vec3 pc = vec3(0.82, 0.82, 0.78);
    if (type == 3) {
      if ((v & 64) != 0) {
        float bars = (v & 2) != 0 ? fract(wp.x * 1.4) : fract(wp.y * 1.4);
        paint = step(bars, 0.5);
      } else {
        if ((v & 1) != 0 && abs(f.y - 0.5) < 0.05 && fract(wp.x / 3.0) < 0.55) { paint = 1.0; pc = vec3(0.78, 0.66, 0.24); }
        if ((v & 2) != 0 && abs(f.x - 0.5) < 0.05 && fract(wp.y / 3.0) < 0.55) { paint = 1.0; pc = vec3(0.78, 0.66, 0.24); }
        if ((v & 4) != 0 && f.y < 0.1 && f.y > 0.02) paint = 1.0;
        if ((v & 8) != 0 && f.y > 0.9 && f.y < 0.98) paint = 1.0;
        if ((v & 16) != 0 && f.x < 0.1 && f.x > 0.02) paint = 1.0;
        if ((v & 32) != 0 && f.x > 0.9 && f.x < 0.98) paint = 1.0;
      }
    } else if (type == 5 && (v & 128) != 0) {
      if ((v & 1) != 0) paint = step(f.y, 0.07); else paint = step(f.x, 0.07);
    }
    c = mix(c, pc, paint * (0.55 + 0.35 * nf));
  } else if (type == 4) {
    c = vec3(0.57, 0.56, 0.53) * (0.9 + nf * 0.1 + n * 0.08);
    vec2 g = fract(wp * 0.5);
    if (g.x < 0.02 || g.y < 0.02) c *= 0.78;
    c *= 1.0 - smoothstep(0.62, 0.8, qfbm(wp * 0.6)) * 0.18;
  } else if (type == 6) {
    c = vec3(0.47, 0.45, 0.41) * (0.8 + qh21(floor(wp * 14.0)) * 0.35);
  } else if (type == 7 || type == 17) {
    float row = sin(wp.y * 6.2831) * 0.5 + 0.5;
    c = mix(vec3(0.24, 0.18, 0.12), vec3(0.4, 0.31, 0.22), row) * (0.9 + nf * 0.15);
  } else if (type == 8) {
    c = mix(vec3(0.23, 0.27, 0.15), vec3(0.31, 0.25, 0.16), qfbm(wp * 0.8)) * (0.85 + nf * 0.25);
    if (qh21(floor(wp * 6.0)) > 0.93) c = vec3(0.45, 0.3, 0.14);
  } else if (type == 9) {
    float r = qnoise(wp * 1.3 + vec2(uTime * 0.15, uTime * 0.1)) * 0.6 + qnoise(wp * 3.1 - vec2(uTime * 0.2, 0.0)) * 0.4;
    c = mix(vec3(0.1, 0.17, 0.2), vec3(0.2, 0.3, 0.33), r);
  } else if (type == 10) {
    c = vec3(0.6, 0.55, 0.44) * (0.9 + nf * 0.15);
  } else if (type == 11) {
    float pi = floor(wp.y * 4.0);
    float off = qh21(vec2(pi, 3.0)) * 2.0;
    float seg = floor(wp.x / 2.0 + off);
    float pv = qh21(vec2(pi, seg));
    c = mix(vec3(0.42, 0.29, 0.18), vec3(0.55, 0.4, 0.26), pv);
    c *= 0.9 + qnoise(vec2(wp.x * 2.0, wp.y * 60.0)) * 0.15;
    if (fract(wp.y * 4.0) < 0.06 || fract(wp.x / 2.0 + off) < 0.012) c *= 0.7;
  } else if (type == 12) {
    int pal = v - (v / 4) * 4;
    vec2 g = fract(wp * 2.0);
    vec3 a = pal == 0 ? vec3(0.8, 0.79, 0.75) : pal == 1 ? vec3(0.72, 0.66, 0.56) : pal == 2 ? vec3(0.56, 0.62, 0.66) : vec3(0.85, 0.85, 0.82);
    if (pal == 3 && mod(floor(wp.x * 2.0) + floor(wp.y * 2.0), 2.0) > 0.5) a = vec3(0.16, 0.16, 0.17);
    c = a * (0.94 + nf * 0.08);
    if (g.x < 0.05 || g.y < 0.05) c *= 0.72;
  } else if (type == 13) {
    int pal = v - (v / 6) * 6;
    vec3 a = pal == 0 ? vec3(0.47, 0.4, 0.32) : pal == 1 ? vec3(0.34, 0.4, 0.46) : pal == 2 ? vec3(0.43, 0.3, 0.29) : pal == 3 ? vec3(0.38, 0.43, 0.34) : pal == 4 ? vec3(0.53, 0.5, 0.44) : vec3(0.3, 0.3, 0.33);
    c = a * (0.88 + qh21(floor(wp * 24.0)) * 0.12 + n * 0.08);
  } else if (type == 14) {
    c = vec3(0.5, 0.5, 0.48) * (0.88 + n * 0.14 + nf * 0.05);
    if (fract(wp.x / 4.0) < 0.008 || fract(wp.y / 4.0) < 0.008) c *= 0.8;
  } else if (type == 15) {
    c = vec3(0.71, 0.71, 0.67) * (0.93 + qh21(floor(wp * 30.0)) * 0.08);
    if (f.x < 0.015 || f.y < 0.015) c *= 0.85;
  } else if (type == 16) {
    c = vec3(0.1, 0.09, 0.08) + vec3(0.12) * qh21(floor(wp * 11.0)) * n;
  } else if (type == 18) {
    c = vec3(0.38, 0.35, 0.32) * (0.7 + qh21(floor(wp * 5.0)) * 0.5);
  } else if (type == 20) {
    c = mix(vec3(0.46, 0.39, 0.29), vec3(0.37, 0.31, 0.23), n) * (0.9 + nf * 0.15);
  }
  // decals
  if ((dec & 1) != 0) {
    float b = qfbm(wp * 4.0 + vec2(float(t.x) * 0.37, float(t.y) * 0.71));
    c = mix(c, vec3(0.25, 0.03, 0.02), smoothstep(0.52, 0.6, b) * 0.9);
  }
  if ((dec & 2) != 0 && qh21(floor(wp * 22.0)) > 0.9) c = vec3(0.75, 0.82, 0.85);
  if ((dec & 4) != 0) c = mix(c, vec3(0.08, 0.07, 0.06), smoothstep(0.35, 0.6, qfbm(wp * 2.0)) * 0.8);
  // soft darkening where the floor meets a wall
  float ao = 1.0;
  if ((walls & 1) != 0) ao *= mix(0.62, 1.0, smoothstep(0.0, 0.35, f.y));
  if ((walls & 2) != 0) ao *= mix(0.62, 1.0, smoothstep(0.0, 0.35, 1.0 - f.x));
  if ((walls & 4) != 0) ao *= mix(0.62, 1.0, smoothstep(0.0, 0.35, 1.0 - f.y));
  if ((walls & 8) != 0) ao *= mix(0.62, 1.0, smoothstep(0.0, 0.35, f.x));
  aoEdge = ao;
  // rain darkens outdoor surfaces
  c *= 1.0 - uWet * 0.25;
  return s2l(c);
}
`;

export interface PatchOpts {
  /** Minimum visibility factor (roofs never go fully dark). */
  minVis?: number;
  /** Darken near the floor (cheap ambient occlusion for walls/furniture). */
  ao?: boolean;
  ground?: boolean;
  /** Skip fog-of-war (e.g. the player's own model). */
  noFog?: boolean;
}

export function patchMaterial<T extends THREE.Material>(mat: T, opts: PatchOpts = {}): T {
  const minVis = (opts.minVis ?? 0).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVis = U.uVis;
    shader.uniforms.uLight = U.uLight;
    shader.uniforms.uMapSize = U.uMapSize;
    shader.uniforms.uFogColor = U.uFogColor;
    shader.uniforms.uFogAmt = U.uFogAmt;
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uNight = U.uNight;
    shader.uniforms.uWet = U.uWet;
    if (opts.ground) shader.uniforms.uTiles = U.uTiles;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 qW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          qW = instanceMatrix * qW;
        #endif
        qW = modelMatrix * qW;
        vWPos = qW.xyz;`,
      );
    let frag = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON_FRAG + (opts.ground ? GROUND_FUNC : ''));
    if (opts.ground) {
      frag = frag.replace('#include <map_fragment>', 'float groundAo = 1.0;\ndiffuseColor.rgb = groundColor(vWPos.xz, groundAo);');
    }
    frag = frag.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      {
        vec3 lamp = texture2D(uLight, vWPos.xz / uMapSize).rgb;
        float lampFall = ${opts.ground ? '1.0' : 'clamp(1.2 - vWPos.y * 0.25, 0.4, 1.0)'};
        reflectedLight.indirectDiffuse += diffuseColor.rgb * lamp * 2.2 * lampFall;
      }`,
    );
    frag = frag.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      {
        ${opts.ground ? 'gl_FragColor.rgb *= groundAo;' : ''}
        ${opts.ao ? 'gl_FragColor.rgb *= mix(0.6, 1.0, clamp(vWPos.y / 1.1, 0.0, 1.0));' : ''}
        ${
          opts.noFog
            ? ''
            : `vec4 vis = texture2D(uVis, vWPos.xz / uMapSize);
        float seen = max(vis.r, ${minVis});
        float known = max(vis.g, ${minVis});
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 desat = mix(vec3(lum) * vec3(0.8, 0.86, 1.0), gl_FragColor.rgb, 0.3);
        float mk = mix(0.26, 0.5, known) * (1.0 - uNight * 0.5);
        vec3 hidden = desat * mk;
        hidden = mix(hidden, uFogColor, uFogAmt * 0.7);
        gl_FragColor.rgb = mix(hidden, gl_FragColor.rgb, seen);`
        }
      }`,
    );
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `q:${opts.ground ? 1 : 0}:${opts.ao ? 1 : 0}:${minVis}:${opts.noFog ? 1 : 0}`;
  return mat;
}
