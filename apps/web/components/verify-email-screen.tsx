"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { API_URL } from "../lib/config";
import {
  getStoredEmailVerificationPreviewUrl,
  setStoredEmailVerificationPreviewUrl,
} from "../lib/email-verification";

type VerificationState =
  | "idle"
  | "sent"
  | "confirming"
  | "success"
  | "verified"
  | "invalid"
  | "error";

type VerifyEmailSuccessPayload = {
  success: true;
  email: string;
};

export function VerifyEmailScreen() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? null;
  const sentFromRegister = searchParams?.get("sent") === "1";
  const { isAuthenticated, isLoading, refreshSession, requestEmailVerification, user } = useAuth();
  const [state, setState] = useState<VerificationState>(token ? "confirming" : sentFromRegister ? "sent" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  useEffect(() => {
    setPreviewUrl(getStoredEmailVerificationPreviewUrl());
  }, []);

  useEffect(() => {
    if (!token) {
      if (user?.emailVerifiedAt) {
        setState("verified");
        setMessage("Почта уже подтверждена. Можно продолжать работу.");
      } else if (sentFromRegister) {
        setState("sent");
        setMessage("Письмо отправлено. Подтвердите email, чтобы завершить настройку аккаунта.");
      }

      return;
    }

    let cancelled = false;

    const confirmEmail = async () => {
      setState("confirming");
      setMessage("Проверяем ссылку подтверждения...");

      try {
        const response = await fetch(`${API_URL}/auth/verify-email/confirm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        const body = (await response.json().catch(() => null)) as
          | { message?: string | string[]; email?: string }
          | null;

        if (!response.ok) {
          const nextMessage = Array.isArray(body?.message)
            ? body.message.join(", ")
            : body?.message ?? "Не удалось подтвердить email.";

          throw new Error(nextMessage);
        }

        const payload = body as VerifyEmailSuccessPayload;

        if (cancelled) {
          return;
        }

        await refreshSession();
        setStoredEmailVerificationPreviewUrl(null);
        setPreviewUrl(null);
        setState("success");
        setMessage(`Почта ${payload.email} успешно подтверждена.`);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const nextMessage =
          error instanceof Error ? error.message : "Не удалось подтвердить email.";

        setState(
          /недействительна|устарела|invalid|expired/i.test(nextMessage)
            ? "invalid"
            : "error",
        );
        setMessage(nextMessage);
      }
    };

    void confirmEmail();

    return () => {
      cancelled = true;
    };
  }, [refreshSession, sentFromRegister, token, user?.emailVerifiedAt]);

  const handleResend = async () => {
    if (!isAuthenticated || isResending) {
      return;
    }

    setIsResending(true);
    setMessage(null);

    try {
      const result = await requestEmailVerification();
      setStoredEmailVerificationPreviewUrl(result.emailVerificationPreviewUrl);
      setPreviewUrl(result.emailVerificationPreviewUrl);

      if (result.alreadyVerified || result.user.emailVerifiedAt) {
        setState("verified");
        setMessage("Почта уже подтверждена.");
        return;
      }

      setState("sent");
      setMessage("Новое письмо отправлено. Откройте ссылку ниже, чтобы подтвердить email.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось отправить письмо повторно.");
    } finally {
      setIsResending(false);
    }
  };

  const handleCopyPreviewLink = async () => {
    if (!previewUrl || isCopying || typeof navigator === "undefined") {
      return;
    }

    setIsCopying(true);

    try {
      await navigator.clipboard.writeText(previewUrl);
      setMessage("Ссылка подтверждения скопирована.");
    } catch {
      setMessage("Не удалось скопировать ссылку. Откройте её вручную.");
    } finally {
      setIsCopying(false);
    }
  };

  const canResend = isAuthenticated && !isLoading && !user?.emailVerifiedAt;
  const title = useMemo(() => {
    switch (state) {
      case "confirming":
        return "Подтверждаем почту";
      case "success":
      case "verified":
        return "Почта подтверждена";
      case "invalid":
        return "Ссылка устарела";
      case "error":
        return "Не получилось подтвердить email";
      case "sent":
        return "Письмо уже в пути";
      default:
        return "Подтверждение email";
    }
  }, [state]);

  const description = useMemo(() => {
    switch (state) {
      case "confirming":
        return "Проверяем токен и синхронизируем статус аккаунта.";
      case "success":
      case "verified":
        return "Статус обновлен. Теперь можно спокойно продолжать работу в мессенджере.";
      case "invalid":
        return "У старой ссылки закончился срок. Запросите новое письмо и подтвердите email ещё раз.";
      case "error":
        return "Сервер не смог завершить подтверждение. Попробуйте еще раз или отправьте письмо заново.";
      case "sent":
        return "Откройте письмо и перейдите по ссылке подтверждения. В локальной разработке мы показываем ссылку прямо на странице.";
      default:
        return "Мы храним статус подтверждения отдельно, чтобы аккаунт был устойчивым и понятным.";
    }
  }, [state]);

  return (
    <main className="auth-scene grain min-h-screen px-4 py-6 sm:px-6 sm:py-8" data-testid="verify-email-page">
      <div className="mx-auto max-w-4xl rounded-[34px] border border-black/8 bg-white px-6 py-6 shadow-[0_24px_60px_rgba(17,24,39,0.08)] sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 pb-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Email verification</p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[0.95] tracking-tight text-[#171717] sm:text-[2.6rem]">
              {title}
            </h1>
          </div>
          <div className="rounded-full border border-black/10 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-stone-500">
            {state === "success" || state === "verified"
              ? "verified"
              : state === "confirming"
                ? "processing"
                : "pending"}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_320px]">
          <section className="rounded-[30px] border border-black/8 bg-[#fbfaf7] px-6 py-6 shadow-[0_16px_36px_rgba(17,24,39,0.05)]">
            <p className="text-sm leading-7 text-stone-600">{description}</p>

            {message ? (
              <div
                className={`mt-5 rounded-[22px] border px-4 py-4 text-sm ${
                  state === "success" || state === "verified"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : state === "invalid" || state === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-stone-200 bg-white text-stone-600"
                }`}
                data-testid="verify-email-status-message"
              >
                {message}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/chat"
                className="rounded-[20px] bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
              >
                Перейти в чат
              </Link>
              <Link
                href="/profile"
                className="rounded-[20px] border border-black/10 bg-white px-5 py-3 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black"
              >
                Открыть профиль
              </Link>
              {canResend ? (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isResending}
                  data-testid="verify-email-resend-button"
                  className="rounded-[20px] border border-black/10 bg-white px-5 py-3 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResending ? "Отправляем..." : "Отправить письмо еще раз"}
                </button>
              ) : null}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.05)]">
              <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Status</p>
              <p className="mt-3 text-sm text-[#171717]">
                {user?.emailVerifiedAt
                  ? "Email уже подтвержден в аккаунте."
                  : user?.emailVerificationSentAt
                    ? "Последняя отправка письма уже зафиксирована."
                    : "Письмо будет сгенерировано при регистрации или по кнопке повторной отправки."}
              </p>
            </div>

            {previewUrl ? (
              <div className="rounded-[28px] border border-black/8 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.05)]" data-testid="verify-email-preview-card">
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Dev preview</p>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  В локальной разработке письмо заменяется этой ссылкой подтверждения.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    href={previewUrl}
                    className="rounded-[18px] bg-[#111111] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black"
                    data-testid="verify-email-open-preview-link"
                  >
                    Открыть ссылку
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyPreviewLink}
                    disabled={isCopying}
                    className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm font-medium text-stone-600 transition hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCopying ? "Копируем..." : "Скопировать"}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
