import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'smartpos-secret-key';

export interface AuthPayload {
  id: string;
  email?: string;
  phone?: string;
  regNo?: string;
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
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const ensureAdmin = (req: Request, res: Response, next: NextFunction): any => {
  ensureAuthenticated(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

export const ensureFinanceOrAdmin = (req: Request, res: Response, next: NextFunction): any => {
  ensureAuthenticated(req, res, () => {
    if (!['admin', 'finance'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Admin or finance access required' });
    }
    next();
  });
};
