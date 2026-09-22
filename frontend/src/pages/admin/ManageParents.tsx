import React, { useEffect, useMemo, useState } from "react";
import { Users, Plus, Edit, Trash2, X, Search } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

const emptyParent = { name: "", phone: "", email: "", password: "", studentIds: [] as string[] };
const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none";

const ManageParents: React.FC = () => {
  const [parents, setParents] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [parentForm, setParentForm] = useState(emptyParent);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredParents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parents;
    return parents.filter((p) => {
      const linked = (p.students || [])
        .map((s: any) => `${s.name || ""} ${s.regNo || ""}`)
        .join(" ");
      const haystack = [p.name, p.phone, p.email, linked]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [parents, searchQuery]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([API.get("/parents"), API.get("/students")]);
      setParents(p.data);
      setStudents(s.data);
    } catch (e: any) {
      toast.error("Failed to load parents", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setParentForm(emptyParent);
  };

  const saveParent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...parentForm, studentIds: parentForm.studentIds };
      if (editId) {
        const body: any = { name: payload.name, phone: payload.phone, email: payload.email, studentIds: payload.studentIds };
        if (payload.password) body.password = payload.password;
        await API.put(`/parents/${editId}`, body);
      } else {
        await API.post("/parents", payload);
      }
      toast.success(editId ? "Updated" : "Added");
      closeForm();
      fetchData();
    } catch (e: any) {
      toast.error("Operation failed", e.response?.data?.message);
    }
  };

  const editParent = (p: any) => {
    setEditId(p._id || p.id);
    setParentForm({
      name: p.name, phone: p.phone || "", email: p.email || "", password: "",
      studentIds: (p.students || []).map((s: any) => s.id),
    });
    setShowForm(true);
  };

  const deleteParent = async (id: string) => {
    const r = await toast.confirm("Delete parent?", { confirmLabel: "Delete" });
    if (!r) return;
    await API.delete(`/parents/${id}`);
    fetchData();
  };

  const toggleParentStudent = (studentId: string) => {
    setParentForm((f) => ({
      ...f,
      studentIds: f.studentIds.includes(studentId)
        ? f.studentIds.filter((id) => id !== studentId)
        : [...f.studentIds, studentId],
    }));
  };

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-[#0A1F44] text-white rounded-2xl p-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={28} /> Parents
          </h1>
          <p className="text-blue-200 text-sm mt-1">Add and manage parent accounts and link them to students</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border-b border-gray-100">
            <h2 className="font-bold text-[#0A1F44]">View All Parents</h2>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search parents or linked students..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
                />
              </div>
              <button onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center justify-center gap-2 bg-[#0A1F44] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#0A1F44]/90">
                <Plus size={16} /> Add a Parent
              </button>
            </div>
          </div>

          {loading ? (
            <Loader size="sm" title="Loading parents..." subtitle="Fetching parent accounts" className="py-8" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Parent</th>
                    <th className="px-4 py-3 text-left">Contact</th>
                    <th className="px-4 py-3 text-left">Linked Students</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {parents.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">No parents yet</td></tr>
                  ) : filteredParents.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">No parents match your search</td></tr>
                  ) : filteredParents.map((p) => (
                    <tr key={p._id || p.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-semibold">{p.name}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.phone || "-"}</p>
                        <p className="text-gray-400">{p.email || "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {(p.students || []).length === 0 ? "-" : (
                          <div className="flex flex-wrap gap-1">
                            {p.students.map((s: any) => (
                              <span key={s.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs">{s.regNo}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => editParent(p)} className="p-2 text-gray-400 hover:text-amber-600"><Edit size={16} /></button>
                          <button onClick={() => deleteParent(p._id || p.id)} className="p-2 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
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
              <h3 className="font-bold text-[#0A1F44]">{editId ? "Edit" : "Add"} Parent</h3>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={saveParent} className="space-y-3">
              <input className={inputCls} placeholder="Full name" value={parentForm.name} onChange={(e) => setParentForm({ ...parentForm, name: e.target.value })} required />
              <input className={inputCls} placeholder="Phone" value={parentForm.phone} onChange={(e) => setParentForm({ ...parentForm, phone: e.target.value })} required />
              <input type="email" className={inputCls} placeholder="Email (optional)" value={parentForm.email} onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })} />
              <input type="password" className={inputCls} placeholder={editId ? "New password (leave blank to keep)" : "Password"} value={parentForm.password} onChange={(e) => setParentForm({ ...parentForm, password: e.target.value })} required={!editId} minLength={7} />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Link Students</p>
                <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1">
                  {students.length === 0 ? <p className="text-xs text-gray-400 p-2">Add students first</p> : students.map((s) => (
                    <label key={s._id || s.id} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm">
                      <input type="checkbox" checked={parentForm.studentIds.includes(s._id || s.id)} onChange={() => toggleParentStudent(s._id || s.id)} />
                      {s.name} ({s.regNo})
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit" className="w-full py-2.5 bg-[#0A1F44] text-white rounded-xl font-semibold">{editId ? "Save Changes" : "Add Parent"}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageParents;
