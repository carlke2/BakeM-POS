import 'dotenv/config';
import prisma from '../services/prisma';
import {
  REGISTRATION_FEE_KES,
  REGISTRATION_FEE_REF,
  REGISTRATION_FEE_TYPE,
} from '../services/registrationFee';

async function main() {
  const students = await prisma.student.findMany({
    select: { id: true, name: true, regNo: true, walletBalance: true },
  });
  const fees = await prisma.walletTransaction.findMany({
    where: {
      OR: [{ reference: REGISTRATION_FEE_REF }, { type: REGISTRATION_FEE_TYPE }],
    },
    select: { studentId: true, amount: true },
  });
  const feeByStudent = new Map(fees.map((f) => [f.studentId, f]));
  let withFee = 0;
  let withoutFee = 0;
  let oddAmount = 0;
  const noFee: Array<{ regNo: string; name: string; wallet: number }> = [];
  for (const s of students) {
    const f = feeByStudent.get(s.id);
    if (!f) {
      withoutFee += 1;
      noFee.push({ regNo: s.regNo, name: s.name, wallet: s.walletBalance });
    } else {
      withFee += 1;
      if (Number(f.amount) !== -REGISTRATION_FEE_KES) oddAmount += 1;
    }
  }
  console.log(
    JSON.stringify(
      {
        total: students.length,
        withFee,
        withoutFee,
        oddAmount,
        feeTxnCount: fees.length,
        sampleNoFee: noFee.slice(0, 15),
        roundBalances: students.filter((s) => Number(s.walletBalance) % 500 === 0).length,
        sampleBalances: students.slice(0, 10).map((s) => ({
          regNo: s.regNo,
          wallet: s.walletBalance,
          hasFee: feeByStudent.has(s.id),
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
