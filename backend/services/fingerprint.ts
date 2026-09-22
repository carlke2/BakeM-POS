import crypto from 'crypto';
import prisma from '@/services/prisma';

export const getScannerUrl = (): string =>
  (process.env.FINGERPRINT_SCANNER_URL || 'http://127.0.0.1:17890').replace(/\/$/, '');

const SCANNER_URL = getScannerUrl();
const SCANNER_TIMEOUT_MS = 8_000;

type FingerprintOwner = { id: string; name: string; label: string };

export class FingerprintDuplicateError extends Error {
  matchedStudent?: { id: string; name: string; regNo: string };
  matchedUser?: { id: string; name: string; email: string };

  constructor(
    message: string,
    matched?: { student?: { id: string; name: string; regNo: string }; user?: { id: string; name: string; email: string } },
  ) {
    super(message);
    this.name = 'FingerprintDuplicateError';
    this.matchedStudent = matched?.student;
    this.matchedUser = matched?.user;
  }
}

export type FingerprintExclude = {
  studentId?: string;
  userId?: string;
};

function normalizeExclude(exclude?: string | FingerprintExclude): FingerprintExclude {
  if (!exclude) return {};
  if (typeof exclude === 'string') return { studentId: exclude };
  return exclude;
}

export const hashFingerprintTemplate = (templateBase64: string): string =>
  crypto.createHash('sha256').update(Buffer.from(templateBase64, 'base64')).digest('hex');

/** Parse ZKTeco match score from API body (number or numeric string). */
export const parseFingerprintMatchScore = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
};

export const parseFingerprintTemplate = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('INVALID_FINGERPRINT');
  const trimmed = value.trim();
  if (!trimmed) return null;
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length < 32) throw new Error('INVALID_FINGERPRINT');
  return trimmed;
};

export const fingerprintEnrollmentData = (template: string | null) => {
  if (!template) {
    return {
      fingerprintTemplate: null,
      fingerprintTemplateHash: null,
      fingerprintEnrolledAt: null,
    };
  }
  return {
    fingerprintTemplate: template,
    fingerprintTemplateHash: hashFingerprintTemplate(template),
    fingerprintEnrolledAt: new Date(),
  };
};

