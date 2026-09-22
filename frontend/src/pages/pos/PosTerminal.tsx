import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShoppingCart,
  Search,
  Trash2,
  Plus,
  Minus,
  X,
  Loader2,
  TrendingUp,
  Receipt,
  Package,
  BarChart3,
  Calendar,
  Smartphone,
  Download,
  Printer,
  CheckCircle2,
  Banknote,
} from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { displayReceiptNo } from "@/lib/receipt";
import {
  downloadOrderReceipt,
  printOrderReceipt,
  receiptFromPosTransaction,
  receiptFromGuestCash,
  type OrderReceiptData,
} from "@/lib/orderReceipt";
import OrderReceiptCard from "@/components/OrderReceiptCard";
import logo from "@/assets/icon.png";
import { initiateStkPushAndWait } from "@/services/kopokopoPayment";
import { useAuth } from "@/context/AuthContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  isAvailable: boolean;
  imageUrl?: string;
  stockLevel?: number | null;
  batchYield?: number;
  kitchenStats?: {
    portionsReady: number;
    activeRemaining: number;
    activeSold: number;
    expectedPerBatch: number;
  };
}
interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

interface SalesSummary {
  date: string;
  totalSales: number;
  posSales?: number;
  tillInflow?: number;
  transactionCount: number;
  tillPaymentCount?: number;
  itemsSold: number;
  hourlyBreakdown: { hour: string; amount: number; count: number; posAmount?: number; tillAmount?: number }[];
  tillPayments?: TillPaymentRow[];
}

interface TillPaymentRow {
  id: string;
  source: "till";
  receiptNo?: string | null;
  totalAmount: number;
  status: string;
  paymentMethod?: string;
  purpose?: string;
  phone?: string | null;
  tillNumber?: string | null;
  label?: string;
  createdAt: string;
  student: { name: string; regNo: string } | null;
  items: { quantity: number; price: number; menuItem: { name: string } }[];
}

interface ReceiptItem {
  id: string;
  receiptNo?: string | null;
  totalAmount: number;
  status: string;
  createdAt: string;
  paymentMethod?: string;
  cashierName?: string | null;
  source?: "pos" | "till";
  label?: string;
  phone?: string | null;
  student: { name: string; regNo: string } | null;
  items: { quantity: number; price: number; menuItem: { name: string } }[];
}

type PosView = "checkout" | "sales";

