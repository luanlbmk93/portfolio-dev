import * as React from 'react'
import { Download, Trash2 } from 'lucide-react'

import { DropzoneCard } from '@/components/DropzoneCard'
import { PageGridSortable, type PageItem } from '@/components/PageGridSortable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { useAsyncTask } from '@/hooks/useAsyncTask'
import { usePdfThumbnails } from '@/hooks/usePdfThumbnails'
import { downloadBytes } from '@/lib/download'
import { fileToArrayBuffer, isProbablyPdf } from '@/lib/file'
import { getPdfPageCount, organizePdf } from '@/lib/pdf/operations'

export function OrganizeTab() {
  const [file, setFile] = React.useState<File | null>(null)
  const [bytes, setBytes] = React.useState<ArrayBuffer | null>(null)
  const [items, setItems] = React.useState<PageItem[]>([])
  const task = useAsyncTask()

  const thumbs = usePdfThumbnails(bytes ?? undefined)

  const clear = React.useCallback(() => {
    setFile(null)
    setBytes(null)
    setItems([])
  }, [])

  const onFiles = React.useCallback(async (files: File[]) => {
    const f = files[0]
    if (!f) return
    if (!isProbablyPdf(f)) {
      toast({ variant: 'destructive', title: 'Arquivo inválido', description: 'Envie apenas PDF.' })
      return
    }
    try {
      const b = await fileToArrayBuffer(f)
      setFile(f)
      setBytes(b)
      const pc = await getPdfPageCount(b)
      setItems(
        Array.from({ length: pc }).map((_, idx) => ({
          id: crypto.randomUUID(),
          pageNumber1: idx + 1,
          rotation: 0,
          deleted: false,
        }))
      )
    } catch (e) {
      toast({ variant: 'destructive', title: 'Falha ao abrir', description: e instanceof Error ? e.message : 'Erro ao ler PDF.' })
      clear()
    }
  }, [clear])

  React.useEffect(() => {
    setItems((prev) =>
      prev.map((p) => ({ ...p, thumbUrl: thumbs.thumbs[p.pageNumber1] }))
    )
  }, [thumbs.thumbs])

  const rotate = React.useCallback((id: string) => {
    setItems((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, rotation: ((p.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
          : p
      )
    )
  }, [])

  const toggleDelete = React.useCallback((id: string) => {
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, deleted: !p.deleted } : p))
    )
  }, [])

  const doExport = React.useCallback(async () => {
    if (!bytes || !file) {
      toast({ variant: 'destructive', title: 'Envie um PDF', description: 'Adicione um arquivo para organizar.' })
      return
    }
    const kept = items.filter((p) => !p.deleted)
    if (!kept.length) {
      toast({ variant: 'destructive', title: 'Nenhuma página', description: 'Você removeu todas as páginas.' })
      return
    }

    await task.run(async ({ setLabel, setProgress, yieldToUi }) => {
      setLabel('Gerando PDF…')
      setProgress(20)

      const pages = items.map((p) => ({
        id: p.id,
        pageIndex0: p.pageNumber1 - 1,
        rotation: p.rotation,
        deleted: p.deleted,
      }))

      await yieldToUi()
      const out = await organizePdf({ bytes, pages })
      setProgress(100)

      downloadBytes(out, `organize-${file.name.replace(/\.pdf$/i, '')}.pdf`)
      toast({ title: 'PDF pronto', description: 'Download iniciado automaticamente.' })
    })
  }, [bytes, file, items, task])

  return (
    <div className="grid gap-4">
      <DropzoneCard
        accept={{ 'application/pdf': ['.pdf'] }}
        multiple={false}
        title="Envie um PDF"
        description="Arraste páginas, remova/rote e exporte o PDF reorganizado."
        onFiles={(files) => void onFiles(files)}
        disabled={task.state.isRunning}
      />

      <Card>
        <CardHeader>
          <CardTitle>Organizar páginas</CardTitle>
          <CardDescription>
            {file ? (
              <>
                Arquivo: <span className="font-medium text-foreground">{file.name}</span>
                {typeof thumbs.pageCount === 'number' ? ` • ${thumbs.pageCount} páginas` : ''}
              </>
            ) : (
              'Nenhum arquivo selecionado.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {thumbs.error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
              {thumbs.error}
            </div>
          ) : null}

          {items.length ? (
            <PageGridSortable
              items={items}
              onChange={setItems}
              onRotate={rotate}
              onDeleteToggle={toggleDelete}
              onEnsureThumb={thumbs.ensureThumb}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Envie um PDF para pré-visualizar e reorganizar páginas.
            </div>
          )}

          {task.state.isRunning ? (
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">
                {task.state.label ?? 'Processando…'}
              </div>
              <Progress value={task.state.progress ?? 0} />
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="secondary" onClick={clear} disabled={!file || task.state.isRunning}>
              <Trash2 className="h-4 w-4" />
              Limpar tudo
            </Button>
            <Button type="button" variant="premium" onClick={() => void doExport()} disabled={!file || task.state.isRunning}>
              <Download className="h-4 w-4" />
              Exportar PDF
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

