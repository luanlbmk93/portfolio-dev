import * as UTIF from 'utif'

function parseSvgSize(svgText: string) {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const svg = doc.documentElement
    const wAttr = svg.getAttribute('width') ?? ''
    const hAttr = svg.getAttribute('height') ?? ''
    const viewBox = svg.getAttribute('viewBox') ?? svg.getAttribute('viewbox') ?? ''

    const num = (v: string) => {
      const m = /(-?\d+(\.\d+)?)/.exec(v)
      return m ? Number(m[1]) : NaN
    }

    const w = num(wAttr)
    const h = num(hAttr)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) }
    }

    const vb = viewBox.trim().split(/[\s,]+/).map(Number)
    if (vb.length === 4 && vb.every((x) => Number.isFinite(x))) {
      const vbW = vb[2]
      const vbH = vb[3]
      if (vbW > 0 && vbH > 0) return { width: Math.round(vbW), height: Math.round(vbH) }
    }
  } catch {
    // ignore
  }
  // Fallback: safe default for SVGs without size
  return { width: 1024, height: 1024 }
}

async function blobToImageBitmap(blob: Blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob)
    } catch {
      throw new Error(
        'A imagem não pôde ser decodificada neste navegador. Converta para PNG ou JPG e tente novamente.'
      )
    }
  }
  // Fallback (older browsers): <img> -> canvas
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas indisponível.')
    ctx.drawImage(img, 0, 0)
    return await createImageBitmap(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToPngBytes(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function decodeTiffToCanvas(bytes: ArrayBuffer) {
  const ifds = UTIF.decode(bytes)
  if (!ifds?.length) throw new Error('TIFF inválido ou vazio.')
  UTIF.decodeImage(bytes, ifds[0])
  const rgba = UTIF.toRGBA8(ifds[0])
  const w = ifds[0].width as number
  const h = ifds[0].height as number
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível.')
  // Copy into a real ArrayBuffer (avoid ArrayBufferLike typing issues)
  const clamped = new Uint8ClampedArray(rgba)
  const imageData = new ImageData(clamped, w, h)
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export async function fileToPngBytesForPdf(file: File) {
  const name = file.name.toLowerCase()
  const isTiff =
    file.type === 'image/tiff' || name.endsWith('.tif') || name.endsWith('.tiff')
  const isSvg =
    file.type === 'image/svg+xml' || name.endsWith('.svg')

  if (isTiff) {
    const bytes = await file.arrayBuffer()
    const canvas = await decodeTiffToCanvas(bytes)
    return canvasToPngBytes(canvas)
  }

  if (isSvg) {
    const svgText = await file.text()
    const { width, height } = parseSvgSize(svgText)
    const blob = new Blob([svgText], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () =>
          reject(
            new Error(
              'SVG não pôde ser renderizado. Tente salvar o SVG como PNG e envie novamente.'
            )
          )
        el.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível.')
      ctx.drawImage(img, 0, 0, width, height)
      return canvasToPngBytes(canvas)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Most formats (png/jpg/webp/gif/bmp) can be rendered by the browser.
  const bitmap = await blobToImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível.')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return canvasToPngBytes(canvas)
}

