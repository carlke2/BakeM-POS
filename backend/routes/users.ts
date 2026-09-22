import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { signToken, ensureAdmin, ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import {
  FingerprintDuplicateError,
  assertFingerprintUnique,
  checkFingerprintUnique,
  fingerprintEnrollmentData,
  parseFingerprintTemplate,
} from '@/services/fingerprint';

const router = Router();

const fmt = (u: any) => ({
  ...u,
  _id: u.id,
  hasFingerprint: Boolean(u.fingerprintTemplate || u.fingerprintEnrolledAt),
  fingerprintTemplate: undefined,
});

const userListSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  rejectionReason: true,
  fingerprintEnrolledAt: true,
  fingerprintTemplate: true,
  createdAt: true,
} as const;

// ─── POST /api/users (admin create) ───────────────────────────────────────────
router.post('/', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { name, email, password, phone, role, status } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(422).json({ message: 'Name, email, password and role are required' });
  }

  const allowedRoles = ['finance', 'restaurant'];
  if (!allowedRoles.includes(role)) {
    return res.status(422).json({ message: 'Role must be finance or restaurant' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ message: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name, email, password: hashed, phone, role,
        status: status === 'pending' ? 'pending' : 'approved',
      },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true },
    });

    await logAuditEvent({
      eventType: 'user_created',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Create Staff User',
      description: `Admin created ${role} account for ${name} (${email})`,
      metadata: { role },
      ipAddress: req.ip,
    });

    return res.status(201).json(fmt(user));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/users/register ─────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response): Promise<any> => {
  const { name, email, password, phone, role,  } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(422).json({ message: 'Name, email, password and role are required' });
  }

  const allowedRoles = ['finance', 'restaurant'];
  if (!allowedRoles.includes(role)) {
    return res.status(422).json({ message: 'Invalid role' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, phone, role,  status: 'pending' },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });

    await logAuditEvent({
      eventType: 'user_registered',
      userType: role,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'User Registration',
      description: `New ${role} account registered - pending admin approval`,
      metadata: { role },
      ipAddress: req.ip,
    });

    return res.status(201).json(fmt(user));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/users/login ────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(422).json({ message: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (role && user.role !== role) {
      return res.status(401).json({ message: `No ${role} account found with this email` });
    }
    if (user.status !== 'approved') {
      const msgs: Record<string, string> = {
        pending: 'Your account is pending admin approval',
        rejected: 'Your account registration was rejected. Please contact the administrator for more information.',
      };
      return res.status(403).json({ message: msgs[user.status] || 'Account not active' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });

    await logAuditEvent({
      eventType: 'login',
      userType: user.role,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'User login',
      description: `${user.role} ${user.email} logged in`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ token, id: user.id, _id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', ensureAdmin, async (_req: Request, res: Response): Promise<any> => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: userListSelect,
    });
    return res.json(users.map(fmt));
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/users/check-fingerprint ────────────────────────────────────────
router.post('/check-fingerprint', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { fingerprintTemplate, excludeUserId, biometric } = req.body;
  try {
    const template = parseFingerprintTemplate(fingerprintTemplate);
    if (!template) {
      return res.status(422).json({ message: 'fingerprintTemplate is required' });
    }

    const result = await checkFingerprintUnique(template, { userId: excludeUserId }, {
      biometric: biometric !== false,
    });

    if (!result.unique) {
      return res.status(409).json({
        unique: false,
        message: result.message,
        matchedStudent: result.matchedStudent,
        matchedUser: result.matchedUser,
      });
    }

    return res.json({ unique: true });
  } catch (err: any) {
    if (err instanceof FingerprintDuplicateError) {
      return res.status(409).json({
        unique: false,
        message: err.message,
        matchedStudent: err.matchedStudent,
        matchedUser: err.matchedUser,
      });
    }
    if (err?.message === 'INVALID_FINGERPRINT') {
      return res.status(422).json({ message: 'Invalid fingerprint template' });
    }
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/users/:id/fingerprint ───────────────────────────────────────────
router.put('/:id/fingerprint', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { fingerprintTemplate } = req.body;
  try {
    const parsed = parseFingerprintTemplate(fingerprintTemplate);
    if (!parsed) {
      return res.status(422).json({ message: 'fingerprintTemplate is required' });
    }

    await assertFingerprintUnique(parsed, { userId: req.params.id as string });

    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data: fingerprintEnrollmentData(parsed),
      select: userListSelect,
    });

    await logAuditEvent({
      eventType: 'fingerprint_enrolled',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Staff Fingerprint Enrolled',
      description: `Enrolled fingerprint for staff ${user.name} (${user.email})`,
      ipAddress: req.ip,
    });

    return res.json(fmt(user));
  } catch (err: any) {
    if (err instanceof FingerprintDuplicateError) {
      return res.status(409).json({ message: err.message, matchedUser: err.matchedUser, matchedStudent: err.matchedStudent });
    }
    if (err?.message === 'INVALID_FINGERPRINT') {
      return res.status(422).json({ message: 'Invalid fingerprint template' });
    }
    if (err.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── DELETE /api/users/:id/fingerprint ────────────────────────────────────────
router.delete('/:id/fingerprint', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data: fingerprintEnrollmentData(null),
      select: userListSelect,
    });

    await logAuditEvent({
      eventType: 'fingerprint_removed',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Staff Fingerprint Removed',
      description: `Removed fingerprint for staff ${user.name} (${user.email})`,
      ipAddress: req.ip,
    });

    return res.json(fmt(user));
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: (req.params.id as string) },
      select: {
        id: true, name: true, email: true, phone: true,
        role: true, status: true, createdAt: true,
      },
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(fmt(user));
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put('/:id', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { name, email, phone, password, role, status } = req.body;
  try {
    if (email) {
      const conflict = await prisma.user.findFirst({
        where: { email, id: { not: req.params.id as string } },
      });
      if (conflict) return res.status(409).json({ message: 'Another user uses this email' });
    }

    const data: any = {};
    if (name) data.name = name;
    if (email) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role && ['finance', 'restaurant'].includes(role)) data.role = role;
    if (status && ['pending', 'approved', 'rejected'].includes(status)) data.status = status;
    if (password) data.password = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true },
    });

    await logAuditEvent({
      eventType: 'user_updated',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Update Staff User',
      description: `Updated ${user.role} account for ${user.name}`,
      ipAddress: req.ip,
    });

    return res.json(fmt(user));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PATCH /api/users/:id/approve ─────────────────────────────────────────────
router.patch('/:id/approve', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.update({
      where: { id: (req.params.id as string) },
      data: { status: 'approved', rejectionReason: null },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    await logAuditEvent({
      eventType: 'user_approved',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Approve User',
      description: `Approved ${user.role} account for ${user.name} (${user.email})`,
      ipAddress: req.ip,
    });

    return res.json(fmt(user));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PATCH /api/users/:id/reject ──────────────────────────────────────────────
router.patch('/:id/reject', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { reason } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: (req.params.id as string) },
      data: { status: 'rejected', rejectionReason: reason || null },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    await logAuditEvent({
      eventType: 'user_rejected',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Reject User',
      description: `Rejected ${user.role} account for ${user.name} (${user.email})`,
      metadata: { reason },
      ipAddress: req.ip,
    });

    return res.json(fmt(user));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
router.delete('/:id', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.delete({ where: { id: (req.params.id as string) } });

    await logAuditEvent({
      eventType: 'user_deleted',
      userType: 'admin',
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      action: 'Delete User',
      description: `Deleted user ${user.name} (${user.email})`,
      ipAddress: req.ip,
    });

    return res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
