import { degrees, PDFDocument } from 'pdf-lib'
import { fileToPngBytesForPdf } from '@/lib/images/toPngBytes'

export async function getPdfPageCount(bytes: ArrayBuffer) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false })
  return doc.getPageCount()
}

export type MergeInput =
  | { kind: 'pdf'; bytes: ArrayBuffer }
  | { kind: 'image'; file: File; bytes?: ArrayBuffer }

function asArrayBuffer(bytes: ArrayBuffer | Uint8Array) {
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  }
  return bytes
}

async function appendPdf(out: PDFDocument, pdfBytes: ArrayBuffer | Uint8Array) {
  const doc = await PDFDocument.load(asArrayBuffer(pdfBytes), {
    ignoreEncryption: false,
  })
  const pages = await out.copyPages(doc, doc.getPageIndices())
  for (const p of pages) out.addPage(p)
}

async function appendImageAsPdfPage(out: PDFDocument, file: File) {
  const name = file.name.toLowerCase()
  const isJpeg =
    file.type === 'image/jpeg' || file.type === 'image/jpg' || name.endsWith('.jpg') || name.endsWith('.jpeg')
  const isPng = file.type === 'image/png' || name.endsWith('.png')

  const imageDoc = await PDFDocument.create()

  const toArrayBuffer = (bytes: Uint8Array) =>
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer

  try {
    if (isJpeg) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const img = await imageDoc.embedJpg(toArrayBuffer(bytes))
      const page = imageDoc.addPage([img.width, img.height])
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      })
    } else if (isPng) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const img = await imageDoc.embedPng(toArrayBuffer(bytes))
      const page = imageDoc.addPage([img.width, img.height])
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      })
    } else {
      // webp/gif/bmp/tiff/etc -> convert to PNG via canvas/UTIF
      const pngBytes = await fileToPngBytesForPdf(file)
      const img = await imageDoc.embedPng(toArrayBuffer(pngBytes))
      const page = imageDoc.addPage([img.width, img.height])
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      })
    }
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : 'A imagem não pôde ser processada.'
    throw new Error(`Falha ao processar a imagem "${file.name}": ${msg}`)
  }

  await appendPdf(out, await imageDoc.save())
}

export async function mergePdfs(items: MergeInput[]) {
  const out = await PDFDocument.create()
  for (const it of items) {
    if (it.kind === 'pdf') await appendPdf(out, it.bytes)
    else await appendImageAsPdfPage(out, it.file)
  }
  return await out.save()
}

export async function extractPages(options: {
  bytes: ArrayBuffer
  pages1Based: number[]
}) {
  const src = await PDFDocument.load(options.bytes, { ignoreEncryption: false })
  const out = await PDFDocument.create()
  const indices = options.pages1Based.map((p) => p - 1)
  const pages = await out.copyPages(src, indices)
  for (const p of pages) out.addPage(p)
  return await out.save()
}

export type SplitMode =
  | { type: 'each-page' }
  | { type: 'chunk'; chunkSize: number }
  | { type: 'ranges'; ranges: Array<{ start: number; end: number }> }

export async function splitPdf(options: {
  bytes: ArrayBuffer
  mode: SplitMode
}) {
  const src = await PDFDocument.load(options.bytes, { ignoreEncryption: false })
  const pageCount = src.getPageCount()

  const groups: Array<number[]> = []

  if (options.mode.type === 'each-page') {
    for (let i = 0; i < pageCount; i++) groups.push([i])
  } else if (options.mode.type === 'chunk') {
    const size = Math.max(1, Math.floor(options.mode.chunkSize))
    for (let i = 0; i < pageCount; i += size) {
      const chunk: number[] = []
      for (let j = i; j < Math.min(pageCount, i + size); j++) chunk.push(j)
      groups.push(chunk)
    }
  } else {
    for (const r of options.mode.ranges) {
      const start = Math.max(1, Math.floor(r.start))
      const end = Math.max(1, Math.floor(r.end))
      if (start > end) throw new Error(`Intervalo inválido: ${start}-${end}`)
      if (start < 1 || end > pageCount)
        throw new Error(`Intervalo fora do PDF: ${start}-${end} (total ${pageCount})`)
      const idx: number[] = []
      for (let p = start; p <= end; p++) idx.push(p - 1)
      groups.push(idx)
    }
  }

  const outputs: Uint8Array[] = []
  for (const group of groups) {
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, group)
    for (const p of pages) out.addPage(p)
    outputs.push(await out.save())
  }

  return { outputs, pageCount, groups }
}

export type OrganizePageState = {
  id: string
  pageIndex0: number
  rotation: 0 | 90 | 180 | 270
  deleted?: boolean
}

export async function organizePdf(options: {
  bytes: ArrayBuffer
  pages: OrganizePageState[]
}) {
  const src = await PDFDocument.load(options.bytes, { ignoreEncryption: false })
  const out = await PDFDocument.create()

  const kept = options.pages.filter((p) => !p.deleted)
  const indices = kept.map((p) => p.pageIndex0)
  const copied = await out.copyPages(src, indices)

  for (let i = 0; i < copied.length; i++) {
    const page = copied[i]
    const rotation = kept[i]?.rotation ?? 0
    if (rotation !== 0) page.setRotation(degrees(rotation))
    out.addPage(page)
  }

  return await out.save()
}

