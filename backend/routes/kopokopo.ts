import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '@/services/prisma';
import {
  initiateSTKPush,
  getPaymentStatus,
  subscribeWebhook,
  validateWebhookSignature,
} from '@/services/kopokopo.service';
import { executeGuestMpesaSale } from '@/routes/pos';
import { displayReceiptNo } from '@/services/receipt';
import type { AuthPayload } from '@/middlewares/auth';
import { ensureAuthenticated, canManageOps, ensureOwner } from '@/middlewares/auth';
import 'dotenv/config';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'slowrise-secret-key';

type PosCartLine = { menuItemId: string; quantity: number };

/** posCart stored as { cashierId, items } — also accept legacy bare items array. */
type PosCartPayload = {
  cashierId: string;
  items: PosCartLine[];
};

function parsePosCart(raw: unknown): PosCartPayload | null {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length > 0) {
    return { cashierId: 'pos', items: raw as PosCartLine[] };
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { cashierId?: string; items?: PosCartLine[] };
    if (Array.isArray(obj.items) && obj.items.length > 0) {
      return { cashierId: obj.cashierId || 'pos', items: obj.items };
    }
  }
  return null;
}

function getOptionalUser(req: Request): AuthPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

const SUCCESS_STATUSES = new Set(['success', 'received', 'complete', 'completed', 'paid']);

const mapStatus = (kopoStatus: string): string => {
  const s = (kopoStatus || '').toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return 'success';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'reversed') return 'reversed';
  if (s === 'pending' || s === 'processing' || s === 'request sent') return 'pending';
  return 'pending';
};

function isSuccessStatus(status: string): boolean {
  return mapStatus(status) === 'success';
}

function isConfirmedPaid(parsed: Pick<ParsedKopoPayload, 'rawStatus' | 'status' | 'transactionReference'>): boolean {
  if (!isSuccessStatus(parsed.rawStatus) && parsed.status !== 'success') return false;
  return Boolean(String(parsed.transactionReference || '').trim());
}

function normalizeLocation(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.trim().replace(/\/$/, '');
  }
}

function locationId(url: string): string | null {
  const normalized = normalizeLocation(url);
  if (!normalized) return null;
  const parts = normalized.split('/');
  return parts[parts.length - 1] || null;
}

interface ParsedKopoPayload {
  status: string;
  rawStatus: string;
  amount: number;
  currency: string;
  phone: string;
  reference: string;
  transactionReference: string;
  location: string;
  originationTime: string;
  tillNumber: string;
  paymentId?: string;
  purpose?: string;
  payerType?: string;
}

function parseKopoPayload(payload: any): ParsedKopoPayload {
  const data = payload?.data ?? payload;
  const attrs = data?.attributes ?? {};
  const resource =
    attrs?.event?.resource ??
    payload?.event?.resource ??
    data?.event?.resource ??
    {};
  const links = attrs?._links ?? data?._links ?? payload?._links ?? {};
  const metadata = attrs?.metadata ?? payload?.metadata ?? {};

  const rawStatus = String(
    attrs.status || resource.status || payload?.event?.resource?.status || 'Pending',
  );
  const amountRaw = resource.amount ?? attrs.amount?.value ?? attrs.amount ?? 0;
  const trustedMpesaRef = String(resource.reference ?? attrs.mpesa_receipt_number ?? '').trim();

  let mapped = mapStatus(rawStatus);
  if (mapped === 'success' && !trustedMpesaRef) {
    mapped = 'pending';
  }

  return {
    status: mapped,
    rawStatus: mapped === 'pending' && isSuccessStatus(rawStatus) && !trustedMpesaRef ? 'Pending' : rawStatus,
    amount: Number(amountRaw) || 0,
    currency: resource.currency ?? attrs.amount?.currency ?? 'KES',
    phone: String(
      resource.sender_phone_number ??
        attrs.sender_phone_number ??
        attrs.phone_number ??
        '',
    ),
    reference: String(data?.id ?? attrs.id ?? resource.id ?? payload?.id ?? ''),
    transactionReference: trustedMpesaRef,
    location: normalizeLocation(String(links.self ?? links.resource ?? '')),
    originationTime: String(
      resource.origination_time ??
        attrs.origination_time ??
        attrs.initiation_time ??
        payload?.created_at ??
        '',
    ),
    tillNumber: String(
      resource.till_number ?? attrs.till_number ?? process.env.KOPOKOPO_TILL_NUMBER ?? '',
    ),
    paymentId: String(metadata.payment_id ?? metadata.paymentId ?? '').trim() || undefined,
    purpose: String(metadata.purpose ?? '').trim() || undefined,
    payerType: String(metadata.payer_type ?? metadata.payerType ?? '').trim() || undefined,
  };
}

