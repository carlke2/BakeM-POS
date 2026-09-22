import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { History, GraduationCap } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type WalletTx = {
  id: string;
  amount: number;
  type: string;
  description?: string | null;
  reference?: string | null;
  createdAt: string;
};

type StudentHistory = {
  id: string;
  name: string;
  regNo: string;
  walletBalance: number;
  transactions: WalletTx[];
};

const fmtDate = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const ParentWalletHistory = () => {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string>((location.state as any)?.studentId || "");
  const [students, setStudents] = useState<{ id: string; name: string; regNo: string }[]>([]);
  const [data, setData] = useState<StudentHistory | null>(null);

  const selected = useMemo(() => students.find((s) => s.id === studentId), [students, studentId]);

  const fetchStudents = async () => {
    const { data } = await API.get("/parents/students");
    const list = (data || []).map((s: any) => ({ id: s.id, name: s.name, regNo: s.regNo }));
    setStudents(list);
    if (!studentId && list.length > 0) setStudentId(list[0].id);
  };

  const fetchHistory = async (id: string) => {
    setLoading(true);
    try {
      const res = await API.get(`/parents/students/${id}/history`);
      setData(res.data);
    } catch (e: any) {
      toast.error("Failed to load history", e.response?.data?.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents().catch(() => {});
  }, []);

  useEffect(() => {
    if (!studentId) return;
    fetchHistory(studentId);
  }, [studentId]);

  return (
    <div className="min-h-screen bg-[#efefed] font-sans">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="rounded-2xl bg-white border border-gray-200 p-5 flex items-center justify-between gap-4 shadow-sm">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-stone-400">Parent Wallet</p>
            <h1 className="text-xl font-extrabold truncate flex items-center gap-2 text-[#111]">
              <History className="w-5 h-5 text-[#f97316]" /> Wallet History
            </h1>
            <p className="text-sm text-stone-500 mt-1">Transactions for the selected student</p>
          </div>
          <Link
            to="/parent-dashboard"
            className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-semibold text-stone-700"
          >
            Back
          </Link>
        </div>

        {students.length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <label className="text-xs font-semibold text-stone-500">Student</label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white border border-gray-200 outline-none text-sm text-stone-800"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.regNo})
                </option>
              ))}
            </select>
            {data && (
              <p className="text-xs text-stone-500 mt-2">
                Balance: <span className="text-[#111] font-bold">KES {Number(data.walletBalance || 0).toLocaleString()}</span>
              </p>
            )}
          </div>
        )}

        {loading ? (
          <Loader size="sm" title="Loading..." subtitle="Fetching transactions" className="py-10" />
        ) : !selected ? (
          <div className="rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
              <GraduationCap className="w-6 h-6 text-stone-400" />
            </div>
            <p className="font-semibold text-stone-700">Select a student</p>
            <p className="text-sm text-stone-400 mt-1">Choose a linked student to view wallet history.</p>
          </div>
        ) : (data?.transactions?.length || 0) === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <p className="font-semibold text-stone-700">No transactions yet</p>
            <p className="text-sm text-stone-400 mt-1">Top up the wallet to see activity here.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200">
              <p className="font-extrabold text-[#111]">{data?.name} · {data?.regNo}</p>
              <p className="text-sm text-stone-500">Last 100 transactions</p>
            </div>
            <div className="divide-y divide-gray-100">
              {(data?.transactions || []).map((tx) => {
                const positive = Number(tx.amount) >= 0;
                return (
                  <div key={tx.id} className="px-5 py-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#111] truncate">
                        {tx.description ||
                          (tx.type === "registration_fee"
                            ? "System registration fee"
                            : tx.type)}
                      </p>
                      <p className="text-xs text-stone-400 mt-1">
                        {fmtDate(tx.createdAt)}{tx.reference ? ` · Ref: ${tx.reference}` : ""}
                      </p>
                    </div>
                    <div className={`font-extrabold ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                      {positive ? "+" : "-"}KES {Math.abs(Number(tx.amount || 0)).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParentWalletHistory;

