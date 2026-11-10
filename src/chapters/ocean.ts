/**
 * 05 · 深海. Scroll to dive from the surface to 4000 m. Everything is drawn
 * per pixel into a low-res buffer: dithered depth bands, caustics, and sprite
 * colours absorbed the way water absorbs light (red first, blue last). Below
 * the sunlight only bioluminescence is left — and sonar.
 */
import { sound } from '../audio'
import { GameShell } from '../game'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const PX = 3
const MAX_D = 4000
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const PAL = ['#7fdcf4', '#45b8e3', '#2b94cd', '#1f70ab', '#18548b', '#133d6b', '#0e2c50', '#0b1f3a', '#08152a', '#060e1e', '#040812', '#02040a'].map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
])
const STOPS = [0, 40, 100, 180, 300, 500, 800, 1200, 1800, 2600, 3400, 4000]
const ZONES = [
  { to: 200, name: '透光层', range: '0–200 m', desc: '阳光还在。焦散在水里晃，暖色依旧鲜艳——浅海关卡通常用整套游戏里最饱和的调色板。' },
  { to: 1000, name: '暮光层', range: '200–1000 m', desc: '水先吃掉红色，再吃掉黄色。同一条鱼往下游，颜色会自己变冷、变暗——画面里的“环境色”就是这么来的。' },
  { to: 3000, name: '午夜层', range: '1000–3000 m', desc: '阳光到不了这里。能看见的只有自己会发光的生物：画深海，其实是在画光点。' },
  { to: 4001, name: '深渊', range: '3000–4000 m', desc: '完全的黑。点击画面发出声呐——在没有光的地方，轮廓是唯一的信息。' },
]

interface Creature {
  spr: Sprite
  x: number
  depth: number
  scale: number
  speed: number
  dir: number
  phase: number
  glow: [number, number, number] | null
  layer: number
  revealUntil: number
}

const depthU = (d: number) => {
  for (let i = 1; i < STOPS.length; i++) if (d <= STOPS[i]) return i - 1 + (d - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1])
  return STOPS.length - 1
}

