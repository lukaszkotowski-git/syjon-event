import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, TicketX } from 'lucide-react';
import type { PublicEventListItemDto } from '@syjonevent/shared';
import { api, ApiError } from '../lib/api';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../lib/legal';

const SOCIAL_LINKS = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/wspolnota.syjon.waw',
    icon: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/channel/UCvyDmZjgG5AfxiZWluYVuvw/featured',
    icon: (
      <>
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
        <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
      </>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/wspolnota_syjon/',
    icon: (
      <>
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.5" y1="6.5" y2="6.5" />
      </>
    ),
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@wspolnota_syjon',
    icon: (
      <>
        <path d="M13 4v12a4 4 0 1 1-4-4" />
        <path d="M13 8a4 4 0 0 0 4 4v3" />
      </>
    ),
  },
];

const eventDateFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const closesFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });

function EventCard({ event }: { event: PublicEventListItemDto }) {
  return (
    <Link
      to={`/f/${event.slug}`}
      className="group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-3xl bg-brand-gradient shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-soft"
    >
      {event.imageUrl && (
        <img
          src={event.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-brand-950/90 via-brand-950/45 to-brand-950/10" />

      <span className="badge absolute left-4 top-4 items-center gap-1.5 bg-white/15 text-white backdrop-blur">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        {eventDateFormat.format(new Date(event.eventDate))}
      </span>
      {event.soldOut && (
        <span className="badge absolute right-4 top-4 items-center gap-1.5 bg-amber-100 text-amber-900">
          <TicketX className="h-3.5 w-3.5" aria-hidden />
          Brak miejsc
        </span>
      )}

      <div className="relative p-5">
        <h3 className="font-display text-lg font-semibold text-white">{event.title}</h3>
        {event.summary && <p className="mt-1.5 line-clamp-3 text-sm text-brand-50/90">{event.summary}</p>}
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-white">
          {event.soldOut ? 'Zobacz szczegóły' : 'Zapisz się'}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
          <span className="ml-auto text-xs font-normal text-brand-100/80">
            zapisy do {closesFormat.format(new Date(event.closesAt))}
          </span>
        </p>
      </div>
    </Link>
  );
}

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
  const [events, setEvents] = useState<PublicEventListItemDto[] | null>(null);

  useEffect(() => {
    api
      .get<{ events: PublicEventListItemDto[] }>('/api/public/events')
      // Awaria listy nie może zasłonić reszty strony — pokazujemy wtedy pusty stan.
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
  }, []);

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
              Zobacz wydarzenia
            </button>
          </div>
        </div>
      </section>

      {/* Otwarte zapisy */}
      <section ref={eventsRef} className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900">Wydarzenia z otwartymi zapisami</h2>
          <p className="mt-3 text-slate-500">
            Wybierz wydarzenie i zapisz się w kilka chwil. Zapisy zamykają się w terminie podanym na kafelku.
          </p>
        </div>

        {events === null ? (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Ładowanie wydarzeń">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-[4/5] animate-pulse rounded-3xl bg-slate-100" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="mx-auto mt-12 max-w-md rounded-3xl border border-dashed border-slate-300 px-6 py-12 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
            <p className="mt-4 font-display text-lg font-semibold text-slate-800">Brak otwartych zapisów</p>
            <p className="mt-1.5 text-sm text-slate-500">
              Obecnie nie prowadzimy zapisów na żadne wydarzenie. Zajrzyj tu ponownie za jakiś czas.
            </p>
          </div>
        ) : (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.slug} event={event} />
            ))}
          </div>
        )}
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
          <div className="flex items-center gap-4">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="text-slate-400 transition hover:text-brand-700"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  {social.icon}
                </svg>
              </a>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
