declare module 'utif' {
  // Minimal typings for our usage
  export function decode(buffer: ArrayBuffer): any[]
  export function decodeImage(buffer: ArrayBuffer, ifd: any): void
  export function toRGBA8(ifd: any): Uint8Array
}

