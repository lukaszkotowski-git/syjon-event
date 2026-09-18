import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../lib/legal';

const SOCIAL_LINKS = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/wspolnota.syjon.waw',
    icon: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/channel/UCvyDmZjgG5AfxiZWluYVuvw/featured',
    icon: (
      <>
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
        <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
      </>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/wspolnota_syjon/',
    icon: (
      <>
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.5" y1="6.5" y2="6.5" />
      </>
    ),
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@wspolnota_syjon',
    icon: (
      <>
        <path d="M13 4v12a4 4 0 1 1-4-4" />
        <path d="M13 8a4 4 0 0 0 4 4v3" />
      </>
    ),
  },
];

export function SocialLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3.5 ${className}`}>
      {SOCIAL_LINKS.map((social) => (
        <a
          key={social.label}
          href={social.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={social.label}
          className="inline-flex text-slate-400 transition hover:-translate-y-0.5 hover:scale-110 hover:text-brand-700"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[18px] w-[18px]"
            aria-hidden
          >
            {social.icon}
          </svg>
        </a>
      ))}
    </div>
  );
}

/** Nagłówek stron publicznych; `children` to akcje po prawej stronie. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-9 w-9" />
          <span className="font-display text-lg font-semibold text-brand-900">Syjon Event</span>
        </Link>
        <div className="flex items-center gap-4">{children}</div>
      </div>
    </header>
  );
}

const footerLinkClass = 'hover:text-brand-700 hover:underline';

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-6 w-6" />
            <span>Syjon Event</span>
          </div>
          <SocialLinks />
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link to="/platnosci" className={footerLinkClass}>
            Sposoby płatności
          </Link>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className={footerLinkClass}>
            Polityka prywatności
          </a>
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={footerLinkClass}>
            Regulamin serwisu internetowego
          </a>
        </nav>
      </div>
    </footer>
  );
}
