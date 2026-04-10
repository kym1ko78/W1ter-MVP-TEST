"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { ConfirmDialog } from "./confirm-dialog";
import { readJson, useAuth } from "../lib/auth-context";
import { appendMessageUnique, upsertMessage } from "../lib/message-cache";
import { SOCKET_URL } from "../lib/config";
import {
  formatRelativeLastSeen,
  formatTime,
  getChatTitle,
  getLastMessagePreviewText,
} from "../lib/utils";
import type { ChatListItem, ChatMessage, MessagePage, SafeUser } from "../types/api";
import { UserAvatar } from "./user-avatar";

const CHAT_PAGE_LOCK_CLASS = "chat-page-locked";

type ChatDeletedPayload = {
  chatId: string;
};

type DeleteChatResponse = {
  success: boolean;
  chatId: string;
};

export function ChatShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const safePathname = pathname ?? "/";
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const { accessToken, authorizedFetch, isAuthenticated, isLoading, logout, user } = useAuth();
  const [search, setSearch] = useState("");
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [confirmingChatId, setConfirmingChatId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const currentChatId = useMemo(() => {
    const segments = safePathname.split("/").filter(Boolean);
    if (segments[0] === "chat" && segments[1]) {
      return segments[1];
    }

    return null;
  }, [safePathname]);

  const chatsQuery = useQuery({
    queryKey: ["chats"],
    enabled: isAuthenticated,
    queryFn: async () => readJson<ChatListItem[]>(await authorizedFetch("/chats")),
  });

  const searchUsersQuery = useQuery({
    queryKey: ["user-search", deferredSearch],
    enabled: isAuthenticated && deferredSearch.trim().length > 1,
    queryFn: async () =>
      readJson<SafeUser[]>(
        await authorizedFetch(`/users/search?query=${encodeURIComponent(deferredSearch.trim())}`),
      ),
  });

  const createDirectChatMutation = useMutation({
    mutationFn: async (targetUserId: string) =>
      readJson<ChatListItem>(
        await authorizedFetch("/chats/direct", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetUserId }),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      setSearch("");
      startTransition(() => {
        router.replace("/chat");
      });
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (chatId: string) =>
      readJson<DeleteChatResponse>(
        await authorizedFetch(`/chats/${chatId}`, {
          method: "DELETE",
        }),
      ),
    onMutate: (chatId) => {
      setDeletingChatId(chatId);
    },
    onSuccess: ({ chatId }) => {
      queryClient.removeQueries({ queryKey: ["chat", chatId] });
      queryClient.removeQueries({ queryKey: ["messages", chatId] });
      queryClient.setQueryData<ChatListItem[] | undefined>(["chats"], (old) =>
        old?.filter((chat) => chat.id !== chatId),
      );
      if (currentChatId === chatId) {
        startTransition(() => {
          router.replace("/chat");
        });
      }
    },
    onSettled: () => {
      setDeletingChatId(null);
      setConfirmingChatId(null);
    },
  });

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const rootElement = document.documentElement;
    const bodyElement = document.body;

    rootElement.classList.add(CHAT_PAGE_LOCK_CLASS);
    bodyElement.classList.add(CHAT_PAGE_LOCK_CLASS);

    return () => {
      rootElement.classList.remove(CHAT_PAGE_LOCK_CLASS);
      bodyElement.classList.remove(CHAT_PAGE_LOCK_CLASS);
    };
  }, []);

  useEffect(() => {
    if (!accessToken || socketRef.current) {
      return;
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      withCredentials: true,
      auth: {
        token: accessToken,
      },
    });

    socket.on("message:new", (message: ChatMessage) => {
      queryClient.setQueryData<MessagePage>(["messages", message.chatId], (old) =>
        appendMessageUnique(old, message),
      );

      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", message.chatId] });
    });

    socket.on("message:updated", (message: ChatMessage) => {
      queryClient.setQueryData<MessagePage>(["messages", message.chatId], (old) =>
        upsertMessage(old, message),
      );

      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", message.chatId] });
    });

    socket.on("chat:updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    });

    socket.on("chat:deleted", (payload: ChatDeletedPayload) => {
      queryClient.setQueryData<ChatListItem[] | undefined>(["chats"], (old) =>
        old?.filter((chat) => chat.id !== payload.chatId),
      );
      queryClient.removeQueries({ queryKey: ["chat", payload.chatId] });
      queryClient.removeQueries({ queryKey: ["messages", payload.chatId] });
      if (currentChatId === payload.chatId) {
        startTransition(() => {
          router.replace("/chat");
        });
      }
    });

    socket.on("chat:read", () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    });

    socket.on("presence:changed", () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      if (currentChatId) {
        void queryClient.invalidateQueries({ queryKey: ["chat", currentChatId] });
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, currentChatId, queryClient, router]);

  useEffect(() => {
    if (!currentChatId || !socketRef.current) {
      return;
    }

    socketRef.current.emit("join_chat_room", { chatId: currentChatId });
  }, [currentChatId]);


  const handleDeleteChat = (chatId: string) => {
    if (deleteChatMutation.isPending) {
      return;
    }

    setConfirmingChatId(chatId);
  };

  const confirmingChat = chatsQuery.data?.find((chat) => chat.id === confirmingChatId) ?? null;

  if (isLoading || !isAuthenticated) {
    return (
      <div className="chat-scene flex h-[100dvh] items-center justify-center px-3 py-3 sm:px-5 sm:py-5">
        <div className="border-b border-black/8 bg-white/90 px-5 py-3 text-sm text-stone-600 shadow-panel">
          Подготавливаем рабочее пространство...
        </div>
      </div>
    );
  }

  return (
    <main className="chat-scene grain h-[100dvh] overflow-hidden" data-testid="chat-shell">
      <div className="grid h-full min-h-0 grid-rows-[360px_minmax(0,1fr)] gap-0 lg:grid-cols-[380px_minmax(0,1fr)] lg:grid-rows-1">
        <aside
          className="chat-shell-panel flex min-h-0 flex-col overflow-hidden rounded-none border-0 border-r border-black/8 p-4 sm:p-5"
          data-testid="chat-sidebar"
        >
          <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
            <Link
              href="/profile"
              data-testid="profile-link"
              className="flex min-w-0 items-start gap-3 rounded-[24px] border border-transparent pr-2 transition hover:border-black/8 hover:bg-black/[0.02]"
            >
              <UserAvatar
                user={user}
                accessToken={accessToken}
                className="h-14 w-14 shrink-0 rounded-[18px]"
                fallbackClassName="text-base"
              />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.28em] text-stone-400">Messenger</p>
                <h1 className="mt-2 truncate text-[1.75rem] font-semibold leading-none tracking-tight text-[#171717]">
                  {user?.displayName}
                </h1>
                <p className="mt-2 truncate text-sm text-stone-500">{user?.email}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-stone-400">
                  Открыть профиль
                </p>
              </div>
            </Link>
            <button
              data-testid="logout-button"
              type="button"
              onClick={() => void logout()}
              className="shrink-0 rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] font-medium uppercase tracking-[0.2em] text-stone-600 transition hover:border-black hover:bg-black hover:text-white"
            >
              Exit
            </button>
          </div>

          <div className="relative z-10 space-y-3">
            <label className="block">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.24em] text-stone-400">
                Найти пользователя
              </span>
              <input
                data-testid="user-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Имя или email"
                className="w-full rounded-[20px] border border-black/8 bg-[#f7f7f5] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              />
            </label>

            {deferredSearch.trim().length > 1 ? (
              <div
                className="scroll-region-y max-h-52 overflow-y-auto rounded-[24px] border border-black/8 bg-white p-2 shadow-[0_18px_30px_rgba(17,24,39,0.06)]"
                data-testid="user-search-results"
              >
                {searchUsersQuery.isLoading ? (
                  <p className="px-3 py-4 text-sm text-stone-500">Ищем пользователей...</p>
                ) : searchUsersQuery.data?.length ? (
                  <div className="space-y-2">
                    {searchUsersQuery.data.map((foundUser) => (
                      <button
                        key={foundUser.id}
                        data-testid="user-search-result"
                        type="button"
                        onClick={() => createDirectChatMutation.mutate(foundUser.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-transparent px-3 py-3 text-left transition hover:border-black/8 hover:bg-[#f7f7f5]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar
                            user={foundUser}
                            accessToken={accessToken}
                            className="h-11 w-11 shrink-0 rounded-[14px]"
                            fallbackClassName="text-sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#171717]">
                              {foundUser.displayName}
                            </p>
                            <p className="truncate text-xs text-stone-500">{foundUser.email}</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                          {createDirectChatMutation.isPending ? "..." : "Direct"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-4 text-sm text-stone-500">Ничего не найдено.</p>
                )}
              </div>
            ) : null}
          </div>

          <div className="relative z-10 mt-6 flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Ваши чаты</p>
              <span className="rounded-full border border-black/8 bg-[#111111] px-2.5 py-1 text-xs font-semibold text-white">
                {chatsQuery.data?.length ?? 0}
              </span>
            </div>

            <div
              className="scroll-region-y min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
              data-testid="chat-list"
            >
              {chatsQuery.isLoading ? (
                <>
                  <SidebarSkeleton />
                  <SidebarSkeleton />
                  <SidebarSkeleton />
                </>
              ) : chatsQuery.data?.length ? (
                chatsQuery.data.map((chat) => {
                  const title = getChatTitle(chat.members, user?.id);
                  const partner = chat.members.find((member) => member.id !== user?.id);
                  const isActive = currentChatId === chat.id;
                  const isDeleting = deletingChatId === chat.id;

                  return (
                    <div
                      key={chat.id}
                      data-testid="chat-list-entry"
                      className={clsx(
                        "group rounded-[26px] border px-4 py-3 transition",
                        isActive
                          ? "border-black bg-[#151515] text-white shadow-[0_22px_34px_rgba(17,24,39,0.14)]"
                          : "border-black/6 bg-white/92 hover:border-black/14 hover:bg-white",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <UserAvatar
                          user={partner ?? { displayName: title, email: title, avatarUrl: null }}
                          accessToken={accessToken}
                          className="h-12 w-12 shrink-0 rounded-[16px]"
                          fallbackClassName={clsx(
                            "text-sm",
                            isActive ? "bg-white text-[#111111]" : "bg-[#111111] text-white",
                          )}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <Link
                              data-testid="chat-list-item"
                              href={`/chat/${chat.id}`}
                              className="min-w-0 flex-1"
                            >
                              <p
                                className={clsx(
                                  "truncate text-sm font-semibold",
                                  isActive ? "text-white" : "text-[#171717]",
                                )}
                              >
                                {title}
                              </p>
                              <p
                                className={clsx(
                                  "mt-1 truncate text-xs",
                                  isActive ? "text-white/60" : "text-stone-500",
                                )}
                              >
                                {partner?.lastSeenAt
                                  ? `Был(а) ${formatRelativeLastSeen(partner.lastSeenAt)}`
                                  : "Личный чат"}
                              </p>
                            </Link>

                            <div className="shrink-0 text-right">
                              <p
                                className={clsx(
                                  "text-[10px] uppercase tracking-[0.16em]",
                                  isActive ? "text-white/45" : "text-stone-400",
                                )}
                              >
                                {chat.lastMessage ? formatTime(chat.lastMessage.createdAt) : "New"}
                              </p>
                              {chat.unreadCount > 0 ? (
                                <span
                                  data-testid="chat-unread-badge"
                                  className={clsx(
                                    "mt-2 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-1 text-[11px] font-semibold",
                                    isActive ? "bg-white text-[#111111]" : "bg-[#111111] text-white",
                                  )}
                                >
                                  {chat.unreadCount}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleDeleteChat(chat.id)}
                                disabled={deleteChatMutation.isPending}
                                data-testid="chat-list-delete-button"
                                className={clsx(
                                  "mt-2 block rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-60",
                                  isActive
                                    ? "border-white/15 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
                                    : "border-black/10 bg-white text-stone-500 hover:border-black/20 hover:text-black",
                                )}
                              >
                                {isDeleting ? "Удаление..." : "Удалить"}
                              </button>
                            </div>
                          </div>

                          <Link
                            href={`/chat/${chat.id}`}
                            className={clsx(
                              "mt-3 block truncate text-sm",
                              isActive ? "text-white/76" : "text-stone-600",
                            )}
                          >
                            {getLastMessagePreviewText(chat.lastMessage)}
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div
                  className="rounded-[26px] border border-dashed border-black/12 bg-white/80 px-4 py-6 text-sm leading-6 text-stone-600"
                  data-testid="chat-list-empty"
                >
                  Пока нет чатов. Найдите пользователя выше и создайте первый direct chat.
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="min-h-0 min-w-0">{children}</section>
      </div>

      <ConfirmDialog
        open={Boolean(confirmingChatId)}
        title="Удалить этот чат?"
        description={
          confirmingChat
            ? `Диалог с ${getChatTitle(confirmingChat.members, user?.id)} будет удален целиком.`
            : "Диалог будет удален целиком."
        }
        isLoading={deleteChatMutation.isPending}
        onCancel={() => {
          if (!deleteChatMutation.isPending) {
            setConfirmingChatId(null);
          }
        }}
        onConfirm={() => {
          if (confirmingChatId) {
            deleteChatMutation.mutate(confirmingChatId);
          }
        }}
      />
    </main>
  );
}

function SidebarSkeleton() {
  return <div className="h-24 animate-pulse rounded-[24px] border border-black/6 bg-white/80" />;
}
