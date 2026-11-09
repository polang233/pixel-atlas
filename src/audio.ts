/**
 * Synthesised chiptune-ish sound. No audio files: everything is oscillators,
 * noise and envelopes, so the sound has the same "made of tiny parts" feel as
 * the pixels.
 *
 * Routing: sfx → sfxBus ┐
 *          ambience → ambBus ┼→ master → compressor → out
 * Browsers only allow audio after a click/key press; wheel scrolling does
 * not count, so the HUD shows a button until the context is unlocked.
 */

import type { AmbienceName as AmbName } from './types'

interface Ambience {
  out: GainNode
  set(key: string, v: number): void
  stop(): void
}

const STORE = 'pixel-atlas:sound'

class Sound {
  ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private ambBus!: GainNode
  private noiseBuf!: AudioBuffer
  private brownBuf!: AudioBuffer
  private amb: { name: AmbName; a: Ambience } | null = null
  private wantedAmb: AmbName | null = null
  private listeners = new Set<() => void>()
  private lastTick = 0
  muted = false
  /** when the context first started running (a click that unlocks shouldn't also toggle mute) */
  unlockedAt = 0

  constructor() {
    try {
      this.muted = localStorage.getItem(STORE) === 'off'
    } catch {
      /* storage may be unavailable */
    }
    const unlock = () => {
      this.unlock()
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true)
        window.removeEventListener('keydown', unlock, true)
        window.removeEventListener('touchend', unlock, true)
      }
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    window.addEventListener('touchend', unlock, true)
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) this.ctx.suspend()
      else this.ctx.resume()
    })
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted
  }
  get unlocked() {
    return !!this.ctx && this.ctx.state === 'running'
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
  }
  private emit() {
    this.listeners.forEach((f) => f())
  }

  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.8
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.ratio.value = 4
      this.master.connect(comp).connect(ctx.destination)
      this.sfxBus = ctx.createGain()
      this.ambBus = ctx.createGain()
      this.sfxBus.connect(this.master)
      this.ambBus.connect(this.master)
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      this.brownBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
      const b = this.brownBuf.getChannelData(0)
      let last = 0
      for (let i = 0; i < b.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        b[i] = last * 3.5
      }
    }
    if (this.ctx.state === 'running' && !this.unlockedAt) {
      this.unlockedAt = performance.now()
      queueMicrotask(() => this.emit())
    }
    if (this.ctx.state !== 'running') {
      this.ctx.resume().then(() => {
        if (!this.unlockedAt) this.unlockedAt = performance.now()
        if (this.wantedAmb && !this.amb) this.ambience(this.wantedAmb)
        this.emit()
      })
    }
  }

  setMuted(m: boolean) {
    this.muted = m
    try {
      localStorage.setItem(STORE, m ? 'off' : 'on')
    } catch {
      /* ignore */
    }
    if (!m) this.unlock()
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
    this.emit()
  }

  // ---- primitives ----------------------------------------------------------

  private now() {
    return this.ctx!.currentTime
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  /** one oscillator note with optional pitch slide */
  tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; at?: number; attack?: number; dest?: AudioNode } = {}) {
    if (!this.ready) return
    const t = this.now() + (opts.at ?? 0)
    const o = this.ctx!.createOscillator()
    const g = this.ctx!.createGain()
    o.type = opts.type ?? 'square'
    o.frequency.setValueAtTime(freq, t)
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur)
    this.env(g, t, opts.vol ?? 0.06, opts.attack ?? 0.004, dur)
    o.connect(g).connect(opts.dest ?? this.sfxBus)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  /** filtered noise burst with a filter sweep */
  noise(dur: number, opts: { f0?: number; f1?: number; q?: number; type?: BiquadFilterType; vol?: number; at?: number; attack?: number; brown?: boolean } = {}) {
    if (!this.ready) return
    const t = this.now() + (opts.at ?? 0)
    const src = this.ctx!.createBufferSource()
    src.buffer = opts.brown ? this.brownBuf : this.noiseBuf
    src.loop = true
    const f = this.ctx!.createBiquadFilter()
    f.type = opts.type ?? 'bandpass'
    f.Q.value = opts.q ?? 1
    f.frequency.setValueAtTime(opts.f0 ?? 1200, t)
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + dur)
    const g = this.ctx!.createGain()
    this.env(g, t, opts.vol ?? 0.08, opts.attack ?? 0.005, dur)
    src.connect(f).connect(g).connect(this.sfxBus)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.1)
  }

  /** arpeggio */
  arp(notes: number[], step = 0.055, opts: { type?: OscillatorType; vol?: number; len?: number; dest?: AudioNode; at?: number } = {}) {
    notes.forEach((n, i) => this.tone(n, opts.len ?? step * 1.6, { type: opts.type, vol: opts.vol ?? 0.05, at: (opts.at ?? 0) + i * step, dest: opts.dest }))
  }

  /** a quantiser for the "colour depth" sounds: fewer bits = crunchier */
  private crusher(bits: number): AudioNode {
    const ws = this.ctx!.createWaveShaper()
    const n = 4096
    const curve = new Float32Array(n)
    const L = 2 ** (bits - 1)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = bits >= 16 ? x : Math.round(x * L) / L
    }
    ws.curve = curve
    const post = this.ctx!.createGain()
    post.gain.value = 0.07
    ws.connect(post).connect(this.sfxBus)
    setTimeout(() => ws.disconnect(), 2500)
    return ws
  }

  /** the same little chime, played at a given bit depth */
  depthChime(bits: number) {
    if (!this.ready) return
    const dest = this.crusher(bits)
    this.arp([523, 659, 784, 1047], 0.075, { type: 'triangle', vol: 0.75, len: 0.32, dest })
  }

  // ---- named sounds ---------------------------------------------------------

  tick(freq = 2200, vol = 0.018) {
    const n = performance.now()
    if (n - this.lastTick < 28) return
    this.lastTick = n
    this.tone(freq, 0.018, { vol, type: 'square' })
  }
  click() {
    this.tone(880, 0.04, { vol: 0.05, slide: 1320 })
  }
  key() {
    this.tone(1600 + Math.random() * 900, 0.012, { vol: 0.02 })
    this.noise(0.015, { f0: 5000, q: 2, vol: 0.02 })
  }
  select() {
    this.arp([660, 990, 1320], 0.045, { vol: 0.045 })
  }
  lock() {
    this.arp([523, 659, 784, 1047], 0.06, { vol: 0.05, type: 'triangle', len: 0.3 })
  }
  whoosh(dur = 0.8, up = true) {
    this.noise(dur, { f0: up ? 300 : 2400, f1: up ? 2400 : 300, q: 1.4, vol: 0.06, attack: dur * 0.4 })
  }
  results(n: number) {
    const k = Math.min(5, Math.max(1, Math.round(Math.log10(n + 1) * 1.4)))
    this.arp([392, 523, 659, 784, 1047].slice(0, k), 0.04, { vol: 0.04 })
  }
  nothing() {
    this.tone(220, 0.18, { vol: 0.05, slide: 150 })
  }
  hit() {
    this.noise(0.12, { f0: 2400, f1: 300, q: 0.8, vol: 0.14 })
    this.tone(240, 0.14, { vol: 0.1, slide: 70 })
  }
  bubble(vol = 0.03) {
    const f = 300 + Math.random() * 500
    this.tone(f, 0.07, { type: 'sine', vol, slide: f * 2.6 })
  }
  sonar() {
    if (!this.ready) return
    const ctx = this.ctx!
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.32
    const fb = ctx.createGain()
    fb.gain.value = 0.42
    const lp = ctx.createBiquadFilter()
    lp.frequency.value = 1800
    delay.connect(fb).connect(lp).connect(delay)
    delay.connect(this.sfxBus)
    this.tone(1180, 0.7, { type: 'sine', vol: 0.09, dest: delay })
    this.tone(1180, 0.7, { type: 'sine', vol: 0.07 })
    setTimeout(() => delay.disconnect(), 3500)
  }
  buzz() {
    this.tone(118, 0.22, { type: 'sawtooth', vol: 0.035 })
    this.noise(0.18, { f0: 3200, q: 6, vol: 0.03 })
  }
  ignite() {
    this.noise(0.35, { f0: 600, f1: 2600, q: 0.7, vol: 0.09 })
    this.tone(180, 0.2, { type: 'triangle', vol: 0.05, slide: 360 })
  }
  relay() {
    this.noise(0.02, { f0: 3000, q: 1, vol: 0.12 })
    this.noise(0.18, { f0: 5000, type: 'highpass', vol: 0.025, at: 0.02 })
  }
  sparkle() {
    this.arp([1568, 2093], 0.035, { type: 'triangle', vol: 0.025 })
  }
  pop() {
    this.tone(520, 0.05, { type: 'square', vol: 0.04, slide: 900 })
  }

  transition(kind: string) {
    switch (kind) {
      case 'dither': {
        // 14 stepped notes falling, then rising — follows the 14-step dissolve
        const notes = Array.from({ length: 8 }, (_, i) => 1200 * 0.86 ** i)
        this.arp(notes, 0.05, { vol: 0.03, len: 0.05 })
        this.arp([...notes].reverse(), 0.05, { vol: 0.025, len: 0.05, at: 0.42 })
        break
      }
      case 'slash':
        this.noise(0.3, { f0: 800, f1: 5000, q: 0.9, vol: 0.1, attack: 0.2 })
        this.tone(110, 0.25, { type: 'sine', vol: 0.18, slide: 40, at: 0.32 })
        this.noise(0.08, { f0: 1500, q: 0.6, vol: 0.12, at: 0.32 })
        break
      case 'crt':
        this.tone(1400, 0.3, { type: 'sine', vol: 0.05, slide: 50 })
        this.noise(0.02, { f0: 3000, vol: 0.1, at: 0.34 })
        this.tone(60, 0.5, { type: 'sawtooth', vol: 0.05, at: 0.36, slide: 120 })
        this.tone(8000, 0.5, { type: 'sine', vol: 0.006, at: 0.36 })
        break
      case 'iris':
        this.tone(660, 0.34, { type: 'square', vol: 0.04, slide: 110 })
        this.tone(110, 0.34, { type: 'square', vol: 0.04, slide: 660, at: 0.36 })
        break
      case 'wave':
        this.noise(0.8, { f0: 200, f1: 900, q: 0.6, vol: 0.12, attack: 0.3, brown: true })
        this.bubble(0.04)
        setTimeout(() => this.bubble(0.03), 180)
        setTimeout(() => this.bubble(0.03), 320)
        break
      case 'glitch':
        for (let i = 0; i < 6; i++) this.tone(200 + Math.random() * 1800, 0.03, { vol: 0.04, at: i * 0.05 })
        this.noise(0.06, { f0: 6000, type: 'highpass', vol: 0.06, at: 0.3 })
        break
      case 'melt':
        this.tone(330, 0.8, { type: 'triangle', vol: 0.05, slide: 55 })
        this.tone(338, 0.8, { type: 'triangle', vol: 0.04, slide: 52 })
        break
      default:
        this.tone(440, 0.12, { type: 'triangle', vol: 0.03 })
    }
  }

  // ---- ambience ----------------------------------------------------------------

  ambience(name: AmbName | null) {
    this.wantedAmb = name
    if (!this.ctx || this.ctx.state !== 'running') return
    if (this.amb?.name === name) return
    const old = this.amb
    if (old) {
      old.a.out.gain.setTargetAtTime(0, this.now(), 0.25)
      setTimeout(() => old.a.stop(), 1500)
    }
    this.amb = null
    if (!name) return
    const a = this.buildAmb(name)
    a.out.gain.value = 0
    a.out.gain.setTargetAtTime(1, this.now(), 0.4)
    this.amb = { name, a }
  }

  /** live parameter on the current ambience (zoom wind, madness, depth…) */
  set(key: string, v: number) {
    this.amb?.a.set(key, v)
  }

  private loopSrc(brown = false) {
    const s = this.ctx!.createBufferSource()
    s.buffer = brown ? this.brownBuf : this.noiseBuf
    s.loop = true
    s.start(0, Math.random() * 1.5)
    return s
  }

  private buildAmb(name: AmbName): Ambience {
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.connect(this.ambBus)
    const nodes: (AudioScheduledSourceNode)[] = []
    const timers: number[] = []
    const params: Record<string, (v: number) => void> = {}
    const osc = (type: OscillatorType, f: number, vol: number, dest: AudioNode = out) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = vol
      o.connect(g).connect(dest)
      o.start()
      nodes.push(o)
      return { o, g }
    }
    const noiseLayer = (brown: boolean, type: BiquadFilterType, f: number, vol: number, q = 0.7) => {
      const s = this.loopSrc(brown)
      const fl = ctx.createBiquadFilter()
      fl.type = type
      fl.frequency.value = f
      fl.Q.value = q
      const g = ctx.createGain()
      g.gain.value = vol
      s.connect(fl).connect(g).connect(out)
      nodes.push(s)
      return { fl, g }
    }
    const every = (ms: number, fn: () => void) => timers.push(window.setInterval(fn, ms))
    const T = () => ctx.currentTime

    switch (name) {
      case 'space': {
        const lp = ctx.createBiquadFilter()
        lp.frequency.value = 520
        lp.connect(out)
        osc('triangle', 110, 0.03, lp)
        osc('triangle', 164.8, 0.022, lp).o.detune.value = 7
        osc('sine', 55, 0.03, lp)
        const lfo = osc('sine', 0.07, 180, lp.frequency as unknown as AudioNode)
        void lfo
        const wind = noiseLayer(false, 'bandpass', 500, 0, 0.9)
        params.wind = (v) => wind.g.gain.setTargetAtTime(Math.min(0.09, v * 0.09), T(), 0.08)
        params.pitch = (v) => wind.fl.frequency.setTargetAtTime(300 + v * 2600, T(), 0.1)
        break
      }
      case 'crt': {
        osc('sawtooth', 60, 0.012)
        osc('sine', 120, 0.008)
        osc('sine', 15734, 0.0025)
        noiseLayer(false, 'highpass', 6000, 0.006)
        break
      }
      case 'dungeon': {
        noiseLayer(true, 'lowpass', 180, 0.12)
        const fire = noiseLayer(false, 'bandpass', 900, 0.012, 0.5)
        let density = 0.3
        params.fire = (v) => {
          density = 0.2 + Math.min(1, v) * 0.6
          fire.g.gain.setTargetAtTime(0.008 + v * 0.01, T(), 0.2)
        }
        every(45, () => {
          if (Math.random() < density) this.noise(0.006 + Math.random() * 0.02, { f0: 1800 + Math.random() * 3000, q: 1.5, vol: 0.015 + Math.random() * 0.05 })
        })
        every(5200, () => Math.random() < 0.5 && this.tone(1900 + Math.random() * 400, 0.5, { type: 'sine', vol: 0.012, slide: 1700 }))
        break
      }
      case 'ocean': {
        const body = noiseLayer(true, 'lowpass', 700, 0.22)
        const lfo = osc('sine', 0.12, 120, body.fl.frequency as unknown as AudioNode)
        void lfo
        let rate = 0.5
        params.depth = (d) => {
          body.fl.frequency.setTargetAtTime(700 - d * 560, T(), 0.3)
          rate = 0.5 - d * 0.35
        }
        every(240, () => Math.random() < rate * 0.24 && this.bubble(0.012 + Math.random() * 0.02))
        break
      }
      case 'neon': {
        const rain = noiseLayer(false, 'highpass', 2400, 0.03)
        void rain
        noiseLayer(true, 'lowpass', 110, 0.1)
        const hum = ctx.createBiquadFilter()
        hum.type = 'bandpass'
        hum.frequency.value = 240
        hum.Q.value = 3
        hum.connect(out)
        osc('sawtooth', 120, 0.012, hum)
        every(140, () => Math.random() < 0.18 && this.tone(3000 + Math.random() * 3000, 0.01, { vol: 0.008 }))
        break
      }
      case 'cthulhu': {
        const a = osc('sine', 55, 0.0)
        const b = osc('sine', 58.3, 0.0)
        const w = noiseLayer(false, 'bandpass', 420, 0, 9)
        let m = 0
        params.madness = (v) => {
          m = v
          a.g.gain.setTargetAtTime(0.03 + v * 0.09, T(), 0.2)
          b.g.gain.setTargetAtTime(0.02 + v * 0.08, T(), 0.2)
          w.g.gain.setTargetAtTime(v * v * 0.05, T(), 0.3)
          w.fl.frequency.setTargetAtTime(300 + v * 500, T(), 0.3)
        }
        params.madness(0)
        let next = 0
        every(50, () => {
          const now = performance.now()
          if (now < next) return
          next = now + 1150 - m * 600
          const v = 0.05 + m * 0.14
          this.tone(62, 0.12, { type: 'sine', vol: v, slide: 38 })
          this.tone(58, 0.12, { type: 'sine', vol: v * 0.7, slide: 36, at: 0.17 })
        })
        break
      }
      case 'outro': {
        // tiny looping chiptune: square lead + triangle bass, 112 bpm
        const lead = [659, 0, 784, 659, 523, 0, 587, 659, 784, 0, 880, 784, 659, 0, 523, 587]
        const bass = [131, 131, 165, 165, 175, 175, 196, 196]
        let step = 0
        every(134, () => {
          if (!this.ready) return
          const n = lead[step % 16]
          if (n) this.tone(n, 0.12, { vol: 0.018, dest: out })
          if (step % 2 === 0) this.tone(bass[(step / 2) % 8], 0.24, { type: 'triangle', vol: 0.04, dest: out })
          if (step % 4 === 2) this.noise(0.03, { f0: 7000, type: 'highpass', vol: 0.012 })
          step++
        })
        break
      }
      default:
        break
    }
    return {
      out,
      set: (k, v) => params[k]?.(v),
      stop: () => {
        timers.forEach(clearInterval)
        nodes.forEach((n) => {
          try {
            n.stop()
          } catch {
            /* already stopped */
          }
        })
        out.disconnect()
      },
    }
  }
}

export const sound = new Sound()
