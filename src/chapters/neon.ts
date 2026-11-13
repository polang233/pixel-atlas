/**
 * 06 · Neon. Night city in the rain. Each sign is a sprite turned into a neon
 * tube automatically: keep only the outline and the strongest inner edges,
 * paint them in one saturated colour, blur that into a glow. Signs power on
 * when you get near them; the wet street reflects everything. In the rhythm
 * game the notes are the same sprites through the same filter, and every one
 * that is hit flies off the track to become one more sign on a facade.
 */

import { sound } from '../audio'
import { rgbToLch } from '../color'
import { GameShell } from '../game'
import { t as msg, onLocaleChange } from '../i18n'
import { drawText, textWidth } from '../pixelfont'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const PX = 3
const NEON: [number, number, number, number][] = [
  // hue, r, g, b
  [0, 255, 59, 92],
  [35, 255, 122, 43],
  [95, 255, 225, 77],
  [140, 124, 255, 79],
  [200, 34, 243, 255],
  [285, 163, 107, 255],
  [330, 255, 43, 214],
]
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

interface Sign {
  spr: Sprite
  x: number
  y: number
  size: number
  on: HTMLCanvasElement
  off: HTMLCanvasElement
  glow: HTMLCanvasElement
  raw: HTMLCanvasElement
  rgb: [number, number, number]
  state: 'off' | 'starting' | 'on'
  until: number
  pattern: number[]
  glitchUntil: number
}

/** The neon filter on an n×n RGBA block: 0 empty, 1 body, 2 outline, 3 a strong inner edge. */
function tubeClasses(d: Uint8ClampedArray, n: number) {
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && d[(y * n + x) * 4 + 3] > 127
  const lum = (x: number, y: number) => {
    const o = (y * n + x) * 4
    return (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255
  }
  const cls = new Uint8Array(n * n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!op(x, y)) continue
      const edge = !op(x - 1, y) || !op(x + 1, y) || !op(x, y - 1) || !op(x, y + 1)
      const l = lum(x, y)
      const inner =
        (op(x + 1, y) && lum(x + 1, y) - l > 0.3) ||
        (op(x, y + 1) && lum(x, y + 1) - l > 0.3) ||
        (op(x - 1, y) && lum(x - 1, y) - l > 0.3) ||
        (op(x, y - 1) && lum(x, y - 1) - l > 0.3)
      cls[y * n + x] = edge ? 2 : inner ? 3 : 1
    }
  return cls
}

function tube(spr: Sprite) {
  const d = spr.data.data
  const mask = tubeClasses(d, 16).map((v) => (v > 1 ? 1 : 0))
  let hx = 0
  let hy = 0
  for (let o = 0; o < 1024; o += 4) {
    if (d[o + 3] <= 127) continue
    const [, C, h] = rgbToLch([d[o], d[o + 1], d[o + 2]])
    hx += Math.cos((h * Math.PI) / 180) * C
    hy += Math.sin((h * Math.PI) / 180) * C
  }
  const hue = ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360
  const best =
    Math.hypot(hx, hy) < 0.02
      ? NEON[4]
      : NEON.reduce((a, b) => (Math.abs(((b[0] - hue + 540) % 360) - 180) < Math.abs(((a[0] - hue + 540) % 360) - 180) ? b : a))
  return { mask, rgb: [best[1], best[2], best[3]] as [number, number, number] }
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function buildSign(spr: Sprite, SCALE: number) {
  const { mask, rgb } = tube(spr)
  const S = 16 * SCALE
  const M = 10
  const on = makeCanvas(S, S)
  const off = makeCanvas(S, S)
  const raw = makeCanvas(S, S)
  const oc = on.getContext('2d')!
  const fc = off.getContext('2d')!
  const rc = raw.getContext('2d')!
  const core = rgb.map((v) => Math.round(v + (255 - v) * 0.55))
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4
      if (spr.data.data[o + 3] > 127) {
        rc.fillStyle = `rgb(${spr.data.data[o]},${spr.data.data[o + 1]},${spr.data.data[o + 2]})`
        rc.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
      }
      if (!mask[y * 16 + x]) continue
      oc.fillStyle = `rgb(${rgb.join(',')})`
      oc.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
      oc.fillStyle = `rgb(${core.join(',')})`
      oc.fillRect(x * SCALE, y * SCALE, 1, 1)
      fc.fillStyle = `rgb(${rgb.map((v) => Math.round(v * 0.16 + 14)).join(',')})`
      fc.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
    }
  // glow: box-blur the tube mask twice, quantise into dithered rings
  const G = S + M * 2
  let a = new Float32Array(G * G)
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      if (mask[y * 16 + x]) for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) a[(M + y * SCALE + dy) * G + M + x * SCALE + dx] = 1
  for (let pass = 0; pass < 3; pass++) {
    const b = new Float32Array(G * G)
    const r = 3
    for (let y = 0; y < G; y++)
      for (let x = 0; x < G; x++) {
        let s = 0
        let n = 0
        for (let k = -r; k <= r; k++) {
          const xx = pass % 2 ? x : x + k
          const yy = pass % 2 ? y + k : y
          if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue
          s += a[yy * G + xx]
          n++
        }
        b[y * G + x] = s / n
      }
    a = b
  }
  const glow = makeCanvas(G, G)
  const gc = glow.getContext('2d')!
  const gd = gc.createImageData(G, G)
  for (let i = 0; i < G * G; i++) {
    const x = i % G
    const y = (i / G) | 0
    const v = Math.min(1, a[i] * 2.4)
    const q = Math.floor(v * 5 + BAYER4[(y & 3) * 4 + (x & 3)] * 0.9) / 5
    gd.data[i * 4] = rgb[0]
    gd.data[i * 4 + 1] = rgb[1]
    gd.data[i * 4 + 2] = rgb[2]
    gd.data[i * 4 + 3] = Math.round(q * 150)
  }
  gc.putImageData(gd, 0, 0)
  return { on, off, glow, raw, rgb }
}

/** A 16×16 sprite at n×n: box-filtered when shrinking so thin parts survive, nearest when growing. */
function resample(src: Uint8ClampedArray, n: number) {
  if (n === 16) return src
  const out = new Uint8ClampedArray(n * n * 4)
  const k = 16 / n
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4
      if (n > 16) {
        const s = (Math.floor((y + 0.5) * k) * 16 + Math.floor((x + 0.5) * k)) * 4
        for (let c = 0; c < 4; c++) out[o + c] = src[s + c]
        continue
      }
      const y1 = Math.min(16, (y + 1) * k)
      const x1 = Math.min(16, (x + 1) * k)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = Math.floor(y * k); sy < y1; sy++)
        for (let sx = Math.floor(x * k); sx < x1; sx++) {
          const s = (sy * 16 + sx) * 4
          if (src[s + 3] <= 127) continue
          const wgt = (Math.min(sy + 1, y1) - Math.max(sy, y * k)) * (Math.min(sx + 1, x1) - Math.max(sx, x * k))
          r += src[s] * wgt
          g += src[s + 1] * wgt
          b += src[s + 2] * wgt
          a += wgt
        }
      if (a < k * k * 0.45) continue
      out[o] = r / a
      out[o + 1] = g / a
      out[o + 2] = b / a
      out[o + 3] = 255
    }
  return out
}

/** rows of a note sheet: one per lane, then the burnt-out tube, then the white flash */
const NOTE_DEAD = 4
const NOTE_FLASH = 5

interface NoteSheet {
  size: number
  cols: number
  img: HTMLCanvasElement
  /** dithered halo per lane, `size + pad * 2` square */
  halo: HTMLCanvasElement
  pad: number
}

/**
 * Every sprite as a neon note at one pixel size, in every lane colour. The filter runs on the resampled sprite,
 * so the tube stays one pixel wide at any size.
 */
