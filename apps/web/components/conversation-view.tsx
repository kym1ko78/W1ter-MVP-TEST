"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { readJson, useAuth } from "../lib/auth-context";
import {
  appendMessageUnique,
  dedupeMessages,
  normalizeMessagePage,
} from "../lib/message-cache";
import { buildAttachmentUrl } from "../lib/config";
import {
  formatFileSize,
  formatRelativeLastSeen,
  formatTime,
  getChatTitle,
} from "../lib/utils";
import type { ChatAttachment, ChatListItem, ChatMessage, MessagePage } from "../types/api";

const MESSAGE_MAX_LENGTH = 4000;
const COMPOSER_MIN_HEIGHT = 56;
const COMPOSER_MAX_HEIGHT = 200;
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
].join(",");
const ATTACHMENT_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

type ComposerPayload = {
  body: string;
  file: File | null;
};

export function ConversationView({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const { accessToken, authorizedFetch, isAuthenticated, user } = useAuth();
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    mutationFn: async ({ body, file }: ComposerPayload) => {
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        if (body) {
          formData.append("body", body);
        }

        return readJson<ChatMessage>(
          await authorizedFetch(`/chats/${chatId}/attachments`, {
            method: "POST",
            body: formData,
          }),
        );
      }

      return readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body }),
        }),
      );
    },
    onSuccess: (message) => {
      queryClient.setQueryData<MessagePage>(["messages", chatId], (old) =>
        appendMessageUnique(old, message),
      );
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
      setComposerError(null);
      setDraft("");
      setPendingFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
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
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    element.style.height = `${COMPOSER_MIN_HEIGHT}px`;
    const nextHeight = Math.min(
      Math.max(element.scrollHeight, COMPOSER_MIN_HEIGHT),
      COMPOSER_MAX_HEIGHT,
    );

    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);

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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;

    if (!selectedFile) {
      setPendingFile(null);
      return;
    }

    if (!ATTACHMENT_ALLOWED_TYPES.has(selectedFile.type)) {
      setComposerError("Поддерживаются только PNG, JPEG, WEBP, PDF и TXT файлы.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > ATTACHMENT_MAX_BYTES) {
      setComposerError("Размер файла не должен превышать 10 MB.");
      event.target.value = "";
      return;
    }

    setComposerError(null);
    setPendingFile(selectedFile);
  };

  const clearPendingFile = () => {
    setPendingFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const body = draft.trim();
    if ((!body && !pendingFile) || sendMessageMutation.isPending) {
      return;
    }

    if (body.length > MESSAGE_MAX_LENGTH) {
      setComposerError(`Сообщение не должно превышать ${MESSAGE_MAX_LENGTH} символов.`);
      return;
    }

    setComposerError(null);
    sendMessageMutation.mutate({ body, file: pendingFile });
  };

  if (chatQuery.isLoading || messagesQuery.isLoading) {
    return <ConversationSkeleton />;
  }

  if (!chatQuery.data || !messagesQuery.data) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-[28px] bg-white/50 text-stone-600">
        Не удалось загрузить чат.
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[rgba(255,251,245,0.82)] shadow-panel backdrop-blur"
      data-testid="conversation-view"
    >
      <header className="flex flex-none items-center justify-between border-b border-stone-200/80 px-5 py-4">
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

      <div className="scroll-region-y flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-5 sm:px-6" data-testid="message-list">
        {messageItems.map((message) => {
          const isMine = message.senderId === user?.id;
          const normalizedBody = message.body?.trim() ?? "";
          const hasText = Boolean(normalizedBody);
          const hasAttachments = message.attachments.length > 0;
          const compactBubble = hasText && !hasAttachments;
          const shortTextOnlyBubble =
            compactBubble && normalizedBody.length <= 8 && !normalizedBody.includes("\n");

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
                  "max-w-[85%] shadow-sm sm:max-w-[70%]",
                  shortTextOnlyBubble
                    ? "rounded-[19px] px-3 py-1.5"
                    : compactBubble
                      ? "rounded-[21px] px-3.5 py-1.5"
                      : "rounded-[24px] px-4 py-2.5",
                  isMine
                    ? "bg-[linear-gradient(135deg,#d17c43,#af5f2d)] text-white"
                    : "border border-stone-200 bg-white text-ink",
                )}
              >
                {!isMine ? (
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] leading-none text-stone-500">
                    {message.sender.displayName}
                  </p>
                ) : null}
                {message.body ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p>
                ) : null}
                {message.attachments.length > 0 ? (
                  <MessageAttachments
                    accessToken={accessToken}
                    attachments={message.attachments}
                    isMine={isMine}
                  />
                ) : null}
                <p
                  className={clsx(
                    shortTextOnlyBubble ? "mt-0.5 text-right text-[11px] leading-none" : "mt-1 text-right text-[11px] leading-none",
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

      <form onSubmit={handleSubmit} className="flex-none border-t border-stone-200/80 p-4 sm:p-5">
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
          data-testid="attachment-input"
        />

        {composerError ? (
          <div
            className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            data-testid="composer-error"
          >
            {composerError}
          </div>
        ) : null}

        {pendingFile ? (
          <div
            className="mb-3 flex items-center justify-between gap-3 rounded-[22px] border border-stone-200 bg-white/80 px-4 py-3"
            data-testid="attachment-preview"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{pendingFile.name}</p>
              <p className="text-xs text-stone-500">{formatFileSize(pendingFile.size)}</p>
            </div>
            <button
              type="button"
              onClick={clearPendingFile}
              className="rounded-full border border-stone-200 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-stone-600 transition hover:border-rose-300 hover:text-rose-700"
            >
              Убрать
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <textarea
            ref={textareaRef}
            data-testid="message-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (composerError) {
                setComposerError(null);
              }
            }}
            rows={1}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="Напишите сообщение..."
            className="h-14 min-h-14 max-h-[200px] flex-1 resize-none overflow-y-hidden rounded-[24px] border border-stone-200 bg-white/85 px-4 py-4 leading-6 outline-none transition focus:border-clay focus:ring-4 focus:ring-clay/10"
          />
          <button
            data-testid="send-message-button"
            type="submit"
            disabled={sendMessageMutation.isPending || (!draft.trim() && !pendingFile)}
            className="h-14 rounded-[24px] bg-[linear-gradient(135deg,#0f766e,#0b5c56)] px-5 text-sm font-semibold text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-55 sm:w-[180px]"
          >
            {sendMessageMutation.isPending ? (pendingFile ? "Загрузка..." : "Отправка...") : "Отправить"}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-stone-200 bg-white/75 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-stone-600 transition hover:border-clay hover:text-clay"
            data-testid="attachment-picker-button"
          >
            Прикрепить файл
          </button>
          <p className="text-right text-xs text-stone-500" data-testid="message-counter">
            {draft.length}/{MESSAGE_MAX_LENGTH}
          </p>
        </div>
      </form>
    </section>
  );
}

