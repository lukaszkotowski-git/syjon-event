import type { FieldDefinition, FieldType } from '@syjonevent/shared';

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Tekst',
  email: 'E-mail',
  tel: 'Telefon (+48)',
  number: 'Liczba',
  select: 'Lista wyboru',
  checkbox: 'Checkbox',
  date: 'Data',
};

interface Props {
  fields: FieldDefinition[];
  onChange: (fields: FieldDefinition[]) => void;
}

function emptyField(type: FieldType, index: number): FieldDefinition {
  const base = { key: `pole_${index + 1}`, label: 'Nowe pole', required: false };
  if (type === 'select') return { ...base, type, options: ['Opcja 1'] };
  if (type === 'number') return { ...base, type };
  return { ...base, type } as FieldDefinition;
}

/** Prosty builder: dodawanie, kolejność strzałkami, edycja inline. Bez drag & drop (świadomie). */
export default function FieldBuilder({ fields, onChange }: Props) {
  const update = (index: number, patch: Partial<FieldDefinition>) => {
    onChange(fields.map((field, i) => (i === index ? ({ ...field, ...patch } as FieldDefinition) : field)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const a = next[index] as FieldDefinition;
    const b = next[target] as FieldDefinition;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="text-sm text-slate-500">
          Brak pól dodatkowych. Dane kupującego (e-mail, telefon) i zgody prawne są zawsze obecne.
        </p>
      )}

      {fields.map((field, index) => (
        <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="label">Etykieta</label>
              <input
                className="input"
                value={field.label}
                onChange={(e) => update(index, { label: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Klucz techniczny</label>
              <input
                className="input font-mono text-xs"
                value={field.key}
                onChange={(e) => update(index, { key: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Typ</label>
              <select
                className="input"
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value as FieldType;
                  onChange(
                    fields.map((f, i) =>
                      i === index ? { ...emptyField(type, i), key: f.key, label: f.label, required: f.required } : f,
                    ),
                  );
                }}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => update(index, { required: e.target.checked })}
                />
                Wymagane
              </label>
              <div className="flex gap-1">
                <button type="button" className="btn-secondary px-2 py-1" onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button type="button" className="btn-secondary px-2 py-1" onClick={() => move(index, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1 text-red-600"
                  onClick={() => onChange(fields.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          {field.type === 'select' && (
            <div className="mt-3">
              <label className="label">Opcje (jedna na linię)</label>
              <textarea
                className="input h-24"
                value={field.options.join('\n')}
                onChange={(e) =>
                  // Nie czyścimy tu (trim/filter) — robimy to dopiero na onBlur, bo
                  // czyszczenie na każde naciśnięcie klawisza usuwało pusty ostatni
                  // wiersz i blokowało wpisanie więcej niż jednej linii.
                  update(index, {
                    options: e.target.value.split('\n'),
                  } as Partial<FieldDefinition>)
                }
                onBlur={(e) =>
                  update(index, {
                    options: e.target.value
                      .split('\n')
                      .map((o) => o.trim())
                      .filter(Boolean),
                  } as Partial<FieldDefinition>)
                }
              />
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TYPE_LABELS) as FieldType[]).map((type) => (
          <button
            key={type}
            type="button"
            className="btn-secondary"
            onClick={() => onChange([...fields, emptyField(type, fields.length)])}
          >
            + {TYPE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}
