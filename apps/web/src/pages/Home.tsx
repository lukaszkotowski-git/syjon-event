import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../lib/legal';

type EventIconType = 'fireworks' | 'beach' | 'ski' | 'disco' | 'camp' | 'picnic';

function EventIcon({ type, className }: { type: EventIconType; className?: string }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', className };
  switch (type) {
    case 'fireworks':
      return (
        <svg {...common}>
          <path
            d="M12 2v6M12 16v6M4.2 4.2l4.2 4.2M15.6 15.6l4.2 4.2M2 12h6M16 12h6M4.2 19.8l4.2-4.2M15.6 8.4l4.2-4.2"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'beach':
      return (
        <svg {...common}>
          <circle cx="12" cy="9.5" r="3.4" stroke="currentColor" strokeWidth={1.7} />
          <path
            d="M12 3.3v1.6M5.4 9.5H3.8M20.2 9.5h-1.6M7.2 5l1.1 1.1M16.8 5l-1.1 1.1"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
          <path
            d="M2.5 18c1.6-1.5 3.2-1.5 4.8 0s3.2 1.5 4.8 0 3.2-1.5 4.8 0 3.2 1.5 4.8 0"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'ski':
      return (
        <svg {...common}>
          <path
            d="M2.5 18.5 8 9l3 4.2 2-2.8L20 18.5H2.5Z"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinejoin="round"
          />
          <path
            d="M18 4.5v4M16.3 5.8l3.4 1.4M19.7 5.8l-3.4 1.4"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'disco':
      return (
        <svg {...common}>
          <circle cx="12" cy="10.5" r="5.2" stroke="currentColor" strokeWidth={1.7} />
          <path
            d="M6.8 10.5h10.4M12 5.3v10.4M8.4 6.9l7.2 7.2M15.6 6.9l-7.2 7.2"
            stroke="currentColor"
            strokeWidth={1.3}
            strokeLinecap="round"
          />
          <path d="M12 15.7v3.3M9.3 20.5h5.4" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
        </svg>
      );
    case 'camp':
      return (
        <svg {...common}>
          <path d="M12 4 20.5 19h-17L12 4Z" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
          <path d="M12 4v15M9.3 19l-2-3.4M14.7 19l2-3.4" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
        </svg>
      );
    case 'picnic':
      return (
        <svg {...common}>
          <circle cx="8.7" cy="8.2" r="2.4" stroke="currentColor" strokeWidth={1.7} />
          <circle cx="15.8" cy="9.3" r="2" stroke="currentColor" strokeWidth={1.7} />
          <path
            d="M4 19.2c.5-3.2 2.3-5.2 4.9-5.2s4.4 2 4.9 5.2M14.2 19.2c.3-2.3 1.5-4 3.4-4.4"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

interface SampleEvent {
  icon: EventIconType;
  title: string;
  description: string;
  gradient: string;
}

const SAMPLE_EVENTS: SampleEvent[] = [
  {
    icon: 'fireworks',
    title: 'Sylwester',
    description: 'Wspólne powitanie Nowego Roku z biletami i limitem miejsc.',
    gradient: 'from-brand-950 via-brand-800 to-brand-600',
  },
  {
    icon: 'beach',
    title: 'Wyjazd wakacyjny',
    description: 'Kilkudniowy wyjazd z zapisami, zaliczkami i kartą uczestnika.',
    gradient: 'from-brand-300 via-brand-200 to-brand-50',
  },
  {
    icon: 'ski',
    title: 'Wyjazd na narty',
    description: 'Rejestracja na obóz zimowy z wyborem pakietu i terminu.',
    gradient: 'from-brand-900 via-brand-700 to-brand-400',
  },
  {
    icon: 'disco',
    title: 'Dyskoteka',
    description: 'Szybki formularz wejściówek na wieczorne wydarzenie.',
    gradient: 'from-brand-800 via-brand-600 to-brand-500',
  },
  {
    icon: 'camp',
    title: 'Rekolekcje weekendowe',
    description: 'Zapisy grupowe z polami dodatkowymi i zgodami prawnymi.',
    gradient: 'from-brand-700 via-brand-800 to-brand-950',
  },
  {
    icon: 'picnic',
    title: 'Piknik integracyjny',
    description: 'Wydarzenie bezpłatne z prostym formularzem obecności.',
    gradient: 'from-brand-400 via-brand-500 to-brand-700',
  },
];

const FEATURES = [
  {
    title: 'Formularze na miarę',
    description: 'Buduj sekcje i pola dopasowane do każdego wydarzenia — bez kodu, w kilka minut.',
    path: 'M4 6h16M4 12h10M4 18h7',
  },
  {
    title: 'Płatności online',
    description: 'Bilety płatne i darmowe, limity miejsc i rezerwacje pilnowane automatycznie.',
    path: 'M3 8h18M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2M3 8v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M7 16h4',
  },
  {
    title: 'Panel dla organizatorów',
    description: 'Zgłoszenia, eksport CSV i zarządzanie wydarzeniami w jednym miejscu.',
    path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v4l3 2',
  },
];

function LoginPanel({ onClose }: { onClose: () => void }) {
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
    <div className="absolute right-0 top-full z-30 mt-3 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">Logowanie do panelu</p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Zamknij">
          ✕
        </button>
      </div>
      <form onSubmit={onSubmit} className="space-y-2.5">
        <input
          type="email"
          className="input"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <input
          type="password"
          className="input"
          placeholder="Hasło"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Logowanie…' : 'Zaloguj się'}
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  const [loginOpen, setLoginOpen] = useState(false);
  const eventsRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-slate-100/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Syjon Event" className="h-9 w-9" />
            <span className="font-display text-lg font-semibold text-brand-900">Syjon Event</span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLoginOpen((v) => !v)}
              className="btn-ghost text-sm text-brand-800 hover:bg-brand-50"
            >
              Panel organizatora
            </button>
            {loginOpen && <LoginPanel onClose={() => setLoginOpen(false)} />}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-brand-gradient">
        <div
          aria-hidden
          className="animate-float-slow absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-300/30 blur-3xl"
        />
        <div
          aria-hidden
          className="animate-float-slower absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center sm:py-32">
          <span className="badge border border-white/25 bg-white/10 px-3.5 py-1.5 text-brand-50">
            Rejestracja na wydarzenia bez chaosu
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl">
            Zorganizuj wydarzenie i zbieraj zgłoszenia w jednym miejscu
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-brand-100 sm:text-lg">
            Formularze, bilety, płatności i lista uczestników — od sylwestra po wyjazd na narty.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => eventsRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="btn-primary bg-white text-brand-800 shadow-soft hover:bg-brand-50 active:bg-brand-100"
            >
              Zobacz przykładowe wydarzenia
            </button>
          </div>
        </div>
      </section>

      {/* Sample events */}
      <section ref={eventsRef} className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900">Do jakich wydarzeń pasuje Syjon Event?</h2>
          <p className="mt-3 text-slate-500">
            Poniżej kilka przykładów — Twój formularz może wyglądać zupełnie inaczej, dopasowany do konkretnego
            wydarzenia.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SAMPLE_EVENTS.map((event) => (
            <div
              key={event.title}
              className={`group relative aspect-[4/5] overflow-hidden rounded-3xl bg-gradient-to-br shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-soft ${event.gradient}`}
            >
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.15]"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                }}
              />
              <span className="badge absolute right-4 top-4 bg-white/15 text-white backdrop-blur">Przykład</span>
              <div className="flex h-full items-center justify-center">
                <EventIcon type={event.icon} className="h-16 w-16 text-white/90 transition group-hover:scale-110" />
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-950/80 via-brand-950/30 to-transparent p-5 pt-12">
                <h3 className="font-display text-lg font-semibold text-white">{event.title}</h3>
                <p className="mt-1 text-sm text-brand-50/90">{event.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="bg-brand-gradient-soft">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-brand-900">Wszystko, czego potrzebuje organizator</h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                    <path d={feature.path} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Syjon Event" className="h-6 w-6" />
            <span>Syjon Event</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link to="/platnosci" className="hover:text-brand-700 hover:underline">
              Sposoby płatności
            </Link>
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brand-700 hover:underline"
            >
              Polityka prywatności
            </a>
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brand-700 hover:underline"
            >
              Regulamin serwisu internetowego
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
