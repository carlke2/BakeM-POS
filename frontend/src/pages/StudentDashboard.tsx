import React, { useEffect, useState } from "react";
import { Wallet, User, History } from "lucide-react";
import { Link } from "react-router-dom";
import API from "@/services/api";

const Card = ({ title, description, to, icon }: {
  title: string; description: string; to: string; icon: React.ReactNode;
}) => (
  <Link to={to} className="group bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex flex-col gap-4">
    <div className="p-3.5 bg-[#E8F4FD] text-[#0A1F44] rounded-xl group-hover:bg-[#0A1F44] group-hover:text-white transition-colors">{icon}</div>
    <div>
      <h3 className="text-lg font-bold text-[#0A1F44]">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
    </div>
  </Link>
);

const StudentDashboard: React.FC = () => {
  const name = localStorage.getItem("studentName") || "Student";
  const regNo = localStorage.getItem("regNo") || "";
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    API.get("/wallet/balance").then((r) => setBalance(r.data.balance)).catch(() => {});
  }, []);

  return (
    <div className="p-4 md:p-8 space-y-8 bg-[#E8F4FD] min-h-screen font-sans">
      <div className="bg-[#0A1F44] text-white rounded-3xl shadow-xl p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Welcome back, {name}!</h2>
          <p className="text-sm text-blue-200 mt-2">Admission Number: <span className="font-bold text-white">{regNo}</span></p>
          <p className="text-2xl font-bold text-green-300 mt-3">Wallet: KES {balance.toLocaleString()}</p>
        </div>
        <div className="mt-4 sm:mt-0 w-14 h-14 rounded-full bg-white text-[#0A1F44] flex items-center justify-center font-bold text-xl">
          {name.charAt(0).toUpperCase()}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-5xl">
        <Card title="My Wallet" description="View balance and spending limits" to="/student/wallet" icon={<Wallet size={24} />} />
        <Card title="History" description="Wallet and cafeteria expenditure" to="/student/history" icon={<History size={24} />} />
        <Card title="Profile" description="View your student profile" to="/student-profile" icon={<User size={24} />} />
      </div>

      <p className="text-center text-xs text-gray-500">© {new Date().getFullYear()} SmartPOS School Feeding System</p>
    </div>
  );
};

export default StudentDashboard;
