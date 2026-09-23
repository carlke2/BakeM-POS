import prisma from '../services/prisma';
import { hashOtp } from '../services/shopAuth';
import { releaseExpiredReservations } from '../services/stockReservation';
import '../services/shopOrders';

const BASE = 'http://127.0.0.1:5000';
const PHONE = '254711999002';

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const flour = await prisma.inventoryItem.findFirst({ where: { name: 'Flour' } });
  const yeast = await prisma.inventoryItem.findFirst({ where: { name: 'Yeast' } });
  const loaf = await prisma.menuItem.findFirst({ where: { name: 'Brown Loaf' } });
  if (!flour || !yeast || !loaf) throw new Error('seed data missing');

  await prisma.phoneOtp.deleteMany({ where: { phone: { in: [PHONE, '254711999001'] } } });
  await prisma.customer.deleteMany({ where: { phone: { in: [PHONE, '254711999001'] } } });

  const code = '246810';
  await prisma.phoneOtp.create({
    data: { phone: PHONE, codeHash: hashOtp(PHONE, code), expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
  });

  const missingName = await api('/api/shop/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: '0711999002', code }),
  });
  check('name required', missingName.status === 422, String(missingName.status));

  const verified = await api('/api/shop/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: '0711999002', code, name: 'Shop Tester' }),
  });
  const token = verified.body?.token as string;
  check('verify', verified.status === 200 && verified.body?.customer?.phone === PHONE, String(verified.status));

  const staff = await api('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } });
  check('staff rejects customer', staff.status === 403, String(staff.status));

  const me = await api('/api/shop/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  check('customer session', me.status === 200 && me.body?.customer?.role === 'customer', String(me.status));

  const firstSend = await api('/api/shop/auth/request', {
    method: 'POST',
    body: JSON.stringify({ phone: '0711999002' }),
  });
  const secondSend = await api('/api/shop/auth/request', {
    method: 'POST',
    body: JSON.stringify({ phone: '0711999002' }),
  });
  check('otp send fallback', firstSend.status === 200 && firstSend.body?.delivery === 'console', String(firstSend.status));
  check('otp cooldown', secondSend.status === 429, String(secondSend.status));

  const auth = { Authorization: `Bearer ${token}` };
  const flourBefore = flour.reservedQuantity;
  const checkout = await api('/api/shop/checkout', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      fulfillmentType: 'delivery',
      items: [{ menuItemId: loaf.id, quantity: 1 }],
    }),
  });
  check('delivery address required', checkout.status === 422, String(checkout.status));
  const pickup = await api('/api/shop/checkout', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      fulfillmentType: 'pickup',
      items: [{ menuItemId: loaf.id, quantity: 1 }],
    }),
  });
  const flourAfterCheckout = await prisma.inventoryItem.findUnique({ where: { id: flour.id } });
  check(
    'checkout without daraja does not hold stock',
    pickup.status === 503 && flourAfterCheckout?.reservedQuantity === flourBefore,
    `${pickup.status} reserved ${flourAfterCheckout?.reservedQuantity}`,
  );

  const customer = await prisma.customer.findUnique({ where: { phone: PHONE } });
  if (!customer) throw new Error('customer missing');

  const created = await api('/api/reservations', {
    method: 'POST',
    body: JSON.stringify({ customerRef: customer.id, items: [{ menuItemId: loaf.id, quantity: 1 }] }),
  });
  const reservationId = created.body?.reservation?.id as string;
  const order = await prisma.shopOrder.create({
    data: {
      customerId: customer.id,
      fulfillmentType: 'pickup',
      status: 'placed',
      reservationId,
      items: { create: [{ menuItemId: loaf.id, name: loaf.name, unitType: loaf.unitType, quantity: 1, unitPrice: loaf.price }] },
    },
  });
  const payment = await prisma.kopoPayment.create({
    data: {
      status: 'pending',
      amount: loaf.price,
      phone: PHONE,
      purpose: 'shop_order',
      eventType: 'daraja_stk',
      location: `SHOP-OK-${Date.now()}`,
      reservationId,
    },
  });
  await prisma.stockReservation.update({ where: { id: reservationId }, data: { paymentId: payment.id } });
  await prisma.shopOrder.update({ where: { id: order.id }, data: { paymentId: payment.id } });
  const paid = await api('/api/mpesa/callback', {
    method: 'POST',
    body: JSON.stringify({
      Body: {
        stkCallback: {
          CheckoutRequestID: payment.location,
          ResultCode: 0,
          ResultDesc: 'Success',
          CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'SHOPOK1' }, { Name: 'Amount', Value: loaf.price }] },
        },
      },
    }),
  });
  let confirmed = await prisma.shopOrder.findUnique({ where: { id: order.id } });
  const waitStart = Date.now();
  while (Date.now() - waitStart < 15000 && confirmed?.status === 'placed') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    confirmed = await prisma.shopOrder.findUnique({ where: { id: order.id } });
  }
  const flourPaid = await prisma.inventoryItem.findUnique({ where: { id: flour.id } });
  check(
    'payment confirms order and deducts flour',
    paid.status === 200 && confirmed?.status === 'confirmed' && Boolean(confirmed.receiptNo) && flourPaid?.stockLevel === flour.stockLevel - 0.5 && flourPaid.reservedQuantity === 0,
    `order ${confirmed?.status} flour ${flour.stockLevel}->${flourPaid?.stockLevel} reserved ${flourPaid?.reservedQuantity}`,
  );

  const held = await api('/api/reservations', {
    method: 'POST',
    body: JSON.stringify({ customerRef: customer.id, items: [{ menuItemId: loaf.id, quantity: 1 }] }),
  });
  const expireReservationId = held.body?.reservation?.id as string;
  const expireOrder = await prisma.shopOrder.create({
    data: {
      customerId: customer.id,
      fulfillmentType: 'delivery',
      status: 'placed',
      reservationId: expireReservationId,
      buildingName: 'Rose Court',
      street: 'Ngong Road',
      area: 'Kilimani',
      floor: '2',
      unit: '6',
      latitude: -1.2921,
      longitude: 36.8219,
      items: { create: [{ menuItemId: loaf.id, name: loaf.name, unitType: loaf.unitType, quantity: 1, unitPrice: loaf.price }] },
    },
  });
  await prisma.stockReservation.update({
    where: { id: expireReservationId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await releaseExpiredReservations();
  const expiredOrder = await prisma.shopOrder.findUnique({ where: { id: expireOrder.id } });
  const flourExpired = await prisma.inventoryItem.findUnique({ where: { id: flour.id } });
  check(
    'expiry cancels order and releases reserved flour',
    expiredOrder?.status === 'cancelled' && flourExpired?.reservedQuantity === 0 && flourExpired.stockLevel === flourPaid?.stockLevel,
    `order ${expiredOrder?.status} reserved ${flourExpired?.reservedQuantity} stock ${flourExpired?.stockLevel}`,
  );

  await prisma.stockMovement.deleteMany({ where: { reference: { in: [reservationId, expireReservationId] } } });
  await prisma.shopOrder.deleteMany({ where: { customerId: customer.id } });
  await prisma.kopoPayment.deleteMany({ where: { id: payment.id } });
  await prisma.stockReservation.deleteMany({ where: { id: { in: [reservationId, expireReservationId] } } });
  await prisma.phoneOtp.deleteMany({ where: { phone: { in: [PHONE, '254711999001'] } } });
  await prisma.customer.deleteMany({ where: { phone: { in: [PHONE, '254711999001'] } } });
  await prisma.inventoryItem.update({ where: { id: flour.id }, data: { stockLevel: flour.stockLevel, reservedQuantity: flour.reservedQuantity } });
  await prisma.inventoryItem.update({ where: { id: yeast.id }, data: { stockLevel: yeast.stockLevel, reservedQuantity: yeast.reservedQuantity } });
  const restored = await prisma.inventoryItem.findUnique({ where: { id: flour.id } });
  console.log(`RESTORED flour ${restored?.stockLevel}/${restored?.reservedQuantity}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => prisma.$disconnect());
