import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { phoneCandidates } from '@/services/phone';

function looksLikePhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

/** Canonical parent password = phone as stored (usually 07XXXXXXXX). */
export function defaultParentPassword(phone: string): string {
  const trimmed = String(phone || '').trim();
  return trimmed || 'parent1';
}

async function hashMatches(hash: string, attempts: Iterable<string>) {
  for (const attempt of attempts) {
    if (attempt && (await bcrypt.compare(attempt, hash))) return true;
  }
  return false;
}

/**
 * Verify parent password. Accepts:
 * - stored bcrypt password
 * - full phone (any KE format)
 * - legacy last-6-digits default
 * On success with a plaintext phone-style password, self-heals hash to canonical phone.
 */
export async function verifyParentPassword(
  parent: { id: string; phone: string | null; password: string },
  password: string,
): Promise<boolean> {
  const submitted = String(password || '').trim();
  if (!submitted) return false;

  const attempts = new Set<string>([submitted]);
  if (looksLikePhone(submitted)) {
    for (const c of phoneCandidates(submitted)) attempts.add(c);
  }

  if (await hashMatches(parent.password, attempts)) {
    return true;
  }

  // Accept phone / legacy last-6 even if DB hash is outdated
  const phone = String(parent.phone || '').trim();
  if (!phone) return false;

  const accepted = new Set<string>(phoneCandidates(phone));
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 6) accepted.add(digits.slice(-6));
  accepted.add(phone);

  const matchedPlain = [...attempts].some((a) => accepted.has(a));
  if (!matchedPlain) return false;

  // Self-heal so next login uses a consistent phone password
  try {
    const canonical = defaultParentPassword(phone);
    const hash = await bcrypt.hash(canonical, 10);
    await prisma.parent.update({ where: { id: parent.id }, data: { password: hash } });
  } catch (err) {
    console.warn('[auth] Failed to self-heal parent password', parent.id, err);
  }

  return true;
}

export function findParentPhoneWhere(phone: string) {
  return { phone: { in: phoneCandidates(phone) } };
}
