import Link from "next/link";

export default function LegacyNotFoundPage() {
  return (
    <main className="grain flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-[32px] border border-white/60 bg-[rgba(255,251,245,0.78)] p-8 text-center shadow-panel backdrop-blur sm:p-10">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">404</p>
        <h1 className="mt-4 text-3xl font-semibold text-ink sm:text-4xl">
          Такой страницы нет
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
          Вернитесь в рабочее пространство мессенджера и продолжайте диалог из списка чатов.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            href="/chat"
            className="rounded-full bg-[linear-gradient(135deg,#d17c43,#af5f2d)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-clay/20 transition hover:translate-y-[-1px]"
          >
            Открыть чат
          </Link>
        </div>
      </div>
    </main>
  );
}
