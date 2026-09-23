import { Prisma } from '@prisma/client';
import prisma from '@/services/prisma';

/** Daraja's handset prompt is about a minute, but callbacks can arrive later. Hold stock for 15 minutes so a delayed success still commits. */
export const RESERVATION_TTL_MS = 15 * 60 * 1000;

export type ReservationScope = 'recipe' | 'pos_sale';

export type RequestedLine = { menuItemId: string; quantity: number };

export type AvailabilityStatus = 'available' | 'partial' | 'unavailable';

export type LimitingIngredient = {
  inventoryItemId: string;
  name: string;
  unit: string;
  perUnit: number;
  required: number;
  available: number;
};

export type AvailabilityLine = {
  menuItemId: string;
  name: string;
  unitType: string;
  requested: number;
  status: AvailabilityStatus;
  /** Largest quantity of this line that still fits while every other line stays at its requested quantity. Null when the item has no recipe. */
  maxQuantity: number | null;
  /** Largest quantity if this item were ordered on its own. */
  maxQuantityAlone: number | null;
  tracksIngredients: boolean;
  /** Batch-yield items are limited by cooked portions already in stock, not by raw ingredients. */
  tracksFinishedPortions: boolean;
  limitingIngredients: LimitingIngredient[];
};

export type AvailabilityResult = {
  lines: AvailabilityLine[];
  cartFits: boolean;
};

export class AvailabilityError extends Error {
  result: AvailabilityResult;

  constructor(result: AvailabilityResult) {
    super('INSUFFICIENT_AVAILABILITY');
    this.result = result;
  }
}

type Tx = Prisma.TransactionClient;

type IngredientRow = {
  inventoryItemId: string;
  name: string;
  unit: string;
  stockLevel: number;
  reservedQuantity: number;
  perUnit: number;
};

type PreparedLine = {
  menuItemId: string;
  name: string;
  unitType: string;
  batchYield: number | null;
  requested: number;
  ingredients: IngredientRow[];
  /** Set for batch-yield items. Availability is finished portions, not raw ingredients. */
  finishedStock: number | null;
  finishedReserved: number;
};

const QTY_SCALE = 10000;
const QTY_EPSILON = 0.0001;

/** Round to 4 decimal places. Anything smaller than 0.0001 is float dust and becomes 0. */
export function snapQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < QTY_EPSILON) return 0;
  return Math.round(value * QTY_SCALE) / QTY_SCALE;
}

const roundQty = snapQty;

/** Remote Postgres (session pooler) often needs longer than Prisma's 5s interactive default. */
const txOptions = { maxWait: 15_000, timeout: 20_000 };

const floorQty = (value: number) => Math.max(0, Math.floor(value * 10000 + 1e-8) / 10000);

function parseLines(items: RequestedLine[]): RequestedLine[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('ITEMS_REQUIRED');
  }
  return items.map((item) => {
    const quantity = Number(item.quantity);
    if (!item.menuItemId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('INVALID_QUANTITY');
    }
    return { menuItemId: item.menuItemId, quantity: roundQty(quantity) };
  });
}

async function activeFinishedHolds(tx: Tx, menuIds: string[], excludeReservationId?: string) {
  if (menuIds.length === 0) return new Map<string, number>();
  const rows = await tx.stockReservationItem.groupBy({
    by: ['menuItemId'],
    where: {
      menuItemId: { in: menuIds },
      reservation: {
        status: 'active',
        ...(excludeReservationId ? { NOT: { id: excludeReservationId } } : {}),
      },
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.menuItemId, row._sum.quantity ?? 0]));
}

