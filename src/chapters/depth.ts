import gsap from 'gsap'
import { sound } from '../audio'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import type { Sprite } from '../sprites'

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

const DB32 = '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30'
  .split(' ')
  .map((c) => hex('#' + c))
const PICO = '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'
  .split(' ')
  .map((c) => hex('#' + c))
const GB = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'].map(hex)
const BW: RGB[] = [[0, 0, 0], [255, 255, 255]]

interface Stage {
  key: string
  era: string
  bits: number
  /** what the era's jingle is played on */
  voice: string
  name: string
  desc: string
  palette: RGB[] | null
  /** map by luminance into ordered levels instead of nearest colour */
  ramp?: boolean
  theme: [bg: string, fg: string, accent: string]
}

const STAGES: Stage[] = [
  {
    key: '现代',
    era: '今天',
    bits: 16,
    voice: '软件合成 · 和弦铺底 + 长回声',
    name: '现代像素 · 不限色',
    desc: '这批素材平均每张 21 色，带渐变、高光和描边。今天的独立游戏大多是这种“高色深像素”：格子还是格子，颜色几乎不设限。',
    palette: null,
    theme: ['#14121c', '#efe6d2', '#ffcc4d'],
  },
  {
    key: '32 色',
    era: '16 位时代的电脑',
    bits: 5,
    voice: '8 位采样 · 带回声的弦乐',
    name: '32 色 · 统一调色板',
    desc: '所有素材共用同一套 32 色。单张图会损失一点细节，但整个画面立刻像出自同一个游戏——这是像素美术里最便宜也最有效的“统一画风”手段。',
    palette: DB32,
    theme: ['#cbdbfc', '#222034', '#5b6ee1'],
  },
  {
    key: '16 色',
    era: '8 位主机 / 幻想主机',
    bits: 4,
    voice: '两条脉冲波 + 一条三角波',
    name: '16 色 · 幻想主机',
    desc: '高饱和的 16 色。没有中间调可用，阴影只能靠换一种颜色来画——限制反而逼出了鲜明的风格。',
    palette: PICO,
    theme: ['#1d2b53', '#fff1e8', '#ff004d'],
  },
  {
    key: '4 色',
    era: '1989 · 掌机',
    bits: 2,
    voice: '12.5% 窄脉冲 · 一只小喇叭',
    name: '4 色 · 掌机绿',
    desc: '四阶绿色，物体只能靠明暗而不是色相来区分。设计时要先看灰度：灰度里分不清的东西，上了色也分不清。',
    palette: GB,
    ramp: true,
    theme: ['#9bbc0f', '#0f380f', '#306230'],
  },
  {
    key: '1 位',
    era: '1984 · 早期个人电脑',
    bits: 1,
    voice: '1 位蜂鸣器 · 用快速琶音假装和弦',
    name: '1 位 · 只有黑白',
    desc: '只剩亮与暗，轮廓成了唯一的语言。打开“有序抖动”，用棋盘格的疏密假装出灰色——这是早期电脑最古老的魔法。',
    palette: BW,
    ramp: true,
    theme: ['#ffffff', '#000000', '#000000'],
  },
]

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5)

function quantize(src: ImageData, stage: Stage, dither: boolean): ImageData {
  const out = new ImageData(16, 16)
  const pal = stage.palette
  for (let i = 0; i < 256; i++) {
    const o = i * 4
    const a = src.data[o + 3]
    if (a === 0) continue
    let r = src.data[o], g = src.data[o + 1], b = src.data[o + 2]
    let c: RGB = [r, g, b]
    if (pal) {
      const bay = dither ? BAYER4[(((i / 16) | 0) % 4) * 4 + (i % 4)] : 0
      if (stage.ramp) {
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        const n = pal.length
        const idx = Math.max(0, Math.min(n - 1, Math.floor((lum + bay / (n - 1)) * n)))
        c = pal[idx]
      } else {
        const s = 64
        r += bay * s; g += bay * s; b += bay * s
        let best = 0, bd = Infinity
        for (let k = 0; k < pal.length; k++) {
          const dr = r - pal[k][0], dg = g - pal[k][1], db = b - pal[k][2]
          const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db
          if (d < bd) { bd = d; best = k }
        }
        c = pal[best]
      }
    }
    out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255
  }
  return out
}

