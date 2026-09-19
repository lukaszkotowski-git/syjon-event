/**
 * Seed kont administratorów z ADMIN_USERS.
 * Format: "email:hasło,email2:hasło2" (hasło bez przecinka).
 * Uruchomienie: npm run seed:admins
 *
 * Idempotentny: istniejące konto dostaje nowy hash hasła (reset), nowe jest tworzone.
 * Nigdy nie loguje haseł.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function parseAdminUsers(raw: string): { email: string; password: string }[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator < 1) {
        throw new Error('ADMIN_USERS ma niepoprawny format. Oczekiwano "email:haslo,email2:haslo2".');
      }
      const email = entry.slice(0, separator).trim().toLowerCase();
      const password = entry.slice(separator + 1);
      if (!email.includes('@') || password.length < 12) {
        throw new Error(`Konto ${email}: wymagany poprawny e-mail i hasło minimum 12 znaków.`);
      }
      return { email, password };
    });
}

async function main() {
  const raw = process.env.ADMIN_USERS;
  if (!raw) {
    throw new Error('Brak zmiennej ADMIN_USERS.');
  }

  const admins = parseAdminUsers(raw);
  if (admins.length === 0) {
    throw new Error('ADMIN_USERS nie zawiera żadnego konta.');
  }

  // Konto super administratora zarządza się wyłącznie przez SUPER_ADMIN_* — seed go nie dotyka.
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  for (const { email, password } of admins) {
    if (email === superAdminEmail) {
      console.log(`[seed] pominięto ${email} — to konto super administratora (SUPER_ADMIN_*)`);
      continue;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.admin.upsert({
      where: { email },
      update: { passwordHash, disabledAt: null },
      create: { email, passwordHash },
    });
    console.log(`[seed] konto gotowe: ${email}`);
  }

  console.log(`[seed] zapisano ${admins.length} kont administratorów.`);
}

main()
  .catch((error: unknown) => {
    console.error('[seed] błąd:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
