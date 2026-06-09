export async function fileToArrayBuffer(file: File) {
  return await file.arrayBuffer()
}

export function isProbablyPdf(file: File) {
  if (file.type === 'application/pdf') return true
  return file.name.toLowerCase().endsWith('.pdf')
}

export function isProbablyImage(file: File) {
  if (file.type.startsWith('image/')) return true
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp') ||
    name.endsWith('.gif') ||
    name.endsWith('.bmp') ||
    name.endsWith('.svg') ||
    name.endsWith('.tif') ||
    name.endsWith('.tiff')
  )
}

export type MergeKind = 'pdf' | 'image'

export function detectMergeKind(file: File): MergeKind | null {
  if (isProbablyPdf(file)) return 'pdf'
  if (isProbablyImage(file)) return 'image'
  return null
}

