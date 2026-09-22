/**
 * Remove duplicate KopoPayment rows that share the same M-Pesa transactionReference.
 * Keeps the oldest row; prefers a wallet-credited / allocated row if present.
 *
 * Usage: npx ts-node -r tsconfig-paths/register scripts/dedupe-kopo-payments.ts
 */
import prisma from '@/services/prisma';

async function main() {
  const payments = await prisma.kopoPayment.findMany({
    where: { transactionReference: { not: '' } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      transactionReference: true,
      walletCredited: true,
      allocatedAt: true,
      studentId: true,
      amount: true,
      createdAt: true,
    },
  });

  const groups = new Map<string, typeof payments>();
  for (const p of payments) {
    const key = p.transactionReference.trim().toUpperCase();
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(p);
    groups.set(key, list);
  }

  let removed = 0;
  for (const [ref, rows] of groups) {
    if (rows.length < 2) continue;

    // Prefer credited/allocated, else oldest
    const keep =
      rows.find((r) => r.walletCredited || r.allocatedAt) ||
      rows.find((r) => r.studentId) ||
      rows[0];

    const dropIds = rows.filter((r) => r.id !== keep.id).map((r) => r.id);
    console.log(
      `Ref ${ref}: keep ${keep.id} (KES ${keep.amount}), delete ${dropIds.length} duplicate(s)`,
    );

    const result = await prisma.kopoPayment.deleteMany({ where: { id: { in: dropIds } } });
    removed += result.count;
  }

  console.log(`Done. Removed ${removed} duplicate payment(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
