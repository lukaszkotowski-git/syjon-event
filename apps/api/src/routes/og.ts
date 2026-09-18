import { Router } from 'express';
import { asyncHandler } from '../http/async-handler.js';
import { env } from '../env.js';
import { formatEventDate } from '../services/mailer.js';
import { prisma } from '../prisma.js';
import { toSummary } from '../utils/text.js';

/**
 * Podgląd linku dla Facebooka, WhatsAppa, Messengera itp. Te roboty nie wykonują JS,
 * więc nginx kieruje je (po User-Agent) na /api/og/f/:slug zamiast na SPA.
 */
export const ogRouter: Router = Router();

const DEFAULT_TITLE = 'Syjon Event — rejestracja na wydarzenia';
const DEFAULT_DESCRIPTION = 'Wydarzenia Wspólnoty Syjon — zapisz się w kilka chwil i miej bilet zawsze pod ręką.';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `${env().APP_BASE_URL.replace(/\/+$/, '')}${url}`;
}

function page(meta: { title: string; description: string; url: string; image: string }): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const u = escapeHtml(meta.url);
  const i = escapeHtml(meta.image);
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Syjon Event" />
    <meta property="og:locale" content="pl_PL" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${i}" />
  </head>
  <body>
    <h1>${t}</h1>
    <p>${d}</p>
    <p><a href="${u}">${u}</a></p>
  </body>
</html>`;
}

ogRouter.get('/home', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(page({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, url: absolute('/'), image: absolute('/logo.png') }));
});

ogRouter.get(
  '/f/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug);
    const url = absolute(`/f/${encodeURIComponent(slug)}`);
    const form = await prisma.form.findUnique({ where: { slug } });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');

    // Szkic lub nieistniejące wydarzenie — ogólny podgląd, bez zdradzania szczegółów.
    if (!form || form.status !== 'PUBLISHED') {
      res.send(page({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, url, image: absolute('/logo.png') }));
      return;
    }

    const when = [formatEventDate(form.eventDate), form.location].filter(Boolean).join(' · ');
    const summary = toSummary(form.description, 200);
    res.send(
      page({
        title: `${form.title} — Syjon Event`,
        description: [when, summary].filter(Boolean).join(' — ') || DEFAULT_DESCRIPTION,
        url,
        image: absolute(form.backgroundImageDesktopUrl ?? form.backgroundImageMobileUrl ?? '/logo.png'),
      }),
    );
  }),
);
