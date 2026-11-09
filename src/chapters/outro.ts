import gsap from 'gsap'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Sprite } from '../sprites'

export function createOutro(el: HTMLElement, sprites: Sprite[]): Chapter {
  const rain = el.querySelector<HTMLElement>('.outro-rain')!
  let tweens: gsap.core.Tween[] = []

  function start() {
    rain.replaceChildren()
    tweens.forEach((t) => t.kill())
    tweens = []
    const n = window.innerWidth < 700 ? 18 : 36
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
          { y: window.innerHeight + 80, duration: 5 + Math.random() * 6, ease: 'steps(40)', repeat: -1, delay: -Math.random() * 6 },
        ),
      )
    }
  }

  return {
    id: 'outro',
    num: '04',
    title: '素材库',
    color: '#f4ecd8',
    transition: 'dither',
    el,
    enter: start,
    leave() {
      tweens.forEach((t) => t.kill())
      tweens = []
    },
  }
}
