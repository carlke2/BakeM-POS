import { LogOut, Shield, Users } from "lucide-react";
import { toast } from "@/services/toast";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";

const AdminNavbar = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const adminName = user?.name || localStorage.getItem("adminName") || "Admin";

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
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* Left: Title & Admin Info */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 flex items-center justify-center rounded-full bg-red-100 text-red-600 font-semibold text-lg">
            {adminName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-800 flex items-center gap-1">
              <Shield size={18} className="text-red-500" />
              Admin Dashboard
            </h1>
            <p className="text-sm text-gray-500">Welcome, {adminName}</p>
          </div>
        </div>

        {/* Center: quick links */}
        <div className="hidden md:flex items-center gap-2">
          <Link
            to="/staffs"
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-[#0A1F44] px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
          >
            <Users size={16} />
            Staff
          </Link>
        </div>

        {/* Right: Logout Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleLogout}
          className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-all duration-200 shadow-sm"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Logout</span>
        </motion.button>
      </div>
    </motion.nav>
  );
};

export default AdminNavbar;
