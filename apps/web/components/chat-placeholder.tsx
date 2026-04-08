export function ChatPlaceholder() {
  return (
    <div
      className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-stone-300/80 bg-white/45 px-8 text-center"
      data-testid="chat-placeholder"
    >
      <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Ready</p>
      <h2 className="mt-4 text-3xl font-semibold text-ink">Выберите чат слева</h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-stone-600">
        Найдите пользователя, создайте direct chat и продолжайте уже в рабочем окне
        сообщения.
      </p>
    </div>
  );
}