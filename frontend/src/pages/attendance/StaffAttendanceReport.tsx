import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Filter, LogIn, LogOut } from "lucide-react";
import API from "@/services/api";
import Loader from "@/components/ui/loader";
import { toast } from "@/services/toast";

type AttendanceRow = {
  id: string;
  type: string;
  date: string;
  name: string;
  email: string;
  role: string;
};

type TodaySummary = {
  date: string;
  totalEvents: number;
  staffPresent: number;
  summary: {
    userId: string;
    name: string;
    role: string;
    lastType?: string;
    lastAt?: string;
    checkIns: number;
    checkOuts: number;
  }[];
  recent: { id: string; type: string; date: string; name: string; role: string }[];
};

const StaffAttendanceReport = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    try {
      const [recordsRes, todayRes] = await Promise.all([
        API.get<AttendanceRow[]>("/attendance/records", { params }),
        API.get<TodaySummary>("/attendance/today"),
      ]);
      setRows(recordsRes.data);
      setToday(todayRes.data);
    } catch (e: any) {
      toast.error("Failed to load attendance", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const presentCount = today?.staffPresent ?? 0;

  const filteredLabel = useMemo(() => {
    if (startDate || endDate) return `${startDate || "…"} to ${endDate || "…"}`;
    return "All dates";
  }, [startDate, endDate]);

  return (
    <div className="p-4 md:p-8 bg-[#FBF4D0] min-h-screen font-sans space-y-6">
      <div className="bg-[#B91D2D] text-white rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Clock /> Staff Attendance
          </h2>
          <p className="text-white/80 text-sm mt-1">Manual clock-in and clock-out records</p>
        </div>
        <div className="text-right">
          <p className="text-white/80 text-xs">Currently checked in today</p>
          <p className="text-2xl font-bold text-[#FBF4D0]">{presentCount}</p>
        </div>
      </div>

      {today && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-gray-100">
            <p className="text-xs text-gray-500 uppercase">Today&apos;s events</p>
            <p className="text-2xl font-bold text-[#B91D2D] mt-1">{today.totalEvents}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100">
            <p className="text-xs text-gray-500 uppercase">Staff checked in</p>
            <p className="text-2xl font-bold text-[#B91D2D] mt-1">{today.staffPresent}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100">
            <p className="text-xs text-gray-500 uppercase">Active staff today</p>
            <p className="text-2xl font-bold text-[#B91D2D] mt-1">{today.summary.length}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-[#B91D2D]" />
          <span className="font-semibold text-[#B91D2D]">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => { setStartDate(""); setEndDate(""); }}
            className="text-sm text-gray-500 hover:text-[#B91D2D]"
          >
            Clear dates
          </button>
        </div>
        <p className="text-xs text-gray-500">{filteredLabel} · {rows.length} records</p>
      </div>

      {loading ? (
        <Loader size="sm" title="Loading attendance..." subtitle="Fetching staff records" className="py-8" />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-gray-500 uppercase text-xs bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4">Staff</th>
                <th className="text-left py-3 px-4">Role</th>
                <th className="text-left py-3 px-4">Event</th>
                <th className="text-left py-3 px-4">Date & time</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-400">No attendance records yet</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-3 px-4 font-semibold text-[#B91D2D]">{r.name}</td>
                    <td className="py-3 px-4 capitalize text-gray-600">{r.role}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.type === "check_in" ? "bg-[#FFA29D] text-[#5C0101]" : "bg-amber-100 text-amber-800"
                      }`}>
                        {r.type === "check_in" ? <LogIn size={12} /> : <LogOut size={12} />}
                        {r.type === "check_in" ? "Check in" : "Check out"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                      {new Date(r.date).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StaffAttendanceReport;
