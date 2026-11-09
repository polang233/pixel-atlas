/**
 * 02 · 显像管. A tiny game screen drawn at 256×144, shown through a CRT
 * shader that is switched on one layer at a time: scanlines → shadow mask →
 * bloom (where checkerboard dither melts into a new colour) → curved glass.
 */
import gsap from 'gsap'
import { sound } from '../audio'
import type { Sprite } from '../sprites'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'

const SW = 256
const SH = 144

const STAGES = [
  { key: '原始', name: '原始像素', desc: '这是模拟器默认的样子：每个像素一个硬边方块。干净，但它不是当年玩家看到的画面。' },
  { key: '扫描线', name: '扫描线', desc: '电子束一行一行扫过屏幕，行与行之间留下暗缝。亮的像素光束更粗，暗的更细——所以亮处的扫描线几乎看不见。' },
  { key: '荫罩', name: '荧光粉与荫罩', desc: '凑近看，每个“像素”其实是红、绿、蓝三条荧光粉。颜色是在你眼睛里混出来的。' },
  { key: '光晕', name: '光晕与模糊', desc: '信号带宽有限，相邻像素会互相渗色。看左下角那块红蓝棋盘格：在这里它被糊成了紫色——当年的美术就是靠这个，用两种颜色“抖”出第三种。' },
  { key: '曲面', name: '曲面玻璃', desc: '玻璃是凸的，四角更暗，画面还会轻轻闪烁。你记忆里的“像素感”，有一半其实是这块玻璃。按住画面看原始像素对比。' },
]

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uSrc;
uniform float uStage;
uniform float uTime;
uniform float uRaw;
out vec4 o;

vec3 fetchRow(vec2 uv, float blur) {
  // horizontal beam smear: blend neighbours along the scanline
  vec2 px = uv * uSrc;
  float x = px.x - 0.5;
  float fx = fract(x);
  float y = floor(px.y) + 0.5;
  vec3 a = texture(uTex, vec2(floor(x) + 0.5, y) / uSrc).rgb;
  vec3 b = texture(uTex, vec2(floor(x) + 1.5, y) / uSrc).rgb;
  vec3 c = texture(uTex, vec2(floor(x) - 0.5, y) / uSrc).rgb;
  vec3 d = texture(uTex, vec2(floor(x) + 2.5, y) / uSrc).rgb;
  vec3 sharp = mix(a, b, step(0.5, fx));
  vec3 soft = mix(a, b, smoothstep(0.0, 1.0, fx)) * 0.7 + (c * (1.0 - fx) + d * fx) * 0.3;
  return mix(sharp, soft, blur);
}

