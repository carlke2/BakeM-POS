import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import shopApi from "@/shop/shopApi";
import { saveShopSession } from "@/shop/shopSession";

const ShopLoginPage = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await shopApi.post("/shop/auth/request", { phone });
      setSent(true);
      setHint(response.data.message);
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not send a code");
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await shopApi.post("/shop/auth/verify", { phone, code, name });
      saveShopSession(response.data.token, response.data.customer);
      navigate("/shop");
    } catch (err: any) {
      setError(err.response?.data?.message || "That code was not accepted");
    }
  };

  return (
    <div className="max-w-md bg-white border border-[#E5C48D] rounded-xl p-6">
      <h1 className="text-3xl font-bold mb-2">Sign in</h1>
      <p className="text-sm mb-4">Use your phone number. We will send a 5-minute code.</p>
      {!sent ? (
        <form onSubmit={requestCode} className="space-y-3">
          <input required placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
          {error && <p className="text-sm text-[#B91D2D]">{error}</p>}
          <button className="bg-[#B91D2D] text-white rounded-lg px-4 py-2">Send code</button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm">{hint}</p>
          <input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
          <input required placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} className="w-full border border-[#E5C48D] rounded-lg px-3 py-2" />
          {error && <p className="text-sm text-[#B91D2D]">{error}</p>}
          <button className="bg-[#B91D2D] text-white rounded-lg px-4 py-2">Verify</button>
          <button type="button" className="block text-sm underline" onClick={requestCode}>Resend code</button>
        </form>
      )}
    </div>
  );
};

export default ShopLoginPage;
