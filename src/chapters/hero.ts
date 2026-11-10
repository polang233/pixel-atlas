/**
 * 00 · 星图. The whole dataset as one colour-wheel planet.
 *
 * Rendering is a tiny virtual-texture system:
 *   LOD0 overview.png  1 texel per sprite (mipmapped)       far away
 *   LOD1 l1 tiles      4×4 px per sprite (box filtered)      mid zoom
 *   LOD2 l2 tiles      the real 16×16 sprites                close up
 * Tiles stream into two texture arrays; a small page table per level maps
 * tile → array layer, and the shader falls back level by level when a tile
 * isn't there yet. Searching, flying and rotating all run on this.
 */
import { sound } from '../audio'
import {
  bytesDownloaded,
  cellInfo,
  loadIndex,
  loadMeta,
  nearestColorCell,
  search,
  spriteCanvas,
  tileBitmap,
  type AtlasMeta,
  type CellInfo,
  type LevelMeta,
  type Overview,
} from '../atlas'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import { zhLabel } from '../zh'

export interface HeroHooks {
  toWorkshop(sprite: HTMLCanvasElement, info: CellInfo): void
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
precision highp sampler2DArray;
uniform sampler2D uOv;
uniform sampler2DArray uA1;
uniform sampler2DArray uA2;
uniform usampler2D uP1;
uniform usampler2D uP2;
uniform vec2 uRes;
uniform vec2 uW;
uniform float uZoom;
uniform float uAngle;
uniform float uSide;
uniform float uR;
uniform float uTime;
uniform float uDim;
uniform float uM1;
uniform float uM2;
uniform float uGrid;
uniform float uCellGrid;
uniform float uShade;
uniform float uStyle;
uniform float uBlock;
uniform vec2 uN;   // tiles per side for l1, l2
out vec4 o;

uniform float uMap;      // 0 = one planet, 1 = continents pushed apart into a world map
uniform vec4 uSec[7];    // per colour continent: mid angle, half width, offset x, offset y
uniform float uRc;       // radius of the grey core island
float wobA(float r) { return 0.075 * sin(r * 0.027) + 0.04 * sin(r * 0.011 + 2.0); }
float wobR(float a) { return uR * (0.045 * sin(a * 5.0) + 0.022 * sin(a * 11.0 + 1.0) + 0.012 * sin(a * 23.0)); }
// signed distance in cells from disc point p (relative to the centre) to piece k; <= 0 is inside
float pieceDist(vec2 p, int k) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float rc = uRc + wobR(a);
  if (k == 0) return r - rc;
  vec4 sc = uSec[k - 1];
  float da = mod(a + wobA(r) - sc.x + 3.14159265, 6.2831853) - 3.14159265;
  return max(max((abs(da) - sc.y) * r, r - uR), rc - r);
}
// which piece a map point falls on (-1 = sea); w = the disc point it shows
int locate(vec2 m, vec2 D, out vec2 w, out float dist) {
  dist = 1e9;
  int hit = -1;
  w = m;
  for (int k = 0; k < 8; k++) {
    vec2 off = k == 0 ? vec2(0.0) : uSec[k - 1].zw * uMap;
    vec2 p = m - D - off;
    float d = pieceDist(p, k);
    if (d <= 0.0 && hit < 0) { hit = k; w = p + D; }
    dist = min(dist, d);
  }
  return hit;
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.y * 4 + i.x;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[idx]) + 0.5) / 16.0;
}

vec4 lvl(usampler2D pt, sampler2DArray arr, float cpt, float n, vec2 w, vec2 gx, vec2 gy) {
  vec2 t = floor(w / cpt);
  if (t.x < 0.0 || t.y < 0.0 || t.x >= n || t.y >= n) return vec4(-1.0);
  uint layer = texelFetch(pt, ivec2(t), 0).r;
  if (layer == 0u) return vec4(-1.0);
  vec2 uv = w / cpt - t;
  return textureGrad(arr, vec3(uv, float(layer - 1u)), gx / cpt, gy / cpt);
}

const vec3 PICO[16] = vec3[16](
  vec3(0.0), vec3(0.114, 0.169, 0.325), vec3(0.494, 0.145, 0.325), vec3(0.0, 0.529, 0.318),
  vec3(0.671, 0.322, 0.212), vec3(0.373, 0.341, 0.310), vec3(0.761, 0.765, 0.780), vec3(1.0, 0.945, 0.910),
  vec3(1.0, 0.0, 0.302), vec3(1.0, 0.639, 0.0), vec3(1.0, 0.925, 0.153), vec3(0.0, 0.894, 0.212),
  vec3(0.161, 0.678, 1.0), vec3(0.514, 0.463, 0.612), vec3(1.0, 0.467, 0.659), vec3(1.0, 0.8, 0.667));
vec3 nearest16(vec3 c) {
  vec3 best = PICO[0];
  float bd = 9.0;
  for (int i = 0; i < 16; i++) {
    vec3 d = c - PICO[i];
    float dd = dot(d * d, vec3(0.3, 0.59, 0.11));
    if (dd < bd) { bd = dd; best = PICO[i]; }
  }
  return best;
}

