import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUCCESS_STATUSES = new Set(['success', 'received', 'complete', 'completed', 'paid']);

function phoneKey(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function kopoMetadataFromRaw(rawPayload: unknown): Record<string, string> {
  if (!rawPayload || typeof rawPayload !== 'object') return {};
  const data = (rawPayload as any)?.data ?? rawPayload;
  const attrs = (data as any)?.attributes ?? {};
  const meta = attrs?.metadata ?? {};
  const event = attrs?.event ?? (data as any)?.event ?? {};
  const resource = event?.resource ?? {};

  const senderPhone = String(resource.sender_phone_number ?? '').trim();

  return {
    student_reg_no: String(meta.student_reg_no ?? meta.studentRegNo ?? meta.reg_no ?? meta.adm_no ?? ''),
    student_id: String(meta.student_id ?? meta.studentId ?? ''),
    student_name: String(meta.student_name ?? meta.studentName ?? ''),
    payer_phone: String(meta.payer_phone ?? meta.payerPhone ?? senderPhone ?? ''),
  };
}

async function creditStudentWallet(paymentId: string, studentId: string, amount: number, phone: string, reference: string) {
  if (!studentId || amount <= 0) return false;

  const claimed = await prisma.kopoPayment.updateMany({
    where: { id: paymentId, walletCredited: false },
    data: { walletCredited: true },
  });
  if (claimed.count === 0) return false;

  try {
    await prisma.student.update({
      where: { id: studentId },
      data: { walletBalance: { increment: amount } },
    });

    await prisma.walletTransaction.create({
      data: {
        studentId,
        amount,
        type: 'deposit',
        reference,
        description: `KopoKopo top-up from ${phone || 'M-Pesa'}`,
      },
    });
  } catch (err) {
    await prisma.kopoPayment.update({ where: { id: paymentId }, data: { walletCredited: false } }).catch(() => {});
    throw err;
  }

  return true;
}

async function main() {
  console.log('──Linking parent topups to students──');

  const candidates = await prisma.kopoPayment.findMany({
    where: {
      status: { in: Array.from(SUCCESS_STATUSES) },
      amount: { gt: 0 },
      walletCredited: false,
      posCompleted: false,
      purpose: { not: 'pos_sale' },
      studentId: null,
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  console.log(`Found ${candidates.length} unallocated successful till payment(s)`);

  let linked = 0;
  let skipped = 0;
  let credited = 0;

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    if (i % 50 === 0) console.log(`  progress: ${i}/${candidates.length}`);

    const meta = kopoMetadataFromRaw(p.rawPayload);
    const regNo = String(meta.student_reg_no || '').trim().toUpperCase();
    const metaStudentId = String(meta.student_id || '').trim();

    let student:
      | { id: string; regNo: string; name: string; parentId: string | null }
      | null = null;

    if (metaStudentId) {
      student = await prisma.student.findUnique({
        where: { id: metaStudentId },
        select: { id: true, regNo: true, name: true, parentId: true },
      });
    }

    if (!student && regNo) {
      student = await prisma.student.findUnique({
        where: { regNo },
        select: { id: true, regNo: true, name: true, parentId: true },
      });
    }

    if (!student) {
      const payerPhone = meta.payer_phone || p.phone;
      const pk = phoneKey(payerPhone);
      if (!pk) {
        skipped++;
        continue;
      }

      const parent = await prisma.parent.findFirst({
        where: { phone: { endsWith: pk } },
        select: {
          id: true,
          phone: true,
          students: { select: { id: true, regNo: true, name: true, parentId: true } },
        },
      });

      const students = parent?.students || [];
      if (students.length === 1) {
        student = students[0];
      } else if (students.length > 1) {
        const sn = String(meta.student_name || '').trim().toLowerCase();
        if (sn) {
          const matched = students.filter((s) => s.name.toLowerCase().includes(sn));
          if (matched.length === 1) student = matched[0];
        }
      }
    }

    if (!student) {
      skipped++;
      continue;
    }

    await prisma.kopoPayment.update({
      where: { id: p.id },
      data: {
        studentId: student.id,
        purpose: 'wallet_topup',
        allocatedBy: 'system',
        allocatedAt: new Date(),
        description: `Wallet top-up for ${student.name} · ${student.regNo} (auto-linked)`,
      },
    });
    linked++;

    const ok = await creditStudentWallet(
      p.id,
      student.id,
      p.amount,
      p.phone,
      p.transactionReference || p.reference || p.id,
    );
    if (ok) credited++;
  }

  console.log(`Linked payments: ${linked}`);
  console.log(`Wallet credits created: ${credited}`);
  console.log(`Skipped (ambiguous/unmatched): ${skipped}`);

  console.log('\nDone.\n');
}

main()
  .catch((err) => {
    console.error('Linking failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

