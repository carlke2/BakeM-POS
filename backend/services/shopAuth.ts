import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '@/services/prisma';
import { normalizeKenyanMobile, sendAdvantaSms } from '@/services/sms';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const JWT_SECRET = process.env.JWT_SECRET || 'slowrise-secret-key';

export type CustomerToken = {
  id: string;
  name: string;
  phone: string;
  role: 'customer';
};

function pepper() {
  return JWT_SECRET;
}

export function hashOtp(phone: string, code: string) {
  return crypto.createHash('sha256').update(`${pepper()}:${phone}:${code}`).digest('hex');
}

function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export function signCustomerToken(customer: { id: string; name: string; phone: string }) {
  const payload: CustomerToken = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    role: 'customer',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyCustomerToken(token: string): CustomerToken | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as CustomerToken;
    if (decoded.role !== 'customer' || !decoded.id) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function cleanupPhoneOtps() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.phoneOtp.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() }, createdAt: { lt: cutoff } },
        { usedAt: { not: null }, createdAt: { lt: cutoff } },
      ],
    },
  });
}

export function startShopOtpSweeper() {
  const tick = () => {
    cleanupPhoneOtps().catch((err) => console.error('[shop-otp] cleanup failed', err));
  };
  setInterval(tick, 60_000);
  tick();
}

export async function requestShopOtp(rawPhone: string) {
  const phone = normalizeKenyanMobile(rawPhone);
  if (!phone) {
    throw new Error('INVALID_PHONE');
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.phoneOtp.findMany({
    where: { phone, createdAt: { gte: hourAgo } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (recent.length >= MAX_SENDS_PER_HOUR) {
    throw new Error('OTP_HOURLY_LIMIT');
  }
  const latest = recent[0];
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) / 1000,
    );
    const error = new Error('OTP_COOLDOWN');
    (error as Error & { retryAfterSeconds: number }).retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  await prisma.phoneOtp.updateMany({
    where: { phone, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = randomCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.phoneOtp.create({
    data: { phone, codeHash: hashOtp(phone, code), expiresAt },
  });

  let delivery: 'sms' | 'console' = 'sms';
  try {
    await sendAdvantaSms(phone, `Slow Rise Co code: ${code}. It expires in 5 minutes.`);
  } catch (err) {
    delivery = 'console';
    const reason = err instanceof Error ? err.message : 'SMS failed';
    console.log(`[shop-otp] SMS not sent (${reason}). Phone ${phone} code ${code}`);
  }

  return { phone, delivery, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyShopOtp(rawPhone: string, code: string, name?: string) {
  const phone = normalizeKenyanMobile(rawPhone);
  if (!phone) throw new Error('INVALID_PHONE');
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length !== 6) throw new Error('INVALID_CODE');

  const otp = await prisma.phoneOtp.findFirst({
    where: { phone, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.expiresAt.getTime() <= Date.now() || otp.codeHash !== hashOtp(phone, digits)) {
    throw new Error('INVALID_CODE');
  }

  const existing = await prisma.customer.findUnique({ where: { phone } });
  const trimmedName = String(name || '').trim();
  if (!existing && trimmedName.length < 2) {
    throw new Error('NAME_REQUIRED');
  }

  await prisma.phoneOtp.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });

  const customer = existing
    ? existing
    : await prisma.customer.create({
        data: { phone, name: trimmedName },
      });

  return {
    token: signCustomerToken(customer),
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
  };
}
