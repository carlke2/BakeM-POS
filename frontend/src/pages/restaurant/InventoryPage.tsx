import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Package, AlertTriangle, ArrowDownCircle, ArrowUpCircle, Boxes, TrendingUp, ChefHat } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import KitchenPanel from "@/components/KitchenPanel";

interface InventoryItem {
  id: string; name: string; category: string; unit: string;
  stockLevel: number; reorderLevel: number; unitCost: number;
}

interface SupplierOption {
  id: string;
  name: string;
}

const InventoryPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "stock" ? "stock" : "kitchen";

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [newItem, setNewItem] = useState({ name: "", category: "Grains", unit: "kg", reorderLevel: "10", unitCost: "0" });
  const [movement, setMovement] = useState({
    inventoryItemId: "",
    type: "IN",
    quantity: "",
    reason: "purchase",
    notes: "",
    supplierId: "",
    reference: "",
  });

  const fetchItems = async () => {
    try {
      const { data } = await API.get("/inventory/items");
      setItems(data);
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const { data } = await API.get<SupplierOption[]>("/inventory/suppliers");
      setSuppliers(data);
    } catch {
      // Non-blocking — movements still work without supplier list
    }
  };

  useEffect(() => {
    fetchItems();
    fetchSuppliers();
  }, []);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.post("/inventory/items", {
        ...newItem,
        reorderLevel: Number(newItem.reorderLevel),
        unitCost: Number(newItem.unitCost),
      });
      setNewItem({ name: "", category: "Grains", unit: "kg", reorderLevel: "10", unitCost: "0" });
      fetchItems();
      toast.success("Item added");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const recordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const isPurchaseIn = movement.type === "IN" && movement.reason === "purchase";
    if (isPurchaseIn && !movement.supplierId) {
      toast.error("Select a supplier for purchase deliveries");
      return;
    }
    try {
      await API.post("/inventory/movements", {
        inventoryItemId: movement.inventoryItemId,
        type: movement.type,
        quantity: Number(movement.quantity),
        reason: movement.reason,
        notes: movement.notes || undefined,
        supplierId: isPurchaseIn ? movement.supplierId : undefined,
        reference: movement.reference.trim() || undefined,
      });
      setMovement({
        inventoryItemId: "",
        type: "IN",
        quantity: "",
        reason: "purchase",
        notes: "",
        supplierId: "",
        reference: "",
      });
      fetchItems();
      toast.success("Movement recorded");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const showSupplierFields = movement.type === "IN" && movement.reason === "purchase";

  const lowStock = items.filter((i) => i.stockLevel <= i.reorderLevel);
  const totalValue = items.reduce((sum, item) => sum + item.stockLevel * item.unitCost, 0);
  const totalItems = items.length;

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 shadow-sm border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black flex items-center gap-2"><Package className="text-indigo-400" /> Inventory & Kitchen</h2>
          <p className="text-blue-200 text-sm mt-1">Raw stock, cook batches, and track expected sales from each batch</p>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-white rounded-xl border border-slate-100 w-fit shadow-sm">
        <button
          onClick={() => setSearchParams({ tab: "kitchen" })}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-extrabold transition ${
            tab === "kitchen" ? "bg-[#0A1F44] text-white" : "text-gray-500 hover:bg-slate-50"
          }`}
        >
          <ChefHat size={16} /> Cook & Track Sales
        </button>
        <button
          onClick={() => setSearchParams({ tab: "stock" })}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-extrabold transition ${
            tab === "stock" ? "bg-[#0A1F44] text-white" : "text-gray-500 hover:bg-slate-50"
          }`}
        >
          <Boxes size={16} /> Raw Stock
        </button>
      </div>

      {tab === "kitchen" ? (
        <KitchenPanel onProductionRecorded={fetchItems} />
      ) : (
        <>
      {/* Low Stock Banner */}
      {lowStock.length > 0 && (
        <div className="bg-amber-50 border border-amber-250 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in duration-200">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-extrabold text-amber-900 text-sm">Low Stock Warning</p>
            <p className="text-xs text-amber-700 mt-1 leading-normal">
              The following items have fallen below their reorder thresholds:{" "}
              <span className="font-bold">{lowStock.map((i) => `${i.name} (${i.stockLevel} ${i.unit})`).join(", ")}</span>
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* KPI 1: Total Items */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center justify-between select-none">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-extrabold">Total Items</p>
            <p className="text-2xl font-black text-[#0A1F44] mt-1">{totalItems}</p>
          </div>
          <div className="h-10 w-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
            <Boxes size={20} />
          </div>
        </div>

        {/* KPI 2: Low Stock Warning */}
        <div className={`bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center justify-between select-none`}>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-extrabold">Low Stock Warning</p>
            <p className={`text-2xl font-black mt-1 ${lowStock.length > 0 ? "text-amber-600 animate-pulse" : "text-[#0A1F44]"}`}>
              {lowStock.length}
            </p>
          </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${lowStock.length > 0 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
            <AlertTriangle size={20} />
          </div>
        </div>

        {/* KPI 3: Estimated Stock Value */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center justify-between select-none">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-extrabold">Stock Valuation</p>
            <p className="text-xl font-black text-[#0A1F44] mt-1.5">KES {totalValue.toLocaleString()}</p>
          </div>
          <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
            <TrendingUp size={20} />
          </div>
        </div>
      </div>

      {/* Forms Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form 1: Add Inventory */}
        <form onSubmit={addItem} className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 shadow-sm">
          <h3 className="font-extrabold text-[#0A1F44] text-base">Add Inventory Item</h3>
          
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Item Name</label>
            <input 
              placeholder="e.g. Baking Flour" 
              value={newItem.name} 
              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} 
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200" 
              required 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Category</label>
              <select 
                value={newItem.category} 
                onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
              >
                {["Grains", "Vegetables", "Meat", "Dairy", "Spices", "Other"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Unit of Measure</label>
              <select 
                value={newItem.unit} 
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
              >
                {["kg", "liters", "pieces", "bags"].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reorder Level Alert</label>
              <input 
                type="number" 
                placeholder="10" 
                value={newItem.reorderLevel} 
                onChange={(e) => setNewItem({ ...newItem, reorderLevel: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold" 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Unit Cost (KES)</label>
              <input 
                type="number" 
                placeholder="Unit Cost" 
                value={newItem.unitCost} 
                onChange={(e) => setNewItem({ ...newItem, unitCost: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold" 
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="w-full py-3 bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white rounded-xl font-extrabold text-sm transition duration-200 shadow-sm"
          >
            Add Inventory Item
          </button>
        </form>

        {/* Form 2: Record Movement */}
        <form onSubmit={recordMovement} className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 shadow-sm">
          <h3 className="font-extrabold text-[#0A1F44] text-base">Record Stock Movement</h3>
          
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Inventory Item</label>
            <select 
              value={movement.inventoryItemId} 
              onChange={(e) => setMovement({ ...movement, inventoryItemId: e.target.value })} 
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold" 
              required
            >
              <option value="">Select item to adjust</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stockLevel} {i.unit} in stock)</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Adjustment Type</label>
              <select 
                value={movement.type} 
                onChange={(e) => setMovement({ ...movement, type: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
              >
                <option value="IN">Stock IN (+)</option>
                <option value="OUT">Stock OUT (-)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Quantity</label>
              <input 
                type="number" 
                placeholder="Quantity" 
                value={movement.quantity} 
                onChange={(e) => setMovement({ ...movement, quantity: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold" 
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reason</label>
              <select 
                value={movement.reason} 
                onChange={(e) => setMovement({ ...movement, reason: e.target.value, supplierId: "" })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
              >
                {["purchase", "usage", "spoilage", "adjustment"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
              <input 
                placeholder="Add receipt info..." 
                value={movement.notes} 
                onChange={(e) => setMovement({ ...movement, notes: e.target.value })} 
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200" 
              />
            </div>
          </div>

          {showSupplierFields && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Supplier *</label>
                <select
                  value={movement.supplierId}
                  onChange={(e) => setMovement({ ...movement, supplierId: e.target.value })}
                  className="w-full px-3 py-2.5 bg-white border border-indigo-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                  required
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-[10px] text-indigo-600 mt-1">Add suppliers first under Suppliers menu.</p>
                )}
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Invoice / LPO #</label>
                <input
                  placeholder="e.g. INV-2026-042"
                  value={movement.reference}
                  onChange={(e) => setMovement({ ...movement, reference: e.target.value })}
                  className="w-full px-3 py-2.5 bg-white border border-indigo-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          <button 
            type="submit" 
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-sm transition duration-200 shadow-sm"
          >
            Record Stock Movement
          </button>
        </form>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-gray-500 uppercase text-[10px] border-b border-slate-100">
            <tr>
              <th className="px-5 py-4 text-left font-extrabold tracking-wider">Item</th>
              <th className="px-5 py-4 text-left font-extrabold tracking-wider">Category</th>
              <th className="px-5 py-4 text-right font-extrabold tracking-wider">Stock Level</th>
              <th className="px-5 py-4 text-right font-extrabold tracking-wider">Reorder threshold</th>
              <th className="px-5 py-4 text-right font-extrabold tracking-wider">Estimated Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                  No inventory items cataloged yet.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isLow = item.stockLevel <= item.reorderLevel;
                return (
                  <tr key={item.id} className={`hover:bg-slate-50/50 transition duration-150 ${isLow ? "bg-amber-50/20" : ""}`}>
                    <td className="px-5 py-4 font-extrabold text-[#0A1F44]">{item.name}</td>
                    <td className="px-5 py-4">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">{item.category}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${isLow ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50"}`}>
                        {isLow ? <ArrowDownCircle size={14} className="text-amber-500 animate-bounce" /> : <ArrowUpCircle size={14} className="text-emerald-500" />}
                        {item.stockLevel} {item.unit}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right text-gray-500 font-semibold">{item.reorderLevel} {item.unit}</td>
                    <td className="px-5 py-4 text-right font-black text-[#0A1F44]">KES {(item.stockLevel * item.unitCost).toLocaleString()}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
};

export default InventoryPage;
