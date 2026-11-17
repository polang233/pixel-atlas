/**
 * "Snap fake pixels back to the grid": the code behind the Toolbox demo.
 *
 * Our own small version of what Pixel Snapper and unfake.js do, kept free of the DOM so it can
 * run anywhere:
 *   makeFake    ruins a clean sprite the way image models do (odd cell size, soft edges, drifting colours)
 *   detectGrid  finds the cell size and where the grid starts
 *   sampleCells takes the median colour at each cell centre
 *   quantise    merges colours that are nearly the same
 */

export interface Raster {
  width: number
  height: number
  /** RGBA, straight alpha */
  data: Uint8ClampedArray
}

export interface Grid {
  /** cell size in pixels, usually not a whole number */
  cell: number
  /** left and top edge of the first cell; may be slightly negative */
  x: number
  y: number
  cols: number
  rows: number
}

const raster = (width: number, height: number): Raster => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** how far each cell's colour drifts, per channel */
const DRIFT = 6
/** per-pixel noise, per channel */
const NOISE = 7
/** edge softness, in cells: the blur reaches this far either side of a cell border */
const BLUR = 0.17
/** how far the grid lines wander, in cells */
const WOBBLE = 0.05
const TAPS = [-1, -0.5, 0, 0.5, 1]
const TAP_WEIGHT = [1, 4, 6, 4, 1]

/**
 * A fake-pixel version of `sprite` on a `size`×`size` canvas: every source pixel becomes a
 * `scale`-wide cell that starts off the pixel grid, with soft edges, wavy lines, a different
 * tint in every cell and noise on top.
 */
export function makeFake(sprite: Raster, scale: number, size: number, seed: number): Raster {
  const rand = mulberry32(seed)
  const n = sprite.width
  const m = sprite.height
  const out = raster(size, size)
  const left = (size - n * scale) / 2 + (rand() - 0.5) * 0.7 * scale
  const top = (size - m * scale) / 2 + (rand() - 0.5) * 0.7 * scale
  const tint = new Float32Array(n * m * 3)
  for (let i = 0; i < tint.length; i++) tint[i] = (rand() * 2 - 1) * DRIFT
  const phaseU = rand() * 6.283
  const phaseV = rand() * 6.283
  const src = sprite.data
  const reach = (BLUR + WOBBLE) * scale + 1
  const x0 = Math.max(0, Math.floor(left - reach))
  const x1 = Math.min(size, Math.ceil(left + n * scale + reach))
  const y0 = Math.max(0, Math.floor(top - reach))
  const y1 = Math.min(size, Math.ceil(top + m * scale + reach))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - left) / scale + WOBBLE * Math.sin((y / size) * 8.2 + phaseU)
      const v = (y + 0.5 - top) / scale + WOBBLE * Math.sin((x / size) * 6.9 + phaseV)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      // away from the borders every tap lands in the same cell: one lookup does it
      const inside = Math.floor(u - BLUR) === Math.floor(u + BLUR) && Math.floor(v - BLUR) === Math.floor(v + BLUR)
      for (let j = inside ? 2 : 0; j < (inside ? 3 : 5); j++) {
        const cy = Math.floor(v + TAPS[j] * BLUR)
        if (cy < 0 || cy >= m) continue
        for (let i = inside ? 2 : 0; i < (inside ? 3 : 5); i++) {
          const cx = Math.floor(u + TAPS[i] * BLUR)
          if (cx < 0 || cx >= n) continue
          const k = cy * n + cx
          const alpha = src[k * 4 + 3]
          if (!alpha) continue
          const w = (TAP_WEIGHT[i] * TAP_WEIGHT[j] * alpha) / 255
          r += w * (src[k * 4] + tint[k * 3])
          g += w * (src[k * 4 + 1] + tint[k * 3 + 1])
          b += w * (src[k * 4 + 2] + tint[k * 3 + 2])
          a += w
        }
      }
      if (a < 0.5) continue
      // a faint bevel in every cell, lighter towards its top-left corner
      const shade = (1 - (u - Math.floor(u)) - (v - Math.floor(v))) * 5
      const o = (y * size + x) * 4
      out.data[o] = r / a + shade + (rand() * 2 - 1) * NOISE
      out.data[o + 1] = g / a + shade + (rand() * 2 - 1) * NOISE
      out.data[o + 2] = b / a + shade + (rand() * 2 - 1) * NOISE
      out.data[o + 3] = (a / (inside ? 36 : 256)) * 255
    }
  }
  return out
}

