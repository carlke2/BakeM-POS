import bcrypt from 'bcrypt';
import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import {
  assertFingerprintUnique,
  fingerprintEnrollmentData,
  FingerprintDuplicateError,
  getScannerUrl,
  parseFingerprintMatchScore,
  parseFingerprintTemplate,
} from '@/services/fingerprint';
import { displayReceiptNo, generateReceiptNo } from '@/services/receipt';
import { deductStockForOrder } from '@/services/inventoryDeduction';

const router = Router();

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
    cashierName: nameById.get(r.cashierId) || (r.cashierId === 'kiosk' ? 'Kiosk' : null),
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
  if (message === 'STUDENT_NOT_FOUND') {
    return { status: 404, body: { message: 'Student not found' } };
  }
  if (message === 'INSUFFICIENT_FUNDS' || message === 'INSUFFICIENT_BALANCE') {
    return { status: 402, body: { message: 'Insufficient wallet balance' } };
  }
  if (message === 'INVALID_QUANTITY') {
    return { status: 422, body: { message: 'Each item must have a quantity greater than 0' } };
  }
  if (message === 'WALLET_FROZEN') {
    return { status: 403, body: { message: 'Wallet is frozen. Please contact the parent/admin.' } };
  }
  if (message === 'AUTH_REQUIRED') {
    // 401 triggers global logout in frontend; this is a business-rule failure, not an auth failure
    return { status: 422, body: { message: 'Authorization required (PIN or fingerprint)' } };
  }
  if (message === 'AUTH_NOT_CONFIGURED') {
    return { status: 409, body: { message: 'No PIN or fingerprint is configured for this student' } };
  }
  if (message === 'INVALID_PIN') {
    // 401 triggers global logout in frontend; keep this as a validation error
    return { status: 422, body: { message: 'Invalid wallet PIN' } };
  }
  if (message === 'FINGERPRINT_REQUIRED') {
    return { status: 422, body: { message: 'Fingerprint template is required' } };
  }
  if (message === 'FINGERPRINT_NOT_ENROLLED') {
    return { status: 409, body: { message: 'Student has no fingerprint enrolled' } };
  }
  if (message === 'FINGERPRINT_NO_MATCH') {
    // 401 triggers global logout in frontend; keep this as a validation error
    return { status: 422, body: { message: 'Fingerprint did not match' } };
  }
  if (message.startsWith('DAILY_LIMIT_EXCEEDED')) {
    return { status: 409, body: { message: 'Daily spend limit reached' } };
  }
  if (message.startsWith('WEEKLY_LIMIT_EXCEEDED')) {
    return { status: 409, body: { message: 'Weekly spend limit reached' } };
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
  if (message === 'FINGERPRINT_ALREADY_ENROLLED') {
    return { status: 409, body: { message: 'Fingerprint is already enrolled for this student' } };
  }
  if (message === 'INVALID_FINGERPRINT') {
    return { status: 422, body: { message: 'Invalid fingerprint scan. Please try again.' } };
  }
  if (message.startsWith('FINGERPRINT_DUPLICATE')) {
    const detail = message.split(':').slice(1).join(':');
    return {
      status: 409,
      body: { message: detail || 'This fingerprint is already enrolled for another student' },
    };
  }
  return null;
};

const startOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

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

// Monday 00:00 UTC
const startOfUtcWeek = (date: Date) => {
  const dayStart = startOfUtcDay(date);
  const dow = dayStart.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  return new Date(dayStart.getTime() - diff * 24 * 60 * 60 * 1000);
};

const SCANNER_TIMEOUT_MS = 8_000;

