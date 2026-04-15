"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
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
import {
  RealtimeContext,
  type NotificationPermissionState,
  type RealtimeConnectionState,
} from "../lib/realtime-context";
import {
  ChatLayoutProvider,
  CHAT_CENTER_MIN_WIDTH,
  CHAT_LEFT_SIDEBAR_DEFAULT_WIDTH,
  CHAT_LEFT_SIDEBAR_MAX_WIDTH,
  CHAT_LEFT_SIDEBAR_MIN_WIDTH,
  CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  CHAT_RIGHT_PANEL_MAX_WIDTH,
  CHAT_RIGHT_PANEL_MIN_WIDTH,
} from "../lib/chat-layout-context";
import type { ChatListItem, ChatMessage, MessagePage, SafeUser } from "../types/api";
import { UserAvatar } from "./user-avatar";

const CHAT_PAGE_LOCK_CLASS = "chat-page-locked";
const TYPING_TTL_MS = 6_000;
const NOTIFICATIONS_PREFERENCE_KEY = "w1ter.notifications.enabled";
const MAX_NOTIFIED_MESSAGE_IDS = 200;
const LEFT_SIDEBAR_WIDTH_STORAGE_KEY = "w1ter.layout.left-sidebar-width";
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "w1ter.layout.right-panel-width";

type ChatDeletedPayload = {
  chatId: string;
};

type PresenceChangedPayload = {
  userId: string;
  isOnline: boolean;
};

type TypingChangedPayload = {
  chatId: string;
  userId: string;
  isTyping: boolean;
};

