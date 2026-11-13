/**
 * Access to the streaming atlas built by pipeline/build_atlas.py.
 * A "cell" (y * side + x) is the id of a sprite on the colour-wheel disc.
 */
import { type ColorWord, translateQuery } from './search-zh'

export interface LevelMeta {
  cells: number
  px: number
  tiles: number
}
export interface AtlasMeta {
  side: number
  count: number
  l1: LevelMeta
  l2: LevelMeta
}

/**
 * Base URL of the atlas, without a trailing slash. Defaults to the copy under
 * public/atlas; set VITE_ATLAS_BASE (see .env.example) to stream it from another
 * origin, such as an R2 bucket behind a custom domain.
 */
const envBase: string | undefined = import.meta.env.VITE_ATLAS_BASE
export const ATLAS = (envBase?.trim() || '/atlas').replace(/\/+$/, '')

/**
 * Every atlas request is made in CORS mode and without credentials, so the
 * response stays readable when the atlas is on another origin and the bitmaps
 * decoded from it can be drawn to a canvas or uploaded to WebGL without tainting.
 */
const CORS: RequestInit = { mode: 'cors', credentials: 'omit' }

/** Fetch a file of the atlas by its path under the base, e.g. `overview.png`. */
export const atlasFetch = (path: string): Promise<Response> => fetch(`${ATLAS}/${path}`, CORS)

let metaP: Promise<AtlasMeta> | null = null
export const loadMeta = (): Promise<AtlasMeta> => (metaP ??= atlasFetch('meta.json').then((r) => r.json()))

// ---- tile bitmaps (shared by the hero renderer and sprite crops) -------------

const bitmapCache = new Map<string, Promise<ImageBitmap | null>>()
let downloaded = 0
export const bytesDownloaded = () => downloaded

export function tileUrl(level: 1 | 2, tx: number, ty: number) {
  return `${ATLAS}/l${level}/${tx}_${ty}.webp`
}

/** Fetch + decode a tile. Level-2 bitmaps stay cached (LRU) for crops. */
export function tileBitmap(level: 1 | 2, tx: number, ty: number, keep = level === 2): Promise<ImageBitmap | null> {
  const url = tileUrl(level, tx, ty)
  const hit = bitmapCache.get(url)
  if (hit) {
    bitmapCache.delete(url)
    bitmapCache.set(url, hit)
    return hit
  }
  const p = fetch(url, CORS)
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => {
      if (!b) return null
      downloaded += b.size
      return createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    })
    .catch(() => null)
  if (keep) {
    bitmapCache.set(url, p)
    while (bitmapCache.size > 48) {
      const [k, v] = bitmapCache.entries().next().value!
      bitmapCache.delete(k)
      v.then((bm) => bm?.close())
    }
  }
  return p
}

/** The 16x16 sprite at a cell, as a canvas. */
export async function spriteCanvas(cell: number): Promise<HTMLCanvasElement | null> {
  const m = await loadMeta()
  const x = cell % m.side
  const y = Math.floor(cell / m.side)
  const n = m.l2.cells
  const bm = await tileBitmap(2, Math.floor(x / n), Math.floor(y / n))
  if (!bm) return null
  const c = document.createElement('canvas')
  c.width = c.height = 16
  c.getContext('2d')!.drawImage(bm, (x % n) * 16, (y % n) * 16, 16, 16, 0, 0, 16, 16)
  return c
}

// ---- captions -----------------------------------------------------------------

export interface CellInfo {
  cell: number
  id: number
  subject: string
  caption: string
}
type CapRow = [number, number, string] | null
const capChunks = new Map<string, Promise<CapRow[]>>()

export async function cellInfo(cell: number): Promise<CellInfo | null> {
  const m = await loadMeta()
  const x = cell % m.side
  const y = Math.floor(cell / m.side)
  const n = m.l2.cells
  const key = `${Math.floor(x / n)}_${Math.floor(y / n)}`
  let p = capChunks.get(key)
  if (!p) {
    p = atlasFetch(`cap/${key}.json`).then((r) => (r.ok ? r.json() : []))
    capChunks.set(key, p)
    if (capChunks.size > 64) capChunks.delete(capChunks.keys().next().value!)
  }
  const [rows, subjects] = await Promise.all([p, loadSubjects()])
  const row = rows[(y % n) * n + (x % n)]
  if (!row) return null
  return { cell, id: row[0], subject: subjects[row[1]][0], caption: row[2] }
}

// ---- search ---------------------------------------------------------------------

let subjectsP: Promise<[string, number][]> | null = null
const loadSubjects = (): Promise<[string, number][]> => (subjectsP ??= atlasFetch('subjects.json').then((r) => r.json()))

