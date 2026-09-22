import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REG_NO = process.argv[2] || 'ADM00068';
const AMOUNT = Number(process.argv[3] || 0);
const DESCRIPTION = process.argv[4] || 'Manual wallet credit';

async function main() {
  const regCandidates = [REG_NO.toUpperCase()];
  if (/^ADM\d{1,4}$/i.test(REG_NO)) {
    const digits = REG_NO.replace(/\D/g, '').padStart(5, '0');
    regCandidates.push(`ADM${digits}`);
  }

  const student = await prisma.student.findFirst({
    where: { regNo: { in: regCandidates } },
    select: { id: true, name: true, regNo: true, walletBalance: true },
  });

  if (!student) {
    console.error(`Student not found for reg no: ${REG_NO}`);
    process.exit(1);
  }

  if (!AMOUNT || AMOUNT <= 0) {
    console.log(JSON.stringify({ student, message: 'Lookup only — pass amount as 2nd arg to credit' }, null, 2));
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.student.update({
      where: { id: student.id },
      data: { walletBalance: { increment: AMOUNT } },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        studentId: student.id,
        amount: AMOUNT,
        type: 'deposit',
        reference: `manual-${Date.now()}`,
        description: DESCRIPTION,
      },
    });

    return { updated, transaction };
  });

  console.log(
    JSON.stringify(
      {
        student: { name: student.name, regNo: student.regNo },
        credited: AMOUNT,
        previousBalance: student.walletBalance,
        newBalance: result.updated.walletBalance,
        transactionId: result.transaction.id,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
