import prisma from '@/services/prisma';

export type KitchenBoardDish = {
  id: string;
  name: string;
  price: number;
  batchYield: number;
  portionsReady: number;
  canCookBatches: number;
  expectedPerBatch: number;
  ingredients: {
    inventoryItemId: string;
    name: string;
    unit: string;
    quantityPerBatch: number;
    stockLevel: number;
    batchesPossible: number;
  }[];
  activeBatch: {
    id: string;
    yieldQuantity: number;
    soldQuantity: number;
    soldAmount: number;
    expectedRevenue: number;
    remainingQuantity: number;
    remainingExpected: number;
    progressPercent: number;
    createdAt: Date;
  } | null;
  totals: {
    activeExpected: number;
    activeSold: number;
    activeRemaining: number;
    activePortionsLeft: number;
  };
};

export async function getKitchenBoard(): Promise<KitchenBoardDish[]> {
  const items = await prisma.menuItem.findMany({
    where: {
      batchYield: { gt: 0 },
      ingredients: { some: {} },
    },
    include: {
      ingredients: {
        include: {
          inventoryItem: { select: { id: true, name: true, unit: true, stockLevel: true } },
        },
      },
      productionBatches: {
        where: { status: 'active' },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  return items.map((item) => {
    const batchYield = item.batchYield!;
    const ingredients = item.ingredients.map((ing) => {
      const batchesPossible =
        ing.quantity > 0 ? Math.floor(ing.inventoryItem.stockLevel / ing.quantity) : 0;
      return {
        inventoryItemId: ing.inventoryItemId,
        name: ing.inventoryItem.name,
        unit: ing.inventoryItem.unit,
        quantityPerBatch: ing.quantity,
        stockLevel: ing.inventoryItem.stockLevel,
        batchesPossible,
      };
    });

    const canCookBatches =
      ingredients.length > 0 ? Math.min(...ingredients.map((i) => i.batchesPossible)) : 0;

    const activeBatches = item.productionBatches.filter(
      (b) => b.soldQuantity < b.yieldQuantity,
    );

    const totals = activeBatches.reduce(
      (acc, b) => {
        const remainingQty = b.yieldQuantity - b.soldQuantity;
        const remainingAmt = b.expectedRevenue - b.soldAmount;
        acc.activeExpected += b.expectedRevenue;
        acc.activeSold += b.soldAmount;
        acc.activeRemaining += remainingAmt;
        acc.activePortionsLeft += remainingQty;
        return acc;
      },
      { activeExpected: 0, activeSold: 0, activeRemaining: 0, activePortionsLeft: 0 },
    );

    const oldest = activeBatches[0];
    const activeBatch = oldest
      ? {
          id: oldest.id,
          yieldQuantity: oldest.yieldQuantity,
          soldQuantity: oldest.soldQuantity,
          soldAmount: oldest.soldAmount,
          expectedRevenue: oldest.expectedRevenue,
          remainingQuantity: oldest.yieldQuantity - oldest.soldQuantity,
          remainingExpected: oldest.expectedRevenue - oldest.soldAmount,
          progressPercent:
            oldest.expectedRevenue > 0
              ? Math.min(100, (oldest.soldAmount / oldest.expectedRevenue) * 100)
              : 0,
          createdAt: oldest.createdAt,
        }
      : null;

    return {
      id: item.id,
      name: item.name,
      price: item.price,
      batchYield,
      portionsReady: item.stockLevel ?? 0,
      canCookBatches,
      expectedPerBatch: batchYield * item.price,
      ingredients,
      activeBatch,
      totals,
    };
  });
}

/** When batch yield is configured, menu stock must be tracked (0 until cooked). */
export async function ensureBatchStockTracking(menuItemId: string, batchYield: number | null) {
  if (!batchYield || batchYield <= 0) return;
  const item = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { stockLevel: true },
  });
  if (item && item.stockLevel === null) {
    await prisma.menuItem.update({
      where: { id: menuItemId },
      data: { stockLevel: 0, isAvailable: false },
    });
  }
}
