import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/services/prisma';
import supabase, { getSupabaseConfigError, isSupabaseConfigured } from '@/services/supabase';
import { ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import { recordProduction } from '@/services/production';
import { ensureBatchStockTracking, getKitchenBoard } from '@/services/kitchenBoard';

function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return error instanceof Error ? error.message : String(error);
}

const router = Router();

function canManageMenu(role: string | undefined): boolean {
  return !!role && ['admin', 'restaurant'].includes(role);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only jpg, png, and webp images are allowed'));
  },
});

// ─── GET /api/menu/display ────────────────────────────────────────────────────
// Public cafeteria menu for kiosks — same stock rules as staff POS
function isMenuItemVisible(item: {
  isAvailable: boolean;
  stockLevel: number | null;
  batchYield: number | null;
}): boolean {
  if (!item.isAvailable) return false;
  if (item.batchYield) return (item.stockLevel ?? 0) > 0;
  return item.stockLevel === null || item.stockLevel > 0;
}

router.get('/display', async (_req: Request, res: Response): Promise<any> => {
  try {
    const items = await prisma.menuItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        category: true,
        imageUrl: true,
        isAvailable: true,
        stockLevel: true,
        batchYield: true,
      },
    });
    const visible = items.filter(isMenuItemVisible);
    return res.json(visible);
  } catch (error) {
    console.error('GET /menu/display error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/menu/categories ─────────────────────────────────────────────────
router.get('/categories', ensureAuthenticated, async (_req: Request, res: Response): Promise<any> => {
  try {
    const categories = await prisma.menuCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return res.json(categories);
  } catch (error) {
    console.error('GET /menu/categories error:', error);
    return res.status(500).json({
      message: 'Something went wrong',
      detail: devErrorDetail(error),
    });
  }
});

// ─── POST /api/menu/categories ────────────────────────────────────────────────
router.post('/categories', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!canManageMenu(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(422).json({ message: 'Category name is required' });
  }

  try {
    const existing = await prisma.menuCategory.findUnique({ where: { name } });
    if (existing) {
      return res.status(409).json({ message: 'A category with this name already exists' });
    }

    const sortOrder = Number(req.body.sortOrder);
    const category = await prisma.menuCategory.create({
      data: {
        name,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      },
    });

    await logAuditEvent({
      eventType: 'menu_category_created',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Create Menu Category',
      description: `Added menu category "${name}"`,
      ipAddress: req.ip,
    });

    return res.status(201).json(category);
  } catch (error) {
    console.error('POST /menu/categories error:', error);
    return res.status(500).json({
      message: 'Something went wrong',
      detail: devErrorDetail(error),
    });
  }
});

// ─── PUT /api/menu/categories/:categoryId ─────────────────────────────────────
router.put('/categories/:categoryId', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!canManageMenu(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const categoryId = req.params.categoryId as string;
  const name = req.body.name !== undefined ? String(req.body.name).trim() : undefined;
  const sortOrder = req.body.sortOrder !== undefined ? Number(req.body.sortOrder) : undefined;

  if (name !== undefined && !name) {
    return res.status(422).json({ message: 'Category name cannot be empty' });
  }

  try {
    const existing = await prisma.menuCategory.findUnique({ where: { id: categoryId } });
    if (!existing) {
      return res.status(404).json({ message: 'Category not found' });
    }

    if (name && name !== existing.name) {
      const duplicate = await prisma.menuCategory.findUnique({ where: { name } });
      if (duplicate) {
        return res.status(409).json({ message: 'A category with this name already exists' });
      }
    }

    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.menuCategory.update({
        where: { id: categoryId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(sortOrder !== undefined && Number.isFinite(sortOrder) ? { sortOrder } : {}),
        },
      });

      if (name && name !== existing.name) {
        await tx.menuItem.updateMany({
          where: { category: existing.name },
          data: { category: name },
        });
      }

      return updated;
    });

    await logAuditEvent({
      eventType: 'menu_category_updated',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Update Menu Category',
      description: `Updated menu category "${existing.name}"${name && name !== existing.name ? ` to "${name}"` : ''}`,
      ipAddress: req.ip,
    });

    return res.json(category);
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Category not found' });
    console.error('PUT /menu/categories/:categoryId error:', error);
    return res.status(500).json({
      message: 'Something went wrong',
      detail: devErrorDetail(error),
    });
  }
});

