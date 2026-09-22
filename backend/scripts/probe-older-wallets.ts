import 'dotenv/config';
import prisma from '../services/prisma';
import {
  REGISTRATION_FEE_EFFECTIVE_FROM,
  REGISTRATION_FEE_REF,
  REGISTRATION_FEE_TYPE,
} from '../services/registrationFee';

async function main() {
  const older = await prisma.student.findMany({
    where: { createdAt: { lt: REGISTRATION_FEE_EFFECTIVE_FROM } },
    select: {
      id: true,
      regNo: true,
      walletBalance: true,
      transactions: {
        select: { amount: true, type: true, reference: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  let noTxnZero = 0;
  let onlyPurchases = 0;
  let hasDepositTx = 0;
  let neg = 0;
  let zero = 0;

  for (const s of older) {
    if (s.walletBalance < 0) neg++;
    if (s.walletBalance === 0) zero++;
    if (s.transactions.length === 0 && s.walletBalance === 0) noTxnZero++;
    const deps = s.transactions.filter((t) => Number(t.amount) > 0);
    const onlyBuy =
      s.transactions.length > 0 && s.transactions.every((t) => Number(t.amount) < 0);
    if (onlyBuy) onlyPurchases++;
    if (deps.length) hasDepositTx++;
  }

  const kopo = await prisma.kopoPayment.groupBy({
    by: ['studentId'],
    where: {
      studentId: { not: null },
      walletCredited: true,
    },
    _sum: { amount: true },
    _count: true,
  });

  console.log(
    JSON.stringify(
      {
        older: older.length,
        neg,
        zero,
        noTxnZero,
        onlyPurchases,
        hasDepositTx,
        kopoCreditedStudents: kopo.length,
        sampleKopo: kopo.slice(0, 5),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
