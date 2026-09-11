import { z } from 'zod';
import { DEFAULT_RESERVATION_SECONDS } from '@syjonevent/shared';

/** Konfiguracja z env — walidowana raz przy starcie, żeby nie wywalić się w runtime. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET musi mieć minimum 32 znaki'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  APP_BASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  PAYNOW_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYNOW_API_KEY: z.string().min(1),
  PAYNOW_SIGNATURE_KEY: z.string().min(1),
  PAYNOW_VALIDITY_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(864_000)
    .default(DEFAULT_RESERVATION_SECONDS),
});

export type Env = z.infer<typeof envSchema> & { PAYNOW_BASE_URL: string };

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Niepoprawna konfiguracja środowiska — ${details}`);
  }
  cached = {
    ...parsed.data,
    PAYNOW_BASE_URL:
      parsed.data.PAYNOW_ENV === 'production'
        ? 'https://api.paynow.pl'
        : 'https://api.sandbox.paynow.pl',
  };
  return cached;
}

export const env = () => loadEnv();
