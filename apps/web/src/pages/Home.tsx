import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, LogIn, TicketX, X } from 'lucide-react';
import type { PublicEventListItemDto } from '@syjonevent/shared';
import { api } from '../lib/api';
import LoginForm from '../components/LoginForm';
import { SiteFooter, SiteHeader, SocialLinks } from '../components/SiteChrome';

const PAST_EVENTS = [
  {
    title: 'Sylwester z Syjonem',
    description: 'Wspólne przywitanie Nowego Roku pełne uwielbienia, świadectw i radości — zobacz, jak było!',
    video: '/sylwester.mp4',
  },
  {
    title: 'Syjon Camp',
    description:
      'Syjon Camp to wakacyjny wyjazd rekolekcyjno-wypoczynkowy, w którym tworzymy przestrzeń na wzrost duchowy, budowanie relacji a także reset duszy i ciała!',
    video: '/mikorzyn.mp4',
  },
];

const eventDateFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const closesFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });

function EventCard({ event, delay = 0 }: { event: PublicEventListItemDto; delay?: number }) {
  return (
    <Link
      to={`/f/${event.slug}`}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-pop-in group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-3xl bg-brand-gradient shadow-card transition duration-300 hover:-translate-y-1.5 hover:scale-[1.02] hover:shadow-soft"
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
  return (
    <div className="animate-pop-in absolute right-0 top-full z-30 mt-3 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">Logowanie do panelu</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Zamknij"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <LoginForm compact />
    </div>
  );
}

/**
 * Film z poprzedniego wydarzenia: gra tylko, gdy jest widoczny na ekranie, i nie pobiera się
 * w całości od razu — dwa filmy naraz zjadały transfer na komórce.
 */
function PastEventVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.5 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      controls
      preload="metadata"
      className="aspect-video w-full bg-slate-900 object-cover"
    />
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
      <SiteHeader>
        <SocialLinks className="hidden sm:flex" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setLoginOpen((v) => !v)}
            aria-expanded={loginOpen}
            className="btn-ghost text-sm text-brand-800 hover:bg-brand-50"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Login
          </button>
          {loginOpen && <LoginPanel onClose={() => setLoginOpen(false)} />}
        </div>
      </SiteHeader>

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
        <div className="relative mx-auto max-w-6xl px-6 py-14 text-center sm:py-20">
          <span
            className="animate-fade-in-up badge border border-white/25 bg-white/10 px-3.5 py-1.5 text-brand-50"
          >
            Zapisy Online
          </span>
          <h1
            style={{ animationDelay: '90ms' }}
            className="animate-fade-in-up mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl"
          >
            Wydarzenia Wspólnoty Syjon
          </h1>
          <p
            style={{ animationDelay: '180ms' }}
            className="animate-fade-in-up mx-auto mt-5 max-w-xl text-base text-brand-100 sm:text-lg"
          >
            Wybierz wydarzenie, zapisz się w kilka chwil i miej bilet zawsze pod ręką.
          </p>
          <div
            style={{ animationDelay: '270ms' }}
            className="animate-fade-in-up mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <button
              type="button"
              onClick={() => eventsRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="btn-primary bg-white text-brand-800 shadow-soft transition-transform hover:-translate-y-0.5 hover:bg-brand-50 hover:shadow-lg active:translate-y-0 active:bg-brand-100"
            >
              Zobacz wydarzenia
            </button>
          </div>
        </div>
      </section>

      {/* Otwarte zapisy */}
      <section ref={eventsRef} className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16 sm:py-20">
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
            {events.map((event, i) => (
              <EventCard key={event.slug} event={event} delay={i * 80} />
            ))}
          </div>
        )}
      </section>

      {/* Zakończone wydarzenia */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900">Zakończone wydarzenia</h2>
            <p className="mt-3 text-slate-500">Zobacz, jak wyglądały nasze poprzednie spotkania.</p>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2">
            {PAST_EVENTS.map((item) => (
              <div key={item.title} className="overflow-hidden rounded-3xl bg-white shadow-card">
                <PastEventVideo src={item.video} />
                <div className="p-5">
                  <h3 className="font-display text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-500">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
