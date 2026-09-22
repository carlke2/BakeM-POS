import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '@/services/prisma';
import { ensureAuthenticated, signToken } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import { isMailConfigured, sendPasswordResetCode } from '@/services/mail';
import { verifyParentPassword } from '@/services/parentAuth';

const router = Router();

const CODE_TTL_MS = 5 * 60 * 1000;
const RESET_ROLES = ['student', 'parent'] as const;
type ResetRole = (typeof RESET_ROLES)[number];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function looksLikeEmail(value: string) {
  return value.includes('@');
}

function looksLikePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function phoneCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  const candidates = new Set<string>([trimmed, digits].filter(Boolean));
  if (digits) {
    if (digits.startsWith('254') && digits.length >= 12) {
      candidates.add(`0${digits.slice(3)}`);
      candidates.add(`+${digits}`);
    } else if (digits.startsWith('0') && digits.length >= 10) {
      candidates.add(`254${digits.slice(1)}`);
      candidates.add(`+254${digits.slice(1)}`);
    } else if (digits.length === 9) {
      candidates.add(`0${digits}`);
      candidates.add(`254${digits}`);
      candidates.add(`+254${digits}`);
    }
  }
  return [...candidates];
}

function normalizeLoginIdentifier(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (looksLikeEmail(trimmed)) return normalizeEmail(trimmed);
  if (looksLikePhone(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('254') && digits.length >= 12) return `0${digits.slice(3)}`;
    if (digits.length === 9) return `0${digits}`;
    return digits.startsWith('0') ? digits : trimmed;
  }
  return trimmed;
}

async function passwordMatches(hash: string, password: string, opts?: { phoneMode?: boolean }) {
  const attempts = new Set<string>();
  const trimmed = String(password || '').trim();
  if (trimmed) attempts.add(trimmed);
  if (opts?.phoneMode) {
    for (const c of phoneCandidates(trimmed)) attempts.add(c);
  }
  for (const attempt of attempts) {
    if (attempt && (await bcrypt.compare(attempt, hash))) return true;
  }
  return false;
}

function generateCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

