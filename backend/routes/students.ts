import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { signToken, ensureAdmin, ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import { sendParentWelcomeNotifications } from '@/services/parentWelcome';
import {
  assertFingerprintUnique,
  checkFingerprintUnique,
  fingerprintEnrollmentData,
  FingerprintDuplicateError,
} from '@/services/fingerprint';
import { buildWalletPinUpdate, defaultWalletPinData } from '@/services/walletPin';
import { normalizePersonName, phoneCandidates } from '@/services/phone';
import { defaultParentPassword } from '@/services/parentAuth';
import {
  backfillMissingRegistrationFees,
  ensureSystemRegistrationFee,
  REGISTRATION_FEE_DESCRIPTION,
  REGISTRATION_FEE_KES,
} from '@/services/registrationFee';

const router = Router();

/** Map prisma student → frontend shape (uses _id for MongoDB compat) */
const fmt = (s: any) => {
  const { fingerprintTemplate, ...rest } = s;
  return {
    ...rest,
    _id: s.id,
    hasFingerprint: Boolean(fingerprintTemplate),
  };
};

const studentListSelect = {
  id: true, name: true, regNo: true, phone: true, email: true,
  gender: true, dateOfBirth: true, course: true, parentRelationship: true,
  walletBalance: true, parentId: true, createdAt: true,
  walletPinSetAt: true,
  fingerprintTemplate: true, fingerprintEnrolledAt: true,
  parent: { select: { id: true, name: true, email: true, phone: true, receiveSms: true, receiveEmail: true } },
} as const;

const studentDetailSelect = {
  ...studentListSelect,
} as const;

const posStudentSelect = {
  id: true,
  name: true,
  regNo: true,
  phone: true,
  walletBalance: true,
  walletFrozen: true,
  walletPinSetAt: true,
  fingerprintTemplate: true,
} as const;

function toPosStudent(student: {
  id: string;
  name: string;
  regNo: string;
  phone?: string | null;
  walletBalance: number;
  walletFrozen?: boolean;
  walletPinSetAt?: Date | null;
  fingerprintTemplate?: string | null;
}) {
  return {
    ...fmt(student),
    walletFrozen: Boolean(student.walletFrozen),
    pinEnabled: Boolean(student.walletPinSetAt),
    hasFingerprint: Boolean(student.fingerprintTemplate),
  };
}

function rankStudentSearch<T extends { name: string; regNo: string; phone?: string | null }>(
  students: T[],
  query: string,
): T[] {
  const lower = query.toLowerCase();
  return students
    .map((student) => {
      const reg = student.regNo.toLowerCase();
      const name = student.name.toLowerCase();
      const phone = (student.phone || '').toLowerCase();
      let score = 0;
      if (reg === lower) score = 100;
      else if (reg.startsWith(lower)) score = 80;
      else if (name.startsWith(lower)) score = 70;
      else if (phone.startsWith(lower)) score = 65;
      else if (reg.includes(lower)) score = 50;
      else if (name.includes(lower)) score = 40;
      else if (phone.includes(lower)) score = 30;
      return { student, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.student.name.localeCompare(b.student.name))
    .map(({ student }) => student);
}

const generateRegNo = async (): Promise<string> => {
  const year = new Date().getFullYear();
  for (let i = 0; i < 10; i++) {
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const regNo = `ADM-${year}-${suffix}`;
    const exists = await prisma.student.findUnique({ where: { regNo } });
    if (!exists) return regNo;
  }
  return `ADM-${year}-${Date.now()}`;
};

type ParentEnrollmentInput = {
  name?: string;
  phone?: string;
  email?: string;
  receiveSms?: boolean;
  receiveEmail?: boolean;
};

function buildDefaultParentPassword(phone: string): string {
  return defaultParentPassword(phone);
}

const resolveParentId = async (
  parentId: string | null | undefined,
  parentInfo: ParentEnrollmentInput | undefined,
  existingParentId?: string | null,
): Promise<{
  parentId: string | null;
  notify?: {
    parent: { name: string; email?: string | null; phone?: string | null; receiveSms?: boolean; receiveEmail?: boolean };
    password?: string;
  };
}> => {
  if (parentId) {
    if (existingParentId && parentId === existingParentId) return { parentId };
    const existingById = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { id: true, name: true, email: true, phone: true, receiveSms: true, receiveEmail: true },
    });
    if (!existingById) return { parentId };
    return {
      parentId,
      notify: { parent: existingById },
    };
  }
  if (!parentInfo?.name?.trim() || !parentInfo?.phone?.trim()) {
    return { parentId: existingParentId ?? null };
  }

  const phone = parentInfo.phone.trim();
  const email = parentInfo.email?.trim() || null;
  const parentData = {
    name: parentInfo.name.trim(),
    phone,
    email,
    receiveSms: parentInfo.receiveSms !== false,
    receiveEmail: parentInfo.receiveEmail !== false,
  };

  const candidates = phoneCandidates(phone);
  const existingByPhone = await prisma.parent.findFirst({
    where: { phone: { in: candidates } },
  });
  if (existingByPhone) {
    await prisma.parent.update({
      where: { id: existingByPhone.id },
      data: {
        name: parentData.name,
        email: email || existingByPhone.email,
        receiveSms: parentData.receiveSms,
        receiveEmail: parentData.receiveEmail,
      },
    });
    return {
      parentId: existingByPhone.id,
      notify: {
        parent: {
          name: parentData.name,
          phone: existingByPhone.phone,
          email: email || existingByPhone.email,
          receiveSms: parentData.receiveSms,
          receiveEmail: parentData.receiveEmail,
        },
      },
    };
  }

  if (email) {
    const existingByEmail = await prisma.parent.findUnique({ where: { email } });
    if (existingByEmail) {
      throw Object.assign(new Error('PARENT_EMAIL_EXISTS'), {
        code: 'PARENT_EMAIL_EXISTS',
        parent: existingByEmail,
      });
    }
  }

  const plainPassword = buildDefaultParentPassword(phone);
  const hashed = await bcrypt.hash(plainPassword, 10);
  const created = await prisma.parent.create({ data: { ...parentData, password: hashed } });
  return {
    parentId: created.id,
    notify: { parent: parentData, password: plainPassword },
  };
};

async function findDuplicateStudent(params: {
  name: string;
  phone?: string | null;
  email?: string | null;
  parentId?: string | null;
  parentPhone?: string | null;
  excludeStudentId?: string;
}): Promise<{ message: string; existing: { id: string; name: string; regNo: string } } | null> {
  const { name, phone, email, parentId, parentPhone, excludeStudentId } = params;
  const normalizedName = normalizePersonName(name);
  if (!normalizedName) return null;

  const exclude = excludeStudentId ? { id: { not: excludeStudentId } } : {};

  if (phone?.trim()) {
    const candidates = phoneCandidates(phone);
    const byPhone = await prisma.student.findFirst({
      where: {
        ...exclude,
        OR: candidates.map((p) => ({ phone: p })),
      },
      select: { id: true, name: true, regNo: true },
    });
    if (byPhone) {
      return {
        message: `A student with this phone already exists (${byPhone.name} · ${byPhone.regNo})`,
        existing: byPhone,
      };
    }
  }

  if (email?.trim()) {
    const byEmail = await prisma.student.findFirst({
      where: {
        ...exclude,
        email: { equals: email.trim(), mode: 'insensitive' },
      },
      select: { id: true, name: true, regNo: true },
    });
    if (byEmail) {
      return {
        message: `A student with this email already exists (${byEmail.name} · ${byEmail.regNo})`,
        existing: byEmail,
      };
    }
  }

  let resolvedParentId = parentId || null;
  if (!resolvedParentId && parentPhone?.trim()) {
    const parent = await prisma.parent.findFirst({
      where: { phone: { in: phoneCandidates(parentPhone) } },
      select: { id: true },
    });
    resolvedParentId = parent?.id || null;
  }

  if (resolvedParentId) {
    const siblings = await prisma.student.findMany({
      where: { ...exclude, parentId: resolvedParentId },
      select: { id: true, name: true, regNo: true },
    });
    const match = siblings.find((s) => normalizePersonName(s.name) === normalizedName);
    if (match) {
      return {
        message: `This student is already registered under this parent (${match.name} · ${match.regNo}). Update the existing record instead of creating a new one.`,
        existing: match,
      };
    }
  }

  return null;
}

const parseDateOfBirth = (value: unknown): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_DOB');
  return date;
};

