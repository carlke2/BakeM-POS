export type CartLine = {
  menuItemId: string;
  name: string;
  unitType: string;
  price: number;
  quantity: number;
};

const KEY = "slowrise-shop-cart";

export function readCart(): CartLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("shop-cart"));
}

export function addToCart(line: CartLine) {
  const cart = readCart();
  const existing = cart.find((item) => item.menuItemId === line.menuItemId);
  if (existing) existing.quantity = line.quantity;
  else cart.push(line);
  writeCart(cart.filter((item) => item.quantity > 0));
}
