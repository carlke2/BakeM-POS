import { useEffect, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";

interface Expense {
  id: string; category: string; amount: number; description: string; date: string;
}

const CATEGORIES = ["Salaries", "Utilities", "Maintenance", "Ingredients", "Equipment", "Other"];

const ExpensesPage = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [form, setForm] = useState({ category: "Ingredients", amount: "", description: "", date: "" });

  const fetchExpenses = async () => {
    try {
      const { data } = await API.get("/finance/expenses");
      setExpenses(data);
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  useEffect(() => { fetchExpenses(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.post("/finance/expenses", {
        ...form,
        amount: Number(form.amount),
        date: form.date || undefined,
      });
      setForm({ category: "Ingredients", amount: "", description: "", date: "" });
      fetchExpenses();
      toast.success("Expense recorded");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><ClipboardList /> Expenses</h2>
          <p className="text-blue-200 text-sm mt-1">Record and track operational expenses</p>
        </div>
        <div className="text-right">
          <p className="text-blue-200 text-xs">Total Recorded</p>
          <p className="text-2xl font-bold">KES {total.toLocaleString()}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input type="number" placeholder="Amount (KES)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" required />
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="px-3 py-2 border rounded-lg text-sm sm:col-span-2" required />
        <button type="submit" className="flex items-center justify-center gap-2 bg-[#0A1F44] text-white rounded-lg py-2 font-semibold text-sm">
          <Plus size={16} /> Record
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((exp) => (
              <tr key={exp.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-gray-600">{new Date(exp.date).toLocaleDateString()}</td>
                <td className="px-4 py-3"><span className="px-2 py-1 bg-gray-100 rounded-full text-xs font-medium">{exp.category}</span></td>
                <td className="px-4 py-3 text-gray-700">{exp.description}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-600">KES {exp.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExpensesPage;
