export function CreditsFooter({ className = '' }: { className?: string }) {
  return (
    <footer
      className={`text-center text-xs text-zelony-muted py-5 ${className}`}
    >
      Desenvolvido por{' '}
      <span className="text-zelony-gold font-semibold">Luan Biagioni</span>
    </footer>
  );
}
