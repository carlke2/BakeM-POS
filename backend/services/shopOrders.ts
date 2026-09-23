import prisma from '@/services/prisma';
import { generateReceiptNo } from '@/services/receipt';
import { normalizeKenyanMobile } from '@/services/sms';
import {
  commitReservation,
  createReservation,
  onReservationReleased,
  releaseReservation,
} from '@/services/stockReservation';
import {
  darajaConfigError,
  initiateDarajaStk,
  isDarajaConfigured,
} from '@/services/daraja.service';

export type ShopFulfillment = 'pickup' | 'delivery';

export type ShopAddress = {
  buildingName?: string;
  street?: string;
  area?: string;
  floor?: string;
  unit?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type ShopLineInput = { menuItemId: string; quantity: number };

const orderInclude = {
  items: true,
  customer: { select: { id: true, name: true, phone: true } },
  deliveryUser: { select: { id: true, name: true, phone: true } },
} as const;

function clean(value: unknown) {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

function optionalCoord(value: unknown) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function addressFor(fulfillment: ShopFulfillment, address: ShopAddress | undefined) {
  if (fulfillment === 'pickup') {
    return {
      buildingName: null,
      street: null,
      area: null,
      floor: null,
      unit: null,
      latitude: null,
      longitude: null,
    };
  }
  const buildingName = clean(address?.buildingName);
  const street = clean(address?.street);
  const area = clean(address?.area);
  if (!buildingName || !street || !area) {
    throw new Error('ADDRESS_REQUIRED');
  }
  return {
    buildingName,
    street,
    area,
    floor: clean(address?.floor),
    unit: clean(address?.unit),
    latitude: optionalCoord(address?.latitude),
    longitude: optionalCoord(address?.longitude),
  };
}

export function trackingSteps(fulfillmentType: string) {
  if (fulfillmentType === 'pickup') {
    return [
      { status: 'placed', label: 'Placed' },
      { status: 'confirmed', label: 'Confirmed' },
      { status: 'ready_for_pickup', label: 'Ready for pickup' },
      { status: 'picked_up', label: 'Picked up' },
    ];
  }
  return [
    { status: 'placed', label: 'Placed' },
    { status: 'confirmed', label: 'Confirmed' },
    { status: 'out_for_delivery', label: 'Out for delivery' },
    { status: 'delivered', label: 'Delivered' },
  ];
}

onReservationReleased(async (reservationId) => {
  await prisma.shopOrder.updateMany({
    where: { reservationId, status: 'placed' },
    data: { status: 'cancelled' },
  });
});

export async function placeShopOrder(input: {
  customerId: string;
  phone: string;
  fulfillmentType: string;
  items: ShopLineInput[];
  address?: ShopAddress;
  payPhone?: string;
}) {
  const fulfillment = input.fulfillmentType === 'delivery' ? 'delivery' : input.fulfillmentType === 'pickup' ? 'pickup' : null;
  if (!fulfillment) throw new Error('INVALID_FULFILLMENT');
  const address = addressFor(fulfillment, input.address);
  if (!isDarajaConfigured()) {
    throw new Error(darajaConfigError() || 'DARAJA_NOT_CONFIGURED');
  }

  const payPhone = normalizeKenyanMobile(input.payPhone || input.phone);
  if (!payPhone) throw new Error('INVALID_PHONE');

  const menuIds = [...new Set(input.items.map((item) => item.menuItemId))];
  const menu = await prisma.menuItem.findMany({ where: { id: { in: menuIds } } });
  const menuById = new Map(menu.map((item) => [item.id, item]));

  const reserved = await createReservation({
    customerRef: input.customerId,
    scope: 'recipe',
    items: input.items,
  });

  let orderId: string | null = null;
  try {
    const lines = reserved.reservation.items.map((item) => {
      const product = menuById.get(item.menuItemId);
      if (!product) throw new Error(`ITEM_NOT_FOUND:${item.menuItemId}`);
      return {
        menuItemId: product.id,
        name: product.name,
        unitType: product.unitType,
        quantity: item.quantity,
        unitPrice: product.price,
      };
    });
    const amount = Math.round(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
    if (amount < 1) throw new Error('INVALID_AMOUNT');

    const order = await prisma.shopOrder.create({
      data: {
        customerId: input.customerId,
        fulfillmentType: fulfillment,
        status: 'placed',
        reservationId: reserved.reservation.id,
        ...address,
        items: { create: lines },
      },
    });
    orderId = order.id;

    const payment = await prisma.kopoPayment.create({
      data: {
        status: 'pending',
        amount,
        phone: payPhone,
        purpose: 'shop_order',
        description: 'Slow Rise Co shop order',
        eventType: 'daraja_stk',
        reservationId: reserved.reservation.id,
        tillNumber: process.env.MPESA_SHORTCODE || '',
      },
    });
    await prisma.stockReservation.update({
      where: { id: reserved.reservation.id },
      data: { paymentId: payment.id },
    });
    await prisma.shopOrder.update({
      where: { id: order.id },
      data: { paymentId: payment.id },
    });

    const stk = await initiateDarajaStk({
      phone: payPhone,
      amount,
      accountReference: order.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'SLOWRISE',
      description: 'Slow Rise Co',
    });
    await prisma.kopoPayment.update({
      where: { id: payment.id },
      data: {
        location: stk.checkoutRequestId,
        reference: stk.merchantRequestId || stk.checkoutRequestId,
      },
    });

    const placed = await prisma.shopOrder.findUnique({ where: { id: order.id }, include: orderInclude });
    return {
      order: placed,
      paymentId: payment.id,
      location: stk.checkoutRequestId,
      customerMessage: stk.customerMessage,
      availability: reserved.availability,
    };
  } catch (error) {
    await releaseReservation(reserved.reservation.id, 'payment_failed').catch(() => {});
    if (orderId) {
      await prisma.shopOrder.updateMany({
        where: { id: orderId, status: 'placed' },
        data: { status: 'cancelled' },
      });
    }
    throw error;
  }
}

export async function confirmShopPayment(paymentId: string, _mpesaReceipt: string) {
  const order = await prisma.shopOrder.findFirst({ where: { paymentId }, include: { items: true } });
  if (!order || order.status !== 'placed' || !order.reservationId) return null;

  await commitReservation(order.reservationId, order.customerId);
  const receiptNo = await generateReceiptNo(async (candidate) =>
    Boolean(await prisma.shopOrder.findFirst({ where: { receiptNo: candidate }, select: { id: true } })),
  );
  return prisma.shopOrder.update({
    where: { id: order.id },
    data: { status: 'confirmed', receiptNo },
    include: orderInclude,
  });
}

export async function customerOrders(customerId: string) {
  const orders = await prisma.shopOrder.findMany({
    where: { customerId },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });
  return orders.map((order) => ({ ...order, steps: trackingSteps(order.fulfillmentType) }));
}

export async function customerOrder(customerId: string, orderId: string) {
  const order = await prisma.shopOrder.findFirst({
    where: { id: orderId, customerId },
    include: orderInclude,
  });
  if (!order) return null;
  return { ...order, steps: trackingSteps(order.fulfillmentType) };
}

const PICKUP_NEXT: Record<string, string> = {
  confirmed: 'ready_for_pickup',
  ready_for_pickup: 'picked_up',
};
const DELIVERY_NEXT: Record<string, string> = {
  confirmed: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

export async function updateShopOrderStatus(input: {
  orderId: string;
  nextStatus: string;
  actorRole: 'owner' | 'delivery';
  actorId: string;
}) {
  const order = await prisma.shopOrder.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error('ORDER_NOT_FOUND');

  if (order.fulfillmentType === 'pickup') {
    if (input.actorRole !== 'owner' || PICKUP_NEXT[order.status] !== input.nextStatus) {
      throw new Error('INVALID_TRANSITION');
    }
  } else if (
    input.actorRole !== 'delivery'
    || order.deliveryUserId !== input.actorId
    || DELIVERY_NEXT[order.status] !== input.nextStatus
  ) {
    throw new Error('INVALID_TRANSITION');
  }

  return prisma.shopOrder.update({
    where: { id: order.id },
    data: { status: input.nextStatus },
    include: orderInclude,
  });
}

export async function assignDelivery(orderId: string, deliveryUserId: string | null) {
  const order = await prisma.shopOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (order.fulfillmentType !== 'delivery') throw new Error('NOT_DELIVERY');
  if (!['confirmed', 'out_for_delivery'].includes(order.status)) throw new Error('NOT_READY');
  if (deliveryUserId) {
    const rider = await prisma.user.findFirst({
      where: { id: deliveryUserId, role: 'delivery', status: 'active' },
      select: { id: true },
    });
    if (!rider) throw new Error('RIDER_NOT_FOUND');
  }
  return prisma.shopOrder.update({
    where: { id: orderId },
    data: { deliveryUserId },
    include: orderInclude,
  });
}

export function orderTotal(items: Array<{ quantity: number; unitPrice: number }>) {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
