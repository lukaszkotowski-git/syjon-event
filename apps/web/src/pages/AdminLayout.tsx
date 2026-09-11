import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export default function AdminLayout() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<{ email: string } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .get<{ admin: { email: string } }>('/api/auth/me')
      .then((data) => setAdmin(data.admin))
      .catch(() => navigate('/admin/login', { replace: true }))
      .finally(() => setChecked(true));
  }, [navigate]);

  async function logout() {
    await api.post('/api/auth/logout');
    navigate('/admin/login', { replace: true });
  }

  if (!checked) return <p className="p-8 text-slate-500">Ładowanie…</p>;
  if (!admin) return null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/admin" className="font-semibold">
            Syjon Event <span className="text-slate-400">/ panel</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{admin.email}</span>
            <button onClick={logout} className="btn-secondary">
              Wyloguj
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