function buildNoteSheet(sprites: Sprite[], n: number, lanes: [number, number, number][]): NoteSheet {
  const cols = Math.max(1, Math.min(64, sprites.length))
  const rows = lanes.length + 2
  const img = makeCanvas(cols * n, Math.ceil(sprites.length / cols) * rows * n || 1)
  const ictx = img.getContext('2d')!
  const id = ictx.createImageData(img.width, img.height)
  const tint = (c: number[], k: number) => c.map((v) => Math.round(v + (255 - v) * k))
  // per row: body, outline, inner edge, glint
  const pal = lanes.map((c) => [...c.map((v) => Math.round(v * 0.1 + 5)), ...c, ...tint(c, 0.5), ...tint(c, 0.88)])
  pal.push([9, 8, 14, 92, 86, 112, 120, 114, 140, 150, 146, 170], new Array<number>(12).fill(255))
  const glints = Math.max(1, Math.round((n * n) / 50))
  sprites.forEach((spr, i) => {
    const px = resample(spr.data.data, n)
    const cls = tubeClasses(px, n)
    const lum = (p: number) => (0.299 * px[p * 4] + 0.587 * px[p * 4 + 1] + 0.114 * px[p * 4 + 2]) / 255
    // near-white glints: the few brightest pixels inside the outline
    const inside: number[] = []
    for (let p = 0; p < n * n; p++) if (cls[p] === 1 || cls[p] === 3) inside.push(lum(p))
    inside.sort((a, b) => b - a)
    const cut = Math.max(0.7, inside[Math.min(glints, inside.length) - 1] ?? 1)
    for (let p = 0, left = glints; p < n * n && left > 0; p++)
      if ((cls[p] === 1 || cls[p] === 3) && lum(p) >= cut) {
        cls[p] = 4
        left--
      }
    const ox = (i % cols) * n
    const oy = Math.floor(i / cols) * rows * n
    for (let row = 0; row < rows; row++)
      for (let p = 0; p < n * n; p++) {
        if (!cls[p]) continue
        const o = ((oy + row * n + Math.floor(p / n)) * img.width + ox + (p % n)) * 4
        const k = (cls[p] - 1) * 3
        id.data[o] = pal[row][k]
        id.data[o + 1] = pal[row][k + 1]
        id.data[o + 2] = pal[row][k + 2]
        id.data[o + 3] = 255
      }
  })
  ictx.putImageData(id, 0, 0)
  const pad = Math.max(2, Math.round(n * 0.3))
  const hs = n + pad * 2
  const halo = makeCanvas(hs * lanes.length, hs)
  const hctx = halo.getContext('2d')!
  const hd = hctx.createImageData(halo.width, hs)
  for (let y = 0; y < hs; y++)
    for (let x = 0; x < hs; x++) {
      const v = 1 - Math.hypot(x + 0.5 - hs / 2, y + 0.5 - hs / 2) / (hs / 2)
      const q = Math.floor(Math.max(0, Math.min(1, v * 1.5)) * 3 + BAYER4[(y & 3) * 4 + (x & 3)] * 0.9) / 3
      if (q <= 0) continue
      lanes.forEach((c, l) => {
        const o = (y * halo.width + l * hs + x) * 4
        hd.data[o] = c[0]
        hd.data[o + 1] = c[1]
        hd.data[o + 2] = c[2]
        hd.data[o + 3] = Math.round(q * 105)
      })
    }
  hctx.putImageData(hd, 0, 0)
  return { size: n, cols, img, halo, pad }
}

