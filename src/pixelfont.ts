/** A 3×5 pixel font for text drawn straight into low-res game canvases. */
export const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '111100101101111', H: '101101111101101', I: '111010010010111', J: '001001001101111',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '111101101101111',
  P: '111101111100100', Q: '111101101111001', R: '110101110101101', S: '111100111001111', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', x: '000101010101000', ':': '000010000010000', '!': '010010010000010', '+': '000010111010000',
  '-': '000000111000000', '.': '000000000000010',
}

/** Draw `s` with its top-left at (x, y); `scale` is the size of one font pixel. */
export function drawText(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, shadow = true, scale = 1) {
  for (const pass of shadow ? [1, 0] : [0]) {
    g.fillStyle = pass ? '#000' : color
    let xx = x
    for (const ch of s) {
      const gl = FONT[ch]
      if (gl) for (let i = 0; i < 15; i++) if (gl[i] === '1') g.fillRect(xx + ((i % 3) + pass) * scale, y + (Math.floor(i / 3) + pass) * scale, scale, scale)
      xx += 4 * scale
    }
  }
}
export const textWidth = (s: string, scale = 1) => s.length * 4 * scale