async function findKopoPayment(parsed: ParsedKopoPayload, hintLocation?: string) {
  const candidates = [
    normalizeLocation(hintLocation || ''),
    parsed.location,
    hintLocation || '',
  ].filter(Boolean);

  for (const loc of candidates) {
    const payment = await prisma.kopoPayment.findUnique({ where: { location: loc } });
    if (payment) return payment;
  }

  if (parsed.paymentId) {
    const payment = await prisma.kopoPayment.findUnique({ where: { id: parsed.paymentId } });
    if (payment) return payment;
  }

  const refIds = [parsed.reference, ...candidates.map(locationId)].filter(Boolean) as string[];
  for (const ref of refIds) {
    const payment = await prisma.kopoPayment.findUnique({ where: { reference: ref } });
    if (payment) return payment;
    const byLocation = await prisma.kopoPayment.findFirst({
      where: { location: { contains: ref } },
      orderBy: { createdAt: 'desc' },
    });
    if (byLocation) return byLocation;
  }

  const mpesaRef = String(parsed.transactionReference || '').trim();
  if (mpesaRef) {
    const byMpesa = await prisma.kopoPayment.findFirst({
      where: {
        OR: [
          { transactionReference: { equals: mpesaRef, mode: 'insensitive' } },
          { reference: { equals: mpesaRef, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (byMpesa) return byMpesa;
  }

  return null;
}

async function completePosSaleFromPayment(
  paymentId: string,
  mpesaReference: string,
): Promise<{ receiptNo: string; posTransactionId: string } | null> {
  const payment = await prisma.kopoPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.purpose !== 'pos_sale' || payment.posCompleted) {
    return null;
  }

  const cart = parsePosCart(payment.posCart);
  if (!cart) return null;

  const claimed = await prisma.kopoPayment.updateMany({
    where: { id: paymentId, posCompleted: false },
    data: { posCompleted: true },
  });
  if (claimed.count === 0) return null;

  try {
    const { posTx } = await executeGuestMpesaSale(
      cart.cashierId,
      cart.items,
      mpesaReference,
    );

    await prisma.kopoPayment.update({
      where: { id: paymentId },
      data: { posTransactionId: posTx.id },
    });

    console.log(`[Kopokopo] POS M-Pesa sale completed: ${displayReceiptNo(posTx)}`);
    return { receiptNo: displayReceiptNo(posTx), posTransactionId: posTx.id };
  } catch (err) {
    await prisma.kopoPayment.update({
      where: { id: paymentId },
      data: { posCompleted: false },
    });
    console.error('[Kopokopo] POS sale completion failed:', err);
    return null;
  }
}

async function applyPaymentUpdate(
  existing: { id: string; amount: number; phone: string; purpose: string; posCompleted: boolean },
  parsed: ParsedKopoPayload,
  rawPayload?: object,
) {
  const creditAmount = parsed.amount > 0 ? parsed.amount : existing.amount;

  const payment = await prisma.kopoPayment.update({
    where: { id: existing.id },
    data: {
      reference: parsed.reference || undefined,
      location: parsed.location || undefined,
      status: parsed.status,
      amount: creditAmount,
      currency: parsed.currency,
      phone: parsed.phone || existing.phone,
      tillNumber: parsed.tillNumber,
      transactionReference: parsed.transactionReference,
      originationTime: parsed.originationTime || undefined,
      ...(rawPayload ? { rawPayload } : {}),
    },
  });

  let posReceiptNo: string | undefined;
  let posTransactionId: string | undefined;
  if (
    isConfirmedPaid(parsed) &&
    payment.purpose === 'pos_sale' &&
    !payment.posCompleted
  ) {
    const posResult = await completePosSaleFromPayment(
      payment.id,
      parsed.transactionReference || parsed.reference || payment.id,
    );
    posReceiptNo = posResult?.receiptNo;
    posTransactionId = posResult?.posTransactionId;
  }

  const updated = await prisma.kopoPayment.findUnique({ where: { id: payment.id } });
  return { payment: updated, posReceiptNo, posTransactionId };
}

const STALE_PENDING_MS = 2 * 60 * 1000;
const ORPHAN_PENDING_MS = 45 * 1000;

function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function isPendingPhoneBlockError(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { error_code?: number; error_message?: string } } };
  const code = e?.response?.data?.error_code ?? e?.response?.status;
  const msg = String(e?.response?.data?.error_message ?? '').toLowerCase();
  return code === 429 || msg.includes('pending request for the phone');
}

async function syncPendingFromKopokopo(paymentId: string, location: string) {
  try {
    const statusData = await getPaymentStatus(location);
    const mpesaRef = String(statusData.reference || '').trim();
    let mapped = mapStatus(statusData.status);
    if (mapped === 'success' && !mpesaRef) mapped = 'pending';
    if (mapped === 'pending') return null;

    const payment = await prisma.kopoPayment.findUnique({ where: { id: paymentId } });
    if (!payment) return null;

    const parsed: ParsedKopoPayload = {
      ...parseKopoPayload(statusData.raw ?? {}),
      rawStatus: statusData.status,
      status: mapped,
      amount: statusData.amount || payment.amount,
      currency: statusData.currency || payment.currency,
      phone: statusData.phone || payment.phone,
      reference: String(payment.reference || statusData.reference || ''),
      transactionReference: mpesaRef || payment.transactionReference || '',
      location: normalizeLocation(location),
      originationTime: statusData.originationTime || payment.originationTime || '',
      tillNumber: payment.tillNumber,
    };

    if (!isConfirmedPaid(parsed) && mapped === 'success') return null;

    const result = await applyPaymentUpdate(payment, parsed, statusData.raw ?? undefined);
    return result.payment;
  } catch (err) {
    console.warn('[Kopokopo] Sync pending failed for', paymentId, err);
    return null;
  }
}

async function resolvePhonePendingBlock(phone: string) {
  const key = phoneKey(phone);
  const now = Date.now();
  const lookback = new Date(now - STALE_PENDING_MS - 60_000);

  const candidates = await prisma.kopoPayment.findMany({
    where: {
      status: 'pending',
      createdAt: { gte: lookback },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  const forPhone = candidates.filter((p) => phoneKey(p.phone) === key);
  if (forPhone.length === 0) return null;

  const toFail: string[] = [];
  let newestLive: (typeof forPhone)[0] | null = null;

  for (const payment of forPhone) {
    const age = now - payment.createdAt.getTime();

    if (!payment.location) {
      if (age > ORPHAN_PENDING_MS) toFail.push(payment.id);
      continue;
    }

    if (age > STALE_PENDING_MS) {
      toFail.push(payment.id);
      continue;
    }

    if (!newestLive) newestLive = payment;
  }

  if (toFail.length > 0) {
    await prisma.kopoPayment.updateMany({
      where: { id: { in: toFail } },
      data: { status: 'failed' },
    });
  }

  if (!newestLive?.location) return null;

  const updated = await syncPendingFromKopokopo(newestLive.id, newestLive.location);
  if (updated && updated.status !== 'pending') return null;

  return updated ?? newestLive;
}

function respondPendingStk(
  res: Response,
  payment: { id: string; location: string | null; amount: number; purpose: string },
  requestedAmount: number,
  resume: boolean,
): void {
  if (!payment.location) {
    res.status(422).json({
      error:
        'An M-Pesa request is already pending on this phone number. Check the phone for the STK prompt or wait about 2 minutes.',
      code: 'PENDING_PHONE',
    });
    return;
  }

  if (Math.abs(payment.amount - requestedAmount) > 0.01) {
    res.status(409).json({
      error: `There is already a pending M-Pesa request for KES ${payment.amount} on this phone. Complete it on the phone or wait about 2 minutes before trying a different amount.`,
      code: 'PENDING_STK',
      location: payment.location,
      paymentId: payment.id,
      pendingAmount: payment.amount,
    });
    return;
  }

  res.status(201).json({
    location: payment.location,
    paymentId: payment.id,
    purpose: payment.purpose,
    resumed: resume,
  });
}

function buildKopoEmitPayload(
  payment: Awaited<ReturnType<typeof prisma.kopoPayment.findUnique>>,
  parsed: Partial<ParsedKopoPayload>,
  extras?: { posReceiptNo?: string; posTransactionId?: string },
) {
  return {
    paymentId: payment?.id,
    location: payment?.location || parsed.location,
    reference: parsed.reference,
    status: parsed.status ?? payment?.status,
    amount: payment?.amount ?? parsed.amount,
    currency: parsed.currency ?? payment?.currency,
    phone: payment?.phone ?? parsed.phone,
    transactionReference: parsed.transactionReference ?? payment?.transactionReference,
    originationTime: parsed.originationTime,
    purpose: payment?.purpose ?? 'pos_sale',
    posCompleted: payment?.posCompleted ?? false,
    posReceiptNo: extras?.posReceiptNo,
    posTransactionId: extras?.posTransactionId,
  };
}

function emitKopokopoUpdate(req: Request, payload: Record<string, unknown>) {
  const io = req.app.get('io');
  if (!io) return;

  io.emit('kopokopo_update', payload);

  const location = payload.location as string | undefined;
  if (location) {
    io.to(location).emit('kopokopo_update', payload);
  }
}

// POST /api/kopokopo/stkpush — POS guest sales only
router.post('/stkpush', async (req: Request, res: Response) => {
  const user = getOptionalUser(req);
  const {
    phone,
    amount,
    description,
    items,
  } = req.body as {
    phone: string;
    amount: number;
    description?: string;
    items?: PosCartLine[];
  };

  if (!phone || !amount) {
    res.status(400).json({ error: 'phone and amount are required' });
    return;
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    res.status(422).json({ error: 'amount must be a positive number' });
    return;
  }

  if (!user || !canManageOps(user.role)) {
    res.status(403).json({ error: 'Only bakery staff can initiate POS M-Pesa sales' });
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    res.status(422).json({ error: 'Cart items are required for POS M-Pesa sales' });
    return;
  }

  const purpose = 'pos_sale';
  const posCart: PosCartPayload = { cashierId: user.id, items };

  try {
    console.log('[Kopokopo] Initiating STK Push →', {
      phone,
      amount: numericAmount,
      purpose,
      user: user.role,
    });

    const existingPending = await resolvePhonePendingBlock(phone);
    if (existingPending) {
      await prisma.kopoPayment.update({
        where: { id: existingPending.id },
        data: { posCart },
      });
      console.log('[Kopokopo] Resuming pending STK for phone', phoneKey(phone));
      respondPendingStk(res, existingPending, numericAmount, true);
      return;
    }

    const pending = await prisma.kopoPayment.create({
      data: {
        status: 'pending',
        amount: numericAmount,
        phone,
        purpose,
        posCart,
        description: description || 'Slow Rise Co bakery sale',
      },
    });

    let rawLocation: string;
    try {
      ({ location: rawLocation } = await initiateSTKPush({
        phone,
        amount: numericAmount,
        description: pending.description,
        paymentId: pending.id,
        purpose,
      }));
    } catch (stkErr: any) {
      const kopoBody = stkErr?.response?.data;
      const kopoMessage =
        kopoBody?.error_message ||
        kopoBody?.message ||
        stkErr?.message ||
        'Kopokopo STK Push failed';

      await prisma.kopoPayment.update({
        where: { id: pending.id },
        data: { status: 'failed' },
      }).catch(() => {});

      if (isPendingPhoneBlockError(stkErr)) {
        const blocked = await resolvePhonePendingBlock(phone);
        if (blocked) {
          console.log('[Kopokopo] 429 — resuming existing pending STK for', phoneKey(phone));
          respondPendingStk(res, blocked, numericAmount, true);
          return;
        }
        console.error('[Kopokopo] STK Push Error (phone blocked):', kopoBody || stkErr.message);
        res.status(422).json({
          error:
            'An M-Pesa request is already pending on this phone number. Check the phone for the STK prompt or wait about 2 minutes.',
          code: 'PENDING_PHONE',
          details: kopoBody || stkErr.message,
        });
        return;
      }

      console.error('[Kopokopo] STK Push Error:', kopoBody || stkErr.message);
      res.status(422).json({ error: kopoMessage, details: kopoBody || stkErr.message });
      return;
    }

    const location = normalizeLocation(rawLocation);
    const reference = locationId(location);

    const payment = await prisma.kopoPayment.update({
      where: { id: pending.id },
      data: {
        location,
        reference: reference || undefined,
      },
    });

    console.log('[Kopokopo] STK Push queued. Location:', location);
    res.status(201).json({ location, paymentId: payment.id, purpose: payment.purpose });
  } catch (err: any) {
    console.error('[Kopokopo] STK Push Error:', err?.response?.data || err.message);
    const kopoBody = err?.response?.data;
    const kopoMessage =
      kopoBody?.error_message ||
      kopoBody?.message ||
      err?.message ||
      'Kopokopo STK Push failed';
    res.status(422).json({ error: kopoMessage, details: kopoBody || err.message });
  }
});

// GET /api/kopokopo/status?location=...
router.get('/status', async (req: Request, res: Response) => {
  const location = req.query.location as string;

  if (!location) {
    res.status(400).json({ error: 'location query param is required' });
    return;
  }

  const normalized = normalizeLocation(location);

  try {
    const locId = locationId(normalized);
    const existing =
      (await prisma.kopoPayment.findFirst({
        where: { OR: [{ location: normalized }, { location }] },
        orderBy: { createdAt: 'desc' },
      })) ||
      (locId
        ? await prisma.kopoPayment.findFirst({
            where: { reference: locId },
            orderBy: { createdAt: 'desc' },
          })
        : null);

    if (existing && existing.status !== 'pending') {
      res.json({
        status: existing.status,
        amount: existing.amount,
        currency: existing.currency,
        reference: existing.reference,
        transactionReference: existing.transactionReference,
        phone: existing.phone,
        paymentId: existing.id,
        purpose: existing.purpose,
        posCompleted: existing.posCompleted,
        posTransactionId: existing.posTransactionId,
      });
      return;
    }

    const statusData = await getPaymentStatus(location);
    const fromRaw = parseKopoPayload(statusData.raw ?? {});
    const mpesaRef = String(
      statusData.reference || fromRaw.transactionReference || '',
    ).trim();
    let mapped = mapStatus(statusData.status);
    if (mapped === 'success' && !mpesaRef) {
      mapped = 'pending';
    }

    if (existing) {
      const parsed: ParsedKopoPayload = {
        ...fromRaw,
        status: mapped,
        rawStatus: statusData.status,
        amount: statusData.amount || existing.amount,
        currency: statusData.currency || existing.currency,
        phone: statusData.phone || existing.phone,
        transactionReference: mpesaRef || existing.transactionReference || '',
        location: normalized,
        tillNumber: existing.tillNumber,
        reference: String(existing.reference || fromRaw.reference || ''),
        originationTime: statusData.originationTime || existing.originationTime || '',
      };

      if (mapped !== 'pending') {
        const result = await applyPaymentUpdate(existing, parsed, statusData.raw ?? undefined);
        res.json({
          status: result.payment?.status ?? mapped,
          amount: result.payment?.amount,
          currency: result.payment?.currency,
          reference: result.payment?.reference,
          transactionReference: result.payment?.transactionReference,
          phone: result.payment?.phone,
          paymentId: result.payment?.id,
          purpose: result.payment?.purpose,
          posCompleted: result.payment?.posCompleted,
          posTransactionId: result.posTransactionId || result.payment?.posTransactionId,
          posReceiptNo: result.posReceiptNo,
        });
        return;
      }
    }

    res.json({
      status: mapped,
      amount: statusData.amount,
      currency: statusData.currency,
      reference: statusData.reference,
      transactionReference: mpesaRef,
      phone: statusData.phone,
      paymentId: existing?.id,
      purpose: existing?.purpose ?? 'pos_sale',
      posCompleted: existing?.posCompleted ?? false,
      posTransactionId: existing?.posTransactionId,
    });
  } catch (err: any) {
    console.error('[Kopokopo] Status Check Error:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to fetch Kopokopo payment status',
      details: err?.response?.data || err.message,
    });
  }
});

async function handlePaymentCallback(req: Request, res: Response) {
  const signature = req.headers['x-kopokopo-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  if (signature && rawBody) {
    const valid = validateWebhookSignature(rawBody, signature);
    if (!valid) {
      console.warn('[Kopokopo] Invalid webhook signature!');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  const payload = req.body;
  console.log('[Kopokopo] Payment Callback received:', JSON.stringify(payload, null, 2));

  try {
    const parsed = parseKopoPayload(payload);
    let payment = await findKopoPayment(parsed);
    let posReceiptNo: string | undefined;
    let posTransactionId: string | undefined;

    if (payment) {
      const result = await applyPaymentUpdate(payment, parsed, payload);
      payment = result.payment;
      posReceiptNo = result.posReceiptNo;
      posTransactionId = result.posTransactionId;
    } else if (parsed.location || parsed.reference || parsed.transactionReference) {
      if (parsed.transactionReference) {
        const byMpesa = await prisma.kopoPayment.findFirst({
          where: {
            transactionReference: {
              equals: String(parsed.transactionReference).trim(),
              mode: 'insensitive',
            },
          },
          orderBy: { createdAt: 'asc' },
        });
        if (byMpesa) {
          const result = await applyPaymentUpdate(byMpesa, parsed, payload);
          payment = result.payment;
          posReceiptNo = result.posReceiptNo;
          posTransactionId = result.posTransactionId;
          emitKopokopoUpdate(req, buildKopoEmitPayload(payment, parsed, { posReceiptNo, posTransactionId }));
          res.status(200).json({ message: 'Callback processed successfully' });
          return;
        }
      }

      payment = await prisma.kopoPayment.create({
        data: {
          reference: parsed.reference || undefined,
          location: parsed.location || undefined,
          status: parsed.status,
          amount: parsed.amount,
          currency: parsed.currency,
          phone: parsed.phone,
          tillNumber: parsed.tillNumber,
          transactionReference: parsed.transactionReference,
          originationTime: parsed.originationTime || undefined,
          purpose: 'pos_sale',
          description: 'Slow Rise Co bakery sale',
          rawPayload: payload,
        },
      });
    }

    if (parsed.status === 'success' && !isConfirmedPaid(parsed)) {
      parsed.status = 'pending';
      parsed.rawStatus = 'Pending';
    }

    emitKopokopoUpdate(req, buildKopoEmitPayload(payment, parsed, { posReceiptNo, posTransactionId }));

    res.status(200).json({ message: 'Callback processed successfully' });
  } catch (err: any) {
    console.error('[Kopokopo] Callback processing error:', err.message);
    res.status(500).json({ error: 'Callback processing failed' });
  }
}

router.post('/payment/callback', handlePaymentCallback);

// POST /api/kopokopo/webhooks
router.post('/webhooks', async (req: Request, res: Response) => {
  const signature = req.headers['x-kopokopo-signature'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  if (signature && rawBody) {
    const valid = validateWebhookSignature(rawBody, signature);
    if (!valid) {
      console.warn('[Kopokopo] Invalid webhook signature on /webhooks');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  const payload = req.body;
  const eventType: string = payload?.topic ?? payload?.event?.type ?? 'unknown';
  console.log(`[Kopokopo] Webhook event: ${eventType}`, JSON.stringify(payload, null, 2));

  try {
    const io = req.app.get('io');
    if (io) {
      io.emit('kopokopo_webhook', { eventType, payload });
    }

    if (
      eventType === 'buygoods_transaction_received' ||
      eventType === 'b2b_transaction_received'
    ) {
      const parsed = parseKopoPayload(payload);
      if (!parsed.transactionReference) {
        console.warn('[Kopokopo] Ignoring buygoods webhook without M-Pesa reference');
      } else {
        parsed.status = 'success';
        parsed.rawStatus = 'Received';

        let payment = await findKopoPayment(parsed);
        let posReceiptNo: string | undefined;
        let posTransactionId: string | undefined;

        if (payment) {
          const result = await applyPaymentUpdate(payment, parsed, payload);
          payment = result.payment;
          posReceiptNo = result.posReceiptNo;
          posTransactionId = result.posTransactionId;
        } else {
          const existingByRef = await prisma.kopoPayment.findFirst({
            where: {
              transactionReference: {
                equals: String(parsed.transactionReference).trim(),
                mode: 'insensitive',
              },
            },
            orderBy: { createdAt: 'asc' },
          });

          if (existingByRef) {
            const result = await applyPaymentUpdate(existingByRef, parsed, payload);
            payment = result.payment;
            posReceiptNo = result.posReceiptNo;
            posTransactionId = result.posTransactionId;
          } else {
            payment = await prisma.kopoPayment.create({
              data: {
                reference: parsed.reference || undefined,
                status: 'success',
                amount: parsed.amount,
                currency: parsed.currency,
                phone: parsed.phone,
                tillNumber: parsed.tillNumber,
                eventType,
                transactionReference: parsed.transactionReference,
                purpose: 'pos_sale',
                description: 'Slow Rise Co till payment',
                rawPayload: payload,
              },
            });
          }
        }

        emitKopokopoUpdate(req, buildKopoEmitPayload(payment, parsed, { posReceiptNo, posTransactionId }));
      }
    }

    res.status(200).json({ message: 'Webhook received' });
  } catch (err: any) {
    console.error('[Kopokopo] Webhook handling error:', err.message);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

// POST /api/kopokopo/subscribe-webhooks
router.post('/subscribe-webhooks', async (_req: Request, res: Response) => {
  const webhookUrl = process.env.KOPOKOPO_WEBHOOK_URL;
  if (!webhookUrl) {
    res.status(400).json({ error: 'KOPOKOPO_WEBHOOK_URL is not configured' });
    return;
  }

  const eventTypes = [
    'buygoods_transaction_received',
    'buygoods_transaction_reversed',
    'settlement_transfer_completed',
  ];

  const results: Record<string, string> = {};

  for (const eventType of eventTypes) {
    try {
      const location = await subscribeWebhook(eventType, webhookUrl);
      results[eventType] = location || 'subscribed';
      console.log(`[Kopokopo] Subscribed to ${eventType}:`, location);
    } catch (err: any) {
      results[eventType] = `error: ${err?.response?.data?.message || err.message}`;
      console.error(`[Kopokopo] Failed to subscribe to ${eventType}:`, err?.response?.data || err.message);
    }
  }

  res.json({ message: 'Webhook subscription complete', results });
});

// POST /api/kopokopo/reconcile-pos
router.post('/reconcile-pos', async (_req: Request, res: Response) => {
  try {
    const pending = await prisma.kopoPayment.findMany({
      where: {
        purpose: 'pos_sale',
        posCompleted: false,
        status: 'success',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const results = [];
    for (const payment of pending) {
      const result = await completePosSaleFromPayment(
        payment.id,
        payment.transactionReference || payment.reference || payment.id,
      );
      results.push({ paymentId: payment.id, completed: Boolean(result), receiptNo: result?.receiptNo });
    }

    res.json({ reconciled: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kopokopo/webhook-status
router.get('/webhook-status', ensureAuthenticated, async (req: Request, res: Response) => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  res.json({
    callbackUrl: process.env.KOPOKOPO_CALLBACK_URL || null,
    webhookUrl: process.env.KOPOKOPO_WEBHOOK_URL || null,
    tillNumber: process.env.KOPOKOPO_TILL_NUMBER || null,
    configured: Boolean(
      process.env.KOPOKOPO_CLIENT_ID &&
        process.env.KOPOKOPO_CLIENT_SECRET &&
        process.env.KOPOKOPO_API_KEY,
    ),
  });
});

// GET /api/kopokopo/transactions
router.get('/transactions', ensureOwner, async (req: Request, res: Response) => {
  const take = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const payments = await prisma.kopoPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
