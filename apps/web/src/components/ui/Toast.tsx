import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, X } from 'lucide-react';

type ToastKind = 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION_MS: Record<ToastKind, number> = { success: 3500, error: 7000 };

/**
 * Powiadomienia w stałym miejscu ekranu (prawy górny róg) — widoczne niezależnie od tego,
 * gdzie strona jest przewinięta, w przeciwieństwie do banerów wstawianych w treść.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current++;
      // Maks. 3 naraz — starsze znikają, żeby seria zapisów nie zasłoniła ekranu.
      setToasts((list) => [...list.slice(-2), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), DURATION_MS[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (text) => push('success', text), error: (text) => push('error', text) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((toast) => {
          const Icon = toast.kind === 'success' ? CircleCheck : CircleX;
          return (
            <div
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-soft"
            >
              <Icon
                className={`mt-0.5 h-5 w-5 shrink-0 ${toast.kind === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
                aria-hidden
              />
              <p className="flex-1">{toast.text}</p>
              <button
                type="button"
                aria-label="Zamknij powiadomienie"
                className="-mr-1 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => dismiss(toast.id)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast wymaga <ToastProvider>');
  return ctx;
}
