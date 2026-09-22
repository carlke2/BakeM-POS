import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import API from "@/services/api";
import {
  AuthUser,
  clearAuthSession,
  getStoredRole,
  getToken,
  getTokenRole,
  hasValidStoredSession,
  isTokenExpired,
  persistAuthSession,
  UserRole,
} from "@/services/authStorage";

function normalizeAuthUser(raw: any): AuthUser | null {
  if (!raw?.id && !raw?._id) return null;
  const roleRaw = String(raw.role || "").toLowerCase();
  let role: UserRole | null = null;
  if (roleRaw === "owner" || roleRaw === "admin") role = "owner";
  else if (roleRaw === "cashier" || roleRaw === "restaurant" || roleRaw === "finance") role = "cashier";
  if (!role) return null;
  return {
    id: raw.id || raw._id,
    name: raw.name,
    role,
    email: raw.email,
  };
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  refreshSession: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const DASHBOARD_PATHS: Record<UserRole, string> = {
  owner: "/",
  cashier: "/pos",
};

export function getDashboardPath(role: UserRole) {
  return DASHBOARD_PATHS[role];
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const logout = useCallback(() => {
    clearAuthSession();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const login = useCallback((nextUser: AuthUser, token: string) => {
    const normalized = normalizeAuthUser(nextUser) || nextUser;
    persistAuthSession(normalized, token);
    if (!hasValidStoredSession()) {
      clearAuthSession();
      setUser(null);
      setStatus("unauthenticated");
      return;
    }
    setUser(normalized);
    setStatus("authenticated");
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const token = getToken();
    const role = getStoredRole();

    if (!token || !role || isTokenExpired(token)) {
      logout();
      return false;
    }

    const tokenRole = getTokenRole(token);
    if (!tokenRole || tokenRole !== role) {
      logout();
      return false;
    }

    try {
      const { data } = await API.get("/auth/session", {
        skipAuthRedirect: true,
        timeout: 10000,
      } as any);
      const sessionUser = normalizeAuthUser(data.user);
      if (!sessionUser?.id || sessionUser.role !== role) {
        logout();
        return false;
      }
      persistAuthSession(sessionUser, token);
      setUser(sessionUser);
      setStatus("authenticated");
      return true;
    } catch {
      logout();
      return false;
    }
  }, [logout]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const value = useMemo(
    () => ({ status, user, login, logout, refreshSession }),
    [status, user, login, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
