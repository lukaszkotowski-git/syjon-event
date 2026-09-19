import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { prisma } from './prisma.js';
import { syncSuperAdmin } from './services/super-admin.js';

const cfg = loadEnv();
await syncSuperAdmin();
const app = createApp();

const server = app.listen(cfg.PORT, () => {
  console.log(`[api] nasłuchuje na porcie ${cfg.PORT} (${cfg.NODE_ENV}, paynow: ${cfg.PAYNOW_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} — zamykanie`);
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
