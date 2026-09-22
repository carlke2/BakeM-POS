import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Eye, Edit, Trash2, X, User, Phone, Mail, BookOpen, Clock, Search } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";

interface Student {
  _id: string;
  name: string;
  regNo: string;
  course: string;
  email: string;
  phone: string;
  gender: string;
  year: number;
}

const students: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => {
      const haystack = [
        s.name,
        s.regNo,
        s.course,
        s.email,
        s.phone,
        s.gender,
        s.year?.toString(),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [students, searchQuery]);

  const fetchStudents = async () => {
    const { data } = await API.get("/students");
    setStudents(data);
  };

  const deleteStudent = async (id: string) => {
    try {
      await API.delete(`/students/${id}`);
      toast.success("Student deleted!");
      fetchStudents();
    } catch (error: any) {
      toast.error("Error deleting student", error.response?.data?.message || error.message);
    }
  };

  const startEdit = (student: Student) => {
    setEditId(student._id);
    setEditForm({
      name: student.name,
      course: student.course,
      year: student.year.toString(),
      email: student.email,
      phone: student.phone,
      gender: student.gender,
      password: "",
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...editForm };
      if (!payload.password) delete payload.password;
      await API.put(`/students/${editId}`, payload);
      toast.success("Student updated!");
      setEditId(null);
      setEditForm(null);
      fetchStudents();
    } catch (error: any) {
      if (error.response?.status === 409) {
        toast.warning("Student already exists", error.response.data.message);
      } else {
        toast.error("Error updating student", error.response?.data?.message || error.message);
      }
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  return (
    <div className="max-w-6xl mx-auto mt-10 p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 pb-6 border-b border-gray-100 gap-4 sm:gap-0">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F44]">Student Directory</h1>
          <p className="text-gray-500 text-sm mt-1">Manage all registered students across the platform</p>
        </div>
        <Link
          to="/add-student"
          className="flex items-center gap-2 bg-[#0A1F44] text-white px-5 py-2.5 rounded-xl hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#0A1F44]/20 transition-all duration-300 font-medium"
        >
          <Plus className="w-5 h-5" />
          Add New Student
        </Link>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, reg no, course, email, or phone..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-sm uppercase tracking-wider">
              <th className="p-4 font-semibold rounded-tl-xl">Student</th>
              <th className="p-4 font-semibold">Reg No / Course</th>
              <th className="p-4 font-semibold">Contact</th>
              <th className="p-4 font-semibold text-center rounded-tr-xl">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {students.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">
                  No students found. Add a new student to get started.
                </td>
              </tr>
            ) : filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">
                  No students match your search.
                </td>
              </tr>
            ) : (
              filteredStudents.map((s) => (
                <tr key={s._id} className="hover:bg-gray-50/50 transition-colors group">
                  {editId === s._id ? (
                    <td colSpan={4} className="p-4">
                      <form onSubmit={saveEdit} className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                          <h3 className="font-semibold text-[#0A1F44]">Edit Student: {s.name}</h3>
                          <button type="button" onClick={() => { setEditId(null); setEditForm(null); }} className="text-gray-400 hover:text-gray-600">
                            <X size={20} />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                          <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none" required placeholder="Name" />
                          <input type="text" value={editForm.course} onChange={e => setEditForm({ ...editForm, course: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none" required placeholder="Course" />
                          <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none" required placeholder="Email" />
                          <input type="tel" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none" required placeholder="Phone" />
                          <select value={editForm.gender} onChange={e => setEditForm({ ...editForm, gender: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none" required>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                          <input type="number" value={editForm.year} onChange={e => setEditForm({ ...editForm, year: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none" min="1" max="10" required placeholder="Year" />
                          <input type="password" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} className="border border-gray-200 p-2.5 rounded-lg focus:ring-2 focus:ring-[#0A1F44] focus:border-transparent outline-none md:col-span-3 lg:col-span-1" placeholder="New pass (blank=unchanged)" />
                        </div>
                        <div className="flex justify-end gap-3 mt-2">
                          <button type="button" onClick={() => { setEditId(null); setEditForm(null); }} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
                          <button type="submit" className="px-4 py-2 bg-[#0A1F44] text-white rounded-lg hover:bg-indigo-900 transition-colors font-medium">Save Changes</button>
                        </div>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#E8F4FD] text-[#0A1F44] flex items-center justify-center font-bold text-lg">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 group-hover:text-[#0A1F44] transition-colors">{s.name}</p>
                            <p className="text-xs text-gray-500 capitalize">{s.gender} • Year {s.year}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-gray-800">{s.regNo}</p>
                        <p className="text-sm text-gray-500">{s.course}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-gray-700">{s.email}</p>
                        <p className="text-sm text-gray-500">{s.phone}</p>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => setSelectedStudent(s)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors tooltip" title="View Details">
                            <Eye size={18} />
                          </button>
                          <button onClick={() => startEdit(s)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors tooltip" title="Edit Student">
                            <Edit size={18} />
                          </button>
                          <button onClick={() => deleteStudent(s._id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors tooltip" title="Delete Student">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* View Student Modal Overlay */}
      {selectedStudent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-[#0A1F44] shrink-0 relative px-6 pt-6 pb-12 text-white flex flex-col items-center">
              <button
                onClick={() => setSelectedStudent(null)}
                className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <X size={20} />
              </button>

              <div className="w-20 h-20 bg-white text-[#0A1F44] flex items-center justify-center text-3xl font-bold rounded-full shadow-lg border-4 border-[#0A1F44]/50 mb-3">
                {selectedStudent.name.charAt(0).toUpperCase()}
              </div>
              <h2 className="text-xl font-bold text-center">{selectedStudent.name}</h2>
              <p className="text-blue-200 tracking-wide mt-1 text-xs rounded-full bg-white/10 px-3 py-1 font-mono">
                {selectedStudent.regNo}
              </p>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-6 -mt-6 bg-white rounded-t-3xl relative z-10 flex flex-col gap-5 overflow-y-auto">

              {/* Academic Info */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Academic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex items-start gap-3">
                    <div className="p-2 bg-[#E8F4FD] text-[#0A1F44] rounded-xl"><BookOpen size={18} /></div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Course</p>
                      <p className="font-semibold text-gray-900 leading-tight mt-0.5">{selectedStudent.course}</p>
                    </div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex items-start gap-3">
                    <div className="p-2 bg-[#E8F4FD] text-[#0A1F44] rounded-xl"><Clock size={18} /></div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Year</p>
                      <p className="font-semibold text-gray-900 leading-tight mt-0.5">Year {selectedStudent.year}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Personal Info */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Personal & Contact</h3>
                <div className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
                  <div className="p-4 flex items-center gap-4">
                    <div className="p-2 bg-white text-gray-500 rounded-lg shadow-sm border border-gray-100"><Mail size={16} /></div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Email Address</p>
                      <p className="font-medium text-gray-900 text-sm">{selectedStudent.email}</p>
                    </div>
                  </div>
                  <div className="p-4 flex items-center gap-4">
                    <div className="p-2 bg-white text-gray-500 rounded-lg shadow-sm border border-gray-100"><Phone size={16} /></div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Phone Number</p>
                      <p className="font-medium text-gray-900 text-sm">{selectedStudent.phone}</p>
                    </div>
                  </div>
                  <div className="p-4 flex items-center gap-4">
                    <div className="p-2 bg-white text-gray-500 rounded-lg shadow-sm border border-gray-100"><User size={16} /></div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Gender</p>
                      <p className="font-medium text-gray-900 text-sm capitalize">{selectedStudent.gender}</p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedStudent(null)}
                className="w-full mt-2 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default students;