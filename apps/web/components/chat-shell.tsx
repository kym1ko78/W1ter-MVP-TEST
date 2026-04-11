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
import {
  appendMessageUnique,
  normalizeMessagePage,
  upsertMessage,
} from "../lib/message-cache";
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

type LeaveGroupResponse = {
  success: boolean;
  chatId: string;
};

type ChatActionMode = "delete" | "leave";

type GlobalMessageSearchResult = {
  chatId: string;
  messageId: string;
  chatTitle: string;
  senderName: string;
  body: string;
  createdAt: string;
};

type GlobalSearchResult = {
  users: SafeUser[];
  chats: ChatListItem[];
  messages: GlobalMessageSearchResult[];
  totalUsers: number;
  totalChats: number;
  totalMessages: number;
};

export function ChatShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const safePathname = pathname ?? "/";
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const { accessToken, authorizedFetch, isAuthenticated, isLoading, logout, user } = useAuth();
  const [search, setSearch] = useState("");
  const [groupTitleDraft, setGroupTitleDraft] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<SafeUser[]>([]);
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [confirmingChatAction, setConfirmingChatAction] = useState<{
    chatId: string;
    mode: ChatActionMode;
  } | null>(null);
  const deferredSearch = useDeferredValue(search);
  const deferredGroupSearch = useDeferredValue(groupSearch);
  const deferredGlobalSearch = useDeferredValue(globalSearch);
  const normalizedGroupSearch = deferredGroupSearch.trim();
  const normalizedGroupTitle = groupTitleDraft.trim();
  const normalizedGlobalSearch = deferredGlobalSearch.trim();
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

  const groupUserSearchQuery = useQuery({
    queryKey: ["group-user-search", normalizedGroupSearch],
    enabled: isAuthenticated && normalizedGroupSearch.length > 1,
    queryFn: async () =>
      readJson<SafeUser[]>(
        await authorizedFetch(`/users/search?query=${encodeURIComponent(normalizedGroupSearch)}`),
      ),
  });

  const globalSearchQuery = useQuery({
    queryKey: [
      "global-search",
      normalizedGlobalSearch,
      chatsQuery.data?.map((chat) => chat.id).join("|") ?? "",
    ],
    enabled: isAuthenticated && normalizedGlobalSearch.length > 1,
    staleTime: 15_000,
    queryFn: async () => {
      const normalizedQuery = normalizedGlobalSearch.toLocaleLowerCase();
      const chats = chatsQuery.data ?? [];
      const users = await readJson<SafeUser[]>(
        await authorizedFetch(`/users/search?query=${encodeURIComponent(normalizedGlobalSearch)}`),
      );

      const chatMatches = chats.filter((chat) => {
        const title = getChatTitle(chat.members, user?.id, {
          type: chat.type,
          title: chat.title,
        }).toLocaleLowerCase();
        const lastMessage = getLastMessagePreviewText(chat.lastMessage).toLocaleLowerCase();
        const matchedByMember = chat.members.some(
          (member) =>
            member.id !== user?.id &&
            `${member.displayName} ${member.email}`.toLocaleLowerCase().includes(normalizedQuery),
        );

        return (
          title.includes(normalizedQuery) ||
          lastMessage.includes(normalizedQuery) ||
          matchedByMember
        );
      });

      const messageMatches: GlobalMessageSearchResult[] = [];

      await Promise.all(
        chats.map(async (chat) => {
          const page = normalizeMessagePage(
            await readJson<MessagePage>(await authorizedFetch(`/chats/${chat.id}/messages`)),
          );

          if (!page?.items.length) {
            return;
          }

          const chatTitle = getChatTitle(chat.members, user?.id, {
            type: chat.type,
            title: chat.title,
          });

          for (const message of page.items) {
            const body = message.body?.trim();

            if (!body || message.isDeleted) {
              continue;
            }

            if (!body.toLocaleLowerCase().includes(normalizedQuery)) {
              continue;
            }

            messageMatches.push({
              chatId: chat.id,
              messageId: message.id,
              chatTitle,
              senderName: message.sender.displayName,
              body,
              createdAt: message.createdAt,
            });
          }
        }),
      );

      messageMatches.sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );

      return {
        users: users.slice(0, 8),
        chats: chatMatches.slice(0, 8),
        messages: messageMatches.slice(0, 20),
        totalUsers: users.length,
        totalChats: chatMatches.length,
        totalMessages: messageMatches.length,
      } satisfies GlobalSearchResult;
    },
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

  const createGroupChatMutation = useMutation({
    mutationFn: async (payload: { title: string; memberIds: string[] }) =>
      readJson<ChatListItem>(
        await authorizedFetch("/chats/group", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
      ),
    onMutate: () => {
      setGroupCreateError(null);
    },
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      setGroupTitleDraft("");
      setGroupSearch("");
      setSelectedGroupMembers([]);
      setGroupCreateError(null);
      startTransition(() => {
        router.replace(`/chat/${chat.id}`);
      });
    },
    onError: (error) => {
      setGroupCreateError(
        error instanceof Error ? error.message : "Не удалось создать группу. Попробуйте снова.",
      );
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
      setConfirmingChatAction(null);
    },
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async (chatId: string) =>
      readJson<LeaveGroupResponse>(
        await authorizedFetch(`/chats/${chatId}/leave`, {
          method: "POST",
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
      setConfirmingChatAction(null);
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

  const handleChatDangerAction = (chat: ChatListItem) => {
    if (deleteChatMutation.isPending || leaveGroupMutation.isPending) {
      return;
    }

    const mode: ChatActionMode =
      chat.type === "group" && chat.currentUserRole !== "creator" ? "leave" : "delete";
    setConfirmingChatAction({ chatId: chat.id, mode });
  };

  const confirmingChat =
    chatsQuery.data?.find((chat) => chat.id === confirmingChatAction?.chatId) ?? null;
  const selectedGroupMemberIds = useMemo(
    () => selectedGroupMembers.map((member) => member.id),
    [selectedGroupMembers],
  );
  const availableGroupUserResults = useMemo(
    () =>
      (groupUserSearchQuery.data ?? []).filter(
        (foundUser) =>
          foundUser.id !== user?.id && !selectedGroupMemberIds.includes(foundUser.id),
      ),
    [groupUserSearchQuery.data, selectedGroupMemberIds, user?.id],
  );

  const handleCreateGroup = () => {
    if (!normalizedGroupTitle || createGroupChatMutation.isPending) {
      return;
    }

    setGroupCreateError(null);
    createGroupChatMutation.mutate({
      title: normalizedGroupTitle,
      memberIds: selectedGroupMemberIds,
    });
  };

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

            <div className="rounded-[22px] border border-black/8 bg-white/90 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">Новая группа</p>
              <input
                data-testid="group-title-input"
                value={groupTitleDraft}
                onChange={(event) => {
                  setGroupTitleDraft(event.target.value);
                  if (groupCreateError) {
                    setGroupCreateError(null);
                  }
                }}
                placeholder="Название группы"
                maxLength={80}
                className="mt-2 w-full rounded-[16px] border border-black/8 bg-[#f7f7f5] px-3 py-2 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              />
              <input
                data-testid="group-members-search-input"
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                placeholder="Добавить участников"
                className="mt-2 w-full rounded-[16px] border border-black/8 bg-[#f7f7f5] px-3 py-2 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              />

              {selectedGroupMembers.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid="group-selected-members">
                  {selectedGroupMembers.map((selectedUser) => (
                    <button
                      key={selectedUser.id}
                      type="button"
                      onClick={() =>
                        setSelectedGroupMembers((current) =>
                          current.filter((member) => member.id !== selectedUser.id),
                        )
                      }
                      className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs text-stone-600 transition hover:border-black/25 hover:text-black"
                    >
                      {selectedUser.displayName} ×
                    </button>
                  ))}
                </div>
              ) : null}

              {normalizedGroupSearch.length > 1 ? (
                <div
                  className="scroll-region-y mt-2 max-h-40 overflow-y-auto rounded-[16px] border border-black/8 bg-[#fafaf9] p-1.5"
                  data-testid="group-members-search-results"
                >
                  {groupUserSearchQuery.isLoading ? (
                    <p className="px-2 py-3 text-xs text-stone-500">Ищем участников...</p>
                  ) : availableGroupUserResults.length > 0 ? (
                    <div className="space-y-1.5">
                      {availableGroupUserResults.map((foundUser) => (
                        <button
                          key={foundUser.id}
                          type="button"
                          onClick={() =>
                            setSelectedGroupMembers((current) => [...current, foundUser])
                          }
                          className="flex w-full items-center justify-between rounded-[12px] border border-transparent px-2 py-2 text-left transition hover:border-black/8 hover:bg-white"
                        >
                          <span className="truncate text-xs font-medium text-[#171717]">
                            {foundUser.displayName}
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-stone-500">
                            Add
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="px-2 py-3 text-xs text-stone-500">Подходящих пользователей нет.</p>
                  )}
                </div>
              ) : null}

              {groupCreateError ? (
                <p className="mt-2 text-xs text-stone-600">{groupCreateError}</p>
              ) : (
                <p className="mt-2 text-[11px] text-stone-500">
                  Можно создать пустую группу и добавить участников позже.
                </p>
              )}

              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={!normalizedGroupTitle || createGroupChatMutation.isPending}
                data-testid="create-group-button"
                className="mt-2 w-full rounded-full bg-[#111111] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
              >
                {createGroupChatMutation.isPending ? "Создаём..." : "Создать группу"}
              </button>
            </div>

            <label className="block pt-1">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.24em] text-stone-400">
                Global search
              </span>
              <input
                data-testid="global-search-input"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Чаты, пользователи, сообщения"
                className="w-full rounded-[20px] border border-black/8 bg-[#f7f7f5] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              />
            </label>

            {normalizedGlobalSearch.length > 1 ? (
              <div
                className="scroll-region-y max-h-72 overflow-y-auto rounded-[24px] border border-black/8 bg-white p-2 shadow-[0_18px_30px_rgba(17,24,39,0.06)]"
                data-testid="global-search-results"
              >
                {globalSearchQuery.isLoading ? (
                  <p className="px-3 py-4 text-sm text-stone-500">Ищем по всем чатам...</p>
                ) : globalSearchQuery.isError ? (
                  <p className="px-3 py-4 text-sm text-stone-500">
                    Не удалось выполнить глобальный поиск.
                  </p>
                ) : globalSearchQuery.data ? (
                  globalSearchQuery.data.chats.length === 0 &&
                  globalSearchQuery.data.users.length === 0 &&
                  globalSearchQuery.data.messages.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-stone-500">Ничего не найдено.</p>
                  ) : (
                    <div className="space-y-3">
                      {globalSearchQuery.data.chats.length > 0 ? (
                        <div className="space-y-2">
                          <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-stone-400">
                            Чаты
                          </p>
                          {globalSearchQuery.data.chats.map((chat) => {
                            const title = getChatTitle(chat.members, user?.id, {
                              type: chat.type,
                              title: chat.title,
                            });
                            const partner = chat.members.find((member) => member.id !== user?.id);

                            return (
                              <Link
                                key={chat.id}
                                href={`/chat/${chat.id}`}
                                className="block rounded-[16px] border border-transparent px-3 py-2 text-sm transition hover:border-black/10 hover:bg-[#f7f7f5]"
                              >
                                <p className="truncate font-semibold text-[#171717]">{title}</p>
                                <p className="truncate text-xs text-stone-500">
                                  {chat.type === "group"
                                    ? `${chat.members.length} участников`
                                    : partner?.email ?? getLastMessagePreviewText(chat.lastMessage)}
                                </p>
                              </Link>
                            );
                          })}
                          {globalSearchQuery.data.totalChats > globalSearchQuery.data.chats.length ? (
                            <p className="px-1 text-[11px] text-stone-400">
                              Показаны первые {globalSearchQuery.data.chats.length} чатов.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {globalSearchQuery.data.users.length > 0 ? (
                        <div className="space-y-2">
                          <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-stone-400">
                            Пользователи
                          </p>
                          {globalSearchQuery.data.users.map((foundUser) => (
                            <button
                              key={foundUser.id}
                              type="button"
                              onClick={() => createDirectChatMutation.mutate(foundUser.id)}
                              className="flex w-full items-center justify-between gap-3 rounded-[16px] border border-transparent px-3 py-2 text-left transition hover:border-black/10 hover:bg-[#f7f7f5]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[#171717]">
                                  {foundUser.displayName}
                                </p>
                                <p className="truncate text-xs text-stone-500">{foundUser.email}</p>
                              </div>
                              <span className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-stone-500">
                                {createDirectChatMutation.isPending ? "..." : "Direct"}
                              </span>
                            </button>
                          ))}
                          {globalSearchQuery.data.totalUsers > globalSearchQuery.data.users.length ? (
                            <p className="px-1 text-[11px] text-stone-400">
                              Показаны первые {globalSearchQuery.data.users.length} пользователей.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {globalSearchQuery.data.messages.length > 0 ? (
                        <div className="space-y-2">
                          <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-stone-400">
                            Сообщения
                          </p>
                          {globalSearchQuery.data.messages.map((result) => (
                            <Link
                              key={result.messageId}
                              href={`/chat/${result.chatId}?message=${encodeURIComponent(result.messageId)}&q=${encodeURIComponent(normalizedGlobalSearch)}`}
                              className="block rounded-[16px] border border-transparent px-3 py-2 transition hover:border-black/10 hover:bg-[#f7f7f5]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                                  {result.chatTitle}
                                </p>
                                <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-stone-400">
                                  {formatTime(result.createdAt)}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm text-[#171717]">
                                {result.senderName}: {result.body}
                              </p>
                            </Link>
                          ))}
                          {globalSearchQuery.data.totalMessages > globalSearchQuery.data.messages.length ? (
                            <p className="px-1 text-[11px] text-stone-400">
                              Показаны первые {globalSearchQuery.data.messages.length} сообщений.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                ) : null}
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
                  const title = getChatTitle(chat.members, user?.id, {
                    type: chat.type,
                    title: chat.title,
                  });
                  const partner = chat.members.find((member) => member.id !== user?.id);
                  const isGroup = chat.type === "group";
                  const actionMode: ChatActionMode =
                    isGroup && chat.currentUserRole !== "creator" ? "leave" : "delete";
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
                          user={
                            isGroup
                              ? { displayName: title, email: title, avatarUrl: null }
                              : partner ?? { displayName: title, email: title, avatarUrl: null }
                          }
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
                                {isGroup
                                  ? `${chat.members.length} участников`
                                  : partner?.lastSeenAt
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
                                onClick={() => handleChatDangerAction(chat)}
                                disabled={deleteChatMutation.isPending || leaveGroupMutation.isPending}
                                data-testid="chat-list-delete-button"
                                className={clsx(
                                  "mt-2 block rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-60",
                                  isActive
                                    ? "border-white/15 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
                                    : "border-black/10 bg-white text-stone-500 hover:border-black/20 hover:text-black",
                                )}
                              >
                                {isDeleting
                                  ? actionMode === "leave"
                                    ? "Выход..."
                                    : "Удаление..."
                                  : actionMode === "leave"
                                    ? "Выйти"
                                    : "Удалить"}
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
                  Пока нет чатов. Найдите пользователя для direct-диалога или создайте первую группу.
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="min-h-0 min-w-0">{children}</section>
      </div>

      <ConfirmDialog
        open={Boolean(confirmingChatAction)}
        title={
          confirmingChatAction?.mode === "leave"
            ? "Выйти из группы?"
            : confirmingChat?.type === "group"
              ? "Удалить группу?"
              : "Удалить этот чат?"
        }
        description={
          confirmingChat
            ? confirmingChatAction?.mode === "leave"
              ? `Вы выйдете из «${getChatTitle(confirmingChat.members, user?.id, { type: confirmingChat.type, title: confirmingChat.title })}» и потеряете доступ к сообщениям этой группы.`
              : confirmingChat.type === "group"
                ? `Группа «${getChatTitle(confirmingChat.members, user?.id, { type: confirmingChat.type, title: confirmingChat.title })}» будет удалена для всех участников.`
                : `Диалог с ${getChatTitle(confirmingChat.members, user?.id, { type: confirmingChat.type, title: confirmingChat.title })} будет удален целиком.`
            : confirmingChatAction?.mode === "leave"
              ? "Вы выйдете из группы."
              : "Диалог будет удален целиком."
        }
        confirmLabel={confirmingChatAction?.mode === "leave" ? "Выйти" : "Удалить"}
        isLoading={deleteChatMutation.isPending || leaveGroupMutation.isPending}
        onCancel={() => {
          if (!deleteChatMutation.isPending && !leaveGroupMutation.isPending) {
            setConfirmingChatAction(null);
          }
        }}
        onConfirm={() => {
          if (!confirmingChatAction) {
            return;
          }

          if (confirmingChatAction.mode === "leave") {
            leaveGroupMutation.mutate(confirmingChatAction.chatId);
            return;
          }

          deleteChatMutation.mutate(confirmingChatAction.chatId);
        }}
      />
    </main>
  );
}

function SidebarSkeleton() {
  return <div className="h-24 animate-pulse rounded-[24px] border border-black/6 bg-white/80" />;
}
