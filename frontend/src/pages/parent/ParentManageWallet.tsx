import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Wallet, GraduationCap, DollarSign, History, Settings, X } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type Student = {
  id: string;
  name: string;
  regNo: string;
  walletBalance: number;
  course?: string | null;
};

type WalletSettings = {
  walletFrozen: boolean;
  dailySpendLimit: number | null;
  weeklySpendLimit: number | null;
  pinEnabled: boolean;
};

const ParentManageWallet = () => {
  const location = useLocation();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string>((location.state as any)?.studentId || "");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settings, setSettings] = useState<WalletSettings | null>(null);
  const [dailyInput, setDailyInput] = useState("");
  const [weeklyInput, setWeeklyInput] = useState("");

  const selected = useMemo(() => students.find((s) => s.id === studentId), [students, studentId]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/parents/students");
      const list = (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        regNo: s.regNo,
        walletBalance: s.walletBalance || 0,
        course: s.course || null,
      }));
      setStudents(list);
      if (!studentId && list.length > 0) setStudentId(list[0].id);
    } catch (e: any) {
      toast.error("Failed to load students", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStudents(); }, []);

  const openSettings = async () => {
    if (!selected) return;
    setShowSettings(true);
    setSettingsLoading(true);
    try {
      const { data } = await API.get(`/parents/students/${selected.id}/wallet-settings`);
      setSettings(data);
      setDailyInput(data.dailySpendLimit == null ? "" : String(data.dailySpendLimit));
      setWeeklyInput(data.weeklySpendLimit == null ? "" : String(data.weeklySpendLimit));
    } catch (e: any) {
      toast.error("Failed to load settings", e.response?.data?.message);
      setShowSettings(false);
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!selected || !settings) return;
    setSavingSettings(true);
    try {
      const payload: any = {
        walletFrozen: settings.walletFrozen,
        dailySpendLimit: dailyInput.trim() ? Number(dailyInput) : null,
        weeklySpendLimit: weeklyInput.trim() ? Number(weeklyInput) : null,
      };
      const { data } = await API.put(`/parents/students/${selected.id}/wallet-settings`, payload);
      setSettings(data);
      toast.success("Saved", "Wallet settings updated");
      setShowSettings(false);
    } catch (e: any) {
      toast.error("Save failed", e.response?.data?.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const setPin = async () => {
    if (!selected) return;
    const pin = window.prompt("Set 4-digit Wallet PIN");
    if (!pin) return;
    try {
      await API.put(`/parents/students/${selected.id}/wallet-settings`, { pin });
      toast.success("PIN updated");
      openSettings();
    } catch (e: any) {
      toast.error("PIN failed", e.response?.data?.message);
    }
  };

  const resetPin = async () => {
    if (!selected) return;
    const ok = await toast.confirm("Reset wallet PIN to default (1234)?", { confirmLabel: "Reset" });
    if (!ok) return;
    try {
      await API.put(`/parents/students/${selected.id}/wallet-settings`, { resetPin: true });
      toast.success("PIN reset");
      openSettings();
    } catch (e: any) {
      toast.error("Reset failed", e.response?.data?.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#efefed] font-sans">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="rounded-2xl bg-white border border-gray-200 p-5 flex items-center justify-between gap-4 shadow-sm">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-stone-400">Parent Wallet</p>
            <h1 className="text-xl font-extrabold truncate flex items-center gap-2 text-[#111]">
              <Wallet className="w-5 h-5 text-[#f97316]" /> Manage Wallet
            </h1>
            <p className="text-sm text-stone-500 mt-1">View balance and quick actions</p>
          </div>
          <Link
            to="/parent-dashboard"
            className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-semibold text-stone-700"
          >
            Back
          </Link>
        </div>

        {loading ? (
          <Loader size="sm" title="Loading..." subtitle="Fetching linked students" className="py-10" />
        ) : students.length === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
              <GraduationCap className="w-6 h-6 text-stone-400" />
            </div>
            <p className="font-semibold text-stone-700">No students linked</p>
            <p className="text-sm text-stone-400 mt-1">Contact the admin to link your account to a student.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-gray-200 p-6 space-y-4 shadow-sm">
            <div>
              <label className="text-xs font-semibold text-stone-500">Student</label>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white border border-gray-200 outline-none text-sm text-stone-800"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.regNo})
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <div className="rounded-2xl bg-stone-50 border border-gray-200 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-extrabold text-lg truncate text-[#111]">{selected.name}</p>
                    <p className="text-sm text-stone-500 mt-1">
                      {selected.regNo}{selected.course ? ` · ${selected.course}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-widest text-stone-400">Wallet</p>
                    <p className="text-2xl font-extrabold text-[#111]">
                      KES {Number(selected.walletBalance || 0).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-5">
                  <Link
                    to="/parent/topup"
                    state={{ studentId: selected.id }}
                    className="rounded-xl bg-[#111] hover:bg-black text-white font-extrabold text-sm py-3 flex items-center justify-center gap-2"
                  >
                    <DollarSign className="w-4 h-4" /> Top Up Wallet
                  </Link>
                  <Link
                    to="/parent/history"
                    state={{ studentId: selected.id }}
                    className="rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm py-3 flex items-center justify-center gap-2 text-stone-800"
                  >
                    <History className="w-4 h-4" /> View History
                  </Link>
                  <Link
                    to="/pay-kopokopo"
                    state={{ studentId: selected.id, studentName: selected.name, regNo: selected.regNo, currentBalance: selected.walletBalance }}
                    className="rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm py-3 flex items-center justify-center gap-2 text-stone-800"
                  >
                    Pay via Kopokopo
                  </Link>
                  <button
                    type="button"
                    onClick={openSettings}
                    className="rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm py-3 flex items-center justify-center gap-2 text-stone-800"
                  >
                    <Settings className="w-4 h-4" /> Wallet Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showSettings && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-xl overflow-hidden">
            <div className="px-5 py-4 bg-[#0A1F44] text-white flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-extrabold">Wallet Settings</p>
                <p className="text-xs text-blue-200 truncate">{selected.name}</p>
              </div>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {settingsLoading || !settings ? (
                <Loader size="sm" title="Loading..." subtitle="Fetching wallet settings" className="py-8" />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-700">Daily Spend Limit</p>
                      <p className="text-xs text-stone-400">Leave blank for no limit</p>
                    </div>
                    <input
                      value={dailyInput}
                      onChange={(e) => setDailyInput(e.target.value)}
                      placeholder="No limit"
                      inputMode="numeric"
                      className="w-36 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-700">Weekly Spend Limit</p>
                      <p className="text-xs text-stone-400">Leave blank for no limit</p>
                    </div>
                    <input
                      value={weeklyInput}
                      onChange={(e) => setWeeklyInput(e.target.value)}
                      placeholder="No limit"
                      inputMode="numeric"
                      className="w-36 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-stone-700">Freeze Wallet</p>
                      <p className="text-xs text-stone-400">Block all spending</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettings((s) => (s ? { ...s, walletFrozen: !s.walletFrozen } : s))}
                      className={`w-12 h-7 rounded-full p-1 transition ${settings.walletFrozen ? "bg-red-500" : "bg-stone-200"}`}
                    >
                      <div className={`h-5 w-5 bg-white rounded-full transition ${settings.walletFrozen ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-700">Wallet PIN</p>
                      <p className="text-xs text-stone-400">{settings.pinEnabled ? "PIN enabled" : "Not set"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={setPin}
                        className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-bold text-stone-800"
                      >
                        Set PIN
                      </button>
                      <button
                        type="button"
                        onClick={resetPin}
                        className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-bold text-stone-800"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={saveSettings}
                    disabled={savingSettings}
                    className="w-full py-3 rounded-xl bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white font-extrabold disabled:opacity-60"
                  >
                    {savingSettings ? "Saving..." : "Save Settings"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ParentManageWallet;

