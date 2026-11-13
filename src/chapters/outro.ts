/**
 * 08 · Take them with you: one sprite, a batch, or the original dataset.
 */
import gsap from 'gsap'
import { sound } from '../audio'
import { onLocaleChange, t } from '../i18n'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

export function createOutro(el: HTMLElement, sprites: Sprite[], toSearch: () => Promise<void>): Chapter {
  const rain = el.querySelector<HTMLElement>('.outro-rain')!
  let tweens: gsap.core.Tween[] = []

  el.querySelectorAll('.outro-search, [data-outro-search]').forEach((button) => {
    button.addEventListener('click', () => {
      sound.click()
      toSearch()
    })
  })
  el.querySelector('[data-outro-batch]')!.addEventListener('click', async () => {
    sound.click()
    await toSearch()
    const input = document.querySelector<HTMLInputElement>('[data-id="hero"] input[name="q"]')!
    input.value = t('outro.batch.query')
    input.form?.requestSubmit()
    // Submit browses existing results; input also schedules a fresh query in that case.
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  el.querySelectorAll('.outro-card').forEach((card, i) => {
    card.addEventListener('pointerenter', () => sound.tick(1200 + i * 220, 0.02))
  })

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const well = el.querySelector<HTMLButtonElement>('.outro-sprite')!
  const one = well.querySelector('img')!
  let oneIndex = (Math.random() * sprites.length) | 0
  one.src = sprites[oneIndex].url
  let squash: Animation | null = null
  well.addEventListener('click', () => {
    oneIndex = (oneIndex + 1 + ((Math.random() * (sprites.length - 1)) | 0)) % sprites.length
    one.src = sprites[oneIndex].url
    squash?.cancel()
    if (!motion.matches) squash = one.animate([{ transform: 'scale(1.15, 0.85)' }, { transform: 'scale(1)' }], { duration: 120, easing: 'steps(2)' })
    sound.click()
  })

  const batch = el.querySelector<HTMLElement>('.is-batch')!
  const sheet = el.querySelector<HTMLElement>('.outro-sheet')!
  const tiles = Array.from({ length: 16 }, () => {
    const img = document.createElement('img')
    img.alt = ''
    img.width = img.height = 32
    sheet.append(img)
    return img
  })
  const shuffleSheet = () => {
    tiles.forEach((img) => {
      img.src = sprites[(Math.random() * sprites.length) | 0].url
    })
  }
  shuffleSheet()
  let active = false
  let hovering = false
  let sheetTimer = 0
  const stopSheet = () => {
    window.clearInterval(sheetTimer)
    sheetTimer = 0
  }
  const updateSheet = () => {
    const engaged = hovering || batch.contains(document.activeElement)
    if (!active || document.hidden || motion.matches || !engaged) stopSheet()
    else if (!sheetTimer) sheetTimer = window.setInterval(shuffleSheet, 600)
  }
  batch.addEventListener('pointerenter', (event) => {
    hovering = event.pointerType !== 'touch'
    updateSheet()
  })
  batch.addEventListener('pointerleave', () => {
    hovering = false
    updateSheet()
  })
  batch.addEventListener('focusin', updateSheet)
  batch.addEventListener('focusout', () => queueMicrotask(updateSheet))
  document.addEventListener('visibilitychange', updateSheet)
  motion.addEventListener('change', () => {
    if (motion.matches) squash?.cancel()
    updateSheet()
  })

  const snippet = el.querySelector<HTMLElement>('#outro-snippet')!
  const copied = el.querySelector<HTMLElement>('.outro-copied')!
  let copyState: 'outro.copied' | 'outro.copyFailed' | null = null
  let copyTimer = 0
  let copyJob = 0
  const renderCopy = () => {
    copied.textContent = copyState ? t(copyState) : ''
    copied.classList.toggle('is-visible', copyState !== null)
  }
  el.querySelector('.outro-actions button')!.addEventListener('click', async () => {
    const job = ++copyJob
    clearTimeout(copyTimer)
    copyState = null
    renderCopy()
    try {
      // biome-ignore lint/performance/useDomNodeTextContent: Copy the rendered Python snippet exactly as shown.
      await navigator.clipboard.writeText(snippet.innerText.trim())
      if (job !== copyJob) return
      copyState = 'outro.copied'
      sound.select()
    } catch {
      if (job !== copyJob) return
      copyState = 'outro.copyFailed'
    }
    renderCopy()
    copyTimer = window.setTimeout(() => {
      copyState = null
      renderCopy()
    }, 1600)
  })
  onLocaleChange(renderCopy)

  const snippets = {
    python: snippet.textContent!,
    zip: `import json, numpy as np
tokens = np.load("tokens.npy", mmap_mode="r")    # 256 palette indices per sprite
palette = np.load("palette.npy")                  # index 0 is transparent
captions = json.load(open("captions.json"))`,
  }
  const formats = el.querySelectorAll<HTMLButtonElement>('[data-outro-format]')
  formats.forEach((button) => {
    button.addEventListener('click', () => {
      const format = button.dataset.outroFormat
      if (format !== 'python' && format !== 'zip') return
      snippet.textContent = snippets[format]
      formats.forEach((other) => {
        other.setAttribute('aria-pressed', String(other === button))
      })
      ++copyJob
      clearTimeout(copyTimer)
      copyState = null
      renderCopy()
      sound.click()
    })
  })

  function start() {
    active = true
    updateSheet()
    rain.replaceChildren()
    tweens.forEach((t) => {
      t.kill()
    })
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
    title: () => t('outro.title'),
    color: '#f4ecd8',
    transition: 'dither',
    ambience: 'outro',
    el,
    enter: start,
    leave() {
      active = false
      hovering = false
      stopSheet()
      squash?.cancel()
      tweens.forEach((t) => {
        t.kill()
      })
      tweens = []
    },
  }
}
