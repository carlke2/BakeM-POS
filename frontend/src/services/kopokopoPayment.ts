import API from "@/services/api";
import { io, Socket } from "socket.io-client";

export type StkPurpose = "wallet_topup" | "pos_sale" | "general";

export type StkPushOptions = {
  phone: string;
  amount: number;
  description?: string;
  studentId?: string;
  purpose?: StkPurpose;
  items?: { menuItemId: string; quantity: number }[];
  useAuth?: boolean;
  kiosk?: boolean;
};

export type StkPaymentResult = {
  status: string;
  amount?: number;
  currency?: string;
  reference?: string;
  transactionReference?: string;
  phone?: string;
  location?: string;
  paymentId?: string;
  walletCredited?: boolean;
  posCompleted?: boolean;
  posReceiptNo?: string;
  posTransactionId?: string;
  purpose?: string;
};

function resolveSocketUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  const socketUrl = (import.meta.env.VITE_SOCKET_URL || "").toString();
  if (socketUrl) return socketUrl;
  if (apiUrl && !apiUrl.startsWith("/")) return apiUrl.replace(/\/?api\/?$/, "");
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:5000";
  }
  return window.location.origin;
}

function normalizeLocation(url?: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

/** Only real end-states. Do not treat arbitrary non-pending strings as done. */
function isTerminalStatus(status?: string) {
  const s = (status || "").toLowerCase();
  return s === "success" || s === "failed" || s === "error" || s === "reversed" || s === "cancelled";
}

function matchesPayment(
  data: StkPaymentResult | undefined,
  paymentLocation: string,
  paymentId?: string,
) {
  if (!data) return false;
  if (paymentId && data.paymentId && data.paymentId === paymentId) return true;
  const eventLoc = normalizeLocation(data.location);
  const waitLoc = normalizeLocation(paymentLocation);
  if (eventLoc && waitLoc && eventLoc === waitLoc) return true;
  return false;
}

export async function initiateStkPushAndWait(
  opts: StkPushOptions,
  onAwaiting?: () => void,
): Promise<StkPaymentResult> {
  const payload: Record<string, unknown> = {
    phone: opts.phone,
    amount: opts.amount,
    description: opts.description,
  };
  if (opts.studentId) payload.studentId = opts.studentId;
  if (opts.purpose) payload.purpose = opts.purpose;
  if (opts.items) payload.items = opts.items;
  if (opts.kiosk) payload.kiosk = true;

  const requestConfig =
    opts.useAuth === false ? { skipAuthRedirect: true as const } : undefined;

  let pushData: { location?: string; resumed?: boolean; paymentId?: string };
  try {
    ({ data: pushData } = await API.post("/kopokopo/stkpush", payload, {
      ...requestConfig,
      timeout: 35_000,
    }));
  } catch (err: any) {
    const data = err?.response?.data;
    if (err?.response?.status === 409 && data?.code === "PENDING_STK" && data?.location) {
      pushData = {
        location: data.location,
        paymentId: data.paymentId,
        resumed: true,
      };
    } else {
      const msg =
        data?.error ||
        data?.error_message ||
        data?.message ||
        err?.message ||
        "Could not start M-Pesa payment";
      throw new Error(msg);
    }
  }

  const paymentLocation = pushData?.location as string | undefined;
  if (!paymentLocation) throw new Error("No payment location returned");
  const paymentId = pushData?.paymentId;

  onAwaiting?.();

  return new Promise((resolve, reject) => {
    const socket: Socket = io(resolveSocketUrl(), {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 4,
      timeout: 8_000,
    });
    let settled = false;
    let pollInFlight = false;

    const finish = (result: StkPaymentResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      window.clearTimeout(hardTimeout);
      window.clearInterval(pollInterval);
      socket.off("kopokopo_update");
      socket.disconnect();
    };

    const pollOnce = async () => {
      if (settled || pollInFlight) return;
      pollInFlight = true;
      try {
        const { data } = await API.get<StkPaymentResult>("/kopokopo/status", {
          params: { location: paymentLocation },
          ...requestConfig,
          timeout: 15_000,
        });
        if (isTerminalStatus(data?.status)) finish(data);
      } catch {
        /* ignore transient poll errors */
      } finally {
        pollInFlight = false;
      }
    };

    socket.emit("join_kopokopo", { location: paymentLocation });
    socket.on("kopokopo_update", (data: StkPaymentResult) => {
      // Ignore other customers' till/STK events (backend also broadcasts globally)
      if (!matchesPayment(data, paymentLocation, paymentId)) return;
      if (!isTerminalStatus(data?.status)) return;
      // Success without M-Pesa receipt = premature (before PIN)
      if (
        (data.status || "").toLowerCase() === "success" &&
        !String(data.transactionReference || "").trim()
      ) {
        return;
      }
      finish(data);
    });

    // Poll immediately, then every 2s
    void pollOnce();
    const pollInterval = window.setInterval(() => {
      void pollOnce();
    }, 2_000);

    const hardTimeout = window.setTimeout(() => {
      fail(new Error("Payment timed out. Check your M-Pesa messages and try again."));
    }, 120_000);
  });
}
