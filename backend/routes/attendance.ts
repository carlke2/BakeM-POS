import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '@/services/prisma';
import { ensureAuthenticated, canManageOps, AuthPayload } from '@/middlewares/auth';
import { logAuditEvent } from '@/services/audit';

const JWT_SECRET = process.env.JWT_SECRET || 'slowrise-secret-key';

function optionalUser(req: Request): AuthPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

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

async function clockUser(
  staff: { id: string; name: string; email: string; role: string },
  req: Request,
) {
  const type = await nextAttendanceType(staff.id);

  const record = await prisma.staffAttendance.create({
    data: {
      userId: staff.id,
      type,
      source: 'manual',
    },
  });

  await logAuditEvent({
    eventType: 'staff_attendance',
    userType: staff.role,
    userId: staff.id,
    userName: staff.name,
    userEmail: staff.email,
    action: type === 'check_in' ? 'Staff Check In' : 'Staff Check Out',
    description: `${staff.name} ${type === 'check_in' ? 'checked in' : 'checked out'} (manual)`,
    metadata: { attendanceId: record.id, type },
    ipAddress: req.ip,
  });

  return {
    message: type === 'check_in' ? 'Checked in successfully' : 'Checked out successfully',
    type,
    staff: { id: staff.id, name: staff.name, role: staff.role, email: staff.email },
    recordedAt: record.createdAt,
  };
}

// GET /api/attendance/staff — active staff with today's last check type
router.get('/staff', async (_req: Request, res: Response): Promise<any> => {
  const dayStart = startOfLocalDay(new Date());
  const dayEnd = endOfLocalDay(new Date());

  try {
    const [users, todayRecords] = await Promise.all([
      prisma.user.findMany({
        where: { status: 'active' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
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
        const lastType = last?.type ?? null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          lastTypeToday: lastType,
          lastAtToday: last?.at ?? null,
          nextAction: lastType === 'check_in' ? 'check_out' : 'check_in',
        };
      }),
    );
  } catch {
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

// POST /api/attendance/clock — body { userId } or authenticated self-clock
router.post('/clock', async (req: Request, res: Response): Promise<any> => {
  const bodyUserId = req.body?.userId ? String(req.body.userId) : null;
  const self = optionalUser(req);
  const targetId = bodyUserId || self?.id;

  if (!targetId) {
    return res.status(422).json({ message: 'userId is required' });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { id: targetId, status: 'active' },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    const result = await clockUser(user, req);
    return res.status(201).json(result);
  } catch (err) {
    console.error('Attendance clock error:', err);
    return res.status(500).json({ message: 'Could not record attendance' });
  }
});

// POST /api/attendance/me/clock — authenticated self clock-in/out
router.post('/me/clock', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!canManageOps(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user!.id, status: 'active' },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) return res.status(404).json({ message: 'Staff member not found' });

    const result = await clockUser(user, req);
    return res.status(201).json(result);
  } catch (err) {
    console.error('Self clock error:', err);
    return res.status(500).json({ message: 'Could not record attendance' });
  }
});

// GET /api/attendance/records
router.get('/records', ensureAuthenticated, async (req: Request, res: Response): Promise<any> => {
  if (!canManageOps(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { startDate, endDate, userId } = req.query as Record<string, string>;
  const dateFilter = parseDateFilter(startDate, endDate);
  if (dateFilter === null) return res.status(422).json({ message: 'Invalid date range' });

  const createdAt =
    dateFilter && Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  const isOwner = req.user!.role === 'owner';

  try {
    const records = await prisma.staffAttendance.findMany({
      where: {
        ...(createdAt ? { createdAt } : {}),
        ...(isOwner
          ? userId
            ? { userId }
            : {}
          : { userId: req.user!.id }),
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
  if (!canManageOps(req.user!.role)) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const dayStart = startOfLocalDay(new Date());
  const dayEnd = endOfLocalDay(new Date());
  const isOwner = req.user!.role === 'owner';

  try {
    const records = await prisma.staffAttendance.findMany({
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
        ...(isOwner ? {} : { userId: req.user!.id }),
      },
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
