import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import shopApi from "@/shop/shopApi";

type Step = { status: string; label: string };
type Order = {
  id: string;
  status: string;
  fulfillmentType: string;
  receiptNo?: string | null;
  buildingName?: string | null;
  street?: string | null;
  area?: string | null;
  floor?: string | null;
  unit?: string | null;
  steps: Step[];
  items: Array<{ name: string; quantity: number; unitPrice: number; unitType: string }>;
};

const ShopTrackingPage = () => {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!id) return;
    shopApi.get(`/shop/orders/${id}`).then((response) => setOrder(response.data));
  }, [id]);

  if (!order) return <p>Loading your order…</p>;
  const current = order.steps.findIndex((step) => step.status === order.status);

  return (
    <div className="bg-white border border-[#E5C48D] rounded-xl p-6">
      <h1 className="text-3xl font-bold capitalize">{order.fulfillmentType}</h1>
      {order.status === "cancelled" ? (
        <p className="mt-4">This order was cancelled. The stock hold was released.</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {order.steps.map((step, index) => (
            <li key={step.status} className={index <= current ? "font-semibold text-[#B91D2D]" : "text-[#5C0101]/50"}>
              {index + 1}. {step.label}
            </li>
          ))}
        </ol>
      )}
      <ul className="mt-6 text-sm space-y-1">
        {order.items.map((item) => (
          <li key={item.name}>{item.name} × {item.quantity} {item.unitType} — KES {item.unitPrice}</li>
        ))}
      </ul>
      {order.fulfillmentType === "delivery" && (
        <p className="mt-4 text-sm">{[order.buildingName, order.street, order.area, order.floor, order.unit].filter(Boolean).join(", ")}</p>
      )}
      {order.receiptNo && (
        <Link to={`/shop/orders/${order.id}/receipt`} className="inline-block mt-6 text-[#B91D2D] underline">View receipt</Link>
      )}
    </div>
  );
};

export default ShopTrackingPage;
