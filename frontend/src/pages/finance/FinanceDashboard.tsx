import { useEffect, useState } from "react";
import { PieChart, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import API from "@/services/api";
import Loader from "@/components/ui/loader";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const FinanceDashboard = () => {
  const [summary, setSummary] = useState({ revenue: 0, expenses: 0, netProfit: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get("/finance/summary")
      .then((r) => setSummary(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const chartData = [
    { name: "Revenue", amount: summary.revenue },
    { name: "Expenses", amount: summary.expenses },
    { name: "Net Profit", amount: summary.netProfit },
  ];

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6">
        <h2 className="text-2xl font-bold flex items-center gap-2"><PieChart /> Finance Dashboard</h2>
        <p className="text-blue-200 text-sm mt-1">Revenue, expenses, and profitability overview</p>
      </div>

      {loading ? (
        <Loader size="sm" title="Loading financial data..." subtitle="Fetching revenue and expense summary" className="py-8" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Revenue</p>
                  <p className="text-3xl font-bold text-green-600 mt-1">KES {summary.revenue.toLocaleString()}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-xl text-green-600"><TrendingUp size={24} /></div>
              </div>
              <p className="text-xs text-gray-400 mt-2">From cafeteria POS sales</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Expenses</p>
                  <p className="text-3xl font-bold text-red-600 mt-1">KES {summary.expenses.toLocaleString()}</p>
                </div>
                <div className="p-3 bg-red-50 rounded-xl text-red-600"><TrendingDown size={24} /></div>
              </div>
              <p className="text-xs text-gray-400 mt-2">Recorded operational costs</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Net Profit</p>
                  <p className={`text-3xl font-bold mt-1 ${summary.netProfit >= 0 ? "text-[#0A1F44]" : "text-red-600"}`}>
                    KES {summary.netProfit.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600"><DollarSign size={24} /></div>
              </div>
              <p className="text-xs text-gray-400 mt-2">Revenue minus expenses</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-[#0A1F44] mb-4">Financial Overview</h3>
            <div className="w-full min-w-0" style={{ height: 256 }}>
              <ResponsiveContainer width="100%" height={256} minWidth={0}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => `KES ${v.toLocaleString()}`} />
                  <Bar dataKey="amount" fill="#0A1F44" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FinanceDashboard;
