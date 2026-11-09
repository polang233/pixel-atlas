import gsap from 'gsap'
import type { Chapter } from '../types'
import { reducedMotion } from '../types'
import { loadImage } from '../sprites'

interface MosaicMeta {
  side: number
  count: number
  window: number
  origin: [number, number]
  target: [number, number]
  targetId: number
  targetCaption: string
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uOverview;
uniform sampler2D uDetail;
uniform vec2 uRes;
uniform vec2 uCenter;   // camera centre in cell units
uniform float uZoom;    // device px per cell
uniform float uSide;
uniform vec2 uOrigin;
uniform float uWin;
uniform float uDetailMix;
uniform float uGrid;
uniform vec2 uTarget;
uniform float uAngle;
uniform float uTime;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main() {
  vec2 f = gl_FragCoord.xy;
  vec2 d = vec2(f.x - uRes.x * 0.5, uRes.y * 0.5 - f.y) / uZoom;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 cell = uCenter + mat2(c, -s, s, c) * d;

  // background: deep space with a few twinkling pixel stars
  vec2 sp = floor(f / 3.0);
  float st = step(0.9975, hash(sp)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp + 7.0) * 40.0));
  vec3 bg = vec3(0.027, 0.024, 0.047) + st * vec3(0.8, 0.8, 1.0);

  vec4 ov = texture(uOverview, cell / uSide);
  vec3 col = mix(bg, ov.rgb, ov.a);

  vec2 local = cell - uOrigin;
  if (uDetailMix > 0.0 && local.x >= 0.0 && local.y >= 0.0 && local.x < uWin && local.y < uWin) {
    vec4 sprite = texture(uDetail, local / uWin);
    vec3 cellBg = ov.rgb * 0.18 + bg * 0.5;
    vec3 det = mix(cellBg, sprite.rgb, sprite.a);
    // pixel grid on the target sprite
    vec2 tl = cell - uTarget;
    if (uGrid > 0.0 && tl.x >= 0.0 && tl.y >= 0.0 && tl.x < 1.0 && tl.y < 1.0) {
      vec2 g = fract(tl * 16.0);
      float px = 1.2 / (uZoom / 16.0);
      float line = step(g.x, px) + step(g.y, px);
      det = mix(det, vec3(1.0, 0.8, 0.3), clamp(line, 0.0, 1.0) * 0.55 * uGrid);
    } else if (uGrid > 0.0) {
      det *= 1.0 - 0.6 * uGrid;
    }
    col = mix(col, det, uDetailMix);
  }
  // vignette
  vec2 q = f / uRes - 0.5;
  col *= 1.0 - dot(q, q) * 0.9;
  o = vec4(col, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
  return sh
}

function texture(gl: WebGL2RenderingContext, img: HTMLImageElement, mip: boolean) {
  const t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  if (mip) gl.generateMipmap(gl.TEXTURE_2D)
  return t
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export async function createHero(el: HTMLElement): Promise<Chapter> {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
  const gl = canvas.getContext('webgl2', { antialias: false })
  const [meta, ovImg, detImg] = await Promise.all([
    fetch('/data/mosaic.json').then((r) => r.json() as Promise<MosaicMeta>),
    loadImage('/data/overview.png'),
    loadImage('/data/detail.png'),
  ])

  el.querySelector('[data-target-id]')!.textContent = String(meta.targetId)
  el.querySelector('[data-target-caption]')!.textContent = meta.targetCaption

  const title = el.querySelector<HTMLElement>('[data-hero="title"]')!
  const mid = el.querySelector<HTMLElement>('[data-hero="mid"]')!
  const end = el.querySelector<HTMLElement>('[data-hero="end"]')!
  const cue = el.querySelector<HTMLElement>('[data-hero="cue"]')!

  let progress = 0 // what the input asked for
  const shown = { p: 0 } // eased value actually rendered
  let raf = 0
  let active = false

  let draw = () => {}
  if (gl) {
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    texture(gl, ovImg, true)
    gl.activeTexture(gl.TEXTURE1)
    texture(gl, detImg, false)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    gl.uniform1i(u('uOverview'), 0)
    gl.uniform1i(u('uDetail'), 1)
    gl.uniform1f(u('uSide'), meta.side)
    gl.uniform2f(u('uOrigin'), meta.origin[0], meta.origin[1])
    gl.uniform1f(u('uWin'), meta.window)
    gl.uniform2f(u('uTarget'), meta.target[0], meta.target[1])
    const uRes = u('uRes'), uCenter = u('uCenter'), uZoom = u('uZoom'), uMix = u('uDetailMix')
    const uGrid = u('uGrid'), uAngle = u('uAngle'), uTime = u('uTime')
    const t0 = performance.now()
    let spin = 0
    let last = t0

    draw = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      const p = shown.p
      const short = Math.min(w, h)
      const z0 = (short / meta.side) * 0.86
      const z1 = short * 0.5
      const zp = smooth(0.04, 1, p)
      const zoom = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * zp)
      const c = meta.side / 2
      const tx = meta.target[0] + 0.5
      const ty = meta.target[1] + 0.5
      const k = smooth(0.0, 0.45, p)
      // slow spin only while zoomed out, unwinding as we dive
      if (!reducedMotion) spin += dt * 0.025 * (1 - k)
      const angle = spin * (1 - k)
      gl.uniform2f(uRes, w, h)
      gl.uniform2f(uCenter, c + (tx - c) * k, c + (ty - c) * k)
      gl.uniform1f(uZoom, zoom)
      const coverZoom = Math.max(w, h) / meta.window
      gl.uniform1f(uMix, smooth(coverZoom * 1.0, coverZoom * 2.2, zoom))
      gl.uniform1f(uGrid, smooth(0.9, 1.0, p))
      gl.uniform1f(uAngle, angle)
      gl.uniform1f(uTime, (now - t0) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      title.style.opacity = String(1 - smooth(0.02, 0.14, p))
      title.style.transform = `translateY(${-smooth(0.02, 0.14, p) * 40}px)`
      cue.style.opacity = String(1 - smooth(0.0, 0.08, p))
      mid.style.opacity = String(smooth(0.28, 0.38, p) * (1 - smooth(0.62, 0.72, p)))
      end.style.opacity = String(smooth(0.93, 1, p))
    }
  }

  const loop = () => {
    draw()
    if (active) raf = requestAnimationFrame(loop)
  }

  const setProgress = (v: number) => {
    progress = Math.min(1, Math.max(0, v))
    gsap.to(shown, { p: progress, duration: reducedMotion ? 0 : 0.9, ease: 'power3.out', overwrite: true })
  }

  return {
    id: 'hero',
    num: '00',
    title: '开场',
    color: '#07060c',
    transition: 'dither',
    el,
    consume(delta) {
      if (delta > 0 && progress >= 1) return false
      if (delta < 0 && progress <= 0) return false
      setProgress(progress + delta / 2600)
      return true
    },
    enter(dir) {
      canvas.style.visibility = 'visible'
      if (dir === -1) setProgress(1)
      active = true
      cancelAnimationFrame(raf)
      loop()
    },
    leave() {
      active = false
      cancelAnimationFrame(raf)
      canvas.style.visibility = 'hidden'
    },
  }
}
