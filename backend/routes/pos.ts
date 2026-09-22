import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAuthenticated, canManageOps } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import { displayReceiptNo, generateReceiptNo } from '@/services/receipt';
import { deductStockForOrder } from '@/services/inventoryDeduction';

const router = Router();

const POS_TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

type CartLine = { menuItemId: string; quantity: number };
export type { CartLine };

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Failed to process sale';
};

async function attachCashierNames<T extends { cashierId: string }>(
  receipts: T[],
): Promise<Array<T & { cashierName: string | null }>> {
  const ids = [...new Set(receipts.map((r) => r.cashierId).filter(Boolean))];
  if (ids.length === 0) {
    return receipts.map((r) => ({ ...r, cashierName: null }));
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return receipts.map((r) => ({
    ...r,
    cashierName: nameById.get(r.cashierId) || null,
  }));
}

async function withCashierName<T extends { cashierId: string }>(
  receipt: T,
  fallbackName?: string,
): Promise<T & { cashierName: string | null }> {
  if (fallbackName) {
    return { ...receipt, cashierName: fallbackName };
  }
  const [enriched] = await attachCashierNames([receipt]);
  return enriched;
}

const mapSaleError = (message: string): { status: number; body: { message: string } } | null => {
  if (message === 'INVALID_QUANTITY') {
    return { status: 422, body: { message: 'Each item must have a quantity greater than 0' } };
  }
  if (message === 'INVALID_PAYMENT_METHOD') {
    return { status: 422, body: { message: 'paymentMethod must be cash or mpesa' } };
  }
  if (message.startsWith('ITEM_NOT_FOUND')) {
    return { status: 422, body: { message: 'One or more menu items were not found' } };
  }
  if (message.startsWith('ITEM_UNAVAILABLE')) {
    const name = message.split(':')[1];
    return { status: 422, body: { message: name ? `${name} is currently unavailable` : 'An item is unavailable' } };
  }
  if (message.startsWith('INSUFFICIENT_STOCK')) {
    const name = message.split(':')[1];
    return { status: 422, body: { message: name ? `Not enough stock for ${name}` : 'Insufficient stock for one or more items' } };
  }
  if (message.startsWith('INSUFFICIENT_INGREDIENT')) {
    const name = message.split(':')[1];
    return { status: 422, body: { message: name ? `Insufficient ingredient stock: ${name}` : 'Insufficient ingredient stock' } };
  }
  return null;
};

const parseDayBounds = (dateStr: string): { start: Date; end: Date } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return {
    start: new Date(year, month - 1, day, 0, 0, 0, 0),
    end: new Date(year, month - 1, day, 23, 59, 59, 999),
  };
};

