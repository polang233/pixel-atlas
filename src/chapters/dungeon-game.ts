/**
 * 地牢 mini game · 摸黑寻宝. A small generated maze seen only by torchlight.
 * The torch is your sight and burns down as you walk; three hearts are your
 * life. Swing the sword at what bites, smash barrels, open chests, light
 * braziers, pray at idols. Find the key, find the door, go one floor deeper.
 */
import { sound } from '../audio'
import { drawText, textWidth } from '../pixelfont'
import type { Sprite } from '../sprites'

const T = 16
const CW = 9
const CH = 6
const MW = CW * 4 + 1
const MH = CH * 4 + 1
const LP = 2 // one light texel = 2 game pixels
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16)

type ItemKind = 'coin' | 'torch' | 'key' | 'door' | 'chest' | 'mimic' | 'brazier' | 'web' | 'barrel' | 'potion' | 'spikes' | 'idol'
interface Item { kind: ItemKind; x: number; y: number; img: HTMLCanvasElement; taken: boolean; lit: boolean; t: number }
type MobKind = 'rat' | 'spider' | 'skull' | 'skeleton' | 'mimic'
interface Mob { kind: MobKind; x: number; y: number; vx: number; vy: number; img: HTMLCanvasElement; t: number; next: number; face: number; hp: number; max: number; hit: number; kx: number; ky: number }
const MOB_HP: Record<MobKind, number> = { rat: 1, spider: 2, skull: 2, skeleton: 3, mimic: 4 }
const MOB_SCORE: Record<MobKind, number> = { rat: 50, spider: 120, skull: 150, skeleton: 220, mimic: 400 }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; c: string }
interface Pop { x: number; y: number; s: string; life: number; c: string }

export interface CrawlUI {
  score(n: number): void
  extra(html: string): void
  end(score: number, title: string, sub: string, won: boolean): void
}

