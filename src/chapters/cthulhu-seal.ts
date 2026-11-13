/** Break the Seal: a stone wall, a candlelit altar, and the sanity left to break it. */
import { sound } from '../audio'
import { t } from '../i18n'
import { drawText, textWidth } from '../pixelfont'
import type { Sprite } from '../sprites'
import { reducedMotion } from '../types'

type Tone = 'go' | 'warn' | 'stop'
export interface SealUI {
  score(n: number): void
  extra(html: () => string): void
  end(score: number, title: () => string, sub: () => string): void
  /** Shared with the chapter's distortion and SAN bar. */
  san(v?: number): number
  say(copy: () => string, tone: Tone): void
}

type BrickKind = 'rune' | 'tome' | 'eye' | 'idol'
type Boon = 'split' | 'pierce' | 'beam' | 'grip' | 'wrath' | 'candle' | 'wide'
type Curse = 'shrink' | 'mad' | 'dark'
type RelicKind = Boon | Curse
type Timed = Exclude<RelicKind, 'split' | 'candle' | 'wrath'>
type Pip = Timed | 'wrath'
interface Art {
  image: HTMLCanvasElement
  colors: string[]
  /** Resting place of the 2×2 pupil that follows the fire. */
  px: number
  py: number
  /** Opaque bounds in sprite pixels: the boss collides with what is drawn. */
  x0: number
  y0: number
  x1: number
  y1: number
}
interface Brick {
  kind: BrickKind
  x: number
  y: number
  row: number
  col: number
  hp: number
  art: Art
  cycle: number
  phase: number
  flash: number
}
interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  /** Held by the tentacle grip: rides the altar at this offset until released. */
  stuck: boolean
  off: number
  held: number
  tx: number[]
  ty: number[]
  tn: number
}
interface Boss {
  art: Art
  index: number
  x: number
  y: number
  cx: number
  cy: number
  cw: number
  ch: number
  hp: number
  max: number
  flash: number
  guard: number
  volley: number
  charging: boolean
  grow: number
}
type Tentacle = { kind: 'waiting'; left: number } | { kind: 'warning' | 'rising'; left: number; side: -1 | 1; art: Art }
type Phase = { kind: 'ready' | 'flying' | 'over' } | { kind: 'reforming'; elapsed: number }

const STEP = 1 / 120
const CELL = 16
const R = 2
const TOP = 8
const TAU = Math.PI * 2
const HP: Record<BrickKind, number> = { rune: 1, tome: 2, eye: 1, idol: 3 }
const POINTS: Record<BrickKind, number> = { rune: 10, tome: 20, eye: 30, idol: 50 }

// Pace: the fire starts a third faster than before, climbs every 8 blocks and eases back a little on each new seal.
const BASE_SPEED = 150
const SEAL_SPEED = 14
const RAMP = 1.05
const RAMP_EVERY = 6
const MAX_SPEED = 265
const AUTO_LAUNCH = 1.2
// Once only a few blocks are left the seal cannot hold: they crumble one by one instead of making the player hunt them.
const CRUMBLE_SHARE = 0.06
const CRUMBLE_EVERY = 0.3
const ALTAR_SPEED = 240
const MISS_SAN = 20
const GAZE_SAN = 6
// One stare at a time: a volley can only cost a single hit.
const GAZE_GUARD = 0.8
const CANDLE_SAN = 15

// Relics: about one block in four drops something; idols always do.
const DROP: Record<BrickKind, number> = { rune: 0.2, tome: 0.32, eye: 0.38, idol: 1 }
const TABLE: Record<BrickKind, readonly (readonly [Boon, number])[]> = {
  rune: [
    ['split', 3],
    ['wide', 3],
    ['candle', 2],
    ['grip', 2],
    ['pierce', 1],
    ['beam', 1],
    ['wrath', 1],
  ],
  tome: [
    ['pierce', 4],
    ['wrath', 3],
    ['split', 2],
    ['beam', 2],
  ],
  eye: [
    ['beam', 5],
    ['candle', 2],
    ['split', 2],
    ['grip', 1],
  ],
  idol: [
    ['wrath', 3],
    ['pierce', 2],
    ['beam', 2],
    ['split', 2],
    ['candle', 2],
  ],
}
const CURSES: readonly Curse[] = ['shrink', 'mad', 'dark']
const CURSE_SHARE = 0.2
const MAX_FALLING = 3
const RELIC_FALL = 55
const DURATION: Record<Timed, number> = { pierce: 6, beam: 8, grip: 10, wide: 10, shrink: 8, mad: 5, dark: 6 }
const WRATH_HITS = 3
const BEAM_RATE = 0.4
const GRIP_HOLD = 1.6
const PIPS: readonly Pip[] = ['pierce', 'beam', 'grip', 'wide', 'wrath', 'shrink', 'mad', 'dark']
const SUBJECT: Record<RelicKind, string> = {
  split: 'void orb',
  pierce: 'eldritch tome',
  beam: 'eye amulet',
  grip: 'tentacle monster',
  wrath: 'skull idol',
  candle: 'candle',
  wide: 'rune obelisk',
  shrink: 'kraken tentacle',
  mad: 'vampire squid',
  dark: 'shadow tome',
}
// The canvas font is ASCII, so these labels read the same in every locale; the status line carries the translation.
const LABEL: Record<RelicKind, () => string> = {
  split: () => t('cthulhu.relic.split'),
  pierce: () => t('cthulhu.relic.pierce'),
  beam: () => t('cthulhu.relic.beam'),
  grip: () => t('cthulhu.relic.grip'),
  wrath: () => t('cthulhu.relic.wrath'),
  candle: () => t('cthulhu.relic.candle', { san: CANDLE_SAN }),
  wide: () => t('cthulhu.relic.wide'),
  shrink: () => t('cthulhu.relic.shrink'),
  mad: () => t('cthulhu.relic.mad'),
  dark: () => t('cthulhu.relic.dark'),
}
const SAY: Record<RelicKind, () => string> = {
  split: () => t('cthulhu.say.split'),
  pierce: () => t('cthulhu.say.pierce', { s: DURATION.pierce }),
  beam: () => t('cthulhu.say.beam', { s: DURATION.beam }),
  grip: () => t('cthulhu.say.grip'),
  wrath: () => t('cthulhu.say.wrath', { n: WRATH_HITS }),
  candle: () => t('cthulhu.say.candle', { san: CANDLE_SAN }),
  wide: () => t('cthulhu.say.wide'),
  shrink: () => t('cthulhu.say.shrink'),
  mad: () => t('cthulhu.say.mad', { s: DURATION.mad }),
  dark: () => t('cthulhu.say.dark', { s: DURATION.dark }),
}
const isCurse = (k: RelicKind): k is Curse => k === 'shrink' || k === 'mad' || k === 'dark'

// Boss health is counted in half hits so a gaze beam can chip where the fire bites.
const BOSS_HP = 48
// Every so many points of damage the boss sheds a relic, so the fight keeps handing out toys.
const BOSS_SHED = 12
// A fire wedged beside the boss would otherwise drum it to death in seconds; it still bounces, but bites only this often.
const BOSS_GUARD = 0.25
const BOSS_SIZE = 64
const BOSS_BONUS = 1000

const GREEN = '#d5edc9'
const GOLD = '#ffdb8b'
const PURPLE = '#c58bff'
const TRAIL = ['#8dbd7f', '#54794c', '#304c2e', '#1c301f']
const TRAIL_PIERCE = ['#f4ffd0', '#c8ff9a', '#8dbd7f', '#54794c']
const TRAIL_WRATH = ['#ffb35c', '#c9692e', '#7a3a1c', '#3d1d10']
const HUES = ['#8a2be2', '#d0307a', '#2bbf9a', '#c9a227']
const MULT_TEXT = ['', 'x1', 'x2', 'x3', 'x4']
const PIP_COLOR: Record<Pip, string> = {
  pierce: '#f4ffd0',
  beam: '#9dff8a',
  grip: '#6fd0a0',
  wide: '#b7e5a5',
  wrath: '#ffb35c',
  shrink: PURPLE,
  mad: PURPLE,
  dark: PURPLE,
}
// Not letters from any alphabet: 3×5 marks that drift up when a seal gives way.
const RUNES = [
  '101101010010010',
  '010111010010010',
  '110101110100100',
  '101010101010101',
  '111001010100111',
  '010101111101010',
  '100110101110100',
  '001011101011001',
]
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const GLITCH = '▓▒░▚▞'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
function weighted(table: readonly (readonly [Boon, number])[]): Boon {
  let total = 0
  for (const [, w] of table) total += w
  let roll = Math.random() * total
  for (const [kind, w] of table) {
    roll -= w
    if (roll < 0) return kind
  }
  return table[0][0]
}

