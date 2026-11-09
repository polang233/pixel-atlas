import gsap from 'gsap'
import type { TransitionKind } from './types'

const fx = document.querySelector<HTMLCanvasElement>('#fx')!
const fxCtx = fx.getContext('2d')!
const slash = document.querySelector<HTMLElement>('.slash')!
const slashBar = slash.querySelector<HTMLElement>('i')!
const stage = document.querySelector<HTMLElement>('#stage')!

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => v / 64)

function tween(duration: number, onUpdate: (t: number) => void, ease = 'none'): Promise<void> {
  const o = { t: 0 }
  return new Promise((resolve) => {
    gsap.to(o, { t: 1, duration, ease, onUpdate: () => onUpdate(o.t), onComplete: resolve })
  })
}

/** Ordered-dither dissolve: blocks fill in Bayer order, biased into a diagonal sweep. */
async function dither(color: string, swap: () => void, dir: 1 | -1) {
  const block = window.innerWidth < 700 ? 18 : 28
  const cols = Math.ceil(window.innerWidth / block)
  const rows = Math.ceil(window.innerHeight / block)
  fx.width = cols
  fx.height = rows
  const thr = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const diag = (x / cols + y / rows) / 2
      const d = dir === 1 ? diag : 1 - diag
      thr[y * cols + x] = BAYER8[(y % 8) * 8 + (x % 8)] * 0.45 + d * 0.55
    }
  }
  const draw = (cover: (v: number) => boolean) => {
    fxCtx.clearRect(0, 0, cols, rows)
    fxCtx.fillStyle = color
    for (let i = 0; i < thr.length; i++) if (cover(thr[i])) fxCtx.fillRect(i % cols, (i / cols) | 0, 1, 1)
  }
  await tween(0.42, (t) => draw((v) => v < t * 1.02), 'steps(14)')
  swap()
  await tween(0.42, (t) => draw((v) => v > t * 1.02), 'steps(14)')
  fxCtx.clearRect(0, 0, cols, rows)
}

/** Diagonal slash: a skewed bar with a bright edge cuts across the screen. */
async function slashCut(color: string, swap: () => void, dir: 1 | -1) {
  slash.style.setProperty('--slash-color', color)
  slash.style.visibility = 'visible'
  const from = dir === 1 ? -100 : 100
  gsap.set(slashBar, { xPercent: from, rotate: -22 })
  gsap.fromTo(stage, { x: 0 }, { x: dir * -14, duration: 0.06, yoyo: true, repeat: 3, ease: 'steps(1)' })
  await new Promise<void>((r) => gsap.to(slashBar, { xPercent: 0, duration: 0.34, ease: 'power3.in', onComplete: r }))
  swap()
  await new Promise<void>((r) => gsap.to(slashBar, { xPercent: -from, duration: 0.4, ease: 'power3.out', onComplete: r }))
  gsap.set(stage, { x: 0 })
  slash.style.visibility = 'hidden'
}

/** CRT power-off of the old chapter, power-on of the new one. */
async function crt(oldEl: HTMLElement, newEl: () => HTMLElement, swap: () => void) {
  stage.style.background = '#000'
  await new Promise<void>((r) =>
    gsap
      .timeline({ onComplete: r })
      .to(oldEl, { scaleY: 0.006, filter: 'brightness(4)', duration: 0.2, ease: 'power2.in' })
      .to(oldEl, { scaleX: 0, duration: 0.14, ease: 'power2.in' }),
  )
  gsap.set(oldEl, { clearProps: 'transform,filter' })
  swap()
  const el = newEl()
  await new Promise<void>((r) =>
    gsap
      .timeline({ onComplete: r })
      .fromTo(el, { scaleX: 0, scaleY: 0.006, filter: 'brightness(4)' }, { scaleX: 1, duration: 0.16, ease: 'power2.out' })
      .to(el, { scaleY: 1, filter: 'brightness(1)', duration: 0.26, ease: 'power3.out' }),
  )
  gsap.set(el, { clearProps: 'transform,filter' })
  stage.style.background = ''
}

async function fade(swap: () => void) {
  await new Promise<void>((r) => gsap.to(stage, { opacity: 0, duration: 0.18, onComplete: r }))
  swap()
  await new Promise<void>((r) => gsap.to(stage, { opacity: 1, duration: 0.22, onComplete: r }))
}

export function runTransition(
  kind: TransitionKind,
  opts: { color: string; dir: 1 | -1; oldEl: HTMLElement; newEl: () => HTMLElement; swap: () => void },
): Promise<void> {
  switch (kind) {
    case 'dither':
      return dither(opts.color, opts.swap, opts.dir)
    case 'slash':
      return slashCut(opts.color, opts.swap, opts.dir)
    case 'crt':
      return crt(opts.oldEl, opts.newEl, opts.swap)
    default:
      return fade(opts.swap)
  }
}
