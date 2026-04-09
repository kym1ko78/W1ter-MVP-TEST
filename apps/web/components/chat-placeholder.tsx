export function ChatPlaceholder() {
  return (
    <section
      className="chat-shell-panel chat-placeholder-surface relative flex h-full min-h-0 overflow-hidden rounded-none border-0"
      data-testid="chat-placeholder"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="chat-scribble-mark right-0 top-0" />
        <div className="chat-orbit-ring -bottom-10 -left-10 h-32 w-32 opacity-90" />
        <div className="chat-orbit-ring bottom-10 right-12 h-20 w-20 border-[14px] opacity-70" />
      </div>

      <div className="relative z-10 grid h-full min-h-0 w-full lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col justify-between px-7 py-8 sm:px-10 sm:py-10">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-stone-400">Ready to chat</p>
            <h2 className="mt-6 max-w-[560px] font-serif text-[3rem] font-semibold leading-[0.96] tracking-[-0.03em] text-[#171717] sm:text-[4rem]">
              Choose a thread
              <br />
              and keep the
              <br />
              workflow clean.
            </h2>
            <p className="mt-6 max-w-[430px] text-base leading-7 text-stone-500">
              Найдите пользователя слева, создайте direct chat и продолжайте общение в
              собранном рабочем окне без лишнего визуального шума.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <InfoCard title="Direct" copy="Личные диалоги с быстрым входом в контекст." />
            <InfoCard title="Realtime" copy="Сообщения, unread и presence в одном рабочем потоке." />
            <InfoCard title="Focused" copy="Минимум отвлекающих деталей, максимум читаемости." />
          </div>
        </div>

        <div className="relative hidden min-h-0 lg:block">
          <div className="absolute inset-y-0 right-0 w-[58%] bg-[#202329]" />
          <div className="chat-scribble-mark right-0 top-0" />

          <div className="absolute left-10 top-16 w-[240px] rounded-[26px] border border-black/8 bg-white px-6 py-5 shadow-[0_24px_60px_rgba(17,24,39,0.14)]">
            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">Workspace</p>
            <p className="mt-3 text-3xl font-semibold text-[#171717]">01</p>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              Слева список диалогов, справа концентрированное рабочее поле.
            </p>
          </div>

          <div className="absolute bottom-14 left-20 right-10 rounded-[30px] bg-[#202329] p-6 text-white shadow-[0_28px_60px_rgba(17,24,39,0.22)]">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/45">Messaging</p>
                <p className="mt-4 max-w-[260px] text-2xl font-semibold leading-tight">
                  Выберите чат слева и продолжайте без переключения контекста.
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-end gap-2">
                  <span className="h-9 w-7 rounded-full bg-white/85" />
                  <span className="h-14 w-7 rounded-full bg-white/65" />
                  <span className="h-6 w-7 rounded-full bg-white/35" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoCard({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-[24px] border border-black/8 bg-white px-5 py-5 shadow-[0_18px_30px_rgba(17,24,39,0.06)]">
      <p className="text-lg font-semibold tracking-tight text-[#171717]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-500">{copy}</p>
    </div>
  );
}
