"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL } from "./config";
import type { SafeUser } from "../types/api";

type AuthResponse = {
  accessToken: string;
  user: SafeUser;
};

type AuthContextValue = {
  user: SafeUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    email: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  authorizedFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string | string[] }
      | null;

    const message = Array.isArray(body?.message)
      ? body?.message.join(", ")
      : body?.message;

    throw new Error(message ?? "Request failed");
  }

  return (await response.json()) as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback((session: AuthResponse | null) => {
    setAccessToken(session?.accessToken ?? null);
    setUser(session?.user ?? null);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        applySession(null);
        return null;
      }

      const session = await parseResponse<AuthResponse>(response);
      applySession(session);
      return session.accessToken;
    } catch {
      applySession(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const session = await parseResponse<AuthResponse>(response);
      applySession(session);
    },
    [applySession],
  );

  const register = useCallback(
    async (input: { email: string; displayName: string; password: string }) => {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const session = await parseResponse<AuthResponse>(response);
      applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });

    applySession(null);
  }, [applySession]);

  const authorizedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const execute = async (token: string) =>
        fetch(`${API_URL}${path}`, {
          ...init,
          credentials: "include",
          headers: {
            ...(init.headers ?? {}),
            Authorization: `Bearer ${token}`,
          },
        });

      let token = accessToken;

      if (!token) {
        token = await refreshSession();
      }

      if (!token) {
        throw new Error("Unauthorized");
      }

      let response = await execute(token);

      if (response.status === 401) {
        const refreshedToken = await refreshSession();

        if (!refreshedToken) {
          throw new Error("Unauthorized");
        }

        response = await execute(refreshedToken);
      }

      return response;
    },
    [accessToken, refreshSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isLoading,
      isAuthenticated: Boolean(user && accessToken),
      login,
      register,
      logout,
      refreshSession,
      authorizedFetch,
    }),
    [accessToken, authorizedFetch, isLoading, login, logout, refreshSession, register, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}

export async function readJson<T>(response: Response): Promise<T> {
  return parseResponse<T>(response);
}

