import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Receipt, FileJson, X, Copy, Check, Search, Filter, Wallet, UserPlus, AlertTriangle, ClipboardPlus } from "lucide-react";
import API from "@/services/api";
import Loader from "@/components/ui/loader";
import { toast } from "@/services/toast";
import StudentPicker, { type StudentOption } from "@/components/StudentPicker";
import WalletAdjustModal from "@/components/WalletAdjustModal";

type CollectionRow = {
  id?: string;
  source?: string;
  channel?: string;
  mpesaNumber: string;
  date: string;
  name: string;
  admNo: string;
  method: string;
  amount: number;
  attemptedAmount?: number;
  status: string;
  type: string;
  metadata: string;
  transactionRef?: string;
  walletCredited?: boolean;
  allocatable?: boolean;
  payload?: Record<string, unknown>;
};

type CollectionsSummary = {
  tillInflow: number;
  walletTopUps: number;
  cashSales: number;
  usage: number;
  recordCount: number;
  uniqueTillPayments?: number;
};

type KopoSearchResult = {
  id: string;
  amount: number;
  phone: string;
  status: string;
  purpose: string;
  transactionReference: string;
  date: string;
  studentName: string | null;
  studentRegNo: string | null;
  allocatable: boolean;
};

const formatKes = (n: number) => `KES ${Number(n || 0).toLocaleString()}`;

