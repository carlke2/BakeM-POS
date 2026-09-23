import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import shopApi from "@/shop/shopApi";
import { readCart, writeCart, type CartLine } from "@/shop/cart";

type AvailabilityLine = {
  menuItemId: string;
  status: "available" | "partial" | "unavailable";
  maxQuantity: number | null;
};

const ShopCartPage = () => {
  const [lines, setLines] = useState<CartLine[]>(readCart());
  const [availability, setAvailability] = useState<AvailabilityLine[]>([]);

  useEffect(() => {
    if (lines.length === 0) {
      setAvailability([]);
      return;
    }
    shopApi.post("/availability", {
      items: lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
    }).then((response) => setAvailability(response.data.lines || []))
      .catch((error) => setAvailability(error.response?.data?.availability?.lines || []));
  }, [lines]);

  const update = (menuItemId: string, quantity: number) => {
    const next = lines
      .map((line) => (line.menuItemId === menuItemId ? { ...line, quantity } : line))
      .filter((line) => line.quantity > 0);
    setLines(next);
    writeCart(next);
  };

  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const ready = lines.length > 0 && availability.length === lines.length && availability.every((line) => line.status === "available");

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Cart</h1>
      {lines.length === 0 && <p>Your cart is empty. <Link className="text-[#B91D2D]" to="/shop">Browse the menu</Link>.</p>}
      <div className="space-y-4">
        {lines.map((line) => {
          const stock = availability.find((entry) => entry.menuItemId === line.menuItemId);
          return (
            <div key={line.menuItemId} className="bg-white border border-[#E5C48D] rounded-xl p-4">
              <div className="flex justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{line.name}</h2>
                  <p className="text-sm">KES {line.price} / {line.unitType}</p>
                </div>
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(event) => update(line.menuItemId, Math.max(1, Number(event.target.value) || 1))}
                  className="w-24 border border-[#E5C48D] rounded-lg px-3 py-2"
                />
              </div>
              {stock?.status === "partial" && (
                <p className="text-sm mt-2">
                  Only {stock.maxQuantity} {line.unitType} can be reserved.
                  {stock.maxQuantity != null && stock.maxQuantity > 0 && (
                    <button className="ml-2 underline text-[#B91D2D]" onClick={() => update(line.menuItemId, stock.maxQuantity || 1)}>
                      Adjust this line
                    </button>
                  )}
                </p>
              )}
              {stock?.status === "unavailable" && (
                <p className="text-sm mt-2">
                  This line is no longer available.
                  <button className="ml-2 underline text-[#B91D2D]" onClick={() => update(line.menuItemId, 0)}>Remove it</button>
                </p>
              )}
              {stock?.status === "available" && <p className="text-sm mt-2 text-[#5C0101]/70">Available.</p>}
            </div>
          );
        })}
      </div>
      {lines.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xl font-semibold">KES {total}</p>
          {ready ? (
            <Link to="/shop/checkout" className="bg-[#B91D2D] text-white rounded-lg px-4 py-2">Checkout</Link>
          ) : (
            <span className="text-sm">Adjust the short lines before checkout.</span>
          )}
        </div>
      )}
    </div>
  );
};

export default ShopCartPage;
