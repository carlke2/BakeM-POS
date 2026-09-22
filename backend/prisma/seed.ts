import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';

async function upsertInventory(name: string, data: {
  category: string;
  unit: string;
  stockLevel: number;
  reorderLevel: number;
  unitCost: number;
}) {
  const existing = await prisma.inventoryItem.findFirst({ where: { name } });
  if (existing) {
    return prisma.inventoryItem.update({
      where: { id: existing.id },
      data: { ...data, name },
    });
  }
  return prisma.inventoryItem.create({ data: { name, ...data } });
}

async function upsertMenuItem(data: {
  name: string;
  category: string;
  price: number;
  unitType: string;
  bestBeforeHours?: number | null;
  batchYield?: number | null;
  stockLevel?: number | null;
  description?: string;
}) {
  const existing = await prisma.menuItem.findFirst({ where: { name: data.name } });
  if (existing) {
    return prisma.menuItem.update({
      where: { id: existing.id },
      data: {
        category: data.category,
        price: data.price,
        unitType: data.unitType,
        bestBeforeHours: data.bestBeforeHours ?? null,
        batchYield: data.batchYield ?? null,
        stockLevel: data.stockLevel ?? existing.stockLevel,
        description: data.description,
        isAvailable: true,
      },
    });
  }
  return prisma.menuItem.create({
    data: {
      name: data.name,
      category: data.category,
      price: data.price,
      unitType: data.unitType,
      bestBeforeHours: data.bestBeforeHours ?? null,
      batchYield: data.batchYield ?? null,
      stockLevel: data.stockLevel ?? null,
      description: data.description,
      isAvailable: true,
    },
  });
}

async function linkIngredient(menuItemId: string, inventoryItemId: string, quantity: number) {
  await prisma.menuItemIngredient.upsert({
    where: {
      menuItemId_inventoryItemId: { menuItemId, inventoryItemId },
    },
    update: { quantity },
    create: { menuItemId, inventoryItemId, quantity },
  });
}

async function main() {
  const ownerEmail = (process.env.SEED_OWNER_EMAIL || 'owner@slowrise.co').trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || 'Owner@12345';
  const ownerName = process.env.SEED_OWNER_NAME || 'Slow Rise Owner';

  const cashierEmail = 'cashier@slowrise.co';
  const cashierPassword = 'Cashier@12345';

  console.log('Seeding Slow Rise Co bakery...');

  const ownerHash = await bcrypt.hash(ownerPassword, 10);
  const cashierHash = await bcrypt.hash(cashierPassword, 10);

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      name: ownerName,
      role: 'owner',
      status: 'active',
      password: ownerHash,
    },
    create: {
      name: ownerName,
      email: ownerEmail,
      role: 'owner',
      status: 'active',
      password: ownerHash,
    },
  });

  const cashier = await prisma.user.upsert({
    where: { email: cashierEmail },
    update: {
      name: 'Front Counter',
      role: 'cashier',
      status: 'active',
      password: cashierHash,
    },
    create: {
      name: 'Front Counter',
      email: cashierEmail,
      role: 'cashier',
      status: 'active',
      password: cashierHash,
    },
  });

  const categories = [
    { name: 'Bread', sortOrder: 1 },
    { name: 'Pastries', sortOrder: 2 },
    { name: 'Cakes', sortOrder: 3 },
    { name: 'Beverages', sortOrder: 4 },
  ];

  for (const cat of categories) {
    await prisma.menuCategory.upsert({
      where: { name: cat.name },
      update: { sortOrder: cat.sortOrder },
      create: cat,
    });
  }

  const flour = await upsertInventory('Flour', {
    category: 'Dry goods',
    unit: 'kg',
    stockLevel: 50,
    reorderLevel: 10,
    unitCost: 80,
  });
  const sugar = await upsertInventory('Sugar', {
    category: 'Dry goods',
    unit: 'kg',
    stockLevel: 30,
    reorderLevel: 5,
    unitCost: 150,
  });
  const yeast = await upsertInventory('Yeast', {
    category: 'Dry goods',
    unit: 'kg',
    stockLevel: 5,
    reorderLevel: 1,
    unitCost: 400,
  });

  const brownLoaf = await upsertMenuItem({
    name: 'Brown Loaf',
    category: 'Bread',
    price: 120,
    unitType: 'loaf',
    bestBeforeHours: 48,
    description: 'Wholemeal sandwich loaf',
    stockLevel: 20,
  });

  const mandazi = await upsertMenuItem({
    name: 'Mandazi',
    category: 'Pastries',
    price: 30,
    unitType: 'piece',
    bestBeforeHours: 12,
    batchYield: 24,
    stockLevel: 24,
    description: 'Soft spiced fried dough',
  });

  await upsertMenuItem({
    name: 'Birthday Cake 1kg',
    category: 'Cakes',
    price: 2500,
    unitType: 'kg',
    bestBeforeHours: 72,
    description: 'Vanilla sponge with buttercream',
    stockLevel: 3,
  });

  await upsertMenuItem({
    name: 'Coffee',
    category: 'Beverages',
    price: 150,
    unitType: 'piece',
    description: 'Fresh brew',
    stockLevel: null,
  });

  await linkIngredient(brownLoaf.id, flour.id, 0.5);
  await linkIngredient(brownLoaf.id, yeast.id, 0.01);
  await linkIngredient(mandazi.id, flour.id, 0.04);
  await linkIngredient(mandazi.id, sugar.id, 0.01);

  const existingBatch = await prisma.productionBatch.findFirst({
    where: { menuItemId: mandazi.id, status: 'active' },
  });

  if (!existingBatch && mandazi.batchYield) {
    const yieldQty = mandazi.batchYield;
    await prisma.productionBatch.create({
      data: {
        menuItemId: mandazi.id,
        yieldQuantity: yieldQty,
        unitPrice: mandazi.price,
        expectedRevenue: yieldQty * mandazi.price,
        soldQuantity: 0,
        soldAmount: 0,
        status: 'active',
        notes: 'Seed batch',
        userId: owner.id,
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  Owner:   ${owner.email}`);
  console.log(`  Cashier: ${cashier.email}`);
  console.log(`  Categories: ${categories.map((c) => c.name).join(', ')}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
