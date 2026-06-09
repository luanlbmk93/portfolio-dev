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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, FileImage, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format'

export type UploadedPdf = {
  id: string
  file: File
  kind?: 'pdf' | 'image'
  pageCount?: number
  bytes?: ArrayBuffer
}

type Props = {
  items: UploadedPdf[]
  onChange: (next: UploadedPdf[]) => void
  onRemove: (id: string) => void
}

function SortableRow({
  item,
  onRemove,
}: {
  item: UploadedPdf
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className={cn(
          'flex items-center justify-between gap-3 p-3 ring-1 ring-border/60 hover:bg-card/70',
          isDragging && 'ring-2 ring-[rgba(255,95,109,.35)]'
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted/25 text-muted-foreground ring-1 ring-border/60 hover:bg-muted/40 hover:text-foreground"
            aria-label="Reordenar"
            {...attributes}
            {...listeners}
            type="button"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,rgba(255,95,109,.16),rgba(255,195,113,.12))] ring-1 ring-border/60">
            {item.kind === 'image' ? (
              <FileImage className="h-4 w-4 text-foreground/90" />
            ) : (
              <FileText className="h-4 w-4 text-foreground/90" />
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.file.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatBytes(item.file.size)}
              {item.kind !== 'image' && typeof item.pageCount === 'number'
                ? ` • ${item.pageCount} páginas`
                : ''}
            </div>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Remover"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </Card>
    </div>
  )
}

export function FileListSortable({ items, onChange, onRemove }: Props) {
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
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-2">
          {items.map((item) => (
            <SortableRow key={item.id} item={item} onRemove={() => onRemove(item.id)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

