import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      navigate('/admin');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nie udało się zalogować');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Syjon Event" className="h-9 w-9" />
          <h1 className="text-xl font-semibold">Logowanie do panelu</h1>
        </div>

        <div>
          <label className="label" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Hasło
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Logowanie…' : 'Zaloguj się'}
        </button>
      </form>
    </main>
  );
}
