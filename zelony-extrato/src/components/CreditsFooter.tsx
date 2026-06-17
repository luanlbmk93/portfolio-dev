export function CreditsFooter({ className = '' }: { className?: string }) {
  return (
    <footer
      className={`text-center text-xs text-zelony-muted py-6 border-t border-zelony-border ${className}`}
    >
      Desenvolvido por{' '}
      <span className="text-zelony-gold font-medium">Luan Biagioni</span>
    </footer>
  );
}
