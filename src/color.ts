/** sRGB ⇄ OKLCH, enough for ramps and palette swaps. */
export type RGB = [number, number, number]
export type LCH = [l: number, c: number, h: number]

const toLin = (v: number) => {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const toSrgb = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, s)) * 255)
}

export function rgbToLch([r, g, b]: RGB): LCH {
  const lr = toLin(r)
  const lg = toLin(g)
  const lb = toLin(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return [L, Math.hypot(A, B), h]
}

export function lchToRgb([L, C, h]: LCH): RGB {
  const hr = (h * Math.PI) / 180
  const A = C * Math.cos(hr)
  const B = C * Math.sin(hr)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** move hue a toward b by at most `deg` degrees, the short way round */
export function hueToward(a: number, b: number, deg: number) {
  let d = ((b - a + 540) % 360) - 180
  if (Math.abs(d) > deg) d = Math.sign(d) * deg
  return (a + d + 360) % 360
}

export const luma = ([r, g, b]: RGB) => (0.299 * r + 0.587 * g + 0.114 * b) / 255
