import { useEffect, useMemo, useState } from "react";
import {
  Truck,
  Plus,
  Edit,
  Trash2,
  X,
  Search,
  Filter,
  Package,
  Phone,
  Mail,
  User,
  MapPin,
} from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { useAuth } from "@/context/AuthContext";

type SupplierRow = {
  id: string;
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  _count?: { stockMovements: number };
};

type StockMovementRow = {
  id: string;
  type: string;
  quantity: number;
  reason: string;
  reference?: string | null;
  notes?: string | null;
  createdAt: string;
  inventoryItem: { id: string; name: string; unit: string };
  supplier?: { id: string; name: string } | null;
};

const emptySupplier = {
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none";

const SuppliersPage = () => {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "restaurant";
  const canDelete = user?.role === "admin";

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptySupplier);
  const [searchQuery, setSearchQuery] = useState("");
  const [historySupplierId, setHistorySupplierId] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const { data } = await API.get<SupplierRow[]>("/inventory/suppliers");
      setSuppliers(data);
    } catch (e: any) {
      toast.error("Failed to load suppliers", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchMovements = async (supplierId: string) => {
    setLoadingMovements(true);
    try {
      const { data } = await API.get<StockMovementRow[]>("/inventory/movements", {
        params: { supplierId, type: "IN", limit: 50 },
      });
      setMovements(data);
    } catch (e: any) {
      toast.error("Failed to load purchase history", e.response?.data?.message);
    } finally {
      setLoadingMovements(false);
    }
  };

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      [s.name, s.contactPerson, s.email, s.phone, s.address]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [suppliers, searchQuery]);

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptySupplier);
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptySupplier);
    setShowForm(true);
  };

  const openEdit = (s: SupplierRow) => {
    setEditId(s.id);
    setForm({
      name: s.name,
      contactPerson: s.contactPerson || "",
      email: s.email || "",
      phone: s.phone || "",
      address: s.address || "",
    });
    setShowForm(true);
  };

  const saveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
      };
      if (editId) {
        await API.put(`/inventory/suppliers/${editId}`, payload);
        toast.success("Supplier updated");
      } else {
        await API.post("/inventory/suppliers", payload);
        toast.success("Supplier added");
      }
      closeForm();
      fetchSuppliers();
    } catch (e: any) {
      toast.error("Save failed", e.response?.data?.message);
    }
  };

  const deleteSupplier = async (s: SupplierRow) => {
    const confirmed = await toast.confirm(`Delete ${s.name}?`, {
      description: "Only suppliers with no purchase history can be removed.",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    try {
      await API.delete(`/inventory/suppliers/${s.id}`);
      toast.success("Supplier deleted");
      if (historySupplierId === s.id) setHistorySupplierId(null);
      fetchSuppliers();
    } catch (e: any) {
      toast.error("Delete failed", e.response?.data?.message);
    }
  };

  const toggleHistory = (supplierId: string) => {
    if (historySupplierId === supplierId) {
      setHistorySupplierId(null);
      setMovements([]);
      return;
    }
    setHistorySupplierId(supplierId);
    fetchMovements(supplierId);
  };

  const historySupplier = suppliers.find((s) => s.id === historySupplierId);
  const totalPurchases = suppliers.reduce((sum, s) => sum + (s._count?.stockMovements || 0), 0);

  if (loading) {
    return (
      <Loader
        size="sm"
        title="Loading suppliers..."
        subtitle="Fetching vendor directory"
        className="min-h-screen py-24"
      />
    );
  }

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 shadow-sm border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black flex items-center gap-2">
            <Truck className="text-indigo-400" /> Suppliers
          </h2>
          <p className="text-blue-200 text-sm mt-1">
            Register vendors who deliver ingredients. Link them when recording stock purchases on Inventory.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 rounded-xl font-bold text-sm transition"
          >
            <Plus size={16} /> Add Supplier
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-extrabold">Active Suppliers</p>
          <p className="text-2xl font-black text-[#0A1F44] mt-1">{suppliers.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-extrabold">Purchase Records</p>
          <p className="text-2xl font-black text-[#0A1F44] mt-1">{totalPurchases}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-extrabold">How it works</p>
          <p className="text-xs text-gray-600 mt-2 leading-relaxed">
            Add supplier → Inventory → Stock IN (purchase) → pick supplier & invoice → stock increases with audit trail.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, phone, email, contact..."
            className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44]"
          />
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-[#0A1F44] flex items-center gap-1"
          >
            <Filter size={14} /> Clear
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-gray-500 uppercase text-[10px] border-b border-slate-100">
            <tr>
              <th className="px-5 py-4 text-left font-extrabold tracking-wider">Supplier</th>
              <th className="px-5 py-4 text-left font-extrabold tracking-wider">Contact</th>
              <th className="px-5 py-4 text-left font-extrabold tracking-wider">Phone / Email</th>
              <th className="px-5 py-4 text-right font-extrabold tracking-wider">Purchases</th>
              <th className="px-5 py-4 text-right font-extrabold tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                  {suppliers.length === 0
                    ? "No suppliers yet. Add your first vendor to track purchases."
                    : "No suppliers match your search."}
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-4">
                    <p className="font-extrabold text-[#0A1F44]">{s.name}</p>
                    {s.address && (
                      <p className="text-xs text-gray-500 mt-0.5 flex items-start gap-1">
                        <MapPin size={12} className="shrink-0 mt-0.5" /> {s.address}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-600">
                    {s.contactPerson ? (
                      <span className="inline-flex items-center gap-1">
                        <User size={14} /> {s.contactPerson}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-600 space-y-0.5">
                    {s.phone && (
                      <p className="flex items-center gap-1">
                        <Phone size={14} /> {s.phone}
                      </p>
                    )}
                    {s.email && (
                      <p className="flex items-center gap-1">
                        <Mail size={14} /> {s.email}
                      </p>
                    )}
                    {!s.phone && !s.email && "—"}
                  </td>
                  <td className="px-5 py-4 text-right font-bold text-[#0A1F44]">
                    {s._count?.stockMovements ?? 0}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleHistory(s.id)}
                        className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50"
                        title="Purchase history"
                      >
                        <Package size={16} />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => openEdit(s)}
                          className="p-2 rounded-lg text-amber-600 hover:bg-amber-50"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => deleteSupplier(s)}
                          className="p-2 rounded-lg text-red-500 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {historySupplierId && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-extrabold text-[#0A1F44]">
              Purchase history - {historySupplier?.name}
            </h3>
            <button
              onClick={() => {
                setHistorySupplierId(null);
                setMovements([]);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-500"
            >
              <X size={18} />
            </button>
          </div>
          {loadingMovements ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Loading purchases...</p>
          ) : movements.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">
              No stock-in purchases recorded for this supplier yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="px-5 py-3 text-left font-extrabold">Date</th>
                  <th className="px-5 py-3 text-left font-extrabold">Item</th>
                  <th className="px-5 py-3 text-right font-extrabold">Qty</th>
                  <th className="px-5 py-3 text-left font-extrabold">Invoice</th>
                  <th className="px-5 py-3 text-left font-extrabold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-gray-600">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-semibold text-[#0A1F44]">{m.inventoryItem.name}</td>
                    <td className="px-5 py-3 text-right">
                      {m.quantity} {m.inventoryItem.unit}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{m.reference || "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{m.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showForm && canEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={saveSupplier}
            className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-[#0A1F44]">
                {editId ? "Edit Supplier" : "Add Supplier"}
              </h3>
              <button type="button" onClick={closeForm} className="p-1 rounded-lg hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Business name *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Contact person</label>
              <input
                className={inputCls}
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Phone</label>
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Address</label>
              <textarea
                className={`${inputCls} min-h-[72px] resize-y`}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white rounded-xl font-extrabold text-sm"
            >
              {editId ? "Save Changes" : "Add Supplier"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default SuppliersPage;
