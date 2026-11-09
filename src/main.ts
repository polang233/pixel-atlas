import './style.css'
import type { Chapter } from './types'
import { reducedMotion } from './types'
import { loadStrip } from './sprites'
import { runTransition } from './transitions'
import { createHero } from './chapters/hero'
import { createDepth } from './chapters/depth'
import { createDungeon } from './chapters/dungeon'
import { createCthulhu } from './chapters/cthulhu'
import { createOutro } from './chapters/outro'

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!
const section = (id: string) => $<HTMLElement>(`.chapter[data-id="${id}"]`)

async function boot() {
  const [depthS, dungeonS, cthS] = await Promise.all([loadStrip('depth'), loadStrip('dungeon'), loadStrip('cthulhu')])
  const chapters: Chapter[] = [
    await createHero(section('hero')),
    createDepth(section('depth'), depthS),
    createDungeon(section('dungeon'), dungeonS),
    createCthulhu(section('cthulhu'), cthS),
    createOutro(section('outro'), [...depthS, ...dungeonS, ...cthS]),
  ]

  const hudNum = $('.hud-num')
  const hudTitle = $('.hud-title')
  const pips = $('.pips')
  const map = $<HTMLElement>('.map')
  const mapList = $('.map-list')

  let index = 0
  let busy = false
  let cooldownUntil = 0
  let edgeAcc = 0
  let consuming = false

  const pipButtons = chapters.map((c, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.title = `${c.num} ${c.title}`
    b.setAttribute('aria-label', `${c.num} ${c.title}`)
    b.addEventListener('click', () => goTo(i))
    pips.append(b)
    return b
  })

  const pickThumb = (list: typeof depthS, re: RegExp) => (list.find((s) => re.test(s.subject)) ?? list[0]).url
  const thumbs = [
    pickThumb(cthS, /orb/),
    pickThumb(depthS, /potion/),
    pickThumb(dungeonS, /torch/),
    pickThumb(cthS, /tentacled eye|eye/),
    pickThumb(depthS, /chest/),
  ]
  const mapButtons = chapters.map((c, i) => {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.type = 'button'
    b.style.background = c.color
    if (c.color === '#f4ecd8') b.style.color = '#15121c'
    b.innerHTML = `<span class="n">${c.num}</span><img src="${thumbs[i]}" alt="" /><span class="t">${c.title}</span>`
    b.addEventListener('click', () => {
      toggleMap(false)
      goTo(i)
    })
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
    if (location.hash.slice(1) !== c.id) history.replaceState(null, '', `#${c.id}`)
  }

  function activate(i: number, dir: 1 | -1) {
    chapters[index].leave?.()
    chapters[index].el.classList.remove('is-active')
    index = i
    chapters[index].el.classList.add('is-active')
    chapters[index].enter?.(dir)
    updateHud()
  }

  async function goTo(i: number) {
    if (busy || i === index || i < 0 || i >= chapters.length) return
    busy = true
    const dir: 1 | -1 = i > index ? 1 : -1
    const target = chapters[i]
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

  let touchY: number | null = null
  window.addEventListener('touchstart', (e) => (touchY = e.touches[0].clientY), { passive: true })
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
    if (show) mapButtons[index].focus()
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'm' || e.key === 'M') return toggleMap()
    if (e.key === 'Escape') return toggleMap(false)
    if (!map.hidden) return
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
  chapters.forEach((c) => c.id !== 'hero' && c.leave?.())
  if (chapters[start].id !== 'hero') chapters[0].leave?.()
  chapters[start].el.classList.add('is-active')
  chapters[start].enter?.(1)
  updateHud()
}

boot().catch((err) => {
  console.error(err)
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;bottom:16px;left:16px;color:#f66">加载失败：${err.message}</p>`)
})
