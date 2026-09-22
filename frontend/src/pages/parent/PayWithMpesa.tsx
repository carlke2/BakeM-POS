import { useState, useRef, useEffect, FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { Smartphone, Coins, ArrowLeft, Info, ArrowUp, ArrowDown } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const PayWithMpesa = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { studentId, studentName, regNo, currentBalance } = (location.state || {}) as {
    studentId?: string;
    studentName?: string;
    regNo?: string;
    currentBalance?: number;
  };
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ phone?: string; amount?: string }>({});
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success'>('idle');
  const [lastReceipt, setLastReceipt] = useState<any>(null);

  const API_URL = import.meta.env.VITE_API_URL;
  const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || '').toString();
  const socketRef = useRef<Socket | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const hardTimeoutRef = useRef<number | null>(null);
  const MySwal = withReactContent(Swal);

  const validateInputs = (): boolean => {
    const errors: { phone?: string; amount?: string } = {};

    if (!/^(01|07)\d{8}$/.test(phone)) {
      errors.phone = 'Enter valid 10-digit phone number (e.g. 0712345678)';
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      errors.amount = 'Enter a valid amount greater than 0';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const connectSocket = () => {
    if (socketRef.current && socketRef.current.connected) return socketRef.current;
    
    let derivedUrl = SOCKET_URL;
    if (!derivedUrl) {
      if (API_URL && !API_URL.startsWith('/')) {
        derivedUrl = API_URL.replace(/\/?api\/?$/, '');
      } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        derivedUrl = 'http://localhost:5000';
      } else {
        derivedUrl = window.location.origin;
      }
    }
    
    console.log('Connecting socket to:', derivedUrl);
    socketRef.current = io(derivedUrl, { transports: ['websocket'] });
    return socketRef.current;
  };

  const clearTimers = () => {
    if (pendingTimerRef.current) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (hardTimeoutRef.current) {
      window.clearTimeout(hardTimeoutRef.current);
      hardTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimers();
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationErrors({});
    if (!validateInputs()) return;

    setLoading(true);

    try {
      const formattedPhone = '254' + phone.slice(-9);
      const numericAmount = Number(amount);

      const response = await axios.post(`${API_URL}/stkpush`, {
        phone: formattedPhone,
        amount: numericAmount,
        studentId: studentId || null
      });

      console.log('STK Push Response:', response.data);
      const { CheckoutRequestID } = response.data || {};

      if (CheckoutRequestID) {
        const socket = connectSocket();

        socket.off('transaction_update');
        socket.emit('join_checkout', { checkoutRequestId: CheckoutRequestID });

        // Soft pending notice after 45s
        pendingTimerRef.current = window.setTimeout(() => {
          MySwal.fire({
            title: 'Still Pending…',
            text: 'If you have not received the prompt, ensure your SIM is active and try again.',
            icon: 'info',
            confirmButtonText: 'OK'
          });
        }, 45000);

        // Hard fallback after 3 minutes
        hardTimeoutRef.current = window.setTimeout(() => {
          setLoading(false);
          MySwal.fire({
            title: 'Payment Timeout',
            text: 'We did not receive a response in time. Please try again.',
            icon: 'warning',
            confirmButtonText: 'OK'
          });
        }, 180000);

        socket.on('transaction_update', (payload: any) => {
          clearTimers();
          setLoading(false);
          const status: string = payload?.status || 'failure';
          const desc: string = payload?.resultDesc || 'Payment update received.';

          if (status === 'success') {
            setLastReceipt({
              amount: payload?.amount || numericAmount,
              receipt: payload?.receipt || 'N/A',
              phone: payload?.phone || phone
            });
            setPaymentStatus('success');
          } else {
            MySwal.fire({
              title: `Payment ${status.toUpperCase()}`,
              text: desc,
              icon: status === 'cancelled' ? 'info' : 'error',
              confirmButtonText: 'OK'
            });
          }
        });
      }

    } catch (err: any) {
      console.error('STK Push Error:', err);
      const backendError = err?.response?.data;
      const details = typeof backendError?.details === 'string'
        ? backendError?.details
        : backendError?.details
          ? JSON.stringify(backendError?.details)
          : err?.message;
      const errorMessage = backendError?.error || 'Payment initiation failed.';

      MySwal.fire({
        title: 'Payment Failed',
        html: `${errorMessage}${details ? `<br/><small className="text-xs text-red-400">${details}</small>` : ''}`,
        icon: 'error',
        confirmButtonText: 'Try Again'
      });
      setLoading(false);
    }
  };

  // SUCCESS STATUS PAGE
  if (paymentStatus === 'success') {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-white min-h-screen flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-slate-100 p-8 text-center space-y-6">
          
          {/* Green checkmark circle */}
          <div className="w-24 h-24 mx-auto bg-white rounded-full flex items-center justify-center border-2 border-emerald-500 shadow-[0_10px_30px_rgba(16,185,129,0.1)]">
            <svg className="w-10 h-10 text-emerald-500 font-bold" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-extrabold text-slate-800 tracking-wide uppercase">Transfer Completed</h2>
            <p className="text-sm font-semibold text-emerald-500">Transaction ID: {lastReceipt?.receipt}</p>
          </div>

          {/* Receipt detail region card */}
          <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-6 text-left space-y-4">
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-slate-400">Receipt No</span>
              <span className="font-extrabold text-slate-800 font-mono tracking-tight">{lastReceipt?.receipt}</span>
            </div>
            
            <div className="h-px bg-slate-200/60 w-full" />
            
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-slate-400">Amount Paid</span>
              <span className="text-xl font-extrabold text-emerald-600">KES {lastReceipt?.amount}</span>
            </div>
            
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-slate-400">Source Phone</span>
              <span className="font-extrabold text-slate-800">{lastReceipt?.phone}</span>
            </div>
            
            {studentName && (
              <>
                <div className="h-px bg-slate-200/60 w-full" />
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-slate-400">Recipient Student</span>
                  <span className="font-extrabold text-slate-800">{studentName} ({regNo})</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-slate-400">New Wallet Balance</span>
                  <span className="font-extrabold text-emerald-600">KES {((currentBalance || 0) + (lastReceipt?.amount || 0)).toLocaleString()}</span>
                </div>
              </>
            )}
          </div>

          {/* Back button */}
          <div className="pt-2">
            <button
              onClick={() => {
                setPhone('');
                setAmount('');
                setPaymentStatus('idle');
                navigate('/parent-dashboard');
              }}
              className="w-full py-5 px-4 text-base font-extrabold text-white bg-[#15A84F] hover:bg-[#108c40] active:scale-[0.98] rounded-[1.5rem] transition-all duration-300 shadow-lg shadow-emerald-100/50"
            >
              Back to Dashboard
            </button>
          </div>

        </div>
      </div>
    );
  }

  // LOADING / PROCESSING PAGE (Matches the user's mockup design)
  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-white min-h-screen flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-slate-100 p-8 text-center space-y-6">
          
          {/* Animated arrows circle */}
          <div className="relative w-24 h-24 mx-auto bg-white rounded-full flex items-center justify-center border-2 border-emerald-500/10 shadow-[0_10px_35px_rgba(16,185,129,0.08)]">
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 border-r-emerald-500 animate-spin" />
            <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-extrabold text-slate-800 tracking-wide uppercase">Transfer In Progress</h2>
            <p className="text-sm font-semibold text-emerald-500 animate-pulse">Processing Transaction...</p>
          </div>

          {/* From Card */}
          <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-4 text-left flex flex-col space-y-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <ArrowUp className="w-3.5 h-3.5 text-slate-400" /> From
            </span>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center font-bold text-emerald-600">
                M
              </div>
              <div>
                <p className="font-bold text-slate-700">{phone}</p>
                <p className="text-xs text-slate-400 font-medium">Safaricom M-Pesa Account</p>
              </div>
            </div>
          </div>

          {/* To Card */}
          <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-4 text-left flex flex-col space-y-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <ArrowDown className="w-3.5 h-3.5 text-slate-400" /> To
            </span>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center font-bold text-[#0A1F44]">
                K
              </div>
              <div>
                <p className="font-extrabold text-slate-800">KES {Number(amount).toFixed(2)}</p>
                <p className="text-xs text-slate-400 font-medium">
                  {studentName ? `${studentName} (${regNo})` : 'School Feeding Wallet'}
                </p>
              </div>
            </div>
          </div>

          {/* Status footer info */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 pt-2">
            <span>Awaiting SIM prompt PIN confirmation...</span>
            <Info className="w-4 h-4 text-slate-300" />
          </div>

        </div>
      </div>
    );
  }

  // IDLE INPUT FORM (Matches the user's mockup design)
  return (
    <div className="bg-gradient-to-tr from-slate-50 via-white to-green-50/10 min-h-screen flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-slate-100/80 p-10 relative">
        
        {/* Back arrow */}
        <button
          onClick={() => navigate('/parent-dashboard')}
          className="absolute top-8 left-8 text-slate-400 hover:text-slate-700 transition-colors z-10"
        >
          <ArrowLeft className="w-6 h-6 stroke-[2]" />
        </button>

        <div className="text-center mb-6 mt-6">
          <h1 className="text-3xl font-extrabold text-[#0D233A] tracking-tight mb-2">Pay with M-Pesa</h1>
          <p className="text-slate-400 font-medium text-sm">Secure payment via STK Push</p>
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
          {/* Phone Field */}
          <div className="space-y-2">
            <label htmlFor="phone" className="block text-[10px] font-extrabold text-slate-400 tracking-wider pl-1 uppercase">
              Phone Number
            </label>
            <div className="relative flex items-center bg-slate-50/50 border border-slate-100 hover:border-slate-200 focus-within:border-emerald-500 focus-within:bg-white rounded-2xl transition-all duration-300 px-4 py-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
              <Smartphone className="w-5 h-5 text-slate-300 stroke-[1.5] mr-3" />
              <input
                id="phone"
                type="tel"
                placeholder="0712345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-slate-700 text-lg font-medium placeholder-slate-300 p-0 focus:ring-0"
              />
            </div>
            {validationErrors.phone && <p className="mt-1 text-xs font-bold text-red-500 pl-1">{validationErrors.phone}</p>}
          </div>

          {/* Amount Field */}
          <div className="space-y-2">
            <label htmlFor="amount" className="block text-[10px] font-extrabold text-slate-400 tracking-wider pl-1 uppercase">
              Amount (KES)
            </label>
            <div className="relative flex items-center bg-slate-50/50 border border-slate-100 hover:border-slate-200 focus-within:border-emerald-500 focus-within:bg-white rounded-2xl transition-all duration-300 px-4 py-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
              <Coins className="w-5 h-5 text-slate-300 stroke-[1.5] mr-3" />
              <input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-slate-700 text-lg font-medium placeholder-slate-300 p-0 focus:ring-0"
              />
            </div>
            {validationErrors.amount && <p className="mt-1 text-xs font-bold text-red-500 pl-1">{validationErrors.amount}</p>}
          </div>

          {/* Button */}
          <div className="pt-6">
            <button
              type="submit"
              className="w-full py-5 px-4 text-base font-extrabold text-white bg-[#15A84F] hover:bg-[#108c40] active:scale-[0.98] rounded-[1.5rem] transition-all duration-300 shadow-lg shadow-emerald-100/50"
            >
              Pay KES {amount || '0'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PayWithMpesa;
