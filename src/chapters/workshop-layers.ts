/**
 * The workshop chapter is two stacked sheets: the workbench (workshop.ts) and the toolbox
 * (toolbox.ts). To the pager they are one chapter, built here from the two.
 *
 * One sheet is in front; the other is hidden and inert, its loops stopped, and shows only as an
 * edge along the side it lives on (workbench left, toolbox right). Swapping them is not a chapter
 * transition: both sheets shrink to cards on the desk, the one behind slides out from under,
 * goes over the top and lands, while the other drops back under a stepped dither.
 *
 * The switch in each sheet's header, the edge, the pager (scrolling past the workbench, or up
 * from the top of the toolbox) and the workbench's "more tools" link all end up in `show`.
 */

import gsap from 'gsap'
import { sound } from '../audio'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Toolbox } from './toolbox'
import type { Workshop } from './workshop'

export type Layer = 'bench' | 'toolbox'

export interface WorkshopLayers extends Chapter {
  /** the sheet in front */
  layer(): Layer
  /** put a sheet in front at once, with no effect: for when the chapter is off screen */
  place(layer: Layer): void
  /** swap the sheets; resolves once the new one has landed. `url` opens the toolbox on that tool's card. */
  show(layer: Layer, url?: string): Promise<void>
  load: Workshop['load']
}

export interface LayerHooks {
  /** a swap wants to start; false refuses it (the pager is in the middle of something) */
  begin(): boolean
  /** the other sheet is now in front: the address and the HUD follow */
  change(layer: Layer): void
  /** the swap has landed */
  end(): void
}

/** how small a sheet gets on the desk; the dither in workshop-layers.css is sized for this */
const REST = 0.875
const PART = 0.24
const LAND = 0.26

