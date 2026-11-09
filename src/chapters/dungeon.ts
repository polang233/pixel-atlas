import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Sprite } from '../sprites'

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16)
const LIGHT_PX = 8 // one light-map texel = 8 css px, so the light itself is pixelated

export function createDungeon(el: HTMLElement, sprites: Sprite[]): Chapter {
  const floor = el.querySelector<HTMLElement>('.dungeon-floor')!
  const dark = el.querySelector<HTMLCanvasElement>('.dungeon-dark')!
  const dctx = dark.getContext('2d')!
  const tip = el.querySelector<HTMLElement>('.dungeon-tip')!

  floor.style.background = `
    linear-gradient(#08070c 4px, transparent 4px) 0 0 / 96px 96px,
    linear-gradient(90deg, #08070c 4px, transparent 4px) 0 0 / 96px 96px,
    linear-gradient(90deg, #08070c 4px, transparent 4px) 48px 48px / 96px 96px,
    repeating-linear-gradient(45deg, #1a1a24 0 8px, #17161f 8px 16px)`

  // scatter sprites over a jittered grid
  const imgs: { img: HTMLImageElement; s: Sprite; light: boolean }[] = []
  const cols = 10
  const rows = 9
  // grid cells, minus the bottom-left corner where the copy sits
  const cells: [number, number][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) / cols, cy = (r + 0.5) / rows
      if (!(cx < 0.6 && cy > 0.55)) cells.push([cx, cy])
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
    })
    img.addEventListener('pointerleave', () => (tip.style.opacity = '0'))
  })

  let mx = window.innerWidth * 0.6
  let my = window.innerHeight * 0.45
  let lastMove = 0
  let raf = 0
  let active = false
  let img: ImageData | null = null

  el.addEventListener('pointermove', (e) => {
    mx = e.clientX
    my = e.clientY
    lastMove = performance.now()
    tip.style.left = `${e.clientX + 16}px`
    tip.style.top = `${e.clientY + 18}px`
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
    // idle: the light wanders on its own
    let lx = mx, ly = my
    if (t - lastMove > 2500) {
      const k = (t - lastMove - 2500) / 1000
      lx = el.clientWidth * (0.55 + 0.25 * Math.sin(k * 0.6))
      ly = el.clientHeight * (0.45 + 0.2 * Math.sin(k * 0.9 + 1))
    }
    const flick = reducedMotion ? 1 : 0.92 + 0.05 * Math.sin(t / 70) + 0.03 * Math.sin(t / 23)
    const lights: [number, number, number][] = [[lx / LIGHT_PX, ly / LIGHT_PX, 30 * flick]]
    for (const it of imgs) {
      if (!it.light) continue
      const r = it.img.getBoundingClientRect()
      lights.push([(r.left + r.width / 2) / LIGHT_PX, (r.top + r.height / 2) / LIGHT_PX, 11 * flick])
    }
    const d = img.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let l = 0
        for (const [px, py, r] of lights) {
          const dx = x - px, dy = (y - py) * 1.1
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

  return {
    id: 'dungeon',
    num: '02',
    title: '地牢',
    color: '#0b0a10',
    transition: 'slash',
    el,
    enter() {
      active = true
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
