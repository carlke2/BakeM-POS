export type UserRole = "owner" | "cashier";

export type AuthUser = {
  id: string;
  name: string;
  role: UserRole;
  email?: string;
};

const AUTH_KEYS = ["token", "role", "userName", "adminName", "studentName", "regNo"] as const;

const VALID_ROLES: UserRole[] = ["owner", "cashier"];

/** Map legacy role names from older sessions/tokens */
function normalizeRole(role: string | undefined | null): UserRole | null {
  if (!role) return null;
  const normalized = role.toLowerCase();
  if (VALID_ROLES.includes(normalized as UserRole)) return normalized as UserRole;
  if (normalized === "admin") return "owner";
  if (normalized === "restaurant" || normalized === "finance") return "cashier";
  return null;
}

export function getToken(): string | null {
  const token = localStorage.getItem("token");
  return token && token.trim() ? token.trim() : null;
}

export function getStoredRole(): UserRole | null {
  return normalizeRole(localStorage.getItem("role"));
}

function decodeTokenPayload(token: string): { role?: string; exp?: number } | null {
  try {
    const base64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!base64) return null;
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function getTokenRole(token: string): UserRole | null {
  return normalizeRole(decodeTokenPayload(token)?.role);
}

export function isTokenExpired(token: string): boolean {
  const exp = decodeTokenPayload(token)?.exp;
  if (!exp) return true;
  return Date.now() >= exp * 1000;
}

export function hasValidStoredSession(): boolean {
  const token = getToken();
  const role = getStoredRole();
  if (!token || !role || isTokenExpired(token)) return false;
  const tokenRole = getTokenRole(token);
  return tokenRole === role;
}

export function persistAuthSession(user: AuthUser, token: string) {
  localStorage.setItem("token", token);
  localStorage.setItem("role", user.role);
  localStorage.setItem("userName", user.name);
  if (user.role === "owner") {
    localStorage.setItem("adminName", user.name);
  }
}

export function clearAuthSession() {
  for (const key of AUTH_KEYS) {
    localStorage.removeItem(key);
  }
}

export function syncUserToStorage(user: AuthUser) {
  persistAuthSession(user, getToken() || "");
}
