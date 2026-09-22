import { isMailConfigured, sendParentWelcomeEmail } from '@/services/mail';
import { isSmsSendingEnabled, sendAdvantaSms } from '@/services/sms';

function parentPortalUrl(): string {
  const base = (process.env.FRONTEND_URL || 'https://betterfork.millenium.co.ke').replace(/\/$/, '');
  return `${base}/login`;
}

export async function sendParentWelcomeNotifications(params: {
  parent: { name: string; email?: string | null; phone?: string | null; receiveSms?: boolean; receiveEmail?: boolean };
  password?: string;
  students: Array<{ name: string; regNo: string }>;
}) {
  const { parent, password, students } = params;
  const siteUrl = parentPortalUrl();

  const jobs: Array<Promise<any>> = [];

  if (parent.receiveEmail !== false && parent.email && isMailConfigured()) {
    jobs.push(
      sendParentWelcomeEmail({
        to: parent.email,
        parentName: parent.name,
        password,
        students,
        siteUrl,
      }),
    );
  }

  if (parent.receiveSms !== false && parent.phone && isSmsSendingEnabled()) {
    const lines = [
      `Welcome ${parent.name}. Your Better Fork parent account is ready.`,
      `Login phone: ${parent.phone}`,
    ];
    if (password) lines.push(`Password: ${password} (your phone number)`);
    if (students.length) {
      const s = students.map((st) => `${st.name} (${st.regNo})`).join(', ');
      lines.push(`Student(s): ${s}`);
    }
    lines.push(`Open: ${siteUrl}`);
    jobs.push(sendAdvantaSms(parent.phone, lines.join('\n')));
  }

  const results = await Promise.allSettled(jobs);
  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r: any) => r.reason?.message || String(r.reason || 'Unknown error'));

  if (errors.length) {
    throw new Error(`Welcome notification failed: ${errors.join(' | ')}`);
  }
}

