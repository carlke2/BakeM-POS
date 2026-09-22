import { useEffect, useState } from "react";
import { BellOff, MessageSquare, Save, Settings as SettingsIcon } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import { useAuth } from "@/context/AuthContext";

const Settings = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [loading, setLoading] = useState(isAdmin);
  const [saving, setSaving] = useState(false);
  const [smsDisabled, setSmsDisabled] = useState(false);
  const [smsConfigured, setSmsConfigured] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await API.get("/admin/settings");
        if (cancelled) return;
        setSmsDisabled(Boolean(data.smsDisabled));
        setSmsConfigured(Boolean(data.smsConfigured));
      } catch (e: any) {
        toast.error("Failed to load settings", e.response?.data?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await API.put("/admin/settings", { smsDisabled });
      setSmsDisabled(Boolean(data.smsDisabled));
      setSmsConfigured(Boolean(data.smsConfigured));
      toast.success(
        smsDisabled ? "SMS disabled" : "SMS enabled",
        smsDisabled
          ? "No SMS will be sent system-wide until you re-enable it"
          : "SMS sending is allowed again (when Advanta is configured)",
      );
    } catch (e: any) {
      toast.error("Save failed", e.response?.data?.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-[#0A1F44]">Settings</h2>
        <p className="text-sm text-gray-500 mt-2">Admin only.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#0A1F44] flex items-center gap-2">
          <SettingsIcon size={24} /> Settings
        </h2>
        <p className="text-sm text-gray-500 mt-1">System notification controls</p>
      </div>

      {loading ? (
        <Loader size="sm" title="Loading settings..." subtitle="Fetching system preferences" className="py-10" />
      ) : (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 md:p-6 space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#0A1F44]">SMS</p>
            <p className="text-sm text-gray-500 mt-1">
              System-wide kill switch for all Advanta SMS (welcome messages and alerts).
              {!smsConfigured && (
                <span className="block mt-1 text-amber-600">
                  Advanta SMS credentials are not configured on the server.
                </span>
              )}
            </p>
          </div>

          <div
            className={`flex items-start justify-between gap-4 p-4 rounded-xl border ${
              smsDisabled ? "bg-amber-50/70 border-amber-100" : "bg-emerald-50/60 border-emerald-100"
            }`}
          >
            <div className="flex gap-3 min-w-0">
              <div
                className={`mt-0.5 p-2 rounded-lg shrink-0 ${
                  smsDisabled ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {smsDisabled ? <BellOff size={18} /> : <MessageSquare size={18} />}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-[#0A1F44]">Disable SMS</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {smsDisabled
                    ? "SMS is off for the whole system."
                    : "SMS is allowed. Turn this on to stop all outbound SMS."}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={smsDisabled}
              aria-label="Disable SMS"
              onClick={() => setSmsDisabled((v) => !v)}
              className={`relative w-14 h-8 rounded-full p-1 transition shrink-0 ${
                smsDisabled ? "bg-amber-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`block h-6 w-6 bg-white rounded-full shadow transition ${
                  smsDisabled ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full sm:w-auto px-5 py-2.5 bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save settings"}
          </button>
        </section>
      )}
    </div>
  );
};

export default Settings;
