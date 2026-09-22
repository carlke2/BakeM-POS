import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  UtensilsCrossed,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  Search,
  Fingerprint,
  X,
  Banknote,
  Smartphone,
} from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { captureFingerprint, checkScannerHealth, matchFingerprint, prepareScanner } from "@/services/fingerprintScanner";
import { receiptFromApiResponse, receiptFromGuestCash, type OrderReceiptData } from "@/lib/orderReceipt";
import { initiateStkPushAndWait } from "@/services/kopokopoPayment";
import OrderReceiptCard from "@/components/OrderReceiptCard";
import logo from "@/assets/LOGO.png";

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  imageUrl?: string;
  stockLevel?: number | null;
  batchYield?: number | null;
  isAvailable?: boolean;
}

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

interface StudentPreview {
  name: string;
  regNo: string;
  walletBalance: number;
  walletFrozen: boolean;
  pinEnabled: boolean;
  hasFingerprint: boolean;
}

type OrderDisplayProps = {
  mode: "kiosk" | "student";
};

type CheckoutStep = "cart" | "identify" | "auth" | "success";

const BRAND = "#0A1F44";
const publicOpts = { skipAuthRedirect: true as const };

const OrderDisplay = ({ mode }: OrderDisplayProps) => {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [category, setCategory] = useState("All");
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>("cart");
  const [regNo, setRegNo] = useState("");
  const [pin, setPin] = useState("");
  const [studentPreview, setStudentPreview] = useState<StudentPreview | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentPreview | null>(null);
  const [searchResults, setSearchResults] = useState<StudentPreview[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const [scannerReady, setScannerReady] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<OrderReceiptData | null>(null);
  const [fingerprintEnrolled, setFingerprintEnrolled] = useState(false);
  const [showMpesa, setShowMpesa] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [mpesaLoading, setMpesaLoading] = useState(false);

  const isKiosk = mode === "kiosk";

  const fetchMenu = useCallback(() => {
    API.get<MenuItem[]>("/menu/display", isKiosk ? publicOpts : undefined)
      .then((r) => setMenu(r.data))
      .catch(() => toast.error("Could not load menu"))
      .finally(() => setLoadingMenu(false));
  }, [isKiosk]);

  useEffect(() => {
    fetchMenu();
    if (!isKiosk) return;
    const timer = window.setInterval(fetchMenu, 30_000);
    return () => window.clearInterval(timer);
  }, [fetchMenu, isKiosk]);

  useEffect(() => {
    if (!isKiosk) {
      API.get("/students/me")
        .then((r) => {
          const s = r.data;
          setStudentProfile({
            name: s.name,
            regNo: s.regNo,
            walletBalance: s.walletBalance || 0,
            walletFrozen: Boolean(s.walletFrozen),
            pinEnabled: Boolean(s.walletPinSetAt),
            hasFingerprint: Boolean(s.hasFingerprint),
          });
        })
        .catch(() => toast.error("Failed to load your profile"));
    }
  }, [isKiosk]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isKiosk || checkoutStep !== "identify") return;

    const query = regNo.trim();
    if (studentPreview || query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setHighlightIndex(-1);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await API.get<StudentPreview[]>("/pos/kiosk/search", {
          params: { q: query },
          ...publicOpts,
        });
        setSearchResults(data);
        setShowResults(true);
        setHighlightIndex(data.length > 0 ? 0 : -1);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [regNo, studentPreview, isKiosk, checkoutStep]);

  const prepareAuthScanner = useCallback(async () => {
    try {
      const h = await checkScannerHealth();
      setScannerReady(h.deviceConnected);
      if (h.deviceConnected) await prepareScanner();
    } catch {
      setScannerReady(false);
    }
  }, []);

  useEffect(() => {
    if (checkoutStep === "auth") {
      prepareAuthScanner();
    }
  }, [checkoutStep, prepareAuthScanner]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(menu.map((m) => m.category)))],
    [menu],
  );

  const filtered = useMemo(() => {
    return menu.filter((m) => category === "All" || m.category === category);
  }, [menu, category]);

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const authOptions = useMemo(() => {
    const active = isKiosk ? studentPreview : studentProfile;
    return {
      pin: Boolean(active?.pinEnabled),
      fingerprint: Boolean(active?.hasFingerprint),
      canEnrollFingerprint: Boolean(active && !active.hasFingerprint && scannerReady !== false),
    };
  }, [isKiosk, studentPreview, studentProfile, scannerReady]);

  const validateStudentForCheckout = (student: StudentPreview): boolean => {
    if (student.walletFrozen) {
      toast.error("Wallet frozen", "Contact your parent or school admin");
      return false;
    }
    return true;
  };

  const selectStudent = (picked: StudentPreview) => {
    if (!validateStudentForCheckout(picked)) return;
    setStudentPreview(picked);
    setRegNo(picked.regNo);
    setSearchResults([]);
    setShowResults(false);
    setHighlightIndex(-1);
    setPin("");
    setCheckoutStep("auth");
  };

  const clearStudent = () => {
    setStudentPreview(null);
    setRegNo("");
    setSearchResults([]);
    setShowResults(false);
    setHighlightIndex(-1);
  };

  const isItemAvailable = (item: MenuItem) => {
    if (item.isAvailable === false) return false;
    if (item.batchYield) return (item.stockLevel ?? 0) > 0;
    return item.stockLevel == null || item.stockLevel > 0;
  };

  const maxQtyForItem = (menuItemId: string) => {
    const item = menu.find((m) => m.id === menuItemId);
    if (!item || item.stockLevel == null) return Infinity;
    return item.stockLevel;
  };

  const addToCart = (item: MenuItem) => {
    if (!isItemAvailable(item)) {
      return toast.warning("Out of stock", `${item.name} is not available right now`);
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      const maxQty = maxQtyForItem(item.id);
      if (existing && existing.quantity >= maxQty) {
        toast.warning("Stock limit", `Only ${maxQty} available`);
        return prev;
      }
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
        .map((c) => {
          if (c.menuItemId !== id) return c;
          const maxQty = maxQtyForItem(id);
          const next = c.quantity + delta;
          if (next > maxQty) {
            toast.warning("Stock limit", `Only ${maxQty} available`);
            return { ...c, quantity: maxQty };
          }
          return { ...c, quantity: next };
        })
        .filter((c) => c.quantity > 0),
    );
  };

  const startCheckout = () => {
    if (cart.length === 0) return toast.warning("Cart is empty", "Add items before checkout");
    if (isKiosk) {
      setCheckoutStep("identify");
      setRegNo("");
      setPin("");
      setStudentPreview(null);
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    if (!studentProfile) return toast.error("Profile not loaded");
    if (!validateStudentForCheckout(studentProfile)) return;
    setCheckoutStep("auth");
    setPin("");
  };

  const lookupStudent = async () => {
    const query = regNo.trim();
    if (!query) {
      return toast.warning("Enter a search term", "Type a name, reg no, or phone number");
    }

    if (highlightIndex >= 0 && searchResults[highlightIndex]) {
      selectStudent(searchResults[highlightIndex]);
      return;
    }

    if (searchResults.length === 1) {
      selectStudent(searchResults[0]);
      return;
    }

    if (query.length < 2) {
      return toast.warning("Keep typing", "Enter at least 2 characters to search");
    }

    setProcessing(true);
    try {
      const { data } = await API.get<StudentPreview>(
        `/pos/kiosk/lookup/${encodeURIComponent(query)}`,
        publicOpts,
      );
      selectStudent(data);
    } catch (e: any) {
      setStudentPreview(null);
      toast.error("Student not found", e.response?.data?.message || `No student matches "${query}"`);
    } finally {
      setProcessing(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showResults || searchResults.length === 0) return;
      setHighlightIndex((prev) => (prev + 1) % searchResults.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!showResults || searchResults.length === 0) return;
      setHighlightIndex((prev) => (prev <= 0 ? searchResults.length - 1 : prev - 1));
      return;
    }
    if (e.key === "Escape") {
      setShowResults(false);
      setHighlightIndex(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      lookupStudent();
    }
  };

  const submitOrder = async (
    auth: { pin?: string; fingerprintTemplate?: string; fingerprintMatchScore?: number },
    options?: { enrollFingerprint?: boolean },
  ) => {
    const active = isKiosk ? studentPreview : studentProfile;
    if (!active) return;

    if (active.walletBalance < total) {
      return toast.error("Insufficient balance", `You need KES ${total} but have KES ${active.walletBalance}`);
    }

    setProcessing(true);
    try {
      const payload = {
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
        auth,
        enrollFingerprint: options?.enrollFingerprint,
      };

      const { data } = isKiosk
        ? await API.post("/pos/kiosk-order", { regNo: active.regNo, ...payload }, publicOpts)
        : await API.post("/pos/student-order", payload);

      setLastReceipt(
        receiptFromApiResponse(data.receipt, { name: active.name, regNo: active.regNo }),
      );
      setFingerprintEnrolled(Boolean(data.fingerprintEnrolled));
      setCart([]);
      setPin("");
      setCheckoutStep("success");

      const profilePatch = {
        walletBalance: data.newBalance,
        hasFingerprint: active.hasFingerprint || Boolean(data.fingerprintEnrolled),
      };
      if (!isKiosk && studentProfile) {
        setStudentProfile({ ...studentProfile, ...profilePatch });
      }
      if (isKiosk && studentPreview) {
        setStudentPreview({ ...studentPreview, ...profilePatch });
      }

      fetchMenu();

      if (data.fingerprintEnrolled) {
        toast.success("Fingerprint enrolled", "Your fingerprint is saved for future orders");
      }
    } catch (e: any) {
      toast.error("Order failed", e.response?.data?.message || "Could not complete order");
    } finally {
      setProcessing(false);
    }
  };

  const payWithCashGuest = async () => {
    if (cart.length === 0) return toast.warning("Cart is empty");
    const confirmed = await toast.confirm("Confirm cash payment?", {
      description: `Collect KES ${total.toLocaleString()} at the counter, then complete this sale.`,
      confirmLabel: "Payment received",
    });
    if (!confirmed) return;

    setProcessing(true);
    try {
      const payload = {
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
      };
      const { data } = await API.post("/pos/kiosk-cash-order", payload, publicOpts);
      setLastReceipt(receiptFromGuestCash(data.receipt));
      setCart([]);
      setCheckoutStep("success");
      fetchMenu();
      toast.success("Cash sale complete", `Receipt ${data.receipt.receiptNo || ""}`);
    } catch (e: any) {
      toast.error("Cash payment failed", e.response?.data?.message || "Could not complete order");
    } finally {
      setProcessing(false);
    }
  };

  const payWithMpesaGuest = async () => {
    if (cart.length === 0) return toast.warning("Cart is empty");
    if (!/^(01|07)\d{8}$/.test(mpesaPhone.trim())) {
      return toast.error("Invalid phone", "Enter a valid 10-digit M-Pesa number");
    }

    setMpesaLoading(true);
    try {
      const result = await initiateStkPushAndWait(
        {
          phone: mpesaPhone.trim(),
          amount: total,
          description: "SmartPOS Kiosk Cafeteria Sale",
          purpose: "pos_sale",
          items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
          useAuth: false,
          kiosk: true,
        },
        () => toast.info("STK sent", "Enter M-Pesa PIN on your phone"),
      );

      const status = (result.status || "").toLowerCase();
      if (status === "success" || status === "received" || status === "complete") {
        const cartSnapshot = [...cart];
        const saleTotal = total;
        const phone = mpesaPhone.trim();

        let receiptData: OrderReceiptData = {
          receiptNo: result.posReceiptNo || `ORDER-${Date.now()}`,
          studentName: "Guest",
          regNo: phone,
          items: cartSnapshot.map((c) => ({
            name: c.name,
            quantity: c.quantity,
            price: c.price,
          })),
          total: saleTotal,
          paidAt: new Date().toISOString(),
          paymentMethod: "M-Pesa",
        };

        setLastReceipt(receiptData);
        setCart([]);
        setShowMpesa(false);
        setMpesaPhone("");
        setCheckoutStep("success");
        fetchMenu();
        toast.success("M-Pesa payment complete", `${receiptData.receiptNo} · KES ${saleTotal.toLocaleString()}`);
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

  const placeOrderWithPin = async () => {
    if (!authOptions.pin) return toast.error("PIN not set", "Ask your parent to set a wallet PIN first");
    if (!/^\d{4}$/.test(pin)) return toast.error("Invalid PIN", "Enter your 4-digit wallet PIN");
    await submitOrder({ pin });
  };

  const placeOrderWithFingerprint = async () => {
    const active = isKiosk ? studentPreview : studentProfile;
    if (!active) return;
    if (!authOptions.fingerprint) {
      return toast.error("Fingerprint not enrolled", "Enroll your fingerprint first");
    }
    if (scannerReady === false) {
      return toast.error("Scanner offline", "Fingerprint scanner is not available on this kiosk");
    }
    setProcessing(true);
    try {
      await prepareScanner();
      const { data: enrolled } = await API.get<{ fingerprintTemplate: string }>(
        `/pos/kiosk/student-fingerprint/${encodeURIComponent(active.regNo)}`,
        isKiosk ? publicOpts : undefined,
      );
      const tpl = await captureFingerprint();
      const { matched, score } = await matchFingerprint(tpl, [enrolled.fingerprintTemplate]);
      if (!matched) {
        toast.error("Fingerprint did not match", "Use the same finger that was enrolled");
        setProcessing(false);
        return;
      }
      await submitOrder({ fingerprintTemplate: tpl, fingerprintMatchScore: score });
    } catch (e: any) {
      toast.error("Fingerprint failed", e.response?.data?.message || e.message || "Could not verify fingerprint");
      setProcessing(false);
    }
  };

  const enrollFingerprintAndPay = async () => {
    if (authOptions.fingerprint) {
      return placeOrderWithFingerprint();
    }
    if (scannerReady === false) {
      return toast.error("Scanner offline", "Fingerprint scanner is not available on this kiosk");
    }
    if (authOptions.pin && !/^\d{4}$/.test(pin)) {
      return toast.error("PIN required", "Enter your wallet PIN to enroll your fingerprint");
    }
    setProcessing(true);
    try {
      await prepareScanner();
      const tpl = await captureFingerprint();
      await submitOrder(
        {
          fingerprintTemplate: tpl,
          pin: authOptions.pin ? pin : undefined,
        },
        { enrollFingerprint: true },
      );
    } catch (e: any) {
      toast.error("Enrollment failed", e.message || "Could not enroll fingerprint");
      setProcessing(false);
    }
  };

  const appendPin = (digit: string) => {
    if (pin.length < 4) setPin((p) => p + digit);
  };

  const resetOrder = () => {
    setCheckoutStep("cart");
    setRegNo("");
    setPin("");
    setStudentPreview(null);
    setSearchResults([]);
    setShowResults(false);
    setLastReceipt(null);
    setFingerprintEnrolled(false);
    setShowMpesa(false);
    setMpesaPhone("");
  };

  const activeStudent = isKiosk ? studentPreview : studentProfile;

  if (checkoutStep === "success" && lastReceipt) {
    return (
      <div className="min-h-screen bg-[#E8F4FD] flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center border border-gray-100">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[#0A1F44]">Order Complete!</h1>
          <p className="text-xs text-gray-400 mt-2">Your receipt is ready to print or download</p>

          <div className="mt-6 text-left">
            <OrderReceiptCard data={lastReceipt} />
          </div>

          {fingerprintEnrolled && (
            <p className="text-xs text-teal-600 font-semibold mt-4 pt-4 border-t border-gray-100 text-center">
              Fingerprint enrolled — you can use it on your next order.
            </p>
          )}

          <button
            type="button"
            onClick={resetOrder}
            style={{ backgroundColor: BRAND }}
            className="mt-6 w-full py-4 rounded-2xl text-white font-bold"
          >
            Order Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E8F4FD] font-sans flex flex-col">
      <header className="bg-[#0A1F44] text-white px-4 py-4 md:px-8 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {!isKiosk && (
            <Link to="/student/wallet" className="p-2 rounded-xl hover:bg-white/10">
              <ArrowLeft size={20} />
            </Link>
          )}
          <img src={logo} alt="" className="h-10 w-auto hidden sm:block" />
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold flex items-center gap-2 truncate">
              <UtensilsCrossed size={22} className="shrink-0" />
              {isKiosk ? "Cafeteria Order" : "Order Food"}
            </h1>
            <p className="text-blue-200 text-xs truncate">
              {isKiosk
                ? "Select meals · Verify with PIN or fingerprint at checkout"
                : studentProfile
                  ? `${studentProfile.name} · Balance KES ${studentProfile.walletBalance.toLocaleString()}`
                  : "Loading..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white/10 rounded-2xl px-4 py-2 shrink-0">
          <ShoppingCart size={18} />
          <span className="font-bold">{cart.reduce((s, c) => s + c.quantity, 0)}</span>
          <span className="text-blue-200">·</span>
          <span className="font-bold">KES {total.toLocaleString()}</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-0 lg:gap-4 p-4 md:p-6 min-h-0">
        <main className="flex-1 min-h-0 flex flex-col">
          <div className="flex gap-2 overflow-x-auto pb-3 shrink-0">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                  category === cat
                    ? "bg-[#0A1F44] text-white"
                    : "bg-white text-gray-600 border border-gray-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {loadingMenu ? (
            <Loader size="sm" title="Loading menu..." className="py-16" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto pb-4">
              {filtered.map((item) => {
                const available = isItemAvailable(item);
                return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => available && addToCart(item)}
                  disabled={!available}
                  className={`bg-white rounded-2xl border p-4 text-left shadow-sm transition active:scale-[0.98] relative ${
                    available
                      ? "border-gray-100 hover:shadow-md hover:border-[#0A1F44]/20"
                      : "border-gray-200 opacity-60 cursor-not-allowed"
                  }`}
                >
                  {!available && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-black uppercase bg-red-600 text-white rounded">
                      Out
                    </span>
                  )}
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-full h-24 object-cover rounded-xl mb-3 bg-gray-100"
                    />
                  ) : (
                    <div className="w-full h-24 rounded-xl bg-gray-100 mb-3 flex items-center justify-center text-gray-300">
                      <UtensilsCrossed size={32} />
                    </div>
                  )}
                  <p className="font-bold text-[#0A1F44] text-sm leading-tight">{item.name}</p>
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                  <p className="text-emerald-600 font-extrabold mt-2">KES {item.price}</p>
                  {item.stockLevel != null && (
                    <p className="text-[10px] text-indigo-600 font-bold mt-1">{item.stockLevel} available</p>
                  )}
                </button>
              );
              })}
            </div>
          )}
        </main>

        <aside className="w-full lg:w-96 shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col max-h-[50vh] lg:max-h-none">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-bold text-[#0A1F44]">Your Cart</h2>
          </div>

          {checkoutStep === "cart" && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[120px]">
                {cart.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Tap a meal to add it</p>
                ) : (
                  cart.map((item) => (
                    <div key={item.menuItemId} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.name}</p>
                        <p className="text-xs text-gray-400">KES {item.price} each</p>
                      </div>
                      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                        <button type="button" onClick={() => updateQty(item.menuItemId, -1)} className="p-1.5">
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <button type="button" onClick={() => updateQty(item.menuItemId, 1)} className="p-1.5">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 border-t border-gray-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex justify-between font-bold text-base flex-1">
                    <span>Total</span>
                    <span className="text-emerald-600">KES {total.toLocaleString()}</span>
                  </div>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="text-[11px] text-red-500 flex items-center gap-1 shrink-0"
                    >
                      <Trash2 size={11} /> Clear
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={startCheckout}
                  style={{ backgroundColor: BRAND }}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-40"
                >
                  {isKiosk ? "Pay with Wallet" : "Checkout"}
                </button>
                {isKiosk && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={mpesaLoading || processing || cart.length === 0}
                      onClick={() => setShowMpesa(true)}
                      className="py-2.5 rounded-xl bg-[#15A84F] hover:bg-[#108c40] text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      <Smartphone size={15} />
                      M-Pesa
                    </button>
                    <button
                      type="button"
                      disabled={processing || mpesaLoading || cart.length === 0}
                      onClick={payWithCashGuest}
                      className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      <Banknote size={15} />
                      {processing ? "..." : "Cash"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {checkoutStep === "identify" && isKiosk && (
            <div className="p-4 space-y-4 flex-1 flex flex-col min-h-0">
              <p className="text-sm text-gray-600">
                Find your account by name, registration number, or phone. You will verify with PIN or fingerprint on this screen - staff cannot see it.
              </p>

              {!studentPreview ? (
                <div className="relative flex-1 flex flex-col min-h-0" ref={searchRef}>
                  <div className="flex gap-2 shrink-0">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                        <Search size={16} />
                      </span>
                      <input
                        type="text"
                        value={regNo}
                        onChange={(e) => {
                          setRegNo(e.target.value);
                          setShowResults(true);
                        }}
                        onFocus={() => searchResults.length > 0 && setShowResults(true)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Name, reg no, or phone"
                        autoComplete="off"
                        autoFocus
                        className="w-full pl-10 pr-10 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-2xl text-base font-semibold focus:outline-none focus:border-[#0A1F44] focus:bg-white transition"
                      />
                      {searching && (
                        <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                          <Loader2 size={18} className="animate-spin" />
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={lookupStudent}
                      disabled={processing}
                      style={{ backgroundColor: BRAND }}
                      className="px-4 py-3.5 text-white rounded-2xl font-bold disabled:opacity-50 shrink-0"
                      title="Select student"
                    >
                      <Search size={20} />
                    </button>
                  </div>

                  {showResults && regNo.trim().length >= 2 && (
                    <div className="mt-2 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden flex-1 min-h-0 flex flex-col">
                      {searching && searchResults.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-gray-400">Searching...</p>
                      ) : searchResults.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-gray-400">No students found</p>
                      ) : (
                        <ul className="overflow-y-auto flex-1">
                          {searchResults.map((result, index) => (
                            <li key={result.regNo}>
                              <button
                                type="button"
                                onMouseEnter={() => setHighlightIndex(index)}
                                onClick={() => selectStudent(result)}
                                className={`w-full px-4 py-3.5 text-left flex items-center gap-3 transition ${
                                  highlightIndex === index ? "bg-indigo-50" : "hover:bg-gray-50"
                                }`}
                              >
                                <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-[#0A1F44]/10 text-[#0A1F44] font-extrabold text-xs shrink-0 uppercase">
                                  {result.name.slice(0, 2)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-[#0A1F44] text-sm truncate">{result.name}</p>
                                  <p className="text-xs text-gray-400 font-semibold mt-0.5">{result.regNo}</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-xs font-black text-emerald-600">
                                    KES {Number(result.walletBalance || 0).toLocaleString()}
                                  </p>
                                  {result.walletFrozen ? (
                                    <p className="text-[10px] font-bold text-red-500 mt-0.5">Frozen</p>
                                  ) : result.hasFingerprint ? (
                                    <p className="text-[10px] font-bold text-teal-600 mt-0.5">Fingerprint</p>
                                  ) : (
                                    <p className="text-[10px] font-bold text-amber-600 mt-0.5">No fingerprint</p>
                                  )}
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="px-4 py-2 border-t border-slate-100 text-[10px] text-gray-400 bg-slate-50 shrink-0">
                        ↑↓ to navigate · Enter to select
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl relative shrink-0">
                  <button
                    type="button"
                    onClick={clearStudent}
                    className="absolute top-3 right-3 text-emerald-600 hover:bg-emerald-100 p-1.5 rounded-lg transition"
                    title="Change student"
                  >
                    <X size={16} />
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-extrabold text-xs shrink-0 uppercase">
                      {studentPreview.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-[#0A1F44] text-sm truncate">{studentPreview.name}</p>
                      <p className="text-xs text-emerald-700 font-bold tracking-wider uppercase mt-0.5">{studentPreview.regNo}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-emerald-100/50 flex items-center justify-between text-sm">
                    <span className="text-emerald-700/80 font-semibold">Wallet balance</span>
                    <span className="text-emerald-800 font-black">KES {Number(studentPreview.walletBalance || 0).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {studentPreview.pinEnabled && (
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-indigo-100 text-indigo-700 rounded">PIN</span>
                    )}
                    {studentPreview.hasFingerprint ? (
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-teal-100 text-teal-700 rounded">Fingerprint enrolled</span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-amber-100 text-amber-700 rounded">No fingerprint yet</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-auto shrink-0">
                <button type="button" onClick={() => setCheckoutStep("cart")} className="flex-1 py-3 rounded-xl border font-semibold">
                  Back
                </button>
                {studentPreview && (
                  <button
                    type="button"
                    onClick={() => setCheckoutStep("auth")}
                    style={{ backgroundColor: BRAND }}
                    className="flex-1 py-3 rounded-xl text-white font-bold"
                  >
                    Continue to pay
                  </button>
                )}
              </div>
            </div>
          )}

          {checkoutStep === "auth" && activeStudent && (
            <div className="p-4 space-y-4 flex-1 flex flex-col overflow-y-auto">
              <div className="bg-gray-50 rounded-2xl p-4 text-center shrink-0">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Paying as</p>
                <p className="font-bold text-[#0A1F44]">{activeStudent.name}</p>
                <p className="text-xs text-gray-500">{activeStudent.regNo}</p>
                <p className="text-sm mt-2">
                  Balance: <strong>KES {activeStudent.walletBalance.toLocaleString()}</strong>
                  {" · "}
                  Total: <strong className="text-emerald-600">KES {total.toLocaleString()}</strong>
                </p>
                <p className="text-xs mt-2">
                  Fingerprint:{" "}
                  <strong className={activeStudent.hasFingerprint ? "text-teal-600" : "text-amber-600"}>
                    {activeStudent.hasFingerprint ? "Enrolled in system" : "Not enrolled yet"}
                  </strong>
                </p>
              </div>

              {authOptions.pin && (
                <div className="space-y-3 shrink-0">
                  <div className="flex items-center justify-center gap-2 text-[#0A1F44]">
                    <KeyRound size={18} />
                    <span className="text-sm font-semibold">
                      {authOptions.fingerprint ? "Option A: Wallet PIN" : authOptions.canEnrollFingerprint ? "Wallet PIN" : "Option A: Wallet PIN"}
                    </span>
                  </div>

                  <div className="flex justify-center gap-3">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`w-4 h-4 rounded-full border-2 ${
                          pin.length > i ? "bg-[#0A1F44] border-[#0A1F44]" : "border-gray-300"
                        }`}
                      />
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto w-full">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((key) => (
                      <button
                        key={key}
                        type="button"
                        disabled={processing}
                        onClick={() => {
                          if (key === "C") setPin("");
                          else if (key === "⌫") setPin((p) => p.slice(0, -1));
                          else appendPin(key);
                        }}
                        className="py-4 rounded-2xl bg-gray-100 font-bold text-lg hover:bg-gray-200 active:scale-95 disabled:opacity-50"
                      >
                        {key}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={processing || pin.length !== 4}
                    onClick={placeOrderWithPin}
                    style={{ backgroundColor: BRAND }}
                    className="w-full py-3 rounded-xl text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {processing ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={16} />}
                    Pay KES {total.toLocaleString()} with Wallet's PIN
                  </button>
                </div>
              )}

              {authOptions.fingerprint && (
                <div className={`space-y-2 shrink-0 ${authOptions.pin ? "border-t border-gray-100 pt-4" : ""}`}>
                  <div className="flex items-center justify-center gap-2 text-[#0A1F44]">
                    <Fingerprint size={18} />
                    <span className="text-sm font-semibold">
                      {authOptions.pin ? "Option B: Fingerprint" : "Verify with fingerprint"}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={processing || scannerReady === false}
                    onClick={placeOrderWithFingerprint}
                    className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-2xl transition flex items-center justify-center gap-2 disabled:opacity-50 border border-gray-200"
                  >
                    {processing ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <Fingerprint size={20} className={scannerReady !== false ? "text-indigo-600" : ""} />
                    )}
                    {processing ? "Scanning..." : "Pay with fingerprint"}
                  </button>
                  {scannerReady === false && (
                    <p className="text-xs text-amber-600 text-center">Fingerprint scanner is offline on this device.</p>
                  )}
                </div>
              )}

              {authOptions.canEnrollFingerprint && (
                <div
                  className={`space-y-3 shrink-0 ${
                    authOptions.pin || authOptions.fingerprint ? "border-t border-gray-100 pt-4" : ""
                  }`}
                >
                  <div className="flex items-center justify-center gap-2 text-[#0A1F44]">
                    <Fingerprint size={18} />
                    <span className="text-sm font-semibold">
                      {authOptions.fingerprint
                        ? "Fingerprint"
                        : authOptions.pin
                          ? "First time? Enroll fingerprint"
                          : "Enroll fingerprint & pay"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 text-center leading-relaxed">
                    {authOptions.pin
                      ? "Enter your PIN above, then scan your finger once to save it and complete this order."
                      : "Place your finger on the scanner to register it and pay for this order."}
                  </p>
                  <button
                    type="button"
                    disabled={processing || (authOptions.pin && pin.length !== 4)}
                    onClick={enrollFingerprintAndPay}
                    className="w-full py-4 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold rounded-2xl transition flex items-center justify-center gap-2 disabled:opacity-50 border border-teal-200"
                  >
                    {processing ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <Fingerprint size={20} className="text-teal-600" />
                    )}
                    {processing ? "Scanning..." : `Enroll fingerprint & pay KES ${total.toLocaleString()}`}
                  </button>
                </div>
              )}

              {!authOptions.pin && !authOptions.fingerprint && !authOptions.canEnrollFingerprint && (
                <div className="text-sm text-amber-600 text-center space-y-2">
                  <p>No wallet PIN or fingerprint is set up yet.</p>
                  <p className="text-xs text-gray-500">
                    Ask your parent to set a wallet PIN, or use a kiosk with a fingerprint scanner to enroll.
                  </p>
                </div>
              )}

              <div className="flex gap-2 mt-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPin("");
                    setCheckoutStep(isKiosk ? "identify" : "cart");
                  }}
                  className="flex-1 py-3 rounded-xl border font-semibold"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {isKiosk && showMpesa && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 bg-[#15A84F] text-white flex items-center justify-between">
              <div>
                <p className="text-sm font-black uppercase tracking-wider">M-Pesa STK Payment</p>
                <p className="text-xs text-green-100 mt-0.5">KES {total.toLocaleString()}</p>
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
                Enter your M-Pesa number. You will receive an STK prompt on your phone to complete payment.
              </p>
              <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <Smartphone className="w-5 h-5 text-gray-400 mr-3 shrink-0" />
                <input
                  type="tel"
                  value={mpesaPhone}
                  onChange={(e) => setMpesaPhone(e.target.value)}
                  placeholder="0712345678"
                  className="w-full bg-transparent outline-none text-lg font-semibold"
                  disabled={mpesaLoading}
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={payWithMpesaGuest}
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
    </div>
  );
};

export default OrderDisplay;
