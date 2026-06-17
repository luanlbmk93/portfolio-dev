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
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 animate-slide-up">
        <div className="w-full max-w-md">
          <p className="text-center font-bold text-zelony-text text-lg mb-8">
            Análise de Extratos Bancários
          </p>

          <div className="zelony-card p-8 sm:p-10 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zelony-gold/60 to-transparent" />

            <div className="mb-8 text-center">
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

      <CreditsFooter className="border-zelony-border-subtle bg-zelony-bg/50" />
    </div>
  );
}
