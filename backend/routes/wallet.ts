import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAuthenticated, ensureFinanceOrAdmin } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';

const router = Router();

type WalletDirection = 'credit' | 'debit';

async function applyWalletAdjustment(opts: {
  studentId: string;
  amount: number;
  direction: WalletDirection;
  reference?: string;
  description?: string;
}) {
  const { studentId, amount, direction, reference, description } = opts;
  const signedAmount = direction === 'credit' ? amount : -amount;
  const txType = direction === 'credit' ? 'deposit' : 'adjustment';
  const defaultDescription =
    direction === 'credit' ? 'Wallet top-up' : 'Wallet adjustment (debit)';

  return prisma.$transaction(async (tx) => {
    const existing = await tx.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, regNo: true, walletBalance: true },
    });
    if (!existing) return { error: 'not_found' as const };

    if (direction === 'debit' && existing.walletBalance < amount) {
      return { error: 'insufficient_balance' as const, student: existing };
    }

    const student = await tx.student.update({
      where: { id: studentId },
      data: { walletBalance: { increment: signedAmount } },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        studentId,
        amount: signedAmount,
        type: txType,
        reference,
        description: description || defaultDescription,
      },
    });

    return { student, transaction, previousBalance: existing.walletBalance };
  });
}

// ─── GET /api/wallet/balance ──────────────────────────────────────────────────
router.get('/balance', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.user!.id },
      select: { walletBalance: true },
    });

    if (!student) return res.status(404).json({ message: 'Student not found' });

    return res.json({ balance: student.walletBalance });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/wallet/history ──────────────────────────────────────────────────
router.get('/history', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  try {
    const transactions = await prisma.walletTransaction.findMany({
      where: { studentId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json(transactions);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/wallet/history/:studentId ───────────────────────────────────────
router.get('/history/:studentId', ensureFinanceOrAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId as string },
      select: { id: true, name: true, regNo: true, walletBalance: true },
    });
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const transactions = await prisma.walletTransaction.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json({ student, transactions });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/wallet/adjust ──────────────────────────────────────────────────
router.post('/adjust', ensureFinanceOrAdmin, async (req: Request, res: Response): Promise<any> => {
  const { studentId, amount, direction, reference, description } = req.body;
  const adjustAmount = Number(amount);
  const adjustDirection: WalletDirection = direction === 'debit' ? 'debit' : 'credit';

  if (!studentId || isNaN(adjustAmount) || adjustAmount <= 0) {
    return res.status(422).json({ message: 'Valid student ID and positive amount are required' });
  }

  try {
    const result = await applyWalletAdjustment({
      studentId,
      amount: adjustAmount,
      direction: adjustDirection,
      reference,
      description,
    });

    if ('error' in result) {
      if (result.error === 'not_found') {
        return res.status(404).json({ message: 'Student not found' });
      }
      return res.status(422).json({
        message: `Insufficient balance. Current balance is KES ${result.student.walletBalance}`,
      });
    }

    const { student, transaction, previousBalance } = result;
    const verb = adjustDirection === 'credit' ? 'Credited' : 'Debited';

    await logAuditEvent({
      eventType: adjustDirection === 'credit' ? 'wallet_deposit' : 'wallet_debit',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: adjustDirection === 'credit' ? 'Wallet Deposit' : 'Wallet Debit',
      description: `${verb} KES ${adjustAmount} ${adjustDirection === 'credit' ? 'to' : 'from'} student ${student.regNo}`,
      metadata: {
        studentId,
        amount: adjustAmount,
        direction: adjustDirection,
        previousBalance,
        transactionId: transaction.id,
      },
      ipAddress: req.ip,
    });

    return res.json({
      message: `${verb} successfully`,
      previousBalance,
      newBalance: student.walletBalance,
      transaction,
    });
  } catch (error) {
    console.error('Wallet adjust error:', error);
    return res.status(500).json({ message: 'Wallet update failed' });
  }
});

// ─── POST /api/wallet/deposit ─────────────────────────────────────────────────
router.post('/deposit', ensureFinanceOrAdmin, async (req: Request, res: Response): Promise<any> => {
  const { studentId, amount, reference, description } = req.body;
  const depositAmount = Number(amount);

  if (!studentId || isNaN(depositAmount) || depositAmount <= 0) {
    return res.status(422).json({ message: 'Valid student ID and positive amount are required' });
  }

  try {
    const result = await applyWalletAdjustment({
      studentId,
      amount: depositAmount,
      direction: 'credit',
      reference,
      description: description || 'Wallet Top-up',
    });

    if ('error' in result) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const { student, transaction } = result;

    await logAuditEvent({
      eventType: 'wallet_deposit',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Wallet Deposit',
      description: `Deposited KES ${depositAmount} to student ${student.regNo}`,
      metadata: { studentId, amount: depositAmount, transactionId: transaction.id },
      ipAddress: req.ip,
    });

    return res.json({
      message: 'Deposit successful',
      newBalance: student.walletBalance,
      transaction,
    });
  } catch (error) {
    console.error('Deposit error:', error);
    return res.status(500).json({ message: 'Deposit failed' });
  }
});

export default router;
