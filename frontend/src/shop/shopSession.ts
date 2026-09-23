const TOKEN_KEY = "shopToken";
const NAME_KEY = "shopName";
const PHONE_KEY = "shopPhone";

export type ShopCustomer = { id: string; name: string; phone: string };

export function getShopToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getShopCustomer(): ShopCustomer | null {
  const token = getShopToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.role !== "customer" || !payload.exp || Date.now() >= payload.exp * 1000) return null;
    return { id: payload.id, name: payload.name, phone: payload.phone };
  } catch {
    return null;
  }
}

export function saveShopSession(token: string, customer: ShopCustomer) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, customer.name);
  localStorage.setItem(PHONE_KEY, customer.phone);
}

export function clearShopSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(PHONE_KEY);
}