const findBiometricDuplicate = async (
  template: string,
  others: { id: string; name: string; label: string; fingerprintTemplate: string }[],
): Promise<FingerprintOwner | null> => {
  if (others.length === 0) return null;

  try {
    const res = await fetch(`${SCANNER_URL}/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template,
        candidates: others.map((o) => o.fingerprintTemplate),
      }),
      signal: AbortSignal.timeout(SCANNER_TIMEOUT_MS),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.warn('Fingerprint scanner duplicate check failed:', data.message);
      return null;
    }

    if (data.isDuplicate && typeof data.matchedIndex === 'number') {
      const matched = others[data.matchedIndex];
      if (matched) return matched;
    }
  } catch (err) {
    console.warn('Fingerprint scanner unavailable for biometric duplicate check:', err);
  }

  return null;
};

/** Hash + exact DB match only (fast). */
export const checkFingerprintFast = async (
  template: string,
  exclude?: string | FingerprintExclude,
): Promise<{ unique: true } | { unique: false; message: string; matchedStudent?: { id: string; name: string; regNo: string }; matchedUser?: { id: string; name: string; email: string } }> => {
  try {
    await assertFingerprintUnique(template, exclude, { biometric: false });
    return { unique: true };
  } catch (err) {
    if (err instanceof FingerprintDuplicateError) {
      return {
        unique: false,
        message: err.message,
        matchedStudent: err.matchedStudent,
        matchedUser: err.matchedUser,
      };
    }
    throw err;
  }
};

/** Ensures template is not assigned to another student or staff member. */
export const assertFingerprintUnique = async (
  template: string,
  exclude?: string | FingerprintExclude,
  options?: { biometric?: boolean },
): Promise<void> => {
  const runBiometric = options?.biometric !== false;
  const { studentId: excludeStudentId, userId: excludeUserId } = normalizeExclude(exclude);
  const hash = hashFingerprintTemplate(template);
  const studentExclude = excludeStudentId ? { id: { not: excludeStudentId } } : {};
  const userExclude = excludeUserId ? { id: { not: excludeUserId } } : {};

  const [exactStudentTemplate, exactStudentHash, exactUserTemplate, exactUserHash] = await Promise.all([
    prisma.student.findFirst({
      where: { fingerprintTemplate: template, ...studentExclude },
      select: { id: true, name: true, regNo: true },
    }),
    prisma.student.findFirst({
      where: { fingerprintTemplateHash: hash, ...studentExclude },
      select: { id: true, name: true, regNo: true },
    }),
    prisma.user.findFirst({
      where: { fingerprintTemplate: template, ...userExclude },
      select: { id: true, name: true, email: true },
    }),
    prisma.user.findFirst({
      where: { fingerprintTemplateHash: hash, ...userExclude },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const studentMatch = exactStudentTemplate || exactStudentHash;
  if (studentMatch) {
    throw new FingerprintDuplicateError(
      `This fingerprint is already enrolled for student ${studentMatch.name} (${studentMatch.regNo})`,
      { student: studentMatch },
    );
  }

  const userMatch = exactUserTemplate || exactUserHash;
  if (userMatch) {
    throw new FingerprintDuplicateError(
      `This fingerprint is already enrolled for staff ${userMatch.name} (${userMatch.email})`,
      { user: userMatch },
    );
  }

  if (!runBiometric) return;

  const [studentOthers, userOthers] = await Promise.all([
    prisma.student.findMany({
      where: { fingerprintTemplate: { not: null }, ...studentExclude },
      select: { id: true, name: true, regNo: true, fingerprintTemplate: true },
    }),
    prisma.user.findMany({
      where: { fingerprintTemplate: { not: null }, ...userExclude },
      select: { id: true, name: true, email: true, fingerprintTemplate: true },
    }),
  ]);

  const candidates = [
    ...studentOthers.map((s) => ({
      id: s.id,
      name: s.name,
      label: s.regNo,
      fingerprintTemplate: s.fingerprintTemplate as string,
    })),
    ...userOthers.map((u) => ({
      id: u.id,
      name: u.name,
      label: u.email,
      fingerprintTemplate: u.fingerprintTemplate as string,
    })),
  ];

  const biometricMatch = await findBiometricDuplicate(template, candidates);
  if (biometricMatch) {
    const isStudent = studentOthers.some((s) => s.id === biometricMatch.id);
    if (isStudent) {
      const s = studentOthers.find((x) => x.id === biometricMatch.id)!;
      throw new FingerprintDuplicateError(
        `This fingerprint matches student ${s.name} (${s.regNo})`,
        { student: s },
      );
    }
    const u = userOthers.find((x) => x.id === biometricMatch.id)!;
    throw new FingerprintDuplicateError(
      `This fingerprint matches staff ${u.name} (${u.email})`,
      { user: u },
    );
  }
};

export const checkFingerprintUnique = async (
  template: string,
  exclude?: string | FingerprintExclude,
  options?: { biometric?: boolean },
): Promise<{ unique: true } | { unique: false; message: string; matchedStudent?: { id: string; name: string; regNo: string }; matchedUser?: { id: string; name: string; email: string } }> => {
  try {
    await assertFingerprintUnique(template, exclude, options);
    return { unique: true };
  } catch (err) {
    if (err instanceof FingerprintDuplicateError) {
      return {
        unique: false,
        message: err.message,
        matchedStudent: err.matchedStudent,
        matchedUser: err.matchedUser,
      };
    }
    throw err;
  }
};

export async function findStaffByFingerprint(template: string) {
  const hash = hashFingerprintTemplate(template);

  const exact = await prisma.user.findFirst({
    where: {
      status: 'approved',
      OR: [{ fingerprintTemplateHash: hash }, { fingerprintTemplate: template }],
    },
    select: { id: true, name: true, email: true, role: true, fingerprintTemplate: true },
  });
  if (exact) return exact;

  const staff = await prisma.user.findMany({
    where: { status: 'approved', fingerprintTemplate: { not: null } },
    select: { id: true, name: true, email: true, role: true, fingerprintTemplate: true },
  });

  if (staff.length === 0) return null;

  const match = await findBiometricDuplicate(
    template,
    staff.map((u) => ({
      id: u.id,
      name: u.name,
      label: u.email,
      fingerprintTemplate: u.fingerprintTemplate as string,
    })),
  );

  if (!match) return null;
  return staff.find((u) => u.id === match.id) ?? null;
}

/** Verify a scan matches a specific staff member's enrolled template. */
export async function verifyStaffFingerprint(
  userId: string,
  candidateTemplate: string,
  options?: { matchScore?: number },
): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, status: 'approved', fingerprintTemplate: { not: null } },
    select: { fingerprintTemplate: true, fingerprintTemplateHash: true },
  });
  if (!user?.fingerprintTemplate) return false;

  const matchScore = parseFingerprintMatchScore(options?.matchScore);
  // Local PC verified via ZKTeco SDK (cloud server has no USB scanner).
  if (matchScore !== undefined) {
    return true;
  }

  const hash = hashFingerprintTemplate(candidateTemplate);
  if (user.fingerprintTemplateHash === hash || user.fingerprintTemplate === candidateTemplate) {
    return true;
  }

  const match = await findBiometricDuplicate(candidateTemplate, [
    {
      id: userId,
      name: '',
      label: '',
      fingerprintTemplate: user.fingerprintTemplate,
    },
  ]);
  if (match?.id === userId) return true;

  return false;
}
