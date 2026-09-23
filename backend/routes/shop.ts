import { Router, Request, Response } from 'express';
import { ensureAuthenticated, ensureOwner } from '@/middlewares/auth';
import { AvailabilityError } from '@/services/stockReservation';
import { ensureCustomer } from '@/routes/shopAuth';
import {
  assignDelivery,
  customerOrder,
  customerOrders,
  orderTotal,
  placeShopOrder,
  updateShopOrderStatus,
} from '@/services/shopOrders';
import prisma from '@/services/prisma';

const router = Router();

function sendError(res: Response, error: unknown) {
  if (error instanceof AvailabilityError) {
    res.status(409).json({
      message: 'One or more items cannot be fulfilled at the requested quantity. Adjust only the lines that are short.',
      availability: error.result,
    });
    return;
  }
  const message = error instanceof Error ? error.message : '';
  const known: Record<string, { status: number; message: string }> = {
    ADDRESS_REQUIRED: { status: 422, message: 'Delivery needs a building, street, and area' },
    INVALID_FULFILLMENT: { status: 422, message: 'Choose pickup or delivery' },
    INVALID_PHONE: { status: 422, message: 'Enter a valid M-Pesa number' },
    ITEM_NOT_FOUND: { status: 422, message: 'One or more menu items were not found' },
    ITEMS_REQUIRED: { status: 422, message: 'Add at least one item' },
    ORDER_NOT_FOUND: { status: 404, message: 'Order not found' },
    NOT_DELIVERY: { status: 422, message: 'Only delivery orders can be assigned' },
    NOT_READY: { status: 409, message: 'Assign a rider after the order is confirmed' },
    RIDER_NOT_FOUND: { status: 422, message: 'Choose an active delivery person' },
    INVALID_TRANSITION: { status: 409, message: 'That status change is not allowed for this order' },
  };
  if (known[message]) {
    res.status(known[message].status).json({ message: known[message].message });
    return;
  }
  if (message.startsWith('Set MPESA_') || message.includes('MPESA_')) {
    res.status(503).json({ message });
    return;
  }
  console.error('[shop]', error);
  res.status(500).json({ message: 'Could not update the shop order' });
}

router.post('/checkout', ensureCustomer, async (req: Request, res: Response) => {
  try {
    const result = await placeShopOrder({
      customerId: req.customer!.id,
      phone: req.customer!.phone,
      fulfillmentType: String(req.body?.fulfillmentType || ''),
      items: Array.isArray(req.body?.items) ? req.body.items : [],
      address: req.body?.address,
      payPhone: req.body?.payPhone,
    });
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/orders', ensureCustomer, async (req: Request, res: Response) => {
  res.json(await customerOrders(req.customer!.id));
});

router.get('/orders/:id', ensureCustomer, async (req: Request, res: Response) => {
  const order = await customerOrder(req.customer!.id, req.params.id as string);
  if (!order) {
    res.status(404).json({ message: 'Order not found' });
    return;
  }
  res.json(order);
});

router.get('/orders/:id/receipt', ensureCustomer, async (req: Request, res: Response) => {
  const order = await customerOrder(req.customer!.id, req.params.id as string);
  if (!order || !order.receiptNo) {
    res.status(404).json({ message: 'Receipt is available after payment is confirmed' });
    return;
  }
  res.json({
    receiptNo: order.receiptNo,
    customerName: order.customer.name,
    phone: order.customer.phone,
    paidAt: order.updatedAt,
    paymentMethod: 'mpesa',
    fulfillmentType: order.fulfillmentType,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.unitPrice,
    })),
    total: orderTotal(order.items),
  });
});

router.get('/manage', ensureOwner, async (_req: Request, res: Response) => {
  const [orders, riders] = await Promise.all([
    prisma.shopOrder.findMany({
      include: {
        items: true,
        customer: { select: { id: true, name: true, phone: true } },
        deliveryUser: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.user.findMany({
      where: { role: 'delivery', status: 'active' },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  res.json({ orders, riders });
});

router.patch('/manage/:id/assign', ensureOwner, async (req: Request, res: Response) => {
  try {
    const deliveryUserId = req.body?.deliveryUserId ? String(req.body.deliveryUserId) : null;
    res.json(await assignDelivery(req.params.id as string, deliveryUserId));
  } catch (error) {
    sendError(res, error);
  }
});

router.patch('/manage/:id/status', ensureOwner, async (req: Request, res: Response) => {
  try {
    res.json(await updateShopOrderStatus({
      orderId: req.params.id as string,
      nextStatus: String(req.body?.status || ''),
      actorRole: 'owner',
      actorId: req.user!.id,
    }));
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/delivery', ensureAuthenticated, async (req: Request, res: Response) => {
  if (req.user!.role !== 'delivery') {
    res.status(403).json({ message: 'Delivery access required' });
    return;
  }
  const orders = await prisma.shopOrder.findMany({
    where: { deliveryUserId: req.user!.id, fulfillmentType: 'delivery' },
    include: {
      items: true,
      customer: { select: { name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
});

router.patch('/delivery/:id/status', ensureAuthenticated, async (req: Request, res: Response) => {
  if (req.user!.role !== 'delivery') {
    res.status(403).json({ message: 'Delivery access required' });
    return;
  }
  try {
    res.json(await updateShopOrderStatus({
      orderId: req.params.id as string,
      nextStatus: String(req.body?.status || ''),
      actorRole: 'delivery',
      actorId: req.user!.id,
    }));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
