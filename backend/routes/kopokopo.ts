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
import { ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import 'dotenv/config';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'smartpos-secret-key';

type KopoPurpose = 'wallet_topup' | 'pos_sale' | 'general';
type PosCartLine = { menuItemId: string; quantity: number };

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

/** True only when Kopokopo indicates paid AND we have an M-Pesa receipt (PIN completed). */
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
  studentId?: string;
  studentRegNo?: string;
  paymentId?: string;
  purpose?: string;
  payerType?: string;
}

function parseKopoPayload(payload: any): ParsedKopoPayload {
  const data = payload?.data ?? payload;
  const attrs = data?.attributes ?? {};
  // K2 STK callbacks use data.attributes.event.resource; till webhooks use event.resource at top level
  const resource =
    attrs?.event?.resource ??
    payload?.event?.resource ??
    data?.event?.resource ??
    {};
  const links = attrs?._links ?? data?._links ?? payload?._links ?? {};
  const metadata = attrs?.metadata ?? payload?.metadata ?? {};

  // Prefer Incoming Payment attributes.status (Pending|Success|Failed).
  // resource.status ("Received") is the buygoods result after M-Pesa PIN — not before.
  // Never default to "Received" (that caused premature "Payment Successful" before PIN).
  const rawStatus = String(
    attrs.status || resource.status || payload?.event?.resource?.status || 'Pending',
  );
  const amountRaw = resource.amount ?? attrs.amount?.value ?? attrs.amount ?? 0;
  // Only trust M-Pesa receipt on the transaction resource (not merchant metadata attrs.reference)
  const trustedMpesaRef = String(resource.reference ?? attrs.mpesa_receipt_number ?? '').trim();

  let mapped = mapStatus(rawStatus);
  // Gate success on a real M-Pesa receipt so STK "Success/Received" without PIN cannot complete.
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
    studentId: String(metadata.student_id ?? metadata.studentId ?? metadata.customer_id ?? '').trim() || undefined,
    studentRegNo: String(metadata.student_reg_no ?? metadata.studentRegNo ?? metadata.adm_no ?? metadata.reg_no ?? '').trim() || undefined,
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

  // Till webhooks often send a new Kopokopo event id on each delivery/retry.
  // Deduplicate by M-Pesa receipt (transactionReference), which is stable.
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

function normalizeMpesaRef(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/**
 * Credit a student wallet exactly once for a KopoPayment.
 * Idempotent by payment id AND by M-Pesa transaction reference so duplicate
 * payment rows / webhook retries cannot double-credit.
 */
async function creditStudentWallet(
  paymentId: string,
  studentId: string,
  amount: number,
  phone: string,
  reference: string,
) {
  if (!studentId || amount <= 0) {
    console.warn('[Kopokopo] Skip wallet credit — missing studentId or invalid amount', {
      paymentId,
      studentId,
      amount,
    });
    return false;
  }

  const mpesaRef = normalizeMpesaRef(reference);

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.kopoPayment.findUnique({ where: { id: paymentId } });
      if (!payment) return false;
      if (payment.walletCredited) return false;

      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) {
        throw new Error(`Student not found: ${studentId}`);
      }

      // Block if this M-Pesa code already credited another payment row
      if (mpesaRef) {
        const siblingCredited = await tx.kopoPayment.findFirst({
          where: {
            id: { not: paymentId },
            walletCredited: true,
            OR: [
              { transactionReference: { equals: mpesaRef, mode: 'insensitive' } },
              { reference: { equals: mpesaRef, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (siblingCredited) {
          await tx.kopoPayment.update({
            where: { id: paymentId },
            data: {
              walletCredited: true,
              studentId,
              status: 'superseded',
              description: `Superseded — M-Pesa ${mpesaRef} already credited via ${siblingCredited.id}`,
            },
          });
          console.warn(
            `[Kopokopo] Skip double credit — ${mpesaRef} already credited on ${siblingCredited.id}`,
          );
          return false;
        }

        const existingDeposit = await tx.walletTransaction.findFirst({
          where: {
            type: 'deposit',
            reference: { equals: mpesaRef, mode: 'insensitive' },
          },
          select: { id: true, studentId: true },
        });
        if (existingDeposit) {
          await tx.kopoPayment.update({
            where: { id: paymentId },
            data: {
              walletCredited: true,
              studentId: existingDeposit.studentId,
              status: 'superseded',
              description: `Superseded — wallet deposit ${mpesaRef} already exists`,
            },
          });
          console.warn(
            `[Kopokopo] Skip double credit — wallet deposit already exists for ${mpesaRef}`,
          );
          return false;
        }
      }

      // Atomic claim on this payment row
      const claimed = await tx.kopoPayment.updateMany({
        where: { id: paymentId, walletCredited: false },
        data: {
          walletCredited: true,
          studentId,
          ...(mpesaRef ? { transactionReference: mpesaRef } : {}),
        },
      });
      if (claimed.count === 0) return false;

      await tx.student.update({
        where: { id: studentId },
        data: { walletBalance: { increment: amount } },
      });

      await tx.walletTransaction.create({
        data: {
          studentId,
          amount,
          type: 'deposit',
          reference: mpesaRef || reference || paymentId,
          description: `KopoKopo top-up from ${phone || 'M-Pesa'}`,
        },
      });

      // Lock sibling duplicate payment rows so they cannot be allocated/credited later
      if (mpesaRef) {
        await tx.kopoPayment.updateMany({
          where: {
            id: { not: paymentId },
            walletCredited: false,
            OR: [
              { transactionReference: { equals: mpesaRef, mode: 'insensitive' } },
              { reference: { equals: mpesaRef, mode: 'insensitive' } },
            ],
          },
          data: {
            walletCredited: true,
            status: 'superseded',
            description: `Superseded after wallet credit of ${mpesaRef}`,
          },
        });
      }

      console.log(`[Kopokopo] Credited student ${studentId} wallet with KES ${amount} (ref ${mpesaRef || paymentId})`);
      return true;
    }, { maxWait: 5_000, timeout: 15_000 });
  } catch (err: any) {
    console.error('[Kopokopo] Wallet credit failed:', err?.message || err);
    return false;
  }
}

async function completePosSaleFromPayment(
  paymentId: string,
  mpesaReference: string,
): Promise<{ receiptNo: string; posTransactionId: string } | null> {
  const payment = await prisma.kopoPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.purpose !== 'pos_sale' || payment.posCompleted) {
    return null;
  }

  const cart = payment.posCart as PosCartLine[] | null;
  if (!Array.isArray(cart) || cart.length === 0) return null;

  const cashierId = payment.payerUserId;
  if (!cashierId) {
    console.warn('[Kopokopo] POS sale pending — no cashier on payment record', { paymentId });
    return null;
  }

  const claimed = await prisma.kopoPayment.updateMany({
    where: { id: paymentId, posCompleted: false },
    data: { posCompleted: true },
  });
  if (claimed.count === 0) return null;

  try {
    const { posTx } = await executeGuestMpesaSale(
      cashierId,
      cart,
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
  existing: {
    id: string;
    studentId: string | null;
    amount: number;
    phone: string;
    walletCredited: boolean;
    purpose: string;
    posCompleted: boolean;
  },
  parsed: ParsedKopoPayload,
  rawPayload?: object,
) {
  const studentId = existing.studentId || parsed.studentId || null;
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
      studentId,
      ...(rawPayload ? { rawPayload } : {}),
    },
  });

  if (isConfirmedPaid(parsed) && studentId && !payment.walletCredited) {
    await creditStudentWallet(
      payment.id,
      studentId,
      creditAmount,
      payment.phone,
      parsed.transactionReference || parsed.reference || payment.id,
    );
  }

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

const STALE_PENDING_MS = 2 * 60 * 1000; // STK prompts expire ~60–90s; unblock retries after 2 min
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

/** Clear stale pending STKs for a phone; only sync the newest live one with Kopokopo. */
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

  // One Kopokopo status call max — do not sync every pending row (was making STK feel stuck)
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
    studentId: payment?.studentId,
    walletCredited: payment?.walletCredited ?? false,
    purpose: payment?.purpose,
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

// POST /api/kopokopo/stkpush
router.post('/stkpush', async (req: Request, res: Response) => {
  const user = getOptionalUser(req);
  const {
    phone,
    amount,
    description,
    studentId,
    purpose: rawPurpose,
    items,
    kiosk: kioskFlag,
  } = req.body as {
    phone: string;
    amount: number;
    description?: string;
    studentId?: string;
    purpose?: KopoPurpose;
    items?: PosCartLine[];
    kiosk?: boolean;
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

  let purpose: KopoPurpose = rawPurpose || (studentId ? 'wallet_topup' : 'general');

  let linkedStudent: { id: string; name: string; regNo: string } | null = null;
  if (studentId) {
    purpose = 'wallet_topup';
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, regNo: true },
    });
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }
    linkedStudent = student;
  } else if (purpose === 'pos_sale') {
    const isKiosk = Boolean(kioskFlag);
    if (!isKiosk && (!user || !['admin', 'restaurant'].includes(user.role))) {
      res.status(403).json({ error: 'Only restaurant staff can initiate POS M-Pesa sales' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: 'Cart items are required for POS M-Pesa sales' });
      return;
    }
  } else {
    if (!user || user.role === 'student') {
      res.status(403).json({ error: 'STK push is available for parents and staff only' });
      return;
    }
    purpose = 'general';
  }

  try {
    const isKioskPos = purpose === 'pos_sale' && Boolean(kioskFlag);
    const payerId = user?.id || (isKioskPos ? 'kiosk' : null);
    const payerRole = user?.role || (isKioskPos ? 'kiosk' : null);

    console.log('[Kopokopo] Initiating STK Push →', {
      phone,
      amount: numericAmount,
      studentId,
      purpose,
      user: user?.role,
      kiosk: isKioskPos,
    });

    const existingPending = await resolvePhonePendingBlock(phone);
    if (existingPending) {
      if (purpose === 'pos_sale' && items) {
        await prisma.kopoPayment.update({
          where: { id: existingPending.id },
          data: {
            posCart: items,
            payerUserId: payerId || existingPending.payerUserId,
            payerRole: payerRole || existingPending.payerRole,
          },
        });
      }
      console.log('[Kopokopo] Resuming pending STK for phone', phoneKey(phone));
      respondPendingStk(res, existingPending, numericAmount, true);
      return;
    }

    const pending = await prisma.kopoPayment.create({
      data: {
        status: 'pending',
        amount: numericAmount,
        phone,
        studentId: studentId || null,
        payerUserId: payerId,
        payerRole: payerRole,
        purpose,
        posCart: purpose === 'pos_sale' ? items : undefined,
        description:
          description ||
          (linkedStudent
            ? `Wallet top-up for ${linkedStudent.name} · ${linkedStudent.regNo}`
            : purpose === 'pos_sale'
              ? isKioskPos
                ? 'SmartPOS Kiosk Cafeteria Sale'
                : 'SmartPOS Cafeteria Sale'
              : purpose === 'wallet_topup'
                ? 'SmartPOS Wallet Top-up'
                : 'SmartPOS Payment'),
      },
    });

    let rawLocation: string;
    try {
      ({ location: rawLocation } = await initiateSTKPush({
        phone,
        amount: numericAmount,
        description: pending.description,
        studentId,
        studentRegNo: linkedStudent?.regNo || (purpose === 'pos_sale' ? 'GUEST' : undefined),
        studentName: linkedStudent?.name || (purpose === 'pos_sale' ? 'Guest' : undefined),
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
    // Fast path: already finalized in DB — skip Kopokopo round-trip
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
        studentId: existing.studentId,
        walletCredited: existing.walletCredited,
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

    const parsed: ParsedKopoPayload = {
      ...fromRaw,
      rawStatus: mapped === 'pending' && isSuccessStatus(statusData.status) && !mpesaRef
        ? 'Pending'
        : statusData.status,
      status: mapped,
      amount: statusData.amount || fromRaw.amount || 0,
      currency: statusData.currency || fromRaw.currency || 'KES',
      phone: statusData.phone || fromRaw.phone || '',
      reference: fromRaw.reference || String(statusData.reference || ''),
      transactionReference: mpesaRef,
      location: normalized,
      originationTime: statusData.originationTime || fromRaw.originationTime || '',
      tillNumber: process.env.KOPOKOPO_TILL_NUMBER || fromRaw.tillNumber || '',
    };

    let payment = existing || (await findKopoPayment(parsed, location));
    let posReceiptNo: string | undefined;
    let posTransactionId: string | undefined;

    if (payment && isConfirmedPaid(parsed)) {
      const paymentId = payment.id;
      try {
        const result = await applyPaymentUpdate(payment, parsed, statusData.raw ?? undefined);
        payment = result.payment;
        posReceiptNo = result.posReceiptNo;
        posTransactionId = result.posTransactionId;
      } catch (creditErr: any) {
        // Payment succeeded at M-Pesa — don't leave the UI hanging if wallet/POS post-processing fails
        console.error('[Kopokopo] Status apply failed after success:', creditErr?.message || creditErr);
        payment = await prisma.kopoPayment.update({
          where: { id: paymentId },
          data: {
            status: 'success',
            ...(statusData.raw ? { rawPayload: statusData.raw as object } : {}),
            ...(parsed.transactionReference
              ? { transactionReference: parsed.transactionReference }
              : {}),
          },
        });
      }
    } else if (payment && parsed.status !== 'pending') {
      payment = await prisma.kopoPayment.update({
        where: { id: payment.id },
        data: {
          status: parsed.status,
          ...(statusData.raw ? { rawPayload: statusData.raw as object } : {}),
        },
      });
    }

    res.json({
      status: parsed.status,
      rawStatus: statusData.status,
      amount: parsed.amount || payment?.amount,
      currency: parsed.currency,
      reference: parsed.reference,
      transactionReference: payment?.transactionReference || parsed.transactionReference,
      phone: payment?.phone || parsed.phone,
      paymentId: payment?.id,
      studentId: payment?.studentId,
      walletCredited: payment?.walletCredited ?? false,
      purpose: payment?.purpose,
      posCompleted: payment?.posCompleted ?? false,
      posReceiptNo,
      posTransactionId,
    });
  } catch (err: any) {
    console.error('[Kopokopo] Status Check Error:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to fetch Kopokopo payment status',
      details: err?.response?.data || err.message,
    });
  }
});

// POST /api/kopokopo/payment/callback
router.post('/payment/callback', async (req: Request, res: Response) => {
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
      // Final M-Pesa-ref guard (till webhooks reuse event ids across retries)
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

      const inferredPurpose = (parsed.purpose as KopoPurpose) || 'general';
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
          studentId: parsed.studentId || null,
          purpose: inferredPurpose,
          description:
            inferredPurpose === 'pos_sale'
              ? 'SmartPOS Guest Cafeteria Sale'
              : 'SmartPOS Payment',
          rawPayload: payload,
        },
      });

      if (isConfirmedPaid(parsed) && payment.studentId && !payment.walletCredited) {
        await creditStudentWallet(
          payment.id,
          payment.studentId,
          payment.amount,
          payment.phone,
          parsed.transactionReference || parsed.reference || payment.id,
        );
        payment = await prisma.kopoPayment.findUnique({ where: { id: payment.id } });
      }
    }

    // Only broadcast terminal success when M-Pesa receipt exists (PIN completed)
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
});

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
      // Till buygoods is paid only when M-Pesa receipt is present
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
        const inferredPurpose = (parsed.purpose as KopoPurpose) || 'general';
        // Re-check M-Pesa ref right before insert to avoid race duplicates from concurrent webhooks
        const existingByRef = parsed.transactionReference
          ? await prisma.kopoPayment.findFirst({
              where: {
                transactionReference: {
                  equals: String(parsed.transactionReference).trim(),
                  mode: 'insensitive',
                },
              },
              orderBy: { createdAt: 'asc' },
            })
          : null;

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
              studentId: parsed.studentId || null,
              purpose: inferredPurpose,
              description:
                inferredPurpose === 'pos_sale'
                  ? 'SmartPOS Guest Cafeteria Sale'
                  : 'SmartPOS Payment',
              rawPayload: payload,
            },
          });

          if (payment.studentId && !payment.walletCredited) {
            await creditStudentWallet(
              payment.id,
              payment.studentId,
              payment.amount,
              payment.phone,
              parsed.transactionReference || parsed.reference || payment.id,
            );
            payment = await prisma.kopoPayment.findUnique({ where: { id: payment.id } });
          }
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
    'customer_created',
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