/** The darkest 2×2 patch with a bright rim near the middle of the sprite is where its pupil sits. */
function findPupil(d: Uint8ClampedArray): [number, number] {
  const lum = (x: number, y: number) => {
    const i = (y * CELL + x) * 4
    return d[i + 3] > 128 ? (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 : -1
  }
  let best = -Infinity
  let bx = 7
  let by = 7
  for (let y = 2; y < 12; y++) {
    for (let x = 3; x < 12; x++) {
      let dark = 0
      let ring = 0
      let solid = true
      for (let j = -1; j < 3 && solid; j++) {
        for (let i = -1; i < 3; i++) {
          const l = lum(x + i, y + j)
          if (l < 0) {
            solid = false
            break
          }
          if (i >= 0 && i < 2 && j >= 0 && j < 2) dark += 255 - l
          else ring += l
        }
      }
      const score = dark / 4 + ring / 12 - (Math.abs(x + 1 - 8) + Math.abs(y + 1 - 8)) * 6
      if (solid && score > best) {
        best = score
        bx = x
        by = y
      }
    }
  }
  return [bx, by]
}

// Sweep results live in module scratch so the physics loop allocates nothing.
let sT = 0
let sNx = 0
let sNy = 0
/** Sweep the fire's centre along (dx, dy) against a rectangle grown by its two-pixel radius. */
function sweep(bx: number, by: number, dx: number, dy: number, x: number, y: number, w: number, h: number): boolean {
  const left = x - R
  const right = x + w + R
  const top = y - R
  const bottom = y + h + R
  if ((!dx && (bx <= left || bx >= right)) || (!dy && (by <= top || by >= bottom))) return false
  const tx1 = dx ? (left - bx) / dx : -Infinity
  const tx2 = dx ? (right - bx) / dx : Infinity
  const ty1 = dy ? (top - by) / dy : -Infinity
  const ty2 = dy ? (bottom - by) / dy : Infinity
  const tx = Math.min(tx1, tx2)
  const ty = Math.min(ty1, ty2)
  const enter = Math.max(tx, ty)
  const exit = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2))
  if (enter < -0.000001 || enter > exit || enter > 1 || exit < 0) return false
  sT = Math.max(0, enter)
  sNx = tx > ty ? -Math.sign(dx) : 0
  sNy = tx > ty ? 0 : -Math.sign(dy)
  return true
}
const NONE = 0
const WALL = 1
const ALTAR = 2
const TENTACLE = 3
const BRICK = 4
const BOSS = 5

function pixelCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  return [c, g] as const
}

