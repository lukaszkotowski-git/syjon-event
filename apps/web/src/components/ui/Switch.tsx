import type { ReactNode } from 'react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Etykieta tylko dla czytnika ekranu — np. gdy obok stoi już widoczny opis. */
  hideLabel?: boolean;
  description?: ReactNode;
  size?: 'md' | 'sm';
}

export default function Switch({ checked, onChange, label, hideLabel, description, size = 'md' }: Props) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const thumb = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const shift = size === 'sm' ? 'translate-x-4' : 'translate-x-5';
  return (
    <label className={`inline-flex cursor-pointer gap-3 ${description ? 'items-start' : 'items-center'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex shrink-0 items-center rounded-full p-0.5 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 ${description ? 'mt-0.5' : ''} ${track} ${
          checked ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`rounded-full bg-white shadow transition-transform ${thumb} ${checked ? shift : 'translate-x-0'}`}
        />
      </button>
      <span className={hideLabel ? 'sr-only' : 'min-w-0'}>
        <span className={`block font-medium text-slate-700 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}
