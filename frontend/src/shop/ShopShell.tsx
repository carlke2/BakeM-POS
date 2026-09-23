import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { clearShopSession, getShopCustomer } from "@/shop/shopSession";
import { readCart } from "@/shop/cart";
import ShopMenuPage from "@/shop/ShopMenuPage";
import ShopProductPage from "@/shop/ShopProductPage";
import ShopCartPage from "@/shop/ShopCartPage";
import ShopCheckoutPage from "@/shop/ShopCheckoutPage";
import ShopLoginPage from "@/shop/ShopLoginPage";
import ShopOrdersPage from "@/shop/ShopOrdersPage";
import ShopTrackingPage from "@/shop/ShopTrackingPage";
import ShopReceiptPage from "@/shop/ShopReceiptPage";

const ShopShell = () => {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(getShopCustomer());
  const [count, setCount] = useState(readCart().length);

  useEffect(() => {
    const sync = () => {
      setCustomer(getShopCustomer());
      setCount(readCart().length);
    };
    window.addEventListener("shop-cart", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("shop-cart", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#FBF4D0] text-[#5C0101]">
      <header className="bg-[#B91D2D] text-[#FBF4D0]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link to="/shop" className="font-bold tracking-wide text-lg">Slow Rise Co</Link>
          <nav className="flex gap-4 text-sm ml-auto">
            <NavLink to="/shop" end className="hover:text-white">Menu</NavLink>
            <NavLink to="/shop/orders" className="hover:text-white">Orders</NavLink>
            <NavLink to="/shop/cart" className="hover:text-white">Cart ({count})</NavLink>
            {customer ? (
              <button
                className="hover:text-white"
                onClick={() => {
                  clearShopSession();
                  setCustomer(null);
                  navigate("/shop");
                }}
              >
                Sign out
              </button>
            ) : (
              <NavLink to="/shop/login" className="hover:text-white">Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/shop" element={<ShopMenuPage />} />
          <Route path="/shop/item/:id" element={<ShopProductPage />} />
          <Route path="/shop/cart" element={<ShopCartPage />} />
          <Route path="/shop/checkout" element={<ShopCheckoutPage />} />
          <Route path="/shop/login" element={<ShopLoginPage />} />
          <Route path="/shop/orders" element={<ShopOrdersPage />} />
          <Route path="/shop/orders/:id" element={<ShopTrackingPage />} />
          <Route path="/shop/orders/:id/receipt" element={<ShopReceiptPage />} />
        </Routes>
      </main>
    </div>
  );
};

export default ShopShell;
