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
import { readJson, useAuth } from "../lib/auth-context";
import { appendMessageUnique } from "../lib/message-cache";
import { SOCKET_URL } from "../lib/config";
import { formatRelativeLastSeen, formatTime, getChatTitle } from "../lib/utils";
import type { ChatListItem, ChatMessage, MessagePage, SafeUser } from "../types/api";

export function ChatShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const safePathname = pathname ?? "/";
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const { accessToken, authorizedFetch, isAuthenticated, isLoading, logout, user } = useAuth();
  const [search, setSearch] = useState("");
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
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      startTransition(() => {
        router.push(`/chat/${chat.id}`);
      });
      setSearch("");
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

    socket.on("chat:updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
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
  }, [accessToken, currentChatId, queryClient]);

  useEffect(() => {
    if (!currentChatId || !socketRef.current) {
      return;
    }

    socketRef.current.emit("join_chat_room", { chatId: currentChatId });
  }, [currentChatId]);

  useEffect(() => {
    if (
      safePathname === "/chat" &&
      chatsQuery.data &&
      chatsQuery.data.length > 0 &&
      !currentChatId
    ) {
      router.replace(`/chat/${chatsQuery.data[0].id}`);
    }
  }, [chatsQuery.data, currentChatId, router, safePathname]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-3 py-3 sm:px-5 sm:py-5">
        <div className="rounded-full border border-white/70 bg-white/70 px-5 py-3 text-sm text-stone-600 shadow-panel">
          Подготавливаем рабочее пространство...
        </div>
      </div>
    );
  }

  return (
    <main className="grain h-[100dvh] overflow-hidden px-3 py-3 sm:px-5 sm:py-5" data-testid="chat-shell">
      <div className="grid h-full min-h-0 grid-rows-[320px_minmax(0,1fr)] gap-3 lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-1">
        <aside
          className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/70 bg-[rgba(255,251,245,0.84)] p-4 shadow-panel backdrop-blur sm:p-5"
          data-testid="chat-sidebar"
        >
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Messenger</p>
              <h1 className="mt-2 text-2xl font-semibold text-ink">{user?.displayName}</h1>
              <p className="mt-1 text-sm text-stone-500">{user?.email}</p>
            </div>
            <button
              data-testid="logout-button"
              type="button"
              onClick={() => void logout()}
              className="rounded-full border border-stone-200 bg-white/75 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-600 transition hover:border-clay hover:text-clay"
            >
              Exit
            </button>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.22em] text-stone-500">
                Найти пользователя
              </span>
              <input
                data-testid="user-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Имя или email"
                className="w-full rounded-[22px] border border-stone-200 bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-clay focus:ring-4 focus:ring-clay/10"
              />
            </label>

            {deferredSearch.trim().length > 1 ? (
              <div
                className="max-h-52 overflow-y-auto rounded-[24px] border border-stone-200/80 bg-white/70 p-2"
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
                        className="flex w-full items-center justify-between rounded-[18px] px-3 py-3 text-left transition hover:bg-sand"
                      >
                        <div>
                          <p className="text-sm font-semibold text-ink">{foundUser.displayName}</p>
                          <p className="text-xs text-stone-500">{foundUser.email}</p>
                        </div>
                        <span className="text-xs uppercase tracking-[0.18em] text-clay">
                          {createDirectChatMutation.isPending ? "..." : "Chat"}
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

          <div className="mt-6 flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-500">Ваши чаты</p>
              <span className="rounded-full bg-sand px-2.5 py-1 text-xs font-medium text-stone-600">
                {chatsQuery.data?.length ?? 0}
              </span>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" data-testid="chat-list">
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

                  return (
                    <Link
                      key={chat.id}
                      data-testid="chat-list-item"
                      href={`/chat/${chat.id}`}
                      className={clsx(
                        "block rounded-[24px] border px-4 py-4 transition",
                        isActive
                          ? "border-clay bg-[linear-gradient(135deg,rgba(209,124,67,0.15),rgba(175,95,45,0.08))]"
                          : "border-transparent bg-white/70 hover:border-stone-200 hover:bg-white",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{title}</p>
                          <p className="mt-1 truncate text-xs text-stone-500">
                            {partner?.lastSeenAt
                              ? `Был(а) ${formatRelativeLastSeen(partner.lastSeenAt)}`
                              : "Личный чат"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-stone-400">
                            {chat.lastMessage ? formatTime(chat.lastMessage.createdAt) : "New"}
                          </p>
                          {chat.unreadCount > 0 ? (
                            <span
                              data-testid="chat-unread-badge"
                              className="mt-2 inline-flex min-w-6 items-center justify-center rounded-full bg-clay px-2 py-1 text-[11px] font-semibold text-white"
                            >
                              {chat.unreadCount}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <p className="mt-3 truncate text-sm text-stone-600">
                        {chat.lastMessage?.body ?? "Сообщений пока нет"}
                      </p>
                    </Link>
                  );
                })
              ) : (
                <div
                  className="rounded-[24px] border border-dashed border-stone-300 bg-white/55 px-4 py-6 text-sm leading-6 text-stone-600"
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
    </main>
  );
}

function SidebarSkeleton() {
  return <div className="h-24 animate-pulse rounded-[24px] bg-white/60" />;
}
