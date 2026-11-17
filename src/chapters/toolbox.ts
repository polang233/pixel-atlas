/**
 * Toolbox: pixel-art tools and resources from the community. It is the second sheet of the
 * workshop chapter, behind the workbench (workshop-layers.ts puts the two together).
 *
 * The page is one scrolling panel. The wheel reaches it through `consume`, touch scrolls it
 * natively (`data-own-touch`), and a drag that starts at either end is handed back to the pager,
 * so the sequence carries on once the list has been read.
 *
 * Three cards at the top are playable, each a small version of the idea behind the tool it
 * introduces, written with our own code and our own sprites:
 *   snap   ruins a 16×16 sprite into "fake pixels", then finds the grid again (toolbox-snap.ts)
 *   forge  a strip of frames with a checker that catches broken ones and retakes them
 *   fx     pixel effects computed frame by frame and laid out as an atlas
 */

import gsap from 'gsap'
import { sound } from '../audio'
import { CATEGORIES, LAST_CHECKED, TOOLBOX, type ToolboxKey, type ToolCategory, type ToolItem } from '../data/toolbox'
import { initRepoStars } from '../gh-stars'
import { formatInt, onLocaleChange, t } from '../i18n'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import { countColours, detectGrid, type Grid, makeFake, quantise, type Raster, sampleCells } from './toolbox-snap'

type Bind = (update: () => void) => void

/** card colours by category: the main one, and a lighter one for identicon highlights */
const KIND: Record<ToolCategory, [string, string]> = {
  agent: ['#ff7a90', '#ffd3da'],
  tools: ['#c9a7ff', '#efe4ff'],
  assets: ['#6fd3ff', '#d6f3ff'],
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

function external(url: string, className: string, text = ''): HTMLAnchorElement {
  const a = h('a', className, text)
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  return a
}

function imageData(ctx: CanvasRenderingContext2D, source: Raster): ImageData {
  const image = ctx.createImageData(source.width, source.height)
  image.data.set(source.data)
  return image
}

/** a small mirrored pixel badge, different for every tool: an anchor for the eye, not a logo */
function identicon(item: ToolItem): HTMLCanvasElement {
  const canvas = h('canvas', 'tb-ident')
  canvas.width = canvas.height = 7
  canvas.setAttribute('aria-hidden', 'true')
  let hash = 2166136261
  for (const ch of item.id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  let filled = 0
  for (let i = 0; i < 15; i++) filled += (hash >>> i) & 1
  // a nearly empty badge reads as a smudge: flip it
  if (filled < 6) hash = (hash ^ 0x7fff) >>> 0
  const ctx = canvas.getContext('2d')!
  const [main, light] = KIND[item.category]
  for (let i = 0; i < 15; i++) {
    if (!((hash >>> i) & 1)) continue
    const x = 1 + (i % 3)
    const y = 1 + ((i / 3) | 0)
    ctx.fillStyle = (hash >>> (15 + i)) & 1 ? light : main
    ctx.fillRect(x, y, 1, 1)
    ctx.fillRect(6 - x, y, 1, 1)
  }
  return canvas
}

function card(item: ToolItem, index: number, variant: 'card' | 'feature' | 'compact', bind: Bind): HTMLElement {
  const el = h('article', `tb-card${variant === 'feature' ? ' tb-feature' : variant === 'compact' ? ' is-compact' : ''}`)
  el.dataset.kind = item.category
  el.dataset.id = item.id

  const head = h('div', 'tb-card-head')
  const title = h('h4', 'pix')
  title.append(external(item.url, 'tb-main', item.name))
  const arrow = h('span', 'tb-arrow pix', '↗')
  arrow.setAttribute('aria-hidden', 'true')
  head.append(identicon(item), title, arrow)

  const desc = h('p', 'tb-desc')
  bind(() => {
    desc.textContent = t(item.desc)
  })

  const tags = h('div', 'tb-tags pix')
  const price = h('span', `tb-price is-${item.price.kind}`)
  bind(() => {
    price.textContent = t(item.price.label)
  })
  tags.append(price)
  if (item.price.licence) tags.append(h('span', 'tb-licence', item.price.licence))
  if (item.aiAssisted) tags.append(aiTag(bind))

  const links = h('div', 'tb-links pix')
  if (item.repo) {
    // data-repo is the hook for star counts
    const repo = external(`https://github.com/${item.repo}`, 'tb-repo', `GitHub · ${item.repo}`)
    repo.dataset.repo = item.repo
    initRepoStars(repo, item.repo)
    const name = item.repo
    bind(() => {
      repo.setAttribute('aria-label', t('toolbox.repo', { repo: name }))
    })
    links.append(repo)
  }
  if (item.xPost) links.append(textLink(item.xPost, 'toolbox.link.x', bind))
  for (const link of item.links ?? []) links.append(textLink(link.url, link.label, bind))

  el.append(head)
  if (variant === 'feature') el.append(h('div', 'tb-demo'))
  el.append(desc, tags)
  if (item.example) {
    const example = item.example
    const box = h('div', 'tb-example')
    const label = h('span', 'tb-example-label pix')
    bind(() => {
      label.textContent = t('toolbox.example')
    })
    const row = h('div', 'tb-example-row pix')
    row.append(external(example.url, 'tb-example-name', `${example.name} ↗`))
    if (example.aiAssisted) row.append(aiTag(bind))
    const text = h('p')
    bind(() => {
      text.textContent = t(example.desc)
    })
    box.append(label, row, text)
    if (example.xPost) {
      const more = h('div', 'tb-links pix')
      more.append(textLink(example.xPost, 'toolbox.link.x', bind))
      box.append(more)
    }
    el.append(box)
  }
  if (links.childElementCount) el.append(links)

  el.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') sound.tick(1100 + (index % 9) * 90, 0.016)
  })
  return el
}

