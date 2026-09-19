import { z } from 'zod';
import { DEFAULT_RESERVATION_SECONDS } from '@syjonevent/shared';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

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
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // UWAGA: z.coerce.boolean() traktuje każdy niepusty string (w tym "false") jako true —
  // trzeba porównać jawnie z wartością tekstową.
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  // Konto super administratora — tworzone przy starcie API, nie da się go utworzyć w panelu.
  // Pusta wartość (np. niezdefiniowana zmienna w docker compose) = brak konta.
  SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email().optional()),
  SUPER_ADMIN_PASSWORD: z.preprocess(
    emptyToUndefined,
    z.string().min(12, 'SUPER_ADMIN_PASSWORD musi mieć minimum 12 znaków').optional(),
  ),
}).refine((v) => Boolean(v.SUPER_ADMIN_EMAIL) === Boolean(v.SUPER_ADMIN_PASSWORD), {
  message: 'SUPER_ADMIN_EMAIL i SUPER_ADMIN_PASSWORD trzeba ustawić razem',
  path: ['SUPER_ADMIN_EMAIL'],
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
