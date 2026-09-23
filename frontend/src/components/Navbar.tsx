import { LogOut, Shield, Monitor } from "lucide-react";
import { toast } from "@/services/toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";

const Navbar = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const name = user?.name || "User";
  const role = user?.role;

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

  const title =
    role === "owner" ? "Owner Dashboard" : role === "cashier" ? "POS Terminal" : "Dashboard";
  const TitleIcon = role === "cashier" ? Monitor : Shield;

  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 flex items-center justify-center rounded-full bg-[#FBF4D0] text-[#5C0101] font-semibold text-lg">
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-800 flex items-center gap-1">
              <TitleIcon size={18} className="text-[#B91D2D]" />
              {title}
            </h1>
            <p className="text-sm text-gray-500">Welcome, {name}</p>
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleLogout}
          className="flex items-center gap-2 bg-[#B91D2D] text-white px-4 py-2 rounded-lg hover:bg-[#B91D2D]/90 transition-all duration-200 shadow-sm"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Logout</span>
        </motion.button>
      </div>
    </motion.nav>
  );
};

export default Navbar;
