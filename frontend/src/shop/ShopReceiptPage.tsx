import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import shopApi from "@/shop/shopApi";
import { downloadOrderReceipt } from "@/lib/orderReceiptPdf";
import logo from "@/assets/LOGO.png";

type Receipt = {
  receiptNo: string;
  customerName: string;
  phone: string;
  paidAt: string;
  paymentMethod: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  total: number;
};

const ShopReceiptPage = () => {
  const { id } = useParams();
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    if (!id) return;
    shopApi.get(`/shop/orders/${id}/receipt`).then((response) => setReceipt(response.data));
  }, [id]);

  if (!receipt) return <p>Loading the receipt…</p>;

  const pdfData = {
    receiptNo: receipt.receiptNo,
    studentName: receipt.customerName,
    regNo: receipt.phone,
    items: receipt.items,
    total: receipt.total,
    paidAt: receipt.paidAt,
    paymentMethod: receipt.paymentMethod,
  };

  return (
    <div className="bg-white border border-[#E5C48D] rounded-xl p-6 max-w-md">
      <h1 className="text-2xl font-bold">{receipt.receiptNo}</h1>
      <p className="mt-2">{receipt.customerName}</p>
      <p className="text-sm">{receipt.phone}</p>
      <ul className="mt-4 space-y-1 text-sm">
        {receipt.items.map((item) => (
          <li key={item.name} className="flex justify-between"><span>{item.name} × {item.quantity}</span><span>KES {item.price * item.quantity}</span></li>
        ))}
      </ul>
      <p className="mt-4 font-semibold">Total KES {receipt.total}</p>
      <button className="mt-6 bg-[#B91D2D] text-white rounded-lg px-4 py-2" onClick={() => downloadOrderReceipt(pdfData, logo)}>
        Download receipt
      </button>
    </div>
  );
};

export default ShopReceiptPage;