function textLink(url: string, label: ToolboxKey, bind: Bind): HTMLAnchorElement {
  const a = external(url, '')
  bind(() => {
    a.textContent = t(label)
  })
  return a
}

function aiTag(bind: Bind): HTMLElement {
  const tag = h('span', 'tb-ai')
  bind(() => {
    tag.textContent = t('toolbox.tag.ai')
    tag.title = t('toolbox.tag.aiTitle')
  })
  return tag
}

// ---- demo 1: snap fake pixels back to the grid ---------------------------------------------

const FAKE_SIZE = 240

function snapDemo(root: HTMLElement, sprites: Sprite[], bind: Bind) {
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const view = q<HTMLButtonElement>('.tb-snap-view')
  const fakeCanvas = q<HTMLCanvasElement>('.tb-snap-fake')
  const outCanvas = q<HTMLCanvasElement>('.tb-snap-out')
  const lines = q('.tb-snap-grid')
  const tag = q('.tb-snap-tag')
  const actual = q('.tb-snap-actual')
  const actualCanvas = actual.querySelector('canvas')!
  const run = q<HTMLButtonElement>('.tb-snap-run')
  const shuffle = q<HTMLButtonElement>('.tb-snap-shuffle')
  const slider = q<HTMLInputElement>('.tb-snap-scale input')
  const readout = q('.tb-snap-scale output')
  const steps = [...root.querySelectorAll<HTMLElement>('.tb-snap-steps li')]
  const stat = q('.tb-snap-stat')
  const swatches = q('.tb-snap-palette')
  const fakeCtx = fakeCanvas.getContext('2d')!
  const outCtx = outCanvas.getContext('2d')!

  // sprites with enough on them to be worth ruining
  const filled = sprites.filter((s) => {
    let area = 0
    for (let p = 3; p < s.data.data.length; p += 4) if (s.data.data[p]) area++
    return area >= 70
  })
  const pool = filled.length ? filled : sprites
  let current = Math.max(
    0,
    pool.findIndex((s) => s.subject === 'knight'),
  )
  let scale = Number(slider.value)
  let snapped = false
  let frame = 0
  let fake!: Raster
  let grid!: Grid
  let cells!: Raster
  let result!: ReturnType<typeof quantise>
  let fakeColours = 0

  function compute() {
    const sprite = pool[current]
    fake = makeFake(sprite.data, scale, FAKE_SIZE, sprite.id * 7 + 13)
    fakeColours = countColours(fake)
    grid = detectGrid(fake)
    cells = sampleCells(fake, grid)
    result = quantise(cells)
    // the output canvas holds one pixel per cell and sits exactly over the cells it found
    outCanvas.width = grid.cols
    outCanvas.height = grid.rows
    const percent = (v: number) => `${(v / FAKE_SIZE) * 100}%`
    for (const el of [outCanvas, lines]) {
      el.style.left = percent(grid.x)
      el.style.top = percent(grid.y)
      el.style.width = percent(grid.cols * grid.cell)
      el.style.height = percent(grid.rows * grid.cell)
    }
    lines.style.setProperty('--tb-cols', String(grid.cols))
    lines.style.setProperty('--tb-rows', String(grid.rows))
  }

  const renderText = () => {
    readout.textContent = t('toolbox.snap.scaleValue', { n: scale.toFixed(2) })
    tag.textContent = t(snapped ? 'toolbox.snap.snapped' : 'toolbox.snap.fake')
    run.textContent = t(snapped ? 'toolbox.snap.undo' : 'toolbox.snap.run')
    stat.textContent = snapped
      ? t('toolbox.snap.stat.snapped', { cell: grid.cell.toFixed(2), from: formatInt(fakeColours), to: result.palette.length })
      : t('toolbox.snap.stat.fake', { w: FAKE_SIZE, h: FAKE_SIZE, colours: formatInt(fakeColours) })
  }

  /** the settled picture for the current state, with nothing in motion */
  function render() {
    cancelAnimationFrame(frame)
    root.dataset.phase = snapped ? 'snapped' : 'fake'
    view.setAttribute('aria-pressed', String(snapped))
    steps.forEach((li) => {
      li.classList.toggle('is-on', snapped)
    })
    fakeCtx.clearRect(0, 0, FAKE_SIZE, FAKE_SIZE)
    outCtx.clearRect(0, 0, grid.cols, grid.rows)
    if (snapped) outCtx.putImageData(imageData(outCtx, result.image), 0, 0)
    else fakeCtx.putImageData(imageData(fakeCtx, fake), 0, 0)
    swatches.replaceChildren(
      ...(snapped ? result.palette : []).map(([r, g, b], i) => {
        const swatch = h('i')
        swatch.style.background = `rgb(${r} ${g} ${b})`
        swatch.style.setProperty('--i', String(i))
        return swatch
      }),
    )
    actual.hidden = !snapped
    if (snapped) drawActual()
    renderText()
  }

  /** the repaired sprite at one screen pixel per cell, cropped to what is on it */
  function drawActual() {
    const { image } = result
    let x0 = image.width
    let y0 = image.height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (!image.data[(y * image.width + x) * 4 + 3]) continue
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
    const w = Math.max(1, x1 - x0 + 1)
    const height = Math.max(1, y1 - y0 + 1)
    actualCanvas.width = w
    actualCanvas.height = height
    actualCanvas.style.width = `${w}px`
    actualCanvas.style.height = `${height}px`
    if (x1 >= 0) actualCanvas.getContext('2d')!.putImageData(imageData(outCtx, image), -x0, -y0)
  }

  /** measure, then snap cell by cell along the diagonals, then squeeze the palette */
  function animate() {
    const MEASURE = 420
    const SAMPLE = 900
    const SETTLE = 380
    const start = performance.now()
    const raw = imageData(outCtx, cells)
    const partial = outCtx.createImageData(grid.cols, grid.rows)
    const last = grid.cols + grid.rows - 2
    let done = -1
    root.dataset.phase = 'measure'
    steps[0].classList.add('is-on')
    sound.arp([660, 880, 1320], 0.06, { vol: 0.03 })
    const tick = (now: number) => {
      const elapsed = now - start
      if (elapsed >= MEASURE) {
        root.dataset.phase = 'sample'
        steps[1].classList.add('is-on')
        const progress = Math.min(1, (elapsed - MEASURE) / SAMPLE)
        const reach = Math.floor(progress * last)
        if (reach > done) {
          for (let d = done + 1; d <= reach; d++) {
            for (let j = Math.max(0, d - grid.cols + 1); j <= Math.min(d, grid.rows - 1); j++) {
              const i = d - j
              const p = (j * grid.cols + i) * 4
              partial.data.set(raw.data.subarray(p, p + 4), p)
              // whole pixels, so no ghost of the blur is left between two cleared cells
              const x = Math.floor(grid.x + i * grid.cell)
              const y = Math.floor(grid.y + j * grid.cell)
              fakeCtx.clearRect(x, y, Math.ceil(grid.x + (i + 1) * grid.cell) - x, Math.ceil(grid.y + (j + 1) * grid.cell) - y)
            }
          }
          done = reach
          outCtx.putImageData(partial, 0, 0)
          sound.tick(700 + progress * 1500, 0.012)
        }
      }
      if (elapsed < MEASURE + SAMPLE) {
        frame = requestAnimationFrame(tick)
        return
      }
      render()
      root.dataset.phase = 'quantise'
      sound.lock()
      frame = requestAnimationFrame(function settle(time: number) {
        if (time - start < MEASURE + SAMPLE + SETTLE) frame = requestAnimationFrame(settle)
        else root.dataset.phase = 'snapped'
      })
    }
    frame = requestAnimationFrame(tick)
  }

  function toggle() {
    snapped = !snapped
    if (snapped && !reducedMotion) {
      // the picture stays fake until the animation has turned it; the labels switch now
      view.setAttribute('aria-pressed', 'true')
      renderText()
      animate()
    } else {
      render()
      if (snapped) sound.lock()
      else sound.flip()
    }
  }
  run.addEventListener('click', toggle)
  view.addEventListener('click', toggle)
  shuffle.addEventListener('click', () => {
    current = (current + 1 + ((Math.random() * (pool.length - 1)) | 0)) % pool.length
    compute()
    render()
    sound.pop()
  })
  slider.addEventListener('input', () => {
    scale = Number(slider.value)
    compute()
    render()
    sound.tick(900 + (scale - 6) * 110, 0.012)
  })
  for (const button of [run, shuffle]) button.addEventListener('pointerenter', () => sound.tick(1700, 0.012))

  compute()
  render()
  bind(renderText)

  return {
    /** finish whatever is in motion */
    settle: render,
  }
}

