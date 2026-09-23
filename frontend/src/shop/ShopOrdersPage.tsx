import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import shopApi from "@/shop/shopApi";
import { getShopCustomer } from "@/shop/shopSession";

type OrderRow = {
  id: string;
  status: string;
  fulfillmentType: string;
  receiptNo?: string | null;
  createdAt: string;
  items: Array<{ name: string; quantity: number }>;
};

const ShopOrdersPage = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    if (!getShopCustomer()) {
      navigate("/shop/login");
      return;
    }
    shopApi.get("/shop/orders").then((response) => setOrders(response.data));
  }, [navigate]);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Your orders</h1>
      <div className="space-y-3">
        {orders.map((order) => (
          <Link key={order.id} to={`/shop/orders/${order.id}`} className="block bg-white border border-[#E5C48D] rounded-xl p-4">
            <div className="flex justify-between">
              <span className="font-semibold capitalize">{order.fulfillmentType} · {order.status.replace(/_/g, " ")}</span>
              <span className="text-sm">{new Date(order.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm mt-1">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</p>
          </Link>
        ))}
        {orders.length === 0 && <p>No orders yet.</p>}
      </div>
    </div>
  );
};

export default ShopOrdersPage;
