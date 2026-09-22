export function displayReceiptNo(receipt: { receiptNo?: string | null; id: string }): string {
  if (receipt.receiptNo) return receipt.receiptNo;
  const compact = receipt.id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `ORDER-${compact.slice(-6)}`;
}
