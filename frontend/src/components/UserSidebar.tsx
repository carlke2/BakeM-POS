import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
    LayoutDashboard, User, Boxes, BarChart3, Store, BookOpen,
    PlusCircle, Edit3, RefreshCw, Trash2, ChefHat, FileText, Tags,
    ChevronLeft, ChevronRight, LogOut, Coins, CreditCard, Clock, 
    Receipt, Scale, Monitor, Fingerprint, Truck
} from "lucide-react";
import { toast } from "@/services/toast";
import { useAuth } from "@/context/AuthContext";
import LogoImg from "@/assets/LOGO.png";

const ROLE_CONFIG: Record<string, {
    label: string;
    menuItems: { name: string; icon: React.FC<any>; path: string }[];
}> = {
    parent: {
        label: "Parent",
        menuItems: [
            { name: "Dashboard", icon: LayoutDashboard, path: "/parent-dashboard" },
            { name: "Top Up Wallet", icon: CreditCard, path: "/parent/topup" },
            { name: "Manage Wallet", icon: Coins, path: "/parent/wallet" },
            { name: "View History", icon: Clock, path: "/parent/history" },
            { name: "My Profile", icon: User, path: "/user-profile" },
        ]
    },
    restaurant: {
        label: "Restaurant POS",
        menuItems: [
            { name: "POS Terminal", icon: Store, path: "/pos" },
            { name: "Order Display", icon: Monitor, path: "/kiosk" },
            { name: "Staff Attendance", icon: Fingerprint, path: "/attendance" },
            { name: "Menu Items", icon: BookOpen, path: "/menu-management/list" },
            { name: "Menu Categories", icon: Tags, path: "/menu-management/categories" },
            { name: "Add Menu Item", icon: PlusCircle, path: "/menu-management/add" },
            { name: "Edit Menu Item", icon: Edit3, path: "/menu-management/edit" },
            { name: "Update Menu Item", icon: RefreshCw, path: "/menu-management/update" },
            { name: "Delete Menu Item", icon: Trash2, path: "/menu-management/delete" },
            { name: "Menu Recipes", icon: ChefHat, path: "/menu-management/recipes" },
            { name: "Inventory & Kitchen", icon: Boxes, path: "/inventory" },
            { name: "Suppliers", icon: Truck, path: "/suppliers" },
            { name: "My Attendance", icon: Fingerprint, path: "/my-attendance" },
            { name: "Profile", icon: User, path: "/user-profile" },
        ]
    },
    finance: {
        label: "Finance Dept",
        menuItems: [
            { name: "Finance Dashboard", icon: BarChart3, path: "/finance" },
            // { name: "M-Pesa STK Pay", icon: CreditCard, path: "/pay-kopokopo" },
            { name: "Collections", icon: Receipt, path: "/collections" },
            { name: "Expenses", icon: Receipt, path: "/expenses" },
            { name: "Inventory & Kitchen", icon: Scale, path: "/inventory" },
            { name: "Suppliers", icon: Truck, path: "/suppliers" },
            { name: "Receipts", icon: FileText, path: "/receipts" },
            { name: "My Attendance", icon: Fingerprint, path: "/my-attendance" },
            { name: "Profile", icon: User, path: "/user-profile" },
        ]
    }
};

const UserSidebar: React.FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    
    const role = user?.role;
    const userName = user?.name || "User";

    if (!role) return null;

    const config = ROLE_CONFIG[role] || ROLE_CONFIG.parent;
    const menuItems = config.menuItems;

    const handleLogout = async () => {
        const confirmed = await toast.confirm("Logout?", {
            description: "Are you sure you want to end your session?",
            confirmLabel: "Logout",
        });
        if (confirmed) {
            logout();
            toast.success("Logged out");
            navigate("/login");
        }
    };

    return (
        <div className={`h-screen bg-[#0A1F44] text-gray-100 flex flex-col transition-all duration-300 ${collapsed ? "w-20" : "w-64"} border-r border-white/5`}>
            {/* Super Creative Header with Logo & Accent Badge */}
            <div className="flex flex-col items-center justify-center pt-5 pb-4 px-4 border-b border-white/5 relative group/header select-none">
                {/* Sleek Collapse Trigger */}
                <button 
                    onClick={() => setCollapsed(!collapsed)} 
                    className="absolute top-2.5 right-2.5 p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition duration-200 z-10"
                    title={collapsed ? "Expand" : "Collapse"}
                >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                </button>

                <div className="flex flex-col items-center gap-2.5">
                    {/* Logo Container with Subtle Floating Outline Card (Rounded) */}
                    <div className={`relative transition-all duration-300 p-1.5 rounded-full border bg-white ${
                        collapsed ? "border-white/5 shadow-sm scale-95" : "border-white/10 shadow-md scale-100 hover:border-indigo-500/30"
                    }`}>
                        <img 
                            src={LogoImg} 
                            alt="Better Forks Logo" 
                            draggable="false"
                            className={`transition-all duration-300 object-cover rounded-full select-none ${
                                collapsed ? "h-8 w-8" : "h-14 w-14"
                            }`}
                        />
                        
                    </div>

                    {!collapsed && (
                        <div className="text-center mt-1 animate-in fade-in slide-in-from-top-1 duration-300 flex flex-col items-center gap-1.5">
                            {/* Brand Name with Creative Letter Spacing & Contrast Weights */}
                            <h2 className="text-xs tracking-[0.2em] text-white font-extrabold uppercase flex flex-col items-center leading-tight">
                                <span className="flex gap-1">
                                    <span>Better</span>
                                    <span>Forks</span>
                                </span>
                                <span className="text-[8px] text-white tracking-[0.12em] font-bold uppercase mt-1">
                                    Restaurant Limited
                                </span>
                            </h2>
                            {/* Premium Status/Console Pill */}
                            <span className="text-[8px] text-white tracking-[0.12em] font-bold uppercase mt-1">
                                {config.label}
                            </span>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Menu Items */}
            <nav className="flex-1 mt-4 overflow-y-auto space-y-1 px-2 select-none">
                {menuItems.map(({ name, icon: Icon, path }) => {
                    const isActive = location.pathname === path || (path !== "/" && location.pathname.startsWith(path));
                    return (
                        <Link
                            key={name}
                            to={path}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                                isActive
                                    ? "bg-white/10 text-white font-semibold shadow-sm"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                            }`}
                        >
                            <Icon 
                                size={18} 
                                className={`transition-colors duration-200 ${isActive ? "text-indigo-400" : "text-gray-400 group-hover:text-gray-200"}`} 
                            />
                            {!collapsed && <span className="text-sm whitespace-nowrap">{name}</span>}
                        </Link>
                    );
                })}
            </nav>

            {/* Profile & Logout Footer */}
            <div className="p-3 border-t border-white/5 flex flex-col gap-2 bg-[#081835]">
                <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
                    <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white font-extrabold text-sm shrink-0 select-none">
                        {userName.charAt(0).toUpperCase()}
                    </div>
                    {!collapsed && (
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white truncate leading-none">{userName}</p>
                            <p className="text-[10px] text-gray-400 capitalize truncate mt-1">{role} Account</p>
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

export default UserSidebar;