/** edge strength between neighbouring columns (or rows), with alpha premultiplied so soft borders count once */
function edgeProfile(img: Raster, vertical: boolean): Float64Array {
  const { width, height, data } = img
  const len = (vertical ? height : width) - 1
  const profile = new Float64Array(len)
  const step = vertical ? width * 4 : 4
  const xs = vertical ? width : width - 1
  const ys = vertical ? height - 1 : height
  for (let y = 0; y < ys; y++) {
    for (let x = 0; x < xs; x++) {
      const p = (y * width + x) * 4
      const q = p + step
      const a = data[p + 3] / 255
      const b = data[q + 3] / 255
      const d =
        Math.abs(data[p] * a - data[q] * b) +
        Math.abs(data[p + 1] * a - data[q + 1] * b) +
        Math.abs(data[p + 2] * a - data[q + 2] * b) +
        Math.abs(data[p + 3] - data[q + 3])
      profile[vertical ? y : x] += d
    }
  }
  let mean = 0
  for (let i = 0; i < len; i++) mean += profile[i]
  mean /= len
  for (let i = 0; i < len; i++) profile[i] -= mean
  return profile
}

/** one Fourier component of a profile: how strongly it repeats every `period` pixels, and at what offset */
function rhythm(profile: Float64Array, period: number): { strength: number; offset: number } {
  const w = (2 * Math.PI) / period
  const stepC = Math.cos(w)
  const stepS = Math.sin(w)
  let c = 1
  let s = 0
  let re = 0
  let im = 0
  for (let i = 0; i < profile.length; i++) {
    re += profile[i] * c
    im += profile[i] * s
    // turn the unit vector by one pixel instead of calling cos and sin again
    const next = c * stepC - s * stepS
    s = s * stepC + c * stepS
    c = next
  }
  // profile[i] sits on the border between pixel i and i + 1
  const offset = (((Math.atan2(im, re) / w + 1) % period) + period) % period
  return { strength: Math.hypot(re, im), offset }
}

/**
 * Cell borders are where colours change, so the edge profile of a fake-pixel image beats at
 * the cell size. The strongest beat wins; its phase says where the grid starts.
 */
export function detectGrid(img: Raster): Grid {
  const px = edgeProfile(img, false)
  const py = edgeProfile(img, true)
  const strength = (cell: number) => rhythm(px, cell).strength + rhythm(py, cell).strength
  const longest = Math.min(img.width, img.height) / 6
  // walk the frequencies in steps a quarter of what the image can resolve, then close in on the loudest
  const step = 1 / (4 * Math.max(px.length, py.length))
  let cell = 3
  let best = -1
  const listen = (frequency: number) => {
    const s = strength(1 / frequency)
    if (s > best) {
      best = s
      cell = 1 / frequency
    }
  }
  for (let f = 1 / longest; f <= 1 / 3; f += step) listen(f)
  const coarse = 1 / cell
  for (let f = coarse - step; f <= coarse + step; f += step / 20) listen(f)
  // soft edges keep the true size louder than its halves and thirds; this catches crisp input, where they tie
  for (let k = 3; k >= 2; k--) {
    if (cell * k <= longest && strength(cell * k) > best * 0.8) {
      cell *= k
      break
    }
  }
  // The beat is a little blunt on a short image, so finish by fitting a straight line through
  // the borders themselves: border k sits at start + k × cell, the same cell on both axes.
  const xs = borders(px, cell, rhythm(px, cell).offset)
  const ys = borders(py, cell, rhythm(py, cell).offset)
  const spread = xs.kk - (xs.k * xs.k) / xs.w + ys.kk - (ys.k * ys.k) / ys.w
  if (spread > 0) {
    const fitted = (xs.kp - (xs.k * xs.p) / xs.w + ys.kp - (ys.k * ys.p) / ys.w) / spread
    if (Math.abs(fitted - cell) < cell * 0.03) cell = fitted
  }
  const start = (sums: Sums) => {
    const offset = ((((sums.p - cell * sums.k) / sums.w) % cell) + cell) % cell
    return offset >= cell / 2 ? offset - cell : offset
  }
  const x = start(xs)
  const y = start(ys)
  return { cell, x, y, cols: Math.ceil((img.width - x) / cell - 0.5), rows: Math.ceil((img.height - y) / cell - 0.5) }
}

interface Sums {
  w: number
  k: number
  kk: number
  p: number
  kp: number
}

