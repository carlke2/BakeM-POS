import { useEffect, useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";

type Rider = { id: string; name: string; phone?: string | null };
type ShopOrder = {
  id: string;
  status: string;
  fulfillmentType: string;
  deliveryUserId?: string | null;
  buildingName?: string | null;
  street?: string | null;
  area?: string | null;
  floor?: string | null;
  unit?: string | null;
  customer: { name: string; phone: string };
  items: Array<{ name: string; quantity: number }>;
};

const ShopOrdersAdminPage = () => {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);

  const load = () => {
    API.get("/shop/manage").then((response) => {
      setOrders(response.data.orders);
      setRiders(response.data.riders);
    }).catch(() => toast.error("Could not load shop orders"));
  };

  useEffect(() => { load(); }, []);

  const assign = async (orderId: string, deliveryUserId: string) => {
    await API.patch(`/shop/manage/${orderId}/assign`, { deliveryUserId: deliveryUserId || null });
    load();
  };

  const advancePickup = async (order: ShopOrder) => {
    const next = order.status === "confirmed" ? "ready_for_pickup" : "picked_up";
    await API.patch(`/shop/manage/${order.id}/status`, { status: next });
    load();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-[#5C0101] mb-4">Shop orders</h1>
      <div className="space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="bg-white border border-[#E5C48D] rounded-xl p-4">
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-semibold">{order.customer.name} · {order.customer.phone}</p>
                <p className="text-sm capitalize">{order.fulfillmentType} · {order.status.replace(/_/g, " ")}</p>
                <p className="text-sm">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</p>
                {order.fulfillmentType === "delivery" && (
                  <p className="text-sm mt-1">{[order.buildingName, order.street, order.area, order.floor, order.unit].filter(Boolean).join(", ")}</p>
                )}
              </div>
              {order.fulfillmentType === "delivery" && ["confirmed", "out_for_delivery"].includes(order.status) && (
                <select
                  className="border border-[#E5C48D] rounded-lg px-2 py-1 h-fit"
                  value={order.deliveryUserId || ""}
                  onChange={(event) => assign(order.id, event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {riders.map((rider) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}
                </select>
              )}
              {order.fulfillmentType === "pickup" && ["confirmed", "ready_for_pickup"].includes(order.status) && (
                <button className="bg-[#B91D2D] text-white rounded-lg px-3 py-2 h-fit" onClick={() => advancePickup(order)}>
                  {order.status === "confirmed" ? "Mark ready" : "Mark picked up"}
                </button>
              )}
            </div>
          </div>
        ))}
        {orders.length === 0 && <p>No shop orders yet.</p>}
      </div>
    </div>
  );
};

export default ShopOrdersAdminPage;
