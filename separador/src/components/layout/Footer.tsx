export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-6 text-xs text-muted-foreground">
        <span>Desenvolvido por Luan Biagioni</span>
        <span aria-hidden>•</span>
        <a href="/" className="text-primary hover:underline">
          Portfolio
        </a>
        <span aria-hidden>•</span>
        <a href="/disparador-gmail/" className="text-primary hover:underline">
          Disparador Gmail
        </a>
      </div>
    </footer>
  )
}

