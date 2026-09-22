import React, { useEffect, useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { Users, GraduationCap, DollarSign, UtensilsCrossed, TrendingUp, TrendingDown } from "lucide-react";

const Reports: React.FC = () => {
  const [students, setStudents] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [finance, setFinance] = useState({ revenue: 0, expenses: 0, netProfit: 0 });
  const [menuCount, setMenuCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, u, m] = await Promise.all([
          API.get("/students"),
          API.get("/users"),
          API.get("/menu"),
        ]);
        setStudents(s.data);
        setStaff(u.data);
        setMenuCount(m.data.length);
        try {
          const f = await API.get("/finance/summary");
          setFinance(f.data);
        } catch { /* ok */ }
      } catch (e: any) {
        toast.error("Failed to load reports", e.response?.data?.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const staffByRole = staff.reduce((acc: Record<string, number>, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  const totalWallet = students.reduce((s, st) => s + (st.walletBalance || 0), 0);

  if (loading) {
    return (
      <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans">
        <Loader size="md" title="Loading reports..." subtitle="Gathering system analytics" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6">
        <h2 className="text-2xl font-bold">System Reports</h2>
        <p className="text-blue-200 text-sm mt-1">SmartPOS school feeding program analytics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center gap-3">
            <GraduationCap className="text-[#0A1F44]" size={24} />
            <div>
              <p className="text-sm text-gray-500">Students</p>
              <p className="text-2xl font-bold">{students.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center gap-3">
            <Users className="text-blue-600" size={24} />
            <div>
              <p className="text-sm text-gray-500">Staff Users</p>
              <p className="text-2xl font-bold">{staff.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center gap-3">
            <UtensilsCrossed className="text-cyan-600" size={24} />
            <div>
              <p className="text-sm text-gray-500">Menu Items</p>
              <p className="text-2xl font-bold">{menuCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center gap-3">
            <DollarSign className="text-green-600" size={24} />
            <div>
              <p className="text-sm text-gray-500">Total Wallet Funds</p>
              <p className="text-2xl font-bold">KES {totalWallet.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <h3 className="font-bold text-[#0A1F44] mb-4">Financial Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-xl">
              <span className="flex items-center gap-2 text-sm"><TrendingUp size={16} className="text-green-600" /> Cafeteria Revenue</span>
              <span className="font-bold text-green-600">KES {finance.revenue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-red-50 rounded-xl">
              <span className="flex items-center gap-2 text-sm"><TrendingDown size={16} className="text-red-600" /> Expenses</span>
              <span className="font-bold text-red-600">KES {finance.expenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-indigo-50 rounded-xl">
              <span className="text-sm font-medium">Net Profit</span>
              <span className={`font-bold ${finance.netProfit >= 0 ? "text-indigo-600" : "text-red-600"}`}>KES {finance.netProfit.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <h3 className="font-bold text-[#0A1F44] mb-4">Staff by Role</h3>
          {Object.keys(staffByRole).length === 0 ? (
            <p className="text-gray-400 text-sm">No staff users registered</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(staffByRole).map(([role, count]) => (
                <div key={role} className="flex justify-between py-2 border-b border-gray-50">
                  <span className="text-sm capitalize">{role}</span>
                  <span className="font-semibold">{count as number}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-gray-100 overflow-x-auto">
        <h3 className="font-bold text-[#0A1F44] mb-4">Student Roster</h3>
        <table className="w-full text-sm">
          <thead className="text-gray-500 uppercase text-xs">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Reg No</th>
              <th className="text-left py-2">Phone</th>
              <th className="text-right py-2">Gender</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id || s._id} className="border-t border-gray-50">
                <td className="py-2">{s.name}</td>
                <td className="py-2 text-gray-500">{s.regNo}</td>
                <td className="py-2">{s.phone}</td>
                <td className="py-2 text-right capitalize">{s.gender}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Reports;
