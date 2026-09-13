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

export default defineConfig({
  plugins: [react(), legalDocuments()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['localhost', 'events.holylabs.ai'],
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
