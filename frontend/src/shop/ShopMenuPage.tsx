import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import shopApi from "@/shop/shopApi";

type MenuItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  category: string;
  imageUrl?: string | null;
  unitType: string;
};

const ShopMenuPage = () => {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    shopApi.get("/menu/display")
      .then((response) => setItems(response.data))
      .catch(() => setError("The menu could not be loaded."));
  }, []);

  const categories = [...new Set(items.map((item) => item.category))];

  return (
    <div>
      <h1 className="text-3xl font-bold text-[#5C0101] mb-2">The menu</h1>
      <p className="text-[#5C0101]/80 mb-8">Order for pickup at the bakery, or delivery to your building.</p>
      {error && <p className="text-[#B91D2D]">{error}</p>}
      {categories.map((category) => (
        <section key={category} className="mb-8">
          <h2 className="text-xl font-semibold mb-3">{category}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {items.filter((item) => item.category === category).map((item) => (
              <Link
                key={item.id}
                to={`/shop/item/${item.id}`}
                className="block bg-white border border-[#E5C48D] rounded-xl p-4 hover:border-[#B91D2D]"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[#5C0101]">{item.name}</h3>
                    <p className="text-sm text-[#5C0101]/70 mt-1">{item.description}</p>
                  </div>
                  <p className="font-semibold text-[#B91D2D] whitespace-nowrap">KES {item.price}</p>
                </div>
                <p className="text-xs uppercase tracking-wide text-[#5C0101]/60 mt-3">per {item.unitType}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default ShopMenuPage;
