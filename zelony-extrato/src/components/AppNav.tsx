import { FileText, Key, LogOut, MessageCircle, ScrollText } from 'lucide-react';

type AppNavProps = {
  userEmail?: string;
  activePage: 'dashboard' | 'logs';
  onTogglePage: () => void;
  onPassword: () => void;
  onLogout: () => void;
  loading?: boolean;
  whatsappUrl: string;
};

export function AppNav({
  userEmail,
  activePage,
  onTogglePage,
  onPassword,
  onLogout,
  loading,
  whatsappUrl,
}: AppNavProps) {
  return (
    <nav className="sticky top-0 z-50 border-b border-zelony-border-subtle bg-zelony-bg/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zelony-brown to-zelony-bg-elevated border border-zelony-gold/30 shadow-gold-sm">
              <FileText className="h-5 w-5 text-zelony-gold" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-zelony-text tracking-tight truncate">Análise de Extratos Bancários</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {userEmail && (
              <div className="hidden lg:block text-right mr-1 max-w-[200px]">
                <p className="text-[10px] uppercase tracking-widest text-zelony-muted font-semibold">Sessão</p>
                <p className="text-xs text-zelony-text-secondary truncate">{userEmail}</p>
              </div>
            )}

            <button
              type="button"
              onClick={onTogglePage}
              className={`zelony-btn-secondary !py-2 !px-3 text-xs sm:text-sm ${
                activePage === 'logs' ? '!border-zelony-gold/40 !text-zelony-gold !bg-zelony-gold/10' : ''
              }`}
            >
              <ScrollText size={15} />
              <span className="hidden xs:inline">{activePage === 'logs' ? 'Dashboard' : 'Logs'}</span>
              {loading && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="zelony-btn-secondary !py-2 !px-3 !border-emerald-500/20 !text-emerald-400 hover:!bg-emerald-500/10 text-xs sm:text-sm"
              title="Suporte WhatsApp"
            >
              <MessageCircle size={15} />
              <span className="hidden sm:inline">Suporte</span>
            </a>

            <button type="button" onClick={onPassword} className="zelony-btn-ghost !py-2" title="Alterar senha">
              <Key size={16} />
            </button>

            <button type="button" onClick={onLogout} className="zelony-btn-ghost !py-2 !text-red-400 hover:!bg-red-500/10 hover:!text-red-300">
              <LogOut size={16} />
              <span className="hidden md:inline">Sair</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