// ---- demo 2: frames that get checked, and retaken when they fail ---------------------------------

/** one pixel of squash (+1) or stretch (-1) above the waist, feet planted: an idle breath */
const POSES = [0, 1, 1, 0, -1, 0]
type Fault = 'foot' | 'area' | 'identity'
const FAULTS: Fault[] = ['foot', 'area', 'identity']

function copyRow(from: ImageData, fromY: number, to: ImageData, toY: number) {
  if (fromY < 0 || fromY >= from.height || toY < 0 || toY >= to.height) return
  to.data.set(from.data.subarray(fromY * from.width * 4, (fromY + 1) * from.width * 4), toY * to.width * 4)
}

function bounds(img: ImageData) {
  let top = img.height
  let foot = -1
  let area = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!img.data[(y * img.width + x) * 4 + 3]) continue
      area++
      top = Math.min(top, y)
      foot = y
    }
  }
  return { top, foot, area }
}

function pose(master: ImageData, squash: number): ImageData {
  const out = new ImageData(master.width, master.height)
  const { top, foot } = bounds(master)
  const waist = top + Math.round((foot - top) * 0.4)
  for (let y = 0; y < master.height; y++) {
    if (squash > 0) copyRow(master, y <= waist ? y - 1 : y, out, y)
    else if (squash < 0) copyRow(master, y < waist ? y + 1 : y, out, y)
    else copyRow(master, y, out, y)
  }
  return out
}

