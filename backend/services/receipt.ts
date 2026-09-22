const RECEIPT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const buildReceiptSuffix = (length = 6): string => {
  let suffix = '';
  for (let i = 0; i < length; i++) {
    suffix += RECEIPT_CHARS[Math.floor(Math.random() * RECEIPT_CHARS.length)];
  }
  return suffix;
};

export const displayReceiptNo = (tx: { receiptNo?: string | null; id: string }): string => {
  if (tx.receiptNo) return tx.receiptNo;
  const compact = tx.id.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `ORDER-${compact.slice(-6)}`;
};

export const generateReceiptNo = async (
  exists: (receiptNo: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const receiptNo = `ORDER-${buildReceiptSuffix(6)}`;
    if (!(await exists(receiptNo))) return receiptNo;
  }
  throw new Error('RECEIPT_NO_GENERATION_FAILED');
};
