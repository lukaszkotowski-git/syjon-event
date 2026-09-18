import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginRequest } from '@syjonevent/shared';
import { requireAdmin } from '../auth/middleware.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from '../auth/session.js';
import { asyncHandler } from '../http/async-handler.js';
import { unauthorized } from '../http/errors.js';
import { prisma } from '../prisma.js';

/** Stały hash do porównania przy nieistniejącym koncie — wyrównuje czas odpowiedzi. */
const DUMMY_HASH = bcrypt.hashSync('nieistniejace-haslo-placeholder', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Zbyt wiele prób logowania. Spróbuj później.' } },
});

export const authRouter: Router = Router();

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginRequest.parse(req.body);

    const admin = await prisma.admin.findUnique({ where: { email } });
    const passwordOk = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);

    if (!admin || admin.disabledAt !== null || !passwordOk) {
      throw unauthorized('Niepoprawny e-mail lub hasło');
    }

    const { token, expiresAt } = await createSession(admin.id);
    setSessionCookie(res, token, expiresAt);
    res.json({ admin: { id: admin.id, email: admin.email, role: admin.role } });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await revokeSession(token);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ admin: req.admin });
  }),
);
