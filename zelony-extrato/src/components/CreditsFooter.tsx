export function CreditsFooter({ className = '' }: { className?: string }) {
  return (
    <footer
      className={`text-center text-xs text-zelony-muted py-6 ${className}`}
    >
      <span className="inline-flex items-center gap-2">
        Desenvolvido por{' '}
        <span className="text-zelony-gold font-semibold tracking-wide">Luan Biagioni</span>
      </span>
    </footer>
  );
}
