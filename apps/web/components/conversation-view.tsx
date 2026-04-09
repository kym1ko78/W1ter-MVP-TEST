"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { readJson, useAuth } from "../lib/auth-context";
import {
  appendMessageUnique,
  dedupeMessages,
  normalizeMessagePage,
  upsertMessage,
} from "../lib/message-cache";
import { buildAttachmentUrl } from "../lib/config";
import {
  formatConversationDateLabel,
  formatFileSize,
  formatRelativeLastSeen,
  formatTime,
  getChatTitle,
  getConversationDayKey,
} from "../lib/utils";
import type { ChatAttachment, ChatListItem, ChatMessage, MessagePage } from "../types/api";
import { ConfirmDialog } from "./confirm-dialog";

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

type ConversationRenderItem =
  | {
      type: "date";
      key: string;
      label: string;
    }
  | {
      type: "message";
      key: string;
      message: ChatMessage;
    };

export function ConversationView({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const { accessToken, authorizedFetch, isAuthenticated, user } = useAuth();
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [confirmingMessage, setConfirmingMessage] = useState<ChatMessage | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageListEndRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollAfterSendRef = useRef(false);

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

  const renderItems = useMemo<ConversationRenderItem[]>(() => {
    const items: ConversationRenderItem[] = [];
    let previousDayKey: string | null = null;

    for (const message of messageItems) {
      const dayKey = getConversationDayKey(message.createdAt);

      if (dayKey !== previousDayKey) {
        items.push({
          type: "date",
          key: `date-${dayKey}-${message.id}`,
          label: formatConversationDateLabel(message.createdAt),
        });
        previousDayKey = dayKey;
      }

      items.push({
        type: "message",
        key: message.id,
        message,
      });
    }

    return items;
  }, [messageItems]);

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
      shouldScrollAfterSendRef.current = true;
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

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) =>
      readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages/${messageId}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagePage>(["messages", chatId], (old) =>
        upsertMessage(old, message),
      );
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
    onSettled: () => {
      setConfirmingMessage(null);
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

    if (!lastMessage || lastMessage.senderId === user?.id || lastMessage.isDeleted) {
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

  useEffect(() => {
    if (!shouldScrollAfterSendRef.current || messageItems.length === 0) {
      return;
    }

    const scrollToBottom = () => {
      const endElement = messageListEndRef.current;
      const listElement = messageListRef.current;

      if (endElement) {
        endElement.scrollIntoView({ block: "end", behavior: "smooth" });
      } else if (listElement) {
        listElement.scrollTo({ top: listElement.scrollHeight, behavior: "smooth" });
      }

      shouldScrollAfterSendRef.current = false;
    };

    const frameId = window.requestAnimationFrame(scrollToBottom);

    return () => window.cancelAnimationFrame(frameId);
  }, [messageItems]);

  const otherUser = useMemo(
    () => chatQuery.data?.members.find((member) => member.id !== user?.id) ?? null,
    [chatQuery.data?.members, user?.id],
  );
  const hasComposerContent = Boolean(draft.trim() || pendingFile);
  const showSendButton = hasComposerContent || sendMessageMutation.isPending;

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

  const submitComposer = () => {
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitComposer();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const selectionStart = target.selectionStart ?? draft.length;
      const selectionEnd = target.selectionEnd ?? draft.length;
      const nextValue = `${draft.slice(0, selectionStart)}\n${draft.slice(selectionEnd)}`;

      setDraft(nextValue);
      if (composerError) {
        setComposerError(null);
      }

      queueMicrotask(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }

        const cursorPosition = selectionStart + 1;
        textarea.selectionStart = cursorPosition;
        textarea.selectionEnd = cursorPosition;
      });
      return;
    }

    if (event.shiftKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    submitComposer();
  };

  const handleDeleteMessage = (message: ChatMessage) => {
    if (deleteMessageMutation.isPending) {
      return;
    }

    setConfirmingMessage(message);
  };

  if (chatQuery.isLoading || messagesQuery.isLoading) {
    return <ConversationSkeleton />;
  }

  if (!chatQuery.data || !messagesQuery.data) {
    return (
      <div className="chat-shell-panel flex h-full min-h-0 items-center justify-center rounded-none border-0 text-stone-600">
        Не удалось загрузить чат.
      </div>
    );
  }

  return (
    <section
      className="chat-shell-panel chat-thread-surface flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0"
      data-testid="conversation-view"
    >
      <header className="relative z-10 flex flex-none items-center justify-between gap-4 border-b border-black/8 px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-[#111111] text-sm font-semibold text-white">
            {getInitials(getChatTitle(chatQuery.data.members, user?.id))}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-stone-400">Direct chat</p>
            <h2
              className="truncate text-lg font-semibold tracking-tight text-[#171717]"
              data-testid="conversation-title"
            >
              {getChatTitle(chatQuery.data.members, user?.id)}
            </h2>
            <p className="truncate text-sm text-stone-500" data-testid="conversation-status">
              {otherUser?.lastSeenAt
                ? `Был(а) ${formatRelativeLastSeen(otherUser.lastSeenAt)}`
                : "Личный чат"}
            </p>
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-stone-500">
          {chatQuery.data.unreadCount > 0 ? `Unread ${chatQuery.data.unreadCount}` : "Direct"}
        </div>
      </header>

      <div
        ref={messageListRef}
        className="scroll-region-y relative z-10 flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-5 sm:px-6"
        data-testid="message-list"
      >
        {renderItems.map((item) => {
          if (item.type === "date") {
            return (
              <div
                key={item.key}
                className="flex justify-center py-1"
                data-testid="message-date-separator"
              >
                <div className="rounded-full border border-black/8 bg-white/95 px-4 py-1 text-xs font-medium tracking-[0.02em] text-stone-500 shadow-sm">
                  {item.label}
                </div>
              </div>
            );
          }

          const { message } = item;
          const isMine = message.senderId === user?.id;
          const normalizedBody = message.body?.trim() ?? "";
          const hasText = Boolean(normalizedBody);
          const hasAttachments = message.attachments.length > 0;
          const inlineMetaBubble = hasText && !hasAttachments;
          const compactBubble = inlineMetaBubble;
          const shortTextOnlyBubble =
            inlineMetaBubble && normalizedBody.length <= 8 && !normalizedBody.includes("\n");

          return (
            <div
              key={item.key}
              data-testid="message-item"
              data-message-id={message.id}
              data-message-owner={isMine ? "self" : "other"}
              className={clsx("group flex w-full", isMine ? "justify-end" : "justify-start")}
            >
              <div
                className={clsx(
                  "flex items-start gap-2",
                  isMine ? "ml-auto max-w-[85%] sm:max-w-[70%]" : "max-w-[85%] sm:max-w-[70%]",
                )}
              >
                {isMine ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteMessage(message)}
                    data-testid="delete-message-button"
                    className="mt-1 rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500 opacity-0 transition hover:border-black/25 hover:text-black group-hover:opacity-100"
                  >
                    {deleteMessageMutation.isPending ? "..." : "Удалить"}
                  </button>
                ) : null}
                <div
                  className={clsx(
                    "w-fit max-w-full shadow-sm",
                    shortTextOnlyBubble
                      ? "rounded-[13px] px-2.5 py-0.5"
                      : compactBubble
                        ? "rounded-[17px] px-2.5 py-1"
                        : "rounded-[22px] px-4 py-2.5",
                    isMine
                      ? "bg-[#111111] text-white"
                      : "border border-black/8 bg-white text-[#171717]",
                  )}
                >
                  {inlineMetaBubble && message.body ? (
                    <div
                      className={clsx(
                        "grid grid-cols-[minmax(0,1fr)_auto] items-end",
                        shortTextOnlyBubble ? "gap-x-1" : "gap-x-1.5",
                      )}
                    >
                      <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-5">
                        {message.body}
                      </p>
                      <p
                        className={clsx(
                          "shrink-0 self-end pb-0 text-[11px] leading-none",
                          isMine ? "text-white/62" : "text-stone-400",
                        )}
                      >
                        {formatTime(message.createdAt)}
                      </p>
                    </div>
                  ) : null}
                  {message.body && !inlineMetaBubble ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p>
                  ) : null}
                  {message.attachments.length > 0 ? (
                    <MessageAttachments
                      accessToken={accessToken}
                      attachments={message.attachments}
                      isMine={isMine}
                    />
                  ) : null}
                  {!inlineMetaBubble ? (
                    <p
                      className={clsx(
                        hasText ? "mt-1 text-right text-[11px] leading-none" : "mt-1.5 text-right text-[11px] leading-none",
                        isMine ? "text-white/62" : "text-stone-400",
                      )}
                    >
                      {formatTime(message.createdAt)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messageListEndRef} aria-hidden="true" />
      </div>

      <form onSubmit={handleSubmit} className="relative z-10 flex-none border-t border-black/8 p-4 sm:p-5">
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
            className="mb-3 rounded-[18px] border border-black/10 bg-black px-4 py-3 text-sm text-white"
            data-testid="composer-error"
          >
            {composerError}
          </div>
        ) : null}

        {pendingFile ? (
          <div
            className="mb-3 flex items-center justify-between gap-3 rounded-[20px] border border-black/8 bg-white px-4 py-3 shadow-[0_12px_24px_rgba(17,24,39,0.04)]"
            data-testid="attachment-preview"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#171717]">{pendingFile.name}</p>
              <p className="text-xs text-stone-500">{formatFileSize(pendingFile.size)}</p>
            </div>
            <button
              type="button"
              onClick={clearPendingFile}
              className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-stone-600 transition hover:border-black/25 hover:text-black"
            >
              Убрать
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[27px] border border-black/8 bg-white pl-2 pr-3 py-1.5 shadow-[0_14px_24px_rgba(17,24,39,0.045)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/10 bg-[#f7f7f5] text-stone-500 transition hover:border-black/25 hover:bg-white hover:text-black"
              data-testid="attachment-picker-button"
              aria-label="Прикрепить файл"
              title="Прикрепить файл"
            >
              <PaperclipIcon className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
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
                onKeyDown={handleComposerKeyDown}
                rows={1}
                maxLength={MESSAGE_MAX_LENGTH}
                placeholder="Сообщение..."
                className="h-[44px] min-h-[44px] max-h-[200px] w-full resize-none overflow-y-hidden border border-transparent bg-transparent px-1 py-[9px] leading-[26px] text-[#171717] outline-none transition placeholder:text-stone-400"
              />

              <div className="mt-0 flex justify-end px-1 pb-0">
                <p data-testid="message-counter" className="shrink-0 text-[10px] text-stone-400">
                  {draft.length}/{MESSAGE_MAX_LENGTH}
                </p>
              </div>
            </div>
          </div>

          <div
            className={clsx(
              "self-center overflow-hidden transition-all duration-200 ease-out",
              showSendButton ? "w-12 opacity-100" : "pointer-events-none w-0 opacity-0",
            )}
          >
            <button
              data-testid="send-message-button"
              type="submit"
              disabled={sendMessageMutation.isPending || !hasComposerContent}
              tabIndex={showSendButton ? 0 : -1}
              aria-label="Отправить сообщение"
              title="Отправить сообщение"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#111111] text-white transition hover:translate-y-[-1px] hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
            >
              {sendMessageMutation.isPending ? (
                <span className="text-sm font-semibold leading-none">...</span>
              ) : (
                <SendIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={Boolean(confirmingMessage)}
        title="Удалить это сообщение?"
        description="Сообщение исчезнет из переписки у участников этого чата."
        isLoading={deleteMessageMutation.isPending}
        onCancel={() => {
          if (!deleteMessageMutation.isPending) {
            setConfirmingMessage(null);
          }
        }}
        onConfirm={() => {
          if (confirmingMessage) {
            deleteMessageMutation.mutate(confirmingMessage.id);
          }
        }}
      />
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
              className="block overflow-hidden rounded-[18px] border border-black/10 bg-black/5"
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
                  isMine ? "bg-white/8 text-white/85" : "bg-stone-50 text-stone-600",
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
              "flex items-center justify-between gap-3 rounded-[16px] border px-3 py-3 text-sm transition hover:translate-y-[-1px]",
              isMine
                ? "border-white/14 bg-white/6 text-white"
                : "border-black/8 bg-stone-50 text-[#171717]",
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
    <div className="chat-shell-panel flex h-full min-h-0 animate-pulse flex-col overflow-hidden rounded-none border-0 p-5">
      <div className="h-16 rounded-[22px] bg-stone-200/70" />
      <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-hidden">
        <div className="h-20 w-2/3 rounded-[22px] bg-stone-200/60" />
        <div className="ml-auto h-16 w-1/2 rounded-[22px] bg-stone-200/60" />
        <div className="h-20 w-3/4 rounded-[22px] bg-stone-200/60" />
      </div>
      <div className="mt-5 h-24 rounded-[24px] bg-stone-200/60" />
    </div>
  );
}

function getInitials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "W";
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4Z" />
    </svg>
  );
}
