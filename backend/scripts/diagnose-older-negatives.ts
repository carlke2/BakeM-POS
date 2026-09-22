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
      name: true,
      regNo: true,
      walletBalance: true,
      createdAt: true,
      transactions: {
        select: { amount: true, type: true, description: true, reference: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { walletBalance: 'asc' },
  });

  const neg = older.filter((s) => s.walletBalance < 0);
  const zero = older.filter((s) => s.walletBalance === 0);
  const pos = older.filter((s) => s.walletBalance > 0);
  const stillHaveFee = older.filter((s) =>
    s.transactions.some(
      (t) => t.reference === REGISTRATION_FEE_REF || t.type === REGISTRATION_FEE_TYPE,
    ),
  );

  const aroundNeg500 = neg.filter(
    (s) => s.walletBalance <= -450 && s.walletBalance >= -550,
  ).length;

  const sample = neg.slice(0, 15).map((s) => {
    const sum = s.transactions.reduce((a, t) => a + Number(t.amount), 0);
    return {
      regNo: s.regNo,
      name: s.name,
      wallet: s.walletBalance,
      ledgerSum: sum,
      txnCount: s.transactions.length,
      types: s.transactions.map((t) => `${t.type}:${t.amount}`),
      hasFee: s.transactions.some(
        (t) => t.reference === REGISTRATION_FEE_REF || t.type === REGISTRATION_FEE_TYPE,
      ),
    };
  });

  console.log(
    JSON.stringify(
      {
        olderTotal: older.length,
        negative: neg.length,
        zero: zero.length,
        positive: pos.length,
        stillHaveFeeTxn: stillHaveFee.length,
        aroundNeg500,
        sampleNeg: sample,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
