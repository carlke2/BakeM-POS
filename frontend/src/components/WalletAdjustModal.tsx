import { useState } from "react";
import { Wallet, X } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import StudentPicker, { type StudentOption } from "@/components/StudentPicker";

type WalletDirection = "credit" | "debit";

const formatKes = (n: number) => `KES ${Number(n || 0).toLocaleString()}`;

const WalletAdjustModal = ({
  onClose,
  onSuccess,
  initialStudent,
  title = "Update student wallet",
  subtitle = "Credit or debit a student wallet",
}: {
  onClose: () => void;
  onSuccess?: () => void;
  initialStudent?: StudentOption | null;
  title?: string;
  subtitle?: string;
}) => {
  const [student, setStudent] = useState<StudentOption | null>(initialStudent ?? null);
  const [direction, setDirection] = useState<WalletDirection>("credit");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const adjustAmount = Number(amount);
    if (!student) {
      toast.warning("Select a student", "Search and pick the student first");
      return;
    }
    if (!Number.isFinite(adjustAmount) || adjustAmount <= 0) {
      toast.warning("Invalid amount", "Enter a positive amount");
      return;
    }

    const confirmLabel = direction === "credit" ? "Credit wallet" : "Debit wallet";
    const confirmed = await toast.confirm(
      `${direction === "credit" ? "Credit" : "Debit"} ${formatKes(adjustAmount)} ${direction === "credit" ? "to" : "from"} ${student.name}?`,
      { confirmLabel },
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const { data } = await API.post("/wallet/adjust", {
        studentId: student.id,
        amount: adjustAmount,
        direction,
        reference: reference.trim() || undefined,
        description:
          description.trim() ||
          (direction === "credit" ? "Manual wallet credit" : "Manual wallet debit"),
      });

      toast.success(
        direction === "credit" ? "Wallet credited" : "Wallet debited",
        `New balance: ${formatKes(data.newBalance)}`,
      );
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Wallet update failed";
      toast.error("Could not update wallet", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#0A1F44] flex items-center gap-2">
              <Wallet size={18} /> {title}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!initialStudent && (
            <StudentPicker selected={student} onSelect={setStudent} onClear={() => setStudent(null)} />
          )}

          {initialStudent && student && (
            <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm">
              <p className="font-semibold text-[#0A1F44]">{student.name}</p>
              <p className="text-xs text-gray-600 mt-0.5">
                {student.regNo}
                {student.walletBalance != null && ` · Balance: ${formatKes(student.walletBalance)}`}
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-600">Action</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection("credit")}
                className={`py-2.5 rounded-xl text-sm font-semibold border transition ${
                  direction === "credit"
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                Credit (+)
              </button>
              <button
                type="button"
                onClick={() => setDirection("debit")}
                className={`py-2.5 rounded-xl text-sm font-semibold border transition ${
                  direction === "debit"
                    ? "bg-rose-600 text-white border-rose-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                Debit (-)
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Amount (KES)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1000"
              className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Reference (optional)</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt or note"
              className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={direction === "credit" ? "Cash top-up at till" : "Balance correction"}
              className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!student || submitting}
              className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 ${
                direction === "credit"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-rose-600 hover:bg-rose-700"
              }`}
            >
              {submitting
                ? "Updating..."
                : direction === "credit"
                  ? "Credit wallet"
                  : "Debit wallet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalletAdjustModal;