// POST /api/kopokopo/reconcile-pos — complete successful guest POS M-Pesa sales still pending
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

// POST /api/kopokopo/reconcile — manually credit any successful but uncredited payments
router.post('/reconcile', async (_req: Request, res: Response) => {
  try {
    const pending = await prisma.kopoPayment.findMany({
      where: {
        walletCredited: false,
        studentId: { not: null },
        status: 'success',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const results = [];
    for (const payment of pending) {
      const ok = await creditStudentWallet(
        payment.id,
        payment.studentId!,
        payment.amount,
        payment.phone,
        payment.transactionReference || payment.reference || payment.id,
      );
      results.push({ paymentId: payment.id, credited: ok });
    }

    res.json({ reconciled: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function isAllocatablePayment(payment: {
  status: string;
  walletCredited: boolean;
  purpose: string;
  posCompleted: boolean;
  amount: number;
}): boolean {
  if (!isSuccessStatus(payment.status)) return false;
  if (payment.walletCredited) return false;
  if (payment.purpose === 'pos_sale') return false;
  if (payment.posCompleted) return false;
  if (payment.amount <= 0) return false;
  return true;
}

async function supersedeDuplicatePayments(allocated: {
  id: string;
  transactionReference: string;
  phone: string;
  amount: number;
}) {
  const orFilters: Array<Record<string, unknown>> = [];

  if (allocated.transactionReference) {
    orFilters.push({
      transactionReference: {
        equals: normalizeMpesaRef(allocated.transactionReference),
        mode: 'insensitive',
      },
    });
  }

  const pk = phoneKey(allocated.phone);
  if (pk) {
    orFilters.push({
      phone: { endsWith: pk },
      amount: allocated.amount,
      status: 'pending',
    });
  }

  if (orFilters.length === 0) return 0;

  const result = await prisma.kopoPayment.updateMany({
    where: {
      id: { not: allocated.id },
      walletCredited: false,
      status: { in: ['pending', 'success'] },
      OR: orFilters,
    },
    data: {
      status: 'superseded',
      walletCredited: true,
      description: 'Superseded by manual wallet allocation',
    },
  });

  return result.count;
}

function ensureFinanceOrAdmin(req: Request, res: Response): boolean {
  if (!req.user || !['admin', 'finance'].includes(req.user.role)) {
    res.status(403).json({ error: 'Admin or finance access required' });
    return false;
  }
  return true;
}

// GET /api/kopokopo/search?q= — find unallocated till payments by M-Pesa code, phone, or ref
router.get('/search', ensureAuthenticated, async (req: Request, res: Response) => {
  if (!ensureFinanceOrAdmin(req, res)) return;

  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }

  try {
    const payments = await prisma.kopoPayment.findMany({
      where: {
        walletCredited: false,
        purpose: { not: 'pos_sale' },
        posCompleted: false,
        status: { in: ['success', 'received', 'complete', 'completed', 'paid'] },
        amount: { gt: 0 },
        OR: [
          { transactionReference: { contains: q, mode: 'insensitive' } },
          { reference: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { id: q },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const studentIds = [...new Set(payments.map((p) => p.studentId).filter(Boolean) as string[])];
    const students =
      studentIds.length > 0
        ? await prisma.student.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, name: true, regNo: true },
          })
        : [];
    const studentById = new Map(students.map((s) => [s.id, s]));

    res.json(
      payments.map((p) => {
        const student = p.studentId ? studentById.get(p.studentId) : undefined;
        return {
          id: p.id,
          amount: p.amount,
          phone: p.phone,
          status: p.status,
          purpose: p.purpose,
          transactionReference: p.transactionReference || p.reference || '',
          date: p.originationTime || p.createdAt,
          studentId: p.studentId,
          studentName: student?.name || null,
          studentRegNo: student?.regNo || null,
          allocatable: isAllocatablePayment(p),
        };
      }),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

// POST /api/kopokopo/:id/allocate — assign till payment to a student and credit wallet
router.post('/:id/allocate', ensureAuthenticated, async (req: Request, res: Response) => {
  if (!ensureFinanceOrAdmin(req, res)) return;

  const { studentId } = req.body as { studentId?: string };
  if (!studentId) {
    res.status(422).json({ error: 'studentId is required' });
    return;
  }

  const paymentId = String(req.params.id);
  if (!paymentId) {
    res.status(422).json({ error: 'Payment id is required' });
    return;
  }

  try {
    const payment = await prisma.kopoPayment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    if (!isAllocatablePayment(payment)) {
      res.status(422).json({
        error: 'Payment cannot be allocated — it may already be credited, failed, or is a POS sale',
      });
      return;
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, regNo: true, walletFrozen: true, walletBalance: true },
    });
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }
    if (student.walletFrozen) {
      res.status(422).json({ error: 'Student wallet is frozen' });
      return;
    }

    const mpesaRef = normalizeMpesaRef(payment.transactionReference || payment.reference);
    if (mpesaRef) {
      const alreadyCredited = await prisma.kopoPayment.findFirst({
        where: {
          id: { not: payment.id },
          walletCredited: true,
          OR: [
            { transactionReference: { equals: mpesaRef, mode: 'insensitive' } },
            { reference: { equals: mpesaRef, mode: 'insensitive' } },
          ],
        },
        select: { id: true, studentId: true },
      });
      if (alreadyCredited) {
        await prisma.kopoPayment.update({
          where: { id: payment.id },
          data: {
            walletCredited: true,
            status: 'superseded',
            description: `Superseded — M-Pesa ${mpesaRef} already allocated`,
          },
        });
        res.status(409).json({
          error: `This M-Pesa code (${mpesaRef}) was already credited to a student wallet`,
        });
        return;
      }

      const existingDeposit = await prisma.walletTransaction.findFirst({
        where: {
          type: 'deposit',
          reference: { equals: mpesaRef, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existingDeposit) {
        await prisma.kopoPayment.update({
          where: { id: payment.id },
          data: {
            walletCredited: true,
            status: 'superseded',
            description: `Superseded — wallet deposit ${mpesaRef} already exists`,
          },
        });
        res.status(409).json({
          error: `This M-Pesa code (${mpesaRef}) already has a wallet deposit recorded`,
        });
        return;
      }
    }

    await prisma.kopoPayment.update({
      where: { id: payment.id },
      data: {
        studentId,
        purpose: 'wallet_topup',
        allocatedBy: req.user!.id,
        allocatedAt: new Date(),
        description: `Wallet top-up for ${student.name} · ${student.regNo} (manual allocation)`,
      },
    });

    const credited = await creditStudentWallet(
      payment.id,
      studentId,
      payment.amount,
      payment.phone,
      mpesaRef || payment.transactionReference || payment.reference || payment.id,
    );

    if (!credited) {
      res.status(409).json({ error: 'Wallet credit failed — payment may already be allocated' });
      return;
    }

    const superseded = await supersedeDuplicatePayments({
      id: payment.id,
      transactionReference: payment.transactionReference,
      phone: payment.phone,
      amount: payment.amount,
    });

    const updatedStudent = await prisma.student.findUnique({
      where: { id: studentId },
      select: { walletBalance: true },
    });

    await logAuditEvent({
      eventType: 'wallet_allocation',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Manual Wallet Allocation',
      description: `Allocated KES ${payment.amount} (${payment.transactionReference || payment.id}) to ${student.regNo}`,
      metadata: {
        paymentId: payment.id,
        studentId,
        amount: payment.amount,
        transactionReference: payment.transactionReference,
        supersededCount: superseded,
      },
      ipAddress: req.ip,
    });

    res.json({
      message: 'Wallet topped up successfully',
      paymentId: payment.id,
      studentId,
      studentName: student.name,
      studentRegNo: student.regNo,
      amount: payment.amount,
      newBalance: updatedStudent?.walletBalance ?? student.walletBalance + payment.amount,
      supersededCount: superseded,
    });
  } catch (err: any) {
    console.error('[Kopokopo] Allocate error:', err?.message || err);
    res.status(500).json({ error: err.message || 'Allocation failed' });
  }
});

// GET /api/kopokopo/webhook-status — diagnostics for till webhook delivery
router.get('/webhook-status', ensureAuthenticated, async (req: Request, res: Response) => {
  if (!ensureFinanceOrAdmin(req, res)) return;

  try {
    const [latest, todayCount] = await Promise.all([
      prisma.kopoPayment.findFirst({
        where: { eventType: 'buygoods_transaction_received', amount: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, amount: true, transactionReference: true },
      }),
      prisma.kopoPayment.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          amount: { gt: 0 },
        },
      }),
    ]);

    const webhookUrl = process.env.KOPOKOPO_WEBHOOK_URL || '';
    const hoursSinceLast =
      latest?.createdAt
        ? Math.round((Date.now() - latest.createdAt.getTime()) / 3_600_000)
        : null;

    res.json({
      tillNumber: process.env.KOPOKOPO_TILL_NUMBER || '',
      webhookUrl,
      callbackUrl: process.env.KOPOKOPO_CALLBACK_URL || '',
      latestPayment: latest,
      paymentsToday: todayCount,
      hoursSinceLastPayment: hoursSinceLast,
      webhookLikelyStale: hoursSinceLast !== null && hoursSinceLast > 24,
      hint:
        'Manual till payments (Lipa na M-Pesa → Buy Goods) only appear when KopoKopo webhooks reach your server. Ensure KOPOKOPO_WEBHOOK_URL points at production (e.g. https://betterfork.millenium.co.ke/api/kopokopo/webhooks) and call POST /api/kopokopo/subscribe-webhooks after changing it.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Status check failed' });
  }
});

// POST /api/kopokopo/register-manual — register a till payment from M-Pesa SMS when webhook missed it
router.post('/register-manual', ensureAuthenticated, async (req: Request, res: Response) => {
  if (!ensureFinanceOrAdmin(req, res)) return;

  const { transactionReference, amount, phone, notes } = req.body as {
    transactionReference?: string;
    amount?: number;
    phone?: string;
    notes?: string;
  };

  const ref = String(transactionReference || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const amt = Number(amount);

  if (!ref || ref.length < 8) {
    res.status(422).json({ error: 'Valid M-Pesa transaction code is required (e.g. UG7QOA5LRC)' });
    return;
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    res.status(422).json({ error: 'Valid positive amount is required' });
    return;
  }

  try {
    const existing = await prisma.kopoPayment.findFirst({
      where: {
        OR: [
          { transactionReference: { equals: ref, mode: 'insensitive' } },
          { reference: { equals: ref, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      if (existing.walletCredited) {
        res.status(409).json({ error: 'This M-Pesa code is already allocated to a student wallet' });
        return;
      }
      res.json({
        message: 'Payment already registered',
        payment: {
          id: existing.id,
          amount: existing.amount,
          transactionReference: existing.transactionReference || existing.reference,
          allocatable: isAllocatablePayment(existing),
        },
      });
      return;
    }

    const payment = await prisma.kopoPayment.create({
      data: {
        status: 'success',
        amount: amt,
        phone: String(phone || '').trim(),
        transactionReference: ref,
        purpose: 'general',
        eventType: 'buygoods_transaction_received',
        tillNumber: process.env.KOPOKOPO_TILL_NUMBER || '',
        description: notes?.trim() || `Manual till payment registered · ${ref}`,
      },
    });

    await logAuditEvent({
      eventType: 'manual_payment_register',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Register Manual Till Payment',
      description: `Registered M-Pesa ${ref} for KES ${amt}`,
      metadata: { paymentId: payment.id, transactionReference: ref, amount: amt },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Payment registered — you can now allocate it to a student',
      payment: {
        id: payment.id,
        amount: payment.amount,
        transactionReference: payment.transactionReference,
        phone: payment.phone,
        allocatable: true,
      },
    });
  } catch (err: any) {
    console.error('[Kopokopo] Manual register error:', err?.message || err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// GET /api/kopokopo/transactions
router.get('/transactions', async (_req: Request, res: Response) => {
  try {
    const transactions = await prisma.kopoPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(transactions);
  } catch {
    res.status(500).json({ error: 'Failed to fetch Kopokopo transactions' });
  }
});

export default router;