interface Index {
  subjects: [string, number][]
  offsets: Uint32Array
  cells: Uint32Array
  words: string[][]
}
let indexP: Promise<Index> | null = null
export function loadIndex(): Promise<Index> {
  indexP ??= Promise.all([loadSubjects(), atlasFetch('cells.bin').then((r) => r.arrayBuffer())]).then(([subjects, buf]) => {
    downloaded += buf.byteLength
    const offsets = new Uint32Array(subjects.length + 1)
    subjects.forEach(([, n], i) => {
      offsets[i + 1] = offsets[i] + n
    })
    return { subjects, offsets, cells: new Uint32Array(buf), words: subjects.map(([s]) => s.split(/[\s-]+/)) }
  })
  return indexP
}

export type SearchResult =
  | { kind: 'color'; rgb: [number, number, number]; label: string; color?: ColorWord }
  | {
      kind: 'subject'
      /** matched subjects, best first */
      subjects: { name: string; count: number; index: number }[]
      cells: Uint32Array
      total: number
      color: ColorWord | null
      english: string
    }
  | { kind: 'none'; english: string }

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i

/** rgba pixels of overview.png — used for colour filters and colour search */
export interface Overview {
  side: number
  px: Uint8ClampedArray
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (d < 1e-6) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

export function colorMatches(c: ColorWord, r: number, g: number, b: number) {
  const [h, s, l] = hsl(r, g, b)
  if (c.grey) return s < 0.14 && l >= c.l[0] && l <= c.l[1]
  if (s < 0.18) return false
  const inHue = c.h[0] <= c.h[1] ? h >= c.h[0] && h <= c.h[1] : h >= c.h[0] || h <= c.h[1]
  return inHue && l >= c.l[0] && l <= c.l[1]
}

export async function search(raw: string, ov: Overview): Promise<SearchResult | null> {
  const q = raw.trim().toLowerCase()
  if (!q) return null
  const hex = q.match(HEX)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = [...h].map((c) => c + c).join('')
    const n = parseInt(h, 16)
    return { kind: 'color', rgb: [n >> 16, (n >> 8) & 255, n & 255], label: `#${h}` }
  }
  const { english, color } = translateQuery(q)
  const words = english.split(/\s+/).filter(Boolean)
  if (!words.length) {
    if (color) return { kind: 'color', rgb: color.rgb, label: color.label, color }
    return { kind: 'none', english }
  }
  const idx = await loadIndex()
  const phrase = words.join(' ')
  const scored: { i: number; score: number }[] = []
  const plural = (w: string) => [w, `${w}s`, `${w}es`, w.replace(/s$/, '')]
  for (let pass = 0; pass < 2 && !scored.length; pass++) {
    idx.words.forEach((sw, i) => {
      const ok = words.every((w) => sw.some((x) => (pass === 0 ? plural(w).includes(x) : x.startsWith(w) || (w.length > 3 && x.includes(w)))))
      if (!ok) return
      const name = idx.subjects[i][0]
      let score = name === phrase ? 1000 : sw[sw.length - 1] === words[words.length - 1] ? 200 : 50
      score -= sw.length * 6
      scored.push({ i, score })
    })
  }
  if (!scored.length) return { kind: 'none', english }
  scored.sort((a, b) => b.score - a.score || idx.subjects[b.i][1] - idx.subjects[a.i][1])

  const top = scored.slice(0, 60)
  let total = 0
  for (const { i } of top) total += idx.subjects[i][1]
  const out = new Uint32Array(Math.min(total, 80_000))
  let k = 0
  for (const { i } of top) {
    for (let j = idx.offsets[i]; j < idx.offsets[i + 1] && k < out.length; j++) {
      const cell = idx.cells[j]
      if (color) {
        const p = cell * 4
        if (!colorMatches(color, ov.px[p], ov.px[p + 1], ov.px[p + 2])) continue
      }
      out[k++] = cell
    }
  }
  const cells = out.slice(0, k)
  return {
    kind: 'subject',
    subjects: top.map(({ i }) => ({ name: idx.subjects[i][0], count: idx.subjects[i][1], index: i })),
    cells,
    total: color ? cells.length : total,
    color,
    english,
  }
}

/** cell whose average colour is closest to rgb */
export function nearestColorCell(ov: Overview, rgb: [number, number, number]) {
  let best = -1
  let bd = Infinity
  const [r, g, b] = rgb
  for (let i = 0, n = ov.side * ov.side; i < n; i++) {
    const p = i * 4
    if (ov.px[p + 3] === 0) continue
    const dr = ov.px[p] - r
    const dg = ov.px[p + 1] - g
    const db = ov.px[p + 2] - b
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}
