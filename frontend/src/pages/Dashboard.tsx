import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  GraduationCap,
  UtensilsCrossed,
  DollarSign,
  AlertCircle,
  Receipt,
  Smartphone,
  Wallet,
  Filter,
} from "lucide-react";
import API from "@/services/api";
import Loader from "@/components/ui/loader";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = ["#0A1F44", "#1E3A8A", "#3B82F6", "#10B981"];

type CollectionRow = {
  id?: string;
  source?: string;
  channel?: string;
  amount: number;
  attemptedAmount?: number;
  type: string;
  method: string;
  metadata: string;
  status: string;
  date: string;
  name: string;
  transactionRef?: string;
  allocatable?: boolean;
  payload?: Record<string, unknown>;
};

type CollectionsSummary = {
  tillInflow: number;
  walletTopUps: number;
  cashSales: number;
  usage: number;
  recordCount: number;
};

type FinanceFilter =
  | "all"
  | "till"
  | "stk"
  | "student_wallets"
  | "wallet_topup"
  | "wallet_usage"
  | "cash"
  | "unallocated";

const FINANCE_FILTERS: { value: FinanceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "till", label: "Till (Buy Goods)" },
  { value: "stk", label: "STK Push" },
  { value: "student_wallets", label: "Student wallets" },
  { value: "wallet_topup", label: "Wallet top-ups" },
  { value: "wallet_usage", label: "Wallet usage" },
  { value: "unallocated", label: "Unallocated till" },
  { value: "cash", label: "Cash" },
];

const formatKes = (n: number) => `KES ${Number(n || 0).toLocaleString()}`;

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

const isWalletTopUp = (row: CollectionRow) =>
  (row.source === "kopo" && row.type === "wallet_topup") ||
  (row.source === "wallet" && row.type === "deposit");

const isWalletUsage = (row: CollectionRow) =>
  row.source === "wallet" && (row.type === "purchase" || row.type === "refund");

const matchesFinanceFilter = (row: CollectionRow, filter: FinanceFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "till") {
    return (
      rowChannel(row) === "till" ||
      (row.source === "kopo" && row.type !== "wallet_topup" && row.type !== "pos_sale")
    );
  }
  if (filter === "stk") {
    return (
      rowChannel(row) === "stk" ||
      row.source === "pos_mpesa" ||
      (row.source === "kopo" && row.type === "pos_sale") ||
      (row.source === "kopo" &&
        row.type === "wallet_topup" &&
        !/till → student wallet|manual allocation/i.test(`${row.method} ${row.metadata}`))
    );
  }
  if (filter === "student_wallets") return isWalletTopUp(row) || isWalletUsage(row);
  if (filter === "wallet_topup") return isWalletTopUp(row);
  if (filter === "wallet_usage") return isWalletUsage(row);
  if (filter === "unallocated") return Boolean(row.allocatable);
  if (filter === "cash") return row.source === "pos_cash" || rowChannel(row) === "cash";
  return true;
};

