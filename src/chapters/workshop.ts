/**
 * 03 · Workshop. One sprite, six small pixel tools — every one of them runs
 * live on the 16×16 data, so playing with them *is* the explanation.
 */
import gsap from 'gsap'
import { sound } from '../audio'
import { hueToward, lchToRgb, type RGB, rgbToLch } from '../color'
import { onLocaleChange, t } from '../i18n'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const N = 20 // working buffer: 16×16 sprite + 2 px padding for outlines/glow
const PAD = 2
const SCALE = 16
type Buf = Uint8ClampedArray
type ToolId = 'depth' | 'light' | 'outline' | 'swap' | 'scale' | 'rotate' | 'juice'

const TOOLS: { id: ToolId; name: string; desc: string }[] = [
  {
    id: 'depth',
    get name() {
      return t('workshop.depth.name')
    },
    get desc() {
      return t('workshop.depth.desc')
    },
  },
  {
    id: 'light',
    get name() {
      return t('workshop.light.name')
    },
    get desc() {
      return t('workshop.light.desc')
    },
  },
  {
    id: 'outline',
    get name() {
      return t('workshop.outline.name')
    },
    get desc() {
      return t('workshop.outline.desc')
    },
  },
  {
    id: 'swap',
    get name() {
      return t('workshop.swap.name')
    },
    get desc() {
      return t('workshop.swap.desc')
    },
  },
  {
    id: 'scale',
    get name() {
      return t('workshop.scale.name')
    },
    get desc() {
      return t('workshop.scale.desc')
    },
  },
  {
    id: 'rotate',
    get name() {
      return t('workshop.rotate.name')
    },
    get desc() {
      return t('workshop.rotate.desc')
    },
  },
  {
    id: 'juice',
    get name() {
      return t('workshop.juice.name')
    },
    get desc() {
      return t('workshop.juice.desc')
    },
  },
]

const hex3 = (h: string): RGB => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
const DEPTHS: { key: string; note: string; palette: RGB[] | null; ramp?: boolean }[] = [
  {
    get key() {
      return t('workshop.depth.original')
    },
    get note() {
      return t('workshop.depth.today')
    },
    palette: null,
  },
  {
    get key() {
      return t('workshop.depth.32')
    },
    get note() {
      return t('workshop.depth.32note')
    },
    palette:
      '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30'
        .split(' ')
        .map(hex3),
  },
  {
    get key() {
      return t('workshop.depth.16')
    },
    get note() {
      return t('workshop.depth.16note')
    },
    palette: '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'.split(' ').map(hex3),
  },
  {
    get key() {
      return t('workshop.depth.4')
    },
    get note() {
      return t('workshop.depth.4note')
    },
    palette: '0f380f 306230 8bac0f c4d82c'.split(' ').map(hex3),
    ramp: true,
  },
  {
    get key() {
      return t('workshop.depth.1')
    },
    get note() {
      return t('workshop.depth.1note')
    },
    palette: [
      [0, 0, 0],
      [255, 255, 255],
    ],
    ramp: true,
  },
]
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5)

const VARIANTS = [
  {
    get name() {
      return t('workshop.swap.original')
    },
  },
  {
    get name() {
      return t('workshop.swap.ice')
    },
    h: 228,
    c: 0.9,
    l: 0.04,
  },
  {
    get name() {
      return t('workshop.swap.poison')
    },
    h: 138,
    c: 1.05,
    l: 0,
  },
  {
    get name() {
      return t('workshop.swap.fire')
    },
    h: 36,
    c: 1.2,
    l: 0.02,
  },
  {
    get name() {
      return t('workshop.swap.shadow')
    },
    h: 296,
    c: 0.55,
    l: -0.12,
  },
  {
    get name() {
      return t('workshop.swap.gold')
    },
    h: 86,
    c: 1.1,
    l: 0.05,
  },
] as { name: string; h?: number; c?: number; l?: number }[]

const pack = (b: Buf, i: number) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]

function scale2x(src: Buf, n: number): Buf {
  const m = n * 2
  const out = new Uint8ClampedArray(m * m * 4)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : pack(src, (y * n + x) * 4))
  const put = (x: number, y: number, v: number) => {
    const o = (y * m + x) * 4
    out[o] = v >>> 24
    out[o + 1] = (v >>> 16) & 255
    out[o + 2] = (v >>> 8) & 255
    out[o + 3] = v & 255
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const P = at(x, y)
      const A = at(x, y - 1)
      const B = at(x + 1, y)
      const C = at(x - 1, y)
      const D = at(x, y + 1)
      put(x * 2, y * 2, C === A && C !== D && A !== B ? A : P)
      put(x * 2 + 1, y * 2, A === B && A !== C && B !== D ? B : P)
      put(x * 2, y * 2 + 1, D === C && D !== B && C !== A ? C : P)
      put(x * 2 + 1, y * 2 + 1, B === D && B !== A && D !== C ? D : P)
    }
  return out
}

export interface Workshop extends Chapter {
  load(sprite: HTMLCanvasElement | ImageData, label: string): void
}

