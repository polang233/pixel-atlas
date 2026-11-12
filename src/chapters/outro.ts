/**
 * 08 · 带走. Where the assets go next: repo, CLI, dsh plugin, licence.
 */
import gsap from 'gsap'
import { sound } from '../audio'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const X_URL = 'https://x.com/polang233'

export function createOutro(el: HTMLElement, sprites: Sprite[], toSearch: () => void): Chapter {
  const rain = el.querySelector<HTMLElement>('.outro-rain')!
  let tweens: gsap.core.Tween[] = []

  if (X_URL) {
    const x = document.createElement('a')
    x.href = X_URL
    x.target = '_blank'
    x.rel = 'noopener'
    x.textContent = 'X ↗'
    el.querySelector('.outro-links')!.append(x)
  }
  el.querySelector('.outro-search')!.addEventListener('click', () => {
    sound.click()
    toSearch()
  })
  el.querySelectorAll<HTMLElement>('.outro-card').forEach((c, i) =>
    c.addEventListener('pointerenter', () => sound.tick(1200 + i * 220, 0.02)),
  )
  el.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy!)
        b.classList.add('copied')
        sound.select()
        setTimeout(() => b.classList.remove('copied'), 1200)
      } catch {
        /* clipboard may be blocked */
      }
    }),
  )

  function start() {
    rain.replaceChildren()
    tweens.forEach((t) => t.kill())
    tweens = []
    const n = window.innerWidth < 700 ? 16 : 32
    for (let i = 0; i < n; i++) {
      const s = sprites[(Math.random() * sprites.length) | 0]
      const img = document.createElement('img')
      img.src = s.url
      img.alt = ''
      img.style.left = `${Math.random() * 100}%`
      rain.append(img)
      if (reducedMotion) {
        img.style.top = `${Math.random() * 100}%`
        continue
      }
      tweens.push(
        gsap.fromTo(
          img,
          { y: -80 - Math.random() * window.innerHeight },
          { y: window.innerHeight + 80, duration: 6 + Math.random() * 6, ease: 'steps(40)', repeat: -1, delay: -Math.random() * 6 },
        ),
      )
    }
  }

  return {
    id: 'outro',
    num: '08',
    title: '带走',
    color: '#f4ecd8',
    transition: 'dither',
    ambience: 'outro',
    el,
    enter: start,
    leave() {
      tweens.forEach((t) => t.kill())
      tweens = []
    },
  }
}
