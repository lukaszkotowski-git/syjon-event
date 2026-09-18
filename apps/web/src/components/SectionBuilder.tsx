import { useState } from 'react';
import type { FieldCondition, FieldDefinition, FieldType, FormSection } from '@syjonevent/shared';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderPlus,
  GitBranch,
  Hash,
  List,
  Mail,
  Phone,
  Plus,
  Settings2,
  SquareCheck,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useConfirm } from './ui/ConfirmDialog';
import IconButton from './ui/IconButton';
import Menu from './ui/Menu';
import Switch from './ui/Switch';

const FIELD_TYPES: Record<FieldType, { label: string; icon: LucideIcon }> = {
  text: { label: 'Tekst', icon: Type },
  email: { label: 'E-mail', icon: Mail },
  tel: { label: 'Telefon (+48)', icon: Phone },
  number: { label: 'Liczba', icon: Hash },
  select: { label: 'Lista wyboru', icon: List },
  checkbox: { label: 'Checkbox', icon: SquareCheck },
  date: { label: 'Data', icon: Calendar },
};

interface Props {
  sections: FormSection[];
  onChange: (sections: FormSection[]) => void;
}

/** Pola, od których może zależeć widoczność: lista wyboru i checkbox. */
type ConditionSource = Extract<FieldDefinition, { type: 'select' | 'checkbox' }>;

function isConditionSource(field: FieldDefinition): field is ConditionSource {
  return field.type === 'select' || field.type === 'checkbox';
}

/** Dlaczego warunek pola jest niepoprawny (np. po przesunięciu pola źródłowego niżej); null = OK. */
function conditionError(condition: FieldCondition, earlier: FieldDefinition[]): string | null {
  const source = earlier.find((f) => f.key === condition.field);
  if (!source || !isConditionSource(source)) return 'warunek musi wskazywać listę albo checkbox położone wyżej';
  if (source.type === 'select' && (typeof condition.value !== 'string' || !source.options.includes(condition.value))) {
    return 'wybrana w warunku opcja nie istnieje już na liście';
  }
  return null;
}

