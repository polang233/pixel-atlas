/**
 * 05 · Deep Sea. Scroll to dive from the beach to 4000 m. The sea is the scene:
 * the first screen is sky, a small beach on the left and open water. The shore
 * drops off steeply and the camera drifts away from it as it sinks, so the sand
 * slides out of the lower-left corner and from about 165 m on there is only
 * water, until the abyssal plain rises into view at the very end. Everything is
 * drawn per pixel into a low-res buffer: dithered depth bands, caustics, and
 * sprite colours absorbed the way water absorbs light (red first, blue last).
 * Below the sunlight only bioluminescence is left — and sonar.
 */

import { sound } from '../audio'
import { GameShell } from '../game'
import { formatInt, onLocaleChange, t } from '../i18n'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const PX = 3
const MAX_D = 4000
/** depth of the abyssal plain */
const FLOOR = MAX_D - 8
/** metres of dry land the seabed table keeps left of the waterline */
const LAND = 320
/** metres of abyssal plain it keeps past the foot of the slope */
const PLAIN = 1800
/** height of the dune behind the beach, metres above the water */
const DUNE = 9
/** how fast the drop-off falls, metres down per metre across: steep, so the sand keeps to the left of the first screen */
const WALL = 5.2
/** depths where the slope pauses on a shelf: the reef terrace, then two ledges in the wall */
const SHELVES = [9, 96, 150]
/** metres across of the terrace and of a ledge */
const TERRACE_W = 14
const LEDGE_W = 9
/** world x is squeezed on screens narrower than this, so a phone sees the same stretch of shore as a desktop */
const ASPECT = 1.6
/** camera depth of the first screen: with its 140 m of view the waterline lies 41 % of the way down, sky above it */
const TOP_D = 13
/** on the first screen the waterline meets the sand this far from the left edge (fraction of the width) */
const SHORE_AX = 0.23
/** camera depth where the drift away from the shore ends; the last sand leaves the corner sooner, near 165 m */
const CLEAR_D = 215
/** from there on the seabed stays out of view: past the left edge by this fraction of the width at a depth this many metres below the bottom row */
const EDGE_AX = 0.04
const EDGE_M = 14
/** Big Fish opens a third of a screen below the surface, the shore a strip on the left, and has left it by this depth */
const GAME_TOP = 60
const GAME_SHORE_AX = 0.12
const GAME_CLEAR = 260
/** it sinks this many metres over its first seconds whatever the player does: enough to leave the beach behind */
const GAME_SINK = 170
const GAME_SINK_S = 20
/** in the abyss the camera sits this many view widths past the foot of the slope: open water */
const OPEN_AX = 0.75
/** Big Fish camera speed limit, metres of depth per frame: growing pans the view instead of jerking it */
const GAME_PAN = 2.4
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const PAL = ['#7fdcf4', '#45b8e3', '#2b94cd', '#1f70ab', '#18548b', '#133d6b', '#0e2c50', '#0b1f3a', '#08152a', '#060e1e', '#040812', '#02040a'].map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
])
const STOPS = [0, 40, 100, 180, 300, 500, 800, 1200, 1800, 2600, 3400, 4000]
const depthU = (d: number) => {
  for (let i = 1; i < STOPS.length; i++) if (d <= STOPS[i]) return i - 1 + (d - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1])
  return STOPS.length - 1
}
const pack = (r: number, g: number, b: number) => (255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)
const SAND = [
  [224, 204, 151],
  [185, 160, 105],
  [121, 109, 79],
]
/** what is left of the three sand tones where no sunlight reaches: just enough to read as ground */
const SAND_DEEP = [
  [30, 34, 48],
  [19, 22, 35],
  [11, 13, 23],
]
const ROCK_BODY = [112, 110, 104]
const ROCK_TOP = [190, 188, 178]
// in the dark a rock is a lump of the ground with a faint rim
const ROCK_BODY_DEEP = [20, 24, 34]
const ROCK_TOP_DEEP = [46, 50, 66]
const KELP_STEM = [24, 67, 46]
const KELP_LEAF = [43, 96, 60]
const KELP_BUBBLE = [116, 175, 181]
const SHELLS = [
  [246, 236, 222],
  [232, 162, 154],
  [240, 132, 74],
]
const SHELL_SHADE = [206, 190, 172]
const NO_GLIM = [0, 0, 0]
/**
 * A colour lying on the seabed at depth d: red fades first, a little of the water's own colour
 * seeps in, and `deep` is what is left of it where no sunlight reaches.
 */
function ground(c: number[], deep: number[], d: number) {
  const k = Math.max(0, d)
  const dark = 1 - Math.exp(-k / 900)
  const fog = PAL[Math.min(PAL.length - 1, Math.floor(depthU(k)))]
  return pack(
    c[0] * Math.exp(-k / 380) * 0.9 + fog[0] * 0.1 + deep[0] * dark,
    c[1] * Math.exp(-k / 640) * 0.9 + fog[1] * 0.1 + deep[1] * dark,
    c[2] * (1 - dark) * 0.9 + fog[2] * 0.1 + deep[2] * dark,
  )
}
const ZONES = [
  {
    to: 200,
    get name() {
      return t('ocean.zone.0.name')
    },
    range: '0–200 m',
    get desc() {
      return t('ocean.zone.0.desc')
    },
  },
  {
    to: 1000,
    get name() {
      return t('ocean.zone.1.name')
    },
    range: '200–1000 m',
    get desc() {
      return t('ocean.zone.1.desc')
    },
  },
  {
    to: 3000,
    get name() {
      return t('ocean.zone.2.name')
    },
    range: '1000–3000 m',
    get desc() {
      return t('ocean.zone.2.desc')
    },
  },
  {
    to: 4001,
    get name() {
      return t('ocean.zone.3.name')
    },
    range: '3000–4000 m',
    get desc() {
      return t('ocean.zone.3.desc')
    },
  },
]

interface Creature {
  spr: Sprite
  /** swimmers: 0–1 along their stretch of open water; anything resting on the seabed: world x in metres */
  x: number
  depth: number
  scale: number
  speed: number
  dir: number
  phase: number
  glow: [number, number, number] | null
  layer: number
  revealUntil: number
  /** resting sprites stand in rows: place in the row and metres to the next one (narrow screens draw every other one) */
  rank: number
  gap: number
  /** where it was last drawn (buffer pixels), for the sonar */
  sx: number
  sy: number
}