const todayDateString = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Guest walk-in sale (cash or M-Pesa) — Slow Rise Co bakery POS. */
export async function executeGuestSale(
  cashierId: string,
  items: CartLine[],
  paymentMethod: 'cash' | 'mpesa',
) {
  if (paymentMethod !== 'cash' && paymentMethod !== 'mpesa') {
    throw new Error('INVALID_PAYMENT_METHOD');
  }

  return prisma.$transaction(async (tx) => {
    const itemIds = items.map((i) => i.menuItemId);
    const menuItems = await tx.menuItem.findMany({ where: { id: { in: itemIds } } });

    let totalAmount = 0;
    const orderLines = items.map((cartItem) => {
      const quantity = Math.floor(Number(cartItem.quantity));
      const menuItem = menuItems.find((m) => m.id === cartItem.menuItemId);

      if (!menuItem) throw new Error(`ITEM_NOT_FOUND:${cartItem.menuItemId}`);
      if (!menuItem.isAvailable) throw new Error(`ITEM_UNAVAILABLE:${menuItem.name}`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');

      totalAmount += menuItem.price * quantity;
      return { menuItemId: menuItem.id, quantity, price: menuItem.price };
    });

    const receiptNo = await generateReceiptNo(async (no) =>
      Boolean(
        await tx.posTransaction.findFirst({ where: { receiptNo: no }, select: { id: true } }),
      ),
    );

    await deductStockForOrder(tx, orderLines, { userId: cashierId, receiptNo });

    const posTx = await tx.posTransaction.create({
      data: {
        cashierId,
        totalAmount,
        receiptNo,
        paymentMethod,
        items: { create: orderLines },
      },
      include: { items: { include: { menuItem: { select: { name: true } } } } },
    });

    return { posTx, totalAmount };
  }, POS_TX_OPTIONS);
}

/** @deprecated use executeGuestSale(..., 'mpesa') */
export async function executeGuestMpesaSale(
  cashierId: string,
  items: CartLine[],
  _mpesaReference: string,
) {
  return executeGuestSale(cashierId, items, 'mpesa');
}

function respondSaleError(res: Response, error: unknown, logLabel: string) {
  const message = getErrorMessage(error);
  console.error(`${logLabel}:`, message);
  const mapped = mapSaleError(message);
  if (mapped !== null) {
    res.status(mapped.status).json(mapped.body);
    return;
  }
  res.status(500).json({ message: 'Failed to process order' });
}

// ─── POST /api/pos/sale ───────────────────────────────────────────────────────
router.post('/sale', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ message: 'Only bakery staff can process sales' });
    return;
  }

  const { items, paymentMethod } = req.body as {
    items?: CartLine[];
    paymentMethod?: string;
  };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(422).json({ message: 'Cart items are required' });
    return;
  }

  const method = String(paymentMethod || '').toLowerCase();
  if (method !== 'cash' && method !== 'mpesa') {
    res.status(422).json({ message: 'paymentMethod must be cash or mpesa' });
    return;
  }

  const cashierId = req.user!.id;

  try {
    const result = await executeGuestSale(cashierId, items, method);

    await logAuditEvent({
      eventType: 'pos_sale',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: method === 'cash' ? 'Cash Sale' : 'M-Pesa Sale',
      description: `${method} sale of KES ${result.totalAmount}`,
      metadata: { receiptId: result.posTx.id, receiptNo: displayReceiptNo(result.posTx), paymentMethod: method },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Sale completed successfully',
      receipt: await withCashierName(result.posTx, req.user!.name),
      totalAmount: result.totalAmount,
    });
  } catch (error: unknown) {
    respondSaleError(res, error, 'POS Sale Error');
  }
});

// ─── POST /api/pos/cash-sale ──────────────────────────────────────────────────
router.post('/cash-sale', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ message: 'Only bakery staff can process sales' });
    return;
  }

  const { items } = req.body as { items?: CartLine[] };
  if (!Array.isArray(items) || items.length === 0) {
    res.status(422).json({ message: 'Cart items are required' });
    return;
  }

  const cashierId = req.user!.id;

  try {
    const result = await executeGuestSale(cashierId, items, 'cash');

    await logAuditEvent({
      eventType: 'pos_cash_sale',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Cash Sale',
      description: `Cash sale of KES ${result.totalAmount}`,
      metadata: { receiptId: result.posTx.id },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Cash sale completed',
      receipt: await withCashierName(result.posTx, req.user!.name),
      totalAmount: result.totalAmount,
    });
  } catch (error: unknown) {
    respondSaleError(res, error, 'POS cash sale error');
  }
});

