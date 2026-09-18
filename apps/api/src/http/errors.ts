import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Paynow nie odpowiedział (timeout, 5xx, 429) — nie wiemy, czy operacja się wykonała. */
export class PaynowTransientError extends Error {}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Wymagane logowanie') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Brak uprawnień') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Nie znaleziono') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const gone = (message: string, code = 'GONE') => new AppError(410, code, message);
export const badGateway = (message: string) => new AppError(502, 'UPSTREAM_ERROR', message);
export const tooManyRequests = (message: string) => new AppError(429, 'RATE_LIMITED', message);

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Niepoprawne dane wejściowe', details: error.flatten() },
    });
    return;
  }
  if (error instanceof AppError) {
    res
      .status(error.statusCode)
      .json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof PaynowTransientError) {
    console.warn(`[api] ${req.method} ${req.path} — ${error.message}`);
    res.status(503).json({
      error: { code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'Operator płatności chwilowo nie odpowiada. Spróbuj za chwilę.' },
    });
    return;
  }
  if (error instanceof MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE' ? 'Plik jest za duży (limit 5 MB)' : 'Nie udało się wgrać pliku';
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
    return;
  }
  if (error instanceof Error && error.message.startsWith('Dozwolone są tylko obrazy')) {
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: error.message } });
    return;
  }

  // Nigdy nie logujemy body — może zawierać dane osobowe i sekrety.
  console.error(`[api] ${req.method} ${req.path} — nieobsłużony błąd:`, error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Błąd serwera' } });
}