async function prepareLines(
  tx: Tx,
  items: RequestedLine[],
  _scope: ReservationScope,
  excludeReservationId?: string,
): Promise<PreparedLine[]> {
  const ids = [...new Set(items.map((item) => item.menuItemId))];
  const menuItems = await tx.menuItem.findMany({
    where: { id: { in: ids } },
    include: {
      ingredients: {
        include: {
          inventoryItem: {
            select: { id: true, name: true, unit: true, stockLevel: true, reservedQuantity: true },
          },
        },
      },
    },
  });
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  const batchIds = menuItems.filter((menu) => menu.batchYield).map((menu) => menu.id);
  const finishedReserved = await activeFinishedHolds(tx, batchIds, excludeReservationId);

  return items.map((item) => {
    const menu = byId.get(item.menuItemId);
    if (!menu) throw new Error(`ITEM_NOT_FOUND:${item.menuItemId}`);
    const portionTracked = Boolean(menu.batchYield);
    return {
      menuItemId: menu.id,
      name: menu.name,
      unitType: menu.unitType,
      batchYield: menu.batchYield,
      requested: item.quantity,
      finishedStock: portionTracked ? (menu.stockLevel ?? 0) : null,
      finishedReserved: snapQty(finishedReserved.get(menu.id) || 0),
      ingredients: portionTracked
        ? []
        : menu.ingredients.map((ingredient) => ({
            inventoryItemId: ingredient.inventoryItemId,
            name: ingredient.inventoryItem.name,
            unit: ingredient.inventoryItem.unit,
            stockLevel: snapQty(ingredient.inventoryItem.stockLevel),
            reservedQuantity: snapQty(ingredient.inventoryItem.reservedQuantity),
            perUnit: snapQty(ingredient.quantity),
          })),
    };
  });
}

function poolFromLines(lines: PreparedLine[], extraAvailable: Map<string, number>) {
  const pool = new Map<string, number>();
  for (const line of lines) {
    for (const ingredient of line.ingredients) {
      if (pool.has(ingredient.inventoryItemId)) continue;
      const extra = extraAvailable.get(ingredient.inventoryItemId) || 0;
      pool.set(
        ingredient.inventoryItemId,
        roundQty(ingredient.stockLevel - ingredient.reservedQuantity + extra),
      );
    }
  }
  return pool;
}

function consumption(lines: PreparedLine[], skipIndex: number | null) {
  const used = new Map<string, number>();
  lines.forEach((line, index) => {
    if (index === skipIndex) return;
    for (const ingredient of line.ingredients) {
      if (ingredient.perUnit <= 0) continue;
      const needed = ingredient.perUnit * line.requested;
      used.set(ingredient.inventoryItemId, (used.get(ingredient.inventoryItemId) || 0) + needed);
    }
  });
  return used;
}

function portionDemand(lines: PreparedLine[], skipIndex: number, menuItemId: string) {
  return lines.reduce((sum, line, index) => {
    if (index === skipIndex || line.menuItemId !== menuItemId || line.finishedStock === null) return sum;
    return sum + line.requested;
  }, 0);
}

function maxForLine(
  line: PreparedLine,
  pool: Map<string, number>,
  usedByOthers: Map<string, number>,
  otherPortions: number,
) {
  if (line.finishedStock !== null) {
    return floorQty(line.finishedStock - line.finishedReserved - otherPortions);
  }
  if (line.ingredients.length === 0) return null;
  let max = Number.POSITIVE_INFINITY;
  for (const ingredient of line.ingredients) {
    if (ingredient.perUnit <= 0) continue;
    const remaining = snapQty(
      (pool.get(ingredient.inventoryItemId) || 0) - (usedByOthers.get(ingredient.inventoryItemId) || 0),
    );
    max = Math.min(max, remaining / ingredient.perUnit);
  }
  if (!Number.isFinite(max)) return null;
  return floorQty(max);
}

export function evaluateAvailability(lines: PreparedLine[], pool: Map<string, number>): AvailabilityResult {
  const evaluated = lines.map((line, index) => {
    const tracksIngredients = line.ingredients.some((ingredient) => ingredient.perUnit > 0);
    const tracksFinishedPortions = line.finishedStock !== null;
    const alone = maxForLine(line, pool, new Map(), 0);
    const withCart = maxForLine(line, pool, consumption(lines, index), portionDemand(lines, index, line.menuItemId));
    const limited = tracksIngredients || tracksFinishedPortions;
    const maxQuantity = limited ? withCart ?? 0 : null;
    const maxQuantityAlone = limited ? alone ?? 0 : null;
    let status: AvailabilityStatus = 'available';
    if (limited) {
      const cap = maxQuantity ?? 0;
      if (cap <= 0) status = 'unavailable';
      else if (cap + 1e-8 < line.requested) status = 'partial';
    }

    const others = consumption(lines, index);
    const limitingIngredients: LimitingIngredient[] = line.ingredients
      .filter((ingredient) => ingredient.perUnit > 0)
      .map((ingredient) => {
        const available = roundQty(
          (pool.get(ingredient.inventoryItemId) || 0) - (others.get(ingredient.inventoryItemId) || 0),
        );
        return {
          inventoryItemId: ingredient.inventoryItemId,
          name: ingredient.name,
          unit: ingredient.unit,
          perUnit: ingredient.perUnit,
          required: roundQty(ingredient.perUnit * line.requested),
          available: Math.max(0, available),
        };
      })
      .filter((ingredient) => ingredient.required > ingredient.available + 1e-8);

    return {
      menuItemId: line.menuItemId,
      name: line.name,
      unitType: line.unitType,
      requested: line.requested,
      status,
      maxQuantity,
      maxQuantityAlone,
      tracksIngredients,
      tracksFinishedPortions,
      limitingIngredients,
    };
  });

  return {
    lines: evaluated,
    cartFits: evaluated.every((line) => line.status === 'available'),
  };
}

