import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { signToken, ensureOwner } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import { isMailConfigured } from '@/services/mail';
import { isAdvantaSmsConfigured } from '@/services/sms';
import { getSystemSettings, setSystemSettings } from '@/services/systemSettings';

const router = Router();

// ─── POST /api/admin/login ────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(422).json({ message: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.role !== 'owner') {
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
      role: 'owner',
      name: user.name,
      phone: user.phone || undefined,
    });

    await logAuditEvent({
      eventType: 'login',
      userType: 'owner',
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: 'Owner login',
      description: `Owner ${user.email} logged in`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      token,
      id: user.id,
      _id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: 'owner',
    });
  } catch (error) {
    console.error('Owner login error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/admin/profile ───────────────────────────────────────────────────
router.get('/profile', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user!.id, role: 'owner' },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });

    if (!user) return res.status(404).json({ message: 'Owner not found' });

    return res.json({ ...user, _id: user.id, role: 'owner' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/admin/profile ───────────────────────────────────────────────────
router.put('/profile', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  const { name, phone, currentPassword, newPassword } = req.body;
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user!.id, role: 'owner' },
    });
    if (!user) return res.status(404).json({ message: 'Owner not found' });

    let passwordHash = user.password;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(422).json({ message: 'Current password is required to set a new password' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(422).json({ message: 'Current password is incorrect' });
      }
      passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name || user.name,
        phone: phone !== undefined ? phone : user.phone,
        password: passwordHash,
      },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });

    return res.json({ ...updated, _id: updated.id, role: 'owner' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/admin/settings ──────────────────────────────────────────────────
router.get('/settings', ensureOwner, async (_req: Request, res: Response): Promise<any> => {
  try {
    const settings = getSystemSettings();
    return res.json({
      ...settings,
      smsConfigured: isAdvantaSmsConfigured(),
      mailConfigured: isMailConfigured(),
    });
  } catch (error) {
    console.error('Owner settings get error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/admin/settings ──────────────────────────────────────────────────
router.put('/settings', ensureOwner, async (req: Request, res: Response): Promise<any> => {
  try {
    const { smsDisabled } = req.body || {};
    if (typeof smsDisabled !== 'boolean') {
      return res.status(422).json({ message: 'smsDisabled (boolean) is required' });
    }

    const settings = setSystemSettings({ smsDisabled });

    await logAuditEvent({
      eventType: 'settings',
      userType: 'owner',
      userId: req.user!.id,
      userName: req.user!.name || req.user!.email || 'Owner',
      userEmail: req.user!.email,
      action: smsDisabled ? 'Disable SMS' : 'Enable SMS',
      description: smsDisabled
        ? 'Owner disabled system-wide SMS'
        : 'Owner enabled system-wide SMS',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      ...settings,
      smsConfigured: isAdvantaSmsConfigured(),
      mailConfigured: isMailConfigured(),
    });
  } catch (error) {
    console.error('Owner settings put error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/admin/notifications/test ───────────────────────────────────────
// Returns SMS/mail configuration status (no parent-welcome send).
router.post('/notifications/test', ensureOwner, async (_req: Request, res: Response): Promise<any> => {
  const config = {
    mailConfigured: isMailConfigured(),
    smsConfigured: isAdvantaSmsConfigured(),
    smsDisabled: getSystemSettings().smsDisabled,
  };

  return res.json({
    ok: true,
    config,
    message: config.mailConfigured || config.smsConfigured
      ? 'Notification channels are configured'
      : 'No mail or SMS credentials configured',
  });
});

export default router;