const verifyFingerprint = async (
  candidateTemplate: string,
  storedTemplate: string,
  matchScore?: number,
): Promise<boolean> => {
  if (candidateTemplate === storedTemplate) return true;
  const parsedScore = parseFingerprintMatchScore(matchScore);
  if (parsedScore !== undefined) return true;

  try {
    const res = await fetch(`${getScannerUrl()}/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: candidateTemplate, candidates: [storedTemplate] }),
      signal: AbortSignal.timeout(SCANNER_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    return Boolean(res.ok && data?.ok && data?.isDuplicate === true && data?.matchedIndex === 0);
  } catch {
    return false;
  }
};

const assertSaleAuthorized = async (student: any, auth: any): Promise<void> => {
  const pinEnabled = Boolean(student.walletPinHash);
  const fpEnabled = Boolean(student.fingerprintTemplate);

  if (!pinEnabled && !fpEnabled) throw new Error('AUTH_NOT_CONFIGURED');

  const pin = typeof auth?.pin === 'string' ? auth.pin.trim() : '';
  const fp = typeof auth?.fingerprintTemplate === 'string' ? auth.fingerprintTemplate.trim() : '';

  if (pin) {
    if (!pinEnabled) throw new Error('AUTH_REQUIRED');
    if (!/^\d{4}$/.test(pin)) throw new Error('INVALID_PIN');
    const ok = await bcrypt.compare(pin, student.walletPinHash);
    if (!ok) throw new Error('INVALID_PIN');
    return;
  }

  if (fp) {
    if (!fpEnabled) throw new Error('FINGERPRINT_NOT_ENROLLED');
    const matchScore = typeof auth?.fingerprintMatchScore === 'number'
      ? auth.fingerprintMatchScore
      : parseFingerprintMatchScore(auth?.fingerprintMatchScore);
    const match = await verifyFingerprint(fp, student.fingerprintTemplate, matchScore);
    if (!match) throw new Error('FINGERPRINT_NO_MATCH');
    return;
  }

  throw new Error('AUTH_REQUIRED');
};

const assertPinValid = async (student: { walletPinHash: string | null }, pin: string): Promise<void> => {
  if (!student.walletPinHash) throw new Error('AUTH_REQUIRED');
  if (!/^\d{4}$/.test(pin)) throw new Error('INVALID_PIN');
  const ok = await bcrypt.compare(pin, student.walletPinHash);
  if (!ok) throw new Error('INVALID_PIN');
};

const resolveEnrollmentTemplate = async (
  student: { id: string; fingerprintTemplate: string | null; walletPinHash: string | null },
  auth: { pin?: string; fingerprintTemplate?: string },
): Promise<string> => {
  if (student.fingerprintTemplate) throw new Error('FINGERPRINT_ALREADY_ENROLLED');

  const rawFp = typeof auth?.fingerprintTemplate === 'string' ? auth.fingerprintTemplate.trim() : '';
  if (!rawFp) throw new Error('FINGERPRINT_REQUIRED');

  let parsed: string | null;
  try {
    parsed = parseFingerprintTemplate(rawFp) ?? null;
  } catch {
    throw new Error('INVALID_FINGERPRINT');
  }
  if (!parsed) throw new Error('FINGERPRINT_REQUIRED');

  if (student.walletPinHash) {
    const pin = typeof auth?.pin === 'string' ? auth.pin.trim() : '';
    await assertPinValid(student, pin);
  }

  try {
    await assertFingerprintUnique(parsed, student.id);
  } catch (err) {
    if (err instanceof FingerprintDuplicateError) {
      throw new Error(`FINGERPRINT_DUPLICATE:${err.message}`);
    }
    throw err;
  }

  return parsed;
};

type CartLine = { menuItemId: string; quantity: number };

export type { CartLine };

type SelfServiceAuth = { pin?: string; fingerprintTemplate?: string };

const POS_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

async function executeSelfServiceOrder(
  student: {
    id: string;
    name: string;
    regNo: string;
    walletBalance: number;
    walletFrozen: boolean;
    dailySpendLimit: number | null;
    weeklySpendLimit: number | null;
    walletPinHash: string | null;
    fingerprintTemplate: string | null;
  },
  items: CartLine[],
  auth: SelfServiceAuth,
  cashierId: string,
  options?: { enrollFingerprint?: boolean },
) {
  if (student.walletFrozen) throw new Error('WALLET_FROZEN');

  let enrollmentTemplate: string | null = null;
  if (options?.enrollFingerprint) {
    enrollmentTemplate = await resolveEnrollmentTemplate(student, auth);
  } else {
    await assertSaleAuthorized(student, auth);
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

    if (student.walletBalance < totalAmount) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const weekStart = startOfUtcWeek(now);

    if (student.dailySpendLimit != null) {
      const daily = await tx.posTransaction.aggregate({
        where: { studentId: student.id, status: 'completed', createdAt: { gte: dayStart } },
        _sum: { totalAmount: true },
      });
      const spentToday = Number(daily._sum.totalAmount || 0);
      if (spentToday + totalAmount > Number(student.dailySpendLimit)) throw new Error('DAILY_LIMIT_EXCEEDED');
    }
    if (student.weeklySpendLimit != null) {
      const weekly = await tx.posTransaction.aggregate({
        where: { studentId: student.id, status: 'completed', createdAt: { gte: weekStart } },
        _sum: { totalAmount: true },
      });
      const spentWeek = Number(weekly._sum.totalAmount || 0);
      if (spentWeek + totalAmount > Number(student.weeklySpendLimit)) throw new Error('WEEKLY_LIMIT_EXCEEDED');
    }

    if (enrollmentTemplate) {
      await tx.student.update({
        where: { id: student.id },
        data: fingerprintEnrollmentData(enrollmentTemplate),
      });
    }

    const receiptNo = await generateReceiptNo(async (no) =>
      Boolean(
        await tx.posTransaction.findFirst({ where: { receiptNo: no }, select: { id: true } }),
      ),
    );

    await deductStockForOrder(tx, orderLines, { userId: cashierId, receiptNo });

    const posTx = await tx.posTransaction.create({
      data: {
        studentId: student.id,
        cashierId,
        totalAmount,
        receiptNo,
        items: { create: orderLines },
      },
      include: { items: { include: { menuItem: { select: { name: true } } } } },
    });

    const updatedStudent = await tx.student.update({
      where: { id: student.id },
      data: { walletBalance: { decrement: totalAmount } },
      select: { id: true, name: true, regNo: true, walletBalance: true },
    });

    await tx.walletTransaction.create({
      data: {
        studentId: student.id,
        amount: -totalAmount,
        type: 'purchase',
        reference: posTx.id,
        description: `Cafeteria order (${displayReceiptNo(posTx)})`,
      },
    });

    return { student: updatedStudent, posTx, totalAmount, fingerprintEnrolled: Boolean(enrollmentTemplate) };
  }, POS_TX_OPTIONS);
}

/** Guest walk-in sale (cash or M-Pesa) — no student wallet. */
export async function executeGuestSale(
  cashierId: string,
  items: CartLine[],
  paymentMethod: 'cash' | 'mpesa',
) {
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

/** @deprecated use executeGuestSale */
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
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Only restaurant staff can process sales' });
    return;
  }

  const { studentRegNo, items, auth } = req.body;

  if (!studentRegNo || !Array.isArray(items) || items.length === 0) {
    res.status(422).json({ message: 'Student registration number and items array are required' });
    return;
  }

  const cashierId = req.user!.id;

  try {
    const student = await prisma.student.findUnique({ where: { regNo: studentRegNo } });
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }

    const result = await executeSelfServiceOrder(student, items, auth, cashierId);

    await logAuditEvent({
      eventType: 'pos_sale',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Cafeteria Sale',
      description: `Processed sale of KES ${result.totalAmount} for ${result.student.name}`,
      metadata: { receiptId: result.posTx.id, studentRegNo },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Sale completed successfully',
      receipt: await withCashierName(result.posTx, req.user!.name),
      newBalance: result.student.walletBalance,
    });
  } catch (error: unknown) {
    respondSaleError(res, error, 'POS Sale Error');
  }
});

// ─── POST /api/pos/cash-sale ──────────────────────────────────────────────────
router.post('/cash-sale', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Only restaurant staff can process sales' });
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

const kioskStudentSelect = {
  name: true,
  regNo: true,
  phone: true,
  walletBalance: true,
  walletFrozen: true,
  walletPinSetAt: true,
  fingerprintTemplate: true,
} as const;

type KioskStudentRow = {
  name: string;
  regNo: string;
  phone?: string | null;
  walletBalance: number;
  walletFrozen?: boolean;
  walletPinSetAt?: Date | null;
  fingerprintTemplate?: string | null;
};

const toKioskStudent = (student: KioskStudentRow) => ({
  name: student.name,
  regNo: student.regNo,
  walletBalance: student.walletBalance,
  walletFrozen: Boolean(student.walletFrozen),
  pinEnabled: Boolean(student.walletPinSetAt),
  hasFingerprint: Boolean(student.fingerprintTemplate),
});

const rankKioskStudentSearch = <T extends { name: string; regNo: string; phone?: string | null }>(
  students: T[],
  query: string,
): T[] => {
  const lower = query.toLowerCase();
  return students
    .map((student) => {
      const reg = student.regNo.toLowerCase();
      const name = student.name.toLowerCase();
      const phone = (student.phone || '').toLowerCase();
      let score = 0;
      if (reg === lower) score = 100;
      else if (reg.startsWith(lower)) score = 80;
      else if (name.startsWith(lower)) score = 70;
      else if (phone.startsWith(lower)) score = 65;
      else if (reg.includes(lower)) score = 50;
      else if (name.includes(lower)) score = 40;
      else if (phone.includes(lower)) score = 30;
      return { student, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.student.name.localeCompare(b.student.name))
    .map(({ student }) => student);
};

// ─── GET /api/pos/kiosk/search ────────────────────────────────────────────────
// Public: typeahead search for cafeteria kiosk (name, reg no, or phone)
router.get('/kiosk/search', async (req: Request, res: Response): Promise<void> => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) {
    res.json([]);
    return;
  }

  try {
    const students = await prisma.student.findMany({
      where: {
        OR: [
          { regNo: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: kioskStudentSelect,
      take: 25,
    });

    const ranked = rankKioskStudentSearch(students, query).slice(0, 8);
    res.json(ranked.map(toKioskStudent));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/pos/kiosk/lookup/:query ─────────────────────────────────────────
router.get('/kiosk/lookup/:query', async (req: Request, res: Response): Promise<void> => {
  const query = decodeURIComponent(req.params.query as string).trim();
  if (!query) {
    res.status(422).json({ message: 'Search term is required' });
    return;
  }

  try {
    const student = await prisma.student.findFirst({
      where: { regNo: { equals: query, mode: 'insensitive' } },
      select: kioskStudentSelect,
    });
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }
    res.json(toKioskStudent(student));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/pos/kiosk/student-fingerprint/:regNo ───────────────────────────
// Public kiosk: enrolled template for local ZKTeco verify on this PC
router.get('/kiosk/student-fingerprint/:regNo', async (req: Request, res: Response): Promise<void> => {
  const regNo = decodeURIComponent(req.params.regNo as string).trim();
  if (!regNo) {
    res.status(422).json({ message: 'Registration number is required' });
    return;
  }

  try {
    const student = await prisma.student.findFirst({
      where: { regNo: { equals: regNo, mode: 'insensitive' } },
      select: { fingerprintTemplate: true },
    });
    if (!student?.fingerprintTemplate) {
      res.status(404).json({ message: 'Student has no fingerprint enrolled' });
      return;
    }
    res.json({ fingerprintTemplate: student.fingerprintTemplate });
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/pos/kiosk/preview ─────────────────────────────────────────────
// Public: minimal student info for cafeteria kiosk checkout (no auth token)
router.post('/kiosk/preview', async (req: Request, res: Response): Promise<void> => {
  const regNo = String(req.body.regNo || '').trim();
  if (!regNo) {
    res.status(422).json({ message: 'Registration number is required' });
    return;
  }

  try {
    const student = await prisma.student.findFirst({
      where: { regNo: { equals: regNo, mode: 'insensitive' } },
      select: kioskStudentSelect,
    });
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }

    res.json(toKioskStudent(student));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/pos/kiosk-order ────────────────────────────────────────────────
router.post('/kiosk-order', async (req: Request, res: Response): Promise<void> => {
  const { regNo, items, auth, enrollFingerprint } = req.body as {
    regNo?: string;
    items?: CartLine[];
    auth?: SelfServiceAuth;
    enrollFingerprint?: boolean;
  };

  if (!regNo?.trim() || !Array.isArray(items) || items.length === 0) {
    res.status(422).json({ message: 'Registration number and cart items are required' });
    return;
  }

  try {
    const student = await prisma.student.findFirst({
      where: { regNo: { equals: regNo.trim(), mode: 'insensitive' } },
    });
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }

    const result = await executeSelfServiceOrder(student, items, auth || {}, 'kiosk', {
      enrollFingerprint: Boolean(enrollFingerprint),
    });

    if (result.fingerprintEnrolled) {
      await logAuditEvent({
        eventType: 'fingerprint_enrolled',
        userType: 'student',
        userId: student.id,
        userName: student.name,
        action: 'Kiosk Fingerprint Enrollment',
        description: `Enrolled fingerprint during kiosk checkout for ${student.regNo}`,
        metadata: { regNo: student.regNo },
        ipAddress: req.ip,
      });
    }

    await logAuditEvent({
      eventType: 'kiosk_order',
      userType: 'student',
      userId: student.id,
      userName: student.name,
      action: 'Kiosk Meal Order',
      description: `Kiosk order of KES ${result.totalAmount}`,
      metadata: { receiptId: result.posTx.id, regNo: student.regNo },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Order placed successfully',
      receipt: await withCashierName(result.posTx, 'Kiosk'),
      newBalance: result.student.walletBalance,
      fingerprintEnrolled: result.fingerprintEnrolled,
    });
  } catch (error: unknown) {
    respondSaleError(res, error, 'Kiosk order error');
  }
});

// ─── POST /api/pos/kiosk-cash-order ───────────────────────────────────────────
router.post('/kiosk-cash-order', async (req: Request, res: Response): Promise<void> => {
  const { items } = req.body as { items?: CartLine[] };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(422).json({ message: 'Cart items are required' });
    return;
  }

  try {
    const result = await executeGuestSale('kiosk', items, 'cash');

    await logAuditEvent({
      eventType: 'kiosk_cash_order',
      userType: 'guest',
      userId: 'kiosk',
      userName: 'Kiosk Guest',
      action: 'Kiosk Cash Order',
      description: `Kiosk cash sale of KES ${result.totalAmount}`,
      metadata: { receiptId: result.posTx.id },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Cash order completed',
      receipt: await withCashierName(result.posTx, 'Kiosk'),
      totalAmount: result.totalAmount,
    });
  } catch (error: unknown) {
    respondSaleError(res, error, 'Kiosk cash order error');
  }
});

// ─── POST /api/pos/student-order ──────────────────────────────────────────────
router.post('/student-order', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== 'student') {
    res.status(403).json({ message: 'Student access only' });
    return;
  }

  const { items, auth, enrollFingerprint } = req.body as {
    items?: CartLine[];
    auth?: SelfServiceAuth;
    enrollFingerprint?: boolean;
  };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(422).json({ message: 'Cart items are required' });
    return;
  }

  try {
    const student = await prisma.student.findUnique({ where: { id: req.user!.id } });
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }

    const result = await executeSelfServiceOrder(student, items, auth || {}, 'self-service', {
      enrollFingerprint: Boolean(enrollFingerprint),
    });

    if (result.fingerprintEnrolled) {
      await logAuditEvent({
        eventType: 'fingerprint_enrolled',
        userType: 'student',
        userId: req.user!.id,
        userName: req.user!.name,
        action: 'Student Fingerprint Enrollment',
        description: `Enrolled fingerprint during self-service order`,
        metadata: { regNo: student.regNo },
        ipAddress: req.ip,
      });
    }

    await logAuditEvent({
      eventType: 'student_order',
      userType: 'student',
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Student Meal Order',
      description: `Ordered meals worth KES ${result.totalAmount}`,
      metadata: { receiptId: result.posTx.id },
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Order placed successfully',
      receipt: await withCashierName(result.posTx, req.user!.name),
      newBalance: result.student.walletBalance,
      fingerprintEnrolled: result.fingerprintEnrolled,
    });
  } catch (error: unknown) {
    respondSaleError(res, error, 'Student order error');
  }
});

// ─── GET /api/pos/sales/summary ───────────────────────────────────────────────
router.get('/sales/summary', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
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
          walletCredited: true,
          studentId: true,
          createdAt: true,
        },
      }),
    ]);

    // One row per M-Pesa code for money that actually hit the till
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
      if (prev.walletCredited) prevScore += 100;
      if (prev.posCompleted) prevScore += 80;
      if (prev.studentId) prevScore += 20;
      if (KOPO_SUCCESS.has((prev.status || '').toLowerCase())) prevScore += 10;
      if (p.walletCredited) nextScore += 100;
      if (p.posCompleted) nextScore += 80;
      if (p.studentId) nextScore += 20;
      if (KOPO_SUCCESS.has((p.status || '').toLowerCase())) nextScore += 10;
      if (nextScore > prevScore || (nextScore === prevScore && p.createdAt < prev.createdAt)) {
        bestByRef.set(key, p);
      }
    }
    const tillPayments = [...bestByRef.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const studentIds = [...new Set(tillPayments.map((p) => p.studentId).filter(Boolean))] as string[];
    const students = studentIds.length
      ? await prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, name: true, regNo: true },
        })
      : [];
    const studentById = new Map(students.map((s) => [s.id, s]));

    const tillInflow = tillPayments.reduce((sum, p) => sum + p.amount, 0);
    // POS M-Pesa is already counted in till webhook/callback rows — avoid double-counting
    const posNonMpesa = receipts
      .filter((r) => (r.paymentMethod || 'wallet').toLowerCase() !== 'mpesa')
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
      // Only non-M-Pesa POS in hourly combined (M-Pesa comes from till rows)
      if ((receipt.paymentMethod || 'wallet').toLowerCase() !== 'mpesa') {
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
      const student = p.studentId ? studentById.get(p.studentId) : null;
      const purpose = (p.purpose || '').toLowerCase();
      let label = 'Till M-Pesa (Buy Goods)';
      if (purpose === 'pos_sale') label = 'M-Pesa STK (POS)';
      else if (purpose === 'wallet_topup') label = p.walletCredited ? 'Till → Wallet Top-up' : 'Till M-Pesa (Wallet pending)';
      else if (p.eventType === 'buygoods_transaction_received') label = 'Till M-Pesa (Buy Goods)';

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
        student: student ? { name: student.name, regNo: student.regNo } : null,
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

// ─── GET /api/pos/receipts/me ─────────────────────────────────────────────────
router.get('/receipts/me', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== 'student') {
    res.status(403).json({ message: 'Student access only' });
    return;
  }

  try {
    const receipts = await prisma.posTransaction.findMany({
      where: { studentId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });
    res.json(await attachCashierNames(receipts));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/pos/receipts/:id ────────────────────────────────────────────────
router.get('/receipts/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const receiptId = req.params.id as string;

  try {
    const receipt = await prisma.posTransaction.findUnique({
      where: { id: receiptId },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        student: { select: { id: true, name: true, regNo: true } },
      },
    });

    if (!receipt) {
      res.status(404).json({ message: 'Receipt not found' });
      return;
    }

    if (req.user!.role === 'student' && receipt.studentId !== req.user!.id) {
      res.status(403).json({ message: 'Not authorized to view this receipt' });
      return;
    }

    if (!['admin', 'restaurant', 'finance', 'student'].includes(req.user!.role)) {
      res.status(403).json({ message: 'Not authorized' });
      return;
    }

    res.json(await withCashierName(receipt));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/pos/receipts ────────────────────────────────────────────────────
router.get('/receipts', ensureAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
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
        student: { select: { name: true, regNo: true } },
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });
    res.json(await attachCashierNames(receipts));
  } catch {
    res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
