import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CreditsFooter } from './CreditsFooter';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      setError(signInError.message || 'Email ou senha inválidos');
    }
    setLoading(false);
  };

  return (
    <div className="zelony-page">
      <div className="flex-1 grid lg:grid-cols-2 min-h-0">
        <div className="hidden lg:flex flex-col justify-between p-12 xl:p-16 border-r border-zelony-border-subtle relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-zelony-gold/5 via-transparent to-zelony-brown/10 pointer-events-none" />
          <div className="relative">
            <p className="text-lg font-bold text-zelony-text mb-16">Análise de Extratos Bancários</p>

            <h1 className="text-4xl xl:text-5xl font-extrabold text-zelony-text leading-[1.1] tracking-tight max-w-md">
              Análise de extratos com{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-zelony-gold-hover to-zelony-gold">
                precisão
              </span>{' '}
              e agilidade
            </h1>
            <p className="mt-5 text-zelony-text-secondary text-lg max-w-sm leading-relaxed">
              Importe PDFs, identifique padrões e gere relatórios profissionais em minutos.
            </p>
          </div>

          <ul className="relative space-y-3 text-sm text-zelony-text-secondary list-disc list-inside">
            <li>Modo com IA para leitura inteligente</li>
            <li>Relatórios, gráficos e exportação PDF/Excel</li>
            <li>Acesso seguro por usuário</li>
          </ul>
        </div>

        <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 animate-slide-up">
          <div className="w-full max-w-md mx-auto">
            <p className="lg:hidden font-bold text-zelony-text mb-8">Análise de Extratos Bancários</p>

            <div className="zelony-card p-8 sm:p-10 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zelony-gold/60 to-transparent" />

              <div className="mb-8">
                <h2 className="text-2xl font-bold text-zelony-text">Bem-vindo de volta</h2>
                <p className="text-zelony-muted text-sm mt-1">Entre com suas credenciais para continuar</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="zelony-label">
                    E-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="zelony-input"
                    placeholder="seu@email.com"
                    autoComplete="email"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="password" className="zelony-label">
                    Senha
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="zelony-input"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                </div>

                {error && <div className="zelony-alert-error">{error}</div>}

                <button type="submit" disabled={loading} className="zelony-btn-primary w-full !py-3.5 !text-base">
                  {loading ? 'Autenticando...' : 'Entrar na plataforma'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <CreditsFooter className="border-zelony-border-subtle bg-zelony-bg/50" />
    </div>
  );
}
