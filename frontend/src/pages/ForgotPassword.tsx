import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import logo from "@/assets/LOGO.png";

type ResetRole = "student" | "parent";
type Step = "email" | "code" | "password" | "done";

const BRAND = "#0A1F44";
const inputCls =
  "w-full px-3 py-3 bg-gray-100 border-2 border-transparent focus:border-[#0A1F44]/30 focus:bg-white rounded-xl outline-none text-sm transition";

function maskEmail(email: string): string {
  const [local, domain] = email.trim().split("@");
  if (!local || !domain) return email;
  if (local.length <= 4) {
    const stars = "*".repeat(Math.max(local.length - 1, 1));
    return `${local[0] ?? ""}${stars}@${domain}`;
  }
  const hidden = "*".repeat(local.length - 4);
  return `${local.slice(0, 2)}${hidden}${local.slice(-2)}@${domain}`;
}

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialRole = (searchParams.get("role") as ResetRole) || "parent";

  const [step, setStep] = useState<Step>("email");
  const [role, setRole] = useState<ResetRole>(initialRole === "student" ? "student" : "parent");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      await API.post("/auth/forgot-password/request", { email: email.trim(), role });
      toast.success("Check your email", "We sent a 6-digit code if an account exists");
      setStep("code");
    } catch (err: any) {
      toast.error("Could not send code", err.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (digits: string) => {
    if (verifyingRef.current || digits.length !== 6) return;

    verifyingRef.current = true;
    setVerifying(true);
    try {
      await API.post("/auth/forgot-password/verify", {
        email: email.trim(),
        role,
        code: digits,
      });
      toast.success("Code verified", "Choose your new password");
      setStep("password");
    } catch (err: any) {
      toast.error("Invalid code", err.response?.data?.message);
      setCode("");
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  const handleCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) {
      void verifyCode(digits);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 7) {
      return toast.error("Validation", "Password must be at least 7 characters");
    }
    if (newPassword !== confirmPassword) {
      return toast.error("Validation", "Passwords do not match");
    }

    setLoading(true);
    try {
      await API.post("/auth/forgot-password/reset", {
        email: email.trim(),
        role,
        code: code.trim(),
        newPassword,
        confirmPassword,
      });
      setStep("done");
      toast.success("Password updated", "You can log in with your new password");
    } catch (err: any) {
      toast.error("Reset failed", err.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E8F4FD] p-4 font-sans flex items-center justify-center">
      <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-xl p-6 md:p-8 border border-gray-100">
        <div className="flex flex-col items-center mb-6 text-center">
          <img src={logo} alt="SmartPOS" className="w-20 h-auto mb-3" draggable={false} />
          <h1 className="text-xl font-bold text-[#0A1F44] flex items-center gap-2">
            <KeyRound size={20} /> Forgot Password
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {step === "email" && "We'll email you a 6-digit code (expires in 5 minutes)"}
            {step === "code" && "Enter the code we sent to your email"}
            {step === "password" && "Choose a new password"}
            {step === "done" && "Your password has been reset"}
          </p>
        </div>

        {step === "email" && (
          <form onSubmit={requestCode} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-[#0A1F44] ml-1 mb-1 block">Choose account type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["parent", "student"] as ResetRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`py-2.5 rounded-xl text-sm font-semibold border transition ${
                      role === r
                        ? "bg-[#0A1F44] text-white border-[#0A1F44]"
                        : "bg-gray-50 text-gray-600 border-gray-200"
                    }`}
                  >
                    {r === "parent" ? "Parent" : "Student"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-[#0A1F44] ml-1 mb-1 block">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`${inputCls} pl-9`}
                />
              </div>
              {role === "student" && (
                <p className="text-[10px] text-gray-400 mt-1 ml-1">
                  Use the email address saved on your student record.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: BRAND }}
              className="w-full py-3 text-sm font-bold rounded-xl text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send reset code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500 text-center">
              Code sent to <strong>{maskEmail(email)}</strong>
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              disabled={verifying}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="6-digit code"
              className={`${inputCls} text-center text-2xl tracking-[0.4em] font-bold disabled:opacity-60`}
            />
            {verifying && (
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <Loader size="xs" showText={false} />
                Verifying code...
              </div>
            )}
            <button
              type="button"
              disabled={loading || verifying}
              onClick={() => {
                verifyingRef.current = false;
                setVerifying(false);
                setCode("");
                void requestCode();
              }}
              className="w-full text-xs text-gray-500 hover:text-[#0A1F44] disabled:opacity-50"
            >
              {loading ? "Sending..." : "Resend code"}
            </button>
          </div>
        )}

        {step === "password" && (
          <form onSubmit={resetPassword} className="space-y-4">
            <input
              type="password"
              required
              minLength={7}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className={inputCls}
              autoComplete="new-password"
            />
            <input
              type="password"
              required
              minLength={7}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className={inputCls}
              autoComplete="new-password"
            />
            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: BRAND }}
              className="w-full py-3 text-sm font-bold rounded-xl text-white hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader size="xs" showText={false} /> : <ShieldCheck size={16} />}
              {loading ? "Saving..." : "Reset password"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-600">You can now sign in with your new password.</p>
            <button
              type="button"
              onClick={() => navigate(`/login?role=${role}`)}
              style={{ backgroundColor: BRAND }}
              className="w-full py-3 text-sm font-bold rounded-xl text-white hover:opacity-90"
            >
              Go to login
            </button>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-100 text-center">
          <Link to="/login" className="text-xs text-[#0A1F44] font-semibold inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={14} /> Back to login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
