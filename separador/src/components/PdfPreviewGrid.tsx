import * as React from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { usePdfThumbnails } from '@/hooks/usePdfThumbnails'

function useIntersection<T extends Element>(options?: IntersectionObserverInit) {
  const ref = React.useRef<T | null>(null)
  const [isIntersecting, setIsIntersecting] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting)
    }, options)
    obs.observe(el)
    return () => obs.disconnect()
  }, [options])

  return { ref, isIntersecting }
}

function Thumb({
  pageNumber1,
  url,
  onVisible,
  badge,
}: {
  pageNumber1: number
  url?: string
  onVisible: () => void
  badge?: React.ReactNode
}) {
  const { ref, isIntersecting } = useIntersection<HTMLDivElement>({
    rootMargin: '500px',
  })

  React.useEffect(() => {
    if (isIntersecting) onVisible()
  }, [isIntersecting, onVisible])

  return (
    <Card ref={ref} className="overflow-hidden">
      <div className="relative border-b bg-card/35 px-2 py-1.5 text-xs text-muted-foreground">
        <span>
          Página <span className="font-medium text-foreground">{pageNumber1}</span>
        </span>
        {badge ? <span className="absolute right-2 top-1.5">{badge}</span> : null}
      </div>
      <div className="aspect-[3/4] bg-background/20 p-2">
        {url ? (
          <img
            src={url}
            alt={`Página ${pageNumber1}`}
            className="h-full w-full rounded-xl object-contain ring-1 ring-border/50"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
            Carregando…
          </div>
        )}
      </div>
    </Card>
  )
}

export function PdfPreviewGrid(props: {
  bytes?: ArrayBuffer | null
  className?: string
  highlightPages?: Set<number> // 1-based
  maxPages?: number
}) {
  const { bytes, className, highlightPages, maxPages } = props
  const thumbs = usePdfThumbnails(bytes ?? undefined)

  if (!bytes) return null

  const count = thumbs.pageCount ?? 0
  const limit = maxPages ? Math.min(count, maxPages) : count

  return (
    <div className={cn('grid gap-3', className)}>
      <div className="text-sm font-semibold">Pré-visualização</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: limit }).map((_, idx) => {
          const pageNumber1 = idx + 1
          const badge =
            highlightPages?.has(pageNumber1) ? (
              <span className="rounded-full bg-warm-gradient px-2 py-0.5 text-[10px] font-semibold text-black">
                Selecionada
              </span>
            ) : null
          return (
            <Thumb
              key={pageNumber1}
              pageNumber1={pageNumber1}
              url={thumbs.thumbs[pageNumber1]}
              onVisible={() => void thumbs.ensureThumb(pageNumber1)}
              badge={badge}
            />
          )
        })}
      </div>

      {thumbs.loading ? (
        <div className="text-xs text-muted-foreground">Carregando PDF…</div>
      ) : null}
      {thumbs.error ? (
        <div className="text-xs text-destructive">{thumbs.error}</div>
      ) : null}
    </div>
  )
}

