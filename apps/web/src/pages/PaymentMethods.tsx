import { Link } from 'react-router-dom';

export default function PaymentMethods() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Syjon Event" className="h-9 w-9" />
            <span className="font-display text-lg font-semibold text-brand-900">Syjon Event</span>
          </Link>
          <Link to="/" className="btn-ghost text-sm text-brand-800 hover:bg-brand-50">
            ← Strona główna
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Sposoby płatności</h1>
        <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
          Zapłać wygodnie, korzystając z naszych bezpiecznych metod płatności. Akceptujemy m.in. BLIK, Google Pay,
          Apple Pay, Visa i Mastercard. Twoje transakcje są szyfrowane i obsługiwane przez zaufanych dostawców.
        </p>
        <div className="mt-10 card">
          <img src="/paynow.png" alt="Dostępne metody płatności: Paynow, BLIK, Google Pay, Apple Pay, Visa, Mastercard i inne" className="w-full" />
        </div>
      </section>
    </main>
  );
}