function MessageAttachments({
  accessToken,
  attachments,
  isMine,
}: {
  accessToken: string | null;
  attachments: ChatAttachment[];
  isMine: boolean;
}) {
  return (
    <div className={clsx("space-y-2", attachments.length > 0 && "mt-3")}>
      {attachments.map((attachment) => {
        const downloadUrl = buildAttachmentUrl(attachment.downloadPath, accessToken);

        if (attachment.isImage) {
          return (
            <a
              key={attachment.id}
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-[20px] border border-black/10 bg-black/5"
              data-testid="message-attachment"
            >
              <img
                src={downloadUrl}
                alt={attachment.originalName}
                className="max-h-72 w-full object-cover"
                loading="lazy"
              />
              <div
                className={clsx(
                  "flex items-center justify-between gap-3 px-3 py-2 text-xs",
                  isMine ? "bg-black/10 text-white/85" : "bg-stone-50 text-stone-600",
                )}
              >
                <span className="truncate">{attachment.originalName}</span>
                <span className="shrink-0">{formatFileSize(attachment.sizeBytes)}</span>
              </div>
            </a>
          );
        }

        return (
          <a
            key={attachment.id}
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              "flex items-center justify-between gap-3 rounded-[18px] border px-3 py-3 text-sm transition hover:translate-y-[-1px]",
              isMine
                ? "border-white/20 bg-black/10 text-white"
                : "border-stone-200 bg-stone-50 text-ink",
            )}
            data-testid="message-attachment"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">{attachment.originalName}</p>
              <p className={clsx("text-xs", isMine ? "text-white/75" : "text-stone-500")}>
                {attachment.mimeType} · {formatFileSize(attachment.sizeBytes)}
              </p>
            </div>
            <span className="shrink-0 text-xs uppercase tracking-[0.16em]">Open</span>
          </a>
        );
      })}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex h-full min-h-0 animate-pulse flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[rgba(255,251,245,0.82)] p-5">
      <div className="h-16 rounded-2xl bg-stone-200/70" />
      <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-hidden">
        <div className="h-20 w-2/3 rounded-3xl bg-stone-200/60" />
        <div className="ml-auto h-16 w-1/2 rounded-3xl bg-stone-200/60" />
        <div className="h-20 w-3/4 rounded-3xl bg-stone-200/60" />
      </div>
      <div className="mt-5 h-24 rounded-[24px] bg-stone-200/60" />
    </div>
  );
}