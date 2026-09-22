import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1017']);

function isRetryableDbError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  const message = String(err?.message ?? '');
  return (
    RETRYABLE_CODES.has(err?.code ?? '') ||
    message.includes("Can't reach database server") ||
    message.includes('Connection reset') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT')
  );
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

/** Generated Prisma client type (includes all schema models). */
export type AppPrisma = typeof prisma;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableDbError(error) || attempt === maxAttempts) throw error;
      console.warn(`Database unreachable — retrying (${attempt}/${maxAttempts - 1})...`);
      await prisma.$disconnect().catch(() => {});
      await new Promise((r) => setTimeout(r, 400 * attempt));
      await prisma.$connect().catch(() => {});
    }
  }
  throw new Error('Database query failed after retries');
}

export async function connectDatabase(): Promise<void> {
  await withDbRetry(() => prisma.$connect());
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await withDbRetry(() => prisma.$queryRaw`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export default prisma;
