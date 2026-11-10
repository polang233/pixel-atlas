/**
 * 卡带 · one 256×144 screen of dataset sprites, shown through a CRT shader
 * whose four ingredients (scanlines, aperture grille, bloom, curved glass)
 * can be switched on and off one by one. In the showcase a divider follows the
 * pointer: raw pixels on its left, the tube on its right. Press start and the
 * same screen becomes a light-gun gallery.
 */
import { sound } from '../audio'
import { GameShell } from '../game'
import { drawText } from '../pixelfont'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const SW = 256
const SH = 144
const T = 16
const GROUND = 116
const ROUND = 50

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uSrc;
uniform vec4 uFx;     // scanlines, aperture grille, bloom, curved glass
uniform float uSplit; // screen x of the raw | tube divider, < 0 for none
uniform float uFlash;
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
  vec4 fx = uFx * (uSplit < 0.0 ? 1.0 : step(uSplit, f.x));

  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + fx.w * dot(cc, cc) * 0.2);
  vec3 bezel = vec3(0.02, 0.018, 0.03);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(bezel, 1.0); return; }

  vec3 col = fetchRow(uv, max(fx.x, fx.y));
  if (fx.z > 0.0) {
    vec3 g = vec3(0.0);
    for (int i = -3; i <= 3; i++) for (int j = -2; j <= 2; j++) g += texture(uTex, uv + vec2(float(i), float(j)) * 1.4 / uSrc).rgb;
    g /= 35.0;
    col = mix(col, max(col, g), 0.3) + g * g * 0.22;
  }
  float py = fract(uv.y * uSrc.y) - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float sigma = mix(0.2, 0.44, clamp(lum, 0.0, 1.0));
  float beam = exp(-py * py / (2.0 * sigma * sigma));
  col *= mix(1.0, beam * 1.22, fx.x);
  float stripe = mod(floor(f.x / max(1.0, scale / 3.0)), 3.0);
  vec3 mask = stripe < 1.0 ? vec3(1.0, 0.6, 0.6) : stripe < 2.0 ? vec3(0.6, 1.0, 0.6) : vec3(0.6, 0.6, 1.0);
  col *= mix(vec3(1.0), mask * 1.25, fx.y);
  vec2 v = uv - 0.5;
  col *= mix(1.0, 1.0 - dot(v, v) * 1.5, fx.w);
  col *= 1.0 - fx.x * 0.02 * sin(uTime * 110.0);
  float band = smoothstep(0.0, 0.05, 0.05 - abs(fract(uv.y * 0.8 - uTime * 0.15) - 0.5));
  col += fx.x * band * 0.03;
  vec2 corner = abs(v) - (0.5 - 0.04);
  float round_ = length(max(corner, 0.0));
  col = mix(col, bezel, smoothstep(0.035, 0.045, round_) * fx.w);
  if (uSplit >= 0.0 && abs(f.x - uSplit) < max(1.0, scale * 0.2)) col = vec3(1.0, 0.8, 0.3);
  col = mix(col, vec3(1.0), uFlash);
  o = vec4(col, 1.0);
}`

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Kind = 'slime' | 'bat' | 'ghost' | 'goblin' | 'coin' | 'star' | 'knight' | 'heart' | 'dragon'
interface Target {
  kind: Kind
  img: HTMLCanvasElement
  x: number
  y: number
  vx: number
  vy: number
  size: number
  t: number
  hp: number
  pts: number
  /** seconds since it was shot; 0 while alive */
  dead: number
  hurt: number
  phase: number
  spot: number
  gone: boolean
}
interface Bit { x: number; y: number; vx: number; vy: number; life: number; c: string }
interface Pop { x: number; y: number; s: string; life: number; c: string }

const SPOTS = [44, 128, 212]
const FX_KEYS = ['scan', 'mask', 'bloom', 'curve'] as const

export function createCart(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.cart-gl')!
  const splitTag = el.querySelector<HTMLElement>('.cart-split')!
  const fxButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-fx]')]

  const src = document.createElement('canvas')
  src.width = SW
  src.height = SH
  const g = src.getContext('2d')!
  g.imageSmoothingEnabled = false

  const sc = (s: Sprite) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    c.getContext('2d')!.putImageData(s.data, 0, 0)
    return c
  }
  const all = (re: RegExp) => {
    const list = sprites.filter((s) => re.test(s.subject))
    return (list.length ? list : sprites.slice(0, 1)).map(sc)
  }
  const IMG: Record<Kind, HTMLCanvasElement[]> = {
    slime: all(/slime/),
    bat: all(/bat/),
    ghost: all(/ghost/),
    goblin: all(/goblin|skeleton/),
    coin: all(/coin/),
    star: all(/star/),
    knight: all(/knight|wizard/),
    heart: all(/heart/).slice(0, 1),
    dragon: all(/dragon/),
  }
  const castleImg = all(/castle/)[0]
  const shroomImg = all(/toadstool/)
  /** a white silhouette of each sprite, for the hit flash */
  const whiteOf = new Map<HTMLCanvasElement, HTMLCanvasElement>()
  for (const list of Object.values(IMG))
    for (const img of list) {
      const c = document.createElement('canvas')
      c.width = c.height = 16
      const cx = c.getContext('2d')!
      cx.drawImage(img, 0, 0)
      cx.globalCompositeOperation = 'source-in'
      cx.fillStyle = '#fff'
      cx.fillRect(0, 0, 16, 16)
      whiteOf.set(img, c)
    }

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
  const bush = (() => {
    const c = document.createElement('canvas')
    c.width = 30
    c.height = 16
    const b = c.getContext('2d')!
    const blob = (col: string, dy: number) => {
      b.fillStyle = col
      for (const [cx, cy, r] of [[8, 10, 7], [16, 7, 7], [23, 10, 6]])
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) b.fillRect(cx + x, cy + y + dy, 1, 1)
    }
    blob('#1f5a3c', 1)
    blob('#2f8250', 0)
    b.fillStyle = '#6fd27f'
    for (const [x, y] of [[6, 5], [9, 7], [15, 2], [18, 4], [22, 6], [13, 8], [25, 9]]) b.fillRect(x, y, 1, 1)
    return c
  })()
  const stars = Array.from({ length: 46 }, (_, i) => [((i * 97) % SW) + Math.random() * 4, Math.random() * 64, Math.random() * 10])

  // ---- state ---------------------------------------------------------------------
  let targets: Target[] = []
  let bits: Bit[] = []
  let pops: Pop[] = []
  let demo = true
  let done = false
  let elapsed = 0
  let timeLeft = ROUND
  let spawnT = 0
  let score = 0
  let combo = 0
  let bestCombo = 0
  let shots = 0
  let hitsN = 0
  let dragons = 0
  let flash = 0
  let shake = 0
  let recoil = 0
  const aim = { x: SW / 2, y: SH / 2, on: false }
  const keys = { x: 0, y: 0 }
  const fx = { scan: true, mask: true, bloom: true, curve: true }
  let split = -1
  let splitTarget = 0.5
  let pointerIn = false

  const mult = () => 1 + Math.min(6, Math.floor(combo / 4)) * 0.5
  const burst = (x: number, y: number, c: string, n = 8, up = 80) => {
    for (let i = 0; i < n; i++) bits.push({ x, y, vx: (Math.random() - 0.5) * 140, vy: -Math.random() * up - 20, life: 0.4 + Math.random() * 0.4, c })
  }
  const one = <V,>(list: V[]) => list[(Math.random() * list.length) | 0]

  function spawn(kind: Kind) {
    const left = Math.random() < 0.5
    const dir = left ? 1 : -1
    const base: Target = {
      kind, img: one(IMG[kind]), x: left ? -12 : SW + 12, y: 0, vx: 0, vy: 0, size: 16, t: 0, hp: 1, pts: 100,
      dead: 0, hurt: 0, phase: Math.random() * 6, spot: -1, gone: false,
    }
    const speed = 1 + Math.min(1, elapsed / ROUND) * 0.5
    switch (kind) {
      case 'slime':
        Object.assign(base, { y: GROUND - 7, vx: dir * (28 + Math.random() * 26) * speed, pts: 100 })
        break
      case 'knight':
        Object.assign(base, { y: GROUND - 8, vx: dir * 30, pts: -300 })
        break
      case 'bat':
        Object.assign(base, { y: 28 + Math.random() * 50, vx: dir * (46 + Math.random() * 34) * speed, pts: 150 })
        break
      case 'ghost':
        Object.assign(base, { x: 30 + Math.random() * (SW - 60), y: 34 + Math.random() * 50, vx: dir * 14, pts: 250 })
        break
      case 'goblin': {
        const free = SPOTS.map((_, i) => i).filter((i) => !targets.some((q) => q.spot === i))
        if (!free.length) return
        const spot = one(free)
        Object.assign(base, { spot, x: SPOTS[spot], y: GROUND + 4, pts: 200 })
        break
      }
      case 'coin':
        Object.assign(base, { x: 30 + Math.random() * (SW - 60), y: SH + 8, vx: (Math.random() - 0.5) * 50, vy: -(250 + Math.random() * 50), pts: 120 })
        break
      case 'heart':
        Object.assign(base, { x: 30 + Math.random() * (SW - 60), y: SH + 8, vx: 0, vy: -34, pts: 0 })
        break
      case 'star':
        Object.assign(base, { x: left ? 20 + Math.random() * 60 : SW - 20 - Math.random() * 60, y: -10, vx: dir * 96, vy: 84, pts: 500 })
        break
      case 'dragon':
        Object.assign(base, { size: 32, y: 44, vx: dir * 26, hp: 4, pts: 1000, x: left ? -20 : SW + 20 })
        break
    }
    targets.push(base)
  }

  function director(dt: number) {
    spawnT -= dt
    if (spawnT > 0) return
    const u = Math.min(1, elapsed / ROUND)
    spawnT = (demo ? 1.1 : 0.95 - u * 0.5) * (0.65 + Math.random() * 0.7)
    const table: [Kind, number][] = [
      ['slime', 5], ['bat', 3 + u * 2], ['ghost', 1 + u * 2], ['goblin', 2 + u * 2], ['coin', 2], ['knight', demo ? 2 : 1.1 + u],
      ['star', demo ? 0.3 : 0.5], ['heart', demo ? 0 : timeLeft < 30 ? 0.4 : 0],
    ]
    let r = Math.random() * table.reduce((a, [, w]) => a + w, 0)
    for (const [k, w] of table) {
      r -= w
      if (r <= 0) {
        spawn(k)
        break
      }
    }
    if (!demo && dragons < 2 && elapsed > 16 + dragons * 20) {
      dragons++
      spawn('dragon')
      sound.tone(70, 0.9, { type: 'sawtooth', vol: 0.06, slide: 140, attack: 0.3 })
    }
  }

  function reset(isDemo: boolean) {
    targets = []
    bits = []
    pops = []
    demo = isDemo
    done = false
    elapsed = 0
    timeLeft = ROUND
    spawnT = 0.4
    score = combo = bestCombo = shots = hitsN = dragons = 0
    flash = shake = 0
  }

  const hittable = (q: Target) => !q.dead && !(q.kind === 'ghost' && Math.sin(q.t * 2.2 + q.phase) < -0.1)
  const centre = (q: Target): [number, number] => {
    if (q.kind === 'bat') return [q.x, q.y + Math.sin(q.t * 5 + q.phase) * 9]
    if (q.kind === 'dragon') return [q.x, q.y + Math.sin(q.t * 1.6) * 10]
    if (q.kind === 'ghost') return [q.x, q.y + Math.sin(q.t * 1.3 + q.phase) * 5]
    if (q.kind === 'slime') return [q.x, q.y - Math.abs(Math.sin(q.t * 6 + q.phase)) * 5]
    return [q.x, q.y]
  }

  function fire(x: number, y: number) {
    if (demo || done) return
    shots++
    flash = 1
    recoil = 1
    sound.shot()
    let hit: Target | null = null
    for (let i = targets.length - 1; i >= 0 && !hit; i--) {
      const q = targets[i]
      if (!hittable(q)) continue
      const [cx, cy] = centre(q)
      const r = q.size / 2 + 2
      if (Math.abs(x - cx) < r && Math.abs(y - cy) < r) hit = q
    }
    if (!hit) {
      combo = 0
      burst(x, y, '#8a86a0', 3, 30)
      return
    }
    const [cx, cy] = centre(hit)
    if (hit.kind === 'knight') {
      hit.dead = 0.001
      combo = 0
      score = Math.max(0, score - 300)
      timeLeft = Math.max(0, timeLeft - 3)
      shake = 0.3
      sound.hurt()
      burst(cx, cy, '#ff4d6d', 10)
      pops.push({ x: cx, y: cy - 10, s: '-300', life: 1, c: '#ff4d6d' })
      return
    }
    hitsN++
    hit.hp--
    hit.hurt = 0.12
    if (hit.hp > 0) {
      sound.stomp()
      burst(cx, cy, '#ffb347', 6)
      shake = 0.12
      return
    }
    hit.dead = 0.001
    combo++
    bestCombo = Math.max(bestCombo, combo)
    if (hit.kind === 'heart') {
      timeLeft = Math.min(ROUND, timeLeft + 5)
      sound.grow()
      burst(cx, cy, '#ff4d6d', 12)
      pops.push({ x: cx, y: cy - 10, s: '+5 SEC', life: 1.1, c: '#ff8aa0' })
      return
    }
    const gain = Math.round(hit.pts * mult())
    score += gain
    pops.push({ x: cx, y: cy - 10, s: '+' + gain, life: 0.9, c: hit.pts >= 500 ? '#ffd84d' : '#ffffff' })
    const colour = { slime: '#7fe08a', bat: '#b48cff', ghost: '#c8f4ff', goblin: '#9be06a', coin: '#ffd84d', star: '#ffd84d', dragon: '#ff7a2b', knight: '', heart: '' }[hit.kind]
    burst(cx, cy, colour, hit.kind === 'dragon' ? 36 : 12, hit.kind === 'dragon' ? 160 : 90)
    if (hit.kind === 'coin' || hit.kind === 'star') sound.coin()
    else sound.stomp()
    if (hit.kind === 'dragon') {
      shake = 0.5
      sound.win()
    }
    if (combo > 0 && combo % 4 === 0) sound.tone(660 + combo * 20, 0.12, { type: 'triangle', vol: 0.04, slide: 1320 })
  }

  function finish() {
    if (done) return
    done = true
    const acc = shots ? Math.round((hitsN / shots) * 100) : 0
    const won = score >= 5000
    shell.score(score)
    shell.end(score, won ? '神枪手！' : '时间到', `命中 ${hitsN} / ${shots} 枪 · 准确率 ${acc}% · 最高连击 ${bestCombo}`, won)
  }

  function step(dt: number) {
    flash = Math.max(0, flash - dt * 9)
    shake = Math.max(0, shake - dt)
    recoil = Math.max(0, recoil - dt * 7)
    for (const b of bits) {
      b.vy += 320 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
    }
    bits = bits.filter((b) => b.life > 0)
    for (const p of pops) {
      p.y -= 22 * dt
      p.life -= dt
    }
    pops = pops.filter((p) => p.life > 0)
    if (done) return
    elapsed += dt
    if (!demo) {
      timeLeft -= dt
      aim.x = Math.max(2, Math.min(SW - 3, aim.x + keys.x * 150 * dt))
      aim.y = Math.max(2, Math.min(SH - 3, aim.y + keys.y * 150 * dt))
      if (timeLeft <= 0) {
        timeLeft = 0
        finish()
      }
      shell.score(score)
      shell.extra(combo >= 4 ? `连击 ${combo} · 倍率 ×${mult()}` : '')
    }
    director(dt)
    for (const q of targets) {
      q.t += dt
      q.hurt = Math.max(0, q.hurt - dt)
      if (q.dead) {
        q.dead += dt
        if (q.dead > 0.3) q.gone = true
        continue
      }
      q.x += q.vx * dt
      q.y += q.vy * dt
      if (q.kind === 'coin') q.vy += 430 * dt
      if (q.kind === 'goblin') {
        const stay = 1.5 - Math.min(0.6, elapsed * 0.012)
        const up = Math.min(1, q.t / 0.2) - Math.max(0, (q.t - stay) / 0.2)
        q.y = GROUND + 4 - up * 13
        if (q.t > stay + 0.2) q.gone = true
      }
      if (q.kind === 'ghost' && q.t > 7) q.gone = true
      if (q.x < -40 || q.x > SW + 40 || q.y > SH + 30 || q.y < -30) q.gone = true
    }
    targets = targets.filter((q) => !q.gone)
  }

  // ---- drawing --------------------------------------------------------------------
  const text = (s: string, x: number, y: number, color: string) => drawText(g, s, x, y, color)
  const centred = (s: string, y: number, color: string) => text(s, Math.round((SW - s.length * 4) / 2), y, color)

  function drawTarget(q: Target, t: number) {
    const [cx, cy] = centre(q)
    let w = q.size
    let h = q.size
    if (q.kind === 'slime') {
      const hop = Math.abs(Math.sin(q.t * 6 + q.phase))
      h = q.size * (0.85 + hop * 0.15)
      w = q.size * (1.15 - hop * 0.15)
    } else if (q.kind === 'bat' || q.kind === 'dragon') h = q.size * (Math.floor(t * 9 + q.phase) % 2 ? 0.8 : 1)
    else if (q.kind === 'coin') w = Math.max(2, Math.abs(Math.cos(q.t * 7)) * q.size)
    else if (q.kind === 'knight') h = q.size - (Math.floor(q.t * 8) % 2)
    if (q.dead) {
      const k = q.dead / 0.3
      w *= 1 + k * 0.6
      h *= 1 - k * 0.8
    }
    g.save()
    if (q.kind === 'ghost') g.globalAlpha = q.dead ? 1 : Math.max(0.12, 0.55 + 0.45 * Math.sin(q.t * 2.2 + q.phase))
    if (q.vx > 0) {
      g.translate(Math.round(cx) * 2, 0)
      g.scale(-1, 1)
    }
    const img = q.hurt > 0 || (q.dead && q.dead < 0.1) ? whiteOf.get(q.img)! : q.img
    g.drawImage(img, Math.round(cx - w / 2), Math.round(cy + q.size / 2 - h), Math.round(w), Math.round(h))
    g.restore()
    if (q.kind === 'dragon' && !q.dead) {
      g.fillStyle = '#000'
      g.fillRect(Math.round(cx - 9), Math.round(cy - 21), 18, 3)
      g.fillStyle = '#ff7a2b'
      g.fillRect(Math.round(cx - 8), Math.round(cy - 20), q.hp * 4, 1)
    }
    if (q.kind === 'knight' && !q.dead && !demo) {
      // friendly marker: a tiny green tick above the head
      g.fillStyle = '#7fe08a'
      g.fillRect(Math.round(cx - 2), Math.round(cy - 12), 1, 1)
      g.fillRect(Math.round(cx - 1), Math.round(cy - 11), 1, 1)
      g.fillRect(Math.round(cx), Math.round(cy - 12), 1, 1)
      g.fillRect(Math.round(cx + 1), Math.round(cy - 13), 1, 1)
    }
  }

  function draw(t: number) {
    g.save()
    if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * shake * 10), Math.round((Math.random() - 0.5) * shake * 8))
    const bands = ['#120c2c', '#1d1b4f', '#2f3a83', '#4a64b8', '#7b97dc', '#b7c7ee']
    for (let b = 0; b < bands.length; b++) {
      g.fillStyle = bands[b]
      g.fillRect(-8, b * 14, SW + 16, 14)
      if (b < bands.length - 1) {
        g.fillStyle = bands[b + 1]
        for (let x = 0; x < SW; x++) for (let y = 2; y < 4; y++) if ((x + y) % 2 === 0) g.fillRect(x, b * 14 + 10 + y, 1, 1)
      }
    }
    g.fillStyle = bands[5]
    g.fillRect(-8, 84, SW + 16, SH - 84)
    for (const [x, y, p] of stars) {
      if (Math.sin(t * 2 + p) > -0.3) {
        g.fillStyle = '#fff'
        g.fillRect(x | 0, y | 0, 1, 1)
      }
    }
    g.fillStyle = '#fff3d6'
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dy * dy <= 36 && (dx - 3) ** 2 + (dy + 2) ** 2 > 26) g.fillRect(212 + dx, 20 + dy, 1, 1)
    g.fillStyle = '#2b3d6b'
    for (let x = -8; x < SW + 8; x++) {
      const h = 30 + Math.round(Math.sin(x * 0.03 + 1) * 10 + Math.sin(x * 0.09) * 4)
      g.fillRect(x, 112 - h, 1, h + 40)
    }
    g.drawImage(castleImg, 96, 54, 32, 32)
    g.fillStyle = '#22305a'
    for (let x = -8; x < SW + 8; x++) {
      const h = 16 + Math.round(Math.sin(x * 0.05 + 2) * 7)
      g.fillRect(x, 120 - h, 1, h + 30)
    }
    const air: Kind[] = ['ghost', 'bat', 'dragon', 'star', 'coin', 'heart']
    for (const q of targets) if (air.includes(q.kind)) drawTarget(q, t)
    for (const q of targets) if (q.kind === 'goblin') drawTarget(q, t)
    for (let x = -T; x < SW + T; x += T) {
      g.drawImage(grass, x, GROUND)
      g.drawImage(dirt, x, GROUND + T)
    }
    SPOTS.forEach((x) => g.drawImage(bush, x - 15, GROUND - 11))
    shroomImg.forEach((m, i) => g.drawImage(m, [14, 84, 170][i % 3], GROUND - 7, 8, 8))
    for (const q of targets) if (q.kind === 'slime' || q.kind === 'knight') drawTarget(q, t)
    for (const b of bits) {
      g.fillStyle = b.c
      g.fillRect(Math.round(b.x), Math.round(b.y), 2, 2)
    }
    for (const p of pops) text(p.s, Math.round(p.x - p.s.length * 2), Math.round(p.y), p.c)
    g.restore()

    if (demo) {
      // a test card strip: the classic colour bars, as sprites would never show them
      const bars = ['#ffffff', '#ffe14d', '#4de1ff', '#58e06a', '#ff5fd2', '#ff4d5a', '#4d6bff']
      bars.forEach((c, i) => {
        g.fillStyle = c
        g.fillRect(6 + i * 6, 6, 6, 5)
      })
      text('CART 01', 52, 6, '#ffffff')
      text('CH 03', SW - 28, 6, '#9ad1ff')
      if (Math.floor(t * 1.6) % 2) centred('PRESS START', 66, '#ffd84d')
    } else {
      const u = timeLeft / ROUND
      g.fillStyle = '#000'
      g.fillRect(5, 5, 82, 5)
      g.fillStyle = u < 0.2 && Math.floor(t * 6) % 2 ? '#ffffff' : u < 0.2 ? '#ff4d6d' : '#7fe08a'
      g.fillRect(6, 6, Math.round(80 * u), 3)
      text('TIME ' + String(Math.ceil(timeLeft)).padStart(2, '0'), 92, 5, '#ffffff')
      text('SCORE ' + String(score).padStart(6, '0'), SW - 54, 5, '#ffffff')
      if (combo >= 4) text('x' + mult().toFixed(1), SW - 22, 13, '#ffd84d')
      if (elapsed < 1.6) centred('READY!', 60, '#ffd84d')
      // crosshair
      const ax = Math.round(aim.x)
      const ay = Math.round(aim.y)
      const r = 5 + Math.round(recoil * 3)
      for (const pass of [1, 0]) {
        g.fillStyle = pass ? '#000' : '#fff'
        const o = pass
        g.fillRect(ax - r + o, ay + o, 3, 1)
        g.fillRect(ax + r - 2 + o, ay + o, 3, 1)
        g.fillRect(ax + o, ay - r + o, 1, 3)
        g.fillRect(ax + o, ay + r - 2 + o, 1, 3)
      }
      g.fillStyle = '#ff4d6d'
      g.fillRect(ax, ay, 1, 1)
    }
  }

  // ---- GL: CRT ----------------------------------------------------------------------
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  let present = (_t: number) => {}
  /** canvas css position → source pixel, through the same curve the shader bends with */
  function toSource(clientX: number, clientY: number): [number, number] {
    const r = canvas.getBoundingClientRect()
    const scale = Math.min(r.width / SW, r.height / SH)
    let u = (clientX - r.left - (r.width - SW * scale) / 2) / (SW * scale)
    let v = (clientY - r.top - (r.height - SH * scale) / 2) / (SH * scale)
    if (fx.curve) {
      const cx = u - 0.5
      const cy = v - 0.5
      const k = 1 + (cx * cx + cy * cy) * 0.2
      u = 0.5 + cx * k
      v = 0.5 + cy * k
    }
    return [u * SW, v * SH]
  }
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
    const uFx = U('uFx')
    const uSplit = U('uSplit')
    const uFlash = U('uFlash')
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
      gl.uniform4f(uFx, +fx.scan, +fx.mask, +fx.bloom, +fx.curve)
      gl.uniform1f(uSplit, split < 0 ? -1 : split * w)
      gl.uniform1f(uFlash, flash * 0.55)
      gl.uniform1f(uTime, t)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  // ---- input ------------------------------------------------------------------------
  fxButtons.forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.fx as (typeof FX_KEYS)[number]
      fx[k] = !fx[k]
      b.setAttribute('aria-pressed', String(fx[k]))
      sound.relay()
    }),
  )
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    pointerIn = true
    splitTarget = (e.clientX - r.left) / r.width
    if (shell.playing) [aim.x, aim.y] = toSource(e.clientX, e.clientY)
  })
  canvas.addEventListener('pointerleave', () => (pointerIn = false))
  canvas.addEventListener('pointerdown', (e) => {
    if (!shell.playing) return
    e.preventDefault()
    ;[aim.x, aim.y] = toSource(e.clientX, e.clientY)
    fire(aim.x, aim.y)
  })
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1] }
  window.addEventListener('keydown', (e) => {
    if (!shell.playing || demo) return
    const a = arrows[e.key]
    if (a) {
      e.preventDefault()
      if (a[0]) keys.x = a[0]
      if (a[1]) keys.y = a[1]
    } else if (e.key === ' ' && !e.repeat && !shell.ended) {
      e.preventDefault()
      fire(aim.x, aim.y)
    }
  })
  window.addEventListener('keyup', (e) => {
    const a = arrows[e.key]
    if (!a) return
    if (a[0]) keys.x = 0
    if (a[1]) keys.y = 0
  })

  const shell = new GameShell(el, 'cart-gallery', '光枪靶场', {
    ambience: 'cart',
    base: 'crt',
    start() {
      reset(false)
      keys.x = keys.y = 0
      aim.x = SW / 2
      aim.y = SH / 2
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
    // the divider follows the pointer; left alone it sweeps by itself so the comparison is always visible
    if (shell.playing) split = -1
    else {
      const want = pointerIn ? splitTarget : 0.5 + 0.3 * Math.sin(t * 0.5)
      split = split < 0 ? want : split + (want - split) * Math.min(1, dt * 9)
      splitTag.style.left = `${(split * 100).toFixed(2)}%`
    }
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