// ─── DELETE /api/menu/categories/:categoryId ──────────────────────────────────
router.delete('/categories/:categoryId', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!canManageMenu(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const categoryId = req.params.categoryId as string;

  try {
    const existing = await prisma.menuCategory.findUnique({ where: { id: categoryId } });
    if (!existing) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const itemCount = await prisma.menuItem.count({ where: { category: existing.name } });
    if (itemCount > 0) {
      return res.status(409).json({
        message: `Cannot delete category "${existing.name}" because ${itemCount} menu item(s) use it`,
      });
    }

    await prisma.menuCategory.delete({ where: { id: categoryId } });

    await logAuditEvent({
      eventType: 'menu_category_deleted',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Delete Menu Category',
      description: `Removed menu category "${existing.name}"`,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Category deleted' });
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Category not found' });
    console.error('DELETE /menu/categories/:categoryId error:', error);
    return res.status(500).json({
      message: 'Something went wrong',
      detail: devErrorDetail(error),
    });
  }
});

// ─── POST /api/menu/upload-image ──────────────────────────────────────────────
router.post(
  '/upload-image',
  ensureAuthenticated,
  (req: Request, res: Response, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!['admin', 'restaurant'].includes(req.user!.role)) {
        return res.status(403).json({ message: 'Not authorized' });
      }
      if (!req.file) {
        return res.status(422).json({ message: 'No image file provided' });
      }

      const configError = getSupabaseConfigError();
      if (!isSupabaseConfigured()) {
        console.error('Supabase storage not configured:', configError);
        return res.status(503).json({
          message: 'Image upload is not configured on the server',
          detail: configError,
        });
      }

      const ext = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
      const filename = `${uuidv4()}.${ext}`;

      let uploadResult = await supabase.storage
        .from('menu-images')
        .upload(filename, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadResult.error && uploadResult.error.message === 'Bucket not found') {
        console.log('Supabase bucket "menu-images" not found. Attempting to create it...');
        const { error: createError } = await supabase.storage.createBucket('menu-images', {
          public: true,
        });
        if (createError) {
          console.error('Failed to create Supabase bucket:', createError);
          return res.status(500).json({
            message: 'Image upload failed: bucket not found and could not be created',
            detail: createError.message,
          });
        }
        console.log('Successfully created public Supabase bucket "menu-images". Retrying upload...');
        uploadResult = await supabase.storage
          .from('menu-images')
          .upload(filename, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });
      }

      if (uploadResult.error) {
        console.error('Supabase upload error:', uploadResult.error);
        return res.status(500).json({ message: 'Image upload failed', detail: uploadResult.error.message });
      }

      const { data: publicData } = supabase.storage
        .from('menu-images')
        .getPublicUrl(filename);

      return res.json({ url: publicData.publicUrl });
    } catch (err: any) {
      console.error('Upload image handler error:', err);
      return res.status(500).json({
        message: 'Something went wrong during image upload',
        detail: devErrorDetail(err),
      });
    }
  },
);