export function createDepth(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.depth-canvas')!
  const ctx = canvas.getContext('2d')!
  const nameEl = el.querySelector<HTMLElement>('.depth-stage-name')!
  const descEl = el.querySelector<HTMLElement>('.depth-stage-desc')!
  const steps = el.querySelector<HTMLElement>('.depth-steps')!
  const palEl = el.querySelector<HTMLElement>('.depth-palette')!
  const ditherBox = el.querySelector<HTMLInputElement>('.dither-toggle')!
  const eraEl = el.querySelector<HTMLElement>('.depth-era')!

  const COLS = 8, SCALE = 6, CELL = 96
  const list = sprites.slice(0, 48)
  const order = list.map((_, i) => i).sort(() => Math.random() - 0.5)
  let stage = 0
  let acc = 0
  let lockUntil = 0

  // a sample of the original colours, for the stage-0 swatch row
  const origColors = (() => {
    const counts = new Map<string, number>()
    for (const s of list) for (let i = 0; i < 256; i++) {
      if (s.data.data[i * 4 + 3] === 0) continue
      const k = `${s.data.data[i * 4]},${s.data.data[i * 4 + 1]},${s.data.data[i * 4 + 2]}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    // spread across hue so the swatch row shows the range, not just outline darks
    const keys = [...counts.keys()].map((k) => k.split(',').map(Number) as RGB)
    const hueOf = ([r, g, b]: RGB) => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      if (mx - mn < 24) return 2 + mx / 255
      const d = mx - mn
      const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      return h / 6
    }
    keys.sort((a, b) => hueOf(a) - hueOf(b))
    const step = keys.length / 48
    const top = Array.from({ length: 48 }, (_, i) => `rgb(${keys[Math.floor(i * step)].join(',')})`)
    return { total: counts.size, top }
  })()

  STAGES.forEach((s, i) => {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = s.key
    b.addEventListener('click', () => setStage(i))
    b.addEventListener('pointerenter', () => sound.tick(1500 + i * 140, 0.012))
    li.append(b)
    steps.append(li)
  })

  function drawSprite(k: number, st: Stage) {
    const q = quantize(list[k].data, st, ditherBox.checked)
    const x0 = (k % COLS) * CELL + 8, y0 = Math.floor(k / COLS) * CELL + 8
    ctx.clearRect(x0 - 8, y0 - 8, CELL, CELL)
    for (let i = 0; i < 256; i++) {
      const o = i * 4
      if (q.data[o + 3] === 0) continue
      ctx.fillStyle = `rgb(${q.data[o]},${q.data[o + 1]},${q.data[o + 2]})`
      ctx.fillRect(x0 + (i % 16) * (SCALE - 1) + 0, y0 + ((i / 16) | 0) * (SCALE - 1), SCALE - 1, SCALE - 1)
    }
  }

  function render(animate: boolean) {
    const st = STAGES[stage]
    if (!animate || reducedMotion) {
      list.forEach((_, k) => drawSprite(k, st))
      return
    }
    const o = { n: 0 }
    gsap.to(o, {
      n: list.length, duration: 0.45, ease: 'steps(12)', overwrite: true,
      onUpdate: () => { for (let j = 0; j < Math.floor(o.n); j++) drawSprite(order[j], st) },
      onComplete: () => list.forEach((_, k) => drawSprite(k, st)),
    })
  }

  function setStage(i: number, animate = true) {
    stage = Math.max(0, Math.min(STAGES.length - 1, i))
    const st = STAGES[stage]
    const [bg, fg, ac] = st.theme
    el.style.setProperty('--depth-bg', bg)
    el.style.setProperty('--depth-fg', fg)
    el.style.setProperty('--depth-accent', ac)
    document.documentElement.style.setProperty('--chapter-fg', fg)
    nameEl.textContent = `${stage + 1}/${STAGES.length} · ${st.name}`
    eraEl.textContent = `${st.era} · 音色：${st.voice}`
    descEl.textContent = st.desc
    steps.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === stage)))
    palEl.replaceChildren(
      ...(st.palette ? st.palette.map((c) => `rgb(${c.join(',')})`) : origColors.top).map((c) => {
        const i = document.createElement('i')
        i.style.background = c
        return i
      }),
    )
    if (!st.palette) palEl.title = `这 48 张素材共用了 ${origColors.total} 种颜色`
    render(animate)
    if (animate) sound.eraJingle(stage)
  }

  // replay the era's jingle by clicking the board
  canvas.addEventListener('click', () => sound.eraJingle(stage))
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('is-active') || e.target instanceof HTMLInputElement) return
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    // at either end the key is left alone, so the page can offer the next section
    if (!dir || stage + dir < 0 || stage + dir >= STAGES.length) return
    setStage(stage + dir)
    e.preventDefault()
  })
  ditherBox.addEventListener('change', () => {
    sound.click()
    render(true)
  })
  setStage(0, false)

  return {
    id: 'depth',
    num: '色深',
    title: '色深',
    color: '#14121c',
    transition: 'dither',
    el,
    atEnd: () => stage >= STAGES.length - 1,
    consume(delta) {
      const now = performance.now()
      if (now < lockUntil) return true
      if (delta > 0 && stage >= STAGES.length - 1) return false
      if (delta < 0 && stage <= 0) return false
      acc += delta
      if (Math.abs(acc) > 160) {
        setStage(stage + Math.sign(acc))
        acc = 0
        lockUntil = now + 520
      }
      return true
    },
    enter() {
      setStage(stage, false)
      acc = 0
      lockUntil = performance.now() + 400
    },
    leave() {
      document.documentElement.style.removeProperty('--chapter-fg')
    },
  }
}