function spoil(img: ImageData, fault: Fault): ImageData {
  const out = new ImageData(img.width, img.height)
  const { top, foot } = bounds(img)
  for (let y = 0; y < img.height; y++) {
    // floating: the whole frame three pixels up
    if (fault === 'foot') copyRow(img, y + 3, out, y)
    // a chunk missing from the top
    else if (fault !== 'area' || y > top + (foot - top) * 0.4) copyRow(img, y, out, y)
  }
  if (fault === 'identity') {
    // the same shape in someone else's colours
    for (let p = 0; p < out.data.length; p += 4) {
      const [r, g, b] = [out.data[p], out.data[p + 1], out.data[p + 2]]
      out.data[p] = 255 - g
      out.data[p + 1] = 255 - b
      out.data[p + 2] = 255 - r
    }
  }
  return out
}

/** Three things a script can check on a frame: where the feet are, how much is drawn, and whether the colours are still the character's. */
function inspect(img: ImageData, expected: ImageData): { fault: Fault; amount: number } | null {
  const a = bounds(img)
  const b = bounds(expected)
  if (a.foot !== b.foot) return { fault: 'foot', amount: Math.abs(b.foot - a.foot) }
  const off = Math.abs(a.area - b.area) / Math.max(1, b.area)
  if (off > 0.12) return { fault: 'area', amount: Math.round(off * 100) }
  let diff = 0
  let n = 0
  for (let p = 0; p < img.data.length; p += 4) {
    if (!img.data[p + 3] || !expected.data[p + 3]) continue
    diff += Math.abs(img.data[p] - expected.data[p]) + Math.abs(img.data[p + 1] - expected.data[p + 1]) + Math.abs(img.data[p + 2] - expected.data[p + 2])
    n++
  }
  return n && diff / n > 90 ? { fault: 'identity', amount: 0 } : null
}

