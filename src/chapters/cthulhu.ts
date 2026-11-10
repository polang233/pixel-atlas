import gsap from 'gsap'
import { sound } from '../audio'
import { GameShell } from '../game'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Sprite } from '../sprites'

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

  // ---- mini game: 禁忌图鉴 — a memory game that fights back as sanity drops -----------------
  const play = el.querySelector<HTMLElement>('.cth-play')!
  const board = el.querySelector<HTMLElement>('.cth-board')!
  const peekBtn = el.querySelector<HTMLButtonElement>('.cth-peek')!
  interface Card { el: HTMLButtonElement; img: HTMLImageElement; pair: number; spr: Sprite; up: boolean; done: boolean }
  const g = {
    on: false,
    cards: [] as Card[],
    first: null as Card | null,
    lock: true,
    found: 0,
    pairs: 0,
    streak: 0,
    score: 0,
    moves: 0,
    last: 0,
    nextSwap: 0,
    nextLie: 0,
    over: false,
    timers: [] as number[],
  }
  const later = (ms: number, fn: () => void) => g.timers.push(window.setTimeout(fn, ms))
  const flip = (c: Card, up: boolean) => {
    c.up = up
    c.el.classList.toggle('is-up', up)
  }

  function deal() {
    const cols = el.clientWidth < 700 ? 4 : 6
    const n = cols === 4 ? 8 : 12
    const bySubject = new Map<string, Sprite[]>()
    for (const s of sprites) bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s])
    const picks = [...bySubject.values()].sort(() => Math.random() - 0.5).slice(0, n).map((list) => list[(Math.random() * list.length) | 0])
    board.style.setProperty('--cols', String(cols))
    board.replaceChildren()
    g.cards = [...picks, ...picks]
      .map((spr, i) => ({ spr, pair: i % picks.length }))
      .sort(() => Math.random() - 0.5)
      .map(({ spr, pair }, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'cth-card'
        b.style.setProperty('--i', String(i))
        b.setAttribute('aria-label', '一张盖着的牌')
        b.innerHTML = `<span class="face back"><i></i></span><span class="face front"><img alt="" src="${spr.url}"></span>`
        const card: Card = { el: b, img: b.querySelector('img')!, pair, spr, up: false, done: false }
        b.addEventListener('click', () => pick(card))
        b.addEventListener('pointerenter', () => !card.up && sound.tick(700 + Math.random() * 200, 0.01))
        board.append(b)
        return card
      })
    g.pairs = picks.length
  }

  function pick(c: Card) {
    if (!g.on || g.lock || g.over || c.up || c.done) return
    c.img.src = c.spr.url
    flip(c, true)
    sound.flip()
    if (!g.first) {
      g.first = c
      return
    }
    const a = g.first
    g.first = null
    g.moves++
    if (a.pair === c.pair) {
      a.done = c.done = true
      later(180, () => {
        a.el.classList.add('is-done')
        c.el.classList.add('is-done')
      })
      g.found++
      g.streak++
      g.score += 100 * g.streak
      san = Math.min(100, san + 6)
      sound.banish()
      if (g.streak > 1) sound.tone(440 + g.streak * 110, 0.12, { type: 'triangle', vol: 0.04, at: 0.1 })
      if (g.found === g.pairs) {
        g.over = true
        g.score += Math.round(san) * 30
        shell.score(g.score)
        later(500, () => shell.end(g.score, '图鉴合上了', `${g.moves} 次翻牌认全了 ${g.pairs} 种不可名状之物 · 剩余理智 ${Math.round(san)}`, true))
      }
    } else {
      g.lock = true
      g.streak = 0
      san = Math.max(0, san - 9)
      sound.nothing()
      board.classList.add('is-wrong')
      later(720, () => {
        board.classList.remove('is-wrong')
        if (g.over) return
        flip(a, false)
        flip(c, false)
        g.lock = false
      })
    }
  }

  /** two face-down cards trade places — you can follow it, if you are watching */
  function swap() {
    const pool = g.cards.filter((c) => !c.up && !c.done)
    if (pool.length < 2 || g.lock) return
    const a = pool[(Math.random() * pool.length) | 0]
    let b = a
    while (b === a) b = pool[(Math.random() * pool.length) | 0]
    const ra = a.el.getBoundingClientRect()
    const rb = b.el.getBoundingClientRect()
    const mark = document.createComment('')
    a.el.replaceWith(mark)
    b.el.replaceWith(a.el)
    mark.replaceWith(b.el)
    for (const [c, from, to] of [[a, ra, rb], [b, rb, ra]] as const) {
      c.el.classList.add('is-moving')
      gsap.fromTo(c.el, { x: from.left - to.left, y: from.top - to.top }, {
        x: 0, y: 0, duration: reducedMotion ? 0 : 0.55, ease: 'power2.inOut', overwrite: true,
        onComplete: () => {
          c.el.classList.remove('is-moving')
          gsap.set(c.el, { clearProps: 'transform' })
        },
      })
    }
    sound.whisper()
  }

  /** a card shows you something that is not what it holds */
  function lie() {
    const pool = g.cards.filter((c) => !c.up && !c.done)
    if (!pool.length || g.lock || g.first) return
    const c = pool[(Math.random() * pool.length) | 0]
    const other = g.cards.filter((o) => o.pair !== c.pair)
    c.img.src = other[(Math.random() * other.length) | 0].spr.url
    c.el.classList.add('is-up', 'is-lie')
    sound.eyeOpen()
    later(420, () => {
      c.el.classList.remove('is-lie')
      if (c.up) c.img.src = c.spr.url
      else {
        c.el.classList.remove('is-up')
        later(260, () => (c.img.src = c.spr.url))
      }
    })
  }

  function peek() {
    if (!g.on || g.lock || g.over || san <= 12) return
    g.lock = true
    san -= 12
    const down = g.cards.filter((c) => !c.up && !c.done)
    down.forEach((c) => c.el.classList.add('is-up'))
    sound.sonar()
    later(1100, () => {
      down.forEach((c) => !c.up && c.el.classList.remove('is-up'))
      g.lock = false
    })
  }
  peekBtn.addEventListener('click', peek)
  window.addEventListener('keydown', (e) => {
    if (!g.on || e.key !== ' ' || e.repeat) return
    e.preventDefault()
    peek()
  })

  function gameFrame(now: number) {
    const dt = Math.min(0.05, (now - g.last) / 1000)
    g.last = now
    if (g.over) return
    const m = 1 - san / 100
    if (!g.lock || g.first) san = Math.max(0, san - dt * 0.55)
    apply()
    board.style.setProperty('--mad', m.toFixed(3))
    play.dataset.stage = m > 0.7 ? '3' : m > 0.5 ? '2' : m > 0.3 ? '1' : '0'
    peekBtn.disabled = san <= 12
    if (m > 0.3 && now > g.nextSwap) {
      g.nextSwap = now + 9000 - m * 5000
      swap()
    }
    if (m > 0.6 && now > g.nextLie) {
      g.nextLie = now + 5200 + Math.random() * 3000
      lie()
    }
    shell.score(g.score)
    shell.extra(`<span class="san-chip">SAN ${Math.round(san)}</span> · 配对 ${g.found}/${g.pairs}${g.streak > 1 ? ` · 连对 ×${g.streak}` : ''}`)
    if (san <= 0) {
      g.over = true
      g.cards.forEach((c) => c.el.classList.add('is-up'))
      sound.noise(1.4, { f0: 300, f1: 2400, q: 6, vol: 0.06, attack: 0.6 })
      later(600, () => shell.end(g.score, '理智归零', `认出了 ${g.found} / ${g.pairs} 种 · 剩下的，已经认识你了。`, false))
    }
  }

  const shell = new GameShell(el, 'cthulhu-memory', '禁忌图鉴', {
    start() {
      g.timers.forEach(clearTimeout)
      san = 100
      apply()
      deal()
      const now = performance.now()
      Object.assign(g, { on: true, first: null, lock: true, found: 0, streak: 0, score: 0, moves: 0, last: now, nextSwap: now + 12000, nextLie: now + 9000, over: false, timers: [] })
      play.hidden = false
      play.dataset.stage = '0'
      // a short look at everything, then the book closes
      later(350, () => g.cards.forEach((c, i) => later(i * 28, () => c.el.classList.add('is-up'))))
      later(3300, () => {
        g.cards.forEach((c) => c.el.classList.remove('is-up'))
        g.lock = false
        g.last = performance.now()
      })
    },
    stop() {
      g.on = false
      g.timers.forEach(clearTimeout)
      play.hidden = true
      board.replaceChildren()
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
