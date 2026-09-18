import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarRange, ChartColumn, LogOut } from 'lucide-react';
import { api } from '../lib/api';

const NAV_TABS = [
  { to: '/admin', label: 'Wydarzenia', icon: CalendarRange, end: true },
  { to: '/admin/statystyki', label: 'Statystyki', icon: ChartColumn, end: false },
];

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

  if (!checked) {
    // Szkielet w kształcie panelu — bez przeskoku układu po sprawdzeniu sesji.
    return (
      <div className="min-h-screen" aria-busy="true" aria-label="Ładowanie panelu">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl animate-pulse items-center justify-between px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-slate-100" />
              <div className="h-4 w-32 rounded bg-slate-100" />
            </div>
            <div className="h-9 w-24 rounded-xl bg-slate-100" />
          </div>
        </div>
        <div className="mx-auto max-w-6xl animate-pulse space-y-3 px-4 py-8 sm:px-6">
          <div className="h-7 w-40 rounded bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }
  if (!admin) return null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/admin" className="flex shrink-0 items-center gap-2.5 font-semibold">
            <img src="/logo.png" alt="Syjon Event" className="h-8 w-8" />
            <span className="hidden sm:inline">
              Syjon Event <span className="text-slate-400">/ panel</span>
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span className="hidden truncate text-slate-500 sm:block" title={admin.email}>
              {admin.email}
            </span>
            <button onClick={logout} className="btn-secondary shrink-0 px-3 sm:px-5" title={admin.email}>
              <LogOut className="h-4 w-4" aria-hidden />
              Wyloguj
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 sm:px-6">
          {NAV_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`
              }
            >
              <tab.icon className="h-4 w-4" aria-hidden />
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
