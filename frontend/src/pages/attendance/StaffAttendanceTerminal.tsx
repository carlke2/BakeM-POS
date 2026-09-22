import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LogIn,
  LogOut,
  Loader2,
  RefreshCw,
  Search,
  ArrowLeft,
  UserCircle2,
  Clock,
} from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import logo from "@/assets/icon.png";
import { useAuth } from "@/context/AuthContext";

type StaffOption = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  lastTypeToday: string | null;
  nextAction: "check_in" | "check_out" | null;
};

type ClockResult = {
  type: "check_in" | "check_out";
  staff: { name: string; role: string };
  recordedAt: string;
};

const roleLabel = (role: string) => {
  if (role === "owner" || role === "admin") return "Owner";
  if (role === "cashier" || role === "restaurant" || role === "finance") return "Cashier";
  return role;
};

const StaffAttendanceTerminal = () => {
  const { user } = useAuth();
  const [clocking, setClocking] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [lastResult, setLastResult] = useState<ClockResult | null>(null);

  const loadStaff = useCallback(async () => {
    setLoadingStaff(true);
    try {
      const { data } = await API.get<StaffOption[]>("/attendance/staff", { skipAuthRedirect: true } as any);
      setStaffList(data);
    } catch (e: any) {
      toast.error("Could not load staff", e.response?.data?.message || e.message);
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    if (!user?.id || staffList.length === 0 || selected) return;
    const self = staffList.find((s) => s.id === user.id || s.email === user.email);
    if (self) setSelected(self);
  }, [user, staffList, selected]);

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staffList;
    return staffList.filter((s) =>
      [s.name, s.email, s.role, s.phone].join(" ").toLowerCase().includes(q),
    );
  }, [staffList, query]);

  const selectStaff = (member: StaffOption) => {
    setSelected(member);
    setLastResult(null);
  };

  const backToList = () => {
    setSelected(null);
    setLastResult(null);
    loadStaff();
  };

  const clock = async () => {
    if (!selected) return;

    setClocking(true);
    try {
      const { data } = await API.post(
        "/attendance/clock",
        { userId: selected.id },
        { skipAuthRedirect: true } as any,
      );

      const result: ClockResult = {
        type: data.type,
        staff: data.staff,
        recordedAt: data.recordedAt,
      };
      setLastResult(result);
      toast.success(
        data.type === "check_in" ? "Checked in" : "Checked out",
        `${data.staff.name} · ${new Date(data.recordedAt).toLocaleTimeString()}`,
      );
      setTimeout(() => backToList(), 3500);
    } catch (e: any) {
      toast.error("Clock failed", e.response?.data?.message || e.message || "Could not record attendance");
    } finally {
      setClocking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#39B54A] text-white font-sans">
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
        <div className="text-center space-y-3 pt-4">
          <img src={logo} alt="Slow Rise Co" className="h-16 w-16 rounded-2xl mx-auto" />
          <h1 className="text-2xl font-black tracking-wide">Staff Attendance</h1>
          <p className="text-white/80 text-sm">
            {selected
              ? "Confirm clock in or clock out"
              : "Select your profile, then clock in or out"}
          </p>
        </div>

        {!selected ? (
          <>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60" size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search staff by name, email, or role…"
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>

            {loadingStaff ? (
              <div className="flex justify-center py-16">
                <Loader2 className="animate-spin text-white/80" size={32} />
              </div>
            ) : filteredStaff.length === 0 ? (
              <p className="text-center text-white/80 py-12">No staff found</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1">
                {filteredStaff.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => selectStaff(member)}
                    className="text-left rounded-2xl p-4 border transition bg-white/10 border-white/10 hover:bg-white/15 hover:border-white/25"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 font-bold text-lg">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold truncate">{member.name}</p>
                        <p className="text-xs text-white/80 capitalize">{roleLabel(member.role)}</p>
                        <p className="text-[11px] text-white/60 truncate mt-0.5">{member.email}</p>
                      </div>
                    </div>
                    {member.nextAction && (
                      <div className="mt-3">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                            member.nextAction === "check_in"
                              ? "bg-sky-500/20 text-sky-200"
                              : "bg-amber-500/20 text-amber-200"
                          }`}
                        >
                          {member.nextAction === "check_in" ? <LogIn size={10} /> : <LogOut size={10} />}
                          {member.nextAction === "check_in" ? "Check in next" : "Check out next"}
                        </span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => loadStaff()}
              className="w-full text-xs text-white/80 hover:text-white inline-flex items-center justify-center gap-1 py-2"
            >
              <RefreshCw size={12} /> Refresh staff list
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center gap-2 text-sm text-white/80 hover:text-white"
            >
              <ArrowLeft size={16} /> Back to staff list
            </button>

            <div className="bg-white/10 rounded-2xl p-6 border border-white/10 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-white/10 flex items-center justify-center">
                  <UserCircle2 size={36} className="text-white/70" />
                </div>
                <div>
                  <p className="text-xl font-bold">{selected.name}</p>
                  <p className="text-sm text-white/80 capitalize">{roleLabel(selected.role)}</p>
                  <p className="text-xs text-white/60">{selected.email}</p>
                </div>
              </div>

              {selected.nextAction && !lastResult && (
                <p
                  className={`text-sm font-semibold px-3 py-2 rounded-xl inline-flex items-center gap-2 ${
                    selected.nextAction === "check_in"
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "bg-amber-500/20 text-amber-100"
                  }`}
                >
                  {selected.nextAction === "check_in" ? <LogIn size={16} /> : <LogOut size={16} />}
                  You will {selected.nextAction === "check_in" ? "check in" : "check out"}
                </p>
              )}

              {!lastResult && (
                <button
                  type="button"
                  onClick={clock}
                  disabled={clocking}
                  className="w-full py-5 rounded-2xl bg-white text-[#39B54A] font-bold text-lg flex items-center justify-center gap-3 hover:bg-[#E8F6EC] disabled:opacity-50 transition"
                >
                  {clocking ? <Loader2 className="animate-spin" size={28} /> : <Clock size={28} />}
                  {clocking
                    ? "Recording…"
                    : selected.nextAction === "check_out"
                      ? "Clock out"
                      : "Clock in"}
                </button>
              )}

              {lastResult && (
                <div
                  className={`rounded-2xl p-5 border ${
                    lastResult.type === "check_in"
                      ? "bg-emerald-500/15 border-emerald-400/30"
                      : "bg-amber-500/15 border-amber-400/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {lastResult.type === "check_in" ? <LogIn size={28} /> : <LogOut size={28} />}
                    <div>
                      <p className="font-bold text-lg">
                        {lastResult.type === "check_in" ? "Checked in" : "Checked out"}
                      </p>
                      <p className="text-sm text-white/70">{lastResult.staff.name}</p>
                      <p className="text-xs text-white/80 mt-1">
                        {new Date(lastResult.recordedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-white/60 mt-3 text-center">Returning to staff list…</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffAttendanceTerminal;
