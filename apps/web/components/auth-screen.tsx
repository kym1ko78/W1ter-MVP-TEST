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
      const fallbackMessage = isRegister
        ? "Не удалось создать аккаунт"
        : "Не удалось выполнить вход";

      setErrorMessage(error instanceof Error ? error.message : fallbackMessage);
    }
  });

  return (
    <main className="auth-scene grain min-h-screen">
      <div className="auth-stage-surface relative w-full min-h-screen overflow-hidden bg-white">
        <div className="pointer-events-none absolute left-6 top-6 z-20 sm:left-10 sm:top-8 lg:left-12 lg:top-10">
          <div className="pointer-events-auto flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-black text-sm font-semibold text-white">
              W
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink">W1ter</span>
          </div>
        </div>

        <section className="auth-dark-panel flex min-h-screen items-center justify-center px-6 py-6 sm:px-10 sm:py-8 lg:px-12 lg:py-10">
          <div className="relative flex w-full max-w-[700px] min-h-[420px] flex-col justify-center overflow-hidden rounded-[30px] bg-[#24272d] p-6 text-white sm:p-8">
            <div className="auth-scribble auth-scribble-top" aria-hidden="true" />
            <div className="auth-scribble auth-scribble-bottom" aria-hidden="true" />

            <div className="relative z-10 flex items-center justify-between">
              <div>
                <h2 className="max-w-[320px] text-3xl font-semibold leading-tight text-white sm:text-[2.45rem]">
                  Вход в WR
                </h2>
              </div>
              <div className="mr-8 hidden rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/60 sm:block">
                Alfa
              </div>
            </div>

            <div className="relative z-10 mt-8 flex flex-1 items-center">
              <div className="relative z-10 mx-auto w-full max-w-[420px] rounded-[28px] border border-white/10 bg-white px-5 py-6 text-[#1f2430] shadow-[0_24px_60px_rgba(0,0,0,0.24)] sm:px-7 sm:py-7">
                <form onSubmit={onSubmit} className="space-y-4" data-testid="auth-form">
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
    </main>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) {
    return null;
  }

  return <p className="text-sm text-rose-600">{error}</p>;
}