function forgeDemo(slot: HTMLElement, master: Sprite, bind: Bind) {
  slot.classList.add('tb-forge')
  const strip = h('div', 'tb-forge-strip')
  const loop = h('canvas', 'tb-forge-loop')
  loop.width = loop.height = 16
  loop.setAttribute('role', 'img')
  const status = h('p', 'tb-demo-status pix')
  const hint = h('p', 'tb-demo-hint pix')
  const row = h('div', 'tb-forge-row')
  row.append(strip, loop)
  slot.append(row, status, hint)
  bind(() => {
    hint.textContent = t('toolbox.forge.hint')
    loop.setAttribute('aria-label', t('toolbox.forge.loop'))
  })

  const clean = POSES.map((squash) => pose(master.data, squash))
  const frames = clean.map((img, k) => {
    const button = h('button', 'tb-frame')
    button.type = 'button'
    const canvas = h('canvas')
    canvas.width = canvas.height = 16
    const mark = h('i')
    mark.setAttribute('aria-hidden', 'true')
    button.append(canvas, mark)
    strip.append(button)
    bind(() => {
      button.setAttribute('aria-label', t('toolbox.forge.frame', { n: k + 1 }))
    })
    return { button, ctx: canvas.getContext('2d')!, img, broken: false }
  })
  const loopCtx = loop.getContext('2d')!
  let say: () => string = () => t('toolbox.forge.idle', { n: frames.length })
  const tell = (message: () => string) => {
    say = message
    status.textContent = say()
  }
  bind(() => {
    status.textContent = say()
  })

  let active = false
  let checking = false
  let fixed = false
  let nextFault = 0
  let shown = 0
  let loopTimer = 0
  let timer = 0

  const paint = (k: number) => {
    frames[k].ctx.putImageData(frames[k].img, 0, 0)
    frames[k].button.classList.toggle('is-broken', frames[k].broken)
    if (reducedMotion || !active) loopCtx.putImageData(frames[0].img, 0, 0)
  }
  frames.forEach((_, k) => {
    paint(k)
  })

  const wait = (ms: number, then: () => void) => {
    timer = window.setTimeout(then, ms)
  }
  function check(k: number) {
    frames.forEach((f, i) => {
      f.button.classList.toggle('is-checking', i === k)
    })
    if (k >= frames.length) {
      checking = false
      // one may have been broken behind the checker's back
      if (frames.some((f) => f.broken)) return wait(300, recheck)
      if (fixed) sound.select()
      fixed = false
      return tell(() => t('toolbox.forge.idle', { n: frames.length }))
    }
    tell(() => t('toolbox.forge.checking', { n: k + 1 }))
    sound.tick(1300 + k * 110, 0.014)
    wait(240, () => {
      const problem = inspect(frames[k].img, clean[k])
      if (!problem) {
        frames[k].broken = false
        return check(k + 1)
      }
      const n = k + 1
      tell(() =>
        problem.fault === 'foot'
          ? t('toolbox.forge.foot', { n, px: problem.amount })
          : problem.fault === 'area'
            ? t('toolbox.forge.area', { n, pct: problem.amount })
            : t('toolbox.forge.identity', { n }),
      )
      frames[k].button.classList.add('is-bad')
      sound.nothing()
      wait(950, () => {
        frames[k].img = clean[k]
        frames[k].broken = false
        frames[k].button.classList.remove('is-bad')
        paint(k)
        if (!reducedMotion) frames[k].button.animate([{ transform: 'scale(1.2, 0.8)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'steps(3)' })
        fixed = true
        sound.pop()
        wait(320, () => check(k + 1))
      })
    })
  }
  function recheck() {
    if (checking || !active) return
    checking = true
    check(0)
  }

  frames.forEach((f, k) => {
    f.button.addEventListener('click', () => {
      if (f.broken) return
      f.broken = true
      f.img = spoil(clean[k], FAULTS[nextFault++ % FAULTS.length])
      // a fault the checker cannot see (grey sprites look the same in "someone else's colours") is no use here
      if (!inspect(f.img, clean[k])) f.img = spoil(clean[k], 'foot')
      paint(k)
      sound.hurt()
      if (checking) return
      tell(() => t('toolbox.forge.broken', { n: k + 1 }))
      window.clearTimeout(timer)
      wait(520, recheck)
    })
    f.button.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') sound.tick(1500 + k * 90, 0.012)
    })
  })

  return {
    start() {
      active = true
      window.clearInterval(loopTimer)
      if (!reducedMotion) {
        loopTimer = window.setInterval(() => {
          shown = (shown + 1) % frames.length
          loopCtx.putImageData(frames[shown].img, 0, 0)
        }, 140)
      }
      if (frames.some((f) => f.broken)) recheck()
    },
    stop() {
      active = false
      checking = false
      window.clearInterval(loopTimer)
      window.clearTimeout(timer)
      frames.forEach((f) => {
        f.button.classList.remove('is-checking', 'is-bad')
      })
    },
  }
}

// ---- demo 3: effects drawn by code, frame by frame ------------------------------------------------

const FX = 24
const FX_FRAMES = 8
type Put = (x: number, y: number, colour: number) => void

interface Effect {
  name: 'toolbox.fx.burst' | 'toolbox.fx.ring' | 'toolbox.fx.spark'
  /** four colours, from the hot centre to the fading edge */
  ramp: [number, number, number][]
  draw(put: Put, frame: number): void
  sound(): void
}

const EFFECTS: Effect[] = [
  {
    name: 'toolbox.fx.burst',
    ramp: [
      [255, 247, 214],
      [255, 204, 77],
      [255, 122, 60],
      [194, 48, 74],
    ],
    draw(put, f) {
      const colour = Math.min(3, f >> 1)
      if (f < 3) {
        const r = 2.5 + f
        for (let y = -5; y <= 5; y++) {
          for (let x = -5; x <= 5; x++) {
            const d = Math.hypot(x, y)
            if (d <= r && (f < 2 || d > r - 1.5)) put(12 + x, 12 + y, colour)
          }
        }
      }
      const reach = 2 + 9 * (1 - (1 - f / 7) ** 2)
      for (let i = 0; i < 12; i++) {
        // the last frames lose every other spark
        if (f >= 6 && i % 2) continue
        const angle = (i / 12) * Math.PI * 2 + (i % 3) * 0.17
        const r = reach * (0.72 + ((i * 7) % 5) * 0.07)
        const x = Math.round(11.5 + Math.cos(angle) * r)
        const y = Math.round(11.5 + Math.sin(angle) * r)
        put(x, y, colour)
        if (f < 4) {
          put(x + 1, y, colour)
          put(x, y + 1, colour)
          put(x + 1, y + 1, colour)
        }
      }
    },
    sound: () => sound.pop(),
  },
  {
    name: 'toolbox.fx.ring',
    ramp: [
      [255, 255, 255],
      [157, 240, 255],
      [74, 168, 255],
      [58, 79, 208],
    ],
    draw(put, f) {
      const r = 1.5 + f * 1.3
      // two pixels thick while it is young, one after that
      const width = f < 3 ? 1 : 0.5
      for (let y = 0; y < FX; y++) {
        for (let x = 0; x < FX; x++) {
          if (Math.abs(Math.hypot(x - 11.5, y - 11.5) - r) > width) continue
          // the ring breaks into a dither as it fades, then into a few last dots
          if (f === 6 && (x + y) % 2) continue
          if (f === 7 && (x * 7 + y * 13) % 5 > 1) continue
          put(x, y, Math.min(3, f >> 1))
        }
      }
    },
    sound: () => sound.whoosh(0.3, false),
  },
  {
    name: 'toolbox.fx.spark',
    ramp: [
      [255, 255, 255],
      [255, 243, 160],
      [255, 204, 77],
      [255, 154, 60],
    ],
    draw(put, f) {
      const arm = [1, 3, 6, 9, 7, 5, 3, 1][f]
      for (let k = 0; k <= arm; k++) {
        const colour = k < arm * 0.4 ? 0 : k < arm * 0.75 ? 1 : 2
        put(12 + k, 12, colour)
        put(12 - k, 12, colour)
        put(12, 12 + k, colour)
        put(12, 12 - k, colour)
      }
      if (f >= 2 && f <= 5) {
        for (let k = 1; k <= arm >> 1; k++) {
          for (const [sx, sy] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]) {
            put(12 + sx * k, 12 + sy * k, k === 1 ? 1 : 3)
          }
        }
      }
    },
    sound: () => sound.sparkle(),
  },
]

