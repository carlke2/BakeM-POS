import { useEffect, useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import { Save } from "lucide-react";
import Loader from "@/components/ui/loader";
import { useAuth } from "@/context/AuthContext";
import { persistAuthSession } from "@/services/authStorage";

const AdminProfile = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const fetchMe = async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/admin/profile");
      setForm((f) => ({
        ...f,
        name: data.name || "",
        email: data.email || "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
    } catch (error: any) {
      toast.error("Failed to load profile", error.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

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
      const payload: { name: string; currentPassword?: string; newPassword?: string } = {
        name: form.name.trim(),
      };
      if (form.newPassword) {
        payload.currentPassword = form.currentPassword;
        payload.newPassword = form.newPassword;
      }

      const { data } = await API.put("/admin/profile", payload);
      if (user) {
        persistAuthSession({ ...user, name: data.name }, localStorage.getItem("token") || "");
      }
      localStorage.setItem("adminName", data.name);
      setForm((f) => ({
        ...f,
        name: data.name,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      toast.success("Profile updated successfully");
    } catch (error: any) {
      toast.error("Update failed", error.response?.data?.message || error.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  if (loading) {
    return (
      <Loader size="sm" title="Loading profile..." subtitle="Fetching your admin details" className="py-16" />
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-12 bg-white p-8 rounded-xl shadow-md border border-gray-100">
      <h2 className="text-2xl font-semibold mb-6 text-gray-800 text-center">
        Admin Profile
      </h2>

      <form onSubmit={save} className="flex flex-col gap-5">
        <div>
          <label className="text-sm text-gray-600 mb-1 block">Full Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            placeholder="Enter your full name"
            required
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Email</label>
          <input
            type="email"
            value={form.email}
            readOnly
            className="w-full border border-gray-300 bg-gray-50 text-gray-500 p-2.5 rounded-md cursor-not-allowed"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Current Password</label>
          <input
            type="password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            placeholder="Required only when changing password"
            autoComplete="current-password"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">New Password</label>
          <input
            type="password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            placeholder="Leave blank to keep current password"
            autoComplete="new-password"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Confirm New Password</label>
          <input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            autoComplete="new-password"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2.5 rounded-md transition"
        >
          <Save size={18} />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
};

export default AdminProfile;
