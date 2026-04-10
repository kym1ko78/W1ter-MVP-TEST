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

type AuthSessionResponse = {
  accessToken: string;
  user: SafeUser;
  emailVerificationPreviewUrl?: string | null;
};

type EmailVerificationResponse = {
  success?: boolean;
  user: SafeUser;
  emailVerificationPreviewUrl: string | null;
  alreadyVerified?: boolean;
};

type AuthContextValue = {
  user: SafeUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: {
    email: string;
    password: string;
    rememberMe: boolean;
  }) => Promise<AuthSessionResponse>;
  register: (input: {
    email: string;
    displayName: string;
    password: string;
    rememberMe: boolean;
  }) => Promise<AuthSessionResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  authorizedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  requestEmailVerification: () => Promise<EmailVerificationResponse>;
  updateProfile: (input: { displayName: string }) => Promise<SafeUser>;
  uploadAvatar: (file: File) => Promise<SafeUser>;
  removeAvatar: () => Promise<SafeUser>;
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

function isConnectivityError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "TypeError" ||
    /Failed to fetch|Load failed|NetworkError|fetch/i.test(error.message)
  );
}

function toConnectivityError() {
  return new Error(
    "Не удается подключиться к API. Проверьте, что запущены `docker compose up -d` и `pnpm dev`.",
  );
}

async function performAuthRequest(path: string, init: RequestInit) {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
    });

    return await parseResponse<AuthSessionResponse>(response);
  } catch (error) {
    if (isConnectivityError(error)) {
      throw toConnectivityError();
    }

    throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback((session: AuthSessionResponse | null) => {
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

      const session = await parseResponse<AuthSessionResponse>(response);
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
    async (input: { email: string; password: string; rememberMe: boolean }) => {
      const session = await performAuthRequest("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      applySession(session);
      return session;
    },
    [applySession],
  );

  const register = useCallback(
    async (input: {
      email: string;
      displayName: string;
      password: string;
      rememberMe: boolean;
    }) => {
      const session = await performAuthRequest("/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      applySession(session);
      return session;
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

  const requestEmailVerification = useCallback(async () => {
    const payload = await readJson<EmailVerificationResponse>(
      await authorizedFetch("/auth/verify-email/request", {
        method: "POST",
      }),
    );

    setUser(payload.user);
    return payload;
  }, [authorizedFetch]);

  const updateProfile = useCallback(
    async (input: { displayName: string }) => {
      const updatedUser = await readJson<SafeUser>(
        await authorizedFetch("/users/me", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        }),
      );

      setUser(updatedUser);
      return updatedUser;
    },
    [authorizedFetch],
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const updatedUser = await readJson<SafeUser>(
        await authorizedFetch("/users/me/avatar", {
          method: "POST",
          body: formData,
        }),
      );

      setUser(updatedUser);
      return updatedUser;
    },
    [authorizedFetch],
  );

  const removeAvatar = useCallback(async () => {
    const updatedUser = await readJson<SafeUser>(
      await authorizedFetch("/users/me/avatar", {
        method: "DELETE",
      }),
    );

    setUser(updatedUser);
    return updatedUser;
  }, [authorizedFetch]);

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
      requestEmailVerification,
      updateProfile,
      uploadAvatar,
      removeAvatar,
    }),
    [
      accessToken,
      authorizedFetch,
      isLoading,
      login,
      logout,
      requestEmailVerification,
      refreshSession,
      register,
      removeAvatar,
      updateProfile,
      uploadAvatar,
      user,
    ],
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
