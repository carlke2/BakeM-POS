export type OrderReceiptLine = {
  name: string;
  quantity: number;
  price: number;
};

export type OrderReceiptData = {
  receiptNo: string;
  studentName: string;
  regNo: string;
  items: OrderReceiptLine[];
  total: number;
  paidAt: string;
  paymentMethod?: string;
  /** Restaurant staff who processed the sale */
  servedBy?: string;
};
