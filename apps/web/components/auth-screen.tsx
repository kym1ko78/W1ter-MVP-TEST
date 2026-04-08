"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "../lib/auth-context";

const loginSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: z.string().min(8, "Минимум 8 символов"),
});

const registerSchema = loginSchema.extend({
  displayName: z.string().min(2, "Минимум 2 символа").max(50, "Максимум 50 символов"),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type AuthFormValues = {
  email: string;
  password: string;
  displayName: string;
};

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { login, register, isAuthenticated, isLoading } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isRegister = mode === "register";

  const form = useForm<AuthFormValues>({
    resolver: zodResolver((isRegister ? registerSchema : loginSchema) as typeof registerSchema),
    defaultValues: {
      displayName: "",
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/chat");
    }
  }, [isAuthenticated, isLoading, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setErrorMessage(null);

    try {
      if (isRegister) {
        await register(values as RegisterValues);
      } else {
        await login(values as LoginValues);
      }

      router.replace("/chat");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось выполнить вход");
    }
  });

  return (
    <main className="grain flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[32px] border border-white/60 bg-[rgba(255,251,245,0.78)] shadow-panel backdrop-blur">
        <div className="grid min-h-[680px] lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden bg-[linear-gradient(180deg,rgba(16,24,39,0.94),rgba(16,24,39,0.82))] p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.28em] text-white/70">
                Web Messenger MVP
              </span>
              <h1 className="max-w-md text-5xl font-semibold leading-tight">
                Сообщения без перегруза, но с ощущением настоящего продукта.
              </h1>
              <p className="max-w-md text-base leading-7 text-white/72">
                Первая версия мессенджера для личных диалогов, realtime-обновлений и аккуратного
                web-first интерфейса.
              </p>
            </div>

            <div className="grid gap-4 rounded-[24px] border border-white/10 bg-white/5 p-6">
              <div>
                <p className="text-sm uppercase tracking-[0.22em] text-white/55">MVP scope</p>
                <p className="mt-2 text-lg text-white/88">
                  Auth, direct chats, history, unread status, Socket.IO и адаптивный UI.
                </p>
              </div>
              <div className="flex gap-3 text-sm text-white/60">
                <span className="rounded-full border border-white/10 px-3 py-1">Next.js</span>
                <span className="rounded-full border border-white/10 px-3 py-1">NestJS</span>
                <span className="rounded-full border border-white/10 px-3 py-1">PostgreSQL</span>
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center px-6 py-10 sm:px-10">
            <div className="w-full max-w-md space-y-8">
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.24em] text-stone-500">
                  {isRegister ? "Create account" : "Welcome back"}
                </p>
                <h2 className="text-3xl font-semibold text-ink">
                  {isRegister ? "Создайте аккаунт" : "Войдите в рабочее пространство"}
                </h2>
                <p className="text-sm leading-6 text-stone-600">
                  {isRegister
                    ? "Создадим первый аккаунт и сразу попадем в чат-интерфейс."
                    : "Войдите, чтобы продолжить работу с чатами и историей сообщений."}
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4" data-testid="auth-form">
                {isRegister ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-stone-700">Имя</span>
                    <input
                      data-testid="auth-display-name-input"
                      className="w-full rounded-2xl border border-stone-200 bg-white/70 px-4 py-3 outline-none transition focus:border-clay focus:ring-4 focus:ring-clay/10"
                      placeholder="Anna"
                      {...form.register("displayName")}
                    />
                    <FieldError error={form.formState.errors.displayName?.message} />
                  </label>
                ) : null}

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-700">Email</span>
                  <input
                    data-testid="auth-email-input"
                    className="w-full rounded-2xl border border-stone-200 bg-white/70 px-4 py-3 outline-none transition focus:border-clay focus:ring-4 focus:ring-clay/10"
                    placeholder="anna@example.com"
                    {...form.register("email")}
                  />
                  <FieldError error={form.formState.errors.email?.message} />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-700">Пароль</span>
                  <input
                    data-testid="auth-password-input"
                    type="password"
                    className="w-full rounded-2xl border border-stone-200 bg-white/70 px-4 py-3 outline-none transition focus:border-clay focus:ring-4 focus:ring-clay/10"
                    placeholder="Минимум 8 символов"
                    {...form.register("password")}
                  />
                  <FieldError error={form.formState.errors.password?.message} />
                </label>

                {errorMessage ? (
                  <div
                    data-testid="auth-error-message"
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                  >
                    {errorMessage}
                  </div>
                ) : null}

                <button
                  data-testid="auth-submit-button"
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  className={clsx(
                    "w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white transition",
                    "bg-[linear-gradient(135deg,#d17c43,#af5f2d)] shadow-lg shadow-clay/20 hover:translate-y-[-1px]",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {form.formState.isSubmitting
                    ? "Подождите..."
                    : isRegister
                      ? "Создать аккаунт"
                      : "Войти"}
                </button>
              </form>

              <p className="text-sm text-stone-600">
                {isRegister ? "Уже есть аккаунт?" : "Нужен новый аккаунт?"}{" "}
                <Link
                  href={isRegister ? "/login" : "/register"}
                  className="font-semibold text-clay hover:text-[var(--accent-strong)]"
                >
                  {isRegister ? "Войти" : "Зарегистрироваться"}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) {
    return null;
  }

  return <p className="text-sm text-rose-600">{error}</p>;
}