import prisma from '@/services/prisma';

async function main() {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setDate(dayStart.getDate() - 1);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const all = await prisma.kopoPayment.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd }, amount: { gt: 0 } },
    select: {
      id: true,
      status: true,
      amount: true,
      walletCredited: true,
      purpose: true,
      transactionReference: true,
    },
  });

  const byStatus: Record<string, number> = {};
  let sumAll = 0;
  let sumSuccess = 0;
  let sumSuperseded = 0;
  let sumSuccessLike = 0;

  const success = new Set(['success', 'received', 'complete', 'completed', 'paid']);
  const refs = new Map<string, number>();

  for (const r of all) {
    const st = (r.status || '').toLowerCase();
    byStatus[st] = (byStatus[st] || 0) + 1;
    sumAll += r.amount;
    if (success.has(st)) sumSuccess += r.amount;
    if (st === 'superseded') sumSuperseded += r.amount;
    if (success.has(st) || st === 'superseded') sumSuccessLike += r.amount;

    const ref = (r.transactionReference || '').trim().toUpperCase();
    if (ref) refs.set(ref, (refs.get(ref) || 0) + 1);
  }

  let uniqueTill = 0;
  const seen = new Set<string>();
  for (const r of all) {
    const st = (r.status || '').toLowerCase();
    if (!success.has(st) && st !== 'superseded') continue;
    const ref = (r.transactionReference || '').trim().toUpperCase() || r.id;
    if (seen.has(ref)) continue;
    seen.add(ref);
    uniqueTill += r.amount;
  }

  const multi = [...refs.entries()].filter(([, n]) => n > 1).length;

  console.log(
    JSON.stringify(
      {
        dayStart,
        dayEnd,
        count: all.length,
        byStatus,
        sumAll,
        sumSuccess,
        sumSuperseded,
        sumSuccessLike,
        uniqueTill,
        multiRefGroups: multi,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
