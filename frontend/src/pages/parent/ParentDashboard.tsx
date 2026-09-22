import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Wallet, User, GraduationCap, RefreshCw, DollarSign, History } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

interface Student {
  id: string;
  name: string;
  regNo: string;
  walletBalance: number;
  transactions: { id: string; amount: number; type: string; description?: string; createdAt: string }[];
  course?: string | null;
}


const ParentDashboard = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStudentId, setActiveStudentId] = useState<string>("");
  const name = localStorage.getItem("userName") || "Parent";
  const firstName = name.split(" ")[0];
  const navigate = useNavigate();

  const active = useMemo(
    () => students.find((s) => s.id === activeStudentId) || students[0],
    [students, activeStudentId],
  );

  const fetchStudents = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { data } = await API.get("/parents/students");
      setStudents(data);
    } catch (e: any) {
      toast.error("Failed to load students", e.response?.data?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchStudents(); }, []);

  useEffect(() => {
    if (!activeStudentId && students.length > 0) setActiveStudentId(students[0].id);
  }, [students, activeStudentId]);

  return (
    <div className="min-h-screen bg-[#efefed] font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .db { font-family: 'Inter', sans-serif; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .card-in { animation: fadeUp 0.35s cubic-bezier(0.22,1,0.36,1) both; }
        .card-in:nth-child(2) { animation-delay: 0.07s; }

        .s-card {
          background: #fff;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.05);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        .s-card:hover {
          box-shadow: 0 2px 6px rgba(0,0,0,0.08), 0 10px 32px rgba(0,0,0,0.09);
          transform: translateY(-2px);
        }

        .action-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #f5f5f3;
          padding: 16px 24px;
          text-decoration: none;
          transition: background 0.15s ease;
          cursor: pointer;
        }
        .action-row:hover { background: #efefed; }
        .action-row:active { background: #e8e8e5; }

        .refresh-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 600;
          color: #888;
          background: #fff;
          border: 1px solid #e5e5e5;
          padding: 6px 13px;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .refresh-btn:hover { color: #333; border-color: #ccc; }
      `}</style>

      <div className="db max-w-4xl mx-auto p-5 md:p-10 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Parent Portal</p>
            <h1 className="text-2xl font-extrabold text-[#111] tracking-tight">Hello, {firstName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchStudents(true)}
              disabled={refreshing}
              className="refresh-btn"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <div className="w-9 h-9 rounded-xl bg-[#111] text-white flex items-center justify-center font-bold text-sm">
              {name.charAt(0)}
            </div>
          </div>
        </div>

        {/* ── Active student + actions (matches screenshot buttons) ── */}
        {!loading && students.length > 0 && active && (
          <div className="s-card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Student</p>
                <select
                  value={activeStudentId || students[0].id}
                  onChange={(e) => setActiveStudentId(e.target.value)}
                  className="mt-2 w-full sm:w-[360px] px-3 py-2 rounded-xl bg-white border border-gray-200 outline-none text-sm"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.regNo})
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-stone-400">Wallet</p>
                <p className="text-2xl font-extrabold text-[#111]">
                  Ksh {active.walletBalance.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                onClick={() => navigate("/parent/topup", { state: { studentId: active.id } })}
                className="px-4 py-2 rounded-xl bg-[#111] hover:bg-black text-white text-sm font-extrabold flex items-center gap-2"
              >
                <DollarSign className="w-4 h-4" /> Top Up wallet
              </button>
              <button
                type="button"
                onClick={() => navigate("/parent/wallet", { state: { studentId: active.id } })}
                className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-bold flex items-center gap-2"
              >
                <Wallet className="w-4 h-4 text-stone-600" /> Wallet
              </button>
              <button
                type="button"
                onClick={() => navigate("/parent/history", { state: { studentId: active.id } })}
                className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-bold flex items-center gap-2"
              >
                <History className="w-4 h-4 text-stone-600" /> View History
              </button>
              <Link
                to="/pay-kopokopo"
                state={{ studentId: active.id, studentName: active.name, regNo: active.regNo, currentBalance: active.walletBalance }}
                className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-bold flex items-center gap-2 text-stone-800"
              >
                Pay via Kopokopo
              </Link>
            </div>
          </div>
        )}

        {/* ── Cards ── */}
        {loading ? (
          <Loader size="sm" title="Loading students..." subtitle="Fetching your children's accounts" className="py-12" />
        ) : students.length === 0 ? (
          <div className="s-card p-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
              <GraduationCap className="w-6 h-6 text-stone-400" />
            </div>
            <p className="font-semibold text-stone-700">No students linked yet</p>
            <p className="text-sm text-stone-400 mt-1">Contact the school admin to link your children.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {[active || students[0]].filter(Boolean).map((s: any, i) => (
              <div key={s.id} className="s-card card-in" style={{ animationDelay: `${i * 0.07}s` }}>
                <div className="p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-[18px] font-extrabold leading-tight truncate text-[#111]">{s.name}</h2>
                      <p className="text-sm text-stone-500 mt-1 font-medium leading-snug">{s.regNo}{s.course ? ` · ${s.course}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-widest text-stone-400">Wallet</p>
                      <p className="text-2xl font-extrabold text-[#111]">KES {Number(s.walletBalance || 0).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-stone-50 border border-gray-200 p-4">
                    <p className="text-sm font-extrabold text-[#111] mb-2">Recent Transactions</p>
                    {(!s.transactions || s.transactions.length === 0) ? (
                      <p className="text-sm text-stone-500">No transactions yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {s.transactions.slice(0, 5).map((t: any) => {
                          const positive = Number(t.amount) >= 0;
                          return (
                            <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                              <span className="truncate text-stone-700">
                                {t.description ||
                                  (t.type === "registration_fee"
                                    ? "System registration fee"
                                    : t.type)}
                              </span>
                              <span className={`font-extrabold ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                                {positive ? "+" : "-"}KES {Math.abs(Number(t.amount || 0)).toLocaleString()}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex gap-5 pb-4">
          <Link to="/user-profile" className="flex items-center gap-2 text-sm text-stone-400 font-semibold hover:text-stone-700 transition-colors">
            <User size={14} /> My Profile
          </Link>
        </div>

      </div>
    </div>
  );
};

export default ParentDashboard;
