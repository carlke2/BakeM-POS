import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { ensureAuthenticated, signToken } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';

const router = Router();

const STAFF_ROLES = new Set(['owner', 'cashier', 'delivery']);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const email = normalizeEmail(String(req.body.email ?? req.body.identifier ?? ''));
  const password = String(req.body.password ?? '');

  if (!email || !password.trim()) {
    return res.status(422).json({ message: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!STAFF_ROLES.has(user.role)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Account is inactive. Contact the owner.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      phone: user.phone || undefined,
    });

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

    return res.json({
      token,
      id: user.id,
      _id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/auth/session ─────────────────────────────────────────────────────
router.get('/session', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  const { id, role } = req.user!;

  if (!STAFF_ROLES.has(role)) {
    return res.status(401).json({ message: 'Session invalid' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true },
    });

    if (!user || user.role !== role) {
      return res.status(401).json({ message: 'Session invalid' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
