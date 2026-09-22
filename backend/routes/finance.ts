import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAuthenticated } from '@/middlewares/auth';
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
    // include entire end date day
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
    student_reg_no: String(meta.student_reg_no ?? meta.studentRegNo ?? meta.reg_no ?? ''),
    student_name: String(meta.student_name ?? meta.studentName ?? ''),
    payer_name: String(meta.payer_name ?? meta.payerName ?? senderName ?? ''),
    payer_phone: String(meta.payer_phone ?? meta.payerPhone ?? senderPhone ?? ''),
    purpose: String(meta.purpose ?? ''),
    payer_type: String(meta.payer_type ?? meta.payerType ?? ''),
    status: String(attrs.status ?? ''),
    error: String(event.errors ?? event.error ?? ''),
  };
}

function isGuestTillPayment(purpose: string, studentId: string | null | undefined, meta: Record<string, string>): boolean {
  if (purpose === 'pos_sale' && !studentId) return true;
  return meta.payer_type === 'guest' || meta.student_name?.toLowerCase() === 'guest';
}

function tillPaymentReceived(status: string, amount: number): boolean {
  const s = (status || '').toLowerCase();
  // Money hit the till for success and for superseded duplicates of a real receipt
  return (KOPO_SUCCESS.has(s) || s === 'superseded') && amount > 0;
}

