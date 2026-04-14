export function ChatPlaceholder() {
  return (
    <section
      className="chat-shell-panel chat-placeholder-surface relative flex h-full min-h-0 overflow-hidden rounded-none border-0"
      data-testid="chat-placeholder"
    >
      <div className="relative z-10 flex h-full min-h-0 w-full items-center px-7 py-8 sm:px-10 sm:py-10">
        <div className="max-w-[560px]">
          <h2 className="font-serif text-[3rem] font-semibold leading-[0.96] tracking-[-0.03em] text-[#171717] sm:text-[4rem]">
            Choose a thread
            <br />
            and keep the
            <br />
            workflow clean.
          </h2>
        </div>
      </div>
    </section>
  );
}
