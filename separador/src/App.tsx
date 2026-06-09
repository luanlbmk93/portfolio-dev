import * as React from 'react'

import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MergeTab } from '@/features/merge/MergeTab'
import { SplitTab } from '@/features/split/SplitTab'
import { ExtractTab } from '@/features/extract/ExtractTab'
import { OrganizeTab } from '@/features/organize/OrganizeTab'

const TITLES: Record<string, string> = {
  merge: 'Juntar PDFs',
  split: 'Separar PDFs',
  extract: 'Extrair páginas',
  organize: 'Organizar PDF',
}

export default function App() {
  const [tab, setTab] = React.useState('merge')

  React.useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  React.useEffect(() => {
    document.title = `PDF Tools • ${TITLES[tab] ?? 'PDF'}`
  }, [tab])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />

      <main className="relative mx-auto w-full max-w-6xl px-4 py-10">
        <div className="pointer-events-none absolute -inset-x-10 -top-40 h-[520px] bg-[radial-gradient(880px_380px_at_20%_20%,rgba(255,95,109,.24),transparent_60%),radial-gradient(880px_380px_at_80%_20%,rgba(255,195,113,.18),transparent_60%),radial-gradient(820px_360px_at_50%_0%,rgba(0,230,118,.10),transparent_60%)] blur-[2px]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:22px_22px]" />

        <div className="relative mb-8">
          <div className="text-4xl font-semibold tracking-tight sm:text-5xl">
            PDF Tools
          </div>
          <div className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Junte, separe, extraia e reorganize PDFs com pré-visualização — tudo
            100% no navegador (offline após carregar, sem upload).
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="merge">Juntar</TabsTrigger>
            <TabsTrigger value="split">Separar</TabsTrigger>
            <TabsTrigger value="extract">Extrair páginas</TabsTrigger>
            <TabsTrigger value="organize">Organizar</TabsTrigger>
          </TabsList>

          <TabsContent value="merge">
            <MergeTab />
          </TabsContent>
          <TabsContent value="split">
            <SplitTab />
          </TabsContent>
          <TabsContent value="extract">
            <ExtractTab />
          </TabsContent>
          <TabsContent value="organize">
            <OrganizeTab />
          </TabsContent>
        </Tabs>
      </main>

      <Footer />
    </div>
  )
}
