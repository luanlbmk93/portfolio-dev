import { FileStack } from 'lucide-react'

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25 shadow-soft/10">
            <FileStack className="h-5 w-5 text-primary" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              PDF Tools
            </div>
            <div className="text-xs text-muted-foreground">
              Offline • Sem upload • Rápido
            </div>
          </div>
        </div>

        <div className="hidden text-xs text-muted-foreground sm:block">
          Simples, bonito e privado.
        </div>
      </div>
    </header>
  )
}