async function validateResetCode(email: string, role: ResetRole, code: string) {
  const normalized = normalizeEmail(email);
  const account = await findAccount(normalized, role);
  if (!account) {
    return { ok: false as const, message: 'Invalid or expired reset code' };
  }

  const reset = await prisma.passwordReset.findFirst({
    where: {
      email: normalized,
      role,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!reset) {
    return { ok: false as const, message: 'Invalid or expired reset code' };
  }

  const codeOk = await bcrypt.compare(String(code).trim(), reset.codeHash);
  if (!codeOk) {
    return { ok: false as const, message: 'Invalid or expired reset code' };
  }

  return { ok: true as const, resetId: reset.id, accountId: account.id };
}

async function findAccount(email: string, role: ResetRole) {
  if (role === 'parent') {
    return prisma.parent.findUnique({ where: { email } });
  }
  return prisma.student.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
}

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
// Role-intelligent login: identifier can be email, phone, or student regNo.
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const identifier = normalizeLoginIdentifier(
    String(req.body.identifier ?? req.body.email ?? req.body.phone ?? req.body.regNo ?? ''),
  );
  const password = String(req.body.password ?? '');

  if (!identifier || !password.trim()) {
    return res.status(422).json({ message: 'Identifier and password are required' });
  }

  const ipAddress = req.ip;
  const userAgent = req.headers['user-agent'];

  try {
    // Email → admin, staff (finance/restaurant), or parent by email
    if (looksLikeEmail(identifier)) {
      const email = normalizeEmail(identifier);

      const admin = await prisma.admin.findUnique({ where: { email } });
      if (admin) {
        const isMatch = await passwordMatches(admin.password, password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

        const token = signToken({ id: admin.id, email: admin.email, role: 'admin', name: admin.name });
        await logAuditEvent({
          eventType: 'login',
          userType: 'admin',
          userId: admin.id,
          userName: admin.name,
          userEmail: admin.email,
          action: 'Admin login',
          description: `Admin ${admin.email} logged in`,
          ipAddress,
          userAgent,
        });
        return res.json({
          token,
          id: admin.id,
          _id: admin.id,
          name: admin.name,
          email: admin.email,
          role: 'admin',
        });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        if (user.status !== 'approved') {
          const msgs: Record<string, string> = {
            pending: 'Your account is pending admin approval',
            rejected: 'Your account registration was rejected. Please contact the administrator for more information.',
          };
          return res.status(403).json({ message: msgs[user.status] || 'Account not active' });
        }
        const isMatch = await passwordMatches(user.password, password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

        const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
        await logAuditEvent({
          eventType: 'login',
          userType: user.role,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          action: 'User login',
          description: `${user.role} ${user.email} logged in`,
          ipAddress,
          userAgent,
        });
        return res.json({
          token,
          id: user.id,
          _id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        });
      }

      const parentByEmail = await prisma.parent.findUnique({ where: { email } });
      if (parentByEmail) {
        const isMatch = await verifyParentPassword(parentByEmail, password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

        const token = signToken({
          id: parentByEmail.id,
          phone: parentByEmail.phone || undefined,
          email: parentByEmail.email || undefined,
          role: 'parent',
          name: parentByEmail.name,
        });
        await logAuditEvent({
          eventType: 'login',
          userType: 'parent',
          userId: parentByEmail.id,
          userName: parentByEmail.name,
          userEmail: parentByEmail.email || undefined,
          action: 'Parent login',
          ipAddress,
          userAgent,
        });
        return res.json({
          token,
          id: parentByEmail.id,
          name: parentByEmail.name,
          email: parentByEmail.email,
          phone: parentByEmail.phone,
          role: 'parent',
        });
      }

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Phone → parent (if no parent match, fall through — numeric regNos can look like phones)
    if (looksLikePhone(identifier)) {
      const candidates = phoneCandidates(identifier);
      const parent = await prisma.parent.findFirst({
        where: { phone: { in: candidates } },
      });

      if (parent) {
        const isMatch = await verifyParentPassword(parent, password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

        const token = signToken({
          id: parent.id,
          phone: parent.phone || undefined,
          email: parent.email || undefined,
          role: 'parent',
          name: parent.name,
        });
        await logAuditEvent({
          eventType: 'login',
          userType: 'parent',
          userId: parent.id,
          userName: parent.name,
          userEmail: parent.email || undefined,
          action: 'Parent login',
          ipAddress,
          userAgent,
        });
        return res.json({
          token,
          id: parent.id,
          name: parent.name,
          email: parent.email,
          phone: parent.phone,
          role: 'parent',
        });
      }
    }

    // Student registration number
    const student = await prisma.student.findUnique({ where: { regNo: identifier } });
    if (!student) return res.status(401).json({ message: 'Invalid credentials' });

    const isMatch = await passwordMatches(student.password, password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const token = signToken({ id: student.id, regNo: student.regNo, role: 'student', name: student.name });
    await logAuditEvent({
      eventType: 'login',
      userType: 'student',
      userId: student.id,
      userName: student.name,
      action: 'Student login',
      description: `Student ${student.regNo} logged in`,
      ipAddress,
      userAgent,
    });
    return res.json({
      token,
      id: student.id,
      _id: student.id,
      name: student.name,
      regNo: student.regNo,
      walletBalance: student.walletBalance,
      role: 'student',
    });
  } catch (error) {
    console.error('Unified login error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/auth/session ─────────────────────────────────────────────────────
router.get('/session', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  const { id, role } = req.user!;

  try {
    switch (role) {
      case 'admin': {
        const admin = await prisma.admin.findUnique({
          where: { id },
          select: { id: true, name: true, email: true },
        });
        if (!admin) return res.status(401).json({ message: 'Session invalid' });
        return res.json({ user: { ...admin, role: 'admin' } });
      }
      case 'student': {
        const student = await prisma.student.findUnique({
          where: { id },
          select: { id: true, name: true, regNo: true, walletBalance: true },
        });
        if (!student) return res.status(401).json({ message: 'Session invalid' });
        return res.json({ user: { ...student, role: 'student' } });
      }
      case 'parent': {
        const parent = await prisma.parent.findUnique({
          where: { id },
          select: { id: true, name: true, email: true },
        });
        if (!parent) return res.status(401).json({ message: 'Session invalid' });
        return res.json({ user: { ...parent, role: 'parent' } });
      }
      case 'finance':
      case 'restaurant': {
        const user = await prisma.user.findUnique({
          where: { id },
          select: { id: true, name: true, email: true, role: true, status: true },
        });
        if (!user || user.role !== role) {
          return res.status(401).json({ message: 'Session invalid' });
        }
        if (user.status !== 'approved') {
          return res.status(403).json({ message: 'Account is not approved' });
        }
        return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
      }
      default:
        return res.status(401).json({ message: 'Session invalid' });
    }
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/auth/forgot-password/request ───────────────────────────────────
router.post('/forgot-password/request', async (req: Request, res: Response): Promise<any> => {
  const { email, role } = req.body as { email?: string; role?: string };

  if (!email?.trim() || !role) {
    return res.status(422).json({ message: 'Email and account type are required' });
  }
  if (!RESET_ROLES.includes(role as ResetRole)) {
    return res.status(422).json({ message: 'Password reset is only available for students and parents' });
  }
  if (!isMailConfigured()) {
    return res.status(503).json({ message: 'Email service is not configured on the server' });
  }

  const normalized = normalizeEmail(email);
  const resetRole = role as ResetRole;

  try {
    const account = await findAccount(normalized, resetRole);

    if (account) {
      const recent = await prisma.passwordReset.count({
        where: {
          email: normalized,
          role: resetRole,
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });
      if (recent >= 3) {
        return res.status(429).json({ message: 'Too many requests. Please try again later.' });
      }

      const code = generateCode();
      const codeHash = await bcrypt.hash(code, 10);

      await prisma.passwordReset.deleteMany({
        where: { email: normalized, role: resetRole, usedAt: null },
      });

      await prisma.passwordReset.create({
        data: {
          email: normalized,
          role: resetRole,
          codeHash,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });

      await sendPasswordResetCode(normalized, code, resetRole);
    }

    return res.json({
      message: 'If an account exists for this email, a 6-digit code has been sent. It expires in 5 minutes.',
    });
  } catch (err: any) {
    console.error('Forgot password request error:', err?.message || err);
    return res.status(500).json({ message: 'Could not send reset code. Please try again later.' });
  }
});

// ─── POST /api/auth/forgot-password/verify ────────────────────────────────────
router.post('/forgot-password/verify', async (req: Request, res: Response): Promise<any> => {
  const { email, role, code } = req.body as { email?: string; role?: string; code?: string };

  if (!email?.trim() || !role || !code) {
    return res.status(422).json({ message: 'Email, account type, and code are required' });
  }
  if (!RESET_ROLES.includes(role as ResetRole)) {
    return res.status(422).json({ message: 'Invalid account type' });
  }
  if (!/^\d{6}$/.test(String(code).trim())) {
    return res.status(422).json({ message: 'Enter the 6-digit code from your email' });
  }

  try {
    const result = await validateResetCode(normalizeEmail(email), role as ResetRole, code);
    if (!result.ok) {
      return res.status(422).json({ message: result.message });
    }
    return res.json({ message: 'Code verified' });
  } catch (err: any) {
    console.error('Forgot password verify error:', err?.message || err);
    return res.status(500).json({ message: 'Could not verify code. Please try again.' });
  }
});

// ─── POST /api/auth/forgot-password/reset ─────────────────────────────────────
router.post('/forgot-password/reset', async (req: Request, res: Response): Promise<any> => {
  const { email, role, code, newPassword, confirmPassword } = req.body as {
    email?: string;
    role?: string;
    code?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  if (!email?.trim() || !role || !code || !newPassword || !confirmPassword) {
    return res.status(422).json({ message: 'All fields are required' });
  }
  if (!RESET_ROLES.includes(role as ResetRole)) {
    return res.status(422).json({ message: 'Invalid account type' });
  }
  if (!/^\d{6}$/.test(String(code).trim())) {
    return res.status(422).json({ message: 'Enter the 6-digit code from your email' });
  }
  if (newPassword.length < 7) {
    return res.status(422).json({ message: 'Password must be at least 7 characters' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(422).json({ message: 'Passwords do not match' });
  }

  const normalized = normalizeEmail(email);
  const resetRole = role as ResetRole;

  try {
    const result = await validateResetCode(normalized, resetRole, code);
    if (!result.ok) {
      return res.status(422).json({ message: result.message });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    if (resetRole === 'parent') {
      await prisma.parent.update({
        where: { id: result.accountId },
        data: { password: passwordHash },
      });
    } else {
      await prisma.student.update({
        where: { id: result.accountId },
        data: { password: passwordHash },
      });
    }

    await prisma.passwordReset.update({
      where: { id: result.resetId },
      data: { usedAt: new Date() },
    });

    await prisma.passwordReset.deleteMany({
      where: { email: normalized, role: resetRole, usedAt: null },
    });

    return res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (err: any) {
    console.error('Forgot password reset error:', err?.message || err);
    return res.status(500).json({ message: 'Could not reset password. Please try again.' });
  }
});

export default router;
