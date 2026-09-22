import { useEffect, useState } from "react";
import { User, GraduationCap, Save, Lock } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type LinkedStudent = {
  id: string;
  name: string;
  regNo: string;
  course?: string | null;
  gender?: string;
  walletBalance: number;
  parentRelationship?: string | null;
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";

const ParentProfile = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [students, setStudents] = useState<LinkedStudent[]>([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    receiveEmail: true,
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/parents/profile");
      setForm((f) => ({
        ...f,
        name: data.name || "",
        email: data.email || "",
        phone: data.phone || "",
        receiveEmail: data.receiveEmail !== false,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      setStudents(data.students || []);
      if (data.name) localStorage.setItem("userName", data.name);
    } catch (e: any) {
      toast.error("Failed to load profile", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const role = (localStorage.getItem("role") || "").toLowerCase();
    if (role !== "parent") {
      toast.error("Access denied", "Please log in as a parent to view this profile");
      return;
    }
    fetchProfile();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.newPassword || form.confirmPassword || form.currentPassword) {
      if (!form.currentPassword) {
        return toast.error("Validation", "Enter your current password to change it");
      }
      if (form.newPassword.length < 7) {
        return toast.error("Validation", "New password must be at least 7 characters");
      }
      if (form.newPassword !== form.confirmPassword) {
        return toast.error("Validation", "New passwords do not match");
      }
    }

    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        receiveEmail: form.receiveEmail,
      };
      if (form.newPassword) {
        payload.currentPassword = form.currentPassword;
        payload.newPassword = form.newPassword;
      }

      const { data } = await API.put("/parents/profile", payload);
      setStudents(data.students || []);
      setForm((f) => ({
        ...f,
        name: data.name,
        phone: data.phone || "",
        receiveEmail: data.receiveEmail !== false,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      localStorage.setItem("userName", data.name);
      toast.success("Profile updated");
    } catch (e: any) {
      toast.error("Update failed", e.response?.data?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#efefed] font-sans">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="bg-[#0A1F44] text-white rounded-2xl p-6 text-center">
          <div className="w-20 h-20 rounded-full bg-white text-[#0A1F44] flex items-center justify-center font-bold text-3xl mx-auto mb-3">
            {(form.name || "P").charAt(0).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
            <User size={22} /> My Profile
          </h1>
          <p className="text-blue-200 text-sm mt-1">Manage your profile data and account security</p>
        </div>

        {loading ? (
          <Loader size="sm" title="Loading profile..." subtitle="Fetching your account details" className="py-12" />
        ) : (
          <form onSubmit={save} className="space-y-6">
            <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
              <p className="text-xs font-bold text-[#0A1F44] uppercase tracking-wide">Biodata</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Full Name</label>
                  <input
                    className={inputCls}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input className={`${inputCls} bg-gray-50 text-gray-500`} value={form.email} disabled />
                  <p className="text-xs text-gray-400 mt-1">Contact admin to change email</p>
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input
                    className={inputCls}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 0712345678"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className={labelCls}>Communication Preferences</p>
                <div className="flex flex-wrap gap-4 mt-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.receiveEmail}
                      onChange={(e) => setForm({ ...form, receiveEmail: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    Receive Email
                  </label>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
              <p className="text-xs font-bold text-[#0A1F44] uppercase tracking-wide flex items-center gap-2">
                <GraduationCap size={16} /> Linked Students
              </p>
              {students.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No students linked yet. Contact the school admin to link your children.
                </p>
              ) : (
                <div className="space-y-3">
                  {students.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-4 rounded-xl bg-stone-50 border border-gray-200"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#111] truncate">{s.name}</p>
                        <p className="text-sm text-gray-500">
                          {s.regNo}
                          {s.course ? ` · ${s.course}` : ""}
                          {s.parentRelationship ? ` · ${s.parentRelationship}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400 uppercase">Wallet</p>
                        <p className="font-bold text-[#111]">
                          KES {Number(s.walletBalance || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
              <p className="text-xs font-bold text-[#0A1F44] uppercase tracking-wide flex items-center gap-2">
                <Lock size={16} /> Change Password
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Current Password</label>
                  <input
                    type="password"
                    className={inputCls}
                    value={form.currentPassword}
                    onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                    placeholder="Required only when changing password"
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label className={labelCls}>New Password</label>
                  <input
                    type="password"
                    className={inputCls}
                    value={form.newPassword}
                    onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                    minLength={7}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className={labelCls}>Confirm New Password</label>
                  <input
                    type="password"
                    className={inputCls}
                    value={form.confirmPassword}
                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                    minLength={7}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </section>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Save size={18} />
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ParentProfile;
