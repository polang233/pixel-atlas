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

  // ---- mini game: keep the lantern on the eyes -------------------------------------------
  const PX = 4
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
  const gc = el.querySelector<HTMLCanvasElement>('.cth-game')!
  const gx = gc.getContext('2d')!
  const eyeSprites = sprites.filter((s) => /eye|tentacle|squid|void|kraken/.test(s.subject))
  const eyeCanvas = (eyeSprites.length ? eyeSprites : sprites).map((s) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    c.getContext('2d')!.putImageData(s.data, 0, 0)
    return c
  })
  interface Eye { x: number; y: number; img: HTMLCanvasElement; born: number; open: number; light: number; gone: number }
  const g = { on: false, eyes: [] as Eye[], next: 0, t0: 0, banished: 0, mx: -99, my: -99, last: 0, dead: false }
  let img: ImageData | null = null

  gc.addEventListener('pointermove', (e) => {
    const r = gc.getBoundingClientRect()
    g.mx = (e.clientX - r.left) / PX
    g.my = (e.clientY - r.top) / PX
  })
  gc.addEventListener('pointerdown', (e) => {
    const r = gc.getBoundingClientRect()
    g.mx = (e.clientX - r.left) / PX
    g.my = (e.clientY - r.top) / PX
  })

  function gameFrame(now: number) {
    const w = Math.ceil(el.clientWidth / PX)
    const h = Math.ceil(el.clientHeight / PX)
    if (gc.width !== w || gc.height !== h || !img) {
      gc.width = w
      gc.height = h
      img = gx.createImageData(w, h)
    }
    const dt = Math.min(0.05, (now - g.last) / 1000)
    g.last = now
    const age = (now - g.t0) / 1000
    const m = 1 - san / 100
    // the lantern shrinks and flickers as sanity goes
    const R = (30 - m * 10) * (1 + (Math.random() - 0.5) * m * 0.25)
    if (!g.dead) {
      if (now > g.next) {
        const S = 32
        let x = 0
        let y = 0
        for (let k = 0; k < 8; k++) {
          x = S / 2 + Math.random() * (w - S)
          y = S / 2 + Math.random() * (h - S)
          if (Math.hypot(x - g.mx, y - g.my) > R * 1.6) break
        }
        g.eyes.push({ x, y, img: eyeCanvas[(Math.random() * eyeCanvas.length) | 0], born: now, open: 0, light: 0, gone: 0 })
        g.next = now + Math.max(550, 2300 - age * 32)
        sound.eyeOpen()
      }
      let drain = 0
      for (const e of g.eyes) {
        if (e.gone) continue
        e.open = Math.min(1, e.open + dt / 1.4)
        const lit = Math.hypot(e.x - g.mx, e.y - g.my) < R * 0.85
        e.light = lit ? e.light + dt : Math.max(0, e.light - dt * 0.5)
        if (e.light > 0.45) {
          e.gone = now
          g.banished++
          sound.banish()
        } else if (e.open >= 1) drain += 2.6
      }
      const before = Math.ceil(san / 10)
      san = Math.max(0, san - drain * dt)
      if (Math.ceil(san / 10) < before) sound.tone(110 + before * 22, 0.25, { type: 'sawtooth', vol: 0.03, slide: 90 + before * 15 })
      apply()
      const score = g.banished * 100 + Math.floor(age) * 10
      shell.score(score)
      shell.extra(`<span class="san-chip">SAN ${Math.round(san)}</span> · 封印 ${g.banished} 只眼 · ${Math.floor(age)} 秒`)
      if (san <= 0) {
        g.dead = true
        sound.noise(1.4, { f0: 300, f1: 2400, q: 6, vol: 0.06, attack: 0.6 })
        shell.end(score, '理智归零', `你封印了 ${g.banished} 只眼睛，撑了 ${Math.floor(age)} 秒。祂们还在看着。`)
      }
    }
    g.eyes = g.eyes.filter((e) => !e.gone || now - e.gone < 500)

    // darkness with a dithered lantern hole
    const d = img.data
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dist = Math.hypot(x - g.mx, y - g.my) / R
        const v = Math.min(1, Math.max(0, (dist - 0.55) / 0.45))
        const q = Math.floor(v * 4 + BAYER4[(y & 3) * 4 + (x & 3)] * 0.95) / 4
        const o = (y * w + x) * 4
        d[o] = 3
        d[o + 1] = 6
        d[o + 2] = 4
        d[o + 3] = Math.round(Math.min(1, q) * 246)
      }
    gx.putImageData(img, 0, 0)
    // eyes: a red glint in the dark, the full creature in the light
    gx.imageSmoothingEnabled = false
    for (const e of g.eyes) {
      const lit = Math.hypot(e.x - g.mx, e.y - g.my) < R
      const S = 32
      if (e.gone) {
        const k = (now - e.gone) / 500
        gx.globalAlpha = 1 - k
        gx.drawImage(e.img, e.x - (S / 2) * (1 - k), e.y - (S / 2) * (1 + k), S * (1 - k), S * (1 + k))
        gx.globalAlpha = 1
        continue
      }
      const hh = Math.max(1, Math.round(S * e.open))
      if (lit) {
        gx.drawImage(e.img, Math.round(e.x - S / 2), Math.round(e.y - hh / 2), S, hh)
        // how close it is to being sealed
        gx.fillStyle = '#9fd18b'
        gx.fillRect(Math.round(e.x - S / 2), Math.round(e.y + S / 2 + 2), Math.round((S * e.light) / 0.45), 1)
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(now / 160 + e.x)
        gx.fillStyle = e.open >= 1 ? `rgba(255,40,40,${0.6 + pulse * 0.4})` : `rgba(160,40,40,${0.3 + e.open * 0.4})`
        const sz = e.open >= 1 ? 2 : 1
        gx.fillRect(Math.round(e.x - 4), Math.round(e.y), sz, sz)
        gx.fillRect(Math.round(e.x + 3), Math.round(e.y), sz, sz)
      }
    }
    // the lantern ring
    gx.fillStyle = 'rgba(255, 214, 140, 0.6)'
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2
      gx.fillRect(Math.round(g.mx + Math.cos(a) * R * 0.98), Math.round(g.my + Math.sin(a) * R * 0.98), 1, 1)
    }
  }

  const shell = new GameShell(el, 'cthulhu', '克苏鲁', {
    start() {
      san = 100
      apply()
      const now = performance.now()
      Object.assign(g, { on: true, eyes: [], next: now + 900, t0: now, banished: 0, last: now, dead: false, mx: el.clientWidth / PX / 2, my: el.clientHeight / PX / 2 })
      gc.hidden = false
    },
    stop() {
      g.on = false
      gc.hidden = true
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
