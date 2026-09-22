import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { Loader2, Smartphone, Coins, ArrowLeft, ArrowUp, ArrowDown, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { initiateStkPushAndWait } from '@/services/kopokopoPayment';

const MySwal = withReactContent(Swal);

const PayWithKopokopo = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { studentId, studentName, regNo, currentBalance, purpose: routePurpose } = (location.state || {}) as {
    studentId?: string;
    studentName?: string;
    regNo?: string;
    currentBalance?: number;
    purpose?: 'wallet_topup' | 'general';
  };

  const isWalletTopUp = Boolean(studentId);
  const isParent = user?.role === 'parent';

  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ phone?: string; amount?: string }>({});
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success'>('idle');
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const validateInputs = (): boolean => {
    const errors: { phone?: string; amount?: string } = {};
    if (!/^(01|07)\d{8}$/.test(phone)) {
      errors.phone = 'Enter a valid 10-digit phone number (e.g. 0712345678)';
    }
    const n = Number(amount);
    if (isNaN(n) || n <= 0) {
      errors.amount = 'Enter a valid amount greater than 0';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const backPath = isWalletTopUp
    ? '/parent/topup'
    : user?.role === 'finance'
      ? '/finance'
      : user?.role === 'restaurant'
        ? '/pos'
        : user?.role === 'admin'
          ? '/'
          : '/parent-dashboard';

  useEffect(() => {
    if (isParent && !studentId) {
      MySwal.fire({
        title: 'Select a student',
        text: 'Choose which student wallet to top up first.',
        icon: 'info',
        confirmButtonText: 'Go to Top Up',
      }).then(() => navigate('/parent/topup'));
    }
  }, [studentId, isParent, navigate]);

  useEffect(() => {
    return () => {
      setAwaitingConfirmation(false);
    };
  }, []);

  const handlePaymentResult = (data: any, fallbackAmount: number, sourcePhone: string) => {
    const status: string = (data?.status || '').toLowerCase();

    // Only confirmed paid (backend maps to success after M-Pesa receipt / PIN)
    if (status === 'success') {
      const mpesaRef = String(data?.transactionReference || '').trim();
      if (!mpesaRef) {
        MySwal.fire({
          title: 'Still waiting for M-Pesa',
          text: 'Enter your M-Pesa PIN on the phone to complete the payment.',
          icon: 'info',
          confirmButtonText: 'OK',
        });
        return;
      }
      if (data?.walletCredited === false && data?.studentId) {
        MySwal.fire({
          title: 'Payment received',
          text: 'Your payment succeeded but the wallet is still updating. Refresh your dashboard in a moment.',
          icon: 'warning',
          confirmButtonText: 'OK',
        });
      }
      setLastReceipt({
        amount: data?.amount || fallbackAmount,
        currency: data?.currency || 'KES',
        reference: mpesaRef,
        phone: data?.phone || sourcePhone,
        originationTime: data?.originationTime || new Date().toISOString(),
      });
      setPaymentStatus('success');
      MySwal.fire({
        title: 'Payment Successful!',
        text: `KES ${data?.amount || fallbackAmount} received via M-Pesa.`,
        icon: 'success',
        timer: 2500,
        showConfirmButton: false,
      });
    } else if (status === 'failed' || status === 'error') {
      MySwal.fire({
        title: 'Payment Failed',
        text: 'The payment could not be completed. Please try again.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
    } else if (status === 'reversed') {
      MySwal.fire({
        title: 'Payment Reversed',
        text: 'The payment was reversed by M-Pesa.',
        icon: 'warning',
        confirmButtonText: 'OK',
      });
    } else {
      MySwal.fire({
        title: 'Payment Status Unknown',
        text: `Status: ${status || 'No response received'}`,
        icon: 'info',
        confirmButtonText: 'OK',
      });
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationErrors({});
    if (!validateInputs()) return;

    if (isParent && !studentId) return;

    setLoading(true);
    setAwaitingConfirmation(false);

    const numericAmount = Number(amount);
    const sourcePhone = phone;

    try {
      const result = await initiateStkPushAndWait(
        {
          phone,
          amount: numericAmount,
          description: isWalletTopUp
            ? studentName
              ? `Wallet top-up for ${studentName}`
              : 'SmartPOS Wallet Top-up'
            : 'SmartPOS Payment',
          studentId: studentId || undefined,
          purpose: isWalletTopUp ? 'wallet_topup' : routePurpose || 'general',
          useAuth: !isWalletTopUp,
        },
        () => {
          setAwaitingConfirmation(true);
          setLoading(false);
        },
      );

      setAwaitingConfirmation(false);
      handlePaymentResult(result, numericAmount, sourcePhone);
    } catch (err: any) {
      setLoading(false);
      setAwaitingConfirmation(false);
      const details = err?.response?.data?.details || err?.message || 'Unknown error';
      const message = err?.response?.data?.error || 'Payment initiation failed.';
      MySwal.fire({
        title: 'Payment Failed',
        html: `${message}<br/><small>${typeof details === 'string' ? details : JSON.stringify(details)}</small>`,
        icon: 'error',
        confirmButtonText: 'Try Again',
      });
    }
  };

  if (paymentStatus === 'success') {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-white min-h-screen flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-slate-100 p-8 text-center space-y-6">
          <div className="w-24 h-24 mx-auto bg-white rounded-full flex items-center justify-center border-2 border-emerald-500 shadow-[0_10px_30px_rgba(16,185,129,0.1)]">
            <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-extrabold text-slate-800 tracking-wide uppercase">Transfer Completed</h2>
            <p className="text-sm font-semibold text-emerald-500">Reference: {lastReceipt?.reference}</p>
          </div>

          <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-6 text-left space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Amount</span>
              <span className="text-2xl font-black text-emerald-600">
                {lastReceipt?.currency} {Number(lastReceipt?.amount).toLocaleString()}
              </span>
            </div>
            <div className="h-px bg-slate-200" />
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Phone</span>
              <span className="font-semibold text-slate-700">{lastReceipt?.phone}</span>
            </div>
            {studentName && (
              <>
                <div className="h-px bg-slate-200" />
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Student</span>
                  <span className="font-bold text-slate-800">{studentName} ({regNo})</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">New Balance</span>
                  <span className="font-bold text-emerald-600">
                    KES {((currentBalance || 0) + (lastReceipt?.amount || 0)).toLocaleString()}
                  </span>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => navigate(backPath)}
            className="w-full py-5 text-base font-extrabold text-white bg-[#15A84F] hover:bg-[#108c40] rounded-[1.5rem] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (loading || awaitingConfirmation) {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-white min-h-screen flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-slate-100 p-8 text-center space-y-6">
          <div className="relative w-24 h-24 mx-auto bg-white rounded-full flex items-center justify-center border-2 border-emerald-500/10">
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 border-r-emerald-500 animate-spin" />
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-extrabold text-slate-800 tracking-wide uppercase">
              {loading ? 'Initiating Payment' : 'Transfer In Progress'}
            </h2>
            <p className="text-sm font-semibold text-emerald-500 animate-pulse">
              {loading ? 'Contacting Kopokopo...' : 'Awaiting M-Pesa PIN on your phone...'}
            </p>
          </div>

          <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-4 text-left space-y-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <ArrowUp className="w-3.5 h-3.5" /> From
            </span>
            <p className="font-bold text-slate-700">{phone}</p>
            <p className="text-xs text-slate-400">Safaricom M-Pesa via Kopokopo</p>
          </div>

          <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-4 text-left space-y-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <ArrowDown className="w-3.5 h-3.5" /> To
            </span>
            <p className="font-extrabold text-slate-800">KES {Number(amount).toFixed(2)}</p>
            <p className="text-xs text-slate-400">
              {studentName ? `${studentName} (${regNo})` : 'School Feeding Wallet'}
            </p>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <span>Check your phone for the STK prompt</span>
            <Info className="w-4 h-4 text-slate-300" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-tr from-slate-50 via-white to-green-50/10 min-h-screen flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-slate-100/80 p-10 relative">
        <button
          onClick={() => navigate(backPath)}
          className="absolute top-8 left-8 text-slate-400 hover:text-slate-700 transition-colors z-10"
        >
          <ArrowLeft className="w-6 h-6 stroke-[2]" />
        </button>

        <div className="text-center mb-6 mt-6">
          <h1 className="text-3xl font-extrabold text-[#0D233A] tracking-tight mb-2">
            {isWalletTopUp ? 'Pay with Kopokopo' : 'M-Pesa STK Payment'}
          </h1>
          <p className="text-slate-400 font-medium text-sm">
            {isWalletTopUp
              ? 'Secure M-Pesa payment via STK Push'
              : 'Collect payment from staff or visitors via STK Push'}
          </p>
        </div>

        {studentName && (
          <div className="mb-6 p-4 bg-slate-50 border border-slate-100/60 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 font-semibold uppercase block tracking-wider mb-0.5">Top-up Wallet For</span>
              <span className="font-extrabold text-slate-700 text-sm">{studentName}</span>
              <span className="text-slate-400 block mt-0.5">{regNo}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 font-semibold uppercase block tracking-wider mb-0.5">Current Balance</span>
              <span className="font-extrabold text-emerald-600 text-sm">KES {Number(currentBalance).toLocaleString()}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="kopo-phone" className="block text-[10px] font-extrabold text-slate-400 tracking-wider pl-1 uppercase">
              Phone Number
            </label>
            <div className="relative flex items-center bg-slate-50/50 border border-slate-100 rounded-2xl px-4 py-4 focus-within:border-emerald-500 focus-within:bg-white transition-all">
              <Smartphone className="w-5 h-5 text-slate-300 mr-3" />
              <input
                id="kopo-phone"
                type="tel"
                placeholder="0712345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-slate-700 text-lg font-medium placeholder-slate-300"
              />
            </div>
            {validationErrors.phone && <p className="text-xs font-bold text-red-500 pl-1">{validationErrors.phone}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="kopo-amount" className="block text-[10px] font-extrabold text-slate-400 tracking-wider pl-1 uppercase">
              Amount (KES)
            </label>
            <div className="relative flex items-center bg-slate-50/50 border border-slate-100 rounded-2xl px-4 py-4 focus-within:border-emerald-500 focus-within:bg-white transition-all">
              <Coins className="w-5 h-5 text-slate-300 mr-3" />
              <input
                id="kopo-amount"
                type="number"
                placeholder="0.00"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-slate-700 text-lg font-medium placeholder-slate-300"
              />
            </div>
            {validationErrors.amount && <p className="text-xs font-bold text-red-500 pl-1">{validationErrors.amount}</p>}
          </div>

          <div className="pt-6">
            <button
              type="submit"
              className="w-full py-5 text-base font-extrabold text-white bg-[#15A84F] hover:bg-[#108c40] active:scale-[0.98] rounded-[1.5rem] transition-all shadow-lg shadow-emerald-100/50"
            >
              Pay KES {amount || '0'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PayWithKopokopo;
