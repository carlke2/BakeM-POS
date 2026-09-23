import { Prisma } from '@prisma/client';

type OrderLine = { menuItemId: string; quantity: number; price?: number };

export async function recordProduction(
  tx: Prisma.TransactionClient,
  menuItemId: string,
  batchCount: number,
  userId: string,
  notes?: string,
) {
  const menuItem = await tx.menuItem.findUnique({
    where: { id: menuItemId },
    include: {
      ingredients: { include: { inventoryItem: true } },
    },
  });

  if (!menuItem) throw new Error('MENU_ITEM_NOT_FOUND');
  if (!menuItem.batchYield || menuItem.batchYield <= 0) throw new Error('BATCH_YIELD_REQUIRED');
  if (menuItem.ingredients.length === 0) throw new Error('RECIPE_REQUIRED');

  const count = Math.max(1, Math.floor(Number(batchCount) || 1));
  const inventoryIds = menuItem.ingredients.map((ing) => ing.inventoryItemId).sort();
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM inventory_items
    WHERE id IN (${Prisma.join(inventoryIds)})
    FOR UPDATE
  `);
  const locked = await tx.inventoryItem.findMany({
    where: { id: { in: inventoryIds } },
    select: { id: true, name: true, stockLevel: true, reservedQuantity: true },
  });
  const lockedById = new Map(locked.map((item) => [item.id, item]));

  for (const ing of menuItem.ingredients) {
    const needed = ing.quantity * count;
    const current = lockedById.get(ing.inventoryItemId);
    const available = (current?.stockLevel ?? 0) - (current?.reservedQuantity ?? 0);
    if (available + 1e-8 < needed) {
      throw new Error(`INSUFFICIENT_INGREDIENT:${current?.name || ing.inventoryItem.name}`);
    }
  }

  const yieldTotal = menuItem.batchYield * count;
  const expectedRevenue = yieldTotal * menuItem.price;

  for (const ing of menuItem.ingredients) {
    const qty = ing.quantity * count;
    await tx.stockMovement.create({
      data: {
        inventoryItemId: ing.inventoryItemId,
        type: 'OUT',
        quantity: qty,
        reason: 'production',
        notes: `Batch production: ${menuItem.name}${count > 1 ? ` (×${count})` : ''}`,
        userId,
      },
    });
    await tx.inventoryItem.update({
      where: { id: ing.inventoryItemId },
      data: { stockLevel: { decrement: qty } },
    });
  }

  const batch = await tx.productionBatch.create({
    data: {
      menuItemId,
      yieldQuantity: yieldTotal,
      unitPrice: menuItem.price,
      expectedRevenue,
      userId,
      notes: notes?.trim() || null,
    },
  });

  if (menuItem.stockLevel === null) {
    await tx.menuItem.update({
      where: { id: menuItemId },
      data: { stockLevel: yieldTotal, isAvailable: true },
    });
  } else {
    await tx.menuItem.update({
      where: { id: menuItemId },
      data: { stockLevel: { increment: yieldTotal }, isAvailable: true },
    });
  }

  return { batch, menuItem, yieldTotal, expectedRevenue, batchCount: count };
}

export async function allocateSalesToBatches(
  tx: Prisma.TransactionClient,
  orderLines: OrderLine[],
): Promise<void> {
  for (const line of orderLines) {
    const menuItem = await tx.menuItem.findUnique({
      where: { id: line.menuItemId },
      select: { batchYield: true, price: true },
    });
    if (!menuItem?.batchYield) continue;

    let remaining = line.quantity;
    const unitPrice = line.price ?? menuItem.price;

    while (remaining > 0) {
      const batch = await tx.productionBatch.findFirst({
        where: {
          menuItemId: line.menuItemId,
          status: 'active',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!batch) break;

      const batchRemaining = batch.yieldQuantity - batch.soldQuantity;
      if (batchRemaining <= 0) {
        await tx.productionBatch.update({
          where: { id: batch.id },
          data: { status: 'depleted' },
        });
        continue;
      }

      const alloc = Math.min(remaining, batchRemaining);
      const newSoldQty = batch.soldQuantity + alloc;
      const newSoldAmount = batch.soldAmount + alloc * unitPrice;
      const depleted = newSoldQty >= batch.yieldQuantity;

      await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          soldQuantity: newSoldQty,
          soldAmount: newSoldAmount,
          status: depleted ? 'depleted' : 'active',
        },
      });

      remaining -= alloc;
    }
  }
}
