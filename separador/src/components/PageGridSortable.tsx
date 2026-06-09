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
import { RotateCw, Trash2, GripVertical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type PageItem = {
  id: string
  pageNumber1: number
  rotation: 0 | 90 | 180 | 270
  deleted?: boolean
  thumbUrl?: string
}

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

function PageCard(props: {
  item: PageItem
  onRotate: () => void
  onDeleteToggle: () => void
  onVisible: () => void
}) {
  const { item, onRotate, onDeleteToggle, onVisible } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const { ref, isIntersecting } = useIntersection<HTMLDivElement>({
    rootMargin: '400px',
  })

  React.useEffect(() => {
    if (isIntersecting) onVisible()
  }, [isIntersecting, onVisible])

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        ref={ref}
        className={cn(
          'overflow-hidden',
          isDragging && 'ring-2 ring-[rgba(255,95,109,.35)]',
          item.deleted && 'opacity-45'
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b bg-card/40 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/35 hover:text-foreground"
              aria-label="Arrastar"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="text-xs text-muted-foreground">
              Página <span className="font-medium text-foreground">{item.pageNumber1}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRotate}
              aria-label="Rotacionar"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={item.deleted ? 'secondary' : 'ghost'}
              size="icon"
              onClick={onDeleteToggle}
              aria-label="Remover/Restaurar"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="aspect-[3/4] bg-background/20 p-2">
          {item.thumbUrl ? (
            <img
              src={item.thumbUrl}
              alt={`Página ${item.pageNumber1}`}
              className="h-full w-full rounded-xl object-contain ring-1 ring-border/50"
              style={{ transform: `rotate(${item.rotation}deg)` }}
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
              Carregando miniatura…
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

export function PageGridSortable(props: {
  items: PageItem[]
  onChange: (next: PageItem[]) => void
  onRotate: (id: string) => void
  onDeleteToggle: (id: string) => void
  onEnsureThumb: (pageNumber1: number) => void | Promise<void>
}) {
  const { items, onChange, onRotate, onDeleteToggle, onEnsureThumb } = props
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <PageCard
              key={item.id}
              item={item}
              onRotate={() => onRotate(item.id)}
              onDeleteToggle={() => onDeleteToggle(item.id)}
              onVisible={() => void onEnsureThumb(item.pageNumber1)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

