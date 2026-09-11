import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Syjon Event</h1>
      <p className="mt-2 text-slate-600">
        Portal rejestracyjny na wydarzenia. Formularze publiczne działają pod adresem{' '}
        <code className="rounded bg-slate-200 px-1">/f/:slug</code>.
      </p>
      <Link to="/admin" className="btn-primary mt-6 self-start">
        Panel administratora
      </Link>
    </main>
  );
}