function aggregateHolds(lines: PreparedLine[]) {
  const holds = new Map<string, number>();
  for (const line of lines) {
    for (const ingredient of line.ingredients) {
      if (ingredient.perUnit <= 0) continue;
      const qty = roundQty(ingredient.perUnit * line.requested);
      holds.set(ingredient.inventoryItemId, roundQty((holds.get(ingredient.inventoryItemId) || 0) + qty));
    }
  }
  return holds;
}

async function applyReservedDelta(tx: Tx, inventoryItemId: string, delta: number) {
  const change = snapQty(delta);
  if (change === 0) return;
  await tx.$executeRaw(Prisma.sql`
    UPDATE inventory_items
    SET reserved_quantity = CASE
      WHEN reserved_quantity + ${change} < ${QTY_EPSILON} THEN 0::double precision
      ELSE round((reserved_quantity + ${change})::numeric, 4)::double precision
    END
    WHERE id = ${inventoryItemId}
  `);
}

async function lockInventory(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM inventory_items
    WHERE id IN (${Prisma.join(sorted)})
    FOR UPDATE
  `);
}

async function holdsForReservation(tx: Tx, reservationId: string) {
  const holds = await tx.stockReservationHold.findMany({
    where: { reservationId },
    select: { inventoryItemId: true, quantity: true },
  });
  return new Map(holds.map((hold) => [hold.inventoryItemId, hold.quantity]));
}

export async function checkAvailability(
  items: RequestedLine[],
  options?: { scope?: ReservationScope; excludeReservationId?: string },
) {
  const lines = parseLines(items);
  const scope = options?.scope ?? 'recipe';
  return prisma.$transaction(async (tx) => {
    const prepared = await prepareLines(tx, lines, scope, options?.excludeReservationId);
    const extra = options?.excludeReservationId
      ? await holdsForReservation(tx, options.excludeReservationId)
      : new Map<string, number>();
    return evaluateAvailability(prepared, poolFromLines(prepared, extra));
  }, txOptions);
}

async function writeReservation(
  tx: Tx,
  prepared: PreparedLine[],
  input: { customerRef?: string | null; paymentId?: string | null; ttlMs?: number },
) {
  const ids = [...new Set(prepared.flatMap((line) => line.ingredients.map((ingredient) => ingredient.inventoryItemId)))];
  await lockInventory(tx, ids);

  const fresh = await prepareLines(
    tx,
    prepared.map((line) => ({ menuItemId: line.menuItemId, quantity: line.requested })),
    'recipe',
  );
  // prepared already dropped batch-item ingredients when scope is pos_sale.
  const scoped = fresh.map((line, index) => ({
    ...line,
    ingredients: prepared[index].ingredients.length === 0 ? [] : line.ingredients,
  }));
  const holds = aggregateHolds(scoped);
  const availability = evaluateAvailability(scoped, poolFromLines(scoped, new Map()));
  if (!availability.cartFits) throw new AvailabilityError(availability);

  const expiresAt = new Date(Date.now() + (input.ttlMs ?? RESERVATION_TTL_MS));
  const reservation = await tx.stockReservation.create({
    data: {
      status: 'active',
      expiresAt,
      customerRef: input.customerRef || null,
      paymentId: input.paymentId || null,
      items: {
        create: scoped.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.requested,
        })),
      },
      holds: {
        create: [...holds.entries()].map(([inventoryItemId, quantity]) => ({
          inventoryItemId,
          quantity,
        })),
      },
    },
    include: { items: true, holds: true },
  });

  await lockInventory(tx, [...holds.keys()]);
  for (const [inventoryItemId, quantity] of holds) {
    await applyReservedDelta(tx, inventoryItemId, quantity);
  }

  return { reservation, availability };
}

export async function createReservation(input: {
  items: RequestedLine[];
  customerRef?: string | null;
  paymentId?: string | null;
  scope?: ReservationScope;
  ttlMs?: number;
}) {
  const lines = parseLines(input.items);
  const scope = input.scope ?? 'recipe';
  return prisma.$transaction(async (tx) => {
    const prepared = await prepareLines(tx, lines, scope);
    return writeReservation(tx, prepared, input);
  }, txOptions);
}

async function loadActiveReservation(tx: Tx, id: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_reservations WHERE id = ${id} FOR UPDATE`);
  const reservation = await tx.stockReservation.findUnique({
    where: { id },
    include: { items: true, holds: true },
  });
  if (!reservation) throw new Error('RESERVATION_NOT_FOUND');
  return reservation;
}

