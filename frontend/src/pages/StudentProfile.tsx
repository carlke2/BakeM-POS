import React, { useEffect, useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import { Save } from "lucide-react";

const StudentProfile: React.FC = () => {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    regNo: "",
    gender: "male",
    className: "",
    course: "",
    category: "",
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    parentRelationship: "",
    password: "",
  });

  const fetchMe = async () => {
    try {
      const { data } = await API.get("/students/me", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setForm({
        name: data.name || "",
        phone: data.phone || "",
        regNo: data.regNo || "",
        gender: data.gender || "male",
        className: data.className || "",
        course: data.course || "",
        category: data.category || "",
        parentName: data.parent?.name || "",
        parentPhone: data.parent?.phone || "",
        parentEmail: data.parent?.email || "",
        parentRelationship: data.parentRelationship || "",
        password: "",
      });
    } catch (error: any) {
      toast.error("Failed to load profile", error.response?.data?.message || error.message);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...form } as any;
      if (!payload.password) delete payload.password;
      delete payload.regNo;
      delete payload.className;
      delete payload.course;
      delete payload.category;
      delete payload.parentName;
      delete payload.parentPhone;
      delete payload.parentEmail;
      delete payload.parentRelationship;

      await API.put("/students/me", payload, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });

      toast.success("Profile updated successfully");
      setForm({ ...form, password: "" });
    } catch (error: any) {
      toast.error("Update failed", error.response?.data?.message || error.message);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  return (
    <div className="max-w-2xl mx-auto mt-10 bg-white p-8 rounded-xl shadow-md border border-gray-100">
      <h2 className="text-2xl font-semibold mb-6 text-gray-800 text-center">
        Student Profile
      </h2>

      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="text-sm text-gray-600 mb-1 block">Full Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            placeholder="Enter your full name"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            placeholder="Enter phone number"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Admission Number</label>
          <input
            value={form.regNo}
            readOnly
            className="w-full bg-gray-100 border border-gray-300 p-2.5 rounded-md text-gray-500 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Class</label>
          <input
            value={form.className || "-"}
            readOnly
            className="w-full bg-gray-100 border border-gray-300 p-2.5 rounded-md text-gray-500 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Category</label>
          <input
            value={form.category ? (form.category === "sponsored" ? "Sponsored" : "Regular") : "-"}
            readOnly
            className="w-full bg-gray-100 border border-gray-300 p-2.5 rounded-md text-gray-500 cursor-not-allowed"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="text-sm text-gray-600 mb-1 block">Parent / Guardian</label>
          <div className="w-full bg-gray-50 border border-gray-200 p-4 rounded-md space-y-1">
            <p className="text-sm font-semibold text-gray-800">{form.parentName || "-"}</p>
            <p className="text-sm text-gray-600">Phone: {form.parentPhone || "-"}</p>
            <p className="text-sm text-gray-600">Email: {form.parentEmail || "-"}</p>
            <p className="text-sm text-gray-600">
              Relationship: {form.parentRelationship ? form.parentRelationship : "-"}
            </p>
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600 mb-1 block">Gender</label>
          <select
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md bg-white"
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="text-sm text-gray-600 mb-1 block">New Password (optional)</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none p-2.5 rounded-md"
            placeholder="Enter new password"
          />
        </div>

        <button
          type="submit"
          className="sm:col-span-2 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-md transition"
        >
          <Save size={18} />
          Save Changes
        </button>
      </form>
    </div>
  );
};

export default StudentProfile;
