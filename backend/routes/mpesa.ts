import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '@/services/prisma';
import {
  darajaConfigError,
  formatMpesaPhone,
  initiateDarajaStk,
  isDarajaConfigured,
  queryDarajaStk,
} from '@/services/daraja.service';
import { executeGuestMpesaSale } from '@/routes/pos';
import { displayReceiptNo } from '@/services/receipt';
import type { AuthPayload } from '@/middlewares/auth';
import { canManageOps } from '@/middlewares/auth';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'slowrise-secret-key';

type PosCartLine = { menuItemId: string; quantity: number };
type PosCartPayload = { cashierId: string; items: PosCartLine[] };

function getOptionalUser(req: Request): AuthPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

function emitMpesaUpdate(req: Request, payload: Record<string, unknown>) {
  const io = req.app.get('io');
  if (!io) return;
  io.emit('mpesa_update', payload);
  const location = payload.location as string | undefined;
  if (location) io.to(location).emit('mpesa_update', payload);
}

function paymentView(payment: {
  id: string;
  location: string | null;
  reference: string | null;
  status: string;
  amount: number;
  currency: string;
  phone: string;
  transactionReference: string;
  purpose: string;
  posCompleted: boolean;
  posTransactionId: string | null;
}) {
  return {
    paymentId: payment.id,
    location: payment.location,
    reference: payment.reference,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    phone: payment.phone,
    transactionReference: payment.transactionReference,
    purpose: payment.purpose,
    posCompleted: payment.posCompleted,
    posTransactionId: payment.posTransactionId,
  };
}

async function completePosSale(paymentId: string, mpesaReference: string) {
  const payment = await prisma.kopoPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.purpose !== 'pos_sale' || payment.posCompleted) return null;

  const raw = payment.posCart as { cashierId?: string; items?: PosCartLine[] } | PosCartLine[] | null;
  const cart = Array.isArray(raw)
    ? { cashierId: 'pos', items: raw }
    : raw && Array.isArray(raw.items)
      ? { cashierId: raw.cashierId || 'pos', items: raw.items }
      : null;
  if (!cart || cart.items.length === 0) return null;

  const claimed = await prisma.kopoPayment.updateMany({
    where: { id: paymentId, posCompleted: false },
    data: { posCompleted: true },
  });
  if (claimed.count === 0) return null;

  try {
    const { posTx } = await executeGuestMpesaSale(cart.cashierId, cart.items, mpesaReference);
    await prisma.kopoPayment.update({
      where: { id: paymentId },
      data: { posTransactionId: posTx.id },
    });
    return { receiptNo: displayReceiptNo(posTx), posTransactionId: posTx.id };
  } catch (err) {
    await prisma.kopoPayment.update({
      where: { id: paymentId },
      data: { posCompleted: false },
    });
    console.error('[Daraja] POS sale completion failed:', err);
    return null;
  }
}

async function markPaid(
  req: Request,
  paymentId: string,
  receipt: string,
  rawPayload?: object,
) {
  const payment = await prisma.kopoPayment.update({
    where: { id: paymentId },
    data: {
      status: 'success',
      transactionReference: receipt,
      ...(rawPayload ? { rawPayload } : {}),
    },
  });
  const sale = await completePosSale(payment.id, receipt);
  const payload = {
    ...paymentView(payment),
    status: 'success',
    transactionReference: receipt,
    posReceiptNo: sale?.receiptNo,
    posTransactionId: sale?.posTransactionId || payment.posTransactionId,
    posCompleted: true,
  };
  emitMpesaUpdate(req, payload);
  return payload;
}