void main() {
  vec2 f = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // the map is drawn in chunky screen blocks while it is far away; uBlock falls to 1 as you fly in
  float MB = uMap > 0.001 && uStyle < 0.5 ? max(uBlock, 1.0) : 1.0;
  vec2 mcell = floor(f / MB);
  vec2 fm = MB > 1.0 ? (mcell + 0.5) * MB : f;
  vec2 d = (fm - uRes * 0.5) / uZoom;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 m = uW + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  vec2 gx = vec2(c, s) / uZoom * MB, gy = vec2(-s, c) / uZoom * MB;
  vec2 D = vec2(uSide * 0.5);
  vec2 w = m;
  float cdist = length(m - D) - uR;
  bool land = cdist <= 0.0;
  if (uMap > 0.001) land = locate(m, D, w, cdist) >= 0;
  vec2 rel = w - D;
  float r = length(rel);

  // space: sparse twinkling pixel stars
  vec2 sp = floor(f / 2.0);
  float st = step(0.9982, hash(sp)) * (0.45 + 0.55 * sin(uTime * 1.7 + hash(sp + 7.0) * 40.0));
  vec3 bg = vec3(0.027, 0.024, 0.047) + st * vec3(0.75, 0.78, 1.0);

  // far view. uStyle > 0 snaps it to chunky screen blocks so the planet reads as pixel art
  float B = max(uBlock, 1.0);
  bool px = uStyle > 0.5;
  vec2 cellp = px ? floor(f / B) : floor(f / 2.0);
  vec2 fw = w; vec2 frel = rel; float fr = r;
  vec4 ov;
  if (px) {
    vec2 dq = ((cellp + 0.5) * B - uRes * 0.5) / uZoom;
    fw = uW + vec2(c * dq.x - s * dq.y, s * dq.x + c * dq.y);
    frel = fw - D; fr = length(frel);
    ov = textureLod(uOv, fw / uSide, log2(max(B / uZoom, 1.0)));
    ov = fr < uR ? vec4(ov.rgb / max(ov.a, 0.2), 1.0) : vec4(0.0);
  } else {
    // overview stores rgb=0 outside the disc, so its mips are premultiplied
    ov = textureGrad(uOv, w / uSide, gx / uSide, gy / uSide);
    if (!land) ov = vec4(0.0);
  }
  vec3 far = bg * (1.0 - ov.a) + ov.rgb;
  float step1 = B / uZoom;  // one block in world units

  float sph = uShade * (1.0 - uMap);
  if (sph > 0.0 && fr < uR && land) {
    vec2 q = vec2(c * frel.x + s * frel.y, -s * frel.x + c * frel.y) / uR;  // screen-space offset
    vec3 nrm = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
    float lam = clamp(dot(nrm, normalize(vec3(-0.55, -0.6, 0.75))), 0.0, 1.0);
    float lv;
    if (uStyle > 7.5) {
      lv = 0.75;  // sticker: no shading at all
    } else if (uStyle > 4.5 && uStyle < 5.5) {
      lv = lam < 0.3 ? 0.2 : (lam < 0.62 ? 0.62 : 1.0);
    } else if (uStyle > 2.5 && uStyle < 3.5) {
      // cel: three flat tones and a hard highlight
      lv = lam < 0.22 ? 0.12 : (lam < 0.55 ? 0.55 : 1.0);
    } else if (px) {
      lv = floor(lam * 4.0 + bayer4(cellp)) / 4.0;
    } else {
      lv = floor(lam * 5.0 + bayer4(cellp)) / 5.0;
    }
    far *= mix(1.0, 0.42 + 0.78 * lv, sph * 0.75);
    float lum = dot(far, vec3(0.299, 0.587, 0.114));
    far = max(vec3(0.0), mix(vec3(lum), far, 1.0 + 0.35 * sph));
    if (uStyle > 0.5 && uStyle < 1.5) far = floor(far * 7.0 + 0.5) / 7.0;
    if (uStyle > 1.5 && uStyle < 2.5) far = floor(far * 1.25 * 3.0 + bayer4(cellp)) / 3.0;
    if (uStyle > 2.5 && uStyle < 3.5) {
      far = floor(far * 5.0 + 0.5) / 5.0;
      if (lam > 0.965) far += vec3(0.28);
    }
    if (uStyle > 4.5 && uStyle < 5.5) {
      // one 56-pixel sprite in a fixed 16-colour palette
      far = nearest16(clamp(far * 1.25 + (bayer4(cellp) - 0.5) * 0.12, 0.0, 1.0));
      if (fr > uR - step1 * 1.1) far = PICO[1] * 0.6;
    }
    if (uStyle > 5.5 && uStyle < 6.5) {
      // tiles: every block gets a lit top-left edge and a shaded bottom-right one
      far = floor(far * 1.15 * 6.0 + 0.5) / 6.0;
      vec2 ip = fract(f / B) * B;
      if (ip.x < 1.0 || ip.y < 1.0) far = far * 1.35 + 0.05;
      else if (ip.x > B - 1.0 || ip.y > B - 1.0) far *= 0.5;
    }
    if (uStyle > 6.5 && uStyle < 7.5) {
      // 1-bit: brightness becomes dot density, hue is the only colour left
      float l1 = dot(far, vec3(0.299, 0.587, 0.114));
      float mx = max(far.r, max(far.g, far.b));
      vec3 ink = mx > 0.02 ? far / mx : vec3(1.0);
      far = step(bayer4(cellp), l1 * 1.7) > 0.5 ? mix(vec3(1.0), ink, 0.8) : vec3(0.04, 0.035, 0.09);
    }
    if (uStyle > 7.5) {
      far = floor(far * 1.2 * 5.0 + 0.5) / 5.0;
      if (fr > uR - step1 * 2.0) far = vec3(0.96, 0.93, 0.85);
    }
    // sprite outline: one dark block around the silhouette
    if (px && uStyle < 3.5 && fr > uR - step1 * 1.2) far *= 0.22;
  }
  if (!px) {
    // atmosphere: the rim colour bleeds out into space
    if (r > uR * 0.985 && uMap < 0.999) {
      vec3 rim = textureLod(uOv, (D + rel / r * uR * 0.94) / uSide, 4.0).rgb * (1.0 - uMap) * (1.0 - uMap);
      float k = exp(-max(r - uR, 0.0) / (uR * 0.07)) * smoothstep(uR * 0.985, uR * 1.004, r);
      float band = floor(k * 6.0 + bayer4(floor(f / 3.0)) * 0.9) / 6.0;
      far += rim * band * 0.75;
    }
  } else if (fr >= uR) {
    vec4 rs = textureLod(uOv, (D + frel / fr * uR * 0.9) / uSide, 5.0);
    vec3 rim = rs.rgb / max(rs.a, 0.2);
    float n = (fr - uR) / step1;  // blocks away from the edge
    if (uStyle < 1.5) {
      // two hard halo steps, the outer one checkered
      if (n < 2.0) far += rim * 0.34 * uShade;
      else if (n < 5.0 && mod(cellp.x + cellp.y, 2.0) < 0.5) far += rim * 0.22 * uShade;
    } else if (uStyle < 2.5) {
      float k = exp(-n / 5.0);
      far += rim * step(bayer4(cellp), k * 0.9) * 0.5 * uShade;
    } else if (uStyle < 3.5) {
      // no glow: loose pixels drifting off the rim
      float k = exp(-n / 7.0);
      far += rim * step(1.0 - k * 0.28, hash(cellp)) * 0.9 * uShade;
    } else if (uStyle < 4.5) {
      float k = exp(-n / 4.0);
      far += rim * floor(k * 3.0 + 0.3) / 3.0 * 0.4 * uShade;
    } else if (uStyle > 7.5) {
      // sticker: a hard drop shadow, down and to the right
      if (length(frel - vec2(c * 2.0 - s * 2.0, s * 2.0 + c * 2.0) * step1) < uR) far = vec3(0.0);
    }
  }
  if (uStyle > 3.5 && uStyle < 4.5) {
    // LED matrix: every block is a lamp with a dark gap
    vec2 lp = abs(fract(f / B) - 0.5);
    float lamp = step(max(lp.x, lp.y), 0.36);
    far = mix(far * 0.1 + vec3(0.012), far * 1.2, lamp);
  }

  if (uMap > 0.001 && uStyle < 0.5) {
    float st = MB / uZoom;  // one block in cells
    if (land) {
      // far away the land is flat terrain colour in stepped bands; the real cells take over as you approach
      vec4 sm = textureLod(uOv, w / uSide, clamp(log2(max(st, 1.0)) + 2.5 * uShade, 0.0, 6.0));
      vec3 base = sm.rgb / max(sm.a, 0.4);
      float lumb = dot(base, vec3(0.299, 0.587, 0.114));
      base = mix(vec3(lumb), base, 1.75) * 1.28;
      base = floor(clamp(base, 0.0, 1.0) * 8.0 + 0.5) / 8.0;
      float t = floor(clamp(-cdist / (uR * 0.06), 0.0, 3.0));
      base *= 0.84 + 0.1 * t;
      if (cdist > -st * 1.1) base = vec3(0.04, 0.05, 0.13);
      far = mix(far, base, uMap * uShade);
    } else {
      // beaches of uneven width give the cut pieces capes and bays; a few sand islets dot the open sea
      float cape = 0.5 + 0.5 * sin(m.x * 0.009 + sin(m.y * 0.007) * 2.2);
      float bw = uR * (0.018 + 0.1 * cape * cape) * uMap;
      float isl = sin(m.x * 0.013 + 1.7) * sin(m.y * 0.016 + 0.4) + 0.5 * sin((m.x + m.y) * 0.031);
      vec3 sea;
      if (cdist < bw) {
        sea = cdist > bw - st * 1.1 ? vec3(0.72, 0.62, 0.40) : (cdist < bw * 0.45 && cape > 0.6 ? vec3(0.62, 0.74, 0.42) : vec3(0.90, 0.81, 0.56));
      } else if (cdist > bw + uR * 0.12 && isl > 1.3 && uMap > 0.9) {
        sea = isl > 1.37 ? vec3(0.45, 0.68, 0.40) : vec3(0.90, 0.81, 0.56);
      } else {
        float dd = (cdist - bw) / (uR * 0.028);
        sea = mix(vec3(0.20, 0.50, 0.70), vec3(0.055, 0.13, 0.30), min(1.0, floor(dd) / 4.0));
        float tick = floor(uTime * 2.2);
        if (dd < 1.0 && mod(mcell.x + mcell.y + tick, 5.0) < 2.0) sea = vec3(0.91, 0.96, 1.0);
        else if (dd > 3.0 && hash(vec2(floor(mcell.x / 2.0), mcell.y)) > 0.975 && mod(mcell.x + tick, 7.0) < 3.0) sea *= 1.5;
        if (mod(mcell.x + mcell.y, 2.0) < 1.0) sea *= 0.94;
      }
      far = mix(far, sea, uMap);
    }
  }

  vec3 col = far;
  if (uM1 > 0.0 && land) {
    ivec2 ci = ivec2(floor(w));
    vec4 cell = (ci.x >= 0 && ci.y >= 0 && ci.x < int(uSide) && ci.y < int(uSide)) ? texelFetch(uOv, ci, 0) : vec4(0.0);
    vec3 tint = bg * (1.0 - cell.a * 0.4) + cell.rgb * 0.16;
    vec4 s1 = lvl(uP1, uA1, 128.0, uN.x, w, gx, gy);
    vec4 spr = s1.a < 0.0 ? cell : vec4(s1.rgb * s1.a, s1.a);
    if (uM2 > 0.0) {
      vec4 s2 = lvl(uP2, uA2, 32.0, uN.y, w, gx, gy);
      if (s2.a >= 0.0) spr = mix(spr, s2, uM2);
    }
    vec3 det = tint * (1.0 - spr.a) + spr.rgb;
    col = mix(far, det, uM1);
  }
  if (uCellGrid > 0.0 && land) {
    vec2 fc = fract(w);
    float px = 1.0 / uZoom;
    float l = max(step(fc.x, px), step(fc.y, px));
    col = mix(col, col * 0.35, l * uCellGrid);
  }
  if (uGrid > 0.0 && land) {
    vec2 fp = fract(w * 16.0);
    float px = 16.0 / uZoom;
    float l = max(step(fp.x, px), step(fp.y, px));
    col = mix(col, col * 0.62 + vec3(0.03), l * uGrid * 0.6);
  }
  col *= 1.0 - uDim;
  vec2 vq = f / uRes - 0.5;
  col *= 1.0 - dot(vq, vq) * 0.8;
  o = vec4(col, 1.0);
}`

// far-view look: 0 smooth, 1 mosaic, 2 dither, 3 cel, 4 LED. `?ring=n` previews one.
const RING_BLOCKS = [1, 6, 4, 5, 8, -56, 12, 3, 6]
const ringParam = Number(new URLSearchParams(location.search).get('ring') ?? 0)
const RING = { style: ringParam >= 0 && ringParam <= 8 ? Math.floor(ringParam) : 0, block: 1 }
RING.block = RING_BLOCKS[RING.style]

const HIT_VERT = `#version 300 es
uniform vec2 uRes;
uniform vec2 uW;
uniform float uZoom;
uniform float uAngle;
uniform float uR;
uniform float uSide;
uniform float uMap;      // 0 = one planet, 1 = continents pushed apart into a world map
uniform vec4 uSec[7];    // per colour continent: mid angle, half width, offset x, offset y
uniform float uRc;       // radius of the grey core island
float wobA(float r) { return 0.075 * sin(r * 0.027) + 0.04 * sin(r * 0.011 + 2.0); }
float wobR(float a) { return uR * (0.045 * sin(a * 5.0) + 0.022 * sin(a * 11.0 + 1.0) + 0.012 * sin(a * 23.0)); }
// signed distance in cells from disc point p (relative to the centre) to piece k; <= 0 is inside
float pieceDist(vec2 p, int k) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float rc = uRc + wobR(a);
  if (k == 0) return r - rc;
  vec4 sc = uSec[k - 1];
  float da = mod(a + wobA(r) - sc.x + 3.14159265, 6.2831853) - 3.14159265;
  return max(max((abs(da) - sc.y) * r, r - uR), rc - r);
}
// which piece a map point falls on (-1 = sea); w = the disc point it shows
int locate(vec2 m, vec2 D, out vec2 w, out float dist) {
  dist = 1e9;
  int hit = -1;
  w = m;
  for (int k = 0; k < 8; k++) {
    vec2 off = k == 0 ? vec2(0.0) : uSec[k - 1].zw * uMap;
    vec2 p = m - D - off;
    float d = pieceDist(p, k);
    if (d <= 0.0 && hit < 0) { hit = k; w = p + D; }
    dist = min(dist, d);
  }
  return hit;
}
in vec2 aCorner;
in vec2 aCell;
out vec2 vUv;
out float vPhase;
void main() {
  float size = max(1.0, 3.0 / uZoom) * (uZoom > 10.0 ? 1.2 : 1.0);
  vec2 w = aCell + 0.5 + (aCorner - 0.5) * size;
  if (uMap > 0.001) {
    vec2 pc = aCell + 0.5 - vec2(uSide * 0.5);
    for (int k = 1; k < 8; k++) if (pieceDist(pc, k) <= 0.0) { w += uSec[k - 1].zw * uMap; break; }
  }
  vec2 d = w - uW;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 sp = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) * uZoom + uRes * 0.5;
  gl_Position = vec4(sp.x / uRes.x * 2.0 - 1.0, 1.0 - sp.y / uRes.y * 2.0, 0.0, 1.0);
  vUv = aCorner;
  vPhase = fract(sin(dot(aCell, vec2(12.9898, 78.233))) * 43758.5453);
}`

const HIT_FRAG = `#version 300 es
precision highp float;
uniform float uZoom;
uniform float uTime;
in vec2 vUv;
in float vPhase;
out vec4 o;
void main() {
  float pulse = 0.65 + 0.35 * sin(uTime * 4.0 + vPhase * 6.283);
  vec3 gold = vec3(1.0, 0.8, 0.3);
  if (uZoom > 10.0) {
    vec2 e = min(vUv, 1.0 - vUv);
    float b = 2.0 / (uZoom * 1.2);
    if (min(e.x, e.y) > b) discard;
    o = vec4(gold, 0.95);
  } else {
    o = vec4(gold * pulse, 0.9);
  }
}`

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const fmt = (n: number) => n.toLocaleString('en-US')

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
    gl.attachShader(prog, sh)
  }
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
  return prog
}

let inflight = 0
const MAX_INFLIGHT = 6

/** one streamed level: a texture array of tile slots + its page table */
class TileLevel {
  arr: WebGLTexture
  pt: WebGLTexture
  owner: Int32Array
  used: Float64Array
  slotOf: Int16Array
  ptData: Uint8Array
  pending = new Set<number>()
  missing = new Set<number>()
  dirty = false
  loaded = 0
  private gl: WebGL2RenderingContext
  level: 1 | 2
  m: LevelMeta
  slots: number
  private side: number
  private R: number

  constructor(gl: WebGL2RenderingContext, level: 1 | 2, m: LevelMeta, slots: number, side: number, R: number) {
    this.gl = gl
    this.level = level
    this.m = m
    this.slots = slots
    this.side = side
    this.R = R
    const size = m.cells * m.px
    this.arr = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(size) + 1, gl.RGBA8, size, size, slots)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.pt = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.pt)
    this.ptData = new Uint8Array(m.tiles * m.tiles)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, m.tiles, m.tiles, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.ptData)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    this.owner = new Int32Array(slots).fill(-1)
    this.used = new Float64Array(slots)
    this.slotOf = new Int16Array(m.tiles * m.tiles).fill(-1)
  }

  /** tiles that intersect the disc at all (corners of the square are empty) */
  empty(tx: number, ty: number) {
    const n = this.m.cells
    const c = this.side / 2
    const nx = Math.max(tx * n, Math.min(c, (tx + 1) * n))
    const ny = Math.max(ty * n, Math.min(c, (ty + 1) * n))
    return Math.hypot(nx - c, ny - c) > this.R + 2
  }

  /** visible tiles, nearest first, within the slot budget */
  want(minX: number, minY: number, maxX: number, maxY: number, cx: number, cy: number) {
    const n = this.m.cells
    const t = this.m.tiles
    const x0 = Math.max(0, Math.floor(minX / n) - 1)
    const y0 = Math.max(0, Math.floor(minY / n) - 1)
    const x1 = Math.min(t - 1, Math.floor(maxX / n) + 1)
    const y1 = Math.min(t - 1, Math.floor(maxY / n) + 1)
    const out: { i: number; d: number; tx: number; ty: number }[] = []
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (this.empty(tx, ty)) continue
        out.push({ i: ty * t + tx, tx, ty, d: Math.hypot((tx + 0.5) * n - cx, (ty + 0.5) * n - cy) })
      }
    out.sort((a, b) => a.d - b.d)
    return out.slice(0, this.slots - 4)
  }

  update(list: { i: number; tx: number; ty: number }[], now: number) {
    for (const w of list) {
      const s = this.slotOf[w.i]
      if (s >= 0) {
        this.used[s] = now
        continue
      }
      if (this.pending.has(w.i) || this.missing.has(w.i) || inflight >= MAX_INFLIGHT) continue
      this.pending.add(w.i)
      inflight++
      tileBitmap(this.level, w.tx, w.ty).then((bm) => {
        inflight--
        this.pending.delete(w.i)
        if (!bm) {
          this.missing.add(w.i)
          return
        }
        this.place(w.i, bm, now)
        if (this.level === 1) bm.close()
      })
    }
  }

  private place(i: number, bm: ImageBitmap, now: number) {
    if (this.slotOf[i] >= 0) return
    let slot = -1
    let oldest = Infinity
    for (let s = 0; s < this.slots; s++) {
      if (this.owner[s] < 0) {
        slot = s
        break
      }
      if (this.used[s] < oldest && this.used[s] < now) {
        oldest = this.used[s]
        slot = s
      }
    }
    if (slot < 0) return
    const gl = this.gl
    const prev = this.owner[slot]
    if (prev >= 0) {
      this.slotOf[prev] = -1
      this.ptData[prev] = 0
    } else this.loaded++
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, bm.width, bm.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, bm)
    this.owner[slot] = i
    this.slotOf[i] = slot
    this.used[slot] = performance.now()
    this.ptData[i] = slot + 1
    this.dirty = true
  }

  flush() {
    if (!this.dirty) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
    gl.bindTexture(gl.TEXTURE_2D, this.pt)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.m.tiles, this.m.tiles, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.ptData)
    this.dirty = false
  }
}

export async function createHero(el: HTMLElement, hooks: HeroHooks): Promise<Chapter> {
  const meta: AtlasMeta = await loadMeta()
  const ovBlob = await fetch('/atlas/overview.png').then((r) => r.blob())
  const ovBm = await createImageBitmap(ovBlob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const SIDE = meta.side
  const R = Math.sqrt(meta.count / Math.PI)
  const D = SIDE / 2

  const ovCanvas = document.createElement('canvas')
  ovCanvas.width = ovCanvas.height = SIDE
  const octx = ovCanvas.getContext('2d', { willReadFrequently: true })!
  octx.drawImage(ovBm, 0, 0)
  const overview: Overview = { side: SIDE, px: octx.getImageData(0, 0, SIDE, SIDE).data }

  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!
  const canvas = $<HTMLCanvasElement>('.hero-gl')
  const reticle = $('.hero-reticle')
  const hoverBox = $('.hero-hover')
  const tip = $('.hero-tip')
  const input = $<HTMLInputElement>('.hero-search input')
  const form = $<HTMLFormElement>('.hero-search')
  const status = $('.hero-status')
  const subjectsEl = $('.hero-subjects')
  const tray = $('.hero-tray')
  const suggest = $('.hero-suggest')
  const stepEl = $('.hero-step')
  const card = $('.hero-card')
  const cardCanvas = card.querySelector('canvas')!
  const cardCap = card.querySelector<HTMLElement>('.cap')!
  const cardMeta = card.querySelector<HTMLElement>('.meta')!
  const lodItems = [...el.querySelectorAll<HTMLElement>('.hero-lod li')]
  const tech = $('.hero-tech')
  const hint = $('.hero-hint')
  const intro = $('.hero-intro')
  const coarse = matchMedia('(pointer: coarse)')
  let touch = coarse.matches
  coarse.addEventListener('change', () => (touch = coarse.matches))

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  if (!gl) throw new Error('需要 WebGL2')

  // ---- GL setup ---------------------------------------------------------------
  const prog = compile(gl, VERT, FRAG)
  const hitProg = compile(gl, HIT_VERT, HIT_FRAG)
  const vaoMain = gl.createVertexArray()!
  gl.bindVertexArray(vaoMain)
  const tri = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, tri)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const pLoc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(pLoc)
  gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0)

  const vaoHit = gl.createVertexArray()!
  gl.bindVertexArray(vaoHit)
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const cLoc = gl.getAttribLocation(hitProg, 'aCorner')
  gl.enableVertexAttribArray(cLoc)
  gl.vertexAttribPointer(cLoc, 2, gl.FLOAT, false, 0, 0)
  const hitBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, hitBuf)
  const hLoc = gl.getAttribLocation(hitProg, 'aCell')
  gl.enableVertexAttribArray(hLoc)
  gl.vertexAttribPointer(hLoc, 2, gl.FLOAT, false, 0, 0)
  gl.vertexAttribDivisor(hLoc, 1)
  gl.bindVertexArray(null)
  let hitCount = 0

  const ovTex = gl.createTexture()!
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, ovTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ovBm)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.generateMipmap(gl.TEXTURE_2D)
  ovBm.close()

  const L1 = new TileLevel(gl, 1, meta.l1, 56, SIDE, R)
  const L2 = new TileLevel(gl, 2, meta.l2, 64, SIDE, R)

  gl.useProgram(prog)
  const U = (n: string) => gl.getUniformLocation(prog, n)
  gl.uniform1i(U('uOv'), 0)
  gl.uniform1i(U('uA1'), 1)
  gl.uniform1i(U('uA2'), 2)
  gl.uniform1i(U('uP1'), 3)
  gl.uniform1i(U('uP2'), 4)
  gl.uniform1f(U('uSide'), SIDE)
  gl.uniform1f(U('uR'), R)
  gl.uniform2f(U('uN'), meta.l1.tiles, meta.l2.tiles)
  const u = Object.fromEntries(
    ['uRes', 'uW', 'uZoom', 'uAngle', 'uTime', 'uDim', 'uM1', 'uM2', 'uGrid', 'uCellGrid', 'uShade', 'uStyle', 'uBlock', 'uMap', 'uRc'].map((n) => [n, U(n)]),
  )
  gl.useProgram(hitProg)
  const H = (n: string) => gl.getUniformLocation(hitProg, n)
  const hu = Object.fromEntries(['uRes', 'uW', 'uZoom', 'uAngle', 'uTime', 'uMap', 'uRc'].map((n) => [n, H(n)]))
  gl.uniform1f(H('uR'), R)
  gl.uniform1f(H('uSide'), SIDE)

  // ---- the world map: the same disc, cut along its hue borders and pushed apart ------------
  // angles are measured on the disc (y down); the cuts sit where the dominant hue changes
  const DEG = Math.PI / 180
  const RC = R * 0.62
  const LANDS = [
    { name: '灰烬之心', note: '灰与黑白', a0: 0, a1: 0, push: 0 },
    { name: '赤焰群岛', note: '红', a0: 330, a1: 400, push: 0.5 },
    { name: '赤陶荒原', note: '红棕', a0: 40, a1: 130, push: 0.44 },
    { name: '琥珀荒原', note: '橙', a0: 130, a1: 205, push: 0.47 },
    { name: '金穗平原', note: '黄', a0: 205, a1: 232, push: 0.6 },
    { name: '翡翠森林', note: '绿与青', a0: 232, a1: 258, push: 0.5 },
    { name: '蓝晶冻原', note: '蓝', a0: 258, a1: 312, push: 0.46 },
    { name: '紫雾沼泽', note: '紫与粉', a0: 312, a1: 330, push: 0.62 },
  ].map((l, k) => {
    const mid = ((l.a0 + l.a1) / 2) * DEG
    const half = ((l.a1 - l.a0) / 2) * DEG
    return { ...l, k, mid, half, ox: k ? Math.cos(mid) * R * l.push : 0, oy: k ? Math.sin(mid) * R * l.push : 0 }
  })
  const secData = new Float32Array(28)
  LANDS.slice(1).forEach((l, i) => secData.set([l.mid, l.half, l.ox, l.oy], i * 4))
  for (const pr of [prog, hitProg]) {
    gl.useProgram(pr)
    gl.uniform4fv(gl.getUniformLocation(pr, 'uSec'), secData)
    gl.uniform1f(gl.getUniformLocation(pr, 'uRc'), RC)
  }
  /** how far the continents are pushed apart right now: 0 planet, 1 map */
  let mapE = 0
  let homed = false
  const MAP_ON = RING.style === 0
  const wobA = (r: number) => 0.075 * Math.sin(r * 0.027) + 0.04 * Math.sin(r * 0.011 + 2.0)
  const wobR = (a: number) => R * (0.045 * Math.sin(a * 5.0) + 0.022 * Math.sin(a * 11.0 + 1.0) + 0.012 * Math.sin(a * 23.0))
  // mirrors pieceDist() in the shader
  function pieceDist(px: number, py: number, k: number) {
    const r = Math.hypot(px, py)
    const a = Math.atan2(py, px)
    const rc = RC + wobR(a)
    if (k === 0) return r - rc
    const l = LANDS[k]
    const da = ((((a + wobA(r) - l.mid + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    return Math.max((Math.abs(da) - l.half) * r, r - R, rc - r)
  }
  /** the piece a disc point belongs to (-1 outside the disc) */
  function pieceOf(wx: number, wy: number) {
    for (let k = 0; k < 8; k++) if (pieceDist(wx - D, wy - D, k) <= 0) return k
    return -1
  }
  /** map point → disc point, or null over the sea */
  function discOf(mx: number, my: number, e = mapE): [number, number] | null {
    if (e < 0.001) return [mx, my]
    for (let k = 0; k < 8; k++) {
      const x = mx - LANDS[k].ox * e
      const y = my - LANDS[k].oy * e
      if (pieceDist(x - D, y - D, k) <= 0) return [x, y]
    }
    return null
  }
  function mapOf(wx: number, wy: number, e = mapE): [number, number] {
    const k = e < 0.001 ? -1 : pieceOf(wx, wy)
    return k < 1 ? [wx, wy] : [wx + LANDS[k].ox * e, wy + LANDS[k].oy * e]
  }
  /** the land nearest to a map point, for streaming tiles while the centre is over water */
  function nearestLand(mx: number, my: number) {
    let best = 0
    let bd = Infinity
    for (let k = 0; k < 8; k++) {
      const d = pieceDist(mx - LANDS[k].ox * mapE - D, my - LANDS[k].oy * mapE - D, k)
      if (d < bd) {
        bd = d
        best = k
      }
    }
    return best
  }

  // ---- camera ----------------------------------------------------------------------
  /** world point at the screen centre, css px per cell, view rotation */
  const cam = { x: D, y: D, z: 1, a: MAP_ON ? 0 : 0.9 }
  let tgtZ = 1
  let anchor: { sx: number; sy: number; wx: number; wy: number } | null = null
  let flight: { t0: number; dur: number; f: (t: number) => [number, number, number]; a0: number; done?: () => void } | null = null
  const vel = { x: 0, y: 0, a: 0 }
  let W = 1
  let Hh = 1
  /** the planet filling the view: the yardstick for level-of-detail thresholds */
  const zFit = () => (Math.min(W, Hh) * 0.86) / (2 * R)
  /** the whole world map in view: where the page opens */
  const zHome = () => (MAP_ON ? (W < 760 ? W * 1.04 : Math.min(Math.min(W, Hh) * 0.98, W * 0.64)) / (2 * R * 1.68) : zFit())
  /** furthest out: the continents have closed back into one planet */
  const zMin = () => (MAP_ON ? zHome() * 0.62 : zFit())
  const mapAt = (z: number) => (MAP_ON ? smooth(zHome() * 0.7, zHome() * 0.97, z) : 0)
  const zMax = () => Math.min(W, Hh) * 0.5
  let lastInput = 0
  let wasAtMax = false

  const toMapPt = (sx: number, sy: number): [number, number] => {
    const dx = (sx - W / 2) / cam.z
    const dy = (sy - Hh / 2) / cam.z
    const c = Math.cos(cam.a)
    const s = Math.sin(cam.a)
    return [cam.x + c * dx - s * dy, cam.y + s * dx + c * dy]
  }
  const mapToScreen = (wx: number, wy: number): [number, number] => {
    const dx = wx - cam.x
    const dy = wy - cam.y
    const c = Math.cos(cam.a)
    const s = Math.sin(cam.a)
    return [(c * dx + s * dy) * cam.z + W / 2, (-s * dx + c * dy) * cam.z + Hh / 2]
  }
  /** screen → disc cell coordinates; far off the disc when the point is over the sea */
  const toWorld = (sx: number, sy: number): [number, number] => discOf(...toMapPt(sx, sy)) ?? [-1e7, -1e7]
  const toScreen = (wx: number, wy: number): [number, number] => mapToScreen(...mapOf(wx, wy))
  /** rotate the planet on screen by d radians around the disc centre */
  const rotatePlanet = (d: number) => {
    if (mapE > 0.02) return
    const [sx, sy] = mapToScreen(D, D)
    cam.a -= d
    const [wx, wy] = toMapPt(sx, sy)
    cam.x += D - wx
    cam.y += D - wy
  }
  const clampCam = () => {
    const dx = cam.x - D
    const dy = cam.y - D
    const r = Math.hypot(dx, dy)
    const lim = R * (1 + 0.7 * mapE)
    if (r > lim) {
      cam.x = D + (dx / r) * lim
      cam.y = D + (dy / r) * lim
    }
  }

  function zoomAt(factor: number, sx: number, sy: number) {
    const nz = Math.min(zMax(), Math.max(zMin(), tgtZ * factor))
    if (!anchor || Math.abs(anchor.sx - sx) > 2 || Math.abs(anchor.sy - sy) > 2) {
      const [wx, wy] = toMapPt(sx, sy)
      anchor = { sx, sy, wx, wy }
    }
    tgtZ = nz
    flight = null
    lastInput = performance.now()
  }

  /** van Wijk & Nuij smooth zoom-and-pan */
  function flyTo(wx: number, wy: number, z1: number, done?: () => void, raw = false) {
    z1 = Math.min(zMax(), Math.max(zMin(), z1))
    // callers pass disc cells; the camera lives on the map as it will be laid out at the target zoom
    if (!raw) [wx, wy] = mapOf(wx, wy, mapAt(z1))
    anchor = null
    vel.x = vel.y = vel.a = 0
    if (reducedMotion) {
      cam.x = wx
      cam.y = wy
      cam.z = tgtZ = z1
      cam.a = Math.round(cam.a / (2 * Math.PI)) * 2 * Math.PI
      done?.()
      return
    }
    const rho = 1.42
    const ux0 = cam.x
    const uy0 = cam.y
    const w0 = W / cam.z
    const w1 = W / z1
    const dx = wx - ux0
    const dy = wy - uy0
    const d2 = dx * dx + dy * dy
    const d1 = Math.sqrt(d2)
    let S: number
    let f: (t: number) => [number, number, number]
    if (d1 < 1e-6) {
      S = Math.log(w1 / w0) / rho
      f = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)]
    } else {
      const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * d2) / (2 * w0 * rho * rho * d1)
      const b1 = (w1 * w1 - w0 * w0 - rho ** 4 * d2) / (2 * w1 * rho * rho * d1)
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
      S = (r1 - r0) / rho
      f = (t) => {
        const s = t * S
        const ch = Math.cosh(r0)
        const uu = (w0 / (rho * rho * d1)) * (ch * Math.tanh(rho * s + r0) - Math.sinh(r0))
        return [ux0 + uu * dx, uy0 + uu * dy, (w0 * ch) / Math.cosh(rho * s + r0)]
      }
    }
    const dur = Math.min(2600, Math.max(650, Math.abs(S) * 520))
    flight = { t0: performance.now(), dur, f, a0: cam.a, done }
    sound.whoosh(dur / 1000, z1 > cam.z)
  }

  // ---- legend, breadcrumb and place names ---------------------------------------------------
  const panelEl = $('.hero-panel')
  const crumb = $('.hero-crumb')
  const legendEl = $('.hero-legend')
  const labelsEl = $('.hero-labels')
  /** where each land's name sits, in disc cells, and a representative colour sampled from the overview */
  const landInfo = LANDS.map((l) => {
    const cx = l.k ? D + Math.cos(l.mid) * R * 0.82 : D
    const cy = l.k ? D + Math.sin(l.mid) * R * 0.82 : D
    let r = 0, g = 0, b = 0, n = 0, cells = 0
    for (let y = 4; y < SIDE; y += 8)
      for (let x = 4; x < SIDE; x += 8) {
        if (pieceDist(x - D, y - D, l.k) > 0) continue
        cells += 64
        const o = (y * SIDE + x) * 4
        if (!overview.px[o + 3]) continue
        r += overview.px[o]; g += overview.px[o + 1]; b += overview.px[o + 2]; n++
      }
    const m = (r + g + b) / 3 / Math.max(1, n)
    // push the average away from grey so the swatch reads as the land's hue
    const boost = (v: number) => Math.round(Math.max(0, Math.min(255, (m + (v / Math.max(1, n) - m) * 1.9) * 1.35)))
    return { cx, cy, cells, color: l.k ? `rgb(${boost(r)},${boost(g)},${boost(b)})` : '#a9a7b2' }
  })
  const flyLand = (k: number) => {
    deselect()
    flyTo(landInfo[k].cx, landInfo[k].cy, zHome() * (k ? 2.6 : 1.9))
    sound.click()
  }
  LANDS.forEach((l, k) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.title = `${l.name} · ${l.note}`
    b.innerHTML = `<i style="background:${landInfo[k].color}"></i><span>${l.name}</span><small>${Math.round(landInfo[k].cells / 1e4)} 万</small>`
    b.addEventListener('click', () => flyLand(k))
    legendEl.append(b)
  })
  const labels = LANDS.map((l, k) => {
    const sp = document.createElement('span')
    sp.style.color = landInfo[k].color
    sp.innerHTML = `${l.name}<small>${l.note} · ${Math.round(landInfo[k].cells / 1e4)} 万张</small>`
    labelsEl.append(sp)
    return sp
  })
  if (!MAP_ON) {
    legendEl.hidden = true
    labelsEl.hidden = true
  }
  crumb.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button')
    if (!t) return
    deselect()
    if (t.dataset.go === 'planet') goPlanet()
    else if (t.dataset.go === 'home') goHome()
    else flyLand(Number(t.dataset.go))
    sound.click()
  })
  $('.hero-logo').addEventListener('click', () => {
    deselect()
    goHome()
  })
  let crumbKey = ''

  /** on wide screens the map sits to the right of the title plate */
  const homeX = () => D - (MAP_ON && W > 900 ? (W * 0.14) / zHome() : 0)
  /** on phones the plate takes the top of the screen, so the map sits lower */
  const homeY = () => D - (MAP_ON && W < 760 ? (Hh * 0.2) / zHome() : 0)
  const goHome = () => flyTo(homeX(), homeY(), zHome(), undefined, true)
  const goPlanet = () => flyTo(D, D, zMin(), undefined, true)
  const cellXY = (cell: number): [number, number] => [(cell % SIDE) + 0.5, Math.floor(cell / SIDE) + 0.5]
  const flyToCell = (cell: number, z = 72) => {
    const [x, y] = cellXY(cell)
    flyTo(x, y, z, () => select(cell))
  }

  // ---- selection card ------------------------------------------------------------------
  let selected = -1
  let selInfo: CellInfo | null = null
  let selSprite: HTMLCanvasElement | null = null
  const cctx = cardCanvas.getContext('2d')!

  async function select(cell: number) {
    if (!Number.isFinite(cell) || cell < 0) return
    if (cell < 0) return
    const [x, y] = cellXY(cell)
    if (Math.hypot(x - D, y - D) > R) return
    selected = cell
    sound.select()
    card.hidden = false
    cardCap.textContent = '…'
    cardMeta.textContent = ''
    cctx.clearRect(0, 0, 16, 16)
    const [info, spr] = await Promise.all([cellInfo(cell), spriteCanvas(cell)])
    if (selected !== cell) return
    selInfo = info
    selSprite = spr
    if (spr) cctx.drawImage(spr, 0, 0)
    if (info) {
      cardCap.textContent = info.caption
      const zh = zhLabel(info.subject)
      cardMeta.innerHTML = `<b>${info.subject}</b>${zh ? ` · ${zh}` : ''}<br>格子 #${fmt(cell)} · 数据集 #${fmt(info.id)}`
    } else cardCap.textContent = '（空格子）'
  }
  function deselect() {
    selected = -1
    selInfo = null
    card.hidden = true
  }

  card.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (!act) return
    sound.click()
    if (act === 'close') deselect()
    if (act === 'workshop' && selSprite && selInfo) hooks.toWorkshop(selSprite, selInfo)
    if (act === 'same' && selInfo) {
      input.value = selInfo.subject
      runSearch(true)
    }
    if (act === 'png' && selSprite && selInfo) {
      const big = document.createElement('canvas')
      big.width = big.height = 256
      const b = big.getContext('2d')!
      b.imageSmoothingEnabled = false
      b.drawImage(selSprite, 0, 0, 256, 256)
      big.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `pixel-atlas-${selInfo!.id}-${selInfo!.subject.replace(/\W+/g, '-')}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      })
    }
  })

  // ---- search ----------------------------------------------------------------------------
  let tour: number[] = []
  let tourAt = -1
  let searchSeq = 0
  let indexLoaded = false

  function setHits(cells: Uint32Array | null) {
    const n = cells?.length ?? 0
    const data = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      data[i * 2] = cells![i] % SIDE
      data[i * 2 + 1] = Math.floor(cells![i] / SIDE)
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, hitBuf)
    gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
    hitCount = n
  }

  /** a few results that share tiles, so the tray costs few downloads */
  function pickTray(cells: Uint32Array, n = 12) {
    const per = new Map<number, number[]>()
    const t = meta.l2.cells
    for (const c of cells) {
      const key = Math.floor(Math.floor(c / SIDE) / t) * 1000 + Math.floor((c % SIDE) / t)
      const list = per.get(key)
      if (list) list.push(c)
      else per.set(key, [c])
    }
    const groups = [...per.values()].sort((a, b) => b.length - a.length)
    const out: number[] = []
    for (let round = 0; out.length < n && round < 6; round++)
      for (const g of groups.slice(0, 6)) {
        if (g[round] !== undefined && out.length < n) out.push(g[round])
      }
    return out
  }

  function renderTray(cells: number[]) {
    tray.replaceChildren()
    tour = cells
    tourAt = -1
    stepEl.hidden = cells.length < 2
    cells.forEach((cell, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tray-item'
      b.title = '飞过去'
      b.addEventListener('click', () => {
        tourAt = i
        flyToCell(cell)
      })
      b.addEventListener('pointerenter', () => sound.tick(1800 + i * 60))
      tray.append(b)
      spriteCanvas(cell).then((c) => c && b.append(c))
    })
  }

  async function runSearch(fly = false) {
    const q = input.value
    const seq = ++searchSeq
    el.classList.toggle('is-searching', !!q.trim())
    if (!q.trim()) {
      setHits(null)
      status.textContent = ''
      subjectsEl.replaceChildren()
      tray.replaceChildren()
      stepEl.hidden = true
      suggest.hidden = false
      return
    }
    suggest.hidden = true
    if (!indexLoaded) status.textContent = '载入索引（5.4 MB）…'
    const res = await search(q, overview)
    indexLoaded = true
    if (seq !== searchSeq || !res) return
    if (res.kind === 'color') {
      setHits(null)
      subjectsEl.replaceChildren()
      tray.replaceChildren()
      stepEl.hidden = true
      const cell = nearestColorCell(overview, res.rgb)
      status.innerHTML = `<i class="sw" style="background:rgb(${res.rgb.join(',')})"></i> 飞往最接近 ${res.label} 的色区`
      if (fly || res.label.startsWith('#')) flyToCell(cell, 40)
      return
    }
    if (res.kind === 'none') {
      setHits(null)
      subjectsEl.replaceChildren()
      tray.replaceChildren()
      stepEl.hidden = true
      status.textContent = `没找到「${q.trim()}」${res.english ? `（${res.english}）` : ''}，换个词试试`
      sound.nothing()
      return
    }
    setHits(res.cells)
    const label = res.color ? `${res.color.label}的「${res.english}」` : `「${q.trim()}」`
    status.innerHTML = `${label}命中 <b>${fmt(res.total)}</b> 张 · ${res.subjects.length} 个主题${res.total ? ' · 金点就是它们' : ''}`
    sound.results(res.total)
    subjectsEl.replaceChildren(
      ...res.subjects.slice(0, 6).map((s) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        const zh = zhLabel(s.name)
        b.innerHTML = `${s.name}${zh ? ` <span>${zh}</span>` : ''} <em>${fmt(s.count)}</em>`
        b.addEventListener('click', () => {
          input.value = s.name
          runSearch()
        })
        return b
      }),
    )
    renderTray(pickTray(res.cells))
    if (fly && tour.length) {
      tourAt = 0
      flyToCell(tour[0])
    }
  }

  let deb = 0
  input.addEventListener('input', () => {
    sound.key()
    clearTimeout(deb)
    deb = window.setTimeout(() => runSearch(false), 160)
  })
  input.addEventListener('focus', () => {
    loadIndex()
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    clearTimeout(deb)
    if (tour.length && input.value.trim()) step(1)
    else runSearch(true)
  })
  const step = (d: number) => {
    if (!tour.length) return
    tourAt = (tourAt + d + tour.length) % tour.length
    flyToCell(tour[tourAt])
    sound.click()
  }
  stepEl.querySelector('[data-step="-1"]')!.addEventListener('click', () => step(-1))
  stepEl.querySelector('[data-step="1"]')!.addEventListener('click', () => step(1))
  suggest.addEventListener('click', (e) => {
    const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q
    if (!q) return
    input.value = q
    runSearch(q.startsWith('#'))
  })
  $('.dice').addEventListener('click', () => {
    let cell = -1
    while (cell < 0) {
      const c = Math.floor(Math.random() * SIDE * SIDE)
      const [x, y] = cellXY(c)
      if (Math.hypot(x - D, y - D) < R - 1) cell = c
    }
    flyToCell(cell)
  })
  // zoom buttons: the same zoom as the wheel, around the screen centre
  el.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.zoom
      if (k === 'fit') {
        deselect()
        goHome()
      } else if (k === 'planet') {
        deselect()
        if (mapE > 0.5) goPlanet()
        else goHome()
      } else zoomAt(k === 'in' ? 2.2 : 1 / 2.2, W / 2, Hh / 2)
      sound.click()
    }),
  )
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('is-active') || e.target instanceof HTMLInputElement) return
    if (e.key === '+' || e.key === '=') zoomAt(1.8, W / 2, Hh / 2)
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.8, W / 2, Hh / 2)
    else if (e.key === '0') goHome()
    else if (e.key === 'q' || e.key === 'Q') rotatePlanet(-0.12)
    else if (e.key === 'e' || e.key === 'E') rotatePlanet(0.12)
  })

  // ---- pointer --------------------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>()
  let drag: { mode: 'rotate' | 'pan'; sx: number; sy: number; moved: boolean; last: number } | null = null
  let pinch: { d: number; mx: number; my: number; ang: number } | null = null
  let hoverCell = -1
  let mouse = { x: -1, y: -1, inside: false }
  let rotAcc = 0
  let capTimer = 0
  let capFor = -1

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e)
    pointers.set(e.pointerId, p)
    canvas.setPointerCapture(e.pointerId)
    flight = null
    anchor = null
    vel.x = vel.y = vel.a = 0
    lastInput = performance.now()
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) }
      drag = null
      return
    }
    const [cx0, cy0] = mapToScreen(D, D)
    const rDisc = R * cam.z
    const onRim = mapE < 0.02 && Math.hypot(p.x - cx0, p.y - cy0) > rDisc * 0.97 && Math.hypot(p.x - cx0, p.y - cy0) < rDisc * 1.35 + 30
    drag = { mode: e.shiftKey || e.button === 2 || onRim ? 'rotate' : 'pan', sx: p.x, sy: p.y, moved: false, last: performance.now() }
    canvas.classList.add('is-grabbing')
    canvas.classList.toggle('is-rotating', drag.mode === 'rotate')
  })

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e)
    mouse = { ...p, inside: true }
    const prev = pointers.get(e.pointerId)
    if (prev) pointers.set(e.pointerId, p)
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const [wx, wy] = toMapPt(pinch.mx, pinch.my)
      cam.z = tgtZ = Math.min(zMax(), Math.max(zMin(), cam.z * (d / pinch.d)))
      const [nx, ny] = toMapPt(mx, my)
      cam.x += wx - nx
      cam.y += wy - ny
      // two-finger twist turns the planet
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      let da = ang - pinch.ang
      if (da > Math.PI) da -= 2 * Math.PI
      if (da < -Math.PI) da += 2 * Math.PI
      if (cam.z < zFit() * 4) rotatePlanet(da)
      pinch = { d, mx, my, ang }
      return
    }
    if (drag && prev) {
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5) drag.moved = true
      if (!drag.moved) return
      const now = performance.now()
      const dt = Math.max(1, now - drag.last) / 16.7
      drag.last = now
      if (drag.mode === 'rotate') {
        const [cx, cy] = mapToScreen(D, D)
        const a0 = Math.atan2(prev.y - cy, prev.x - cx)
        const a1 = Math.atan2(p.y - cy, p.x - cx)
        let da = a1 - a0
        if (da > Math.PI) da -= 2 * Math.PI
        if (da < -Math.PI) da += 2 * Math.PI
        rotatePlanet(da)
        vel.a = da / dt
        rotAcc += Math.abs(da)
        if (rotAcc > 0.07) {
          rotAcc = 0
          sound.tick(1400 + Math.min(1600, Math.abs(vel.a) * 9000), 0.02)
        }
      } else {
        const c = Math.cos(cam.a)
        const s = Math.sin(cam.a)
        const wx = (c * dx - s * dy) / cam.z
        const wy = (s * dx + c * dy) / cam.z
        cam.x -= wx
        cam.y -= wy
        vel.x = -wx / dt
        vel.y = -wy / dt
      }
      lastInput = now
      return
    }
    {
      const [cx0, cy0] = mapToScreen(D, D)
      const dd = Math.hypot(p.x - cx0, p.y - cy0)
      canvas.classList.toggle('is-rim', mapE < 0.02 && dd > R * cam.z * 0.97 && dd < R * cam.z * 1.35 + 30)
    }
    updateHover()
  })

  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    canvas.classList.remove('is-grabbing', 'is-rotating')
    if (!drag) return
    const p = local(e)
    if (!drag.moved && e.type === 'pointerup' && e.button === 0) clickAt(p.x, p.y)
    if (performance.now() - drag.last > 80) vel.x = vel.y = vel.a = 0
    drag = null
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('pointerleave', () => {
    mouse.inside = false
    hoverCell = -1
  })

  function clickAt(sx: number, sy: number) {
    const [wx, wy] = toWorld(sx, sy)
    if (Math.hypot(wx - D, wy - D) > R) {
      deselect()
      return
    }
    const cell = Math.floor(wy) * SIDE + Math.floor(wx)
    if (cam.z < 8) flyTo(wx, wy, Math.max(9, cam.z * 4))
    else if (cell === selected) flyTo(Math.floor(wx) + 0.5, Math.floor(wy) + 0.5, zMax() * 0.9)
    else select(cell)
  }

  function updateHover() {
    if (!mouse.inside || cam.z < 10 || drag) {
      hoverCell = -1
      return
    }
    const [wx, wy] = toWorld(mouse.x, mouse.y)
    const cell = Math.hypot(wx - D, wy - D) < R ? Math.floor(wy) * SIDE + Math.floor(wx) : -1
    if (cell !== hoverCell) {
      hoverCell = cell
      if (cell >= 0 && cam.z > 24) sound.tick(2600, 0.008)
      clearTimeout(capTimer)
      tip.hidden = true
      if (cell >= 0 && cam.z >= 18) {
        capTimer = window.setTimeout(async () => {
          const info = await cellInfo(cell)
          if (hoverCell !== cell || !info) return
          capFor = cell
          tip.textContent = info.caption
          tip.hidden = false
        }, 90)
      }
    }
  }

  // ---- frame ------------------------------------------------------------------------------
  let raf = 0
  let active = false
  let last = performance.now()
  const t0 = last
  let readoutAt = 0

  function frame() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    W = canvas.clientWidth
    Hh = canvas.clientHeight
    if (canvas.width !== W || canvas.height !== Hh) {
      canvas.width = W
      canvas.height = Hh
      if (cam.z < zMin()) cam.z = tgtZ = zHome()
    }
    if (!homed && W > 50 && Hh > 50) {
      homed = true
      cam.z = tgtZ = zHome()
      cam.x = homeX()
      cam.y = homeY()
    }
    const prevZ = cam.z

    if (flight) {
      const t = Math.min(1, (now - flight.t0) / flight.dur)
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      const [x, y, w] = flight.f(e)
      cam.x = x
      cam.y = y
      cam.z = tgtZ = W / w
      const full = Math.round(flight.a0 / (2 * Math.PI)) * 2 * Math.PI
      cam.a = flight.a0 + (full - flight.a0) * e
      if (t >= 1) {
        const done = flight.done
        flight = null
        done?.()
      }
    } else {
      // zoom eases toward its target, keeping the anchor under the cursor
      if (Math.abs(Math.log(tgtZ / cam.z)) > 1e-4) {
        const k = 1 - Math.exp(-dt * 12)
        cam.z = Math.exp(Math.log(cam.z) + (Math.log(tgtZ) - Math.log(cam.z)) * k)
      } else {
        cam.z = tgtZ
      }
      if (!drag && !pinch) {
        // inertia
        if (Math.abs(vel.a) > 1e-5) {
          rotatePlanet(vel.a * dt * 60)
          vel.a *= Math.exp(-dt * 3.2)
        }
        if (Math.abs(vel.x) + Math.abs(vel.y) > 1e-4) {
          cam.x += vel.x * dt * 60
          cam.y += vel.y * dt * 60
          vel.x *= Math.exp(-dt * 5)
          vel.y *= Math.exp(-dt * 5)
        }
        // unwind the spin as we get close, so sprites end up upright
        const k = Math.max(smooth(zFit() * 3, zFit() * 14, cam.z), mapE > 0.02 ? 1 : 0)
        if (k > 0) {
          const full = Math.round(cam.a / (2 * Math.PI)) * 2 * Math.PI
          cam.a += (full - cam.a) * Math.min(1, dt * 5 * k)
        }
        // idle drift when far away
        const idle = now - lastInput > 2500
        if (idle && !reducedMotion && mapE < 0.02 && Math.abs(vel.a) < 1e-4) rotatePlanet(dt * 0.035)
      }
      if (anchor) {
        const dx = (anchor.sx - W / 2) / cam.z
        const dy = (anchor.sy - Hh / 2) / cam.z
        const c = Math.cos(cam.a)
        const s = Math.sin(cam.a)
        cam.x = anchor.wx - (c * dx - s * dy)
        cam.y = anchor.wy - (s * dx + c * dy)
        if (cam.z === tgtZ) anchor = null
      }
      clampCam()
    }

    const z = cam.z
    mapE = mapAt(z)
    // ---- streaming: tiles are asked for in disc space, through the land nearest the view centre
    const near = LANDS[mapE > 0.001 ? nearestLand(cam.x, cam.y) : 0]
    const corners = [toMapPt(0, 0), toMapPt(W, 0), toMapPt(0, Hh), toMapPt(W, Hh)]
    const xs = corners.map((c) => c[0] - near.ox * mapE)
    const ys = corners.map((c) => c[1] - near.oy * mapE)
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const
    const tcx = cam.x - near.ox * mapE
    const tcy = cam.y - near.oy * mapE
    const m1 = smooth(2.2, 4.2, z)
    const m2 = smooth(8.5, 15, z)
    if (z >= 1.9) L1.update(L1.want(...box, tcx, tcy), now)
    if (z >= 7) L2.update(L2.want(...box, tcx, tcy), now)
    L1.flush()
    L2.flush()

    // ---- draw
    gl!.viewport(0, 0, W, Hh)
    gl!.useProgram(prog)
    gl!.bindVertexArray(vaoMain)
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, ovTex)
    gl!.activeTexture(gl!.TEXTURE1)
    gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, L1.arr)
    gl!.activeTexture(gl!.TEXTURE2)
    gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, L2.arr)
    gl!.activeTexture(gl!.TEXTURE3)
    gl!.bindTexture(gl!.TEXTURE_2D, L1.pt)
    gl!.activeTexture(gl!.TEXTURE4)
    gl!.bindTexture(gl!.TEXTURE_2D, L2.pt)
    const time = (now - t0) / 1000
    gl!.uniform2f(u.uRes, W, Hh)
    gl!.uniform2f(u.uW, cam.x, cam.y)
    gl!.uniform1f(u.uZoom, z)
    gl!.uniform1f(u.uAngle, cam.a)
    gl!.uniform1f(u.uTime, time)
    gl!.uniform1f(u.uDim, hitCount ? 0.5 * (1 - smooth(10, 30, z)) : 0)
    gl!.uniform1f(u.uM1, m1)
    gl!.uniform1f(u.uM2, m2)
    gl!.uniform1f(u.uGrid, smooth(40, 90, z))
    gl!.uniform1f(u.uCellGrid, smooth(6, 16, z) * 0.6)
    const shade = 1 - smooth(1.2, 4, z / zFit())
    gl!.uniform1f(u.uShade, shade)
    // blocks shrink as you fly in, so the mosaic resolves into the real sprites
    // a negative block means “this many blocks across the planet”, whatever the screen size
    const block = MAP_ON ? 1 + 2 * shade * (mapE > 0.001 ? 1 : 0) : (RING.block < 0 ? (2 * R * z) / -RING.block : RING.block) * (0.15 + 0.85 * shade)
    gl!.uniform1f(u.uStyle, MAP_ON || block < 1.6 ? 0 : RING.style)
    gl!.uniform1f(u.uBlock, block)
    gl!.uniform1f(u.uMap, mapE)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)

    if (hitCount) {
      gl!.useProgram(hitProg)
      gl!.bindVertexArray(vaoHit)
      gl!.enable(gl!.BLEND)
      gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA)
      gl!.uniform2f(hu.uRes, W, Hh)
      gl!.uniform2f(hu.uW, cam.x, cam.y)
      gl!.uniform1f(hu.uZoom, z)
      gl!.uniform1f(hu.uAngle, cam.a)
      gl!.uniform1f(hu.uTime, time)
      gl!.uniform1f(hu.uMap, mapE)
      gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, hitCount)
      gl!.disable(gl!.BLEND)
    }
    gl!.bindVertexArray(null)

    // ---- DOM overlays
    const place = (box: HTMLElement, cell: number, pad: number) => {
      if (cell < 0) {
        box.hidden = true
        return
      }
      const [x, y] = cellXY(cell)
      const [sx, sy] = toScreen(x, y)
      const size = Math.max(z, 18) + pad
      if (sx < -size || sy < -size || sx > W + size || sy > Hh + size) {
        box.hidden = true
        return
      }
      box.hidden = false
      box.style.transform = `translate(${sx - size / 2}px, ${sy - size / 2}px) rotate(${-cam.a}rad)`
      box.style.width = box.style.height = `${size}px`
    }
    place(reticle, selected, 12)
    place(hoverBox, hoverCell !== selected ? hoverCell : -1, 0)
    if (!tip.hidden) {
      if (hoverCell !== capFor || hoverCell < 0) tip.hidden = true
      else tip.style.transform = `translate(${Math.min(mouse.x + 18, W - 300)}px, ${mouse.y + 20}px)`
    }

    if (MAP_ON) {
      const show = mapE > 0.7 && z < zHome() * 3.4 && !hitCount
      const pr = show ? panelEl.getBoundingClientRect() : null
      const cr = show ? canvas.getBoundingClientRect() : null
      labels.forEach((sp, k) => {
        let on = show
        if (pr && cr) {
          const [sx, sy] = toScreen(landInfo[k].cx, landInfo[k].cy)
          const px = sx + cr.left
          const py = sy + cr.top
          if (sx < 40 || sy < 70 || sx > W - 40 || sy > Hh - 60) on = false
          if (px > pr.left - 70 && px < pr.right + 70 && py > pr.top - 26 && py < pr.bottom + 26) on = false
          sp.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -50%)`
        }
        sp.style.opacity = on ? '1' : '0'
      })
    }

    // sound follows motion: wind from zoom speed, pitch from depth
    const zv = Math.abs(Math.log(z / prevZ)) / Math.max(dt, 1e-3)
    const pv = Math.hypot(vel.x, vel.y) * z * 0.02 + Math.abs(vel.a) * 20
    sound.set('wind', Math.min(1, zv * 0.35 + pv * 0.4 + (flight ? 0.25 : 0)))
    sound.set('pitch', Math.min(1, Math.log(z / zFit()) / Math.log(zMax() / zFit())))

    // (the canvas can still be 0×0 on the first frames while the page lays out)
    const atMax = W > 50 && Hh > 50 && z >= zMax() * 0.985
    if (atMax && !wasAtMax) {
      sound.lock()
      if (selected < 0) {
        const [wx, wy] = toWorld(W / 2, Hh / 2)
        select(Math.floor(wy) * SIDE + Math.floor(wx))
      }
    }
    wasAtMax = atMax

    if (now > readoutAt) {
      readoutAt = now + 120
      const lod = z < 1.9 ? 0 : z < 4 ? 1 : z < 12 ? 2 : 3
      lodItems.forEach((li, i) => li.classList.toggle('on', i === lod))
      const vw = Math.round(W / z)
      const vh = Math.round(Hh / z)
      const lv = lod === 3 ? L2 : L1
      tech.textContent = `视野 ${fmt(Math.min(vw, SIDE))}×${fmt(Math.min(vh, SIDE))} 格 · ${lod >= 2 ? `瓦片 ${lv.loaded}/${lv.slots} · ` : ''}已下载 ${(bytesDownloaded() / 1e6).toFixed(1)} MB`
      hint.textContent = atMax
        ? '已到原图 · 点素材看详情'
        : z < zFit() * 3.2
          ? touch
            ? '双指缩放 / 旋转 · 点一下放大'
            : mapE > 0.5
              ? '滚轮缩放 · 拖动平移 · 点一下放大 · 继续缩小会合拢成星球'
              : '这是同一批素材合拢成的星球 · 拖外圈旋转 · 放大就裂开成地图'
          : z < 8
            ? '再点一下继续放大 · 滚轮缩放'
            : touch
              ? '拖动平移 · 点素材看详情'
              : '拖动平移 · 点素材看详情 · 再点一次放到最大'
      intro.style.opacity = String(1 - smooth(1.4, 3, z / zFit()))
      if (MAP_ON) {
        // the plate: full on arrival, one line while exploring; the breadcrumb says where the view centre is
        const away = z > zHome() * 1.22 || z < zHome() * 0.9 || Math.hypot(cam.x - homeX(), cam.y - homeY()) > R * 0.2
        el.classList.toggle('is-exploring', away)
        const here = mapE < 0.5 ? -2 : (() => {
          const p = discOf(cam.x, cam.y)
          return p ? pieceOf(p[0], p[1]) : -1
        })()
        const key = `${here}|${z >= 8}`
        if (key !== crumbKey) {
          crumbKey = key
          crumb.innerHTML =
            here === -2
              ? `<b>星球</b> › <button type="button" data-go="home">展开成地图</button>`
              : `<button type="button" data-go="planet">星球</button> › <button type="button" data-go="home">世界</button> › ${here < 0 ? '海上' : `<button type="button" data-go="${here}">${LANDS[here].name}</button>`}${z >= 8 ? ' › <b>素材</b>' : ''}`
        }
      }
      el.classList.toggle('is-deep', z > 12)
    }
    updateHover()
  }

  const loop = () => {
    frame()
    if (active) raf = requestAnimationFrame(loop)
  }

  cam.z = tgtZ = 0.0001
  return {
    id: 'hero',
    num: '00',
    title: '星图',
    color: '#07060c',
    transition: 'dither',
    ambience: 'space',
    el,
    consume(delta) {
      if (flight) flight = null
      zoomAt(Math.exp(-delta * 0.0026), mouse.inside ? mouse.x : W / 2, mouse.inside ? mouse.y : Hh / 2)
      return true
    },
    enter() {
      active = true
      last = performance.now()
      if (cam.z < 0.001) {
        W = canvas.clientWidth
        Hh = canvas.clientHeight
        cam.z = tgtZ = zHome()
      }
      cancelAnimationFrame(raf)
      loop()
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      input.blur()
    },
    focusSearch() {
      input.focus()
      input.select()
    },
  }
}