type PresenceSyncResponse = {
  ok: boolean;
  statuses: Array<{ userId: string; isOnline: boolean }>;
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
  const sidebarMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopLayoutRef = useRef(false);
  const leftSidebarWidthRef = useRef(CHAT_LEFT_SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(CHAT_RIGHT_PANEL_DEFAULT_WIDTH);
  const { accessToken, authorizedFetch, isAuthenticated, isLoading, logout, user } = useAuth();
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = useState(false);
  const [isGroupComposerOpen, setIsGroupComposerOpen] = useState(false);
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
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>("disconnected");
  const [isOffline, setIsOffline] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Record<string, true>>({});
  const [typingByChat, setTypingByChat] = useState<Record<string, Record<string, number>>>({});
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>("unsupported");
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(CHAT_LEFT_SIDEBAR_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(CHAT_RIGHT_PANEL_DEFAULT_WIDTH);
  const notifiedMessageIdsRef = useRef<string[]>([]);
  const localTypingByChatRef = useRef<Map<string, boolean>>(new Map());
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
  const currentChatIdRef = useRef<string | null>(currentChatId);
  const notificationsSupported =
    typeof window !== "undefined" && typeof window.Notification !== "undefined";
  const statusesMayBeStale = connectionState !== "connected";
  const updateOnlineUsers = useCallback((userId: string, isOnline: boolean) => {
    setOnlineUserIds((current) => {
      const hasUser = Boolean(current[userId]);
      if (isOnline && hasUser) {
        return current;
      }

      if (!isOnline && !hasUser) {
        return current;
      }

      if (isOnline) {
        return {
          ...current,
          [userId]: true,
        };
      }

      const next = { ...current };
      delete next[userId];
      return next;
    });
  }, []);
  const isUserOnline = useCallback(
    (userId: string | null | undefined) => (userId ? Boolean(onlineUserIds[userId]) : false),
    [onlineUserIds],
  );
  const isUserTyping = useCallback(
    (chatId: string, userId: string | null | undefined) => {
      if (!userId) {
        return false;
      }

      const updatedAt = typingByChat[chatId]?.[userId];
      if (!updatedAt) {
        return false;
      }

      return Date.now() - updatedAt < TYPING_TTL_MS;
    },
    [typingByChat],
  );
  const setNotificationsEnabled = useCallback((value: boolean) => {
    setNotificationsEnabledState(value);
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(NOTIFICATIONS_PREFERENCE_KEY, value ? "1" : "0");
  }, []);
  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === "undefined" || typeof window.Notification === "undefined") {
      setNotificationPermission("unsupported");
      setNotificationsEnabled(false);
      return;
    }

    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === "granted") {
        setNotificationsEnabled(true);
        return;
      }

      setNotificationsEnabled(false);
    } catch {
      setNotificationPermission("denied");
      setNotificationsEnabled(false);
    }
  }, [setNotificationsEnabled]);
  const markMessageAsNotified = useCallback((messageId: string) => {
    const knownMessageIds = notifiedMessageIdsRef.current;
    if (knownMessageIds.includes(messageId)) {
      return false;
    }

    knownMessageIds.push(messageId);
    if (knownMessageIds.length > MAX_NOTIFIED_MESSAGE_IDS) {
      knownMessageIds.splice(0, knownMessageIds.length - MAX_NOTIFIED_MESSAGE_IDS);
    }

    return true;
  }, []);
  const updateTyping = useCallback((chatId: string, isTyping: boolean) => {
    if (!chatId) {
      return;
    }

    const nextValue = Boolean(isTyping);
    const currentValue = localTypingByChatRef.current.get(chatId) ?? false;

    if (currentValue === nextValue) {
      return;
    }

    if (nextValue) {
      localTypingByChatRef.current.set(chatId, true);
    } else {
      localTypingByChatRef.current.delete(chatId);
    }

    socketRef.current?.emit("typing:update", { chatId, isTyping: nextValue });
  }, []);

  useEffect(() => {
    leftSidebarWidthRef.current = leftSidebarWidth;
  }, [leftSidebarWidth]);

  useEffect(() => {
    rightPanelWidthRef.current = rightPanelWidth;
  }, [rightPanelWidth]);

  useEffect(() => {
    desktopLayoutRef.current = isDesktopLayout;
  }, [isDesktopLayout]);

  const clampLeftSidebarWidth = useCallback((value: number) => {
    if (typeof window === "undefined") {
      return Math.min(
        Math.max(value, CHAT_LEFT_SIDEBAR_MIN_WIDTH),
        CHAT_LEFT_SIDEBAR_MAX_WIDTH,
      );
    }

    const viewportWidth = window.innerWidth;
    const maxWidth = Math.max(
      CHAT_LEFT_SIDEBAR_MIN_WIDTH,
      Math.min(
        CHAT_LEFT_SIDEBAR_MAX_WIDTH,
        viewportWidth - rightPanelWidthRef.current - CHAT_CENTER_MIN_WIDTH,
      ),
    );

    return Math.min(Math.max(value, CHAT_LEFT_SIDEBAR_MIN_WIDTH), maxWidth);
  }, []);

  const clampRightPanelWidth = useCallback((value: number) => {
    if (typeof window === "undefined") {
      return Math.min(
        Math.max(value, CHAT_RIGHT_PANEL_MIN_WIDTH),
        CHAT_RIGHT_PANEL_MAX_WIDTH,
      );
    }

    const viewportWidth = window.innerWidth;
    const maxWidth = Math.max(
      CHAT_RIGHT_PANEL_MIN_WIDTH,
      Math.min(
        CHAT_RIGHT_PANEL_MAX_WIDTH,
        viewportWidth - leftSidebarWidthRef.current - CHAT_CENTER_MIN_WIDTH,
      ),
    );

    return Math.min(Math.max(value, CHAT_RIGHT_PANEL_MIN_WIDTH), maxWidth);
  }, []);

  const startLeftSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!desktopLayoutRef.current || typeof window === "undefined") {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const initialWidth = leftSidebarWidthRef.current;
      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampLeftSidebarWidth(initialWidth + (moveEvent.clientX - startX));
        setLeftSidebarWidth(nextWidth);
      };

      const stopResize = () => {
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
    },
    [clampLeftSidebarWidth],
  );

  const chatsQuery = useQuery({
    queryKey: ["chats"],
    enabled: isAuthenticated,
    queryFn: async () => readJson<ChatListItem[]>(await authorizedFetch("/chats")),
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
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      setGlobalSearch("");
      setIsSidebarMenuOpen(false);
      startTransition(() => {
        router.replace(`/chat/${chat.id}`);
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
      setIsGroupComposerOpen(false);
      setIsSidebarMenuOpen(false);
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
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const syncDesktopLayout = () => {
      const nextIsDesktop = mediaQuery.matches;
      setIsDesktopLayout(nextIsDesktop);
      desktopLayoutRef.current = nextIsDesktop;

      if (!nextIsDesktop) {
        return;
      }

      const storedLeftWidth = Number(window.localStorage.getItem(LEFT_SIDEBAR_WIDTH_STORAGE_KEY));
      const storedRightWidth = Number(window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));

      if (Number.isFinite(storedLeftWidth) && storedLeftWidth > 0) {
        setLeftSidebarWidth(clampLeftSidebarWidth(storedLeftWidth));
      }

      if (Number.isFinite(storedRightWidth) && storedRightWidth > 0) {
        setRightPanelWidth(clampRightPanelWidth(storedRightWidth));
      }
    };

    syncDesktopLayout();
    mediaQuery.addEventListener("change", syncDesktopLayout);

    return () => mediaQuery.removeEventListener("change", syncDesktopLayout);
  }, [clampLeftSidebarWidth, clampRightPanelWidth]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDesktopLayout) {
      return;
    }

    window.localStorage.setItem(LEFT_SIDEBAR_WIDTH_STORAGE_KEY, String(leftSidebarWidth));
  }, [isDesktopLayout, leftSidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDesktopLayout) {
      return;
    }

    window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
  }, [isDesktopLayout, rightPanelWidth]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDesktopLayout) {
      return;
    }

    const syncPanelWidths = () => {
      setLeftSidebarWidth((current) => clampLeftSidebarWidth(current));
      setRightPanelWidth((current) => clampRightPanelWidth(current));
    };

    syncPanelWidths();
    window.addEventListener("resize", syncPanelWidths);

    return () => window.removeEventListener("resize", syncPanelWidths);
  }, [clampLeftSidebarWidth, clampRightPanelWidth, isDesktopLayout]);

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
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateOfflineState = () => {
      setIsOffline(!window.navigator.onLine);
    };

    updateOfflineState();
    window.addEventListener("online", updateOfflineState);
    window.addEventListener("offline", updateOfflineState);

    return () => {
      window.removeEventListener("online", updateOfflineState);
      window.removeEventListener("offline", updateOfflineState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.Notification === "undefined") {
      setNotificationPermission("unsupported");
      setNotificationsEnabled(false);
      return;
    }

    const permission = window.Notification.permission;
    setNotificationPermission(permission);

    if (permission !== "granted") {
      setNotificationsEnabled(false);
      return;
    }

    const persistedPreference = window.localStorage.getItem(NOTIFICATIONS_PREFERENCE_KEY);
    setNotificationsEnabled(persistedPreference !== "0");
  }, [setNotificationsEnabled]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTypingByChat((current) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, Record<string, number>> = {};

        for (const [chatId, userMap] of Object.entries(current)) {
          const freshEntries = Object.entries(userMap).filter(
            ([, updatedAt]) => now - updatedAt < TYPING_TTL_MS,
          );

          if (freshEntries.length > 0) {
            next[chatId] = Object.fromEntries(freshEntries);
          }

          if (freshEntries.length !== Object.keys(userMap).length) {
            changed = true;
          }
        }

        return changed ? next : current;
      });
    }, 1_500);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!accessToken || socketRef.current) {
      return;
    }

    setConnectionState("connecting");
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      withCredentials: true,
      auth: {
        token: accessToken,
      },
    });

    const handleConnect = () => {
      setConnectionState("connected");
      const chatId = currentChatIdRef.current;

      if (!chatId) {
        return;
      }

      socket.emit("join_chat_room", { chatId });
    };

    const handleMessageNew = (message: ChatMessage) => {
      queryClient.setQueryData<MessagePage>(["messages", message.chatId], (old) =>
        appendMessageUnique(old, message),
      );

      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", message.chatId] });

      if (
        message.senderId === user?.id ||
        notificationPermission !== "granted" ||
        !notificationsEnabled ||
        typeof document === "undefined"
      ) {
        return;
      }

      const isCurrentChatVisible =
        currentChatIdRef.current === message.chatId &&
        document.visibilityState === "visible" &&
        document.hasFocus();

      if (isCurrentChatVisible || !markMessageAsNotified(message.id)) {
        return;
      }

      const knownChats = queryClient.getQueryData<ChatListItem[]>(["chats"]) ?? [];
      const targetChat = knownChats.find((chat) => chat.id === message.chatId);
      const title = targetChat
        ? getChatTitle(targetChat.members, user?.id, {
            type: targetChat.type,
            title: targetChat.title,
          })
        : message.sender.displayName;
      const body = getLastMessagePreviewText(message);

      try {
        const notification = new window.Notification(title, {
          body,
          tag: `chat:${message.chatId}`,
        });

        notification.onclick = () => {
          window.focus();
          startTransition(() => {
            router.push(`/chat/${message.chatId}`);
          });
          notification.close();
        };
      } catch {
        setNotificationsEnabled(false);
      }
    };

    const handleMessageUpdated = (message: ChatMessage) => {
      queryClient.setQueryData<MessagePage>(["messages", message.chatId], (old) =>
        upsertMessage(old, message),
      );

      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", message.chatId] });
    };

    const handleChatUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    const handleChatDeleted = (payload: ChatDeletedPayload) => {
      queryClient.setQueryData<ChatListItem[] | undefined>(["chats"], (old) =>
        old?.filter((chat) => chat.id !== payload.chatId),
      );
      queryClient.removeQueries({ queryKey: ["chat", payload.chatId] });
      queryClient.removeQueries({ queryKey: ["messages", payload.chatId] });
      if (currentChatIdRef.current === payload.chatId) {
        startTransition(() => {
          router.replace("/chat");
        });
      }
    };

    const handleChatRead = () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    const handleDisconnect = () => {
      setConnectionState("disconnected");
    };

    const handleConnectError = () => {
      setConnectionState("disconnected");
    };

    const handleReconnectAttempt = () => {
      setConnectionState("connecting");
    };

    const handlePresenceChanged = (payload: PresenceChangedPayload) => {
      if (payload?.userId) {
        updateOnlineUsers(payload.userId, Boolean(payload.isOnline));
      }

      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      if (currentChatIdRef.current) {
        void queryClient.invalidateQueries({ queryKey: ["chat", currentChatIdRef.current] });
      }
    };

    const handleTypingChanged = (payload: TypingChangedPayload) => {
      if (!payload?.chatId || !payload?.userId) {
        return;
      }

      setTypingByChat((current) => {
        const next = { ...current };
        const currentChatTyping = { ...(next[payload.chatId] ?? {}) };

        if (payload.isTyping) {
          currentChatTyping[payload.userId] = Date.now();
          next[payload.chatId] = currentChatTyping;
          return next;
        }

        if (!currentChatTyping[payload.userId]) {
          return current;
        }

        delete currentChatTyping[payload.userId];
        if (Object.keys(currentChatTyping).length > 0) {
          next[payload.chatId] = currentChatTyping;
        } else {
          delete next[payload.chatId];
        }

        return next;
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("message:new", handleMessageNew);
    socket.on("message:updated", handleMessageUpdated);
    socket.on("chat:updated", handleChatUpdated);
    socket.on("chat:deleted", handleChatDeleted);
    socket.on("chat:read", handleChatRead);
    socket.on("presence:changed", handlePresenceChanged);
    socket.on("typing:changed", handleTypingChanged);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);

    socketRef.current = socket;

    return () => {
      for (const [chatId, isTyping] of localTypingByChatRef.current.entries()) {
        if (isTyping) {
          socket.emit("typing:update", { chatId, isTyping: false });
        }
      }

      localTypingByChatRef.current.clear();
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("message:new", handleMessageNew);
      socket.off("message:updated", handleMessageUpdated);
      socket.off("chat:updated", handleChatUpdated);
      socket.off("chat:deleted", handleChatDeleted);
      socket.off("chat:read", handleChatRead);
      socket.off("presence:changed", handlePresenceChanged);
      socket.off("typing:changed", handleTypingChanged);
      socket.io.off("reconnect_attempt", handleReconnectAttempt);
      socket.io.opts.reconnection = false;

      if (socket.connected) {
        socket.disconnect();
      } else {
        socket.once("connect", () => {
          socket.disconnect();
        });
      }

      socketRef.current = null;
      setConnectionState("disconnected");
    };
  }, [
    accessToken,
    markMessageAsNotified,
    notificationPermission,
    notificationsEnabled,
    queryClient,
    router,
    setNotificationsEnabled,
    updateOnlineUsers,
    user?.id,
  ]);

  useEffect(() => {
    if (!currentChatId || !socketRef.current || connectionState !== "connected") {
      return;
    }

    socketRef.current.emit("join_chat_room", { chatId: currentChatId });
  }, [connectionState, currentChatId]);

  useEffect(() => {
    if (connectionState !== "connected" || !socketRef.current) {
      return;
    }

    const userIds = Array.from(
      new Set(
        (chatsQuery.data ?? [])
          .flatMap((chat) => chat.members.map((member) => member.id))
          .filter((memberId) => memberId && memberId !== user?.id),
      ),
    );

    if (userIds.length === 0) {
      return;
    }

    socketRef.current.emit(
      "presence:sync",
      { userIds },
      (payload?: PresenceSyncResponse) => {
        if (!payload?.ok || !Array.isArray(payload.statuses)) {
          return;
        }

        setOnlineUserIds((current) => {
          const next = { ...current };
          for (const userId of userIds) {
            delete next[userId];
          }

          for (const status of payload.statuses) {
            if (status.isOnline) {
              next[status.userId] = true;
            }
          }

          return next;
        });
      },
    );
  }, [chatsQuery.data, connectionState, user?.id]);

  useEffect(() => {
    setIsSidebarMenuOpen(false);
    setIsGroupComposerOpen(false);
  }, [safePathname]);

  useEffect(() => {
    if (!isSidebarMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (!target) {
        return;
      }

      if (sidebarMenuRef.current?.contains(target) || sidebarMenuButtonRef.current?.contains(target)) {
        return;
      }

      setIsSidebarMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setIsSidebarMenuOpen(false);
      window.requestAnimationFrame(() => {
        sidebarMenuButtonRef.current?.focus();
      });
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSidebarMenuOpen]);

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
  const connectionStatusCopy = isOffline
    ? "Оффлайн. Соединение восстановится автоматически."
    : connectionState === "connected"
      ? "Realtime подключен."
      : connectionState === "connecting"
        ? "Подключаемся к realtime..."
        : "Связь потеряна. Статусы могут запаздывать.";
  const notificationStatusCopy =
    notificationPermission === "unsupported"
      ? "Браузер не поддерживает web-notifications."
      : notificationPermission === "denied"
        ? "Уведомления заблокированы в браузере."
        : notificationPermission === "granted"
          ? notificationsEnabled
            ? "Уведомления о новых сообщениях включены."
            : "Уведомления выключены."
          : "Разрешение на уведомления еще не выдано.";
  const realtimeContextValue = useMemo(
    () => ({
      connectionState,
      isOffline,
      statusesMayBeStale,
      notificationPermission,
      notificationsEnabled,
      notificationsSupported,
      requestNotificationPermission,
      setNotificationsEnabled,
      isUserOnline,
      isUserTyping,
      updateTyping,
    }),
    [
      connectionState,
      isOffline,
      isUserOnline,
      isUserTyping,
      notificationPermission,
      notificationsEnabled,
      notificationsSupported,
      requestNotificationPermission,
      setNotificationsEnabled,
      statusesMayBeStale,
      updateTyping,
    ],
  );

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
    <RealtimeContext.Provider value={realtimeContextValue}>
      <ChatLayoutProvider
        value={{
          isDesktopLayout,
          leftSidebarWidth,
          rightPanelWidth,
          setLeftSidebarWidth,
          setRightPanelWidth,
        }}
      >
      <main className="chat-scene grain relative h-[100dvh] overflow-hidden" data-testid="chat-shell">
      <div
        className={clsx(
          "pointer-events-none absolute inset-0 z-20 bg-black/18 transition-opacity duration-300",
          isSidebarMenuOpen ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      />

      <div
        ref={sidebarMenuRef}
        className={clsx(
          "pointer-events-auto absolute inset-y-0 left-0 z-30 flex w-[min(92vw,360px)] max-w-full flex-col border-r border-black/8 bg-white shadow-[0_28px_60px_rgba(17,24,39,0.12)] transition-transform duration-300 ease-out",
          isSidebarMenuOpen ? "translate-x-0" : "-translate-x-[104%]",
        )}
        data-testid="chat-sidebar-drawer"
      >
        <div className="flex items-start justify-between gap-4 border-b border-black/8 px-5 py-5">
          <Link
            href="/profile"
            data-testid="profile-link"
            onClick={() => setIsSidebarMenuOpen(false)}
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
              <h1 className="mt-2 truncate text-[1.5rem] font-semibold leading-none tracking-tight text-[#171717]">
                {user?.displayName}
              </h1>
              <p className="mt-2 truncate text-sm text-stone-500">{user?.email}</p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-stone-400">
                Открыть профиль
              </p>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setIsSidebarMenuOpen(false)}
            className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-600 transition hover:border-black hover:bg-black hover:text-white"
            aria-label="Закрыть меню"
            title="Закрыть меню"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="scroll-region-y scroll-region-overlay-right min-h-0 flex-1 overflow-y-auto bg-white">
          <div className="px-0 py-4">
            {isGroupComposerOpen ? (
              <div className="px-5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsGroupComposerOpen(false)}
                    className="rounded-full border border-black/10 bg-white px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-stone-500 transition hover:border-black/25 hover:text-black"
                  >
                    Назад
                  </button>
                </div>

                <div className="mt-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-black/10 bg-[#f7f7f5] text-stone-600">
                      <GroupsIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#171717]">Создать группу</p>
                      <p className="text-xs text-stone-500">
                        Укажите название и при желании сразу добавьте участников.
                      </p>
                    </div>
                  </div>

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
                    className="mt-4 w-full rounded-[16px] border border-black/8 bg-[#f7f7f5] px-3 py-2.5 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
                  />
                  <input
                    data-testid="group-members-search-input"
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.target.value)}
                    placeholder="Добавить участников"
                    className="mt-2 w-full rounded-[16px] border border-black/8 bg-[#f7f7f5] px-3 py-2.5 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
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
                      className="scroll-region-y mt-2 max-h-40 overflow-y-auto rounded-[16px] border border-black/8 bg-white p-1.5"
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
                              className="flex w-full items-center justify-between rounded-[12px] border border-transparent px-2 py-2 text-left transition hover:border-black/8 hover:bg-[#f7f7f5]"
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
                        <p className="px-2 py-3 text-xs text-stone-500">
                          Подходящих пользователей нет.
                        </p>
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
                    className="mt-4 w-full rounded-full bg-[#111111] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {createGroupChatMutation.isPending ? "Создаём..." : "Создать группу"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <Link
                  href="/profile"
                  onClick={() => setIsSidebarMenuOpen(false)}
                  className="flex items-center gap-3 px-5 py-4 text-sm text-[#171717] transition hover:bg-[#f7f7f5]"
                >
                  <ProfileIcon className="h-5 w-5 text-stone-500" />
                  <span className="font-medium">Мой профиль</span>
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setIsSidebarMenuOpen(false);
                    void logout();
                  }}
                  data-testid="logout-button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm text-[#171717] transition hover:bg-[#f7f7f5]"
                >
                  <LogoutIcon className="h-5 w-5 text-stone-500" />
                  <span className="font-medium">Выйти из аккаунта</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsGroupComposerOpen(true)}
                  data-testid="open-group-composer-button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm text-[#171717] transition hover:bg-[#f7f7f5]"
                >
                  <GroupsIcon className="h-5 w-5 text-stone-500" />
                  <span className="font-medium">Создать группу</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="relative grid h-full min-h-0 grid-rows-[360px_minmax(0,1fr)] gap-0 lg:grid-rows-1"
        style={
          isDesktopLayout
            ? { gridTemplateColumns: `${leftSidebarWidth}px minmax(0, 1fr)` }
            : undefined
        }
      >
        <aside
          className="chat-shell-panel flex min-h-0 flex-col overflow-hidden rounded-none border-0 border-r border-black/8 p-4 sm:p-5"
          data-testid="chat-sidebar"
        >
          <div className="relative z-10 mb-5 flex items-center gap-3">
            <button
              ref={sidebarMenuButtonRef}
              type="button"
              onClick={() => setIsSidebarMenuOpen((current) => !current)}
              data-testid="chat-sidebar-menu-button"
              className={clsx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border transition",
                isSidebarMenuOpen
                  ? "border-black bg-[#111111] text-white"
                  : "border-black/10 bg-white text-stone-600 hover:border-black hover:bg-black hover:text-white",
              )}
              aria-label="Открыть меню"
              title="Открыть меню"
            >
              <MenuIcon className="h-5 w-5" />
            </button>

            <label className="relative block min-w-0 flex-1">
              <input
                data-testid="global-search-input"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Поиск"
                className="w-full rounded-[20px] border border-black/8 bg-[#f7f7f5] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              />
            </label>
          </div>

          <div className="relative z-10 space-y-3">
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
                                className="block rounded-[16px] border border-transparent px-3 py-2 text-sm transition-[transform,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-black/10 hover:bg-[#f7f7f5] active:scale-[0.99] active:translate-y-[1px]"
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
                              <div className="flex min-w-0 items-center gap-3">
                                <UserAvatar
                                  user={foundUser}
                                  accessToken={accessToken}
                                  className="h-10 w-10 shrink-0 rounded-[14px]"
                                  fallbackClassName="text-sm"
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-[#171717]">
                                    {foundUser.displayName}
                                  </p>
                                  <p className="truncate text-xs text-stone-500">
                                    #{foundUser.username} · {foundUser.email}
                                  </p>
                                </div>
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
                              className="block rounded-[16px] border border-transparent px-3 py-2 transition-[transform,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-black/10 hover:bg-[#f7f7f5] active:scale-[0.99] active:translate-y-[1px]"
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

            <div className="rounded-[22px] border border-black/8 bg-white/95 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">
                  Realtime
                </p>
                <span
                  className={clsx(
                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                    connectionState === "connected" && !isOffline
                      ? "border-black/12 bg-[#111111] text-white"
                      : "border-black/12 bg-white text-stone-500",
                  )}
                >
                  {isOffline
                    ? "offline"
                    : connectionState === "connected"
                      ? "online"
                      : connectionState}
                </span>
              </div>
              <p className="mt-2 text-xs text-stone-500">{connectionStatusCopy}</p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-stone-400">
                Notifications
              </p>
              <p className="mt-2 text-xs text-stone-500">{notificationStatusCopy}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {notificationPermission === "default" ? (
                  <button
                    type="button"
                    onClick={() => {
                      void requestNotificationPermission();
                    }}
                    className="rounded-full border border-black/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black"
                  >
                    Включить
                  </button>
                ) : null}
                {notificationPermission === "granted" ? (
                  <button
                    type="button"
                    onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                    className="rounded-full border border-black/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black"
                  >
                    {notificationsEnabled ? "Отключить" : "Включить"}
                  </button>
                ) : null}
                {notificationPermission === "denied" ? (
                  <span className="rounded-full border border-black/10 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                    Разрешите в настройках браузера
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-6 flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Ваши чаты</p>
              <span className="rounded-full border border-black/8 bg-[#111111] px-2.5 py-1 text-xs font-semibold text-white">
                {chatsQuery.data?.length ?? 0}
              </span>
            </div>

            <div
              className="scroll-region-y scroll-region-overlay-right -mx-4 min-h-0 flex-1 overflow-y-auto sm:-mx-5"
              data-testid="chat-list"
            >
              {chatsQuery.isLoading ? (
                <>
                  <SidebarSkeleton />
                  <SidebarSkeleton />
                  <SidebarSkeleton />
                </>
              ) : chatsQuery.data?.length ? (
                <div className="overflow-hidden bg-white/92">
                  {chatsQuery.data.map((chat) => {
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
                    const onlineMembersCount = chat.members.filter(
                      (member) => member.id !== user?.id && isUserOnline(member.id),
                    ).length;
                    const typingMembers = chat.members.filter(
                      (member) => member.id !== user?.id && isUserTyping(chat.id, member.id),
                    );
                    const hasTyping = typingMembers.length > 0;
                    const statusText = isGroup
                      ? hasTyping
                        ? typingMembers.length === 1
                          ? `${typingMembers[0]?.displayName ?? "Кто-то"} печатает...`
                          : `${typingMembers.length} печатают...`
                        : `${chat.members.length} участников${onlineMembersCount > 0 ? ` · ${onlineMembersCount} онлайн` : ""}`
                      : hasTyping
                        ? "Печатает..."
                        : partner && isUserOnline(partner.id)
                          ? "В сети"
                          : partner?.lastSeenAt
                            ? `Был(а) ${formatRelativeLastSeen(partner.lastSeenAt)}`
                            : statusesMayBeStale
                              ? "Статус может быть устаревшим"
                              : "Личный чат";
                    const lastMessagePreview = hasTyping
                      ? typingMembers.length > 1
                        ? `${typingMembers.length} печатают...`
                        : "Печатает..."
                      : getLastMessagePreviewText(chat.lastMessage);

                    return (
                      <div
                        key={chat.id}
                        data-testid="chat-list-entry"
                        className={clsx(
                          "group px-4 py-3 transition-[transform,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:translate-y-[1px] active:scale-[0.988]",
                          isActive ? "bg-[#151515] text-white" : "bg-white/92 hover:bg-white",
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
                            className="h-12 w-12 shrink-0 rounded-[16px] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.01] group-active:scale-[0.96]"
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
                                className="min-w-0 flex-1 rounded-[18px] transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.995]"
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
                                  {statusText}
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
                                "mt-3 block truncate text-sm transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.995]",
                                isActive ? "text-white/76" : "text-stone-600",
                              )}
                            >
                              {lastMessagePreview}
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="rounded-[26px] border border-dashed border-black/12 bg-white/80 px-4 py-6 text-sm leading-6 text-stone-600"
                  data-testid="chat-list-empty"
                >
                  Пока нет чатов. Используйте общий поиск сверху или откройте меню, чтобы создать первую группу.
                </div>
              )}
            </div>
          </div>
        </aside>

        {isDesktopLayout ? (
          <button
            type="button"
            onPointerDown={startLeftSidebarResize}
            onDoubleClick={() => setLeftSidebarWidth(CHAT_LEFT_SIDEBAR_DEFAULT_WIDTH)}
            className="absolute bottom-0 top-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize border-0 bg-transparent lg:block"
            style={{ left: `${leftSidebarWidth}px` }}
            aria-label="Изменить ширину левой панели"
            title="Изменить ширину левой панели"
          >
            <span className="mx-auto block h-full w-[3px] rounded-full bg-black/6 transition hover:bg-black/18" />
          </button>
        ) : null}

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
      </ChatLayoutProvider>
    </RealtimeContext.Provider>
  );
}

function SidebarSkeleton() {
  return <div className="h-24 animate-pulse rounded-[24px] border border-black/6 bg-white/80" />;
}

function MenuIcon({ className }: { className?: string }) {
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
      <path d="M4 7h12" />
      <path d="M4 12h16" />
      <path d="M4 17h10" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
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
      <path d="M6 6 18 18" />
      <path d="m18 6-12 12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ProfileIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
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
      <path d="M14 16l4-4-4-4" />
      <path d="M18 12H9" />
      <path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function GroupsIcon({ className }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="3" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
