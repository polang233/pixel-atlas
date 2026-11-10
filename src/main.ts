import './style.css'
import gsap from 'gsap'
import { sound } from './audio'
import { createCart } from './chapters/cart'
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

type Area = 'hero' | 'worlds' | 'depth' | 'workshop' | 'outro'

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
  })
  const worlds: Chapter[] = [
    createCart(section('cart'), strips.crt),
    createDungeon(section('dungeon'), strips.dungeon, strips.crt.find((q) => q.subject === 'knight')),
    createOcean(section('ocean'), strips.ocean),
    createNeon(section('neon'), strips.neon),
    createCthulhu(section('cthulhu'), strips.cthulhu),
  ]
  const depth = createDepth(section('depth'), strips.depth)
  const outro = createOutro(section('outro'), Object.values(strips).flat(), () => {
    goTo(0).then(() => hero.focusSearch?.())
  })
  const chapters: Chapter[] = [hero, ...worlds, depth, workshop, outro]
  const areaOf = (c: Chapter): Area => (worlds.includes(c) ? 'worlds' : (c.id as Area))

  const hudHint = $('.hint')
  const navButtons = [...document.querySelectorAll<HTMLButtonElement>('.topnav [data-go]')]
  const worldbar = $<HTMLElement>('.worldbar')
  const worldList = $('.worldbar-list')
  const sndBtn = $<HTMLButtonElement>('.snd-btn')

  const AREAS: Area[] = ['hero', 'worlds', 'depth', 'workshop', 'outro']
  const AREA_NAME: Record<Area, string> = { hero: '星图', worlds: '世界', depth: '色深', workshop: '工坊', outro: '获取' }
  const nextbar = $<HTMLButtonElement>('.nextbar')
  const nextLabel = nextbar.querySelector<HTMLElement>('.nb-label')!
  const nextName = nextbar.querySelector<HTMLElement>('b')!
  const nextFill = nextbar.querySelector<HTMLElement>('.nb-fill')!
  const EDGE = 520

  let index = 0
  let lastWorld = 1
  let busy = false
  let cooldownUntil = 0
  let edgeAcc = 0
  let consuming = false
  let edgeDir: 1 | -1 = 1
  let edgeTimer = 0
  let armedUntil = 0

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
    if (!chapters[index].playing?.()) sound.ambience(chapters[index].ambience ?? null)
  })
  updateSound()

  // ---- nav ------------------------------------------------------------------------------
  navButtons.forEach((b, i) => {
    b.addEventListener('click', () => {
      const go = b.dataset.go as Area
      goTo(go === 'worlds' ? lastWorld : chapters.findIndex((c) => c.id === go))
    })
    b.addEventListener('pointerenter', () => sound.tick(1500 + i * 160, 0.014))
  })
  const worldButtons = worlds.map((c, k) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.innerHTML = `<b>${c.num}</b>${c.title}`
    b.addEventListener('click', () => goTo(k + 1))
    b.addEventListener('pointerenter', () => sound.tick(1700 + k * 120, 0.012))
    worldList.append(b)
    return b
  })
  worldbar.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = index - 1 + Number(b.dataset.step)
      goTo(1 + ((k + worlds.length) % worlds.length))
    }),
  )

  const HINTS: Record<Area, string> = {
    hero: '<kbd>滚轮</kbd> 缩放 <kbd>/</kbd> 搜索',
    worlds: '<kbd>滚轮</kbd><kbd>↑↓</kbd> 换世界 · 每个世界都能玩一局',
    depth: '<kbd>←→</kbd><kbd>滚轮</kbd> 换年代 · 点画面重听',
    workshop: '选一个工具，在画布上拖动试试',
    outro: '<kbd>/</kbd> 回到星图搜索',
  }

  function updateHud() {
    const c = chapters[index]
    const area = areaOf(c)
    navButtons.forEach((b) => b.setAttribute('aria-current', String(b.dataset.go === area)))
    worldButtons.forEach((b, k) => b.setAttribute('aria-current', String(worlds[k] === c)))
    worldbar.hidden = area !== 'worlds'
    hudHint.innerHTML = HINTS[area]
    document.body.dataset.chapter = c.id
    document.body.dataset.area = area
    if (location.hash.slice(1) !== c.id) history.replaceState(null, '', `#${c.id}`)
  }

  // ---- "there is more this way": the hand-off between the big sections --------------------
  /** the section before / after the one on screen, and the chapter you would land on */
  function neighbour(dir: 1 | -1) {
    const area = AREAS[AREAS.indexOf(areaOf(chapters[index])) + dir]
    if (!area) return null
    const to = area === 'worlds' ? (dir === 1 ? 1 : worlds.length) : chapters.findIndex((c) => c.id === area)
    return { area, to }
  }
  /** is the chapter on screen the last (dir 1) or first (dir -1) page of its section? */
  function atSectionEdge(dir: 1 | -1) {
    const c = chapters[index]
    if (areaOf(c) === 'hero') return false
    if (areaOf(c) !== 'worlds') return true
    return c === (dir === 1 ? worlds[worlds.length - 1] : worlds[0])
  }
  function showNext(dir: 1 | -1, progress: number, armed = false) {
    const n = neighbour(dir)
    if (!n) return
    nextbar.hidden = false
    nextbar.dataset.dir = String(dir)
    nextbar.classList.toggle('is-charging', progress > 0 || armed)
    nextLabel.textContent = armed
      ? `再按一次 ${dir === 1 ? '↓' : '↑'} 前往`
      : dir === 1
        ? progress > 0 ? '继续滚动，前往' : chapters[index].atEnd ? `「${AREA_NAME[areaOf(chapters[index])]}」看完了 · 继续滚动前往` : '下一站 · 继续滚动前往'
        : '继续向上，回到'
    nextName.textContent = AREA_NAME[n.area]
    nextFill.style.transform = `scaleX(${armed ? 1 : Math.min(1, progress)})`
  }
  /** resting state: a quiet pointer onward whenever the current section has nothing left to scroll */
  function restNext() {
    const c = chapters[index]
    edgeAcc = 0
    const end = !busy && !c.playing?.() && atSectionEdge(1) && (c.atEnd?.() ?? true) && neighbour(1)
    if (end) showNext(1, 0)
    else nextbar.hidden = true
  }
  function pushEdge(delta: number) {
    const dir = delta > 0 ? 1 : -1
    const n = neighbour(dir)
    if (!n || !atSectionEdge(dir)) return
    if (dir !== edgeDir) edgeAcc = 0
    edgeDir = dir
    edgeAcc += delta
    showNext(dir, Math.abs(edgeAcc) / EDGE)
    clearTimeout(edgeTimer)
    if (Math.abs(edgeAcc) >= EDGE) {
      edgeAcc = 0
      sound.select()
      goTo(n.to)
      return
    }
    sound.tick(900 + (Math.abs(edgeAcc) / EDGE) * 900, 0.01)
    edgeTimer = window.setTimeout(restNext, 900)
  }
  /** keyboard version: the first press arms the hand-off, the second one goes */
  function keyEdge(dir: 1 | -1) {
    const n = neighbour(dir)
    if (!n || !atSectionEdge(dir) || busy) return
    const now = performance.now()
    if (now < armedUntil && dir === edgeDir) {
      armedUntil = 0
      sound.select()
      goTo(n.to)
      return
    }
    edgeDir = dir
    armedUntil = now + 2600
    showNext(dir, 0, true)
    sound.tick(1400, 0.02)
    clearTimeout(edgeTimer)
    edgeTimer = window.setTimeout(restNext, 2600)
  }
  nextbar.addEventListener('click', () => {
    const n = neighbour(Number(nextbar.dataset.dir) === -1 ? -1 : 1)
    if (n) goTo(n.to)
  })
  window.setInterval(() => {
    if (edgeAcc === 0 && performance.now() > armedUntil) restNext()
  }, 300)

  /** the copy of a chapter steps in, line by line, each time the chapter comes on */
  function reveal(el: HTMLElement) {
    if (reducedMotion) return
    const items = el.querySelectorAll('.world-copy > *, .depth-copy > *, .ws-head > *, .ws-tools > *, .outro-box > *, .outro-cards > *')
    if (!items.length) return
    gsap.fromTo(items, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: 'steps(4)', stagger: 0.045, delay: 0.12, overwrite: true, clearProps: 'opacity,transform' })
  }

  function activate(i: number, dir: 1 | -1) {
    chapters[index].leave?.()
    chapters[index].el.classList.remove('is-active')
    index = i
    if (areaOf(chapters[i]) === 'worlds') lastWorld = i
    chapters[index].el.classList.add('is-active')
    chapters[index].enter?.(dir)
    sound.ambience(chapters[index].ambience ?? null)
    updateHud()
    reveal(chapters[index].el)
    armedUntil = 0
    nextbar.hidden = true
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

  /**
   * Route scroll-like input. Every page gets it first; only the worlds
   * page on to the next world once the current one is done with it.
   */
  function input(delta: number) {
    if (busy) return
    const c = chapters[index]
    if (c.playing?.()) return
    if (c.consume?.(delta)) {
      edgeAcc = 0
      consuming = true
      return
    }
    if (areaOf(c) === 'hero') return
    // the chapter just hit its end: hold briefly so scroll momentum
    // doesn't skip the final frame of that chapter
    if (consuming) {
      consuming = false
      cooldownUntil = performance.now() + 700
    }
    if (performance.now() < cooldownUntil) return
    const dir = delta > 0 ? 1 : -1
    // leaving a whole section takes a deliberate, visible push; world to world is a short one
    if (atSectionEdge(dir)) return pushEdge(delta)
    edgeAcc += delta
    if (Math.abs(edgeAcc) > 90) {
      const next = index + Math.sign(edgeAcc)
      edgeAcc = 0
      if (next >= 1 && next <= worlds.length) goTo(next)
    }
  }

  window.addEventListener(
    'wheel',
    (e) => {
      // let scrollable panels (workshop side, outro) scroll natively
      const t = e.target as HTMLElement
      if (t.closest?.('[data-scroll]')) return
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
      const own = (e.target as HTMLElement).closest?.('[data-own-touch], [data-scroll], input, button, a, label')
      touchY = own || areaOf(chapters[index]) === 'hero' ? null : e.touches[0].clientY
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

  /** Keys step through a world's internal progress in chunks, then on to the next world. */
  function keyStep(dir: 1 | -1) {
    const c = chapters[index]
    if (areaOf(c) !== 'worlds') return keyEdge(dir)
    const onward = () => (atSectionEdge(dir) ? keyEdge(dir) : goTo(index + dir))
    if (c.consume) {
      let n = 0
      const id = setInterval(() => {
        if (!c.consume?.(dir * 120) || ++n >= 4) {
          clearInterval(id)
          if (n === 0) onward()
        }
      }, 40)
    } else onward()
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && t.type !== 'checkbox') {
      if (e.key === 'Escape') t.blur()
      return
    }
    if (chapters[index].playing?.() || e.defaultPrevented) return
    if (e.key === '/') {
      e.preventDefault()
      if (index === 0) hero.focusSearch?.()
      else goTo(0).then(() => hero.focusSearch?.())
      return
    }
    const area = areaOf(chapters[index])
    if (area === 'hero') return
    if (['ArrowDown', 'PageDown'].includes(e.key) || (e.key === ' ' && area === 'worlds' && !(t instanceof HTMLButtonElement))) {
      e.preventDefault()
      keyStep(1)
    } else if (['ArrowUp', 'PageUp'].includes(e.key)) {
      e.preventDefault()
      keyStep(-1)
    }
  })

  $('.logo').addEventListener('click', (e) => {
    e.preventDefault()
    goTo(0)
  })
  window.addEventListener('hashchange', () => {
    const i = chapters.findIndex((c) => c.id === location.hash.slice(1))
    if (i >= 0) goTo(i)
  })

  const start = Math.max(0, chapters.findIndex((c) => c.id === location.hash.slice(1)))
  index = start
  if (areaOf(chapters[start]) === 'worlds') lastWorld = start
  chapters.forEach((c, i) => i !== start && c.leave?.())
  chapters[start].el.classList.add('is-active')
  chapters[start].enter?.(1)
  sound.ambience(chapters[start].ambience ?? null)
  updateHud()
  reveal(chapters[start].el)
  document.body.classList.add('is-ready')
}

boot().catch((err) => {
  console.error(err)
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;bottom:16px;left:16px;color:#f66;z-index:99">加载失败：${err.message}</p>`)
})
