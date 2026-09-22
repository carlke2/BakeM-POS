import { useState } from "react";
import { LayoutDashboard, Users, Settings, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const menuItems = [
    { name: "Dashboard", icon: LayoutDashboard, path: "/" },
    { name: "Students", icon: Users, path: "/students" },
    { name: "Add Student", icon: Plus, path: "/add-student" },
    { name: "All Staff", icon: Users, path: "/staff-list" },
    { name: "Add Staff", icon: Plus, path: "/add-staff" },
    { name: "Settings", icon: Settings, path: "/settings" },
  ];

  return (
    <div
      className={`h-screen bg-gray-900 text-gray-100 flex flex-col transition-all duration-300 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <span className={`text-xl font-bold ${collapsed && "hidden"}`}>Admin</span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-white transition"
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="flex-1 mt-4">
        {menuItems.map(({ name, icon: Icon, path }) => (
          <Link
            key={name}
            to={path}
            className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition ${
              location.pathname === path ? "bg-gray-800" : ""
            }`}
          >
            <Icon size={20} />
            {!collapsed && <span>{name}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
};

export default Sidebar;
