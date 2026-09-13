import { useEffect, useState } from 'react';

/** Wartość opóźniona o `delayMs` — np. żeby wyszukiwarka nie wysyłała zapytania na każdy klawisz. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
