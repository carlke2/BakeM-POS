import { Prisma } from '@prisma/client';
import { snapQty } from '@/services/stockReservation';
import { allocateSalesToBatches } from '@/services/production';

type OrderLine = { menuItemId: string; quantity: number; price?: number };

type DeductOptions = {
  userId: string;
  receiptNo: string;
  /** When set, this reservation's holds are still available to the sale that is committing them. */
  reservationId?: string;
};

function aggregateQuantities(lines: OrderLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.menuItemId, (totals.get(line.menuItemId) || 0) + line.quantity);
  }
  return totals;
}

export async function deductStockForOrder(
  tx: Prisma.TransactionClient,
  orderLines: OrderLine[],
  opts: DeductOptions,
): Promise<void> {
  if (orderLines.length === 0) return;

  const menuQtyById = aggregateQuantities(orderLines);
  const menuItemIds = [...menuQtyById.keys()];

  const menuItems = await tx.menuItem.findMany({
    where: { id: { in: menuItemIds } },
    select: { id: true, name: true, stockLevel: true, batchYield: true },
  });
  const menuById = new Map(menuItems.map((m) => [m.id, m]));

  const batchIds = menuItems.filter((item) => item.batchYield).map((item) => item.id);
  const reservedPortions = new Map<string, number>();
  if (batchIds.length > 0) {
    const rows = await tx.stockReservationItem.groupBy({
      by: ['menuItemId'],
      where: {
        menuItemId: { in: batchIds },
        reservation: {
          status: 'active',
          ...(opts.reservationId ? { NOT: { id: opts.reservationId } } : {}),
        },
      },
      _sum: { quantity: true },
    });
    for (const row of rows) reservedPortions.set(row.menuItemId, row._sum.quantity ?? 0);
  }

  const unavailableMenuIds: string[] = [];
  for (const [menuItemId, qty] of menuQtyById) {
    const menuItem = menuById.get(menuItemId);
    if (!menuItem) continue;

    const trackedStock = menuItem.batchYield ? (menuItem.stockLevel ?? 0) : menuItem.stockLevel;
    if (trackedStock === null) continue;

    const free = menuItem.batchYield ? trackedStock - (reservedPortions.get(menuItemId) || 0) : trackedStock;
    if (free < qty) {
      throw new Error(
        menuItem.batchYield
          ? `INSUFFICIENT_STOCK:${menuItem.name} — cook a batch first`
          : `INSUFFICIENT_STOCK:${menuItem.name}`,
      );
    }
    if (free - qty <= 0) {
      unavailableMenuIds.push(menuItemId);
    }
  }

  await Promise.all(
    [...menuQtyById.entries()]
      .filter(([menuItemId]) => {
        const menuItem = menuById.get(menuItemId);
        if (!menuItem) return false;
        if (menuItem.batchYield) return true;
        return menuItem.stockLevel !== null;
      })
      .map(([menuItemId, qty]) =>
        tx.menuItem.update({
          where: { id: menuItemId },
          data: { stockLevel: { decrement: qty } },
        }),
      ),
  );

  if (unavailableMenuIds.length > 0) {
    await tx.menuItem.updateMany({
      where: { id: { in: unavailableMenuIds } },
      data: { isAvailable: false },
    });
  }

  await allocateSalesToBatches(tx, orderLines);

  const batchMenuIds = menuItemIds.filter((id) => {
    const menuItem = menuById.get(id);
    return menuItem?.batchYield;
  });

  if (batchMenuIds.length === menuItemIds.length) return;

  const legacyMenuIds = menuItemIds.filter((id) => !menuById.get(id)?.batchYield);
  if (legacyMenuIds.length === 0) return;

  const recipes = await tx.menuItemIngredient.findMany({
    where: { menuItemId: { in: legacyMenuIds } },
    include: { inventoryItem: { select: { id: true, name: true, stockLevel: true, reservedQuantity: true } } },
  });

  if (recipes.length === 0) return;

  const recipesByMenuId = new Map<string, typeof recipes>();
  for (const recipe of recipes) {
    const list = recipesByMenuId.get(recipe.menuItemId) || [];
    list.push(recipe);
    recipesByMenuId.set(recipe.menuItemId, list);
  }

  const ingredientTotals = new Map<string, { qty: number; name: string }>();
  for (const [menuItemId, lineQty] of menuQtyById) {
    if (menuById.get(menuItemId)?.batchYield) continue;
    for (const recipe of recipesByMenuId.get(menuItemId) || []) {
      const needed = recipe.quantity * lineQty;
      const existing = ingredientTotals.get(recipe.inventoryItemId);
      if (existing) {
        existing.qty += needed;
      } else {
        ingredientTotals.set(recipe.inventoryItemId, {
          qty: needed,
          name: recipe.inventoryItem.name,
        });
      }
    }
  }

  if (ingredientTotals.size === 0) return;

  const ownHolds = new Map<string, number>();
  if (opts.reservationId) {
    const holds = await tx.stockReservationHold.findMany({
      where: { reservationId: opts.reservationId },
      select: { inventoryItemId: true, quantity: true },
    });
    for (const hold of holds) ownHolds.set(hold.inventoryItemId, hold.quantity);
  }

  const inventoryIds = [...ingredientTotals.keys()].sort();
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM inventory_items
    WHERE id IN (${Prisma.join(inventoryIds)})
    FOR UPDATE
  `);
  const inventoryItems = await tx.inventoryItem.findMany({
    where: { id: { in: inventoryIds } },
    select: { id: true, name: true, stockLevel: true, reservedQuantity: true },
  });
  const inventoryById = new Map(inventoryItems.map((i) => [i.id, i]));

  for (const [inventoryItemId, { qty, name }] of ingredientTotals) {
    const item = inventoryById.get(inventoryItemId);
    if (!item) continue;
    const free = snapQty(item.stockLevel - snapQty(item.reservedQuantity) + (ownHolds.get(inventoryItemId) || 0));
    if (free + 1e-8 < qty) {
      throw new Error(`INSUFFICIENT_INGREDIENT:${name}`);
    }
  }

  await tx.stockMovement.createMany({
    data: [...ingredientTotals.entries()].map(([inventoryItemId, { qty }]) => ({
      inventoryItemId,
      type: 'OUT',
      quantity: qty,
      reason: 'usage',
      reference: opts.receiptNo,
      notes: 'Auto-deducted from POS sale',
      userId: opts.userId,
    })),
  });

  await Promise.all(
    [...ingredientTotals.entries()].map(([inventoryItemId, { qty }]) =>
      tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: { stockLevel: { decrement: qty } },
      }),
    ),
  );
}
