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
    <main className="auth-scene grain min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="relative mx-auto w-full max-w-[1240px] overflow-hidden rounded-[38px] border border-black/6 bg-white shadow-panel">
        <div className="grid min-h-[760px] lg:grid-cols-[1.08fr_0.92fr]">
          <section className="order-2 flex flex-col justify-between bg-white px-6 py-6 sm:px-10 sm:py-8 lg:order-1 lg:px-12 lg:py-10">
            <div>
              <div className="mb-12 flex items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-black text-sm font-semibold text-white">
                    W
                  </span>
                  <span className="text-lg font-semibold tracking-tight text-ink">W1ter</span>
                </div>
                <nav className="hidden items-center gap-8 text-sm text-stone-500 lg:flex">
                  <span>Features</span>
                  <span>Realtime</span>
                  <span>Security</span>
                </nav>
              </div>

              <div className="max-w-[520px]">
                <p className="mb-5 text-xs uppercase tracking-[0.28em] text-stone-400">
                  Web Messenger MVP
                </p>
                <h1 className="font-serif text-[3rem] font-semibold leading-[0.95] tracking-[-0.03em] text-[#1c1c1a] sm:text-[4rem] lg:text-[4.7rem]">
                  Chat
                  <br />
                  For teams
                  <br />
                  that prefer
                  <br />
                  clarity.
                </h1>
                <p className="mt-6 max-w-[420px] text-base leading-7 text-stone-500">
                  Лаконичный вход в рабочее пространство с прямыми диалогами, историей и
                  быстрым realtime-потоком без визуального шума.
                </p>
              </div>

              <div className="mt-10 flex flex-wrap gap-3">
                <div className="rounded-[18px] border border-black/8 bg-[#faf8f4] px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Flow</p>
                  <p className="mt-2 text-sm font-medium text-ink">Login, search, direct chat</p>
                </div>
                <div className="rounded-[18px] border border-black/8 bg-white px-5 py-4 shadow-[0_10px_30px_rgba(17,24,39,0.06)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Realtime</p>
                  <p className="mt-2 text-sm font-medium text-ink">Messages, unread, last seen</p>
                </div>
              </div>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <FeatureCard title="Fast entry" copy="Форма, которая не перегружает пользователя." />
              <FeatureCard title="Calm UI" copy="Чистая типографика и аккуратные состояния." />
              <FeatureCard title="Single flow" copy="Один экран, одна задача, понятный маршрут." />
            </div>
          </section>

          <section className="auth-dark-panel order-1 px-6 py-6 sm:px-10 sm:py-8 lg:order-2 lg:px-10 lg:py-10">
            <div className="relative flex h-full min-h-[420px] flex-col justify-between overflow-hidden rounded-[30px] bg-[#24272d] p-6 text-white sm:p-8">
              <div className="auth-scribble auth-scribble-top" aria-hidden="true" />
              <div className="auth-scribble auth-scribble-bottom" aria-hidden="true" />

              <div className="relative z-10 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.26em] text-white/45">
                    {isRegister ? "Create account" : "Welcome back"}
                  </p>
                  <h2 className="mt-3 max-w-[320px] text-3xl font-semibold leading-tight text-white sm:text-[2.45rem]">
                    {isRegister ? "Создайте ваш вход в продукт." : "Войдите в рабочее пространство."}
                  </h2>
                </div>
                <div className="hidden rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/60 sm:block">
                  live
                </div>
              </div>

              <div className="relative z-10 mt-8 flex-1">
                <div className="auth-float-card auth-float-card-top">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Message flow</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="h-10 w-8 rounded-full bg-black/80" />
                    <span className="h-16 w-8 rounded-full bg-black/65" />
                    <span className="h-8 w-8 rounded-full bg-black/40" />
                    <span className="h-12 w-8 rounded-full bg-black/70" />
                  </div>
                </div>

                <div className="auth-float-card auth-float-card-bottom">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Auth status</p>
                  <p className="mt-3 text-3xl font-semibold text-[#202229]">Ready</p>
                  <p className="mt-2 text-sm leading-6 text-stone-500">
                    Один вход, один экран, прямой путь в chat shell.
                  </p>
                </div>

                <div className="relative z-10 mx-auto mt-6 w-full max-w-[420px] rounded-[28px] border border-white/10 bg-white px-5 py-6 text-[#1f2430] shadow-[0_24px_60px_rgba(0,0,0,0.24)] sm:px-7 sm:py-7">
                  <p className="text-xs uppercase tracking-[0.24em] text-stone-400">
                    {isRegister ? "Create account" : "Sign in"}
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">
                    {isRegister ? "Регистрация" : "Вход"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-500">
                    {isRegister
                      ? "Создайте аккаунт и сразу попадите в мессенджер."
                      : "Введите данные, чтобы продолжить работу с чатами."}
                  </p>

                  <form onSubmit={onSubmit} className="mt-6 space-y-4" data-testid="auth-form">
                    {isRegister ? (
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-stone-700">Имя</span>
                        <input
                          data-testid="auth-display-name-input"
                          className="w-full rounded-[18px] border border-stone-200 bg-[#fbfbfb] px-4 py-3 outline-none transition focus:border-black/70 focus:ring-4 focus:ring-black/5"
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
                        className="w-full rounded-[18px] border border-stone-200 bg-[#fbfbfb] px-4 py-3 outline-none transition focus:border-black/70 focus:ring-4 focus:ring-black/5"
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
                        className="w-full rounded-[18px] border border-stone-200 bg-[#fbfbfb] px-4 py-3 outline-none transition focus:border-black/70 focus:ring-4 focus:ring-black/5"
                        placeholder="Минимум 8 символов"
                        {...form.register("password")}
                      />
                      <FieldError error={form.formState.errors.password?.message} />
                    </label>

                    {errorMessage ? (
                      <div
                        data-testid="auth-error-message"
                        className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                      >
                        {errorMessage}
                      </div>
                    ) : null}

                    <button
                      data-testid="auth-submit-button"
                      type="submit"
                      disabled={form.formState.isSubmitting}
                      className={clsx(
                        "w-full rounded-[18px] px-4 py-3 text-sm font-semibold text-white transition",
                        "bg-[#1f232b] shadow-[0_14px_30px_rgba(31,35,43,0.18)] hover:translate-y-[-1px] hover:bg-black",
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

                  <p className="mt-5 text-sm text-stone-500">
                    {isRegister ? "Уже есть аккаунт?" : "Нужен новый аккаунт?"}{" "}
                    <Link
                      href={isRegister ? "/login" : "/register"}
                      className="font-semibold text-[#1f232b] underline decoration-black/20 underline-offset-4 hover:decoration-black/60"
                    >
                      {isRegister ? "Войти" : "Зарегистрироваться"}
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-[22px] bg-[#25282f] px-5 py-6 text-white shadow-[0_16px_28px_rgba(17,24,39,0.08)]">
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="mt-3 text-sm leading-6 text-white/70">{copy}</p>
    </div>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) {
    return null;
  }

  return <p className="text-sm text-rose-600">{error}</p>;
}
