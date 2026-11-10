/**
 * 卡带 · a side-scrolling platformer drawn at 256×144 with dataset sprites,
 * shown through a CRT shader (scanlines, aperture grille, bloom, curved
 * glass). In the showcase it plays itself like an arcade attract mode;
 * press start and it is yours.
 */
import { sound } from '../audio'
import { GameShell } from '../game'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const SW = 256
const SH = 144
const T = 16
const ROWS = SH / T
const LW = 150
const GRAV = 980
const RUN = 92
const JUMP = 338

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uSrc;
uniform float uOn;
uniform float uTime;
out vec4 o;

vec3 fetchRow(vec2 uv, float blur) {
  vec2 px = uv * uSrc;
  float x = px.x - 0.5;
  float fx = fract(x);
  float y = floor(px.y) + 0.5;
  vec3 a = texture(uTex, vec2(floor(x) + 0.5, y) / uSrc).rgb;
  vec3 b = texture(uTex, vec2(floor(x) + 1.5, y) / uSrc).rgb;
  vec3 c = texture(uTex, vec2(floor(x) - 0.5, y) / uSrc).rgb;
  vec3 d = texture(uTex, vec2(floor(x) + 2.5, y) / uSrc).rgb;
  vec3 sharp = mix(a, b, step(0.5, fx));
  vec3 soft = mix(a, b, smoothstep(0.0, 1.0, fx)) * 0.7 + (c * (1.0 - fx) + d * fx) * 0.3;
  return mix(sharp, soft, blur);
}

