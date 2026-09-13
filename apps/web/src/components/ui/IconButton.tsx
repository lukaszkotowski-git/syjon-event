import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Wymagane: trafia do aria-label i podpowiedzi — przycisk bez tekstu musi mieć nazwę. */
  label: string;
  tone?: 'default' | 'danger';
  /** `sm` — mniejszy, bez ramki; do wstawiania w tekst, np. w wierszu tabeli. */
  size?: 'sm' | 'md' | 'lg';
  /** Po której stronie pokazać podpowiedź — `bottom` przy górnej krawędzi ekranu. */
  tooltip?: 'top' | 'bottom';
}

/** Przycisk z samą ikoną: czytnik ekranu dostaje `label`, mysz i klawiatura — podpowiedź. */
export default function IconButton({
  icon: Icon,
  label,
  tone = 'default',
  size = 'md',
  tooltip = 'top',
  className = '',
  ...rest
}: Props) {
  const toneClass =
    tone === 'danger'
      ? 'text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600'
      : 'text-slate-500 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800';
  return (
    // Nazwana grupa (`group/icon`), żeby hover na rodzicu z własną klasą `group` (np. wierszu tabeli)
    // nie odsłaniał podpowiedzi wszystkich przycisków w środku.
    <span className="group/icon relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-lg border transition ${
          size === 'sm'
            ? 'h-6 w-6 border-transparent bg-transparent'
            : size === 'lg'
              ? 'h-10 w-10 rounded-xl border-slate-200 bg-white'
              : 'h-8 w-8 border-slate-200 bg-white'
        } focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:pointer-events-none disabled:opacity-40 ${toneClass} ${className}`}
        {...rest}
      >
        <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      </button>
      <span
        role="presentation"
        className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover/icon:opacity-100 group-has-[:focus-visible]/icon:opacity-100 ${
          tooltip === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
