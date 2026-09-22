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

export async function sendPasswordResetCode(email: string, code: string, role: 'student' | 'parent') {
  const transport = getTransport();
  const fromName = MAIL_FROM_NAME || 'SmartPOS';
  const { fromAddress, replyTo } = resolveFromAddress();

  const roleLabel = role === 'student' ? 'Student' : 'Parent';

  await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    replyTo,
    to: email,
    subject: `${fromName} - Password reset code`,
    text: [
      `Your ${roleLabel} portal password reset code is: ${code}`,
      '',
      'This code expires in 5 minutes.',
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1F44;margin:0 0 12px">${fromName}</h2>
        <p>Your <strong>${roleLabel}</strong> portal password reset code is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0A1F44;margin:24px 0">${code}</p>
        <p style="color:#666;font-size:14px">This code expires in <strong>5 minutes</strong>.</p>
        <p style="color:#999;font-size:12px">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

export function isMailConfigured(): boolean {
  return Boolean(MAIL_HOST && MAIL_USERNAME && MAIL_PASSWORD);
}

export async function sendParentWelcomeEmail(params: {
  to: string;
  parentName: string;
  password?: string;
  students: Array<{ name: string; regNo: string }>;
  siteUrl?: string;
}) {
  const transport = getTransport();
  const fromName = MAIL_FROM_NAME || 'SmartPOS';
  const { fromAddress, replyTo } = resolveFromAddress();
  const siteUrl = (params.siteUrl || process.env.FRONTEND_URL || 'https://betterfork.millenium.co.ke').replace(/\/$/, '');
  const loginUrl = siteUrl.includes('/login') ? siteUrl : `${siteUrl}/login`;

  const studentLines = (params.students || []).map((s) => `- ${s.name} (${s.regNo})`);
  const studentHtml = (params.students || [])
    .map((s) => `<li><strong>${escapeHtml(s.name)}</strong> (${escapeHtml(s.regNo)})</li>`)
    .join('');
  const passwordLine = params.password ? [`Password: ${params.password}`, ''] : [];
  const passwordHtml = params.password
    ? `
        <div style="background:#f5f7fb;border:1px solid #e5e9f2;border-radius:12px;padding:16px;margin:16px 0">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px">Password</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:1px;color:#0A1F44">${escapeHtml(params.password)}</div>
        </div>
      `
    : '';

  await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    replyTo,
    to: params.to,
    subject: `${fromName} - Parent account created`,
    text: [
      `Hello ${params.parentName},`,
      '',
      'Your parent portal account has been created.',
      ...passwordLine,
      passwordLine.length
        ? 'Tip: your password is your phone number unless you changed it.'
        : '',
      'Linked student(s):',
      ...(studentLines.length ? studentLines : ['- (none)']),
      '',
      `Login here: ${loginUrl}`,
      'Sign in with your phone number and password.',
      '',
      'Please keep this password safe.',
    ].filter((line, i, arr) => line !== '' || arr[i - 1] !== '').join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#0A1F44;margin:0 0 12px">${fromName}</h2>
        <p>Hello <strong>${escapeHtml(params.parentName)}</strong>,</p>
        <p>Your parent portal account has been created.</p>
        ${passwordHtml}
        <p style="margin:16px 0 6px">Linked student(s):</p>
        <ul style="margin:0;padding-left:18px">${studentHtml || '<li>(none)</li>'}</ul>
        <p style="margin:20px 0 8px">
          <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#0A1F44;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">
            Open Parent Portal
          </a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin:0">
          Or visit <a href="${escapeHtml(loginUrl)}" style="color:#0A1F44">${escapeHtml(loginUrl)}</a><br/>
          Sign in with your phone number and password.
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:18px">Please keep this password safe.</p>
      </div>
    `,
  });
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveFromAddress(): { fromAddress: string; replyTo?: string } {
  const username = String(MAIL_USERNAME || '').trim();
  const configuredFrom = String(MAIL_FROM_ADDRESS || '').trim();

  // Gmail SMTP often rejects "From" addresses that aren't the authenticated user / alias.
  const isGmail = String(MAIL_HOST || '').toLowerCase().includes('gmail');
  if (isGmail && configuredFrom && username && configuredFrom.toLowerCase() !== username.toLowerCase()) {
    return { fromAddress: username, replyTo: configuredFrom };
  }

  return { fromAddress: configuredFrom || username };
}
