export interface SpriteMeta {
  id: number
  caption: string
  subject: string
}

export interface Sprite extends SpriteMeta {
  /** 16x16 RGBA pixels */
  data: ImageData
  /** data URL of the sprite scaled up for <img> use */
  url: string
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${src}`))
    img.src = src
  })
}

/** Load a 16-column strip produced by pipeline/build_proto.py. */
export async function loadStrip(name: string): Promise<Sprite[]> {
  const [img, meta] = await Promise.all([loadImage(`/data/ch_${name}.png`), fetch(`/data/ch_${name}.json`).then((r) => r.json() as Promise<SpriteMeta[]>)])
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const one = document.createElement('canvas')
  one.width = one.height = 16
  const octx = one.getContext('2d')!
  return meta.map((m, k) => {
    const x = (k % 16) * 16
    const y = Math.floor(k / 16) * 16
    const data = ctx.getImageData(x, y, 16, 16)
    octx.clearRect(0, 0, 16, 16)
    octx.putImageData(data, 0, 0)
    return { ...m, data, url: one.toDataURL() }
  })
}
