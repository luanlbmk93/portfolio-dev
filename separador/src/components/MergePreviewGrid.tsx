import * as React from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { GripHorizontal, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { loadPdfJsDocument, renderPdfPageToDataUrl } from '@/lib/pdf/pdfjs'
import type { UploadedPdf } from '@/components/FileListSortable'

function PreviewCard(props: {
  item: UploadedPdf
  index: number
  onRemove: () => void
}) {
  const { item, index, onRemove } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }

  const [thumb, setThumb] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setThumb(null)
    setLoading(true)
    const blobUrlRef = { current: null as string | null }

    ;(async () => {
      try {
        if (item.kind === 'image') {
          const url = URL.createObjectURL(item.file)
          blobUrlRef.current = url
          if (!cancelled) {
            setThumb(url)
            setLoading(false)
          }
          return
        }

        if (!item.bytes) return
        const doc = await loadPdfJsDocument(item.bytes)
        if (cancelled) return
        const url = await renderPdfPageToDataUrl({
          doc,
          pageNumber: 1,
          targetWidth: 320,
        })
        if (!cancelled) {
          setThumb(url)
          setLoading(false)
        }
        doc.destroy?.()
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    }
  }, [item.file, item.kind, item.bytes])

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="group relative"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-card/80 to-card/40 shadow-soft/15 backdrop-blur-md transition-all duration-300',
          'hover:border-white/10 hover:shadow-soft/25',
          isDragging && 'scale-[1.02] border-[rgba(255,95,109,.35)] shadow-[0_24px_60px_-20px_rgba(255,95,109,.25)]'
        )}
      >
        {/* Área arrastável = card inteiro menos o X */}
        <div
          className="relative cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          {/* Número da ordem */}
          <div className="absolute left-3 top-3 z-20 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-warm-gradient px-2 text-xs font-bold text-black shadow-lg">
            {index + 1}
          </div>

          {/* Preview */}
          <div className="relative aspect-[3/4] bg-[linear-gradient(145deg,rgba(255,255,255,.04),rgba(255,255,255,.01))] p-3 pt-4">
            <div className="absolute inset-3 rounded-xl bg-[repeating-conic-gradient(rgba(255,255,255,.03)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px] opacity-40" />

            {loading ? (
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
                <span className="relative text-xs text-muted-foreground">Carregando…</span>
              </div>
            ) : thumb ? (
              <img
                src={thumb}
                alt=""
                className="relative h-full w-full rounded-xl object-contain shadow-inner ring-1 ring-white/[0.08]"
                draggable={false}
              />
            ) : (
              <div className="relative flex h-full w-full items-center justify-center rounded-xl ring-1 ring-dashed ring-white/10 text-xs text-muted-foreground">
                Sem prévia
              </div>
            )}

            {/* Dica de arrastar — aparece no hover */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/90 backdrop-blur-sm">
                <GripHorizontal className="h-3.5 w-3.5" />
                Segure e arraste
              </span>
            </div>
          </div>
        </div>

        {/* Remover — fora da área de drag */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label="Remover"
          className={cn(
            'absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full',
            'bg-black/50 text-white/90 backdrop-blur-md ring-1 ring-white/10',
            'transition-all hover:bg-destructive hover:text-white hover:ring-destructive/50 hover:scale-105'
          )}
        >
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </motion.div>
  )
}

export function MergePreviewGrid(props: {
  items: UploadedPdf[]
  onChange: (next: UploadedPdf[]) => void
  onRemove: (id: string) => void
}) {
  const { items, onChange, onRemove } = props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } })
  )

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = items.findIndex((i) => i.id === active.id)
      const newIndex = items.findIndex((i) => i.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      onChange(arrayMove(items, oldIndex, newIndex))
    },
    [items, onChange]
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => (
            <PreviewCard
              key={item.id}
              item={item}
              index={index}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
