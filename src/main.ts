import './style.css'
import { sound } from './audio'
import { createCrt } from './chapters/crt'
import { createCthulhu } from './chapters/cthulhu'
import { createDepth } from './chapters/depth'
import { createDungeon } from './chapters/dungeon'
import { createHero } from './chapters/hero'
import { createNeon } from './chapters/neon'
import { createOcean } from './chapters/ocean'
import { createOutro } from './chapters/outro'
import { createWorkshop } from './chapters/workshop'
import { loadStrip, type Sprite } from './sprites'
import { runTransition } from './transitions'
import type { Chapter } from './types'
import { reducedMotion } from './types'

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!
const section = (id: string) => $<HTMLElement>(`.chapter[data-id="${id}"]`)

async function boot() {
  const names = ['depth', 'crt', 'workshop', 'dungeon', 'ocean', 'neon', 'cthulhu'] as const
  const strips = Object.fromEntries(
    await Promise.all(names.map(async (n) => [n, await loadStrip(n)] as const)),
  ) as Record<(typeof names)[number], Sprite[]>

  let goTo: (i: number) => Promise<void> = async () => {}
  const workshop = createWorkshop(section('workshop'), strips.workshop)
  const hero = await createHero(section('hero'), {
    toWorkshop(sprite, info) {
      workshop.load(sprite, info.caption)
      goTo(chapters.indexOf(workshop))
    },
    next: () => goTo(1),
  })
  const chapters: Chapter[] = [
    hero,
    createDepth(section('depth'), strips.depth),
    createCrt(section('crt'), strips.crt),
    workshop,
    createDungeon(section('dungeon'), strips.dungeon),
    createOcean(section('ocean'), strips.ocean),
    createNeon(section('neon'), strips.neon),
    createCthulhu(section('cthulhu'), strips.cthulhu),
    createOutro(section('outro'), Object.values(strips).flat(), () => {
      goTo(0).then(() => hero.focusSearch?.())
    }),
  ]

  const hudNum = $('.hud-num')
  const hudTitle = $('.hud-title')
  const pips = $('.pips')
  const map = $<HTMLElement>('.map')
  const mapList = $('.map-list')
  const sndBtn = $<HTMLButtonElement>('.snd-btn')

  let index = 0
  let busy = false
  let cooldownUntil = 0
  let edgeAcc = 0
  let consuming = false

  // ---- sound toggle ----------------------------------------------------------------
  function updateSound() {
    const label = !sound.unlocked ? '点我开声音' : sound.muted ? '声音 关' : '声音 开'
    sndBtn.querySelector('span')!.textContent = label
    sndBtn.classList.toggle('is-locked', !sound.unlocked && !sound.muted)
    sndBtn.classList.toggle('is-off', sound.muted)
    sndBtn.setAttribute('aria-pressed', String(!sound.muted && sound.unlocked))
  }
  sndBtn.addEventListener('click', () => {
    // the same click may have just unlocked audio (capture listener) — then it means "on"
    if (!sound.unlocked || performance.now() - sound.unlockedAt < 1500) {
      sound.setMuted(false)
      sound.unlock()
    } else sound.setMuted(!sound.muted)
    setTimeout(() => sound.click(), 30)
    updateSound()
  })
  sound.onChange(() => {
    updateSound()
    sound.ambience(chapters[index].ambience ?? null)
  })
  updateSound()

  // ---- nav chrome ----------------------------------------------------------------------
  const pipButtons = chapters.map((c, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.title = `${c.num} ${c.title}`
    b.setAttribute('aria-label', `${c.num} ${c.title}`)
    b.addEventListener('click', () => goTo(i))
    b.addEventListener('pointerenter', () => sound.tick(1600 + i * 120, 0.012))
    pips.append(b)
    return b
  })

  const pick = (list: Sprite[], re: RegExp) => (list.find((s) => re.test(s.subject)) ?? list[0]).url
  const thumbs: Record<string, string> = {
    hero: '/atlas/overview.png',
    depth: pick(strips.depth, /potion/),
    crt: pick(strips.crt, /slime/),
    workshop: pick(strips.workshop, /apple|orb/),
    dungeon: pick(strips.dungeon, /torch/),
    ocean: pick(strips.ocean, /angler|jelly/),
    neon: pick(strips.neon, /arcade|cassette/),
    cthulhu: pick(strips.cthulhu, /tentacled eye|eye/),
    outro: pick(strips.depth, /chest/),
  }
  const mapButtons = chapters.map((c, i) => {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.type = 'button'
    b.style.background = c.color
    if (['#f4ecd8', '#ff2bd6'].includes(c.color)) b.style.color = '#15121c'
    b.innerHTML = `<span class="n">${c.num}</span><img src="${thumbs[c.id]}" alt="" class="${c.id === 'hero' ? 'round' : ''}" /><span class="t">${c.title}</span>`
    b.addEventListener('click', () => {
      toggleMap(false)
      goTo(i)
    })
    b.addEventListener('pointerenter', () => sound.tick(1500 + i * 110, 0.015))
    li.append(b)
    mapList.append(li)
    return b
  })

  function updateHud() {
    const c = chapters[index]
    hudNum.textContent = c.num
    hudTitle.textContent = c.title
    pipButtons.forEach((b, i) => b.setAttribute('aria-current', String(i === index)))
    mapButtons.forEach((b, i) => b.setAttribute('aria-current', String(i === index)))
    document.body.dataset.chapter = c.id
    if (location.hash.slice(1) !== c.id) history.replaceState(null, '', `#${c.id}`)
  }

  function activate(i: number, dir: 1 | -1) {
    chapters[index].leave?.()
    chapters[index].el.classList.remove('is-active')
    index = i
    chapters[index].el.classList.add('is-active')
    chapters[index].enter?.(dir)
    sound.ambience(chapters[index].ambience ?? null)
    updateHud()
  }

  goTo = async (i: number) => {
    if (busy || i === index || i < 0 || i >= chapters.length) return
    busy = true
    const dir: 1 | -1 = i > index ? 1 : -1
    const target = chapters[i]
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    await runTransition(reducedMotion ? 'fade' : target.transition, {
      color: target.color,
      dir,
      oldEl: chapters[index].el,
      newEl: () => target.el,
      swap: () => activate(i, dir),
    })
    busy = false
    edgeAcc = 0
    cooldownUntil = performance.now() + 650
  }

  /** Route scroll-like input: the chapter first, then page navigation. */
  function input(delta: number) {
    if (busy || !map.hidden) return
    const c = chapters[index]
    if (c.consume?.(delta)) {
      edgeAcc = 0
      consuming = true
      return
    }
    // the chapter just hit its end: hold briefly so scroll momentum
    // doesn't skip the final frame of that chapter
    if (consuming) {
      consuming = false
      cooldownUntil = performance.now() + 700
    }
    if (performance.now() < cooldownUntil) return
    edgeAcc += delta
    if (Math.abs(edgeAcc) > 90) {
      const next = index + Math.sign(edgeAcc)
      edgeAcc = 0
      goTo(next)
    }
  }

  window.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY
      input(Math.max(-220, Math.min(220, d)))
    },
    { passive: false },
  )

  // touches on elements that handle their own gestures (the planet, tool canvases) don't page
  let touchY: number | null = null
  window.addEventListener(
    'touchstart',
    (e) => {
      const own = (e.target as HTMLElement).closest?.('[data-own-touch], input, button, a, label')
      touchY = own ? null : e.touches[0].clientY
    },
    { passive: true },
  )
  window.addEventListener(
    'touchmove',
    (e) => {
      if (touchY === null) return
      const y = e.touches[0].clientY
      input((touchY - y) * 2.4)
      touchY = y
    },
    { passive: true },
  )
  window.addEventListener('touchend', () => (touchY = null))

  /** Keys step through a chapter's internal progress in chunks, then pages. */
  function keyStep(dir: 1 | -1) {
    const c = chapters[index]
    if (c.consume) {
      let n = 0
      const id = setInterval(() => {
        if (!c.consume?.(dir * 120) || ++n >= 4) {
          clearInterval(id)
          if (n === 0) goTo(index + dir)
        }
      }, 40)
    } else goTo(index + dir)
  }

  function toggleMap(show = map.hidden) {
    map.hidden = !show
    sound.tone(show ? 660 : 440, 0.08, { type: 'square', vol: 0.04, slide: show ? 990 : 330 })
    if (show) mapButtons[index].focus()
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && t.type !== 'checkbox' && t.type !== 'range') {
      if (e.key === 'Escape') t.blur()
      return
    }
    if (e.key === 'm' || e.key === 'M') return toggleMap()
    if (e.key === 'Escape') return toggleMap(false)
    if (!map.hidden) return
    if (e.key === '/') {
      e.preventDefault()
      if (index === 0) hero.focusSearch?.()
      else goTo(0).then(() => hero.focusSearch?.())
      return
    }
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault()
      keyStep(1)
    } else if (['ArrowUp', 'PageUp'].includes(e.key)) {
      e.preventDefault()
      keyStep(-1)
    } else if (e.key === 'Home') goTo(0)
    else if (e.key === 'End') goTo(chapters.length - 1)
  })

  $('.map-btn').addEventListener('click', () => toggleMap())
  map.addEventListener('click', (e) => e.target === map && toggleMap(false))
  $('.logo').addEventListener('click', (e) => {
    e.preventDefault()
    goTo(0)
  })

  const start = Math.max(0, chapters.findIndex((c) => c.id === location.hash.slice(1)))
  index = start
  chapters.forEach((c, i) => i !== start && c.leave?.())
  chapters[start].el.classList.add('is-active')
  chapters[start].enter?.(1)
  sound.ambience(chapters[start].ambience ?? null)
  updateHud()
  document.body.classList.add('is-ready')
}

boot().catch((err) => {
  console.error(err)
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;bottom:16px;left:16px;color:#f66;z-index:99">加载失败：${err.message}</p>`)
})
