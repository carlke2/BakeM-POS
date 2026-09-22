import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetWallets() {
  console.log('Clearing simulated wallet data...\n');

  const kopoDeleted = await prisma.kopoPayment.deleteMany({});
  console.log(`Deleted ${kopoDeleted.count} Kopokopo payment record(s)`);

  // 2. Delete all wallet transactions
  const txDeleted = await prisma.walletTransaction.deleteMany({});
  console.log(`Deleted ${txDeleted.count} wallet transaction(s)`);

  // 3. Reset all student wallet balances to 0
  const studentsReset = await prisma.student.updateMany({
    data: { walletBalance: 0 },
  });
  console.log(`Reset wallet balance to KES 0 for ${studentsReset.count} student(s)`);

  console.log('\nDone! All simulated data has been cleared.');
  await prisma.$disconnect();
}

resetWallets().catch((err) => {
  console.error('Reset failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