const parseFingerprintTemplate = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('INVALID_FINGERPRINT');
  const trimmed = value.trim();
  if (!trimmed) return null;
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length < 32) throw new Error('INVALID_FINGERPRINT');
  return trimmed;
};

// ─── POST /api/students/check-fingerprint ─────────────────────────────────────
router.post('/check-fingerprint', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { fingerprintTemplate, excludeStudentId, biometric } = req.body;
  try {
    const template = parseFingerprintTemplate(fingerprintTemplate);
    if (!template) {
      return res.status(422).json({ message: 'fingerprintTemplate is required' });
    }
    const result = await checkFingerprintUnique(template, excludeStudentId || undefined, {
      biometric: biometric !== false,
    });
    if (!result.unique) {
      return res.status(409).json({
        unique: false,
        message: result.message,
        matchedStudent: result.matchedStudent,
      });
    }
    return res.json({ unique: true });
  } catch {
    return res.status(422).json({ message: 'Invalid fingerprint template' });
  }
});

// ─── POST /api/students/login ─────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const { regNo, password } = req.body;
  if (!regNo || !password) {
    return res.status(422).json({ message: 'Registration number and password are required' });
  }
  try {
    const student = await prisma.student.findUnique({ where: { regNo } });
    if (!student) {
      return res.status(401).json({ message: 'Invalid registration number or password' });
    }
    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid registration number or password' });
    }

    const token = signToken({ id: student.id, regNo: student.regNo, role: 'student', name: student.name });

    await logAuditEvent({
      eventType: 'login',
      userType: 'student',
      userId: student.id,
      userName: student.name,
      userEmail: undefined,
      action: 'Student login',
      description: `Student ${student.regNo} logged in`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ token, id: student.id, _id: student.id, name: student.name, regNo: student.regNo });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/students ────────────────────────────────────────────────────────
