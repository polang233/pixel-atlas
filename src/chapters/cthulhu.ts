import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Sprite } from '../sprites'

const GLYPHS = '᚛᚜ᛟᛞᛝᛜ⸸⸎⸙꙰꙱҈҉ⵙⵘⵚ◬⟁⧖⨀⩎'

export function createCthulhu(el: HTMLElement, sprites: Sprite[]): Chapter {
  const field = el.querySelector<HTMLElement>('.cth-field')!
  const disp = el.querySelector<SVGFEDisplacementMapElement>('feDisplacementMap')!
  const turb = el.querySelector<SVGFETurbulenceElement>('feTurbulence')!
  const h2 = el.querySelector<HTMLElement>('h2')!
  const text = el.querySelector<HTMLElement>('.cth-text')!
  const bar = el.querySelector<HTMLElement>('.san-bar i')!
  const num = el.querySelector<HTMLElement>('.san-num')!
  const hint = el.querySelector<HTMLElement>('.cth-hint')!
  const src = text.dataset.src ?? ''
  text.textContent = src

  const imgs = [...sprites, ...sprites].slice(0, 81).map((s) => {
    const img = document.createElement('img')
    img.src = s.url
    img.alt = s.caption
    img.title = s.caption
    field.append(img)
    return img
  })

  let san = 100
  let raf = 0
  let active = false
  let lastGlitch = 0

  function apply() {
    const m = 1 - san / 100
    bar.style.transform = `scaleX(${san / 100})`
    num.textContent = String(Math.round(san))
    field.style.setProperty('--sat', String(0.75 - m * 0.55))
    field.style.filter = `url(#madness) saturate(${0.75 - m * 0.55}) hue-rotate(${m * -40}deg) contrast(${1 + m * 0.3})`
    disp.setAttribute('scale', String(m * m * 46))
    hint.textContent = san <= 0 ? '你已看见太多。继续向下，离开这里。' : '继续向下……如果你确定的话'
  }

  function frame(t: number) {
    const m = 1 - san / 100
    if (!reducedMotion) {
      turb.setAttribute('baseFrequency', `${0.01 + 0.004 * Math.sin(t / 900)} ${0.028 + 0.01 * Math.cos(t / 700)}`)
      if (t - lastGlitch > 110) {
        lastGlitch = t
        const flick = Math.random() > 0.75 ? 1 : 0.25
        h2.style.setProperty('--glitch', String(Math.min(1, m * 1.4) * flick))
        // corrupt the paragraph a little more as sanity drops
        const p = m * 0.32
        text.textContent = [...src].map((c) => (c.trim() && Math.random() < p ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c)).join('')
        el.style.transform = m > 0.55 && Math.random() > 0.6 ? `translate(${(Math.random() - 0.5) * m * 10}px, ${(Math.random() - 0.5) * m * 6}px)` : ''
        // a few sprites twitch
        const k = (Math.random() * imgs.length) | 0
        imgs[k].style.transform = m > 0.2 ? `scale(${1 + Math.random() * m * 0.5}) rotate(${(Math.random() - 0.5) * m * 30}deg)` : ''
      }
    } else {
      h2.style.setProperty('--glitch', String(m * 0.6))
    }
    if (active) raf = requestAnimationFrame(frame)
  }

  apply()

  return {
    id: 'cthulhu',
    num: '03',
    title: '克苏鲁',
    color: '#050607',
    transition: 'crt',
    el,
    consume(delta) {
      if (delta > 0 && san <= 0) return false
      if (delta < 0 && san >= 100) return false
      san = Math.max(0, Math.min(100, san - delta / 16))
      apply()
      return true
    },
    enter(dir) {
      san = dir === 1 ? 100 : 0
      apply()
      active = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      el.style.transform = ''
    },
  }
}
