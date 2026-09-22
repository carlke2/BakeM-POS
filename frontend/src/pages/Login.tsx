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

const BRAND = "#39B54A";

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
      <Loader size="sm" title="Loading Slow Rise Co..." subtitle="Checking your session" className="min-h-screen py-24" />
    );
  }

  const toAuthUser = (data: any): AuthUser => {
    const roleRaw = String(data.role || "").toLowerCase();
    const role: UserRole =
      roleRaw === "owner" || roleRaw === "admin"
        ? "owner"
        : "cashier";
    return {
      id: data.id || data._id,
      name: data.name,
      role,
      email: data.email,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const rawId = identifier.trim();
      const rawPass = password;

      const res = await API.post("/auth/login", {
        identifier: rawId,
        password: rawPass.trim(),
      });
      const data = res.data;

      if (!data?.role || !data?.token) {
        toast.error("Login failed", "Unexpected response from server");
        return;
      }

      const authUser = toAuthUser(data);
      login(authUser, data.token);
      void refreshSession();
      toast.success(`Welcome, ${data.name || "user"}!`);
      navigate(getDashboardPath(authUser.role));
    } catch (error: any) {
      toast.error("Login failed", error.response?.data?.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full px-3 py-3 bg-gray-100 border-2 border-transparent focus:border-[#39B54A]/30 focus:bg-white rounded-xl outline-none text-sm transition";

  return (
    <div className="min-h-screen bg-[#E8F6EC] p-4 font-sans relative overflow-y-auto">
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-[#39B54A]/10 blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] rounded-full bg-[#39B54A]/5 blur-[120px]" />
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
                alt="Slow Rise Co"
                className="w-40 h-auto object-contain mb-3"
              />
              <h2 className="text-xl font-bold text-[#39B54A]">Welcome to Slow Rise Co</h2>
              <p className="text-slate-500 text-xs mt-1 text-center">
                Staff login · Owner & cashier email and password
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3">
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="Email address"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className={inputCls}
                />
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`${inputCls} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#39B54A]"
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
                  "Sign in"
                )}
              </button>

              <p className="text-center">
                <Link
                  to="/forgot-password"
                  className="text-xs font-semibold text-[#39B54A] hover:underline"
                >
                  Forgot password?
                </Link>
              </p>
            </form>

            <div className="mt-6 pt-4 border-t border-gray-100 text-center">
              <p className="text-[10px] text-gray-400">
                © {new Date().getFullYear()} Slow Rise Co
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
