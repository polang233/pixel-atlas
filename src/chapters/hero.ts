/**
 * 00 · Atlas. The whole dataset as one colour-wheel planet.
 *
 * Rendering is a tiny virtual-texture system:
 *   LOD0 overview.png  1 texel per sprite (mipmapped)       far away
 *   LOD1 l1 tiles      4×4 px per sprite (box filtered)      mid zoom
 *   LOD2 l2 tiles      the real 16×16 sprites                close up
 * Tiles stream into two texture arrays; a small page table per level maps
 * tile → array layer, and the shader falls back level by level when a tile
 * isn't there yet. Searching, flying and rotating all run on this.
 */
import gsap from 'gsap'
import {
  type AtlasMeta,
  atlasFetch,
  bytesDownloaded,
  type CellInfo,
  cellInfo,
  type LevelMeta,
  loadIndex,
  loadMeta,
  nearestColorCell,
  type Overview,
  search,
  spriteCanvas,
  tileBitmap,
} from '../atlas'
import { sound } from '../audio'
import { escapeHtml, formatCount, formatInt, getLocale, onLocaleChange, t } from '../i18n'
import { zhLabel } from '../search-zh'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import { zip } from '../zip'

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
      // every bit of land is made of sprites, so the coast is only a thin sand line (a few screen pixels, whatever the zoom);
      // the capes and bays are drawn in the water instead, as shallows of uneven width
      float cape = 0.5 + 0.5 * sin(m.x * 0.009 + sin(m.y * 0.007) * 2.2);
      float bw = uR * (0.018 + 0.1 * cape * cape) * uMap;
      float sw = min(bw, (MB + 3.0 * cape) / uZoom);
      float tick = floor(uTime * 2.2);
      vec3 sea;
      if (cdist < sw) {
        sea = vec3(0.90, 0.81, 0.56);
      } else if (cdist < bw) {
        float k = (cdist - sw) / max(bw - sw, 0.001);
        sea = k < 0.42 ? vec3(0.45, 0.82, 0.80) : (k < 0.8 ? vec3(0.31, 0.68, 0.78) : vec3(0.24, 0.57, 0.74));
        if (cdist < sw + st * 1.2 && mod(mcell.x + mcell.y + tick, 5.0) < 2.0) sea = vec3(0.91, 0.96, 1.0);
        else if (hash(vec2(floor(mcell.x / 2.0), mcell.y)) > 0.965 && mod(mcell.x + tick, 6.0) < 2.0) sea = vec3(0.70, 0.93, 0.92);
        if (mod(mcell.x + mcell.y, 2.0) < 1.0) sea *= 0.96;
      } else {
        float dd = (cdist - bw) / (uR * 0.028);
        sea = mix(vec3(0.20, 0.50, 0.70), vec3(0.055, 0.13, 0.30), min(1.0, floor(dd) / 4.0));
        if (dd > 3.0 && hash(vec2(floor(mcell.x / 2.0), mcell.y)) > 0.975 && mod(mcell.x + tick, 7.0) < 3.0) sea *= 1.5;
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
const fmt = formatInt

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
  const ovBlob = await atlasFetch('overview.png').then((r) => r.blob())
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
  const batchButton = $<HTMLButtonElement>('[data-act="batch"]')
  const card = $('.hero-card')
  const cardCanvas = card.querySelector('canvas')!
  const cardCap = card.querySelector<HTMLElement>('.cap')!
  const cardMeta = card.querySelector<HTMLElement>('.meta')!
  const lodButtons = [...el.querySelectorAll<HTMLButtonElement>('.hero-lod [data-lod]')]
  const viewButton = $<HTMLButtonElement>('[data-zoom="view"]')
  const tech = $('.hero-tech')
  const hint = $('.hero-hint')
  const intro = $('.hero-intro')
  const coarse = matchMedia('(pointer: coarse)')
  const fine = matchMedia('(pointer: fine)')
  let touch = coarse.matches
  coarse.addEventListener('change', () => (touch = coarse.matches))
  let hintDismissed = false

  function dismissHint() {
    if (hintDismissed) return
    hintDismissed = true
    hint.classList.add('is-dismissed')
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) hint.hidden = true
    else window.setTimeout(() => (hint.hidden = true), 300)
  }

  // The lens sits right above the map and below every other overlay: it redraws the cells around the pointer where they are.
  const loupe = document.createElement('div')
  loupe.className = 'hero-loupe'
  loupe.hidden = true
  loupe.setAttribute('aria-hidden', 'true')
  const loupeCanvas = document.createElement('canvas')
  const loupeCtx = loupeCanvas.getContext('2d')!
  loupe.append(loupeCanvas)
  canvas.after(loupe)
  /** how much the map is dimmed this frame (search results, gather); the lens dims with it */
  let mapDim = 0
  /** the cells the search has lit, so the lens can frame them too */
  let lensHits: Set<number> | null = null
  let lensHitsVersion = 0

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  if (!gl) throw new Error(t('hero.webgl'))

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
    { name: () => t('land.0.name'), note: () => t('land.0.note'), a0: 0, a1: 0, push: 0 },
    { name: () => t('land.1.name'), note: () => t('land.1.note'), a0: 330, a1: 400, push: 0.5 },
    { name: () => t('land.2.name'), note: () => t('land.2.note'), a0: 40, a1: 130, push: 0.44 },
    { name: () => t('land.3.name'), note: () => t('land.3.note'), a0: 130, a1: 205, push: 0.47 },
    { name: () => t('land.4.name'), note: () => t('land.4.note'), a0: 205, a1: 232, push: 0.6 },
    { name: () => t('land.5.name'), note: () => t('land.5.note'), a0: 232, a1: 258, push: 0.5 },
    { name: () => t('land.6.name'), note: () => t('land.6.note'), a0: 258, a1: 312, push: 0.46 },
    { name: () => t('land.7.name'), note: () => t('land.7.note'), a0: 312, a1: 330, push: 0.62 },
  ].map((l, k) => {
    const mid = ((l.a0 + l.a1) / 2) * DEG
    const half = ((l.a1 - l.a0) / 2) * DEG
    return { ...l, k, mid, half, ox: k ? Math.cos(mid) * R * l.push : 0, oy: k ? Math.sin(mid) * R * l.push : 0 }
  })
  const secData = new Float32Array(28)
  LANDS.slice(1).forEach((l, i) => {
    secData.set([l.mid, l.half, l.ox, l.oy], i * 4)
  })
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
    closeGather()
    const nz = Math.min(zMax(), Math.max(zMin(), tgtZ * factor))
    // This path is used only by wheel, keyboard and zoom-button input.
    if (nz !== tgtZ) dismissHint()
    if (!anchor || Math.abs(anchor.sx - sx) > 2 || Math.abs(anchor.sy - sy) > 2) {
      const [wx, wy] = toMapPt(sx, sy)
      anchor = { sx, sy, wx, wy }
    }
    tgtZ = nz
    flight = null
    lastInput = performance.now()
  }

  function noteUserZoom(z: number) {
    if (Math.min(zMax(), Math.max(zMin(), z)) !== cam.z) dismissHint()
  }

  /** van Wijk & Nuij smooth zoom-and-pan */
  function flyTo(wx: number, wy: number, z1: number, done?: () => void, raw = false) {
    closeGather()
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
    let r = 0,
      g = 0,
      b = 0,
      n = 0,
      cells = 0
    for (let y = 4; y < SIDE; y += 8)
      for (let x = 4; x < SIDE; x += 8) {
        if (pieceDist(x - D, y - D, l.k) > 0) continue
        cells += 64
        const o = (y * SIDE + x) * 4
        if (!overview.px[o + 3]) continue
        r += overview.px[o]
        g += overview.px[o + 1]
        b += overview.px[o + 2]
        n++
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
  const landText: (() => void)[] = []
  LANDS.forEach((l, k) => {
    const b = document.createElement('button')
    b.type = 'button'
    const swatch = document.createElement('i')
    swatch.style.background = landInfo[k].color
    const name = document.createElement('span')
    const count = document.createElement('small')
    const update = () => {
      b.title = `${l.name()} · ${l.note()}`
      name.textContent = l.name()
      count.textContent = formatCount(landInfo[k].cells, 'short')
    }
    landText.push(update)
    update()
    b.append(swatch, name, count)
    b.addEventListener('click', () => flyLand(k))
    legendEl.append(b)
  })
  const labels = LANDS.map((l, k) => {
    const sp = document.createElement('span')
    sp.style.color = landInfo[k].color
    const name = document.createTextNode('')
    const detail = document.createElement('small')
    const update = () => {
      name.textContent = l.name()
      detail.textContent = t('hero.landDetail', { note: l.note(), count: formatCount(landInfo[k].cells, 'short') })
    }
    landText.push(update)
    update()
    sp.append(name, detail)
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
  /** the view has left the opening one: zoomed, panned, or folded into the planet */
  const isAway = () => cam.z > zHome() * 1.22 || cam.z < zHome() * 0.9 || Math.hypot(cam.x - homeX(), cam.y - homeY()) > R * 0.2
  /** one button, two jobs: from the opening view it folds the planet, from anywhere else it comes back */
  const viewAction = () => (MAP_ON && !isAway() ? 'planet' : 'home')
  let viewShown = ''
  function renderViewButton() {
    const planet = viewShown === 'planet'
    viewButton.dataset.view = viewShown
    viewButton.textContent = planet ? '◐' : '◎'
    viewButton.title = t(planet ? 'hero.toPlanetTitle' : 'hero.toHomeTitle')
    viewButton.setAttribute('aria-label', t(planet ? 'hero.toPlanet' : 'hero.toHome'))
  }
  function toggleView() {
    deselect()
    if (viewAction() === 'planet') {
      noteUserZoom(zMin())
      goPlanet()
    } else {
      noteUserZoom(zHome())
      goHome()
    }
  }
  /** the disc point under the view centre; over the sea, the nearest shore, pulled a little inland */
  function landNear(inland: number): [number, number] {
    const here = discOf(cam.x, cam.y)
    if (here) return here
    const step = Math.max(4, 12 / cam.z)
    for (let r = step; r < R * 3; r += step)
      for (let i = 0; i < 24; i++) {
        const dx = Math.cos((i / 12) * Math.PI)
        const dy = Math.sin((i / 12) * Math.PI)
        const shore = discOf(cam.x + dx * r, cam.y + dy * r)
        if (shore) return discOf(cam.x + dx * (r + inland), cam.y + dy * (r + inland)) ?? shore
      }
    return [D, D]
  }
  /** a zoom well inside each level of detail; the map level is the opening view */
  const LOD_Z = [0, 2.6, 7, 20]
  function goLod(level: number) {
    deselect()
    if (!level) {
      noteUserZoom(zHome())
      goHome()
      return
    }
    // (from the planet this unfolds the map on the way: the continents part as the zoom passes the opening view)
    const z = Math.min(zMax(), LOD_Z[level])
    noteUserZoom(z)
    flyTo(...landNear((Math.min(W, Hh) * 0.25) / z), z)
  }
  const cellXY = (cell: number): [number, number] => [(cell % SIDE) + 0.5, Math.floor(cell / SIDE) + 0.5]
  const flyToCell = (cell: number, z = 72) => {
    const [x, y] = cellXY(cell)
    flyTo(x, y, z, () => select(cell))
  }

  // ---- selection card ------------------------------------------------------------------
  let selected = -1
  let selInfo: CellInfo | null = null
  let cardReady = false
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
    cardReady = false
    selInfo = null
    selSprite = null
    cardCap.textContent = '…'
    cardMeta.textContent = ''
    cctx.clearRect(0, 0, 16, 16)
    const [info, spr] = await Promise.all([cellInfo(cell), spriteCanvas(cell)])
    if (selected !== cell) return
    selInfo = info
    cardReady = true
    selSprite = spr
    if (spr) cctx.drawImage(spr, 0, 0)
    renderCard()
  }
  function renderCard() {
    const info = selInfo
    if (info) {
      cardCap.textContent = info.caption
      const zh = getLocale() === 'zh-CN' ? zhLabel(info.subject) : ''
      cardMeta.innerHTML = t('hero.cardMetaHtml', {
        subject: escapeHtml(info.subject),
        translation: zh ? ` · ${escapeHtml(zh)}` : '',
        cell: fmt(selected),
        id: fmt(info.id),
      })
    } else cardCap.textContent = t('hero.empty')
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
    if ((act === 'png' || act === 'png-big') && selSprite && selInfo) {
      const filename = `pixel-atlas-${selInfo.id}-${slug(selInfo.subject, 'sprite')}${act === 'png-big' ? '-x16' : ''}.png`
      let output = selSprite
      if (act === 'png-big') {
        output = document.createElement('canvas')
        output.width = output.height = 256
        const b = output.getContext('2d')!
        b.imageSmoothingEnabled = false
        b.drawImage(selSprite, 0, 0, 256, 256)
      }
      output.toBlob((blob) => {
        if (!blob) return
        download(blob, filename)
      })
    }
  })

  function slug(value: string, fallback = 'batch') {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '') || fallback
    )
  }

  function download(blob: Blob, filename: string) {
    const a = document.createElement('a')
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  // ---- search ----------------------------------------------------------------------------
  let tour: number[] = []
  let tourAt = -1
  let searchSeq = 0
  let indexLoaded = false

  let batchResult: { query: string; english: string; total: number; cells: Uint32Array } | null = null
  let batchState: { kind: 'idle' } | { kind: 'packing'; n: number; total: number } | { kind: 'failed' } = { kind: 'idle' }
  let batchJob = 0
  let batchTimer = 0

  function renderBatch() {
    batchButton.hidden = !batchResult
    if (batchState.kind === 'packing') {
      batchButton.setAttribute('aria-busy', 'true')
      batchButton.textContent = t('hero.batchProgress', { n: batchState.n, total: batchState.total })
    } else {
      batchButton.removeAttribute('aria-busy')
      batchButton.textContent =
        batchState.kind === 'failed' ? t('hero.batchFailed') : batchResult && batchResult.total > 256 ? t('hero.batchFirst', { n: 256 }) : t('hero.batch')
    }
  }

  function resetBatch() {
    ++batchJob
    clearTimeout(batchTimer)
    batchResult = null
    batchState = { kind: 'idle' }
    renderBatch()
  }

  batchButton.addEventListener('click', async () => {
    if (!batchResult || batchState.kind === 'packing') return
    const result = batchResult
    const job = ++batchJob
    const cells = result.cells.slice(0, Math.min(256, result.total))
    const current = () => job === batchJob && batchState.kind === 'packing'
    clearTimeout(batchTimer)
    batchState = { kind: 'packing', n: 0, total: cells.length }
    renderBatch()
    try {
      const loaded: ({ sprite: HTMLCanvasElement; info: CellInfo } | null)[] = Array.from({ length: cells.length }, () => null)
      let next = 0
      let done = 0
      // Six workers load one cell at a time; slots preserve the search result order.
      const worker = async () => {
        while (current() && next < cells.length) {
          const i = next++
          const sprite = await spriteCanvas(cells[i])
          if (!current()) return
          const info = sprite ? await cellInfo(cells[i]) : null
          if (!current()) return
          if (sprite && info) loaded[i] = { sprite, info }
          batchState = { kind: 'packing', n: ++done, total: cells.length }
          renderBatch()
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, cells.length) }, worker))
      if (!current()) return
      const sprites = loaded.filter((item) => item !== null)
      if (!sprites.length) throw new Error('No sprites available')
      const columns = Math.min(16, sprites.length)
      const sheet = document.createElement('canvas')
      sheet.width = columns * 16
      sheet.height = Math.ceil(sprites.length / columns) * 16
      const ctx = sheet.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      const manifest = {
        generator: 'Pixel Atlas · https://pixelatlas.org',
        query: result.query,
        source: 'https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m',
        licence:
          'Sprites: CC0 1.0 by Angais, generated with Krea 2 (commercial use is also subject to the Krea 2 Community License). Sheet layout: CC BY 4.0, Pixel Atlas.',
        tileSize: 16,
        columns,
        count: sprites.length,
        datasetIndexNote: 'datasetIndex is the row in the dataset ZIP (tokens.npy, captions.json, objects.json).',
        sprites: sprites.map(({ sprite, info }, i) => {
          const x = (i % columns) * 16
          const y = Math.floor(i / columns) * 16
          ctx.drawImage(sprite, x, y)
          return { x, y, datasetIndex: info.id, subject: info.subject, caption: info.caption }
        }),
      }
      const png = await new Promise<Blob>((resolve, reject) => {
        sheet.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Cannot encode sprite sheet'))), 'image/png')
      })
      if (!current()) return
      const data = new Uint8Array(await png.arrayBuffer())
      if (!current()) return
      const name = slug(result.english || result.query)
      const archive = zip([
        { name: `${name}.png`, data },
        { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      ])
      download(archive, `pixel-atlas-${name}.zip`)
      sound.select()
      batchState = { kind: 'idle' }
      renderBatch()
    } catch {
      if (!current()) return
      batchState = { kind: 'failed' }
      renderBatch()
      batchTimer = window.setTimeout(() => {
        if (job !== batchJob) return
        batchState = { kind: 'idle' }
        renderBatch()
      }, 2000)
    }
  })

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
    lensHits = n ? new Set(cells) : null
    lensHitsVersion++
  }

  // ---- gather: the best results leave their lands and meet in the middle of the screen -------
  const gatherEl = $('.hero-gather')
  interface GItem {
    cell: number
    el: HTMLButtonElement
    x: number
    y: number
    size: number
    ready: boolean
  }
  let gItems: GItem[] = []
  let gathered = false
  let gatherK = 0
  let gatherCells: number[] = []
  let gHover: GItem | null = null
  let swallowClick = false

  /**
   * The results to show, best first. Sprites come out of level-2 tiles, so the pick is
   * limited to a few tiles: the best one on each land, then the ones holding the most results.
   */
  function pickGather(cells: Uint32Array, n = 220, budget = 22) {
    const t = meta.l2.cells
    const nt = meta.l2.tiles
    const tileOf = (c: number) => Math.floor(Math.floor(c / SIDE) / t) * nt + Math.floor((c % SIDE) / t)
    const weight = new Map<number, number>()
    for (let i = 0; i < cells.length; i++) {
      const k = tileOf(cells[i])
      weight.set(k, (weight.get(k) ?? 0) + 1 / (1 + i / 400))
    }
    const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
    const chosen = new Set<number>()
    const landSeen = new Set<number>()
    for (const k of ranked) {
      const land = pieceOf(((k % nt) + 0.5) * t, (Math.floor(k / nt) + 0.5) * t)
      if (landSeen.has(land)) continue
      landSeen.add(land)
      chosen.add(k)
    }
    for (const k of ranked) {
      if (chosen.size >= budget) break
      chosen.add(k)
    }
    const perTile = new Map<number, number>()
    const cap = Math.max(6, Math.ceil((n / Math.max(1, chosen.size)) * 1.6))
    const out: number[] = []
    for (let i = 0; i < cells.length && out.length < n; i++) {
      const k = tileOf(cells[i])
      if (!chosen.has(k)) continue
      const c = perTile.get(k) ?? 0
      if (c >= cap) continue
      perTile.set(k, c + 1)
      out.push(cells[i])
    }
    return out
  }

  /** the part of the screen the gathering may use: beside the plate on wide screens, under it on phones */
  function gatherRect() {
    const pr = panelEl.getBoundingClientRect()
    const cr = canvas.getBoundingClientRect()
    if (W < 760) return { x0: 8, x1: W - 56, y0: Math.min(Hh * 0.6, pr.bottom - cr.top + 10), y1: Hh - 64 }
    return { x0: pr.right - cr.left + 24, x1: W - 76, y0: 120, y1: Hh - 96 }
  }

  /** a sunflower spiral: the best result big in the middle, the rest shrinking outwards */
  function gatherSlots(n: number, rect: { x0: number; x1: number; y0: number; y1: number }) {
    const rw = Math.max(40, (rect.x1 - rect.x0) / 2)
    const rh = Math.max(40, (rect.y1 - rect.y0) / 2)
    const asp = Math.min(1.45, Math.max(0.7, rw / rh))
    const sx = Math.sqrt(asp)
    const sy = 1 / sx
    const room = Math.min(rw / sx, rh / sy)
    const cx = Math.round((rect.x0 + rect.x1) / 2)
    const cy = Math.round((rect.y0 + rect.y1) / 2)
    const need = Math.min(n, 36)
    let best: { x: number; y: number; size: number }[] = []
    for (const scale of [1, 0.75, 0.5]) {
      const slots: { x: number; y: number; size: number }[] = []
      let area = 0
      for (let i = 0; i < n; i++) {
        const base = i === 0 ? 96 : i < 7 ? 64 : i < 27 ? 48 : 32
        const size = Math.max(16, Math.round((base * scale) / 16) * 16)
        const cellArea = (size + 5) ** 2
        const r = i === 0 ? 0 : Math.sqrt((area + cellArea / 2) / Math.PI) * 1.0 * Math.max(sx, sy)
        area += cellArea
        if (r + size / 2 > room) break
        const a = i * 2.399963
        slots.push({ x: Math.round(cx + Math.cos(a) * r * sx - size / 2), y: Math.round(cy + Math.sin(a) * r * sy - size / 2), size })
      }
      if (slots.length > best.length) best = slots
      if (slots.length >= need) break
    }
    return best
  }

  /** where a result lives on the map right now, as the transform of a tiny copy of it */
  const homeOf = (g: GItem) => {
    const [x, y] = cellXY(g.cell)
    const [sx, sy] = toScreen(x, y)
    return { x: sx - g.size / 2, y: sy - g.size / 2, scale: Math.max(cam.z, 4) / g.size }
  }
  function sendHome(g: GItem) {
    g.el.style.pointerEvents = 'none'
    if (reducedMotion || !g.ready) {
      g.el.remove()
      return
    }
    gsap.to(g.el, { ...homeOf(g), opacity: 0, duration: 0.32, ease: 'steps(6)', overwrite: true, onComplete: () => g.el.remove() })
  }
  function arrive(g: GItem, i: number) {
    if (reducedMotion) {
      gsap.set(g.el, { x: g.x, y: g.y, scale: 1, opacity: 1 })
      return
    }
    gsap.fromTo(
      g.el,
      { ...homeOf(g), opacity: 1 },
      { x: g.x, y: g.y, scale: 1, duration: 0.5, delay: Math.min(0.5, i * 0.004), ease: 'steps(9)', overwrite: true },
    )
  }

  function openGather(cells: number[]) {
    if (!cells.length) return closeGather()
    deselect()
    flight = null
    anchor = null
    gathered = true
    el.classList.add('is-gathered')
    const slots = gatherSlots(cells.length, gatherRect())
    const old = new Map(gItems.map((g) => [g.cell, g]))
    gItems = cells.slice(0, slots.length).map((cell, i) => {
      const slot = slots[i]
      const g = old.get(cell)
      if (g) {
        old.delete(cell)
        Object.assign(g, slot)
        g.el.style.width = g.el.style.height = `${slot.size}px`
        if (g.ready) gsap.to(g.el, { x: g.x, y: g.y, scale: 1, opacity: 1, duration: reducedMotion ? 0 : 0.3, ease: 'steps(5)', overwrite: true })
        return g
      }
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'gather-item'
      b.setAttribute('aria-label', t('hero.resultLabel', { n: i + 1 }))
      b.style.width = b.style.height = `${slot.size}px`
      const item: GItem = { cell, el: b, ...slot, ready: false }
      b.addEventListener('click', () => {
        tourAt = tour.indexOf(cell)
        flyToCell(cell)
      })
      b.addEventListener('pointerenter', () => {
        gHover = item
        sound.tick(1700 + (i % 12) * 70, 0.012)
        tip.hidden = true
        cellInfo(cell).then((info) => {
          if (gHover !== item || !info) return
          tip.textContent = info.caption
          tip.hidden = false
          tip.style.transform = `translate(${Math.max(8, Math.min(item.x, W - 300))}px, ${item.y + item.size + 10}px)`
        })
      })
      b.addEventListener('pointerleave', () => {
        if (gHover !== item) return
        gHover = null
        tip.hidden = true
      })
      gatherEl.append(b)
      spriteCanvas(cell).then((c) => {
        if (!c || !gItems.includes(item)) return b.remove()
        b.append(c)
        item.ready = true
        arrive(item, i)
      })
      return item
    })
    for (const g of old.values()) sendHome(g)
  }

  function closeGather() {
    if (!gathered) return
    gathered = false
    el.classList.remove('is-gathered')
    if (gHover) tip.hidden = true
    gHover = null
    for (const g of gItems) sendHome(g)
    gItems = []
  }

  function renderTray(cells: number[]) {
    tray.replaceChildren()
    tour = cells
    tourAt = -1
    stepEl.hidden = cells.length < 1
    cells.forEach((cell, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tray-item'
      b.title = t('hero.fly')
      b.addEventListener('click', () => {
        tourAt = i
        flyToCell(cell)
      })
      b.addEventListener('pointerenter', () => sound.tick(1800 + i * 60))
      tray.append(b)
      spriteCanvas(cell).then((c) => c && b.append(c))
    })
  }

  let statusCopy = () => {
    status.textContent = ''
  }
  const showStatus = (copy: () => void) => {
    statusCopy = copy
    copy()
  }
  let subjectText: (() => void)[] = []

  async function runSearch(fly = false) {
    const q = input.value
    const seq = ++searchSeq
    resetBatch()
    el.classList.toggle('is-searching', !!q.trim())
    if (!q.trim()) {
      setHits(null)
      closeGather()
      gatherCells = []
      showStatus(() => {
        status.textContent = ''
      })
      subjectsEl.replaceChildren()
      tray.replaceChildren()
      stepEl.hidden = true
      suggest.hidden = false
      return
    }
    suggest.hidden = true
    if (!indexLoaded)
      showStatus(() => {
        status.textContent = t('hero.status.loading')
      })
    const res = await search(q, overview)
    indexLoaded = true
    if (seq !== searchSeq || !res) return
    if (res.kind === 'color') {
      closeGather()
      gatherCells = []
      setHits(null)
      subjectsEl.replaceChildren()
      tray.replaceChildren()
      stepEl.hidden = true
      const cell = nearestColorCell(overview, res.rgb)
      showStatus(() => {
        const swatch = document.createElement('i')
        swatch.className = 'sw'
        swatch.style.background = `rgb(${res.rgb.join(',')})`
        status.replaceChildren(swatch, t('hero.status.colour', { label: res.color && getLocale() === 'en' ? res.color.en : res.label }))
      })
      if (fly || res.label.startsWith('#')) flyToCell(cell, 40)
      return
    }
    if (res.kind === 'none') {
      closeGather()
      gatherCells = []
      setHits(null)
      subjectsEl.replaceChildren()
      tray.replaceChildren()
      stepEl.hidden = true
      showStatus(() => {
        status.textContent = t('hero.status.none', { query: q.trim(), english: res.english ? t('hero.status.translation', { english: res.english }) : '' })
      })
      sound.nothing()
      return
    }
    setHits(res.cells)
    if (res.total > 0 && res.cells.length) {
      batchResult = { query: q, english: res.english, total: res.total, cells: res.cells }
      renderBatch()
    }

    gatherCells = pickGather(res.cells, W < 760 ? 120 : 220, W < 760 ? 14 : 22)
    showStatus(() => {
      const label = res.color
        ? t('hero.status.colourQuery', { colour: getLocale() === 'en' ? res.color.en : res.color.label, query: res.english })
        : t('hero.status.query', { query: q.trim() })
      status.innerHTML = t('hero.status.hitsHtml', {
        label: escapeHtml(label),
        n: fmt(res.total),
        subjects: res.subjects.length,
        home: res.total ? t('hero.status.home') : '',
      })
    })
    sound.results(res.total)
    subjectText = []
    subjectsEl.replaceChildren(
      ...res.subjects.slice(0, 6).map((s) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        const name = document.createTextNode(s.name)
        const translation = document.createElement('span')
        const count = document.createElement('em')
        b.append(name, translation, ' ', count)
        const update = () => {
          const zh = getLocale() === 'zh-CN' ? zhLabel(s.name) : ''
          translation.textContent = zh ? ` ${zh}` : ''
          count.textContent = fmt(s.count)
        }
        subjectText.push(update)
        update()
        b.addEventListener('click', () => {
          input.value = s.name
          runSearch()
        })
        return b
      }),
    )
    renderTray(gatherCells.slice(0, 12))
    // (the plate changes height with the new status line, and the gathering sits beside / under it)
    requestAnimationFrame(() => seq === searchSeq && openGather(gatherCells))
  }

  let deb = 0
  input.addEventListener('input', () => {
    sound.key()
    ++searchSeq
    resetBatch()
    clearTimeout(deb)
    deb = window.setTimeout(() => runSearch(false), 160)
  })
  input.addEventListener('focus', () => {
    loadIndex()
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    clearTimeout(deb)
    if (gathered) return
    if (tour.length && input.value.trim()) step(1)
    else runSearch(true)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGather()
  })
  stepEl.querySelector('[data-gather]')!.addEventListener('click', () => {
    openGather(gatherCells)
    sound.results(gatherCells.length)
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
  el.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.zoom
      if (k === 'view') toggleView()
      else zoomAt(k === 'in' ? 2.2 : 1 / 2.2, W / 2, Hh / 2)
      sound.click()
    })
  })
  lodButtons.forEach((b, level) => {
    b.addEventListener('click', () => {
      goLod(level)
      sound.click()
    })
  })
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('is-active') || e.target instanceof HTMLInputElement) return
    if (e.key === 'Escape') closeGather()
    if (e.key === '+' || e.key === '=') zoomAt(1.8, W / 2, Hh / 2)
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.8, W / 2, Hh / 2)
    else if (e.key === '0') toggleView()
    else if (e.key === 'q' || e.key === 'Q') rotatePlanet(-0.12)
    else if (e.key === 'e' || e.key === 'E') rotatePlanet(0.12)
  })

  // ---- pointer --------------------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>()
  let drag: { mode: 'rotate' | 'pan'; sx: number; sy: number; moved: boolean; last: number } | null = null
  let pinch: { d: number; mx: number; my: number; ang: number } | null = null
  let hoverCell = -1
  let mouse = { x: -1, y: -1, inside: false }
  let pointerIsTouch = false
  let rotAcc = 0
  let capTimer = 0
  let capFor = -1

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointerIsTouch = e.pointerType === 'touch'
    const p = local(e)
    pointers.set(e.pointerId, p)
    canvas.setPointerCapture(e.pointerId)
    swallowClick = gathered
    closeGather()
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
    pointerIsTouch = e.pointerType === 'touch'
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
      const nz = Math.min(zMax(), Math.max(zMin(), cam.z * (d / Math.max(pinch.d, 1))))
      if (nz !== cam.z || mx !== pinch.mx || my !== pinch.my) dismissHint()
      cam.z = tgtZ = nz
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
        if (dx || dy) dismissHint()
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
    mouse.inside = document.elementFromPoint(e.clientX, e.clientY) === canvas
    if (pointers.size < 2) pinch = null
    canvas.classList.remove('is-grabbing', 'is-rotating')
    if (!drag) return
    const p = local(e)
    if (!drag.moved && !swallowClick && e.type === 'pointerup' && e.button === 0) clickAt(p.x, p.y)
    if (performance.now() - drag.last > 80) vel.x = vel.y = vel.a = 0
    drag = null
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('pointerleave', () => {
    mouse.inside = false
    hoverCell = -1
    if (!gHover) tip.hidden = true
  })

  function clickAt(sx: number, sy: number) {
    const [wx, wy] = toWorld(sx, sy)
    if (Math.hypot(wx - D, wy - D) > R) {
      deselect()
      return
    }
    const cell = Math.floor(wy) * SIDE + Math.floor(wx)
    if (cam.z < 8) {
      const z = Math.max(9, cam.z * 4)
      noteUserZoom(z)
      flyTo(wx, wy, z)
    } else if (cell === selected) {
      noteUserZoom(zMax() * 0.9)
      flyTo(Math.floor(wx) + 0.5, Math.floor(wy) + 0.5, zMax() * 0.9)
    } else select(cell)
  }

  function updateHover() {
    if (!mouse.inside || cam.z < 4 || drag || pinch || flight || gathered) {
      hoverCell = -1
      clearTimeout(capTimer)
      if (!gHover) tip.hidden = true
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

  // ---- lens: a dock-style fisheye, drawn in place over the map ------------------------------
  // The cells around the pointer are redrawn where they are: the hovered sprite grows to LENS_PX, its neighbours
  // grow less and are pushed outward, and a squeezed ring further out gives the room back. At LENS_R every cell is
  // exactly where and how big the map draws it, so the lens needs no rim.
  //
  // Along a ray from the pointer, with u the distance in cells, the local scale is
  //   σ(u) = 1 + (M − 1)·bump(u) − κ·squeeze(u)
  // and a cell lands at f(u) = ∫σ. κ is set so that the two terms cancel over the lens, which makes f(U) = U;
  // κ stays below 1, so σ > 0 and neighbours never swap places.
  /** the hovered sprite on screen, in CSS px: four screen pixels per sprite pixel */
  const LENS_PX = 64
  /** beyond this many CSS px from the pointer the map is untouched */
  const LENS_R = 224
  /** the lens canvas: the radius plus room for the cells that straddle it */
  const LENS_BOX = 2 * (LENS_R + 32)
  /** the lens fades out between these zooms: the sprites there are nearly LENS_PX already */
  const LENS_FADE = [48, 56] as const
  /**
   * The colour layer below has no lens, so leaving it the hovered sprite grows out of its own cell (no lens at
   * the first zoom) and only reaches LENS_PX by the end of this range, instead of jumping straight to 16×.
   */
  const LENS_RAMP = [4, 11] as const
  const lensTarget = (z: number) => z + (LENS_PX - z) * smooth(LENS_RAMP[0], LENS_RAMP[1], z)
  const LENS_EASE_MS = 120
  const LENS_EASE_STEPS = 4
  /** cells drawn smaller than this come from the 4 px thumbnails, as the map itself does at that size */
  const LENS_THUMB_BELOW = 12
  const LENS_INK = '#07060c'
  const LENS_GOLD = '#ffcc4d'
  /** in cells: the bump is flat this far out, so the hovered sprite keeps its full size while the pointer is on it */
  const BUMP_FLAT = 0.45
  const BUMP_END = 3.2
  const SQUEEZE_FROM = 2
  /** the squeeze rises over this share of its span, then tails off all the way to LENS_R */
  const SQUEEZE_RISE = 0.1
  const SQUEEZE_MAX = 0.85
  const bump = (u: number) => (u <= BUMP_FLAT ? 1 : u >= BUMP_END ? 0 : (1 - smooth(2, BUMP_END, u)) / (1 + ((u - BUMP_FLAT) / 0.79) ** 1.17))
  const BUMP_STEPS = 128
  /** ∫ bump from 0, sampled across [0, BUMP_END] */
  const bumpSum = new Float32Array(BUMP_STEPS + 1)
  for (let i = 0; i < BUMP_STEPS; i++) {
    let sum = 0
    for (let j = 0; j < 8; j++) sum += bump(((i + (j + 0.5) / 8) * BUMP_END) / BUMP_STEPS)
    bumpSum[i + 1] = bumpSum[i] + (sum / 8) * (BUMP_END / BUMP_STEPS)
  }
  const BUMP_AREA = bumpSum[BUMP_STEPS]
  const bumpArea = (u: number) => {
    if (u >= BUMP_END) return BUMP_AREA
    const t = (u / BUMP_END) * BUMP_STEPS
    const i = Math.floor(t)
    return bumpSum[i] + (bumpSum[i + 1] - bumpSum[i]) * (t - i)
  }
  /** the squeeze profile at x in 0…1 of its span, and the share of its area that lies before x */
  let squeezeAt = 0
  let squeezeBefore = 0
  function squeeze(x: number) {
    if (x <= 0) {
      squeezeAt = squeezeBefore = 0
    } else if (x < SQUEEZE_RISE) {
      const t = x / SQUEEZE_RISE
      squeezeAt = t * t * (3 - 2 * t)
      squeezeBefore = 2 * SQUEEZE_RISE * (t * t * t - (t * t * t * t) / 2)
    } else if (x < 1) {
      const t = (x - SQUEEZE_RISE) / (1 - SQUEEZE_RISE)
      squeezeAt = 1 - t * t * (3 - 2 * t)
      squeezeBefore = SQUEEZE_RISE + 2 * (1 - SQUEEZE_RISE) * (t - t * t * t + (t * t * t * t) / 2)
    } else {
      squeezeAt = 0
      squeezeBefore = 1
    }
  }

  /** M − 1 for a zoom: the hovered sprite ends up LENS_PX wide, less and less so as the map nears that size by itself */
  const lensGain = (z: number) => (z < LENS_RAMP[0] || z >= LENS_FADE[1] ? 0 : Math.max(0, lensTarget(z) / z - 1) * (1 - smooth(LENS_FADE[0], LENS_FADE[1], z)))

  // the lens as it is set up right now (lensSetup), and what lensAt() last worked out
  let lensM1 = 0
  let lensSpan = 1
  let lensKappa = 0
  /** in cells: past this the cells have moved by less than half a pixel and are left to the map */
  let lensReach = 0
  /** how far from the pointer a cell is drawn, as a multiple of its real distance */
  let lensPush = 1
  /** how big a cell is drawn, as a multiple of its real size */
  let lensSize = 1
  function lensSetup(z: number, strength: number) {
    lensSpan = LENS_R / z - SQUEEZE_FROM
    // (the cap is never reached with the constants above; it is what keeps σ positive if they change)
    lensM1 = Math.min(lensGain(z) * strength, (SQUEEZE_MAX * lensSpan) / (2 * BUMP_AREA))
    lensKappa = (lensM1 * BUMP_AREA * 2) / lensSpan
    let lo = 0
    let hi = 1
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      squeeze(mid)
      if (lensM1 * BUMP_AREA * (1 - squeezeBefore) * z > 0.5) lo = mid
      else hi = mid
    }
    lensReach = Math.max(BUMP_END, SQUEEZE_FROM + hi * lensSpan)
  }
  function lensAt(u: number) {
    const b = bump(u)
    squeeze((u - SQUEEZE_FROM) / lensSpan)
    lensPush = u > 1e-4 ? 1 + (lensM1 * (bumpArea(u) - BUMP_AREA * squeezeBefore)) / u : 1 + lensM1
    const sigma = 1 + lensM1 * b - lensKappa * squeezeAt
    // A square cell cannot follow the stretch around the pointer and the squeeze along the ray at once. Next to the
    // pointer it keeps close to the scale along the ray, so neighbours touch; further out it leans towards the
    // stretch, so the squeezed ring overlaps like roof tiles instead of leaving dark gaps.
    const lean = 0.2 + 0.65 * smooth(1.25, 3, u)
    lensSize = Math.max(1, 1 + lensM1 * b, sigma ** (1 - lean) * lensPush ** lean)
  }
  /** how far below the pointer the tooltip goes: past the hovered sprite and its first ring */
  function lensTipGap() {
    lensSetup(cam.z, 1)
    lensAt(1)
    return Math.round((lensPush + lensSize / 2) * cam.z) + 10
  }

  // ---- lens: what it draws from ----
  // Two small sheets hold the cells around the pointer, each on the dark wash of its own colour that the map puts
  // behind a sprite: thumbnails at 4 px a cell for the far field, sprites at 16 px for everything drawn large.
  const THUMB_REACH = Math.ceil(LENS_R / 4) + 1
  const SPRITE_REACH = Math.ceil(LENS_R / LENS_THUMB_BELOW) + 1
  const THUMB_SIDE = THUMB_REACH * 2 + 1
  const sheet = (side: number) => {
    const c = document.createElement('canvas')
    c.width = c.height = side
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    return { canvas: c, ctx }
  }
  const washSheet = sheet(THUMB_SIDE)
  const thumbSheet = sheet(THUMB_SIDE * 4)
  const spriteSheet = sheet((SPRITE_REACH * 2 + 1) * 16)
  const washData = washSheet.ctx.createImageData(THUMB_SIDE, THUMB_SIDE)
  /** per cell of the wash sheet: 1 where the cell is on the hovered land */
  const lensOwn = new Uint8Array(THUMB_SIDE * THUMB_SIDE)
  const loupeTiles = new Map<number, ImageBitmap>()
  const loupePending = new Set<number>()
  const loupeMissing = new Set<number>()
  let lensTilesVersion = 0
  /** a tile for the sheets, or null while it is on its way (or when `ask` is off and the lens does not hold it) */
  function lensTile(level: 1 | 2, tx: number, ty: number, ask = true) {
    const key = level * 65536 + ty * 256 + tx
    const have = loupeTiles.get(key)
    // (a bitmap the tile cache has evicted is closed and reports no width)
    if (have?.width) return have
    loupeTiles.delete(key)
    if (!ask || loupePending.has(key) || loupeMissing.has(key)) return null
    loupePending.add(key)
    tileBitmap(level, tx, ty).then((bitmap) => {
      loupePending.delete(key)
      if (!bitmap) loupeMissing.add(key)
      if (!bitmap?.width) return
      loupeTiles.set(key, bitmap)
      lensTilesVersion++
    })
    return null
  }

  // the sheets as they were last built: around which cell, on which land, how many cells out, with which tiles
  let sheetCell = -1
  let sheetLand = -2
  let sheetWash = 0
  let sheetThumbs = -1
  let sheetSprites = -1
  let sheetTiles = -1
  /** let go of a tile the sheets no longer reach (all of them once the lens has been away for a while) */
  function dropLensTile(bitmap: ImageBitmap, key: number) {
    const level = Math.floor(key / 65536)
    const n = level === 1 ? meta.l1.cells : meta.l2.cells
    const reach = level === 1 ? sheetThumbs : sheetSprites
    const tx = key % 256
    const ty = Math.floor(key / 256) % 256
    const hx = sheetCell % SIDE
    const hy = Math.floor(sheetCell / SIDE)
    if (sheetCell >= 0 && bitmap.width && (tx + 1) * n > hx - reach && tx * n <= hx + reach && (ty + 1) * n > hy - reach && ty * n <= hy + reach) return
    // (level 1 bitmaps are not kept by the atlas cache, so the lens owns the ones it asked for)
    if (level === 1 && bitmap.width) bitmap.close()
    loupeTiles.delete(key)
  }
  /** paint one level's tiles over the wash; a tile that is not here yet falls back to the coarser one, then to flat colour */
  function fillSheet(to: CanvasRenderingContext2D, level: 1 | 2, x0: number, y0: number, reach: number) {
    const px = level === 1 ? 4 : 16
    const n = level === 1 ? meta.l1.cells : meta.l2.cells
    const nt = level === 1 ? meta.l1.tiles : meta.l2.tiles
    const n1 = meta.l1.cells
    const side = reach * 2 + 1
    const from = THUMB_REACH - reach
    to.clearRect(0, 0, side * px, side * px)
    to.drawImage(washSheet.canvas, from, from, side, side, 0, 0, side * px, side * px)
    for (let ty = Math.max(0, Math.floor(y0 / n)); ty <= Math.min(nt - 1, Math.floor((y0 + side - 1) / n)); ty++)
      for (let tx = Math.max(0, Math.floor(x0 / n)); tx <= Math.min(nt - 1, Math.floor((x0 + side - 1) / n)); tx++) {
        const ax = Math.max(x0, tx * n)
        const ay = Math.max(y0, ty * n)
        // (the last level 1 tile runs past the edge of the grid)
        const w = Math.min(x0 + side, (tx + 1) * n, SIDE) - ax
        const h = Math.min(y0 + side, (ty + 1) * n, SIDE) - ay
        if (w <= 0 || h <= 0) continue
        const bitmap = lensTile(level, tx, ty)
        // (a level 2 tile always sits inside one level 1 tile)
        const coarse = bitmap || level === 1 ? null : lensTile(1, Math.floor(ax / n1), Math.floor(ay / n1), false)
        if (bitmap) to.drawImage(bitmap, (ax - tx * n) * px, (ay - ty * n) * px, w * px, h * px, (ax - x0) * px, (ay - y0) * px, w * px, h * px)
        else if (coarse) to.drawImage(coarse, (ax % n1) * 4, (ay % n1) * 4, w * 4, h * 4, (ax - x0) * px, (ay - y0) * px, w * px, h * px)
        else to.drawImage(ovCanvas, ax, ay, w, h, (ax - x0) * px, (ay - y0) * px, w * px, h * px)
      }
  }
  function buildSheets(cell: number, land: number, thumbs: number, sprites: number) {
    const hx = cell % SIDE
    const hy = Math.floor(cell / SIDE)
    const reach = Math.max(thumbs, sprites)
    if (cell !== sheetCell || land !== sheetLand || reach > sheetWash) {
      // Well inside a land nothing needs testing: within a piece pieceDist() changes by less than three per cell
      // (the core island is the exception, its wobble is steep near the middle, so it goes by radius).
      const far = reach * Math.SQRT2 + 1
      const fromMiddle = Math.hypot(hx + 0.5 - D, hy + 0.5 - D)
      const inland = land > 0 ? pieceDist(hx + 0.5 - D, hy + 0.5 - D, land) < -3 * far : fromMiddle + far < (land === 0 ? RC - R * 0.08 : R)
      const data = washData.data
      for (let j = THUMB_REACH - reach; j <= THUMB_REACH + reach; j++)
        for (let i = THUMB_REACH - reach; i <= THUMB_REACH + reach; i++) {
          const o = j * THUMB_SIDE + i
          const x = hx - THUMB_REACH + i
          const y = hy - THUMB_REACH + j
          let own = x >= 0 && y >= 0 && x < SIDE && y < SIDE
          if (own && !inland) own = land >= 0 ? pieceDist(x + 0.5 - D, y + 0.5 - D, land) <= 0 : Math.hypot(x + 0.5 - D, y + 0.5 - D) < R
          // (the pointer is on the hovered cell even where the middle of that cell is off the land)
          if (i === THUMB_REACH && j === THUMB_REACH) own = true
          lensOwn[o] = own ? 1 : 0
          if (!own) {
            data[o * 4 + 3] = 0
            continue
          }
          // the same dark wash of its own colour that the map puts behind each sprite
          const q = (y * SIDE + x) * 4
          const keep = 1 - (overview.px[q + 3] / 255) * 0.4
          data[o * 4] = 7 * keep + overview.px[q] * 0.16
          data[o * 4 + 1] = 6 * keep + overview.px[q + 1] * 0.16
          data[o * 4 + 2] = 12 * keep + overview.px[q + 2] * 0.16
          data[o * 4 + 3] = 255
        }
      washSheet.ctx.putImageData(washData, 0, 0, THUMB_REACH - reach, THUMB_REACH - reach, reach * 2 + 1, reach * 2 + 1)
      sheetWash = reach
    }
    sheetCell = cell
    sheetLand = land
    sheetThumbs = thumbs
    sheetSprites = sprites
    loupeTiles.forEach(dropLensTile)
    if (thumbs) fillSheet(thumbSheet.ctx, 1, hx - thumbs, hy - thumbs, thumbs)
    fillSheet(spriteSheet.ctx, 2, hx - sprites, hy - sprites, sprites)
    // (a tile that arrives later bumps the version, and the sheets are built again with it)
    sheetTiles = lensTilesVersion
  }

  // ---- lens: drawing ----
  /** eased strength, 0…1 */
  let lensOn = 0
  let lensTick = 0
  let lensHiddenAt = 0
  /** where the lens is centred, in disc cells, and the cell and land under that point */
  let lensWX = 0
  let lensWY = 0
  let lensCell = -1
  let lensLand = -2
  /** device pixels per CSS px of the lens canvas */
  let lensScale = 0
  /** true while the lens has redrawn the selected cell somewhere else than the map has it */
  let lensHoldsSelected = false
  /** everything the last drawing depended on; nothing is redrawn while it all stays the same */
  const LENS_STATE = 18
  const lensDrawn = new Float64Array(LENS_STATE)
  const lensNow = new Float64Array(LENS_STATE)
  // the vignette the map shader multiplies in, as a gradient over the unit square of the view: 1 − 0.8·d²
  const lensVignette = loupeCtx.createRadialGradient(0, 0, 0, 0, 0, 0.8)
  for (let i = 0; i <= 8; i++) lensVignette.addColorStop(i / 8, `rgba(0,0,0,${(0.8 * ((0.8 * i) / 8) ** 2).toFixed(4)})`)

  // one drawing pass, set up by drawLens()
  let passZ = 1
  let passCos = 1
  let passSin = 0
  let passX = 0
  let passY = 0
  let passDim = 0
  let passGrid = 0
  let passLine = 1
  let passHx = 0
  let passHy = 0
  let passRings = 0
  let cellX = 0
  let cellY = 0
  let cellW = 0
  let cellH = 0
  let cellU = 0
  /** a CSS px offset inside the lens canvas → device px. Whole CSS px wherever the screen has whole device px for them. */
  const lensPx = (v: number) => (Number.isInteger(lensScale) ? Math.round(v) * lensScale : Math.round(v * lensScale))
  /** where the lens puts a cell: false when it leaves the cell to the map */
  function lensRect(x: number, y: number) {
    const dx = x + 0.5 - lensWX
    const dy = y + 0.5 - lensWY
    cellU = Math.sqrt(dx * dx + dy * dy)
    if (cellU >= lensReach || Math.abs(x - passHx) > passRings || Math.abs(y - passHy) > passRings) return false
    if (!lensOwn[(y - passHy + THUMB_REACH) * THUMB_SIDE + x - passHx + THUMB_REACH]) return false
    lensAt(cellU)
    const half = (lensSize * passZ) / 2
    const cx = passX + (passCos * dx + passSin * dy) * passZ * lensPush
    const cy = passY + (passCos * dy - passSin * dx) * passZ * lensPush
    cellX = lensPx(cx - half)
    cellY = lensPx(cy - half)
    cellW = lensPx(cx + half) - cellX
    cellH = lensPx(cy + half) - cellY
    return cellW > 0 && cellH > 0
  }
  function lensCellDraw(x: number, y: number) {
    if (!lensRect(x, y)) return
    const ctx = loupeCtx
    const dx = x - passHx
    const dy = y - passHy
    if (lensSize * passZ >= LENS_THUMB_BELOW && Math.abs(dx) <= sheetSprites && Math.abs(dy) <= sheetSprites)
      ctx.drawImage(spriteSheet.canvas, (dx + sheetSprites) * 16, (dy + sheetSprites) * 16, 16, 16, cellX, cellY, cellW, cellH)
    else if (sheetThumbs) ctx.drawImage(thumbSheet.canvas, (dx + sheetThumbs) * 4, (dy + sheetThumbs) * 4, 4, 4, cellX, cellY, cellW, cellH)
    // the map's one-pixel cell lines, along the left and the top of every cell
    if (passGrid > 0 && cellW > passLine && cellH > passLine) {
      ctx.globalAlpha = passGrid
      ctx.fillRect(cellX, cellY, cellW, passLine)
      ctx.fillRect(cellX, cellY + passLine, passLine, cellH - passLine)
      ctx.globalAlpha = 1
    }
    // near the pointer the search dim lifts with the bump, so what is being looked at stays bright
    if (passDim > 0) {
      const dim = passDim * (1 - bump(cellU))
      if (dim > 0.01) {
        ctx.globalAlpha = dim
        ctx.fillRect(cellX, cellY, cellW, cellH)
        ctx.globalAlpha = 1
      }
    }
  }
  /** the gold marks the map draws as overlays: search hits, the selected cell, the hovered cell */
  function lensCellMark(x: number, y: number) {
    const cell = y * SIDE + x
    const hit = lensHits?.has(cell)
    const hovered = x === passHx && y === passHy
    if (!hit && !hovered && cell !== selected) return
    if (!lensRect(x, y)) return
    const ctx = loupeCtx
    const px = passLine
    if (hit) {
      // as on the map: a frame a little larger than the cell, or a solid block while the cell is too small for one
      const pad = Math.round((cellW * 0.1) / px) * px
      if (cellW < 10 * px) ctx.fillRect(cellX, cellY, Math.max(cellW, 3 * px), Math.max(cellH, 3 * px))
      else lensFrame(cellX - pad, cellY - pad, cellW + 2 * pad, cellH + 2 * pad, 2 * px, 0)
    }
    if (cell === selected) lensFrame(cellX - 6 * px, cellY - 6 * px, cellW + 12 * px, cellH + 12 * px, 3 * px, 10 * px)
    else if (hovered) lensFrame(cellX, cellY, cellW, cellH, 2 * px, 0)
  }
  /** a frame of the given thickness, or only its corners when `corner` gives their length */
  function lensFrame(x: number, y: number, w: number, h: number, t: number, corner: number) {
    const ctx = loupeCtx
    if (!corner) {
      ctx.fillRect(x, y, w, t)
      ctx.fillRect(x, y + h - t, w, t)
      ctx.fillRect(x, y + t, t, h - 2 * t)
      ctx.fillRect(x + w - t, y + t, t, h - 2 * t)
      return
    }
    for (let i = 0; i < 4; i++) {
      const cx = i & 1 ? x + w - corner : x
      const cy = i & 2 ? y + h - corner : y
      ctx.fillRect(cx, i & 2 ? y + h - t : y, corner, t)
      ctx.fillRect(i & 1 ? x + w - t : x, cy, t, corner)
    }
  }
  /** every cell of a square ring around the hovered cell, once */
  function lensRing(ring: number, each: (x: number, y: number) => void) {
    if (!ring) {
      each(passHx, passHy)
      return
    }
    for (let i = -ring; i < ring; i++) {
      each(passHx + i, passHy - ring)
      each(passHx + ring, passHy + i)
      each(passHx - i, passHy + ring)
      each(passHx - ring, passHy - i)
    }
  }

  function drawLens(strength: number, left: number, top: number, fx: number, fy: number) {
    const ctx = loupeCtx
    const z = cam.z
    const size = Math.round(LENS_BOX * lensScale)
    if (loupeCanvas.width !== size) {
      loupeCanvas.width = loupeCanvas.height = size
      loupeCanvas.style.width = loupeCanvas.style.height = `${LENS_BOX}px`
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, size, size)

    // the sheets cover what the lens reaches at full strength, so they are not rebuilt while it eases in
    lensSetup(z, 1)
    const reach = Math.min(THUMB_REACH, Math.ceil(lensReach) + 1)
    let sprites = reach
    let thumbs = 0
    if (z < LENS_THUMB_BELOW) {
      thumbs = reach
      sprites = 1
      for (let u = 1; u < reach && u < SPRITE_REACH; u += 0.5) {
        lensAt(u)
        if (lensSize * z >= LENS_THUMB_BELOW) sprites = Math.ceil(u) + 1
      }
    }
    sprites = Math.min(sprites, SPRITE_REACH)
    if (lensCell !== sheetCell || lensLand !== sheetLand || thumbs !== sheetThumbs || sprites !== sheetSprites || lensTilesVersion !== sheetTiles)
      buildSheets(lensCell, lensLand, thumbs, sprites)

    lensSetup(z, strength)
    // (the pointer is inside the hovered cell, so a cell k rings out is at least k − ½ cells away)
    passRings = Math.min(reach, Math.ceil(lensReach + 0.5))
    passZ = z
    passCos = Math.cos(cam.a)
    passSin = Math.sin(cam.a)
    passX = fx - left
    passY = fy - top
    passHx = lensCell % SIDE
    passHy = Math.floor(lensCell / SIDE)
    passLine = Math.max(1, Math.round(lensScale))
    passDim = 0
    // (the map's cell lines fade in between 6 and 16 px a cell; while they are faint they are not worth two rectangles a cell)
    passGrid = smooth(6, 16, z) * 0.6 * 0.65
    if (passGrid < 0.2) passGrid = 0

    // 1. Hide the map under every cell the lens is about to move, row by row.
    ctx.fillStyle = LENS_INK
    for (let y = passHy - passRings; y <= passHy + passRings; y++) {
      const dy = y + 0.5 - lensWY
      const chord = lensReach * lensReach - dy * dy
      if (chord <= 0) continue
      const span = Math.sqrt(chord)
      const xa = Math.max(passHx - passRings, Math.ceil(lensWX - span - 0.5))
      const xb = Math.min(passHx + passRings, Math.floor(lensWX + span - 0.5))
      const y0 = lensPx(passY + (y - lensWY) * z)
      const y1 = lensPx(passY + (y + 1 - lensWY) * z)
      let run = -1
      for (let x = xa; x <= xb + 1; x++) {
        const own = x <= xb && lensOwn[(y - passHy + THUMB_REACH) * THUMB_SIDE + x - passHx + THUMB_REACH] === 1
        if (own && run < 0) run = x
        else if (!own && run >= 0) {
          const x0 = lensPx(passX + (run - lensWX) * z)
          ctx.fillRect(x0, y0, lensPx(passX + (x - lensWX) * z) - x0, y1 - y0)
          run = -1
        }
      }
    }

    // 2. The cells, from the outside in, so that whatever is nearer the pointer lies on top.
    ctx.fillStyle = '#000'
    for (let ring = passRings; ring >= 0; ring--) {
      // every cell the bump reaches is within three rings; the rest dims as one, exactly like the map around it
      if (ring === 3 && mapDim > 0.01) {
        ctx.globalCompositeOperation = 'source-atop'
        ctx.globalAlpha = mapDim
        ctx.fillRect(0, 0, size, size)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        passDim = mapDim
      }
      lensRing(ring, lensCellDraw)
    }

    // 3. The map's vignette, over what has been painted and nothing else.
    ctx.globalCompositeOperation = 'source-atop'
    ctx.setTransform(W * lensScale, 0, 0, Hh * lensScale, (W / 2 - left) * lensScale, (Hh / 2 - top) * lensScale)
    ctx.fillStyle = lensVignette
    ctx.fillRect(-1, -1, 2, 2)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'

    // 4. The gold marks, which the map also draws on top of everything.
    ctx.fillStyle = LENS_GOLD
    if (lensHits) for (let ring = passRings; ring > 0; ring--) lensRing(ring, lensCellMark)
    else if (selected >= 0 && selected !== lensCell) lensCellMark(selected % SIDE, Math.floor(selected / SIDE))
    lensCellMark(passHx, passHy)
    lensHoldsSelected = selected >= 0 && lensRect(selected % SIDE, Math.floor(selected / SIDE))
  }

  function hideLoupe() {
    lensOn = 0
    lensHoldsSelected = false
    if (!loupe.hidden) {
      loupe.hidden = true
      lensHiddenAt = lensTick
    }
    // the tiles stay for a moment, so the lens comes back whole when the pointer only crossed a strait
    if (loupeTiles.size && lensTick - lensHiddenAt > 8000) {
      sheetCell = -1
      loupeTiles.forEach(dropLensTile)
    }
  }

  function updateLoupe() {
    const now = performance.now()
    const dt = now - lensTick
    lensTick = now
    const z = cam.z
    // gone at once whenever the map itself is on the move, or where there is no lens at all
    const turned = Math.abs(Math.sin(cam.a)) > 0.02 || Math.cos(cam.a) < 0
    if (!fine.matches || touch || pointerIsTouch || lensGain(z) * z < 1 || turned || drag?.moved || pinch || flight || gathered) {
      hideLoupe()
      return
    }
    // (a press that may still be a click keeps the lens as it is)
    const held = !!drag
    const want = held ? lensOn > 0 : mouse.inside && hoverCell >= 0
    if (want && !held) {
      const [wx, wy] = toWorld(mouse.x, mouse.y)
      lensWX = wx
      lensWY = wy
      lensCell = hoverCell
      lensLand = mapE > 0.5 ? pieceOf(wx, wy) : -1
    }
    if (!held) {
      const step = reducedMotion ? 1 : dt / LENS_EASE_MS
      lensOn = want ? Math.min(1, lensOn + step) : Math.max(0, lensOn - step)
    }
    if (lensOn <= 0 || lensCell < 0) {
      hideLoupe()
      return
    }
    // stepped, like every other transition here
    const strength = Math.ceil(lensOn * LENS_EASE_STEPS) / LENS_EASE_STEPS
    const scale = Math.min(3, window.devicePixelRatio || 1)
    const [fx, fy] = mapToScreen(lensWX + (lensLand > 0 ? LANDS[lensLand].ox * mapE : 0), lensWY + (lensLand > 0 ? LANDS[lensLand].oy * mapE : 0))
    // on whole CSS px where the screen allows it, like the map's own pixels
    const grid = Number.isInteger(scale) ? 1 : scale
    const left = Math.round((fx - LENS_BOX / 2) * grid) / grid
    const top = Math.round((fy - LENS_BOX / 2) * grid) / grid
    const s = lensNow
    s[0] = fx
    s[1] = fy
    s[2] = cam.x
    s[3] = cam.y
    s[4] = z
    s[5] = cam.a
    s[6] = strength
    s[7] = lensTilesVersion
    s[8] = selected
    s[9] = Math.round(mapDim * 64)
    s[10] = lensHitsVersion
    s[11] = W
    s[12] = Hh
    s[13] = scale
    s[14] = lensCell
    s[15] = lensLand
    s[16] = lensWX
    s[17] = lensWY
    let same = !loupe.hidden
    for (let i = 0; same && i < LENS_STATE; i++) same = s[i] === lensDrawn[i]
    if (same) return
    lensDrawn.set(s)
    lensScale = scale
    loupe.hidden = false
    loupe.style.transform = `translate(${left}px, ${top}px)`
    drawLens(strength, left, top, fx, fy)
  }

  // ---- frame ------------------------------------------------------------------------------
  let raf = 0
  let active = false
  let last = performance.now()
  const t0 = last
  let readoutAt = 0
  let lodShown = -1

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
      if (gathered) requestAnimationFrame(() => gathered && openGather(gatherCells))
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
    gatherK += ((gathered ? 1 : 0) - gatherK) * Math.min(1, dt * 9)
    mapDim = Math.max(hitCount ? 0.5 * (1 - smooth(10, 30, z)) : 0, 0.74 * gatherK)
    gl!.uniform1f(u.uDim, mapDim)
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
    updateHover()
    updateLoupe()
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
    // (the lens marks the hovered and the selected cell itself, where it has moved them to)
    place(reticle, lensHoldsSelected ? -1 : selected, 12)
    place(hoverBox, loupe.hidden && z >= 10 && hoverCell !== selected ? hoverCell : -1, 0)
    if (!tip.hidden && !gHover) {
      if (hoverCell !== capFor || hoverCell < 0) tip.hidden = true
      else if (loupe.hidden) tip.style.transform = `translate(${Math.min(mouse.x + 18, W - 300)}px, ${mouse.y + 20}px)`
      else {
        // clear of the magnified sprite and its first ring: below them, or above when there is no room
        const gap = lensTipGap()
        const below = mouse.y + gap + tip.offsetHeight <= Hh - 8
        tip.style.transform = `translate(${Math.min(mouse.x + 18, W - 300)}px, ${below ? mouse.y + gap : mouse.y - gap - tip.offsetHeight}px)`
      }
    }

    if (MAP_ON) {
      const show = mapE > 0.7 && z < zHome() * 3.4 && !hitCount && !gathered
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
      updateReadout()
    }
  }

  function updateReadout() {
    const z = cam.z
    const atMax = W > 50 && Hh > 50 && z >= zMax() * 0.985
    const lod = z < 1.9 ? 0 : z < 4 ? 1 : z < 12 ? 2 : 3
    if (lod !== lodShown) {
      lodShown = lod
      lodButtons.forEach((b, i) => {
        b.setAttribute('aria-pressed', String(i === lod))
      })
    }
    if (viewAction() !== viewShown) {
      viewShown = viewAction()
      renderViewButton()
    }
    const vw = Math.round(W / z)
    const vh = Math.round(Hh / z)
    const lv = lod === 3 ? L2 : L1
    tech.textContent = t('hero.tech', {
      w: fmt(Math.min(vw, SIDE)),
      h: fmt(Math.min(vh, SIDE)),
      tiles: lod >= 2 ? t('hero.tiles', { loaded: lv.loaded, slots: lv.slots }) : '',
      mb: (bytesDownloaded() / 1e6).toFixed(1),
    })
    if (!hintDismissed)
      hint.textContent = atMax
        ? t('hero.hint.full')
        : z < zFit() * 3.2
          ? touch
            ? t('hero.hint.touch')
            : mapE > 0.5
              ? t('hero.hint.map')
              : t('hero.hint.planet')
          : z < 8
            ? t('hero.hint.again')
            : touch
              ? t('hero.hint.pan')
              : t('hero.hint.max')
    intro.style.opacity = String(1 - smooth(1.4, 3, z / zFit()))
    if (MAP_ON) {
      // the plate: full on arrival, one line while exploring; the breadcrumb says where the view centre is
      el.classList.toggle('is-exploring', isAway())
      const here =
        mapE < 0.5
          ? -2
          : (() => {
              const p = discOf(cam.x, cam.y)
              return p ? pieceOf(p[0], p[1]) : -1
            })()
      const key = `${here}|${z >= 8}`
      if (key !== crumbKey) {
        crumbKey = key
        crumb.innerHTML =
          here === -2
            ? t('hero.crumb.planetHtml')
            : t('hero.crumb.mapHtml', {
                land: here < 0 ? t('hero.crumb.sea') : `<button type="button" data-go="${here}">${escapeHtml(LANDS[here].name())}</button>`,
                sprite: z >= 8 ? t('hero.crumb.spriteHtml') : '',
              })
      }
    }
    el.classList.toggle('is-deep', z > 12)
  }
  onLocaleChange(() => {
    landText.forEach((update) => {
      update()
    })
    if (selected >= 0 && cardReady) renderCard()
    statusCopy()
    renderBatch()
    subjectText.forEach((update) => {
      update()
    })
    gItems.forEach((item, i) => {
      item.el.setAttribute('aria-label', t('hero.resultLabel', { n: i + 1 }))
    })
    tray.querySelectorAll('button').forEach((button) => {
      button.title = t('hero.fly')
    })
    crumbKey = ''
    // (the static markup was just reset to its opening labels)
    viewShown = ''
    updateReadout()
  })

  const loop = () => {
    frame()
    if (active) raf = requestAnimationFrame(loop)
  }

  cam.z = tgtZ = 0.0001
  return {
    id: 'hero',
    num: '00',
    title: () => t('nav.atlas'),
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
      mouse.inside = false
      hideLoupe()
      input.blur()
    },
    focusSearch() {
      input.focus()
      input.select()
    },
  }
}
