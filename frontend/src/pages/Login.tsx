import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "@/services/toast";
import API from "@/services/api";
import Loader from "@/components/ui/loader";
import logo from "@/assets/LOGO.png";
import { getDashboardPath, useAuth } from "@/context/AuthContext";
import type { AuthUser, UserRole } from "@/services/authStorage";

const BRAND = "#0A1F44";

const Login: React.FC = () => {
  const { status, user, login, refreshSession } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "authenticated" && user) {
      navigate(getDashboardPath(user.role), { replace: true });
    }
  }, [status, user, navigate]);

  if (status === "loading") {
    return (
      <Loader size="sm" title="Loading..." subtitle="Checking your session" className="min-h-screen py-24" />
    );
  }

  const toAuthUser = (data: any): AuthUser => ({
    id: data.id || data._id,
    name: data.name,
    role: data.role as UserRole,
    email: data.email,
    regNo: data.regNo,
    walletBalance: data.walletBalance,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const rawId = identifier.trim();
      const rawPass = password;
      const digits = rawId.replace(/\D/g, "");
      const normalizedId =
        !rawId.includes("@") && digits.length >= 9 && digits.length <= 15
          ? digits.startsWith("254") && digits.length >= 12
            ? `0${digits.slice(3)}`
            : digits.length === 9
              ? `0${digits}`
              : digits.startsWith("0")
                ? digits
                : rawId
          : rawId;

      const res = await API.post("/auth/login", {
        identifier: normalizedId,
        password: rawPass.trim(),
      });
      const data = res.data;

      if (!data?.role || !data?.token) {
        toast.error("Login failed", "Unexpected response from server");
        return;
      }

      const authUser = toAuthUser(data);
      // Set session immediately from login response — don't block on a second round-trip
      login(authUser, data.token);
      void refreshSession();
      toast.success(`Welcome, ${data.name || "user"}!`);
      navigate(getDashboardPath(authUser.role));
    } catch (error: any) {
      toast.error("Login failed", error.response?.data?.message || "Invalid phone/email or password");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full px-3 py-3 bg-gray-100 border-2 border-transparent focus:border-[#0A1F44]/30 focus:bg-white rounded-xl outline-none text-sm transition";

  return (
    <div className="min-h-screen bg-[#E8F4FD] p-4 font-sans relative overflow-y-auto">
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-[#0A1F44]/10 blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] rounded-full bg-[#0A1F44]/5 blur-[120px]" />
      </div>

      <div className="min-h-screen flex items-center justify-center py-8">
        <div className="w-full max-w-[380px] relative my-auto">
          <div className="bg-white rounded-3xl shadow-xl p-6 md:p-8 border border-gray-100">
            <div className="flex flex-col items-center mb-6">
              <motion.img
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                src={logo}
                draggable={false}
                alt="SmartPOS"
                className="w-40 h-auto object-contain mb-3"
              />
              <h2 className="text-xl font-bold text-[#0A1F44]">Welcome Back, please login!</h2>
              <p className="text-slate-500 text-xs mt-1 text-center">
                Email, phone, or admission number · Parents: password is your phone
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3">
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Email, phone, or admission number"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className={inputCls}
                />
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`${inputCls} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0A1F44]"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{ backgroundColor: BRAND }}
                className="w-full py-3 text-sm font-bold rounded-xl text-white hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader size="xs" showText={false} />
                    Authenticating...
                  </>
                ) : (
                  "Login to your account now"
                )}
              </button>

              <p className="text-center">
                <Link
                  to="/forgot-password"
                  className="text-xs font-semibold text-[#0A1F44] hover:underline"
                >
                  Forgot password?
                </Link>
              </p>
            </form>

            <div className="mt-6 pt-4 border-t border-gray-100 text-center">
              <p className="text-[10px] text-gray-400">
                © {new Date().getFullYear()} SmartPOS · Feeding Minds, Nourishing Futures
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
