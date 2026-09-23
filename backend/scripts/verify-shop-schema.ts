import prisma from '../services/prisma';

async function main() {
  const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>>`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('customers', 'phone_otps', 'shop_orders', 'shop_order_items')
    ORDER BY table_name, ordinal_position
  `;
  for (const column of columns) {
    console.log(`${column.table_name}.${column.column_name} ${column.data_type} ${column.is_nullable}`);
  }
}

main().finally(() => prisma.$disconnect());