void main() {
  vec2 f = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // fit 16:9 into the canvas
  float scale = min(uRes.x / uSrc.x, uRes.y / uSrc.y);
  vec2 size = uSrc * scale;
  vec2 origin = (uRes - size) * 0.5;
  vec2 uv = (f - origin) / size;

  float s1 = clamp(uStage, 0.0, 1.0) * (1.0 - uRaw);
  float s2 = clamp(uStage - 1.0, 0.0, 1.0) * (1.0 - uRaw);
  float s3 = clamp(uStage - 2.0, 0.0, 1.0) * (1.0 - uRaw);
  float s4 = clamp(uStage - 3.0, 0.0, 1.0) * (1.0 - uRaw);

  // curved glass
  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + s4 * dot(cc, cc) * 0.22);
  vec3 bezel = vec3(0.02, 0.018, 0.03);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(bezel, 1.0); return; }

  vec3 col = fetchRow(uv, s3);
  // glow: a wide blurry copy added on top
  if (s3 > 0.0) {
    vec3 g = vec3(0.0);
    for (int i = -3; i <= 3; i++) for (int j = -2; j <= 2; j++) {
      g += texture(uTex, uv + vec2(float(i), float(j)) * 1.4 / uSrc).rgb;
    }
    g /= 35.0;
    col = mix(col, max(col, g), 0.35 * s3) + g * g * 0.25 * s3;
  }
  // scanlines: gaussian beam whose width grows with brightness
  float py = fract(uv.y * uSrc.y) - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float sigma = mix(0.18, 0.42, clamp(lum, 0.0, 1.0));
  float beam = exp(-py * py / (2.0 * sigma * sigma));
  col *= mix(1.0, beam * 1.25, s1);
  // aperture grille: vertical RGB stripes in screen space
  float stripe = mod(floor(f.x / max(1.0, scale / 3.0)), 3.0);
  vec3 mask = stripe < 1.0 ? vec3(1.0, 0.55, 0.55) : stripe < 2.0 ? vec3(0.55, 1.0, 0.55) : vec3(0.55, 0.55, 1.0);
  col *= mix(vec3(1.0), mask * 1.3, s2);
  // vignette, flicker, rolling refresh band, corner mask
  vec2 v = uv - 0.5;
  col *= mix(1.0, 1.0 - dot(v, v) * 1.6, s4);
  col *= 1.0 - s4 * 0.025 * sin(uTime * 110.0);
  float band = smoothstep(0.0, 0.05, 0.05 - abs(fract(uv.y * 0.8 - uTime * 0.15) - 0.5));
  col += s4 * band * 0.035;
  vec2 corner = abs(v) - (0.5 - 0.04);
  float round_ = length(max(corner, 0.0));
  if (round_ > 0.04 * s4 && s4 > 0.0) col = mix(col, bezel, smoothstep(0.035, 0.045, round_) * s4);
  o = vec4(col, 1.0);
}`

// 3×5 pixel font for the HUD text
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  S: '111100111001111', C: '111100100100111', O: '111101101101111', R: '110101110101101', E: '111100110100111',
  x: '000101010101000', L: '100100100100111', V: '101101101101010',
}

export function createCrt(el: HTMLElement, sprites: Sprite[]): Chapter {
  const canvas = el.querySelector<HTMLCanvasElement>('.crt-gl')!
  const nameEl = el.querySelector<HTMLElement>('.crt-stage-name')!
  const descEl = el.querySelector<HTMLElement>('.crt-stage-desc')!
  const steps = el.querySelector<HTMLElement>('.crt-steps')!

  const src = document.createElement('canvas')
  src.width = SW
  src.height = SH
  const sctx = src.getContext('2d')!
  sctx.imageSmoothingEnabled = false

  const spr = (re: RegExp, k = 0) => sprites.filter((s) => re.test(s.subject))[k] ?? sprites[k]
  const sprCanvas = (s: Sprite) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    c.getContext('2d')!.putImageData(s.data, 0, 0)
    return c
  }
  const knight = sprCanvas(spr(/knight/))
  const slimes = [sprCanvas(spr(/^slime/)), sprCanvas(spr(/king slime/)), sprCanvas(spr(/slime/, 2))]
  const coin = sprCanvas(spr(/coin/))
  const heart = sprCanvas(spr(/heart/))
  const chest = sprCanvas(spr(/chest/))
  const ghost = sprCanvas(spr(/ghost/))
  const castle = sprCanvas(spr(/castle/))
  const dragon = sprCanvas(spr(/dragon/))
  const stars = Array.from({ length: 40 }, () => [Math.random() * SW, Math.random() * 60, Math.random() * 10])

  function text(s: string, x: number, y: number, color: string) {
    sctx.fillStyle = color
    for (const ch of s) {
      const g = FONT[ch]
      if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') sctx.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1)
      x += 4
    }
  }

  function drawScene(t: number) {
    // sky: banded gradient with checkerboard dither between bands
    const bands = ['#120c2c', '#1d1b4f', '#2f3a83', '#4a64b8', '#7b97dc', '#b7c7ee']
    const bandH = 14
    for (let b = 0; b < bands.length; b++) {
      sctx.fillStyle = bands[b]
      sctx.fillRect(0, b * bandH, SW, bandH)
      if (b < bands.length - 1) {
        sctx.fillStyle = bands[b + 1]
        for (let x = 0; x < SW; x++) for (let y = 0; y < 4; y++) if ((x + y) % 2 === 0 && y >= 2 - 0) sctx.fillRect(x, b * bandH + bandH - 4 + y, 1, 1)
      }
    }
    for (const [x, y, p] of stars) {
      if (Math.sin(t * 2 + p) > -0.3) {
        sctx.fillStyle = '#ffffff'
        sctx.fillRect(x | 0, y | 0, 1, 1)
      }
    }
    // hills
    sctx.fillStyle = '#2b3d6b'
    for (let x = 0; x < SW; x++) {
      const h = 18 + Math.round(Math.sin(x * 0.04) * 8 + Math.sin(x * 0.11) * 3)
      sctx.fillRect(x, 100 - h, 1, h)
    }
    sctx.drawImage(castle, 196, 64, 32, 32)
    sctx.fillStyle = '#1f2c4f'
    for (let x = 0; x < SW; x++) {
      const h = 10 + Math.round(Math.sin(x * 0.07 + 2) * 5)
      sctx.fillRect(x, 104 - h, 1, h)
    }
    // ground: brick tiles
    for (let ty = 104; ty < SH; ty += 8)
      for (let tx = 0; tx < SW; tx += 16) {
        const off = ((ty - 104) / 8) % 2 ? 8 : 0
        sctx.fillStyle = '#7a3f2a'
        sctx.fillRect(tx - off, ty, 16, 8)
        sctx.fillStyle = '#a8603c'
        sctx.fillRect(tx - off + 1, ty + 1, 14, 1)
        sctx.fillStyle = '#3a1d16'
        sctx.fillRect(tx - off + 15, ty, 1, 8)
        sctx.fillRect(tx - off, ty + 7, 16, 1)
      }
    sctx.fillStyle = '#5bbf4a'
    sctx.fillRect(0, 103, SW, 2)
    // dither showcase: red/blue checkerboard
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 30; x++) {
        sctx.fillStyle = (x + y) % 2 ? '#e8303a' : '#2c4bff'
        sctx.fillRect(10 + x, 118 + y, 1, 1)
      }
    // actors
    const k = Math.floor(t * 6)
    const kx = 60 + Math.round(Math.sin(t * 0.6) * 30)
    sctx.save()
    if (Math.cos(t * 0.6) < 0) {
      sctx.translate(kx * 2 + 16, 0)
      sctx.scale(-1, 1)
    }
    sctx.drawImage(knight, kx, 88 - (k % 2), 16, 16)
    sctx.restore()
    slimes.forEach((s, i) => {
      const hop = Math.max(0, Math.sin(t * 4 + i * 2)) * 6
      sctx.drawImage(s, 120 + i * 26, 88 - Math.round(hop), 16, 16)
    })
    for (let i = 0; i < 5; i++) {
      const w = Math.max(1, Math.round(Math.abs(Math.cos(t * 3 + i)) * 16))
      sctx.drawImage(coin, 104 + i * 18 + (16 - w) / 2, 62 + Math.round(Math.sin(t * 3 + i) * 2), w, 16)
    }
    sctx.drawImage(chest, 224, 88, 16, 16)
    sctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 2)
    sctx.drawImage(ghost, 170, 44 + Math.round(Math.sin(t * 1.3) * 4), 16, 16)
    sctx.globalAlpha = 1
    sctx.drawImage(dragon, 20 + ((t * 18) % (SW + 40)) - 20, 24 + Math.round(Math.sin(t * 2) * 3), 16, 16)
    // HUD
    for (let i = 0; i < 3; i++) sctx.drawImage(heart, 4 + i * 11, 4, 10, 10)
    text('SCORE', 180, 6, '#ffffff')
    text(String(4200 + (Math.floor(t * 10) % 100) * 10).padStart(6, '0'), 204, 6, '#ffd84d')
    text('LV', 4, 18, '#ffffff')
    text('3', 14, 18, '#7cff4f')
  }

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  let draw = (_t: number) => {}
  const shown = { s: 0 }
  let raw = 0
  if (gl) {
    const prog = gl.createProgram()!
    for (const [type, s] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, FRAG],
    ] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, s)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh))
      gl.attachShader(prog, sh)
    }
    gl.linkProgram(prog)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const U = (n: string) => gl.getUniformLocation(prog, n)
    gl.uniform2f(U('uSrc'), SW, SH)
    const uRes = U('uRes')
    const uStage = U('uStage')
    const uTime = U('uTime')
    const uRaw = U('uRaw')
    draw = (t) => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      drawScene(t)
      gl.viewport(0, 0, w, h)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uStage, shown.s)
      gl.uniform1f(uTime, t)
      gl.uniform1f(uRaw, raw)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  let stage = 0
  let acc = 0
  let lockUntil = 0
  let raf = 0
  let active = false

  STAGES.forEach((s, i) => {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = s.key
    b.addEventListener('click', () => setStage(i))
    li.append(b)
    steps.append(li)
  })

  function setStage(i: number, animate = true) {
    const prev = stage
    stage = Math.max(0, Math.min(STAGES.length - 1, i))
    const s = STAGES[stage]
    nameEl.textContent = `${stage + 1}/${STAGES.length} · ${s.name}`
    descEl.textContent = s.desc
    steps.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === stage)))
    gsap.to(shown, { s: stage, duration: animate && !reducedMotion ? 0.5 : 0, ease: 'steps(6)', overwrite: true })
    if (animate && prev !== stage) sound.relay()
  }

  const hold = (v: number) => () => {
    raw = v
    if (v) sound.relay()
  }
  canvas.addEventListener('pointerdown', hold(1))
  canvas.addEventListener('pointerup', hold(0))
  canvas.addEventListener('pointerleave', () => (raw = 0))

  const t0 = performance.now()
  const loop = () => {
    draw((performance.now() - t0) / 1000)
    if (active) raf = requestAnimationFrame(loop)
  }
  setStage(0, false)

  return {
    id: 'crt',
    num: '02',
    title: '显像管',
    color: '#000000',
    transition: 'crt',
    ambience: 'crt',
    el,
    consume(delta) {
      const now = performance.now()
      if (delta > 0 && stage >= STAGES.length - 1) return false
      if (delta < 0 && stage <= 0) return false
      if (now < lockUntil) return true
      acc += delta
      if (Math.abs(acc) > 160) {
        setStage(stage + Math.sign(acc))
        acc = 0
        lockUntil = now + 520
      }
      return true
    },
    enter(dir) {
      setStage(dir === 1 ? 0 : STAGES.length - 1, false)
      acc = 0
      lockUntil = performance.now() + 400
      active = true
      cancelAnimationFrame(raf)
      loop()
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
    },
  }
}
