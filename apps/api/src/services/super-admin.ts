import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../env.js';
import { prisma } from '../prisma.js';

export const PASSWORD_HASH_ROUNDS = 12;

/** HMAC hasła z env — pozwala wykryć jego zmianę bez przechowywania samego hasła. */
function envPasswordDigest(password: string): string {
  return crypto.createHmac('sha256', env().SESSION_SECRET).update(`super-admin:${password}`).digest('hex');
}

/**
 * Synchronizuje konto super administratora z SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD przy starcie API.
 *
 * - brak konta → tworzy je z hasłem z env;
 * - hasło w env zmieniło się od ostatniego startu → ustawia je (to jedyna droga odzyskania konta)
 *   i wylogowuje wszystkie sesje; inaczej zostaje hasło zmienione przez super admina w panelu;
 * - rola SUPER_ADMIN przysługuje tylko temu kontu — inne konta z tą rolą (np. po zmianie e-maila
 *   w env) wracają do roli ADMIN.
 */
export async function syncSuperAdmin(): Promise<void> {
  const { SUPER_ADMIN_EMAIL: email, SUPER_ADMIN_PASSWORD: password } = env();

  await prisma.admin.updateMany({
    where: { role: 'SUPER_ADMIN', ...(email ? { email: { not: email } } : {}) },
    data: { role: 'ADMIN' },
  });
  if (!email || !password) {
    console.warn('[super-admin] brak SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD — konto super administratora nie jest skonfigurowane');
    return;
  }

  const digest = envPasswordDigest(password);
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (!existing) {
    await prisma.admin.create({
      data: {
        email,
        role: 'SUPER_ADMIN',
        passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS),
        envPasswordDigest: digest,
      },
    });
    console.log(`[super-admin] utworzono konto ${email}`);
    return;
  }

  const passwordChangedInEnv = existing.envPasswordDigest !== digest;
  await prisma.admin.update({
    where: { id: existing.id },
    data: {
      role: 'SUPER_ADMIN',
      disabledAt: null,
      ...(passwordChangedInEnv
        ? { passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS), envPasswordDigest: digest }
        : {}),
    },
  });
  if (passwordChangedInEnv) {
    await prisma.session.updateMany({
      where: { adminId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.log(`[super-admin] ustawiono hasło konta ${email} z SUPER_ADMIN_PASSWORD`);
  }
}
