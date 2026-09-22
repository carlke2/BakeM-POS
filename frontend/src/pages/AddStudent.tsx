import React, { useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";

const AddStudent: React.FC = () => {
  const [form, setForm] = useState({
    name: "",
    course: "",
    year: "",
    email: "",
    phone: "",
    gender: "male",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const addStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.post("/students", form);
      toast.success("Student added!");
      setForm({
        name: "",
        course: "",
        year: "",
        email: "",
        phone: "",
        gender: "male",
        password: "",
      });
    } catch (error: any) {
      if (error.response?.status === 409) {
        toast.warning("Student already exists", error.response.data.message);
      } else {
        toast.error("Error adding student", error.response?.data?.message || error.message);
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-12 bg-white border border-gray-200 shadow-md rounded-2xl p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-semibold text-gray-800">Add New Student</h2>
        <button
          onClick={() => navigate("/students")}
          className="flex items-center gap-2 text-blue-600 border border-blue-500 px-4 py-2 rounded-lg hover:bg-blue-50 transition-all duration-200"
        >
          <ArrowLeft className="w-5 h-5" />
          All Students
        </button>
      </div>

      {/* Form */}
      <form
        onSubmit={addStudent}
        className="grid grid-cols-1 sm:grid-cols-2 gap-6"
      >
        {/* Name */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Enter full name"
            className="border border-gray-300 rounded-lg p-2.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Course */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Course</label>
          <input
            type="text"
            required
            value={form.course}
            onChange={(e) => setForm({ ...form, course: e.target.value })}
            placeholder="Enter course"
            className="border border-gray-300 rounded-lg p-2.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Email */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Email Address</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Enter email"
            className="border border-gray-300 rounded-lg p-2.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Phone */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Phone Number</label>
          <input
            type="tel"
            required
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="e.g. 0712345678"
            className="border border-gray-300 rounded-lg p-2.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Gender */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Gender</label>
          <select
            required
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className="border border-gray-300 rounded-lg p-2.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        {/* Year */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700 mb-1">Year of Study</label>
          <input
            type="number"
            min="1"
            max="10"
            required
            value={form.year}
            onChange={(e) => setForm({ ...form, year: e.target.value })}
            placeholder="Enter year"
            className="border border-gray-300 rounded-lg p-2.5 text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Password */}
        <div className="flex flex-col sm:col-span-2 relative">
          <label className="text-sm font-medium text-gray-700 mb-1">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={7}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Enter password (minimum 7 characters)"
              className="border border-gray-300 rounded-lg p-2.5 w-full text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Submit Button */}
        <div className="sm:col-span-2 flex justify-end mt-4">
          <button
            type="submit"
            className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-all duration-200"
          >
            Add Student
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddStudent;
