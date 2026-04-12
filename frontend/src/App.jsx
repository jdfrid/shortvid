import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import CreativeStudio from './pages/CreativeStudio';
import { LogOut, Sparkles } from 'lucide-react';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && roles.length && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-midnight-400 px-4 text-center">
        אין הרשאה לצפות בדף זה.
      </div>
    );
  }
  return children;
}

function StudioLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-midnight-800 bg-midnight-950/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gold-400 font-semibold">
            <Sparkles size={22} />
            shortvid
          </div>
          <div className="flex items-center gap-3 text-sm text-midnight-400">
            <span className="hidden sm:inline truncate max-w-[200px]">{user?.email}</span>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-midnight-700 hover:bg-midnight-800 text-midnight-200"
            >
              <LogOut size={16} />
              יציאה
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute roles={['admin', 'editor']}>
              <StudioLayout>
                <CreativeStudio />
              </StudioLayout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
