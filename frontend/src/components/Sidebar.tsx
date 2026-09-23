import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  LayoutDashboard,
  LogOut,
  Monitor,
  Package,
  PieChart,
  Receipt,
  Settings,
  ShoppingBag,
  Sliders,
  TrendingUp,
  Truck,
  UserCircle2,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/services/toast";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/services/authStorage";

type MenuItem = {
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
};

type MenuSection = { title?: string; items: MenuItem[] };

const OWNER_SECTIONS: MenuSection[] = [
  {
    items: [{ name: "Dashboard", icon: Compass, path: "/" }],
  },
  {
    title: "Operations",
    items: [
      { name: "Staff", icon: Users, path: "/staffs" },
      { name: "Menu", icon: UtensilsCrossed, path: "/menu-management" },
      { name: "Inventory", icon: Package, path: "/inventory" },
      { name: "Suppliers", icon: Truck, path: "/suppliers" },
      { name: "Production", icon: ShoppingBag, path: "/production" },
      { name: "POS", icon: Monitor, path: "/pos" },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Finance Dashboard", icon: LayoutDashboard, path: "/finance" },
      { name: "Expenses", icon: Wallet, path: "/expenses" },
      { name: "Receipts", icon: Receipt, path: "/receipts" },
      { name: "Collections", icon: PieChart, path: "/collections" },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Reports", icon: TrendingUp, path: "/reports" },
      { name: "Staff Attendance", icon: Clock, path: "/staff-attendance" },
      { name: "Audit Logs", icon: Activity, path: "/audit-logs" },
      { name: "Settings", icon: Sliders, path: "/settings" },
    ],
  },
  {
    title: "Account",
    items: [{ name: "Profile", icon: UserCircle2, path: "/admin-profile" }],
  },
];

const CASHIER_SECTIONS: MenuSection[] = [
  {
    items: [
      { name: "POS Terminal", icon: Monitor, path: "/pos" },
      { name: "My Attendance", icon: Clock, path: "/my-attendance" },
      { name: "Profile", icon: UserCircle2, path: "/user-profile" },
    ],
  },
];

const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  cashier: "Cashier",
};

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const role = user?.role;

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("sidebar_collapsed") === "true";
  });
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", String(collapsed));
  }, [collapsed]);

  const isExpanded = !collapsed || hovered;
  const displayName = user?.name || "User";
  const sections = role === "cashier" ? CASHIER_SECTIONS : OWNER_SECTIONS;

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleLogout = async () => {
    const confirmed = await toast.confirm("Logout?", {
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
      className={`h-screen bg-[#B91D2D] text-white flex flex-col border-r border-white/10 transition-all duration-300 select-none
        ${collapsed ? "w-20" : "w-64"}
        ${collapsed && hovered ? "w-64 shadow-2xl z-50 absolute" : ""}
      `}
    >
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/15">
        {isExpanded ? (
          <span className="text-base font-extrabold tracking-wide text-white">
            Slow Rise Co
          </span>
        ) : (
          <span className="text-base font-black text-white">SR</span>
        )}

        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition duration-200"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 mt-4 overflow-y-auto space-y-4 px-2">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {isExpanded && section.title && (
              <p className="px-3 mb-1 text-[10px] uppercase tracking-wider text-white/60 font-bold">
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
                      ? "bg-white text-[#5C0101] font-semibold shadow-sm"
                      : "text-white/85 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  <Icon
                    size={18}
                    className={`transition-colors duration-200 ${
                      active ? "text-[#5C0101]" : "text-white/80 group-hover:text-white"
                    }`}
                  />

                  {isExpanded && (
                    <span className="text-sm whitespace-nowrap">{name}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/15 flex flex-col gap-2 bg-[#5C0101]">
        <div className={`flex items-center gap-3 ${!isExpanded ? "justify-center" : ""}`}>
          <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-white text-[#5C0101] font-extrabold text-sm shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          {isExpanded && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate leading-none">{displayName}</p>
              <p className="text-[10px] text-white/70 uppercase tracking-wider font-bold mt-1">
                {role ? ROLE_LABELS[role] : "Staff"}
              </p>
            </div>
          )}
        </div>
        {isExpanded ? (
          <button
            onClick={handleLogout}
            className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#FBF4D0]/15 hover:bg-[#FBF4D0]/25 text-[#FBF4D0] text-xs font-bold transition duration-200"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        ) : (
          <button
            onClick={handleLogout}
            title="Logout"
            className="mt-1 w-full flex items-center justify-center p-2 rounded-lg text-[#FBF4D0] hover:bg-[#FBF4D0]/15 transition duration-200"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
