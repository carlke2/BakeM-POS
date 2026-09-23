import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { canManageOps, ensureAuthenticated } from '@/middlewares/auth';
import {
  AvailabilityError,
  checkAvailability,
  commitReservation,
  createReservation,
  releaseReservation,
  replaceReservationItems,
  type RequestedLine,
} from '@/services/stockReservation';

const router = Router();

function sendReservationError(res: Response, error: unknown) {
  if (error instanceof AvailabilityError) {
    res.status(409).json({
      message: 'One or more items cannot be fulfilled at the requested quantity. Adjust only the lines that are short.',
      availability: error.result,
    });
    return;
  }

  const message = error instanceof Error ? error.message : '';
  if (message === 'ITEMS_REQUIRED') {
    res.status(422).json({ message: 'At least one menu item is required' });
    return;
  }
  if (message === 'INVALID_QUANTITY') {
    res.status(422).json({ message: 'Each item needs a menuItemId and a quantity greater than 0' });
    return;
  }
  if (message.startsWith('ITEM_NOT_FOUND')) {
    res.status(422).json({ message: 'One or more menu items were not found' });
    return;
  }
  if (message === 'RESERVATION_NOT_FOUND') {
    res.status(404).json({ message: 'Reservation not found' });
    return;
  }
  if (message === 'RESERVATION_NOT_ACTIVE') {
    res.status(409).json({ message: 'This reservation is no longer active' });
    return;
  }
  if (message === 'RESERVATION_EXPIRED') {
    res.status(409).json({ message: 'This reservation expired and its stock has been released' });
    return;
  }
  if (message.startsWith('INSUFFICIENT_INGREDIENT')) {
    const name = message.split(':')[1];
    res.status(409).json({ message: name ? `Not enough ${name} left to commit this reservation` : 'Not enough stock to commit this reservation' });
    return;
  }

  console.error('[reservation]', error);
  res.status(500).json({ message: 'Could not update stock reservation' });
}

function readItems(body: { items?: RequestedLine[] }): RequestedLine[] {
  return Array.isArray(body.items) ? body.items : [];
}

function reservationId(req: Request): string {
  return req.params.id as string;
}

// POST /api/availability
router.post('/availability', async (req: Request, res: Response) => {
  try {
    const availability = await checkAvailability(readItems(req.body));
    res.json(availability);
  } catch (error) {
    sendReservationError(res, error);
  }
});

// POST /api/reservations — hold ingredient stock before payment
router.post('/reservations', async (req: Request, res: Response) => {
  try {
    const customerRef = typeof req.body?.customerRef === 'string' ? req.body.customerRef : null;
    const created = await createReservation({
      items: readItems(req.body),
      customerRef,
      scope: 'recipe',
    });
    res.status(201).json({
      reservation: created.reservation,
      availability: created.availability,
    });
  } catch (error) {
    sendReservationError(res, error);
  }
});

// GET /api/reservations/:id
router.get('/reservations/:id', async (req: Request, res: Response) => {
  const reservation = await prisma.stockReservation.findUnique({
    where: { id: reservationId(req) },
    include: { items: true, holds: { include: { inventoryItem: { select: { name: true, unit: true } } } } },
  });
  if (!reservation) {
    res.status(404).json({ message: 'Reservation not found' });
    return;
  }
  res.json(reservation);
});

// PUT /api/reservations/:id — change one or more lines to the available quantity
router.put('/reservations/:id', async (req: Request, res: Response) => {
  try {
    const updated = await replaceReservationItems(reservationId(req), readItems(req.body));
    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'RESERVATION_EXPIRED') {
      await releaseReservation(reservationId(req), 'timeout').catch(() => {});
    }
    sendReservationError(res, error);
  }
});

// POST /api/reservations/:id/cancel — release before production
router.post('/reservations/:id/cancel', async (req: Request, res: Response) => {
  try {
    const reservation = await releaseReservation(reservationId(req), 'cancelled');
    if (reservation.paymentId) {
      await prisma.kopoPayment.updateMany({
        where: { id: reservation.paymentId, status: 'pending' },
        data: { status: 'failed', description: 'Order cancelled before production' },
      });
    }
    res.json(reservation);
  } catch (error) {
    sendReservationError(res, error);
  }
});

// POST /api/reservations/:id/commit — payment confirmed or order moved to production
router.post('/reservations/:id/commit', ensureAuthenticated, async (req: Request, res: Response) => {
  if (!canManageOps(req.user!.role)) {
    res.status(403).json({ message: 'Only bakery staff can commit reserved stock' });
    return;
  }
  try {
    const reservation = await commitReservation(reservationId(req), req.user!.id);
    res.json(reservation);
  } catch (error) {
    if (error instanceof Error && error.message === 'RESERVATION_EXPIRED') {
      await releaseReservation(reservationId(req), 'timeout').catch(() => {});
    }
    sendReservationError(res, error);
  }
});

export default router;
