import { Suspense } from "react";
import { VerifyEmailScreen } from "../../components/verify-email-screen";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailScreenFallback />}>
      <VerifyEmailScreen />
    </Suspense>
  );
}

function VerifyEmailScreenFallback() {
  return (
    <main className="auth-scene grain min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl rounded-[34px] border border-black/8 bg-white px-6 py-6 shadow-[0_24px_60px_rgba(17,24,39,0.08)] sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 pb-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
              Email verification
            </p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[0.95] tracking-tight text-[#171717] sm:text-[2.6rem]">
              Подтверждение email
            </h1>
          </div>
          <div className="rounded-full border border-black/10 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-stone-500">
            loading
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_320px]">
          <section className="rounded-[30px] border border-black/8 bg-[#fbfaf7] px-6 py-6 shadow-[0_16px_36px_rgba(17,24,39,0.05)]">
            <p className="text-sm leading-7 text-stone-600">
              Подготавливаем состояние подтверждения и проверяем параметры ссылки.
            </p>
          </section>

          <aside className="rounded-[28px] border border-black/8 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(17,24,39,0.05)]">
            <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Status</p>
            <p className="mt-3 text-sm text-[#171717]">Загрузка данных подтверждения...</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
