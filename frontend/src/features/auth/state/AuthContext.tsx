/**
 * Who is signed in.
 *
 * The provider restores the session from the stored token on load, hears
 * from the HTTP client when a token stops working, and clears every cached
 * query on sign-out so the next person never sees the last person's data.
 */
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi, type AuthUser } from "@/features/auth/api/authApi";
import { getAuthToken, onUnauthorised, setAuthToken } from "@/shared/auth/authToken";
import { grants, isAdministrator } from "@/shared/auth/roles";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Re-read the profile from the server, e.g. after it was edited. */
  refresh: () => Promise<void>;
  /** Apply a profile the server just returned, without another round trip. */
  setUser: (user: AuthUser) => void;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>(() => (getAuthToken() ? "loading" : "anonymous"));
  const [user, setUserState] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    if (!getAuthToken()) {
      setUserState(null);
      setStatus("anonymous");
      return;
    }
    try {
      const response = await authApi.me();
      setUserState(response.user);
      setStatus("authenticated");
    } catch {
      // A 401 has already dropped the token; anything else (server down) is
      // treated the same so the person lands on the sign-in page with a way back.
      setAuthToken(null);
      setUserState(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      onUnauthorised(() => {
        setUserState(null);
        setStatus("anonymous");
        queryClient.clear();
      }),
    [queryClient]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login(email, password);
      setAuthToken(response.access_token);
      queryClient.clear();
      setUserState(response.user);
      setStatus("authenticated");
      return response.user;
    },
    [queryClient]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The token may already be dead; signing out locally is what matters.
    }
    setAuthToken(null);
    setUserState(null);
    setStatus("anonymous");
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login,
      logout,
      refresh,
      setUser: setUserState,
      hasRole: (role: string) => grants(user?.roles ?? [], role),
      isAdmin: isAdministrator(user?.roles ?? [])
    }),
    [status, user, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

/** True when the signed-in person holds the role. Anonymous means false. */
export function useCan(role: string): boolean {
  return useAuth().hasRole(role);
}
