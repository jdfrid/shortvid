import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lock, Mail, AlertCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'התחברות נכשלה');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-midnight-950 to-midnight-900">
      <div className="glass rounded-2xl p-8 w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gold-500/15 text-gold-400 mb-3">
            <Sparkles size={28} />
          </div>
          <h1 className="text-xl font-bold text-white">shortvid</h1>
          <p className="text-sm text-midnight-400 mt-1">התחברות לסטודיו</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-300 bg-red-500/10 rounded-lg px-3 py-2 text-sm">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-midnight-300 mb-1">אימייל</label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-midnight-500" size={18} />
              <input
                type="email"
                className="input-dark w-full pr-10"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-midnight-300 mb-1">סיסמה</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-midnight-500" size={18} />
              <input
                type="password"
                className="input-dark w-full pr-10"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>
          <button type="submit" className="btn-gold w-full" disabled={loading}>
            {loading ? 'מתחבר…' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}
