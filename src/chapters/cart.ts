/**
 * World 01 · 弹力. A box of sprites with real weight: grab one, throw it, watch
 * it squash on landing and stretch in flight. The four ingredients of pixel
 * "bounce" (squash and stretch, afterimages, dust, low frame rate) can each be
 * switched off to feel what they add.
 * Game: 越滚越大 — drop sprites into a jar; two of a kind merge into the next
 * one up, from a coin all the way to a castle.
 */
import { sound } from '../audio'
import { GameShell } from '../game'
import { drawText, textWidth } from '../pixelfont'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

interface Body {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  img: HTMLCanvasElement
  tier: number
  /** squash along y: negative = flattened, positive = stretched tall; springs back to 0 */
  sq: number
  sv: number
  held: boolean
  age: number
  trail: { x: number; y: number }[]
  rest: number
  dead?: boolean
}
interface Puff { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }
interface Pop { x: number; y: number; text: string; t: number }

// the merge ladder, smallest to largest
const LADDER = ['coin', 'toadstool', 'slime', 'cave bat', 'ghost', 'goblin', 'skeleton', 'wizard', 'knight', 'king slime', 'dragon', 'castle']
const LADDER_ZH = ['金币', '毒蘑菇', '史莱姆', '蝙蝠', '幽灵', '哥布林', '骷髅', '巫师', '骑士', '史莱姆王', '巨龙', '城堡']
const RADII = [7, 9, 11, 13, 15, 18, 21, 24, 27, 31, 35, 40]

