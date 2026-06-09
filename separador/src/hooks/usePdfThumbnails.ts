import * as React from 'react'

import { loadPdfJsDocument, renderPdfPageToDataUrl } from '@/lib/pdf/pdfjs'

export function usePdfThumbnails(bytes?: ArrayBuffer) {
  const [pageCount, setPageCount] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [thumbs, setThumbs] = React.useState<Record<number, string>>({})
  const thumbsRef = React.useRef<Record<number, string>>({})

  const docRef = React.useRef<Awaited<ReturnType<typeof loadPdfJsDocument>> | null>(
    null
  )

  React.useEffect(() => {
    let cancelled = false
    setThumbs({})
    thumbsRef.current = {}
    setPageCount(null)
    setError(null)
    docRef.current = null
    if (!bytes) return

    ;(async () => {
      setLoading(true)
      try {
        const doc = await loadPdfJsDocument(bytes)
        if (cancelled) return
        docRef.current = doc
        setPageCount(doc.numPages)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Falha ao ler o PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      docRef.current?.destroy?.()
      docRef.current = null
    }
  }, [bytes])

  const ensureThumb = React.useCallback(async (pageNumber1: number) => {
    if (!docRef.current) return
    if (thumbsRef.current[pageNumber1]) return

    const url = await renderPdfPageToDataUrl({
      doc: docRef.current,
      pageNumber: pageNumber1,
      targetWidth: 220,
    })

    setThumbs((t) => {
      if (t[pageNumber1]) return t
      const next = { ...t, [pageNumber1]: url }
      thumbsRef.current = next
      return next
    })
  }, [])

  return { pageCount, loading, error, thumbs, ensureThumb }
}

