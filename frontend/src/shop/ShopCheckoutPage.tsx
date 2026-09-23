import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import shopApi from "@/shop/shopApi";
import { getShopCustomer } from "@/shop/shopSession";
import { readCart, writeCart } from "@/shop/cart";

const ShopCheckoutPage = () => {
  const navigate = useNavigate();
  const customer = getShopCustomer();
  const [fulfillmentType, setFulfillmentType] = useState<"pickup" | "delivery">("pickup");
  const [buildingName, setBuildingName] = useState("");
  const [street, setStreet] = useState("");
  const [area, setArea] = useState("");
  const [floor, setFloor] = useState("");
  const [unit, setUnit] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [payPhone, setPayPhone] = useState(customer?.phone || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cart = readCart();

  const useLocation = () => {
    if (!navigator.geolocation) {
      setError("This browser cannot share your location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setError("");
      },
      () => setError("Location was not shared. You can still type the address."),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer) {
      navigate("/shop/login");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await shopApi.post("/shop/checkout", {
        fulfillmentType,
        payPhone,
        items: cart.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
        address: fulfillmentType === "delivery"
          ? { buildingName, street, area, floor, unit, latitude, longitude }
          : undefined,
      });
      writeCart([]);
      navigate(`/shop/orders/${response.data.order.id}`);
    } catch (err: any) {
      const availability = err.response?.data?.availability?.lines;
      if (availability) {
        setError("A line is short now. Go back to the cart and adjust only that item.");
      } else {
        setError(err.response?.data?.message || "Checkout could not place the hold.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!customer) {
    return <p>Sign in to check out. <Link className="text-[#B91D2D]" to="/shop/login">Phone code</Link></p>;
  }
  if (cart.length === 0) {
    return <p>Your cart is empty. <Link className="text-[#B91D2D]" to="/shop">Browse the menu</Link></p>;
  }

  return (
    <form onSubmit={submit} className="bg-white border border-[#E5C48D] rounded-xl p-6 max-w-xl space-y-4">
      <h1 className="text-3xl font-bold">Checkout</h1>
      <div className="flex gap-3">
        <label className="flex items-center gap-2"><input type="radio" checked={fulfillmentType === "pickup"} onChange={() => setFulfillmentType("pickup")} /> Pickup</label>
        <label className="flex items-center gap-2"><input type="radio" checked={fulfillmentType === "delivery"} onChange={() => setFulfillmentType("delivery")} /> Delivery</label>
      </div>
      {fulfillmentType === "delivery" && (
        <div className="space-y-3">
          <input required placeholder="Building name" value={buildingName} onChange={(e) => setBuildingName(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
          <input required placeholder="Street or road" value={street} onChange={(e) => setStreet(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
          <input required placeholder="Area or neighborhood" value={area} onChange={(e) => setArea(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Floor (optional)" value={floor} onChange={(e) => setFloor(e.target.value)} className="border border-[#E5C48D] rounded-lg px-3 py-2" />
            <input placeholder="Room or unit (optional)" value={unit} onChange={(e) => setUnit(e.target.value)} className="border border-[#E5C48D] rounded-lg px-3 py-2" />
          </div>
          <button type="button" onClick={useLocation} className="bg-[#FFA29D] text-[#5C0101] rounded-lg px-3 py-2">
            Use my current location
          </button>
          {latitude != null && longitude != null && (
            <p className="text-sm">Location saved: {latitude.toFixed(5)}, {longitude.toFixed(5)}. The address fields stay as you typed them.</p>
          )}
        </div>
      )}
      <label className="block text-sm font-semibold">M-Pesa number</label>
      <input value={payPhone} onChange={(e) => setPayPhone(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
      {error && <p className="text-[#B91D2D] text-sm">{error}</p>}
      <button disabled={busy} className="bg-[#B91D2D] text-white rounded-lg px-4 py-2 disabled:opacity-40">
        {busy ? "Placing the hold…" : "Pay with M-Pesa"}
      </button>
    </form>
  );
};

export default ShopCheckoutPage;
