"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { readJson, useAuth } from "../lib/auth-context";
import {
  appendMessageUnique,
  dedupeMessages,
  normalizeMessagePage,
} from "../lib/message-cache";
import { formatRelativeLastSeen, formatTime, getChatTitle } from "../lib/utils";
import type { ChatListItem, ChatMessage, MessagePage } from "../types/api";

const MESSAGE_MAX_LENGTH = 4000;

export function ConversationView({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const { authorizedFetch, isAuthenticated, user } = useAuth();
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);

  const chatQuery = useQuery({
    queryKey: ["chat", chatId],
    enabled: isAuthenticated,
    queryFn: async () =>
      readJson<ChatListItem>(await authorizedFetch(`/chats/${chatId}`)),
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", chatId],
    enabled: isAuthenticated,
    queryFn: async () =>
      normalizeMessagePage(
        await readJson<MessagePage>(await authorizedFetch(`/chats/${chatId}/messages`)),
      )!,
  });

  const messageItems = useMemo(
    () => dedupeMessages(messagesQuery.data?.items ?? []),
    [messagesQuery.data?.items],
  );

  const sendMessageMutation = useMutation({
    mutationFn: async (body: string) =>
      readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body }),
        }),
      ),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagePage>(["messages", chatId], (old) =>
        appendMessageUnique(old, message),
      );
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      setComposerError(null);
      setDraft("");
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить сообщение. Попробуйте еще раз.",
      );
    },
  });

  useEffect(() => {
    const lastMessage = messageItems[messageItems.length - 1];

    if (!lastMessage || lastMessage.senderId === user?.id) {
      return;
    }

    void authorizedFetch(`/chats/${chatId}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
    });
  }, [authorizedFetch, chatId, messageItems, user?.id]);

  const otherUser = useMemo(
    () => chatQuery.data?.members.find((member) => member.id !== user?.id) ?? null,
    [chatQuery.data?.members, user?.id],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const body = draft.trim();
    if (!body || sendMessageMutation.isPending) {
      return;
    }

    if (body.length > MESSAGE_MAX_LENGTH) {
      setComposerError(`Сообщение не должно превышать ${MESSAGE_MAX_LENGTH} символов.`);
      return;
    }

    setComposerError(null);
    sendMessageMutation.mutate(body);
  };

  if (chatQuery.isLoading || messagesQuery.isLoading) {
    return <ConversationSkeleton />;
  }

  if (!chatQuery.data || !messagesQuery.data) {
    return (
      <div className="flex h-full items-center justify-center rounded-[28px] bg-white/50 text-stone-600">
        Не удалось загрузить чат.
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-[70vh] flex-col rounded-[28px] border border-white/70 bg-[rgba(255,251,245,0.82)] shadow-panel backdrop-blur"
      data-testid="conversation-view"
    >
      <header className="flex items-center justify-between border-b border-stone-200/80 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-ink" data-testid="conversation-title">
            {getChatTitle(chatQuery.data.members, user?.id)}
          </h2>
          <p className="text-sm text-stone-500" data-testid="conversation-status">
            {otherUser?.lastSeenAt ? `Был(а) ${formatRelativeLastSeen(otherUser.lastSeenAt)}` : "Личный чат"}
          </p>
        </div>
        <div className="rounded-full bg-sand px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-stone-600">
          {chatQuery.data.unreadCount > 0 ? `Unread ${chatQuery.data.unreadCount}` : "Direct"}
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6" data-testid="message-list">
        {messageItems.map((message) => {
          const isMine = message.senderId === user?.id;

          return (
            <div
              key={message.id}
              data-testid="message-item"
              data-message-id={message.id}
              data-message-owner={isMine ? "self" : "other"}
              className={clsx("flex", isMine ? "justify-end" : "justify-start")}
            >
              <div
                className={clsx(
                  "max-w-[85%] rounded-[24px] px-4 py-3 shadow-sm sm:max-w-[70%]",
                  isMine
                    ? "bg-[linear-gradient(135deg,#d17c43,#af5f2d)] text-white"
                    : "border border-stone-200 bg-white text-ink",
                )}
              >
                {!isMine ? (
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    {message.sender.displayName}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                <p
                  className={clsx(
                    "mt-2 text-right text-[11px]",
                    isMine ? "text-white/75" : "text-stone-400",
                  )}
                >
                  {formatTime(message.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-stone-200/80 p-4 sm:p-5">
        {composerError ? (
          <div
            className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            data-testid="composer-error"
          >
            {composerError}
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <textarea
            data-testid="message-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (composerError) {
                setComposerError(null);
              }
            }}
            rows={3}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="Напишите сообщение..."
            className="min-h-[72px] flex-1 rounded-[24px] border border-stone-200 bg-white/85 px-4 py-3 outline-none transition focus:border-clay focus:ring-4 focus:ring-clay/10"
          />
          <div className="flex flex-col gap-2 sm:w-[180px]">
            <button
              data-testid="send-message-button"
              type="submit"
              disabled={sendMessageMutation.isPending || !draft.trim()}
              className="rounded-[24px] bg-[linear-gradient(135deg,#0f766e,#0b5c56)] px-5 py-3 text-sm font-semibold text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {sendMessageMutation.isPending ? "Отправка..." : "Отправить"}
            </button>
            <p className="text-right text-xs text-stone-500" data-testid="message-counter">
              {draft.length}/{MESSAGE_MAX_LENGTH}
            </p>
          </div>
        </div>
      </form>
    </section>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex h-full min-h-[70vh] animate-pulse flex-col rounded-[28px] border border-white/70 bg-[rgba(255,251,245,0.82)] p-5">
      <div className="h-16 rounded-2xl bg-stone-200/70" />
      <div className="mt-5 flex-1 space-y-3">
        <div className="h-20 w-2/3 rounded-3xl bg-stone-200/60" />
        <div className="ml-auto h-16 w-1/2 rounded-3xl bg-stone-200/60" />
        <div className="h-20 w-3/4 rounded-3xl bg-stone-200/60" />
      </div>
      <div className="mt-5 h-24 rounded-[24px] bg-stone-200/60" />
    </div>
  );
}