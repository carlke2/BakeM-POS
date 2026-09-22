import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, ArrowUpCircle, ArrowDownCircle, Receipt, Wallet, Download, Printer } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { displayReceiptNo } from "@/lib/receipt";
import {
  downloadOrderReceipt,
  printOrderReceipt,
  receiptFromApiResponse,
} from "@/lib/orderReceipt";
import logo from "@/assets/LOGO.png";

type WalletTx = {
  id: string;
  amount: number;
  type: string;
  description?: string | null;
  reference?: string | null;
  createdAt: string;
};

type ReceiptItem = {
  id: string;
  receiptNo?: string | null;
  totalAmount: number;
  createdAt: string;
  paymentMethod?: string;
  items: { quantity: number; price: number; menuItem: { name: string } }[];
};

type Tab = "all" | "wallet" | "meals";

const StudentHistory = () => {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [balance, setBalance] = useState(0);

  const studentName = localStorage.getItem("studentName") || "Student";
  const regNo = localStorage.getItem("regNo") || "";

  const toReceiptData = (r: ReceiptItem) =>
    receiptFromApiResponse(r, { name: studentName, regNo });

  const handlePrintReceipt = async (r: ReceiptItem) => {
    try {
      await printOrderReceipt(toReceiptData(r), logo);
    } catch (e: any) {
      toast.error("Print failed", e.message);
    }
  };

  const handleDownloadReceipt = async (r: ReceiptItem) => {
    try {
      await downloadOrderReceipt(toReceiptData(r), logo);
      toast.success("Receipt downloaded", "Saved as PDF");
    } catch (e: any) {
      toast.error("Download failed", e.message);
    }
  };

  useEffect(() => {
    Promise.all([API.get("/wallet/balance"), API.get("/wallet/history"), API.get("/pos/receipts/me")])
      .then(([bal, hist, rec]) => {
        setBalance(bal.data.balance);
        setTransactions(hist.data || []);
        setReceipts(rec.data || []);
      })
      .catch((e) => toast.error("Failed to load history", e.response?.data?.message))
      .finally(() => setLoading(false));
  }, []);

  const totalSpent = useMemo(
    () => receipts.reduce((s, r) => s + r.totalAmount, 0),
    [receipts],
  );

  const totalTopUps = useMemo(
    () => transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
    [transactions],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "wallet", label: "Wallet" },
    { id: "meals", label: "Cafeteria" },
  ];

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <History size={24} /> Expenditure History
          </h2>
          <p className="text-blue-200 text-sm mt-1">Wallet movements and cafeteria purchases</p>
        </div>
        <Link
          to="/student/wallet"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-semibold"
        >
          <Wallet size={16} /> Back to wallet
        </Link>
      </div>

      {loading ? (
        <Loader size="sm" title="Loading history..." subtitle="Fetching transactions" className="py-8" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs text-gray-400 uppercase">Current balance</p>
              <p className="text-xl font-bold text-[#0A1F44] mt-1">KES {balance.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs text-gray-400 uppercase">Total top-ups</p>
              <p className="text-xl font-bold text-green-600 mt-1">KES {totalTopUps.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs text-gray-400 uppercase">Cafeteria spending</p>
              <p className="text-xl font-bold text-red-600 mt-1">KES {totalSpent.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                  tab === t.id
                    ? "bg-[#0A1F44] text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {(tab === "all" || tab === "wallet") && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h3 className="font-bold text-[#0A1F44] mb-4 flex items-center gap-2">
                  <ArrowDownCircle size={18} /> Wallet Transactions
                </h3>
                {transactions.length === 0 ? (
                  <p className="text-gray-400 text-sm">No wallet transactions yet</p>
                ) : (
                  <div className="space-y-3 max-h-[28rem] overflow-y-auto">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                        <div className="flex items-center gap-3 min-w-0">
                          {tx.amount >= 0 ? (
                            <ArrowUpCircle size={18} className="text-green-500 shrink-0" />
                          ) : (
                            <ArrowDownCircle size={18} className="text-red-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {tx.description || tx.type}
                            </p>
                            <p className="text-xs text-gray-400">
                              {new Date(tx.createdAt).toLocaleString()}
                              {tx.reference ? ` · Ref ${tx.reference}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className={`font-bold text-sm shrink-0 ${tx.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {tx.amount >= 0 ? "+" : ""}KES {Math.abs(tx.amount).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(tab === "all" || tab === "meals") && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                <h3 className="font-bold text-[#0A1F44] mb-4 flex items-center gap-2">
                  <Receipt size={18} /> Cafeteria Receipts
                </h3>
                {receipts.length === 0 ? (
                  <p className="text-gray-400 text-sm">No cafeteria purchases yet</p>
                ) : (
                  <div className="space-y-3 max-h-[28rem] overflow-y-auto">
                    {receipts.map((r) => (
                      <div key={r.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <span className="text-xs text-gray-400">
                            {displayReceiptNo({ receiptNo: r.receiptNo, id: r.id })} · {new Date(r.createdAt).toLocaleString()}
                          </span>
                          <span className="font-bold text-red-600 shrink-0">-KES {r.totalAmount.toLocaleString()}</span>
                        </div>
                        {r.items.map((item, i) => (
                          <p key={i} className="text-sm text-gray-600">
                            {item.menuItem.name} × {item.quantity} - KES {(item.price * item.quantity).toLocaleString()}
                          </p>
                        ))}
                        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
                          <button
                            type="button"
                            onClick={() => handlePrintReceipt(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0A1F44] border border-[#0A1F44]/20 rounded-lg hover:bg-[#0A1F44]/5"
                          >
                            <Printer size={14} /> Print
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadReceipt(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0A1F44] rounded-lg hover:bg-[#0A1F44]/90"
                          >
                            <Download size={14} /> Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StudentHistory;
