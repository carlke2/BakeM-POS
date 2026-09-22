import { ChevronLeft, ChevronRight, LogOut, UserCheck, PiggyBank, Clock } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/services/toast";
import { useAuth } from "@/context/AuthContext";

const StudentSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  const studentName = user?.name || localStorage.getItem("studentName") || "Student";

  const menuItems = [
    // { name: "Order Food", icon: UtensilsCrossed, path: "/student/order" },
    { name: "My Wallet", icon: PiggyBank, path: "/student/wallet" },
    { name: "History", icon: Clock, path: "/student/history" },
    { name: "Profile", icon: UserCheck, path: "/student-profile" },
  ];

  const isActive = (path: string) =>
    location.pathname === path ||
    (path === "/student/wallet" && ["/student-fees", "/student-dashboard"].includes(location.pathname)) ||
    (path === "/student/order" && location.pathname === "/student/order");

  const handleLogout = async () => {
    const confirmed = await toast.confirm("Logout?", {
      description: "Are you sure you want to logout?",
      confirmLabel: "Logout",
    });
    if (confirmed) {
      logout();
      toast.success("Logged out");
      navigate("/login");
    }
  };

  return (
    <div className={`h-screen bg-gray-950 text-gray-100 flex flex-col border-r border-gray-800 transition-all duration-300 select-none ${collapsed ? "w-20" : "w-64"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <span className={`text-base font-extrabold tracking-wider uppercase text-white ${collapsed && "hidden"}`}>Student</span>
        <button 
          onClick={() => setCollapsed(!collapsed)} 
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition duration-200"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-4 overflow-y-auto space-y-1 px-2">
        {menuItems.map(({ name, icon: Icon, path }) => {
          const active = isActive(path);
          return (
            <Link 
              key={name} 
              to={path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                active
                  ? "bg-gray-800 text-white font-semibold shadow-sm"
                  : "text-gray-400 hover:bg-gray-900 hover:text-white"
              }`}
            >
              <Icon 
                size={18} 
                className={`transition-colors duration-200 ${active ? "text-indigo-400" : "text-gray-400 group-hover:text-gray-200"}`} 
              />
              {!collapsed && <span className="text-sm whitespace-nowrap">{name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Profile & Logout Footer */}
      <div className="p-3 border-t border-gray-850 flex flex-col gap-2 bg-gray-900">
        <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
          <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white font-extrabold text-sm shrink-0">
            {studentName.charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate leading-none">{studentName}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mt-1">Student Portal</p>
            </div>
          )}
        </div>
        {!collapsed ? (
          <button
            onClick={handleLogout}
            className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition duration-200"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        ) : (
          <button
            onClick={handleLogout}
            title="Logout"
            className="mt-1 w-full flex items-center justify-center p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition duration-200"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default StudentSidebar;
