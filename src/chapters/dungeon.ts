/**
 * 04 · 地牢. The cursor is a torch; clicking plants another one. Light is
 * computed on an 8-px grid and banded with ordered dither, so even the light
 * is made of pixels.
 */
import { sound } from '../audio'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16)
const LIGHT_PX = 8 // one light-map texel = 8 css px, so the light itself is pixelated
const MAX_TORCHES = 4

export function createDungeon(el: HTMLElement, sprites: Sprite[]): Chapter {
  const floor = el.querySelector<HTMLElement>('.dungeon-floor')!
  const dark = el.querySelector<HTMLCanvasElement>('.dungeon-dark')!
  const dctx = dark.getContext('2d')!
  const tip = el.querySelector<HTMLElement>('.dungeon-tip')!
  const countEl = el.querySelector<HTMLElement>('.dungeon-count')!

  floor.style.background = `
    linear-gradient(#08070c 4px, transparent 4px) 0 0 / 96px 96px,
    linear-gradient(90deg, #08070c 4px, transparent 4px) 0 0 / 96px 96px,
    linear-gradient(90deg, #08070c 4px, transparent 4px) 48px 48px / 96px 96px,
    repeating-linear-gradient(45deg, #1a1a24 0 8px, #17161f 8px 16px)`

  const torchSprite = sprites.find((s) => /^torch|sconce/.test(s.subject)) ?? sprites[0]
  const imgs: { img: HTMLImageElement; s: Sprite; light: boolean }[] = []
  const cols = 10
  const rows = 9
  const cells: [number, number][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) / cols
      const cy = (r + 0.5) / rows
      if (!(cx < 0.6 && cy > 0.5)) cells.push([cx, cy])
    }
  const shuffled = [...sprites].sort(() => Math.random() - 0.5).slice(0, cells.length)
  shuffled.forEach((s, k) => {
    const img = document.createElement('img')
    img.className = 'spr'
    img.src = s.url
    img.alt = s.caption
    const [cx, cy] = cells[k]
    img.style.left = `calc(${(cx * 100).toFixed(2)}% + ${Math.round((Math.random() - 0.5) * 60)}px - 40px)`
    img.style.top = `calc(${(cy * 100).toFixed(2)}% + ${Math.round((Math.random() - 0.5) * 40)}px - 40px)`
    floor.append(img)
    imgs.push({ img, s, light: /torch|candle|lantern/.test(s.subject) })
    img.addEventListener('pointerenter', () => {
      tip.textContent = s.caption
      tip.style.opacity = '1'
      sound.tick(1400 + Math.random() * 400, 0.012)
    })
    img.addEventListener('pointerleave', () => (tip.style.opacity = '0'))
  })

  const planted: { x: number; y: number; img: HTMLImageElement; born: number }[] = []
  let mx = window.innerWidth * 0.6
  let my = window.innerHeight * 0.45
  let lx = mx
  let ly = my
  let lastMove = 0
  let raf = 0
  let active = false
  let img: ImageData | null = null

  function updateCount() {
    countEl.textContent = `火把 ${planted.length}/${MAX_TORCHES} · 点击地面插一支`
    sound.set('fire', planted.length / MAX_TORCHES)
  }

  el.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
    lastMove = performance.now()
    tip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 260)}px`
    tip.style.top = `${e.clientY + 18}px`
  })
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (planted.length >= MAX_TORCHES) {
      const old = planted.shift()!
      old.img.remove()
    }
    const t = document.createElement('img')
    t.className = 'spr planted'
    t.src = torchSprite.url
    t.alt = ''
    t.style.left = `${x - 32}px`
    t.style.top = `${y - 56}px`
    el.querySelector('.dungeon-planted')!.append(t)
    planted.push({ x, y: y - 24, img: t, born: performance.now() })
    sound.ignite()
    updateCount()
  })

  function frame(t: number) {
    const w = Math.ceil(el.clientWidth / LIGHT_PX)
    const h = Math.ceil(el.clientHeight / LIGHT_PX)
    if (dark.width !== w || dark.height !== h) {
      dark.width = w
      dark.height = h
      img = dctx.createImageData(w, h)
    }
    if (!img) return
    let tx = mx
    let ty = my
    if (t - lastMove > 2500) {
      const k = (t - lastMove - 2500) / 1000
      tx = el.clientWidth * (0.6 + 0.22 * Math.sin(k * 0.6))
      ty = el.clientHeight * (0.42 + 0.2 * Math.sin(k * 0.9 + 1))
    }
    // the hand-held torch lags a little behind the cursor
    lx += (tx - lx) * 0.25
    ly += (ty - ly) * 0.25
    const flick = (seed: number) => (reducedMotion ? 1 : 0.9 + 0.06 * Math.sin(t / 70 + seed) + 0.04 * Math.sin(t / 23 + seed * 3))
    const lights: [number, number, number][] = [[lx / LIGHT_PX, ly / LIGHT_PX, 28 * flick(0)]]
    for (const it of imgs) {
      if (!it.light) continue
      const r = it.img.getBoundingClientRect()
      lights.push([(r.left + r.width / 2) / LIGHT_PX, (r.top + r.height / 2) / LIGHT_PX, 11 * flick(r.left)])
    }
    for (const p of planted) {
      const grow = Math.min(1, (t - p.born) / 400)
      lights.push([p.x / LIGHT_PX, p.y / LIGHT_PX, 18 * grow * flick(p.x)])
    }
    const d = img.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let l = 0
        for (const [px, py, r] of lights) {
          const dx = x - px
          const dy = (y - py) * 1.1
          const v = 1 - Math.sqrt(dx * dx + dy * dy) / r
          if (v > l) l = v
        }
        const band = Math.min(1, Math.floor(Math.max(0, l) * 5 + BAYER4[(y % 4) * 4 + (x % 4)]) / 4)
        const darkness = 1 - band
        const o = (y * w + x) * 4
        const warm = band > 0 && band < 1
        d[o] = warm ? 70 : 5
        d[o + 1] = warm ? 34 : 4
        d[o + 2] = warm ? 8 : 12
        d[o + 3] = Math.round(255 * (darkness * 0.96 + (warm ? 0.12 : 0)))
      }
    }
    dctx.putImageData(img, 0, 0)
    if (active) raf = requestAnimationFrame(frame)
  }

  updateCount()
  return {
    id: 'dungeon',
    num: '04',
    title: '地牢',
    color: '#0b0a10',
    transition: 'slash',
    ambience: 'dungeon',
    el,
    enter() {
      active = true
      updateCount()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      tip.style.opacity = '0'
    },
  }
}
