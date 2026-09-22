import React, { useEffect, useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { Users, DollarSign, UtensilsCrossed, TrendingUp, TrendingDown } from "lucide-react";

const Reports: React.FC = () => {
  const [staff, setStaff] = useState<any[]>([]);
  const [finance, setFinance] = useState({ revenue: 0, expenses: 0, netProfit: 0 });
  const [menuCount, setMenuCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [u, m] = await Promise.all([
          API.get("/users"),
          API.get("/menu"),
        ]);
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

  if (loading) {
    return (
      <div className="p-4 md:p-8 bg-[#E8F6EC] min-h-screen font-sans">
        <Loader size="md" title="Loading reports..." subtitle="Gathering bakery analytics" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 bg-[#E8F6EC] min-h-screen font-sans space-y-6">
      <div className="bg-[#39B54A] text-white rounded-2xl p-6">
        <h2 className="text-2xl font-bold">System Reports</h2>
        <p className="text-white/80 text-sm mt-1">Slow Rise Co bakery analytics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center gap-3">
            <Users className="text-[#148A32]" size={24} />
            <div>
              <p className="text-sm text-gray-500">Staff</p>
              <p className="text-2xl font-bold">{staff.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center gap-3">
            <UtensilsCrossed className="text-[#39B54A]" size={24} />
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
              <p className="text-sm text-gray-500">Sales</p>
              <p className="text-2xl font-bold">KES {finance.revenue.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <h3 className="font-bold text-[#39B54A] mb-4">Financial Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-xl">
              <span className="flex items-center gap-2 text-sm"><TrendingUp size={16} className="text-green-600" /> Sales</span>
              <span className="font-bold text-green-600">KES {finance.revenue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-red-50 rounded-xl">
              <span className="flex items-center gap-2 text-sm"><TrendingDown size={16} className="text-red-600" /> Expenses</span>
              <span className="font-bold text-red-600">KES {finance.expenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[#E8F6EC] rounded-xl">
              <span className="text-sm font-medium">Net</span>
              <span className={`font-bold ${finance.netProfit >= 0 ? "text-[#148A32]" : "text-red-600"}`}>KES {finance.netProfit.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <h3 className="font-bold text-[#39B54A] mb-4">Staff by Role</h3>
          {Object.keys(staffByRole).length === 0 ? (
            <p className="text-gray-400 text-sm">No staff registered</p>
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
    </div>
  );
};

export default Reports;