/** Problemy blokujące zapis (API wymaga niepustych nazw i poprawnych kluczy). */
export function sectionBuilderErrors(sections: FormSection[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const earlier: FieldDefinition[] = [];
  for (const section of sections) {
    if (!section.name.trim()) errors.push('Każda sekcja musi mieć nazwę');
    for (const field of section.fields) {
      if (!field.label.trim()) errors.push('Każde pole musi mieć etykietę');
      if (!/^[a-z][a-z0-9_]*$/.test(field.key)) {
        errors.push(`Klucz „${field.key}”: małe litery, cyfry i podkreślenia, zaczyna się od litery`);
      }
      if (keys.has(field.key)) errors.push(`Klucz „${field.key}” występuje więcej niż raz`);
      keys.add(field.key);
      if (field.type === 'select' && field.options.every((o) => !o.trim())) {
        errors.push(`Lista „${field.label || field.key}” musi mieć przynajmniej jedną opcję`);
      }
      const problem = field.showIf ? conditionError(field.showIf, earlier) : null;
      if (problem) errors.push(`Pole „${field.label || field.key}”: ${problem}`);
      earlier.push(field);
    }
  }
  return [...new Set(errors)];
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

function pluralFields(count: number) {
  if (count === 0) return 'pusta';
  if (count === 1) return '1 pole';
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  return `${count} ${lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'pola' : 'pól'}`;
}

function toggleIn(set: Set<string>, value: string) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Builder z sekcjami: dodawanie sekcji/pól, kolejność strzałkami, przenoszenie pola między sekcjami. Bez drag & drop (świadomie). */
export default function SectionBuilder({ sections, onChange }: Props) {
  const confirm = useConfirm();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Rozwinięte ustawienia pola trzymamy po kluczu pola — przy zmianie klucza przenosimy wpis.
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  const updateSection = (sectionIndex: number, patch: Partial<FormSection>) => {
    onChange(sections.map((s, i) => (i === sectionIndex ? { ...s, ...patch } : s)));
  };

  const moveSection = (sectionIndex: number, direction: -1 | 1) => {
    const target = sectionIndex + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[sectionIndex], next[target]] = [next[target] as FormSection, next[sectionIndex] as FormSection];
    onChange(next);
  };

  const removeSection = async (sectionIndex: number) => {
    const section = sections[sectionIndex] as FormSection;
    // Pusta sekcja znika od razu; z polami — dopiero po potwierdzeniu, bo kasuje je wszystkie.
    if (section.fields.length > 0) {
      const confirmed = await confirm({
        title: `Usunąć sekcję „${section.name || 'bez nazwy'}”?`,
        description: `Razem z sekcją usuniesz ${pluralFields(section.fields.length)}. Zmiana stanie się trwała po zapisaniu wydarzenia.`,
        confirmLabel: 'Usuń sekcję',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    onChange(sections.filter((_, i) => i !== sectionIndex));
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
    [fields[fieldIndex], fields[target]] = [fields[target] as FieldDefinition, fields[fieldIndex] as FieldDefinition];
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
    <div className="space-y-4">
      {sections.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Brak dodatkowych pól. E-mail, telefon kupującego i zgody prawne formularz zbiera zawsze.
        </p>
      )}

      {sections.map((section, sectionIndex) => {
        const isCollapsed = collapsed.has(section.id);
        return (
          <div key={section.id} className="rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 p-3">
              <IconButton
                icon={isCollapsed ? ChevronRight : ChevronDown}
                label={isCollapsed ? 'Rozwiń sekcję' : 'Zwiń sekcję'}
                size="sm"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((prev) => toggleIn(prev, section.id))}
              />
              <input
                className={`input flex-1 py-2 font-medium ${section.name.trim() ? '' : 'input-error'}`}
                value={section.name}
                aria-label="Nazwa sekcji"
                placeholder="Nazwa sekcji, np. Dane uczestnika"
                onChange={(e) => updateSection(sectionIndex, { name: e.target.value })}
              />
              <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 sm:inline">
                {pluralFields(section.fields.length)}
              </span>
              <div className="flex shrink-0 gap-1">
                <IconButton
                  icon={ChevronUp}
                  label="Przesuń sekcję wyżej"
                  disabled={sectionIndex === 0}
                  onClick={() => moveSection(sectionIndex, -1)}
                />
                <IconButton
                  icon={ChevronDown}
                  label="Przesuń sekcję niżej"
                  disabled={sectionIndex === sections.length - 1}
                  onClick={() => moveSection(sectionIndex, 1)}
                />
                <IconButton
                  icon={Trash2}
                  label="Usuń sekcję"
                  tone="danger"
                  onClick={() => void removeSection(sectionIndex)}
                />
              </div>
            </div>

            {!isCollapsed && (
              <div className="space-y-2 border-t border-slate-100 p-3">
                {section.fields.length === 0 && (
                  <p className="px-1 py-2 text-sm text-slate-400">Sekcja jest pusta — dodaj pierwsze pole.</p>
                )}

                {section.fields.map((field, fieldIndex) => {
                  const TypeIcon = FIELD_TYPES[field.type].icon;
                  const settingsOpen = expandedFields.has(field.key);
                  const idBase = `${section.id}-${fieldIndex}`;
                  const earlierFields = [
                    ...sections.slice(0, sectionIndex).flatMap((s) => s.fields),
                    ...section.fields.slice(0, fieldIndex),
                  ];
                  const conditionSources = earlierFields.filter(isConditionSource);
                  const conditionSource = field.showIf
                    ? conditionSources.find((f) => f.key === field.showIf?.field)
                    : undefined;
                  const conditionProblem = field.showIf ? conditionError(field.showIf, earlierFields) : null;
                  return (
                    // Klucz po pozycji, nie po field.key — inaczej edycja klucza przebudowywałaby
                    // wiersz i gubiła fokus po każdym znaku.
                    <div key={idBase} className="rounded-lg bg-slate-50 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700 ring-1 ring-slate-200"
                          title={FIELD_TYPES[field.type].label}
                        >
                          <TypeIcon className="h-4 w-4" aria-hidden />
                        </span>
                        <input
                          className={`input min-w-[10rem] flex-1 py-2 ${field.label.trim() ? '' : 'input-error'}`}
                          value={field.label}
                          aria-label="Etykieta pola"
                          placeholder="Etykieta, np. Imię i nazwisko"
                          onChange={(e) => updateField(sectionIndex, fieldIndex, { label: e.target.value })}
                        />
                        <select
                          className="input w-auto py-2 pr-8"
                          aria-label="Typ pola"
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
                          {Object.entries(FIELD_TYPES).map(([value, meta]) => (
                            <option key={value} value={value}>
                              {meta.label}
                            </option>
                          ))}
                        </select>
                        {field.showIf && (
                          <button
                            type="button"
                            onClick={() => setExpandedFields((prev) => new Set(prev).add(field.key))}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                              conditionProblem ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700'
                            }`}
                            title={conditionProblem ?? `Widoczne, gdy „${conditionSource?.label ?? ''}” = ${String(field.showIf.value)}`}
                          >
                            <GitBranch className="h-3 w-3" aria-hidden />
                            warunkowe
                          </button>
                        )}
                        <div className="px-1">
                          <Switch
                            size="sm"
                            checked={field.required}
                            onChange={(required) => updateField(sectionIndex, fieldIndex, { required })}
                            label="Wymagane"
                          />
                        </div>
                        <div className="ml-auto flex shrink-0 gap-1">
                          <IconButton
                            icon={Settings2}
                            label={settingsOpen ? 'Ukryj ustawienia pola' : 'Ustawienia pola'}
                            aria-expanded={settingsOpen}
                            className={settingsOpen ? '!border-brand-200 !bg-brand-50 !text-brand-700' : ''}
                            onClick={() => setExpandedFields((prev) => toggleIn(prev, field.key))}
                          />
                          <IconButton
                            icon={ChevronUp}
                            label="Przesuń pole wyżej"
                            disabled={fieldIndex === 0}
                            onClick={() => moveField(sectionIndex, fieldIndex, -1)}
                          />
                          <IconButton
                            icon={ChevronDown}
                            label="Przesuń pole niżej"
                            disabled={fieldIndex === section.fields.length - 1}
                            onClick={() => moveField(sectionIndex, fieldIndex, 1)}
                          />
                          <IconButton
                            icon={Trash2}
                            label="Usuń pole"
                            tone="danger"
                            onClick={() => removeField(sectionIndex, fieldIndex)}
                          />
                        </div>
                      </div>

                      {field.type === 'select' && (
                        <div className="mt-2.5 sm:pl-11">
                          <label className="label text-xs" htmlFor={`options-${idBase}`}>
                            Opcje listy (jedna na linię)
                          </label>
                          <textarea
                            id={`options-${idBase}`}
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

                      {settingsOpen && (
                        <div className="mt-2.5 grid gap-3 border-t border-slate-200 pt-2.5 sm:grid-cols-2 sm:pl-11">
                          <div>
                            <label className="label text-xs" htmlFor={`key-${idBase}`}>
                              Klucz techniczny
                            </label>
                            <input
                              id={`key-${idBase}`}
                              className="input py-2 font-mono text-xs"
                              value={field.key}
                              onChange={(e) => {
                                const key = e.target.value;
                                setExpandedFields((prev) => {
                                  const next = new Set(prev);
                                  next.delete(field.key);
                                  next.add(key);
                                  return next;
                                });
                                updateField(sectionIndex, fieldIndex, { key });
                              }}
                            />
                            <p className="mt-1 text-xs text-slate-400">Nazwa kolumny w eksporcie i w kodzie JS.</p>
                          </div>
                          <div>
                            <label className="label text-xs" htmlFor={`section-${idBase}`}>
                              Przenieś do sekcji
                            </label>
                            <select
                              id={`section-${idBase}`}
                              className="input py-2"
                              value={section.id}
                              onChange={(e) => moveFieldToSection(sectionIndex, fieldIndex, e.target.value)}
                            >
                              {sections.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name || 'Sekcja bez nazwy'}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="label flex items-center gap-1.5 text-xs" htmlFor={`condition-${idBase}`}>
                              <GitBranch className="h-3.5 w-3.5 text-violet-600" aria-hidden />
                              Pokaż to pole
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <select
                                id={`condition-${idBase}`}
                                className="input w-auto min-w-[12rem] flex-1 py-2"
                                value={field.showIf?.field ?? ''}
                                onChange={(e) => {
                                  const source = conditionSources.find((f) => f.key === e.target.value);
                                  updateField(sectionIndex, fieldIndex, {
                                    showIf: source
                                      ? { field: source.key, value: source.type === 'checkbox' ? true : (source.options[0] ?? '') }
                                      : undefined,
                                  });
                                }}
                              >
                                <option value="">zawsze</option>
                                {conditionSources.map((source) => (
                                  <option key={source.key} value={source.key}>
                                    gdy „{source.label}”…
                                  </option>
                                ))}
                              </select>
                              {conditionSource && field.showIf && (
                                <select
                                  className="input w-auto min-w-[10rem] flex-1 py-2"
                                  aria-label="Wymagana odpowiedź"
                                  value={String(field.showIf.value)}
                                  onChange={(e) =>
                                    updateField(sectionIndex, fieldIndex, {
                                      showIf: {
                                        field: conditionSource.key,
                                        value: conditionSource.type === 'checkbox' ? e.target.value === 'true' : e.target.value,
                                      },
                                    })
                                  }
                                >
                                  {conditionSource.type === 'checkbox' ? (
                                    <>
                                      <option value="true">jest zaznaczone</option>
                                      <option value="false">nie jest zaznaczone</option>
                                    </>
                                  ) : (
                                    conditionSource.options.map((option) => (
                                      <option key={option} value={option}>
                                        = {option}
                                      </option>
                                    ))
                                  )}
                                </select>
                              )}
                            </div>
                            {conditionProblem ? (
                              <p className="mt-1 text-xs text-red-600">{conditionProblem}</p>
                            ) : conditionSources.length === 0 ? (
                              <p className="mt-1 text-xs text-slate-400">
                                Dodaj wyżej listę wyboru albo checkbox, żeby uzależnić od nich to pole.
                              </p>
                            ) : (
                              <p className="mt-1 text-xs text-slate-400">
                                Ukryte pole nie jest wymagane i nie trafia do zgłoszenia.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <Menu
                  trigger={
                    <>
                      <Plus className="h-4 w-4" aria-hidden />
                      Dodaj pole
                    </>
                  }
                  triggerClassName="btn-ghost px-3 py-2 text-brand-700 hover:bg-brand-50 hover:text-brand-800"
                  items={(Object.keys(FIELD_TYPES) as FieldType[]).map((type) => ({
                    label: FIELD_TYPES[type].label,
                    icon: FIELD_TYPES[type].icon,
                    onSelect: () => addField(sectionIndex, type),
                  }))}
                />
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="btn-secondary" onClick={() => onChange([...sections, newSection()])}>
        <FolderPlus className="h-4 w-4" aria-hidden />
        Dodaj sekcję
      </button>
    </div>
  );
}