export function createCart(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.bn-canvas')!
  const ctx = canvas.getContext('2d')!
  const ladderEl = el.querySelector<HTMLElement>('.bn-ladder')!
  const toCanvas = (s: Sprite) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    c.getContext('2d')!.putImageData(s.data, 0, 0)
    return c
  }
  const all = sprites.map(toCanvas)
  const tierImg = LADDER.map((name) => {
    const i = sprites.findIndex((s) => s.subject === name)
    return all[i >= 0 ? i : 0]
  })
  ladderEl.innerHTML = LADDER.map((_, i) => `<img src="${sprites.find((s) => s.subject === LADDER[i])?.url ?? ''}" alt="${LADDER_ZH[i]}" title="${LADDER_ZH[i]}">`).join('<i>›</i>')

  const fx = { squash: true, trail: true, dust: true, lowfps: false }
  el.querySelectorAll<HTMLButtonElement>('[data-bn]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.bn as keyof typeof fx
      fx[k] = !fx[k]
      b.setAttribute('aria-pressed', String(fx[k]))
      sound.click()
    }),
  )

  let PX = 3
  let W = 0
  let H = 0
  let bodies: Body[] = []
  let puffs: Puff[] = []
  let pops: Pop[] = []
  let raf = 0
  let active = false
  let last = 0
  let time = 0
  let shake = 0
  let nextHop = 0
  const pointer = { x: 0, y: 0, px: 0, py: 0, down: false, grab: null as Body | null }
  // the jar the game is played in (buffer px)
  const jar = { l: 0, r: 0, top: 0, bottom: 0, line: 0 }

  function resize() {
    PX = Math.max(2, Math.round(canvas.clientWidth / 430))
    W = Math.ceil(canvas.clientWidth / PX)
    H = Math.ceil(canvas.clientHeight / PX)
    canvas.width = W
    canvas.height = H
    const jw = Math.min(190, W - 24)
    jar.l = Math.round(W / 2 - jw / 2)
    jar.r = jar.l + jw
    jar.bottom = H - 40
    jar.top = Math.max(34, jar.bottom - Math.min(H - 60, 250))
    jar.line = jar.top + 26
  }

  const make = (x: number, y: number, tier: number, img = tierImg[tier], r = RADII[tier]): Body => ({ x, y, vx: 0, vy: 0, r, img, tier, sq: 0, sv: 0, held: false, age: 0, trail: [], rest: 0 })

  function dust(x: number, y: number, power: number, c = '#d9cfb8') {
    if (!fx.dust || reducedMotion) return
    const n = Math.min(10, 2 + Math.floor(power / 60))
    for (let i = 0; i < n; i++) puffs.push({ x, y, vx: (Math.random() - 0.5) * (60 + power * 0.25), vy: -Math.random() * (20 + power * 0.1), life: 0.3 + Math.random() * 0.3, c, s: Math.random() < 0.4 ? 2 : 1 })
  }

  /** an impact along the given axis: the body flattens against whatever it hit */
  function bump(b: Body, power: number, vertical: boolean) {
    if (power < 40) return
    const amt = Math.min(0.5, power / 520)
    b.sv += (vertical ? -1 : 1) * amt * 26
    if (power > 90) sound.tone(110 + 900 / b.r + Math.min(160, power * 0.2), 0.05, { type: 'triangle', vol: Math.min(0.05, power / 9000) })
  }

  // ---- showcase ---------------------------------------------------------------------------
  function fillShowcase() {
    bodies = []
    const pool = all.filter((_, i) => !/castle|star|coin/.test(sprites[i].subject))
    const n = Math.max(7, Math.min(16, Math.floor(W / 30)))
    for (let i = 0; i < n; i++) {
      const big = i % 5 === 0
      const b = make(20 + Math.random() * (W - 40), 20 + Math.random() * (H * 0.5), -1, pool[(Math.random() * pool.length) | 0], big ? 24 : i % 3 === 0 ? 16 : 12)
      b.vx = (Math.random() - 0.5) * 120
      bodies.push(b)
    }
  }

  // ---- game: 越滚越大 ------------------------------------------------------------------------
  const g = { on: false, over: false, score: 0, best: 0, next: 0, hold: 0, aim: 0, cool: 0, danger: 0, keys: new Set<string>() }
  const rollTier = () => {
    const r = Math.random()
    return r < 0.34 ? 0 : r < 0.62 ? 1 : r < 0.82 ? 2 : r < 0.94 ? 3 : 4
  }
  const hud = () => `最大：${LADDER_ZH[g.best]} · 下一个：${LADDER_ZH[g.next]}`

  function drop() {
    if (!g.on || g.over || g.cool > 0) return
    const r = RADII[g.hold]
    const b = make(Math.max(jar.l + r, Math.min(jar.r - r, g.aim)), jar.top - 10, g.hold)
    b.vy = 40
    bodies.push(b)
    g.hold = g.next
    g.next = rollTier()
    g.cool = 0.5
    sound.jump()
    shell.extra(hud())
  }

  function merge(a: Body, b: Body) {
    a.dead = b.dead = true
    const t = a.tier + 1
    const x = (a.x + b.x) / 2
    const y = (a.y + b.y) / 2
    const pts = (t + 1) * (t + 1) * 5
    g.score += pts
    g.best = Math.max(g.best, t)
    pops.push({ x, y: y - 6, text: `+${pts}`, t: 0 })
    for (let i = 0; i < 12; i++) puffs.push({ x, y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.7) * 140, life: 0.4 + Math.random() * 0.3, c: i % 2 ? '#ffd84d' : '#fff', s: 2 })
    sound.arp([392, 494, 587, 784].map((f) => f * 2 ** (Math.min(t, 10) / 12)), 0.04, { wave: sound.pulse(0.25), vol: 0.04, len: 0.1 })
    shake = Math.min(0.3, 0.08 + t * 0.02)
    if (t >= LADDER.length) {
      // two castles: the top of the ladder, cleared for a bonus
      g.score += 3000
      pops.push({ x, y: y - 16, text: '+3000', t: 0 })
      sound.win()
    } else {
      const nb = make(x, y, t)
      nb.vy = -40
      nb.sv = 14 // pops into being
      bodies.push(nb)
    }
    shell.score(g.score)
    shell.extra(hud())
  }

  // ---- physics ----------------------------------------------------------------------------
  function step(dt: number) {
    const inJar = g.on
    const L = inJar ? jar.l : 0
    const Rr = inJar ? jar.r : W
    const floor = inJar ? jar.bottom : H - 36
    const rest = inJar ? 0.18 : 0.56
    const sub = 4
    const h = dt / sub
    for (let s = 0; s < sub; s++) {
      for (const b of bodies) {
        if (b.held) {
          // a held sprite follows the pointer on a spring, so it trails behind and can be thrown
          b.vx = (pointer.x - b.x) * 18
          b.vy = (pointer.y - b.y) * 18
        } else b.vy += 620 * h
        b.x += b.vx * h
        b.y += b.vy * h
        if (b.y + b.r > floor) {
          b.y = floor - b.r
          if (b.vy > 0) {
            bump(b, b.vy, true)
            if (b.vy > 110) dust(b.x, floor, b.vy)
            b.vy = -b.vy * rest
            if (Math.abs(b.vy) < 26) b.vy = 0
            b.vx *= 0.94
          }
        }
        if (!inJar && b.y - b.r < 0) {
          b.y = b.r
          if (b.vy < 0) {
            bump(b, -b.vy, true)
            b.vy = -b.vy * rest
          }
        }
        if (b.x - b.r < L) {
          b.x = L + b.r
          if (b.vx < 0) {
            bump(b, -b.vx, false)
            b.vx = -b.vx * rest
          }
        }
        if (b.x + b.r > Rr) {
          b.x = Rr - b.r
          if (b.vx > 0) {
            bump(b, b.vx, false)
            b.vx = -b.vx * rest
          }
        }
      }
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]
        if (a.dead) continue
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]
          if (b.dead) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const min = a.r + b.r
          const d2 = dx * dx + dy * dy
          if (d2 >= min * min || d2 === 0) continue
          if (inJar && a.tier === b.tier && a.tier >= 0 && a.age > 0.12 && b.age > 0.12) {
            merge(a, b)
            break
          }
          const d = Math.sqrt(d2)
          const nx = dx / d
          const ny = dy / d
          const ma = a.r * a.r
          const mb = b.r * b.r
          const ta = a.held ? 0 : mb / (ma + mb)
          const tb = b.held ? 0 : ma / (ma + mb)
          const pen = min - d
          a.x -= nx * pen * ta
          a.y -= ny * pen * ta
          b.x += nx * pen * tb
          b.y += ny * pen * tb
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
          if (rel < 0) {
            const jimp = -(1 + rest) * rel
            a.vx -= nx * jimp * ta
            a.vy -= ny * jimp * ta
            b.vx += nx * jimp * tb
            b.vy += ny * jimp * tb
            const vert = Math.abs(ny) > Math.abs(nx)
            bump(a, -rel * tb, vert)
            bump(b, -rel * ta, vert)
          }
        }
      }
    }
    bodies = bodies.filter((b) => !b.dead)
    for (const b of bodies) {
      b.age += dt
      // squash is a damped spring, so a landing overshoots into a little stretch before settling
      b.sv += (-b.sq * 260 - b.sv * 13) * dt
      b.sq = Math.max(-0.55, Math.min(0.55, b.sq + b.sv * dt))
      b.vx *= 1 - dt * (inJar ? 1.6 : 0.25)
      const sp = Math.hypot(b.vx, b.vy)
      b.rest = sp < 22 ? b.rest + dt : 0
      if (fx.trail && sp > 150) {
        b.trail.push({ x: b.x, y: b.y })
        if (b.trail.length > 5) b.trail.shift()
      } else if (b.trail.length) b.trail.shift()
    }
  }

  function update(dt: number, now: number) {
    time += dt
    shake = Math.max(0, shake - dt)
    for (const p of puffs) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 160 * dt
      p.life -= dt
    }
    puffs = puffs.filter((p) => p.life > 0)
    for (const p of pops) p.t += dt
    pops = pops.filter((p) => p.t < 0.9)
    if (g.on) {
      if (g.over) return
      g.cool = Math.max(0, g.cool - dt)
      const dir = (g.keys.has('r') ? 1 : 0) - (g.keys.has('l') ? 1 : 0)
      if (dir) g.aim += dir * 150 * dt
      g.aim = Math.max(jar.l + RADII[g.hold], Math.min(jar.r - RADII[g.hold], g.aim))
      step(dt)
      // the jar is full once something has sat above the line for a moment
      const over = bodies.some((b) => b.age > 1 && b.rest > 0.5 && b.y - b.r < jar.line)
      g.danger = over ? g.danger + dt : Math.max(0, g.danger - dt * 2)
      if (g.danger > 1.6) {
        g.over = true
        sound.hurt()
        shell.end(g.score, '罐子满了', `最大合成到 ${LADDER_ZH[g.best]} · 天梯一共 ${LADDER.length} 级`, g.best >= 8)
      }
    } else {
      step(dt)
      // nobody touching: now and then one of them hops by itself
      if (now > nextHop && !pointer.grab && !reducedMotion) {
        nextHop = now + 450 + Math.random() * 800
        const idle = bodies.filter((b) => b.rest > 0.3)
        const b = idle[(Math.random() * idle.length) | 0]
        if (b) {
          b.vy = -300 - Math.random() * 220
          b.vx = (Math.random() - 0.5) * 180
          b.sv += 9 // stretches up as it takes off
          sound.tone(520 + Math.random() * 240, 0.05, { type: 'square', vol: 0.012 })
        }
      }
    }
  }

  // ---- drawing ----------------------------------------------------------------------------
  function drawBody(b: Body, alpha = 1, at?: { x: number; y: number }) {
    let sy = 1
    let sx = 1
    if (fx.squash && !reducedMotion) {
      // squash on impact, plus a stretch along the direction of fast travel
      const fly = Math.min(0.22, Math.abs(b.vy) / 1600) - Math.min(0.18, Math.abs(b.vx) / 1800)
      const q = Math.max(-0.5, Math.min(0.5, b.sq + (b.rest > 0 ? 0 : fly)))
      sy = 1 + q
      sx = 1 - q * 0.8
    }
    const w = Math.max(2, Math.round(b.r * 2 * sx))
    const hh = Math.max(2, Math.round(b.r * 2 * sy))
    const cx = at ? at.x : b.x
    const cy = at ? at.y : b.y
    // squashing keeps the feet on the ground: scale from the bottom edge
    const x = Math.round(cx - w / 2)
    const y = Math.round(cy + b.r - hh)
    ctx.globalAlpha = alpha
    ctx.drawImage(b.img, x, y, w, hh)
    ctx.globalAlpha = 1
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    // a toy room: banded wall, dotted wallpaper, wooden floor
    const bands = ['#33264a', '#3d2d57', '#473463', '#523c70']
    const floor = g.on ? jar.bottom : H - 36
    bands.forEach((c, i) => {
      ctx.fillStyle = c
      ctx.fillRect(0, Math.round((i * H) / 4), W, Math.ceil(H / 4))
    })
    ctx.fillStyle = 'rgba(255,255,255,0.09)'
    for (let y = 8; y < H; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < W; x += 16) ctx.fillRect(x, y, 2, 2)
    const k = shake > 0 && !reducedMotion ? shake * 14 : 0
    ctx.translate(Math.round((Math.random() - 0.5) * k), Math.round((Math.random() - 0.5) * k))
    ctx.fillStyle = '#7a4a2a'
    ctx.fillRect(-4, floor, W + 8, H - floor + 4)
    ctx.fillStyle = '#a8703c'
    ctx.fillRect(-4, floor, W + 8, 2)
    ctx.fillStyle = '#5c3620'
    for (let x = 0; x < W; x += 24) ctx.fillRect(x, floor + 2, 1, H - floor)

    if (g.on) {
      // the jar and its fill line
      ctx.fillStyle = 'rgba(12,8,22,0.55)'
      ctx.fillRect(jar.l, jar.top - 14, jar.r - jar.l, jar.bottom - jar.top + 14)
      ctx.fillStyle = '#e8dfc8'
      ctx.fillRect(jar.l - 3, jar.top - 14, 3, jar.bottom - jar.top + 17)
      ctx.fillRect(jar.r, jar.top - 14, 3, jar.bottom - jar.top + 17)
      ctx.fillRect(jar.l - 3, jar.bottom, jar.r - jar.l + 6, 3)
      const warn = g.danger > 0 && Math.floor(time * 8) % 2
      ctx.fillStyle = warn ? '#ff4d6d' : 'rgba(255,255,255,0.35)'
      for (let x = jar.l + 2; x < jar.r - 2; x += 6) ctx.fillRect(x, jar.line, 3, 1)
      if (!g.over) {
        // the piece in hand and a dotted drop guide
        const r = RADII[g.hold]
        ctx.fillStyle = 'rgba(255,255,255,0.22)'
        for (let y = jar.top + 4; y < jar.bottom; y += 6) ctx.fillRect(Math.round(g.aim), y, 1, 2)
        ctx.globalAlpha = g.cool > 0 ? 0.4 : 1
        ctx.drawImage(tierImg[g.hold], Math.round(g.aim - r), Math.round(jar.top - 12 - r), r * 2, r * 2)
        ctx.globalAlpha = 1
      }
    }

    const hold = fx.lowfps && !reducedMotion
    for (const b of bodies) {
      if (fx.trail && !reducedMotion) b.trail.forEach((t, i) => drawBody(b, 0.08 + i * 0.05, t))
      // contact shadow
      const d = floor - (b.y + b.r)
      if (d < 60) {
        const sw = Math.max(2, Math.round(b.r * 1.6 * (1 - d / 80)))
        ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - d / 60)})`
        ctx.fillRect(Math.round(b.x - sw / 2), floor - 1, sw, 2)
      }
      if (hold) {
        // 12 fps: the pose is only refreshed on every fifth frame, like hand-drawn frames
        const key = b as Body & { shown?: { x: number; y: number } }
        if (!key.shown || Math.floor(time * 12) !== Math.floor((time - 1 / 60) * 12)) key.shown = { x: b.x, y: b.y }
        drawBody(b, 1, key.shown)
      } else drawBody(b)
    }
    for (const p of puffs) {
      ctx.fillStyle = p.c
      ctx.globalAlpha = Math.min(1, p.life * 3)
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s)
    }
    ctx.globalAlpha = 1
    for (const p of pops) drawText(ctx, p.text, Math.round(p.x - textWidth(p.text) / 2), Math.round(p.y - p.t * 18), '#ffd84d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  function frame(now: number) {
    if (canvas.width !== Math.ceil(canvas.clientWidth / Math.max(2, Math.round(canvas.clientWidth / 430))) || canvas.height !== Math.ceil(canvas.clientHeight / PX)) {
      resize()
      if (!g.on) fillShowcase()
    }
    const dt = Math.min(0.033, (now - last) / 1000)
    last = now
    update(dt, now)
    draw()
    if (active) raf = requestAnimationFrame(frame)
  }

  // ---- input ------------------------------------------------------------------------------
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    pointer.x = (e.clientX - r.left) / PX
    pointer.y = (e.clientY - r.top) / PX
  }
  canvas.addEventListener('pointerdown', (e) => {
    at(e)
    if (g.on) {
      g.aim = pointer.x
      drop()
      return
    }
    canvas.setPointerCapture(e.pointerId)
    const hit = [...bodies].reverse().find((b) => Math.hypot(b.x - pointer.x, b.y - pointer.y) < b.r + 4)
    if (hit) {
      hit.held = true
      pointer.grab = hit
      hit.sv += 10
      sound.pop()
    } else if (bodies.length < 40) {
      // an empty spot: a new one drops in
      const pool = all
      const b = make(pointer.x, pointer.y, -1, pool[(Math.random() * pool.length) | 0], [12, 12, 16, 24][(Math.random() * 4) | 0])
      b.sv = 12
      bodies.push(b)
      sound.pop()
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    at(e)
    if (g.on) g.aim = pointer.x
  })
  const release = () => {
    if (pointer.grab) {
      pointer.grab.held = false
      pointer.grab = null
    }
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)

  const shell = new GameShell(el, 'cart-merge', '越滚越大', {
    start() {
      release()
      resize()
      bodies = []
      puffs = []
      pops = []
      Object.assign(g, { on: true, over: false, score: 0, best: 0, hold: rollTier(), next: rollTier(), aim: W / 2, cool: 0.3, danger: 0 })
      g.keys.clear()
      shell.extra(hud())
    },
    stop() {
      g.on = false
      g.keys.clear()
      resize()
      fillShowcase()
    },
  })
  const KEYMAP: Record<string, string> = { ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r' }
  window.addEventListener('keydown', (e) => {
    if (!g.on) return
    if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      e.preventDefault()
      if (!e.repeat) drop()
      return
    }
    const k = KEYMAP[e.key]
    if (!k) return
    e.preventDefault()
    g.keys.add(k)
  })
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.key]
    if (k) g.keys.delete(k)
  })

  return {
    id: 'cart',
    num: '01',
    title: '弹力',
    color: '#ffb347',
    transition: 'crt',
    ambience: 'cart',
    el,
    playing: () => shell.playing,
    enter() {
      active = true
      last = performance.now()
      resize()
      if (!g.on) fillShowcase()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      release()
      shell.quit()
    },
  }
}
