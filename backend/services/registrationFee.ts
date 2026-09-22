import prisma from '@/services/prisma';
import type { Prisma } from '@prisma/client';

export const REGISTRATION_FEE_KES = 500;
export const REGISTRATION_FEE_REF = 'SYSTEM_REGISTRATION';
export const REGISTRATION_FEE_TYPE = 'registration_fee';
export const REGISTRATION_FEE_DESCRIPTION = 'System registration fee';
export const PRE_FEE_OPENING_RESTORE_REF = 'PRE_FEE_OPENING_RESTORE';

/**
 * Registration fee applies only to students onboarded on/after this local date
 * (Africa/Nairobi). Older students must not be charged.
 */
export const REGISTRATION_FEE_EFFECTIVE_FROM = new Date('2026-09-08T00:00:00+03:00');

type DbClient = Prisma.TransactionClient | typeof prisma;

export function isRegistrationFeeEligible(createdAt?: string | Date | null): boolean {
  if (!createdAt) return false;
  return new Date(createdAt).getTime() >= REGISTRATION_FEE_EFFECTIVE_FROM.getTime();
}

async function findExistingFee(studentId: string, db: DbClient) {
  return db.walletTransaction.findFirst({
    where: {
      studentId,
      OR: [
        { reference: REGISTRATION_FEE_REF },
        { type: REGISTRATION_FEE_TYPE },
      ],
    },
  });
}

/**
 * Idempotently deduct the system registration fee for eligible (new) students only.
 */
export async function ensureSystemRegistrationFee(studentId: string) {
  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, regNo: true, walletBalance: true, createdAt: true },
    });
    if (!student) {
      return { applied: false as const, skipped: 'not_found' as const };
    }
    if (!isRegistrationFeeEligible(student.createdAt)) {
      return { applied: false as const, skipped: 'not_eligible' as const };
    }

    const existing = await findExistingFee(studentId, tx);
    if (existing) {
      return { applied: false as const, transaction: existing, skipped: 'already_applied' as const };
    }

    const updated = await tx.student.update({
      where: { id: studentId },
      data: { walletBalance: { decrement: REGISTRATION_FEE_KES } },
      select: { id: true, name: true, regNo: true, walletBalance: true },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        studentId,
        amount: -REGISTRATION_FEE_KES,
        type: REGISTRATION_FEE_TYPE,
        reference: REGISTRATION_FEE_REF,
        description: REGISTRATION_FEE_DESCRIPTION,
      },
    });

    return { applied: true as const, student: updated, transaction };
  });
}

/**
 * Remove incorrectly applied registration fees from students onboarded before the cutoff,
 * and credit KES 500 back with a ledger row so history stays consistent.
 */
export async function reverseIneligibleRegistrationFees() {
  const feeRows = await prisma.walletTransaction.findMany({
    where: {
      OR: [
        { reference: REGISTRATION_FEE_REF },
        { type: REGISTRATION_FEE_TYPE },
      ],
      amount: { lt: 0 },
    },
    select: {
      id: true,
      studentId: true,
      amount: true,
      student: { select: { id: true, createdAt: true } },
    },
  });

  let reversed = 0;
  for (const row of feeRows) {
    if (isRegistrationFeeEligible(row.student.createdAt)) continue;
    const credit = Math.abs(Number(row.amount) || REGISTRATION_FEE_KES);

    await prisma.$transaction(async (tx) => {
      await tx.walletTransaction.delete({ where: { id: row.id } });
      await tx.student.update({
        where: { id: row.studentId },
        data: { walletBalance: { increment: credit } },
      });
      await tx.walletTransaction.create({
        data: {
          studentId: row.studentId,
          amount: credit,
          type: 'adjustment',
          reference: 'REGISTRATION_FEE_REVERSAL',
          description: 'Registration fee reversal (student onboarded before fee start date)',
        },
      });
    });
    reversed += 1;
  }

  return { reversed, scanned: feeRows.length };
}