// ─── GET /api/menu/kitchen-board ──────────────────────────────────────────────
router.get('/kitchen-board', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const board = await getKitchenBoard();
    return res.json(board);
  } catch (error) {
    console.error('GET /menu/kitchen-board error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/menu/production-batches ───────────────────────────────────────
router.get('/production-batches', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { menuItemId, status, limit } = req.query;
  const take = Math.min(Number(limit) || 100, 500);

  try {
    const batches = await prisma.productionBatch.findMany({
      where: {
        ...(menuItemId ? { menuItemId: String(menuItemId) } : {}),
        ...(status ? { status: String(status) } : {}),
      },
      include: {
        menuItem: { select: { id: true, name: true, price: true, batchYield: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const enriched = batches.map((b) => ({
      ...b,
      remainingQuantity: Math.max(0, b.yieldQuantity - b.soldQuantity),
      remainingExpected: Math.max(0, b.expectedRevenue - b.soldAmount),
    }));

    return res.json(enriched);
  } catch (error) {
    console.error('GET /menu/production-batches error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/menu/:id/produce ─────────────────────────────────────────────
router.post('/:id/produce', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!canManageMenu(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const menuItemId = req.params.id as string;
  const batchCount = Math.max(1, Math.floor(Number(req.body.batchCount) || 1));
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined;

  try {
    const result = await prisma.$transaction(async (tx) =>
      recordProduction(tx, menuItemId, batchCount, req.user!.id, notes),
    );

    await logAuditEvent({
      eventType: 'production_batch',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Record production',
      description: `Produced ${result.yieldTotal} ${result.menuItem.name} (expected KES ${result.expectedRevenue.toLocaleString()})`,
      metadata: { batchId: result.batch.id, menuItemId },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      batch: result.batch,
      yieldTotal: result.yieldTotal,
      expectedRevenue: result.expectedRevenue,
      menuItemName: result.menuItem.name,
      unitPrice: result.menuItem.price,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'MENU_ITEM_NOT_FOUND') {
      return res.status(404).json({ message: 'Menu item not found' });
    }
    if (message === 'BATCH_YIELD_REQUIRED') {
      return res.status(422).json({
        message: 'Set batch yield on the recipe first (e.g. 60 mandazis per batch)',
      });
    }
    if (message === 'RECIPE_REQUIRED') {
      return res.status(422).json({ message: 'Add recipe ingredients before recording production' });
    }
    if (message.startsWith('INSUFFICIENT_INGREDIENT')) {
      const name = message.split(':')[1];
      return res.status(422).json({
        message: name ? `Not enough ${name} in stock to cook this batch` : 'Insufficient ingredients',
      });
    }
    console.error('POST /menu/:id/produce error:', error);
    return res.status(500).json({ message: 'Failed to record production' });
  }
});

// ─── GET /api/menu ────────────────────────────────────────────────────────────
router.get('/', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  try {
    const items = await prisma.menuItem.findMany({
      orderBy: { category: 'asc' },
    });

    const visibleItems = items.filter((item) => {
      if (!item.isAvailable) return false;
      if (item.batchYield) return (item.stockLevel ?? 0) > 0;
      return item.stockLevel === null || item.stockLevel > 0;
    });

    if (!['admin', 'restaurant', 'finance'].includes(req.user?.role ?? '')) {
      return res.json(visibleItems);
    }

    const board = await getKitchenBoard();
    const boardById = new Map(board.map((d) => [d.id, d]));

    const enriched = visibleItems.map((item) => {
      const kitchen = boardById.get(item.id);
      if (!kitchen) return item;
      return {
        ...item,
        batchYield: kitchen.batchYield,
        kitchenStats: {
          portionsReady: kitchen.portionsReady,
          canCookBatches: kitchen.canCookBatches,
          expectedPerBatch: kitchen.expectedPerBatch,
          activeSold: kitchen.totals.activeSold,
          activeRemaining: kitchen.totals.activeRemaining,
          activeExpected: kitchen.totals.activeExpected,
        },
      };
    });

    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/menu/all ────────────────────────────────────────────────────────
// Admin/Restaurant staff view including unavailable items
router.get('/all', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }
  try {
    const items = await prisma.menuItem.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        ingredients: {
          include: {
            inventoryItem: { select: { id: true, name: true, unit: true, stockLevel: true } },
          },
        },
      },
    });
    return res.json(items);
  } catch (error) {
    console.error('GET /menu/all error:', error);
    return res.status(500).json({
      message: 'Something went wrong',
      detail: devErrorDetail(error),
    });
  }
});

// ─── POST /api/menu ───────────────────────────────────────────────────────────
router.post('/', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { name, description, price, category, imageUrl, isAvailable, stockLevel, batchYield } = req.body;
  if (!name || !price || !category) {
    return res.status(422).json({ message: 'Name, price, and category are required' });
  }

  const parsedStock =
    stockLevel === undefined || stockLevel === null || stockLevel === ''
      ? null
      : Math.max(0, Math.floor(Number(stockLevel)));

  const parsedBatchYield =
    batchYield === undefined || batchYield === null || batchYield === ''
      ? null
      : Math.max(1, Math.floor(Number(batchYield)));

  try {
    const item = await prisma.menuItem.create({
      data: {
        name,
        description,
        price: Number(price),
        category,
        imageUrl,
        isAvailable: isAvailable ?? true,
        stockLevel: parsedStock,
        batchYield: parsedBatchYield,
      },
    });

    await logAuditEvent({
      eventType: 'menu_item_created',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Create Menu Item',
      description: `Added ${name} to the menu`,
      ipAddress: req.ip,
    });

    return res.status(201).json(item);
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/menu/:id/ingredients ────────────────────────────────────────────
router.get('/:id/ingredients', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }
  try {
    const rows = await prisma.menuItemIngredient.findMany({
      where: { menuItemId: req.params.id as string },
      include: {
        inventoryItem: { select: { id: true, name: true, unit: true, stockLevel: true } },
      },
      orderBy: { inventoryItem: { name: 'asc' } },
    });
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/menu/:id/ingredients ────────────────────────────────────────────
router.put('/:id/ingredients', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const menuItemId = req.params.id as string;
  const { ingredients } = req.body;
  if (!Array.isArray(ingredients)) {
    return res.status(422).json({ message: 'ingredients array is required' });
  }

  try {
    const menuItem = await prisma.menuItem.findUnique({ where: { id: menuItemId } });
    if (!menuItem) return res.status(404).json({ message: 'Menu item not found' });

    const parsed = ingredients
      .map((row: any) => ({
        inventoryItemId: String(row.inventoryItemId || ''),
        quantity: Number(row.quantity),
      }))
      .filter((row) => row.inventoryItemId && row.quantity > 0);

    await prisma.$transaction([
      prisma.menuItemIngredient.deleteMany({ where: { menuItemId } }),
      ...(parsed.length > 0
        ? [
            prisma.menuItemIngredient.createMany({
              data: parsed.map((row) => ({
                menuItemId,
                inventoryItemId: row.inventoryItemId,
                quantity: row.quantity,
              })),
            }),
          ]
        : []),
    ]);

    const menuWithYield = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { batchYield: true },
    });
    if (menuWithYield?.batchYield) {
      await ensureBatchStockTracking(menuItemId, menuWithYield.batchYield);
    }

    const rows = await prisma.menuItemIngredient.findMany({
      where: { menuItemId },
      include: {
        inventoryItem: { select: { id: true, name: true, unit: true, stockLevel: true } },
      },
      orderBy: { inventoryItem: { name: 'asc' } },
    });
    return res.json(rows);
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/menu/:id ────────────────────────────────────────────────────────
router.put('/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { name, description, price, category, imageUrl, isAvailable, stockLevel, batchYield } = req.body;

  try {
    const data: any = {};
    if (name) data.name = name;
    if (description !== undefined) data.description = description;
    if (price !== undefined) data.price = Number(price);
    if (category) data.category = category;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (isAvailable !== undefined) data.isAvailable = isAvailable;
    if (stockLevel !== undefined) {
      data.stockLevel =
        stockLevel === null || stockLevel === ''
          ? null
          : Math.max(0, Math.floor(Number(stockLevel)));
      if (data.stockLevel !== null && data.stockLevel > 0 && isAvailable === undefined) {
        data.isAvailable = true;
      }
    }
    if (batchYield !== undefined) {
      data.batchYield =
        batchYield === null || batchYield === ''
          ? null
          : Math.max(1, Math.floor(Number(batchYield)));
    }

    const item = await prisma.menuItem.update({
      where: { id: req.params.id as string },
      data,
    });

    if (data.batchYield) {
      await ensureBatchStockTracking(item.id, data.batchYield);
    }

    return res.json(item);
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Menu item not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── DELETE /api/menu/:id ─────────────────────────────────────────────────────
router.delete('/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const item = await prisma.menuItem.delete({ where: { id: req.params.id as string } });

    await logAuditEvent({
      eventType: 'menu_item_deleted',
      userType: req.user!.role,
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'Delete Menu Item',
      description: `Removed ${item.name} from the menu`,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Menu item deleted' });
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Menu item not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