const DashboardCard = ({
  title,
  value,
  icon,
  color = "#0A1F44",
  prefix = "",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
  prefix?: string;
}) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (start === end) {
      setCount(end);
      return;
    }
    const timer = setInterval(() => {
      start += Math.ceil(end / 60);
      if (start >= end) {
        start = end;
        clearInterval(timer);
      }
      setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 flex flex-col justify-between hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm text-gray-500 font-medium">{title}</h3>
          <p className="text-3xl font-bold text-[#0A1F44] mt-2">
            {prefix}
            {count.toLocaleString()}
          </p>
        </div>
        <div className="p-3.5 rounded-xl" style={{ backgroundColor: `${color}15`, color }}>
          {icon}
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [studentCount, setStudentCount] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [menuCount, setMenuCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collectionRows, setCollectionRows] = useState<CollectionRow[]>([]);
  const [serverSummary, setServerSummary] = useState<CollectionsSummary | null>(null);
  const [financeFilter, setFinanceFilter] = useState<FinanceFilter>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const fetchCounts = async () => {
      setLoadError(null);
      try {
        const [studentsRes, usersRes, menuRes] = await Promise.all([
          API.get("/students"),
          API.get("/users"),
          API.get("/menu"),
        ]);
        setStudentCount(studentsRes.data?.length || 0);
        setStaffCount(usersRes.data?.length || 0);
        setMenuCount(menuRes.data?.length || 0);
        try {
          const finRes = await API.get("/finance/summary");
          setRevenue(finRes.data?.revenue || 0);
        } catch {
          /* optional */
        }
      } catch (error: unknown) {
        const msg =
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "ERR_NETWORK"
            ? "Cannot reach the backend. Start it with: cd backend && npm run dev"
            : "Failed to load dashboard data";
        setLoadError(msg);
        console.error("Error loading dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchCounts();
  }, []);

  const fetchCollections = useCallback(async () => {
    setFinanceLoading(true);
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    try {
      const r = await API.get<CollectionRow[] | { rows: CollectionRow[]; summary: CollectionsSummary }>(
        "/finance/collections",
        { params },
      );
      const data = r.data;
      if (Array.isArray(data)) {
        setCollectionRows(data);
        setServerSummary(null);
      } else {
        setCollectionRows(data.rows || []);
        setServerSummary(data.summary || null);
      }
    } catch {
      setCollectionRows([]);
      setServerSummary(null);
    } finally {
      setFinanceLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const filteredRows = useMemo(
    () => collectionRows.filter((r) => matchesFinanceFilter(r, financeFilter)),
    [collectionRows, financeFilter],
  );

  const financeTotals = useMemo(() => {
    if (financeFilter === "all" && serverSummary && !startDate && !endDate) {
      return {
        till: serverSummary.tillInflow,
        stk: collectionRows
          .filter((r) => matchesFinanceFilter(r, "stk") && r.amount > 0)
          .reduce((s, r) => s + Math.abs(r.amount), 0),
        walletTopUps: serverSummary.walletTopUps,
        usage: serverSummary.usage,
        cash: serverSummary.cashSales,
        records: serverSummary.recordCount,
      };
    }

    const till = filteredRows
      .filter((r) => matchesFinanceFilter(r, "till") && r.amount > 0)
      .reduce((s, r) => s + Math.abs(r.amount), 0);
    const stk = filteredRows
      .filter((r) => matchesFinanceFilter(r, "stk") && r.amount > 0)
      .reduce((s, r) => s + Math.abs(r.amount), 0);
    const walletTopUps = filteredRows
      .filter(isWalletTopUp)
      .reduce((s, r) => s + Math.abs(r.amount), 0);
    const usage = filteredRows
      .filter(isWalletUsage)
      .reduce((s, r) => s + Math.abs(r.amount), 0);
    const cash = filteredRows
      .filter((r) => r.source === "pos_cash" || rowChannel(r) === "cash")
      .reduce((s, r) => s + Math.abs(r.amount), 0);

    return {
      till,
      stk,
      walletTopUps,
      usage,
      cash,
      records: filteredRows.length,
    };
  }, [financeFilter, filteredRows, collectionRows, serverSummary, startDate, endDate]);

  const data = [
    { name: "Students", value: studentCount },
    { name: "Staff Users", value: staffCount },
    { name: "Menu Items", value: menuCount },
  ];
  const chartTotal = data.reduce((sum, item) => sum + item.value, 0);
  const showChart = !loading && !loadError && chartTotal > 0;

  const collectionsPath =
    financeFilter === "all"
      ? "/collections"
      : `/collections?source=${encodeURIComponent(financeFilter)}`;

  return (
    <div className="p-4 md:p-8 space-y-8 bg-[#E8F4FD] min-h-screen font-sans">
      <div className="bg-[#0A1F44] text-white rounded-3xl shadow-xl p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-3xl font-bold tracking-tight">Admin Dashboard</h2>
          <p className="text-sm text-blue-200 mt-2 font-medium">School feeding program overview</p>
        </div>
        <div className="mt-6 sm:mt-0 w-14 h-14 rounded-full bg-white text-[#0A1F44] flex items-center justify-center font-bold text-xl">
          AD
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <Loader size="sm" title="Loading dashboard..." subtitle="Fetching platform statistics" className="py-8" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <DashboardCard title="Students" value={studentCount} icon={<GraduationCap size={24} />} color="#0A1F44" />
          <DashboardCard title="Staff Users" value={staffCount} icon={<Users size={24} />} color="#0A1F44" />
          <DashboardCard title="Menu Items" value={menuCount} icon={<UtensilsCrossed size={24} />} color="#0A1F44" />
          <DashboardCard
            title="Cafeteria Revenue"
            value={revenue}
            icon={<DollarSign size={24} />}
            color="#0A1F44"
            prefix="KES "
          />
        </div>
      )}

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-[#0A1F44] flex items-center gap-2">
              <Filter size={18} /> Collections overview
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Filter till, STK push, and student wallet activity
            </p>
          </div>
          <Link
            to={collectionsPath}
            className="text-sm font-semibold text-[#0A1F44] hover:underline"
          >
            Open full collections →
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {FINANCE_FILTERS.map((opt) => {
            const active = financeFilter === opt.value;
            const count =
              opt.value === "all"
                ? collectionRows.length
                : collectionRows.filter((r) => matchesFinanceFilter(r, opt.value)).length;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFinanceFilter(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-[#0A1F44] text-white border-[#0A1F44]"
                    : "bg-white text-[#0A1F44] border-gray-200 hover:border-[#0A1F44]/40"
                }`}
              >
                {opt.label}
                <span className={`ml-1 ${active ? "text-blue-200" : "text-gray-400"}`}>({count})</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
            title="From date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
            title="To date"
          />
        </div>

        {financeLoading ? (
          <Loader size="sm" title="Loading collections..." subtitle="Fetching till and wallet totals" className="py-6" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex items-center gap-2 text-emerald-800 text-sm font-semibold">
                <Receipt size={16} /> Till inflow
              </div>
              <p className="text-2xl font-bold text-emerald-900 mt-2">{formatKes(financeTotals.till)}</p>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="flex items-center gap-2 text-indigo-800 text-sm font-semibold">
                <Smartphone size={16} /> STK Push
              </div>
              <p className="text-2xl font-bold text-indigo-900 mt-2">{formatKes(financeTotals.stk)}</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
              <div className="flex items-center gap-2 text-sky-800 text-sm font-semibold">
                <Wallet size={16} /> Wallet top-ups
              </div>
              <p className="text-2xl font-bold text-sky-900 mt-2">{formatKes(financeTotals.walletTopUps)}</p>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
              <div className="flex items-center gap-2 text-rose-800 text-sm font-semibold">
                <Wallet size={16} /> Wallet usage
              </div>
              <p className="text-2xl font-bold text-rose-900 mt-2">{formatKes(financeTotals.usage)}</p>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500">
          Showing {financeTotals.records} record{financeTotals.records === 1 ? "" : "s"}
          {startDate || endDate ? ` · ${startDate || "…"} to ${endDate || "…"}` : ""}
          {financeTotals.cash > 0 ? ` · Cash POS ${formatKes(financeTotals.cash)}` : ""}
        </p>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
        <h3 className="text-xl font-bold text-[#0A1F44] mb-6">Platform Statistics</h3>
        {showChart ? (
          <div className="w-full min-w-0" style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height={350} minWidth={0}>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                  {data.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : loading ? (
          <Loader size="sm" title="Loading chart..." subtitle="Preparing platform statistics" className="py-8" />
        ) : (
          <p className="text-center text-gray-400 py-16 text-sm">
            {loadError ? "Chart unavailable while offline" : "No data to chart yet"}
          </p>
        )}
      </div>

      <p className="text-center text-xs text-gray-500">
        © {new Date().getFullYear()} SmartPOS School Feeding System
      </p>
    </div>
  );
};

export default Dashboard;