function fxDemo(slot: HTMLElement, bind: Bind) {
  slot.classList.add('tb-fx')
  const stage = h('button', 'tb-fx-stage')
  stage.type = 'button'
  const screen = h('canvas')
  screen.width = screen.height = FX
  stage.append(screen)
  const sheet = h('div', 'tb-fx-sheet')
  const atlas = h('canvas')
  atlas.width = FX * FX_FRAMES
  atlas.height = FX
  const marker = h('i')
  sheet.append(atlas, marker)
  sheet.setAttribute('aria-hidden', 'true')
  const status = h('p', 'tb-demo-status pix')
  const hint = h('p', 'tb-demo-hint pix')
  const side = h('div', 'tb-fx-side')
  side.append(sheet, status, hint)
  slot.append(stage, side)

  const screenCtx = screen.getContext('2d')!
  const atlasCtx = atlas.getContext('2d')!
  // every effect is rendered once, as its eight frames
  const rendered = EFFECTS.map((effect) =>
    Array.from({ length: FX_FRAMES }, (_, f) => {
      const img = new ImageData(FX, FX)
      effect.draw((x, y, colour) => {
        if (x < 0 || y < 0 || x >= FX || y >= FX) return
        img.data.set([...effect.ramp[colour], 255], (y * FX + x) * 4)
      }, f)
      return img
    }),
  )
  let which = 0
  let timer = 0
  const show = (f: number) => {
    screenCtx.putImageData(rendered[which][f], 0, 0)
    marker.style.left = `${(f / FX_FRAMES) * 100}%`
  }
  const lay = () => {
    atlasCtx.clearRect(0, 0, atlas.width, atlas.height)
    rendered[which].forEach((img, f) => {
      atlasCtx.putImageData(img, f * FX, 0)
    })
    show(3)
  }
  bind(() => {
    status.textContent = t('toolbox.fx.atlas', { name: t(EFFECTS[which].name), n: FX_FRAMES })
    hint.textContent = t('toolbox.fx.hint')
    stage.setAttribute('aria-label', t('toolbox.fx.play'))
  })
  const stop = () => {
    window.clearInterval(timer)
    timer = 0
    show(3)
  }
  stage.addEventListener('click', () => {
    // the first click plays what is on show; after that each click moves on to the next effect
    if (stage.dataset.played) which = (which + 1) % EFFECTS.length
    stage.dataset.played = 'true'
    window.clearInterval(timer)
    lay()
    status.textContent = t('toolbox.fx.atlas', { name: t(EFFECTS[which].name), n: FX_FRAMES })
    EFFECTS[which].sound()
    if (reducedMotion) return
    let f = 0
    show(0)
    timer = window.setInterval(() => {
      if (++f >= FX_FRAMES) stop()
      else show(f)
    }, 70)
  })
  stage.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') sound.tick(1900, 0.012)
  })
  lay()
  return { stop }
}

