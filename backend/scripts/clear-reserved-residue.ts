import prisma from '../services/prisma';

const EPSILON = 0.0001;

async function main() {
  const rows = await prisma.inventoryItem.findMany({
    select: { id: true, name: true, reservedQuantity: true },
    orderBy: { name: 'asc' },
  });
  const dirty = rows.filter(
    (row) => row.reservedQuantity !== 0 && Math.abs(row.reservedQuantity) < EPSILON,
  );

  console.log(`Scanned ${rows.length} inventory items.`);
  if (dirty.length === 0) {
    console.log('No near-zero reservedQuantity values found.');
    return;
  }

  for (const row of dirty) {
    console.log(`${row.name}: ${row.reservedQuantity} -> 0`);
  }

  const result = await prisma.inventoryItem.updateMany({
    where: { id: { in: dirty.map((row) => row.id) } },
    data: { reservedQuantity: 0 },
  });
  console.log(`Cleared ${result.count} row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
