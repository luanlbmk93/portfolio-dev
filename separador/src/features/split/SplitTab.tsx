import * as React from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { Download, Trash2 } from 'lucide-react'

import { DropzoneCard } from '@/components/DropzoneCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { PdfPreviewGrid } from '@/components/PdfPreviewGrid'
import { fileToArrayBuffer, isProbablyPdf } from '@/lib/file'
import { getPdfPageCount, splitPdf, type SplitMode } from '@/lib/pdf/operations'
import { useAsyncTask } from '@/hooks/useAsyncTask'

function parseRanges(input: string) {
  const normalized = input.replace(/\s+/g, '')
  if (!normalized) throw new Error('Digite os intervalos. Ex: 1-3,4-8')
  const parts = normalized.split(',').filter(Boolean)
  return parts.map((p) => {
    const m = /^(\d+)-(\d+)$/.exec(p)
    if (!m) throw new Error(`Intervalo inválido: "${p}"`)
    return { start: Number(m[1]), end: Number(m[2]) }
  })
}

type ModeUi = 'each' | 'chunk' | 'ranges'

export function SplitTab() {
  const [file, setFile] = React.useState<File | null>(null)
  const [bytes, setBytes] = React.useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = React.useState<number | null>(null)
  const [mode, setMode] = React.useState<ModeUi>('each')
  const [chunkSize, setChunkSize] = React.useState('2')
  const [ranges, setRanges] = React.useState('1-3,4-6')
  const [results, setResults] = React.useState<Array<{ name: string; bytes: Uint8Array }> | null>(null)
  const task = useAsyncTask()

  const clear = React.useCallback(() => {
    setFile(null)
    setBytes(null)
    setPageCount(null)
    setResults(null)
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
      setPageCount(null)
      setResults(null)
      setPageCount(await getPdfPageCount(b))
    } catch (e) {
      toast({ variant: 'destructive', title: 'Falha ao abrir', description: e instanceof Error ? e.message : 'Erro ao ler PDF.' })
      clear()
    }
  }, [clear])

  const doSplit = React.useCallback(async () => {
    if (!bytes || !file) {
      toast({ variant: 'destructive', title: 'Envie um PDF', description: 'Adicione um arquivo para dividir.' })
      return
    }

    await task.run(async ({ setLabel, setProgress, yieldToUi }) => {
      let splitMode: SplitMode
      if (mode === 'each') splitMode = { type: 'each-page' }
      else if (mode === 'chunk') splitMode = { type: 'chunk', chunkSize: Number(chunkSize) }
      else splitMode = { type: 'ranges', ranges: parseRanges(ranges) }

      setLabel('Dividindo…')
      setProgress(10)
      const { outputs } = await splitPdf({ bytes, mode: splitMode })
      setProgress(55)

      setLabel('Gerando ZIP…')
      const zip = new JSZip()
      const res: Array<{ name: string; bytes: Uint8Array }> = []
      for (let i = 0; i < outputs.length; i++) {
        const name = `parte-${String(i + 1).padStart(3, '0')}.pdf`
        zip.file(name, outputs[i])
        res.push({ name, bytes: outputs[i] })
        if (i % 5 === 0) {
          setProgress(55 + Math.round((i / Math.max(1, outputs.length)) * 40))
          await yieldToUi()
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setProgress(55 + Math.round(meta.percent * 0.45))
      })

      setProgress(100)
      saveAs(blob, `split-${file.name.replace(/\.pdf$/i, '')}.zip`)
      setResults(res)
      toast({ title: 'ZIP pronto', description: 'Download iniciado automaticamente.' })
    })
  }, [bytes, file, mode, chunkSize, ranges, task])

  return (
    <div className="grid gap-4">
      <DropzoneCard
        accept={{ 'application/pdf': ['.pdf'] }}
        multiple={false}
        title="Envie um PDF"
        description="Escolha o modo e baixe um ZIP com os arquivos."
        onFiles={(files) => void onFiles(files)}
        disabled={task.state.isRunning}
      />

      <Card>
        <CardHeader>
          <CardTitle>Configurações</CardTitle>
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
            <Label>Modo</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button type="button" variant={mode === 'each' ? 'default' : 'secondary'} onClick={() => setMode('each')}>
                Cada página
              </Button>
              <Button type="button" variant={mode === 'chunk' ? 'default' : 'secondary'} onClick={() => setMode('chunk')}>
                A cada X páginas
              </Button>
              <Button type="button" variant={mode === 'ranges' ? 'default' : 'secondary'} onClick={() => setMode('ranges')}>
                Por intervalos
              </Button>
            </div>
          </div>

          {mode === 'chunk' ? (
            <div className="grid gap-2">
              <Label htmlFor="chunkSize">Dividir após X páginas</Label>
              <Input id="chunkSize" value={chunkSize} onChange={(e) => setChunkSize(e.target.value)} inputMode="numeric" />
              <div className="text-xs text-muted-foreground">Ex: 2 → gera PDFs de 2 em 2 páginas.</div>
            </div>
          ) : null}

          {mode === 'ranges' ? (
            <div className="grid gap-2">
              <Label htmlFor="ranges">Intervalos</Label>
              <Input id="ranges" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3,4-6" />
              <div className="text-xs text-muted-foreground">Ex: “1-3,4-6,7-10”.</div>
            </div>
          ) : null}

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
            <Button type="button" variant="premium" onClick={() => void doSplit()} disabled={!file || task.state.isRunning}>
              <Download className="h-4 w-4" />
              Exportar ZIP
            </Button>
          </div>

          <PdfPreviewGrid bytes={bytes} maxPages={24} />

          {results?.length ? (
            <div className="grid gap-2">
              <div className="text-sm font-semibold">Downloads individuais</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {results.slice(0, 24).map((r) => (
                  <Button
                    key={r.name}
                    type="button"
                    variant="outline"
                    onClick={() =>
                      saveAs(
                        new Blob(
                          [
                            r.bytes.buffer.slice(
                              r.bytes.byteOffset,
                              r.bytes.byteOffset + r.bytes.byteLength
                            ) as ArrayBuffer,
                          ],
                          { type: 'application/pdf' }
                        ),
                        r.name
                      )
                    }
                  >
                    <Download className="h-4 w-4" />
                    {r.name}
                  </Button>
                ))}
              </div>
              {results.length > 24 ? (
                <div className="text-xs text-muted-foreground">
                  Mostrando apenas os primeiros 24 arquivos. Use o ZIP para baixar todos.
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