void main() {
  vec2 f = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float scale = min(uRes.x / uSrc.x, uRes.y / uSrc.y);
  vec2 size = uSrc * scale;
  vec2 origin = (uRes - size) * 0.5;
  vec2 uv = (f - origin) / size;
  float s = uOn;

  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + s * dot(cc, cc) * 0.2);
  vec3 bezel = vec3(0.02, 0.018, 0.03);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(bezel, 1.0); return; }

  vec3 col = fetchRow(uv, s);
  if (s > 0.0) {
    vec3 g = vec3(0.0);
    for (int i = -3; i <= 3; i++) for (int j = -2; j <= 2; j++) g += texture(uTex, uv + vec2(float(i), float(j)) * 1.4 / uSrc).rgb;
    g /= 35.0;
    col = mix(col, max(col, g), 0.3 * s) + g * g * 0.22 * s;
  }
  float py = fract(uv.y * uSrc.y) - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float sigma = mix(0.2, 0.44, clamp(lum, 0.0, 1.0));
  float beam = exp(-py * py / (2.0 * sigma * sigma));
  col *= mix(1.0, beam * 1.22, s);
  float stripe = mod(floor(f.x / max(1.0, scale / 3.0)), 3.0);
  vec3 mask = stripe < 1.0 ? vec3(1.0, 0.6, 0.6) : stripe < 2.0 ? vec3(0.6, 1.0, 0.6) : vec3(0.6, 0.6, 1.0);
  col *= mix(vec3(1.0), mask * 1.25, s);
  vec2 v = uv - 0.5;
  col *= mix(1.0, 1.0 - dot(v, v) * 1.5, s);
  col *= 1.0 - s * 0.02 * sin(uTime * 110.0);
  float band = smoothstep(0.0, 0.05, 0.05 - abs(fract(uv.y * 0.8 - uTime * 0.15) - 0.5));
  col += s * band * 0.03;
  vec2 corner = abs(v) - (0.5 - 0.04);
  float round_ = length(max(corner, 0.0));
  if (s > 0.0) col = mix(col, bezel, smoothstep(0.035, 0.045, round_) * s);
  o = vec4(col, 1.0);
}`

// 3×5 pixel font for the in-game HUD
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '111100101101111', H: '101101111101101', I: '111010010010111', K: '101101110101101',
  L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '111101101101111', P: '111101111100100',
  R: '110101110101101', S: '111100111001111', T: '111010010010010', U: '101101101101111', V: '101101101101010',
  W: '101101111111101', Y: '101101010010010', x: '000101010101000', ':': '000010000010000', '!': '010010010000010',
}

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number; ground: boolean }
interface Slime extends Body { alive: boolean; dead: number; kind: number }
interface Bat { x: number; y0: number; ph: number; alive: boolean; dead: number }
interface Coin { x: number; y: number; taken: boolean }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; c: string }

function buildLevel(seed: number) {
  const rnd = mulberry32(seed)
  const map = new Uint8Array(LW * ROWS)
  const coins: Coin[] = []
  const slimes: Slime[] = []
  const bats: Bat[] = []
  const fill = (x0: number, x1: number, h: number) => {
    for (let x = x0; x < Math.min(LW, x1); x++) for (let y = ROWS - h; y < ROWS; y++) map[y * LW + x] = 1
  }
  const top = (h: number) => (ROWS - h) * T
  let gh = 2
  fill(0, 12, gh)
  let x = 12
  while (x < LW - 16) {
    if (rnd() < 0.26) {
      const g = 2 + (rnd() < 0.45 ? 1 : 0)
      for (let k = 0; k <= g; k++) coins.push({ x: (x + k) * T - 4, y: top(gh) - 30 - Math.sin((k / g) * Math.PI) * 18, taken: false })
      x += g
    }
    const len = 4 + Math.floor(rnd() * 7)
    const up = rnd() < 0.5 ? 0 : rnd() < 0.55 ? 1 : -1
    gh = Math.max(2, Math.min(4, gh + up))
    fill(x, x + len, gh)
    if (len >= 6 && rnd() < 0.7) slimes.push({ x: (x + len / 2) * T, y: top(gh) - 10, w: 12, h: 10, vx: rnd() < 0.5 ? -20 : 20, vy: 0, ground: false, alive: true, dead: 0, kind: Math.floor(rnd() * 3) })
    const r = rnd()
    if (r < 0.34 && len >= 5) {
      const py = ROWS - gh - 4
      for (let k = 1; k < 4; k++) map[py * LW + x + k] = 2
      for (let k = 1; k < 4; k++) coins.push({ x: (x + k) * T, y: py * T - 16, taken: false })
    } else if (r < 0.6) {
      for (let k = 1; k < Math.min(4, len - 1); k++) coins.push({ x: (x + k) * T, y: top(gh) - 22, taken: false })
    }
    if (rnd() < 0.28 && x > 24) bats.push({ x: (x + len / 2) * T, y0: top(gh) - 56, ph: rnd() * 6, alive: true, dead: 0 })
    x += len
  }
  fill(x, LW, gh)
  const goal = { x: (LW - 6) * T, y: top(gh) - 16 }
  return { map, coins, slimes, bats, goal }
}

export function createCart(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.cart-gl')!
  const crtBtn = el.querySelector<HTMLButtonElement>('.cart-crt')!
  const pad = el.querySelector<HTMLElement>('.cart-pad')!

  const src = document.createElement('canvas')
  src.width = SW
  src.height = SH
  const g = src.getContext('2d')!
  g.imageSmoothingEnabled = false

  const pick = (re: RegExp, k = 0) => sprites.filter((s) => re.test(s.subject))[k] ?? sprites[k]
  const sc = (s: Sprite) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    c.getContext('2d')!.putImageData(s.data, 0, 0)
    return c
  }
  const knight = sc(pick(/knight/))
  const slimeImg = [sc(pick(/^slime/)), sc(pick(/king slime/)), sc(pick(/slime/, 2))]
  const coinImg = sc(pick(/coin/))
  const heartImg = sc(pick(/heart/))
  const chestImg = sc(pick(/chest/))
  const batImg = sc(pick(/bat/))
  const castleImg = sc(pick(/castle/))
  const ghostImg = sc(pick(/ghost/))

  // tile textures, drawn once
  const tile = (draw: (c: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas')
    c.width = c.height = T
    draw(c.getContext('2d')!)
    return c
  }
  const speck = (c: CanvasRenderingContext2D, col: string, seed: number) => {
    const r = mulberry32(seed)
    c.fillStyle = col
    for (let i = 0; i < 9; i++) c.fillRect(Math.floor(r() * 15), 3 + Math.floor(r() * 12), 1 + (r() < 0.3 ? 1 : 0), 1)
  }
  const dirt = tile((c) => {
    c.fillStyle = '#4a2f3a'
    c.fillRect(0, 0, T, T)
    speck(c, '#5e3c46', 3)
    speck(c, '#36222c', 9)
  })
  const grass = tile((c) => {
    c.drawImage(dirt, 0, 0)
    c.fillStyle = '#3e9a5a'
    c.fillRect(0, 0, T, 4)
    c.fillStyle = '#7fe08a'
    c.fillRect(0, 0, T, 1)
    c.fillStyle = '#2b6b45'
    for (let x = 0; x < T; x += 3) c.fillRect(x, 4, 1, 1 + (x % 2))
  })
  const plank = tile((c) => {
    c.fillStyle = '#b8743e'
    c.fillRect(0, 0, T, T)
    c.fillStyle = '#e3a35e'
    c.fillRect(1, 1, 14, 1)
    c.fillStyle = '#6e3d22'
    c.fillRect(0, 15, T, 1)
    c.fillRect(15, 0, 1, T)
    c.fillRect(0, 7, T, 1)
    c.fillStyle = '#8f522d'
    c.fillRect(4, 3, 1, 3)
    c.fillRect(10, 10, 1, 3)
  })
  const stars = Array.from({ length: 46 }, (_, i) => [((i * 97) % 512) + Math.random() * 8, Math.random() * 64, Math.random() * 10])

  // ---- state -------------------------------------------------------------------
  let L = buildLevel(7)
  const P: Body & { face: number; coyote: number; buffer: number; inv: number; safeX: number; safeY: number; squash: number } = {
    x: 24, y: 80, w: 10, h: 14, vx: 0, vy: 0, ground: false, face: 1, coyote: 0, buffer: 0, inv: 0, safeX: 24, safeY: 80, squash: 0,
  }
  let cx = 0
  let bits: Bit[] = []
  let hearts = 3
  let score = 0
  let coins = 0
  let timeLeft = 200
  let demo = true
  let done = false
  const keys = { l: false, r: false, j: false }
  let jumpHeld = false
  let crtOn = true
  let raw = 0

  const solid = (tx: number, ty: number) => {
    if (tx < 0 || tx >= LW) return true
    if (ty < 0 || ty >= ROWS) return false
    return L.map[ty * LW + tx] > 0
  }
  const hits = (b: Body) => {
    for (let tx = Math.floor(b.x / T); tx <= Math.floor((b.x + b.w - 0.01) / T); tx++)
      for (let ty = Math.floor(b.y / T); ty <= Math.floor((b.y + b.h - 0.01) / T); ty++) if (solid(tx, ty)) return true
    return false
  }
  function move(b: Body, dt: number) {
    b.x += b.vx * dt
    if (hits(b)) {
      if (b.vx > 0) b.x = Math.floor((b.x + b.w) / T) * T - b.w - 0.01
      else b.x = (Math.floor(b.x / T) + 1) * T + 0.01
      b.vx = 0
    }
    b.y += b.vy * dt
    b.ground = false
    if (hits(b)) {
      if (b.vy > 0) {
        b.y = Math.floor((b.y + b.h) / T) * T - b.h - 0.01
        b.ground = true
      } else b.y = (Math.floor(b.y / T) + 1) * T + 0.01
      b.vy = 0
    }
  }

  const burst = (x: number, y: number, c: string, n = 8, up = 80) => {
    for (let i = 0; i < n; i++) bits.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * up - 30, life: 0.5 + Math.random() * 0.3, c })
  }

  function reset(isDemo: boolean) {
    L = buildLevel(isDemo ? 7 : 7 + Math.floor(Math.random() * 1000))
    Object.assign(P, { x: 24, y: 80, vx: 0, vy: 0, face: 1, inv: 0, safeX: 24, safeY: 80, coyote: 0, buffer: 0 })
    bits = []
    hearts = 3
    score = 0
    coins = 0
    timeLeft = 200
    demo = isDemo
    done = false
    cx = 0
  }

  function hurt() {
    if (P.inv > 0) return
    sound.hurt()
    if (!demo) hearts--
    P.inv = 1.4
    P.vy = -200
    P.vx = -P.face * 120
    if (hearts <= 0) finish(false)
  }
  function finish(won: boolean) {
    if (done) return
    done = true
    if (demo) {
      setTimeout(() => demo && reset(true), 1200)
      return
    }
    if (won) score += 1000 + Math.ceil(timeLeft) * 10
    shell.score(score)
    shell.end(score, won ? '宝箱到手！' : '骑士倒下了', won ? `收集 ${coins} 枚金币 · 剩余时间 ${Math.ceil(timeLeft)} 秒` : `收集了 ${coins} 枚金币`, won)
  }

  // ---- the attract-mode pilot ---------------------------------------------------------
  function pilot() {
    const foot = Math.floor((P.y + P.h + 2) / T)
    const front = P.x + P.w
    const gap = !solid(Math.floor((front + 12) / T), foot) && !solid(Math.floor((front + 4) / T), foot)
    const wall = solid(Math.floor((front + 6) / T), Math.floor((P.y + P.h - 3) / T))
    const enemy = L.slimes.some((s) => s.alive && s.x - front > -2 && s.x - front < 30 && Math.abs(s.y - P.y) < 18)
    keys.r = true
    keys.l = false
    if (P.ground && (gap || wall || enemy)) keys.j = true
    else if (P.vy > 0) keys.j = false
  }

  function step(dt: number) {
    if (done) {
      bits.forEach((b) => (b.life -= dt))
      return
    }
    if (demo) pilot()
    else timeLeft -= dt
    if (!demo && timeLeft <= 0) {
      timeLeft = 0
      finish(false)
    }
    // run with a little acceleration
    const want = (keys.r ? 1 : 0) - (keys.l ? 1 : 0)
    if (want) P.face = want
    const acc = P.ground ? 900 : 520
    if (want) P.vx += Math.sign(want * RUN - P.vx) * Math.min(acc * dt, Math.abs(want * RUN - P.vx))
    else P.vx -= Math.sign(P.vx) * Math.min(Math.abs(P.vx), (P.ground ? 1100 : 300) * dt)
    // jump: coyote time + input buffer + variable height
    P.coyote = P.ground ? 0.1 : P.coyote - dt
    if (keys.j && !jumpHeld) P.buffer = 0.12
    else P.buffer -= dt
    if (P.buffer > 0 && P.coyote > 0) {
      P.vy = -JUMP
      P.coyote = 0
      P.buffer = 0
      P.squash = -0.25
      sound.jump()
    }
    if (!keys.j && P.vy < -120) P.vy = -120
    jumpHeld = keys.j
    P.vy = Math.min(420, P.vy + GRAV * dt)
    const wasGround = P.ground
    move(P, dt)
    if (P.ground && !wasGround) {
      P.squash = 0.25
      burst(P.x + P.w / 2, P.y + P.h, '#c9b8d8', 3, 20)
    }
    if (P.ground && solid(Math.floor((P.x + 1) / T), Math.floor((P.y + P.h + 2) / T)) && solid(Math.floor((P.x + P.w - 1) / T), Math.floor((P.y + P.h + 2) / T))) {
      P.safeX = P.x
      P.safeY = P.y
    }
    P.inv = Math.max(0, P.inv - dt)
    P.squash *= Math.exp(-dt * 12)
    if (P.y > SH + 24) {
      sound.tone(500, 0.5, { type: 'square', vol: 0.05, slide: 80 })
      if (!demo) hearts--
      if (hearts <= 0) return finish(false)
      Object.assign(P, { x: P.safeX - 20, y: P.safeY - 4, vx: 0, vy: 0, inv: 1.4, buffer: 0 })
      if (hits(P)) P.x = P.safeX
    }

    for (const s of L.slimes) {
      if (!s.alive) {
        s.dead += dt
        continue
      }
      if (Math.abs(s.x - P.x) > SW * 1.2) continue
      s.vy = Math.min(420, s.vy + GRAV * dt)
      const vx = s.vx
      move(s, dt)
      if (s.vx === 0) s.vx = -vx
      // turn at ledges
      const ahead = s.vx > 0 ? s.x + s.w + 1 : s.x - 1
      if (s.ground && !solid(Math.floor(ahead / T), Math.floor((s.y + s.h + 2) / T))) s.vx = -s.vx
      if (s.y > SH + 20) s.alive = false
      if (overlap(P, s)) {
        if (P.vy > 0 && P.y + P.h - s.y < 9) {
          s.alive = false
          P.vy = -240
          score += 200
          sound.stomp()
          burst(s.x + 6, s.y + 6, '#7fe08a', 10)
        } else hurt()
      }
    }
    for (const b of L.bats) {
      if (!b.alive) {
        b.dead += dt
        continue
      }
      b.ph += dt
      const bx = b.x + Math.sin(b.ph * 0.8) * 24
      const by = b.y0 + Math.sin(b.ph * 2.6) * 12
      const box = { x: bx + 2, y: by + 4, w: 12, h: 8, vx: 0, vy: 0, ground: false }
      if (overlap(P, box)) {
        if (P.vy > 0 && P.y + P.h - box.y < 8) {
          b.alive = false
          P.vy = -240
          score += 300
          sound.stomp()
          burst(bx + 8, by + 8, '#b48cff', 10)
        } else hurt()
      }
    }
    for (const c of L.coins) {
      if (c.taken) continue
      if (P.x < c.x + 12 && P.x + P.w > c.x + 4 && P.y < c.y + 14 && P.y + P.h > c.y + 2) {
        c.taken = true
        coins++
        score += 100
        sound.coin()
        burst(c.x + 8, c.y + 8, '#ffd84d', 5, 50)
      }
    }
    if (P.x + P.w > L.goal.x + 2 && P.y + P.h > L.goal.y) {
      burst(L.goal.x + 8, L.goal.y, '#ffd84d', 24, 140)
      finish(true)
    }
    for (const b of bits) {
      b.vy += 300 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
    }
    bits = bits.filter((b) => b.life > 0)
    if (!demo) {
      shell.score(score)
    }
    const target = Math.max(0, Math.min(LW * T - SW, P.x - SW * 0.38 + P.face * 18))
    cx += (target - cx) * Math.min(1, dt * 5)
  }
  const overlap = (a: Body, b: Body) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  // ---- drawing --------------------------------------------------------------------
  function text(s: string, x: number, y: number, color: string, shadow = true) {
    for (const pass of shadow ? [1, 0] : [0]) {
      g.fillStyle = pass ? '#000' : color
      let xx = x
      for (const ch of s) {
        const gl = FONT[ch]
        if (gl) for (let i = 0; i < 15; i++) if (gl[i] === '1') g.fillRect(xx + (i % 3) + pass, y + Math.floor(i / 3) + pass, 1, 1)
        xx += 4
      }
    }
  }

  function draw(t: number) {
    const bands = ['#120c2c', '#1d1b4f', '#2f3a83', '#4a64b8', '#7b97dc', '#b7c7ee']
    for (let b = 0; b < bands.length; b++) {
      g.fillStyle = bands[b]
      g.fillRect(0, b * 14, SW, 14)
      if (b < bands.length - 1) {
        g.fillStyle = bands[b + 1]
        for (let x = 0; x < SW; x++) for (let y = 2; y < 4; y++) if ((x + y) % 2 === 0) g.fillRect(x, b * 14 + 10 + y, 1, 1)
      }
    }
    g.fillStyle = bands[5]
    g.fillRect(0, 84, SW, SH - 84)
    const sx = cx * 0.05
    for (const [x, y, p] of stars) {
      if (Math.sin(t * 2 + p) > -0.3) {
        g.fillStyle = '#fff'
        g.fillRect(Math.floor((((x - sx) % 512) + 512) % 512) % SW, y | 0, 1, 1)
      }
    }
    // moon
    g.fillStyle = '#fff3d6'
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dy * dy <= 36 && (dx - 3) ** 2 + (dy + 2) ** 2 > 26) g.fillRect(212 + dx, 20 + dy, 1, 1)
    // far hills + castle, near hills (parallax)
    g.fillStyle = '#2b3d6b'
    for (let x = 0; x < SW; x++) {
      const wx = x + cx * 0.2
      const h = 30 + Math.round(Math.sin(wx * 0.03) * 10 + Math.sin(wx * 0.09) * 4)
      g.fillRect(x, 112 - h, 1, h + 40)
    }
    const castleX = Math.round(((180 - cx * 0.2) % 600 + 600) % 600) - 40
    g.drawImage(castleImg, castleX, 52, 32, 32)
    g.fillStyle = '#22305a'
    for (let x = 0; x < SW; x++) {
      const wx = x + cx * 0.45
      const h = 16 + Math.round(Math.sin(wx * 0.05 + 2) * 7)
      g.fillRect(x, 120 - h, 1, h + 30)
    }
    // a ghost drifting in the background, half transparent
    g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 2)
    g.drawImage(ghostImg, Math.round(((300 - cx * 0.3 + t * 6) % 420 + 420) % 420) - 30, 40 + Math.round(Math.sin(t * 1.3) * 4))
    g.globalAlpha = 1

    const ox = Math.round(cx)
    const tx0 = Math.floor(ox / T)
    for (let tx = tx0; tx <= tx0 + SW / T + 1; tx++)
      for (let ty = 0; ty < ROWS; ty++) {
        const v = tx >= 0 && tx < LW ? L.map[ty * LW + tx] : 0
        if (!v) continue
        const img = v === 2 ? plank : ty > 0 && L.map[(ty - 1) * LW + tx] === 1 ? dirt : grass
        g.drawImage(img, tx * T - ox, ty * T)
      }
    // goal chest with a sparkle
    g.drawImage(chestImg, L.goal.x - ox, L.goal.y)
    if (Math.floor(t * 4) % 2) {
      g.fillStyle = '#ffd84d'
      g.fillRect(L.goal.x - ox + 7, L.goal.y - 5, 1, 3)
      g.fillRect(L.goal.x - ox + 6, L.goal.y - 4, 3, 1)
    }
    for (const c of L.coins) {
      if (c.taken) continue
      const w = Math.max(2, Math.round(Math.abs(Math.cos(t * 4 + c.x * 0.05)) * 16))
      g.drawImage(coinImg, Math.round(c.x - ox + (16 - w) / 2), Math.round(c.y + Math.sin(t * 3 + c.x) * 1.5), w, 16)
    }
    for (const s of L.slimes) {
      if (!s.alive && s.dead > 0.4) continue
      const hop = s.alive ? Math.abs(Math.sin(t * 6 + s.x)) : 0
      const sq = s.alive ? 1 - hop * 0.15 : 0.3
      const w = 16 * (2 - sq)
      const h = 16 * sq
      g.save()
      if (s.vx < 0) {
        g.translate(Math.round(s.x - ox + 6) * 2, 0)
        g.scale(-1, 1)
      }
      g.drawImage(slimeImg[s.kind], Math.round(s.x - ox + 6 - w / 2), Math.round(s.y + s.h - h - hop * 3), Math.round(w), Math.round(h))
      g.restore()
    }
    for (const b of L.bats) {
      if (!b.alive && b.dead > 0.4) continue
      const bx = b.x + Math.sin(b.ph * 0.8) * 24
      const by = b.y0 + Math.sin(b.ph * 2.6) * 12
      const flap = Math.floor(t * 10) % 2 ? 12 : 16
      g.drawImage(batImg, Math.round(bx - ox), Math.round(by + (16 - flap) / 2), 16, b.alive ? flap : 4)
    }
    // player
    if (!(P.inv > 0 && Math.floor(t * 20) % 2)) {
      const run = P.ground && Math.abs(P.vx) > 10 ? Math.floor(t * 12) % 2 : 0
      const sw = Math.round(16 * (1 + P.squash))
      const sh = Math.round(16 * (1 - P.squash))
      const px = Math.round(P.x - ox + P.w / 2)
      const py = Math.round(P.y + P.h)
      g.save()
      if (P.face < 0) {
        g.translate(px * 2, 0)
        g.scale(-1, 1)
      }
      g.drawImage(knight, px - sw / 2, py - sh - run + 1, sw, sh)
      g.restore()
    }
    for (const b of bits) {
      g.fillStyle = b.c
      g.fillRect(Math.round(b.x - ox), Math.round(b.y), 2, 2)
    }
    // HUD
    if (demo) {
      text('DEMO', 6, 6, '#9ad1ff')
      if (Math.floor(t * 1.6) % 2) text('PRESS START', 106, 64, '#ffd84d')
      text('SCORE ' + String(score).padStart(5, '0'), 178, 6, '#ffffff')
    } else {
      for (let i = 0; i < 3; i++) {
        g.globalAlpha = i < hearts ? 1 : 0.25
        g.drawImage(heartImg, 4 + i * 11, 4, 10, 10)
      }
      g.globalAlpha = 1
      g.drawImage(coinImg, 42, 3, 12, 12)
      text('x' + String(coins).padStart(2, '0'), 55, 7, '#ffd84d')
      text('TIME ' + String(Math.ceil(timeLeft)).padStart(3, '0'), 100, 7, '#ffffff')
      text('SCORE ' + String(score).padStart(5, '0'), 178, 7, '#ffffff')
    }
  }

  // ---- GL: CRT ----------------------------------------------------------------------
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  let present = (_t: number) => {}
  if (gl) {
    const prog = gl.createProgram()!
    for (const [type, s] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, FRAG],
    ] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, s)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh))
      gl.attachShader(prog, sh)
    }
    gl.linkProgram(prog)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const U = (n: string) => gl.getUniformLocation(prog, n)
    gl.uniform2f(U('uSrc'), SW, SH)
    const uRes = U('uRes')
    const uOn = U('uOn')
    const uTime = U('uTime')
    present = (t) => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uOn, crtOn && !raw ? 1 : 0)
      gl.uniform1f(uTime, t)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  // ---- input ------------------------------------------------------------------------
  const keyMap: Record<string, keyof typeof keys> = {
    ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r',
    ' ': 'j', ArrowUp: 'j', w: 'j', W: 'j', k: 'j', K: 'j', z: 'j', Z: 'j',
  }
  window.addEventListener('keydown', (e) => {
    if (!shell.playing || demo) return
    const k = keyMap[e.key]
    if (!k) return
    e.preventDefault()
    keys[k] = true
  })
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.key]
    if (k && !demo) keys[k] = false
  })
  pad.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => {
    const k = b.dataset.k as keyof typeof keys
    const set = (v: boolean) => (e: Event) => {
      e.preventDefault()
      if (!demo) keys[k] = v
    }
    b.addEventListener('pointerdown', set(true))
    b.addEventListener('pointerup', set(false))
    b.addEventListener('pointercancel', set(false))
    b.addEventListener('pointerleave', set(false))
  })
  crtBtn.addEventListener('click', () => {
    crtOn = !crtOn
    crtBtn.setAttribute('aria-pressed', String(crtOn))
    crtBtn.textContent = crtOn ? 'CRT 滤镜 开' : 'CRT 滤镜 关'
    sound.relay()
  })
  const hold = (v: number) => () => {
    if (shell.playing) return
    raw = v
    if (v) sound.relay()
  }
  canvas.addEventListener('pointerdown', hold(1))
  canvas.addEventListener('pointerup', hold(0))
  canvas.addEventListener('pointerleave', () => (raw = 0))

  const shell = new GameShell(el, 'cart', '卡带', {
    ambience: 'cart',
    base: 'crt',
    start() {
      reset(false)
      keys.l = keys.r = keys.j = false
    },
    stop() {
      reset(true)
    },
  })

  // ---- loop -------------------------------------------------------------------------
  let raf = 0
  let active = false
  let last = 0
  let accT = 0
  const t0 = performance.now()
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    accT += reducedMotion && demo ? 0 : dt
    while (accT >= 1 / 60) {
      step(1 / 60)
      accT -= 1 / 60
    }
    const t = (now - t0) / 1000
    draw(t)
    present(t)
    if (active) raf = requestAnimationFrame(loop)
  }
  reset(true)

  return {
    id: 'cart',
    num: '01',
    title: '卡带',
    color: '#000000',
    transition: 'crt',
    ambience: 'crt',
    el,
    playing: () => shell.playing,
    enter() {
      active = true
      last = performance.now()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(loop)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      shell.quit()
    },
  }
}
