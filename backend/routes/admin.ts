import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import { signToken, ensureAdmin } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';
import { sendParentWelcomeNotifications } from '@/services/parentWelcome';
import { isMailConfigured } from '@/services/mail';
import { isAdvantaSmsConfigured } from '@/services/sms';
import { getSystemSettings, setSystemSettings } from '@/services/systemSettings';

const router = Router();

// ─── POST /api/admin/login ────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(422).json({ message: 'Email and password are required' });
  }

  try {
    const admin = await prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = signToken({ id: admin.id, email: admin.email, role: 'admin', name: admin.name });

    // Audit log
    await logAuditEvent({
      eventType: 'login',
      userType: 'admin',
      userId: admin.id,
      userName: admin.name,
      userEmail: admin.email,
      action: 'Admin login',
      description: `Admin ${admin.email} logged in`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      token,
      id: admin.id,
      _id: admin.id,
      name: admin.name,
      email: admin.email,
      role: 'admin',
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/admin/profile ───────────────────────────────────────────────────
router.get('/profile', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    return res.json({ ...admin, _id: admin.id, role: 'admin' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/admin/profile ───────────────────────────────────────────────────
router.put('/profile', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { name, currentPassword, newPassword } = req.body;
  try {
    const admin = await prisma.admin.findUnique({ where: { id: req.user!.id } });
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    let passwordHash = admin.password;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(422).json({ message: 'Current password is required to set a new password' });
      }
      const isMatch = await bcrypt.compare(currentPassword, admin.password);
      if (!isMatch) {
        return res.status(422).json({ message: 'Current password is incorrect' });
      }
      passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.admin.update({
      where: { id: admin.id },
      data: { name: name || admin.name, password: passwordHash },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    return res.json({ ...updated, _id: updated.id, role: 'admin' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── GET /api/admin/settings ──────────────────────────────────────────────────
router.get('/settings', ensureAdmin, async (_req: Request, res: Response): Promise<any> => {
  try {
    const settings = getSystemSettings();
    return res.json({
      ...settings,
      smsConfigured: isAdvantaSmsConfigured(),
    });
  } catch (error) {
    console.error('Admin settings get error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── PUT /api/admin/settings ──────────────────────────────────────────────────
router.put('/settings', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { smsDisabled } = req.body || {};
    if (typeof smsDisabled !== 'boolean') {
      return res.status(422).json({ message: 'smsDisabled (boolean) is required' });
    }

    const settings = setSystemSettings({ smsDisabled });

    await logAuditEvent({
      eventType: 'settings',
      userType: 'admin',
      userId: req.user!.id,
      userName: req.user!.name || req.user!.email || 'Admin',
      userEmail: req.user!.email,
      action: smsDisabled ? 'Disable SMS' : 'Enable SMS',
      description: smsDisabled
        ? 'Admin disabled system-wide SMS'
        : 'Admin enabled system-wide SMS',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      ...settings,
      smsConfigured: isAdvantaSmsConfigured(),
    });
  } catch (error) {
    console.error('Admin settings put error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// ─── POST /api/admin/notifications/test ───────────────────────────────────────
router.post('/notifications/test', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  const { email, phone, parentName, password, studentName, studentRegNo, dryRun } = req.body || {};

  const config = {
    mailConfigured: isMailConfigured(),
    smsConfigured: isAdvantaSmsConfigured(),
    smsDisabled: getSystemSettings().smsDisabled,
  };

  try {
    if (!email && !phone) {
      return res.status(422).json({ message: 'Provide at least email or phone', config });
    }
    if (!password) {
      return res.status(422).json({ message: 'password is required', config });
    }

    if (dryRun === true) {
      return res.json({
        ok: true,
        dryRun: true,
        config,
        wouldSend: {
          email: Boolean(email && config.mailConfigured),
          sms: Boolean(phone && config.smsConfigured && !config.smsDisabled),
        },
      });
    }

    const parent = {
      name: String(parentName || 'Test Parent'),
      email: String(email || ''),
      phone: phone ? String(phone) : null,
      receiveEmail: true,
      receiveSms: true,
    };
    const students = [{
      name: String(studentName || 'Test Student'),
      regNo: String(studentRegNo || 'TEST-001'),
    }];

    await sendParentWelcomeNotifications({
      parent,
      password: String(password),
      students,
    });

    return res.json({ ok: true, config });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      config,
      error: err?.message || String(err),
    });
  }
});

export default router;
