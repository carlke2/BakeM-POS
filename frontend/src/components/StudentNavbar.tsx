import { LogOut } from "lucide-react";
import { toast } from "@/services/toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";

const StudentNavbar = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    const confirmed = await toast.confirm("Logout from student portal?", {
      description: "You will need to log in again to access your account.",
      confirmLabel: "Logout",
    });
    if (confirmed) {
      logout();
      toast.success("Logged out");
      navigate("/login");
    }
  };

  const name = user?.name || localStorage.getItem("studentName") || "Student";

  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* Left: Portal Title */}
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 bg-blue-100 text-blue-600 flex items-center justify-center rounded-full font-bold text-lg">
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-800 leading-tight">
              Student Portal
            </h1>
            <p className="text-sm text-gray-500">Welcome, {name}</p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleLogout}
            className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors duration-200 shadow-sm"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium">Logout</span>
          </motion.button>
        </div>
      </div>
    </motion.nav>
  );
};

export default StudentNavbar;
