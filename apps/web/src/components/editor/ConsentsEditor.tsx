import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ConsentDefinition } from '@syjonevent/shared';
import IconButton from '../ui/IconButton';
import Switch from '../ui/Switch';

interface Props {
  consents: ConsentDefinition[];
  onChange: (consents: ConsentDefinition[]) => void;
}

const MAX_CONSENTS = 10;

const PRESETS = [
  'Wyrażam zgodę na wykorzystanie mojego wizerunku (zdjęcia, nagrania) w materiałach Wspólnoty Syjon.',
  'Chcę otrzymywać informacje o kolejnych wydarzeniach Wspólnoty Syjon na podany adres e-mail.',
];

function nextKey(consents: ConsentDefinition[]): string {
  const used = new Set(consents.map((c) => c.key));
  let n = consents.length + 1;
  while (used.has(`zgoda_${n}`)) n += 1;
  return `zgoda_${n}`;
}

/** Problemy blokujące zapis zgód. */
export function consentsErrors(consents: ConsentDefinition[]): string[] {
  const errors: string[] = [];
  for (const consent of consents) {
    if (!consent.label.trim()) errors.push('Każda zgoda musi mieć treść');
    if (consent.url && !/^https?:\/\/\S+$/.test(consent.url.trim())) {
      errors.push(`Link przy zgodzie „${consent.label.slice(0, 40)}” musi zaczynać się od https://`);
    }
  }
  return [...new Set(errors)];
}

/** Zgody dodatkowe pokazywane obok regulaminu — zapisywane z treścią w każdym zgłoszeniu. */
export default function ConsentsEditor({ consents, onChange }: Props) {
  const update = (index: number, patch: Partial<ConsentDefinition>) =>
    onChange(consents.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const add = (label = '') => onChange([...consents, { key: nextKey(consents), label, required: false }]);
  const unusedPresets = PRESETS.filter((preset) => !consents.some((c) => c.label === preset));

  return (
    <div className="space-y-3">
      {consents.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Brak zgód dodatkowych. Regulamin i polityka prywatności są w formularzu zawsze.
        </p>
      )}

      {consents.map((consent, index) => (
        <div key={consent.key} className="space-y-2.5 rounded-xl bg-slate-50 p-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-2.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <textarea
              className={`input min-h-[3.5rem] flex-1 py-2 ${consent.label.trim() ? '' : 'input-error'}`}
              aria-label="Treść zgody"
              placeholder="Np. Wyrażam zgodę na wykorzystanie mojego wizerunku…"
              value={consent.label}
              onChange={(e) => update(index, { label: e.target.value })}
            />
            <IconButton
              icon={Trash2}
              label="Usuń zgodę"
              tone="danger"
              onClick={() => onChange(consents.filter((_, i) => i !== index))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pl-6">
            <input
              className="input min-w-[14rem] flex-1 py-2 text-xs"
              aria-label="Link do dokumentu (opcjonalnie)"
              placeholder="Link do dokumentu, np. https://… (opcjonalnie)"
              value={consent.url ?? ''}
              onChange={(e) => update(index, { url: e.target.value || undefined })}
            />
            <Switch
              size="sm"
              checked={consent.required}
              onChange={(required) => update(index, { required })}
              label="Wymagana"
            />
          </div>
        </div>
      ))}

      {consents.length < MAX_CONSENTS && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => add()}>
            <Plus className="h-4 w-4" aria-hidden />
            Dodaj zgodę
          </button>
          {unusedPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="btn-ghost text-left text-xs text-brand-700 hover:bg-brand-50"
              onClick={() => add(preset)}
            >
              + {preset.startsWith('Wyrażam') ? 'Zgoda na wizerunek' : 'Zgoda na informacje o wydarzeniach'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