// ─── GET /api/pos/sales/summary ───────────────────────────────────────────────
router.get('/sales/summary', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }

  const dateStr = String(req.query.date || '').trim() || todayDateString();
  const bounds = parseDayBounds(dateStr);
  if (!bounds) {
    res.status(422).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    return;
  }

  const where = {
    status: 'completed',
    createdAt: { gte: bounds.start, lte: bounds.end },
  };

  const KOPO_SUCCESS = new Set(['success', 'received', 'complete', 'completed', 'paid']);
  const tillReceived = (status: string, amount: number) => {
    const s = (status || '').toLowerCase();
    return (KOPO_SUCCESS.has(s) || s === 'superseded') && amount > 0;
  };
  const normalizeTillRef = (ref: string | null | undefined, fallbackId: string) => {
    const cleaned = String(ref || '').trim().toUpperCase().replace(/\s+/g, '');
    return cleaned || fallbackId;
  };

  try {
    const [aggregate, transactionCount, receipts, kopoRaw] = await Promise.all([
      prisma.posTransaction.aggregate({ where, _sum: { totalAmount: true } }),
      prisma.posTransaction.count({ where }),
      prisma.posTransaction.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true,
          paymentMethod: true,
          items: { select: { quantity: true } },
        },
      }),
      prisma.kopoPayment.findMany({
        where: {
          createdAt: { gte: bounds.start, lte: bounds.end },
          amount: { gt: 0 },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          status: true,
          eventType: true,
          purpose: true,
          phone: true,
          description: true,
          tillNumber: true,
          transactionReference: true,
          reference: true,
          posCompleted: true,
          posTransactionId: true,
          createdAt: true,
        },
      }),
    ]);

    const tillCandidates = kopoRaw.filter((p) => tillReceived(p.status, p.amount));
    const bestByRef = new Map<string, (typeof tillCandidates)[number]>();
    for (const p of tillCandidates) {
      const key = normalizeTillRef(p.transactionReference || p.reference, p.id);
      const prev = bestByRef.get(key);
      if (!prev) {
        bestByRef.set(key, p);
        continue;
      }
      let prevScore = 0;
      let nextScore = 0;
      if (prev.posCompleted) prevScore += 80;
      if (KOPO_SUCCESS.has((prev.status || '').toLowerCase())) prevScore += 10;
      if (p.posCompleted) nextScore += 80;
      if (KOPO_SUCCESS.has((p.status || '').toLowerCase())) nextScore += 10;
      if (nextScore > prevScore || (nextScore === prevScore && p.createdAt < prev.createdAt)) {
        bestByRef.set(key, p);
      }
    }
    const tillPayments = [...bestByRef.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const tillInflow = tillPayments.reduce((sum, p) => sum + p.amount, 0);
    const posNonMpesa = receipts
      .filter((r) => (r.paymentMethod || 'cash').toLowerCase() !== 'mpesa')
      .reduce((sum, r) => sum + r.totalAmount, 0);
    const posSales = aggregate._sum.totalAmount || 0;
    const combinedTotal = posNonMpesa + tillInflow;

    const itemsSold = receipts.reduce(
      (sum, receipt) => sum + receipt.items.reduce((lineSum, item) => lineSum + item.quantity, 0),
      0,
    );

    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      amount: 0,
      count: 0,
      posAmount: 0,
      tillAmount: 0,
    }));

    for (const receipt of receipts) {
      const hour = new Date(receipt.createdAt).getHours();
      if ((receipt.paymentMethod || 'cash').toLowerCase() !== 'mpesa') {
        hourly[hour].amount += receipt.totalAmount;
        hourly[hour].posAmount += receipt.totalAmount;
        hourly[hour].count += 1;
      } else {
        hourly[hour].posAmount += receipt.totalAmount;
        hourly[hour].count += 1;
      }
    }
    for (const payment of tillPayments) {
      const hour = new Date(payment.createdAt).getHours();
      hourly[hour].amount += payment.amount;
      hourly[hour].tillAmount += payment.amount;
      hourly[hour].count += 1;
    }

    const tillRows = tillPayments.map((p) => {
      const purpose = (p.purpose || '').toLowerCase();
      let label = 'Till M-Pesa (Buy Goods)';
      if (purpose === 'pos_sale') label = 'M-Pesa STK (POS)';

      return {
        id: `till-${p.id}`,
        source: 'till' as const,
        receiptNo: p.transactionReference || p.reference || p.id,
        totalAmount: p.amount,
        status: 'completed',
        paymentMethod: 'till',
        purpose: p.purpose,
        phone: p.phone || null,
        tillNumber: p.tillNumber || null,
        label,
        createdAt: p.createdAt,
        items: [{ quantity: 1, price: p.amount, menuItem: { name: label } }],
      };
    });

    res.json({
      date: dateStr,
      totalSales: combinedTotal,
      posSales,
      tillInflow,
      transactionCount,
      tillPaymentCount: tillPayments.length,
      itemsSold,
      hourlyBreakdown: hourly,
      tillPayments: tillRows,
    });
  } catch (error) {
    console.error('Sales summary error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/pos/receipts/:id ────────────────────────────────────────────────
router.get('/receipts/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }

  const receiptId = req.params.id as string;

  try {
    const receipt = await prisma.posTransaction.findUnique({
      where: { id: receiptId },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });

    if (!receipt) {
      res.status(404).json({ message: 'Receipt not found' });
      return;
    }

    res.json(await withCashierName(receipt));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/pos/receipts ────────────────────────────────────────────────────
router.get('/receipts', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ message: 'Not authorized' });
    return;
  }

  const dateStr = String(req.query.date || '').trim();
  const bounds = dateStr ? parseDayBounds(dateStr) : null;
  if (dateStr && !bounds) {
    res.status(422).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    return;
  }

  try {
    const receipts = await prisma.posTransaction.findMany({
      where: bounds
        ? { createdAt: { gte: bounds.start, lte: bounds.end } }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: bounds ? 500 : 100,
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });
    res.json(await attachCashierNames(receipts));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
