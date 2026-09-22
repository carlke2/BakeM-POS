import axios from 'axios';
import '../loadEnv';

const consumerKey = () => (process.env.MPESA_CONSUMER_KEY || '').trim();
const consumerSecret = () => (process.env.MPESA_CONSUMER_SECRET || '').trim();
const shortCode = () => (process.env.MPESA_SHORTCODE || '').trim();
const passkey = () => (process.env.MPESA_PASSKEY || '').trim();
const callbackUrl = () => (process.env.MPESA_CALLBACK_URL || '').trim();
const transactionType = () =>
  (process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline').trim();
const partyB = () => (process.env.MPESA_PARTY_B || shortCode()).trim();

export function darajaBaseUrl(): string {
  const env = (process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
  if (env === 'production' || env === 'live') return 'https://api.safaricom.co.ke';
  return 'https://sandbox.safaricom.co.ke';
}

export function isDarajaConfigured(): boolean {
  return Boolean(consumerKey() && consumerSecret() && shortCode() && passkey() && callbackUrl());
}

export function darajaConfigError(): string | null {
  if (!consumerKey() || !consumerSecret()) return 'Set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in backend/.env';
  if (!shortCode()) return 'Set MPESA_SHORTCODE in backend/.env';
  if (!passkey()) return 'Set MPESA_PASSKEY in backend/.env';
  if (!callbackUrl()) return 'Set MPESA_CALLBACK_URL to a public URL Safaricom can reach';
  if (!callbackUrl().startsWith('https://')) return 'MPESA_CALLBACK_URL must be a public https URL';
  return null;
}

/** 2547XXXXXXXX */
export function formatMpesaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  throw new Error('Enter a valid Safaricom number, for example 07XXXXXXXX');
}

export function darajaTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
}

function stkPassword(timestamp: string): string {
  return Buffer.from(`${shortCode()}${passkey()}${timestamp}`).toString('base64');
}

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

export async function getDarajaToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) return tokenCache.accessToken;

  const basic = Buffer.from(`${consumerKey()}:${consumerSecret()}`).toString('base64');
  const response = await axios.get(`${darajaBaseUrl()}/oauth/v1/generate`, {
    params: { grant_type: 'client_credentials' },
    headers: { Authorization: `Basic ${basic}` },
    timeout: 15_000,
  });

  const accessToken = String(response.data?.access_token || '');
  const expiresIn = Number(response.data?.expires_in || 3600);
  if (!accessToken) throw new Error('Daraja did not return an access token');

  tokenCache = { accessToken, expiresAt: now + expiresIn * 1000 };
  return accessToken;
}

export interface DarajaStkResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export async function initiateDarajaStk(opts: {
  phone: string;
  amount: number;
  accountReference: string;
  description?: string;
}): Promise<DarajaStkResult> {
  const configError = darajaConfigError();
  if (configError) throw new Error(configError);

  const timestamp = darajaTimestamp();
  const token = await getDarajaToken();
  const phone = formatMpesaPhone(opts.phone);
  const amount = Math.round(opts.amount);
  if (amount < 1) throw new Error('Amount must be at least KES 1');

  const response = await axios.post(
    `${darajaBaseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortCode(),
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: transactionType(),
      Amount: amount,
      PartyA: phone,
      PartyB: partyB(),
      PhoneNumber: phone,
      CallBackURL: callbackUrl(),
      AccountReference: opts.accountReference.slice(0, 12),
      TransactionDesc: (opts.description || 'Slow Rise Co').slice(0, 13),
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20_000,
    },
  );

  const data = response.data || {};
  if (String(data.ResponseCode) !== '0' || !data.CheckoutRequestID) {
    throw new Error(data.ResponseDescription || data.errorMessage || 'Daraja STK push was rejected');
  }

  return {
    merchantRequestId: String(data.MerchantRequestID || ''),
    checkoutRequestId: String(data.CheckoutRequestID),
    responseCode: String(data.ResponseCode),
    responseDescription: String(data.ResponseDescription || ''),
    customerMessage: String(data.CustomerMessage || ''),
  };
}

export interface DarajaQueryResult {
  resultCode: string;
  resultDesc: string;
  pending: boolean;
  success: boolean;
  failed: boolean;
}

/** ResultCode 0 = paid. 1032 = cancelled. 1037 = timeout. Other non-zero = failed. Empty = still pending. */
export async function queryDarajaStk(checkoutRequestId: string): Promise<DarajaQueryResult> {
  const timestamp = darajaTimestamp();
  const token = await getDarajaToken();
  const response = await axios.post(
    `${darajaBaseUrl()}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: shortCode(),
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    },
  );

  const data = response.data || {};
  const resultCode = data.ResultCode === undefined || data.ResultCode === null ? '' : String(data.ResultCode);
  const resultDesc = String(data.ResultDesc || data.ResponseDescription || '');
  const pending = resultCode === '' || resultDesc.toLowerCase().includes('still under processing') || resultCode === '4999';
  return {
    resultCode,
    resultDesc,
    pending,
    success: resultCode === '0',
    failed: !pending && resultCode !== '0',
  };
}