const ROCK = 0
const KELP = 1
const CORAL = 2
const SHELL = 3
const PALM_TREE = 4
/** scenery on the seabed, fixed in the world; a and b are per-kind (size, variant, phase) */
interface Decor {
  x: number
  kind: number
  a: number
  b: number
}

const smooth = (k: number) => {
  const c = Math.max(0, Math.min(1, k))
  return c * c * (3 - 2 * c)
}
/** stable 0–1 hash: the seabed must look the same on every frame and every visit */
function hash(n: number, seed: number) {
  let h = Math.imul(n ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
/** 1-D value noise in -1..1 */
function noise(x: number, seed: number) {
  const i = Math.floor(x)
  const f = x - i
  const s = f * f * (3 - 2 * f)
  return (hash(i, seed) * (1 - s) + hash(i + 1, seed) * s) * 2 - 1
}

/**
 * The seabed, one sample per metre of world x (0 = the waterline). Built once:
 * it is in metres, so it does not depend on the canvas size. A dune, a short
 * foreshore and a reef terrace, then a drop-off that plunges to the plain at
 * FLOOR, broken by two ledges; benches and lumps are layered on top. `path` is
 * the inverse of the smooth profile (depth → x), which the camera and the
 * swimmers steer by; `flats` are the middles of the shelves, where something
 * can rest.
 */
function buildSeabed() {
  const slope: number[] = []
  const flats: number[] = []
  const path = new Float32Array(FLOOR + 1)
  let d = 0
  let next = 1
  let shelf = 0
  let width = 1
  let hold = 0
  while (d < FLOOR) {
    // metres down per metre across: 0.6 at the waterline, 0.9 from 6 m, WALL from 12 m below the terrace, flattening over the last 160 m
    let step = (0.6 + 0.3 * smooth(d / 6) + (WALL - 0.9) * smooth((d - SHELVES[0]) / 12)) * Math.sqrt(Math.max(0.02, Math.min(1, (FLOOR - d) / 160)))
    if (shelf < SHELVES.length && d >= SHELVES[shelf]) {
      width = hold = shelf++ ? LEDGE_W : TERRACE_W
      flats.push(slope.length + width / 2)
    }
    // a shelf keeps the ground almost level for `width` metres, eased over 2.5 m at either end
    if (hold > 0) {
      step *= 1 - 0.97 * smooth(Math.min(hold, width - hold) / 2.5)
      hold--
    }
    for (; next <= d + step && next <= FLOOR; next++) path[next] = slope.length + (next - d) / step
    slope.push(d)
    d += step
  }
  const footX = slope.length
  const depth = new Float32Array(LAND + footX + PLAIN)
  for (let i = 0; i < depth.length; i++) {
    const x = i - LAND
    // the dune rises quickly, so the palms stand well clear of the water
    const base = x < 0 ? -DUNE * (1 - Math.exp(x / 12)) : x < footX ? slope[x] : FLOOR
    // the beach stays smooth; the plain keeps only small lumps
    const wet = smooth((base - 2) / 58)
    const hill = smooth((FLOOR - base) / 120)
    // benches: a staircase 22 m of depth apart, its phase wandering so the steps are uneven
    const stair = base / 22 + noise(x / 260, 3) * 1.2
    const f = stair - Math.floor(stair)
    const g = smooth(smooth(f))
    depth[i] = base + 16 * (g - f) * wet * hill + noise(x / 55, 1) * (0.5 + 4.5 * wet) * (0.3 + 0.7 * hill) + noise(x / 17, 2) * (0.25 + 1.35 * wet)
  }
  return { depth, path, footX, flats }
}

// 19 × 21, trunk foot in column 5. l/g/d = frond light/mid/dark, t/b = trunk and its rings, c = coconut
const PALM = [
  '....lll.....lll....',
  '..llgggl...lgggll..',
  '.lgggddgl.lgddgggl.',
  'lggd...dglgd...dggl',
  'gd..lll.dgd.lll..dg',
  'd.llgggldtdlgggll.d',
  '.lggdddgctcgdddggl.',
  'lgd....dctb....dgl.',
  'gd.....dtt.d....dg.',
  'd.......tb.......d.',
  '........tt.........',
  '.......tt..........',
  '.......bt..........',
  '.......tt..........',
  '......tt...........',
  '......bt...........',
  '......tt...........',
  '.....tt............',
  '.....bt............',
  '.....tt............',
  '....ttt............',
]
const PALM_INK: Record<string, number> = {
  l: pack(132, 204, 96),
  g: pack(62, 152, 78),
  d: pack(32, 104, 64),
  t: pack(156, 108, 64),
  b: pack(110, 74, 46),
  c: pack(92, 56, 34),
}
// 5 × 5 pixel corals: two fans and a mound
const CORALS = [
  ['#.#.#', '#.#.#', '.###.', '..#..', '..#..'],
  ['.#..#', '.#.#.', '#.##.', '.##..', '..#..'],
  ['.....', '.....', '.##..', '####.', '#####'],
]
const CORAL_INK = [
  [236, 104, 142],
  [244, 152, 84],
  [168, 116, 226],
]

export function createOcean(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.oc-canvas')!
  const ctx = canvas.getContext('2d')!
  const depthNum = el.querySelector<HTMLElement>('.oc-depth')!
  const marker = el.querySelector<HTMLElement>('.oc-marker')!
  const zoneName = el.querySelector<HTMLElement>('.oc-zone')!
  const zoneDesc = el.querySelector<HTMLElement>('.oc-desc')!

  const { depth: seabed, path, footX, flats } = buildSeabed()
  const seabedAt = (x: number) => {
    const f = Math.max(0, Math.min(seabed.length - 1.001, x + LAND))
    const i = Math.floor(f)
    return seabed[i] + (seabed[i + 1] - seabed[i]) * (f - i)
  }
  /** world x where the smooth slope reaches depth d */
  const pathAt = (d: number) => {
    const f = Math.max(0, Math.min(FLOOR - 0.001, d))
    const i = Math.floor(f)
    return path[i] + (path[i + 1] - path[i]) * (f - i)
  }

  const by = (re: RegExp) => sprites.filter((s) => re.test(s.subject))
  // Almost every sprite in this strip is drawn facing left; these two face right.
  const facesRight = new Set<Sprite>([sprites[24], sprites[33]].filter(Boolean))
  /** mirror the sprite when its drawn facing differs from where it is heading */
  const mirror = (spr: Sprite, heading: number) => heading > 0 !== facesRight.has(spr)
  const creatures: Creature[] = []
  const add = (list: Sprite[], d0: number, d1: number, o: Partial<Creature> = {}) =>
    list.forEach((spr) => {
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
        rank: 0,
        gap: 0,
        sx: -9999,
        sy: -9999,
        ...o,
      })
    })
  const rest = (spr: Sprite, x: number, rank: number, gap: number) => {
    creatures.push({ spr, x, depth: 0, scale: 1, speed: 0, dir: 1, phase: rank, glow: null, layer: 1, revealUntil: 0, rank, gap, sx: -9999, sy: -9999 })
  }
  add(by(/tang|clownfish|puffer|seahorse|sea turtle|reef shark/), 14, 176)
  // the first screen is mostly open water: a few more small fish to fill it
  add(by(/tang|clownfish|seahorse/), 8, 70)
  // the reef: nothing can sit on the wall, so one rests on each shelf, a different pick on every visit
  const reef = by(/coral|seaweed|starfish|hermit|clam|pearl|urchin/)
  const reefGap = Math.min(...flats.slice(1).map((x, i) => x - flats[i]))
  const reefPick = Math.floor(Math.random() * reef.length)
  // 7 apart in a list of three of each: the shelves get different creatures
  if (reef.length) for (let i = 0; i < flats.length; i++) rest(reef[(reefPick + i * 7) % reef.length], flats[i], i, reefGap)
  add(by(/hammerhead|^jellyfish|^octopus|diver/), 260, 950)
  add(by(/sperm whale/).slice(0, 1), 520, 620, { scale: 3, speed: 0.00002 })
  add(by(/submarine/).slice(0, 1), 700, 800, { scale: 2, speed: 0.00003 })
  add(by(/ghost jellyfish/), 1200, 2800, { glow: [90, 230, 255], speed: 0.00002 })
  add(by(/^jellyfish/), 1500, 2600, { glow: [255, 120, 230], speed: 0.00002 })
  add(by(/anglerfish/), 1800, 3500, { glow: [190, 255, 120] })
  add(by(/dumbo/), 2600, 3900)
  // wreckage on the plain, where the dive ends: across the right half of the last screen, clear of the copy panel
  by(/anchor|treasure chest/).forEach((spr, i) => {
    rest(spr, footX + 400 + i * 56, i, 56)
  })

  // Scenery along the seabed, sorted by x: shells and palms on the beach, kelp and coral in the
  // light, and only rocks further down, thinning out with depth.
  const decor: Decor[] = [
    { x: -25, kind: PALM_TREE, a: 1, b: 1 },
    { x: -11, kind: PALM_TREE, a: 0, b: 0 },
  ]
  for (let i = 0, x = -48; x < footX + PLAIN; i++) {
    const d = seabedAt(x)
    // the wall below here never comes into view: the next sand the camera meets is the plain
    if (d > 420 && x < footX) {
      x = footX
      continue
    }
    // slots are 7 m apart along the ground, not across: the wall is dressed as densely as the flats
    const step = 7 / Math.hypot(1, seabedAt(x + 1) - d)
    const r = hash(i, 11)
    const at = x + hash(i, 12) * step * 0.7
    x += step
    if (d < 4) {
      if (r < 0.5) decor.push({ x: at, kind: SHELL, a: Math.floor(hash(i, 13) * 3), b: 0 })
      continue
    }
    const kelp = d > 5 && d < 250 ? 0.34 * (1 - d / 250) : 0
    const coral = d > 4 && d < 160 ? 0.16 * (1 - d / 160) : 0
    const rock = 0.09 + 0.09 * (1 - smooth((d - 300) / 1200))
    if (r < kelp) decor.push({ x: at, kind: KELP, a: 9 + Math.floor(hash(i, 13) * 22), b: hash(i, 14) * 6 })
    else if (r < kelp + coral) decor.push({ x: at, kind: CORAL, a: Math.floor(hash(i, 13) * 3), b: Math.floor(hash(i, 14) * 3) })
    else if (r < kelp + coral + rock) decor.push({ x: at, kind: ROCK, a: 4 + Math.floor(hash(i, 13) ** 2 * 8), b: hash(i, 14) })
  }
  decor.sort((p, q) => p.x - q.x)

  // sediment bands: fixed tone offsets per 4 rows, the band edges stepping every 16 columns
  const STRATA = Float32Array.from({ length: 16 }, (_, i) => (hash(i, 7) - 0.5) * 0.4)
  const WOBBLE = Uint8Array.from({ length: 16 }, (_, i) => Math.floor(hash(i, 9) * 6))
  const SAND_DRY = Uint32Array.from(SAND, (c) => pack(c[0] * 1.04, c[1] * 1.04, c[2] * 1.04))
  const sandWet = new Uint32Array(3)

  const snow = Array.from({ length: 30 }, () => ({ x: Math.random(), y: Math.random(), s: 0.2 + Math.random() }))
  /** world space: x in metres, d = depth in metres; v = rise in buffer pixels per frame; it pops at depth `pop` */
  const bubbles: { x: number; d: number; r: number; v: number; pop: number }[] = []
  /** world space, so a ring stays where it was sent while the dive moves on */
  const pings: { x: number; d: number; t0: number }[] = []
  const bubble = (x: number, d: number, pop: number) => {
    const r = Math.random()
    bubbles.push({ x, d, r: r < 0.08 ? 2 : r < 0.45 ? 1 : 0, v: 0.2 + Math.random() * 0.4, pop })
  }

  const SUN_P = 0.3
  // offsets from the shoal's centre: ox in view widths, oy in metres; x/y are world metres once placed
  const school = Array.from({ length: 54 }, () => ({
    ox: (Math.random() - 0.5) * 0.2 + (Math.random() - 0.5) * 0.1,
    oy: (Math.random() - 0.5) * 28,
    x: Number.NaN,
    y: 0,
    vx: 0,
    vy: 0,
  }))
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
  let waterline = new Float32Array(0)
  /** first sand row of every buffer column, refreshed each frame from the seabed table */
  let seaY = new Int16Array(0)
  /** the camera for this frame. left = world x of the left edge; ppm/ppmX = buffer pixels per metre down/across */
  const view = { cam: TOP_D, ppm: 1, ppmX: 1, squeeze: 1, left: 0, surfaceY: 0 }
  // How far the camera has travelled, in buffer pixels. Sand grain, waves and light patterns are
  // offset by it, so they stay put on the seabed instead of sliding with the screen.
  let scrollX = 0
  let scrollY = 0
  let lastCx = Number.NaN
  let lastCam = 0

  const depthAt = (p: number) => (p < SUN_P ? TOP_D + (p / SUN_P) * (200 - TOP_D) : 200 + ((p - SUN_P) / (1 - SUN_P)) * (MAX_D - 200 - 120))
  const cameraDepth = () => depthAt(shown)
  const progressAt = (d: number) =>
    Math.max(0, Math.min(1, d < 200 ? ((d - TOP_D) / (200 - TOP_D)) * SUN_P : SUN_P + ((d - 200) / (MAX_D - 320)) * (1 - SUN_P)))
  /** metres of water the showcase fits into the height: zoomed in under the sun, wide below it */
  const sceneViewM = (cam: number) => 140 + 220 * smooth((cam - 110) / 420)
  /**
   * World x of the view centre for a camera at depth `cam` (span and viewM = width and height of
   * the view in metres). It starts with the shore on the left and leaves it as it sinks: by `clear`
   * the left edge has drawn level with the point where the seabed passes below the view, and it
   * keeps that lead all the way down, so the dive is open water. A sine ease: the sand starts to
   * slide out with the first metre and has stopped moving by the time the last of it goes. From
   * 3250 m the camera pulls ahead and ends over the plain.
   */
  function cameraX(cam: number, span: number, viewM: number, inGame: boolean) {
    const top = inGame ? GAME_TOP : TOP_D
    const away = Math.sin((Math.max(0, Math.min(1, (cam - top) / ((inGame ? GAME_CLEAR : CLEAR_D) - top))) * Math.PI) / 2)
    const shore = -(inGame ? GAME_SHORE_AX : SHORE_AX) * span
    const open = pathAt(cam + viewM / 2 + EDGE_M) + EDGE_AX * span
    const cx = shore + (open - shore) * away + span / 2
    return cx + (footX + OPEN_AX * span - cx) * smooth((cam - 3250) / 630)
  }

  /** point the camera for this frame and work out where the seabed and the waves cross each column */
  function aim(w: number, h: number, t: number) {
    const cam = cameraDepth()
    const viewM = game.on ? 360 : sceneViewM(cam)
    const ppm = h / viewM
    const squeeze = Math.max(0.3, Math.min(1.25, w / h / ASPECT))
    const ppmX = ppm * squeeze
    const cx = cameraX(cam, w / ppmX, viewM, game.on)
    if (!Number.isNaN(lastCx)) {
      scrollX += (cx - lastCx) * ppmX
      scrollY += (cam - lastCam) * ppm
    }
    lastCx = cx
    lastCam = cam
    const left = cx - w / 2 / ppmX
    view.cam = cam
    view.ppm = ppm
    view.ppmX = ppmX
    view.squeeze = squeeze
    view.left = left
    view.surfaceY = h / 2 - cam * ppm
    for (let x = 0; x < w; x++) {
      // not clamped to the view: scenery rooted on it must stay off-screen when the seabed is
      seaY[x] = Math.max(-30000, Math.min(30000, Math.round(h / 2 + (seabedAt(left + (x + 0.5) / ppmX) - cam) * ppm)))
      const xw = x + scrollX
      waterline[x] = h / 2 + (-Math.sin(xw * 0.07 + t * 1.3) * 1.6 - Math.sin(xw * 0.023 - t * 0.8) * 1.2 - cam) * ppm
    }
  }
  const rowD = (y: number, h: number) => view.cam + (y - h / 2) / view.ppm
  const seaAt = (x: number) => seaY[Math.max(0, Math.min(seaY.length - 1, Math.round(x)))]

  el.addEventListener('pointermove', (e) => {
    mx = e.clientX / el.clientWidth
    my = e.clientY / el.clientHeight
  })
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect()
    const x = view.left + (e.clientX - r.left) / PX / view.ppmX
    const d = rowD((e.clientY - r.top) / PX, canvas.height)
    pings.push({ x, d, t0: performance.now() })
    if (pings.length > 4) pings.shift()
    sound.sonar()
    for (let i = 0; i < 2; i++) bubble(x + ((Math.random() - 0.5) * 10) / view.ppmX, d + (Math.random() * 4) / view.ppm, 0)
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
  interface Fish {
    spr: Sprite
    x: number
    y: number
    size: number
    vx: number
    vy: number
    phase: number
    glow: [number, number, number] | null
    revealUntil: number
  }
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
    x: 0,
    y: 0,
    size: START,
    face: 1,
    inv: 0,
    fish: [] as Fish[],
    score: 0,
    eaten: 0,
    keys: { x: 0, y: 0 },
    pointer: false,
    t0: 0,
  }
  /**
   * Where the round's camera wants to be: deeper as the player grows, as before, and GAME_SINK
   * deeper over the opening seconds on top of that. Both are eased in by the clock, so the round
   * starts under the surface and sinks slowly however fast the first fish are eaten.
   */
  const gameDepth = (now: number) => {
    const grown = (game.size - START) / (WIN - START)
    return GAME_TOP + smooth((now - game.t0) / 1000 / GAME_SINK_S) * (GAME_SINK + grown * (MAX_D - 300 - GAME_TOP - GAME_SINK))
  }
  /** lowest centre y that keeps a fish of this size out of the sand (sprites rarely fill their corners) */
  const seaMaxY = (x: number, size: number) => (seaY.length ? Math.min(seaAt(x - size * 0.3), seaAt(x), seaAt(x + size * 0.3)) - size * 0.35 : Infinity)
  const waterY = (x: number, y: number, size: number, h: number) =>
    Math.max(size / 2, view.surfaceY + 6 + size / 2, Math.min(h - size / 2, seaMaxY(x, size), y))

  /** the seabed is solid and so is the surface: nudge a fish back between them */
  function keepInWater(f: Fish) {
    const maxY = seaMaxY(f.x, f.size)
    if (f.y > maxY) {
      f.y = maxY
      f.vy = Math.min(f.vy, -0.2)
    }
    const minY = view.surfaceY + 6 + f.size / 2
    if (f.y < minY) {
      f.y = minY
      f.vy = Math.max(f.vy, 0.2)
    }
  }

  /** a new fish swims in from the left or right edge, or starts at `atX` when the round is being seeded */
  function spawn(w: number, h: number, d: number, atX = Number.NaN) {
    const pool = POOLS.find((p) => d < p.to) ?? POOLS[0]
    const list = pool.list.length ? pool.list : sprites
    // mostly smaller than you, some bigger — the ratio keeps the game fair as you grow
    const r = Math.random()
    const ratio = r < 0.62 ? 0.35 + Math.random() * 0.55 : r < 0.85 ? 1.15 + Math.random() * 0.5 : 1.8 + Math.random() * 1.2
    const size = Math.max(6, Math.min(110, game.size * ratio))
    const minY = Math.max(16, view.surfaceY + 6 + size / 2)
    const room = (x: number) => Math.min(h - 16, seaMaxY(x, size) - 4) - minY
    let left = Math.random() < 0.5
    let x = atX
    if (Number.isNaN(x)) {
      // an edge buried in the slope has no water to swim in from: use the other one
      if (room(left ? 0 : w - 1) < size / 2) left = !left
      x = left ? -size : w + size
    }
    const span = room(x)
    if (span < 0) return
    game.fish.push({
      spr: list[(Math.random() * list.length) | 0],
      x,
      y: minY + Math.random() * span,
      size,
      vx: (left ? 1 : -1) * (0.25 + Math.random() * 0.45) * (ratio > 1 ? 0.8 : 1),
      vy: 0,
      phase: Math.random() * 6,
      glow: pool.glow && Math.random() < 0.6 ? pool.glow : null,
      revealUntil: 0,
    })
  }

  function stepGame(w: number, h: number, now: number) {
    const cam = view.cam
    // Camera motion can move the waterline and the seabed even after the round has ended.
    game.y = waterY(game.x, game.y, game.size, h)
    for (const f of game.fish) keepInWater(f)
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
    game.y = waterY(game.x, game.y, game.size, h)
    game.inv = Math.max(0, game.inv - 1 / 60)
    if (game.fish.length < 12 + Math.floor(w / 120) && Math.random() < 0.06) spawn(w, h, cam)
    for (const f of game.fish) {
      f.x += f.vx * (16 / Math.max(10, f.size)) ** 0.3
      f.y += f.vy + Math.sin(now / 900 + f.phase) * 0.08
      f.vy *= 0.92
      keepInWater(f)
      const d = Math.hypot(f.x - game.x, f.y - game.y)
      if (d < (f.size + game.size) * 0.3) {
        if (game.size > f.size * 1.05) {
          f.x = -9999
          game.eaten++
          game.score += Math.round(f.size * 10)
          const before = Math.floor(game.size / 10)
          game.size = Math.min(WIN, game.size + f.size * 0.11)
          game.y = waterY(game.x, game.y, game.size, h)
          sound.eat(f.size)
          bubble(view.left + game.x / view.ppmX, rowD(game.y, h), 0)
          if (Math.floor(game.size / 10) > before) sound.grow()
          shell.score(game.score)
          if (game.size >= WIN) {
            game.alive = false
            const eaten = game.eaten
            const depth = Math.round(gameDepth(now))
            shell.end(
              game.score + 2000,
              () => t('ocean.won'),
              () => t('ocean.winResult', { n: eaten, depth: formatInt(depth) }),
              true,
            )
          }
        } else if (f.size > game.size * 1.05 && game.inv <= 0) {
          game.alive = false
          sound.hurt()
          sound.tone(300, 1.2, { type: 'sine', vol: 0.05, slide: 60 })
          const eaten = game.eaten
          const depth = Math.round(cam)
          shell.end(
            game.score,
            () => t('ocean.eaten'),
            () => t('ocean.loseResult', { subject: f.spr.subject, n: eaten, depth: formatInt(depth) }),
          )
        }
      }
    }
    game.fish = game.fish.filter((f) => f.x > -f.size * 2 && f.x < w + f.size * 2)
    progress = progressAt(gameDepth(now))
    shell.extra(() => t('ocean.hud', { size: Math.round(game.size), depth: formatInt(Math.round(cam)) }))
  }

  const shell = new GameShell(el, 'ocean', () => t('game.ocean'), {
    start() {
      const w = canvas.width
      const h = canvas.height
      const now = performance.now()
      Object.assign(game, { on: true, alive: true, x: w / 2, y: h / 2, size: START, face: 1, inv: 2, fish: [], score: 0, eaten: 0, t0: now })
      // The round opens at its own camera: cut there, so the fish are seeded against the seabed they will meet.
      progress = shown = progressAt(gameDepth(now))
      if (seaY.length === w) aim(w, h, now / 1000)
      game.y = waterY(game.x, game.y, game.size, h)
      for (let i = 0; i < 8; i++) spawn(w, h, GAME_TOP, Math.random() * w)
    },
    stop() {
      game.on = false
      game.fish = []
    },
  })
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    a: [-1, 0],
    ArrowRight: [1, 0],
    d: [1, 0],
    ArrowUp: [0, -1],
    w: [0, -1],
    ArrowDown: [0, 1],
    s: [0, 1],
  }
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
      waterline = new Float32Array(w)
      seaY = new Int16Array(w)
    }
    const b = buf!
    const t = now / 1000
    if (game.on) {
      // in metres, not in scroll progress: the same pace above and below the sunlit zone
      const d = cameraDepth()
      shown = progressAt(d + Math.max(-GAME_PAN, Math.min(GAME_PAN, (depthAt(progress) - d) * 0.05)))
    } else shown += (progress - shown) * 0.12
    // the first third of the dive stays in the sunlit zone, zoomed in; below it the view widens
    aim(w, h, t)
    const { cam, ppm, ppmX, left, surfaceY } = view
    const depthY = (d: number) => h / 2 + (d - cam) * ppm
    const sox = Math.round(scrollX)
    const soy = Math.round(scrollY)
    // on a phone 72 % across is where the depth gauge hangs: the sun stays left of it
    const sunX = Math.min(w * 0.72, w - 42)

    // ---- water and sand
    for (let y = 0; y < h; y++) {
      const d = rowD(y, h)
      const u = depthU(Math.max(0, d))
      const air = d < 4
      const shallow = d < 34 ? 1 - Math.max(0, d) / 34 : 0
      const caus = d < 140 ? (1 - d / 140) * (1 - d / 140) : 0
      const rays = d < 320 ? 1 - d / 320 : 0
      for (let i = 0; i < 3; i++) sandWet[i] = ground(SAND[i], SAND_DEEP[i], d)
      const yw = y + soy
      const sandBay = (yw & 3) * 4
      for (let x = 0; x < w; x++) {
        const below = y - seaY[x]
        if (below >= 0) {
          // a light crust, then sediment that slowly darkens inward; dither, bands and grain are fixed to the world.
          // The crust is two pixels thick sideways as well, or the drop-off would only be lit on the top of each step.
          const xw = x + sox
          let shade =
            below < 2 || y < seaY[x + 2 < w ? x + 2 : w - 1]
              ? 0
              : 0.45 + Math.min(0.4, below / 50) + Math.min(0.5, Math.max(0, below - 50) / 160) + STRATA[((yw + WOBBLE[(xw >> 4) & 15]) >> 2) & 15]
          let grain = Math.imul(xw, 374761393) + Math.imul(yw, 668265263)
          grain = Math.imul(grain ^ (grain >>> 13), 1274126177) >>> 27
          if (grain === 0) shade += 1
          else if (grain === 1) shade -= 1
          const tone = Math.max(0, Math.min(2, Math.floor(shade + BAYER4[sandBay + (xw & 3)])))
          b[y * w + x] = air && y <= waterline[x] ? SAND_DRY[tone] : sandWet[tone]
          continue
        }
        const bay = BAYER4[(y & 3) * 4 + (x & 3)]
        const p = PAL[Math.min(PAL.length - 1, Math.floor(u + bay))]
        let r = p[0]
        let g = p[1]
        let bl = p[2]
        if (air) {
          // the surface: a rolling waterline, foam on top, sky above
          const ds = (y - waterline[x]) / ppm
          if (ds < 0) {
            const k = Math.min(1, -ds / 40)
            const band = Math.floor(k * 4 + bay) / 4
            const sun = Math.hypot(x - sunX, (ds + 26) * ppm)
            if (sun < 7) b[y * w + x] = pack(255, 244, 196)
            else if (sun < 11 && bay > 0.4) b[y * w + x] = pack(255, 232, 170)
            else b[y * w + x] = pack(176 - band * 60, 226 - band * 34, 250 - band * 8)
            continue
          }
          if (ds < 1.3) {
            b[y * w + x] = pack(240, 252, 255)
            continue
          }
        }
        const xs = x + scrollX
        const ys = y + scrollY
        if (shallow > 0) {
          r += 26 * shallow
          g += 30 * shallow
          bl += 22 * shallow
          // glints dancing just under the surface
          const gl = Math.sin(xs * 0.31 + t * 2.1 + Math.sin(ys * 0.4 + t) * 2) * Math.sin(xs * 0.07 - t * 1.2)
          if (d > 1 && d < 22 && gl > 0.9 - bay * 0.1) {
            r += 70
            g += 70
            bl += 50
          }
        }
        if (rays > 0) {
          const v = Math.sin((xs + ys * 0.55) * 0.045 + t * 0.25) + Math.sin((xs - ys * 0.2) * 0.021 - t * 0.17)
          if (v > 1.3 - bay * 0.3) {
            r += 30 * rays
            g += 34 * rays
            bl += 30 * rays
          }
        }
        if (caus > 0) {
          const c = Math.abs(Math.sin(xs * 0.12 + t * 1.1 + Math.sin(ys * 0.19 + t * 0.7) * 1.6) + Math.sin(ys * 0.15 - t * 0.9 + Math.sin(xs * 0.09) * 1.3))
          if (c < 0.1 + bay * 0.06) {
            r += 48 * caus
            g += 50 * caus
            bl += 44 * caus
          }
        }
        b[y * w + x] = pack(r, g, bl)
      }
    }

    // ---- scenery on the seabed
    const paint = (x: number, y: number, color: number) => {
      if (x >= 0 && x < w && y >= 0 && y < h) b[y * w + x] = color
    }
    /** only where there is water: not above the waves, not inside the sand */
    const wet = (x: number, y: number, color: number) => {
      if (x >= 0 && x < w && y >= 0 && y < h && y > waterline[x] + 1 && y < seaY[x]) b[y * w + x] = color
    }
    // two palms 14 m apart would overlap on a narrow screen
    const onePalm = 14 * ppmX < 15
    for (let i = 0; i < decor.length; i++) {
      const q = decor[i]
      const x = Math.floor((q.x - left) * ppmX)
      if (x < -20) continue
      if (x >= w + 20) break
      const root = seaAt(x)
      if (root < -2 || root > h + 32) continue
      const dRoot = rowD(root, h)
      if (q.kind === ROCK) {
        // a boulder half sunk into the slope: rounded on top, lit from above
        const rows = Math.round(q.a * 0.6 + q.b * 1.5 + 1)
        const low = root + 1
        const body = ground(ROCK_BODY, ROCK_BODY_DEEP, dRoot)
        const top = ground(ROCK_TOP, ROCK_TOP_DEEP, dRoot)
        for (let dy = 0; dy < rows; dy++) {
          const inset = dy === rows - 1 ? (q.a > 5 ? 2 : 1) : dy === rows - 2 && q.a > 5 ? 1 : 0
          for (let dx = inset; dx < q.a - inset; dx++) wet(x + dx - (q.a >> 1), low - dy - 1, dy === rows - 1 || dx === inset ? top : body)
        }
      } else if (q.kind === KELP) {
        const height = Math.min(q.a, Math.floor((root - surfaceY) * 0.8))
        const stem = ground(KELP_STEM, NO_GLIM, dRoot)
        const leaf = ground(KELP_LEAF, NO_GLIM, dRoot)
        for (let row = 0; row < height; row++) {
          const sway = Math.round((Math.sin((reducedMotion ? 0 : t * 0.7) + q.b + row * 0.18) * 2 * row) / height)
          wet(x + sway, root - row - 1, stem)
          wet(x + sway + 1, root - row - 1, row % 4 < 2 ? leaf : stem)
        }
        // now and then a tall strand lets one bubble go
        const age = (t + q.b * 3) % 9
        if (!reducedMotion && q.a > 22 && age < 2.4)
          wet(x + Math.round(Math.sin(t + q.b)), Math.round(root - height - age * 9), ground(KELP_BUBBLE, NO_GLIM, dRoot))
      } else if (q.kind === CORAL) {
        const color = ground(CORAL_INK[q.b], NO_GLIM, dRoot)
        const rows = CORALS[q.a]
        for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) if (rows[dy][dx] === '#') wet(x + dx - 2, root - 4 + dy, color)
      } else if (q.kind === SHELL) {
        // a scallop, a pink cockle or a tiny starfish, on the beach and in the shallows
        const color = ground(SHELLS[q.a], NO_GLIM, dRoot)
        paint(x, root - 1, color)
        if (q.a === 2) {
          paint(x - 1, root - 1, color)
          paint(x + 1, root - 1, color)
          paint(x, root - 2, color)
        } else paint(x + 1, root - 1, ground(SHELL_SHADE, NO_GLIM, dRoot))
      } else if (!(onePalm && q.b)) {
        for (let dy = 0; dy < PALM.length; dy++) {
          const row = PALM[dy]
          for (let dx = 0; dx < row.length; dx++) {
            const ink = PALM_INK[row[dx]]
            if (ink !== undefined) paint(x + (q.a ? 5 - dx : dx - 5), root - PALM.length + 1 + dy, ink)
          }
        }
      }
    }

    // ---- particles
    for (const s of snow) {
      s.y += 0.0004 * s.s
      s.x += Math.sin(t + s.s * 10) * 0.0002
      if (s.y > 1) s.y = 0
      // nearer flakes slide further as the camera moves: the dive is felt even in open water
      const fx = s.x - (scrollX * 0.3 * s.s) / w
      const fy = s.y - (scrollY * 0.3 * s.s) / h
      const x = Math.floor((fx - Math.floor(fx)) * w)
      const y = Math.min(h - 1, Math.floor((fy - Math.floor(fy)) * h))
      if (y <= waterline[x] + 1 || y >= seaY[x]) continue
      const d = rowD(y, h)
      const a = 80 * Math.exp(-d / 900) + 10
      b[y * w + x] = pack(a + 8, a + 14, a + 22)
    }
    // a few stray bubbles: they rise from the seabed or from below the view, and most are gone before the surface
    if (!reducedMotion && Math.random() < (0.07 + (cam < 200 ? 0.04 : 0)) * Math.exp(-cam / 1200)) {
      const x = Math.floor(Math.random() * w)
      const y = Math.min(h + 2, seaY[x] - 1)
      if (y > waterline[x] + 8) bubble(left + x / ppmX, rowD(y, h), 3 + Math.random() * 24)
    }
    let kept = 0
    for (let i = 0; i < bubbles.length; i++) {
      const q = bubbles[i]
      q.d -= q.v / ppm
      const cy = Math.round(depthY(q.d))
      q.x += (Math.sin(cy * 0.2) * 0.2) / ppmX
      const cx = Math.round((q.x - left) * ppmX)
      // the camera may have left it behind
      if (q.d < q.pop || cx < -8 || cx > w + 8 || cy < -4 || cy > h + 60 || cy + q.r <= waterline[Math.max(0, Math.min(w - 1, cx))]) continue
      bubbles[kept++] = q
      const l = Math.max(26, 200 * Math.exp(-q.d / 1200))
      const color = pack(l, l + 10, l + 20)
      for (let dy = -q.r; dy <= q.r; dy++)
        for (let dx = -q.r; dx <= q.r; dx++) {
          const rr = dx * dx + dy * dy
          if (rr > q.r * q.r + 0.5 || (q.r > 1 && rr < (q.r - 1) * (q.r - 1))) continue
          wet(cx + dx, cy + dy, color)
        }
    }
    bubbles.length = kept

    // ---- a school of silversides in the sunlit zone: it parts around the pointer
    if (!game.on && cam < 330) {
      const px = mx * w
      const py = my * h
      // the shoal drifts up and down the dive path: just right of centre when the camera is level with it
      const span = (w / h / view.squeeze) * 140
      const scD = 74 + 38 * Math.sin(t * 0.21 + 1)
      const scX = cameraX(scD, span, 140, false) + (0.04 + 0.04 * Math.sin(t * 0.13)) * span
      for (const f of school) {
        const tx = scX + f.ox * span * 0.66
        const ty = scD + f.oy
        if (Number.isNaN(f.x)) {
          f.x = tx
          f.y = ty
        }
        f.vx += (tx - f.x) * ppmX * 0.004
        f.vy += (ty - f.y) * ppm * 0.004
        const fx = (f.x - left) * ppmX
        const fy = depthY(f.y)
        const dx = fx - px
        const dy = fy - py
        const dd = dx * dx + dy * dy
        if (dd < 34 * 34 && dd > 0.01) {
          const k = (1 - Math.sqrt(dd) / 34) * 1.1
          f.vx += (dx / Math.sqrt(dd)) * k
          f.vy += (dy / Math.sqrt(dd)) * k
        }
        f.vx *= 0.9
        f.vy *= 0.9
        if (!reducedMotion) {
          f.x += (f.vx + Math.sin(t * 2 + f.ox * 40) * 0.12) / ppmX
          f.y += f.vy / ppm
        }
        const xx = Math.round(fx)
        const yy = Math.round(fy)
        if (xx < 2 || yy < 0 || xx >= w - 2 || yy >= h || yy >= seaY[xx]) continue
        if (f.y < 3) continue
        const l = Math.exp(-f.y / 260)
        const head = f.vx >= 0 ? 1 : -1
        const flash = Math.sin(t * 6 + f.ox * 90) > 0.6 ? 40 : 0
        b[yy * w + xx] = pack(150 * l + 60 + flash, 190 * l + 50 + flash, 200 * l + 50 + flash)
        b[yy * w + xx + head] = pack(210 * l + 40, 232 * l + 20, 240 * l + 14)
        b[yy * w + xx - head] = pack(70 * l + 20, 110 * l + 30, 150 * l + 30)
      }
    }

    // ---- creatures
    const halos: [number, number, [number, number, number], number][] = []
    /** draw one sprite into the water buffer, absorbed by depth like real light; the sand hides whatever dips into it */
    const blit = (
      spr: Sprite,
      sx: number,
      sy: number,
      size: number,
      flip: boolean,
      d: number,
      glow: [number, number, number] | null,
      phase: number,
      reveal: number,
      lit = 0,
    ) => {
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
          if (xx < 0 || xx >= w || yy <= waterline[xx] || yy >= seaY[xx]) continue
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
              ux === 0 ||
              uy === 0 ||
              ux === 15 ||
              uy === 15 ||
              data[o - 4 + 3] < 128 ||
              data[o + 4 + 3] < 128 ||
              data[o - 64 + 3] < 128 ||
              data[o + 64 + 3] < 128
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
      stepGame(w, h, now)
      for (const f of game.fish) {
        const size = Math.round(f.size)
        const dl = Math.hypot(f.x - game.x, f.y - game.y)
        const lit = cam > 600 ? Math.max(0, 1 - dl / (40 + game.size)) : 0
        blit(
          f.spr,
          Math.round(f.x - size / 2),
          Math.round(f.y - size / 2 + Math.sin(t * 2 + f.phase) * 1.5),
          size,
          mirror(f.spr, f.vx),
          rowD(f.y, h),
          f.glow,
          f.phase,
          Math.max(0, (f.revealUntil - now) / 1400),
          lit,
        )
      }
      if (game.alive || Math.floor(now / 90) % 2) {
        const size = Math.round(game.size)
        blit(
          game.spr,
          Math.round(game.x - size / 2),
          Math.round(game.y - size / 2),
          size,
          mirror(game.spr, game.face),
          Math.min(rowD(game.y, h), 300),
          cam > 900 ? [255, 214, 120] : null,
          0,
          0.35 + 0.15 * Math.sin(now / 200),
          1,
        )
      }
    } else {
      for (const c of creatures) {
        const size = Math.round(16 * c.scale)
        c.sx = -9999
        let sx: number
        let sy: number
        let depth: number
        if (!c.speed) {
          // resting on the seabed, wherever the slope is under it
          // a 16 px sprite needs room: skip some where a squeezed view packs the row closer than that
          if (c.rank % Math.max(1, Math.ceil(18 / (c.gap * ppmX)))) continue
          const cx = Math.round((c.x - left) * ppmX)
          if (cx < -size || cx > w + size) continue
          const root = seaAt(cx)
          sx = cx - size / 2
          sy = root - size + 2
          depth = rowD(root, h)
        } else {
          if (!reducedMotion) c.x += c.speed * c.dir * 16
          // swimmers patrol the open water at their depth: from just clear of the slope (6 m deeper and
          // further out than they reach, for its lumps) to a little past the right edge of the view the
          // camera has when it reaches them
          if (c.x > 1) c.dir = -1
          if (c.x < 0) c.dir = 1
          const viewM = sceneViewM(c.depth)
          const pd = h / viewM
          const pdx = pd * view.squeeze
          const span = w / pdx
          const half = 8 * c.scale
          const hi = cameraX(Math.max(TOP_D, c.depth), span, viewM, false) + 0.62 * span
          const lo = Math.max(hi - 1.2 * span, pathAt(c.depth + half / pd + 6) + half / pdx + 6)
          const bob = Math.sin(t * 1.4 + c.phase) * 2
          sx = Math.round((lo + c.x * Math.max(40, hi - lo) - left) * ppmX + (mx - 0.5) * c.layer * -14 - size / 2)
          depth = c.depth
          sy = Math.round(depthY(depth) + bob + (my - 0.5) * c.layer * -6 - size / 2)
        }
        if (sy > h || sy + size < 0 || sx > w || sx + size < 0) continue
        c.sx = sx + size / 2
        c.sy = sy + size / 2
        // reef fish are shy: they turn and dart away from the pointer
        if (c.speed && c.depth < 200 && !reducedMotion) {
          const ddx = c.sx - mx * w
          const ddy = c.sy - my * h
          if (ddx * ddx + ddy * ddy < 30 * 30) {
            c.dir = ddx >= 0 ? 1 : -1
            c.x += c.dir * 0.004
          }
        }
        blit(c.spr, sx, sy, size, mirror(c.spr, c.dir), depth, c.glow, c.phase, Math.max(0, (c.revealUntil - now) / 1400))
      }
    }
    // additive glow halos, quantised into rings
    for (const [cx, cy, col, p] of halos) {
      const R = 14
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = Math.round(cx + dx)
          const yy = Math.round(cy + dy)
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || yy <= waterline[xx]) continue
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
      const px = (pg.x - left) * ppmX
      const py = depthY(pg.d)
      const steps = Math.ceil(rad * 6)
      for (let k = 0; k < steps; k += 2) {
        const a = (k / steps) * Math.PI * 2
        const xx = Math.round(px + Math.cos(a) * rad)
        const yy = Math.round(py + Math.sin(a) * rad)
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || yy <= waterline[xx]) continue
        const v = b[yy * w + xx]
        b[yy * w + xx] = pack((v & 255) + 30 * fade, ((v >> 8) & 255) + 200 * fade, ((v >> 16) & 255) + 190 * fade)
      }
      for (const f of game.fish) {
        const dd = Math.hypot(f.x - px, f.y - py)
        if (Math.abs(dd - rad) < f.size / 2 + 2 && f.revealUntil < now + 600) f.revealUntil = now + 1400
      }
      for (const c of creatures) {
        const dd = Math.hypot(c.sx - px, c.sy - py)
        if (Math.abs(dd - rad) < 8 * c.scale + 2 && c.revealUntil < now + 600) c.revealUntil = now + 1400
      }
    }
    ctx.putImageData(img!, 0, 0)

    // ---- HUD
    const dNow = Math.max(0, Math.round(cam))
    depthNum.textContent = `${formatInt(dNow)} m`
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

  onLocaleChange(() => {
    if (zone < 0) return
    zoneName.textContent = `${ZONES[zone].name} · ${ZONES[zone].range}`
    zoneDesc.textContent = ZONES[zone].desc
  })

  return {
    id: 'ocean',
    num: '03',
    title: () => t('world.ocean'),
    color: '#1f70ab',
    transition: 'wave',
    ambience: 'ocean',
    el,
    playing: () => shell.playing,
    consume(delta) {
      if (delta > 0 && progress >= 1) return false
      if (delta < 0 && progress <= 0) return false
      // slower than the wheel wants: the sunlit zone alone takes a few good scrolls
      progress = Math.min(1, Math.max(0, progress + delta / 6400))
      return true
    },
    enter(dir) {
      progress = shown = dir === 1 ? 0 : 1
      whaleSung = false
      zone = -1
      lastCx = Number.NaN
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
