// ZIP STORE: PNG is already compressed. Compute the CRC-32 lookup table once.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
  return n
})

export function zip(files: { name: string; data: Uint8Array }[], date = new Date()): Blob {
  const encoder = new TextEncoder()
  let localSize = 0
  let directorySize = 0
  const entries = files.map(({ name, data }) => {
    const filename = encoder.encode(name)
    let crc = 0xffffffff
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    const entry = { filename, data, crc: (crc ^ 0xffffffff) >>> 0, offset: localSize }
    localSize += 30 + filename.length + data.length
    directorySize += 46 + filename.length
    return entry
  })
  // Classic ZIP fields have 16-bit counts/names and 32-bit sizes/offsets.
  if (files.length > 0xffff || entries.some((e) => e.filename.length > 0xffff) || localSize + directorySize + 22 > 0xffffffff) {
    throw new RangeError('Archive exceeds classic ZIP limits')
  }
  const bytes = new Uint8Array(localSize + directorySize + 22)
  const view = new DataView(bytes.buffer)
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((Math.min(2107, Math.max(1980, date.getFullYear())) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  let directory = localSize
  for (const { filename, data, crc, offset } of entries) {
    // Local header and file body. Bit 11 marks UTF-8 names; method 0 is STORE.
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0x0800, true)
    view.setUint16(offset + 10, time, true)
    view.setUint16(offset + 12, day, true)
    view.setUint32(offset + 14, crc, true)
    view.setUint32(offset + 18, data.length, true)
    view.setUint32(offset + 22, data.length, true)
    view.setUint16(offset + 26, filename.length, true)
    bytes.set(filename, offset + 30)
    bytes.set(data, offset + 30 + filename.length)

    // Central directory repeats the metadata and points back to the local header.
    view.setUint32(directory, 0x02014b50, true)
    view.setUint16(directory + 4, 20, true)
    view.setUint16(directory + 6, 20, true)
    view.setUint16(directory + 8, 0x0800, true)
    view.setUint16(directory + 12, time, true)
    view.setUint16(directory + 14, day, true)
    view.setUint32(directory + 16, crc, true)
    view.setUint32(directory + 20, data.length, true)
    view.setUint32(directory + 24, data.length, true)
    view.setUint16(directory + 28, filename.length, true)
    view.setUint32(directory + 42, offset, true)
    bytes.set(filename, directory + 46)
    directory += 46 + filename.length
  }
  // End of central directory; unused fields stay zero, including compression.
  view.setUint32(directory, 0x06054b50, true)
  view.setUint16(directory + 8, files.length, true)
  view.setUint16(directory + 10, files.length, true)
  view.setUint32(directory + 12, directorySize, true)
  view.setUint32(directory + 16, localSize, true)
  return new Blob([bytes], { type: 'application/zip' })
}
