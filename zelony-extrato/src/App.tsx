import { useAuth } from './contexts/AuthContext';
import { LoginForm } from './components/LoginForm';
import { Dashboard } from './components/Dashboard';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="zelony-page items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="h-12 w-12 rounded-2xl border-2 border-zelony-gold/30 border-t-zelony-gold animate-spin" />
          <p className="text-sm text-zelony-muted">Carregando plataforma...</p>
        </div>
      </div>
    );
  }

  return user ? <Dashboard /> : <LoginForm />;
}

export default App;