function normalizeTillRef(ref: string | null | undefined, fallbackId: string): string {
  const cleaned = String(ref || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  return cleaned || fallbackId;
}

/** Keep one row per M-Pesa code so Collections never double-counts till money. */
function dedupeKopoPaymentsByMpesaRef<
  T extends {
    id: string;
    transactionReference: string;
    reference: string | null;
    status: string;
    walletCredited: boolean;
    allocatedAt: Date | null;
    studentId: string | null;
    createdAt: Date;
    amount: number;
  },
>(payments: T[]): T[] {
  const rank = (p: T) => {
    let score = 0;
    if (p.walletCredited) score += 100;
    if (p.allocatedAt) score += 50;
    if (p.studentId) score += 20;
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

function kopoSettlementNote(
  purpose: string,
  success: boolean,
  walletCredited: boolean,
  posCompleted: boolean,
): string {
  if (!success) return 'not received';
  if (purpose === 'wallet_topup') return walletCredited ? 'wallet credited' : 'till received · wallet pending';
  if (purpose === 'pos_sale') return posCompleted ? 'pos sale completed' : 'till received · pos pending';
  return 'till received';
}

function formatKopoMetadata(
  description: string,
  meta: Record<string, string>,
  extras?: { guest?: boolean; purpose?: string },
): string {
  const parts: string[] = [];
  if (extras?.guest) parts.push('Guest');
  if (meta.description) parts.push(meta.description);
  if (meta.student_reg_no && meta.student_reg_no !== 'GUEST') parts.push(`Adm: ${meta.student_reg_no}`);
  const purpose = extras?.purpose || meta.purpose;
  if (purpose) parts.push(`Purpose: ${purpose}`);
  if (meta.error) parts.push(meta.error);
  if (meta.status && meta.status.toLowerCase() !== 'success') parts.push(`Status: ${meta.status}`);
  if (parts.length > 0) return parts.join(' · ');
  return description || '-';
}

function kopoMethod(purpose: string, guest = false, opts?: { manuallyAllocated?: boolean }): string {
  if (purpose === 'pos_sale') return guest ? 'M-Pesa STK (Guest POS)' : 'M-Pesa STK (POS)';
  if (purpose === 'wallet_topup') {
    return opts?.manuallyAllocated
      ? 'Till → Student Wallet'
      : 'M-Pesa STK (Student Wallet)';
  }
  return 'M-Pesa Till (Buy Goods)';
}

function kopoChannel(
  purpose: string,
  opts?: { manuallyAllocated?: boolean },
): 'till' | 'stk' | 'wallet' {
  if (purpose === 'pos_sale') return 'stk';
  if (purpose === 'wallet_topup') return opts?.manuallyAllocated ? 'wallet' : 'stk';
  return 'till';
}

// ─── GET /api/finance/summary ─────────────────────────────────────────────────
// Aggregates total POS sales (Revenue) and total Expenses
router.get('/summary', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

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

    return res.json({
      revenue,
      expenses,
      netProfit,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/finance/collections ─────────────────────────────────────────────
// Till M-Pesa payments (all statuses) + wallet top-ups/deposits + wallet usage
router.get('/collections', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { startDate, endDate } = req.query as Record<string, string>;
  const dateFilter = parseDateFilter(startDate, endDate);
  if (dateFilter === null) return res.status(422).json({ message: 'Invalid date range' });

  const createdAt =
    dateFilter && Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  try {
    const [koposRaw, purchases, deposits, guestPosSales] = await Promise.all([
      prisma.kopoPayment.findMany({
        where: createdAt ? { createdAt } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 20000,
      }),
      prisma.walletTransaction.findMany({
        where: {
          ...(createdAt ? { createdAt } : {}),
          type: { in: ['purchase', 'refund'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 20000,
        include: {
          student: { select: { name: true, regNo: true } },
        },
      }),
      prisma.walletTransaction.findMany({
        where: {
          ...(createdAt ? { createdAt } : {}),
          type: 'deposit',
          NOT: { description: { contains: 'KopoKopo', mode: 'insensitive' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20000,
        include: {
          student: { select: { name: true, regNo: true } },
        },
      }),
      prisma.posTransaction.findMany({
        where: {
          paymentMethod: { in: ['mpesa', 'cash'] },
          studentId: null,
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

    const studentIds = [
      ...new Set(kopos.map((k) => k.studentId).filter(Boolean) as string[]),
    ];
    const students =
      studentIds.length > 0
        ? await prisma.student.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, name: true, regNo: true },
          })
        : [];
    const studentById = new Map(students.map((s) => [s.id, s]));

    const kopoRows = kopos.map((k) => {
      const student = k.studentId ? studentById.get(k.studentId) : undefined;
      const meta = kopoMetadataFromRaw(k.rawPayload);
      const purpose = k.purpose || meta.purpose || 'general';
      const guest = isGuestTillPayment(purpose, k.studentId, meta);
      const success = KOPO_SUCCESS.has((k.status || '').toLowerCase());
      const receivedOnTill = tillPaymentReceived(k.status, k.amount);
      const payerName = meta.payer_name || '';
      const payerPhone = meta.payer_phone || '';
      const manuallyAllocated =
        Boolean(k.allocatedAt) ||
        /manual allocation/i.test(k.description || '');
      const channel = kopoChannel(purpose, { manuallyAllocated });

      const payload = {
        source: 'kopo',
        channel,
        paymentId: k.id,
        status: k.status,
        purpose,
        guest,
        amount: k.amount,
        currency: k.currency,
        phone: k.phone,
        description: k.description,
        tillNumber: k.tillNumber,
        transactionReference: k.transactionReference,
        reference: k.reference,
        location: k.location,
        studentId: k.studentId,
        studentName: guest ? 'Guest' : student?.name || meta.student_name || null,
        studentRegNo: guest ? k.phone || 'GUEST' : student?.regNo || meta.student_reg_no || null,
        payerName: payerName || null,
        payerPhone: payerPhone || null,
        walletCredited: k.walletCredited,
        posCompleted: k.posCompleted,
        posTransactionId: k.posTransactionId,
        posCart: k.posCart,
        payerUserId: k.payerUserId,
        payerRole: k.payerRole,
        tillReceived: receivedOnTill,
        settlement: kopoSettlementNote(purpose, success, k.walletCredited, k.posCompleted),
        createdAt: k.createdAt,
        originationTime: k.originationTime,
        metadata: {
          description: meta.description || k.description,
          student_id: k.studentId || '',
          student_reg_no: guest ? 'GUEST' : student?.regNo || meta.student_reg_no || '',
          student_name: guest ? 'Guest' : student?.name || meta.student_name || '',
          payer_name: payerName,
          payer_phone: payerPhone,
          purpose,
          payer_type: guest ? 'guest' : meta.payer_type || 'student',
          ...(meta.error ? { error: meta.error } : {}),
        },
        kopokopo: k.rawPayload ?? null,
      };

      return {
        id: k.id,
        source: 'kopo',
        channel,
        mpesaNumber: k.phone || payerPhone || '',
        date: k.createdAt,
        name: guest ? 'Guest' : student?.name || meta.student_name || payerName || '',
        admNo: guest ? k.phone || 'GUEST' : student?.regNo || meta.student_reg_no || '',
        method: kopoMethod(purpose, guest, { manuallyAllocated }),
        amount: receivedOnTill ? k.amount : 0,
        attemptedAmount: k.amount,
        status: k.status,
        type: purpose,
        metadata: formatKopoMetadata(k.description, meta, { guest, purpose }),
        transactionRef: k.transactionReference || k.reference || '',
        walletCredited: k.walletCredited,
        allocatable: success && !k.walletCredited && purpose !== 'pos_sale' && !k.posCompleted && k.amount > 0,
        payload,
      };
    });

    const guestPosRows = guestPosSales
      .filter((tx) => !linkedPosIds.has(tx.id))
      .map((tx) => {
        const isCash = tx.paymentMethod === 'cash';
        const source = isCash ? 'pos_cash' : 'pos_mpesa';
        const channel = isCash ? 'cash' : 'stk';
        const channelLabel = tx.cashierId === 'kiosk' ? 'Kiosk' : 'POS';

        const payload = {
          source,
          channel,
          guest: true,
          posTransactionId: tx.id,
          receiptNo: tx.receiptNo,
          totalAmount: tx.totalAmount,
          paymentMethod: tx.paymentMethod,
          cashierId: tx.cashierId,
          channelLabel,
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
          admNo: tx.receiptNo || 'GUEST',
          method: isCash ? `Cash (${channelLabel})` : `M-Pesa STK (Guest ${channelLabel})`,
          amount: tx.totalAmount,
          attemptedAmount: tx.totalAmount,
          status: 'completed',
          type: 'pos_sale',
          metadata: `Guest · ${isCash ? 'Cash' : 'STK'} · ${channelLabel} · receipt ${tx.receiptNo || tx.id}`,
          transactionRef: tx.receiptNo || tx.id,
          payload,
        };
      });

    const purchaseRows = purchases.map((t) => {
      const payload = {
        source: 'wallet',
        channel: 'wallet',
        transactionId: t.id,
        type: t.type,
        amount: t.amount,
        reference: t.reference,
        description: t.description,
        studentId: t.studentId,
        studentName: t.student?.name || null,
        studentRegNo: t.student?.regNo || null,
        createdAt: t.createdAt,
      };

      return {
        id: t.id,
        source: 'wallet',
        channel: 'wallet',
        mpesaNumber: '',
        date: t.createdAt,
        name: t.student?.name || '',
        admNo: t.student?.regNo || '',
        method: t.type === 'refund' ? 'Student Wallet Refund' : 'Student Wallet Usage',
        amount: t.amount,
        attemptedAmount: Math.abs(t.amount),
        status: 'completed',
        type: t.type,
        metadata: t.description || '',
        transactionRef: t.reference || '',
        payload,
      };
    });

    const depositRows = deposits.map((t) => {
      const payload = {
        source: 'wallet',
        channel: 'wallet',
        transactionId: t.id,
        type: 'deposit',
        amount: t.amount,
        reference: t.reference,
        description: t.description,
        studentId: t.studentId,
        studentName: t.student?.name || null,
        studentRegNo: t.student?.regNo || null,
        createdAt: t.createdAt,
      };

      return {
        id: t.id,
        source: 'wallet',
        channel: 'wallet',
        mpesaNumber: '',
        date: t.createdAt,
        name: t.student?.name || '',
        admNo: t.student?.regNo || '',
        method: 'Student Wallet Top-up (Manual)',
        amount: t.amount,
        attemptedAmount: t.amount,
        status: 'completed',
        type: 'deposit',
        metadata: t.description || 'Wallet top-up',
        transactionRef: t.reference || '',
        payload,
      };
    });

    const rows = [...kopoRows, ...guestPosRows, ...depositRows, ...purchaseRows].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const tillInflow = kopoRows
      .filter((r) => r.amount > 0 && r.source === 'kopo')
      .reduce((s, r) => s + r.amount, 0);
    const guestMpesa = guestPosRows
      .filter((r) => r.source === 'pos_mpesa')
      .reduce((s, r) => s + r.amount, 0);
    const cashSales = guestPosRows
      .filter((r) => r.source === 'pos_cash')
      .reduce((s, r) => s + r.amount, 0);
    const walletTopUps = kopoRows
      .filter((r) => r.type === 'wallet_topup' && r.walletCredited)
      .reduce((s, r) => s + r.amount, 0)
      + depositRows.reduce((s, r) => s + r.amount, 0);
    const usage = purchaseRows
      .filter((r) => r.type === 'purchase')
      .reduce((s, r) => s + Math.abs(r.amount), 0);

    return res.json({
      rows,
      summary: {
        tillInflow: tillInflow + guestMpesa,
        walletTopUps,
        cashSales,
        usage,
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
router.get('/expenses', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const expenses = await prisma.expense.findMany({ orderBy: { date: 'desc' }, take: 100 });
    return res.json(expenses);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/finance/expenses ───────────────────────────────────────────────
router.post('/expenses', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

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
