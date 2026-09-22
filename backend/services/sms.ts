import axios from 'axios';
import { isSmsGloballyDisabled } from '@/services/systemSettings';

const {
  ADVANTA_SMS_URL,
  ADVANTA_API_KEY,
  ADVANTA_PARTNER_ID,
  ADVANTA_SHORTCODE,
} = process.env;

export function isAdvantaSmsConfigured(): boolean {
  return Boolean(ADVANTA_SMS_URL && ADVANTA_API_KEY && ADVANTA_PARTNER_ID && ADVANTA_SHORTCODE);
}

/** Configured and not turned off by admin Settings → Disable SMS. */
export function isSmsSendingEnabled(): boolean {
  return isAdvantaSmsConfigured() && !isSmsGloballyDisabled();
}

export function normalizeKenyanMobile(raw: string): string | null {
  const v = String(raw || '').trim().replace(/\s+/g, '').replace(/^\+/, '');
  if (!v) return null;

  if (/^254\d{9,12}$/.test(v)) return v;
  if (/^0\d{9}$/.test(v)) return `254${v.slice(1)}`;
  if (/^7\d{8}$/.test(v)) return `254${v}`;

  const digits = v.replace(/\D/g, '');
  if (/^254\d{9,12}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `254${digits.slice(1)}`;

  return null;
}

export async function sendAdvantaSms(toPhone: string, message: string): Promise<void> {
  if (isSmsGloballyDisabled()) {
    throw new Error('SMS is disabled by admin');
  }
  if (!isAdvantaSmsConfigured()) {
    throw new Error('SMS is not configured. Set ADVANTA_SMS_URL, ADVANTA_API_KEY, ADVANTA_PARTNER_ID, ADVANTA_SHORTCODE');
  }

  const mobile = normalizeKenyanMobile(toPhone);
  if (!mobile) {
    throw new Error('Invalid mobile number');
  }

  // Advanta docs show JSON, but many gateways accept/expect form encoding.
  // Form encoding is generally the most compatible across deployments.
  const body = new URLSearchParams({
    apikey: String(ADVANTA_API_KEY),
    partnerID: String(ADVANTA_PARTNER_ID),
    message: String(message),
    shortcode: String(ADVANTA_SHORTCODE),
    mobile,
  });

  await axios.post(String(ADVANTA_SMS_URL), body.toString(), {
    timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  }).then((resp) => {
    if (resp.status < 200 || resp.status >= 300) {
      const respBody = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      throw new Error(`Advanta SMS failed (${resp.status}): ${respBody}`);
    }
  });
}

