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
uniform vec2 uN;   // tiles per side for l1, l2
out vec4 o;

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

void main() {
  vec2 f = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = (f - uRes * 0.5) / uZoom;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 w = uW + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  vec2 gx = dFdx(w), gy = dFdy(w);
  vec2 D = vec2(uSide * 0.5);
  vec2 rel = w - D;
  float r = length(rel);

  // space: sparse twinkling pixel stars
  vec2 sp = floor(f / 2.0);
  float st = step(0.9982, hash(sp)) * (0.45 + 0.55 * sin(uTime * 1.7 + hash(sp + 7.0) * 40.0));
  vec3 bg = vec3(0.027, 0.024, 0.047) + st * vec3(0.75, 0.78, 1.0);

  // LOD0 — overview stores rgb=0 outside the disc, so its mips are premultiplied
  vec4 ov = textureGrad(uOv, w / uSide, gx / uSide, gy / uSide);
  vec3 far = bg * (1.0 - ov.a) + ov.rgb;

  // pixel-art sphere shading on the far view: lambert, quantised with Bayer dither
  if (uShade > 0.0 && r < uR) {
    vec2 q = vec2(c * rel.x + s * rel.y, -s * rel.x + c * rel.y) / uR;  // screen-space offset
    vec3 nrm = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
    float lam = clamp(dot(nrm, normalize(vec3(-0.55, -0.6, 0.75))), 0.0, 1.0);
    float lv = floor(lam * 5.0 + bayer4(floor(f / 2.0))) / 5.0;
    far *= mix(1.0, 0.42 + 0.78 * lv, uShade * 0.75);
    float lum = dot(far, vec3(0.299, 0.587, 0.114));
    far = max(vec3(0.0), mix(vec3(lum), far, 1.0 + 0.35 * uShade));
  }
  // atmosphere: the rim colour bleeds out into space
  if (r > uR * 0.985) {
    vec3 rim = textureLod(uOv, (D + rel / r * uR * 0.94) / uSide, 4.0).rgb;
    float k = exp(-max(r - uR, 0.0) / (uR * 0.07)) * smoothstep(uR * 0.985, uR * 1.004, r);
    float band = floor(k * 6.0 + bayer4(floor(f / 3.0)) * 0.9) / 6.0;
    far += rim * band * 0.75;
  }

  vec3 col = far;
  if (uM1 > 0.0) {
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
  if (uCellGrid > 0.0) {
    vec2 fc = fract(w);
    float px = 1.0 / uZoom;
    float l = max(step(fc.x, px), step(fc.y, px));
    col = mix(col, col * 0.35, l * uCellGrid);
  }
  if (uGrid > 0.0) {
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

const HIT_VERT = `#version 300 es
uniform vec2 uRes;
uniform vec2 uW;
uniform float uZoom;
uniform float uAngle;
in vec2 aCorner;
in vec2 aCell;
out vec2 vUv;
out float vPhase;
void main() {
  float size = max(1.0, 3.0 / uZoom) * (uZoom > 10.0 ? 1.2 : 1.0);
  vec2 w = aCell + 0.5 + (aCorner - 0.5) * size;
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
    ['uRes', 'uW', 'uZoom', 'uAngle', 'uTime', 'uDim', 'uM1', 'uM2', 'uGrid', 'uCellGrid', 'uShade'].map((n) => [n, U(n)]),
  )
  gl.useProgram(hitProg)
  const H = (n: string) => gl.getUniformLocation(hitProg, n)
  const hu = Object.fromEntries(['uRes', 'uW', 'uZoom', 'uAngle', 'uTime'].map((n) => [n, H(n)]))

  // ---- camera ----------------------------------------------------------------------
  /** world point at the screen centre, css px per cell, view rotation */
  const cam = { x: D, y: D, z: 1, a: 0.9 }
  let tgtZ = 1
  let anchor: { sx: number; sy: number; wx: number; wy: number } | null = null
  let flight: { t0: number; dur: number; f: (t: number) => [number, number, number]; a0: number; done?: () => void } | null = null
  const vel = { x: 0, y: 0, a: 0 }
  let W = 1
  let Hh = 1
  const zFit = () => (Math.min(W, Hh) * 0.86) / (2 * R)
  const zMax = () => Math.min(W, Hh) * 0.5
  let lastInput = 0
  let wasAtMax = false

  const toWorld = (sx: number, sy: number): [number, number] => {
    const dx = (sx - W / 2) / cam.z
    const dy = (sy - Hh / 2) / cam.z
    const c = Math.cos(cam.a)
    const s = Math.sin(cam.a)
    return [cam.x + c * dx - s * dy, cam.y + s * dx + c * dy]
  }
  const toScreen = (wx: number, wy: number): [number, number] => {
    const dx = wx - cam.x
    const dy = wy - cam.y
    const c = Math.cos(cam.a)
    const s = Math.sin(cam.a)
    return [(c * dx + s * dy) * cam.z + W / 2, (-s * dx + c * dy) * cam.z + Hh / 2]
  }
  /** rotate the planet on screen by d radians around the disc centre */
  const rotatePlanet = (d: number) => {
    const [sx, sy] = toScreen(D, D)
    cam.a -= d
    const [wx, wy] = toWorld(sx, sy)
    cam.x += D - wx
    cam.y += D - wy
  }
  const clampCam = () => {
    const dx = cam.x - D
    const dy = cam.y - D
    const r = Math.hypot(dx, dy)
    if (r > R) {
      cam.x = D + (dx / r) * R
      cam.y = D + (dy / r) * R
    }
  }

  function zoomAt(factor: number, sx: number, sy: number) {
    const nz = Math.min(zMax(), Math.max(zFit(), tgtZ * factor))
    if (!anchor || Math.abs(anchor.sx - sx) > 2 || Math.abs(anchor.sy - sy) > 2) {
      const [wx, wy] = toWorld(sx, sy)
      anchor = { sx, sy, wx, wy }
    }
    tgtZ = nz
    flight = null
    lastInput = performance.now()
  }

  /** van Wijk & Nuij smooth zoom-and-pan */
  function flyTo(wx: number, wy: number, z1: number, done?: () => void) {
    z1 = Math.min(zMax(), Math.max(zFit(), z1))
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
        flyTo(D, D, zFit())
      } else zoomAt(k === 'in' ? 2.2 : 1 / 2.2, W / 2, Hh / 2)
      sound.click()
    }),
  )
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('is-active') || e.target instanceof HTMLInputElement) return
    if (e.key === '+' || e.key === '=') zoomAt(1.8, W / 2, Hh / 2)
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.8, W / 2, Hh / 2)
    else if (e.key === '0') flyTo(D, D, zFit())
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
    const [cx0, cy0] = toScreen(D, D)
    const rDisc = R * cam.z
    const onRim = Math.hypot(p.x - cx0, p.y - cy0) > rDisc * 0.97 && Math.hypot(p.x - cx0, p.y - cy0) < rDisc * 1.35 + 30
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
      const [wx, wy] = toWorld(pinch.mx, pinch.my)
      cam.z = tgtZ = Math.min(zMax(), Math.max(zFit(), cam.z * (d / pinch.d)))
      const [nx, ny] = toWorld(mx, my)
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
        const [cx, cy] = toScreen(D, D)
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
      const [cx0, cy0] = toScreen(D, D)
      const dd = Math.hypot(p.x - cx0, p.y - cy0)
      canvas.classList.toggle('is-rim', dd > R * cam.z * 0.97 && dd < R * cam.z * 1.35 + 30)
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
      if (cam.z < zFit()) cam.z = tgtZ = zFit()
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
        const k = smooth(zFit() * 3, zFit() * 14, cam.z)
        if (k > 0) {
          const full = Math.round(cam.a / (2 * Math.PI)) * 2 * Math.PI
          cam.a += (full - cam.a) * Math.min(1, dt * 5 * k)
        }
        // idle drift when far away
        const idle = now - lastInput > 2500
        if (idle && !reducedMotion && cam.z < zFit() * 1.6 && Math.abs(vel.a) < 1e-4) rotatePlanet(dt * 0.035)
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
    // ---- streaming
    const corners = [toWorld(0, 0), toWorld(W, 0), toWorld(0, Hh), toWorld(W, Hh)]
    const xs = corners.map((c) => c[0])
    const ys = corners.map((c) => c[1])
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const
    const m1 = smooth(2.2, 4.2, z)
    const m2 = smooth(8.5, 15, z)
    if (z >= 1.9) L1.update(L1.want(...box, cam.x, cam.y), now)
    if (z >= 7) L2.update(L2.want(...box, cam.x, cam.y), now)
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
    gl!.uniform1f(u.uShade, 1 - smooth(1.2, 4, z / zFit()))
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
            : '滚轮缩放 · 拖动平移 · 拖外圈旋转 · 点一下放大'
          : z < 8
            ? '再点一下继续放大 · 滚轮缩放'
            : touch
              ? '拖动平移 · 点素材看详情'
              : '拖动平移 · 点素材看详情 · 再点一次放到最大'
      intro.style.opacity = String(1 - smooth(1.4, 3, z / zFit()))
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
        cam.z = tgtZ = zFit()
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
