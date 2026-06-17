import { useAuth } from './contexts/AuthContext';
import { LoginForm } from './components/LoginForm';
import { Dashboard } from './components/Dashboard';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-zelony-bg flex items-center justify-center">
        <div className="text-lg text-zelony-muted">Carregando...</div>
      </div>
    );
  }

  return user ? <Dashboard /> : <LoginForm />;
}

export default App;
