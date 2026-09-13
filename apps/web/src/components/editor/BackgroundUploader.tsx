import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Monitor, RefreshCw, Smartphone, Trash2, type LucideIcon } from 'lucide-react';

type Variant = 'desktop' | 'mobile';

interface Props {
  disabled: boolean;
  desktopUrl: string | null;
  mobileUrl: string | null;
  busyVariant: Variant | null;
  onUpload: (variant: Variant, file: File) => void;
  onRemove: (variant: Variant) => void;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export default function BackgroundUploader({ disabled, desktopUrl, mobileUrl, busyVariant, onUpload, onRemove }: Props) {
  if (disabled) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
        Zapisz wydarzenie, aby dodać grafikę tła.
      </p>
    );
  }
  return (
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Tile
        variant="desktop"
        icon={Monitor}
        label="Duży ekran"
        hint="od 800 px szerokości"
        aspect="aspect-video"
        url={desktopUrl}
        busy={busyVariant === 'desktop'}
        onUpload={onUpload}
        onRemove={onRemove}
      />
      <Tile
        variant="mobile"
        icon={Smartphone}
        label="Telefon"
        hint="poniżej 800 px"
        aspect="aspect-[4/5]"
        url={mobileUrl}
        busy={busyVariant === 'mobile'}
        onUpload={onUpload}
        onRemove={onRemove}
      />
    </div>
  );
}

interface TileProps {
  variant: Variant;
  icon: LucideIcon;
  label: string;
  hint: string;
  aspect: string;
  url: string | null;
  busy: boolean;
  onUpload: (variant: Variant, file: File) => void;
  onRemove: (variant: Variant) => void;
}

function Tile({ variant, icon: Icon, label, hint, aspect, url, busy, onUpload, onRemove }: TileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = () => inputRef.current?.click();

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Icon className="h-4 w-4 text-slate-400" aria-hidden />
        {label}
        <span className="font-normal text-slate-400">· {hint}</span>
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onUpload(variant, file);
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) onUpload(variant, file);
        }}
        className={`group/tile relative overflow-hidden rounded-xl border-2 transition ${aspect} ${
          dragging ? 'border-brand-500 bg-brand-50' : url ? 'border-transparent' : 'border-dashed border-slate-300'
        }`}
      >
        {url ? (
          <>
            <img src={url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/50 opacity-0 transition focus-within:opacity-100 group-hover/tile:opacity-100">
              <button type="button" className="btn-secondary px-3 py-1.5" disabled={busy} onClick={pick}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                Zamień
              </button>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                disabled={busy}
                onClick={() => onRemove(variant)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Usuń
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-slate-500 transition hover:bg-brand-50/60 hover:text-brand-700 focus:outline-none focus-visible:bg-brand-50"
          >
            <ImagePlus className="h-7 w-7" aria-hidden />
            <span className="text-sm font-medium">Przeciągnij plik lub kliknij</span>
            <span className="text-xs text-slate-400">PNG, JPG, WebP lub GIF · do 5 MB</span>
          </button>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white/80 text-sm text-slate-600">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Wgrywanie…
          </div>
        )}
      </div>
    </div>
  );
}
