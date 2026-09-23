import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import shopApi from "@/shop/shopApi";
import { addToCart } from "@/shop/cart";

type MenuItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  unitType: string;
};

type AvailabilityLine = {
  status: "available" | "partial" | "unavailable";
  maxQuantity: number | null;
  limitingIngredients: Array<{ name: string; unit: string; available: number }>;
};

const ShopProductPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<MenuItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [line, setLine] = useState<AvailabilityLine | null>(null);

  useEffect(() => {
    shopApi.get("/menu/display").then((response) => {
      const found = (response.data as MenuItem[]).find((entry) => entry.id === id) || null;
      setItem(found);
    });
  }, [id]);

  useEffect(() => {
    if (!id || quantity <= 0) return;
    const handle = window.setTimeout(() => {
      shopApi.post("/availability", { items: [{ menuItemId: id, quantity }] })
        .then((response) => setLine(response.data.lines?.[0] || null))
        .catch((error) => setLine(error.response?.data?.availability?.lines?.[0] || null));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [id, quantity]);

  if (!item) return <p>Loading this item…</p>;

  const cap = line?.maxQuantity;
  const canAdd = line?.status === "available" || (line?.status === "partial" && cap != null && cap > 0);

  return (
    <div className="bg-white border border-[#E5C48D] rounded-xl p-6 max-w-xl">
      <Link to="/shop" className="text-sm text-[#B91D2D]">Back to menu</Link>
      <h1 className="text-3xl font-bold mt-3">{item.name}</h1>
      <p className="mt-2 text-[#5C0101]/80">{item.description}</p>
      <p className="mt-4 text-xl font-semibold text-[#B91D2D]">KES {item.price} / {item.unitType}</p>
      <label className="block mt-6 text-sm font-semibold">Quantity ({item.unitType})</label>
      <input
        type="number"
        min={1}
        step={1}
        value={quantity}
        onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
        className="mt-1 w-32 border border-[#E5C48D] rounded-lg px-3 py-2"
      />
      {line && (
        <div className="mt-4 rounded-lg bg-[#FBF4D0] border border-[#E5C48D] p-3 text-sm">
          {line.status === "available" && <p>Available at this quantity.</p>}
          {line.status === "partial" && (
            <p>
              We can make {cap} {item.unitType} right now.
              {cap != null && cap > 0 && (
                <button className="ml-2 underline text-[#B91D2D]" onClick={() => setQuantity(cap)}>
                  Use {cap}
                </button>
              )}
            </p>
          )}
          {line.status === "unavailable" && <p>This item is unavailable at the moment.</p>}
          {line.limitingIngredients?.[0] && (
            <p className="mt-1 text-[#5C0101]/70">Limited by {line.limitingIngredients[0].name}.</p>
          )}
        </div>
      )}
      <button
        disabled={!canAdd}
        className="mt-6 bg-[#B91D2D] text-white rounded-lg px-4 py-2 disabled:opacity-40"
        onClick={() => {
          const nextQty = line?.status === "partial" && cap != null ? Math.min(quantity, cap) : quantity;
          addToCart({
            menuItemId: item.id,
            name: item.name,
            unitType: item.unitType,
            price: item.price,
            quantity: nextQty,
          });
          navigate("/shop/cart");
        }}
      >
        Add to cart
      </button>
    </div>
  );
};

export default ShopProductPage;
