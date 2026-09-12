import type { FieldDefinition, FieldType, FormSection } from '@syjonevent/shared';

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
  sections: FormSection[];
  onChange: (sections: FormSection[]) => void;
}

function nextFieldKey(sections: FormSection[]): string {
  const used = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
  let n = sections.reduce((sum, s) => sum + s.fields.length, 0) + 1;
  while (used.has(`pole_${n}`)) n += 1;
  return `pole_${n}`;
}

function emptyField(type: FieldType, key: string): FieldDefinition {
  const base = { key, label: 'Nowe pole', required: false };
  if (type === 'select') return { ...base, type, options: ['Opcja 1'] };
  if (type === 'number') return { ...base, type };
  return { ...base, type } as FieldDefinition;
}

function newSection(): FormSection {
  return { id: crypto.randomUUID(), name: 'Nowa sekcja', fields: [] };
}

/** Builder z sekcjami: dodawanie sekcji/pól, kolejność strzałkami, przenoszenie pola między sekcjami. Bez drag & drop (świadomie). */
export default function SectionBuilder({ sections, onChange }: Props) {
  const updateSection = (sectionIndex: number, patch: Partial<FormSection>) => {
    onChange(sections.map((s, i) => (i === sectionIndex ? { ...s, ...patch } : s)));
  };

  const moveSection = (sectionIndex: number, direction: -1 | 1) => {
    const target = sectionIndex + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const a = next[sectionIndex] as FormSection;
    const b = next[target] as FormSection;
    next[sectionIndex] = b;
    next[target] = a;
    onChange(next);
  };

  const removeSection = (sectionIndex: number) => {
    onChange(sections.filter((_, i) => i !== sectionIndex));
  };

  const addSection = () => {
    onChange([...sections, newSection()]);
  };

  const updateField = (sectionIndex: number, fieldIndex: number, patch: Partial<FieldDefinition>) => {
    onChange(
      sections.map((s, i) =>
        i === sectionIndex
          ? { ...s, fields: s.fields.map((f, j) => (j === fieldIndex ? ({ ...f, ...patch } as FieldDefinition) : f)) }
          : s,
      ),
    );
  };

  const moveField = (sectionIndex: number, fieldIndex: number, direction: -1 | 1) => {
    const section = sections[sectionIndex] as FormSection;
    const target = fieldIndex + direction;
    if (target < 0 || target >= section.fields.length) return;
    const fields = [...section.fields];
    const a = fields[fieldIndex] as FieldDefinition;
    const b = fields[target] as FieldDefinition;
    fields[fieldIndex] = b;
    fields[target] = a;
    updateSection(sectionIndex, { fields });
  };

  const removeField = (sectionIndex: number, fieldIndex: number) => {
    const section = sections[sectionIndex] as FormSection;
    updateSection(sectionIndex, { fields: section.fields.filter((_, j) => j !== fieldIndex) });
  };

  const addField = (sectionIndex: number, type: FieldType) => {
    const section = sections[sectionIndex] as FormSection;
    updateSection(sectionIndex, { fields: [...section.fields, emptyField(type, nextFieldKey(sections))] });
  };

  const moveFieldToSection = (fromSectionIndex: number, fieldIndex: number, toSectionId: string) => {
    const fromSection = sections[fromSectionIndex] as FormSection;
    if (fromSection.id === toSectionId) return;
    const field = fromSection.fields[fieldIndex] as FieldDefinition;
    onChange(
      sections.map((s, i) => {
        if (i === fromSectionIndex) return { ...s, fields: s.fields.filter((_, j) => j !== fieldIndex) };
        if (s.id === toSectionId) return { ...s, fields: [...s.fields, field] };
        return s;
      }),
    );
  };

  return (
    <div className="space-y-6">
      {sections.length === 0 && (
        <p className="text-sm text-slate-500">
          Brak sekcji. Dane kupującego (e-mail, telefon) i zgody prawne są zawsze obecne.
        </p>
      )}

      {sections.map((section, sectionIndex) => (
        <div key={section.id} className="rounded-lg border border-slate-300 p-4">
          <div className="mb-3 flex items-center gap-2">
            <input
              className="input flex-1 font-medium"
              value={section.name}
              onChange={(e) => updateSection(sectionIndex, { name: e.target.value })}
              placeholder="Nazwa sekcji"
            />
            <div className="flex gap-1">
              <button type="button" className="btn-secondary px-2 py-1" onClick={() => moveSection(sectionIndex, -1)}>
                ↑
              </button>
              <button type="button" className="btn-secondary px-2 py-1" onClick={() => moveSection(sectionIndex, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-red-600"
                onClick={() => removeSection(sectionIndex)}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {section.fields.map((field, fieldIndex) => (
              <div key={field.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <div>
                    <label className="label">Etykieta</label>
                    <input
                      className="input"
                      value={field.label}
                      onChange={(e) => updateField(sectionIndex, fieldIndex, { label: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Klucz techniczny</label>
                    <input
                      className="input font-mono text-xs"
                      value={field.key}
                      onChange={(e) => updateField(sectionIndex, fieldIndex, { key: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Typ</label>
                    <select
                      className="input"
                      value={field.type}
                      onChange={(e) => {
                        const type = e.target.value as FieldType;
                        updateField(sectionIndex, fieldIndex, {
                          ...emptyField(type, field.key),
                          label: field.label,
                          required: field.required,
                        } as Partial<FieldDefinition>);
                      }}
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Sekcja</label>
                    <select
                      className="input"
                      value={section.id}
                      onChange={(e) => moveFieldToSection(sectionIndex, fieldIndex, e.target.value)}
                    >
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(sectionIndex, fieldIndex, { required: e.target.checked })}
                      />
                      Wymagane
                    </label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1"
                        onClick={() => moveField(sectionIndex, fieldIndex, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1"
                        onClick={() => moveField(sectionIndex, fieldIndex, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-red-600"
                        onClick={() => removeField(sectionIndex, fieldIndex)}
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
                        updateField(sectionIndex, fieldIndex, {
                          options: e.target.value.split('\n'),
                        } as Partial<FieldDefinition>)
                      }
                      onBlur={(e) =>
                        updateField(sectionIndex, fieldIndex, {
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
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(TYPE_LABELS) as FieldType[]).map((type) => (
              <button
                key={type}
                type="button"
                className="btn-secondary"
                onClick={() => addField(sectionIndex, type)}
              >
                + {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button type="button" className="btn-secondary" onClick={addSection}>
        + Dodaj sekcję
      </button>
    </div>
  );
}