/** Eligible students that still need the system registration fee deducted. */
export async function findStudentsMissingRegistrationFee() {
  const students = await prisma.student.findMany({
    where: { createdAt: { gte: REGISTRATION_FEE_EFFECTIVE_FROM } },
    select: { id: true, name: true, regNo: true, walletBalance: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (students.length === 0) return [];

  const feeRows = await prisma.walletTransaction.findMany({
    where: {
      OR: [
        { reference: REGISTRATION_FEE_REF },
        { type: REGISTRATION_FEE_TYPE },
      ],
      studentId: { in: students.map((s) => s.id) },
    },
    select: { studentId: true },
  });
  const hasFee = new Set(feeRows.map((t) => t.studentId));

  return students.filter((s) => !hasFee.has(s.id));
}

/**
 * Restore older students to pre-registration-fee wallet levels.
 *
 * The fee rollout ran a ledger sync that wiped opening balances that were never
 * stored as deposit rows. We put those openings back as a single adjustment so:
 *   wallet = originalOpening + sum(existing non-restore transactions)
 * which is the balance before the registration-fee work — without re-importing
 * students or overwriting later top-ups/purchases.
 */
export async function restoreOlderStudentsPreRegistrationFee(
  openingByRegNo: Map<string, number>,
) {
  const older = await prisma.student.findMany({
    where: { createdAt: { lt: REGISTRATION_FEE_EFFECTIVE_FROM } },
    select: {
      id: true,
      regNo: true,
      walletBalance: true,
      transactions: {
        select: { id: true, amount: true, reference: true },
      },
    },
  });

  let restored = 0;
  let skipped = 0;
  let missingOpening = 0;
  const errors: string[] = [];

  for (const s of older) {
    try {
      const already = s.transactions.some((t) => t.reference === PRE_FEE_OPENING_RESTORE_REF);
      if (already) {
        skipped += 1;
        continue;
      }

      const opening = openingByRegNo.get(s.regNo.toUpperCase());
      if (opening == null || !(opening > 0)) {
        missingOpening += 1;
        continue;
      }

      // Ledger without a prior restore row (= current activity since onboard).
      const activitySum = s.transactions.reduce((a, t) => a + Number(t.amount || 0), 0);
      const target = opening + activitySum;
      const delta = target - Number(s.walletBalance || 0);
      if (Math.abs(delta) < 0.005) {
        skipped += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: s.id },
          data: { walletBalance: { increment: delta } },
        });
        await tx.walletTransaction.create({
          data: {
            studentId: s.id,
            amount: delta,
            type: 'adjustment',
            reference: PRE_FEE_OPENING_RESTORE_REF,
            description:
              'Opening balance restored (undo registration-fee ledger wipe; pre-fee position)',
          },
        });
      });
      restored += 1;
    } catch (err: any) {
      errors.push(`${s.regNo}: ${err?.message || String(err)}`);
    }
  }

  return {
    older: older.length,
    restored,
    skipped,
    missingOpening,
    errors: errors.slice(0, 20),
  };
}

/**
 * 1) Reverse fees wrongly charged to students before the cutoff
 * 2) Apply missing fees only to eligible (new) students
 * NOTE: Does NOT reconcile wallets to ledger sum (that wiped openings).
 */
export async function backfillMissingRegistrationFees() {
  const reversed = await reverseIneligibleRegistrationFees();
  const missing = await findStudentsMissingRegistrationFee();
  const eligibleTotal = await prisma.student.count({
    where: { createdAt: { gte: REGISTRATION_FEE_EFFECTIVE_FROM } },
  });
  const totalStudents = await prisma.student.count();

  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const s of missing) {
    try {
      const result = await ensureSystemRegistrationFee(s.id);
      if (result.applied) applied += 1;
    } catch (err: any) {
      failed += 1;
      errors.push(`${s.id}: ${err?.message || String(err)}`);
    }
  }

  const stillMissing = await findStudentsMissingRegistrationFee();

  return {
    applied,
    failed,
    reversed: reversed.reversed,
    total: totalStudents,
    eligibleTotal,
    missingBefore: missing.length,
    missingAfter: stillMissing.length,
    skipped: eligibleTotal - applied - stillMissing.length,
    balancesSynced: 0,
    effectiveFrom: REGISTRATION_FEE_EFFECTIVE_FROM.toISOString(),
    errors: errors.slice(0, 20),
  };
}