const todayDateString = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const PosTerminal = () => {
  const { user } = useAuth();
  const staffName = user?.name?.trim() || "";
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [category, setCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<PosView>("checkout");
  const [salesDate, setSalesDate] = useState(todayDateString);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [salesReceipts, setSalesReceipts] = useState<ReceiptItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<OrderReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showMpesa, setShowMpesa] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);

  const toReceiptData = (r: ReceiptItem) => receiptFromPosTransaction(r, undefined, staffName || undefined);

  const handlePrintReceipt = async (r: ReceiptItem) => {
    try {
      await printOrderReceipt(toReceiptData(r), logo);
    } catch (e: any) {
      toast.error("Print failed", e.message);
    }
  };

  const handleDownloadReceipt = async (r: ReceiptItem) => {
    try {
      await downloadOrderReceipt(toReceiptData(r), logo);
      toast.success("Receipt downloaded", "Saved as PDF");
    } catch (e: any) {
      toast.error("Download failed", e.message);
    }
  };

  const closeReceipt = () => {
    setShowReceipt(false);
    setLastReceipt(null);
  };

  const fetchSalesData = useCallback(async (date: string) => {
    setSalesLoading(true);
    try {
      const [summaryRes, receiptsRes] = await Promise.all([
        API.get<SalesSummary>("/pos/sales/summary", { params: { date } }),
        API.get<ReceiptItem[]>("/pos/receipts", { params: { date } }),
      ]);
      setSalesSummary(summaryRes.data);

      const posRows: ReceiptItem[] = (receiptsRes.data || []).map((r) => ({ ...r, source: "pos" as const }));
      const tillRows: ReceiptItem[] = (summaryRes.data.tillPayments || []).map((t) => ({
        id: t.id,
        receiptNo: t.receiptNo,
        totalAmount: t.totalAmount,
        status: t.status,
        createdAt: t.createdAt,
        paymentMethod: t.paymentMethod || "till",
        source: "till" as const,
        label: t.label,
        phone: t.phone,
        student: t.student,
        items: t.items,
      }));
      const posNonMpesa = posRows.filter((r) => (r.paymentMethod || "").toLowerCase() !== "mpesa");
      const merged = [...tillRows, ...posNonMpesa].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setSalesReceipts(merged);
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message ?? "Failed to load sales data");
    } finally {
      setSalesLoading(false);
    }
  }, []);

  const fetchMenu = useCallback(() => {
    API.get("/menu")
      .then((r) => setMenu(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  useEffect(() => {
    if (view === "sales") {
      fetchSalesData(salesDate);
    }
  }, [view, salesDate, fetchSalesData]);

  const categories = ["All", ...new Set(menu.map((m) => m.category))];

  const filtered = useMemo(() => {
    return menu.filter((m) => {
      const matchesCategory = category === "All" || m.category === category;
      const matchesSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [menu, category, searchQuery]);

  const hourlyChartData = useMemo(() => {
    if (!salesSummary) return [];
    return salesSummary.hourlyBreakdown.filter((row) => row.amount > 0);
  }, [salesSummary]);

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.menuItemId === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    );
  };

  const payWithCash = async () => {
    if (cart.length === 0) return toast.warning("Cart is empty");

    const confirmed = await toast.confirm("Confirm cash received?", {
      description: `Complete cash sale for KES ${total.toLocaleString()}`,
      confirmLabel: "Complete sale",
    });
    if (!confirmed) return;

    setCashLoading(true);
    try {
      const { data } = await API.post("/pos/cash-sale", {
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
        paymentMethod: "cash",
      });
      setLastReceipt(receiptFromGuestCash(data.receipt, staffName || undefined));
      setShowReceipt(true);
      setCart([]);
      fetchMenu();
      if (view === "sales" || salesDate === todayDateString()) {
        fetchSalesData(salesDate);
      }
      toast.success("Cash sale complete", `${displayReceiptNo(data.receipt)} · KES ${total.toLocaleString()}`);
    } catch (e: any) {
      toast.error("Cash sale failed", e.response?.data?.message);
    } finally {
      setCashLoading(false);
    }
  };

  const payWithMpesa = async () => {
    if (cart.length === 0) return toast.warning("Cart is empty");
    if (!/^(01|07)\d{8}$/.test(mpesaPhone.trim())) {
      return toast.error("Invalid phone", "Enter a valid 10-digit M-Pesa number");
    }

    setMpesaLoading(true);
    try {
      const result = await initiateStkPushAndWait({
        phone: mpesaPhone.trim(),
        amount: total,
        description: "Slow Rise Co Bakery Sale",
        purpose: "pos_sale",
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
        useAuth: true,
      });

      const status = (result.status || "").toLowerCase();
      const mpesaRef = String(result.transactionReference || "").trim();
      if (status === "success" && mpesaRef) {
        const cartSnapshot = [...cart];
        const saleTotal = total;
        const phone = mpesaPhone.trim();

        let receiptData: OrderReceiptData | null = null;
        if (result.posTransactionId) {
          try {
            const { data: receipt } = await API.get(`/pos/receipts/${result.posTransactionId}`);
            receiptData = receiptFromPosTransaction(receipt, undefined, staffName || undefined);
          } catch {
            /* fall back to cart snapshot */
          }
        }
        if (!receiptData) {
          receiptData = {
            receiptNo: result.posReceiptNo || `ORDER-${Date.now()}`,
            studentName: "Walk-in",
            regNo: phone,
            items: cartSnapshot.map((c) => ({
              name: c.name,
              quantity: c.quantity,
              price: c.price,
            })),
            total: saleTotal,
            paidAt: new Date().toISOString(),
            paymentMethod: "M-Pesa",
            servedBy: staffName || undefined,
          };
        }

        toast.success(
          "M-Pesa sale complete",
          `${receiptData.receiptNo} · KES ${saleTotal.toLocaleString()}`,
        );
        setLastReceipt(receiptData);
        setShowReceipt(true);
        setCart([]);
        setShowMpesa(false);
        setMpesaPhone("");
        fetchMenu();
        if (view === "sales" || salesDate === todayDateString()) {
          fetchSalesData(salesDate);
        }
      } else if (status === "success" && !mpesaRef) {
        toast.warning("Awaiting PIN", "Customer must enter M-Pesa PIN to complete payment");
      } else if (status === "failed" || status === "error") {
        toast.error("Payment failed", "M-Pesa payment was not completed");
      } else {
        toast.warning("Payment status", result.status || "Unknown");
      }
    } catch (e: any) {
      toast.error("M-Pesa failed", e.message || "Could not complete STK push");
    } finally {
      setMpesaLoading(false);
    }
  };

  const receiptLabel = (r: ReceiptItem) => {
    const method = (r.paymentMethod || "").toLowerCase();
    if (r.source === "till") return r.label || "Till M-Pesa";
    if (method === "cash") return "Cash sale";
    if (method === "mpesa") return "M-Pesa sale";
    return "Walk-in sale";
  };

  return (
    <div className="p-4 md:p-6 bg-[#E8F6EC] min-h-screen font-sans">
      <div className="bg-[#39B54A] text-white rounded-2xl p-6 mb-6 shadow-sm border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black flex items-center gap-2">
            <ShoppingCart className="text-white" /> Slow Rise Co · POS
          </h2>
          <p className="text-white/80 text-sm mt-1">
            {view === "checkout"
              ? "Walk-in cash & M-Pesa bakery sales"
              : "Track bakery sales and receipts by day"}
          </p>
        </div>
        <div className="flex gap-2 bg-white/10 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setView("checkout")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
              view === "checkout" ? "bg-white text-[#39B54A]" : "text-white/70 hover:bg-white/10"
            }`}
          >
            Checkout
          </button>
          <button
            type="button"
            onClick={() => setView("sales")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
              view === "sales" ? "bg-white text-[#39B54A]" : "text-white/70 hover:bg-white/10"
            }`}
          >
            Sales Tracker
          </button>
        </div>
      </div>

      {view === "sales" ? (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Filter by day</p>
              <p className="text-sm font-semibold text-[#39B54A] mt-1">View sales for a specific date</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={salesDate}
                  max={todayDateString()}
                  onChange={(e) => setSalesDate(e.target.value)}
                  className="pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#39B54A] focus:bg-white transition-all duration-200 font-semibold"
                />
              </div>
              <button
                type="button"
                onClick={() => setSalesDate(todayDateString())}
                className="px-3 py-2.5 text-xs font-bold text-[#39B54A] border border-slate-200 rounded-xl hover:bg-slate-50 transition"
              >
                Today
              </button>
            </div>
          </div>

          {salesLoading ? (
            <Loader size="sm" title="Loading sales..." subtitle="Fetching daily summary and receipts" className="py-8" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Total Collected</p>
                      <p className="text-2xl font-bold text-green-600 mt-1">
                        KES {(salesSummary?.totalSales ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-xl text-green-600">
                      <TrendingUp size={22} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">POS + till M-Pesa</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Till M-Pesa</p>
                      <p className="text-2xl font-bold text-[#15A84F] mt-1">
                        KES {(salesSummary?.tillInflow ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-xl text-[#15A84F]">
                      <Smartphone size={22} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {salesSummary?.tillPaymentCount ?? 0} webhook payment
                    {(salesSummary?.tillPaymentCount ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">POS Sales</p>
                      <p className="text-2xl font-bold text-[#39B54A] mt-1">
                        KES {(salesSummary?.posSales ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 bg-[#E8F6EC] rounded-xl text-[#148A32]">
                      <Receipt size={22} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {salesSummary?.transactionCount ?? 0} receipt
                    {(salesSummary?.transactionCount ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Items Sold</p>
                      <p className="text-2xl font-bold text-[#148A32] mt-1">
                        {salesSummary?.itemsSold ?? 0}
                      </p>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
                      <Package size={22} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Menu items checked out</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h3 className="font-bold text-[#39B54A] mb-4 flex items-center gap-2">
                  <BarChart3 size={18} /> Hourly Sales
                </h3>
                {hourlyChartData.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-10">No sales recorded for this day.</p>
                ) : (
                  <div className="w-full min-w-0" style={{ height: 256 }}>
                    <ResponsiveContainer width="100%" height={256} minWidth={0}>
                      <BarChart data={hourlyChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="hour" />
                        <YAxis />
                        <Tooltip formatter={(v: number) => `KES ${v.toLocaleString()}`} />
                        <Bar dataKey="amount" fill="#39B54A" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-[#39B54A] flex items-center gap-2">
                    <Receipt size={18} /> Day Activity
                  </h3>
                  <p className="text-xs text-gray-400">
                    {new Date(`${salesDate}T12:00:00`).toLocaleDateString(undefined, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
                {salesReceipts.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">No sales or till payments for this day</div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {salesReceipts.map((r) => (
                      <div key={r.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedReceipt(expandedReceipt === r.id ? null : r.id)}
                          className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition text-left"
                        >
                          <div>
                            <p className="font-semibold text-[#39B54A]">
                              {receiptLabel(r)}
                              {r.source === "till" && (
                                <span className="ml-2 text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                  Till
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {new Date(r.createdAt).toLocaleString()}
                              {r.source === "till"
                                ? ` · ${r.receiptNo || "Till payment"}${r.phone ? ` · ${r.phone}` : ""}`
                                : ` · ${displayReceiptNo(r)}`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-green-600">KES {r.totalAmount.toLocaleString()}</p>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                r.source === "till"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : r.status === "completed"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {r.source === "till" ? r.label || "Till webhook" : r.status}
                            </span>
                          </div>
                        </button>
                        {expandedReceipt === r.id && (
                          <div className="px-5 pb-4 border-t border-gray-50 bg-slate-50/50">
                            {r.items.map((item, i) => (
                              <div key={i} className="flex justify-between text-sm py-1.5">
                                <span>
                                  {item.menuItem.name} × {item.quantity}
                                </span>
                                <span className="font-medium">
                                  KES {(item.price * item.quantity).toLocaleString()}
                                </span>
                              </div>
                            ))}
                            {r.source !== "till" && (
                              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
                                <button
                                  type="button"
                                  onClick={() => handlePrintReceipt(r)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#39B54A] border border-[#39B54A]/20 rounded-lg hover:bg-[#39B54A]/5"
                                >
                                  <Printer size={14} /> Print
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadReceipt(r)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#39B54A] rounded-lg hover:bg-[#39B54A]/90"
                                >
                                  <Download size={14} /> Download PDF
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center bg-white rounded-2xl p-3 border border-slate-100 shadow-sm">
              <div className="flex gap-1.5 flex-wrap">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
                      category === c
                        ? "bg-[#39B54A] text-white shadow-sm"
                        : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-64">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  placeholder="Search menu..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#39B54A] focus:bg-white transition-all duration-200"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-gray-400 shadow-sm">
                <ShoppingCart size={40} className="mx-auto mb-2 text-gray-300" strokeWidth={1.5} />
                <p className="text-sm font-semibold">No items match your search filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filtered.map((item) => {
                  const available =
                    item.isAvailable !== false && (item.stockLevel == null || item.stockLevel > 0);
                  return (
                    <button
                      key={item.id}
                      onClick={() => available && addToCart(item)}
                      disabled={!available}
                      className={`bg-white rounded-2xl border transition-all duration-200 text-left relative flex flex-col overflow-hidden select-none ${
                        available
                          ? "border-slate-100 hover:shadow-md hover:border-amber-200 active:scale-[0.98]"
                          : "opacity-60 cursor-not-allowed border-gray-200 bg-gray-50/50"
                      }`}
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          draggable={false}
                          className="w-full h-24 object-cover"
                        />
                      ) : (
                        <div className="w-full h-24 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                          <span className="text-3xl font-black text-slate-300 select-none">
                            {item.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      {!available && (
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-black uppercase bg-red-600 text-white rounded shadow-sm">
                          Out
                        </span>
                      )}
                      <div className="p-3 flex flex-col gap-1">
                        <p className="font-extrabold text-[#39B54A] text-xs leading-tight line-clamp-2">
                          {item.name}
                        </p>
                        <p className="text-[9px] text-gray-400 uppercase tracking-wider font-bold">
                          {item.category}
                        </p>
                        <p className="text-emerald-600 font-black text-sm mt-1">
                          KES {item.price.toLocaleString()}
                        </p>
                        {item.kitchenStats ? (
                          <div className="mt-1 space-y-0.5">
                            <p className="text-[9px] font-bold text-[#148A32]">
                              {item.kitchenStats.portionsReady} ready to sell
                            </p>
                            {item.kitchenStats.activeRemaining > 0 && (
                              <p className="text-[8px] text-amber-700 font-semibold">
                                KES {item.kitchenStats.activeRemaining.toLocaleString()} still expected
                              </p>
                            )}
                          </div>
                        ) : item.stockLevel != null ? (
                          <p className="text-[9px] text-gray-400 font-semibold">{item.stockLevel} left</p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-5 shadow-sm h-fit sticky top-6">
            <div className="space-y-2 flex flex-col">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                  Cart Items
                </span>
                {cart.length > 0 && (
                  <button
                    onClick={() => setCart([])}
                    className="text-xs font-bold text-red-500 hover:text-red-600 hover:underline transition"
                  >
                    Clear Cart
                  </button>
                )}
              </div>

              <div className="space-y-2 overflow-y-auto max-h-56 pr-1">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-gray-300">
                    <ShoppingCart size={28} strokeWidth={1.5} className="mb-1" />
                    <p className="text-[11px] font-bold">No items in cart</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.menuItemId}
                      className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-100 rounded-xl select-none"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-extrabold text-[#39B54A] text-xs truncate leading-tight">
                          {item.name}
                        </p>
                        <p className="text-[9px] text-gray-400 font-semibold mt-0.5">
                          KES {item.price.toLocaleString()} each
                        </p>
                      </div>
                      <div className="flex items-center gap-1 bg-white border border-gray-150 rounded-lg p-0.5 shadow-sm shrink-0">
                        <button
                          onClick={() => updateQty(item.menuItemId, -1)}
                          className="p-1 hover:bg-gray-50 rounded text-gray-650 hover:text-gray-800 transition"
                        >
                          <Minus size={10} />
                        </button>
                        <span className="w-4 text-center font-black text-[11px] text-[#39B54A]">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQty(item.menuItemId, 1)}
                          className="p-1 hover:bg-gray-50 rounded transition"
                        >
                          <Plus size={10} />
                        </button>
                      </div>
                      <div className="w-16 text-right font-black text-[#39B54A] text-xs shrink-0">
                        KES {(item.price * item.quantity).toLocaleString()}
                      </div>
                      <button
                        onClick={() => updateQty(item.menuItemId, -item.quantity)}
                        className="p-1 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition shrink-0"
                        title="Remove item"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500">Checkout Total</span>
                <span className="font-black text-lg text-[#39B54A]">KES {total.toLocaleString()}</span>
              </div>

              <button
                type="button"
                onClick={payWithCash}
                disabled={cashLoading || mpesaLoading || cart.length === 0}
                className="w-full py-3 bg-amber-500 text-white rounded-xl font-extrabold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition duration-200 flex items-center justify-center gap-2 shadow-sm"
              >
                <Banknote size={16} />
                <span>{cashLoading ? "Processing..." : "Cash Sale"}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowMpesa(true)}
                disabled={mpesaLoading || cashLoading || cart.length === 0}
                className="w-full py-3 bg-[#15A84F] text-white rounded-xl font-extrabold hover:bg-[#108c40] disabled:opacity-40 disabled:cursor-not-allowed transition duration-200 flex items-center justify-center gap-2 shadow-sm"
              >
                <Smartphone size={16} />
                <span>M-Pesa STK</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showMpesa && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 bg-[#15A84F] text-white flex items-center justify-between">
              <div>
                <p className="text-sm font-black uppercase tracking-wider">M-Pesa Payment</p>
                <p className="text-xs text-green-100 mt-0.5">STK Push · KES {total.toLocaleString()}</p>
              </div>
              <button
                type="button"
                onClick={() => !mpesaLoading && setShowMpesa(false)}
                className="p-1.5 rounded-lg hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Enter the customer&apos;s M-Pesa number — they will receive an STK prompt on their phone.
              </p>
              <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <Smartphone className="w-5 h-5 text-gray-400 mr-3" />
                <input
                  type="tel"
                  value={mpesaPhone}
                  onChange={(e) => setMpesaPhone(e.target.value)}
                  placeholder="0712345678"
                  className="w-full bg-transparent outline-none text-lg font-semibold"
                  disabled={mpesaLoading}
                />
              </div>
              <button
                type="button"
                onClick={payWithMpesa}
                disabled={mpesaLoading}
                className="w-full py-4 bg-[#15A84F] text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {mpesaLoading ? <Loader2 className="animate-spin" size={18} /> : <Smartphone size={18} />}
                {mpesaLoading ? "Awaiting M-Pesa PIN..." : `Send STK · KES ${total.toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipt && lastReceipt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 size={22} />
                <h3 className="font-bold text-[#39B54A]">Sale Complete</h3>
              </div>
              <button
                type="button"
                onClick={closeReceipt}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <OrderReceiptCard data={lastReceipt} />
            <button
              type="button"
              onClick={closeReceipt}
              className="mt-4 w-full py-3 bg-[#39B54A] text-white rounded-xl font-bold text-sm hover:bg-[#39B54A]/90"
            >
              New Sale
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosTerminal;