export async function releaseReservation(id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await loadActiveReservation(tx, id);
    if (reservation.status === 'released') return reservation;
    if (reservation.status !== 'active') throw new Error('RESERVATION_NOT_ACTIVE');

    await lockInventory(tx, reservation.holds.map((hold) => hold.inventoryItemId));
    for (const hold of reservation.holds) {
      await applyReservedDelta(tx, hold.inventoryItemId, -hold.quantity);
    }

    return tx.stockReservation.update({
      where: { id },
      data: {
        status: 'released',
        releaseReason: reason,
        releasedAt: new Date(),
      },
      include: { items: true, holds: true },
    });
  }, txOptions);
}

export async function releaseReservationForPayment(paymentId: string, reason: string) {
  const reservation = await prisma.stockReservation.findFirst({
    where: { paymentId, status: 'active' },
    select: { id: true },
  });
  if (!reservation) return null;
  return releaseReservation(reservation.id, reason);
}

/** Stock was already deducted by the caller. Drop the hold so it is not counted twice. */
export async function settleReservation(tx: Tx, id: string) {
  const reservation = await loadActiveReservation(tx, id);
  if (reservation.status !== 'active') throw new Error('RESERVATION_NOT_ACTIVE');

  await lockInventory(tx, reservation.holds.map((hold) => hold.inventoryItemId));
  for (const hold of reservation.holds) {
    await applyReservedDelta(tx, hold.inventoryItemId, -hold.quantity);
  }

  return tx.stockReservation.update({
    where: { id },
    data: { status: 'committed', committedAt: new Date() },
  });
}

