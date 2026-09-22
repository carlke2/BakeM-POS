import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureOwner } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';

const router = Router();

type DateFilter = { gte?: Date; lte?: Date };

const KOPO_SUCCESS = new Set(['success', 'received', 'complete', 'completed', 'paid']);

function parseDateFilter(startDate?: string, endDate?: string): DateFilter | null {
  const filter: DateFilter = {};
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) return null;
    filter.gte = d;
  }
  if (endDate) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    filter.lte = d;
  }
  return filter;
}

function kopoMetadataFromRaw(rawPayload: unknown): Record<string, string> {
  if (!rawPayload || typeof rawPayload !== 'object') return {};
  const data = (rawPayload as any)?.data ?? rawPayload;
  const attrs = (data as any)?.attributes ?? {};
  const meta = attrs?.metadata ?? {};
  const event = attrs?.event ?? (data as any)?.event ?? {};
  const resource = event?.resource ?? {};

  const senderFirst = String(resource.sender_first_name ?? '').trim();
  const senderMiddle = String(resource.sender_middle_name ?? '').trim();
  const senderLast = String(resource.sender_last_name ?? '').trim();
  const senderName = [senderFirst, senderMiddle, senderLast].filter(Boolean).join(' ');
  const senderPhone = String(resource.sender_phone_number ?? '').trim();

  return {
    description: String(meta.description ?? ''),
    payer_name: String(meta.payer_name ?? meta.payerName ?? senderName ?? ''),
    payer_phone: String(meta.payer_phone ?? meta.payerPhone ?? senderPhone ?? ''),
    purpose: String(meta.purpose ?? ''),
    payer_type: String(meta.payer_type ?? meta.payerType ?? ''),
    status: String(attrs.status ?? ''),
    error: String(event.errors ?? event.error ?? ''),
  };
}

function tillPaymentReceived(status: string, amount: number): boolean {
  const s = (status || '').toLowerCase();
  return (KOPO_SUCCESS.has(s) || s === 'superseded') && amount > 0;
}

