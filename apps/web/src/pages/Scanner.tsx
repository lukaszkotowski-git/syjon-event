import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CameraOff,
  CircleCheck,
  Flashlight,
  FlashlightOff,
  ImagePlus,
  LoaderCircle,
  LogOut,
  QrCode,
  ScanLine,
  Search,
  ShieldX,
  TimerOff,
  TriangleAlert,
  UserRoundCheck,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type {
  CheckInParticipantDto,
  CheckInResult,
  ScanResultDto,
  StationMeDto,
  StationStatsDto,
} from '@syjonevent/shared';
import { api, ApiError } from '../lib/api';
import { useDebouncedValue } from '../lib/hooks';
import {
  CameraError,
  feedback,
  getQrDetector,
  keepScreenAwake,
  openRearCamera,
  setTorch,
  stopStream,
  torchSupported,
  unlockAudio,
  type CameraErrorKind,
} from '../lib/qr-scanner';

const SCAN_INTERVAL_MS = 150;
/** Ten sam kod wciąż w kadrze po zamknięciu wyniku nie jest wysyłany ponownie przez tyle ms. */
const SAME_CODE_COOLDOWN_MS = 4000;
const SUCCESS_AUTO_DISMISS_MS = 2200;

type Phase = 'idle' | 'starting' | 'scanning' | 'camera-error';

type Overlay =
  | { kind: 'result'; data: ScanResultDto }
  | { kind: 'error'; title: string; message: string };

const RESULT_STYLE: Record<CheckInResult, { title: string; icon: LucideIcon; className: string }> = {
  SUCCESS: { title: 'Wejście OK', icon: CircleCheck, className: 'bg-emerald-600' },
  DUPLICATE: { title: 'Bilet już użyty', icon: TriangleAlert, className: 'bg-amber-500' },
  INVALID: { title: 'Nieprawidłowy kod', icon: ShieldX, className: 'bg-red-600' },
  EXPIRED: { title: 'Kod wygasł', icon: TimerOff, className: 'bg-orange-700' },
};

const CAMERA_ERRORS: Record<CameraErrorKind, string> = {
  denied:
    'Brak zgody na użycie aparatu. iPhone: Ustawienia → Safari → Aparat → Zezwalaj. Android: ikona kłódki obok adresu → Uprawnienia → Aparat.',
  'not-found': 'Nie znaleziono aparatu w tym urządzeniu.',
  insecure: 'Aparat działa tylko na stronie otwartej przez HTTPS.',
  unsupported: 'Ta przeglądarka nie obsługuje aparatu. Użyj Safari (iPhone) lub Chrome (Android).',
  busy: 'Aparat jest zajęty przez inną aplikację. Zamknij ją i spróbuj ponownie.',
  unknown: 'Nie udało się uruchomić aparatu.',
};

const timeFormat = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });

function ParticipantCard({ participant, tone }: { participant: CheckInParticipantDto; tone: 'dark' | 'light' }) {
  const muted = tone === 'dark' ? 'text-white/75' : 'text-slate-500';
  return (
    <div>
      <p className="text-2xl font-bold leading-tight">{participant.displayName}</p>
      <p className="mt-1 text-lg font-medium">{participant.ticketName}</p>
      <p className={`mt-1 text-sm ${muted}`}>
        {participant.maskedEmail} · nr <span className="font-mono">{participant.ticketReference}</span>
      </p>
    </div>
  );
}

