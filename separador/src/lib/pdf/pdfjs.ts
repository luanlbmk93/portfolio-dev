import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

export type PdfJsDocument = pdfjs.PDFDocumentProxy

export async function loadPdfJsDocument(bytes: ArrayBuffer) {
  // pdf.js may transfer (detach) ArrayBuffers to the worker.
  // Always clone so previews never break later pdf-lib operations.
  const cloned = bytes.slice(0)
  const task = pdfjs.getDocument({ data: cloned })
  return await task.promise
}

export async function renderPdfPageToDataUrl(options: {
  doc: PdfJsDocument
  pageNumber: number
  targetWidth: number
  devicePixelRatio?: number
}) {
  const { doc, pageNumber, targetWidth } = options
  const dpr = options.devicePixelRatio ?? window.devicePixelRatio ?? 1
  const page = await doc.getPage(pageNumber)

  const viewport1x = page.getViewport({ scale: 1 })
  const scale = targetWidth / viewport1x.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível criar o contexto do canvas.')

  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`

  const renderContext = {
    canvas,
    canvasContext: ctx,
    viewport: page.getViewport({ scale: scale * dpr }),
  }

  await page.render(renderContext).promise
  return canvas.toDataURL('image/png', 0.92)
}