export async function commitReservation(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await loadActiveReservation(tx, id);
    if (reservation.status !== 'active') throw new Error('RESERVATION_NOT_ACTIVE');
    if (reservation.expiresAt.getTime() <= Date.now()) {
      throw new Error('RESERVATION_EXPIRED');
    }

    await lockInventory(tx, reservation.holds.map((hold) => hold.inventoryItemId));
    const inventory = await tx.inventoryItem.findMany({
      where: { id: { in: reservation.holds.map((hold) => hold.inventoryItemId) } },
      select: { id: true, name: true, stockLevel: true },
    });
    const byId = new Map(inventory.map((item) => [item.id, item]));
    for (const hold of reservation.holds) {
      const item = byId.get(hold.inventoryItemId);
      if (!item || item.stockLevel + 1e-8 < hold.quantity) {
        throw new Error(`INSUFFICIENT_INGREDIENT:${item?.name || hold.inventoryItemId}`);
      }
    }

    for (const hold of reservation.holds) {
      await tx.stockMovement.create({
        data: {
          inventoryItemId: hold.inventoryItemId,
          type: 'OUT',
          quantity: hold.quantity,
          reason: 'usage',
          reference: reservation.id,
          notes: 'Reserved stock committed',
          userId,
        },
      });
      await tx.inventoryItem.update({
        where: { id: hold.inventoryItemId },
        data: { stockLevel: { decrement: hold.quantity } },
      });
      await applyReservedDelta(tx, hold.inventoryItemId, -hold.quantity);
    }

    const menus = await tx.menuItem.findMany({
      where: { id: { in: reservation.items.map((item) => item.menuItemId) } },
      select: { id: true, name: true, batchYield: true, stockLevel: true },
    });
    const menuById = new Map(menus.map((menu) => [menu.id, menu]));
    const portionQty = new Map<string, number>();
    for (const item of reservation.items) {
      if (!menuById.get(item.menuItemId)?.batchYield) continue;
      portionQty.set(item.menuItemId, roundQty((portionQty.get(item.menuItemId) || 0) + item.quantity));
    }
    for (const [menuItemId, quantity] of portionQty) {
      const menu = menuById.get(menuItemId);
      if ((menu?.stockLevel ?? 0) + 1e-8 < quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${menu?.name || menuItemId}`);
      }
      await tx.menuItem.update({
        where: { id: menuItemId },
        data: { stockLevel: { decrement: quantity } },
      });
    }

    return tx.stockReservation.update({
      where: { id },
      data: { status: 'committed', committedAt: new Date() },
      include: { items: true, holds: true },
    });
  }, txOptions);
}

export async function replaceReservationItems(id: string, items: RequestedLine[]) {
  const lines = parseLines(items);
  return prisma.$transaction(async (tx) => {
    const reservation = await loadActiveReservation(tx, id);
    if (reservation.status !== 'active') throw new Error('RESERVATION_NOT_ACTIVE');
    if (reservation.expiresAt.getTime() <= Date.now()) throw new Error('RESERVATION_EXPIRED');

    const draft = await prepareLines(tx, lines, 'recipe', id);
    const ids = [
      ...new Set([
        ...draft.flatMap((line) => line.ingredients.map((ingredient) => ingredient.inventoryItemId)),
        ...reservation.holds.map((hold) => hold.inventoryItemId),
      ]),
    ];
    await lockInventory(tx, ids);

    const prepared = await prepareLines(tx, lines, 'recipe', id);
    const holds = aggregateHolds(prepared);
    const current = new Map(reservation.holds.map((hold) => [hold.inventoryItemId, hold.quantity]));
    const availability = evaluateAvailability(prepared, poolFromLines(prepared, current));
    if (!availability.cartFits) throw new AvailabilityError(availability);

    await tx.stockReservationItem.deleteMany({ where: { reservationId: id } });
    await tx.stockReservationHold.deleteMany({ where: { reservationId: id } });
    await tx.stockReservationItem.createMany({
      data: prepared.map((line) => ({
        reservationId: id,
        menuItemId: line.menuItemId,
        quantity: line.requested,
      })),
    });
    if (holds.size > 0) {
      await tx.stockReservationHold.createMany({
        data: [...holds.entries()].map(([inventoryItemId, quantity]) => ({
          reservationId: id,
          inventoryItemId,
          quantity,
        })),
      });
    }

    for (const inventoryItemId of ids) {
      const next = holds.get(inventoryItemId) || 0;
      const prev = current.get(inventoryItemId) || 0;
      await applyReservedDelta(tx, inventoryItemId, next - prev);
    }

    const updated = await tx.stockReservation.findUnique({
      where: { id },
      include: { items: true, holds: true },
    });
    return { reservation: updated, availability };
  }, txOptions);
}

export async function releaseExpiredReservations() {
  const expired = await prisma.stockReservation.findMany({
    where: { status: 'active', expiresAt: { lt: new Date() } },
    select: { id: true, paymentId: true },
  });

  for (const row of expired) {
    try {
      await releaseReservation(row.id, 'timeout');
      if (!row.paymentId) continue;
      await prisma.kopoPayment.updateMany({
        where: { id: row.paymentId, status: 'pending' },
        data: {
          status: 'expired',
          description: 'Reservation expired before payment completed',
        },
      });
    } catch (err) {
      console.error('[reservation] failed to release', row.id, err);
    }
  }

  return expired.length;
}

export function startReservationSweeper() {
  const tick = () => {
    releaseExpiredReservations().catch((err) => {
      console.error('[reservation] sweep failed:', err);
    });
  };
  setInterval(tick, 60_000);
  tick();
}
