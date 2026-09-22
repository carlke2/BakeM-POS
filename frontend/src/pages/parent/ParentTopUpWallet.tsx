import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { DollarSign, GraduationCap, Wallet } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type StudentLite = {
  id: string;
  name: string;
  regNo: string;
  walletBalance: number;
};

const ParentTopUpWallet = () => {
  const location = useLocation();
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string>((location.state as any)?.studentId || "");

  const selected = useMemo(() => students.find((s) => s.id === studentId), [students, studentId]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/parents/students");
      const list = (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        regNo: s.regNo,
        walletBalance: s.walletBalance || 0,
      }));
      setStudents(list);
      if (!studentId && list.length > 0) setStudentId(list[0].id);
    } catch (e: any) {
      toast.error("Failed to load students", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStudents(); }, []);

  return (
    <div className="min-h-screen bg-[#efefed] font-sans">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="rounded-2xl bg-white border border-gray-200 p-5 flex items-center justify-between gap-4 shadow-sm">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-stone-400">Parent Wallet</p>
            <h1 className="text-xl font-extrabold truncate flex items-center gap-2 text-[#111]">
              <DollarSign className="w-5 h-5 text-[#f97316]" /> Top Up Wallet
            </h1>
            <p className="text-sm text-stone-500 mt-1">Add funds to your child’s school feeding wallet</p>
          </div>
          <Link
            to="/parent-dashboard"
            className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-semibold text-stone-700"
          >
            Back
          </Link>
        </div>

        {loading ? (
          <Loader size="sm" title="Loading..." subtitle="Fetching linked students" className="py-10" />
        ) : students.length === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
              <GraduationCap className="w-6 h-6 text-stone-400" />
            </div>
            <p className="font-semibold text-stone-700">No students linked</p>
            <p className="text-sm text-stone-400 mt-1">Contact the admin to link your account to a student.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-gray-200 p-6 space-y-4 shadow-sm">
            <div>
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
              {selected && (
                <p className="text-xs text-stone-500 mt-2 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-[#f97316]" /> Current: KES {Number(selected.walletBalance || 0).toLocaleString()}
                </p>
              )}
            </div>

            <div className="rounded-xl bg-stone-50 border border-gray-200 p-4">
              <p className="text-sm font-semibold text-stone-700">Top up via Kopokopo (M-Pesa STK Push)</p>
              <p className="text-sm text-stone-500 mt-1">
                Click below to initiate an STK Push. You’ll enter the amount and phone number on the next screen.
              </p>
            </div>

            <Link
              to="/pay-kopokopo"
              state={selected ? { studentId: selected.id, studentName: selected.name, regNo: selected.regNo, currentBalance: selected.walletBalance } : undefined}
              onClick={(e) => {
                if (!selected) {
                  e.preventDefault();
                  toast.error("Select student", "Choose the student to top up");
                }
              }}
              className="block w-full py-3 rounded-xl bg-[#111] hover:bg-black text-sm font-extrabold text-white text-center"
            >
              Continue to Payment
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParentTopUpWallet;

