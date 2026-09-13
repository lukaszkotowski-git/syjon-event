import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Aktywna sekcja = ostatnia, której nagłówek minął górną ćwiartkę ekranu. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  useEffect(() => {
    const update = () => {
      const threshold = window.innerHeight * 0.25;
      let current = ids[0] ?? '';
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= threshold) current = id;
      }
      // Na samym dole strony podświetlamy ostatnią sekcję, nawet jeśli jest krótka.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = ids[ids.length - 1] ?? current;
      }
      setActive(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ids]);
  return active;
}

export default function EditorNav({ sections }: { sections: NavSection[] }) {
  const ids = useMemo(() => sections.map((s) => s.id), [sections]);
  const active = useActiveSection(ids);

  return (
    <>
      {/* Desktop: pionowa nawigacja przyklejona obok formularza. */}
      <nav aria-label="Sekcje wydarzenia" className="sticky top-6 hidden self-start lg:block">
        <ul className="space-y-0.5">
          {sections.map(({ id, label, icon: Icon }) => {
            const isActive = active === id;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(id);
                  }}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-white text-brand-800 shadow-card' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-brand-600' : 'text-slate-400'}`} aria-hidden />
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Mobile/tablet: poziomy pasek skrótów. */}
      <nav
        aria-label="Sekcje wydarzenia"
        className="sticky top-0 z-20 -mx-6 overflow-x-auto border-b border-slate-200 bg-white/90 px-6 py-2 backdrop-blur lg:hidden"
      >
        <ul className="flex gap-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <li key={id} className="shrink-0">
              <a
                href={`#${id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(id);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  active === id ? 'bg-brand-50 text-brand-800' : 'text-slate-500'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