export function createWorkshopLayers(el: HTMLElement, bench: Workshop, toolbox: Toolbox, hooks: LayerHooks): WorkshopLayers {
  const parts: Record<Layer, Chapter> = { bench, toolbox }
  const shades = {} as Record<Layer, HTMLElement>
  for (const id of ['bench', 'toolbox'] as const) {
    const shade = document.createElement('i')
    shade.className = 'co-shade'
    shade.setAttribute('aria-hidden', 'true')
    parts[id].el.append(shade)
    shades[id] = shade
  }
  const dim = (id: Layer, level: number) => {
    shades[id].dataset.dim = String(level)
  }

  let layer: Layer = 'bench'
  let active = false
  let swap: gsap.core.Timeline | null = null
  /** scroll momentum left over from the gesture that turned the sheet is not meant for the new one */
  let settleUntil = 0

  function place(next: Layer) {
    layer = next
    el.dataset.layer = next
    for (const id of ['bench', 'toolbox'] as const) parts[id].el.inert = id !== next
    el.querySelectorAll<HTMLElement>('.co-switch [data-layer-go]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.layerGo === next))
    })
  }

  /** paper sliding, then the sheet coming down: rising for the toolbox, falling for the workbench */
  function swish(up: boolean) {
    sound.noise(0.18, { f0: up ? 700 : 2600, f1: up ? 2800 : 600, q: 0.8, vol: 0.05 })
  }
  function thud(up: boolean) {
    sound.tone(120, 0.09, { type: 'triangle', vol: 0.09, slide: 55 })
    sound.arp(up ? [659, 988] : [988, 659], 0.05, { vol: 0.03 })
  }

  function animate(from: Layer, next: Layer, arrive: () => void): Promise<void> {
    const out = parts[from].el
    const inc = parts[next].el
    // each sheet has a side of the desk: the toolbox comes from the right and goes back there
    const side = next === 'toolbox' ? 1 : -1
    el.classList.add('is-swapping')
    out.inert = true
    gsap.set(out, { zIndex: 2 })
    gsap.set(inc, { zIndex: 1, scale: REST, xPercent: side * 4, yPercent: 2 })
    dim(next, 3)
    swish(side === 1)
    return new Promise((resolve) => {
      swap = gsap
        .timeline({
          onComplete() {
            gsap.set([out, inc, el], { clearProps: 'transform,zIndex' })
            dim(from, 0)
            inc.classList.remove('is-lifted')
            el.classList.remove('is-swapping')
            swap = null
            resolve()
          },
        })
        // part: the front sheet drops back while the one behind slides out from under it
        .to(out, { scale: REST, xPercent: -side * 10, yPercent: 2, duration: PART, ease: 'steps(4)' }, 0)
        .to(inc, { xPercent: side * 30, yPercent: -4, duration: PART, ease: 'steps(4)' }, 0)
        .call(dim, [from, 1], PART * 0.5)
        .call(dim, [next, 2], PART * 0.5)
        // over the top: from here on the new sheet is the one in front
        .call(
          () => {
            gsap.set(inc, { zIndex: 3 })
            inc.classList.add('is-lifted')
            dim(next, 0)
            sound.tone(side === 1 ? 392 : 294, 0.05, { vol: 0.03 })
            arrive()
          },
          [],
          PART,
        )
        // land: it comes down to fill the desk, the other one settles underneath and dims out
        .to(inc, { scale: 1, xPercent: 0, yPercent: 0, duration: LAND, ease: 'steps(5)' }, PART)
        .to(out, { xPercent: -side * 5, duration: LAND, ease: 'steps(3)' }, PART)
        .call(dim, [from, 2], PART + LAND / 3)
        .call(dim, [from, 3], PART + (LAND * 2) / 3)
        .call(thud, [side === 1], PART + LAND)
        .fromTo(el, { y: 5 }, { y: 0, duration: 0.08, ease: 'steps(2)', immediateRender: false }, PART + LAND)
    })
  }

  async function show(next: Layer, url?: string): Promise<void> {
    if (next === layer) {
      if (url && active && next === 'toolbox') toolbox.spotlight(url, true)
      return
    }
    if (!active) return place(next)
    if (swap || !hooks.begin()) return
    const from = layer
    const held = el.contains(document.activeElement)
    let card = null as HTMLElement | null
    parts[from].leave?.()
    const arrive = () => {
      place(next)
      parts[next].enter?.(1)
      if (url && next === 'toolbox') card = toolbox.spotlight(url)
      hooks.change(next)
    }
    if (reducedMotion) {
      arrive()
      thud(next === 'toolbox')
    } else await animate(from, next, arrive)
    // the control that was pressed is on the sheet that left: hand the focus to its twin, or to the card asked for
    if (held || card) {
      const twin = card ?? parts[next].el.querySelector<HTMLElement>('.co-switch [aria-pressed="true"]')
      twin?.focus({ preventScroll: true })
      // the header is hidden on very short screens: the edge of the other sheet is always there
      if (held && document.activeElement !== twin) el.querySelector<HTMLElement>(`.co-edge[data-layer-go="${from}"]`)?.focus({ preventScroll: true })
    }
    settleUntil = performance.now() + 350
    hooks.end()
  }

  el.addEventListener('click', (event) => {
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-go]')
    if (control) show(control.dataset.layerGo as Layer)
  })
  el.querySelectorAll<HTMLElement>('[data-layer-go]').forEach((control) => {
    control.addEventListener('pointerenter', () => sound.tick(control.dataset.layerGo === 'toolbox' ? 1900 : 1500, 0.014))
  })
  // the workbench's "more tools" link: open the toolbox on the tool it was talking about
  el.addEventListener('workshop:toolbox', (event) => {
    const url = (event as CustomEvent<{ url?: string } | null>).detail?.url
    show('toolbox', typeof url === 'string' ? url : undefined)
  })

  place('bench')

  return {
    id: bench.id,
    num: bench.num,
    title: bench.title,
    color: bench.color,
    transition: bench.transition,
    ambience: bench.ambience,
    el,
    layer: () => layer,
    place,
    show,
    load: (sprite, label) => bench.load(sprite, label),
    consume(delta) {
      if (swap || performance.now() < settleUntil) return true
      return layer === 'toolbox' ? (toolbox.consume?.(delta) ?? false) : false
    },
    // the workbench has nothing to scroll through: it is always ready to hand on
    atEnd: () => (layer === 'toolbox' ? (toolbox.atEnd?.() ?? true) : true),
    enter(dir) {
      active = true
      parts[layer].enter?.(dir)
    },
    leave() {
      swap?.progress(1)
      active = false
      bench.leave?.()
      toolbox.leave?.()
    },
  }
}