export function createOcean(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.oc-canvas')!
  const ctx = canvas.getContext('2d')!
  const depthNum = el.querySelector<HTMLElement>('.oc-depth')!
  const marker = el.querySelector<HTMLElement>('.oc-marker')!
  const zoneName = el.querySelector<HTMLElement>('.oc-zone')!
  const zoneDesc = el.querySelector<HTMLElement>('.oc-desc')!

  const by = (re: RegExp) => sprites.filter((s) => re.test(s.subject))
  // Almost every sprite in this strip is drawn facing left; these two face right.
  const facesRight = new Set<Sprite>([sprites[24], sprites[33]].filter(Boolean))
  /** mirror the sprite when its drawn facing differs from where it is heading */
  const mirror = (spr: Sprite, heading: number) => heading > 0 !== facesRight.has(spr)
  const creatures: Creature[] = []
  const add = (list: Sprite[], d0: number, d1: number, o: Partial<Creature> = {}) =>
    list.forEach((spr) =>
      creatures.push({
        spr,
        x: Math.random(),
        depth: d0 + Math.random() * (d1 - d0),
        scale: 1,
        speed: 0.00004 + Math.random() * 0.00008,
        dir: Math.random() < 0.5 ? -1 : 1,
        phase: Math.random() * 10,
        glow: null,
        layer: 0.5 + Math.random(),
        revealUntil: 0,
        ...o,
      }),
    )
  add(by(/tang|clownfish|puffer|seahorse|sea turtle|reef shark/), 20, 170)
  by(/coral|seaweed|starfish|hermit|clam|pearl|urchin/).forEach((spr, i) =>
    creatures.push({ spr, x: 0.02 + (i / 24) * 0.4, depth: 186 - Math.random() * 4, scale: 1, speed: 0, dir: 1, phase: i, glow: null, layer: 1, revealUntil: 0 }),
  )
  add(by(/hammerhead|^jellyfish|^octopus|diver/), 260, 950)
  add(by(/sperm whale/).slice(0, 1), 520, 620, { scale: 3, speed: 0.00002 })
  add(by(/submarine/).slice(0, 1), 700, 800, { scale: 2, speed: 0.00003 })
  add(by(/ghost jellyfish/), 1200, 2800, { glow: [90, 230, 255], speed: 0.00002 })
  add(by(/^jellyfish/), 1500, 2600, { glow: [255, 120, 230], speed: 0.00002 })
  add(by(/anglerfish/), 1800, 3500, { glow: [190, 255, 120] })
  add(by(/dumbo/), 2600, 3900)
  by(/anchor|treasure chest/).forEach((spr, i) =>
    creatures.push({ spr, x: 0.55 + i * 0.12, depth: 3985 - Math.random() * 6, scale: 1, speed: 0, dir: 1, phase: i, glow: null, layer: 1, revealUntil: 0 }),
  )

  const snow = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: 0.2 + Math.random() }))
  let bubbles: { x: number; y: number; r: number; v: number }[] = []
  const pings: { x: number; y: number; t0: number }[] = []

  let progress = 0
  let shown = 0
  let mx = 0.5
  let my = 0.5
  let raf = 0
  let active = false
  let img: ImageData | null = null
  let buf: Uint32Array | null = null
  let zone = -1
  let whaleSung = false

  const pack = (r: number, g: number, b: number) => (255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)

  el.addEventListener('pointermove', (e) => {
    mx = e.clientX / el.clientWidth
    my = e.clientY / el.clientHeight
  })
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect()
    const x = (e.clientX - r.left) / PX
    const y = (e.clientY - r.top) / PX
    pings.push({ x, y, t0: performance.now() })
    if (pings.length > 4) pings.shift()
    sound.sonar()
    for (let i = 0; i < 6; i++) bubbles.push({ x: x + (Math.random() - 0.5) * 10, y: y + Math.random() * 4, r: Math.random() < 0.3 ? 2 : 1, v: 0.3 + Math.random() * 0.4 })
  })

  function setZone(d: number) {
    const z = ZONES.findIndex((q) => d < q.to)
    if (z === zone) return
    if (zone >= 0) sound.tone(z > zone ? 220 : 330, 0.5, { type: 'triangle', vol: 0.04, slide: z > zone ? 165 : 440 })
    zone = z
    zoneName.textContent = `${ZONES[z].name} · ${ZONES[z].range}`
    zoneDesc.textContent = ZONES[z].desc
    el.dataset.zone = String(z)
  }

  // ---- mini game: big fish eats small fish -------------------------------------------------
  interface Fish { spr: Sprite; x: number; y: number; size: number; vx: number; phase: number; glow: [number, number, number] | null; revealUntil: number }
  const POOLS: { to: number; list: Sprite[]; glow?: [number, number, number] }[] = [
    { to: 400, list: by(/tang|clownfish|puffer|seahorse|sea turtle|reef shark/) },
    { to: 1400, list: by(/hammerhead|^jellyfish|^octopus|turtle|shark/) },
    { to: 2600, list: by(/ghost jellyfish/), glow: [90, 230, 255] },
    { to: 4001, list: by(/anglerfish|^jellyfish|dumbo/), glow: [190, 255, 120] },
  ]
  const START = 13
  const WIN = 60
  const game = {
    on: false,
    alive: true,
    spr: by(/clownfish/)[0] ?? sprites[0],
    x: 0, y: 0, size: START, face: 1, inv: 0,
    fish: [] as Fish[],
    score: 0,
    eaten: 0,
    keys: { x: 0, y: 0 },
    pointer: false,
    t0: 0,
  }
  const gameDepth = () => 60 + ((game.size - START) / (WIN - START)) * (MAX_D - 300)

  function spawn(w: number, h: number, d: number) {
    const pool = POOLS.find((p) => d < p.to) ?? POOLS[0]
    const list = pool.list.length ? pool.list : sprites
    const left = Math.random() < 0.5
    // mostly smaller than you, some bigger — the ratio keeps the game fair as you grow
    const r = Math.random()
    const ratio = r < 0.62 ? 0.35 + Math.random() * 0.55 : r < 0.85 ? 1.15 + Math.random() * 0.5 : 1.8 + Math.random() * 1.2
    const size = Math.max(6, Math.min(110, game.size * ratio))
    game.fish.push({
      spr: list[(Math.random() * list.length) | 0],
      x: left ? -size : w + size,
      y: 16 + Math.random() * (h - 32),
      size,
      vx: (left ? 1 : -1) * (0.25 + Math.random() * 0.45) * (ratio > 1 ? 0.8 : 1),
      phase: Math.random() * 6,
      glow: pool.glow && Math.random() < 0.6 ? pool.glow : null,
      revealUntil: 0,
    })
  }

  function stepGame(w: number, h: number, cam: number, _rowD: (y: number) => number, now: number) {
    if (!game.alive) return
    // steer toward the pointer, or with the arrow keys
    const sp = 1.6 + 14 / game.size
    let tx = game.x
    let ty = game.y
    if (game.keys.x || game.keys.y) {
      tx = game.x + game.keys.x * 30
      ty = game.y + game.keys.y * 30
    } else if (game.pointer) {
      tx = mx * w
      ty = my * h
    }
    const dx = tx - game.x
    const dy = ty - game.y
    const dist = Math.hypot(dx, dy)
    if (dist > 1) {
      const v = Math.min(sp, dist * 0.12)
      game.x += (dx / dist) * v
      game.y += (dy / dist) * v
      if (Math.abs(dx) > Math.max(3, game.size * 0.2)) game.face = Math.sign(dx)
    }
    game.x = Math.max(game.size / 2, Math.min(w - game.size / 2, game.x))
    game.y = Math.max(game.size / 2, Math.min(h - game.size / 2, game.y))
    game.inv = Math.max(0, game.inv - 1 / 60)
    if (game.fish.length < 12 + Math.floor(w / 120) && Math.random() < 0.06) spawn(w, h, cam)
    for (const f of game.fish) {
      f.x += f.vx * (16 / Math.max(10, f.size)) ** 0.3
      f.y += Math.sin(now / 900 + f.phase) * 0.08
      const d = Math.hypot(f.x - game.x, f.y - game.y)
      if (d < (f.size + game.size) * 0.3) {
        if (game.size > f.size * 1.05) {
          f.x = -9999
          game.eaten++
          game.score += Math.round(f.size * 10)
          const before = Math.floor(game.size / 10)
          game.size = Math.min(WIN, game.size + f.size * 0.11)
          sound.eat(f.size)
          for (let i = 0; i < 4; i++) bubbles.push({ x: game.x + (Math.random() - 0.5) * 8, y: game.y, r: 1, v: 0.3 + Math.random() * 0.4 })
          if (Math.floor(game.size / 10) > before) sound.grow()
          shell.score(game.score)
          if (game.size >= WIN) {
            game.alive = false
            shell.end(game.score + 2000, '深渊霸主', `吃掉 ${game.eaten} 条 · 一路下潜到 ${Math.round(gameDepth()).toLocaleString('en-US')} m`, true)
          }
        } else if (f.size > game.size * 1.05 && game.inv <= 0) {
          game.alive = false
          sound.hurt()
          sound.tone(300, 1.2, { type: 'sine', vol: 0.05, slide: 60 })
          shell.end(game.score, '被吃掉了', `被一条更大的${f.spr.subject}吞下 · 吃掉 ${game.eaten} 条 · 最深 ${Math.round(cam).toLocaleString('en-US')} m`)
        }
      }
    }
    game.fish = game.fish.filter((f) => f.x > -f.size * 2 && f.x < w + f.size * 2)
    progress = Math.min(1, (gameDepth() - 60) / (MAX_D - 180))
    shell.extra(`体长 ${Math.round(game.size)} 像素 · 深度 ${Math.round(cam).toLocaleString('en-US')} m`)
  }

  const shell = new GameShell(el, 'ocean', '深海', {
    start() {
      const w = canvas.width
      const h = canvas.height
      Object.assign(game, { on: true, alive: true, x: w / 2, y: h / 2, size: START, face: 1, inv: 2, fish: [], score: 0, eaten: 0, t0: performance.now() })
      for (let i = 0; i < 8; i++) {
        spawn(w, h, 60)
        game.fish[i].x = Math.random() * w
      }
      progress = 0
    },
    stop() {
      game.on = false
      game.fish = []
    },
  })
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1] }
  window.addEventListener('keydown', (e) => {
    const a = arrows[e.key]
    if (!a || !game.on) return
    e.preventDefault()
    if (a[0]) game.keys.x = a[0]
    if (a[1]) game.keys.y = a[1]
  })
  window.addEventListener('keyup', (e) => {
    const a = arrows[e.key]
    if (!a) return
    if (a[0]) game.keys.x = 0
    if (a[1]) game.keys.y = 0
  })
  el.addEventListener('pointermove', () => (game.pointer = true))

  function frame(now: number) {
    const w = Math.ceil(el.clientWidth / PX)
    const h = Math.ceil(el.clientHeight / PX)
    if (canvas.width !== w || canvas.height !== h || !img) {
      canvas.width = w
      canvas.height = h
      img = ctx.createImageData(w, h)
      buf = new Uint32Array(img.data.buffer)
    }
    const b = buf!
    const t = now / 1000
    shown += (progress - shown) * 0.12
    const cam = 60 + shown * (MAX_D - 60 - 120)
    const ppm = h / 360
    const rowD = (y: number) => cam + (y - h / 2) / ppm

    // ---- water
    for (let y = 0; y < h; y++) {
      const d = rowD(y)
      const u = depthU(Math.max(0, d))
      const caus = d < 140 ? (1 - d / 140) * (1 - d / 140) : 0
      const rays = d < 320 ? 1 - d / 320 : 0
      const floor = d > MAX_D - 8
      const shelfY = d > 192 && d < 215
      for (let x = 0; x < w; x++) {
        const bay = BAYER4[(y & 3) * 4 + (x & 3)]
        const p = PAL[Math.min(PAL.length - 1, Math.floor(u + bay))]
        let r = p[0]
        let g = p[1]
        let bl = p[2]
        if (rays > 0) {
          const v = Math.sin((x + y * 0.55) * 0.045 + t * 0.25) + Math.sin((x - y * 0.2) * 0.021 - t * 0.17)
          if (v > 1.45 - bay * 0.3) {
            r += 30 * rays
            g += 34 * rays
            bl += 30 * rays
          }
        }
        if (caus > 0) {
          const c = Math.abs(Math.sin(x * 0.12 + t * 1.1 + Math.sin(y * 0.19 + t * 0.7) * 1.6) + Math.sin(y * 0.15 - t * 0.9 + Math.sin(x * 0.09) * 1.3))
          if (c < 0.1 + bay * 0.06) {
            r += 48 * caus
            g += 50 * caus
            bl += 44 * caus
          }
        }
        if (floor || (shelfY && !game.on && x < w * 0.42 - (d - 192) * 0.8)) {
          const l = Math.exp(-Math.max(0, d) / 900)
          const n = ((x * 13) ^ (y * 7)) & 7
          r = (floor ? 22 : 196) * l + n
          g = (floor ? 18 : 172) * l + n
          bl = (floor ? 26 : 118) * l + n
        }
        b[y * w + x] = pack(r, g, bl)
      }
    }

    // ---- particles
    for (const s of snow) {
      s.y += 0.0004 * s.s
      s.x += Math.sin(t + s.s * 10) * 0.0002
      if (s.y > 1) s.y = 0
      const x = Math.floor(((s.x % 1) + 1) % 1 * w)
      const y = Math.min(h - 1, Math.floor(s.y * h))
      const d = rowD(y)
      const a = 80 * Math.exp(-d / 900) + 10
      b[y * w + x] = pack(a + 8, a + 14, a + 22)
    }
    if (!reducedMotion && Math.random() < 0.15 * Math.exp(-cam / 1200)) bubbles.push({ x: Math.random() * w, y: h + 2, r: Math.random() < 0.3 ? 2 : 1, v: 0.2 + Math.random() * 0.4 })
    bubbles = bubbles.filter((q) => q.y > -4)
    for (const q of bubbles) {
      q.y -= q.v
      q.x += Math.sin(q.y * 0.2) * 0.2
      const d = rowD(q.y)
      const l = Math.max(26, 200 * Math.exp(-d / 1200))
      const cx = Math.round(q.x)
      const cy = Math.round(q.y)
      for (let dy = -q.r; dy <= q.r; dy++)
        for (let dx = -q.r; dx <= q.r; dx++) {
          const rr = dx * dx + dy * dy
          if (rr > q.r * q.r + 0.5 || (q.r > 1 && rr < (q.r - 1) * (q.r - 1))) continue
          const xx = cx + dx
          const yy = cy + dy
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) b[yy * w + xx] = pack(l, l + 10, l + 20)
        }
    }

    // ---- creatures
    const halos: [number, number, [number, number, number], number][] = []
    /** draw one sprite into the water buffer, absorbed by depth like real light */
    const blit = (spr: Sprite, sx: number, sy: number, size: number, flip: boolean, d: number, glow: [number, number, number] | null, phase: number, reveal: number, lit = 0) => {
      d = Math.max(0, d)
      const light = Math.exp(-d / 650)
      const ar = Math.exp(-d / 110) * light
      const ag = Math.exp(-d / 650) * light
      const ab = Math.exp(-d / 2400) * light
      const pulse = 0.75 + 0.25 * Math.sin(t * 2.2 + phase)
      const data = spr.data.data
      const fog = PAL[Math.min(PAL.length - 1, Math.floor(depthU(d)))]
      const k16 = 16 / size
      for (let py = 0; py < size; py++) {
        const yy = sy + py
        if (yy < 0 || yy >= h) continue
        const uy = Math.min(15, Math.floor(py * k16))
        for (let px = 0; px < size; px++) {
          const xx = sx + px
          if (xx < 0 || xx >= w) continue
          const ux = Math.min(15, Math.floor(px * k16))
          const o = (uy * 16 + (flip ? 15 - ux : ux)) * 4
          if (data[o + 3] < 128) continue
          let r: number, g: number, bl: number
          if (glow && d > 900) {
            const k = pulse * 0.9
            r = data[o] * 0.25 * k + glow[0] * 0.55 * k
            g = data[o + 1] * 0.25 * k + glow[1] * 0.55 * k
            bl = data[o + 2] * 0.25 * k + glow[2] * 0.55 * k
          } else {
            r = data[o] * (ar + (1 - ar) * lit * 0.85) + fog[0] * 0.35
            g = data[o + 1] * (ag + (1 - ag) * lit * 0.85) + fog[1] * 0.35
            bl = data[o + 2] * (ab + (1 - ab) * lit * 0.85) + fog[2] * 0.35
          }
          if (reveal > 0) {
            const edge =
              ux === 0 || uy === 0 || ux === 15 || uy === 15 ||
              data[o - 4 + 3] < 128 || data[o + 4 + 3] < 128 || data[o - 64 + 3] < 128 || data[o + 64 + 3] < 128
            if (edge) {
              r += 40 * reveal
              g += 255 * reveal
              bl += 230 * reveal
            }
          }
          b[yy * w + xx] = pack(r, g, bl)
        }
      }
      if (glow && d > 900) halos.push([sx + size / 2, sy + size / 2, glow, pulse])
    }
    if (game.on) {
      stepGame(w, h, cam, rowD, now)
      for (const f of game.fish) {
        const size = Math.round(f.size)
        const dl = Math.hypot(f.x - game.x, f.y - game.y)
        const lit = cam > 600 ? Math.max(0, 1 - dl / (40 + game.size)) : 0
        blit(f.spr, Math.round(f.x - size / 2), Math.round(f.y - size / 2 + Math.sin(t * 2 + f.phase) * 1.5), size, mirror(f.spr, f.vx), rowD(f.y), f.glow, f.phase, Math.max(0, (f.revealUntil - now) / 1400), lit)
      }
      if (game.alive || Math.floor(now / 90) % 2) {
        const size = Math.round(game.size)
        blit(game.spr, Math.round(game.x - size / 2), Math.round(game.y - size / 2), size, mirror(game.spr, game.face), Math.min(rowD(game.y), 300), cam > 900 ? [255, 214, 120] : null, 0, 0.35 + 0.15 * Math.sin(now / 200), 1)
      }
    } else
    for (const c of creatures) {
      if (!reducedMotion) c.x += c.speed * c.dir * 16
      if (c.x > 1.1) c.x = -0.1
      if (c.x < -0.1) c.x = 1.1
      const size = Math.round(16 * c.scale)
      const bob = c.speed ? Math.sin(t * 1.4 + c.phase) * 2 : 0
      const sx = Math.round(c.x * w + (mx - 0.5) * c.layer * -14 - size / 2)
      const sy = Math.round(h / 2 + (c.depth - cam) * ppm + bob + (my - 0.5) * c.layer * -6 - size / 2)
      if (sy > h || sy + size < 0) continue
      blit(c.spr, sx, sy, size, mirror(c.spr, c.dir), c.depth, c.glow, c.phase, Math.max(0, (c.revealUntil - now) / 1400))
    }
    // additive glow halos, quantised into rings
    for (const [cx, cy, col, p] of halos) {
      const R = 14
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = Math.round(cx + dx)
          const yy = Math.round(cy + dy)
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const dist = Math.sqrt(dx * dx + dy * dy) / R
          if (dist >= 1) continue
          const band = Math.floor((1 - dist) * 4 + BAYER4[(yy & 3) * 4 + (xx & 3)] * 0.9) / 4
          if (band <= 0) continue
          const i = yy * w + xx
          const v = b[i]
          const k = band * 0.22 * p
          b[i] = pack((v & 255) + col[0] * k, ((v >> 8) & 255) + col[1] * k, ((v >> 16) & 255) + col[2] * k)
        }
    }
    // sonar rings
    for (const pg of pings) {
      const age = (now - pg.t0) / 1000
      const rad = age * 150
      const fade = Math.max(0, 1 - age / 1.6)
      if (fade <= 0) continue
      const steps = Math.ceil(rad * 6)
      for (let k = 0; k < steps; k += 2) {
        const a = (k / steps) * Math.PI * 2
        const xx = Math.round(pg.x + Math.cos(a) * rad)
        const yy = Math.round(pg.y + Math.sin(a) * rad)
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const v = b[yy * w + xx]
        b[yy * w + xx] = pack((v & 255) + 30 * fade, ((v >> 8) & 255) + 200 * fade, ((v >> 16) & 255) + 190 * fade)
      }
      for (const f of game.fish) {
        const dd = Math.hypot(f.x - pg.x, f.y - pg.y)
        if (Math.abs(dd - rad) < f.size / 2 + 2 && f.revealUntil < now + 600) f.revealUntil = now + 1400
      }
      for (const c of creatures) {
        const size = 16 * c.scale
        const cx = c.x * w
        const cy = h / 2 + (c.depth - cam) * ppm
        const dd = Math.hypot(cx - pg.x, cy - pg.y)
        if (Math.abs(dd - rad) < size / 2 + 2 && c.revealUntil < now + 600) c.revealUntil = now + 1400
      }
    }
    ctx.putImageData(img!, 0, 0)

    // ---- HUD
    const dNow = Math.max(0, Math.round(cam))
    depthNum.textContent = `${dNow.toLocaleString('en-US')} m`
    marker.style.top = `${(dNow / MAX_D) * 100}%`
    setZone(dNow)
    sound.set('depth', Math.min(1, dNow / 3000))
    if (!whaleSung && dNow > 480 && dNow < 700) {
      whaleSung = true
      sound.tone(190, 1.8, { type: 'sine', vol: 0.05, slide: 120, attack: 0.5 })
      sound.tone(150, 1.6, { type: 'sine', vol: 0.035, slide: 210, at: 1.6, attack: 0.4 })
    }
    if (active) raf = requestAnimationFrame(frame)
  }

  return {
    id: 'ocean',
    num: '03',
    title: '深海',
    color: '#1f70ab',
    transition: 'wave',
    ambience: 'ocean',
    el,
    playing: () => shell.playing,
    consume(delta) {
      if (delta > 0 && progress >= 1) return false
      if (delta < 0 && progress <= 0) return false
      progress = Math.min(1, Math.max(0, progress + delta / 3200))
      return true
    },
    enter(dir) {
      progress = shown = dir === 1 ? 0 : 1
      whaleSung = false
      zone = -1
      active = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      shell.quit()
    },
  }
}