export function createCrawl(canvas: HTMLCanvasElement, sprites: Sprite[], hero: Sprite | undefined, ui: CrawlUI) {
  const ctx = canvas.getContext('2d')!
  const sc = (s: Sprite) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    c.getContext('2d')!.putImageData(s.data, 0, 0)
    return c
  }
  const all = (re: RegExp) => {
    const list = sprites.filter((s) => re.test(s.subject))
    return (list.length ? list : sprites.slice(0, 1)).map(sc)
  }
  const one = <V,>(list: V[]) => list[(Math.random() * list.length) | 0]
  const IMG = {
    hero: hero ? [sc(hero)] : all(/skeleton warrior/),
    coin: all(/^coin/),
    torch: all(/^torch/),
    key: all(/dungeon key|skeleton key/),
    door: all(/cellar door/),
    chest: all(/^treasure chest/),
    brazier: all(/lantern|candle/),
    web: all(/spider web/),
    rat: all(/dire rat/),
    spider: all(/giant spider/),
    skull: all(/floating skull/),
    skeleton: all(/^skeleton/),
    mimic: all(/mimic chest/),
    barrel: all(/barrel/),
    potion: all(/potion vial/),
    idol: all(/skull idol/),
  }

  // ---- tiles -------------------------------------------------------------------------
  const tile = (draw: (c: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas')
    c.width = c.height = T
    draw(c.getContext('2d')!)
    return c
  }
  const floors = [0, 1, 2].map((k) =>
    tile((c) => {
      c.fillStyle = ['#2b2836', '#292633', '#2d2a39'][k]
      c.fillRect(0, 0, T, T)
      c.fillStyle = '#211e2a'
      c.fillRect(0, 0, T, 1)
      c.fillRect(k === 1 ? 7 : 0, 0, 1, T)
      if (k === 2) c.fillRect(0, 8, T, 1)
      c.fillStyle = '#353243'
      for (let i = 0; i < 5; i++) c.fillRect((i * 7 + k * 3) % 15, (i * 5 + k * 6) % 14 + 1, 1, 1)
    }),
  )
  const wallTop = tile((c) => {
    c.fillStyle = '#14121b'
    c.fillRect(0, 0, T, T)
    c.fillStyle = '#1b1824'
    for (let i = 0; i < 6; i++) c.fillRect((i * 5) % 14, (i * 7) % 14, 2, 1)
  })
  const wallFace = tile((c) => {
    c.fillStyle = '#4c4760'
    c.fillRect(0, 0, T, T)
    c.fillStyle = '#353146'
    for (let y = 0; y < T; y += 5) {
      c.fillRect(0, y + 4, T, 1)
      for (let x = (y / 5) % 2 ? 4 : 0; x < T; x += 8) c.fillRect(x, y, 1, 4)
    }
    c.fillStyle = '#6a6484'
    c.fillRect(0, 0, T, 1)
    c.fillStyle = '#1c1925'
    c.fillRect(0, 15, T, 1)
  })

  // ---- state -------------------------------------------------------------------------
  let map = new Uint8Array(MW * MH)
  let items: Item[] = []
  let mobs: Mob[] = []
  let bits: Bit[] = []
  let pops: Pop[] = []
  const P = { x: 0, y: 0, face: 1, inv: 0, walk: 0, stepT: 0, ax: 1, ay: 0, atk: 0, cd: 0 }
  let hp = 3
  let maxHp = 3
  let kills = 0
  let wantAttack = false
  let wantUse = false
  let fuel = 100
  let floor = 1
  let score = 0
  let hasKey = false
  let alive = true
  let shake = 0
  let fade = 0 // 1 → black, used between floors
  let fadeDir = 0
  let hint = ''
  let hintUntil = 0
  let last = 0
  let running = false
  let lightImg: ImageData | null = null
  const lightCanvas = document.createElement('canvas')
  const lctx = lightCanvas.getContext('2d')!
  const keys = new Set<string>()
  const pointer = { on: false, x: 0, y: 0 }
  let cam = { x: 0, y: 0 }
  let W = 0
  let H = 0
  let PX = 4

  const solid = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || map[ty * MW + tx] === 1
  const blocked = (x: number, y: number, r: number) =>
    solid(Math.floor((x - r) / T), Math.floor((y - r) / T)) || solid(Math.floor((x + r) / T), Math.floor((y - r) / T)) ||
    solid(Math.floor((x - r) / T), Math.floor((y + r) / T)) || solid(Math.floor((x + r) / T), Math.floor((y + r) / T))
  function slide(o: { x: number; y: number }, dx: number, dy: number, r: number) {
    if (!blocked(o.x + dx, o.y, r)) o.x += dx
    if (!blocked(o.x, o.y + dy, r)) o.y += dy
  }

  function spawn(kind: MobKind, x: number, y: number) {
    const max = MOB_HP[kind] + (kind === 'skeleton' && floor > 3 ? 1 : 0)
    mobs.push({ kind, x, y, vx: 0, vy: 0, img: one(IMG[kind]), t: Math.random() * 3, next: 0, face: 1, hp: max, max, hit: 0, kx: 0, ky: 0 })
  }
  function drop(kind: ItemKind, x: number, y: number) {
    const img = kind === 'coin' ? one(IMG.coin) : kind === 'torch' ? one(IMG.torch) : one(IMG.potion)
    // items thrown out of a chest must not land inside a wall
    const o = { x, y }
    slide(o, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, 5)
    items.push({ kind, x: o.x, y: o.y, img, taken: false, lit: false, t: Math.random() * 6 })
  }

  function generate() {
    map = new Uint8Array(MW * MH).fill(1)
    const carve = (x: number, y: number) => (map[y * MW + x] = 0)
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) carve(1 + cx * 4 + dx, 1 + cy * 4 + dy)
    const links = new Map<number, number[]>()
    const link = (a: number, b: number) => {
      links.set(a, [...(links.get(a) ?? []), b])
      links.set(b, [...(links.get(b) ?? []), a])
      const [ax, ay, bx, by] = [a % CW, (a / CW) | 0, b % CW, (b / CW) | 0]
      const wide = Math.random() < 0.45
      for (let k = wide ? 0 : 1; k < (wide ? 3 : 2); k++) {
        if (ax !== bx) carve(Math.max(ax, bx) * 4, 1 + ay * 4 + k)
        else carve(1 + ax * 4 + k, Math.max(ay, by) * 4)
      }
    }
    const near = (c: number) => {
      const [x, y] = [c % CW, (c / CW) | 0]
      return [x > 0 && c - 1, x < CW - 1 && c + 1, y > 0 && c - CW, y < CH - 1 && c + CW].filter((v): v is number => v !== false)
    }
    const seen = new Set([0])
    const stack = [0]
    while (stack.length) {
      const c = stack[stack.length - 1]
      const next = near(c).filter((n) => !seen.has(n))
      if (!next.length) {
        stack.pop()
        continue
      }
      const n = one(next)
      seen.add(n)
      link(c, n)
      stack.push(n)
    }
    // a few extra doors so the maze has loops to escape through
    for (let i = 0; i < 9; i++) {
      const c = (Math.random() * CW * CH) | 0
      const n = one(near(c))
      if (!links.get(c)!.includes(n)) link(c, n)
    }
    const dist = (from: number) => {
      const d = new Array<number>(CW * CH).fill(-1)
      d[from] = 0
      const q = [from]
      for (let i = 0; i < q.length; i++) for (const n of links.get(q[i])!) if (d[n] < 0) {
        d[n] = d[q[i]] + 1
        q.push(n)
      }
      return d
    }
    const d0 = dist(0)
    const doorCell = d0.indexOf(Math.max(...d0))
    const dDoor = dist(doorCell)
    let keyCell = 1
    let best = -1
    for (let c = 1; c < CW * CH; c++) {
      const v = Math.min(d0[c], dDoor[c]) + Math.random()
      if (c !== doorCell && v > best) {
        best = v
        keyCell = c
      }
    }
    const at = (c: number, ox = 1, oy = 1): [number, number] => [(1 + (c % CW) * 4 + ox + 0.5) * T, (1 + ((c / CW) | 0) * 4 + oy + 0.5) * T]
    items = []
    mobs = []
    const put = (kind: ItemKind, c: number, img: HTMLCanvasElement, ox = 1, oy = 1) => {
      const [x, y] = at(c, ox, oy)
      items.push({ kind, x, y, img, taken: false, lit: false, t: Math.random() * 6 })
    }
    put('door', doorCell, one(IMG.door))
    put('key', keyCell, one(IMG.key))
    const free = Array.from({ length: CW * CH }, (_, c) => c).filter((c) => c !== 0 && c !== doorCell && c !== keyCell).sort(() => Math.random() - 0.5)
    const take = (n: number) => free.splice(0, n)
    take(Math.max(3, 6 - floor)).forEach((c) => put('torch', c, one(IMG.torch)))
    take(4).forEach((c) => put('brazier', c, one(IMG.brazier)))
    take(3).forEach((c, i) => put(i === 0 && floor > 1 ? 'mimic' : 'chest', c, one(IMG.chest)))
    take(1).forEach((c) => put('idol', c, one(IMG.idol)))
    for (let i = 0; i < 9; i++) put('barrel', 1 + ((Math.random() * (CW * CH - 1)) | 0), one(IMG.barrel), i % 3, i % 2 ? 0 : 2)
    for (let i = 0; i < 3 + floor; i++) {
      const c = 1 + ((Math.random() * (CW * CH - 1)) | 0)
      if (c !== doorCell && c !== keyCell) put('spikes', c, floors[0], (Math.random() * 3) | 0, 1)
    }
    take(4).forEach((c) => put('web', c, one(IMG.web), (Math.random() * 3) | 0, (Math.random() * 3) | 0))
    for (let c = 1; c < CW * CH; c++) {
      if (c === doorCell || Math.random() > 0.55) continue
      const n = 1 + ((Math.random() * 3) | 0)
      const row = (Math.random() * 3) | 0
      for (let k = 0; k < n; k++) if (c !== keyCell || row !== 1 || k !== 1) put('coin', c, one(IMG.coin), k, row === 1 && k === 1 ? 0 : row)
    }
    const far = Array.from({ length: CW * CH }, (_, c) => c).filter((c) => d0[c] > 2)
    const mob = (kind: MobKind) => {
      const [x, y] = at(one(far), (Math.random() * 3) | 0, (Math.random() * 3) | 0)
      spawn(kind, x, y)
    }
    for (let i = 0; i < 3 + floor; i++) mob('rat')
    for (let i = 0; i < 1 + floor; i++) mob('spider')
    for (let i = 0; i < Math.min(4, floor - 1); i++) mob('skull')
    for (let i = 0; i < Math.min(5, 1 + Math.floor(floor / 2)); i++) mob('skeleton')
    if (floor > 1) {
      const [gx, gy] = at(doorCell, 0, 2)
      spawn('skeleton', gx, gy)
    }
    ;[P.x, P.y] = at(0)
    hasKey = false
  }

  const burst = (x: number, y: number, c: string, n = 8) => {
    for (let i = 0; i < n; i++) bits.push({ x, y, vx: (Math.random() - 0.5) * 110, vy: (Math.random() - 0.7) * 110, life: 0.35 + Math.random() * 0.35, c })
  }
  const pop = (x: number, y: number, s: string, c = '#ffd84d') => pops.push({ x, y, s, life: 1, c })
  const say = (s: string, ms = 2200) => {
    hint = s
    hintUntil = performance.now() + ms
  }
  const radius = () => (1.35 + 4.1 * Math.sqrt(Math.max(0, fuel) / 100)) * T

  function bite(amount: number, fromX: number, fromY: number) {
    if (P.inv > 0 || !alive) return
    hp--
    fuel = Math.max(0, fuel - amount * 0.4)
    P.inv = 1.1
    shake = 0.35
    const d = Math.hypot(P.x - fromX, P.y - fromY) || 1
    slide(P, ((P.x - fromX) / d) * 10, ((P.y - fromY) / d) * 10, 5)
    sound.hurt()
    burst(P.x, P.y, '#ff9a3c', 10)
    pop(P.x, P.y - 12, '-1', '#ff4d6d')
    if (hp <= 0) {
      alive = false
      sound.tone(240, 1.1, { type: 'triangle', vol: 0.05, slide: 50 })
      ui.end(score, `倒在了第 ${floor} 层`, `击倒 ${kills} 只怪物 · 剑还握在手里`, floor >= 3)
    }
  }

  function kill(m: Mob) {
    m.t = -1
    kills++
    score += MOB_SCORE[m.kind]
    burst(m.x, m.y, m.kind === 'skull' ? '#c8f4ff' : '#e8e2d0', 14)
    pop(m.x, m.y - 10, '+' + MOB_SCORE[m.kind], '#c8f4ff')
    sound.stomp()
    const r = Math.random()
    if (m.kind === 'mimic') for (let i = 0; i < 5; i++) drop('coin', m.x, m.y)
    else if (r < 0.45) drop('coin', m.x, m.y)
    else if (r < 0.58 && hp < maxHp) drop('potion', m.x, m.y)
  }

  function openChest(it: Item) {
    it.taken = true
    score += 150
    sound.win()
    burst(it.x, it.y, '#ffd84d', 22)
    pop(it.x, it.y - 10, '+150')
    for (let i = 0; i < 3; i++) drop('coin', it.x, it.y)
    drop(Math.random() < 0.5 ? 'potion' : 'torch', it.x, it.y)
  }
  function wakeMimic(it: Item) {
    it.taken = true
    say('是宝箱怪！砍它！')
    spawn('mimic', it.x, it.y)
    sound.eyeOpen()
    shake = 0.25
  }

  /** one sword swing along the aim direction */
  function attack() {
    if (P.cd > 0 || !alive) return
    P.atk = 0.16
    P.cd = 0.3
    sound.noise(0.09, { f0: 2600, f1: 700, q: 2, vol: 0.05 })
    const cx = P.x + P.ax * 12
    const cy = P.y + P.ay * 12
    let landed = false
    for (const m of mobs) {
      if (m.t < 0 || Math.hypot(m.x - cx, m.y - cy) > 15) continue
      landed = true
      m.hp--
      m.hit = 0.18
      const heavy = m.kind === 'skeleton' || m.kind === 'mimic' ? 0.6 : 1
      m.kx = P.ax * 190 * heavy
      m.ky = P.ay * 190 * heavy
      m.next = Math.max(m.next, m.t + 0.45)
      burst(m.x, m.y, '#ffffff', 5)
      if (m.hp <= 0) kill(m)
    }
    for (const it of items) {
      if (it.taken || Math.hypot(it.x - cx, it.y - cy) > 14) continue
      if (it.kind === 'barrel') {
        it.taken = true
        landed = true
        score += 20
        burst(it.x, it.y, '#a8743c', 14)
        const r = Math.random()
        if (r < 0.5) drop('coin', it.x, it.y)
        else if (r < 0.68) drop('torch', it.x, it.y)
        else if (r < 0.8 && hp < maxHp) drop('potion', it.x, it.y)
      } else if (it.kind === 'chest') {
        landed = true
        openChest(it)
      } else if (it.kind === 'mimic') {
        landed = true
        wakeMimic(it)
      } else if (it.kind === 'web') {
        it.taken = true
        burst(it.x, it.y, '#d8d8e8', 6)
      }
    }
    if (landed) {
      sound.hit()
      shake = Math.max(shake, 0.12)
    }
  }

  /** E: use whatever is in reach */
  function use(now: number) {
    let best: Item | null = null
    for (const it of items) {
      if (it.taken || !['chest', 'mimic', 'idol', 'brazier', 'door'].includes(it.kind)) continue
      const d = Math.hypot(it.x - P.x, it.y - P.y)
      if (d < 20 && (!best || d < Math.hypot(best.x - P.x, best.y - P.y))) best = it
    }
    if (!best) return
    if (best.kind === 'chest') openChest(best)
    else if (best.kind === 'mimic') wakeMimic(best)
    else if (best.kind === 'idol') {
      if (best.lit) say('神像已经闭上了眼')
      else if (score < 300) say('神像要 300 分的供奉')
      else {
        best.lit = true
        score -= 300
        maxHp = Math.min(6, maxHp + 1)
        hp = maxHp
        sound.banish()
        burst(best.x, best.y, '#c8f4ff', 20)
        pop(best.x, best.y - 12, '+1 MAX', '#ff8fa3')
        say('献上 300 分 · 生命上限 +1，伤口愈合')
      }
    } else if (best.kind === 'door' && !hasKey && now > hintUntil) say('门锁着 · 先找到钥匙')
  }

  function update(dt: number, now: number) {
    for (const b of bits) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.vy += 220 * dt
      b.life -= dt
    }
    bits = bits.filter((b) => b.life > 0)
    for (const p of pops) {
      p.y -= 16 * dt
      p.life -= dt
    }
    pops = pops.filter((p) => p.life > 0)
    shake = Math.max(0, shake - dt)
    if (fadeDir) {
      fade = Math.max(0, Math.min(1, fade + fadeDir * dt * 3.2))
      if (fade >= 1 && fadeDir > 0) {
        floor++
        fuel = Math.min(100, fuel + 30)
        generate()
        say(`第 ${floor} 层 · 更深，也更黑`)
        fadeDir = -1
      } else if (fade <= 0) fadeDir = 0
      return
    }
    if (!alive) return

    // ---- player
    let dx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0)
    let dy = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0)
    if (!dx && !dy && pointer.on) {
      const tx = pointer.x / PX + cam.x - P.x
      const ty = pointer.y / PX + cam.y - P.y
      if (Math.hypot(tx, ty) > 5) {
        dx = tx
        dy = ty
      }
    }
    const len = Math.hypot(dx, dy)
    if (len > 0) {
      const sp = 82 * dt
      slide(P, (dx / len) * sp, (dy / len) * sp, 5)
      if (P.atk <= 0) {
        P.ax = dx / len
        P.ay = dy / len
      }
      if (Math.abs(dx) > 0.2 * len) P.face = Math.sign(dx)
      P.walk += dt
      P.stepT -= dt
      if (P.stepT <= 0) {
        P.stepT = 0.26
        sound.step()
      }
    }
    P.inv = Math.max(0, P.inv - dt)
    P.atk = Math.max(0, P.atk - dt)
    P.cd = Math.max(0, P.cd - dt)
    if (wantAttack) attack()
    if (wantUse) use(now)
    wantAttack = wantUse = false
    fuel = Math.max(0, fuel - dt * (100 / 100) * (1 + (floor - 1) * 0.07))
    const R = radius()

    // ---- items
    for (const it of items) {
      it.t += dt
      if (it.taken) continue
      const d = Math.hypot(it.x - P.x, it.y - P.y)
      if (d > 11) continue
      switch (it.kind) {
        case 'coin':
          it.taken = true
          score += 100
          sound.coin()
          burst(it.x, it.y, '#ffd84d', 5)
          break
        case 'torch':
          it.taken = true
          fuel = Math.min(100, fuel + 34)
          sound.ignite()
          burst(it.x, it.y, '#ffb347', 12)
          pop(it.x, it.y - 10, '+34')
          break
        case 'key':
          it.taken = true
          hasKey = true
          sound.lock()
          say('拿到钥匙了 · 去找那扇发蓝光的门')
          burst(it.x, it.y, '#fff3b0', 14)
          break
        case 'brazier':
          if (!it.lit) {
            it.lit = true
            score += 50
            sound.ignite()
            pop(it.x, it.y - 10, '+50')
            for (const m of mobs) if (m.kind === 'skull' && Math.hypot(m.x - it.x, m.y - it.y) < 3.4 * T) kill(m)
          }
          break
        case 'chest':
        case 'mimic':
          if (now > hintUntil) say('挥剑或按 E 开箱', 900)
          break
        case 'idol':
          if (!it.lit && now > hintUntil) say('骷髅神像 · 按 E 献上 300 分，换一颗心', 900)
          break
        case 'potion':
          if (hp >= maxHp) break
          it.taken = true
          hp++
          sound.grow()
          burst(it.x, it.y, '#ff8fa3', 10)
          pop(it.x, it.y - 10, '+1', '#ff8fa3')
          break
        case 'spikes':
          if (it.t % 2.6 > 1.5 && d < 9) bite(10, it.x, it.y + 1)
          break
        case 'barrel':
          break
        case 'door':
          if (hasKey) {
            it.taken = true
            score += 500 * floor
            sound.door()
            fadeDir = 1
          } else if (now > hintUntil) say('门锁着 · 先找到钥匙')
          break
        case 'web':
          break
      }
    }
    mobs = mobs.filter((m) => m.t >= 0)

    // ---- monsters
    const litBy = (x: number, y: number) => items.some((it) => it.kind === 'brazier' && it.lit && Math.hypot(it.x - x, it.y - y) < 3.2 * T)
    for (const m of mobs) {
      m.t += dt
      m.hit = Math.max(0, m.hit - dt)
      if (Math.abs(m.kx) + Math.abs(m.ky) > 6) {
        if (m.kind === 'skull') {
          m.x += m.kx * dt
          m.y += m.ky * dt
        } else slide(m, m.kx * dt, m.ky * dt, 4)
        m.kx *= 0.82
        m.ky *= 0.82
        continue
      }
      const ddx = P.x - m.x
      const ddy = P.y - m.y
      const d = Math.hypot(ddx, ddy) || 1
      if (m.kind === 'rat') {
        if (d < Math.min(R, 5 * T)) {
          m.vx = (ddx / d) * 50
          m.vy = (ddy / d) * 50
        } else if (m.t > m.next) {
          m.next = m.t + 0.5 + Math.random()
          const a = Math.random() * Math.PI * 2
          const v = Math.random() < 0.3 ? 0 : 34
          m.vx = Math.cos(a) * v
          m.vy = Math.sin(a) * v
        }
        slide(m, m.vx * dt, m.vy * dt, 4)
      } else if (m.kind === 'spider') {
        // sits still, then lunges in a straight line
        if (m.t > m.next && d < 3.4 * T) {
          m.next = m.t + 2.1
          m.vx = (ddx / d) * 118
          m.vy = (ddy / d) * 118
          sound.tick(300, 0.03)
        }
        const k = m.next - m.t
        if (k > 1.25) slide(m, m.vx * dt, m.vy * dt, 4)
      } else if (m.kind === 'skeleton') {
        // walks you down, stops to wind up, then lunges
        if (m.t > m.next && d < 26) {
          m.next = m.t + 1.5
          m.vx = (ddx / d) * 130
          m.vy = (ddy / d) * 130
          sound.tick(220, 0.03)
        }
        const k = m.next - m.t
        if (k > 1.02) {
          /* wind-up: stand still and shake */
        } else if (k > 0.78) slide(m, m.vx * dt, m.vy * dt, 4)
        else if (d < Math.max(R, 4 * T) + T) slide(m, (ddx / d) * 30 * dt, (ddy / d) * 30 * dt, 4)
      } else if (m.kind === 'mimic') {
        // hops: a pause, then a leap
        if (m.t > m.next) {
          m.next = m.t + 0.75
          m.vx = (ddx / d) * 150
          m.vy = (ddy / d) * 150
        }
        if (m.next - m.t > 0.5) slide(m, m.vx * dt, m.vy * dt, 5)
      } else {
        // skulls drift through walls, but will not enter brazier light
        const sp = 24 + floor * 2
        m.vx = (ddx / d) * sp
        m.vy = (ddy / d) * sp
        const nx = m.x + m.vx * dt
        const ny = m.y + m.vy * dt
        if (!litBy(nx, ny)) {
          m.x = nx
          m.y = ny
        }
      }
      if (Math.abs(m.vx) > 4) m.face = Math.sign(m.vx)
      if (d < 10 && m.hit <= 0) bite(m.kind === 'skull' ? 30 : 12, m.x, m.y)
    }

    mobs = mobs.filter((m) => m.t >= 0)
    if (fuel <= 0 && now > hintUntil && Math.floor(now / 4000) % 2 === 0) say('火把烧完了 · 找一支新的，或者点亮灯台', 1500)
    sound.set('fire', fuel / 100)
    ui.score(score)
    const hearts = Array.from({ length: maxHp }, (_, i) => `<i class="${i < hp ? 'on' : ''}"></i>`).join('')
    ui.extra(`<span class="hp">${hearts}</span><span class="fuel${fuel < 25 ? ' low' : ''}"><i style="width:${Math.round(fuel)}%"></i></span> 第 ${floor} 层 · 钥匙 ${hasKey ? '<b>✓</b>' : '—'}`)
  }

  function render(now: number) {
    const t = now / 1000
    PX = Math.max(2, Math.round(canvas.clientWidth / 340))
    const w = Math.ceil(canvas.clientWidth / PX)
    const h = Math.ceil(canvas.clientHeight / PX)
    if (w !== W || h !== H || !lightImg) {
      W = canvas.width = w
      H = canvas.height = h
      lightCanvas.width = Math.ceil(w / LP)
      lightCanvas.height = Math.ceil(h / LP)
      lightImg = lctx.createImageData(lightCanvas.width, lightCanvas.height)
    }
    const fit = (v: number, view: number, world: number) => (world <= view ? (world - view) / 2 : Math.max(0, Math.min(world - view, v)))
    cam.x += (fit(P.x - w / 2, w, MW * T) - cam.x) * 0.18
    cam.y += (fit(P.y - h / 2, h, MH * T) - cam.y) * 0.18
    const ox = Math.round(cam.x + (shake > 0 ? (Math.random() - 0.5) * shake * 12 : 0))
    const oy = Math.round(cam.y + (shake > 0 ? (Math.random() - 0.5) * shake * 12 : 0))
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0b0a10'
    ctx.fillRect(0, 0, w, h)
    for (let ty = Math.floor(oy / T); ty <= Math.floor((oy + h) / T); ty++)
      for (let tx = Math.floor(ox / T); tx <= Math.floor((ox + w) / T); tx++) {
        if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) continue
        const wall = map[ty * MW + tx] === 1
        const img = wall ? (solid(tx, ty + 1) ? wallTop : wallFace) : floors[(tx * 7 + ty * 13) % 3]
        ctx.drawImage(img, tx * T - ox, ty * T - oy)
      }
    const R = radius()
    const flick = (seed: number) => 0.93 + 0.05 * Math.sin(t * 13 + seed) + 0.03 * Math.sin(t * 41 + seed * 3)
    const lights: [number, number, number][] = [[P.x - ox, P.y - oy, R * flick(0) * (fuel < 25 ? 0.9 + 0.1 * Math.sin(t * 30) : 1)]]
    for (const it of items) {
      if (it.taken && it.kind !== 'door') continue
      const sx = Math.round(it.x - ox - 8)
      const sy = Math.round(it.y - oy - 8)
      if (sx < -16 || sy < -16 || sx > w || sy > h) continue
      if (it.kind === 'coin') {
        const cw = Math.max(2, Math.round(Math.abs(Math.cos(it.t * 4)) * 10))
        ctx.drawImage(it.img, Math.round(it.x - ox - cw / 2), sy + 3, cw, 10)
      } else if (it.kind === 'mimic') {
        // the tell: a mimic shivers now and then when you are close enough to see it
        const near = Math.hypot(it.x - P.x, it.y - P.y) < 2.6 * T
        const j = near && Math.sin(it.t * 2.2) > 0.86 ? Math.round(Math.sin(it.t * 50)) : 0
        ctx.drawImage(it.img, sx + j, sy)
      } else if (it.kind === 'spikes') {
        const up = it.t % 2.6 > 1.5
        const warn = !up && it.t % 2.6 > 1.1
        for (let k = 0; k < 4; k++) {
          const hx = sx + 2 + (k % 2) * 8 + (k > 1 ? 2 : 0)
          const hy = sy + 4 + (k > 1 ? 7 : 0)
          ctx.fillStyle = '#15131c'
          ctx.fillRect(hx, hy + 2, 3, 2)
          if (up) {
            ctx.fillStyle = '#c9c4dc'
            ctx.fillRect(hx + 1, hy - 3, 1, 5)
            ctx.fillStyle = '#8983a3'
            ctx.fillRect(hx, hy, 3, 2)
          } else if (warn) {
            ctx.fillStyle = '#8983a3'
            ctx.fillRect(hx + 1, hy + 1, 1, 1)
          }
        }
      } else if (it.kind === 'idol') {
        ctx.drawImage(it.img, sx, sy)
        if (!it.lit) lights.push([it.x - ox, it.y - oy, 1.1 * T * (0.85 + 0.15 * Math.sin(t * 2))])
      } else if (it.kind === 'brazier') {
        ctx.globalAlpha = it.lit ? 1 : 0.55
        ctx.drawImage(it.img, sx, sy)
        ctx.globalAlpha = 1
        if (it.lit) lights.push([it.x - ox, it.y - oy, 3.2 * T * flick(it.x)])
      } else ctx.drawImage(it.img, sx, sy + (it.kind === 'key' || it.kind === 'torch' || it.kind === 'potion' ? Math.round(Math.sin(it.t * 3) * 1.5) : 0))
      if (it.kind === 'door') lights.push([it.x - ox, it.y - oy, (hasKey ? 2.2 : 1.3) * T * (0.9 + 0.1 * Math.sin(t * 3))])
      if (it.kind === 'key') lights.push([it.x - ox, it.y - oy, 0.9 * T * (0.8 + 0.2 * Math.sin(t * 5))])
    }
    for (const m of mobs) {
      const sx = Math.round(m.x - ox)
      const sy = Math.round(m.y - oy + (m.kind === 'skull' ? Math.sin(m.t * 3) * 2 : 0))
      ctx.save()
      if (m.face > 0) {
        ctx.translate(sx * 2, 0)
        ctx.scale(-1, 1)
      }
      const wind = (m.kind === 'skeleton' && m.next - m.t > 1.02) || (m.kind === 'spider' && m.next - m.t > 1.9) ? Math.round(Math.sin(t * 60)) : 0
      if (!(m.hit > 0 && Math.floor(t * 30) % 2)) ctx.drawImage(m.img, sx - 8 + wind, sy - 8 - (m.kind === 'rat' ? Math.floor(m.t * 10) % 2 : 0))
      ctx.restore()
      if (m.hp < m.max) {
        ctx.fillStyle = '#15131c'
        ctx.fillRect(sx - 6, sy - 12, 12, 2)
        ctx.fillStyle = '#ff4d6d'
        ctx.fillRect(sx - 6, sy - 12, Math.round((12 * m.hp) / m.max), 2)
      }
    }
    if (!(P.inv > 0 && Math.floor(t * 18) % 2) && alive) {
      const px = Math.round(P.x - ox)
      const py = Math.round(P.y - oy)
      ctx.save()
      if (P.face < 0) {
        ctx.translate(px * 2, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(IMG.hero[0], px - 8, py - 10 - (Math.floor(P.walk * 9) % 2))
      ctx.restore()
      // the torch flame in hand
      if (fuel > 0) {
        ctx.fillStyle = Math.floor(t * 12) % 2 ? '#ffd84d' : '#ff9a3c'
        ctx.fillRect(px - P.face * 7, py - 9 - (Math.floor(t * 9) % 2), 2, 3)
      }
      // the sword: at rest it points along the aim, a swing sweeps an arc
      const ang = Math.atan2(P.ay, P.ax)
      if (P.atk > 0) {
        const k = 1 - P.atk / 0.16
        for (let i = 0; i < 7; i++) {
          const a = ang - 1.1 + (i / 6) * 2.2 * Math.min(1, k * 1.6)
          const rr = 13
          ctx.fillStyle = i > 4 * k ? '#ffffff' : '#bfe8ff'
          ctx.fillRect(Math.round(px + Math.cos(a) * rr) - 1, Math.round(py - 2 + Math.sin(a) * rr) - 1, 2, 2)
        }
        const a = ang - 1.1 + 2.2 * k
        for (let r = 5; r < 13; r += 2) {
          ctx.fillStyle = '#e8eef8'
          ctx.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py - 2 + Math.sin(a) * r), 2, 2)
        }
      } else {
        ctx.fillStyle = '#c9d4e8'
        for (let r = 6; r < 12; r += 2) ctx.fillRect(Math.round(px + Math.cos(ang) * r), Math.round(py - 2 + Math.sin(ang) * r), 1, 1)
      }
    }
    for (const b of bits) {
      ctx.fillStyle = b.c
      ctx.fillRect(Math.round(b.x - ox), Math.round(b.y - oy), 2, 2)
    }

    // ---- light: computed on a coarse grid and banded with ordered dither
    const lw = lightCanvas.width
    const lh = lightCanvas.height
    const d = lightImg.data
    for (let y = 0; y < lh; y++)
      for (let x = 0; x < lw; x++) {
        let l = 0
        for (const [px, py, r] of lights) {
          const v = 1 - Math.hypot(x * LP - px, (y * LP - py) * 1.08) / r
          if (v > l) l = v
        }
        const band = Math.min(1, Math.floor(Math.max(0, l) * 5 + BAYER4[(y & 3) * 4 + (x & 3)]) / 4)
        const o = (y * lw + x) * 4
        const warm = band > 0 && band < 1
        d[o] = warm ? 70 : 5
        d[o + 1] = warm ? 34 : 4
        d[o + 2] = warm ? 8 : 12
        d[o + 3] = Math.round(255 * Math.max(fade, (1 - band) * 0.97 + (warm ? 0.1 : 0)))
      }
    lctx.putImageData(lightImg, 0, 0)
    ctx.drawImage(lightCanvas, 0, 0, lw * LP, lh * LP)

    // things that show through the dark: eyes, a key's glint
    if (fade < 0.5) {
      for (const m of mobs) {
        if (Math.hypot(m.x - P.x, m.y - P.y) < R * 0.8) continue
        const sx = Math.round(m.x - ox)
        const sy = Math.round(m.y - oy)
        ctx.fillStyle = m.kind === 'skull' ? '#7fe9ff' : `rgba(255,60,60,${0.5 + 0.4 * Math.sin(t * 5 + m.x)})`
        ctx.fillRect(sx - 2, sy - 2, 1, 1)
        ctx.fillRect(sx + 1, sy - 2, 1, 1)
      }
      for (const p of pops) drawText(ctx, p.s, Math.round(p.x - ox - textWidth(p.s) / 2), Math.round(p.y - oy), p.c)
      if (now < hintUntil) {
        const el = canvas.nextElementSibling as HTMLElement | null
        if (el && el.textContent !== hint) el.textContent = hint
        el?.classList.add('on')
      } else (canvas.nextElementSibling as HTMLElement | null)?.classList.remove('on')
    }
  }

  const KEYMAP: Record<string, string> = {
    ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r', ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd',
  }
  window.addEventListener('keydown', (e) => {
    if (!running) return
    if (e.key === ' ' || e.key === 'j' || e.key === 'J') {
      e.preventDefault()
      if (!e.repeat) wantAttack = true
      return
    }
    if (e.key === 'e' || e.key === 'E' || e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      if (!e.repeat) wantUse = true
      return
    }
    const k = KEYMAP[e.key]
    if (!k) return
    e.preventDefault()
    keys.add(k)
  })
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.key]
    if (k) keys.delete(k)
  })
  const point = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    pointer.x = e.clientX - r.left
    pointer.y = e.clientY - r.top
  }
  canvas.addEventListener('pointerdown', (e) => {
    pointer.on = true
    point(e)
    canvas.setPointerCapture(e.pointerId)
    // a press swings toward where you pressed; holding keeps walking there
    const tx = pointer.x / PX + cam.x - P.x
    const ty = pointer.y / PX + cam.y - P.y
    const d = Math.hypot(tx, ty)
    if (d > 2 && running) {
      P.ax = tx / d
      P.ay = ty / d
      if (Math.abs(tx) > 0.2 * d) P.face = Math.sign(tx)
      wantAttack = true
    }
  })
  canvas.addEventListener('pointermove', (e) => pointer.on && point(e))
  const release = () => (pointer.on = false)
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)

  return {
    start() {
      floor = 1
      score = 0
      fuel = 100
      hp = maxHp = 3
      kills = 0
      P.ax = 1
      P.ay = 0
      P.atk = P.cd = 0
      wantAttack = wantUse = false
      alive = true
      fade = 1
      fadeDir = -1
      bits = []
      pops = []
      keys.clear()
      pointer.on = false
      generate()
      cam = { x: P.x, y: P.y }
      W = 0
      last = performance.now()
      running = true
      say('空格挥剑 · E 互动 · 找到钥匙，再找到门', 3800)
    },
    stop() {
      running = false
      keys.clear()
    },
    frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      update(dt, now)
      render(now)
    },
  }
}