const statusBadge = (status: string) => {
  const s = (status || "").toLowerCase();
  if (["success", "received", "complete", "completed", "paid"].includes(s)) {
    return "bg-emerald-100 text-emerald-700";
  }
  if (["failed", "error", "reversed", "cancelled", "superseded"].includes(s)) {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-amber-100 text-amber-800";
};

type StatusFilter = "all" | "success" | "pending" | "failed";
type SourceFilter =
  | "all"
  | "till"
  | "stk"
  | "student_wallets"
  | "wallet_topup"
  | "wallet_usage"
  | "guest"
  | "cash"
  | "unallocated";

const SOURCE_FILTERS: { value: SourceFilter; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Every collection record" },
  { value: "till", label: "Till (Buy Goods)", hint: "Lipa na M-Pesa till payments" },
  { value: "stk", label: "STK Push", hint: "Parent/guest STK payments" },
  { value: "student_wallets", label: "Student wallets", hint: "Top-ups and cafeteria usage" },
  { value: "wallet_topup", label: "Wallet top-ups", hint: "Money added to student wallets" },
  { value: "wallet_usage", label: "Wallet usage", hint: "Cafeteria purchases from wallets" },
  { value: "unallocated", label: "Unallocated till", hint: "Till money not yet assigned" },
  { value: "guest", label: "Guest POS", hint: "Guest M-Pesa & cash sales" },
  { value: "cash", label: "Cash only", hint: "Guest cash POS" },
];

const isGuestPosRow = (row: CollectionRow) =>
  row.source === "pos_mpesa" ||
  row.source === "pos_cash" ||
  (row.source === "kopo" && row.type === "pos_sale");

const statusBucket = (status: string): StatusFilter => {
  const s = (status || "").toLowerCase();
  if (["success", "received", "complete", "completed", "paid"].includes(s)) return "success";
  if (["failed", "error", "reversed", "cancelled", "superseded"].includes(s)) return "failed";
  return "pending";
};

const isWalletTopUpRow = (row: CollectionRow) =>
  (row.source === "kopo" && row.type === "wallet_topup") ||
  (row.source === "wallet" && row.type === "deposit");

const isWalletUsageRow = (row: CollectionRow) =>
  row.source === "wallet" && (row.type === "purchase" || row.type === "refund");

const rowChannel = (row: CollectionRow): string => {
  const fromPayload = typeof row.payload?.channel === "string" ? row.payload.channel : "";
  if (fromPayload) return fromPayload;
  if (row.channel) return row.channel;
  if (row.source === "pos_cash") return "cash";
  if (row.source === "pos_mpesa" || (row.source === "kopo" && row.type === "pos_sale")) return "stk";
  if (row.source === "wallet") return "wallet";
  if (row.source === "kopo" && row.type === "wallet_topup") {
    return /till → student wallet|manual allocation/i.test(`${row.method} ${row.metadata}`)
      ? "wallet"
      : "stk";
  }
  if (row.source === "kopo") return "till";
  return "other";
};

const isTillBuyGoodsRow = (row: CollectionRow) =>
  rowChannel(row) === "till" ||
  (row.source === "kopo" && row.type !== "wallet_topup" && row.type !== "pos_sale");

const isStkPushRow = (row: CollectionRow) =>
  rowChannel(row) === "stk" ||
  row.source === "pos_mpesa" ||
  (row.source === "kopo" && row.type === "pos_sale") ||
  (row.source === "kopo" &&
    row.type === "wallet_topup" &&
    !/till → student wallet|manual allocation/i.test(`${row.method} ${row.metadata}`));

const matchesSource = (row: CollectionRow, source: SourceFilter): boolean => {
  if (source === "all") return true;
  if (source === "till") return isTillBuyGoodsRow(row);
  if (source === "stk") return isStkPushRow(row);
  if (source === "student_wallets") return isWalletTopUpRow(row) || isWalletUsageRow(row);
  if (source === "wallet_topup") return isWalletTopUpRow(row);
  if (source === "wallet_usage") return isWalletUsageRow(row);
  if (source === "unallocated") return Boolean(row.allocatable);
  if (source === "cash") return row.source === "pos_cash";
  if (source === "guest") return isGuestPosRow(row);
  return true;
};

const channelBadge = (channel: string) => {
  switch (channel) {
    case "till":
      return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "stk":
      return "bg-indigo-50 text-indigo-700 border-indigo-100";
    case "wallet":
      return "bg-sky-50 text-sky-700 border-sky-100";
    case "cash":
      return "bg-amber-50 text-amber-800 border-amber-100";
    default:
      return "bg-gray-50 text-gray-600 border-gray-100";
  }
};

const channelLabel = (channel: string) => {
  switch (channel) {
    case "till":
      return "Till";
    case "stk":
      return "STK";
    case "wallet":
      return "Wallet";
    case "cash":
      return "Cash";
    default:
      return channel || "Other";
  }
};

const PayloadModal = ({
  rows,
  selectedId,
  onClose,
  onSelect,
}: {
  rows: CollectionRow[];
  selectedId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.admNo, r.metadata, r.method, r.status, r.transactionRef, r.mpesaNumber]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  const selected =
    rows.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  const json = selected?.payload
    ? JSON.stringify(selected.payload, null, 2)
    : "No payload available for this record.";

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-bold text-[#0A1F44] flex items-center gap-2">
              <FileJson size={18} /> Transaction payloads
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {rows.length} records · metadata and Kopokopo responses
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <div className="md:w-2/5 border-b md:border-b-0 md:border-r border-gray-100 flex flex-col min-h-0">
            <div className="p-3 border-b border-gray-50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, adm no, ref..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 max-h-64 md:max-h-none">
              {filtered.length === 0 ? (
                <p className="p-4 text-sm text-gray-400 text-center">No matches</p>
              ) : (
                filtered.map((r) => (
                  <button
                    key={r.id || r.date}
                    type="button"
                    onClick={() => r.id && onSelect(r.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${
                      selected?.id === r.id ? "bg-[#E8F4FD] border-l-4 border-l-[#0A1F44]" : ""
                    }`}
                  >
                    <p className="font-semibold text-sm text-[#0A1F44] truncate">
                      {r.name || r.method || "Transaction"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {r.admNo ? `${r.admNo} · ` : ""}
                      {new Date(r.date).toLocaleString()}
                    </p>
                    <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full capitalize ${statusBadge(r.status)}`}>
                      {r.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {selected && (
              <div className="px-4 py-2 border-b border-gray-50 bg-gray-50/80 text-xs text-gray-600 shrink-0">
                <span className="font-semibold text-[#0A1F44]">{selected.name || "—"}</span>
                {selected.admNo && <span> · {selected.admNo}</span>}
                <span> · {selected.method}</span>
              </div>
            )}
            <div className="flex-1 overflow-auto p-4 bg-slate-950">
              <pre className="text-xs text-emerald-300 font-mono whitespace-pre-wrap break-words">{json}</pre>
            </div>
            <div className="p-3 border-t border-gray-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={copyJson}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#0A1F44] border border-[#0A1F44]/20 rounded-lg hover:bg-[#0A1F44]/5"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


const AllocateModal = ({
  payment,
  onClose,
  onSuccess,
}: {
  payment: { id: string; amount: number; transactionRef?: string; mpesaNumber?: string; date?: string };
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleAllocate = async () => {
    if (!student) {
      toast.warning("Select a student", "Search and pick the student to top up");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await API.post(`/kopokopo/${payment.id}/allocate`, { studentId: student.id });
      toast.success(
        "Wallet topped up",
        `${data.studentName} (${data.studentRegNo}) · ${formatKes(data.amount)} · New balance ${formatKes(data.newBalance)}`,
      );
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Allocation failed";
      toast.error("Could not allocate", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#0A1F44] flex items-center gap-2">
              <UserPlus size={18} /> Allocate to student
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Credit this till payment to a student wallet</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3 bg-slate-50 rounded-xl text-sm space-y-1">
            <p className="font-bold text-emerald-600 text-lg">{formatKes(payment.amount)}</p>
            {payment.transactionRef && (
              <p className="text-xs font-mono text-gray-600">M-Pesa: {payment.transactionRef}</p>
            )}
            {payment.mpesaNumber && <p className="text-xs text-gray-500">Phone: {payment.mpesaNumber}</p>}
            {payment.date && (
              <p className="text-xs text-gray-500">{new Date(payment.date).toLocaleString()}</p>
            )}
          </div>

          <StudentPicker selected={student} onSelect={setStudent} onClear={() => setStudent(null)} />

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAllocate}
              disabled={!student || submitting}
              className="flex-1 py-2.5 text-sm font-semibold bg-[#0A1F44] text-white rounded-xl hover:bg-[#0A1F44]/90 disabled:opacity-50"
            >
              {submitting ? "Topping up..." : "Top up wallet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const FindPaymentModal = ({
  onClose,
  onAllocate,
  onRegister,
}: {
  onClose: () => void;
  onAllocate: (payment: KopoSearchResult) => void;
  onRegister: (prefill?: { code?: string; amount?: string }) => void;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KopoSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await API.get<KopoSearchResult[]>("/kopokopo/search", { params: { q } });
        setResults(data);
      } catch {
        setResults([]);
        toast.error("Search failed", "Could not search payments");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#0A1F44] flex items-center gap-2">
              <Search size={18} /> Find M-Pesa payment
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Search by M-Pesa code, phone, or reference</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. QGH7XABCD or 2547..."
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          {searching && <p className="text-xs text-gray-400">Searching...</p>}

          <div className="max-h-64 overflow-y-auto space-y-2">
            {query.trim().length >= 2 && !searching && results.length === 0 && (
              <div className="text-center py-4 space-y-3">
                <p className="text-sm text-gray-500">
                  No payment found in the system for <span className="font-mono font-semibold">{query.trim()}</span>.
                </p>
                <p className="text-xs text-gray-400 px-4">
                  Manual till payments only appear automatically when KopoKopo webhooks reach your server.
                  Register it from the M-Pesa SMS, then allocate to a student.
                </p>
                <button
                  type="button"
                  onClick={() => onRegister({ code: query.trim().toUpperCase() })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600"
                >
                  <ClipboardPlus size={16} /> Register from M-Pesa SMS
                </button>
              </div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={!r.allocatable}
                onClick={() => onAllocate(r)}
                className="w-full text-left p-3 border border-gray-100 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-semibold text-[#0A1F44]">{formatKes(r.amount)}</p>
                    <p className="text-xs font-mono text-gray-500">{r.transactionReference || r.id}</p>
                    <p className="text-xs text-gray-400">{r.phone || "—"} · {new Date(r.date).toLocaleString()}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${statusBadge(r.status)}`}>
                    {r.allocatable ? "unallocated" : r.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const RegisterManualModal = ({
  onClose,
  onSuccess,
  prefill,
}: {
  onClose: () => void;
  onSuccess: (payment: { id: string; amount: number; transactionReference: string }) => void;
  prefill?: { code?: string; amount?: string };
}) => {
  const [code, setCode] = useState(prefill?.code || "");
  const [amount, setAmount] = useState(prefill?.amount || "");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async () => {
    const ref = code.trim().toUpperCase();
    const amt = Number(amount);
    if (!ref || ref.length < 8) {
      toast.warning("M-Pesa code required", "Enter the code from the M-Pesa SMS (e.g. UG7QOA5LRC)");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warning("Amount required", "Enter the amount paid at the till");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await API.post("/kopokopo/register-manual", {
        transactionReference: ref,
        amount: amt,
        phone: phone.trim() || undefined,
      });
      toast.success("Payment registered", "You can now allocate it to a student");
      onSuccess({
        id: data.payment.id,
        amount: data.payment.amount,
        transactionReference: data.payment.transactionReference,
      });
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Registration failed";
      toast.error("Could not register", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#0A1F44] flex items-center gap-2">
              <ClipboardPlus size={18} /> Register till payment
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Enter details from the parent&apos;s M-Pesa confirmation SMS
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-900">
            Use this when a parent paid via <strong>Lipa na M-Pesa → Buy Goods</strong> to till{" "}
            <strong>3611959</strong> but the payment did not appear automatically.
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">M-Pesa code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. UG7QOA5LRC"
              className="mt-1 w-full px-3 py-2.5 text-sm font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Amount (KES)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1"
              className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Phone (optional)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Parent M-Pesa number"
              className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRegister}
              disabled={submitting}
              className="flex-1 py-2.5 text-sm font-semibold bg-[#0A1F44] text-white rounded-xl hover:bg-[#0A1F44]/90 disabled:opacity-50"
            >
              {submitting ? "Registering..." : "Register payment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const CollectionsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceFromUrl = searchParams.get("source") as SourceFilter | null;
  const initialSource: SourceFilter =
    sourceFromUrl && SOURCE_FILTERS.some((f) => f.value === sourceFromUrl)
      ? sourceFromUrl
      : "all";

  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [serverSummary, setServerSummary] = useState<CollectionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [selectedPayloadId, setSelectedPayloadId] = useState<string | null>(null);
  const [allocatePayment, setAllocatePayment] = useState<{
    id: string;
    amount: number;
    transactionRef?: string;
    mpesaNumber?: string;
    date?: string;
  } | null>(null);
  const [findPaymentOpen, setFindPaymentOpen] = useState(false);
  const [walletAdjustOpen, setWalletAdjustOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerPrefill, setRegisterPrefill] = useState<{ code?: string; amount?: string }>();
  const [webhookStatus, setWebhookStatus] = useState<{
    paymentsToday: number;
    hoursSinceLastPayment: number | null;
    webhookLikelyStale: boolean;
    tillNumber: string;
  } | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    source: initialSource,
    status: "all" as StatusFilter,
    startDate: "",
    endDate: "",
  });

  useEffect(() => {
    const src = searchParams.get("source") as SourceFilter | null;
    if (src && SOURCE_FILTERS.some((f) => f.value === src) && src !== filters.source) {
      setFilters((f) => ({ ...f, source: src }));
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (filters.source === "all") next.delete("source");
    else next.set("source", filters.source);
    setSearchParams(next, { replace: true });
  }, [filters.source]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;

    try {
      const r = await API.get<CollectionRow[] | { rows: CollectionRow[]; summary: CollectionsSummary }>(
        "/finance/collections",
        { params },
      );
      const data = r.data;
      if (Array.isArray(data)) {
        setRows(data);
        setServerSummary(null);
      } else {
        setRows(data.rows || []);
        setServerSummary(data.summary || null);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filters.startDate, filters.endDate]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    API.get("/kopokopo/webhook-status")
      .then((r) => setWebhookStatus(r.data))
      .catch(() => setWebhookStatus(null));
  }, [rows.length]);

  const openRegister = (prefill?: { code?: string; amount?: string }) => {
    setRegisterPrefill(prefill);
    setRegisterOpen(true);
    setFindPaymentOpen(false);
  };

  const handleRegistered = (payment: { id: string; amount: number; transactionReference: string }) => {
    fetchRows();
    setAllocatePayment({
      id: payment.id,
      amount: payment.amount,
      transactionRef: payment.transactionReference,
    });
  };

  const filteredRows = useMemo(() => {
    let list = rows;

    if (filters.source !== "all") {
      list = list.filter((r) => matchesSource(r, filters.source));
    }

    if (filters.status !== "all") {
      list = list.filter((r) => statusBucket(r.status) === filters.status);
    }

    const q = filters.search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.name, r.admNo, r.metadata, r.method, r.status, r.transactionRef, r.mpesaNumber, r.type]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }

    return list;
  }, [rows, filters.search, filters.source, filters.status]);

  const hasActiveFilters =
    filters.search !== "" ||
    filters.source !== "all" ||
    filters.status !== "all" ||
    filters.startDate !== "" ||
    filters.endDate !== "";

  const clearFilters = () => {
    setFilters({
      search: "",
      source: "all",
      status: "all",
      startDate: "",
      endDate: "",
    });
  };

  const openAllocate = (row: CollectionRow) => {
    if (!row.id || !row.allocatable) return;
    setAllocatePayment({
      id: row.id,
      amount: row.amount || row.attemptedAmount || 0,
      transactionRef: row.transactionRef,
      mpesaNumber: row.mpesaNumber,
      date: row.date,
    });
  };

  const handleFindPaymentAllocate = (payment: KopoSearchResult) => {
    setFindPaymentOpen(false);
    setAllocatePayment({
      id: payment.id,
      amount: payment.amount,
      transactionRef: payment.transactionReference,
      mpesaNumber: payment.phone,
      date: payment.date,
    });
  };

  const openPayloads = (rowId?: string) => {
    setSelectedPayloadId(rowId ?? filteredRows.find((r) => r.id)?.id ?? null);
    setPayloadOpen(true);
  };

  const totals = useMemo(() => {
    // When filters are active, recompute from visible rows; otherwise prefer server unique totals.
    const useServer = !hasActiveFilters && serverSummary;

    const tillInflowFromRows = () => {
      const seen = new Set<string>();
      let sum = 0;
      for (const r of filteredRows) {
        const isTill =
          (r.source === "kopo" && r.amount > 0) ||
          r.source === "pos_mpesa";
        if (!isTill) continue;
        const key = (r.transactionRef || r.id || `${r.name}-${r.amount}-${r.date}`)
          .toString()
          .trim()
          .toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        sum += Math.abs(r.amount);
      }
      return sum;
    };

    const topUps = useServer ? serverSummary!.tillInflow : tillInflowFromRows();
    const walletTopUps = useServer
      ? serverSummary!.walletTopUps
      : filteredRows.filter(isWalletTopUpRow).reduce((s, r) => s + Math.abs(r.amount), 0);
    const cashSales = useServer
      ? serverSummary!.cashSales
      : filteredRows.filter((r) => r.source === "pos_cash").reduce((s, r) => s + r.amount, 0);
    const usage = useServer
      ? serverSummary!.usage
      : filteredRows
          .filter((r) => r.type === "purchase" || isWalletUsageRow(r))
          .reduce((s, r) => s + Math.abs(r.amount), 0);
    const tillAttempts = filteredRows.filter(
      (r) => r.source === "kopo" || r.source === "pos_mpesa" || r.source === "pos_cash" || isWalletUsageRow(r),
    ).length;
    return { topUps, walletTopUps, cashSales, usage, tillAttempts };
  }, [filteredRows, hasActiveFilters, serverSummary]);

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      {webhookStatus && (webhookStatus.webhookLikelyStale || webhookStatus.paymentsToday === 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-amber-900 space-y-1">
            <p className="font-semibold">Manual till payments may not appear automatically</p>
            <p>
              Till <strong>{webhookStatus.tillNumber}</strong> payments only sync when KopoKopo webhooks reach your server.
              {webhookStatus.hoursSinceLastPayment != null
                ? ` Last recorded payment was ${webhookStatus.hoursSinceLastPayment}h ago.`
                : " No payments recorded yet."}
              {" "}Use <strong>Register till payment</strong> with the M-Pesa code from the SMS, then allocate to the student.
            </p>
          </div>
        </div>
      )}

      <div className="bg-[#0A1F44] text-white rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Receipt /> Collections Report
          </h2>
          <p className="text-blue-200 text-sm mt-1">
            Till M-Pesa, guest cash & STK POS, wallet top-ups, and wallet cafeteria usage
          </p>
        </div>
        <div className="flex flex-col sm:items-end gap-3">
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={fetchRows}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold"
              title="Refresh collections"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setFindPaymentOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/90 hover:bg-emerald-500 rounded-xl text-sm font-semibold"
            >
              <Search size={16} /> Find M-Pesa payment
            </button>
            <button
              type="button"
              onClick={() => openRegister()}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/90 hover:bg-amber-500 rounded-xl text-sm font-semibold"
            >
              <ClipboardPlus size={16} /> Register till payment
            </button>
            <button
              type="button"
              onClick={() => setWalletAdjustOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold"
            >
              <Wallet size={16} /> Update wallet
            </button>
            <button
              type="button"
              onClick={() => openPayloads()}
              disabled={filteredRows.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold disabled:opacity-40"
            >
              <FileJson size={16} /> View all payloads
            </button>
          </div>
          <div className="text-right space-y-1">
            <p className="text-blue-200 text-xs">
              Till inflow (unique) / Wallet top-ups / Cash POS / Wallet usage · Records
              {hasActiveFilters && filteredRows.length !== rows.length ? (
                <span className="ml-1">({filteredRows.length} shown)</span>
              ) : null}
            </p>
            <p className="text-lg font-bold">
              <span className="text-emerald-300" title="Unique M-Pesa till receipts">
                {formatKes(totals.topUps)}
              </span>
              <span className="text-blue-200"> · </span>
              <span className="text-sky-300" title="Allocated / manual wallet top-ups">
                {formatKes(totals.walletTopUps)}
              </span>
              <span className="text-blue-200"> · </span>
              <span className="text-amber-300" title="Guest cash POS">
                {formatKes(totals.cashSales)}
              </span>
              <span className="text-blue-200"> · </span>
              <span className="text-rose-300" title="Wallet cafeteria purchases">
                {formatKes(totals.usage)}
              </span>
              <span className="text-blue-200"> · </span>
              <span className="text-white">{filteredRows.length}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-[#0A1F44]" />
            <span className="font-semibold text-[#0A1F44]">Filters</span>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-gray-500 hover:text-[#0A1F44]"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {SOURCE_FILTERS.map((opt) => {
            const active = filters.source === opt.value;
            const count =
              opt.value === "all"
                ? rows.length
                : rows.filter((r) => matchesSource(r, opt.value)).length;
            return (
              <button
                key={opt.value}
                type="button"
                title={opt.hint}
                onClick={() => setFilters((f) => ({ ...f, source: opt.value }))}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-[#0A1F44] text-white border-[#0A1F44]"
                    : "bg-white text-[#0A1F44] border-gray-200 hover:border-[#0A1F44]/40"
                }`}
              >
                {opt.label}
                <span className={`ml-1 ${active ? "text-blue-200" : "text-gray-400"}`}>
                  ({count})
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search name, adm no, ref, phone..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
          >
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
            title="From date"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
            title="To date"
          />
        </div>
        {!loading && rows.length > 0 && (
          <p className="text-xs text-gray-500">
            Showing {filteredRows.length} of {rows.length} records
            {filters.startDate || filters.endDate
              ? ` · ${filters.startDate || "…"} to ${filters.endDate || "…"}`
              : ""}
          </p>
        )}
      </div>

      {loading ? (
        <Loader size="sm" title="Loading collections..." subtitle="Fetching till and wallet records" className="py-8" />
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-500">No collections found</div>
      ) : filteredRows.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
          No records match your filters.{" "}
          <button type="button" onClick={clearFilters} className="text-[#0A1F44] font-semibold hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm min-w-[1020px]">
            <thead className="text-gray-500 uppercase text-xs bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4">No</th>
                <th className="text-left py-3 px-4">Name</th>
                <th className="text-left py-3 px-4">Adm No</th>
                <th className="text-left py-3 px-4">M-Pesa Number</th>
                <th className="text-left py-3 px-4">Date</th>
                <th className="text-left py-3 px-4">Method</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Metadata</th>
                <th className="text-right py-3 px-4">Amount</th>
                <th className="text-center py-3 px-4">Actions</th>
                <th className="text-center py-3 px-4">Payload</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, idx) => {
                const failedUnsettled =
                  r.source === "kopo" &&
                  r.amount === 0 &&
                  (r.attemptedAmount ?? 0) > 0;

                return (
                  <tr key={`${r.id || r.transactionRef || r.date}-${idx}`} className="border-t border-gray-100 align-top">
                    <td className="py-3 px-4 text-gray-500">{idx + 1}</td>
                    <td className="py-3 px-4 font-semibold text-[#0A1F44]">{r.name || "-"}</td>
                    <td className="py-3 px-4 text-gray-600 font-mono text-xs">{r.admNo || "-"}</td>
                    <td className="py-3 px-4">{r.mpesaNumber || "-"}</td>
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                      {new Date(r.date).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold border ${channelBadge(rowChannel(r))}`}
                        >
                          {channelLabel(rowChannel(r))}
                        </span>
                        <p>{r.method || "-"}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${statusBadge(r.status)}`}>
                        {r.status || "-"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-xs max-w-xs">
                      <p className="line-clamp-2" title={r.metadata}>{r.metadata || "-"}</p>
                      {r.transactionRef && (
                        <p className="text-[10px] text-gray-400 mt-1 font-mono truncate" title={r.transactionRef}>
                          Ref: {r.transactionRef}
                        </p>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-bold whitespace-nowrap ${
                      r.amount >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}>
                      {r.amount !== 0 ? (
                        <>
                          {r.amount >= 0 ? "+" : "−"} {formatKes(Math.abs(r.amount))}
                        </>
                      ) : failedUnsettled ? (
                        <span className="text-gray-400 font-normal text-xs">
                          {formatKes(r.attemptedAmount || 0)} (not settled)
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {r.allocatable ? (
                        <button
                          type="button"
                          onClick={() => openAllocate(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                        >
                          <UserPlus size={14} />
                          Allocate
                        </button>
                      ) : r.walletCredited && isWalletTopUpRow(r) ? (
                        <span className="text-[10px] text-emerald-600 font-semibold">Credited</span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => r.id && openPayloads(r.id)}
                        disabled={!r.payload}
                        title="View metadata payload"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#0A1F44] border border-[#0A1F44]/20 rounded-lg hover:bg-[#0A1F44]/5 disabled:opacity-30"
                      >
                        <FileJson size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {payloadOpen && (
        <PayloadModal
          rows={filteredRows.filter((r) => r.payload)}
          selectedId={selectedPayloadId}
          onClose={() => setPayloadOpen(false)}
          onSelect={setSelectedPayloadId}
        />
      )}

      {allocatePayment && (
        <AllocateModal
          payment={allocatePayment}
          onClose={() => setAllocatePayment(null)}
          onSuccess={fetchRows}
        />
      )}

      {findPaymentOpen && (
        <FindPaymentModal
          onClose={() => setFindPaymentOpen(false)}
          onAllocate={handleFindPaymentAllocate}
          onRegister={openRegister}
        />
      )}

      {registerOpen && (
        <RegisterManualModal
          prefill={registerPrefill}
          onClose={() => {
            setRegisterOpen(false);
            setRegisterPrefill(undefined);
          }}
          onSuccess={handleRegistered}
        />
      )}

      {walletAdjustOpen && (
        <WalletAdjustModal
          onClose={() => setWalletAdjustOpen(false)}
          onSuccess={fetchRows}
          title="Update student wallet"
          subtitle="Credit or debit a student wallet (cash, corrections, etc.)"
        />
      )}
    </div>
  );
};

export default CollectionsPage;
