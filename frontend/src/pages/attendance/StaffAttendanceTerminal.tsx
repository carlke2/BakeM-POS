import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Fingerprint,
  LogIn,
  LogOut,
  Loader2,
  RefreshCw,
  Search,
  ArrowLeft,
  UserCircle2,
} from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import { captureFingerprint, checkScannerHealth, matchFingerprint, prepareScanner } from "@/services/fingerprintScanner";
import logo from "@/assets/LOGO.png";

type StaffOption = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  hasFingerprint: boolean;
  lastTypeToday: string | null;
  nextAction: "check_in" | "check_out" | null;
};

type ClockResult = {
  type: "check_in" | "check_out";
  staff: { name: string; role: string };
  recordedAt: string;
};

const roleLabel = (role: string) =>
  role === "restaurant" ? "Restaurant" : role === "finance" ? "Finance" : role;

const StaffAttendanceTerminal = () => {
  const [scannerReady, setScannerReady] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [lastResult, setLastResult] = useState<ClockResult | null>(null);

  const refreshScanner = useCallback(async () => {
    try {
      const health = await checkScannerHealth();
      setScannerReady(Boolean(health.ok && health.deviceConnected));
    } catch {
      setScannerReady(false);
    }
  }, []);

  const loadStaff = useCallback(async () => {
    setLoadingStaff(true);
    try {
      const { data } = await API.get<StaffOption[]>("/attendance/staff", { skipAuthRedirect: true });
      setStaffList(data);
    } catch (e: any) {
      toast.error("Could not load staff", e.response?.data?.message || e.message);
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    refreshScanner();
    loadStaff();
    prepareScanner().catch(() => {});
  }, [refreshScanner, loadStaff]);

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staffList;
    return staffList.filter((s) =>
      [s.name, s.email, s.role, s.phone].join(" ").toLowerCase().includes(q),
    );
  }, [staffList, query]);

  const selectStaff = (member: StaffOption) => {
    if (!member.hasFingerprint) {
      toast.warning("Not enrolled", "Ask admin to enroll your fingerprint first");
      return;
    }
    setSelected(member);
    setLastResult(null);
    prepareScanner().catch(() => {});
  };

  const backToList = () => {
    setSelected(null);
    setLastResult(null);
    loadStaff();
  };

  const scanAndClock = async () => {
    if (!selected) return;
    if (scannerReady === false) {
      toast.error("Scanner offline", "Start the fingerprint scanner service on this PC");
      return;
    }

    setScanning(true);
    try {
      await prepareScanner();
      const { data: enrolled } = await API.get<{ fingerprintTemplate: string }>(
        `/attendance/staff/${selected.id}/enrolled-fingerprint`,
        { skipAuthRedirect: true },
      );
      const template = await captureFingerprint();
      const { matched, score } = await matchFingerprint(template, [enrolled.fingerprintTemplate]);
      if (!matched) {
        toast.error("Fingerprint did not match", "Use the same finger you enrolled, or ask admin to re-enroll");
        return;
      }

      const { data } = await API.post(
        "/attendance/clock",
        {
          userId: selected.id,
          fingerprintTemplate: template,
          fingerprintMatchScore: score,
          localFingerprintVerified: true,
        },
        { skipAuthRedirect: true },
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
      const msg = e.response?.data?.message || e.message || "Scan failed";
      if (msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("capture")) {
        toast.error("Place your finger on the scanner", "Hold still for 2–3 seconds, then try again");
      } else {
        toast.error("Scan failed", msg);
      }
    } finally {
      setScanning(false);
      prepareScanner().catch(() => {});
    }
  };

  return (
    <div className="min-h-screen bg-[#0A1F44] text-white font-sans">
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
        <div className="text-center space-y-3 pt-4">
          <img src={logo} alt="Better Forks" className="h-14 w-14 rounded-full mx-auto bg-white p-1" />
          <h1 className="text-2xl font-black tracking-wide">Staff Attendance</h1>
          <p className="text-blue-200 text-sm">
            {selected ? "Verify your fingerprint to continue" : "Select your profile, then scan your fingerprint"}
          </p>
        </div>

        <div className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full mx-auto block w-fit ${
          scannerReady ? "bg-emerald-500/20 text-emerald-200" : scannerReady === false ? "bg-rose-500/20 text-rose-200" : "bg-white/10 text-blue-200"
        }`}>
          <span className={`h-2 w-2 rounded-full inline-block ${scannerReady ? "bg-emerald-400" : scannerReady === false ? "bg-rose-400" : "bg-amber-400"}`} />
          {scannerReady ? "Scanner ready" : scannerReady === false ? "Scanner offline" : "Checking scanner…"}
        </div>

        {!selected ? (
          <>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-300" size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search staff by name, email, or role…"
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-white placeholder:text-blue-300 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>

            {loadingStaff ? (
              <div className="flex justify-center py-16">
                <Loader2 className="animate-spin text-blue-200" size={32} />
              </div>
            ) : filteredStaff.length === 0 ? (
              <p className="text-center text-blue-200 py-12">No staff found</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1">
                {filteredStaff.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => selectStaff(member)}
                    disabled={!member.hasFingerprint}
                    className={`text-left rounded-2xl p-4 border transition ${
                      member.hasFingerprint
                        ? "bg-white/10 border-white/10 hover:bg-white/15 hover:border-white/25"
                        : "bg-white/5 border-white/5 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 font-bold text-lg">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold truncate">{member.name}</p>
                        <p className="text-xs text-blue-200 capitalize">{roleLabel(member.role)}</p>
                        <p className="text-[11px] text-blue-300 truncate mt-0.5">{member.email}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {member.hasFingerprint ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 inline-flex items-center gap-1">
                          <Fingerprint size={10} /> Enrolled
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-200">
                          No fingerprint
                        </span>
                      )}
                      {member.hasFingerprint && member.nextAction && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                          member.nextAction === "check_in" ? "bg-sky-500/20 text-sky-200" : "bg-amber-500/20 text-amber-200"
                        }`}>
                          {member.nextAction === "check_in" ? <LogIn size={10} /> : <LogOut size={10} />}
                          {member.nextAction === "check_in" ? "Check in next" : "Check out next"}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => { refreshScanner(); loadStaff(); }}
              className="w-full text-xs text-blue-200 hover:text-white inline-flex items-center justify-center gap-1 py-2"
            >
              <RefreshCw size={12} /> Refresh staff list
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center gap-2 text-sm text-blue-200 hover:text-white"
            >
              <ArrowLeft size={16} /> Back to staff list
            </button>

            <div className="bg-white/10 rounded-2xl p-6 border border-white/10 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-white/10 flex items-center justify-center">
                  <UserCircle2 size={36} className="text-blue-100" />
                </div>
                <div>
                  <p className="text-xl font-bold">{selected.name}</p>
                  <p className="text-sm text-blue-200 capitalize">{roleLabel(selected.role)}</p>
                  <p className="text-xs text-blue-300">{selected.email}</p>
                </div>
              </div>

              {selected.nextAction && !lastResult && (
                <p className={`text-sm font-semibold px-3 py-2 rounded-xl inline-flex items-center gap-2 ${
                  selected.nextAction === "check_in" ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/20 text-amber-100"
                }`}>
                  {selected.nextAction === "check_in" ? <LogIn size={16} /> : <LogOut size={16} />}
                  You will {selected.nextAction === "check_in" ? "check in" : "check out"}
                </p>
              )}

              {!lastResult && (
                <button
                  type="button"
                  onClick={scanAndClock}
                  disabled={scanning || scannerReady === false}
                  className="w-full py-5 rounded-2xl bg-white text-[#0A1F44] font-bold text-lg flex items-center justify-center gap-3 hover:bg-blue-50 disabled:opacity-50 transition"
                >
                  {scanning ? <Loader2 className="animate-spin" size={28} /> : <Fingerprint size={28} />}
                  {scanning ? "Scanning…" : "Scan fingerprint"}
                </button>
              )}

              {lastResult && (
                <div className={`rounded-2xl p-5 border ${
                  lastResult.type === "check_in" ? "bg-emerald-500/15 border-emerald-400/30" : "bg-amber-500/15 border-amber-400/30"
                }`}>
                  <div className="flex items-center gap-3">
                    {lastResult.type === "check_in" ? <LogIn size={28} /> : <LogOut size={28} />}
                    <div>
                      <p className="font-bold text-lg">
                        {lastResult.type === "check_in" ? "Checked in" : "Checked out"}
                      </p>
                      <p className="text-sm text-blue-100">{lastResult.staff.name}</p>
                      <p className="text-xs text-blue-200 mt-1">
                        {new Date(lastResult.recordedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-blue-300 mt-3 text-center">Returning to staff list…</p>
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
