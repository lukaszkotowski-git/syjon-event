import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { createAdminUserRequest, updateAdminUserRequest, type AdminUserDto } from '@syjonevent/shared';
import type { Admin } from '@prisma/client';
import { requireAdmin, requireFullAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { audit } from '../services/audit.js';
import { isUniqueViolation } from '../services/capacity.js';

/** Zarządzanie kontami panelu — tylko dla administratorów z pełnym dostępem. */
export const adminUsersRouter: Router = Router();
adminUsersRouter.use(requireAdmin, requireFullAdmin);

const ROLE_LABELS = { ADMIN: 'administrator', VIEWER: 'tylko podgląd' } as const;
const PASSWORD_HASH_ROUNDS = 12;

function toDto(admin: Admin, lastSeenAt: Date | null): AdminUserDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    disabled: admin.disabledAt !== null,
    createdAt: admin.createdAt.toISOString(),
    lastSeenAt: lastSeenAt?.toISOString() ?? null,
  };
}

async function lastSeenByAdmin(): Promise<Map<string, Date | null>> {
  const rows = await prisma.session.groupBy({ by: ['adminId'], _max: { lastSeenAt: true } });
  return new Map(rows.map((row) => [row.adminId, row._max.lastSeenAt]));
}

adminUsersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [admins, lastSeen] = await Promise.all([
      prisma.admin.findMany({ orderBy: { createdAt: 'asc' } }),
      lastSeenByAdmin(),
    ]);
    res.json({ admins: admins.map((admin) => toDto(admin, lastSeen.get(admin.id) ?? null)) });
  }),
);

adminUsersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createAdminUserRequest.parse(req.body);
    try {
      const admin = await prisma.admin.create({
        data: {
          email: body.email,
          role: body.role,
          passwordHash: await bcrypt.hash(body.password, PASSWORD_HASH_ROUNDS),
        },
      });
      await audit(req, {
        action: 'admin.create',
        entityId: admin.id,
        summary: `Dodano konto ${admin.email} (${ROLE_LABELS[admin.role]})`,
      });
      res.status(201).json({ admin: toDto(admin, null) });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Konto z tym adresem już istnieje', 'EMAIL_TAKEN');
      throw error;
    }
  }),
);

adminUsersRouter.patch(
  '/:adminId',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.adminId);
    const admin = id.success ? await prisma.admin.findUnique({ where: { id: id.data } }) : null;
    if (!admin) throw notFound('Nie znaleziono konta');
    const body = updateAdminUserRequest.parse(req.body);

    const isSelf = admin.id === req.admin!.id;
    if (isSelf && (body.role === 'VIEWER' || body.disabled === true)) {
      throw badRequest('Nie możesz odebrać uprawnień ani zablokować własnego konta');
    }
    // Zawsze musi zostać przynajmniej jeden aktywny administrator — inaczej nikt nie odzyska dostępu.
    const losesAdmin = admin.role === 'ADMIN' && admin.disabledAt === null && (body.role === 'VIEWER' || body.disabled === true);
    if (losesAdmin) {
      const activeAdmins = await prisma.admin.count({ where: { role: 'ADMIN', disabledAt: null } });
      if (activeAdmins <= 1) throw badRequest('Musi zostać przynajmniej jeden aktywny administrator');
    }

    const updated = await prisma.admin.update({
      where: { id: admin.id },
      data: {
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.disabled !== undefined ? { disabledAt: body.disabled ? (admin.disabledAt ?? new Date()) : null } : {}),
        ...(body.password !== undefined ? { passwordHash: await bcrypt.hash(body.password, PASSWORD_HASH_ROUNDS) } : {}),
      },
    });

    // Blokada, zmiana roli albo nowe hasło — wylogowujemy wszystkie sesje tego konta.
    if (!isSelf && (body.disabled === true || body.password !== undefined || body.role !== undefined)) {
      await prisma.session.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const changes = [
      body.role !== undefined && body.role !== admin.role ? `rola: ${ROLE_LABELS[body.role]}` : null,
      body.disabled === true && admin.disabledAt === null ? 'zablokowano' : null,
      body.disabled === false && admin.disabledAt !== null ? 'odblokowano' : null,
      body.password !== undefined ? 'nowe hasło' : null,
    ].filter(Boolean);
    if (changes.length > 0) {
      await audit(req, { action: 'admin.update', entityId: admin.id, summary: `Konto ${admin.email}: ${changes.join(', ')}` });
    }

    const lastSeen = await lastSeenByAdmin();
    res.json({ admin: toDto(updated, lastSeen.get(updated.id) ?? null) });
  }),
);
