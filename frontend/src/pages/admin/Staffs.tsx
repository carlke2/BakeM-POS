import { useEffect, useMemo, useState } from "react";
import { Users, Plus, Edit, Trash2, X, Fingerprint, Search, Filter } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import {
  captureFingerprint,
  checkScannerHealth,
  prepareScanner,
  checkStaffFingerprintDuplicate,
} from "@/services/fingerprintScanner";

type StaffRole = "finance" | "restaurant";
type StaffStatus = "approved" | "pending" | "rejected";

type StaffRow = {
  id: string;
  _id?: string;
  name: string;
  email: string;
  phone?: string | null;
  role: StaffRole;
  status: StaffStatus;
  hasFingerprint?: boolean;
};

const emptyStaff = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "restaurant" as StaffRole,
  status: "approved" as StaffStatus,
  fingerprintTemplate: "",
  hasFingerprint: false,
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none";

const roleLabel = (role: string) =>
  role === "restaurant" ? "Restaurant" : role === "finance" ? "Finance" : role;

const Staffs = () => {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState(emptyStaff);
  const [scannerReady, setScannerReady] = useState<boolean | null>(null);
  const [capturingFingerprint, setCapturingFingerprint] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | StaffRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | StaffStatus>("all");
  const [fingerprintFilter, setFingerprintFilter] = useState<"all" | "enrolled" | "none">("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await API.get<StaffRow[]>("/users");
      setStaff(data);
    } catch (e: any) {
      toast.error("Failed to load staff", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!showForm) return;
    checkScannerHealth()
      .then((h) => setScannerReady(Boolean(h.ok && h.deviceConnected)))
      .catch(() => setScannerReady(false));
    prepareScanner().catch(() => {});
  }, [showForm]);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staff.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (fingerprintFilter === "enrolled" && !u.hasFingerprint) return false;
      if (fingerprintFilter === "none" && u.hasFingerprint) return false;
      if (!q) return true;
      return [u.name, u.email, u.phone, u.role, roleLabel(u.role), u.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [staff, searchQuery, roleFilter, statusFilter, fingerprintFilter]);

  const hasActiveFilters =
    searchQuery !== "" ||
    roleFilter !== "all" ||
    statusFilter !== "all" ||
    fingerprintFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
    setFingerprintFilter("all");
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setStaffForm(emptyStaff);
  };

  const saveFingerprint = async (userId: string, template: string) => {
    await API.put(`/users/${userId}/fingerprint`, { fingerprintTemplate: template });
  };

  const saveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let userId = editId;
      const body = {
        name: staffForm.name,
        email: staffForm.email,
        phone: staffForm.phone,
        role: staffForm.role,
        status: staffForm.status,
        ...(staffForm.password ? { password: staffForm.password } : {}),
      };

      if (editId) {
        await API.put(`/users/${editId}`, body);
      } else {
        if (!staffForm.password) {
          toast.error("Password required", "Enter a password for the new staff account");
          return;
        }
        const { data } = await API.post("/users", { ...body, password: staffForm.password });
        userId = data._id || data.id;
      }

      if (staffForm.fingerprintTemplate && userId) {
        await saveFingerprint(userId, staffForm.fingerprintTemplate);
      }

      toast.success(editId ? "Staff updated" : "Staff added");
      closeForm();
      fetchData();
    } catch (e: any) {
      toast.error("Operation failed", e.response?.data?.message);
    }
  };

  const handleCaptureFingerprint = async () => {
    setCapturingFingerprint(true);
    try {
      await prepareScanner();
      const template = await captureFingerprint();
      const check = await checkStaffFingerprintDuplicate(template, editId || undefined, {
        biometric: false,
      });
      if (!check.unique) {
        toast.error("Fingerprint already enrolled", check.message);
        return;
      }
      setStaffForm((f) => ({ ...f, fingerprintTemplate: template, hasFingerprint: true }));
      toast.success("Fingerprint captured", "Save the staff record to store it");
      checkStaffFingerprintDuplicate(template, editId || undefined, { biometric: true }).then((full) => {
        if (!full.unique) {
          setStaffForm((f) => ({ ...f, fingerprintTemplate: "", hasFingerprint: false }));
          toast.error("Fingerprint already enrolled", full.message);
        }
      });
    } catch (err: any) {
      toast.error("Capture failed", err.message);
    } finally {
      setCapturingFingerprint(false);
    }
  };

  const removeStoredFingerprint = async () => {
    if (!editId) return;
    const r = await toast.confirm("Remove stored fingerprint?", { confirmLabel: "Remove" });
    if (!r) return;
    try {
      await API.delete(`/users/${editId}/fingerprint`);
      setStaffForm((f) => ({ ...f, fingerprintTemplate: "", hasFingerprint: false }));
      toast.success("Fingerprint removed");
      fetchData();
    } catch (e: any) {
      toast.error("Failed to remove fingerprint", e.response?.data?.message);
    }
  };

  const openAdd = () => {
    closeForm();
    setShowForm(true);
  };

  const editStaffMember = (u: StaffRow) => {
    setEditId(u._id || u.id);
    setStaffForm({
      name: u.name,
      email: u.email,
      phone: u.phone || "",
      password: "",
      role: u.role,
      status: u.status,
      fingerprintTemplate: "",
      hasFingerprint: Boolean(u.hasFingerprint),
    });
    setShowForm(true);
  };

  const deleteStaff = async (id: string) => {
    const r = await toast.confirm("Delete this staff member?", { confirmLabel: "Delete" });
    if (!r) return;
    try {
      await API.delete(`/users/${id}`);
      toast.success("Staff deleted");
      fetchData();
    } catch (e: any) {
      toast.error("Delete failed", e.response?.data?.message);
    }
  };

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-[#0A1F44] text-white rounded-2xl p-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={28} /> Staff
          </h1>
          <p className="text-blue-200 text-sm mt-1">
            Manage restaurant and finance staff, roles, and fingerprint attendance enrollment
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-[#0A1F44]" />
              <span className="font-semibold text-[#0A1F44]">Search & filters</span>
            </div>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-gray-500 hover:text-[#0A1F44]">
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, phone…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
              className={inputCls}
            >
              <option value="all">All roles</option>
              <option value="restaurant">Restaurant</option>
              <option value="finance">Finance</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className={inputCls}
            >
              <option value="all">All statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              value={fingerprintFilter}
              onChange={(e) => setFingerprintFilter(e.target.value as typeof fingerprintFilter)}
              className={inputCls}
            >
              <option value="all">All fingerprints</option>
              <option value="enrolled">Enrolled</option>
              <option value="none">Not enrolled</option>
            </select>
          </div>
          {!loading && (
            <p className="text-xs text-gray-500">
              Showing {filteredStaff.length} of {staff.length} staff
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h2 className="font-bold text-[#0A1F44]">All staff</h2>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 bg-[#0A1F44] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#0A1F44]/90"
            >
              <Plus size={16} /> Add staff
            </button>
          </div>

          {loading ? (
            <Loader size="sm" title="Loading staff..." subtitle="Fetching staff accounts" className="py-8" />
          ) : filteredStaff.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              {staff.length === 0 ? "No staff yet" : "No staff match your filters"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Phone</th>
                    <th className="px-4 py-3 text-center">Fingerprint</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.map((u) => (
                    <tr key={u._id || u.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-semibold">{u.name}</td>
                      <td className="px-4 py-3 capitalize text-gray-600">{roleLabel(u.role)}</td>
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3 text-gray-500">{u.phone || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        {u.hasFingerprint ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <Fingerprint size={12} /> Enrolled
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            u.status === "approved"
                              ? "bg-green-100 text-green-700"
                              : u.status === "pending"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => editStaffMember(u)}
                            className="p-2 text-gray-400 hover:text-amber-600"
                            title="Edit"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteStaff(u._id || u.id)}
                            className="p-2 text-gray-400 hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-[#0A1F44]">{editId ? "Edit staff" : "Add staff"}</h3>
              <button type="button" onClick={closeForm} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveStaff} className="space-y-3">
              <input
                className={inputCls}
                placeholder="Full name"
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                required
              />
              <input
                type="email"
                className={inputCls}
                placeholder="Email"
                value={staffForm.email}
                onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                required
              />
              <input
                className={inputCls}
                placeholder="Phone"
                value={staffForm.phone}
                onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
              />
              <select
                className={inputCls}
                value={staffForm.role}
                onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value as StaffRole })}
                required
              >
                <option value="restaurant">Restaurant staff</option>
                <option value="finance">Finance officer</option>
              </select>
              <select
                className={inputCls}
                value={staffForm.status}
                onChange={(e) => setStaffForm({ ...staffForm, status: e.target.value as StaffStatus })}
              >
                <option value="approved">Approved (active)</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
              </select>
              <input
                type="password"
                className={inputCls}
                placeholder={editId ? "New password (leave blank to keep)" : "Password"}
                value={staffForm.password}
                onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                required={!editId}
                minLength={7}
              />

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                <p className="font-semibold text-[#0A1F44] flex items-center gap-2 text-sm">
                  <Fingerprint size={16} /> Fingerprint (attendance)
                </p>
                <p className="text-xs text-gray-500">
                  Scanner: {scannerReady ? "ready" : scannerReady === false ? "offline" : "checking…"}
                </p>
                <p className="text-xs text-gray-400">
                  Run the fingerprint scanner service on this PC, then capture during add or edit.
                </p>
                {(staffForm.fingerprintTemplate || staffForm.hasFingerprint) && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-emerald-700 font-medium">
                      {staffForm.fingerprintTemplate ? "New fingerprint ready to save" : "Fingerprint on file"}
                    </span>
                    <div className="flex gap-2">
                      {editId && staffForm.hasFingerprint && !staffForm.fingerprintTemplate && (
                        <button
                          type="button"
                          onClick={removeStoredFingerprint}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setStaffForm((f) => ({ ...f, fingerprintTemplate: "" }))}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCaptureFingerprint}
                  disabled={capturingFingerprint || scannerReady === false}
                  className="w-full py-2 text-sm font-semibold border border-[#0A1F44]/20 rounded-lg text-[#0A1F44] hover:bg-[#0A1F44]/5 disabled:opacity-40"
                >
                  {capturingFingerprint ? "Capturing…" : "Capture fingerprint"}
                </button>
              </div>

              <button type="submit" className="w-full py-2.5 bg-[#0A1F44] text-white rounded-xl font-semibold">
                {editId ? "Save changes" : "Add staff"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Staffs;
