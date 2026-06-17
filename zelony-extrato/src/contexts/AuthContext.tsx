import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

type AppRole = 'admin' | 'analyst';
type AppUser = { id: string; email: string };

const TOKEN_STORAGE_KEY = 'auth_token';
// Em DEV, use sempre rotas relativas (/api/*) e deixe o Vite fazer proxy.
// Em PROD, o recomendado é servir o frontend e o /api no mesmo domínio (Nginx reverse proxy),
// então rotas relativas continuam funcionando sem CORS.
const apiUrl = (path: string) => path;

interface AuthContextType {
  user: AppUser | null;
  role: AppRole | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const resp = await fetch(apiUrl('/api/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(payload?.error || 'Sessão inválida');
        setUser(payload?.user ?? null);
        setRole(payload?.role ?? null);
      } catch {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
        setRole(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      role,
      token,
      loading,
      signIn: async (email: string, password: string) => {
        try {
          const resp = await fetch(apiUrl('/api/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha: password }),
          });
          const payload = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(payload?.error || 'Falha no login');

          const newToken = String(payload?.token || '');
          if (!newToken) throw new Error('Token ausente');

          localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
          setToken(newToken);

          // Carrega dados do usuário/role
          const meResp = await fetch(apiUrl('/api/me'), {
            headers: { Authorization: `Bearer ${newToken}` },
          });
          const me = await meResp.json().catch(() => ({}));
          if (!meResp.ok) throw new Error(me?.error || 'Falha ao carregar perfil');

          setUser(me?.user ?? null);
          setRole(me?.role ?? null);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },
      signOut: async () => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
        setRole(null);
      },
    }),
    [loading, role, token, user]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
