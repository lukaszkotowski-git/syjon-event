import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { errorHandler } from './http/errors.js';
import { adminDashboardRouter } from './routes/admin-dashboard.js';
import { adminFormsRouter } from './routes/admin-forms.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { webhookRouter } from './routes/webhook.js';
import { UPLOAD_DIR } from './uploads.js';

export function createApp(): Express {
  const app = express();
  const cfg = env();

  app.set('trust proxy', 1); // za reverse proxy Dokploy
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: cfg.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: cfg.NODE_ENV, time: new Date().toISOString() });
  });

  // KRYTYCZNE: webhook przed express.json(), bo podpis liczymy z surowego body.
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use('/api/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
  app.use('/api/auth', authRouter);
  app.use('/api/forms', adminFormsRouter);
  app.use('/api/dashboard', adminDashboardRouter);
  app.use('/api/public', publicRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu' } });
  });
  app.use(errorHandler);

  return app;
}
