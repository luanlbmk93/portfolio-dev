import { saveAs } from 'file-saver'

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' })
  saveAs(blob, filename)
}

