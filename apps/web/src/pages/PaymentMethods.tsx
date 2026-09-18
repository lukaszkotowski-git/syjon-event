import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SiteFooter, SiteHeader } from '../components/SiteChrome';

export default function PaymentMethods() {
  return (
    <main className="flex min-h-screen flex-col bg-white text-slate-900">
      <SiteHeader>
        <Link to="/" className="btn-ghost text-sm text-brand-800 hover:bg-brand-50">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Strona główna
        </Link>
      </SiteHeader>

      <section className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 sm:py-20">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Sposoby płatności</h1>
        <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
          Zapłać wygodnie, korzystając z naszych bezpiecznych metod płatności. Akceptujemy m.in. BLIK, Google Pay,
          Apple Pay, Visa i Mastercard. Twoje transakcje są szyfrowane i obsługiwane przez zaufanych dostawców.
        </p>
        <div className="mt-10 card">
          <img src="/paynow.png" alt="Dostępne metody płatności: Paynow, BLIK, Google Pay, Apple Pay, Visa, Mastercard i inne" className="w-full" />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