export function createNeon(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.neon-canvas')!
  const ctx = canvas.getContext('2d')!
  const tip = el.querySelector<HTMLElement>('.neon-tip')!
  const rawBtn = el.querySelector<HTMLButtonElement>('.neon-raw')!
  const countEl = el.querySelector<HTMLElement>('.neon-count')!
  const scene = makeCanvas(1, 1)
  const sctx = scene.getContext('2d')!
  let city = makeCanvas(1, 1)

  const picks = [...sprites].sort(() => Math.random() - 0.5)
  let signs: Sign[] = []
  let windows: { x: number; y: number; on: boolean }[] = []
  let drops: { x: number; y: number; v: number; l: number }[] = []
  let splashes: { x: number; y: number; t: number }[] = []
  let w = 0
  let h = 0
  let groundY = 0
  let showRaw = false
  let mx = -999
  let my = -999
  let raf = 0
  let active = false
  let hoverSign: Sign | null = null
  let acc = 0
  let signScale = 2
  let cars: { x: number; y: number; v: number; c: [number, number, number]; len: number }[] = []
  let sparks: { x: number; y: number; vx: number; vy: number; life: number; c: [number, number, number] }[] = []

  function layout() {
    w = Math.ceil(el.clientWidth / PX)
    h = Math.ceil(el.clientHeight / PX)
    canvas.width = scene.width = w
    canvas.height = scene.height = h
    // resizing resets the context; the quarter turns of a dropped note must stay on the pixel grid
    sctx.imageSmoothingEnabled = false
    groundY = Math.round(h * 0.76)
    city = makeCanvas(w, h)
    const c = city.getContext('2d')!
    // sky
    const sky = ['#05030c', '#0b0620', '#160a33', '#241045', '#3a1656', '#55205f']
    for (let y = 0; y < groundY; y++) {
      const u = (y / groundY) * (sky.length - 1)
      for (let x = 0; x < w; x++) {
        c.fillStyle = sky[Math.min(sky.length - 1, Math.floor(u + BAYER4[(y & 3) * 4 + (x & 3)]))]
        c.fillRect(x, y, 1, 1)
      }
    }
    // moon
    c.fillStyle = '#ffe9c4'
    const mxC = Math.round(w * 0.78)
    const myC = Math.round(h * 0.14)
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++) if (dx * dx + dy * dy <= 49 && (dx + 3) * (dx + 3) + (dy - 2) * (dy - 2) > 30) c.fillRect(mxC + dx, myC + dy, 1, 1)
    // far skyline
    windows = []
    let x = 0
    c.fillStyle = '#1a0f2e'
    while (x < w) {
      const bw = 10 + Math.floor(Math.random() * 18)
      const bh = Math.floor(groundY * (0.25 + Math.random() * 0.3))
      c.fillRect(x, groundY - bh, bw, bh)
      x += bw + 1
    }
    // near buildings with sign slots
    x = -4
    signScale = w >= 380 ? 3 : 2
    const S = 16 * signScale
    const slots: [number, number][] = []
    const facades: [number, number, number][] = []
    while (x < w) {
      const bw = S + 8 + Math.floor(Math.random() * 26)
      const bh = Math.floor(groundY * (0.42 + Math.random() * 0.4))
      const top = groundY - bh
      c.fillStyle = '#0d0818'
      c.fillRect(x, top, bw, bh)
      c.fillStyle = '#170f28'
      c.fillRect(x, top, bw, 1)
      c.fillRect(x + bw - 1, top, 1, bh)
      facades.push([x, top, bw])
      for (let wy = top + 4; wy < groundY - 6; wy += 6)
        for (let wx = x + 3; wx < x + bw - 4; wx += 5) if (Math.random() < 0.35) windows.push({ x: wx, y: wy, on: Math.random() < 0.5 })
      if (bw >= S + 8) slots.push([x + Math.floor(bw / 2), top + 8 + Math.floor(Math.random() * Math.max(1, bh * 0.2))])
      if (bh > S * 2.6 + 30) slots.push([x + Math.floor(bw / 2), top + 16 + S + Math.floor(Math.random() * 8)])
      x += bw + 2 + Math.floor(Math.random() * 6)
    }
    // street
    c.fillStyle = '#07050d'
    c.fillRect(0, groundY, w, h - groundY)
    // keep signs clear of the copy box
    const cr = el.querySelector('.neon-copy')!.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const box = [(cr.left - er.left) / PX - 14, (cr.top - er.top) / PX - 14, (cr.right - er.left) / PX + 14, (cr.bottom - er.top) / PX]
    signs = slots
      .filter(([sx]) => sx > S / 2 + 2 && sx < w - S / 2 - 2)
      .filter(([sx, sy]) => {
        const y = Math.min(sy, groundY - S - 10)
        return !(sx + S / 2 > box[0] && sx - S / 2 < box[2] && y + S > box[1] && y < box[3])
      })
      .slice(0, picks.length)
      .map(([sx, sy], i) => {
        const spr = picks[i % picks.length]
        return {
          spr,
          x: sx - S / 2,
          y: Math.min(sy, groundY - S - 10),
          size: S,
          ...buildSign(spr, signScale),
          state: 'off' as const,
          until: 0,
          pattern: [],
          glitchUntil: 0,
        }
      })
    layoutNotes(facades, box)
    drops = Array.from({ length: Math.floor((w * h) / 520) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      v: 2 + Math.random() * 2,
      l: 2 + Math.floor(Math.random() * 3),
    }))
    updateCount()
  }

  function updateCount() {
    const n = signs.filter((s) => s.state === 'on').length
    countEl.textContent = msg('neon.count', { n, total: signs.length })
  }

  function powerOn(s: Sign, now: number) {
    if (s.state !== 'off') return
    s.state = 'starting'
    s.until = now + 650
    // a flicker pattern: on/off toggles in ms
    s.pattern = [0, 60, 110, 190, 260, 300, 420, 470]
    for (let i = 0; i < 14; i++)
      sparks.push({
        x: s.x + Math.random() * s.size,
        y: s.y + Math.random() * s.size,
        vx: (Math.random() - 0.5) * 1.6,
        vy: -Math.random() * 1.2,
        life: 0.6 + Math.random() * 0.5,
        c: s.rgb,
      })
    sound.buzz()
    setTimeout(() => sound.buzz(), 260)
    setTimeout(() => sound.tone(1900, 0.05, { type: 'triangle', vol: 0.02 }), 480)
  }

  const visibleOn = (s: Sign, now: number) => {
    if (s.state === 'off') return false
    if (s.state === 'starting') {
      const t = now - (s.until - 650)
      let on = false
      for (const p of s.pattern) if (t >= p) on = !on
      return on
    }
    if (now < s.glitchUntil) return Math.floor(now / 50) % 3 !== 0
    return true
  }

  el.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    mx = (e.clientX - r.left) / PX
    my = (e.clientY - r.top) / PX
    if (rg.on) {
      tip.hidden = true
      return
    }
    // the cursor drags a few sparks through the rain
    if (!reducedMotion && Math.random() < 0.5) {
      const n = NEON[(Math.random() * NEON.length) | 0]
      sparks.push({ x: mx, y: my, vx: (Math.random() - 0.5) * 0.8, vy: -Math.random() * 0.6, life: 0.5 + Math.random() * 0.3, c: [n[1], n[2], n[3]] })
    }
    const hit = signs.find((s) => mx > s.x - 6 && mx < s.x + s.size + 6 && my > s.y - 6 && my < s.y + s.size + 6) ?? null
    if (hit !== hoverSign) {
      hoverSign = hit
      if (hit) {
        const image = document.createElement('img')
        image.src = hit.spr.url
        image.alt = ''
        const caption = document.createElement('span')
        caption.textContent = hit.spr.caption
        const detail = document.createElement('em')
        detail.className = 'pix'
        detail.textContent = msg('neon.tip')
        tip.replaceChildren(image, caption, detail)
        tip.hidden = false
      } else tip.hidden = true
    }
    if (hit) tip.style.transform = `translate(${Math.min(e.clientX + 16, window.innerWidth - 280)}px, ${e.clientY + 16}px)`
  })
  el.addEventListener('pointerleave', () => {
    mx = my = -999
    tip.hidden = true
    hoverSign = null
  })
  canvas.addEventListener('click', () => !rg.on && hoverSign && powerOn(hoverSign, performance.now()))
  rawBtn.addEventListener('click', () => {
    showRaw = !showRaw
    rawBtn.setAttribute('aria-pressed', String(showRaw))
    rawBtn.textContent = showRaw ? msg('neon.showNeon') : msg('neon.showRaw')
    sound.click()
  })

  // ---- mini game: power the city to the beat ------------------------------------------------
  const BPM = 120
  const BEAT = 60 / BPM
  const TRAVEL = 1.45
  const LANES = [NEON[6], NEON[4], NEON[2], NEON[3]].map((n) => [n[1], n[2], n[3]] as [number, number, number])
  const KEYS: Record<string, number> = {
    d: 0,
    D: 0,
    f: 1,
    F: 1,
    j: 2,
    J: 2,
    k: 3,
    K: 3,
    ArrowLeft: 0,
    ArrowDown: 1,
    ArrowUp: 2,
    ArrowRight: 3,
    '1': 0,
    '2': 1,
    '3': 2,
    '4': 3,
  }
  const N = (m: number) => 440 * 2 ** ((m - 69) / 12)
  const CHORDS = [
    [57, 45],
    [53, 41],
    [48, 48],
    [55, 43],
  ] // Am F C G: [root note, bass]
  interface Note {
    t: number
    lane: number
    hit: boolean
    missed: boolean
    /** index into the strip */
    spr: number
  }
  const judgeEl = el.querySelector<HTMLElement>('.neon-judge')!
  const rg = {
    on: false,
    notes: [] as Note[],
    start: 0,
    clock: () => performance.now() / 1000,
    music: false,
    scheduled: 0,
    combo: 0,
    best: 0,
    score: 0,
    hits: [0, 0, 0, 0] as number[], // perfect, great, good, miss
    press: [0, 0, 0, 0],
    rings: [] as { lane: number; t0: number; q: number }[],
    bump: 0,
    jolt: 0,
    flash: 0,
    pulse: 0,
    comboPop: 0,
    counted: 0,
    bars: 24,
    ended: false,
    demoBar: 0,
    jam: 0,
    flareUntil: 0,
    lit: -1,
    total: 0,
    hudCombo: -1,
  }
  const songT = () => rg.clock() - rg.start

  function chart(bars: number) {
    const notes: Note[] = []
    let lane = 1
    const step = BEAT / 2
    for (let bar = 2; bar < bars; bar++) {
      const dense = bar < 6 ? 0.3 : bar < 12 ? 0.5 : bar < 18 ? 0.62 : 0.72
      for (let k = 0; k < 8; k++) {
        const onBeat = k % 2 === 0
        if (!(onBeat ? Math.random() < dense + 0.25 : Math.random() < dense - 0.2)) continue
        lane = Math.random() < 0.6 ? (lane + (Math.random() < 0.5 ? 1 : 3)) % 4 : (Math.random() * 4) | 0
        const t = bar * 4 * BEAT + k * step
        notes.push({ t, lane, hit: false, missed: false, spr: nextSprite() })
        if (bar >= 12 && onBeat && k % 4 === 0 && Math.random() < 0.25) notes.push({ t, lane: (lane + 2) % 4, hit: false, missed: false, spr: nextSprite() })
      }
    }
    return notes
  }

  function scheduleMusic() {
    if (!rg.music) return
    const horizon = songT() + 0.25
    const step = BEAT / 2
    while (rg.scheduled * step < horizon && rg.scheduled < rg.bars * 8) {
      const k = rg.scheduled
      const at = rg.start + k * step
      const bar = Math.floor(k / 8)
      const [, bass] = CHORDS[bar % 4]
      if (k % 2 === 0) sound.kick(at)
      if (k % 8 === 2 || k % 8 === 6) sound.snare(at)
      sound.hat(at + step / 2, 0.015)
      if (bar >= 2) sound.bassAt(N(bass + (k % 4 === 3 ? 12 : 0)), at, step * 0.9)
      rg.scheduled++
    }
  }

  // the track is drawn in perspective: p = 0 at the vanishing point, 1 on the hit line
  const track = () => {
    const laneW = Math.max(26, Math.min(58, w * 0.105))
    const vy = Math.round(h * 0.2)
    const hy = groundY - 5
    return { laneW, vy, hy, cx: w / 2 }
  }
  const depthScale = (p: number) => 0.14 + 0.86 * p
  const laneX = (i: number, p = 1) => w / 2 + (i - 1.5) * track().laneW * depthScale(p)
  const hitY = () => track().hy
  const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

  // ---- note sprites, and the signs they turn into -------------------------------------------
  const NOTE_SIZES = [4, 6, 8, 12, 16, 24, 32]
  const FX_FLASH = 1
  const FX_FLY = 2
  const FX_FALL = 3
  const FLASH_MS = 34
  // flash + flight last one beat, so a clean hit lands on the next one
  const FLY_MS = BEAT * 1000 - FLASH_MS
  const FLY_STEPS = 12
  const FALL_MS = 650
  interface NoteSign {
    x: number
    y: number
    size: number
    /** -1 while the slot is empty */
    spr: number
    lane: number
    litAt: number
  }
  interface Fx {
    kind: number
    spr: number
    lane: number
    t0: number
    x0: number
    y0: number
    x1: number
    y1: number
    lift: number
    slot: NoteSign | null
  }
  // sheets are kept for the whole visit: a size is rendered the first time a layout asks for it
  const sheets = new Map<number, NoteSheet>()
  const sheetOf = (n: number) => {
    let sh = sheets.get(n)
    if (!sh) {
      sh = buildNoteSheet(sprites, n, LANES)
      sheets.set(n, sh)
    }
    return sh
  }
  let topSheet = sheetOf(16)
  let signSmall = topSheet
  let signBig = topSheet
  let ladder = [topSheet]
  let inUse = [topSheet]
  let smallSlots: NoteSign[] = []
  let bigSlots: NoteSign[] = []
  let smallNext = 0
  let bigNext = 0
  let noteLit = 0
  let topSafe = 0
  const fx: Fx[] = Array.from({ length: 24 }, () => ({ kind: 0, spr: 0, lane: 0, t0: 0, x0: 0, y0: 0, x1: 0, y1: 0, lift: 0, slot: null }))
  let fxNext = 0

  const bag = sprites.map((_, i) => i)
  let bagAt = bag.length
  let lastSprite = -1
  /** walks a shuffled bag of the whole strip, so neighbours on the track never match */
  function nextSprite() {
    if (bagAt >= bag.length) {
      for (let i = bag.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0
        const v = bag[i]
        bag[i] = bag[j]
        bag[j] = v
      }
      if (bag.length > 1 && bag[0] === lastSprite) {
        bag[0] = bag[1]
        bag[1] = lastSprite
      }
      bagAt = 0
    }
    lastSprite = bag[bagAt++] ?? 0
    return lastSprite
  }

  const blit = (sh: NoteSheet, spr: number, row: number, x: number, y: number) => {
    const n = sh.size
    sctx.drawImage(sh.img, (spr % sh.cols) * n, (((spr / sh.cols) | 0) * (LANES.length + 2) + row) * n, n, n, x, y, n, n)
  }
  const halo = (sh: NoteSheet, lane: number, x: number, y: number) => {
    const hs = sh.size + sh.pad * 2
    sctx.drawImage(sh.halo, lane * hs, 0, hs, hs, x - sh.pad, y - sh.pad, hs, hs)
  }
  /** a size is used from the depth where the note has grown to 80% of it */
  const sheetForDepth = (sc: number) => {
    const want = topSheet.size * sc
    for (let i = ladder.length - 1; i > 0; i--) if (ladder[i].size * 0.8 <= want) return ladder[i]
    return ladder[0]
  }
  const sheetNear = (size: number) => {
    let best = inUse[0]
    for (let i = 1; i < inUse.length; i++) if (Math.abs(inUse[i].size - size) < Math.abs(best.size - size)) best = inUse[i]
    return best
  }

  /** note sizes for this track width, and the facade slots the hit notes fly to */
  function layoutNotes(facades: [number, number, number][], box: number[]) {
    const { laneW, vy, hy, cx } = track()
    const top = laneW >= 44 ? 32 : laneW >= 32 ? 24 : 16
    ladder = NOTE_SIZES.filter((n) => n <= top).map(sheetOf)
    topSheet = sheetOf(top)
    // signs a third and two thirds of the big ones; a phone only has room for the smaller pair
    signSmall = sheetOf(w < 240 ? 12 : 16)
    signBig = sheetOf(signScale === 3 ? 32 : 24)
    inUse = [...new Set([...ladder, signSmall, signBig])].sort((a, b) => a.size - b.size)
    for (const f of fx) f.kind = 0
    noteLit = smallNext = bigNext = 0
    const U = signSmall.size
    const B = signBig.size
    const CELL = U + 3
    // the top bar, and on narrow screens the score bar under it
    topSafe = Math.ceil((window.innerWidth <= 820 ? 96 : 58) / PX)
    const callout = Math.max(20, w * 0.1)
    const free = (x0: number, y0: number, x1: number, y1: number) => {
      if (x0 < 1 || x1 > w - 1 || y0 < topSafe || y1 > groundY - 4) return false
      // the road, and the judgement and combo read-outs over its far end
      if (y1 > vy - 30) {
        const road = 2 * laneW * depthScale(Math.max(0, Math.min(1.1, (y1 - vy) / (hy - vy)))) + 4
        const half = y0 < vy + 22 ? Math.max(road, callout) : road
        if (x1 > cx - half && x0 < cx + half) return false
      }
      return !signs.some((s) => x1 > s.x - 5 && x0 < s.x + s.size + 5 && y1 > s.y - 5 && y0 < s.y + s.size + 5)
    }
    // The copy panel is hidden during a round, the only time these signs exist, so the wall behind it is usable:
    // those slots go to the back of the queue and are the first to go when there are too many.
    const behindCopy = (s: NoteSign) => s.x + s.size > box[0] && s.x < box[2] && s.y + s.size > box[1] && s.y < box[3]
    const small: NoteSign[] = []
    const big: NoteSign[] = []
    const roofs: NoteSign[] = []
    const nudge = () => ((Math.random() * 3) | 0) - 1
    for (const [bx, roof, bw] of facades) {
      // only the part of the wall that is on screen
      const left = Math.max(1, bx + 2)
      const span = Math.min(w - 1, bx + bw - 2) - left
      if (span < U) continue
      // The road cuts through some walls, so the cell grid slides to wherever it fits the most signs:
      // centred under the roof first, then a few offsets.
      let cols = 0
      let rows = 0
      let gx = 0
      let gy = 0
      let open = new Uint8Array(0)
      let count = -1
      for (let dy = 0; dy < CELL; dy += 4)
        for (let dx = -2; dx < CELL; dx += 2) {
          const c = Math.floor((span + 3 - Math.max(0, dx)) / CELL)
          const r = Math.floor((groundY - roof - 5 - dy) / CELL)
          if (c < 1) break
          const ox = dx < 0 ? left + ((span - (c * CELL - 3)) >> 1) : left + dx
          const oy = roof + 4 + dy
          const cells = new Uint8Array(c * Math.max(0, r))
          let n = 0
          for (let i = 0; i < cells.length; i++) {
            const x0 = ox + (i % c) * CELL
            const y0 = oy + Math.floor(i / c) * CELL
            if (free(x0 - 1, y0 - 1, x0 + U + 1, y0 + U + 1)) cells[i] = 1
            n += cells[i]
          }
          if (n <= count) continue
          cols = c
          rows = r
          gx = ox
          gy = oy
          open = cells
          count = n
        }
      // double-size slots take a 2×2 block of cells: about half of the open wall goes to them
      let wanted = cols > 1 && rows > 1 ? Math.ceil(count / 8) : 0
      for (let k = open.length * 3; k > 0 && wanted > 0; k--) {
        const i = ((Math.random() * (rows - 1)) | 0) * cols + ((Math.random() * (cols - 1)) | 0)
        if (!(open[i] && open[i + 1] && open[i + cols] && open[i + cols + 1])) continue
        const x0 = gx + (i % cols) * CELL + ((CELL * 2 - 3 - B) >> 1)
        const y0 = gy + Math.floor(i / cols) * CELL + ((CELL * 2 - 3 - B) >> 1)
        if (!free(x0 - 1, y0 - 1, x0 + B + 1, y0 + B + 1)) continue
        open[i] = open[i + 1] = open[i + cols] = open[i + cols + 1] = 0
        big.push({ x: x0, y: y0, size: B, spr: -1, lane: 0, litAt: 0 })
        wanted--
      }
      for (let i = 0; i < open.length; i++)
        if (open[i]) small.push({ x: gx + (i % cols) * CELL + nudge(), y: gy + Math.floor(i / cols) * CELL + nudge(), size: U, spr: -1, lane: 0, litAt: 0 })
      // and some stand on the roof, like billboards
      const fit = Math.floor((span + 3) / CELL)
      for (let c = 0; c < fit; c++) {
        const x0 = left + ((span - (fit * CELL - 3)) >> 1) + c * CELL
        const y0 = roof - U - 1
        if (Math.random() < 0.6 && free(x0 - 1, y0 - 1, x0 + U + 1, y0 + U + 1)) roofs.push({ x: x0, y: y0, size: U, spr: -1, lane: 0, litAt: 0 })
      }
    }
    // a billboard may stand in front of the taller house next door, but not on top of that wall's own signs
    for (const r of roofs)
      if (![...small, ...big].some((s) => r.x + U + 2 > s.x && r.x - 2 < s.x + s.size && r.y + U + 2 > s.y && r.y - 2 < s.y + s.size)) small.push(r)
    // a random handful of them, in the order they will be filled
    const pick = (a: NoteSign[], max: number) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0
        const v = a[i]
        a[i] = a[j]
        a[j] = v
      }
      return [...a.filter((s) => !behindCopy(s)), ...a.filter(behindCopy)].slice(0, max)
    }
    smallSlots = pick(small, 36)
    bigSlots = pick(big, 12)
  }

  /**
   * The next slot in line. A perfect hit gets a double-size one while any is free, then any free wall, so the count
   * never stalls for a good player; once the city is full the oldest sign of that size makes way.
   */
  function takeSlot(perfect: boolean) {
    const useBig = bigSlots.length > 0 && (smallSlots.length === 0 || (perfect && (bigNext < bigSlots.length || smallNext >= smallSlots.length)))
    const pool = useBig ? bigSlots : smallSlots
    if (!pool.length) return null
    return pool[(useBig ? bigNext++ : smallNext++) % pool.length]
  }
  function light(s: NoteSign, spr: number, lane: number, at: number) {
    if (s.spr < 0) noteLit++
    s.spr = spr
    s.lane = lane
    s.litAt = at
  }
  function clearNoteSigns() {
    for (const s of smallSlots) s.spr = -1
    for (const s of bigSlots) s.spr = -1
    for (const f of fx) f.kind = 0
    noteLit = smallNext = bigNext = 0
  }

  /** take a note off the track: a white flash, then a flight to its slot, or a tumble into the gutter */
  function spawnFx(kind: number, n: Note, t: number, slot: NoteSign | null) {
    let f = fx[fxNext]
    for (let i = 0; i < fx.length; i++) {
      const g = fx[(fxNext + i) % fx.length]
      if (g.kind) continue
      f = g
      break
    }
    fxNext = (fxNext + 1) % fx.length
    // every effect busy: the flight being replaced still delivers its sign
    if (f.kind === FX_FLY && f.slot) light(f.slot, f.spr, f.lane, 0)
    const { laneW, vy, hy, cx } = track()
    const sc = depthScale(Math.max(0, 1 - (n.t - t) / TRAVEL) ** 1.8)
    const B = topSheet.size
    f.kind = kind
    f.spr = n.spr
    f.lane = n.lane
    f.t0 = performance.now()
    f.slot = slot
    f.x0 = cx + (n.lane - 1.5) * laneW * sc
    f.y0 = Math.round(vy + (hy - vy) * ((sc - 0.14) / 0.86)) - (B >> 2)
    if (kind === FX_FLY && slot) {
      f.x1 = slot.x + slot.size / 2
      f.y1 = slot.y + slot.size / 2
      // a flatter arc toward the top rows, so the note never leaves through the roof
      f.lift = Math.min(Math.max(14, Math.hypot(f.x1 - f.x0, f.y1 - f.y0) * 0.3), Math.max(4, Math.min(f.y0, f.y1) - topSafe - 20))
    } else if (kind === FX_FALL) f.x1 = reducedMotion ? f.x0 : cx + (n.lane < 2 ? -1 : 1) * (2 * laneW * sc + 8)
  }

  function drawNoteSigns(now: number) {
    const flare = !reducedMotion && now < rg.flareUntil
    const blink = flare && Math.floor(now / 50) % 3 === 0
    // the halos step with the kick drum
    const beat = reducedMotion ? 0.7 : 0.45 + 0.55 * (Math.ceil(rg.pulse * 3) / 3)
    for (let k = 0; k < 2; k++) {
      const pool = k ? bigSlots : smallSlots
      const sh = k ? signBig : signSmall
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i]
        if (s.spr < 0) continue
        const dt = now - s.litAt
        // a short stutter while the tube catches
        const on = !blink && (dt >= 190 || dt < 50 || (dt >= 90 && dt < 150))
        sctx.fillStyle = '#05030a'
        sctx.fillRect(s.x - 1, s.y - 1, sh.size + 2, sh.size + 2)
        if (on) {
          sctx.globalCompositeOperation = 'lighter'
          sctx.globalAlpha = flare ? 1 : beat
          halo(sh, s.lane, s.x, s.y)
          if (flare) halo(sh, s.lane, s.x, s.y)
          sctx.globalCompositeOperation = 'source-over'
          sctx.globalAlpha = 1
        }
        blit(sh, s.spr, on ? s.lane : NOTE_DEAD, s.x, s.y)
      }
    }
  }

  function drawFx(now: number) {
    const B = topSheet.size
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i]
      if (!f.kind) continue
      const age = Math.max(0, now - f.t0)
      if (f.kind === FX_FALL) {
        const k = age / (reducedMotion ? 400 : FALL_MS)
        if (k >= 1) {
          f.kind = 0
          continue
        }
        // quarter turns only, so the pixels stay square while it tumbles
        const turn = reducedMotion ? 0 : (Math.floor(k * 6) * (f.x1 < f.x0 ? -1 : 1)) & 3
        const cos = turn === 0 ? 1 : turn === 2 ? -1 : 0
        const sin = turn === 1 ? 1 : turn === 3 ? -1 : 0
        const drop = reducedMotion ? 0 : (44 * k * k - 28 * k) * (B / 16)
        sctx.setTransform(cos, sin, -sin, cos, Math.round(f.x0 + (f.x1 - f.x0) * k), Math.round(f.y0 + drop))
        sctx.globalAlpha = k < 0.5 ? 1 : 0.8 - Math.floor((k - 0.5) * 8) * 0.2
        blit(topSheet, f.spr, age < 90 ? f.lane : NOTE_DEAD, -B / 2, -B / 2)
        sctx.setTransform(1, 0, 0, 1, 0, 0)
        sctx.globalAlpha = 1
        continue
      }
      if (age < FLASH_MS) {
        blit(topSheet, f.spr, NOTE_FLASH, Math.round(f.x0 - B / 2), Math.round(f.y0 - B / 2))
        continue
      }
      const slot = f.slot
      if (f.kind !== FX_FLY || !slot) {
        f.kind = 0
        continue
      }
      const k = (age - FLASH_MS) / FLY_MS
      if (k >= 1) {
        f.kind = 0
        light(slot, f.spr, f.lane, now)
        for (let j = 0; j < 5; j++)
          sparks.push({
            x: f.x1 + (Math.random() - 0.5) * slot.size,
            y: f.y1 + (Math.random() - 0.5) * slot.size,
            vx: (Math.random() - 0.5) * 1.6,
            vy: -Math.random() * 1.2,
            life: 0.5 + Math.random() * 0.4,
            c: LANES[f.lane],
          })
        sound.tick(1500 + f.lane * 180, 0.012)
        continue
      }
      // the arc moves in a dozen steps and drags two afterimages
      for (let g = 2; g >= 0; g--) {
        const kk = (Math.floor(k * FLY_STEPS) - g) / FLY_STEPS
        if (kk < 0) continue
        const e = 1 - (1 - kk) * (1 - kk)
        const sh = sheetNear(B + (slot.size - B) * e)
        const x = Math.round(f.x0 + (f.x1 - f.x0) * e - sh.size / 2)
        const y = Math.round(f.y0 + (f.y1 - f.y0) * e - f.lift * Math.sin(Math.PI * kk) - sh.size / 2)
        sctx.globalAlpha = g === 0 ? 1 : g === 1 ? 0.4 : 0.18
        if (g === 0) {
          sctx.globalCompositeOperation = 'lighter'
          halo(sh, f.lane, x, y)
          sctx.globalCompositeOperation = 'source-over'
        }
        blit(sh, f.spr, f.lane, x, y)
      }
      sctx.globalAlpha = 1
    }
  }

  let judgeCopy = () => ''
  function judge(copy: () => string, color: string) {
    judgeCopy = copy
    judgeEl.textContent = copy()
    judgeEl.style.color = color
    judgeEl.hidden = false
    judgeEl.classList.remove('pop')
    void judgeEl.offsetWidth
    judgeEl.classList.add('pop')
  }

  function surge() {
    const now = performance.now()
    signs.forEach((sg) => {
      if (sg.state === 'off') powerOn(sg, now)
      else sg.glitchUntil = now + 380
    })
    rg.flash = 1
    rg.flareUntil = now + 380
    sound.arp([523, 659, 784, 1047, 1319], 0.045, { wave: sound.pulse(0.25), vol: 0.04, len: 0.14 })
    judge(() => msg('neon.overload', { n: rg.combo }), '#ffffff')
  }

  /** attract mode: a sparse endless chart that plays itself until someone joins in */
  function demoFill(t: number) {
    while (rg.demoBar * 4 * BEAT < t + TRAVEL + 2) {
      const bar = rg.demoBar++
      for (let k = 0; k < 8; k++) {
        if (Math.random() > (k % 2 === 0 ? 0.5 : 0.14)) continue
        rg.notes.push({ t: bar * 4 * BEAT + (k * BEAT) / 2, lane: (Math.random() * 4) | 0, hit: false, missed: false, spr: nextSprite() })
      }
    }
    if (rg.notes.length > 80) rg.notes = rg.notes.filter((n) => n.t > t - 1)
  }
  function startDemo() {
    rg.clock = () => performance.now() / 1000
    Object.assign(rg, { notes: [], start: rg.clock(), demoBar: 1, rings: [], combo: 0, jam: 0, ended: false })
  }
  /** a lane fired outside a scored round: by the demo itself, or by a visitor jamming along */
  function jam(lane: number, user: boolean, note?: Note) {
    const now = performance.now()
    rg.press[lane] = now
    rg.rings.push({ lane, t0: now, q: user ? 0 : 1 })
    const bar = Math.floor(songT() / (4 * BEAT))
    const [root] = CHORDS[((bar % 4) + 4) % 4]
    const n = user ? 16 : 6
    for (let i = 0; i < n; i++)
      sparks.push({
        x: laneX(lane) + (Math.random() - 0.5) * 16,
        y: hitY(),
        vx: (Math.random() - 0.5) * 4,
        vy: -Math.random() * 3.2 - 0.4,
        life: 0.6 + Math.random() * 0.5,
        c: LANES[lane],
      })
    if (!user) {
      sound.tone(N(root + [12, 16, 19, 24][lane]), 0.12, { type: 'triangle', vol: 0.012 })
      const lit = signs.filter((sg) => sg.state === 'on')
      if (lit.length && Math.random() < 0.5) lit[(Math.random() * lit.length) | 0].glitchUntil = now + 160
      return
    }
    if (note) {
      note.hit = true
      spawnFx(FX_FLASH, note, songT(), null)
    }
    rg.bump = 0.7
    rg.jam++
    sound.tone(N(root + [12, 16, 19, 24][lane]), 0.2, { wave: sound.pulse(0.25), vol: 0.045 })
    const off = signs.filter((sg) => sg.state === 'off')
    if (off.length) powerOn(off[(Math.random() * off.length) | 0], now)
    else signs[(Math.random() * signs.length) | 0].glitchUntil = now + 240
    if (note) judge(() => (rg.jam >= 6 ? msg('neon.jam') : msg('neon.nice')), `rgb(${LANES[lane].join(',')})`)
  }

  function hitLane(lane: number) {
    if (!rg.on) {
      if (shell.playing) return
      const t = songT()
      const near = rg.notes.find((n) => !n.hit && n.lane === lane && Math.abs(n.t - t) < 0.16)
      jam(lane, true, near)
      return
    }
    if (rg.ended) return
    rg.press[lane] = performance.now()
    const t = songT()
    let best: Note | null = null
    for (const n of rg.notes)
      if (!n.hit && !n.missed && n.lane === lane && Math.abs(n.t - t) < 0.16 && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n
    if (!best) {
      sound.tick(900, 0.015)
      return
    }
    best.hit = true
    const err = Math.abs(best.t - t)
    const q = err < 0.05 ? 0 : err < 0.1 ? 1 : 2
    const slot = takeSlot(q === 0)
    if (slot && reducedMotion) light(slot, best.spr, best.lane, 0)
    spawnFx(slot && !reducedMotion ? FX_FLY : FX_FLASH, best, t, slot)
    rg.hits[q]++
    rg.combo++
    rg.best = Math.max(rg.best, rg.combo)
    rg.score += Math.round([300, 200, 100][q] * (1 + Math.min(rg.combo, 60) / 30))
    rg.bump = q === 0 ? 1 : 0.6
    rg.comboPop = 1
    rg.rings.push({ lane, t0: performance.now(), q })
    const [root] = CHORDS[Math.floor(best.t / (4 * BEAT)) % 4]
    sound.tone(N(root + [12, 16, 19, 24][lane]), 0.18, { wave: sound.pulse(0.25), vol: 0.045 })
    if (q === 0) sound.tone(N(root + [12, 16, 19, 24][lane] + 12), 0.1, { type: 'triangle', vol: 0.02, at: 0.03 })
    // every second hit wires up one more sign
    const off = signs.filter((sg) => sg.state === 'off')
    if (off.length && rg.combo % 2 === 0) powerOn(off[(Math.random() * off.length) | 0], performance.now())
    const n = q === 0 ? 22 : 12
    for (let i = 0; i < n; i++)
      sparks.push({
        x: laneX(lane) + (Math.random() - 0.5) * 16,
        y: hitY(),
        vx: (Math.random() - 0.5) * 4.4,
        vy: -Math.random() * 3.6 - 0.4,
        life: 0.7 + Math.random() * 0.5,
        c: LANES[lane],
      })
    if (rg.combo > 0 && rg.combo % 10 === 0) surge()
    else judge(() => `${[msg('neon.perfect'), msg('neon.great'), msg('neon.good')][q]}${rg.combo > 3 ? ` ×${rg.combo}` : ''}`, `rgb(${LANES[lane].join(',')})`)
    shell.score(rg.score)
  }

  function missNote(n: Note) {
    n.missed = true
    rg.hits[3]++
    if (rg.combo >= 5) rg.jolt = 1
    rg.combo = 0
    judge(() => msg('neon.miss'), '#8a7fa8')
    sound.buzz()
    const lit = signs.filter((sg) => sg.state === 'on')
    for (let k = 0; k < 2 && lit.length; k++) lit[(Math.random() * lit.length) | 0].glitchUntil = performance.now() + 600
  }

  function drawGame(now: number) {
    const t = songT()
    const demo = !rg.on
    if (demo) demoFill(t)
    else scheduleMusic()
    const { laneW, vy, hy, cx } = track()
    const phase = t > 0 ? (t / BEAT) % 1 : 1
    const pulse = Math.max(0, 1 - phase * 2.6)
    rg.pulse = pulse
    // the road: a dark trapezoid, pressed lanes lit, dividers that breathe with the beat
    for (let y = vy; y <= hy + 6; y++) {
      const p = (y - vy) / (hy - vy)
      const sc = depthScale(p)
      const half = Math.round(2 * laneW * sc)
      sctx.fillStyle = `rgba(5,3,12,${(demo ? 0.3 : 0.5) + 0.34 * Math.min(1, p)})`
      sctx.fillRect(Math.round(cx) - half, y, half * 2, 1)
      for (let i = 0; i < 4; i++) {
        const held = now - rg.press[i]
        if (held > 170) continue
        sctx.fillStyle = rgba(LANES[i], 0.3 * (1 - held / 170) * (0.3 + 0.7 * p))
        sctx.fillRect(Math.round(cx + (i - 2) * laneW * sc), y, Math.ceil(laneW * sc), 1)
      }
      for (let k = 0; k <= 4; k++) {
        const edge = k === 0 || k === 4
        sctx.fillStyle = rgba(
          edge ? (NEON[6].slice(1) as [number, number, number]) : [120, 110, 190],
          (edge ? 0.45 + pulse * 0.5 : 0.16 + pulse * 0.16) * (0.25 + 0.75 * Math.min(1, p)),
        )
        sctx.fillRect(Math.round(cx + (k - 2) * laneW * sc), y, 1, 1)
      }
    }
    // beat lines rushing toward the player
    for (let b = Math.ceil(t / BEAT); b * BEAT < t + TRAVEL; b++) {
      const u = 1 - (b * BEAT - t) / TRAVEL
      if (u < 0) continue
      const p = u ** 1.8
      const half = Math.round(2 * laneW * depthScale(p))
      sctx.fillStyle = `rgba(255,255,255,${(b % 4 === 0 ? 0.26 : 0.1) * p})`
      sctx.fillRect(Math.round(cx) - half, Math.round(vy + (hy - vy) * p), half * 2, 1)
    }
    // receptors
    for (let i = 0; i < 4; i++) {
      const x = Math.round(laneX(i))
      const c = LANES[i]
      const lit = now - rg.press[i] < 110
      const rw = Math.round(laneW / 2) - 3
      sctx.fillStyle = rgba(c, lit ? 1 : 0.6 + pulse * 0.3)
      sctx.fillRect(x - rw, hy - 2, rw * 2, 1)
      sctx.fillRect(x - rw, hy + 3, rw * 2, 1)
      sctx.fillRect(x - rw, hy - 2, 1, 6)
      sctx.fillRect(x + rw - 1, hy - 2, 1, 6)
      if (lit) {
        sctx.globalCompositeOperation = 'lighter'
        sctx.fillStyle = rgba(c, 0.4)
        sctx.fillRect(x - rw - 2, hy - 5, rw * 2 + 4, 12)
        sctx.globalCompositeOperation = 'source-over'
      }
      if (w > 300) drawText(sctx, 'DFJK'[i], x - 1, hy + 8, rgba(c, 0.8), true)
    }
    // notes: neon sprites that step up through the pre-rendered sizes as they come closer
    for (const n of rg.notes) {
      if (n.hit || n.missed) continue
      if (demo) {
        if (t >= n.t) {
          jam(n.lane, false)
          n.hit = true
          spawnFx(FX_FLASH, n, t, null)
          continue
        }
      } else if (t - n.t > 0.16) {
        missNote(n)
        spawnFx(FX_FALL, n, t, null)
        continue
      }
      const u = 1 - (n.t - t) / TRAVEL
      if (u < 0) continue
      const p = u ** 1.8
      const sc = depthScale(p)
      const sheet = sheetForDepth(sc)
      const s = sheet.size
      const x = Math.round(cx + (n.lane - 1.5) * laneW * sc - s / 2)
      const y = Math.round(vy + (hy - vy) * p) - s + (s >> 2)
      sctx.globalAlpha = Math.min(1, 0.35 + p)
      sctx.globalCompositeOperation = 'lighter'
      halo(sheet, n.lane, x, y)
      sctx.globalCompositeOperation = 'source-over'
      blit(sheet, n.spr, n.lane, x, y)
    }
    sctx.globalAlpha = 1
    // hit rings and light beams
    sctx.globalCompositeOperation = 'lighter'
    rg.rings = rg.rings.filter((r) => now - r.t0 < 320)
    for (const r of rg.rings) {
      const k = (now - r.t0) / 320
      const c = LANES[r.lane]
      const x = Math.round(laneX(r.lane))
      const rw = Math.round(laneW / 2 + k * 14)
      const rh = Math.round(3 + k * 9)
      sctx.fillStyle = rgba(c, (1 - k) * 0.9)
      sctx.fillRect(x - rw, hy - rh, rw * 2, 1)
      sctx.fillRect(x - rw, hy + rh, rw * 2, 1)
      sctx.fillRect(x - rw, hy - rh, 1, rh * 2)
      sctx.fillRect(x + rw, hy - rh, 1, rh * 2)
      if (r.q === 0) {
        // a perfect hit throws a beam of light up the lane
        for (let y = hy; y > vy; y -= 2) {
          const p = (y - vy) / (hy - vy)
          sctx.fillStyle = rgba(c, (1 - k) * 0.22 * p)
          sctx.fillRect(Math.round(cx + (r.lane - 2) * laneW * depthScale(p)), y, Math.ceil(laneW * depthScale(p)), 2)
        }
      }
    }
    sctx.globalCompositeOperation = 'source-over'
    if (demo) return
    // combo counter above the road
    rg.comboPop = Math.max(0, rg.comboPop - 0.08)
    if (rg.combo >= 2) {
      const sc = (w > 360 ? 3 : 2) + (rg.comboPop > 0.5 ? 1 : 0)
      const txt = String(rg.combo)
      const c = LANES[rg.combo % 4]
      drawText(sctx, txt, Math.round(cx - textWidth(txt, sc) / 2), vy - 6 * sc - 2, rgba(c, 1), true, sc)
      drawText(sctx, msg('neon.combo'), Math.round(cx - textWidth(msg('neon.combo')) / 2), vy - 1, 'rgba(255,255,255,0.7)', true)
    }
    // song progress
    const total = rg.bars * 4 * BEAT
    sctx.fillStyle = 'rgba(255,255,255,0.18)'
    sctx.fillRect(Math.round(cx - 2 * laneW), hy + 16, Math.round(4 * laneW), 1)
    sctx.fillStyle = '#22f3ff'
    sctx.fillRect(Math.round(cx - 2 * laneW), hy + 16, Math.round(4 * laneW * Math.max(0, Math.min(1, t / total))), 1)
    // countdown + end
    if (t < 4 * BEAT * 2 && t > 0) {
      const beat = Math.floor(t / BEAT)
      if (beat >= 4 && beat < 8 && beat !== rg.counted) {
        rg.counted = beat
        judge(() => String(8 - beat), '#ffffff')
        sound.tone(beat === 7 ? 1320 : 880, 0.08, { type: 'square', vol: 0.04 })
      }
    }
    if (!rg.ended && t > total + 0.6) {
      rg.ended = true
      const all = rg.notes.length
      const acc = all ? (rg.hits[0] + rg.hits[1] * 0.7 + rg.hits[2] * 0.4) / all : 0
      const grade = acc > 0.92 ? 'S' : acc > 0.8 ? 'A' : acc > 0.65 ? 'B' : acc > 0.45 ? 'C' : 'D'
      shell.end(
        rg.score,
        () => msg('neon.grade', { grade, accuracy: Math.round(acc * 100) }),
        () => msg('neon.result', { perfect: rg.hits[0], great: rg.hits[1], good: rg.hits[2], miss: rg.hits[3], best: rg.best }),
        acc > 0.65,
      )
    }
    let lit = noteLit
    for (const sg of signs) if (sg.state === 'on') lit++
    const slots = signs.length + smallSlots.length + bigSlots.length
    if (lit !== rg.lit || slots !== rg.total || rg.combo !== rg.hudCombo) {
      rg.lit = lit
      rg.total = slots
      rg.hudCombo = rg.combo
      shell.extra(() => msg('neon.hud', { combo: rg.combo, n: rg.lit, total: rg.total }))
    }
  }

  const shell = new GameShell(el, 'neon', () => msg('game.neon'), {
    start() {
      signs.forEach((sg) => {
        sg.state = 'off'
      })
      updateCount()
      clearNoteSigns()
      // the track is not drawn over the original sprites
      if (showRaw) {
        showRaw = false
        rawBtn.setAttribute('aria-pressed', 'false')
        rawBtn.textContent = msg('neon.showRaw')
      }
      rg.music = sound.ready
      rg.clock = rg.music ? () => sound.time : () => performance.now() / 1000
      Object.assign(rg, {
        on: true,
        notes: chart(rg.bars),
        start: rg.clock() + 0.4,
        scheduled: 0,
        combo: 0,
        best: 0,
        score: 0,
        hits: [0, 0, 0, 0],
        rings: [],
        bump: 0,
        jolt: 0,
        flash: 0,
        comboPop: 0,
        counted: 0,
        ended: false,
        flareUntil: 0,
        lit: -1,
      })
    },
    stop() {
      rg.on = false
      judgeEl.hidden = true
      clearNoteSigns()
      startDemo()
    },
  })
  window.addEventListener('keydown', (e) => {
    if (!active || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof HTMLInputElement) return
    // outside a round only D F J K jam: the arrows still turn the page
    const lane = rg.on ? KEYS[e.key] : 'dfjk'.indexOf(e.key.toLowerCase())
    if (lane === undefined || lane < 0) return
    e.preventDefault()
    hitLane(lane)
  })
  canvas.addEventListener('pointerdown', (e) => {
    if (shell.playing && !rg.on) return
    const r = canvas.getBoundingClientRect()
    const x = (e.clientX - r.left) / PX
    if (!rg.on && ((e.clientY - r.top) / PX < track().vy + (hitY() - track().vy) * 0.45 || hoverSign)) return
    let lane = 0
    for (let i = 1; i < 4; i++) if (Math.abs(x - laneX(i)) < Math.abs(x - laneX(lane))) lane = i
    if (Math.abs(x - laneX(lane)) < track().laneW) hitLane(lane)
  })

  function frame(now: number) {
    if (canvas.width !== Math.ceil(el.clientWidth / PX) || canvas.height !== Math.ceil(el.clientHeight / PX)) layout()
    const t = now / 1000
    sctx.drawImage(city, 0, 0)
    // windows flicker
    for (const win of windows) {
      if (!reducedMotion && Math.random() < 0.0015) win.on = !win.on
      if (!win.on) continue
      sctx.fillStyle = (win.x + win.y) % 3 ? '#e8b86a' : '#8ad7ff'
      sctx.globalAlpha = 0.4 + rg.pulse * (rg.on ? 0.6 : 0.4)
      sctx.fillRect(win.x, win.y, 2, 2)
    }
    sctx.globalAlpha = 1
    // signs
    for (const s of signs) {
      const near = Math.hypot(mx - (s.x + s.size / 2), my - (s.y + s.size / 2)) < s.size * 0.9
      if (near && !rg.on) powerOn(s, now)
      if (s.state === 'starting' && now > s.until) {
        s.state = 'on'
        updateCount()
      }
      if (s.state === 'on' && !reducedMotion && Math.random() < 0.0008) {
        s.glitchUntil = now + 300
        sound.buzz()
      }
      if (showRaw) {
        sctx.drawImage(s.raw, s.x, s.y)
        continue
      }
      const on = visibleOn(s, now)
      // mounting: a small dark backboard
      sctx.fillStyle = '#05030a'
      sctx.fillRect(s.x - 2, s.y - 2, s.size + 4, s.size + 4)
      sctx.drawImage(on ? s.on : s.off, s.x, s.y)
      if (on) {
        sctx.globalCompositeOperation = 'lighter'
        sctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 9 + s.x)
        sctx.drawImage(s.glow, s.x - 10, s.y - 10)
        sctx.globalAlpha = 1
        sctx.globalCompositeOperation = 'source-over'
      }
    }
    if (!showRaw && noteLit > 0) drawNoteSigns(now)
    // traffic: streaks of light along the wet street
    if (!reducedMotion && Math.random() < (rg.on ? 0.05 : 0.014)) {
      const left = Math.random() < 0.5
      const n = NEON[(Math.random() * NEON.length) | 0]
      cars.push({
        x: left ? -30 : w + 30,
        y: groundY - 2 - ((Math.random() * 2) | 0),
        v: (left ? 1 : -1) * (3 + Math.random() * 4),
        c: [n[1], n[2], n[3]],
        len: 10 + Math.random() * 16,
      })
    }
    cars = cars.filter((c) => c.x > -60 && c.x < w + 60)
    for (const c of cars) {
      c.x += c.v
      sctx.fillStyle = `rgba(${c.c.join(',')},0.9)`
      sctx.fillRect(Math.round(c.x), c.y, Math.round(c.len), 1)
      sctx.fillStyle = 'rgba(255,255,255,0.9)'
      sctx.fillRect(Math.round(c.v > 0 ? c.x + c.len - 2 : c.x), c.y, 2, 1)
    }
    if (!showRaw) {
      // the horizon breathes with the kick drum
      sctx.globalCompositeOperation = 'lighter'
      sctx.fillStyle = `rgba(255,43,214,${(rg.on ? 0.05 : 0.02) + rg.pulse * (rg.on ? 0.1 : 0.06) + Math.min(0.12, rg.combo / 300)})`
      sctx.fillRect(0, groundY - 46, w, 46)
      sctx.globalCompositeOperation = 'source-over'
      drawGame(now)
      drawFx(now)
    }
    for (const sp of sparks) {
      sp.x += sp.vx
      sp.y += sp.vy
      sp.vy += 0.13
      sp.life -= 0.035
      sctx.fillStyle = `rgba(${sp.c.join(',')},${Math.max(0, Math.min(1, sp.life))})`
      const z = sp.life > 0.6 ? 2 : 1
      sctx.fillRect(Math.round(sp.x), Math.round(sp.y), z, z)
    }
    sparks = sparks.filter((sp) => sp.life > 0)
    if (rg.flash > 0) {
      sctx.fillStyle = `rgba(255,255,255,${rg.flash * 0.35})`
      sctx.fillRect(0, 0, w, h)
      rg.flash = Math.max(0, rg.flash - 0.08)
    }
    // rain
    sctx.fillStyle = 'rgba(170, 185, 255, 0.35)'
    for (const d of drops) {
      if (!reducedMotion) {
        const k = rg.on ? 1 + Math.min(1.2, rg.combo / 30) : 1
        d.y += d.v * k
        d.x -= d.v * 0.25 * k
      }
      if (d.y > groundY + Math.random() * (h - groundY)) {
        if (Math.random() < 0.3) splashes.push({ x: d.x, y: d.y, t: now })
        d.y = -5
        d.x = Math.random() * (w + 20)
      }
      for (let k = 0; k < d.l; k++) sctx.fillRect(Math.round(d.x + k * 0.25), Math.round(d.y - k), 1, 1)
    }
    // a hit punches the camera in a little; a dropped combo jolts it sideways
    rg.bump = Math.max(0, rg.bump - 0.12)
    rg.jolt = Math.max(0, rg.jolt - 0.1)
    const zoom = !reducedMotion ? 1 + rg.bump * 0.018 + rg.pulse * 0.004 : 1
    const jx = rg.on && rg.jolt > 0 ? Math.round(Math.sin(now / 18) * rg.jolt * 4) : 0
    ctx.setTransform(zoom, 0, 0, zoom, (-w * (zoom - 1)) / 2 + jx, -h * (zoom - 1) * 0.7)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(scene, 0, 0)
    // reflection: mirrored rows with a ripple, darkened
    ctx.globalAlpha = 0.5
    for (let y = groundY; y < h; y++) {
      const k = (y - groundY) / Math.max(1, h - groundY)
      const src = groundY - 1 - Math.floor((y - groundY) * 1.4)
      if (src < 0) break
      const off = Math.round(Math.sin(y * 0.7 + t * 4) * (0.5 + k * 2.5))
      ctx.drawImage(scene, 0, src, w, 1, off, y, w, 1)
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(6, 3, 14, 0.35)'
    ctx.fillRect(0, groundY, w, h - groundY)
    ctx.fillStyle = 'rgba(190, 200, 255, 0.5)'
    splashes = splashes.filter((s) => now - s.t < 120)
    for (const s of splashes) {
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 1, 1)
      ctx.fillRect(Math.round(s.x) + 1, Math.round(s.y) - 1, 1, 1)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (active) raf = requestAnimationFrame(frame)
  }

  onLocaleChange(() => {
    updateCount()
    rawBtn.textContent = showRaw ? msg('neon.showNeon') : msg('neon.showRaw')
    const detail = tip.querySelector('em')
    if (detail) detail.textContent = msg('neon.tip')
    judgeEl.textContent = judgeCopy()
  })

  return {
    id: 'neon',
    num: '04',
    title: () => msg('world.neon'),
    color: '#ff2bd6',
    transition: 'glitch',
    ambience: 'neon',
    el,
    playing: () => shell.playing,
    consume(delta) {
      if (delta < 0) return false
      const next = signs.find((s) => s.state === 'off')
      if (!next) return false
      acc += delta
      if (acc > 140) {
        acc = 0
        powerOn(next, performance.now())
      }
      return true
    },
    enter() {
      layout()
      acc = 0
      startDemo()
      active = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      tip.hidden = true
      shell.quit()
    },
  }
}
