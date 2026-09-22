import { Router, Request, Response } from 'express';
import { getScannerUrl } from '@/services/fingerprint';
import { ensureAdmin } from '@/middlewares/auth';

const router = Router();
const SCANNER_TIMEOUT_MS = 20_000;

const proxyToScanner = async (req: Request, res: Response, path: string, method: string) => {
  const scannerUrl = getScannerUrl();
  const qs = new URL(req.originalUrl, 'http://localhost').search;
  const url = `${scannerUrl}${path}${qs}`;

  try {
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(SCANNER_TIMEOUT_MS),
    };

    if (method !== 'GET' && method !== 'HEAD') {
      const hasBody = req.body && Object.keys(req.body).length > 0;
      if (hasBody) {
        init.body = JSON.stringify(req.body);
      }
    }

    const upstream = await fetch(url, init);
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(503).json({
      ok: false,
      message: `Fingerprint scanner unreachable at ${scannerUrl}. Ensure the service is running on the enrollment PC.`,
      detail: err?.message,
    });
  }
};

router.get('/health', (req, res) => proxyToScanner(req, res, '/health', 'GET'));
// Lock down scanner operations to admins (fingerprint templates are sensitive).
router.post('/prepare', ensureAdmin, (req, res) => proxyToScanner(req, res, '/prepare', 'POST'));
router.post('/capture', ensureAdmin, (req, res) => proxyToScanner(req, res, '/capture', 'POST'));
router.post('/check-duplicate', ensureAdmin, (req, res) => proxyToScanner(req, res, '/check-duplicate', 'POST'));

export default router;
