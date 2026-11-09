/**
 * 06 · 霓虹. Night city in the rain. Each sign is a sprite turned into a neon
 * tube automatically: keep only the outline and the strongest inner edges,
 * paint them in one saturated colour, blur that into a glow. Signs power on
 * when you get near them; the wet street reflects everything.
 */
import { sound } from '../audio'
import { rgbToLch } from '../color'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const PX = 3
const SCALE = 2
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
  state: 'off' | 'starting' | 'on'
  until: number
  pattern: number[]
  glitchUntil: number
}

function tube(spr: Sprite) {
  const d = spr.data.data
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 127
  const lum = (x: number, y: number) => {
    const o = (y * 16 + x) * 4
    return (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255
  }
  const mask = new Uint8Array(256)
  let hx = 0
  let hy = 0
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!op(x, y)) continue
      const o = (y * 16 + x) * 4
      const [, C, h] = rgbToLch([d[o], d[o + 1], d[o + 2]])
      hx += Math.cos((h * Math.PI) / 180) * C
      hy += Math.sin((h * Math.PI) / 180) * C
      const edge = !op(x - 1, y) || !op(x + 1, y) || !op(x, y - 1) || !op(x, y + 1)
      const l = lum(x, y)
      const inner =
        (op(x + 1, y) && lum(x + 1, y) - l > 0.3) || (op(x, y + 1) && lum(x, y + 1) - l > 0.3) ||
        (op(x - 1, y) && lum(x - 1, y) - l > 0.3) || (op(x, y - 1) && lum(x, y - 1) - l > 0.3)
      if (edge || inner) mask[y * 16 + x] = 1
    }
  const hue = ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360
  const best = Math.hypot(hx, hy) < 0.02 ? NEON[4] : NEON.reduce((a, b) => (Math.abs(((b[0] - hue + 540) % 360) - 180) < Math.abs(((a[0] - hue + 540) % 360) - 180) ? b : a))
  return { mask, rgb: [best[1], best[2], best[3]] as [number, number, number] }
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function buildSign(spr: Sprite) {
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
  return { on, off, glow, raw }
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

  function layout() {
    w = Math.ceil(el.clientWidth / PX)
    h = Math.ceil(el.clientHeight / PX)
    canvas.width = scene.width = w
    canvas.height = scene.height = h
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
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if (dx * dx + dy * dy <= 49 && (dx + 3) * (dx + 3) + (dy - 2) * (dy - 2) > 30) c.fillRect(mxC + dx, myC + dy, 1, 1)
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
    const slots: [number, number][] = []
    while (x < w) {
      const bw = 34 + Math.floor(Math.random() * 30)
      const bh = Math.floor(groundY * (0.42 + Math.random() * 0.4))
      const top = groundY - bh
      c.fillStyle = '#0d0818'
      c.fillRect(x, top, bw, bh)
      c.fillStyle = '#170f28'
      c.fillRect(x, top, bw, 1)
      c.fillRect(x + bw - 1, top, 1, bh)
      for (let wy = top + 4; wy < groundY - 6; wy += 6)
        for (let wx = x + 3; wx < x + bw - 4; wx += 5) if (Math.random() < 0.35) windows.push({ x: wx, y: wy, on: Math.random() < 0.5 })
      if (bw > 38) slots.push([x + Math.floor(bw / 2), top + 8 + Math.floor(Math.random() * Math.max(1, bh * 0.25))])
      if (bw > 38 && bh > groundY * 0.62) slots.push([x + Math.floor(bw / 2), top + Math.floor(bh * 0.55)])
      x += bw + 2 + Math.floor(Math.random() * 6)
    }
    // street
    c.fillStyle = '#07050d'
    c.fillRect(0, groundY, w, h - groundY)
    const S = 16 * SCALE
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
          ...buildSign(spr),
          state: 'off' as const,
          until: 0,
          pattern: [],
          glitchUntil: 0,
        }
      })
    drops = Array.from({ length: Math.floor((w * h) / 520) }, () => ({ x: Math.random() * w, y: Math.random() * h, v: 2 + Math.random() * 2, l: 2 + Math.floor(Math.random() * 3) }))
    updateCount()
  }

  function updateCount() {
    const n = signs.filter((s) => s.state === 'on').length
    countEl.textContent = `${n} / ${signs.length} 块招牌通电`
  }

  function powerOn(s: Sign, now: number) {
    if (s.state !== 'off') return
    s.state = 'starting'
    s.until = now + 650
    // a flicker pattern: on/off toggles in ms
    s.pattern = [0, 60, 110, 190, 260, 300, 420, 470]
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
    const hit = signs.find((s) => mx > s.x - 6 && mx < s.x + s.size + 6 && my > s.y - 6 && my < s.y + s.size + 6) ?? null
    if (hit !== hoverSign) {
      hoverSign = hit
      if (hit) {
        tip.innerHTML = `<img src="${hit.spr.url}" alt=""><span>${hit.spr.caption}</span><em class="pix">原图 → 只留轮廓 + 发光</em>`
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
  canvas.addEventListener('click', () => hoverSign && powerOn(hoverSign, performance.now()))
  rawBtn.addEventListener('click', () => {
    showRaw = !showRaw
    rawBtn.setAttribute('aria-pressed', String(showRaw))
    rawBtn.textContent = showRaw ? '看霓虹' : '看原图'
    sound.click()
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
      sctx.globalAlpha = 0.55
      sctx.fillRect(win.x, win.y, 2, 2)
    }
    sctx.globalAlpha = 1
    // signs
    for (const s of signs) {
      const near = Math.hypot(mx - (s.x + s.size / 2), my - (s.y + s.size / 2)) < s.size * 0.9
      if (near) powerOn(s, now)
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
    // rain
    sctx.fillStyle = 'rgba(170, 185, 255, 0.35)'
    for (const d of drops) {
      if (!reducedMotion) {
        d.y += d.v
        d.x -= d.v * 0.25
      }
      if (d.y > groundY + Math.random() * (h - groundY)) {
        if (Math.random() < 0.3) splashes.push({ x: d.x, y: d.y, t: now })
        d.y = -5
        d.x = Math.random() * (w + 20)
      }
      for (let k = 0; k < d.l; k++) sctx.fillRect(Math.round(d.x + k * 0.25), Math.round(d.y - k), 1, 1)
    }
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
    if (active) raf = requestAnimationFrame(frame)
  }

  return {
    id: 'neon',
    num: '06',
    title: '霓虹',
    color: '#ff2bd6',
    transition: 'glitch',
    ambience: 'neon',
    el,
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
      active = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      tip.hidden = true
    },
  }
}