function normalizeTillRef(ref: string | null | undefined, fallbackId: string): string {
  const cleaned = String(ref || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  return cleaned || fallbackId;
}

function dedupeKopoPaymentsByMpesaRef<
  T extends {
    id: string;
    transactionReference: string;
    reference: string | null;
    status: string;
    posCompleted: boolean;
    createdAt: Date;
    amount: number;
  },
>(payments: T[]): T[] {
  const rank = (p: T) => {
    let score = 0;
    if (p.posCompleted) score += 80;
    if (KOPO_SUCCESS.has((p.status || '').toLowerCase())) score += 10;
    if ((p.status || '').toLowerCase() === 'superseded') score -= 5;
    return score;
  };

  const best = new Map<string, T>();
  for (const p of payments) {
    const key = normalizeTillRef(p.transactionReference || p.reference, p.id);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, p);
      continue;
    }
    const prevRank = rank(prev);
    const nextRank = rank(p);
    if (nextRank > prevRank || (nextRank === prevRank && p.createdAt < prev.createdAt)) {
      best.set(key, p);
    }
  }
  return [...best.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function kopoSettlementNote(purpose: string, success: boolean, posCompleted: boolean): string {
  if (!success) return 'not received';
  if (purpose === 'pos_sale') return posCompleted ? 'pos sale completed' : 'till received · pos pending';
  return 'till received';
}

function formatKopoMetadata(description: string, meta: Record<string, string>, purpose?: string): string {
  const parts: string[] = ['Guest'];
  if (meta.description) parts.push(meta.description);
  if (purpose) parts.push(`Purpose: ${purpose}`);
  if (meta.error) parts.push(meta.error);
  if (meta.status && meta.status.toLowerCase() !== 'success') parts.push(`Status: ${meta.status}`);
  if (parts.length > 1) return parts.join(' · ');
  return description || '-';
}

// ─── GET /api/finance/summary ─────────────────────────────────────────────────
router.get('/summary', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const { startDate, endDate } = req.query as Record<string, string>;
  const dateFilter = parseDateFilter(startDate, endDate);
  if (dateFilter === null) return res.status(422).json({ message: 'Invalid date range' });

  try {
    const useDate = dateFilter && Object.keys(dateFilter).length > 0;
    const posFilter = useDate ? { createdAt: dateFilter, status: 'completed' } : { status: 'completed' };
    const expenseFilter = useDate ? { date: dateFilter } : {};

    const [posAggr, expenseAggr] = await Promise.all([
      prisma.posTransaction.aggregate({ _sum: { totalAmount: true }, where: posFilter }),
      prisma.expense.aggregate({ _sum: { amount: true }, where: expenseFilter }),
    ]);

    const revenue = posAggr._sum.totalAmount || 0;
    const expenses = expenseAggr._sum.amount || 0;
    const netProfit = revenue - expenses;

    return res.json({ revenue, expenses, netProfit });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/finance/collections ─────────────────────────────────────────────
router.get('/collections', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const { startDate, endDate } = req.query as Record<string, string>;
  const dateFilter = parseDateFilter(startDate, endDate);
  if (dateFilter === null) return res.status(422).json({ message: 'Invalid date range' });

  const createdAt =
    dateFilter && Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  try {
    const [koposRaw, posSales] = await Promise.all([
      prisma.kopoPayment.findMany({
        where: createdAt ? { createdAt } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 20000,
      }),
      prisma.posTransaction.findMany({
        where: {
          paymentMethod: { in: ['mpesa', 'cash'] },
          status: 'completed',
          ...(createdAt ? { createdAt } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 20000,
        include: {
          items: { include: { menuItem: { select: { name: true } } } },
        },
      }),
    ]);

    const kopos = dedupeKopoPaymentsByMpesaRef(koposRaw);

    const linkedPosIds = new Set(
      kopos.map((k) => k.posTransactionId).filter(Boolean) as string[],
    );

    const kopoRows = kopos.map((k) => {
      const meta = kopoMetadataFromRaw(k.rawPayload);
      const purpose = k.purpose || meta.purpose || 'pos_sale';
      const success = KOPO_SUCCESS.has((k.status || '').toLowerCase());
      const receivedOnTill = tillPaymentReceived(k.status, k.amount);
      const payerName = meta.payer_name || '';
      const payerPhone = meta.payer_phone || '';

      const payload = {
        source: 'kopo',
        channel: 'stk' as const,
        paymentId: k.id,
        status: k.status,
        purpose,
        guest: true,
        amount: k.amount,
        currency: k.currency,
        phone: k.phone,
        description: k.description,
        tillNumber: k.tillNumber,
        transactionReference: k.transactionReference,
        reference: k.reference,
        location: k.location,
        payerName: payerName || null,
        payerPhone: payerPhone || null,
        posCompleted: k.posCompleted,
        posTransactionId: k.posTransactionId,
        posCart: k.posCart,
        tillReceived: receivedOnTill,
        settlement: kopoSettlementNote(purpose, success, k.posCompleted),
        createdAt: k.createdAt,
        originationTime: k.originationTime,
        metadata: {
          description: meta.description || k.description,
          payer_name: payerName,
          payer_phone: payerPhone,
          purpose,
          payer_type: 'guest',
          ...(meta.error ? { error: meta.error } : {}),
        },
        kopokopo: k.rawPayload ?? null,
      };

      return {
        id: k.id,
        source: 'kopo',
        channel: 'stk' as const,
        mpesaNumber: k.phone || payerPhone || '',
        date: k.createdAt,
        name: payerName || 'Guest',
        method: 'M-Pesa STK (POS)',
        amount: receivedOnTill ? k.amount : 0,
        attemptedAmount: k.amount,
        status: k.status,
        type: purpose,
        metadata: formatKopoMetadata(k.description, meta, purpose),
        transactionRef: k.transactionReference || k.reference || '',
        posCompleted: k.posCompleted,
        payload,
      };
    });

    const posRows = posSales
      .filter((tx) => !linkedPosIds.has(tx.id))
      .map((tx) => {
        const isCash = tx.paymentMethod === 'cash';
        const source = isCash ? 'pos_cash' : 'pos_mpesa';
        const channel = isCash ? 'cash' : 'stk';

        const payload = {
          source,
          channel,
          guest: true,
          posTransactionId: tx.id,
          receiptNo: tx.receiptNo,
          totalAmount: tx.totalAmount,
          paymentMethod: tx.paymentMethod,
          cashierId: tx.cashierId,
          items: tx.items.map((line) => ({
            name: line.menuItem.name,
            quantity: line.quantity,
            price: line.price,
          })),
          createdAt: tx.createdAt,
        };

        return {
          id: tx.id,
          source,
          channel,
          mpesaNumber: '',
          date: tx.createdAt,
          name: 'Guest',
          method: isCash ? 'Cash (POS)' : 'M-Pesa STK (POS)',
          amount: tx.totalAmount,
          attemptedAmount: tx.totalAmount,
          status: 'completed',
          type: 'pos_sale',
          metadata: `Guest · ${isCash ? 'Cash' : 'STK'} · receipt ${tx.receiptNo || tx.id}`,
          transactionRef: tx.receiptNo || tx.id,
          payload,
        };
      });

    const rows = [...kopoRows, ...posRows].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const tillInflow = kopoRows
      .filter((r) => r.amount > 0)
      .reduce((s, r) => s + r.amount, 0);
    const guestMpesa = posRows
      .filter((r) => r.source === 'pos_mpesa')
      .reduce((s, r) => s + r.amount, 0);
    const cashSales = posRows
      .filter((r) => r.source === 'pos_cash')
      .reduce((s, r) => s + r.amount, 0);

    return res.json({
      rows,
      summary: {
        tillInflow: tillInflow + guestMpesa,
        cashSales,
        recordCount: rows.length,
        uniqueTillPayments: kopoRows.filter((r) => r.amount > 0).length,
        rawKopoBeforeDedupe: koposRaw.length,
      },
    });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/finance/expenses ────────────────────────────────────────────────
router.get('/expenses', ensureOwner, async (_req: Request, res: Response): Promise<any> => {
  try {
    const expenses = await prisma.expense.findMany({ orderBy: { date: 'desc' }, take: 100 });
    return res.json(expenses);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/finance/expenses ───────────────────────────────────────────────
router.post('/expenses', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const { category, amount, description, date } = req.body;
  if (!category || !amount || !description) {
    return res.status(422).json({ message: 'Category, amount, and description are required' });
  }

  try {
    const expense = await prisma.expense.create({
      data: {
        category,
        amount: Number(amount),
        description,
        date: date ? new Date(date) : new Date(),
        recordedBy: req.user!.id,
      },
    });

    await logAuditEvent({
      eventType: 'expense_recorded',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Record Expense',
      description: `Recorded expense of KES ${amount} for ${category} (${description})`,
      ipAddress: req.ip,
    });

    return res.status(201).json(expense);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
