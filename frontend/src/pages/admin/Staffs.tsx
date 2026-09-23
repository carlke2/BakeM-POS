import { useEffect, useMemo, useState } from "react";
import { Users, Plus, Edit, Trash2, X, Search, Filter } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type StaffRole = "owner" | "cashier" | "delivery";
type StaffStatus = "approved" | "pending" | "rejected";

type StaffRow = {
  id: string;
  _id?: string;
  name: string;
  email: string;
  phone?: string | null;
  role: StaffRole;
  status: StaffStatus;
};

const emptyStaff = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "cashier" as StaffRole,
  status: "approved" as StaffStatus,
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#B91D2D] outline-none";

const roleLabel = (role: string) =>
  role === "owner" || role === "admin"
    ? "Owner"
    : role === "cashier" || role === "restaurant" || role === "finance"
      ? "Cashier"
      : role === "delivery"
        ? "Delivery"
        : role;

const normalizeRole = (role: string): StaffRole =>
  role === "owner" || role === "admin" ? "owner" : role === "delivery" ? "delivery" : "cashier";

const Staffs = () => {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState(emptyStaff);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | StaffRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | StaffStatus>("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await API.get<any[]>("/users");
      setStaff(
        (data || []).map((u) => ({
          ...u,
          role: normalizeRole(u.role),
        })),
      );
    } catch (e: any) {
      toast.error("Failed to load staff", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staff.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      return [u.name, u.email, u.phone, u.role, roleLabel(u.role), u.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [staff, searchQuery, roleFilter, statusFilter]);

  const hasActiveFilters =
    searchQuery !== "" || roleFilter !== "all" || statusFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setStaffForm(emptyStaff);
  };

  const saveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
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
        await API.post("/users", { ...body, password: staffForm.password });
      }

      toast.success(editId ? "Staff updated" : "Staff added");
      closeForm();
      fetchData();
    } catch (e: any) {
      toast.error("Operation failed", e.response?.data?.message);
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
      role: normalizeRole(u.role),
      status: u.status,
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
    <div className="p-4 md:p-8 bg-[#FBF4D0] min-h-screen font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-[#B91D2D] text-white rounded-2xl p-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={28} /> Staff
          </h1>
          <p className="text-white/80 text-sm mt-1">
            Manage Slow Rise Co owners, cashiers, and delivery riders
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-[#B91D2D]" />
              <span className="font-semibold text-[#B91D2D]">Search & filters</span>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-gray-500 hover:text-[#B91D2D]"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, phone…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#B91D2D] outline-none"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
              className={inputCls}
            >
              <option value="all">All roles</option>
              <option value="owner">Owner</option>
              <option value="cashier">Cashier</option>
              <option value="delivery">Delivery</option>
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
          </div>
          {!loading && (
            <p className="text-xs text-gray-500">
              Showing {filteredStaff.length} of {staff.length} staff
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h2 className="font-bold text-[#B91D2D]">All staff</h2>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 bg-[#B91D2D] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#B91D2D]/90"
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
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            u.status === "approved"
                              ? "bg-[#FFA29D] text-[#5C0101]"
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
              <h3 className="font-bold text-[#B91D2D]">{editId ? "Edit staff" : "Add staff"}</h3>
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
                <option value="cashier">Cashier</option>
                <option value="delivery">Delivery</option>
                <option value="owner">Owner</option>
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

              <button type="submit" className="w-full py-2.5 bg-[#B91D2D] text-white rounded-xl font-semibold">
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
