import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, LoaderCircle, QrCode, ScanLine } from 'lucide-react';
import type { StationLoginInfoDto } from '@syjonevent/shared';
import { api, ApiError } from '../lib/api';

export default function ScannerLogin() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<StationLoginInfoDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .get<StationLoginInfoDto>(`/api/scanner/login-info?t=${encodeURIComponent(token)}`)
      .then((data) => {
        setInfo(data);
        window.setTimeout(() => inputRef.current?.focus(), 50);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Nie udało się sprawdzić linku'));
  }, [token]);

  async function login(value: string) {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/scanner/login', { token, pin: value });
      navigate('/skaner', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nie udało się zalogować');
      setPin('');
      inputRef.current?.focus();
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void login(pin);
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-brand-950 px-5 py-10 text-white">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/20 text-brand-300">
            <ScanLine className="h-7 w-7" aria-hidden />
          </span>
          <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-brand-300">Skaner biletów</p>
        </div>

        {!token ? (
          <div className="rounded-3xl bg-white/5 p-6 text-center ring-1 ring-white/10">
            <QrCode className="mx-auto h-10 w-10 text-brand-300" aria-hidden />
            <h1 className="mt-4 text-lg font-semibold">Zaloguj stanowisko</h1>
            <p className="mt-2 text-sm text-slate-300">
              Zeskanuj aparatem telefonu kod QR stanowiska, który przekazał Ci organizator, i wpisz PIN.
            </p>
          </div>
        ) : loadError ? (
          <div className="rounded-3xl bg-red-500/10 p-6 text-center ring-1 ring-red-400/30">
            <h1 className="text-lg font-semibold">Nie można się zalogować</h1>
            <p className="mt-2 text-sm text-red-100">{loadError}</p>
            <p className="mt-3 text-xs text-slate-300">Poproś organizatora o aktualny kod QR stanowiska.</p>
          </div>
        ) : !info ? (
          <div className="flex justify-center py-10">
            <LoaderCircle className="h-8 w-8 animate-spin text-brand-300" aria-hidden />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
            <p className="text-center text-sm text-slate-300">{info.eventTitle}</p>
            <h1 className="mt-1 text-center text-2xl font-semibold">{info.stationName}</h1>

            <label htmlFor="station-pin" className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-300">
              <KeyRound className="h-4 w-4" aria-hidden />
              Wpisz 6-cyfrowy PIN
            </label>
            <input
              ref={inputRef}
              id="station-pin"
              className="mt-3 w-full rounded-2xl border-0 bg-white/10 px-4 py-4 text-center font-mono text-3xl tracking-[0.5em] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-brand-400"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="••••••"
              value={pin}
              disabled={busy}
              aria-invalid={Boolean(error) || undefined}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                setPin(digits);
                setError(null);
                if (digits.length === 6) void login(digits);
              }}
            />
            {error && <p className="mt-3 text-center text-sm text-red-300">{error}</p>}
            <button
              type="submit"
              disabled={busy || pin.length !== 6}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3.5 font-semibold text-white transition hover:bg-brand-400 disabled:opacity-40"
            >
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              Zaloguj stanowisko
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