export default function Scanner() {
  const [me, setMe] = useState<StationMeDto | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [stats, setStats] = useState<StationStatsDto | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [cameraError, setCameraError] = useState<CameraErrorKind | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [busy, setBusy] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim());
  const [results, setResults] = useState<CheckInParticipantDto[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CheckInParticipantDto | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const overlayOpenRef = useRef(false);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const releaseWakeLockRef = useRef<() => void>(() => undefined);
  const wantCameraRef = useRef(false);

  overlayOpenRef.current = overlay !== null || searchOpen;

  const handleApiError = useCallback((error: unknown, fallbackTitle: string) => {
    if (error instanceof ApiError && error.status === 401) {
      setUnauthorized(true);
      return;
    }
    const offline = !(error instanceof ApiError);
    feedback('error');
    setOverlay({
      kind: 'error',
      title: offline ? 'Brak połączenia' : fallbackTitle,
      message: offline ? 'Sprawdź internet i zeskanuj kod ponownie. Nic nie zostało zapisane.' : error.message,
    });
  }, []);

  const showResult = useCallback((data: ScanResultDto) => {
    setStats(data.stats);
    setOverlay({ kind: 'result', data });
    feedback(data.result === 'SUCCESS' ? 'success' : data.result === 'DUPLICATE' ? 'warning' : 'error');
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const data = await api.get<StationMeDto>('/api/scanner/me');
      setMe(data);
      setStats(data.stats);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUnauthorized(true);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    const timer = window.setInterval(() => void loadMe(), 20_000);
    return () => window.clearInterval(timer);
  }, [loadMe]);

  const submitCode = useCallback(
    async (code: string) => {
      const last = lastCodeRef.current;
      if (last && last.code === code && Date.now() - last.at < SAME_CODE_COOLDOWN_MS) return;
      processingRef.current = true;
      lastCodeRef.current = { code, at: Date.now() };
      setBusy(true);
      try {
        showResult(await api.post<ScanResultDto>('/api/scanner/scan', { code }));
      } catch (error) {
        handleApiError(error, 'Nie udało się sprawdzić biletu');
      } finally {
        setBusy(false);
        processingRef.current = false;
      }
    },
    [handleApiError, showResult],
  );

  const stopCamera = useCallback(() => {
    if (loopRef.current) window.clearTimeout(loopRef.current);
    loopRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    releaseWakeLockRef.current();
    setTorchOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    wantCameraRef.current = true;
    setPhase('starting');
    setCameraError(null);
    try {
      const [detector, stream] = await Promise.all([getQrDetector(), openRearCamera(video)]);
      streamRef.current = stream;
      setTorchAvailable(torchSupported(stream));
      releaseWakeLockRef.current = await keepScreenAwake();
      setPhase('scanning');

      const tick = async () => {
        if (!streamRef.current) return;
        if (!processingRef.current && !overlayOpenRef.current && video.readyState >= 2) {
          try {
            const code = (await detector.detect(video))[0]?.rawValue;
            if (code) await submitCode(code);
          } catch {
            // Pojedyncza nieudana klatka (np. w trakcie ustawiania ostrości) nie przerywa skanowania.
          }
        }
        loopRef.current = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    } catch (error) {
      stopCamera();
      wantCameraRef.current = false;
      setCameraError(error instanceof CameraError ? error.kind : 'unknown');
      setPhase('camera-error');
    }
  }, [stopCamera, submitCode]);

  // Po wyjściu z karty (telefon zablokowany, przełączenie aplikacji) iOS i tak zatrzymuje aparat —
  // zwalniamy go sami i wznawiamy po powrocie.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera();
      } else if (wantCameraRef.current && !streamRef.current) {
        void startCamera();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  function dismissOverlay() {
    setOverlay(null);
    // Kod wciąż widoczny w kadrze nie wróci od razu jako "duplikat".
    if (lastCodeRef.current) lastCodeRef.current.at = Date.now();
  }

  useEffect(() => {
    if (overlay?.kind !== 'result' || overlay.data.result !== 'SUCCESS') return;
    const timer = window.setTimeout(dismissOverlay, SUCCESS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [overlay]);

  async function scanPhoto(file: File) {
    setBusy(true);
    try {
      const detector = await getQrDetector();
      const bitmap = await createImageBitmap(file);
      const code = (await detector.detect(bitmap))[0]?.rawValue;
      bitmap.close();
      if (!code) {
        feedback('error');
        setOverlay({ kind: 'error', title: 'Nie znaleziono kodu', message: 'Na zdjęciu nie widać kodu QR. Spróbuj ponownie z bliska.' });
        return;
      }
      lastCodeRef.current = null;
      await submitCode(code);
    } catch {
      setOverlay({ kind: 'error', title: 'Nie udało się odczytać zdjęcia', message: 'Spróbuj zrobić zdjęcie ponownie.' });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!searchOpen) return;
    if (debouncedQuery.length < 2) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ participants: CheckInParticipantDto[] }>(`/api/scanner/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((data) => {
        if (cancelled) return;
        setResults(data.participants);
        setSearchError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) setUnauthorized(true);
        setSearchError(error instanceof ApiError ? error.message : 'Brak połączenia');
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searchOpen]);

  async function confirmManualCheckIn() {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      const data = await api.post<ScanResultDto>('/api/scanner/check-in', { submissionId: confirmTarget.submissionId });
      setConfirmTarget(null);
      closeSearch();
      showResult(data);
    } catch (error) {
      setConfirmTarget(null);
      handleApiError(error, 'Nie udało się zameldować');
    } finally {
      setBusy(false);
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery('');
    setResults(null);
    setSearchError(null);
  }

  async function logout() {
    stopCamera();
    wantCameraRef.current = false;
    await api.post('/api/scanner/logout').catch(() => undefined);
    setUnauthorized(true);
  }

  async function toggleTorch() {
    const next = !torchOn;
    try {
      await setTorch(streamRef.current, next);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  if (unauthorized) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-brand-950 px-6 text-center text-white">
        <div className="max-w-sm">
          <QrCode className="mx-auto h-12 w-12 text-brand-300" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Stanowisko nie jest zalogowane</h1>
          <p className="mt-2 text-sm text-slate-300">
            Zeskanuj aparatem telefonu kod QR stanowiska od organizatora i wpisz PIN. Sesja mogła wygasnąć albo
            stanowisko zostało wyłączone.
          </p>
        </div>
      </main>
    );
  }

  const progress = stats && stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0;

  return (
    <main className="flex min-h-[100dvh] flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-400">{me?.event.title ?? 'Ładowanie…'}</p>
          <p className="truncate font-semibold">{me?.station.name ?? ''}</p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="text-right" aria-label={`Weszło ${stats.checkedIn} z ${stats.total}`}>
              <p className="font-mono text-lg font-bold leading-none tabular-nums">
                {stats.checkedIn}
                <span className="text-sm text-slate-400">/{stats.total}</span>
              </p>
              <div className="mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-slate-300 active:bg-white/15"
            aria-label="Wyloguj stanowisko"
          >
            <LogOut className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <section className="relative mx-3 flex-1 overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted autoPlay />

        {phase === 'scanning' && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="aspect-square w-[68%] max-w-[18rem] rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            </div>
            <p className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-sm font-medium text-white/90">
              {busy ? 'Sprawdzam bilet…' : 'Skieruj aparat na kod QR biletu'}
            </p>
            {torchAvailable && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white"
                aria-label={torchOn ? 'Wyłącz latarkę' : 'Włącz latarkę'}
              >
                {torchOn ? <FlashlightOff className="h-5 w-5" aria-hidden /> : <Flashlight className="h-5 w-5" aria-hidden />}
              </button>
            )}
          </>
        )}

        {phase !== 'scanning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            {phase === 'camera-error' ? (
              <>
                <CameraOff className="h-12 w-12 text-red-300" aria-hidden />
                <p className="text-sm text-slate-200">{CAMERA_ERRORS[cameraError ?? 'unknown']}</p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="rounded-2xl bg-white/10 px-5 py-3 font-semibold active:bg-white/20"
                >
                  Spróbuj ponownie
                </button>
              </>
            ) : (
              <>
                <ScanLine className="h-14 w-14 text-brand-300" aria-hidden />
                <button
                  type="button"
                  disabled={phase === 'starting'}
                  onClick={() => {
                    unlockAudio();
                    void startCamera();
                  }}
                  className="flex items-center gap-2 rounded-2xl bg-brand-500 px-6 py-4 text-lg font-semibold active:bg-brand-400 disabled:opacity-60"
                >
                  {phase === 'starting' ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <Camera className="h-5 w-5" aria-hidden />
                  )}
                  Uruchom skanowanie
                </button>
                <p className="text-xs text-slate-400">Przeglądarka poprosi o dostęp do aparatu.</p>
              </>
            )}
          </div>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-4 font-semibold active:bg-white/20"
        >
          <Search className="h-5 w-5" aria-hidden />
          Szukaj ręcznie
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-4 font-semibold active:bg-white/20"
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
          Zdjęcie kodu
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void scanPhoto(file);
          }}
        />
      </nav>

      {overlay && (
        <div
          role="alertdialog"
          aria-live="assertive"
          aria-label={overlay.kind === 'result' ? RESULT_STYLE[overlay.data.result].title : overlay.title}
          className={`fixed inset-0 z-20 flex flex-col justify-between p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] ${
            overlay.kind === 'result' ? RESULT_STYLE[overlay.data.result].className : 'bg-slate-800'
          }`}
          onClick={overlay.kind === 'result' && overlay.data.result === 'SUCCESS' ? dismissOverlay : undefined}
        >
          <div>
            {overlay.kind === 'result' ? (
              (() => {
                const style = RESULT_STYLE[overlay.data.result];
                const Icon = style.icon;
                return (
                  <>
                    <Icon className="h-16 w-16" aria-hidden />
                    <h2 className="mt-4 text-4xl font-extrabold leading-tight">{style.title}</h2>
                    <p className="mt-2 text-lg text-white/90">{overlay.data.message}</p>
                    {overlay.data.participant && (
                      <div className="mt-8 rounded-3xl bg-black/15 p-5">
                        <ParticipantCard participant={overlay.data.participant} tone="dark" />
                      </div>
                    )}
                    {overlay.data.result !== 'SUCCESS' && (
                      <p className="mt-6 text-sm text-white/80">
                        {overlay.data.result === 'DUPLICATE'
                          ? 'Sprawdź dokument tożsamości. Jeśli to inna osoba z tym samym kodem, nie wpuszczaj i skontaktuj się z organizatorem.'
                          : overlay.data.result === 'EXPIRED'
                            ? 'Poproś o najnowszy e-mail z biletem albo wyszukaj osobę ręcznie.'
                            : 'Poproś o bilet z e-maila lub wyszukaj osobę ręcznie po nazwisku.'}
                      </p>
                    )}
                  </>
                );
              })()
            ) : (
              <>
                <WifiOff className="h-16 w-16" aria-hidden />
                <h2 className="mt-4 text-3xl font-extrabold">{overlay.title}</h2>
                <p className="mt-2 text-lg text-white/90">{overlay.message}</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={dismissOverlay}
            className="w-full rounded-2xl bg-white py-4 text-lg font-bold text-slate-900 active:bg-white/80"
            autoFocus
          >
            {overlay.kind === 'result' && overlay.data.result === 'SUCCESS' ? 'Dalej' : 'Skanuj dalej'}
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="fixed inset-0 z-10 flex flex-col bg-slate-950 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2 px-3 pb-3">
            <button
              type="button"
              onClick={closeSearch}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/5 active:bg-white/15"
              aria-label="Wróć do skanowania"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </button>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                autoFocus
                className="w-full rounded-xl border-0 bg-white/10 py-3.5 pl-12 pr-4 text-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="Nazwisko, e-mail lub nr biletu"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-6">
            {searchError && <p className="px-2 py-4 text-sm text-red-300">{searchError}</p>}
            {query.trim().length < 2 && (
              <p className="px-2 py-6 text-center text-sm text-slate-400">
                Wpisz co najmniej 2 znaki. Szukamy tylko wśród opłaconych biletów tego wydarzenia.
              </p>
            )}
            {results?.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">Brak wyników.</p>}
            <ul className="space-y-2">
              {results?.map((participant) => (
                <li key={participant.submissionId}>
                  <button
                    type="button"
                    onClick={() => setConfirmTarget(participant)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/5 p-4 text-left active:bg-white/15"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{participant.displayName}</p>
                      <p className="truncate text-sm text-slate-400">
                        {participant.ticketName} · {participant.maskedEmail}
                      </p>
                    </div>
                    {participant.checkedInAt ? (
                      <span className="shrink-0 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300">
                        wejście {timeFormat.format(new Date(participant.checkedInAt))}
                      </span>
                    ) : (
                      <UserRoundCheck className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div role="alertdialog" aria-label="Potwierdź zameldowanie" className="w-full rounded-3xl bg-white p-5 text-slate-900">
            <p className="text-sm font-medium text-slate-500">Zameldować ręcznie?</p>
            <div className="mt-3">
              <ParticipantCard participant={confirmTarget} tone="light" />
            </div>
            {confirmTarget.checkedInAt && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Wejście już zarejestrowane o {timeFormat.format(new Date(confirmTarget.checkedInAt))}
                {confirmTarget.checkedInStationName ? ` (${confirmTarget.checkedInStationName})` : ''}.
              </p>
            )}
            <p className="mt-3 text-sm text-slate-500">Sprawdź dokument tożsamości przed zameldowaniem.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="rounded-2xl bg-slate-100 py-3.5 font-semibold active:bg-slate-200"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmManualCheckIn()}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                Zamelduj
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
