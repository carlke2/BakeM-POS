export type UserRole = "admin" | "student" | "parent" | "finance" | "restaurant";

export type AuthUser = {
  id: string;
  name: string;
  role: UserRole;
  email?: string;
  regNo?: string;
  walletBalance?: number;
};

const AUTH_KEYS = ["token", "role", "userName", "studentName", "regNo", "adminName"] as const;

export function getToken(): string | null {
  const token = localStorage.getItem("token");
  return token && token.trim() ? token.trim() : null;
}

export function getStoredRole(): UserRole | null {
  const role = localStorage.getItem("role");
  if (!role) return null;
  const normalized = role.toLowerCase();
  if (["admin", "student", "parent", "finance", "restaurant"].includes(normalized)) {
    return normalized as UserRole;
  }
  return null;
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
  const role = decodeTokenPayload(token)?.role?.toLowerCase();
  if (role && ["admin", "student", "parent", "finance", "restaurant"].includes(role)) {
    return role as UserRole;
  }
  return null;
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

  if (user.role === "admin") {
    localStorage.setItem("adminName", user.name);
  } else if (user.role === "student") {
    localStorage.setItem("studentName", user.name);
    if (user.regNo) localStorage.setItem("regNo", user.regNo);
  } else {
    localStorage.setItem("userName", user.name);
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