// POST /api/mpesa/stkpush
router.post('/stkpush', async (req: Request, res: Response) => {
  const user = getOptionalUser(req);
  const { phone, amount, description, items } = req.body as {
    phone?: string;
    amount?: number;
    description?: string;
    items?: PosCartLine[];
  };

  if (!phone || amount == null) {
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
  if (!isDarajaConfigured()) {
    res.status(503).json({ error: darajaConfigError() });
    return;
  }

  let msisdn: string;
  try {
    msisdn = formatMpesaPhone(phone);
  } catch (err: any) {
    res.status(422).json({ error: err.message });
    return;
  }

  const posCart: PosCartPayload = { cashierId: user.id, items };

  try {
    const pending = await prisma.kopoPayment.create({
      data: {
        status: 'pending',
        amount: Math.round(numericAmount),
        phone: msisdn,
        purpose: 'pos_sale',
        posCart,
        description: description || 'Slow Rise Co bakery sale',
        eventType: 'daraja_stk',
        tillNumber: process.env.MPESA_SHORTCODE || '',
      },
    });

    let stk;
    try {
      stk = await initiateDarajaStk({
        phone: msisdn,
        amount: numericAmount,
        accountReference: pending.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'SLOWRISE',
        description: pending.description,
      });
    } catch (stkErr: any) {
      const darajaBody = stkErr?.response?.data;
      const message =
        darajaBody?.errorMessage ||
        darajaBody?.error_description ||
        stkErr?.message ||
        'Daraja STK push failed';
      await prisma.kopoPayment.update({
        where: { id: pending.id },
        data: { status: 'failed', rawPayload: darajaBody || { message } },
      }).catch(() => {});
      console.error('[Daraja] STK push error:', darajaBody || stkErr.message);
      res.status(422).json({ error: message });
      return;
    }

    const payment = await prisma.kopoPayment.update({
      where: { id: pending.id },
      data: {
        location: stk.checkoutRequestId,
        reference: stk.merchantRequestId || stk.checkoutRequestId,
      },
    });

    console.log('[Daraja] STK queued', stk.checkoutRequestId);
    res.status(201).json({
      location: payment.location,
      paymentId: payment.id,
      purpose: payment.purpose,
      customerMessage: stk.customerMessage,
    });
  } catch (err: any) {
    console.error('[Daraja] STK push error:', err?.response?.data || err.message);
    res.status(422).json({ error: err?.message || 'Daraja STK push failed' });
  }
});

// GET /api/mpesa/status?location=CheckoutRequestID
router.get('/status', async (req: Request, res: Response) => {
  const location = String(req.query.location || '');
  if (!location) {
    res.status(400).json({ error: 'location query param is required' });
    return;
  }

  const payment = await prisma.kopoPayment.findFirst({
    where: { OR: [{ location }, { reference: location }] },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  if (payment.status !== 'pending') {
    res.json(paymentView(payment));
    return;
  }
  if (!payment.location || !isDarajaConfigured()) {
    res.json(paymentView(payment));
    return;
  }

  try {
    const query = await queryDarajaStk(payment.location);
    if (query.pending) {
      res.json(paymentView(payment));
      return;
    }
    if (query.success) {
      const receipt = payment.transactionReference || payment.location;
      const updated = await markPaid(req, payment.id, receipt);
      res.json(updated);
      return;
    }
    const failed = await prisma.kopoPayment.update({
      where: { id: payment.id },
      data: { status: 'failed', description: query.resultDesc || payment.description },
    });
    const payload = paymentView(failed);
    emitMpesaUpdate(req, payload);
    res.json(payload);
  } catch (err: any) {
    console.error('[Daraja] STK query error:', err?.response?.data || err.message);
    res.json(paymentView(payment));
  }
});

function callbackItem(items: Array<{ Name?: string; Value?: unknown }> | undefined, name: string) {
  const found = (items || []).find((item) => item.Name === name);
  return found?.Value;
}

// POST /api/mpesa/callback — Safaricom Daraja STK callback
router.post('/callback', async (req: Request, res: Response) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const stk = req.body?.Body?.stkCallback;
  if (!stk) return;

  const checkoutRequestId = String(stk.CheckoutRequestID || '');
  const resultCode = Number(stk.ResultCode);
  const items = stk.CallbackMetadata?.Item as Array<{ Name?: string; Value?: unknown }> | undefined;
  const receipt = String(callbackItem(items, 'MpesaReceiptNumber') || '');
  const amount = Number(callbackItem(items, 'Amount') || 0);
  const phone = String(callbackItem(items, 'PhoneNumber') || '');

  if (!checkoutRequestId) return;

  const payment = await prisma.kopoPayment.findFirst({
    where: { location: checkoutRequestId },
  });
  if (!payment) {
    console.warn('[Daraja] Callback for unknown checkout', checkoutRequestId);
    return;
  }

  if (resultCode !== 0) {
    const failed = await prisma.kopoPayment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        description: String(stk.ResultDesc || 'Payment cancelled'),
        rawPayload: req.body,
      },
    });
    emitMpesaUpdate(req, paymentView(failed));
    return;
  }

  await markPaid(req, payment.id, receipt || checkoutRequestId, req.body);
  if (amount > 0 && Math.abs(amount - payment.amount) > 0.5) {
    console.warn('[Daraja] Callback amount differs from cart', { amount, expected: payment.amount, phone });
  }
});

export default router;
