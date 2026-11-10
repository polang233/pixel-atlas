/**
 * 06 · 霓虹. Night city in the rain. Each sign is a sprite turned into a neon
 * tube automatically: keep only the outline and the strongest inner edges,
 * paint them in one saturated colour, blur that into a glow. Signs power on
 * when you get near them; the wet street reflects everything.
 */
import { sound } from '../audio'
import { GameShell } from '../game'
import { drawText, textWidth } from '../pixelfont'
import { rgbToLch } from '../color'
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
    signScale = w >= 380 ? 3 : 2
    const S = 16 * signScale
    const slots: [number, number][] = []
    while (x < w) {
      const bw = S + 8 + Math.floor(Math.random() * 26)
      const bh = Math.floor(groundY * (0.42 + Math.random() * 0.4))
      const top = groundY - bh
      c.fillStyle = '#0d0818'
      c.fillRect(x, top, bw, bh)
      c.fillStyle = '#170f28'
      c.fillRect(x, top, bw, 1)
      c.fillRect(x + bw - 1, top, 1, bh)
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
    for (let i = 0; i < 14; i++) sparks.push({ x: s.x + Math.random() * s.size, y: s.y + Math.random() * s.size, vx: (Math.random() - 0.5) * 1.6, vy: -Math.random() * 1.2, life: 0.6 + Math.random() * 0.5, c: s.rgb })
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
  canvas.addEventListener('click', () => !rg.on && hoverSign && powerOn(hoverSign, performance.now()))
  rawBtn.addEventListener('click', () => {
    showRaw = !showRaw
    rawBtn.setAttribute('aria-pressed', String(showRaw))
    rawBtn.textContent = showRaw ? '看霓虹' : '看原图'
    sound.click()
  })

  // ---- mini game: power the city to the beat ------------------------------------------------
  const BPM = 120
  const BEAT = 60 / BPM
  const TRAVEL = 1.45
  const LANES = [NEON[6], NEON[4], NEON[2], NEON[3]].map((n) => [n[1], n[2], n[3]] as [number, number, number])
  const KEYS: Record<string, number> = { d: 0, D: 0, f: 1, F: 1, j: 2, J: 2, k: 3, K: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3, '1': 0, '2': 1, '3': 2, '4': 3 }
  const N = (m: number) => 440 * 2 ** ((m - 69) / 12)
  const CHORDS = [[57, 45], [53, 41], [48, 48], [55, 43]] // Am F C G: [root note, bass]
  interface Note { t: number; lane: number; hit: boolean; missed: boolean }
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
        notes.push({ t, lane, hit: false, missed: false })
        if (bar >= 12 && onBeat && k % 4 === 0 && Math.random() < 0.25) notes.push({ t, lane: (lane + 2) % 4, hit: false, missed: false })
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

  function judge(text: string, color: string) {
    judgeEl.textContent = text
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
    sound.arp([523, 659, 784, 1047, 1319], 0.045, { wave: sound.pulse(0.25), vol: 0.04, len: 0.14 })
    judge(`电量过载 ×${rg.combo}`, '#ffffff')
  }

  /** attract mode: a sparse endless chart that plays itself until someone joins in */
  function demoFill(t: number) {
    while (rg.demoBar * 4 * BEAT < t + TRAVEL + 2) {
      const bar = rg.demoBar++
      for (let k = 0; k < 8; k++) {
        if (Math.random() > (k % 2 === 0 ? 0.5 : 0.14)) continue
        rg.notes.push({ t: bar * 4 * BEAT + (k * BEAT) / 2, lane: (Math.random() * 4) | 0, hit: false, missed: false })
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
    for (let i = 0; i < n; i++) sparks.push({ x: laneX(lane) + (Math.random() - 0.5) * 16, y: hitY(), vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3.2 - 0.4, life: 0.6 + Math.random() * 0.5, c: LANES[lane] })
    if (!user) {
      sound.tone(N(root + [12, 16, 19, 24][lane]), 0.12, { type: 'triangle', vol: 0.012 })
      const lit = signs.filter((sg) => sg.state === 'on')
      if (lit.length && Math.random() < 0.5) lit[(Math.random() * lit.length) | 0].glitchUntil = now + 160
      return
    }
    if (note) note.hit = true
    rg.bump = 0.7
    rg.jam++
    sound.tone(N(root + [12, 16, 19, 24][lane]), 0.2, { wave: sound.pulse(0.25), vol: 0.045 })
    const off = signs.filter((sg) => sg.state === 'off')
    if (off.length) powerOn(off[(Math.random() * off.length) | 0], now)
    else signs[(Math.random() * signs.length) | 0].glitchUntil = now + 240
    if (note) judge(rg.jam >= 6 ? '手感不错 · 按 ▶ 开始计分' : 'NICE', `rgb(${LANES[lane].join(',')})`)
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
    for (const n of rg.notes) if (!n.hit && !n.missed && n.lane === lane && Math.abs(n.t - t) < 0.16 && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n
    if (!best) {
      sound.tick(900, 0.015)
      return
    }
    best.hit = true
    const err = Math.abs(best.t - t)
    const q = err < 0.05 ? 0 : err < 0.1 ? 1 : 2
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
    for (let i = 0; i < n; i++) sparks.push({ x: laneX(lane) + (Math.random() - 0.5) * 16, y: hitY(), vx: (Math.random() - 0.5) * 4.4, vy: -Math.random() * 3.6 - 0.4, life: 0.7 + Math.random() * 0.5, c: LANES[lane] })
    if (rg.combo > 0 && rg.combo % 10 === 0) surge()
    else judge(`${['PERFECT', 'GREAT', 'GOOD'][q]}${rg.combo > 3 ? ' ×' + rg.combo : ''}`, `rgb(${LANES[lane].join(',')})`)
    shell.score(rg.score)
  }

  function missNote(n: Note) {
    n.missed = true
    rg.hits[3]++
    if (rg.combo >= 5) rg.jolt = 1
    rg.combo = 0
    judge('MISS', '#8a7fa8')
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
        sctx.fillStyle = rgba(edge ? NEON[6].slice(1) as [number, number, number] : [120, 110, 190], (edge ? 0.45 + pulse * 0.5 : 0.16 + pulse * 0.16) * (0.25 + 0.75 * Math.min(1, p)))
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
    // notes: glowing bars that grow as they come closer
    for (const n of rg.notes) {
      if (n.hit) continue
      if (demo) {
        if (t >= n.t) {
          jam(n.lane, false)
          n.hit = true
          continue
        }
      } else if (!n.missed && t - n.t > 0.16) missNote(n)
      const u = 1 - (n.t - t) / TRAVEL
      if (u < 0 || u > 1.14) continue
      const p = u ** 1.8
      const sc = depthScale(p)
      const y = Math.round(vy + (hy - vy) * p)
      const x = laneX(n.lane, p)
      const c = LANES[n.lane]
      const a = n.missed ? 0.22 : Math.min(1, 0.35 + p)
      const nw = Math.max(3, Math.round((laneW - 6) * sc))
      const nh = Math.max(1, Math.round(5 * sc))
      sctx.globalCompositeOperation = 'lighter'
      sctx.fillStyle = rgba(c, 0.22 * a)
      sctx.fillRect(Math.round(x - nw / 2) - 2, y - nh - 1, nw + 4, nh * 2 + 3)
      // a short tail behind the bar
      sctx.fillStyle = rgba(c, 0.1 * a)
      sctx.fillRect(Math.round(x - nw / 2) + 1, y - nh * 4, nw - 2, nh * 3)
      sctx.globalCompositeOperation = 'source-over'
      sctx.fillStyle = rgba(c, a)
      sctx.fillRect(Math.round(x - nw / 2), y - Math.floor(nh / 2), nw, nh)
      sctx.fillStyle = `rgba(255,255,255,${0.85 * a})`
      sctx.fillRect(Math.round(x - nw / 2) + 1, y - Math.floor(nh / 2), nw - 2, Math.max(1, Math.floor(nh / 2)))
    }
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
      drawText(sctx, 'COMBO', Math.round(cx - textWidth('COMBO') / 2), vy - 1, 'rgba(255,255,255,0.7)', true)
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
        judge(String(8 - beat), '#ffffff')
        sound.tone(beat === 7 ? 1320 : 880, 0.08, { type: 'square', vol: 0.04 })
      }
    }
    if (!rg.ended && t > total + 0.6) {
      rg.ended = true
      const all = rg.notes.length
      const acc = all ? (rg.hits[0] + rg.hits[1] * 0.7 + rg.hits[2] * 0.4) / all : 0
      const grade = acc > 0.92 ? 'S' : acc > 0.8 ? 'A' : acc > 0.65 ? 'B' : acc > 0.45 ? 'C' : 'D'
      shell.end(rg.score, `评级 ${grade} · 准确率 ${Math.round(acc * 100)}%`, `完美 ${rg.hits[0]} · 很好 ${rg.hits[1]} · 还行 ${rg.hits[2]} · 漏掉 ${rg.hits[3]} · 最大连击 ${rg.best}`, acc > 0.65)
    }
    shell.extra(`连击 ${rg.combo} · ${signs.filter((sg) => sg.state === 'on').length}/${signs.length} 块招牌`)
  }

  const shell = new GameShell(el, 'neon', '霓虹', {
    start() {
      signs.forEach((sg) => (sg.state = 'off'))
      updateCount()
      rg.music = sound.ready
      rg.clock = rg.music ? () => sound.time : () => performance.now() / 1000
      Object.assign(rg, { on: true, notes: chart(rg.bars), start: rg.clock() + 0.4, scheduled: 0, combo: 0, best: 0, score: 0, hits: [0, 0, 0, 0], rings: [], bump: 0, jolt: 0, flash: 0, comboPop: 0, counted: 0, ended: false })
    },
    stop() {
      rg.on = false
      judgeEl.hidden = true
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
    // traffic: streaks of light along the wet street
    if (!reducedMotion && Math.random() < (rg.on ? 0.05 : 0.014)) {
      const left = Math.random() < 0.5
      const n = NEON[(Math.random() * NEON.length) | 0]
      cars.push({ x: left ? -30 : w + 30, y: groundY - 2 - ((Math.random() * 2) | 0), v: (left ? 1 : -1) * (3 + Math.random() * 4), c: [n[1], n[2], n[3]], len: 10 + Math.random() * 16 })
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
    ctx.setTransform(zoom, 0, 0, zoom, (-w * (zoom - 1)) / 2 + jx, (-h * (zoom - 1)) * 0.7)
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

  return {
    id: 'neon',
    num: '04',
    title: '霓虹',
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
