import { sound } from '../audio'
import { GameShell } from '../game'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Sprite } from '../sprites'
import { createStalk } from './cthulhu-game'

// only glyphs the pixel font actually has, so nothing falls back to tofu
const GLYPHS = '▓▒░▚▞◢◣◤◥◆◇◎※¤§¶†‡☉☽☾♁♅♆ΔΘΞΨΩλψωж巛彡屮◬'

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
    sound.set('madness', m)
    hint.textContent = san <= 0 ? '你已看见太多。往回滚，或者离开这里。' : '继续向下……如果你确定的话'
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
    if (g.on) gameFrame(t)
    if (active) raf = requestAnimationFrame(frame)
  }

  // ---- mini game: 别被看见 — walk only while the eye sleeps ---------------------------------
  const play = el.querySelector<HTMLElement>('.cth-play')!
  const say = el.querySelector<HTMLElement>('.cth-say')!
  const g = { on: false }
  const stalk = createStalk(el.querySelector<HTMLCanvasElement>('.cth-game')!, sprites, {
    score: (n) => shell.score(n),
    extra: (h) => shell.extra(h),
    end: (score, title, sub) => shell.end(score, title, sub, false),
    san(v) {
      if (v !== undefined) {
        san = Math.max(0, Math.min(100, v))
        apply()
      }
      return san
    },
    say(t) {
      say.textContent = t
      say.dataset.tone = t.includes('别动') ? 'stop' : t.includes('眼皮') ? 'warn' : 'go'
    },
  })
  const gameFrame = (t: number) => stalk.frame(t)

  const shell = new GameShell(el, 'cthulhu-stalk', '别被看见', {
    start() {
      play.hidden = false
      g.on = true
      stalk.start()
    },
    stop() {
      g.on = false
      stalk.stop()
      play.hidden = true
      san = 100
      apply()
    },
  })

  apply()

  return {
    id: 'cthulhu',
    num: '05',
    title: '克苏鲁',
    color: '#0d1410',
    transition: 'melt',
    ambience: 'cthulhu',
    el,
    playing: () => shell.playing,
    atEnd: () => san <= 0,
    consume(delta) {
      if (delta > 0 && san <= 0) return false
      if (delta < 0 && san >= 100) return false
      const before = Math.ceil(san / 10)
      san = Math.max(0, Math.min(100, san - delta / 16))
      apply()
      const after = Math.ceil(san / 10)
      if (after < before) sound.tone(110 + after * 22, 0.25, { type: 'sawtooth', vol: 0.03, slide: 90 + after * 15 })
      if (san <= 0 && before > 0) sound.noise(1.4, { f0: 300, f1: 2400, q: 6, vol: 0.06, attack: 0.6 })
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
      shell.quit()
    },
  }
}
