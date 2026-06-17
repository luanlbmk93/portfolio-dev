import { useState } from 'react';
import { FileText } from 'lucide-react';
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
    <div className="min-h-screen bg-zelony-bg flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-zelony-card rounded-2xl shadow-gold border border-zelony-border p-8">
          <div className="flex flex-col items-center mb-10 text-center">
            <div className="w-14 h-14 mb-5 rounded-xl bg-zelony-brown/40 border border-zelony-gold/30 flex items-center justify-center">
              <FileText className="w-7 h-7 text-zelony-gold" />
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Zelony Extrato</h1>
            <p className="text-zelony-gold font-medium text-lg mt-1">Análise de Extratos Inteligente</p>
            <p className="text-zelony-muted mt-3 text-sm">Acesse sua conta para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-bold uppercase tracking-wider text-zelony-muted mb-2"
              >
                E-mail
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-zelony-border rounded-xl focus:ring-2 focus:ring-zelony-gold/50 focus:border-zelony-gold transition-all outline-none bg-zelony-surface"
                placeholder="seu@email.com"
                required
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-bold uppercase tracking-wider text-zelony-muted mb-2"
              >
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-zelony-border rounded-xl focus:ring-2 focus:ring-zelony-gold/50 focus:border-zelony-gold transition-all outline-none bg-zelony-surface"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-zelony-gold text-zelony-bg py-3.5 rounded-xl font-bold shadow-gold hover:bg-zelony-gold-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Autenticando...' : 'Entrar no Sistema'}
            </button>
          </form>
        </div>
      </div>
      <CreditsFooter />
    </div>
  );
}
