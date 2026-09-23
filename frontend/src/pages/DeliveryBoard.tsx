import { useEffect, useState } from "react";
import API from "@/services/api";
import { useAuth } from "@/context/AuthContext";

type DeliveryOrder = {
  id: string;
  status: string;
  buildingName?: string | null;
  street?: string | null;
  area?: string | null;
  floor?: string | null;
  unit?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  customer: { name: string; phone: string };
  items: Array<{ name: string; quantity: number }>;
};

const DeliveryBoard = () => {
  const { logout, user } = useAuth();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);

  const load = () => {
    API.get("/shop/delivery").then((response) => setOrders(response.data));
  };

  useEffect(() => { load(); }, []);

  const advance = async (order: DeliveryOrder) => {
    const status = order.status === "confirmed" ? "out_for_delivery" : "delivered";
    await API.patch(`/shop/delivery/${order.id}/status`, { status });
    load();
  };

  return (
    <div className="min-h-screen bg-[#FBF4D0] text-[#5C0101]">
      <header className="bg-[#5C0101] text-[#FBF4D0] px-4 py-4 flex justify-between">
        <p className="font-semibold">Deliveries · {user?.name}</p>
        <button onClick={logout}>Sign out</button>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-3">
        {orders.map((order) => (
          <article key={order.id} className="bg-white border border-[#E5C48D] rounded-xl p-4">
            <p className="font-semibold">{order.customer.name} · {order.customer.phone}</p>
            <p className="text-sm capitalize">{order.status.replace(/_/g, " ")}</p>
            <p className="text-sm mt-1">{[order.buildingName, order.street, order.area, order.floor, order.unit].filter(Boolean).join(", ")}</p>
            {order.latitude != null && order.longitude != null && (
              <a className="text-sm text-[#B91D2D] underline" href={`https://www.google.com/maps?q=${order.latitude},${order.longitude}`} target="_blank" rel="noreferrer">
                Open coordinates
              </a>
            )}
            <p className="text-sm mt-1">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</p>
            {["confirmed", "out_for_delivery"].includes(order.status) && (
              <button className="mt-3 bg-[#B91D2D] text-white rounded-lg px-3 py-2" onClick={() => advance(order)}>
                {order.status === "confirmed" ? "Out for delivery" : "Delivered"}
              </button>
            )}
          </article>
        ))}
        {orders.length === 0 && <p>No deliveries are assigned to you.</p>}
      </main>
    </div>
  );
};

export default DeliveryBoard;
