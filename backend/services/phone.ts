/** Normalize Kenyan-style phone numbers into lookup candidates. */
export function phoneCandidates(raw: string | null | undefined): string[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/\D/g, '');
  const candidates = new Set<string>([trimmed]);
  if (digits) {
    candidates.add(digits);
    if (digits.startsWith('254') && digits.length >= 12) {
      candidates.add(`0${digits.slice(3)}`);
      candidates.add(`+${digits}`);
    } else if (digits.startsWith('0') && digits.length >= 10) {
      candidates.add(`254${digits.slice(1)}`);
      candidates.add(`+254${digits.slice(1)}`);
    } else if (digits.length === 9) {
      candidates.add(`0${digits}`);
      candidates.add(`254${digits}`);
      candidates.add(`+254${digits}`);
    }
  }
  return [...candidates];
}

export function normalizePersonName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
