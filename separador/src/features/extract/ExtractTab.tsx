import * as React from 'react'
import { Download, Trash2 } from 'lucide-react'

import { DropzoneCard } from '@/components/DropzoneCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { PdfPreviewGrid } from '@/components/PdfPreviewGrid'
import { downloadBytes } from '@/lib/download'
import { fileToArrayBuffer, isProbablyPdf } from '@/lib/file'
import { getPdfPageCount, extractPages } from '@/lib/pdf/operations'
import { parsePageSelection } from '@/lib/pdf/pageSelection'
import { useAsyncTask } from '@/hooks/useAsyncTask'

export function ExtractTab() {
  const [file, setFile] = React.useState<File | null>(null)
  const [bytes, setBytes] = React.useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = React.useState<number | null>(null)
  const [selection, setSelection] = React.useState('1-3')
  const task = useAsyncTask()

  const clear = React.useCallback(() => {
    setFile(null)
    setBytes(null)
    setPageCount(null)
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
      setPageCount(await getPdfPageCount(b))
    } catch (e) {
      toast({ variant: 'destructive', title: 'Falha ao abrir', description: e instanceof Error ? e.message : 'Erro ao ler PDF.' })
      clear()
    }
  }, [clear])

  const doExtract = React.useCallback(async () => {
    if (!bytes || !file || !pageCount) {
      toast({ variant: 'destructive', title: 'Envie um PDF', description: 'Adicione um arquivo para extrair.' })
      return
    }
    let pages: number[]
    try {
      pages = parsePageSelection(selection, pageCount)
    } catch (e) {
      toast({ variant: 'destructive', title: 'Seleção inválida', description: e instanceof Error ? e.message : 'Verifique as páginas.' })
      return
    }
    await task.run(async ({ setLabel, setProgress }) => {
      setLabel('Extraindo…')
      setProgress(30)
      const out = await extractPages({ bytes, pages1Based: pages })
      setProgress(100)
      downloadBytes(out, `extract-${file.name.replace(/\.pdf$/i, '')}.pdf`)
      toast({ title: 'PDF pronto', description: 'Download iniciado automaticamente.' })
    })
  }, [bytes, file, pageCount, selection, task])

  return (
    <div className="grid gap-4">
      <DropzoneCard
        accept={{ 'application/pdf': ['.pdf'] }}
        multiple={false}
        title="Envie um PDF"
        description="Digite páginas como “1,2,5” ou “1-10” e baixe o novo PDF."
        onFiles={(files) => void onFiles(files)}
        disabled={task.state.isRunning}
      />

      <Card>
        <CardHeader>
          <CardTitle>Extrair páginas</CardTitle>
          <CardDescription>
            {file ? (
              <>
                Arquivo: <span className="font-medium text-foreground">{file.name}</span>
                {typeof pageCount === 'number' ? ` • ${pageCount} páginas` : ''}
              </>
            ) : (
              'Nenhum arquivo selecionado.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="selection">Páginas</Label>
            <Input
              id="selection"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              placeholder="1,3,5-8"
            />
            <div className="text-xs text-muted-foreground">
              Exemplos: “1,2,5” • “1-10” • “1,3,5-8”.
            </div>
          </div>

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
            <Button type="button" variant="premium" onClick={() => void doExtract()} disabled={!file || task.state.isRunning}>
              <Download className="h-4 w-4" />
              Baixar PDF
            </Button>
          </div>

          <PdfPreviewGrid
            bytes={bytes}
            maxPages={24}
            highlightPages={
              file && pageCount
                ? (() => {
                    try {
                      return new Set(parsePageSelection(selection, pageCount))
                    } catch {
                      return undefined
                    }
                  })()
                : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

