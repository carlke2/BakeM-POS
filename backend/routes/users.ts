import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { signToken, ensureOwner, ensureAuthenticated } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';

const router = Router();

const ALLOWED_ROLES = ['owner', 'cashier'] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

const fmt = (u: { id: string; [key: string]: unknown }) => ({ ...u, _id: u.id });

const userListSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

// ─── POST /api/users (owner create) ───────────────────────────────────────────
router.post('/', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const { name, email, password, phone, role, status } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(422).json({ message: 'Name, email, password and role are required' });
  }

  if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
    return res.status(422).json({ message: 'Role must be owner or cashier' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
    if (existing) return res.status(409).json({ message: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email: String(email).trim().toLowerCase(),
        password: hashed,
        phone,
        role,
        status: status === 'inactive' ? 'inactive' : 'active',
      },
      select: userListSelect,
    });

    await logAuditEvent({
      eventType: 'user_created',
      userType: 'owner',
      userId: req.user?.id,
      userName: req.user?.name || 'Owner',
      action: 'Create Staff User',
      description: `Owner created ${role} account for ${name} (${email})`,
      metadata: { role },
      ipAddress: req.ip,
    });

    return res.status(201).json(fmt(user));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/users/login (optional; auth.ts is primary) ─────────────────────
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role as string | undefined;

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
    if (!ALLOWED_ROLES.includes(user.role as AllowedRole)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
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
      role: user.role,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', ensureOwner, async (_req: Request, res: Response): Promise<any> => {
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

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id as string },
      select: userListSelect,
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (req.user!.role !== 'owner' && req.user!.id !== user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    return res.json(fmt(user));
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put('/:id', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const { name, email, phone, password, role, status } = req.body;
  try {
    if (email) {
      const conflict = await prisma.user.findFirst({
        where: { email: String(email).trim().toLowerCase(), id: { not: req.params.id as string } },
      });
      if (conflict) return res.status(409).json({ message: 'Another user uses this email' });
    }

    const data: Record<string, unknown> = {};
    if (name) data.name = name;
    if (email) data.email = String(email).trim().toLowerCase();
    if (phone !== undefined) data.phone = phone;
    if (role && ALLOWED_ROLES.includes(role as AllowedRole)) data.role = role;
    if (status && ['active', 'inactive'].includes(status)) data.status = status;
    if (password) data.password = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data,
      select: userListSelect,
    });

    await logAuditEvent({
      eventType: 'user_updated',
      userType: 'owner',
      userId: req.user?.id,
      userName: req.user?.name || 'Owner',
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

// ─── PATCH /api/users/:id/status ──────────────────────────────────────────────
router.patch('/:id/status', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const status = String(req.body.status || '').trim();
  if (!['active', 'inactive'].includes(status)) {
    return res.status(422).json({ message: 'status must be active or inactive' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data: { status },
      select: userListSelect,
    });

    await logAuditEvent({
      eventType: status === 'active' ? 'user_activated' : 'user_deactivated',
      userType: 'owner',
      userId: req.user?.id,
      userName: req.user?.name || 'Owner',
      action: status === 'active' ? 'Activate User' : 'Deactivate User',
      description: `Set ${user.name} (${user.email}) to ${status}`,
      ipAddress: req.ip,
    });

    return res.json(fmt(user));
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'User not found' });
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
router.delete('/:id', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  try {
    if (req.params.id === req.user!.id) {
      return res.status(422).json({ message: 'Cannot delete your own account' });
    }

    const user = await prisma.user.delete({ where: { id: req.params.id as string } });

    await logAuditEvent({
      eventType: 'user_deleted',
      userType: 'owner',
      userId: req.user?.id,
      userName: req.user?.name || 'Owner',
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
