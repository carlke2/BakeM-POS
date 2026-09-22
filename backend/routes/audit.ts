import { Router, Request, Response } from 'express';
import prisma from '@/services/prisma';
import { ensureAdmin } from '@/middlewares/auth';

const router = Router();

// ─── GET /api/audit/events ────────────────────────────────────────────────────
router.get('/events', ensureAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      eventType,
      userType,
      startDate,
      endDate,
      search,
      page = '1',
      limit = '50',
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};
    if (eventType) where.eventType = eventType;
    if (userType)  where.userType  = userType;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate)   where.timestamp.lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }
    if (search) {
      where.OR = [
        { userName:  { contains: search, mode: 'insensitive' } },
        { userEmail: { contains: search, mode: 'insensitive' } },
        { action:    { contains: search, mode: 'insensitive' } },
        { eventType: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    // Stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [todayCount, recentLogins, byEventTypeRaw, byUserTypeRaw] = await Promise.all([
      prisma.auditEvent.count({ where: { timestamp: { gte: todayStart } } }),
      prisma.auditEvent.count({ where: { eventType: 'login', timestamp: { gte: last24h } } }),
      prisma.auditEvent.groupBy({ by: ['eventType'], _count: { _all: true }, orderBy: { _count: { eventType: 'desc' } }, take: 10 }),
      prisma.auditEvent.groupBy({ by: ['userType'],  _count: { _all: true } }),
    ]);

    const byEventType = byEventTypeRaw.map(r => ({ _id: r.eventType, count: r._count._all }));
    const byUserType  = byUserTypeRaw.map(r => ({ _id: r.userType,  count: r._count._all }));

    return res.json({
      events: events.map(e => ({ ...e, _id: e.id })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
      stats: {
        total,
        today: todayCount,
        recentLogins,
        byEventType,
        byUserType,
      },
    });
  } catch (error) {
    console.error('Audit fetch error:', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

export default router;
