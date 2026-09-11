import { Router, raw } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { asyncHandler } from '../http/async-handler.js';
import { verifySignature } from '../paynow/signature.js';
import { PAYNOW_STATUSES } from '../paynow/status.js';
import { applyProviderStatus } from '../services/payments.js';

const notificationSchema = z.object({
  paymentId: z.string().min(1),
  externalId: z.string().min(1).optional(),
  status: z.enum(PAYNOW_STATUSES),
  modifiedAt: z.string().optional(),
});

export const webhookRouter: Router = Router();

/**
 * UWAGA: ten router MUSI być zamontowany PRZED globalnym express.json(),
 * bo podpis Paynow liczony jest z surowego body.
 */
webhookRouter.post(
  '/paynow',
  raw({ type: '*/*', limit: '64kb' }),
  asyncHandler(async (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = (req.header('Signature') ?? req.header('signature')) || undefined;

    if (!verifySignature(env().PAYNOW_SIGNATURE_KEY, rawBody, signature)) {
      // Brak zmiany stanu przy niepoprawnym podpisie.
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Niepoprawny podpis' } });
      return;
    }

    const parsed = notificationSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_NOTIFICATION', message: 'Niepoprawna notyfikacja' } });
      return;
    }

    const modifiedAt = parsed.data.modifiedAt ? new Date(parsed.data.modifiedAt) : null;
    const result = await applyProviderStatus({
      providerPaymentId: parsed.data.paymentId,
      incomingStatus: parsed.data.status,
      incomingModifiedAt: modifiedAt && !Number.isNaN(modifiedAt.getTime()) ? modifiedAt : null,
      rawPayload: parsed.data,
    });

    if (result.outcome === 'unknown-payment') {
      // 202: nie znamy płatności (np. wyścig z zapisem), ale nie chcemy nieskończonych retry.
      console.warn(`[paynow] notyfikacja dla nieznanej płatności ${parsed.data.paymentId}`);
      res.status(202).json({ received: true });
      return;
    }

    // 200 dopiero po trwałym zapisie w bazie.
    res.status(200).json({ received: true });
  }),
);