export function createWorkshop(el: HTMLElement, sprites: Sprite[]): Workshop {
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!
  const main = $<HTMLCanvasElement>('.ws-main')
  const fxc = $<HTMLCanvasElement>('.ws-fx')
  const mctx = main.getContext('2d')!
  const fctx = fxc.getContext('2d')!
  const stageEl = $('.ws-stage')
  const sun = $('.ws-sun')
  const extra = $('.ws-extra')
  const nameEl = $('.ws-tool-name')
  const descEl = $('.ws-tool-desc')
  const controls = $('.ws-controls')
  const stat = $('.ws-stat')
  const trayEl = $('.ws-tray')
  const toolNav = $('.ws-tools')
  const labelEl = $('.ws-label')
  // The side panel is the only part of the workshop that scrolls. While more of it sits below
  // the fold the chapter is flagged, and CSS draws a cue over the panel's foot.
  const side = $('.ws-side')
  const flagMore = () => el.classList.toggle('ws-more', side.scrollHeight - side.clientHeight - side.scrollTop > 6)
  side.addEventListener('scroll', flagMore, { passive: true })
  const sideWatch = new ResizeObserver(flagMore)
  sideWatch.observe(side)
  for (const child of side.children) sideWatch.observe(child)
  let labelCopy = () => ''
  let statCopy = () => ''
  const showStat = (copy: () => string) => {
    statCopy = copy
    stat.textContent = copy()
  }
  const controlText = new Map<Node, () => void>()
  function bindText(node: Node, copy: () => string) {
    const update = () => {
      node.textContent = copy()
    }
    controlText.set(node, update)
    update()
    return node
  }

  main.width = main.height = N * SCALE
  fxc.width = fxc.height = N * SCALE
  const off = document.createElement('canvas')
  const octx = off.getContext('2d')!

  let base: Buf = new Uint8ClampedArray(N * N * 4)
  let baseColors = 0
  const height = new Float32Array(N * N)
  const normal = new Float32Array(N * N * 3)
  let tool: ToolId = 'light'
  let out: Buf = base
  let active = false
  let raf = 0

  const st = {
    depth: 2,
    dither: false,
    lx: 4,
    ly: 3,
    lz: 7,
    hueShift: true,
    smooth: false,
    lightAuto: true,
    outline: 'selout',
    shadow: false,
    hue: 0,
    variant: 0,
    angle: 0.5,
    rotAuto: true,
    juice: { stop: true, flash: true, shake: true, knock: true, particles: true, number: true, sound: true },
  }

  // ---- sprite loading -----------------------------------------------------------------
  function load(src: HTMLCanvasElement | ImageData, label: () => string) {
    let data: ImageData
    if (src instanceof ImageData) data = src
    else data = src.getContext('2d')!.getImageData(0, 0, 16, 16)
    base = new Uint8ClampedArray(N * N * 4)
    const colors = new Set<number>()
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const s = (y * 16 + x) * 4
        const d = ((y + PAD) * N + x + PAD) * 4
        if (data.data[s + 3] < 128) continue
        base[d] = data.data[s]
        base[d + 1] = data.data[s + 1]
        base[d + 2] = data.data[s + 2]
        base[d + 3] = 255
        colors.add(pack(base, d))
      }
    baseColors = colors.size
    labelCopy = label
    labelEl.textContent = label()
    computeHeight()
    render()
    if (tool === 'swap') renderVariants()
  }

  function computeHeight() {
    const dist = new Float32Array(N * N)
    for (let i = 0; i < N * N; i++) dist[i] = base[i * 4 + 3] ? 99 : 0
    for (let pass = 0; pass < 2; pass++)
      for (let k = 0; k < N * N; k++) {
        const i = pass ? N * N - 1 - k : k
        if (!dist[i]) continue
        const x = i % N
        const y = (i / N) | 0
        const nb = pass ? [x < N - 1 ? dist[i + 1] : 0, y < N - 1 ? dist[i + N] : 0] : [x > 0 ? dist[i - 1] : 0, y > 0 ? dist[i - N] : 0]
        dist[i] = Math.min(dist[i], nb[0] + 1, nb[1] + 1)
      }
    const raw = new Float32Array(N * N)
    for (let i = 0; i < N * N; i++) {
      if (!dist[i]) continue
      const o = i * 4
      const l = (0.299 * base[o] + 0.587 * base[o + 1] + 0.114 * base[o + 2]) / 255
      raw[i] = Math.sqrt(Math.min(dist[i], 4) / 4) + l * 0.3
    }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x
        if (!dist[i]) {
          height[i] = 0
          continue
        }
        let s = raw[i] * 2
        let w = 2
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
          s += raw[yy * N + xx]
          w++
        }
        height[i] = s / w
      }
    const H = (x: number, y: number) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : height[y * N + x])
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = H(x + 1, y) - H(x - 1, y)
        const gy = H(x, y + 1) - H(x, y - 1)
        const nx = -gx * 2.2
        const ny = -gy * 2.2
        const len = Math.hypot(nx, ny, 1)
        const i = (y * N + x) * 3
        normal[i] = nx / len
        normal[i + 1] = ny / len
        normal[i + 2] = 1 / len
      }
  }

  // ---- drawing -------------------------------------------------------------------------
  function blit(ctx: CanvasRenderingContext2D, buf: Buf, n: number, size: number, opts: { checker?: boolean; grid?: boolean; smooth?: boolean } = {}) {
    off.width = off.height = n
    octx.putImageData(new ImageData(buf as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
    ctx.canvas.width = ctx.canvas.height = size
    const px = size / n
    if (opts.checker !== false) {
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#1a1724' : '#14121c'
          ctx.fillRect(x * px, y * px, px, px)
        }
    }
    ctx.imageSmoothingEnabled = !!opts.smooth
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(off, 0, 0, size, size)
    if (opts.grid && px >= 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      for (let k = 1; k < n; k++) {
        ctx.fillRect(k * px, 0, 1, size)
        ctx.fillRect(0, k * px, size, 1)
      }
    }
  }

  const colorCount = (b: Buf) => {
    const s = new Set<number>()
    for (let i = 0; i < b.length; i += 4) if (b[i + 3]) s.add(pack(b, i))
    return s.size
  }

  // ---- colour depth -----------------------------------------------------------------------
  function renderDepth(): Buf {
    const stage = DEPTHS[st.depth]
    const pal = stage.palette
    const o = new Uint8ClampedArray(base)
    if (pal)
      for (let i = 0; i < N * N; i++) {
        const k = i * 4
        if (!o[k + 3]) continue
        const bay = st.dither ? BAYER4[(((i / N) | 0) % 4) * 4 + ((i % N) % 4)] : 0
        let c: RGB
        if (stage.ramp) {
          const lum = (0.299 * o[k] + 0.587 * o[k + 1] + 0.114 * o[k + 2]) / 255
          const n = pal.length
          c = pal[Math.max(0, Math.min(n - 1, Math.floor((lum + bay / (n - 1)) * n)))]
        } else {
          const r = o[k] + bay * 64
          const g = o[k + 1] + bay * 64
          const b = o[k + 2] + bay * 64
          let bd = Infinity
          c = pal[0]
          for (const q of pal) {
            const d = 0.3 * (r - q[0]) ** 2 + 0.59 * (g - q[1]) ** 2 + 0.11 * (b - q[2]) ** 2
            if (d < bd) {
              bd = d
              c = q
            }
          }
        }
        o[k] = c[0]
        o[k + 1] = c[1]
        o[k + 2] = c[2]
      }
    const used = colorCount(o)
    showStat(() =>
      pal ? t('workshop.depth.stat', { base: baseColors, used, note: stage.note }) : t('workshop.depth.base', { base: baseColors, note: stage.note }),
    )
    // the palette under the canvas: colours this sprite actually landed on are lit
    const seen = new Set<number>()
    for (let i = 0; i < o.length; i += 4) if (o[i + 3]) seen.add((o[i] << 16) | (o[i + 1] << 8) | o[i + 2])
    const list: RGB[] = pal ?? [...seen].slice(0, 48).map((v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255] as RGB)
    extra.className = 'ws-extra ws-pal'
    extra.replaceChildren(
      ...list.map((c) => {
        const i = document.createElement('i')
        i.style.background = `rgb(${c.join(',')})`
        if (!seen.has((c[0] << 16) | (c[1] << 8) | c[2])) i.className = 'off'
        return i
      }),
    )
    return o
  }

  // ---- light ---------------------------------------------------------------------------
  const rampCache = new Map<string, RGB>()
  function ramp(rgb: RGB, step: number, shift: boolean): RGB {
    if (step === 0) return rgb
    const key = `${rgb.join(',')},${step},${shift}`
    const hit = rampCache.get(key)
    if (hit) return hit
    const [L, C, h] = rgbToLch(rgb)
    const a = Math.abs(step)
    const L2 = Math.min(0.98, Math.max(0.05, L + step * 0.078))
    let C2 = step === 3 ? C * 0.45 : C * (1 - 0.07 * a)
    let h2 = h
    if (shift) {
      const target = step < 0 ? 272 : 82
      if (C < 0.025) {
        C2 = 0.012 * a
        h2 = target
      } else h2 = hueToward(h, target, 9 * a)
    }
    const res = lchToRgb([L2, C2, h2])
    rampCache.set(key, res)
    if (rampCache.size > 4000) rampCache.clear()
    return res
  }

  let prevSteps = new Int8Array(N * N)
  function renderLight() {
    const res = new Uint8ClampedArray(base)
    const steps = new Int8Array(N * N)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x
        const o = i * 4
        if (!base[o + 3]) continue
        const nx = normal[i * 3]
        const ny = normal[i * 3 + 1]
        const nz = normal[i * 3 + 2]
        let lx = st.lx - (x + 0.5)
        let ly = st.ly - (y + 0.5)
        let lz = st.lz - height[i] * 3
        const ll = Math.hypot(lx, ly, lz)
        lx /= ll
        ly /= ll
        lz /= ll
        const dot = nx * lx + ny * ly + nz * lz
        const diff = Math.max(0, dot)
        const rz = 2 * dot * nz - lz
        const spec = Math.max(0, rz) ** 18
        const s = 0.28 + diff * 0.95
        const rgb: RGB = [base[o], base[o + 1], base[o + 2]]
        if (st.smooth) {
          res[o] = rgb[0] * s + spec * 200
          res[o + 1] = rgb[1] * s + spec * 200
          res[o + 2] = rgb[2] * s + spec * 190
        } else {
          let step = Math.max(-2, Math.min(2, Math.round((s - 0.8) * 4.2)))
          if (spec > 0.5) step = 3
          steps[i] = step
          const c = ramp(rgb, step, st.hueShift)
          res[o] = c[0]
          res[o + 1] = c[1]
          res[o + 2] = c[2]
        }
      }
    let changed = 0
    for (let i = 0; i < N * N; i++) if (steps[i] !== prevSteps[i]) changed++
    prevSteps = steps
    if (changed && active && !st.lightAuto) sound.tick(900 + Math.atan2(st.ly - 10, st.lx - 10) * 200 + 400, Math.min(0.02, 0.004 + changed * 0.0012))
    showStat(() => t('workshop.light.stat', { n: colorCount(res), base: baseColors }))
    return res
  }

  // ---- outline -------------------------------------------------------------------------
  function renderOutline() {
    const res = new Uint8ClampedArray(base)
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && base[(y * N + x) * 4 + 3] > 0
    let added = 0
    let avg: RGB = [0, 0, 0]
    let n = 0
    for (let i = 0; i < N * N; i++)
      if (base[i * 4 + 3]) {
        avg = [avg[0] + base[i * 4], avg[1] + base[i * 4 + 1], avg[2] + base[i * 4 + 2]]
        n++
      }
    avg = avg.map((v) => v / Math.max(1, n)) as RGB
    const [aL, aC, aH] = rgbToLch(avg)
    const set = (x: number, y: number, c: RGB, a = 255) => {
      const o = (y * N + x) * 4
      res[o] = c[0]
      res[o + 1] = c[1]
      res[o + 2] = c[2]
      res[o + 3] = a
    }
    const N4 = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]
    if (st.shadow) {
      for (let y = N - 1; y >= 1; y--) for (let x = N - 1; x >= 1; x--) if (!opaque(x, y) && opaque(x - 1, y - 1)) set(x, y, [10, 8, 18], 140)
    }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4
        if (st.outline === 'inner') {
          if (opaque(x, y) && N4.some(([dx, dy]) => !opaque(x + dx, y + dy))) {
            const [L, C, h] = rgbToLch([base[o], base[o + 1], base[o + 2]])
            set(x, y, lchToRgb([Math.max(0.05, L - 0.2), C * 0.9, hueToward(h, 272, 12)]))
            added++
          }
          continue
        }
        if (opaque(x, y)) continue
        const nb = N4.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => opaque(a, b))
        if (st.outline === 'glow') {
          let near = 9
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) if (opaque(x + dx, y + dy)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)))
          if (near <= 2) {
            set(x, y, lchToRgb([Math.min(0.95, aL + 0.25), Math.max(0.12, aC), aH]), near === 1 ? 170 : 70)
            added++
          }
          continue
        }
        if (!nb.length) continue
        if (st.outline === 'black') set(x, y, [12, 10, 18])
        else if (st.outline === 'color') set(x, y, lchToRgb([Math.max(0.12, aL - 0.35), Math.max(0.06, aC), aH]))
        else if (st.outline === 'selout') {
          const [nx, ny] = nb[0]
          const p = (ny * N + nx) * 4
          const [L, C, h] = rgbToLch([base[p], base[p + 1], base[p + 2]])
          set(x, y, lchToRgb([Math.max(0.08, L - 0.3), Math.min(0.2, C * 1.1 + 0.02), hueToward(h, 272, 18)]))
        } else continue
        added++
      }
    showStat(() =>
      st.outline === 'none' ? t('workshop.outline.original', { n: baseColors }) : t('workshop.outline.stat', { n: added, colours: colorCount(res) }),
    )
    return res
  }

  // ---- palette swap ----------------------------------------------------------------------
  function swapped(v: (typeof VARIANTS)[number], hueOffset = 0): Buf {
    const res = new Uint8ClampedArray(base)
    if (v.h === undefined && !hueOffset) return res
    let sx = 0
    let sy = 0
    for (let i = 0; i < N * N; i++) {
      if (!base[i * 4 + 3]) continue
      const [, C, h] = rgbToLch([base[i * 4], base[i * 4 + 1], base[i * 4 + 2]])
      sx += Math.cos((h * Math.PI) / 180) * C
      sy += Math.sin((h * Math.PI) / 180) * C
    }
    const hAvg = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360
    for (let i = 0; i < N * N; i++) {
      const o = i * 4
      if (!base[o + 3]) continue
      const [L, C, h] = rgbToLch([base[o], base[o + 1], base[o + 2]])
      let L2 = L
      let C2 = C
      let h2 = h
      if (v.h !== undefined) {
        L2 = Math.min(0.97, Math.max(0.04, L + (v.l ?? 0) * (C < 0.025 ? 0.5 : 1)))
        if (C >= 0.025) {
          const rel = ((h - hAvg + 540) % 360) - 180
          h2 = (v.h + rel * 0.35 + 360) % 360
          C2 = C * (v.c ?? 1)
        }
      }
      if (hueOffset && C >= 0.025) h2 = (h2 + hueOffset + 360) % 360
      const c = lchToRgb([L2, C2, h2])
      res[o] = c[0]
      res[o + 1] = c[1]
      res[o + 2] = c[2]
    }
    return res
  }

  function renderVariants() {
    extra.replaceChildren(
      ...VARIANTS.map((v, k) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ws-variant'
        b.setAttribute('aria-pressed', String(k === st.variant))
        const c = document.createElement('canvas')
        blit(c.getContext('2d')!, swapped(v), N, N * 4, { checker: false })
        b.append(
          c,
          bindText(document.createElement('span'), () => v.name),
        )
        b.addEventListener('click', () => {
          st.variant = k
          st.hue = 0
          sound.pop()
          extra.querySelectorAll('button').forEach((x, j) => {
            x.setAttribute('aria-pressed', String(j === k))
          })
          render()
        })
        return b
      }),
    )
  }

  // ---- scale -----------------------------------------------------------------------------
  function renderScale() {
    const panels: [() => string, (ctx: CanvasRenderingContext2D) => void][] = [
      [() => t('workshop.scale.nearest'), (ctx) => blit(ctx, base, N, N * 4 * 2, { checker: false })],
      [() => t('workshop.scale.bilinear'), (ctx) => blit(ctx, base, N, N * 4 * 2, { checker: false, smooth: true })],
      [() => t('workshop.scale.algorithm'), (ctx) => blit(ctx, scale2x(scale2x(base, N), N * 2), N * 4, N * 4 * 2, { checker: false })],
    ]
    extra.replaceChildren(
      ...panels.map(([label, draw]) => {
        const f = document.createElement('figure')
        f.className = 'ws-panel'
        const c = document.createElement('canvas')
        draw(c.getContext('2d')!)
        f.append(c, bindText(document.createElement('figcaption'), label))
        return f
      }),
    )
    showStat(() => t('workshop.scale.stat', { n: colorCount(scale2x(scale2x(base, N), N * 2)) }))
  }

  // ---- rotate ---------------------------------------------------------------------------
  const R = 24
  let rotBig: Buf | null = null
  function rotate(src: Buf, n: number, k: number, angle: number): Buf {
    const res = new Uint8ClampedArray(R * R * 4)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const dx = x + 0.5 - R / 2
        const dy = y + 0.5 - R / 2
        const sx = (c * dx + s * dy + N / 2) * k
        const sy = (-s * dx + c * dy + N / 2) * k
        const ix = Math.floor(sx)
        const iy = Math.floor(sy)
        if (ix < 0 || iy < 0 || ix >= n || iy >= n) continue
        const so = (iy * n + ix) * 4
        const o = (y * R + x) * 4
        res[o] = src[so]
        res[o + 1] = src[so + 1]
        res[o + 2] = src[so + 2]
        res[o + 3] = src[so + 3]
      }
    return res
  }
  let rotPanels: CanvasRenderingContext2D[] = []
  function setupRotate() {
    rotBig = scale2x(scale2x(scale2x(base, N), N * 2), N * 4)
    rotPanels = [() => t('workshop.rotate.direct'), () => t('workshop.rotate.algorithm')].map((label) => {
      const f = document.createElement('figure')
      f.className = 'ws-panel'
      const c = document.createElement('canvas')
      f.append(c, bindText(document.createElement('figcaption'), label))
      extra.append(f)
      return c.getContext('2d')!
    })
  }
  function renderRotate() {
    if (!rotBig) {
      extra.replaceChildren()
      setupRotate()
    }
    const a = st.angle
    blit(rotPanels[0], rotate(base, N, 1, a), R, R * 9, { checker: false })
    blit(rotPanels[1], rotate(rotBig!, N * 8, 8, a), R, R * 9, { checker: false })
    showStat(() => t('workshop.rotate.stat', { n: Math.round(((((a * 180) / Math.PI) % 360) + 360) % 360) }))
  }

  // ---- juice ------------------------------------------------------------------------------
  const juice = {
    flashUntil: 0,
    stopUntil: 0,
    knockAt: 0,
    combo: 0,
    lastHit: 0,
    particles: [] as { x: number; y: number; vx: number; vy: number; c: string; life: number }[],
  }
  function hit(px: number, py: number) {
    const now = performance.now()
    const j = st.juice
    juice.combo = now - juice.lastHit < 900 ? juice.combo + 1 : 1
    juice.lastHit = now
    const crit = Math.random() < 0.18
    if (j.flash) juice.flashUntil = now + (j.stop ? 140 : 80)
    const delay = j.stop ? 80 : 0
    juice.stopUntil = j.stop ? now + delay : 0
    if (j.sound) {
      sound.hit()
      if (crit) sound.tone(1320, 0.12, { vol: 0.05, at: 0.02 })
    }
    setTimeout(() => {
      if (j.knock) juice.knockAt = performance.now()
      if (j.shake && !reducedMotion)
        gsap.fromTo(
          stageEl,
          { x: 0, y: 0 },
          {
            x: () => (Math.random() - 0.5) * 14,
            y: () => (Math.random() - 0.5) * 10,
            duration: 0.04,
            repeat: 5,
            yoyo: true,
            ease: 'steps(1)',
            onComplete: () => void gsap.set(stageEl, { x: 0, y: 0 }),
          },
        )
      if (j.particles) {
        for (let k = 0; k < 14; k++) {
          let o = 0
          for (let t = 0; t < 30; t++) {
            const i = (Math.random() * N * N) | 0
            if (base[i * 4 + 3]) {
              o = i * 4
              break
            }
          }
          juice.particles.push({
            x: px,
            y: py,
            vx: (Math.random() - 0.3) * 7,
            vy: -Math.random() * 7 - 1,
            c: `rgb(${base[o]},${base[o + 1]},${base[o + 2]})`,
            life: 1,
          })
        }
      }
      if (j.number) {
        const d = document.createElement('span')
        d.className = `ws-dmg pix${crit ? ' crit' : ''}`
        d.textContent = crit ? `${20 + ((Math.random() * 20) | 0)}!` : `-${6 + ((Math.random() * 10) | 0)}`
        d.style.left = `${(px / (N * SCALE)) * 100}%`
        d.style.top = `${(py / (N * SCALE)) * 100}%`
        // inside the canvas frame, so the percentages above are measured against the canvas
        main.parentElement!.append(d)
        gsap.fromTo(
          d,
          { y: 0, opacity: 1, scale: crit ? 1.6 : 1 },
          { y: -70, opacity: 0, scale: 1, duration: 0.8, ease: 'steps(10)', onComplete: () => d.remove() },
        )
      }
    }, delay)
    showStat(() => (juice.combo > 1 ? t('workshop.juice.combo', { n: juice.combo }) : t('workshop.juice.again')))
  }

  function renderJuice(now: number) {
    let buf = new Uint8ClampedArray(base)
    // idle breathing: every other beat the top half sinks one pixel
    if (now >= juice.stopUntil && Math.floor(now / 420) % 2 === 1) {
      const sq = new Uint8ClampedArray(N * N * 4)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const sy = y < 12 ? y - 1 : y
          if (sy < 0) continue
          const s = (sy * N + x) * 4
          const d = (y * N + x) * 4
          for (let k = 0; k < 4; k++) sq[d + k] = buf[s + k]
        }
      buf = sq
    }
    if (now < juice.flashUntil) for (let i = 0; i < buf.length; i += 4) if (buf[i + 3]) buf[i] = buf[i + 1] = buf[i + 2] = 255
    let dx = 0
    if (juice.knockAt && now >= juice.stopUntil) {
      const t = (now - juice.knockAt) / 260
      dx = t < 1 ? Math.round(3 * (1 - t) * (1 - t)) : 0
    }
    if (dx) {
      const sh = new Uint8ClampedArray(N * N * 4)
      for (let y = 0; y < N; y++) for (let x = dx; x < N; x++) for (let k = 0; k < 4; k++) sh[(y * N + x) * 4 + k] = buf[(y * N + x - dx) * 4 + k]
      buf = sh
    }
    // particles on the fx layer
    fctx.clearRect(0, 0, fxc.width, fxc.height)
    if (now >= juice.stopUntil) {
      juice.particles = juice.particles.filter((p) => p.life > 0)
      for (const p of juice.particles) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.45
        p.life -= 0.025
        fctx.globalAlpha = Math.max(0, p.life)
        fctx.fillStyle = p.c
        fctx.fillRect(Math.round(p.x / 8) * 8, Math.round(p.y / 8) * 8, 8, 8)
      }
      fctx.globalAlpha = 1
    }
    return buf
  }

  // ---- controls ---------------------------------------------------------------------------
  function checkbox(label: () => string, get: () => boolean, set: (v: boolean) => void) {
    const l = document.createElement('label')
    l.className = 'toggle pix'
    const i = document.createElement('input')
    i.type = 'checkbox'
    i.checked = get()
    i.addEventListener('change', () => {
      set(i.checked)
      sound.click()
      render()
    })
    l.append(
      i,
      bindText(document.createTextNode(''), () => ` ${label()}`),
    )
    return l
  }
  function radios(name: string, opts: [string, () => string][], get: () => string, set: (v: string) => void) {
    const wrap = document.createElement('div')
    wrap.className = 'ws-radios'
    for (const [v, label] of opts) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      bindText(b, label)
      b.setAttribute('aria-pressed', String(get() === v))
      b.addEventListener('click', () => {
        set(v)
        sound.pop()
        wrap.querySelectorAll('button').forEach((x) => {
          x.setAttribute('aria-pressed', String(x === b))
        })
        render()
      })
      wrap.append(b)
    }
    wrap.dataset.name = name
    return wrap
  }
  function slider(label: () => string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) {
    const l = document.createElement('label')
    l.className = 'ws-slider pix'
    const i = document.createElement('input')
    i.type = 'range'
    i.min = String(min)
    i.max = String(max)
    i.step = String(step)
    i.value = String(get())
    i.addEventListener('input', () => {
      set(Number(i.value))
      render()
    })
    l.append(bindText(document.createTextNode(''), label), i)
    return l
  }

  function setTool(id: ToolId) {
    controlText.clear()
    tool = id
    const selectedTool = TOOLS.find((x) => x.id === id)!
    nameEl.textContent = selectedTool.name
    descEl.textContent = selectedTool.desc
    toolNav.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.tool === id))
    })
    el.dataset.tool = id
    side.scrollTop = 0
    extra.replaceChildren()
    extra.className = 'ws-extra'
    rotBig = null
    fctx.clearRect(0, 0, fxc.width, fxc.height)
    const c: HTMLElement[] = []
    if (id === 'depth') {
      c.push(
        radios(
          'depth',
          DEPTHS.map((d, i) => [String(i), () => d.key] as [string, () => string]),
          () => String(st.depth),
          (v) => {
            st.depth = Number(v)
            sound.eraJingle(st.depth)
          },
        ),
      )
      c.push(
        checkbox(
          () => t('workshop.depth.dither'),
          () => st.dither,
          (v) => (st.dither = v),
        ),
      )
    } else if (id === 'light') {
      c.push(
        checkbox(
          () => t('workshop.light.quantise'),
          () => !st.smooth,
          (v) => (st.smooth = !v),
        ),
      )
      c.push(
        checkbox(
          () => t('workshop.light.hue'),
          () => st.hueShift,
          (v) => (st.hueShift = v),
        ),
      )
      c.push(
        slider(
          () => t('workshop.light.height'),
          2,
          16,
          0.5,
          () => st.lz,
          (v) => (st.lz = v),
        ),
      )
    } else if (id === 'outline') {
      c.push(
        radios(
          'outline',
          [
            ['none', () => t('workshop.outline.none')],
            ['black', () => t('workshop.outline.black')],
            ['selout', () => t('workshop.outline.selective')],
            ['color', () => t('workshop.outline.colour')],
            ['inner', () => t('workshop.outline.inner')],
            ['glow', () => t('workshop.outline.glow')],
          ],
          () => st.outline,
          (v) => (st.outline = v),
        ),
      )
      c.push(
        checkbox(
          () => t('workshop.outline.shadow'),
          () => st.shadow,
          (v) => (st.shadow = v),
        ),
      )
    } else if (id === 'swap') {
      renderVariants()
    } else if (id === 'scale') {
      renderScale()
    } else if (id === 'rotate') {
      c.push(
        slider(
          () => t('workshop.rotate.angle'),
          0,
          6.283,
          0.01,
          () => st.angle,
          (v) => {
            st.angle = v
            st.rotAuto = false
          },
        ),
      )
    } else if (id === 'juice') {
      const j = st.juice
      const opts: [keyof typeof j, () => string][] = [
        ['stop', () => t('workshop.juice.stop')],
        ['flash', () => t('workshop.juice.flash')],
        ['shake', () => t('workshop.juice.shake')],
        ['knock', () => t('workshop.juice.knock')],
        ['particles', () => t('workshop.juice.particles')],
        ['number', () => t('workshop.juice.number')],
        ['sound', () => t('workshop.juice.sound')],
      ]
      const wrap = document.createElement('div')
      wrap.className = 'ws-checks'
      for (const [k, label] of opts)
        wrap.append(
          checkbox(
            label,
            () => j[k],
            (v) => (j[k] = v),
          ),
        )
      c.push(wrap)
    }
    controls.replaceChildren(...c)
    render()
  }

  function render() {
    const now = performance.now()
    switch (tool) {
      case 'depth':
        out = renderDepth()
        break
      case 'light':
        out = renderLight()
        break
      case 'outline':
        out = renderOutline()
        break
      case 'swap':
        out = swapped(VARIANTS[st.variant], st.hue)
        showStat(() =>
          st.hue
            ? t('workshop.swap.stat', { hue: `${st.hue > 0 ? '+' : ''}${Math.round(st.hue)}`, name: VARIANTS[st.variant].name })
            : VARIANTS[st.variant].name,
        )
        break
      case 'scale':
        out = base
        break
      case 'rotate':
        renderRotate()
        out = base
        break
      case 'juice':
        out = renderJuice(now)
        break
    }
    blit(mctx, out, N, N * SCALE, { grid: true })
    sun.hidden = tool !== 'light'
    if (tool === 'light') {
      sun.style.left = `${(st.lx / N) * 100}%`
      sun.style.top = `${(st.ly / N) * 100}%`
    }
  }

  // ---- input -------------------------------------------------------------------------------
  let dragX: number | null = null
  const toBuf = (e: PointerEvent) => {
    const r = main.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * N,
      y: ((e.clientY - r.top) / r.height) * N,
      px: ((e.clientX - r.left) / r.width) * N * SCALE,
      py: ((e.clientY - r.top) / r.height) * N * SCALE,
    }
  }
  main.addEventListener('pointermove', (e) => {
    const p = toBuf(e)
    if (tool === 'light') {
      st.lightAuto = false
      st.lx = p.x
      st.ly = p.y
    }
    if (dragX !== null && (tool === 'swap' || tool === 'rotate')) {
      const dx = e.clientX - dragX
      dragX = e.clientX
      if (tool === 'swap') {
        st.hue = ((((st.hue + dx * 1.2 + 180) % 360) + 360) % 360) - 180
        if (Math.abs(dx) > 0) sound.tick(800 + ((st.hue + 180) / 360) * 1600, 0.012)
      } else {
        st.angle += dx * 0.012
        st.rotAuto = false
        sound.tick(1200 + Math.abs(dx) * 40, 0.01)
      }
    }
    if (tool !== 'juice') render()
  })
  main.addEventListener('pointerleave', () => {
    if (tool === 'light') st.lightAuto = true
  })
  main.addEventListener('pointerdown', (e) => {
    main.setPointerCapture(e.pointerId)
    dragX = e.clientX
    if (tool === 'juice') {
      const p = toBuf(e)
      hit(p.px, p.py)
    }
  })
  const up = () => (dragX = null)
  main.addEventListener('pointerup', up)
  main.addEventListener('pointercancel', up)

  toolNav.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]')
    if (!b) return
    sound.click()
    setTool(b.dataset.tool as ToolId)
  })
  toolNav.addEventListener('pointerover', (e) => {
    if ((e.target as HTMLElement).closest('[data-tool]')) sound.tick(2000, 0.01)
  })

  type TrayItem = { url: string; label: () => string; src: HTMLCanvasElement | ImageData }
  const tray = sprites.slice(0, 14)
  /** sprites brought in from outside the preset strip: from the star map, or the visitor's own files */
  const customs: TrayItem[] = []
  function renderTray() {
    const items: TrayItem[] = [...customs, ...tray.map((s) => ({ url: s.url, label: () => s.caption, src: s.data }))]
    trayEl.replaceChildren(
      ...items.map((it, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.title = it.label()
        if (i < customs.length) b.className = 'is-own'
        b.innerHTML = `<img src="${it.url}" alt="">`
        b.addEventListener('click', () => {
          sound.pop()
          load(it.src, it.label)
        })
        return b
      }),
    )
  }
  function adopt(c: HTMLCanvasElement, label: () => string) {
    customs.unshift({ url: c.toDataURL(), label, src: c })
    if (customs.length > 7) customs.pop()
    renderTray()
    load(c, label)
  }
  renderTray()

  // ---- bring your own image ---------------------------------------------------------------
  const importBtn = $<HTMLButtonElement>('.ws-import')
  const fileInput = $<HTMLInputElement>('.ws-file')
  const importNote = $('.ws-import-note')
  const NOTE = () => t('workshop.importNote')
  let noteCopy = NOTE
  const note = (copy: () => string, bad = false) => {
    noteCopy = copy
    importNote.textContent = copy()
    importNote.classList.toggle('bad', bad)
  }
  /** fit any picture into 16×16: trim the empty border, then shrink (pixel art by sampling, photos by averaging) */
  async function importImage(file: Blob, name: () => string) {
    if (!file.type.startsWith('image/')) return note(() => t('workshop.import.invalid'), true)
    if (file.size > 24 * 1024 * 1024) return note(() => t('workshop.import.large'), true)
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(file)
    } catch {
      return note(() => t('workshop.import.unreadable'), true)
    }
    // very large photos are shrunk first so reading their pixels stays cheap
    const pre = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * pre))
    const h = Math.max(1, Math.round(bmp.height * pre))
    const full = document.createElement('canvas')
    full.width = w
    full.height = h
    const fc = full.getContext('2d', { willReadFrequently: true })!
    fc.imageSmoothingQuality = 'high'
    fc.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const px = fc.getImageData(0, 0, w, h).data
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (px[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) return note(() => t('workshop.import.empty'), true)
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    const side = Math.max(bw, bh)
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const cx = c.getContext('2d')!
    if (side <= 16) {
      cx.drawImage(full, x0, y0, bw, bh, Math.floor((16 - bw) / 2), Math.floor((16 - bh) / 2), bw, bh)
    } else {
      const k = 16 / side
      const dw = Math.max(1, Math.round(bw * k))
      const dh = Math.max(1, Math.round(bh * k))
      const ox = Math.floor((16 - dw) / 2)
      const oy = Math.floor((16 - dh) / 2)
      // an enlarged pixel drawing has few colours: sample cell centres so edges stay hard
      const tones = new Set<number>()
      for (let i = 0; i < px.length && tones.size <= 64; i += 4 * 37) tones.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2])
      if (tones.size <= 64) {
        const d = cx.createImageData(dw, dh)
        for (let y = 0; y < dh; y++)
          for (let x = 0; x < dw; x++) {
            const sx = Math.min(w - 1, x0 + Math.floor(((x + 0.5) / dw) * bw))
            const sy = Math.min(h - 1, y0 + Math.floor(((y + 0.5) / dh) * bh))
            d.data.set(px.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * dw + x) * 4)
          }
        cx.putImageData(d, ox, oy)
      } else {
        // halve repeatedly: one big bilinear step would skip most source pixels
        let cur: HTMLCanvasElement = document.createElement('canvas')
        cur.width = bw
        cur.height = bh
        cur.getContext('2d')!.drawImage(full, x0, y0, bw, bh, 0, 0, bw, bh)
        while (cur.width > dw * 2 || cur.height > dh * 2) {
          const nx = document.createElement('canvas')
          nx.width = Math.max(dw, Math.ceil(cur.width / 2))
          nx.height = Math.max(dh, Math.ceil(cur.height / 2))
          const nc = nx.getContext('2d')!
          nc.imageSmoothingQuality = 'high'
          nc.drawImage(cur, 0, 0, nx.width, nx.height)
          cur = nx
        }
        cx.imageSmoothingQuality = 'high'
        cx.drawImage(cur, 0, 0, cur.width, cur.height, ox, oy, dw, dh)
      }
    }
    const short = () =>
      name()
        .replace(/\.[a-z0-9]+$/i, '')
        .slice(0, 24) || t('workshop.import.unnamed')
    adopt(c, () => t('workshop.import.own', { name: short() }))
    sound.sparkle()
    note(() => (side > 16 ? t('workshop.import.resized', { w: bw, h: bh }) : t('workshop.import.loaded')))
    window.setTimeout(() => noteCopy !== NOTE && note(NOTE), 6000)
  }
  importBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) importImage(f, () => f.name)
    fileInput.value = ''
  })
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    el.classList.add('is-drop')
  })
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove('is-drop')
  })
  el.addEventListener('drop', (e) => {
    e.preventDefault()
    el.classList.remove('is-drop')
    const f = e.dataTransfer?.files[0]
    if (f) importImage(f, () => f.name)
  })
  window.addEventListener('paste', (e) => {
    if (!active) return
    const f = [...(e.clipboardData?.files ?? [])].find((q) => q.type.startsWith('image/'))
    if (!f) return
    e.preventDefault()
    importImage(f, () => t('workshop.import.clipboard'))
  })

  el.querySelector('.ws-export')!.addEventListener('click', () => {
    sound.click()
    const n = Math.round(Math.sqrt(out.length / 4)) || N
    const c = document.createElement('canvas')
    blit(c.getContext('2d')!, out, n, n * 16, { checker: false })
    c.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `pixel-atlas-workshop-${tool}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    })
  })

  function loop(now: number) {
    if (tool === 'light' && st.lightAuto && !reducedMotion) {
      const t = now / 1000
      st.lx = N / 2 + Math.cos(t * 0.8) * 9
      st.ly = N / 2 + Math.sin(t * 0.8) * 7
      render()
    } else if (tool === 'rotate' && st.rotAuto && !reducedMotion) {
      st.angle = Math.sin(now / 1400) * 0.9
      render()
    } else if (tool === 'juice') render()
    if (active) raf = requestAnimationFrame(loop)
  }

  const first = sprites.find((s) => /apple|orb/.test(s.subject)) ?? sprites[0]
  load(first.data, () => first.caption)
  setTool('depth')

  onLocaleChange(() => {
    const selectedTool = TOOLS.find((item) => item.id === tool)!
    nameEl.textContent = selectedTool.name
    descEl.textContent = selectedTool.desc
    controlText.forEach((update, node) => {
      if (node.isConnected) update()
      else controlText.delete(node)
    })
    labelEl.textContent = labelCopy()
    stat.textContent = statCopy()
    importNote.textContent = noteCopy()
    const items = [...customs, ...tray.map((sprite) => ({ label: () => sprite.caption }))]
    trayEl.querySelectorAll('button').forEach((button, i) => {
      button.title = items[i].label()
    })
  })

  return {
    id: 'workshop',
    num: '03',
    title: () => t('nav.workshop'),
    color: '#1b1626',
    transition: 'iris',
    el,
    load(src, label) {
      const c = document.createElement('canvas')
      c.width = c.height = 16
      if (src instanceof ImageData) c.getContext('2d')!.putImageData(src, 0, 0)
      else c.getContext('2d')!.drawImage(src, 0, 0)
      adopt(c, () => t('workshop.import.atlas', { name: label }))
    },
    enter() {
      active = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(loop)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
    },
  }
}
