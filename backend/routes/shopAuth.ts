import { Router, Request, Response, NextFunction } from 'express';
import { verifyCustomerToken, CustomerToken } from '@/services/shopAuth';
import { requestShopOtp, verifyShopOtp } from '@/services/shopAuth';

const router = Router();

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerToken;
    }
  }
}

export function ensureCustomer(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const customer = verifyCustomerToken(header.split(' ')[1]);
  if (!customer) {
    res.status(401).json({ error: 'Customer sign-in required' });
    return;
  }
  req.customer = customer;
  next();
}

router.post('/request', async (req: Request, res: Response) => {
  try {
    const result = await requestShopOtp(String(req.body?.phone || ''));
    res.json({
      message: result.delivery === 'sms'
        ? 'We sent a code to your phone.'
        : 'The code was printed in the server terminal because SMS could not be sent.',
      delivery: result.delivery,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_PHONE') {
      res.status(422).json({ message: 'Enter a valid Safaricom number, for example 07XXXXXXXX' });
      return;
    }
    if (message === 'OTP_COOLDOWN') {
      const retryAfterSeconds = (error as Error & { retryAfterSeconds?: number }).retryAfterSeconds || 60;
      res.status(429).json({ message: `Wait ${retryAfterSeconds}s before requesting another code`, retryAfterSeconds });
      return;
    }
    if (message === 'OTP_HOURLY_LIMIT') {
      res.status(429).json({ message: 'Too many codes for this number. Try again in an hour.' });
      return;
    }
    console.error('[shop-otp] request failed', error);
    res.status(500).json({ message: 'Could not send a code' });
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const result = await verifyShopOtp(
      String(req.body?.phone || ''),
      String(req.body?.code || ''),
      typeof req.body?.name === 'string' ? req.body.name : undefined,
    );
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_PHONE') {
      res.status(422).json({ message: 'Enter a valid Safaricom number, for example 07XXXXXXXX' });
      return;
    }
    if (message === 'NAME_REQUIRED') {
      res.status(422).json({ message: 'Your name is required the first time you sign in' });
      return;
    }
    if (message === 'INVALID_CODE') {
      res.status(401).json({ message: 'That code is incorrect or has expired' });
      return;
    }
    console.error('[shop-otp] verify failed', error);
    res.status(500).json({ message: 'Could not verify the code' });
  }
});

router.get('/me', ensureCustomer, async (req: Request, res: Response) => {
  res.json({ customer: req.customer });
});

export default router;
