import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, RemoveFormatting, type LucideIcon } from 'lucide-react';
import IconButton from './ui/IconButton';

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Podgląd bez edycji (konto "tylko podgląd"). */
  readOnly?: boolean;
}

const COLORS = [
  { label: 'Marka', value: '#24757a' },
  { label: 'Czarny', value: '#0f172a' },
  { label: 'Czerwony', value: '#dc2626' },
  { label: 'Bursztynowy', value: '#d97706' },
  { label: 'Niebieski', value: '#2563eb' },
];

/**
 * Lekki edytor WYSIWYG na contentEditable + document.execCommand — bez zewnętrznej
 * biblioteki. onMouseDown z preventDefault na przyciskach paska narzędzi chroni
 * zaznaczenie tekstu w edytorze (inaczej klik na przycisk je kasuje).
 */
export default function RichTextEditor({ value, onChange, readOnly = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [showHtmlBox, setShowHtmlBox] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState('');

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  }

  function insertCustomHtml() {
    if (!htmlDraft.trim()) return;
    ref.current?.focus();
    document.execCommand('insertHTML', false, htmlDraft);
    onChange(ref.current?.innerHTML ?? '');
    setHtmlDraft('');
    setShowHtmlBox(false);
  }

  const toolbarButton = (icon: LucideIcon, label: string, onClick: () => void, active = false) => (
    <IconButton
      icon={icon}
      label={label}
      aria-pressed={active || undefined}
      className={active ? '!border-brand-200 !bg-brand-50 !text-brand-700' : ''}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    />
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {toolbarButton(Bold, 'Pogrubienie', () => exec('bold'))}
        {toolbarButton(Italic, 'Kursywa', () => exec('italic'))}
        {toolbarButton(RemoveFormatting, 'Wyczyść formatowanie', () => exec('removeFormat'))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={`Kolor: ${c.label}`}
            aria-label={`Kolor tekstu: ${c.label}`}
            className="h-6 w-6 rounded-full border border-slate-300 transition hover:scale-110"
            style={{ backgroundColor: c.value }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('foreColor', c.value)}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {toolbarButton(Code, showHtmlBox ? 'Zamknij wstawianie HTML' : 'Wstaw własny HTML', () => setShowHtmlBox((s) => !s), showHtmlBox)}
      </div>

      {showHtmlBox && (
        <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <textarea
            className="input h-24 font-mono text-xs"
            spellCheck={false}
            placeholder="<div>własny kod HTML wstawiany w miejscu kursora</div>"
            value={htmlDraft}
            onChange={(e) => setHtmlDraft(e.target.value)}
          />
          <button type="button" className="btn-secondary" onMouseDown={(e) => e.preventDefault()} onClick={insertCustomHtml}>
            Wstaw w opisie
          </button>
        </div>
      )}

      <div
        ref={ref}
        contentEditable={!readOnly}
        className="input min-h-[120px] [&_a]:underline"
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onBlur={() => onChange(ref.current?.innerHTML ?? '')}
      />
    </div>
  );
}