// ---- the chapter ---------------------------------------------------------------------------------

export interface Toolbox extends Chapter {
  /**
   * Scroll to the card of the tool at `url` (its page, or its GitHub repository) and flash it.
   * Returns the card's link, or null when the list has no such tool.
   */
  spotlight(url: string, smooth?: boolean): HTMLElement | null
}

/** an address without the parts that differ between two links to the same place */
const bare = (url: string) =>
  url
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()

/**
 * @param sprites clean 16×16 sprites for the demos to play with
 * @param page    hands scroll the panel has no use for (a drag past either end) to the chapter pager
 */
export function createToolbox(el: HTMLElement, sprites: Sprite[], page: (delta: number) => void): Toolbox {
  const scroller = el.querySelector<HTMLElement>('.tb-scroll')!
  const jump = el.querySelector<HTMLElement>('.tb-jump')!
  const texts: (() => void)[] = []
  const bind: Bind = (update) => {
    update()
    texts.push(update)
  }
  onLocaleChange(() => {
    texts.forEach((update) => {
      update()
    })
  })

  // ---- cards, from the data ----
  const featured = el.querySelector<HTMLElement>('.tb-featured')!
  const snapLinks = el.querySelector<HTMLElement>('.tb-snap-links')!
  const counts: Record<string, number> = { featured: 0 }
  let forge: ReturnType<typeof forgeDemo> | undefined
  let fx: ReturnType<typeof fxDemo> | undefined
  TOOLBOX.forEach((item, index) => {
    if (!item.featured) {
      el.querySelector(`.tb-section[data-cat="${item.category}"] .tb-grid`)!.append(card(item, index, 'card', bind))
      counts[item.category] = (counts[item.category] ?? 0) + 1
      return
    }
    counts.featured++
    if (item.featured.demo === 'snap') {
      snapLinks.append(card(item, index, 'compact', bind))
      return
    }
    const big = card(item, index, 'feature', bind)
    const slot = big.querySelector<HTMLElement>('.tb-demo')!
    if (item.featured.demo === 'forge') {
      const walker = sprites.find((s) => s.subject === 'goblin') ?? sprites.find((s) => s.subject === 'slime') ?? sprites[0]
      forge = forgeDemo(slot, walker, bind)
    } else fx = fxDemo(slot, bind)
    featured.append(big)
  })
  const snap = snapDemo(el.querySelector<HTMLElement>('.tb-snap')!, sprites, bind)

  const checked = el.querySelector<HTMLElement>('.tb-checked-date')!
  bind(() => {
    checked.textContent = t('toolbox.checked', { date: LAST_CHECKED })
  })

  // ---- jump bar: where you are, and a way to the other sections ----
  const sections = (['featured', ...CATEGORIES] as const).map((id) => ({
    id,
    el: el.querySelector<HTMLElement>(`.tb-section[data-cat="${id}"]`)!,
    button: jump.querySelector<HTMLButtonElement>(`[data-jump="${id}"]`)!,
  }))
  const room = () => scroller.scrollHeight - scroller.clientHeight
  const atBottom = () => room() - scroller.scrollTop < 4
  sections.forEach((section, i) => {
    section.button.querySelector('b')!.textContent = String(counts[section.id] ?? 0)
    section.button.addEventListener('click', () => {
      // the first section starts under the page header: go all the way up for it
      const top = i === 0 ? 0 : section.el.offsetTop - jump.offsetHeight - 10
      scroller.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' })
      sound.select()
    })
    section.button.addEventListener('pointerenter', () => sound.tick(1500 + i * 160, 0.014))
  })
  let flagged = 0
  const flag = () => {
    flagged = 0
    const line = scroller.scrollTop + jump.offsetHeight + 40
    let current = sections[0]
    for (const section of sections) if (section.el.offsetTop <= line) current = section
    if (atBottom()) current = sections[sections.length - 1]
    sections.forEach((section) => {
      section.button.setAttribute('aria-current', String(section === current))
    })
    // "more below": the dithered fade at the foot of the panel
    el.classList.toggle('tb-more', !atBottom())
    jump.classList.toggle('is-stuck', scroller.scrollTop > jump.offsetTop - 1)
  }
  const flagSoon = () => {
    if (!flagged) flagged = requestAnimationFrame(flag)
  }
  scroller.addEventListener('scroll', flagSoon, { passive: true })
  new ResizeObserver(flagSoon).observe(scroller)

  // every link on the page answers with the same click
  el.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) sound.click()
  })
  el.querySelectorAll('[data-suggest]').forEach((link) => {
    link.addEventListener('pointerenter', () => sound.tick(1800, 0.014))
  })

  // ---- scrolling ----
  /** scroll by `delta`; false when the panel is already at that end */
  let carry = 0
  function scrollBy(delta: number): boolean {
    const before = scroller.scrollTop
    if (delta > 0 ? before >= room() - 1 : before <= 0) {
      carry = 0
      return false
    }
    // a trackpad sends fractions of a pixel, which a scroll position may round away: carry them over
    const want = Math.max(0, Math.min(room(), before + delta + carry))
    scroller.scrollTop = want
    const lost = want - scroller.scrollTop
    carry = Math.abs(lost) < 1 ? lost : 0
    return true
  }

  let active = false
  // Arrow and page keys read the list first; at either end they fall through to the pager's hand-off.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!active || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      const pageful = scroller.clientHeight * 0.85
      const keys: Record<string, number | undefined> = { ArrowDown: 90, ArrowUp: -90, PageDown: pageful, PageUp: -pageful, End: room(), Home: -room() }
      const delta = keys[event.key]
      if (delta === undefined || !scrollBy(delta)) return
      event.preventDefault()
    },
    true,
  )

  // Touch scrolls the panel natively. A drag that starts at an end and pulls further is the pager's.
  let touchY: number | null = null
  let fromTop = false
  let fromBottom = false
  scroller.addEventListener(
    'touchstart',
    (event) => {
      touchY = event.touches.length === 1 ? event.touches[0].clientY : null
      fromTop = scroller.scrollTop <= 0
      fromBottom = atBottom()
    },
    { passive: true },
  )
  scroller.addEventListener(
    'touchmove',
    (event) => {
      if (touchY === null) return
      const y = event.touches[0].clientY
      const delta = (touchY - y) * 2.4
      touchY = y
      if ((delta > 0 && fromBottom && atBottom()) || (delta < 0 && fromTop && scroller.scrollTop <= 0)) page(delta)
    },
    { passive: true },
  )
  const endTouch = () => {
    touchY = null
  }
  scroller.addEventListener('touchend', endTouch)
  scroller.addEventListener('touchcancel', endTouch)

  let spot: HTMLElement | null = null
  let spotTimer = 0

  return {
    // never on its own in the pager: these four describe the sheet for workshop-layers.ts
    id: 'toolbox',
    num: '03',
    title: () => t('nav.toolbox'),
    color: '#1b1626',
    transition: 'iris',
    el,
    consume: scrollBy,
    atEnd: atBottom,
    spotlight(url, smooth = false) {
      const want = bare(url)
      const item = TOOLBOX.find((tool) => bare(tool.url) === want || (tool.repo && bare(`github.com/${tool.repo}`) === want))
      const card = item && el.querySelector<HTMLElement>(`.tb-card[data-id="${item.id}"]`)
      if (!card) return null
      // offsets, not rectangles: the sheet may be mid-swap and scaled down
      let top = 0
      for (let node: HTMLElement | null = card; node && node !== scroller; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
      scroller.scrollTo({ top: Math.max(0, top - jump.offsetHeight - 16), behavior: smooth && !reducedMotion ? 'smooth' : 'auto' })
      clearTimeout(spotTimer)
      spot?.classList.remove('is-spot')
      // reading the width restarts the blink when the same card is asked for twice
      void card.offsetWidth
      card.classList.add('is-spot')
      spot = card
      spotTimer = window.setTimeout(() => card.classList.remove('is-spot'), 2600)
      return card.querySelector<HTMLElement>('.tb-main')
    },
    enter(dir) {
      active = true
      // arriving from the workbench starts at the top; coming back from the outro keeps your place
      if (dir === 1) scroller.scrollTop = 0
      flag()
      forge?.start()
      if (reducedMotion) return
      gsap.fromTo(
        el.querySelectorAll('.tb-head > *, .tb-jump, .tb-featured > *'),
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.3, ease: 'steps(4)', stagger: 0.045, delay: 0.12, overwrite: true, clearProps: 'opacity,transform' },
      )
    },
    leave() {
      active = false
      forge?.stop()
      fx?.stop()
      snap.settle()
      clearTimeout(spotTimer)
      spot?.classList.remove('is-spot')
    },
  }
}
