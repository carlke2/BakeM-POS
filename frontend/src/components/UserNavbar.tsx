import { LogOut, User as UserIcon, Users, PieChart, UtensilsCrossed } from "lucide-react";
import { toast } from "@/services/toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";
import React from "react";

const ROLE_ICONS: Record<string, React.ReactNode> = {
    parent: <Users size={18} className="text-orange-500" />,
    finance: <PieChart size={18} className="text-blue-500" />,
    restaurant: <UtensilsCrossed size={18} className="text-cyan-500" />,
};

const ROLE_LABELS: Record<string, string> = {
    parent: "Parent",
    finance: "Finance Officer",
    restaurant: "Restaurant Staff",
};

const UserNavbar = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const userName = user?.name || "User";
    const role = user?.role;

    if (!role) return null;

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
        <motion.nav initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-100 text-[#0A1F44] font-bold text-lg border">
                        {userName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h1 className="text-base font-bold text-gray-800 flex items-center gap-1.5">
                            {ROLE_ICONS[role] || <UserIcon size={18} />}
                            {ROLE_LABELS[role] || role} Dashboard
                        </h1>
                        <p className="text-xs text-gray-500">Welcome, {userName}</p>
                    </div>
                </div>
                <button onClick={handleLogout}
                    className="flex items-center gap-2 bg-[#0A1F44] text-white px-4 py-2 rounded-lg hover:bg-[#0A1F44]/90 text-sm font-semibold">
                    <LogOut size={16} /> Logout
                </button>
            </div>
        </motion.nav>
    );
};

export default UserNavbar;
