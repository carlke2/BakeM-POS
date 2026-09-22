import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAuthenticated } from '@/middlewares/auth';
import { findStaffByFingerprint, parseFingerprintTemplate, parseFingerprintMatchScore, verifyStaffFingerprint } from '@/services/fingerprint';
import { logAuditEvent } from '@/services/audit';

const router = Router();

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function parseDateFilter(startDate?: string, endDate?: string) {
  const filter: { gte?: Date; lte?: Date } = {};
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) return null;
    filter.gte = startOfLocalDay(d);
  }
  if (endDate) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) return null;
    filter.lte = endOfLocalDay(d);
  }
  return filter;
}

async function nextAttendanceType(userId: string): Promise<'check_in' | 'check_out'> {
  const dayStart = startOfLocalDay(new Date());
  const dayEnd = endOfLocalDay(new Date());

  const lastToday = await prisma.staffAttendance.findFirst({
    where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { createdAt: 'desc' },
  });

  return lastToday?.type === 'check_in' ? 'check_out' : 'check_in';
}

// GET /api/attendance/staff — public terminal staff picker
router.get('/staff', async (_req: Request, res: Response): Promise<any> => {
  const dayStart = startOfLocalDay(new Date());
  const dayEnd = endOfLocalDay(new Date());

  try {
    const [users, todayRecords] = await Promise.all([
      prisma.user.findMany({
        where: { status: 'approved' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          fingerprintEnrolledAt: true,
          fingerprintTemplate: true,
        },
      }),
      prisma.staffAttendance.findMany({
        where: { createdAt: { gte: dayStart, lte: dayEnd } },
        orderBy: { createdAt: 'desc' },
        select: { userId: true, type: true, createdAt: true },
      }),
    ]);

    const lastByUser = new Map<string, { type: string; at: Date }>();
    for (const r of todayRecords) {
      if (!lastByUser.has(r.userId)) {
        lastByUser.set(r.userId, { type: r.type, at: r.createdAt });
      }
    }

    return res.json(
      users.map((u) => {
        const last = lastByUser.get(u.id);
        const hasFingerprint = Boolean(u.fingerprintTemplate);
        const lastType = last?.type ?? null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          hasFingerprint,
          lastTypeToday: lastType,
          lastAtToday: last?.at ?? null,
          nextAction: hasFingerprint
            ? lastType === 'check_in'
              ? 'check_out'
              : 'check_in'
            : null,
        };
      }),
    );
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// GET /api/attendance/staff/:userId/enrolled-fingerprint — terminal local verify
router.get('/staff/:userId/enrolled-fingerprint', async (req: Request, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.userId as string, status: 'approved' },
      select: { id: true, fingerprintTemplate: true },
    });
    if (!user?.fingerprintTemplate) {
      return res.status(404).json({ message: 'Fingerprint not enrolled for this staff member' });
    }
    return res.json({ fingerprintTemplate: user.fingerprintTemplate });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// POST /api/attendance/clock — public terminal (select profile + fingerprint scan)
router.post('/clock', async (req: Request, res: Response): Promise<any> => {
  const { fingerprintTemplate, userId, fingerprintMatchScore } = req.body;

  try {
    const template = parseFingerprintTemplate(fingerprintTemplate);
    if (!template) {
      return res.status(422).json({ message: 'fingerprintTemplate is required' });
    }

    let staff: { id: string; name: string; email: string; role: string } | null = null;

    if (userId) {
      const user = await prisma.user.findFirst({
        where: { id: String(userId), status: 'approved' },
        select: { id: true, name: true, email: true, role: true, fingerprintTemplate: true },
      });

      if (!user) {
        return res.status(404).json({ message: 'Staff member not found' });
      }
      if (!user.fingerprintTemplate) {
        return res.status(422).json({ message: 'Fingerprint not enrolled for this staff member. Contact admin.' });
      }

      const matchScore = parseFingerprintMatchScore(fingerprintMatchScore);
      const match = await verifyStaffFingerprint(user.id, template, { matchScore });
      if (!match) {
        return res.status(422).json({ message: 'Fingerprint did not match the selected profile. Try again.' });
      }

      staff = user;
    } else {
      const matched = await findStaffByFingerprint(template);
      if (!matched) {
        return res.status(404).json({ message: 'Fingerprint not recognized. Select your profile first or contact admin.' });
      }
      staff = matched;
    }

    const type = await nextAttendanceType(staff.id);

    const record = await prisma.staffAttendance.create({
      data: {
        userId: staff.id,
        type,
        source: 'fingerprint',
      },
    });

    await logAuditEvent({
      eventType: 'staff_attendance',
      userType: staff.role,
      userId: staff.id,
      userName: staff.name,
      userEmail: staff.email,
      action: type === 'check_in' ? 'Staff Check In' : 'Staff Check Out',
      description: `${staff.name} ${type === 'check_in' ? 'checked in' : 'checked out'} via fingerprint`,
      metadata: { attendanceId: record.id, type },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      message: type === 'check_in' ? 'Checked in successfully' : 'Checked out successfully',
      type,
      staff: { id: staff.id, name: staff.name, role: staff.role, email: staff.email },
      recordedAt: record.createdAt,
    });
  } catch (err: any) {
    if (err?.message === 'INVALID_FINGERPRINT') {
      return res.status(422).json({ message: 'Invalid fingerprint scan. Please try again.' });
    }
    console.error('Attendance clock error:', err);
    return res.status(500).json({ message: 'Could not record attendance' });
  }
});

// GET /api/attendance/records
router.get('/records', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'finance', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { startDate, endDate, userId } = req.query as Record<string, string>;
  const dateFilter = parseDateFilter(startDate, endDate);
  if (dateFilter === null) return res.status(422).json({ message: 'Invalid date range' });

  const createdAt =
    dateFilter && Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  try {
    const records = await prisma.staffAttendance.findMany({
      where: {
        ...(createdAt ? { createdAt } : {}),
        ...(userId ? { userId } : {}),
        ...(req.user!.role !== 'admin' && req.user!.role !== 'finance'
          ? { userId: req.user!.id }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return res.json(
      records.map((r) => ({
        id: r.id,
        type: r.type,
        source: r.source,
        date: r.createdAt,
        userId: r.userId,
        name: r.user.name,
        email: r.user.email,
        role: r.user.role,
      })),
    );
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// GET /api/attendance/today — summary for today
router.get('/today', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!['admin', 'finance', 'restaurant'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const dayStart = startOfLocalDay(new Date());
  const dayEnd = endOfLocalDay(new Date());

  try {
    const records = await prisma.staffAttendance.findMany({
      where: { createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    const byUser = new Map<
      string,
      { userId: string; name: string; role: string; email: string; events: { type: string; at: Date }[] }
    >();

    for (const r of records) {
      const key = r.userId;
      if (!byUser.has(key)) {
        byUser.set(key, {
          userId: r.userId,
          name: r.user.name,
          role: r.user.role,
          email: r.user.email,
          events: [],
        });
      }
      byUser.get(key)!.events.push({ type: r.type, at: r.createdAt });
    }

    const summary = [...byUser.values()].map((row) => {
      const sorted = [...row.events].sort((a, b) => a.at.getTime() - b.at.getTime());
      const last = sorted[sorted.length - 1];
      return {
        ...row,
        lastType: last?.type,
        lastAt: last?.at,
        checkIns: sorted.filter((e) => e.type === 'check_in').length,
        checkOuts: sorted.filter((e) => e.type === 'check_out').length,
      };
    });

    return res.json({
      date: dayStart.toISOString().slice(0, 10),
      totalEvents: records.length,
      staffPresent: summary.filter((s) => s.lastType === 'check_in').length,
      summary,
      recent: records.slice(0, 20).map((r) => ({
        id: r.id,
        type: r.type,
        date: r.createdAt,
        name: r.user.name,
        role: r.user.role,
      })),
    });
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
