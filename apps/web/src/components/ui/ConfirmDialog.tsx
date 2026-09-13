import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Jedno okno potwierdzenia dla całej aplikacji: `if (await confirm({...})) ...`.
 * Przy akcjach niebezpiecznych fokus startuje na "Anuluj", żeby Enter niczego nie skasował.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    // Poprzednie, nierozstrzygnięte pytanie traktujemy jako anulowane.
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (options.tone === 'danger' ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [options, close]);

  const danger = options?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => close(false)} />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-soft"
          >
            <div className="flex gap-4">
              {danger && (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <TriangleAlert className="h-5 w-5" aria-hidden />
                </div>
              )}
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-lg font-semibold text-slate-900">
                  {options.title}
                </h2>
                {options.description && <div className="mt-1.5 text-sm text-slate-600">{options.description}</div>}
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRef} type="button" className="btn-secondary" onClick={() => close(false)}>
                {options.cancelLabel ?? 'Anuluj'}
              </button>
              <button
                ref={confirmRef}
                type="button"
                className={danger ? 'btn bg-red-600 text-white hover:bg-red-700 active:bg-red-800' : 'btn-primary'}
                onClick={() => close(true)}
              >
                {options.confirmLabel ?? 'Potwierdź'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm wymaga <ConfirmProvider>');
  return ctx;
}
