import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet, ArrowUpCircle, ArrowDownCircle, Snowflake, History, Shield } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type WalletTx = {
  id: string;
  amount: number;
  type: string;
  description?: string | null;
  createdAt: string;
};

type StudentMe = {
  name: string;
  regNo: string;
  walletBalance: number;
  walletFrozen?: boolean;
  dailySpendLimit?: number | null;
  weeklySpendLimit?: number | null;
};

const StudentWallet = () => {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StudentMe | null>(null);
  const [recent, setRecent] = useState<WalletTx[]>([]);

  useEffect(() => {
    Promise.all([API.get("/students/me"), API.get("/wallet/history")])
      .then(([me, hist]) => {
        setProfile(me.data);
        setRecent((hist.data || []).slice(0, 5));
      })
      .catch((e) => toast.error("Failed to load wallet", e.response?.data?.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const credits = recent.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const debits = recent.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    return { credits, debits };
  }, [recent]);

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Wallet size={24} /> My Wallet
          </h2>
          <p className="text-blue-200 text-sm mt-1">
            {profile?.name || "Student"} · {profile?.regNo || "-"}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-blue-200 text-xs uppercase tracking-wide">Available Balance</p>
          <p className="text-3xl font-bold text-green-300">
            KES {Number(profile?.walletBalance || 0).toLocaleString()}
          </p>
        </div>
      </div>

      {loading ? (
        <Loader size="sm" title="Loading wallet..." subtitle="Fetching your balance" className="py-8" />
      ) : (
        <>
          {profile?.walletFrozen && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
              <Snowflake size={20} />
              <div>
                <p className="font-semibold text-sm">Wallet frozen</p>
                <p className="text-xs">Contact your parent or school admin to unfreeze spending.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs text-gray-400 uppercase">Recent top-ups</p>
              <p className="text-xl font-bold text-green-600 mt-1">KES {stats.credits.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Last 5 transactions</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs text-gray-400 uppercase">Recent spending</p>
              <p className="text-xl font-bold text-red-600 mt-1">KES {stats.debits.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Last 5 transactions</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs text-gray-400 uppercase flex items-center gap-1">
                <Shield size={12} /> Spend limits
              </p>
              <p className="text-sm font-semibold text-[#0A1F44] mt-2">
                Daily: {profile?.dailySpendLimit ? `KES ${profile.dailySpendLimit}` : "No limit"}
              </p>
              <p className="text-sm font-semibold text-[#0A1F44]">
                Weekly: {profile?.weeklySpendLimit ? `KES ${profile.weeklySpendLimit}` : "No limit"}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[#0A1F44]">Recent Activity</h3>
              <Link
                to="/student/history"
                className="text-sm font-semibold text-[#0A1F44] hover:underline flex items-center gap-1"
              >
                <History size={14} /> View full history
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="text-gray-400 text-sm">No transactions yet</p>
            ) : (
              <div className="space-y-3">
                {recent.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
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
                        <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleString()}</p>
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

          <p className="text-center text-xs text-gray-500">
            Top-ups are made by your parent via Kopokopo (M-Pesa).{" "}
            <Link to="/student/order" className="font-semibold text-[#0A1F44] hover:underline">
              Order food here
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
};

export default StudentWallet;
