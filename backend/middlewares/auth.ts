import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'slowrise-secret-key';

export type StaffRole = 'owner' | 'cashier' | 'delivery';

const STAFF_ROLES = new Set<string>(['owner', 'cashier', 'delivery']);

export interface AuthPayload {
  id: string;
  email?: string;
  phone?: string;
  role: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const signToken = (payload: AuthPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const ensureAuthenticated = (req: Request, res: Response, next: NextFunction): any => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    if (!STAFF_ROLES.has(decoded.role)) {
      return res.status(403).json({ error: 'Staff access required' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/** Owner-only (full bakery management). */
export const ensureOwner = (req: Request, res: Response, next: NextFunction): any => {
  ensureAuthenticated(req, res, () => {
    if (req.user?.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }
    next();
  });
};

/** @deprecated use ensureOwner — kept for gradual import updates */
export const ensureAdmin = ensureOwner;

/** Owner access for finance endpoints. */
export const ensureFinanceOrAdmin = (req: Request, res: Response, next: NextFunction): any => {
  ensureAuthenticated(req, res, () => {
    if (req.user?.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }
    next();
  });
};

export function canManageOps(role: string | undefined): boolean {
  return role === 'owner' || role === 'cashier';
}

export function canManageBackoffice(role: string | undefined): boolean {
  return role === 'owner';
}