router.get('/', ensureAdmin, async (_req: Request, res: Response): Promise<any> => {
  try {
    // Guarantee every student has the system registration fee deducted.
    try {
      await backfillMissingRegistrationFees();
    } catch (err: any) {
      console.error('Registration fee backfill on list error:', err?.message || err);
    }

    const students = await prisma.student.findMany({
      orderBy: { createdAt: 'desc' },
      select: studentListSelect,
    });
    return res.json(students.map(fmt));
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/students ───────────────────────────────────────────────────────
router.post('/', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const {
    name, regNo, phone, email, gender, dateOfBirth, course, className, category, password,
    parentId, parentRelationship, parent: parentInfo, fingerprintTemplate,
  } = req.body;
  if (!name || !gender) {
    return res.status(422).json({ message: 'Name and gender are required' });
  }
  try {
    const finalRegNo = (regNo?.trim() || await generateRegNo());

    const existing = await prisma.student.findUnique({ where: { regNo: finalRegNo } });
    if (existing) {
      return res.status(409).json({ message: 'A student with this admission number already exists' });
    }

    const duplicate = await findDuplicateStudent({
      name,
      phone,
      email,
      parentId,
      parentPhone: parentInfo?.phone,
    });
    if (duplicate) {
      return res.status(409).json({ message: duplicate.message, existingStudent: duplicate.existing });
    }

    let parsedDob: Date | null = null;
    try {
      const parsed = parseDateOfBirth(dateOfBirth);
      if (parsed) parsedDob = parsed;
    } catch {
      return res.status(422).json({ message: 'Invalid date of birth' });
    }

    let parsedFingerprint: string | null = null;
    try {
      const parsed = parseFingerprintTemplate(fingerprintTemplate);
      if (parsed) parsedFingerprint = parsed;
    } catch {
      return res.status(422).json({ message: 'Invalid fingerprint template' });
    }

    if (parsedFingerprint) {
      try {
        await assertFingerprintUnique(parsedFingerprint);
      } catch (err) {
        if (err instanceof FingerprintDuplicateError) {
          return res.status(409).json({ message: err.message, matchedStudent: err.matchedStudent });
        }
        throw err;
      }
    }

    let parentResolved;
    try {
      parentResolved = await resolveParentId(parentId, parentInfo);
    } catch (err: any) {
      if (err?.code === 'PARENT_EMAIL_EXISTS') {
        return res.status(409).json({
          message: `A parent with this email already exists (${err.parent?.name || 'existing parent'}). Use their phone number to link instead.`,
        });
      }
      throw err;
    }
    const finalParentId = parentResolved.parentId;

    if (finalParentId) {
      const duplicateUnderParent = await findDuplicateStudent({
        name,
        parentId: finalParentId,
      });
      if (duplicateUnderParent) {
        return res.status(409).json({
          message: duplicateUnderParent.message,
          existingStudent: duplicateUnderParent.existing,
        });
      }
    }

    const plainPassword = password || finalRegNo.slice(-6);
    const hashed = await bcrypt.hash(plainPassword, 10);
    const defaultPin = await defaultWalletPinData();
    const student = await prisma.student.create({
      data: {
        name,
        regNo: finalRegNo,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        gender,
        dateOfBirth: parsedDob,
        course: course?.trim() || null,
        className: className?.trim() || null,
        category: category?.trim() || 'regular',
        parentRelationship: parentRelationship?.trim() || null,
        password: hashed,
        parentId: finalParentId,
        ...defaultPin,
        ...fingerprintEnrollmentData(parsedFingerprint),
      },
      select: studentDetailSelect,
    });

    try {
      await ensureSystemRegistrationFee(student.id);
    } catch (err: any) {
      console.error('Registration fee error:', err?.message || err);
    }

    const studentWithFee = await prisma.student.findUnique({
      where: { id: student.id },
      select: studentDetailSelect,
    });

    if (parentResolved.notify && finalParentId) {
      try {
        await sendParentWelcomeNotifications({
          parent: parentResolved.notify.parent,
          password: parentResolved.notify.password,
          students: [{ name: student.name, regNo: student.regNo }],
        });
      } catch (err: any) {
        console.error('Parent welcome notification error:', err?.message || err);
      }
    }

    await logAuditEvent({
      eventType: 'student_created',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Create Student',
      description: `Created student ${name} (${finalRegNo})${parsedFingerprint ? ' with fingerprint' : ''}`,
      metadata: {
        regNo: finalRegNo,
        hasFingerprint: Boolean(parsedFingerprint),
        registrationFee: REGISTRATION_FEE_KES,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json(fmt(studentWithFee || student));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/students/me ─────────────────────────────────────────────────────
router.get('/me', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (req.user!.role !== 'student') {
    return res.status(403).json({ message: 'Student access only' });
  }
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, name: true, regNo: true,
        phone: true, gender: true, className: true, course: true, category: true, parentRelationship: true,
        walletBalance: true, walletFrozen: true,
        dailySpendLimit: true, weeklySpendLimit: true, createdAt: true,
        walletPinSetAt: true, fingerprintTemplate: true,
        parent: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    return res.json(fmt(student));
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/students/search ─────────────────────────────────────────────────
router.get('/search', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const query = String(req.query.q || '').trim();
  if (query.length < 2) {
    return res.json([]);
  }

  try {
    const students = await prisma.student.findMany({
      where: {
        OR: [
          { regNo: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: posStudentSelect,
      take: 25,
    });

    const ranked = rankStudentSearch(students, query).slice(0, 8);
    return res.json(ranked.map(toPosStudent));
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/students/lookup/:regNo ─────────────────────────────────────────
router.get('/lookup/:regNo', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }
  try {
    const regNo = decodeURIComponent(req.params.regNo as string).trim();
    const student = await prisma.student.findFirst({
      where: { regNo: { equals: regNo, mode: 'insensitive' } },
      select: posStudentSelect,
    });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    return res.json(toPosStudent(student));
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/students/wallet-pins/backfill-default ─────────────────────────
router.post('/wallet-pins/backfill-default', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const pinData = await defaultWalletPinData();
    const result = await prisma.student.updateMany({
      where: { walletPinHash: null },
      data: pinData,
    });

    await logAuditEvent({
      eventType: 'wallet_pins_backfilled',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Backfill Default Wallet PINs',
      description: `Set default wallet PIN for ${result.count} student(s)`,
      metadata: { count: result.count },
      ipAddress: req.ip,
    });

    return res.json({ message: `Default wallet PIN set for ${result.count} student(s)`, count: result.count });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/students/registration-fees/ensure ──────────────────────────────
router.post('/registration-fees/ensure', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await backfillMissingRegistrationFees();

    await logAuditEvent({
      eventType: 'registration_fees_backfilled',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Ensure System Registration Fees',
      description: `Applied system registration fee (KES ${REGISTRATION_FEE_KES}) to ${result.applied} student(s)`,
      metadata: result,
      ipAddress: req.ip,
    });

    return res.json({
      message: `Registration fee applied to ${result.applied} student(s)`,
      ...result,
      fee: REGISTRATION_FEE_KES,
      description: REGISTRATION_FEE_DESCRIPTION,
    });
  } catch (error) {
    console.error('Registration fee backfill error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/students/:id/wallet-settings ────────────────────────────────────
router.get('/:id/wallet-settings', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        name: true,
        regNo: true,
        walletFrozen: true,
        dailySpendLimit: true,
        weeklySpendLimit: true,
        walletPinSetAt: true,
      },
    });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    return res.json({ ...student, pinEnabled: Boolean(student.walletPinSetAt) });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/students/:id/wallet-settings ────────────────────────────────────
router.put('/:id/wallet-settings', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { pin, resetPin } = req.body || {};

  try {
    const existing = await prisma.student.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, name: true, regNo: true },
    });
    if (!existing) return res.status(404).json({ message: 'Student not found' });

    let pinData: Awaited<ReturnType<typeof buildWalletPinUpdate>>;
    try {
      pinData = await buildWalletPinUpdate({ pin, resetPin });
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_PIN') {
        return res.status(422).json({ message: 'PIN must be exactly 4 digits' });
      }
      throw err;
    }

    if (!pinData.walletPinHash && resetPin !== true && !(typeof pin === 'string' && pin.trim())) {
      return res.status(422).json({ message: 'Provide a 4-digit PIN or resetPin: true' });
    }

    const updated = await prisma.student.update({
      where: { id: existing.id },
      data: pinData,
      select: {
        id: true,
        name: true,
        regNo: true,
        walletFrozen: true,
        dailySpendLimit: true,
        weeklySpendLimit: true,
        walletPinSetAt: true,
      },
    });

    await logAuditEvent({
      eventType: 'wallet_pin_updated',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: resetPin ? 'Reset Wallet PIN' : 'Update Wallet PIN',
      description: `${resetPin ? 'Reset' : 'Updated'} wallet PIN for ${updated.name} (${updated.regNo})`,
      metadata: { studentId: updated.id, resetPin: Boolean(resetPin) },
      ipAddress: req.ip,
    });

    return res.json({ ...updated, pinEnabled: Boolean(updated.walletPinSetAt) });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/students/:id/enrolled-fingerprint — POS local verify (staff only)
router.get('/:id/enrolled-fingerprint', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'restaurant', 'finance'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, fingerprintTemplate: true },
    });
    if (!student?.fingerprintTemplate) {
      return res.status(404).json({ message: 'Student has no fingerprint enrolled' });
    }
    return res.json({ fingerprintTemplate: student.fingerprintTemplate });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/students/:id/fingerprint ────────────────────────────────────────
router.put('/:id/fingerprint', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { fingerprintTemplate } = req.body;
  try {
    let parsed: string;
    try {
      const value = parseFingerprintTemplate(fingerprintTemplate);
      if (!value) {
        return res.status(422).json({ message: 'fingerprintTemplate is required' });
      }
      parsed = value;
    } catch {
      return res.status(422).json({ message: 'Invalid fingerprint template' });
    }

    try {
      await assertFingerprintUnique(parsed, req.params.id as string);
    } catch (err) {
      if (err instanceof FingerprintDuplicateError) {
        return res.status(409).json({ message: err.message, matchedStudent: err.matchedStudent });
      }
      throw err;
    }

    const student = await prisma.student.update({
      where: { id: req.params.id as string },
      data: fingerprintEnrollmentData(parsed),
      select: studentDetailSelect,
    });

    await logAuditEvent({
      eventType: 'fingerprint_enrolled',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Enroll Fingerprint',
      description: `Enrolled fingerprint for ${student.name} (${student.regNo})`,
      metadata: { studentId: student.id, regNo: student.regNo },
      ipAddress: req.ip,
    });

    return res.json(fmt(student));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Student not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── DELETE /api/students/:id/fingerprint ─────────────────────────────────────
router.delete('/:id/fingerprint', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const student = await prisma.student.update({
      where: { id: req.params.id as string },
      data: fingerprintEnrollmentData(null),
      select: studentDetailSelect,
    });

    await logAuditEvent({
      eventType: 'fingerprint_removed',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Remove Fingerprint',
      description: `Removed fingerprint for ${student.name} (${student.regNo})`,
      ipAddress: req.ip,
    });

    return res.json(fmt(student));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Student not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});
router.get('/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: (req.params.id as string) },
      select: { id: true, name: true, regNo: true, phone: true, gender: true, createdAt: true },
    });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    return res.json(fmt(student));
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/students/:id ────────────────────────────────────────────────────
router.put('/:id', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const {
    name, phone, email, gender, dateOfBirth, course, className, category, password,
    parentId, parentRelationship, parent: parentInfo, fingerprintTemplate,
  } = req.body;
  try {
    const current = await prisma.student.findUnique({
      where: { id: req.params.id as string },
      select: { parentId: true },
    });
    if (!current) return res.status(404).json({ message: 'Student not found' });

    const data: any = {};
    let parentResolvedForNotify: Awaited<ReturnType<typeof resolveParentId>> | null = null;
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone?.trim() || null;
    if (email !== undefined) data.email = email?.trim() || null;
    if (gender !== undefined) data.gender = gender;
    if (course !== undefined) data.course = course?.trim() || null;
    if (className !== undefined) data.className = className?.trim() || null;
    if (category !== undefined) data.category = category?.trim() || 'regular';
    if (parentRelationship !== undefined) data.parentRelationship = parentRelationship?.trim() || null;
    if (password) data.password = await bcrypt.hash(password, 10);

    if (dateOfBirth !== undefined) {
      try {
        data.dateOfBirth = parseDateOfBirth(dateOfBirth);
      } catch {
        return res.status(422).json({ message: 'Invalid date of birth' });
      }
    }

    if (parentId !== undefined || parentInfo) {
      try {
        parentResolvedForNotify = await resolveParentId(parentId, parentInfo, current.parentId);
      } catch (err: any) {
        if (err?.code === 'PARENT_EMAIL_EXISTS') {
          return res.status(409).json({
            message: `A parent with this email already exists (${err.parent?.name || 'existing parent'}). Use their phone number to link instead.`,
          });
        }
        throw err;
      }
      data.parentId = parentResolvedForNotify.parentId;
    }

    const nextName = name !== undefined ? name : undefined;
    const nextPhone = phone !== undefined ? phone?.trim() || null : undefined;
    const nextEmail = email !== undefined ? email?.trim() || null : undefined;
    const nextParentId =
      data.parentId !== undefined ? data.parentId : current.parentId;

    if (nextName !== undefined || nextPhone !== undefined || nextEmail !== undefined || parentId !== undefined || parentInfo) {
      const currentFull = await prisma.student.findUnique({
        where: { id: req.params.id as string },
        select: { name: true, phone: true, email: true, parentId: true },
      });
      const duplicate = await findDuplicateStudent({
        name: nextName ?? currentFull?.name ?? '',
        phone: nextPhone !== undefined ? nextPhone : currentFull?.phone,
        email: nextEmail !== undefined ? nextEmail : currentFull?.email,
        parentId: nextParentId,
        parentPhone: parentInfo?.phone,
        excludeStudentId: req.params.id as string,
      });
      if (duplicate) {
        return res.status(409).json({ message: duplicate.message, existingStudent: duplicate.existing });
      }
    }

    if (fingerprintTemplate !== undefined) {
      try {
        const parsed = parseFingerprintTemplate(fingerprintTemplate);
        if (parsed === undefined) {
          return res.status(422).json({ message: 'Invalid fingerprint template' });
        }
        if (parsed) {
          try {
            await assertFingerprintUnique(parsed, req.params.id as string);
          } catch (err) {
            if (err instanceof FingerprintDuplicateError) {
              return res.status(409).json({ message: err.message, matchedStudent: err.matchedStudent });
            }
            throw err;
          }
        }
        Object.assign(data, fingerprintEnrollmentData(parsed));
      } catch {
        return res.status(422).json({ message: 'Invalid fingerprint template' });
      }
    }

    const student = await prisma.student.update({
      where: { id: (req.params.id as string) },
      data,
      select: studentDetailSelect,
    });

    if (parentResolvedForNotify?.notify && data.parentId) {
      try {
        await sendParentWelcomeNotifications({
          parent: parentResolvedForNotify.notify.parent,
          password: parentResolvedForNotify.notify.password,
          students: [{ name: student.name, regNo: student.regNo }],
        });
      } catch (err: any) {
        console.error('Parent welcome notification error:', err?.message || err);
      }
    }

    await logAuditEvent({
      eventType: 'student_updated',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Update Student',
      description: `Updated student ${student.name} (${student.regNo})`,
      ipAddress: req.ip,
    });

    return res.json(fmt(student));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Student not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── DELETE /api/students/:id ─────────────────────────────────────────────────
router.delete('/:id', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    const student = await prisma.$transaction(async (tx) => {
      await tx.walletTransaction.deleteMany({ where: { studentId: id } });

      const posTransactions = await tx.posTransaction.findMany({
        where: { studentId: id },
        select: { id: true },
      });
      if (posTransactions.length > 0) {
        await tx.posTransactionItem.deleteMany({
          where: { transactionId: { in: posTransactions.map((t) => t.id) } },
        });
        await tx.posTransaction.deleteMany({ where: { studentId: id } });
      }

      return tx.student.delete({ where: { id } });
    });

    await logAuditEvent({
      eventType: 'student_deleted',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Delete Student',
      description: `Deleted student ${student.name} (${student.regNo})`,
      ipAddress: req.ip,
    });

    return res.json({ message: 'Student deleted successfully' });
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Student not found' });
    if (error.code === 'P2003') {
      return res.status(409).json({ message: 'Cannot delete student: related records still exist' });
    }
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
