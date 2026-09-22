import { useEffect, useState } from "react";
import { ShoppingCart, Plus, Minus, Trash2, Wallet } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { displayReceiptNo } from "@/lib/receipt";
import logo from "@/assets/LOGO.png";

interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
}

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

const StudentOrder = () => {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);

  const studentName = localStorage.getItem("studentName") || "Student";
  const regNo = localStorage.getItem("regNo") || "";

  const fetchBalance = () => {
    API.get("/wallet/balance")
      .then((r) => setBalance(r.data.balance))
      .catch(() => {});
  };

  useEffect(() => {
    API.get("/menu")
      .then((r) => setMenu(r.data))
      .catch(() => toast.error("Could not load menu"))
      .finally(() => setMenuLoading(false));
    fetchBalance();
  }, []);

  const categories = ["All", ...new Set(menu.map((m) => m.category))];
  const filtered = category === "All" ? menu : menu.filter((m) => m.category === category);
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const shortfall = Math.max(0, total - balance);

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.menuItemId === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  };

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return toast.warning("Your cart is empty");
    if (shortfall > 0) {
      return toast.error(
        "Insufficient balance",
        `You need KES ${shortfall.toLocaleString()} more. Top up your wallet first.`,
      );
    }

    setLoading(true);
    try {
      const { data } = await API.post("/pos/student-order", {
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
      });

      toast.success(
        "Order placed!",
        `${displayReceiptNo(data.receipt)} · Balance KES ${data.newBalance.toLocaleString()}`,
      );
      setCart([]);
      setBalance(data.newBalance);
    } catch (e: any) {
      toast.error("Order failed", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 bg-[#E8F4FD] min-h-screen font-sans">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src={logo} alt="SmartPOS" className="w-14 h-14 object-contain bg-white rounded-xl p-1" />
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <ShoppingCart size={24} /> Cafeteria Menu
            </h2>
            <p className="text-blue-200 text-sm mt-1">
              {studentName} · {regNo}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
          <Wallet size={18} className="text-green-300" />
          <span className="text-sm">Balance: <strong>KES {balance.toLocaleString()}</strong></span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                  category === cat ? "bg-[#0A1F44] text-white" : "bg-white text-gray-600 border"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {menuLoading ? (
            <Loader size="sm" title="Loading menu..." subtitle="Fetching today's cafeteria items" className="py-12" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filtered.map((item) => (
                <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-[#0A1F44]">{item.name}</h3>
                    {item.description && <p className="text-xs text-gray-500 mt-1">{item.description}</p>}
                    <p className="text-green-600 font-bold mt-2">KES {item.price}</p>
                  </div>
                  <button
                    onClick={() => addToCart(item)}
                    className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 h-fit sticky top-4">
          <h3 className="font-bold text-[#0A1F44] mb-4 flex items-center gap-2">
            <ShoppingCart size={18} /> Your Order
          </h3>

          <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
            {cart.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Cart is empty</p>
            ) : (
              cart.map((item) => (
                <div key={item.menuItemId} className="flex items-center justify-between text-sm">
                  <span className="flex-1 truncate">{item.name}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQty(item.menuItemId, -1)} className="p-0.5 text-gray-400 hover:text-gray-600">
                      <Minus size={14} />
                    </button>
                    <span className="w-5 text-center font-medium">{item.quantity}</span>
                    <button onClick={() => updateQty(item.menuItemId, 1)} className="p-0.5 text-gray-400 hover:text-gray-600">
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="w-16 text-right font-medium">KES {(item.price * item.quantity).toFixed(0)}</span>
                  <button
                    onClick={() => updateQty(item.menuItemId, -item.quantity)}
                    className="p-1 text-red-400 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t pt-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-[#0A1F44]">KES {total.toFixed(0)}</span>
            </div>
            {shortfall > 0 && total > 0 && (
              <p className="text-xs text-red-600 font-medium">
                Need KES {shortfall.toFixed(0)} more - top up your wallet to checkout
              </p>
            )}
          </div>

          <form onSubmit={placeOrder} className="space-y-3 border-t pt-3">
            <button
              type="submit"
              disabled={loading || cart.length === 0 || shortfall > 0}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              <Wallet size={18} />
              {loading ? (
                <>
                  <Loader size="xs" showText={false} />
                  Processing...
                </>
              ) : `Pay KES ${total.toFixed(0)} from Wallet`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default StudentOrder;
