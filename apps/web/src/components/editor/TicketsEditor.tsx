import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { depositError, MAX_TICKET_TYPES_PER_FORM, MIN_PAID_AMOUNT_CENTS } from '@syjonevent/shared';
import { formatPln } from '../../lib/api';
import { centsToPlnInput, parsePlnInput } from '../../lib/format';
import IconButton from '../ui/IconButton';
import Switch from '../ui/Switch';

export interface TicketDraft {
  /** Stabilny klucz React — id z bazy albo tymczasowy dla biletu jeszcze niezapisanego. */
  key: string;
  id: string | null;
  name: string;
  priceInput: string;
  /** Pusty = bilet płatny tylko w całości. */
  depositInput: string;
  capacityInput: string;
  isActive: boolean;
}

/** Zaliczka w groszach; null = brak zaliczki, NaN = niepoprawna kwota. */
export function parseDepositInput(input: string): number | null {
  if (input.trim() === '') return null;
  return parsePlnInput(input) ?? Number.NaN;
}

export function ticketError(ticket: TicketDraft): { name?: string; price?: string; deposit?: string; capacity?: string } {
  const errors: { name?: string; price?: string; deposit?: string; capacity?: string } = {};
  if (!ticket.name.trim()) errors.name = 'Podaj nazwę biletu';
  const cents = parsePlnInput(ticket.priceInput);
  if (cents === null) errors.price = 'Niepoprawna kwota';
  else if (cents > 0 && cents < MIN_PAID_AMOUNT_CENTS) errors.price = 'Min. 1,00 zł lub 0';
  const deposit = parseDepositInput(ticket.depositInput);
  if (Number.isNaN(deposit)) errors.deposit = 'Niepoprawna kwota';
  else if (cents !== null) {
    const message = depositError(cents, deposit);
    if (message) errors.deposit = message;
  }
  if (ticket.capacityInput !== '' && !(Number.isInteger(Number(ticket.capacityInput)) && Number(ticket.capacityInput) > 0)) {
    errors.capacity = 'Liczba większa od 0';
  }
  return errors;
}

interface Props {
  tickets: TicketDraft[];
  onChange: (tickets: TicketDraft[]) => void;
  occupancy: { total: number; perTicketType: Record<string, number> };
  capacityTotal: number | null;
  showErrors: boolean;
}

