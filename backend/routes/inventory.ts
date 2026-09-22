import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';

const router = Router();

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return error instanceof Error ? error.message : String(error);
}

// ─── GET /api/inventory/items ─────────────────────────────────────────────────
router.get('/items', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const items = await prisma.inventoryItem.findMany({
      orderBy: { category: 'asc' },
    });
    return res.json(items);
  } catch (error) {
    console.error('GET /inventory/items error:', error);
    return res.status(500).json({
      message: 'Something went wrong',
      detail: devErrorDetail(error),
    });
  }
});

// ─── POST /api/inventory/items ────────────────────────────────────────────────
router.post('/items', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { name, category, unit, reorderLevel, unitCost } = req.body;
  if (!name || !category || !unit) {
    return res.status(422).json({ message: 'Name, category, and unit are required' });
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        name,
        category,
        unit,
        reorderLevel: Number(reorderLevel) || 0,
        unitCost: Number(unitCost) || 0,
        stockLevel: 0,
      },
    });

    return res.status(201).json(item);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/inventory/movements ────────────────────────────────────────────
// Record stock coming in (purchases) or out (usage/spoilage)
router.post('/movements', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { inventoryItemId, type, quantity, reason, reference, notes, supplierId } = req.body;

  if (!inventoryItemId || !type || !quantity || !reason) {
    return res.status(422).json({ message: 'Required fields missing' });
  }

  const numQuantity = Number(quantity);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          inventoryItemId,
          type,
          quantity: numQuantity,
          reason,
          reference,
          notes,
          supplierId,
          userId: req.user!.id,
        },
      });

      // Update stock level
      const stockChange = type === 'IN' ? numQuantity : -numQuantity;
      const item = await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: { stockLevel: { increment: stockChange } },
      });

      return { movement, item };
    });

    await logAuditEvent({
      eventType: 'stock_movement',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: `Stock ${type}`,
      description: `Recorded ${numQuantity} ${result.item.unit} of ${result.item.name} (${reason})`,
      metadata: { movementId: result.movement.id },
      ipAddress: req.ip,
    });

    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to record stock movement' });
  }
});

// ─── GET /api/inventory/movements ─────────────────────────────────────────────
router.get('/movements', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { supplierId, inventoryItemId, type, limit } = req.query;
  const take = Math.min(Number(limit) || 100, 500);

  try {
    const movements = await prisma.stockMovement.findMany({
      where: {
        ...(supplierId ? { supplierId: String(supplierId) } : {}),
        ...(inventoryItemId ? { inventoryItemId: String(inventoryItemId) } : {}),
        ...(type ? { type: String(type) } : {}),
      },
      include: {
        inventoryItem: { select: { id: true, name: true, unit: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return res.json(movements);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/inventory/suppliers ─────────────────────────────────────────────
router.get('/suppliers', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { stockMovements: true } },
      },
    });
    return res.json(suppliers);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/inventory/suppliers ────────────────────────────────────────────
router.post('/suppliers', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { name, contactPerson, email, phone, address } = req.body;
  if (!name?.trim()) return res.status(422).json({ message: 'Supplier name is required' });

  try {
    const supplier = await prisma.supplier.create({
      data: {
        name: name.trim(),
        contactPerson: contactPerson?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
      },
      include: {
        _count: { select: { stockMovements: true } },
      },
    });

    await logAuditEvent({
      eventType: 'supplier_created',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Create supplier',
      description: `Added supplier ${supplier.name}`,
      metadata: { supplierId: supplier.id },
      ipAddress: req.ip,
    });

    return res.status(201).json(supplier);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/inventory/suppliers/:id ─────────────────────────────────────────
router.put('/suppliers/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { name, contactPerson, email, phone, address } = req.body;
  if (!name?.trim()) return res.status(422).json({ message: 'Supplier name is required' });

  const supplierId = req.params.id as string;

  try {
    const supplier = await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        name: name.trim(),
        contactPerson: contactPerson?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
      },
      include: {
        _count: { select: { stockMovements: true } },
      },
    });

    await logAuditEvent({
      eventType: 'supplier_updated',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Update supplier',
      description: `Updated supplier ${supplier.name}`,
      metadata: { supplierId: supplier.id },
      ipAddress: req.ip,
    });

    return res.json(supplier);
  } catch (error) {
    return res.status(500).json({ message: 'Supplier not found or update failed' });
  }
});

// ─── DELETE /api/inventory/suppliers/:id ──────────────────────────────────────
router.delete('/suppliers/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const supplierId = req.params.id as string;

  try {
    const movementCount = await prisma.stockMovement.count({
      where: { supplierId },
    });
    if (movementCount > 0) {
      return res.status(409).json({
        message: 'Cannot delete supplier with recorded purchases. Keep for audit history.',
      });
    }

    const supplier = await prisma.supplier.delete({ where: { id: supplierId } });

    await logAuditEvent({
      eventType: 'supplier_deleted',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Delete supplier',
      description: `Removed supplier ${supplier.name}`,
      metadata: { supplierId: supplier.id },
      ipAddress: req.ip,
    });

    return res.json({ message: 'Supplier deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Supplier not found or delete failed' });
  }
});

export default router;
