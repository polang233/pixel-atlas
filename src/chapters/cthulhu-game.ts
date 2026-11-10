/**
 * 别被看见 — red light / green light under a sleeping eye.
 * Hold to walk while the eye is shut, freeze the moment it opens. A tide of
 * tentacles follows from behind, so standing still forever is not an option.
 */
import { sound } from '../audio'
import { drawText, textWidth } from '../pixelfont'
import type { Sprite } from '../sprites'
import { reducedMotion } from '../types'

export interface StalkUI {
  score(n: number): void
  extra(html: string): void
  end(score: number, title: string, sub: string): void
  /** shared with the chapter so the page itself warps as sanity drops */
  san(v?: number): number
  say(text: string): void
}

type EyeState = 'shut' | 'stir' | 'open'
interface Prop { x: number; kind: 'pillar' | 'tome' | 'idol'; spr: Sprite }
interface Pick { x: number; kind: 'candle' | 'amulet'; spr: Sprite; taken: boolean }
interface Mote { x: number; y: number; v: number; g: number }
interface Pop { x: number; y: number; text: string; t: number; color: string }

const H = 144
const GROUND = 116

export function createStalk(canvas: HTMLCanvasElement, sprites: Sprite[], ui: StalkUI) {
  const g = canvas.getContext('2d')!
  const by = (s: string) => sprites.filter((q) => q.subject === s)
  const pillars = by('rune obelisk')
  const stones = [...by('holed rune stone'), ...by('serpent idol'), ...by('skull idol')]
  const tomes = [...by('eldritch tome'), ...by('shadow tome'), ...by('summoning tome')]
  const candles = by('candle')
  const amulets = by('eye amulet')
  const tentacles = [...by('kraken tentacle'), ...by('tentacle monster')]
  const cache = new Map<Sprite, HTMLCanvasElement>()
  const img = (s: Sprite) => {
    let c = cache.get(s)
    if (!c) {
      c = document.createElement('canvas')
      c.width = c.height = 16
      c.getContext('2d')!.putImageData(s.data, 0, 0)
      cache.set(s, c)
    }
    return c
  }
  const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0]

  let W = 256
  let on = false
  let over = false
  let held = false
  let last = 0
  let time = 0
  let px = 0            // player world x
  let tide = 0          // world x of the tide front
  let eye: EyeState = 'shut'
  let eyeT = 0          // seconds left in the current state
  let lid = 0           // 0 shut .. 1 wide open
  let fake = false
  let seen = 0          // seconds of being watched while moving (for effects)
  let movedThisOpen = false
  let streak = 0
  let bonus = 0
  let stepT = 0
  let hurtT = 0
  let shake = 0
  let genX = 0
  let endT = -1
  let endWhy = ''
  let props: Prop[] = []
  let picks: Pick[] = []
  let pops: Pop[] = []
  const motes: Mote[] = []

  const level = () => Math.floor(px / 400)
  const metres = () => Math.floor(px / 8)

  function resize() {
    const r = canvas.parentElement!.getBoundingClientRect()
    const aspect = Math.max(1.05, Math.min(2, r.width / Math.max(1, r.height)))
    W = Math.round(H * aspect)
    canvas.width = W
    canvas.height = H
  }

  function generate(to: number) {
    while (genX < to) {
      genX += 26 + Math.random() * 30
      const r = Math.random()
      if (r < 0.34) props.push({ x: genX, kind: 'pillar', spr: pick(pillars) })
      else if (r < 0.5) props.push({ x: genX, kind: 'idol', spr: pick(stones) })
      else if (r < 0.6) props.push({ x: genX, kind: 'tome', spr: pick(tomes) })
      else if (r < 0.8) picks.push({ x: genX, kind: 'candle', spr: pick(candles), taken: false })
      else if (r < 0.87 && genX > 260) picks.push({ x: genX, kind: 'amulet', spr: pick(amulets), taken: false })
    }
  }

  function setEye(s: EyeState) {
    eye = s
    const lv = level()
    if (s === 'shut') {
      eyeT = Math.max(1.3, 2.4 + Math.random() * 2.4 - lv * 0.18)
      ui.say('它睡着了 · 按住前进')
    } else if (s === 'stir') {
      eyeT = Math.max(0.3, 0.62 - lv * 0.035)
      fake = lv >= 1 && Math.random() < Math.min(0.34, 0.12 + lv * 0.05)
      sound.whisper()
      ui.say('眼皮在动……')
    } else {
      eyeT = 1.1 + Math.random() * 1.5 + Math.min(1, lv * 0.12)
      movedThisOpen = false
      sound.eyeOpen()
      ui.say('别动！')
    }
  }

  function pop(x: number, y: number, text: string, color = '#ffd166') {
    pops.push({ x, y, text, t: 0, color })
  }

  function start() {
    resize()
    on = true
    over = false
    held = false
    px = 0
    tide = -110
    lid = 0
    seen = 0
    streak = 0
    bonus = 0
    shake = 0
    endT = -1
    genX = 60
    props = []
    picks = []
    pops = []
    motes.length = 0
    for (let i = 0; i < 26; i++) motes.push({ x: Math.random() * 320, y: Math.random() * GROUND, v: 2 + Math.random() * 6, g: (Math.random() * 6) | 0 })
    ui.san(100)
    last = performance.now()
    time = 0
    setEye('shut')
    eyeT = 3.2
  }

  function stop() {
    on = false
    held = false
  }

  function finish(why: string) {
    if (over) return
    over = true
    endWhy = why
    endT = 0
    shake = 6
    sound.noise(1.2, { f0: 300, f1: 2400, q: 6, vol: 0.06, attack: 0.5 })
  }

  function update(dt: number) {
    time += dt
    if (over) {
      endT += dt
      lid = Math.min(1, lid + dt * 4)
      if (endT > 1.1 && endT - dt <= 1.1) {
        const score = metres() + bonus
        ui.end(score, endWhy, `走了 ${metres()} 米 · 连续 ${streak} 次没被察觉`)
      }
      return
    }
    const lv = level()
    const moving = held
    // eye state machine
    eyeT -= dt
    if (eye === 'shut') {
      lid = Math.max(0, lid - dt * 5)
      if (eyeT <= 0) setEye('stir')
    } else if (eye === 'stir') {
      lid = 0.1 + Math.abs(Math.sin(time * 38)) * 0.12
      if (eyeT <= 0) {
        if (fake) {
          fake = false
          setEye('shut')
          eyeT = 0.7 + Math.random() * 1.2
        } else setEye('open')
      }
    } else {
      lid = Math.min(1, lid + dt * 9)
      if (eyeT <= 0) {
        if (!movedThisOpen) {
          streak++
          const add = 40 * Math.min(streak, 8)
          bonus += add
          pop(px, GROUND - 26, `+${add}`, '#9fd18b')
          sound.banish()
        } else streak = 0
        setEye('shut')
      }
    }

    if (moving) {
      const speed = 40 + Math.min(14, lv * 2)
      px += speed * dt
      stepT -= dt
      if (stepT <= 0) {
        stepT = 0.26
        sound.step()
      }
    }
    // caught looking: a short grace so releasing on the cue is fair
    const watched = eye === 'open' && lid > 0.75 && moving
    if (watched) {
      movedThisOpen = true
      seen += dt
      ui.san(ui.san() - dt * 32)
      shake = Math.max(shake, 2.5)
      hurtT -= dt
      if (hurtT <= 0) {
        hurtT = 0.22
        sound.hurt()
      }
    } else seen = Math.max(0, seen - dt * 2)

    // the tide never sleeps
    tide += (17 + Math.min(15, lv * 2.2)) * dt
    if (tide < px - 190) tide = px - 190
    const gap = px - tide
    if (gap < 26) {
      ui.san(ui.san() - dt * (26 - gap) * 4)
      shake = Math.max(shake, 1.5)
    }

    for (const p of picks) {
      if (p.taken || Math.abs(p.x - px) > 7) continue
      p.taken = true
      if (p.kind === 'candle') {
        ui.san(Math.min(100, ui.san() + 9))
        bonus += 25
        pop(p.x, GROUND - 22, '+SAN', '#ffe9b0')
        sound.coin()
      } else {
        bonus += 300
        pop(p.x, GROUND - 22, '+300')
        sound.sparkle()
        // the amulet is its eye too: taking it wakes the big one at once
        if (eye !== 'open') {
          setEye('stir')
          eyeT = 0.34
          fake = false
        }
      }
    }
    generate(px + W)
    props = props.filter((p) => p.x > px - W)
    picks = picks.filter((p) => p.x > px - W)
    for (const p of pops) p.t += dt
    pops = pops.filter((p) => p.t < 0.9)
    shake = Math.max(0, shake - dt * 12)

    ui.score(metres() + bonus)
    const san = Math.max(0, Math.round(ui.san()))
    ui.extra(`<span class="san-chip">SAN ${san}</span> · 潮水 ${Math.max(0, Math.round(gap / 8))} 米${streak > 1 ? ` · 未察觉 ×${streak}` : ''}`)
    if (ui.san() <= 0) finish(gap < 26 ? '被潮水吞没' : '它看见你了')
  }

  // ---- drawing --------------------------------------------------------------------------
  function drawEye(cx: number, cy: number) {
    const rw = 34
    const rh = Math.round(15 * lid)
    // socket
    g.fillStyle = '#0a100c'
    for (let y = -18; y <= 18; y++) {
      const half = Math.round((rw + 5) * Math.sqrt(Math.max(0, 1 - (y / 19) ** 2)))
      g.fillRect(cx - half, cy + y, half * 2, 1)
    }
    if (rh < 1) {
      g.fillStyle = '#3c5a44'
      g.fillRect(cx - rw, cy, rw * 2, 1)
      g.fillStyle = '#24362a'
      for (let i = -rw + 4; i < rw; i += 8) g.fillRect(cx + i, cy + 1, 1, 2 + ((i + 99) % 3))
      return
    }
    const mad = seen > 0
    for (let y = -rh; y <= rh; y++) {
      const half = Math.round(rw * Math.sqrt(Math.max(0, 1 - (y / (rh + 0.5)) ** 2)))
      g.fillStyle = mad ? '#f2c4c4' : y < -rh * 0.3 ? '#a9bea4' : '#cfe0c8'
      g.fillRect(cx - half, cy + y, half * 2, 1)
    }
    // iris looks at the walker, lower left
    const ix = cx - 7
    const iy = cy + Math.min(rh - 2, 3)
    const ir = Math.min(9, rh)
    for (let y = -ir; y <= ir; y++) {
      if (Math.abs(y) > rh) continue
      const half = Math.round(Math.sqrt(ir * ir - y * y))
      g.fillStyle = mad ? '#d13b4a' : '#5f9a58'
      g.fillRect(ix - half, iy + y, half * 2, 1)
    }
    g.fillStyle = '#050607'
    const slit = Math.min(ir, rh)
    g.fillRect(ix - 1, iy - slit + 1, 3, slit * 2 - 1)
    g.fillStyle = '#fff'
    if (rh > 4) g.fillRect(ix + 3, iy - 4, 2, 2)
    // veins when angry
    if (mad) {
      g.fillStyle = '#b3323f'
      for (let i = 0; i < 5; i++) g.fillRect(cx - rw + 6 + i * 13, cy + ((i * 7 + Math.floor(time * 12)) % 5) - 2, 4, 1)
    }
  }

  function drawWalker(x: number, y: number, moving: boolean, froze: boolean) {
    const bob = moving ? Math.floor(time * 9) % 2 : 0
    const h = froze ? 9 : 12
    const top = y - h - bob
    g.fillStyle = '#0c120e'
    g.fillRect(x - 4, top - 1, 9, h + 1)
    g.fillStyle = '#2f4a38'
    g.fillRect(x - 3, top + 2, 7, h - 2)
    g.fillStyle = '#3f6249'
    g.fillRect(x - 2, top, 5, 4)
    g.fillStyle = '#050607'
    g.fillRect(x, top + 1, 3, 2)
    // candle in hand
    g.fillStyle = '#e8dfc8'
    g.fillRect(x + 5, top + 5, 1, 3)
    const fl = Math.floor(time * 14) % 2
    g.fillStyle = froze ? '#7a5a22' : '#ffd166'
    g.fillRect(x + 5, top + 3 - fl, 1, 2)
    // feet
    g.fillStyle = '#0c120e'
    if (moving) {
      const f = Math.floor(time * 9) % 2
      g.fillRect(x - 2 + f * 3, y - 1, 2, 1)
    } else {
      g.fillRect(x - 2, y - 1, 2, 1)
      g.fillRect(x + 1, y - 1, 2, 1)
    }
  }

  function draw() {
    const san = ui.san()
    const m = 1 - san / 100
    const camX = px - W * 0.34
    const sx = (wx: number) => Math.round(wx - camX)
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#050807'
    g.fillRect(0, 0, W, H)
    const k = reducedMotion ? 0 : shake
    g.translate(Math.round((Math.random() - 0.5) * k), Math.round((Math.random() - 0.5) * k))

    // sky bands
    const bands = ['#070b09', '#0a110d', '#0d1711', '#111e16']
    bands.forEach((c, i) => {
      g.fillStyle = c
      g.fillRect(0, 30 + i * 22, W, 22)
    })
    // far arches, slow parallax
    g.fillStyle = '#0b130e'
    for (let i = -1; i < 8; i++) {
      const ax = Math.round(i * 58 - ((camX * 0.25) % 58))
      g.fillRect(ax, 54, 12, GROUND - 54)
      g.fillRect(ax - 4, 50, 20, 5)
    }
    g.fillStyle = '#0e1912'
    for (let i = -1; i < 6; i++) {
      const ax = Math.round(i * 84 - ((camX * 0.5) % 84))
      g.fillRect(ax, 40, 16, GROUND - 40)
      g.fillRect(ax - 5, 36, 26, 5)
    }
    // drifting glyph motes
    for (const o of motes) {
      const x = (((o.x - camX * 0.4 - time * o.v) % (W + 20)) + W + 20) % (W + 20) - 10
      const y = (o.y + Math.sin(time * 0.6 + o.x) * 4) | 0
      g.fillStyle = o.g % 2 ? '#24402e' : '#1a2c20'
      g.fillRect(x | 0, y, 1 + (o.g % 2), 1)
    }

    drawEye(W >> 1, 26)
    // its gaze: a dithered cone on the ground while it is open
    if (lid > 0.5 && eye === 'open') {
      const cx = W >> 1
      for (let y = 44; y < GROUND; y += 2) {
        const spread = ((y - 30) / (GROUND - 30)) * W * 0.62
        for (let x = Math.round(cx - spread); x < cx + spread; x += 2) {
          if ((x + y + Math.floor(time * 20)) % 4 === 0) {
            g.fillStyle = seen > 0 ? 'rgba(209,59,74,0.34)' : 'rgba(207,224,200,0.13)'
            g.fillRect(x, y, 1, 1)
          }
        }
      }
    }

    // floor
    g.fillStyle = '#16241b'
    g.fillRect(0, GROUND, W, H - GROUND)
    g.fillStyle = '#243a2b'
    g.fillRect(0, GROUND, W, 1)
    g.fillStyle = '#0f1a13'
    for (let i = -1; i < W / 16 + 2; i++) {
      const fx = Math.round(i * 16 - (((camX % 16) + 16) % 16))
      g.fillRect(fx, GROUND + 1, 1, H - GROUND)
      g.fillRect(fx + 8, GROUND + 9, 1, H - GROUND)
    }
    g.fillRect(0, GROUND + 9, W, 1)
    g.fillRect(0, GROUND + 19, W, 1)

    for (const p of props) {
      const x = sx(p.x)
      if (x < -20 || x > W + 20) continue
      if (p.kind === 'pillar') {
        g.drawImage(img(p.spr), x - 16, GROUND - 32, 32, 32)
      } else {
        g.globalAlpha = 0.85
        g.drawImage(img(p.spr), x - 8, GROUND - 15)
        g.globalAlpha = 1
      }
    }
    for (const p of picks) {
      if (p.taken) continue
      const x = sx(p.x)
      if (x < -20 || x > W + 20) continue
      const bobY = Math.round(Math.sin(time * 4 + p.x) * 1.5)
      if (p.kind === 'amulet') {
        g.fillStyle = 'rgba(255,209,102,0.16)'
        g.fillRect(x - 10, GROUND - 26 + bobY, 20, 20)
      }
      g.drawImage(img(p.spr), x - 8, GROUND - 24 + bobY)
    }

    const froze = eye === 'open' && !held
    drawWalker(sx(px), GROUND, held && !over, froze)

    // the tide: black water with tentacles feeling forward
    const tx = sx(tide)
    if (tx > -40) {
      g.fillStyle = '#020403'
      g.fillRect(-4, 34, tx - 6, H)
      for (let y = 34; y < H; y += 2) {
        const reach = Math.round(Math.sin(time * 2.4 + y * 0.21) * 4 + Math.sin(time * 5 + y) * 2)
        g.fillRect(tx - 8, y, 8 + reach, 2)
      }
      for (let i = 0; i < 4; i++) {
        const t = tentacles[i % tentacles.length]
        const wob = Math.round(Math.sin(time * 3 + i * 1.7) * 3)
        g.drawImage(img(t), tx - 12 + wob + (i % 2) * 5, GROUND - 16 - i * 17)
      }
    }

    for (const p of pops) {
      const x = sx(p.x) - (textWidth(p.text) >> 1)
      drawText(g, p.text, x, Math.round(p.y - p.t * 16), p.color)
    }

    // madness: scanline tears and a darkening frame
    if (m > 0.35 && !reducedMotion) {
      const n = Math.floor((m - 0.3) * 9)
      for (let i = 0; i < n; i++) {
        const y = (Math.random() * H) | 0
        const off = Math.round((Math.random() - 0.5) * m * 14)
        g.drawImage(canvas, 0, y, W, 2, off, y, W, 2)
      }
    }
    if (seen > 0 && Math.floor(time * 16) % 2 === 0) {
      g.fillStyle = 'rgba(209,59,74,0.14)'
      g.fillRect(0, 0, W, H)
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
    // vignette steps
    g.fillStyle = `rgba(2,4,3,${0.25 + m * 0.4})`
    g.fillRect(0, 0, W, 6)
    g.fillRect(0, H - 6, W, 6)
    g.fillRect(0, 0, 6, H)
    g.fillRect(W - 6, 0, 6, H)
    if (over) {
      g.fillStyle = `rgba(2,4,3,${Math.min(0.8, endT)})`
      g.fillRect(0, 0, W, H)
    }
  }

  function frame(now: number) {
    if (!on) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    update(dt)
    draw()
  }

  const hold = (v: boolean) => {
    if (on && !over) held = v
    else held = false
  }
  const KEYS = new Set([' ', 'ArrowRight', 'd', 'D'])
  window.addEventListener('keydown', (e) => {
    if (!on || !KEYS.has(e.key)) return
    e.preventDefault()
    hold(true)
  })
  window.addEventListener('keyup', (e) => {
    if (on && KEYS.has(e.key)) hold(false)
  })
  const zone = canvas.parentElement!
  zone.addEventListener('pointerdown', (e) => {
    if (!on || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    hold(true)
  })
  window.addEventListener('pointerup', () => hold(false))
  window.addEventListener('pointercancel', () => hold(false))
  window.addEventListener('blur', () => hold(false))
  window.addEventListener('resize', () => on && resize())

  return { start, stop, frame }
}
