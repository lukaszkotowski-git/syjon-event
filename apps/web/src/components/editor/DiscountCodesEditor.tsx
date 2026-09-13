import { Banknote, ChevronDown, ChevronUp, Percent, Plus, Trash2 } from 'lucide-react';
import { MAX_DISCOUNT_CODES_PER_FORM, type DiscountType } from '@syjonevent/shared';
import { centsToPlnInput, parsePlnInput } from '../../lib/format';
import IconButton from '../ui/IconButton';
import Switch from '../ui/Switch';

export interface DiscountCodeDraft {
  /** Stabilny klucz React — id z bazy albo tymczasowy dla kodu jeszcze niezapisanego. */
  key: string;
  id: string | null;
  code: string;
  type: DiscountType;
  /** Procent: liczba "10". Kwota: tekst PLN "10,00" — ten sam format co cena biletu. */
  valueInput: string;
  isActive: boolean;
  usageCount: number;
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{2,40}$/;

export function discountCodeError(draft: DiscountCodeDraft): { code?: string; value?: string } {
  const errors: { code?: string; value?: string } = {};
  if (!CODE_PATTERN.test(draft.code.trim())) {
    errors.code = 'Litery, cyfry, myślnik, podkreślenie (min. 2 znaki)';
  }
  if (draft.type === 'PERCENT') {
    const percent = Number(draft.valueInput);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) errors.value = 'Liczba całkowita 1–100';
  } else {
    const cents = parsePlnInput(draft.valueInput);
    if (cents === null || cents <= 0) errors.value = 'Podaj kwotę większą od zera';
  }
  return errors;
}

interface Props {
  codes: DiscountCodeDraft[];
  onChange: (codes: DiscountCodeDraft[]) => void;
  showErrors: boolean;
}

export default function DiscountCodesEditor({ codes, onChange, showErrors }: Props) {
  const update = (index: number, patch: Partial<DiscountCodeDraft>) =>
    onChange(codes.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= codes.length) return;
    const next = [...codes];
    [next[index], next[target]] = [next[target] as DiscountCodeDraft, next[index] as DiscountCodeDraft];
    onChange(next);
  };

  const add = () =>
    onChange([
      ...codes,
      { key: `new-${crypto.randomUUID()}`, id: null, code: '', type: 'PERCENT', valueInput: '10', isActive: true, usageCount: 0 },
    ]);

  return (
    <div className="space-y-4">
      {codes.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Brak kodów rabatowych. Uczestnicy mogą wpisać kod podczas rejestracji, by otrzymać tańszy bilet.
        </p>
      )}

      <ul className="space-y-3">
        {codes.map((code, index) => {
          const errors = showErrors ? discountCodeError(code) : {};
          return (
            <li
              key={code.key}
              className={`rounded-xl border p-4 transition ${
                code.isActive ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50/70'
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)]">
                <div>
                  <label className="label" htmlFor={`discount-code-${code.key}`}>
                    Kod
                  </label>
                  <input
                    id={`discount-code-${code.key}`}
                    className={`input font-mono uppercase ${errors.code ? 'input-error' : ''}`}
                    placeholder="np. WOLONTARIUSZ"
                    value={code.code}
                    autoFocus={code.id === null && code.code === ''}
                    onChange={(e) => update(index, { code: e.target.value.toUpperCase() })}
                  />
                  {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code}</p>}
                </div>

                <div>
                  <span className="label">Typ</span>
                  <div className="inline-flex rounded-xl border border-slate-200 p-1">
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        code.type === 'PERCENT' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800'
                      }`}
                      onClick={() => update(index, { type: 'PERCENT', valueInput: '10' })}
                    >
                      <Percent className="h-3.5 w-3.5" aria-hidden />
                      Procent
                    </button>
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        code.type === 'AMOUNT' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800'
                      }`}
                      onClick={() => update(index, { type: 'AMOUNT', valueInput: '0' })}
                    >
                      <Banknote className="h-3.5 w-3.5" aria-hidden />
                      Kwota
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor={`discount-value-${code.key}`}>
                    Rabat
                  </label>
                  <div className="relative">
                    {code.type === 'PERCENT' ? (
                      <input
                        id={`discount-value-${code.key}`}
                        className={`input pr-8 text-right tabular-nums ${errors.value ? 'input-error' : ''}`}
                        type="number"
                        min={1}
                        max={100}
                        value={code.valueInput}
                        onChange={(e) => update(index, { valueInput: e.target.value })}
                      />
                    ) : (
                      <input
                        id={`discount-value-${code.key}`}
                        className={`input pr-10 text-right tabular-nums ${errors.value ? 'input-error' : ''}`}
                        inputMode="decimal"
                        value={code.valueInput}
                        onChange={(e) => update(index, { valueInput: e.target.value })}
                        onBlur={() => {
                          const parsed = parsePlnInput(code.valueInput);
                          if (parsed !== null) update(index, { valueInput: centsToPlnInput(parsed) });
                        }}
                      />
                    )}
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      {code.type === 'PERCENT' ? '%' : 'zł'}
                    </span>
                  </div>
                  {errors.value && <p className="mt-1 text-xs text-red-600">{errors.value}</p>}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <Switch
                  size="sm"
                  checked={code.isActive}
                  onChange={(isActive) => update(index, { isActive })}
                  label={code.isActive ? 'Aktywny — można go użyć' : 'Nieaktywny — nie zadziała'}
                />
                <div className="flex items-center gap-1">
                  {code.id !== null && (
                    <span className="mr-2 text-xs text-slate-500">
                      Użyto: <span className="font-medium text-slate-700">{code.usageCount}</span>
                    </span>
                  )}
                  {code.id === null && (
                    <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Nowy — zapisz, aby dodać
                    </span>
                  )}
                  <IconButton
                    icon={ChevronUp}
                    label="Przesuń wyżej"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <IconButton
                    icon={ChevronDown}
                    label="Przesuń niżej"
                    disabled={index === codes.length - 1}
                    onClick={() => move(index, 1)}
                  />
                  {code.id === null && (
                    <IconButton
                      icon={Trash2}
                      label="Usuń niezapisany kod"
                      tone="danger"
                      onClick={() => onChange(codes.filter((_, i) => i !== index))}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={add}
          disabled={codes.length >= MAX_DISCOUNT_CODES_PER_FORM}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Dodaj kod
        </button>
        <p className="text-xs text-slate-500">
          Zapisanych kodów nie usuwa się — wyłącz je, aby przestały działać (historia zgłoszeń zostaje).
        </p>
      </div>
    </div>
  );
}
