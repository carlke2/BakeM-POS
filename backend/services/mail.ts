import nodemailer from 'nodemailer';

const {
  MAIL_HOST,
  MAIL_PORT,
  MAIL_USERNAME,
  MAIL_PASSWORD,
  MAIL_ENCRYPTION,
  MAIL_FROM_ADDRESS,
  MAIL_FROM_NAME,
} = process.env;

function getTransport() {
  if (!MAIL_HOST || !MAIL_USERNAME || !MAIL_PASSWORD) {
    throw new Error('Mail is not configured. Set MAIL_HOST, MAIL_USERNAME, and MAIL_PASSWORD in backend/.env');
  }

  const port = Number(MAIL_PORT || 587);
  const secure = MAIL_ENCRYPTION === 'ssl' || port === 465;

  return nodemailer.createTransport({
    host: MAIL_HOST,
    port,
    secure,
    auth: {
      user: MAIL_USERNAME,
      pass: MAIL_PASSWORD,
    },
  });
}

export function isMailConfigured(): boolean {
  return Boolean(MAIL_HOST && MAIL_USERNAME && MAIL_PASSWORD);
}

function resolveFromAddress(): { fromAddress: string; replyTo?: string } {
  const username = String(MAIL_USERNAME || '').trim();
  const configuredFrom = String(MAIL_FROM_ADDRESS || '').trim();

  const isGmail = String(MAIL_HOST || '').toLowerCase().includes('gmail');
  if (isGmail && configuredFrom && username && configuredFrom.toLowerCase() !== username.toLowerCase()) {
    return { fromAddress: username, replyTo: configuredFrom };
  }

  return { fromAddress: configuredFrom || username };
}

/** Optional helper for owner notifications (e.g. low stock alerts). */
export async function sendSimpleMail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  if (!isMailConfigured()) {
    throw new Error('Mail is not configured');
  }

  const transport = getTransport();
  const fromName = MAIL_FROM_NAME || 'Slow Rise Co';
  const { fromAddress, replyTo } = resolveFromAddress();

  await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    replyTo,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}