export default function TicketsEditor({ tickets, onChange, occupancy, capacityTotal, showErrors }: Props) {
  const update = (index: number, patch: Partial<TicketDraft>) =>
    onChange(tickets.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= tickets.length) return;
    const next = [...tickets];
    [next[index], next[target]] = [next[target] as TicketDraft, next[index] as TicketDraft];
    onChange(next);
  };

  const add = () =>
    onChange([
      ...tickets,
      {
        key: `new-${crypto.randomUUID()}`,
        id: null,
        name: '',
        priceInput: '0',
        depositInput: '',
        capacityInput: '',
        isActive: true,
      },
    ]);

  const occupancyPercent =
    capacityTotal && capacityTotal > 0 ? Math.min(100, Math.round((occupancy.total / capacityTotal) * 100)) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <span className="text-slate-600">
          Zajęte miejsca łącznie:{' '}
          <span className="font-semibold text-slate-900">
            {occupancy.total}
            {capacityTotal !== null ? ` / ${capacityTotal}` : ''}
          </span>
        </span>
        {occupancyPercent !== null && (
          <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200" aria-hidden>
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${occupancyPercent}%` }} />
          </div>
        )}
      </div>

      {tickets.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Brak biletów. Dodaj przynajmniej jeden aktywny bilet, żeby opublikować wydarzenie.
        </p>
      )}

      <ul className="space-y-3">
        {tickets.map((ticket, index) => {
          const errors = showErrors ? ticketError(ticket) : {};
          const cents = parsePlnInput(ticket.priceInput);
          const taken = ticket.id ? occupancy.perTicketType[ticket.id] ?? 0 : 0;
          return (
            <li
              key={ticket.key}
              className={`rounded-xl border p-4 transition ${
                ticket.isActive ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50/70'
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <label className="label" htmlFor={`ticket-name-${ticket.key}`}>
                    Nazwa biletu
                  </label>
                  <input
                    id={`ticket-name-${ticket.key}`}
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    placeholder="np. Bilet normalny"
                    value={ticket.name}
                    autoFocus={ticket.id === null && ticket.name === ''}
                    onChange={(e) => update(index, { name: e.target.value })}
                  />
                  {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
                </div>
                <div>
                  <label className="label" htmlFor={`ticket-price-${ticket.key}`}>
                    Cena
                  </label>
                  <div className="relative">
                    <input
                      id={`ticket-price-${ticket.key}`}
                      className={`input pr-10 text-right tabular-nums ${errors.price ? 'input-error' : ''}`}
                      inputMode="decimal"
                      value={ticket.priceInput}
                      onChange={(e) => update(index, { priceInput: e.target.value })}
                      onBlur={() => {
                        const parsed = parsePlnInput(ticket.priceInput);
                        if (parsed !== null) update(index, { priceInput: centsToPlnInput(parsed) });
                      }}
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      zł
                    </span>
                  </div>
                  {errors.price ? (
                    <p className="mt-1 text-xs text-red-600">{errors.price}</p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      {cents === 0 ? 'Bezpłatny' : cents !== null ? formatPln(cents) : ''}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor={`ticket-deposit-${ticket.key}`}>
                    Zaliczka
                  </label>
                  <div className="relative">
                    <input
                      id={`ticket-deposit-${ticket.key}`}
                      className={`input pr-10 text-right tabular-nums ${errors.deposit ? 'input-error' : ''}`}
                      inputMode="decimal"
                      placeholder="Brak"
                      value={ticket.depositInput}
                      onChange={(e) => update(index, { depositInput: e.target.value })}
                      onBlur={() => {
                        const parsed = parseDepositInput(ticket.depositInput);
                        if (parsed !== null && !Number.isNaN(parsed)) {
                          update(index, { depositInput: parsed === 0 ? '' : centsToPlnInput(parsed) });
                        }
                      }}
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      zł
                    </span>
                  </div>
                  {errors.deposit ? (
                    <p className="mt-1 text-xs text-red-600">{errors.deposit}</p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      {(() => {
                        const deposit = parseDepositInput(ticket.depositInput);
                        return deposit && cents ? `Dopłata ${formatPln(cents - deposit)}` : 'Tylko całość';
                      })()}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor={`ticket-capacity-${ticket.key}`}>
                    Limit miejsc
                  </label>
                  <input
                    id={`ticket-capacity-${ticket.key}`}
                    className={`input tabular-nums ${errors.capacity ? 'input-error' : ''}`}
                    type="number"
                    min={1}
                    placeholder="Bez limitu"
                    value={ticket.capacityInput}
                    onChange={(e) => update(index, { capacityInput: e.target.value })}
                  />
                  {errors.capacity ? (
                    <p className="mt-1 text-xs text-red-600">{errors.capacity}</p>
                  ) : (
                    ticket.id && (
                      <p className="mt-1 text-xs text-slate-500">
                        Zajęte: {taken}
                        {ticket.capacityInput ? ` / ${ticket.capacityInput}` : ''}
                      </p>
                    )
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <Switch
                  size="sm"
                  checked={ticket.isActive}
                  onChange={(isActive) => update(index, { isActive })}
                  label={ticket.isActive ? 'Aktywny — widoczny w formularzu' : 'Nieaktywny — ukryty w formularzu'}
                />
                <div className="flex items-center gap-1">
                  {ticket.id === null && (
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
                    disabled={index === tickets.length - 1}
                    onClick={() => move(index, 1)}
                  />
                  {ticket.id === null && (
                    <IconButton
                      icon={Trash2}
                      label="Usuń niezapisany bilet"
                      tone="danger"
                      onClick={() => onChange(tickets.filter((_, i) => i !== index))}
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
          disabled={tickets.length >= MAX_TICKET_TYPES_PER_FORM}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Dodaj bilet
        </button>
        <p className="text-xs text-slate-500">
          Zapisanych biletów nie usuwa się — wyłącz je, aby zniknęły z formularza (zgłoszenia zachowują dane).
        </p>
      </div>
    </div>
  );
}
