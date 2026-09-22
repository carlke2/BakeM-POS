import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { defaultWalletPinData } from '../services/walletPin';

const prisma = new PrismaClient();

async function setDefaultWalletPins() {
  const pinData = await defaultWalletPinData();

  const result = await prisma.student.updateMany({
    where: { walletPinHash: null },
    data: pinData,
  });

  console.log(`Set default wallet PIN (1234) for ${result.count} student(s) without a PIN.`);
  await prisma.$disconnect();
}

setDefaultWalletPins().catch((err) => {
  console.error('Failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
