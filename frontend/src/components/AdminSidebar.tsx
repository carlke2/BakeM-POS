import {
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Compass,
  Heart,
  Users,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Activity,
  Sliders,
  Fingerprint,
  UserCircle2,
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/services/toast";
import { useAuth } from "@/context/AuthContext";

type MenuItem = {
  name: string;
  icon: any;
  path: string;
};

const menuSections: { title?: string; items: MenuItem[] }[] = [
  {
    items: [{ name: "Dashboard", icon: Compass, path: "/" }],
  },
  {
    title: "Management",
    items: [
      { name: "Students", icon: GraduationCap, path: "/students" },
      { name: "Parents", icon: Heart, path: "/parents" },
      { name: "Staff", icon: Users, path: "/staffs" },
      { name: "Suppliers", icon: Truck, path: "/suppliers" },
      { name: "Pending Approvals", icon: ShieldCheck, path: "/pending-approvals" },
    ],
  },
  {
    title: "System",
    items: [
      { name: "System Reports", icon: TrendingUp, path: "/reports" },
      { name: "Staff Attendance", icon: Fingerprint, path: "/staff-attendance" },
      { name: "Collections & Reconciliations", icon: Receipt, path: "/collections" },
      { name: "Audit Logs", icon: Activity, path: "/audit-logs" },
      { name: "Settings", icon: Sliders, path: "/settings" },
    ],
  },
  {
    title: "Account",
    items: [{ name: "Profile", icon: UserCircle2, path: "/admin-profile" }],
  },
];

const AdminSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("admin_sidebar_collapsed") === "true";
  });

  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    localStorage.setItem("admin_sidebar_collapsed", String(collapsed));
  }, [collapsed]);

  const isExpanded = !collapsed || hovered;
  const adminName = user?.name || localStorage.getItem("adminName") || "Admin";

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  const handleLogout = async () => {
    const confirmed = await toast.confirm("Logout from Admin Dashboard?", {
      description: "You will need to log in again to continue.",
      confirmLabel: "Logout",
    });
    if (confirmed) {
      logout();
      toast.success("Logged out successfully");
      navigate("/login");
    }
  };

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`h-screen bg-gray-950 text-gray-100 flex flex-col border-r border-gray-800 transition-all duration-300 select-none
        ${collapsed ? "w-20" : "w-64"}
        ${collapsed && hovered ? "w-64 shadow-2xl z-50 absolute" : ""}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        {isExpanded ? (
          <span className="text-base font-extrabold tracking-wider uppercase text-white">
            SmartPOS Admin
          </span>
        ) : (
          <span className="text-base font-black text-indigo-400">SP</span>
        )}

        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition duration-200"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-4 overflow-y-auto space-y-4 px-2">
        {menuSections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {isExpanded && section.title && (
              <p className="px-3 mb-1 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                {section.title}
              </p>
            )}

            {section.items.map(({ name, icon: Icon, path }) => {
              const active = isActive(path);

              return (
                <Link
                  key={name}
                  to={path}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 group ${
                    active
                      ? "bg-gray-800 text-white font-semibold shadow-sm"
                      : "text-gray-400 hover:bg-gray-900 hover:text-white"
                  }`}
                >
                  <Icon 
                    size={18} 
                    className={`transition-colors duration-200 ${active ? "text-indigo-400" : "text-gray-400 group-hover:text-gray-200"}`} 
                  />

                  {isExpanded && (
                    <span className="text-sm whitespace-nowrap">
                      {name}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Profile & Logout Footer */}
      <div className="p-3 border-t border-gray-850 flex flex-col gap-2 bg-gray-900">
        <div className={`flex items-center gap-3 ${!isExpanded ? "justify-center" : ""}`}>
          <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-red-600 text-white font-extrabold text-sm shrink-0">
            {adminName.charAt(0).toUpperCase()}
          </div>
          {isExpanded && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate leading-none">{adminName}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold mt-1">Administrator</p>
            </div>
          )}
        </div>
        {isExpanded ? (
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
    </aside>
  );
};

export default AdminSidebar;