/** Where each border really is: the centre of the edge strength near every predicted line, as weighted sums for a line fit. */
function borders(profile: Float64Array, cell: number, offset: number): Sums {
  const sums: Sums = { w: 0, k: 0, kk: 0, p: 0, kp: 0 }
  const reach = cell * 0.3
  for (let k = 0; offset + k * cell < profile.length + 1; k++) {
    const line = offset + k * cell
    let weight = 0
    let centre = 0
    // profile[i] sits on the border between pixel i and i + 1
    for (let i = Math.max(0, Math.ceil(line - reach - 1)); i <= Math.min(profile.length - 1, Math.floor(line + reach - 1)); i++) {
      if (profile[i] <= 0) continue
      weight += profile[i]
      centre += profile[i] * (i + 1)
    }
    if (!weight) continue
    const p = centre / weight
    sums.w += weight
    sums.k += weight * k
    sums.kk += weight * k * k
    sums.p += weight * p
    sums.kp += weight * k * p
  }
  if (!sums.w) return { w: 1, k: 0, kk: 0, p: offset, kp: 0 }
  return sums
}

/** One pixel per cell: the median of the middle of the cell, where the blur from its neighbours does not reach. */
export function sampleCells(img: Raster, grid: Grid): Raster {
  const out = raster(grid.cols, grid.rows)
  const half = Math.max(0.5, grid.cell * 0.22)
  const channels = [0, 1, 2, 3].map(() => [] as number[])
  const median = (list: number[]) => list.sort((a, b) => a - b)[list.length >> 1]
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const cx = grid.x + (i + 0.5) * grid.cell
      const cy = grid.y + (j + 0.5) * grid.cell
      for (const list of channels) list.length = 0
      for (let y = Math.max(0, Math.round(cy - half)); y < Math.min(img.height, Math.round(cy + half)); y++) {
        for (let x = Math.max(0, Math.round(cx - half)); x < Math.min(img.width, Math.round(cx + half)); x++) {
          const p = (y * img.width + x) * 4
          channels[3].push(img.data[p + 3])
          if (img.data[p + 3] >= 128) for (let c = 0; c < 3; c++) channels[c].push(img.data[p + c])
        }
      }
      if (!channels[3].length || median(channels[3]) < 128) continue
      const o = (j * grid.cols + i) * 4
      for (let c = 0; c < 3; c++) out.data[o + c] = median(channels[c])
      out.data[o + 3] = 255
    }
  }
  return out
}

/**
 * Merge colours that sit within `tolerance` of each other (RGB distance) and repaint every
 * cell with the average of its group. Returns the palette, most used colour first.
 */
export function quantise(cells: Raster, tolerance = 16): { image: Raster; palette: [number, number, number][] } {
  const { data } = cells
  const groups: { sum: [number, number, number]; n: number }[] = []
  const owner = new Int32Array(cells.width * cells.height).fill(-1)
  const nearest = (p: number) => {
    let best = -1
    let bestD = Infinity
    for (let k = 0; k < groups.length; k++) {
      const { sum, n } = groups[k]
      if (!n) continue
      const d = Math.hypot(data[p] - sum[0] / n, data[p + 1] - sum[1] / n, data[p + 2] - sum[2] / n)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    return { best, bestD }
  }
  for (let i = 0; i < owner.length; i++) {
    const p = i * 4
    if (!data[p + 3]) continue
    let { best, bestD } = nearest(p)
    if (best < 0 || bestD > tolerance) best = groups.push({ sum: [0, 0, 0], n: 0 }) - 1
    for (let c = 0; c < 3; c++) groups[best].sum[c] += data[p + c]
    groups[best].n++
    owner[i] = best
  }
  // a second look, now that every group has settled on its average
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] < 0) continue
    const p = i * 4
    const { best } = nearest(p)
    if (best === owner[i]) continue
    for (let c = 0; c < 3; c++) {
      groups[owner[i]].sum[c] -= data[p + c]
      groups[best].sum[c] += data[p + c]
    }
    groups[owner[i]].n--
    groups[best].n++
    owner[i] = best
  }
  const image = raster(cells.width, cells.height)
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] < 0) continue
    const { sum, n } = groups[owner[i]]
    for (let c = 0; c < 3; c++) image.data[i * 4 + c] = Math.round(sum[c] / n)
    image.data[i * 4 + 3] = 255
  }
  const palette = groups
    .filter((g) => g.n)
    .sort((a, b) => b.n - a.n)
    .map((g) => [Math.round(g.sum[0] / g.n), Math.round(g.sum[1] / g.n), Math.round(g.sum[2] / g.n)] as [number, number, number])
  return { image, palette }
}

/** distinct colours among pixels that are not fully transparent */
export function countColours(img: Raster): number {
  const seen = new Set<number>()
  for (let p = 0; p < img.data.length; p += 4) {
    if (img.data[p + 3]) seen.add((img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2])
  }
  return seen.size
}
