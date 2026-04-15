"use client";

import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readJson, useAuth } from "../lib/auth-context";
import {
  getStoredEmailVerificationPreviewUrl,
  setStoredEmailVerificationPreviewUrl,
} from "../lib/email-verification";
import { formatRelativeLastSeen } from "../lib/utils";
import { UserAvatar } from "./user-avatar";

const AVATAR_ACCEPT = ["image/png", "image/jpeg", "image/webp"].join(",");
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

type ProfileStatus = {
  type: "success" | "error";
  message: string;
} | null;

type AuthDeviceSession = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  isPersistent: boolean;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

export function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    accessToken,
    authorizedFetch,
    isAuthenticated,
    isLoading,
    logout,
    removeAvatar,
    requestEmailVerification,
    updateProfile,
    uploadAvatar,
    user,
  } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ProfileStatus>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [sessions, setSessions] = useState<AuthDeviceSession[]>([]);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [isRevokingOtherSessions, setIsRevokingOtherSessions] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.displayName]);

  useEffect(() => {
    setVerificationPreviewUrl(getStoredEmailVerificationPreviewUrl());
  }, []);

  useEffect(() => {
    if (user?.emailVerifiedAt) {
      setStoredEmailVerificationPreviewUrl(null);
      setVerificationPreviewUrl(null);
    }
  }, [user?.emailVerifiedAt]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const isNameChanged = useMemo(() => {
    return displayName.trim() !== (user?.displayName ?? "");
  }, [displayName, user?.displayName]);

  const syncMessengerViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chats"] }),
      queryClient.invalidateQueries({ queryKey: ["chat"] }),
      queryClient.invalidateQueries({ queryKey: ["messages"] }),
    ]);
  };

  const loadSessions = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsSessionsLoading(true);
    setSessionsError(null);

    try {
      const payload = await readJson<AuthDeviceSession[]>(
        await authorizedFetch("/auth/sessions"),
      );
      setSessions(payload);
    } catch (error) {
      setSessionsError(
        error instanceof Error ? error.message : "Не удалось загрузить сессии.",
      );
    } finally {
      setIsSessionsLoading(false);
    }
  }, [authorizedFetch, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void loadSessions();
  }, [isAuthenticated, loadSessions]);

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = displayName.trim();

    if (trimmedName.length < 2) {
      setStatus({ type: "error", message: "Имя должно содержать минимум 2 символа." });
      return;
    }

    if (!isNameChanged || isSavingProfile) {
      return;
    }

    setIsSavingProfile(true);
    setStatus(null);

    try {
      await updateProfile({ displayName: trimmedName });
      await syncMessengerViews();
      setStatus({ type: "success", message: "Профиль обновлен." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Не удалось обновить профиль.",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setStatus({ type: "error", message: "Поддерживаются только PNG, JPEG и WEBP изображения." });
      event.target.value = "";
      return;
    }

    if (file.size > AVATAR_MAX_BYTES) {
      setStatus({ type: "error", message: "Размер аватарки не должен превышать 5 MB." });
      event.target.value = "";
      return;
    }

    setIsUploadingAvatar(true);
    setStatus(null);

    try {
      await uploadAvatar(file);
      await syncMessengerViews();
      setStatus({ type: "success", message: "Аватарка обновлена." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Не удалось загрузить аватарку.",
      });
    } finally {
      setIsUploadingAvatar(false);
      event.target.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user?.avatarUrl || isRemovingAvatar) {
      return;
    }

    setIsRemovingAvatar(true);
    setStatus(null);

    try {
      await removeAvatar();
      await syncMessengerViews();
      setStatus({ type: "success", message: "Аватарка удалена." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Не удалось удалить аватарку.",
      });
    } finally {
      setIsRemovingAvatar(false);
    }
  };

  const handleSendVerification = async () => {
    if (isSendingVerification) {
      return;
    }

    setIsSendingVerification(true);
    setStatus(null);

    try {
      const result = await requestEmailVerification();
      setStoredEmailVerificationPreviewUrl(result.emailVerificationPreviewUrl);
      setVerificationPreviewUrl(result.emailVerificationPreviewUrl);

      if (result.alreadyVerified || result.user.emailVerifiedAt) {
        setStatus({ type: "success", message: "Почта уже подтверждена." });
        return;
      }

      setStatus({
        type: "success",
        message: "Письмо отправлено. Для локальной разработки ссылка доступна ниже.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Не удалось отправить письмо подтверждения.",
      });
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (revokingSessionId || isRevokingOtherSessions) {
      return;
    }

    setRevokingSessionId(sessionId);
    setSessionsError(null);

    try {
      await readJson<{ success: boolean }>(
        await authorizedFetch(`/auth/sessions/${sessionId}`, {
          method: "DELETE",
        }),
      );
      await loadSessions();
      setStatus({ type: "success", message: "Сессия завершена." });
    } catch (error) {
      setSessionsError(
        error instanceof Error ? error.message : "Не удалось завершить сессию.",
      );
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleRevokeOtherSessions = async () => {
    if (revokingSessionId || isRevokingOtherSessions) {
      return;
    }

    setIsRevokingOtherSessions(true);
    setSessionsError(null);

    try {
      const result = await readJson<{ success: boolean; revokedCount: number }>(
        await authorizedFetch("/auth/sessions/revoke-others", {
          method: "POST",
        }),
      );
      await loadSessions();
      setStatus({
        type: "success",
        message:
          result.revokedCount > 0
            ? `Завершено сессий: ${result.revokedCount}.`
            : "Дополнительных сессий не найдено.",
      });
    } catch (error) {
      setSessionsError(
        error instanceof Error ? error.message : "Не удалось завершить другие сессии.",
      );
    } finally {
      setIsRevokingOtherSessions(false);
    }
  };

  if (isLoading || !isAuthenticated || !user) {
    return (
      <main className="chat-scene grain flex min-h-[100dvh] items-center justify-center px-4 py-6">
        <div className="profile-panel px-6 py-5 text-sm text-stone-600">Подготавливаем профиль...</div>
      </main>
    );
  }

  return (
    <main className="profile-scene grain min-h-[100dvh] px-4 py-4 sm:px-6 sm:py-6" data-testid="profile-page">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="profile-panel relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
          <div className="profile-orbit profile-orbit-top" aria-hidden="true" />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-600 transition hover:border-black hover:bg-black hover:text-white"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              К чатам
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-600 transition hover:border-black hover:bg-black hover:text-white"
            >
              Exit
            </button>
          </div>

          <div className="relative z-10 mt-10 flex flex-col items-center text-center">
            <UserAvatar
              user={user}
              accessToken={accessToken}
              className="h-28 w-28 rounded-[32px] border border-black/10 shadow-[0_18px_40px_rgba(17,24,39,0.12)]"
              fallbackClassName="text-3xl"
            />
            <h1 className="mt-5 text-[2rem] font-semibold leading-none tracking-tight text-[#171717]">
              {user.displayName}
            </h1>
            <p className="mt-3 text-sm text-stone-500">{user.email}</p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-stone-400">
              Telegram style profile
            </p>
          </div>

          <div className="relative z-10 mt-8 space-y-3">
            <input
              ref={avatarInputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className="hidden"
              onChange={handleAvatarChange}
              data-testid="profile-avatar-input"
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={isUploadingAvatar}
              data-testid="profile-avatar-upload-button"
              className="w-full rounded-[20px] bg-[#111111] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploadingAvatar ? "Загружаем..." : user.avatarUrl ? "Сменить фото" : "Загрузить фото"}
            </button>
            <button
              type="button"
              onClick={handleRemoveAvatar}
              disabled={!user.avatarUrl || isRemovingAvatar}
              data-testid="profile-remove-avatar-button"
              className="w-full rounded-[20px] border border-black/10 bg-white px-4 py-3 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRemovingAvatar ? "Удаляем..." : "Убрать фото"}
            </button>
          </div>

          <div className="relative z-10 mt-8 rounded-[28px] border border-black/8 bg-white/86 px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.06)]">
            <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Активность</p>
            <p className="mt-3 text-sm text-[#171717]">
              {user.lastSeenAt ? `Был(а) ${formatRelativeLastSeen(user.lastSeenAt)}` : "Недавно в сети"}
            </p>
          </div>
        </aside>

        <section className="profile-panel relative overflow-hidden px-5 py-5 sm:px-7 sm:py-7">
          <div className="profile-orbit profile-orbit-bottom" aria-hidden="true" />
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4 border-b border-black/8 pb-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Profile</p>
              <h2 className="mt-3 text-[2.2rem] font-semibold leading-[0.95] tracking-tight text-[#171717] sm:text-[2.7rem]">
                Управляйте данными и аватаркой без лишнего шума.
              </h2>
            </div>
            <div className="max-w-[260px] rounded-[24px] border border-black/8 bg-white px-5 py-4 text-sm leading-6 text-stone-600 shadow-[0_16px_36px_rgba(17,24,39,0.06)]">
              Профиль собран в логике Telegram: крупная аватарка, понятные данные и быстрые действия в одном месте.
            </div>
          </div>

          <div className="relative z-10 mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
            <form onSubmit={handleProfileSubmit} className="space-y-5">
              <div className="rounded-[30px] border border-black/8 bg-white px-5 py-5 shadow-[0_18px_40px_rgba(17,24,39,0.06)] sm:px-6 sm:py-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Основное</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-[#171717]">Имя профиля</h3>
                  </div>
                  <span className="rounded-full border border-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                    edit
                  </span>
                </div>

                <label className="mt-6 block">
                  <span className="mb-2 block text-sm font-medium text-[#171717]">Display name</span>
                  <input
                    data-testid="profile-display-name-input"
                    value={displayName}
                    maxLength={50}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      if (status?.type === "error") {
                        setStatus(null);
                      }
                    }}
                    className="w-full rounded-[20px] border border-black/8 bg-[#f7f7f5] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
                    placeholder="Введите имя"
                  />
                </label>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    data-testid="profile-save-button"
                    type="submit"
                    disabled={!isNameChanged || isSavingProfile}
                    className="rounded-[20px] bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isSavingProfile ? "Сохраняем..." : "Сохранить изменения"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayName(user.displayName)}
                    disabled={!isNameChanged || isSavingProfile}
                    className="rounded-[20px] border border-black/10 bg-white px-5 py-3 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    Сбросить
                  </button>
                </div>
              </div>
            </form>

            <div className="space-y-5">
              <div className="rounded-[26px] border border-black/8 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.06)]">
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                  Email status
                </p>
                <p className="mt-3 text-sm text-[#171717]">
                  {user.emailVerifiedAt
                    ? "Почта подтверждена и аккаунт полностью активен."
                    : "Почта пока не подтверждена. Можно отправить письмо повторно."}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <span
                    className={clsx(
                      "rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]",
                      user.emailVerifiedAt
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-stone-200 bg-[#f7f7f5] text-stone-500",
                    )}
                  >
                    {user.emailVerifiedAt ? "verified" : "pending"}
                  </span>
                  {!user.emailVerifiedAt ? (
                    <button
                      type="button"
                      onClick={handleSendVerification}
                      data-testid="profile-send-verification-button"
                      disabled={isSendingVerification}
                      className="rounded-[18px] border border-black/10 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSendingVerification ? "Отправляем..." : "Отправить письмо"}
                    </button>
                  ) : null}
                </div>
                {verificationPreviewUrl ? (
                  <div className="mt-4 rounded-[18px] border border-black/8 bg-[#f7f7f5] px-4 py-4 text-sm text-stone-600">
                    <p className="font-medium text-[#171717]">
                      Dev-ссылка подтверждения доступна локально.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <a
                        href={verificationPreviewUrl}
                        className="rounded-[16px] bg-[#111111] px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
                        data-testid="profile-open-verification-link"
                      >
                        Открыть ссылку
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-[26px] border border-black/8 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.06)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                    Сессии и устройства
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadSessions()}
                    disabled={isSessionsLoading}
                    className="rounded-full border border-black/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500 transition hover:border-black/20 hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSessionsLoading ? "..." : "Обновить"}
                  </button>
                </div>

                {sessionsError ? (
                  <p className="mt-3 rounded-[12px] border border-black/10 bg-black px-3 py-2 text-xs text-white">
                    {sessionsError}
                  </p>
                ) : null}

                {isSessionsLoading ? (
                  <p className="mt-3 text-sm text-stone-500">Загружаем сессии...</p>
                ) : sessions.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className="rounded-[16px] border border-black/8 bg-[#f7f7f5] px-3 py-3"
                      >
                        <p className="truncate text-sm font-medium text-[#171717]">
                          {session.userAgent || "Неизвестное устройство"}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">
                          IP: {session.ipAddress || "unknown"}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">
                          {session.isCurrent ? "Текущая сессия" : "Дополнительная сессия"}
                        </p>
                        {!session.isCurrent ? (
                          <button
                            type="button"
                            onClick={() => void handleRevokeSession(session.id)}
                            disabled={Boolean(revokingSessionId) || isRevokingOtherSessions}
                            className="mt-2 rounded-full border border-black/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/20 hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {revokingSessionId === session.id ? "Завершаем..." : "Завершить"}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-stone-500">Активных сессий нет.</p>
                )}

                <button
                  type="button"
                  onClick={() => void handleRevokeOtherSessions()}
                  disabled={isRevokingOtherSessions || Boolean(revokingSessionId)}
                  className="mt-4 w-full rounded-[18px] border border-black/10 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRevokingOtherSessions ? "Завершаем..." : "Завершить все, кроме текущей"}
                </button>
              </div>
              <InfoCard label="Email" value={user.email} />
              <InfoCard label="User ID" value={user.id} monospace />
              <InfoCard
                label="Последняя активность"
                value={user.lastSeenAt ? formatRelativeLastSeen(user.lastSeenAt) : "Недавно"}
              />
            </div>
          </div>

          {status ? (
            <div
              data-testid="profile-status-message"
              className={clsx(
                "relative z-10 mt-6 rounded-[24px] border px-5 py-4 text-sm shadow-[0_14px_32px_rgba(17,24,39,0.06)]",
                status.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700",
              )}
            >
              {status.message}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function InfoCard({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="rounded-[26px] border border-black/8 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.06)]">
      <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">{label}</p>
      <p className={clsx("mt-3 break-words text-sm text-[#171717]", monospace && "font-mono text-[13px]")}>{value}</p>
    </div>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </svg>
  );
}
