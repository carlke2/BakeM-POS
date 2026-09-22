import React, { useEffect, useState } from "react";
import API from "@/services/api";
import Loader from "@/components/ui/loader";
import { Wallet, ArrowUpCircle, ArrowDownCircle } from "lucide-react";

interface WalletTx {
  id: string; amount: number; type: string; description?: string; reference?: string; createdAt: string;
}

interface Receipt {
  id: string; totalAmount: number; createdAt: string;
  items: { quantity: number; price: number; menuItem: { name: string } }[];
}

const StudentFees: React.FC = () => {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      API.get("/wallet/balance"),
      API.get("/wallet/history"),
      API.get("/pos/receipts/me"),
    ]).then(([bal, hist, rec]) => {
      setBalance(bal.data.balance);
      setTransactions(hist.data);
      setReceipts(rec.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Wallet /> My Wallet</h2>
          <p className="text-blue-200 text-sm mt-1">Balance and transaction history</p>
        </div>
        <div className="text-right">
          <p className="text-blue-200 text-xs">Available Balance</p>
          <p className="text-3xl font-bold text-green-300">KES {balance.toLocaleString()}</p>
        </div>
      </div>

      {loading ? (
        <Loader size="sm" title="Loading wallet data..." subtitle="Fetching balance and transactions" className="py-8" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-[#0A1F44] mb-4">Wallet Transactions</h3>
            {transactions.length === 0 ? (
              <p className="text-gray-400 text-sm">No transactions yet</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                    <div className="flex items-center gap-3">
                      {tx.amount >= 0
                        ? <ArrowUpCircle size={18} className="text-green-500" />
                        : <ArrowDownCircle size={18} className="text-red-500" />}
                      <div>
                        <p className="text-sm font-medium text-gray-800">{tx.description || tx.type}</p>
                        <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    <span className={`font-bold text-sm ${tx.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {tx.amount >= 0 ? "+" : ""}KES {Math.abs(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-[#0A1F44] mb-4">Meal Purchase Receipts</h3>
            {receipts.length === 0 ? (
              <p className="text-gray-400 text-sm">No cafeteria purchases yet</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {receipts.map((r) => (
                  <div key={r.id} className="p-3 bg-gray-50 rounded-xl">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-gray-400">#{r.id.slice(-8)} · {new Date(r.createdAt).toLocaleDateString()}</span>
                      <span className="font-bold text-red-600">-KES {r.totalAmount}</span>
                    </div>
                    {r.items.map((item, i) => (
                      <p key={i} className="text-sm text-gray-600">{item.menuItem.name} × {item.quantity}</p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentFees;
