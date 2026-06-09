import * as React from 'react'
import { Download, Files, Sparkles, Trash2 } from 'lucide-react'

import { DropzoneCard } from '@/components/DropzoneCard'
import { MergePreviewGrid } from '@/components/MergePreviewGrid'
import type { UploadedPdf } from '@/components/FileListSortable'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { downloadBytes } from '@/lib/download'
import { detectMergeKind, fileToArrayBuffer } from '@/lib/file'
import { getPdfPageCount, mergePdfs, type MergeInput } from '@/lib/pdf/operations'
import { useAsyncTask } from '@/hooks/useAsyncTask'
import { cn } from '@/lib/utils'

function StepBadge({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
        active
          ? 'bg-warm-gradient text-black shadow-lg shadow-[rgba(255,95,109,.25)]'
          : 'bg-muted/50 text-muted-foreground ring-1 ring-border'
      )}
    >
      {n}
    </span>
  )
}

export function MergeTab() {
  const [items, setItems] = React.useState<UploadedPdf[]>([])
  const task = useAsyncTask()

  const addFiles = React.useCallback(async (files: File[]) => {
    const supported = files
      .map((f) => ({ file: f, kind: detectMergeKind(f) }))
      .filter((x): x is { file: File; kind: 'pdf' | 'image' } => x.kind !== null)

    const invalid = files.filter((f) => detectMergeKind(f) === null)
    if (invalid.length) {
      toast({
        variant: 'destructive',
        title: 'Arquivo não aceito',
        description: 'Use PDF ou imagem (jpg, png, webp, svg…).',
      })
    }
    if (!supported.length) return

    const next: UploadedPdf[] = supported.map((s) => ({
      id: crypto.randomUUID(),
      file: s.file,
      kind: s.kind,
    }))
    setItems((prev) => [...prev, ...next])

    for (const it of next) {
      try {
        const bytes = await fileToArrayBuffer(it.file)
        const pageCount = it.kind === 'pdf' ? await getPdfPageCount(bytes) : undefined
        setItems((prev) =>
          prev.map((p) => (p.id === it.id ? { ...p, bytes, pageCount } : p))
        )
      } catch {
        setItems((prev) => prev.filter((p) => p.id !== it.id))
        toast({
          variant: 'destructive',
          title: 'Não deu para abrir',
          description: it.file.name,
        })
      }
    }
  }, [])

  const clearAll = React.useCallback(() => setItems([]), [])

  const doMerge = React.useCallback(async () => {
    if (items.length < 2) {
      toast({
        variant: 'destructive',
        title: 'Precisa de pelo menos 2 arquivos',
        description: 'Adicione mais um PDF ou imagem.',
      })
      return
    }

    await task.run(async ({ setLabel, setProgress, yieldToUi }) => {
      try {
        setLabel('Preparando…')
        const prepared: MergeInput[] = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          let bytes = it.bytes ?? (await fileToArrayBuffer(it.file))
          try {
            new Uint8Array(bytes)
          } catch {
            bytes = await fileToArrayBuffer(it.file)
          }
          if (it.kind === 'image')
            prepared.push({ kind: 'image', file: it.file, bytes })
          else prepared.push({ kind: 'pdf', bytes })
          setProgress(Math.round(((i + 1) / (items.length + 1)) * 100))
          await yieldToUi()
        }

        setLabel('Juntando…')
        const outBytes = await mergePdfs(prepared)
        setProgress(100)

        downloadBytes(outBytes, `documento-${new Date().toISOString().slice(0, 10)}.pdf`)
        toast({
          title: 'Pronto!',
          description: 'Seu PDF foi baixado.',
        })
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'Não deu para juntar',
          description:
            e instanceof Error ? e.message : 'Tente outro arquivo.',
        })
        throw e
      }
    })
  }, [items, task])

  const accept = {
    'application/pdf': ['.pdf'],
    'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg'],
    'image/svg+xml': ['.svg'],
  }

  return (
    <div className="grid gap-8">
      {/* Passo 1 */}
      <section className="grid gap-4">
        <div className="flex items-center gap-3">
          <StepBadge n={1} active />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Adicionar arquivos</h2>
            <p className="text-sm text-muted-foreground">
              PDFs e fotos — quantos quiser.
            </p>
          </div>
        </div>
        <DropzoneCard
          accept={accept}
          multiple
          title="Clique ou arraste aqui"
          description="Solte seus arquivos nesta área"
          onFiles={(files) => void addFiles(files)}
          disabled={task.state.isRunning}
        />
      </section>

      {/* Passo 2 */}
      <section className="grid gap-5 rounded-2xl border border-white/[0.06] bg-card/30 p-5 shadow-soft/10 backdrop-blur-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <StepBadge n={2} active={items.length > 0} />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Organizar</h2>
              <p className="text-sm text-muted-foreground">
                {items.length
                  ? `${items.length} arquivo${items.length > 1 ? 's' : ''} na fila`
                  : 'Suas prévias aparecem aqui'}
              </p>
            </div>
          </div>

          {items.length > 0 ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted/40 px-3 py-1 ring-1 ring-border">
                <span className="font-medium text-foreground">X</span> = remover
              </span>
              <span className="rounded-full bg-muted/40 px-3 py-1 ring-1 ring-border">
                Segure o card = mover
              </span>
            </div>
          ) : null}
        </div>

        {items.length ? (
          <MergePreviewGrid
            items={items}
            onChange={setItems}
            onRemove={(id) => setItems((p) => p.filter((x) => x.id !== id))}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-muted/10 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/30 ring-1 ring-border">
              <Files className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              Ainda vazio. Adicione arquivos no passo 1 e as miniaturas vão aparecer aqui.
            </p>
          </div>
        )}

        {task.state.isRunning ? (
          <div className="grid gap-2 rounded-xl bg-muted/20 p-4">
            <div className="text-sm text-muted-foreground">
              {task.state.label ?? 'Aguarde…'}
            </div>
            <Progress value={task.state.progress ?? 0} />
          </div>
        ) : null}
      </section>

      {/* Passo 3 — CTA fixo visual */}
      <section className="grid gap-4">
        <div className="flex items-center gap-3">
          <StepBadge n={3} active={items.length >= 2} />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Baixar PDF</h2>
            <p className="text-sm text-muted-foreground">
              {items.length < 2
                ? 'Precisa de no mínimo 2 arquivos'
                : 'Tudo pronto — é só clicar'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-12 flex-1 rounded-xl text-base"
            onClick={clearAll}
            disabled={!items.length || task.state.isRunning}
          >
            <Trash2 className="h-5 w-5" />
            Apagar tudo
          </Button>

          <Button
            type="button"
            variant="premium"
            size="lg"
            className="h-14 flex-[2] rounded-xl text-base font-semibold shadow-[0_12px_40px_-12px_rgba(255,95,109,.45)]"
            onClick={() => void doMerge()}
            disabled={items.length < 2 || task.state.isRunning}
          >
            <Download className="h-5 w-5" />
            Baixar PDF junto
            <Sparkles className="h-4 w-4 opacity-80" />
          </Button>
        </div>
      </section>
    </div>
  )
}
