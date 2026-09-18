import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

/** Formularz logowania do panelu — wspólny dla strony /admin/login i panelu na stronie głównej. */
export default function LoginForm({ compact = false }: { compact?: boolean }) {
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
    <form onSubmit={onSubmit} className={compact ? 'space-y-2.5' : 'space-y-4'}>
      <div>
        <label className={compact ? 'sr-only' : 'label'} htmlFor={compact ? 'login-email-compact' : 'login-email'}>
          E-mail
        </label>
        <input
          id={compact ? 'login-email-compact' : 'login-email'}
          type="email"
          className="input"
          placeholder={compact ? 'E-mail' : undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus={compact}
          required
        />
      </div>
      <div>
        <label className={compact ? 'sr-only' : 'label'} htmlFor={compact ? 'login-password-compact' : 'login-password'}>
          Hasło
        </label>
        <input
          id={compact ? 'login-password-compact' : 'login-password'}
          type="password"
          className="input"
          placeholder={compact ? 'Hasło' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Logowanie…' : 'Zaloguj się'}
      </button>
    </form>
  );
}
