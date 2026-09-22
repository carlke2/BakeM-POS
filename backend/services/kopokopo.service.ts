import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

const {
  KOPOKOPO_CLIENT_ID,
  KOPOKOPO_CLIENT_SECRET,
  KOPOKOPO_API_KEY,
  KOPOKOPO_BASE_URL,
  KOPOKOPO_TILL_NUMBER,
  KOPOKOPO_CALLBACK_URL,
} = process.env;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export const getAccessToken = async (): Promise<string> => {
  const now = Date.now();

  if (tokenCache && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const params = new URLSearchParams({
    client_id: KOPOKOPO_CLIENT_ID!,
    client_secret: KOPOKOPO_CLIENT_SECRET!,
    grant_type: 'client_credentials',
  });

  const response = await axios.post(
    `${KOPOKOPO_BASE_URL}/oauth/token`,
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SmartPOS/1.0',
      },
      timeout: 12_000,
    },
  );

  const { access_token, expires_in } = response.data as {
    access_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: access_token,
    expiresAt: now + expires_in * 1000,
  };

  console.log('[Kopokopo] Access token refreshed, expires in', expires_in, 's');
  return access_token;
};

export interface StkPushOptions {
  phone: string;
  amount: number;
  description?: string;
  callbackUrl?: string;
  studentId?: string;
  studentRegNo?: string;
  studentName?: string;
  purpose?: string;
  paymentId?: string;
}

export interface StkPushResult {
  location: string;
}

/** Kopokopo allows at most 5 metadata keys — keep only what callbacks need. */
function buildStkMetadata(opts: StkPushOptions): Record<string, string> {
  const purpose = opts.purpose || (opts.studentId ? 'wallet_topup' : 'general');
  const meta: Record<string, string> = {};

  if (opts.paymentId) meta.payment_id = opts.paymentId;
  meta.purpose = purpose;

  if (opts.studentId) meta.student_id = opts.studentId;

  if (opts.studentRegNo) {
    meta.student_reg_no = opts.studentRegNo;
  } else if (purpose === 'pos_sale' && !opts.studentId) {
    meta.student_reg_no = 'GUEST';
  }

  if (Object.keys(meta).length < 5) {
    if (purpose === 'pos_sale' && !opts.studentId) {
      meta.student_name = opts.studentName || 'Guest';
    } else if (opts.studentName && opts.studentId) {
      meta.student_name = opts.studentName;
    }
  }

  if (purpose === 'general' && opts.description && Object.keys(meta).length < 5) {
    meta.description = opts.description.slice(0, 100);
  }

  const keys = Object.keys(meta);
  if (keys.length > 5) {
    throw new Error(`Kopokopo metadata exceeds 5 keys (${keys.length})`);
  }

  return meta;
}

export const initiateSTKPush = async (opts: StkPushOptions): Promise<StkPushResult> => {
  const accessToken = await getAccessToken();
  const phone = formatKopoPhone(opts.phone);
  const metadata = buildStkMetadata(opts);

  const payload = {
    payment_channel: 'M-PESA STK Push',
    till_number: KOPOKOPO_TILL_NUMBER,
    subscriber: {
      phone_number: phone,
    },
    amount: {
      currency: 'KES',
      value: opts.amount,
    },
    metadata,
    _links: {
      callback_url: opts.callbackUrl || KOPOKOPO_CALLBACK_URL,
    },
  };

  const response = await axios.post(
    `${KOPOKOPO_BASE_URL}/api/v2/incoming_payments`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SmartPOS/1.0',
      },
      timeout: 20_000,
    },
  );

  const location: string =
    response.headers['location'] ||
    response.data?._links?.self ||
    '';

  if (!location) {
    throw new Error('Kopokopo did not return a payment location URL');
  }

  return { location };
};

export interface PaymentStatus {
  status: string;
  amount?: number;
  currency?: string;
  reference?: string;
  originationTime?: string;
  phone?: string;
  raw?: object;
}

export const getPaymentStatus = async (location: string): Promise<PaymentStatus> => {
  const accessToken = await getAccessToken();

  const response = await axios.get(location, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'SmartPOS/1.0',
    },
    timeout: 12_000,
  });

  const data = response.data as any;
  const attrs = data?.data?.attributes ?? data?.attributes ?? {};
  const resource =
    attrs?.event?.resource && typeof attrs.event.resource === 'object'
      ? attrs.event.resource
      : {};

  const amountRaw = resource.amount ?? attrs.amount?.value ?? attrs.amount ?? 0;
  // Incoming Payment lifecycle lives on attributes.status (Pending | Success | Failed).
  // resource.status ("Received") only appears after the customer completes M-Pesa.
  const mpesaRef = String(resource.reference || '').trim();
  const attrsStatus = String(attrs.status || '').trim();
  const resourceStatus = String(resource.status || '').trim();

  let status = attrsStatus || resourceStatus || 'Pending';
  // Never treat as paid without an M-Pesa receipt — avoids "success" before PIN.
  if (!mpesaRef) {
    const s = status.toLowerCase();
    if (s === 'success' || s === 'received' || s === 'complete' || s === 'completed' || s === 'paid') {
      status = 'Pending';
    }
  }

  return {
    status,
    amount: Number(amountRaw) || 0,
    currency: resource.currency ?? attrs.amount?.currency ?? 'KES',
    // Prefer M-Pesa receipt; do not fall back to Kopokopo payment UUID (that looked "paid" early)
    reference: mpesaRef || '',
    originationTime: resource.origination_time ?? attrs.origination_time ?? attrs.initiation_time,
    phone: resource.sender_phone_number ?? attrs.sender_phone_number ?? '',
    raw: data,
  };
};

export const subscribeWebhook = async (eventType: string, url: string): Promise<string> => {
  const accessToken = await getAccessToken();

  const payload = {
    event_type: eventType,
    url,
    scope: 'Till',
    scope_reference: KOPOKOPO_TILL_NUMBER,
  };

  const response = await axios.post(
    `${KOPOKOPO_BASE_URL}/api/v2/webhook_subscriptions`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SmartPOS/1.0',
      },
    },
  );

  return (
    response.headers['location'] ||
    response.data?._links?.self ||
    ''
  );
};

export const validateWebhookSignature = (
  rawBody: string | Buffer,
  signature: string,
): boolean => {
  if (!KOPOKOPO_API_KEY) return false;

  const expected = crypto
    .createHmac('sha256', KOPOKOPO_API_KEY)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
};

const formatKopoPhone = (phone: string): string => {
  if (phone.startsWith('+')) return phone;
  if (phone.startsWith('254')) return `+${phone}`;
  if (phone.startsWith('0')) return `+254${phone.substring(1)}`;
  return `+254${phone}`;
};
