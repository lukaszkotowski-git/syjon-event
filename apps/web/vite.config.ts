import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * Dokumenty prawne pod krótkimi adresami (/terms, /policy) zamiast pełnych nazw plików PDF.
 * W produkcji to samo mapowanie robi nginx.conf — po podmianie pliku zaktualizuj oba miejsca.
 */
const LEGAL_DOCUMENTS: Record<string, string> = {
  '/terms': 'Regulamin serwisu internetowego 5.05.2026.pdf',
  '/policy': 'Polityka prywatnosci 27.04.2026.pdf',
};

function legalDocuments(): Plugin {
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    const fileName = LEGAL_DOCUMENTS[pathname];
    const filePath = fileName ? publicDir + fileName : null;
    if (!fileName || !filePath || !existsSync(filePath)) return next();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    createReadStream(filePath).pipe(res);
  };
  return {
    name: 'legal-documents',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

/** Roboty podglądu linków dostają stronę z meta tagami z API — jak w nginx.conf (produkcja). */
const LINK_PREVIEW_BOTS =
  /facebookexternalhit|facebot|twitterbot|whatsapp|slackbot|linkedinbot|telegrambot|discordbot|pinterest|skypeuripreview|vkshare|redditbot|applebot|google-inspectiontool|embedly/i;

function linkPreviews(apiTarget: string): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    const match = /^\/f\/([a-z0-9-]+)\/?$/.exec(pathname);
    if ((!match && pathname !== '/') || !LINK_PREVIEW_BOTS.test(req.headers['user-agent'] ?? '')) return next();
    fetch(`${apiTarget}/api/og/${match ? `f/${match[1]}` : 'home'}`)
      .then(async (response) => {
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') ?? 'text/html; charset=utf-8');
        res.end(await response.text());
      })
      .catch(next);
  };
  return { name: 'link-previews', configureServer: (server) => void server.middlewares.use(middleware) };
}

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), legalDocuments(), linkPreviews(API_TARGET)],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['localhost', 'events.holylabs.ai'],
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