/** A tile of drifting mist, dithered instead of blurred; it wraps horizontally. */
function makeFog() {
  const w = 128
  const h = 160
  const [c, g] = pixelCanvas(w, h)
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = 0.5 + 0.28 * Math.sin((x / w) * TAU + 2.1 * Math.sin((y / h) * TAU * 1.5)) + 0.22 * Math.sin((x / w) * TAU * 3 + y * 0.11)
      const v = n * (1 - y / h) * 0.8
      const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16
      if (v <= threshold) continue
      const i = (y * w + x) * 4
      const thick = v > threshold + 0.3
      img.data[i] = thick ? 24 : 12
      img.data[i + 1] = thick ? 50 : 28
      img.data[i + 2] = thick ? 34 : 19
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

/** The hole a flame cuts into the dark: solid in the middle, dithered at the rim. */
function makeLight() {
  const size = 64
  const [c, g] = pixelCanvas(size, size)
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 31.5, y - 31.5)
      if (d < 31 && (d < 19 || (31 - d) / 12 > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16)) img.data[(y * size + x) * 4 + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function makeDither() {
  const [c, g] = pixelCanvas(24, 2)
  g.fillStyle = '#2a5038'
  for (let x = 0; x < 24; x++) g.fillRect(x, x & 1, 1, 1)
  return c
}

export function createSeal(canvas: HTMLCanvasElement, sprites: Sprite[], ui: SealUI) {
  const ctx = canvas.getContext('2d')!
  const play = canvas.parentElement!
  const chapter = play.parentElement!
  const status = play.querySelector<HTMLElement>('.cth-say')!
  const [shade, sctx] = pixelCanvas(1, 1)
  const fog = makeFog()
  const light = makeLight()
  const dither = makeDither()

  const cache = new Map<Sprite, Art>()
  function art(s: Sprite): Art {
    const cached = cache.get(s)
    if (cached) return cached
    const [image, g] = pixelCanvas(CELL, CELL)
    g.putImageData(s.data, 0, 0)
    const d = s.data.data
    const colors = new Set<string>()
    let x0 = CELL
    let y0 = CELL
    let x1 = -1
    let y1 = -1
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 128) continue
      colors.add(`rgb(${d[i]} ${d[i + 1]} ${d[i + 2]})`)
      const x = (i / 4) % CELL
      const y = Math.floor(i / 4 / CELL)
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    if (x1 < 0) {
      x0 = y0 = 0
      x1 = y1 = CELL - 1
    }
    const [px, py] = findPupil(d)
    const result: Art = { image, colors: colors.size ? [...colors] : ['#9fd18b'], px, py, x0, y0, x1, y1 }
    cache.set(s, result)
    return result
  }
  const blank: Art = { image: pixelCanvas(CELL, CELL)[0], colors: ['#9fd18b'], px: 7, py: 7, x0: 0, y0: 0, x1: CELL - 1, y1: CELL - 1 }
  // A strip without one of the subjects still has to play.
  const by = (...subjects: string[]) => {
    const list = sprites.filter((s) => subjects.includes(s.subject)).map(art)
    return list.length ? list : [sprites.length ? art(sprites[0]) : blank]
  }
  const brickArt: Record<BrickKind, Art[]> = {
    rune: by('holed rune stone', 'rune obelisk'),
    tome: by('eldritch tome', 'shadow tome', 'summoning tome'),
    eye: by('eye orb', 'tentacled eye'),
    idol: by('serpent idol', 'skull idol'),
  }
  const relicArt = Object.fromEntries((Object.keys(SUBJECT) as RelicKind[]).map((k) => [k, by(SUBJECT[k])])) as Record<RelicKind, Art[]>
  const bossArt = by('octopus', 'giant squid')

  function silhouette(a: Art, color: string) {
    const [c, g] = pixelCanvas(CELL, CELL)
    g.drawImage(a.image, 0, 0)
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = color
    g.fillRect(0, 0, CELL, CELL)
    return c
  }
  const whites = new Map<Art, HTMLCanvasElement>()
  function white(a: Art) {
    let c = whites.get(a)
    if (!c) {
      c = silhouette(a, '#f1ffe6')
      whites.set(a, c)
    }
    return c
  }
  // Falling relics carry a one-pixel rim (pale for boons, purple for curses) so they read against the wall.
  const rimmed = [new Map<Art, HTMLCanvasElement>(), new Map<Art, HTMLCanvasElement>()]
  function relicImage(a: Art, cursed: boolean) {
    const store = rimmed[Number(cursed)]
    let c = store.get(a)
    if (c) return c
    const pair = pixelCanvas(CELL + 2, CELL + 2)
    c = pair[0]
    const g = pair[1]
    const rim = silhouette(a, cursed ? '#b45cff' : '#b7e5a5')
    g.drawImage(rim, 0, 1)
    g.drawImage(rim, 2, 1)
    g.drawImage(rim, 1, 0)
    g.drawImage(rim, 1, 2)
    g.drawImage(a.image, 1, 1)
    if (cursed) {
      g.globalCompositeOperation = 'source-atop'
      g.globalAlpha = 0.45
      g.fillStyle = '#9a3dff'
      g.fillRect(0, 0, CELL + 2, CELL + 2)
    }
    store.set(a, c)
    return c
  }
  const pipImage = Object.fromEntries(PIPS.map((k) => [k, relicImage(relicArt[k][0], isCurse(k))])) as Record<Pip, HTMLCanvasElement>

  let W = 276
  let H = 240
  let running = false
  let paused = false
  let last = 0
  let accumulator = 0
  let time = 0
  let phase: Phase = { kind: 'ready' }
  let score = 0
  let level = 1
  let seals = 0
  let broken = 0
  let levelBroken = 0
  let combo = 0
  let bestCombo = 0
  let bricks: Brick[] = []
  let grid: (Brick | null)[] = []
  let cols = 17
  let left = 2
  let gridRows = 4
  let alive = 0
  let wallSize = 0
  let crumble = 0
  let boss: Boss | null = null
  const balls: Ball[] = []
  let tentacle: Tentacle = { kind: 'waiting', left: 16 }
  let tOn = false
  let tX = 0
  let tY = 0
  let tH = 0
  let altarX = W / 2
  const fx: Record<Timed, number> = { pierce: 0, beam: 0, grip: 0, wide: 0, shrink: 0, mad: 0, dark: 0 }
  let wrath = 0
  let beamCool = 0
  let squash = 0
  let hurt = 0
  let guard = 0
  let hitStop = 0
  let stopCool = 0
  let shake = 0
  let flash = 0
  let blast = 0
  let blastX = 0
  let blastY = 0
  let gazeTime = 2.5
  let watched = false
  let sayTime = 0
  let sayUrgent = false
  let hintShown = false
  let launchPending = false
  let readyTime = 0
  let dockedCount = 1
  let trailTick = 0
  let hallucination = 6
  let falseFire: { x: number; y: number; left: number; side: number } | null = null
  let invert = false
  let jitter = 0
  let glitchTime = 2
  let glitchQueued = false
  let glitchOn = false
  let beat = 0
  let hudDirty = false
  let pointerId: number | null = null
  const keys = new Set<string>()
  let observer: ResizeObserver | null = null

  // Fixed pools: bursts, labels and projectiles reuse their slots instead of feeding the garbage collector.
  const shards = Array.from({ length: 420 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 1, color: '' }))
  let shardNext = 0
  const pops = Array.from({ length: 14 }, () => ({ x: 0, y: 0, text: '', life: 0, max: 1, color: GREEN, scale: 1, label: false }))
  let popNext = 0
  const glyphs = Array.from({ length: 48 }, () => ({ x: 0, y: 0, vy: 0, life: 0, rune: 0 }))
  let glyphNext = 0
  const gazes = Array.from({ length: 28 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, live: false }))
  const beams = Array.from({ length: 16 }, () => ({ x: 0, y: 0, live: false }))
  const relics = Array.from({ length: 10 }, () => ({ x: 0, y: 0, kind: 'candle' as RelicKind, image: pipImage.wide, live: false }))
  let falling = 0

  const width = () => (fx.shrink > 0 ? 28 : fx.wide > 0 ? 60 : 40)
  const altarY = () => H - 22
  const mult = () => (combo >= 10 ? 4 : combo >= 6 ? 3 : combo >= 3 ? 2 : 1)
  const speed = () => Math.min(MAX_SPEED, (BASE_SPEED + SEAL_SPEED * Math.min(level - 1, 5)) * RAMP ** Math.floor(levelBroken / RAMP_EVERY))
  const isBossSeal = () => level % 3 === 0
  // The first wall is four rows so the first seal breaks inside a minute; bosses do not add a row.
  const rows = () => Math.min(clamp(Math.floor((H - 112) / CELL), 5, 9), 3 + level - Math.floor(level / 3))
  const eyeOpen = (b: Brick) => (time + b.phase) % b.cycle < b.cycle * 0.52
  const canInput = () => running && !paused && !document.hidden && phase.kind !== 'over'
  const clampAltar = () => {
    altarX = clamp(altarX, width() / 2 + 2, W - width() / 2 - 2)
  }

  const none = () => ''
  const launchCopy = () => t('cthulhu.say.launch')
  const bossCopy = () => t('cthulhu.say.boss')
  const hudCopy = () => t('cthulhu.hudHtml', { san: Math.round(ui.san()), level, combo, mult: mult() })
  const glitchCopy = () => t('cthulhu.hudHtml', { san: pick([...GLITCH]) + pick([...GLITCH]), level: pick([...GLITCH]), combo, mult: mult() })

  function say(copy: () => string, tone: Tone, seconds = 2) {
    ui.say(copy, tone)
    sayTime = seconds
    sayUrgent = tone !== 'go'
    hintShown = false
  }
  /** Relic names give way to warnings that are still on screen, but not to each other. */
  function note(copy: () => string, tone: Tone) {
    if (sayTime > 0 && sayUrgent) return
    say(copy, tone)
    sayUrgent = false
  }
  function hint() {
    say(launchCopy, 'go')
    hintShown = true
  }
  function hud() {
    hudDirty = false
    glitchOn = false
    ui.score(score)
    ui.extra(hudCopy)
  }

  function layout(reset = false) {
    const hud = chapter.querySelector<HTMLElement>('.game-hud')!
    // The HUD sits at the top on portrait phones and at the bottom elsewhere (see responsive.css);
    // read where it really is instead of guessing from the window width.
    // offsetTop excludes the HUD's entrance animation and the chapter's SAN shake.
    const hudOnTop = hud.offsetTop < chapter.clientHeight / 2
    const narrow = window.innerWidth <= 639 || (window.innerWidth <= 820 && window.innerHeight > window.innerWidth)
    play.style.top = `${hudOnTop ? Math.max(64, hud.offsetTop + hud.offsetHeight + 10) : 64}px`
    play.style.bottom = `${hudOnTop ? 14 : Math.max(14, chapter.clientHeight - hud.offsetTop + 10)}px`
    const availableW = Math.max(1, play.clientWidth)
    const availableH = Math.max(1, play.clientHeight - status.offsetHeight - 10)
    if (reset) {
      W = narrow ? 164 : 276
      H = clamp(Math.floor(availableH / Math.min(4, availableW / W)), 224, 320)
      canvas.width = shade.width = W
      canvas.height = shade.height = H
      ctx.imageSmoothingEnabled = false
      sctx.imageSmoothingEnabled = false
    }
    // Keep the current wall and physics coordinates intact when the viewport changes.
    const PX = Math.min(4, availableW / W, availableH / H)
    canvas.style.width = `${W * PX}px`
    canvas.style.height = `${H * PX}px`
  }

  function generate() {
    cols = Math.floor((W - 4) / CELL)
    left = (W - cols * CELL) / 2
    boss = null
    if (isBossSeal()) {
      const index = level / 3
      const a = pick(bossArt)
      const x = Math.round((W - BOSS_SIZE) / 2)
      const max = Math.min(100, BOSS_HP + 16 * (index - 1))
      boss = {
        art: a,
        index,
        x,
        y: TOP,
        cx: x + a.x0 * 4,
        cy: TOP + a.y0 * 4,
        cw: (a.x1 - a.x0 + 1) * 4,
        ch: (a.y1 - a.y0 + 1) * 4,
        hp: max,
        max,
        flash: 0,
        guard: 0,
        volley: 3.4,
        charging: false,
        grow: 8,
      }
    }
    gridRows = boss ? 5 : rows()
    // The first wall always has open columns: the fire slips behind it early and the first long chain comes quickly.
    const pattern = boss ? 0 : level === 1 ? 1 : Math.floor(Math.random() * 4)
    const mid = (cols - 1) / 2
    const eyes = level === 1 ? 0.07 : Math.min(0.22, 0.08 + level * 0.02)
    const tomes = level === 1 ? 0.14 : 0.23
    bricks = []
    grid = []
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = left + col * CELL
        let hole = false
        // The boss keeps a clear column to either side so the fire can get round it.
        if (boss) hole = x < boss.x + BOSS_SIZE + 8 && x + CELL > boss.x - 8
        else if (pattern === 1) hole = Math.round(Math.abs(col - mid)) % 4 === 3
        else if (pattern === 2) hole = row > 0 && (row + col) % 4 === 0
        else if (pattern === 3) hole = row >= 2 && Math.abs(col - mid) < 1.6
        if (hole) {
          grid.push(null)
          continue
        }
        const roll = Math.random()
        const kind: BrickKind = roll < eyes ? 'eye' : roll > 1 - tomes ? 'tome' : 'rune'
        const cycle = 3 + Math.random() * 2
        const b: Brick = { kind, x, y: TOP + row * CELL, row, col, hp: HP[kind], art: pick(brickArt[kind]), cycle, phase: Math.random() * cycle, flash: 0 }
        bricks.push(b)
        grid.push(b)
      }
    }
    if (level >= 2) {
      const candidates = [...bricks]
      const count = Math.min(8, Math.floor(level / 2) + Math.floor(Math.random() * 2))
      for (let i = 0; i < count && candidates.length; i++) {
        const b = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]
        b.kind = 'idol'
        b.hp = HP.idol
        b.art = pick(brickArt.idol)
      }
    }
    alive = wallSize = bricks.length
    crumble = CRUMBLE_EVERY
    if (boss) play.dataset.boss = ''
    else delete play.dataset.boss
  }

  function releaseInput() {
    keys.clear()
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    pointerId = null
  }
  function pause() {
    paused = true
    last = 0
    accumulator = 0
    releaseInput()
  }
  function resume() {
    paused = false
    last = 0
    accumulator = 0
    if (running) layout()
  }
  function stop() {
    if (glitchOn) hud()
    running = false
    pause()
    observer?.disconnect()
    observer = null
    sayTime = 0
    launchPending = false
    delete play.dataset.boss
    ui.say(none, 'go')
  }
  function finish() {
    phase = { kind: 'over' }
    hud()
    stop()
    ui.end(
      score,
      () => t('cthulhu.lost'),
      () => t('cthulhu.result', { seals, bricks: broken, combo: bestCombo }),
    )
  }
  function changeSan(delta: number) {
    ui.san(clamp(ui.san() + delta, 0, 100))
    hud()
    if (ui.san() <= 0) finish()
  }

  function pop(x: number, y: number, text: string, color = GREEN, scale = 1, life = 0.7) {
    const p = pops[popNext]
    popNext = (popNext + 1) % pops.length
    p.x = x
    p.y = y
    p.text = text
    p.color = color
    p.scale = scale
    p.life = p.max = life
    p.label = false
    return p
  }
  /** Relic names rise from the altar; one caught right after another is set above it instead of on top. */
  function label(text: string, color: string) {
    let recent = 0
    for (const p of pops) if (p.label && p.life > p.max - 0.5) recent++
    pop(altarX, altarY() - 16 - recent * 12, text, color, 2, 1).label = true
  }
  function burst(x: number, y: number, colors: string[], count: number, power: number) {
    if (reducedMotion) return
    for (let i = 0; i < count; i++) {
      const s = shards[shardNext]
      shardNext = (shardNext + 1) % shards.length
      const a = Math.random() * TAU
      const v = power * (0.3 + Math.random() * 0.7)
      s.x = x + Math.cos(a) * 4
      s.y = y + Math.sin(a) * 4
      s.vx = Math.cos(a) * v
      s.vy = Math.sin(a) * v - 30
      s.life = 0.45 + Math.random() * 0.45
      s.size = Math.random() < 0.35 ? 2 : 1
      s.color = colors[Math.floor(Math.random() * colors.length)]
    }
  }
  function runes(count: number) {
    if (reducedMotion) return
    for (let i = 0; i < count; i++) {
      const g = glyphs[glyphNext]
      glyphNext = (glyphNext + 1) % glyphs.length
      g.x = 6 + Math.random() * (W - 12)
      g.y = TOP + Math.random() * (gridRows * CELL + 24)
      g.vy = -(12 + Math.random() * 16)
      g.life = 1.1 + Math.random() * 1.1
      g.rune = Math.floor(Math.random() * RUNES.length)
    }
  }
  function jolt(seconds: number) {
    if (!reducedMotion) shake = Math.max(shake, seconds)
  }

  function dock(afterClear = false) {
    phase = { kind: 'ready' }
    balls.length = 0
    readyTime = 0
    combo = 0
    hudDirty = true
    if (boss && afterClear) {
      launchPending = false
      say(bossCopy, 'stop', 2.6)
      pop(W / 2, boss.y + BOSS_SIZE + 22, t('cthulhu.pop.boss'), '#ff8fa0', 2, 1.6)
    } else {
      launchPending = afterClear && sayTime > 0
      if (!launchPending) hint()
    }
  }
  function makeBall(x: number, y: number, angle: number): Ball {
    return { x, y, vx: Math.sin(angle) * speed(), vy: -Math.cos(angle) * speed(), stuck: false, off: 0, held: 0, tx: [0, 0, 0, 0], ty: [0, 0, 0, 0], tn: 0 }
  }
  function launch() {
    if (!canInput() || phase.kind !== 'ready') return
    const y = altarY() - R - 1
    if (dockedCount === 3) for (const a of [-0.4, 0, 0.4]) balls.push(makeBall(altarX, y, a))
    else balls.push(makeBall(altarX, y, (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.16)))
    dockedCount = 1
    phase = { kind: 'flying' }
    launchPending = false
    if (hintShown) {
      hintShown = false
      sayTime = 0
      ui.say(none, 'go')
    }
    sound.click()
  }
  function release(b: Ball) {
    const angle = clamp(b.off / (width() / 2), -1, 1) * (Math.PI / 3)
    b.vx = Math.sin(angle) * speed()
    b.vy = -Math.cos(angle) * speed()
    b.stuck = false
    b.tn = 0
    sound.click()
  }
  function releaseStuck() {
    for (const b of balls) if (b.stuck) release(b)
  }
  function fireBeams() {
    if (fx.beam <= 0 || beamCool > 0 || phase.kind !== 'flying') return
    beamCool = BEAM_RATE
    let fired = 0
    for (const beam of beams) {
      if (beam.live) continue
      beam.live = true
      beam.x = Math.round(altarX + (fired ? 1 : -1) * (width() / 2 - 4))
      beam.y = altarY() - 9
      if (++fired === 2) break
    }
    sound.tone(1250, 0.07, { type: 'square', vol: 0.028, slide: 520 })
  }
  /** Click, tap or Space: launch a waiting fire, let go of a gripped one, and fire the gaze beams. */
  function press() {
    if (phase.kind === 'ready') launch()
    else if (phase.kind === 'flying') {
      releaseStuck()
      fireBeams()
    }
  }

  function spawnRelic(kind: RelicKind, x: number, y: number) {
    for (const r of relics) {
      if (r.live) continue
      r.live = true
      r.kind = kind
      r.x = clamp(x, 10, W - 10)
      r.y = y
      r.image = relicImage(pick(relicArt[kind]), isCurse(kind))
      falling++
      return
    }
  }
  function drop(b: Brick) {
    if (b.kind !== 'idol' && (falling >= MAX_FALLING || Math.random() >= DROP[b.kind])) return
    // Curses stay out of the first seal and never come from an idol, which costs three hits to open.
    const cursed = level >= 2 && b.kind !== 'idol' && Math.random() < CURSE_SHARE
    spawnRelic(cursed ? pick(CURSES) : weighted(TABLE[b.kind]), b.x + 8, b.y + 8)
  }
  function kill(b: Brick) {
    b.hp = 0
    b.flash = 0.09
    alive--
    broken++
    levelBroken++
    const before = mult()
    combo++
    bestCombo = Math.max(bestCombo, combo)
    const m = mult()
    const points = POINTS[b.kind] * m
    score += points
    pop(b.x + 8, b.y + 4, `+${points}`, m > 1 ? GOLD : GREEN)
    if (m > before) {
      // Announced under the wall, clear of the score pops that crowd the blocks themselves.
      pop(W / 2, TOP + gridRows * CELL + 10, t('cthulhu.pop.combo', { n: m }), GOLD, 2, 0.9)
      sound.arp([660 + m * 110, 880 + m * 110, 1100 + m * 110], 0.04, { type: 'triangle', vol: 0.04 })
    }
    sound.tick(760 + b.row * 115 + Math.min(combo, 12) * 35, 0.025)
    drop(b)
    burst(b.x + 8, b.y + 8, b.art.colors, 12 + Math.floor(Math.random() * 6), 95)
    if (b.kind === 'idol') {
      hitStop = Math.max(hitStop, 3 / 60)
      jolt(0.12)
      sound.noise(0.14, { f0: 1200, f1: 100, q: 2, vol: 0.07 })
    } else if (combo >= 6 && stopCool <= 0) {
      // Two frozen frames give a long chain its weight; the cooldown keeps a triple fire from stuttering.
      hitStop = Math.max(hitStop, 2 / 60)
      stopCool = 0.16
    }
    const v = speed()
    for (const ball of balls) {
      const length = Math.hypot(ball.vx, ball.vy)
      if (!length) continue
      ball.vx = (ball.vx / length) * v
      ball.vy = (ball.vy / length) * v
    }
    hudDirty = true
  }
  function damage(b: Brick, n: number) {
    if (b.hp <= 0) return
    b.hp -= n
    b.flash = 0.09
    if (b.hp > 0) {
      sound.tick(520 + b.row * 80, 0.022)
      burst(b.x + 8, b.y + 8, b.art.colors, 3, 50)
    } else kill(b)
  }
  function explode(x: number, y: number) {
    blast = 0.14
    blastX = x
    blastY = y
    jolt(0.2)
    hitStop = Math.max(hitStop, 2 / 60)
    burst(x, y, TRAIL_WRATH, 16, 130)
    sound.noise(0.22, { f0: 900, f1: 90, q: 1.2, vol: 0.09 })
    sound.tone(120, 0.18, { type: 'triangle', vol: 0.06, slide: 45 })
  }
  /** A fire touches a block: explode if the wrath is loaded, otherwise chip (or pierce) it. */
  function strike(b: Brick, piercing: boolean) {
    if (wrath <= 0) {
      damage(b, piercing ? 9 : 1)
      return
    }
    wrath--
    explode(b.x + 8, b.y + 8)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const row = b.row + dr
        const col = b.col + dc
        if (row < 0 || row >= gridRows || col < 0 || col >= cols) continue
        const near = grid[row * cols + col]
        if (near) damage(near, 9)
      }
    }
  }
  function hitBoss(amount: number, x: number, y: number) {
    if (!boss || boss.hp <= 0) return
    const shed = Math.floor((boss.max - boss.hp) / BOSS_SHED)
    boss.hp -= amount
    boss.flash = 0.1
    levelBroken += amount / 2
    if (boss.hp > 0 && Math.floor((boss.max - boss.hp) / BOSS_SHED) > shed) spawnRelic(weighted(TABLE.idol), boss.x + BOSS_SIZE / 2, boss.cy + boss.ch)
    score += 5 * amount * mult()
    hudDirty = true
    jolt(0.09)
    burst(x, y, boss.art.colors, 4 + amount, 80)
    sound.tone(86, 0.12, { type: 'triangle', vol: 0.07, slide: 48 })
    sound.tick(300, 0.03)
  }
  function strikeBoss(b: Ball) {
    if (!boss || boss.guard > 0) {
      sound.tick(300, 0.03)
      return
    }
    boss.guard = BOSS_GUARD
    if (wrath > 0) {
      wrath--
      explode(b.x, b.y)
      hitBoss(6, b.x, b.y)
    } else hitBoss(fx.pierce > 0 ? 3 : 2, b.x, b.y)
  }
  /** Runes creep back into the gaps while the thing behind the seal lives. */
  function growRunes(count: number) {
    let grown = 0
    for (let n = 0; n < count; n++) {
      let chosen: Brick | null = null
      let seen = 0
      for (const b of bricks) {
        if (b.hp > 0) continue
        let clear = true
        for (const ball of balls) if (Math.abs(ball.x - b.x - 8) < 14 && Math.abs(ball.y - b.y - 8) < 14) clear = false
        if (clear && Math.random() * ++seen < 1) chosen = b
      }
      if (!chosen) break
      chosen.kind = 'rune'
      chosen.hp = 1
      chosen.art = pick(brickArt.rune)
      chosen.flash = 0.3
      alive++
      grown++
    }
    if (grown) sound.tone(140, 0.25, { type: 'triangle', vol: 0.04, slide: 230 })
  }

  function updateTentacle() {
    tOn = tentacle.kind === 'rising'
    if (tentacle.kind !== 'rising') return
    const growth = clamp((4 - tentacle.left) / 0.3, 0, 1)
    tX = tentacle.side < 0 ? 0 : W - 24
    tH = Math.round(66 * growth)
    tY = H - tH
  }

  let hKind = NONE
  let hT = 0
  let hNx = 0
  let hNy = 0
  let hX = 0
  let hY = 0
  let hW = 0
  let hH = 0
  let hBrick: Brick | null = null
  function consider(kind: number, brick: Brick | null, b: Ball, dx: number, dy: number, x: number, y: number, w: number, h: number) {
    if (!sweep(b.x, b.y, dx, dy, x, y, w, h) || (hKind !== NONE && sT >= hT)) return
    hKind = kind
    hT = sT
    hNx = sNx
    hNy = sNy
    hX = x
    hY = y
    hW = w
    hH = h
    hBrick = brick
  }
  function nextHit(b: Ball, remaining: number) {
    hKind = NONE
    hBrick = null
    const dx = b.vx * remaining
    const dy = b.vy * remaining
    consider(WALL, null, b, dx, dy, -16, -16, 16, H + 32)
    consider(WALL, null, b, dx, dy, W, -16, 16, H + 32)
    consider(WALL, null, b, dx, dy, 0, -16, W, 16)
    if (b.vy > 0 && b.y <= altarY() - R + 0.001) consider(ALTAR, null, b, dx, dy, altarX - width() / 2, altarY(), width(), 6)
    if (tOn) consider(TENTACLE, null, b, dx, dy, tX, tY, 24, tH)
    if (boss && boss.hp > 0) consider(BOSS, null, b, dx, dy, boss.cx, boss.cy, boss.cw, boss.ch)
    const minX = Math.min(b.x, b.x + dx) - R - CELL
    const maxX = Math.max(b.x, b.x + dx) + R
    const minY = Math.min(b.y, b.y + dy) - R - CELL
    const maxY = Math.max(b.y, b.y + dy) + R
    if (minY > TOP + gridRows * CELL) return
    for (let i = 0; i < bricks.length; i++) {
      const brick = bricks[i]
      if (brick.hp <= 0 || brick.x < minX || brick.x > maxX || brick.y < minY || brick.y > maxY) continue
      consider(BRICK, brick, b, dx, dy, brick.x, brick.y, CELL, CELL)
    }
  }

  function moveBall(b: Ball, dt: number) {
    if (b.stuck) {
      b.off = clamp(b.off, -width() / 2 + 1, width() / 2 - 1)
      b.x = altarX + b.off
      b.y = altarY() - R - 1
      b.held += dt
      if (b.held >= GRIP_HOLD) release(b)
      return
    }
    // A rising deflector can grow around the ball; eject it toward the field first.
    if (tOn && b.x + R > tX && b.x - R < tX + 24 && b.y + R > tY && b.y - R < H) {
      if (tX === 0) {
        b.x = 24 + R + 0.001
        b.vx = Math.abs(b.vx)
      } else {
        b.x = tX - R - 0.001
        b.vx = -Math.abs(b.vx)
      }
    }
    let remaining = dt
    for (let contact = 0; contact < 6 && remaining > 0.000001; contact++) {
      nextHit(b, remaining)
      if (hKind === NONE) {
        b.x += b.vx * remaining
        b.y += b.vy * remaining
        break
      }
      const kind = hKind
      const brick = hBrick
      b.x += b.vx * remaining * hT
      b.y += b.vy * remaining * hT
      remaining *= 1 - hT
      if (kind === BRICK && fx.pierce > 0 && wrath <= 0) {
        // Piercing fire keeps its line; the block simply stops being there.
        strike(brick!, true)
        continue
      }
      if (hNx) b.x = (hNx < 0 ? hX - R : hX + hW + R) + hNx * 0.001
      if (hNy) b.y = (hNy < 0 ? hY - R : hY + hH + R) + hNy * 0.001
      if (kind === ALTAR) {
        b.y = altarY() - R - 0.001
        squash = 3 / 60
        if (combo) hudDirty = true
        combo = 0
        if (fx.grip > 0) {
          b.stuck = true
          b.off = b.x - altarX
          b.held = 0
          b.vx = b.vy = 0
          sound.tone(150, 0.09, { type: 'triangle', vol: 0.05, slide: 90 })
          return
        }
        const angle = clamp((b.x - altarX) / (width() / 2), -1, 1) * (Math.PI / 3)
        b.vx = Math.sin(angle) * speed()
        b.vy = -Math.cos(angle) * speed()
        sound.tone(100, 0.07, { type: 'triangle', vol: 0.055, slide: 65 })
      } else {
        if (hNx) b.vx = -b.vx
        if (hNy) b.vy = -b.vy
        if (kind === BRICK) strike(brick!, false)
        else if (kind === BOSS) strikeBoss(b)
      }
    }
  }

  function catchRelic(kind: RelicKind) {
    const cursed = isCurse(kind)
    label(LABEL[kind](), cursed ? PURPLE : GREEN)
    note(SAY[kind], cursed ? 'stop' : 'go')
    if (cursed) {
      sound.tone(196, 0.3, { type: 'sawtooth', vol: 0.045, slide: 70 })
      sound.noise(0.2, { f0: 500, f1: 150, q: 3, vol: 0.04 })
    } else sound.select()
    switch (kind) {
      case 'candle':
        // A candle is never wasted: at full sanity it burns for points instead.
        if (ui.san() >= 100) score += 100
        changeSan(CANDLE_SAN)
        return
      case 'wrath':
        wrath = WRATH_HITS
        return
      case 'split': {
        const source = balls[0]
        if (!source) dockedCount = 3
        else {
          // Each void orb restores a three-fire spread; repeated catches cannot grow it without bound.
          const angle = source.stuck ? 0 : Math.atan2(source.vx, Math.abs(source.vy))
          for (let side = -1; balls.length < 3; side = 1) balls.push(makeBall(source.x, source.y, angle + side * 0.4))
        }
        return
      }
      case 'wide':
        fx.shrink = 0
        break
      case 'shrink':
        fx.wide = 0
        break
    }
    fx[kind] = DURATION[kind]
    clampAltar()
  }

  function spawnGaze(x: number, y: number, vx: number, vy: number) {
    for (const g of gazes) {
      if (g.live) continue
      g.live = true
      g.x = x
      g.y = y
      g.vx = vx
      g.vy = vy
      return
    }
  }
  function hazards(dt: number) {
    gazeTime -= dt
    if (gazeTime <= 0) {
      gazeTime += Math.max(1.8, 3.3 - level * 0.15)
      let eye: Brick | null = null
      let seen = 0
      for (const b of bricks) if (b.hp > 0 && b.kind === 'eye' && eyeOpen(b) && Math.random() * ++seen < 1) eye = b
      if (eye) {
        spawnGaze(eye.x + 8, eye.y + 16, 0, 64)
        if (!watched) {
          watched = true
          say(() => t('cthulhu.say.watch'), 'warn')
        }
      }
    }
    if (boss && boss.hp > 0) {
      boss.volley -= dt
      if (boss.volley <= 0.5 && !boss.charging) {
        boss.charging = true
        sound.eyeOpen()
      }
      if (boss.volley <= 0) {
        // A fan aimed where the altar stands now. The stares land 60 px apart, so a short sidestep finds the gap between them.
        boss.charging = false
        boss.volley = 2.8 + boss.hp / boss.max
        const x0 = boss.x + BOSS_SIZE / 2
        const y0 = boss.cy + boss.ch
        const count = boss.hp < boss.max * 0.4 ? 5 : 3
        const flight = (altarY() - y0) / 70
        for (let i = 0; i < count; i++) spawnGaze(x0, y0, (altarX + (i - (count - 1) / 2) * 60 - x0) / flight, 70)
        sound.tone(240, 0.2, { type: 'sawtooth', vol: 0.04, slide: 90 })
      }
      boss.grow -= dt
      if (boss.grow <= 0) {
        boss.grow = 8
        growRunes(3)
      }
    }
    for (const gaze of gazes) {
      if (!gaze.live) continue
      gaze.x += gaze.vx * dt
      gaze.y += gaze.vy * dt
      if (gaze.y >= H) gaze.live = false
      else if (gaze.y + 6 >= altarY() && gaze.y <= altarY() + 6 && Math.abs(gaze.x - altarX) < width() / 2 + 1) {
        gaze.live = false
        if (guard > 0) continue
        guard = GAZE_GUARD
        hurt = 0.4
        sound.tone(190, 0.17, { type: 'sawtooth', slide: 63, vol: 0.045 })
        sound.tone(201, 0.14, { type: 'triangle', slide: 92, vol: 0.035 })
        changeSan(-GAZE_SAN)
        if (!running) return
      }
    }
    if (level < 2) return
    tentacle.left -= dt
    if (tentacle.left > 0) return
    if (tentacle.kind === 'waiting') {
      tentacle = { kind: 'warning', left: 1, side: Math.random() < 0.5 ? -1 : 1, art: pick(relicArt.shrink) }
      say(() => t('cthulhu.say.tentacle'), 'stop')
    } else if (tentacle.kind === 'warning') {
      tentacle = { ...tentacle, kind: 'rising', left: 4 }
    } else {
      // Warning starts are 14–20 seconds apart, including the previous warning and rise.
      tentacle = { kind: 'waiting', left: 9 + Math.random() * 6 }
    }
  }

  function clearField() {
    balls.length = 0
    for (const g of gazes) g.live = false
    for (const beam of beams) beam.live = false
    tentacle = { kind: 'waiting', left: 14 + Math.random() * 6 }
    tOn = false
    levelBroken = 0
    // A broken seal lifts its curses (boons carry over), so the next wall and any boss arrive in plain sight.
    for (const k of CURSES) fx[k] = 0
    clampAltar()
  }
  function sealBroken() {
    const cleared = level
    const fallen = boss
    seals++
    let bonus = 200 * level
    if (fallen) {
      // The whole wall goes with it.
      bonus = BOSS_BONUS * fallen.index
      const d = fallen.art.image.getContext('2d')!.getImageData(0, 0, CELL, CELL).data
      if (!reducedMotion) {
        for (let i = 0; i < d.length; i += 8) {
          if (d[i + 3] <= 128) continue
          const s = shards[shardNext]
          shardNext = (shardNext + 1) % shards.length
          const px = (i / 4) % CELL
          const py = Math.floor(i / 4 / CELL)
          s.x = fallen.x + px * 4 + 2
          s.y = fallen.y + py * 4 + 2
          s.vx = (px - 7.5) * (8 + Math.random() * 14)
          s.vy = (py - 9) * (8 + Math.random() * 14) - 30
          s.life = 0.7 + Math.random() * 0.7
          s.size = 2 + Number(Math.random() < 0.4)
          s.color = pick(fallen.art.colors)
        }
        flash = 0.28
      }
      for (const b of bricks) {
        if (b.hp <= 0) continue
        b.hp = 0
        b.flash = 0.09
        broken++
        burst(b.x + 8, b.y + 8, b.art.colors, 5, 80)
      }
      jolt(0.55)
      hitStop = 6 / 60
      sound.noise(0.9, { f0: 2400, f1: 80, q: 1.5, vol: 0.1 })
      sound.arp([196, 262, 330, 392, 523, 784], 0.07, { type: 'triangle', vol: 0.06, len: 0.2 })
      pop(W / 2, fallen.y + 20, t('cthulhu.pop.bossDown'), GOLD, 2, 1.6)
      pop(W / 2, fallen.y + 40, `+${bonus}`, GOLD, 2, 1.6)
      runes(34)
      say(() => t('cthulhu.say.bossDown', { bonus }), 'go', 2.6)
    } else {
      pop(W / 2, H / 2, `+${bonus}`, GOLD, 2, 1.1)
      runes(18)
      sound.noise(0.35, { f0: 300, f1: 1800, q: 1.4, vol: 0.05 })
      sound.arp([330, 392, 523, 659], 0.06, { type: 'triangle', vol: 0.05, len: 0.18 })
      say(() => t('cthulhu.say.cleared', { n: cleared }), 'go')
    }
    score += bonus
    level++
    clearField()
    generate()
    // A beat of empty dark before the wall grows back (longer after a boss, so its wreckage can settle).
    phase = { kind: 'reforming', elapsed: fallen ? -1 : -0.45 }
    if (fallen) changeSan(10)
    else hud()
  }

  function step(dt: number) {
    time += dt
    const san = ui.san()
    if (san <= 0) {
      finish()
      return
    }
    if (sayTime > 0) {
      sayTime -= dt
      if (sayTime <= 0) {
        ui.say(none, 'go')
        hintShown = false
        if (launchPending && phase.kind === 'ready') {
          launchPending = false
          hint()
        }
      }
    }
    const direction = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'))
    altarX += (fx.mad > 0 ? -direction : direction) * ALTAR_SPEED * dt
    clampAltar()
    squash = Math.max(0, squash - dt)
    hurt = Math.max(0, hurt - dt)
    guard = Math.max(0, guard - dt)
    shake = Math.max(0, shake - dt)
    flash = Math.max(0, flash - dt)
    blast = Math.max(0, blast - dt)
    stopCool = Math.max(0, stopCool - dt)
    if (boss) {
      boss.flash = Math.max(0, boss.flash - dt)
      boss.guard = Math.max(0, boss.guard - dt)
    }
    for (let i = 0; i < bricks.length; i++) if (bricks[i].flash > 0) bricks[i].flash = Math.max(0, bricks[i].flash - dt)
    for (let i = 0; i < pops.length; i++) if (pops[i].life > 0) pops[i].life -= dt
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i]
      if (s.life <= 0) continue
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 190 * dt
      s.life -= dt
    }
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i]
      if (g.life <= 0) continue
      g.y += g.vy * dt
      g.life -= dt
    }
    if (san < 30) {
      // A slow double thump that quickens as sanity runs out; it stays for players who asked for less motion.
      beat -= dt
      if (beat <= 0) {
        beat = 0.72 + (san / 30) * 0.5
        sound.tone(58, 0.13, { type: 'sine', vol: 0.05, slide: 40 })
        sound.tone(52, 0.15, { type: 'sine', vol: 0.035, slide: 36, at: 0.17 })
      }
    } else beat = 0
    if (!reducedMotion) {
      hallucination -= dt
      if (hallucination <= 0) {
        hallucination = 4 + Math.random() * 5
        if (san < 30) {
          invert = true
          const side = Math.random() < 0.5 ? 1 : -1
          falseFire = { x: side > 0 ? 0 : W, y: gridRows * CELL + 24, side, left: 3 }
        }
      }
      if (falseFire) {
        falseFire.x += falseFire.side * (W / 3) * dt
        falseFire.y += Math.sin(time * 3) * dt * 12
        falseFire.left -= dt
        if (falseFire.left <= 0 || san >= 30) falseFire = null
      }
      jitter = Math.max(0, jitter - dt)
      if (san < 50 && Math.random() < dt * 1.2) jitter = 0.06
      if (san < 30) {
        glitchTime -= dt
        if (glitchTime <= 0) {
          glitchTime = 0.8 + Math.random() * 2.2
          glitchQueued = true
        }
      }
    }
    if (hitStop > 0) {
      hitStop -= dt
      return
    }
    for (const relic of relics) {
      if (!relic.live) continue
      relic.y += RELIC_FALL * dt
      const caught = relic.y + 6 >= altarY() && relic.y - 6 <= altarY() + 6 && Math.abs(relic.x - altarX) < width() / 2 + 6
      if (!caught && relic.y < H + 8) continue
      relic.live = false
      falling--
      if (caught) catchRelic(relic.kind)
      if (!running) return
    }
    if (phase.kind === 'reforming') {
      phase.elapsed += dt
      if (phase.elapsed >= gridRows * 0.06 + (boss ? 1 : 0)) dock(true)
      return
    }
    if (phase.kind === 'ready') {
      readyTime += dt
      if (readyTime >= AUTO_LAUNCH) launch()
      return
    }
    if (phase.kind !== 'flying') return
    for (const k of PIPS) {
      if (k === 'wrath' || fx[k] <= 0) continue
      fx[k] = Math.max(0, fx[k] - dt)
      if (fx[k] > 0) continue
      if (k === 'grip') releaseStuck()
      clampAltar()
    }
    beamCool = Math.max(0, beamCool - dt)
    if (fx.beam > 0 && (pointerId !== null || keys.has('Space'))) fireBeams()
    hazards(dt)
    if (!running) return
    for (const beam of beams) {
      if (!beam.live) continue
      beam.y -= 320 * dt
      const row = Math.floor((beam.y - TOP) / CELL)
      const col = Math.floor((beam.x - left) / CELL)
      const b = row >= 0 && row < gridRows && col >= 0 && col < cols ? grid[row * cols + col] : null
      if (b && b.hp > 0) {
        beam.live = false
        damage(b, 1)
      } else if (boss && boss.hp > 0 && beam.x >= boss.cx && beam.x < boss.cx + boss.cw && beam.y < boss.cy + boss.ch) {
        beam.live = false
        hitBoss(1, beam.x, beam.y)
      } else if (beam.y < -8) beam.live = false
    }
    updateTentacle()
    for (let i = 0; i < balls.length; i++) moveBall(balls[i], dt)
    let kept = 0
    for (let i = 0; i < balls.length; i++) if (balls[i].y - R < H) balls[kept++] = balls[i]
    balls.length = kept
    trailTick++
    if (trailTick % 3 === 0) {
      for (const b of balls) {
        if (b.stuck) continue
        for (let i = 3; i > 0; i--) {
          b.tx[i] = b.tx[i - 1]
          b.ty[i] = b.ty[i - 1]
        }
        b.tx[0] = b.x
        b.ty[0] = b.y
        b.tn = Math.min(4, b.tn + 1)
      }
    }
    if (!boss && alive > 0 && alive <= Math.max(3, Math.floor(wallSize * CRUMBLE_SHARE))) {
      crumble -= dt
      if (crumble <= 0) {
        crumble = CRUMBLE_EVERY
        for (let i = bricks.length - 1; i >= 0; i--) {
          if (bricks[i].hp <= 0) continue
          damage(bricks[i], 9)
          break
        }
      }
    }
    if (boss ? boss.hp <= 0 : alive <= 0) sealBroken()
    else if (!balls.length) {
      changeSan(-MISS_SAN)
      if (running) dock()
    }
  }

  function stone(x: number, y: number, w: number, h: number) {
    ctx.fillStyle = '#141c18'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#2a3a32'
    ctx.fillRect(x, y, w, 1)
    ctx.fillRect(x, y, 1, h)
    ctx.fillStyle = '#070a09'
    ctx.fillRect(x, y + h - 1, w, 1)
    ctx.fillRect(x + w - 1, y, 1, h)
  }
  function orb(x: number, y: number, look = 0) {
    x = Math.round(x) - R
    y = Math.round(y) - R
    if (look === 1) {
      // Piercing fire: a white-hot core with a four-point flare.
      ctx.fillStyle = '#c8ff9a'
      ctx.fillRect(x - 1, y + 1, 6, 2)
      ctx.fillRect(x + 1, y - 1, 2, 6)
    }
    ctx.fillStyle = look === 2 ? '#ff9a4d' : look === 1 ? '#f4ffd0' : '#b7e5a5'
    ctx.fillRect(x, y, 4, 4)
    ctx.fillStyle = look === 2 ? '#fff1b8' : '#fffef3'
    ctx.fillRect(x + 1, y + 1, 2, 2)
  }
  function drawBoss(b: Boss, slide: number) {
    const y = b.y - slide + (reducedMotion ? 0 : Math.round(Math.sin(time * 1.3)))
    // Sixteen slices, each swaying a little further than the one above: the arms move, the head barely does.
    for (let r = 0; r < CELL; r++) {
      const sway = reducedMotion || r < 6 ? 0 : Math.round(Math.sin(time * 2.2 + r * 0.55) * ((r - 5) / 10) * 3)
      ctx.drawImage(b.art.image, 0, r, CELL, 1, b.x + sway, y + r * 4, BOSS_SIZE, 4)
      if (b.flash > 0 || (b.charging && Math.floor(time * 14) % 2 === 0)) {
        ctx.globalAlpha = b.flash > 0 ? 0.75 : 0.35
        ctx.drawImage(white(b.art), 0, r, CELL, 1, b.x + sway, y + r * 4, BOSS_SIZE, 4)
        ctx.globalAlpha = 1
      }
    }
    if (slide) return
    ctx.fillStyle = '#070a09'
    ctx.fillRect(b.x - 1, 1, BOSS_SIZE + 2, 6)
    ctx.fillStyle = '#3a1420'
    ctx.fillRect(b.x, 2, BOSS_SIZE, 4)
    ctx.fillStyle = b.flash > 0 ? '#ffd0d8' : '#c94f6d'
    ctx.fillRect(b.x, 2, Math.ceil((BOSS_SIZE * Math.max(0, b.hp)) / b.max), 4)
    ctx.fillStyle = '#070a09'
    for (let x = 8; x < BOSS_SIZE; x += 8) ctx.fillRect(b.x + x, 2, 1, 4)
  }
  /** Tentacle shapes creep in from both edges as sanity falls: a solid core with a dithered fringe. */
  function creep(san: number) {
    const reach = 0.25 + (0.75 * (50 - san)) / 50
    for (let y = 0; y < H; y += 2) {
      for (let side = 0; side < 2; side++) {
        const w = Math.floor(reach * (9 + 7 * Math.sin(y * 0.045 + time * 0.7 + side * 1.7) + 5 * Math.sin(y * 0.13 - time * 1.1 + side * 3.4)))
        if (w <= 0) continue
        const core = w >> 1
        if (core) {
          ctx.fillStyle = '#16301f'
          ctx.fillRect(side ? W - core : 0, y, core, 2)
          if (y % 12 === 0 && core > 2) {
            ctx.fillStyle = '#5c8f69'
            ctx.fillRect(side ? W - core + 1 : core - 2, y, 1, 1)
          }
        }
        ctx.drawImage(dither, 0, 0, w - core, 2, side ? W - w : core, y, w - core, 2)
      }
    }
  }
  function render() {
    const san = ui.san()
    const calm = reducedMotion
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#050807'
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.clip()
    if (shake > 0 && !calm) ctx.translate(Math.round(Math.sin(time * 113) * 2), Math.round(Math.cos(time * 97) * 2))
    // Receding stone pillars keep the ball readable against the dark field.
    for (let x = 12; x < W; x += 48) {
      ctx.fillStyle = '#09100c'
      ctx.fillRect(x, 4, 12, H)
      ctx.fillStyle = '#0c1610'
      ctx.fillRect(x - 3, 4, 18, 3)
    }
    const drift = calm ? 0 : Math.floor(time * 6) % 128
    for (let x = -drift; x < W; x += 128) ctx.drawImage(fog, x, calm ? 0 : Math.round(Math.sin(time * 0.3) * 3))
    ctx.fillStyle = '#203326'
    ctx.fillRect(0, 0, 1, H)
    ctx.fillRect(W - 1, 0, 1, H)

    const reforming = phase.kind === 'reforming' ? phase.elapsed : -1
    // The eyes follow the nearest thing that burns: a fire in flight, or the one waiting on the altar.
    const lookX = balls.length ? balls[0].x : altarX
    const lookY = balls.length ? balls[0].y : altarY()
    const shift = jitter > 0 && !calm
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i]
      if (b.hp <= 0 && b.flash <= 0) continue
      const progress = phase.kind === 'reforming' ? clamp((reforming - b.row * 0.06) / 0.06, 0, 1) : 1
      if (!progress) continue
      const x = b.x
      const y = b.y - (calm ? 0 : Math.round((1 - progress) * 16))
      stone(x, y, CELL, CELL)
      // The wall breathes: each sprite sinks one pixel in a slow wave. Cropping the source keeps the stone frame still.
      const breath = calm ? 0 : Number(Math.sin(time * 1.7 + b.col * 0.45 + b.row * 0.9) > 0.55)
      const j = Number(shift && b.row % 2 === 0)
      ctx.drawImage(b.art.image, 1 - j, 1 - breath, CELL - 2, CELL - 2, x + 1, y + 1, CELL - 2, CELL - 2)
      if (b.kind === 'eye') {
        if (!eyeOpen(b) || (!calm && (time + b.phase * 3.1) % 2.7 < 0.11)) {
          ctx.fillStyle = '#141c18'
          ctx.fillRect(x + 2, y + 3, 12, 10)
          ctx.fillStyle = '#658365'
          ctx.fillRect(x + 3, y + 8, 10, 1)
        } else {
          const ex = x + b.art.px + j
          const ey = y + b.art.py + breath
          const dx = lookX - ex - 1
          const dy = lookY - ey - 1
          const d = Math.hypot(dx, dy) || 1
          ctx.fillStyle = '#050807'
          ctx.fillRect(ex - 1, ey - 1, 4, 4)
          ctx.fillStyle = '#d8ff9a'
          ctx.fillRect(ex + Math.round((dx / d) * 1.2), ey + Math.round((dy / d) * 1.2), 2, 2)
        }
      }
      if ((b.kind === 'tome' || b.kind === 'idol') && b.hp > 0 && b.hp < HP[b.kind]) {
        ctx.fillStyle = '#050807'
        for (let k = 0; k < 11; k++) ctx.fillRect(x + 5 + (Math.floor(k / 3) % 2), y + 2 + k, 1, 1)
        ctx.fillRect(x + 7, y + 8, 4, 1)
        if (b.kind === 'idol' && b.hp === 1) ctx.fillRect(x + 11, y + 3, 1, 9)
      }
      if (b.flash > 0) {
        ctx.fillStyle = GREEN
        ctx.globalAlpha = 0.55
        ctx.fillRect(x, y, CELL, CELL)
        ctx.globalAlpha = 1
      }
    }
    if (boss) {
      const arrival = phase.kind === 'reforming' ? clamp((reforming - gridRows * 0.06) / 0.9, 0, 1) : 1
      // It lowers itself into the wall in nine-pixel steps; with reduced motion it is simply there once the wall forms.
      if (calm ? reforming >= 0 || phase.kind !== 'reforming' : arrival > 0) drawBoss(boss, calm ? 0 : Math.round((1 - arrival) * 9) * 9)
    }
    const wallBottom = TOP + gridRows * CELL
    if (!calm && san < 30) {
      // Below 30 the wall's colours slide: every block takes the hue of the overlay and keeps its own light and shade.
      ctx.globalCompositeOperation = 'hue'
      ctx.globalAlpha = 0.35 + ((30 - san) / 30) * 0.45
      ctx.fillStyle = HUES[Math.floor(time * 0.7) % HUES.length]
      ctx.fillRect(0, 0, W, wallBottom)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    if (invert && !calm) {
      ctx.globalCompositeOperation = 'difference'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, TOP, W, gridRows * CELL)
      ctx.globalCompositeOperation = 'source-over'
    }
    invert = false
    if (blast > 0) {
      ctx.fillStyle = blast > 0.07 ? '#fff1b8' : '#ffb35c'
      const bx = Math.round(blastX) - 24
      const by = Math.round(blastY) - 24
      for (let y = 0; y < 48; y += 2) for (let x = (y >> 1) & 1 ? 2 : 0; x < 48; x += 4) ctx.fillRect(bx + x, by + y, 2, 2)
    }

    if (tentacle.kind === 'warning') {
      const x = tentacle.side < 0 ? 0 : W - 28
      ctx.fillStyle = '#010302'
      ctx.fillRect(x, H - 72, 28, 72)
      const wobble = calm ? 0 : Math.round(Math.sin(time * 45))
      ctx.fillStyle = '#345040'
      ctx.fillRect(x + 12 + wobble, H - 52, 2, 52)
    } else if (tentacle.kind === 'rising' && tOn) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(tX, tY, 24, tH)
      ctx.clip()
      ctx.fillStyle = '#162a1c'
      ctx.fillRect(tX, tY, 24, tH)
      for (let y = H - 32; y > tY - 32; y -= 24) {
        const sway = calm ? 0 : Math.round(Math.sin(time * 3 + y) * 2)
        ctx.drawImage(tentacle.art.image, tX - 4 + sway, y, 32, 32)
      }
      ctx.restore()
    }
    for (const r of relics) if (r.live) ctx.drawImage(r.image, Math.round(r.x) - 9, Math.round(r.y) - 9)

    const aw = width()
    const ax = Math.round(altarX - aw / 2)
    const pressed = Number(squash > 0 && !calm)
    const ay = altarY() + pressed
    if (hurt > 0 && Math.floor(time * 20) % 2 === 0) ctx.globalAlpha = 0.4
    stone(ax, ay, aw, 6 - pressed)
    ctx.fillStyle = fx.mad > 0 ? PURPLE : '#668169'
    ctx.fillRect(ax + 2, ay + 1, aw - 4, 1)
    if (fx.grip > 0) {
      ctx.fillStyle = '#6fd0a0'
      for (let x = ax + 9; x < ax + aw - 9; x += 3) ctx.fillRect(x, ay - 1 - Number(!calm && Math.floor(time * 6 + x) % 2 === 0), 1, 2)
    }
    const flicker = calm ? 0 : Math.floor(time * 8) % 2
    for (let side = 0; side < 2; side++) {
      const x = side ? ax + aw - 8 : ax
      ctx.drawImage(relicArt.candle[0].image, x, ay - 8, 8, 8)
      ctx.fillStyle = fx.beam > 0 ? '#9dff8a' : fx.mad > 0 ? PURPLE : GOLD
      if (fx.beam > 0) ctx.fillRect(x + 3, ay - 10, 2, 3)
      else ctx.fillRect(x + 3, ay - 8 - flicker, 1 + flicker, 2)
    }
    ctx.globalAlpha = 1
    // Timer pips sit under the altar: the relic itself, and a bar that runs down.
    let active = 0
    for (const k of PIPS) if (k === 'wrath' ? wrath > 0 : fx[k] > 0) active++
    if (active) {
      let x = Math.round(clamp(altarX - (active * 11 - 2) / 2, 2, W - active * 11))
      const y = altarY() + 8
      for (const k of PIPS) {
        const part = k === 'wrath' ? wrath / WRATH_HITS : fx[k] / DURATION[k]
        if (part <= 0) continue
        ctx.drawImage(pipImage[k], x, y, 9, 9)
        ctx.fillStyle = '#141c18'
        ctx.fillRect(x, y + 10, 9, 2)
        ctx.fillStyle = PIP_COLOR[k]
        if (k === 'wrath') for (let i = 0; i < wrath; i++) ctx.fillRect(x + i * 3, y + 10, 2, 2)
        else ctx.fillRect(x, y + 10, Math.ceil(part * 9), 2)
        x += 11
      }
    }

    const look = wrath > 0 ? 2 : fx.pierce > 0 ? 1 : 0
    const trail = look === 2 ? TRAIL_WRATH : look === 1 ? TRAIL_PIERCE : TRAIL
    if (phase.kind === 'ready' || phase.kind === 'reforming') orb(altarX, altarY() - R - 1, look)
    for (const b of balls) {
      for (let i = b.tn - 1; i >= 0; i--) {
        const px = Math.round(b.tx[i]) - 2
        const py = Math.round(b.ty[i]) - 2
        ctx.fillStyle = trail[i]
        // A piercing fire leaves a solid streak; the ordinary trail thins out in a dither.
        if (look === 1 && i < 2) ctx.fillRect(px, py, 4, 4)
        else for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if ((dx + dy) % (i + 2) === 0) ctx.fillRect(px + dx, py + dy, 1, 1)
      }
      orb(b.x, b.y, look)
    }
    if (falseFire && !calm) {
      ctx.globalAlpha = 0.4
      orb(falseFire.x, falseFire.y)
      ctx.globalAlpha = 1
    }
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i]
      if (s.life <= 0) continue
      ctx.fillStyle = s.color
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size)
    }
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i]
      if (g.life <= 0) continue
      ctx.fillStyle = g.life > 0.6 ? '#9fd18b' : g.life > 0.3 ? '#54794c' : '#304c2e'
      const gx = Math.round(g.x + Math.sin(time * 2 + i))
      const gy = Math.round(g.y)
      const rune = RUNES[g.rune]
      for (let k = 0; k < 15; k++) if (rune[k] === '1') ctx.fillRect(gx + (k % 3), gy + Math.floor(k / 3), 1, 1)
    }

    // Darkness: everything but a ring of light round each fire and the altar. It gutters before it lifts.
    if (fx.dark > 0 && (fx.dark > 0.7 || Math.floor(time * 12) % 2 === 0)) {
      sctx.globalCompositeOperation = 'source-over'
      sctx.clearRect(0, 0, W, H)
      sctx.fillStyle = 'rgb(2 4 3 / 0.95)'
      sctx.fillRect(0, 0, W, H)
      sctx.globalCompositeOperation = 'destination-out'
      for (const b of balls) sctx.drawImage(light, Math.round(b.x) - 32, Math.round(b.y) - 32)
      sctx.drawImage(light, Math.round(altarX) - 44, altarY() - 34, 88, 60)
      ctx.drawImage(shade, 0, 0)
    }
    for (const beam of beams) {
      if (!beam.live) continue
      ctx.fillStyle = '#e9ffd0'
      ctx.fillRect(beam.x - 1, Math.round(beam.y), 2, 5)
      ctx.fillStyle = '#6fd05c'
      ctx.fillRect(beam.x - 1, Math.round(beam.y) + 5, 2, 3)
    }
    // Stares stay visible in the dark: they glow.
    ctx.fillStyle = '#c1dfad'
    for (const gaze of gazes) if (gaze.live) ctx.fillRect(Math.round(gaze.x) - 1, Math.round(gaze.y), 2, 6)
    if (!calm && san < 50) creep(san)

    for (let i = 0; i < pops.length; i++) {
      const p = pops[i]
      if (p.life <= 0) continue
      const w = textWidth(p.text, p.scale)
      drawText(
        ctx,
        p.text,
        Math.round(clamp(p.x - w / 2, 2, Math.max(2, W - w - 2))),
        Math.round(p.y - (calm ? 0 : (p.max - p.life) * 18)),
        p.color,
        true,
        p.scale,
      )
    }
    const m = mult()
    if (m > 1) drawText(ctx, MULT_TEXT[m], W - 11, H - 8, GOLD)
    if (flash > 0 && !calm) {
      ctx.fillStyle = '#e9ffd0'
      ctx.globalAlpha = flash > 0.18 ? 0.8 : flash > 0.09 ? 0.45 : 0.2
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  function point(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    altarX = fx.mad > 0 ? W - x : x
    clampAltar()
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!canInput() || !e.isPrimary || e.button !== 0) return
    e.preventDefault()
    canvas.focus({ preventScroll: true })
    pointerId = e.pointerId
    canvas.setPointerCapture(e.pointerId)
    point(e)
    press()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (canInput() && e.isPrimary && (e.pointerType === 'mouse' || e.pointerId === pointerId)) point(e)
  })
  const releasePointer = (e: PointerEvent) => {
    if (e.pointerId === pointerId) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      pointerId = null
    }
  }
  canvas.addEventListener('pointerup', releasePointer)
  canvas.addEventListener('pointercancel', releasePointer)
  canvas.addEventListener('lostpointercapture', () => {
    pointerId = null
  })

  /** Development shortcuts for reviewing late-game content; the whole branch is stripped from production builds. */
  function debugKey(code: string) {
    if (code === 'KeyB') {
      // Jump straight to the next boss seal.
      level = isBossSeal() ? level + 3 : Math.ceil(level / 3) * 3
      clearField()
      generate()
      phase = { kind: 'reforming', elapsed: 0 }
      hud()
    } else if (code === 'KeyN') {
      // Break the current seal (takes effect while the fire is in flight).
      if (boss) boss.hp = 0
      else {
        for (const b of bricks) b.hp = 0
        alive = 0
      }
    } else if (code === 'KeyM') changeSan(-20)
    else if (code.startsWith('Digit')) {
      const kinds = Object.keys(SUBJECT) as RelicKind[]
      spawnRelic(kinds[(Number(code.slice(5)) + 9) % 10], altarX, altarY() - 70)
    } else return false
    return true
  }
  window.addEventListener('keydown', (e) => {
    if (!canInput() || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.target instanceof HTMLElement && e.target.closest('button, a, input, textarea, select, [contenteditable]')) return
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'].includes(e.code)) {
      e.preventDefault()
      const fresh = !keys.has(e.code)
      keys.add(e.code)
      if (e.code === 'Space' && fresh && !e.repeat) press()
    } else if (import.meta.env.DEV && !e.repeat && debugKey(e.code)) e.preventDefault()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', releaseInput)

  return {
    start() {
      stop()
      running = true
      paused = document.hidden
      score = seals = broken = levelBroken = combo = bestCombo = time = accumulator = last = 0
      level = 1
      squash = hurt = guard = hitStop = stopCool = shake = flash = blast = jitter = beat = wrath = beamCool = 0
      for (const k of PIPS) if (k !== 'wrath') fx[k] = 0
      gazeTime = 2.5
      watched = invert = glitchQueued = glitchOn = false
      hallucination = 6
      glitchTime = 2
      falseFire = null
      dockedCount = 1
      falling = 0
      for (const r of relics) r.live = false
      for (const s of shards) s.life = 0
      for (const p of pops) p.life = 0
      for (const g of glyphs) g.life = 0
      trailTick = 0
      ui.san(100)
      hud()
      layout(true)
      altarX = W / 2
      clearField()
      generate()
      dock()
      observer = new ResizeObserver(() => {
        if (running && !paused) layout()
      })
      observer.observe(chapter)
      observer.observe(chapter.querySelector('.game-hud')!)
      observer.observe(status)
      canvas.focus({ preventScroll: true })
      render()
    },
    stop,
    pause,
    resume,
    frame(now: number) {
      if (!running || paused || document.hidden) return
      if (!last) last = now
      accumulator += Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      while (accumulator >= STEP && running) {
        accumulator -= STEP
        step(STEP)
      }
      if (running) {
        // Below 30 SAN the HUD shows nonsense for exactly one frame, then the real numbers return.
        if (glitchOn || hudDirty) hud()
        else if (glitchQueued) {
          glitchOn = true
          ui.score(Math.floor(Math.random() * 99999))
          ui.extra(glitchCopy)
        }
        glitchQueued = false
      }
      render()
    },
  }
}
