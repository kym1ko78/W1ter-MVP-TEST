"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { readJson, useAuth } from "../lib/auth-context";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_MB,
  getAttachmentKind,
  getAttachmentTypeLabel,
  validateAttachmentFile,
} from "../lib/attachment-rules";
import { useRealtime } from "../lib/realtime-context";
import {
  CHAT_CENTER_MIN_WIDTH,
  CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  CHAT_RIGHT_PANEL_MAX_WIDTH,
  CHAT_RIGHT_PANEL_MIN_WIDTH,
  useChatLayout,
} from "../lib/chat-layout-context";
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
  getLastMessagePreviewText,
} from "../lib/utils";
import type {
  ChatAttachment,
  ChatListItem,
  ChatMemberRole,
  ChatMessage,
  GroupMembersResponse,
  MessagePage,
  SafeUser,
} from "../types/api";
import { ConfirmDialog, DeleteMessageDialog } from "./confirm-dialog";
import { UserAvatar } from "./user-avatar";

const MESSAGE_MAX_LENGTH = 4000;
const COMPOSER_MIN_HEIGHT = 56;
const COMPOSER_MAX_HEIGHT = 200;
const VOICE_RECORDER_MIME_TYPE = "audio/webm";
const VOICE_RECORDING_FILE_NAME = "voice-message.webm";
const SCROLL_BOTTOM_THRESHOLD = 180;
const PROFILE_PANEL_TRANSITION_MS = 280;
const MESSAGE_CONTEXT_MENU_WIDTH = 276;
const MESSAGE_CONTEXT_MENU_MIN_HEIGHT = 360;
const MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN = 12;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "😮", "😢"] as const;

type ComposerPayload = {
  body: string;
  file: File | null;
  replyToMessageId?: string | null;
};

type DeleteChatResponse = {
  success: boolean;
  chatId: string;
};

type DeleteMessageMode = "self" | "everyone";

type DeleteMessagePayload = {
  messageId: string;
  mode: DeleteMessageMode;
};

type MessageContextMenuState = {
  message: ChatMessage;
  x: number;
  y: number;
};

type RecordingState = "idle" | "recording" | "stopping";

type EditMessagePayload = {
  messageId: string;
  body: string;
};

type ForwardMessagePayload = {
  messageId: string;
  targetChatId: string;
};

type ToggleReactionPayload = {
  messageId: string;
  emoji: (typeof QUICK_REACTIONS)[number];
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

type IconComponent = ComponentType<{ className?: string }>;

export function ConversationView({ chatId }: { chatId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { accessToken, authorizedFetch, isAuthenticated, user } = useAuth();
  const {
    connectionState,
    isOffline,
    statusesMayBeStale,
    isUserOnline,
    isUserTyping,
    updateTyping,
  } = useRealtime();
  const { isDesktopLayout, leftSidebarWidth, rightPanelWidth, setRightPanelWidth } = useChatLayout();
  const [draft, setDraft] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [showGroupMembersPanel, setShowGroupMembersPanel] = useState(false);
  const [groupMemberSearch, setGroupMemberSearch] = useState("");
  const [groupPanelError, setGroupPanelError] = useState<string | null>(null);
  const [confirmingMemberRemoval, setConfirmingMemberRemoval] = useState<{
    userId: string;
    displayName: string;
  } | null>(null);
  const [confirmingGroupLeave, setConfirmingGroupLeave] = useState(false);
  const [confirmingChatDeletion, setConfirmingChatDeletion] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [confirmingMessage, setConfirmingMessage] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardPanelError, setForwardPanelError] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [showConversationProfile, setShowConversationProfile] = useState(false);
  const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState | null>(null);
  const [headerStatusMessage, setHeaderStatusMessage] = useState<string | null>(null);
  const [isConversationProfileMounted, setIsConversationProfileMounted] = useState(false);
  const [isConversationProfileVisible, setIsConversationProfileVisible] = useState(false);
  const deferredMessageSearch = useDeferredValue(messageSearch);
  const deferredGroupMemberSearch = useDeferredValue(groupMemberSearch);
  const deferredForwardSearch = useDeferredValue(forwardSearch);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageSearchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageListEndRef = useRef<HTMLDivElement | null>(null);
  const conversationMenuRef = useRef<HTMLDivElement | null>(null);
  const conversationMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const conversationProfileRef = useRef<HTMLDivElement | null>(null);
  const conversationProfileButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldScrollAfterSendRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const hasInitialScrollRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const prefilledSearchQueryRef = useRef<string | null>(null);
  const focusedFromSearchParamRef = useRef<string | null>(null);
  const typingStopTimeoutRef = useRef<number | null>(null);
  const isLocalUserTypingRef = useRef(false);
  const shouldRefocusComposerRef = useRef(false);

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

  const chatsQuery = useQuery({
    queryKey: ["chats"],
    enabled: isAuthenticated,
    queryFn: async () => readJson<ChatListItem[]>(await authorizedFetch("/chats")),
  });

  const messageItems = useMemo(
    () => dedupeMessages(messagesQuery.data?.items ?? []),
    [messagesQuery.data?.items],
  );
  const normalizedMessageSearch = deferredMessageSearch.trim();
  const normalizedMessageSearchLower = normalizedMessageSearch.toLocaleLowerCase();
  const messageSearchMatches = useMemo(
    () =>
      normalizedMessageSearchLower
        ? messageItems.filter((message) =>
            (message.body ?? "").toLocaleLowerCase().includes(normalizedMessageSearchLower),
          )
        : [],
    [messageItems, normalizedMessageSearchLower],
  );
  const activeSearchMessage =
    messageSearchMatches.length > 0
      ? messageSearchMatches[Math.min(activeMatchIndex, messageSearchMatches.length - 1)] ?? null
      : null;
  const searchParamMessageId = searchParams?.get("message") ?? null;
  const searchParamQuery = searchParams?.get("q") ?? null;
  const normalizedGroupMemberSearch = deferredGroupMemberSearch.trim();
  const normalizedForwardSearch = deferredForwardSearch.trim().toLocaleLowerCase();
  const isGroupChat = chatQuery.data?.type === "group";

  const groupMembersQuery = useQuery({
    queryKey: ["group-members", chatId],
    enabled: isAuthenticated && isGroupChat && showGroupMembersPanel,
    queryFn: async () =>
      readJson<GroupMembersResponse>(await authorizedFetch(`/chats/${chatId}/members`)),
  });

  const groupUsersSearchQuery = useQuery({
    queryKey: ["group-users-search", chatId, normalizedGroupMemberSearch],
    enabled:
      isAuthenticated &&
      isGroupChat &&
      showGroupMembersPanel &&
      Boolean(groupMembersQuery.data?.permissions.canAddMembers) &&
      normalizedGroupMemberSearch.length > 1,
    queryFn: async () =>
      readJson<SafeUser[]>(
        await authorizedFetch(`/users/search?query=${encodeURIComponent(normalizedGroupMemberSearch)}`),
      ),
  });

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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const listElement = messageListRef.current;

    if (!listElement) {
      return;
    }

    const runScroll = () => {
      listElement.scrollTo({
        top: listElement.scrollHeight,
        behavior,
      });
    };

    window.requestAnimationFrame(() => {
      runScroll();
      window.requestAnimationFrame(runScroll);
    });
  }, []);

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea || textarea.disabled) {
        return;
      }

      textarea.focus();
      const caretPosition = textarea.value.length;
      textarea.setSelectionRange(caretPosition, caretPosition);
      });
    });
  }, []);

  const focusMessageById = useCallback((messageId: string, behavior: ScrollBehavior = "smooth") => {
    const listElement = messageListRef.current;

    if (!listElement) {
      return;
    }

    const escapedMessageId =
      typeof window !== "undefined" && window.CSS?.escape ? window.CSS.escape(messageId) : messageId;
    const messageElement = listElement.querySelector<HTMLElement>(
      `[data-message-id="${escapedMessageId}"]`,
    );

    if (!messageElement) {
      return;
    }

    const targetTop =
      messageElement.offsetTop - listElement.clientHeight / 2 + messageElement.clientHeight / 2;

    listElement.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
    setFocusedMessageId(messageId);
  }, []);

  const updateStickToBottomState = useCallback(() => {
    const listElement = messageListRef.current;

    if (!listElement) {
      shouldStickToBottomRef.current = true;
      return;
    }

    const distanceToBottom =
      listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight;

    shouldStickToBottomRef.current = distanceToBottom <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const setLocalTypingState = useCallback(
    (nextValue: boolean) => {
      if (isLocalUserTypingRef.current === nextValue) {
        return;
      }

      isLocalUserTypingRef.current = nextValue;
      updateTyping(chatId, nextValue);
    },
    [chatId, updateTyping],
  );

  const sendMessageMutation = useMutation({
    mutationFn: async ({ body, file, replyToMessageId }: ComposerPayload) => {
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        if (body) {
          formData.append("body", body);
        }
        if (replyToMessageId) {
          formData.append("replyToMessageId", replyToMessageId);
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
          body: JSON.stringify({
            body,
            replyToMessageId: replyToMessageId ?? undefined,
          }),
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
      setReplyingToMessage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      scrollToBottom("smooth");
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить сообщение. Попробуйте еще раз.",
      );
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, body }: EditMessagePayload) =>
      readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages/${messageId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body }),
        }),
      ),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagePage>(["messages", chatId], (old) =>
        upsertMessage(old, message),
      );
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
      setComposerError(null);
      setEditingMessage(null);
      setDraft("");
      setFocusedMessageId(message.id);
      focusMessageById(message.id, "smooth");
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error ? error.message : "Не удалось сохранить изменения сообщения.",
      );
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async ({ messageId, mode }: DeleteMessagePayload) =>
      readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages/${messageId}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode }),
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

  const forwardMessageMutation = useMutation({
    mutationFn: async ({ messageId, targetChatId }: ForwardMessagePayload) =>
      readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages/${messageId}/forward`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetChatId,
          }),
        }),
      ),
    onSuccess: (forwardedMessage) => {
      queryClient.setQueryData<MessagePage>(["messages", forwardedMessage.chatId], (old) =>
        appendMessageUnique(old, forwardedMessage),
      );

      if (forwardedMessage.chatId === chatId) {
        shouldScrollAfterSendRef.current = true;
        scrollToBottom("smooth");
      }

      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", forwardedMessage.chatId] });
      setForwardPanelError(null);
      setForwardingMessage(null);
      setForwardSearch("");
    },
    onError: (error) => {
      setForwardPanelError(
        error instanceof Error ? error.message : "Не удалось переслать сообщение.",
      );
    },
  });

  const toggleReactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: ToggleReactionPayload) =>
      readJson<ChatMessage>(
        await authorizedFetch(`/chats/${chatId}/messages/${messageId}/reaction`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ emoji }),
        }),
      ),
    onSuccess: (message, variables) => {
      queryClient.setQueryData<MessagePage>(["messages", chatId], (old) =>
        upsertMessage(old, message),
      );
      setComposerError(null);
      setForwardPanelError(null);
    },
    onError: (error) => {
      setComposerError(
        error instanceof Error ? error.message : "Не удалось обновить реакцию. Попробуйте еще раз.",
      );
    },
  });

  const addGroupMemberMutation = useMutation({
    mutationFn: async (userId: string) =>
      readJson<GroupMembersResponse>(
        await authorizedFetch(`/chats/${chatId}/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId }),
        }),
      ),
    onSuccess: (payload) => {
      queryClient.setQueryData<GroupMembersResponse>(["group-members", chatId], payload);
      setGroupPanelError(null);
      setGroupMemberSearch("");
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
    onError: (error) => {
      setGroupPanelError(
        error instanceof Error ? error.message : "Не удалось добавить участника.",
      );
    },
  });

  const removeGroupMemberMutation = useMutation({
    mutationFn: async (userId: string) =>
      readJson<GroupMembersResponse>(
        await authorizedFetch(`/chats/${chatId}/members/${userId}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: (payload) => {
      queryClient.setQueryData<GroupMembersResponse>(["group-members", chatId], payload);
      setGroupPanelError(null);
      setConfirmingMemberRemoval(null);
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
    onError: (error) => {
      setGroupPanelError(
        error instanceof Error ? error.message : "Не удалось удалить участника.",
      );
    },
  });

  const updateGroupMemberRoleMutation = useMutation({
    mutationFn: async (payload: { userId: string; role: "admin" | "member" }) =>
      readJson<GroupMembersResponse>(
        await authorizedFetch(`/chats/${chatId}/members/${payload.userId}/role`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: payload.role }),
        }),
      ),
    onSuccess: (payload) => {
      queryClient.setQueryData<GroupMembersResponse>(["group-members", chatId], payload);
      setGroupPanelError(null);
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
    onError: (error) => {
      setGroupPanelError(
        error instanceof Error ? error.message : "Не удалось изменить роль участника.",
      );
    },
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async () =>
      readJson<{ success: boolean; chatId: string }>(
        await authorizedFetch(`/chats/${chatId}/leave`, {
          method: "POST",
        }),
      ),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["group-members", chatId] });
      queryClient.removeQueries({ queryKey: ["chat", chatId] });
      queryClient.removeQueries({ queryKey: ["messages", chatId] });
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      startTransition(() => {
        router.replace("/chat");
      });
    },
    onError: (error) => {
      setGroupPanelError(error instanceof Error ? error.message : "Не удалось выйти из группы.");
    },
    onSettled: () => {
      setConfirmingGroupLeave(false);
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: async () =>
      readJson<DeleteChatResponse>(
        await authorizedFetch(`/chats/${chatId}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: ({ chatId: deletedChatId }) => {
      queryClient.removeQueries({ queryKey: ["group-members", deletedChatId] });
      queryClient.removeQueries({ queryKey: ["chat", deletedChatId] });
      queryClient.removeQueries({ queryKey: ["messages", deletedChatId] });
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      setShowConversationMenu(false);
      setShowConversationProfile(false);
      startTransition(() => {
        router.replace("/chat");
      });
    },
    onError: (error) => {
      setHeaderStatusMessage(
        error instanceof Error ? error.message : "Не удалось удалить этот чат.",
      );
    },
    onSettled: () => {
      setConfirmingChatDeletion(false);
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
    const hasTypingSignal = recordingState === "idle" && draft.trim().length > 0;

    if (!hasTypingSignal) {
      if (typingStopTimeoutRef.current !== null) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }

      setLocalTypingState(false);
      return;
    }

    setLocalTypingState(true);

    if (typingStopTimeoutRef.current !== null) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = window.setTimeout(() => {
      typingStopTimeoutRef.current = null;
      setLocalTypingState(false);
    }, 1_800);
  }, [draft, recordingState, setLocalTypingState]);

  useEffect(
    () => () => {
      if (typingStopTimeoutRef.current !== null) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }

      setLocalTypingState(false);
      isLocalUserTypingRef.current = false;
    },
    [setLocalTypingState],
  );

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
    setActiveMatchIndex(0);
  }, [chatId, normalizedMessageSearch]);

  useEffect(() => {
    setShowGroupMembersPanel(false);
    setShowMessageSearch(false);
    setShowConversationMenu(false);
    setShowConversationProfile(false);
    setHeaderStatusMessage(null);
    setGroupMemberSearch("");
    setGroupPanelError(null);
    setConfirmingMemberRemoval(null);
    setConfirmingGroupLeave(false);
    setReplyingToMessage(null);
    setEditingMessage(null);
    setForwardingMessage(null);
    setForwardSearch("");
    setForwardPanelError(null);
  }, [chatId]);

  useEffect(() => {
    if (activeMatchIndex < messageSearchMatches.length) {
      return;
    }

    setActiveMatchIndex(0);
  }, [activeMatchIndex, messageSearchMatches.length]);

  useEffect(() => {
    if (!searchParamQuery) {
      return;
    }

    const searchKey = `${chatId}:${searchParamQuery}`;
    if (prefilledSearchQueryRef.current === searchKey) {
      return;
    }

    prefilledSearchQueryRef.current = searchKey;
    setMessageSearch((current) => current || searchParamQuery.slice(0, MESSAGE_MAX_LENGTH));
  }, [chatId, searchParamQuery]);

  useEffect(() => {
    if (!normalizedMessageSearch) {
      return;
    }

    setShowMessageSearch(true);
  }, [normalizedMessageSearch]);

  useEffect(() => {
    if (!showMessageSearch) {
      return;
    }

    window.requestAnimationFrame(() => {
      messageSearchInputRef.current?.focus();
      messageSearchInputRef.current?.select();
    });
  }, [showMessageSearch]);

  useEffect(() => {
    if (!headerStatusMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHeaderStatusMessage(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [headerStatusMessage]);

  useEffect(() => {
    if (showConversationProfile) {
      setIsConversationProfileMounted(true);
      const frameId = window.requestAnimationFrame(() => {
        setIsConversationProfileVisible(true);
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    if (!isConversationProfileMounted) {
      return;
    }

    setIsConversationProfileVisible(false);
    const timeoutId = window.setTimeout(() => {
      setIsConversationProfileMounted(false);
    }, PROFILE_PANEL_TRANSITION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isConversationProfileMounted, showConversationProfile]);

  useEffect(() => {
    const handleWindowBlur = () => {
      setLocalTypingState(false);
    };

    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [setLocalTypingState]);

  useEffect(() => {
    if (!showConversationMenu && !showConversationProfile) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (!target) {
        return;
      }

      if (
        showConversationMenu &&
        !conversationMenuRef.current?.contains(target) &&
        !conversationMenuButtonRef.current?.contains(target)
      ) {
        setShowConversationMenu(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setShowConversationMenu(false);
      setShowConversationProfile(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showConversationMenu, showConversationProfile]);

  useEffect(() => {
    if (!messageContextMenu) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMessageContextMenu(null);
      }
    };

    const handleResize = () => {
      setMessageContextMenu(null);
    };

    const listElement = messageListRef.current;
    listElement?.addEventListener("scroll", handleResize, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      listElement?.removeEventListener("scroll", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [messageContextMenu]);

  useEffect(() => {
    if (!activeSearchMessage) {
      return;
    }

    focusMessageById(activeSearchMessage.id, "smooth");
  }, [activeSearchMessage, focusMessageById]);

  useEffect(() => {
    if (!searchParamMessageId) {
      return;
    }

    if (!messageItems.some((message) => message.id === searchParamMessageId)) {
      return;
    }

    const focusKey = `${chatId}:${searchParamMessageId}`;
    if (focusedFromSearchParamRef.current === focusKey) {
      return;
    }

    focusedFromSearchParamRef.current = focusKey;
    focusMessageById(searchParamMessageId, "smooth");
  }, [chatId, focusMessageById, messageItems, searchParamMessageId]);

  useEffect(() => {
    const lastMessage = messageItems[messageItems.length - 1] ?? null;

    if (!lastMessage) {
      lastMessageIdRef.current = null;
      hasInitialScrollRef.current = false;
      return;
    }

    const isInitialRender = !hasInitialScrollRef.current;
    const isNewLastMessage = lastMessage.id !== lastMessageIdRef.current;
    const isOwnMessage = lastMessage.senderId === user?.id;
    const shouldScroll =
      isInitialRender ||
      shouldScrollAfterSendRef.current ||
      isOwnMessage ||
      shouldStickToBottomRef.current;

    lastMessageIdRef.current = lastMessage.id;
    hasInitialScrollRef.current = true;

    if (isNewLastMessage && shouldScroll) {
      scrollToBottom(isInitialRender ? "auto" : "smooth");
    }

    shouldScrollAfterSendRef.current = false;
  }, [messageItems, scrollToBottom, user?.id]);

  const chatMembers = chatQuery.data?.members ?? [];
  const otherUser = useMemo(
    () =>
      chatQuery.data?.type === "direct"
        ? chatMembers.find((member) => member.id !== user?.id) ?? null
        : null,
    [chatMembers, chatQuery.data?.type, user?.id],
  );
  const conversationTitle = getChatTitle(chatMembers, user?.id, {
    type: chatQuery.data?.type,
    title: chatQuery.data?.title,
  });
  const forwardCandidates = useMemo(() => {
    const candidates = chatsQuery.data ?? [];

    return candidates
      .map((chat) => {
        const title = getChatTitle(chat.members, user?.id, {
          type: chat.type,
          title: chat.title,
        });
        const lastMessagePreview = getLastMessagePreviewText(chat.lastMessage);
        const searchableContent = `${title} ${lastMessagePreview}`.toLocaleLowerCase();

        return {
          ...chat,
          title,
          lastMessagePreview,
          isCurrentChat: chat.id === chatId,
          searchableContent,
        };
      })
      .filter((chat) =>
        normalizedForwardSearch ? chat.searchableContent.includes(normalizedForwardSearch) : true,
      )
      .sort((left, right) => {
        if (left.isCurrentChat && !right.isCurrentChat) {
          return -1;
        }

        if (!left.isCurrentChat && right.isCurrentChat) {
          return 1;
        }

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });
  }, [chatId, chatsQuery.data, normalizedForwardSearch, user?.id]);
  const existingGroupMemberIds = useMemo(
    () =>
      new Set(
        (
          groupMembersQuery.data?.members.map((member) => member.user.id) ??
          chatMembers.map((member) => member.id)
        ).filter(Boolean),
      ),
    [chatMembers, groupMembersQuery.data?.members],
  );
  const availableGroupUsers = useMemo(
    () =>
      (groupUsersSearchQuery.data ?? []).filter(
        (candidate) => candidate.id !== user?.id && !existingGroupMemberIds.has(candidate.id),
      ),
    [existingGroupMemberIds, groupUsersSearchQuery.data, user?.id],
  );
  const groupMembersCount = groupMembersQuery.data?.members.length ?? chatMembers.length;
  const onlineGroupMembersCount = chatMembers.filter(
    (member) => member.id !== user?.id && isUserOnline(member.id),
  ).length;
  const typingGroupMembers = chatMembers.filter(
    (member) => member.id !== user?.id && isUserTyping(chatId, member.id),
  );
  const isDirectUserOnline = Boolean(otherUser?.id && isUserOnline(otherUser.id));
  const isDirectUserTyping = Boolean(otherUser?.id && isUserTyping(chatId, otherUser.id));
  const directStatusText = isDirectUserTyping
    ? "Печатает..."
    : isDirectUserOnline
      ? "В сети"
      : otherUser?.lastSeenAt
        ? `Был(а) ${formatRelativeLastSeen(otherUser.lastSeenAt)}`
        : statusesMayBeStale
          ? "Статус может быть устаревшим"
          : "Личный чат";
  const groupStatusText = typingGroupMembers.length
    ? typingGroupMembers.length === 1
      ? `${typingGroupMembers[0]?.displayName ?? "Кто-то"} печатает...`
      : `${typingGroupMembers.length} печатают...`
    : `${groupMembersCount} участников${onlineGroupMembersCount > 0 ? ` · ${onlineGroupMembersCount} онлайн` : ""}`;
  const profileSummaryStatus = isGroupChat ? groupStatusText : directStatusText;
  const realtimeStateCopy = isOffline
    ? "Оффлайн. Соединение восстановится автоматически."
    : connectionState === "connected"
      ? null
      : connectionState === "connecting"
        ? "Подключаемся к realtime..."
        : "Связь потеряна. Статусы могут быть устаревшими.";
  const typingIndicatorLabel = isGroupChat
    ? typingGroupMembers.length === 1
      ? `${typingGroupMembers[0]?.displayName ?? "Кто-то"} печатает...`
      : typingGroupMembers.length > 1
        ? `${typingGroupMembers.length} печатают...`
        : null
    : isDirectUserTyping
      ? `${otherUser?.displayName ?? "Собеседник"} печатает...`
      : null;
  const pendingAttachmentTypeLabel = pendingFile
    ? getAttachmentTypeLabel({
        mimeType: pendingFile.type,
        isImage: pendingFile.type.startsWith("image/"),
        originalName: pendingFile.name,
      })
    : null;
  const isEditingMessage = Boolean(editingMessage);
  const composerText = draft.trim();
  const isComposerSubmitPending = sendMessageMutation.isPending || editMessageMutation.isPending;
  const hasComposerContent = isEditingMessage
    ? Boolean(composerText)
    : Boolean(composerText || pendingFile);
  const showSendButton = hasComposerContent || isComposerSubmitPending;
  const showVoiceButton =
    !isEditingMessage && !hasComposerContent && !isComposerSubmitPending && recordingState === "idle";
  const composerActionMode = showSendButton ? "send" : showVoiceButton ? "voice" : "hidden";
  const showComposerAction = composerActionMode !== "hidden";
  const hasSearchInput = normalizedMessageSearch.length > 0;
  const hasSearchMatches = messageSearchMatches.length > 0;
  const activeSearchNumber = hasSearchMatches
    ? Math.min(activeMatchIndex + 1, messageSearchMatches.length)
    : 0;
  const submitButtonLabel = isEditingMessage ? "Сохранить изменения" : "Отправить сообщение";
  const isGroupActionPending =
    addGroupMemberMutation.isPending ||
    removeGroupMemberMutation.isPending ||
    updateGroupMemberRoleMutation.isPending ||
    leaveGroupMutation.isPending;
  const conversationProfileUser: SafeUser = otherUser ?? {
    id: chatId,
    displayName: conversationTitle,
    username: isGroupChat ? `chat_${chatId.slice(0, 8)}` : `user_${chatId.slice(0, 8)}`,
    email: isGroupChat ? `${groupMembersCount} участников` : conversationTitle,
    avatarUrl: null,
    emailVerifiedAt: null,
    emailVerificationSentAt: null,
    lastSeenAt: null,
  };
  const conversationProfileHandle =
    !isGroupChat && conversationProfileUser.username ? `#${conversationProfileUser.username}` : null;
  const usesSplitConversationLayout = isConversationProfileMounted;
  const conversationProfileOffsetStyle =
    isDesktopLayout && isConversationProfileMounted
      ? { paddingRight: `${rightPanelWidth}px` }
      : undefined;
  const handleRightPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isDesktopLayout || typeof window === "undefined") {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const initialWidth = rightPanelWidth;
      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const viewportWidth = window.innerWidth;
        const rawWidth = initialWidth - (moveEvent.clientX - startX);
        const maxWidth = Math.max(
          CHAT_RIGHT_PANEL_MIN_WIDTH,
          Math.min(
            CHAT_RIGHT_PANEL_MAX_WIDTH,
            viewportWidth - leftSidebarWidth - CHAT_CENTER_MIN_WIDTH,
          ),
        );
        const nextWidth = Math.min(Math.max(rawWidth, CHAT_RIGHT_PANEL_MIN_WIDTH), maxWidth);
        setRightPanelWidth(nextWidth);
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
    [isDesktopLayout, leftSidebarWidth, rightPanelWidth, setRightPanelWidth],
  );
  const messageContextMenuPosition = useMemo(() => {
    if (!messageContextMenu || typeof window === "undefined") {
      return null;
    }

    const maxLeft = Math.max(
      MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN,
      window.innerWidth - MESSAGE_CONTEXT_MENU_WIDTH - MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN,
    );
    const maxTop = Math.max(
      MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN,
      window.innerHeight - MESSAGE_CONTEXT_MENU_MIN_HEIGHT - MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN,
    );

    return {
      left: Math.min(Math.max(messageContextMenu.x, MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(messageContextMenu.y, MESSAGE_CONTEXT_MENU_VIEWPORT_MARGIN), maxTop),
    };
  }, [messageContextMenu]);
  const profileDetailRows = isGroupChat
    ? [
        { label: "Тип", value: "Групповой чат" },
        { label: "Участники", value: String(groupMembersCount) },
        { label: "Онлайн", value: String(onlineGroupMembersCount) },
        {
          label: "Ваша роль",
          value: formatGroupRole(chatQuery.data?.currentUserRole ?? "member"),
        },
      ]
    : [
        { label: "Ник", value: conversationProfileHandle ?? "Не задан" },
        { label: "Email", value: conversationProfileUser.email },
        {
          label: "Статус",
          value: directStatusText,
        },
        {
          label: "Последняя активность",
          value: isDirectUserOnline
            ? "Сейчас в сети"
            : otherUser?.lastSeenAt
              ? formatTime(otherUser.lastSeenAt)
              : statusesMayBeStale
                ? "Данные могут быть устаревшими"
                : "Сейчас недоступно",
        },
      ];
  const visibleGroupMembers = groupMembersQuery.data?.members ?? [];
  const canDeleteConversation = !isGroupChat || chatQuery.data?.currentUserRole === "creator";
  const destructiveConversationLabel = canDeleteConversation
    ? isGroupChat
      ? "Удалить группу"
      : "Удалить чат"
    : "Выйти из группы";
  const mediaStats = useMemo(() => {
    let imageCount = 0;
    let videoCount = 0;
    let audioCount = 0;
    let fileCount = 0;
    let linkCount = 0;

    for (const message of messageItems) {
      linkCount += (message.body?.match(/(?:https?:\/\/|www\.)\S+/gi) ?? []).length;

      for (const attachment of message.attachments) {
        const kind = getAttachmentKind(attachment);

        if (kind === "image") {
          imageCount += 1;
          continue;
        }

        if (kind === "video") {
          videoCount += 1;
          continue;
        }

        if (kind === "audio") {
          audioCount += 1;
          continue;
        }

        fileCount += 1;
      }
    }

    return [
      { key: "images", label: "Фотографии", value: imageCount, icon: GalleryIcon },
      { key: "videos", label: "Видео", value: videoCount, icon: VideoIcon },
      { key: "files", label: "Файлы", value: fileCount, icon: FileStackIcon },
      { key: "audio", label: "Аудио", value: audioCount, icon: AudioBarsIcon },
      { key: "links", label: "Ссылки", value: linkCount, icon: LinkChainIcon },
    ];
  }, [messageItems]);
  const contextMenuMessage = messageContextMenu?.message ?? null;
  const contextMenuTimestampLabel = contextMenuMessage
    ? `${formatConversationDateLabel(contextMenuMessage.createdAt).toLocaleLowerCase()} в ${formatTime(contextMenuMessage.createdAt)}`
    : null;
  const contextMenuCurrentUserReaction =
    contextMenuMessage && user?.id
      ? contextMenuMessage.reactions.find((reaction) => reaction.userIds.includes(user.id))?.emoji ??
        null
      : null;

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const moveMessageSearch = useCallback(
    (direction: -1 | 1) => {
      if (!messageSearchMatches.length) {
        return;
      }

      setActiveMatchIndex((current) => {
        const total = messageSearchMatches.length;
        const normalizedCurrent = ((current % total) + total) % total;
        return (normalizedCurrent + direction + total) % total;
      });
    },
    [messageSearchMatches.length],
  );

  const startVoiceRecording = useCallback(async () => {
    if (recordingState !== "idle" || isComposerSubmitPending || isEditingMessage) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setComposerError("Запись голосовых сообщений не поддерживается в этом браузере.");
      return;
    }

    try {
      setLocalTypingState(false);
      setComposerError(null);
      setPendingFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      recordedChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported(VOICE_RECORDER_MIME_TYPE)
          ? VOICE_RECORDER_MIME_TYPE
          : "";
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecordingState("recording");

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopMediaStream();
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setRecordingState("idle");
        setRecordingSeconds(0);
        setComposerError("Не удалось записать голосовое сообщение.");
      };

      recorder.start();
    } catch (error) {
      stopMediaStream();
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      setRecordingState("idle");
      setRecordingSeconds(0);
      setComposerError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Разрешите доступ к микрофону, чтобы записывать голосовые."
          : "Не удалось получить доступ к микрофону.",
      );
    }
  }, [
    isComposerSubmitPending,
    isEditingMessage,
    recordingState,
    setLocalTypingState,
    stopMediaStream,
  ]);

  const finishVoiceRecording = useCallback(
    (shouldSend: boolean) => {
      const recorder = mediaRecorderRef.current;

      if (!recorder || recorder.state === "inactive") {
        stopMediaStream();
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setRecordingState("idle");
        setRecordingSeconds(0);
        return;
      }

      setRecordingState("stopping");

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || VOICE_RECORDER_MIME_TYPE;
        const normalizedMimeType = mimeType.includes("audio/ogg")
          ? "audio/ogg"
          : mimeType.includes("audio/webm")
            ? VOICE_RECORDER_MIME_TYPE
            : mimeType;
        const chunks = recordedChunksRef.current;

        stopMediaStream();
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setRecordingState("idle");
        setRecordingSeconds(0);

        if (!shouldSend) {
          return;
        }

        const blob = new Blob(chunks, { type: normalizedMimeType });

        if (blob.size <= 0) {
          setComposerError("Голосовое сообщение получилось пустым. Попробуйте ещё раз.");
          return;
        }

        const voiceFile = new File([blob], VOICE_RECORDING_FILE_NAME, {
          type: normalizedMimeType,
        });

        shouldScrollAfterSendRef.current = true;
        shouldRefocusComposerRef.current = true;
        sendMessageMutation.mutate({
          body: "",
          file: voiceFile,
          replyToMessageId: replyingToMessage?.id ?? null,
        });
      };

      recorder.stop();
    },
    [replyingToMessage?.id, sendMessageMutation, stopMediaStream],
  );

  useEffect(() => {
    if (recordingState !== "recording") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [recordingState]);

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      stopMediaStream();
    },
    [stopMediaStream],
  );

  useEffect(() => {
    if (recordingState !== "idle" || isComposerSubmitPending) {
      return;
    }

    if (!shouldRefocusComposerRef.current) {
      return;
    }

    shouldRefocusComposerRef.current = false;
    focusComposer();
  }, [focusComposer, isComposerSubmitPending, recordingState]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isEditingMessage) {
      setComposerError("При редактировании вложения недоступны.");
      event.target.value = "";
      return;
    }

    const selectedFile = event.target.files?.[0] ?? null;

    if (!selectedFile) {
      setPendingFile(null);
      return;
    }

    const validation = validateAttachmentFile(selectedFile);
    if (!validation.isValid) {
      setComposerError(validation.error);
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
    const body = composerText;
    if (
      (!body && !pendingFile) ||
      isComposerSubmitPending ||
      recordingState !== "idle"
    ) {
      return;
    }

    if (body.length > MESSAGE_MAX_LENGTH) {
      setComposerError(`Сообщение не должно превышать ${MESSAGE_MAX_LENGTH} символов.`);
      return;
    }

    setLocalTypingState(false);
    setComposerError(null);
    if (editingMessage) {
      shouldRefocusComposerRef.current = true;
      editMessageMutation.mutate({ messageId: editingMessage.id, body });
      return;
    }

    shouldRefocusComposerRef.current = true;
    sendMessageMutation.mutate({
      body,
      file: pendingFile,
      replyToMessageId: replyingToMessage?.id ?? null,
    });
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

    setMessageContextMenu(null);
    setConfirmingMessage(message);
  };

  const handleDeleteMessageMode = (mode: DeleteMessageMode) => {
    if (!confirmingMessage) {
      return;
    }

    deleteMessageMutation.mutate({
      messageId: confirmingMessage.id,
      mode,
    });
  };

  const openMessageContextMenu = useCallback(
    (message: ChatMessage, x: number, y: number) => {
      setShowConversationMenu(false);
      setShowConversationProfile(false);
      setMessageContextMenu({ message, x, y });
    },
    [],
  );

  const closeMessageContextMenu = useCallback(() => {
    setMessageContextMenu(null);
  }, []);

  const handleReplyMessage = (message: ChatMessage) => {
    if (recordingState !== "idle" || isComposerSubmitPending) {
      return;
    }

    if (message.isDeleted) {
      setComposerError("Нельзя ответить на удаленное сообщение.");
      return;
    }

    setMessageContextMenu(null);
    setComposerError(null);
    setEditingMessage(null);
    setReplyingToMessage(message);
    setPendingFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    textareaRef.current?.focus();
  };

  const handleStartEditingMessage = (message: ChatMessage) => {
    if (recordingState !== "idle" || isComposerSubmitPending) {
      return;
    }

    if (message.senderId !== user?.id || message.isDeleted) {
      return;
    }

    setMessageContextMenu(null);
    setComposerError(null);
    setReplyingToMessage(null);
    setEditingMessage(message);
    setDraft(message.body ?? "");
    setPendingFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    queueMicrotask(() => textareaRef.current?.focus());
  };

  const handleStartForwardMessage = (message: ChatMessage) => {
    if (message.isDeleted) {
      setComposerError("Удаленное сообщение нельзя переслать.");
      return;
    }

    if (!message.body?.trim() && message.attachments.length === 0) {
      setComposerError("В этом сообщении нечего пересылать.");
      return;
    }

    setMessageContextMenu(null);
    setComposerError(null);
    setForwardPanelError(null);
    setForwardSearch("");
    setForwardingMessage(message);
  };

  const handleForwardToChat = (targetChatId: string) => {
    if (!forwardingMessage || forwardMessageMutation.isPending) {
      return;
    }

    forwardMessageMutation.mutate({
      messageId: forwardingMessage.id,
      targetChatId,
    });
  };

  const handleToggleMessageReaction = (
    message: ChatMessage,
    emoji: (typeof QUICK_REACTIONS)[number],
  ) => {
    if (message.isDeleted || toggleReactionMutation.isPending) {
      return;
    }

    setMessageContextMenu(null);
    toggleReactionMutation.mutate({
      messageId: message.id,
      emoji,
    });
  };

  const handleCopyMessageText = useCallback(async (message: ChatMessage) => {
    const text = message.body?.trim();

    if (!text) {
      setHeaderStatusMessage("В этом сообщении нет текста для копирования.");
      setMessageContextMenu(null);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setHeaderStatusMessage("Текст сообщения скопирован.");
    } catch {
      setHeaderStatusMessage("Не удалось скопировать текст сообщения.");
    } finally {
      setMessageContextMenu(null);
    }
  }, []);

  const handlePinMessageStub = useCallback((message: ChatMessage) => {
    setFocusedMessageId(message.id);
    setHeaderStatusMessage("Закрепление сообщений добавим следующим шагом.");
    setMessageContextMenu(null);
  }, []);

  const handleSelectMessageStub = useCallback((message: ChatMessage) => {
    setFocusedMessageId(message.id);
    focusMessageById(message.id, "smooth");
    setHeaderStatusMessage("Режим выделения добавим следующим шагом.");
    setMessageContextMenu(null);
  }, [focusMessageById]);

  const cancelComposerContext = () => {
    if (editingMessage) {
      setEditingMessage(null);
      setDraft("");
    }

    setReplyingToMessage(null);
    setPendingFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setComposerError(null);
  };

  const handleToggleGroupMemberRole = (
    targetUserId: string,
    currentRole: ChatMemberRole,
  ) => {
    if (currentRole === "creator") {
      return;
    }

    updateGroupMemberRoleMutation.mutate({
      userId: targetUserId,
      role: currentRole === "admin" ? "member" : "admin",
    });
  };

  const canRemoveGroupMember = (member: GroupMembersResponse["members"][number]) => {
    const permissions = groupMembersQuery.data?.permissions;

    if (!permissions?.canRemoveMembers || member.isCurrentUser || member.role === "creator") {
      return false;
    }

    if (permissions.isCreator) {
      return true;
    }

    return member.role !== "admin";
  };

  const handleConversationCall = () => {
    setHeaderStatusMessage("Звонки добавим следующим шагом.");
    setShowConversationMenu(false);
  };

  const announceConversationAction = (
    message: string,
    options?: { closeMenu?: boolean; closeProfile?: boolean },
  ) => {
    setHeaderStatusMessage(message);
    if (options?.closeMenu ?? true) {
      setShowConversationMenu(false);
    }
    if (options?.closeProfile) {
      setShowConversationProfile(false);
    }
  };

  const openConversationProfile = () => {
    setShowConversationMenu(false);
    setShowConversationProfile(true);
  };

  const openGroupMembersPanel = () => {
    setShowConversationMenu(false);
    setShowConversationProfile(false);
    setShowGroupMembersPanel(true);
  };

  const handleConversationDangerAction = () => {
    setShowConversationMenu(false);

    if (canDeleteConversation) {
      setConfirmingChatDeletion(true);
      return;
    }

    setConfirmingGroupLeave(true);
  };

  const toggleMessageSearch = () => {
    setShowConversationMenu(false);
    setShowConversationProfile(false);
    setShowMessageSearch((current) => {
      const next = !current;

      if (!next) {
        setMessageSearch("");
        setActiveMatchIndex(0);
        setFocusedMessageId(null);
      }

      return next;
    });
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
      className="chat-shell-panel chat-thread-surface relative flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0"
      data-testid="conversation-view"
    >
      <header
        className="relative z-20 flex flex-none border-b border-black/8 bg-white px-4 py-3 transition-[padding] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-5"
        style={conversationProfileOffsetStyle}
      >
        <div className="flex w-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-[21px] font-semibold leading-none tracking-tight text-[#171717]"
            data-testid="conversation-title"
          >
            {conversationTitle}
          </h2>
          <p
            className="mt-2 truncate text-sm text-stone-500"
            data-testid="conversation-status"
          >
            {profileSummaryStatus}
          </p>
          {realtimeStateCopy ? (
            <p className="mt-1 text-xs text-stone-500">{realtimeStateCopy}</p>
          ) : null}
          {headerStatusMessage ? (
            <p className="mt-2 text-xs font-medium text-stone-500">{headerStatusMessage}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-stone-400 sm:gap-2">
          <button
            type="button"
            onClick={toggleMessageSearch}
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-full border border-transparent transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black",
              showMessageSearch || hasSearchInput ? "border-black/12 bg-[#111111] text-white hover:bg-black hover:text-white" : null,
            )}
            aria-label="Поиск по сообщениям"
            title="Поиск по сообщениям"
          >
            <SearchIcon className="h-5 w-5" />
          </button>
          <button
            ref={conversationProfileButtonRef}
            type="button"
            onClick={() => {
              setShowConversationMenu(false);
              setShowConversationProfile((current) => !current);
            }}
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-full border border-transparent transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black",
              showConversationProfile ? "border-black/12 bg-[#111111] text-white hover:bg-black hover:text-white" : null,
            )}
            aria-label="Открыть профиль чата"
            title="Открыть профиль чата"
          >
            <PanelRightIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleConversationCall}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black"
            aria-label="Позвонить собеседнику"
            title="Позвонить собеседнику"
          >
            <PhoneIcon className="h-5 w-5" />
          </button>
          <div className="relative">
            <button
              ref={conversationMenuButtonRef}
              type="button"
              onClick={() => {
                setShowConversationProfile(false);
                setShowConversationMenu((current) => !current);
              }}
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-full border border-transparent transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black",
                showConversationMenu ? "border-black/12 bg-[#111111] text-white hover:bg-black hover:text-white" : null,
              )}
              aria-label="Дополнительные действия"
              title="Дополнительные действия"
            >
              <DotsVerticalIcon className="h-5 w-5" />
            </button>

            {showConversationMenu ? (
              <div
                ref={conversationMenuRef}
                className="absolute right-0 top-12 z-30 w-[292px] max-w-[calc(100vw-2rem)] rounded-[28px] border border-black/8 bg-[rgba(255,255,255,0.98)] p-2 text-sm text-[#171717] shadow-[0_28px_60px_rgba(17,24,39,0.16)] backdrop-blur"
              >
                <div className="px-3 pb-2 pt-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-stone-400">
                    Быстрые действия
                  </p>
                </div>
                <div className="space-y-1 px-1 pb-2">
                  <ConversationMenuRow
                    icon={PanelRightIcon}
                    label="Открыть профиль"
                    onClick={openConversationProfile}
                    showChevron
                  />
                  <ConversationMenuRow
                    icon={SearchIcon}
                    label={showMessageSearch || hasSearchInput ? "Скрыть поиск" : "Искать в чате"}
                    onClick={toggleMessageSearch}
                  />
                  {isGroupChat ? (
                    <ConversationMenuRow
                      icon={UsersIcon}
                      label={showGroupMembersPanel ? "Скрыть участников" : "Показать участников"}
                      onClick={() => {
                        setShowConversationMenu(false);
                        setShowGroupMembersPanel((current) => !current);
                      }}
                      showChevron
                    />
                  ) : null}
                </div>
                <div className="mx-3 h-px bg-black/6" />
                <div className="space-y-1 px-1 py-2">
                  <ConversationMenuRow
                    icon={BellOffIcon}
                    label="Выключить уведомления"
                    onClick={() =>
                      announceConversationAction("Настройки уведомлений добавим следующим шагом.")
                    }
                    showChevron
                  />
                  <ConversationMenuRow
                    icon={WallpaperIcon}
                    label="Установить обои"
                    onClick={() =>
                      announceConversationAction("Выбор обоев добавим следующим шагом.")
                    }
                  />
                  <ConversationMenuRow
                    icon={CopySlashIcon}
                    label="Запретить копирование"
                    onClick={() =>
                      announceConversationAction("Ограничение копирования добавим следующим шагом.")
                    }
                  />
                  <ConversationMenuRow
                    icon={ExportIcon}
                    label="Экспорт истории чата"
                    onClick={() =>
                      announceConversationAction("Экспорт чата добавим следующим шагом.")
                    }
                    showChevron
                  />
                  <ConversationMenuRow
                    icon={BroomIcon}
                    label="Очистить историю"
                    onClick={() =>
                      announceConversationAction("Очистку истории добавим следующим шагом.")
                    }
                  />
                </div>
                <div className="mx-3 h-px bg-black/6" />
                <div className="px-1 pb-1 pt-2">
                  <ConversationMenuRow
                    icon={TrashIcon}
                    label={destructiveConversationLabel}
                    onClick={handleConversationDangerAction}
                    destructive
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </header>

      {showMessageSearch ? (
        <div className="relative z-10 border-b border-black/8 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input
                ref={messageSearchInputRef}
                data-testid="message-search-input"
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }

                  event.preventDefault();
                  moveMessageSearch(event.shiftKey ? -1 : 1);
                }}
                placeholder="Поиск по сообщениям"
                className="w-full rounded-[16px] border border-black/8 bg-[#f7f7f5] px-3 py-2 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              />
              <button
                type="button"
                onClick={toggleMessageSearch}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-stone-500 transition hover:border-black/25 hover:text-black"
                aria-label="Закрыть поиск по сообщениям"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span
                data-testid="message-search-counter"
                className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-stone-500"
              >
                {activeSearchNumber}/{messageSearchMatches.length}
              </span>
              <button
                type="button"
                onClick={() => moveMessageSearch(-1)}
                disabled={!hasSearchMatches}
                data-testid="message-search-prev"
                className="h-9 w-9 rounded-full border border-black/10 bg-white text-sm text-stone-500 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Предыдущее совпадение"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveMessageSearch(1)}
                disabled={!hasSearchMatches}
                data-testid="message-search-next"
                className="h-9 w-9 rounded-full border border-black/10 bg-white text-sm text-stone-500 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Следующее совпадение"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessageSearch("");
                  setActiveMatchIndex(0);
                  setFocusedMessageId(null);
                }}
                data-testid="message-search-clear"
                className="h-9 rounded-full border border-black/10 bg-white px-3 text-xs font-medium uppercase tracking-[0.12em] text-stone-500 transition hover:border-black/25 hover:text-black"
                aria-label="Очистить поиск по сообщениям"
              >
                Сброс
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showMessageSearch ? (
        <div
          className={clsx(
            "border-b border-black/8 bg-white px-4 py-2 text-xs sm:px-6",
            hasSearchMatches ? "text-stone-500" : "text-stone-600",
          )}
          data-testid="message-search-state"
        >
          {hasSearchMatches
            ? `Найдено ${messageSearchMatches.length}. Enter, ↑ и ↓ — переход по совпадениям.`
            : "Ничего не найдено в этом диалоге."}
        </div>
      ) : null}

      {isConversationProfileMounted ? (
        <>
          {isDesktopLayout ? (
            <button
              type="button"
              onPointerDown={handleRightPanelResizeStart}
              onDoubleClick={() => setRightPanelWidth(CHAT_RIGHT_PANEL_DEFAULT_WIDTH)}
              className="absolute bottom-0 top-0 z-30 hidden w-3 translate-x-1/2 cursor-col-resize border-0 bg-transparent lg:block"
              style={{ right: `${rightPanelWidth}px` }}
              aria-label="Изменить ширину правой панели"
              title="Изменить ширину правой панели"
            >
              <span className="mx-auto block h-full w-[3px] rounded-full bg-black/6 transition hover:bg-black/18" />
            </button>
          ) : null}
          <aside
            ref={conversationProfileRef}
            className={clsx(
              "scroll-region-y scroll-region-overlay-right absolute right-0 top-0 z-30 flex h-full w-full max-w-[90vw] flex-col overflow-y-auto border-l border-black/8 bg-[#f7f7f5] text-[#171717] transition-[transform,opacity,box-shadow] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              isConversationProfileVisible
                ? "pointer-events-auto translate-x-0 opacity-100 shadow-[-24px_0_60px_rgba(17,24,39,0.14)]"
                : "pointer-events-none translate-x-10 opacity-0 shadow-[-12px_0_26px_rgba(17,24,39,0.08)]",
            )}
            style={isDesktopLayout ? { width: `${rightPanelWidth}px` } : undefined}
            data-testid="conversation-profile-panel"
          >
            <div
              className={clsx(
                "border-b border-black/8 bg-white px-5 py-6 transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                isConversationProfileVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <UserAvatar
                  user={conversationProfileUser}
                  accessToken={accessToken}
                  className="h-20 w-20 shrink-0 rounded-full"
                  fallbackClassName="text-xl"
                />
                <button
                  type="button"
                  onClick={() => setShowConversationProfile(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent text-stone-500 transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black"
                  aria-label="Закрыть профиль"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>
              <h3 className="mt-5 text-[28px] font-semibold leading-none tracking-tight text-[#171717]">
                {conversationTitle}
              </h3>
              {conversationProfileHandle ? (
                <p className="mt-2 text-sm font-semibold tracking-[0.16em] text-stone-400">
                  {conversationProfileHandle}
                </p>
              ) : null}
              <p className="mt-2 text-base text-stone-500">{profileSummaryStatus}</p>
              <div className="mt-5 grid grid-cols-3 gap-2.5">
                <ProfileActionTile
                  icon={ChatBubbleIcon}
                  label="Чат"
                  onClick={() => setShowConversationProfile(false)}
                />
                <ProfileActionTile
                  icon={BellIcon}
                  label="Звук"
                  onClick={() =>
                    announceConversationAction("Настройки звука добавим следующим шагом.", {
                      closeMenu: false,
                    })
                  }
                />
                <ProfileActionTile
                  icon={GiftIcon}
                  label="Подарок"
                  onClick={() =>
                    announceConversationAction("Подарки добавим следующим шагом.", {
                      closeMenu: false,
                    })
                  }
                />
              </div>
              <div className="mt-5 rounded-[24px] border border-black/8 bg-[#fafaf9] p-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Обзор</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-[18px] border border-black/8 bg-white px-4 py-3">
                    <p className="text-lg font-semibold text-[#171717]">{messageItems.length}</p>
                    <p className="mt-1 text-sm text-stone-500">Сообщений в чате</p>
                  </div>
                  <div className="rounded-[18px] border border-black/8 bg-white px-4 py-3">
                    <p className="text-lg font-semibold text-[#171717]">
                      {mediaStats.reduce((total, item) => total + item.value, 0)}
                    </p>
                    <p className="mt-1 text-sm text-stone-500">Материалов и ссылок</p>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={clsx(
                "space-y-6 px-5 py-6 transition-[transform,opacity] duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                isConversationProfileVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
            >
              <div className="rounded-[24px] border border-black/8 bg-white p-5 shadow-[0_18px_30px_rgba(17,24,39,0.04)]">
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Информация</p>
                <div className="mt-4 space-y-4">
                  {profileDetailRows.map((row) => (
                    <div key={row.label}>
                      <p className="text-sm text-[#171717]">{row.value}</p>
                      <p className="mt-1 text-sm text-stone-500">{row.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/8 bg-white p-5 shadow-[0_18px_30px_rgba(17,24,39,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                    Материалы
                  </p>
                  <span className="rounded-full border border-black/8 bg-[#fafaf9] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-500">
                    {mediaStats.reduce((total, item) => total + item.value, 0)}
                  </span>
                </div>
                <div className="mt-4 space-y-2">
                  {mediaStats.map((item) => (
                    <ProfileStatRow
                      key={item.key}
                      icon={item.icon}
                      label={item.label}
                      value={item.value}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/8 bg-white p-5 shadow-[0_18px_30px_rgba(17,24,39,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                    Управление
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowConversationProfile(false);
                      setShowConversationMenu(true);
                    }}
                    className="text-xs text-stone-500 transition hover:text-black"
                  >
                    Открыть меню
                  </button>
                </div>
                <div className="mt-4 space-y-1">
                  <ConversationMenuRow
                    icon={BellOffIcon}
                    label="Выключить уведомления"
                    onClick={() =>
                      announceConversationAction(
                        "Настройки уведомлений добавим следующим шагом.",
                        { closeMenu: false },
                      )
                    }
                    compact
                  />
                  <ConversationMenuRow
                    icon={WallpaperIcon}
                    label="Установить обои"
                    onClick={() =>
                      announceConversationAction("Выбор обоев добавим следующим шагом.", {
                        closeMenu: false,
                      })
                    }
                    compact
                  />
                  <ConversationMenuRow
                    icon={CopySlashIcon}
                    label="Запретить копирование"
                    onClick={() =>
                      announceConversationAction(
                        "Ограничение копирования добавим следующим шагом.",
                        { closeMenu: false },
                      )
                    }
                    compact
                  />
                  <ConversationMenuRow
                    icon={ExportIcon}
                    label="Экспорт истории чата"
                    onClick={() =>
                      announceConversationAction("Экспорт чата добавим следующим шагом.", {
                        closeMenu: false,
                      })
                    }
                    compact
                    showChevron
                  />
                  <ConversationMenuRow
                    icon={BroomIcon}
                    label="Очистить историю"
                    onClick={() =>
                      announceConversationAction("Очистку истории добавим следующим шагом.", {
                        closeMenu: false,
                      })
                    }
                    compact
                  />
                  {isGroupChat ? (
                    <ConversationMenuRow
                      icon={UsersIcon}
                      label="Участники группы"
                      onClick={openGroupMembersPanel}
                      compact
                      showChevron
                    />
                  ) : null}
                  <ConversationMenuRow
                    icon={TrashIcon}
                    label={destructiveConversationLabel}
                    onClick={handleConversationDangerAction}
                    destructive
                    compact
                  />
                </div>
              </div>

              {isGroupChat ? (
                <div className="rounded-[24px] border border-black/8 bg-white p-5 shadow-[0_18px_30px_rgba(17,24,39,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                      Участники
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowConversationProfile(false);
                        setShowGroupMembersPanel(true);
                      }}
                      className="text-xs text-stone-500 transition hover:text-black"
                    >
                      Открыть список
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {visibleGroupMembers.length > 0 ? (
                      visibleGroupMembers.slice(0, 5).map((member) => (
                        <div key={member.user.id} className="flex items-center gap-3">
                          <UserAvatar
                            user={member.user}
                            accessToken={accessToken}
                            className="h-11 w-11 shrink-0 rounded-full"
                            fallbackClassName="text-sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#171717]">
                              {member.user.displayName}
                            </p>
                            <p className="truncate text-sm text-stone-500">
                              {member.user.username
                                ? `${formatGroupRole(member.role)} · #${member.user.username}`
                                : formatGroupRole(member.role)}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-stone-500">
                        Откройте список участников, чтобы загрузить состав группы.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-[24px] border border-black/8 bg-white p-5 shadow-[0_18px_30px_rgba(17,24,39,0.04)]">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                    Контакт
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <UserAvatar
                      user={conversationProfileUser}
                      accessToken={accessToken}
                      className="h-14 w-14 shrink-0 rounded-full"
                      fallbackClassName="text-base"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-[#171717]">
                        {conversationProfileUser.displayName}
                      </p>
                      {conversationProfileHandle ? (
                        <p className="truncate text-xs font-semibold tracking-[0.16em] text-stone-400">
                          {conversationProfileHandle}
                        </p>
                      ) : null}
                      <p className="truncate text-sm text-stone-500">
                        {conversationProfileUser.email}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      ) : null}

      {isGroupChat && showGroupMembersPanel ? (
        <div
          className="border-b border-black/8 bg-white/90 px-4 py-3 sm:px-6"
          data-testid="group-members-panel"
        >
          {groupPanelError ? (
            <p className="mb-2 rounded-[12px] border border-black/10 bg-black px-3 py-2 text-xs text-white">
              {groupPanelError}
            </p>
          ) : null}

          {groupMembersQuery.isLoading ? (
            <p className="text-sm text-stone-500">Загружаем участников...</p>
          ) : groupMembersQuery.isError || !groupMembersQuery.data ? (
            <p className="text-sm text-stone-600">Не удалось загрузить список участников.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">Участники</p>
                <span className="rounded-full border border-black/10 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-500">
                  {groupMembersQuery.data.members.length}
                </span>
              </div>

              {groupMembersQuery.data.permissions.canAddMembers ? (
                <div className="space-y-2">
                  <input
                    value={groupMemberSearch}
                    onChange={(event) => setGroupMemberSearch(event.target.value)}
                    placeholder="Добавить участника в группу"
                    className="w-full rounded-[14px] border border-black/8 bg-[#f7f7f5] px-3 py-2 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
                  />
                  {normalizedGroupMemberSearch.length > 1 ? (
                    <div className="scroll-region-y max-h-28 overflow-y-auto rounded-[14px] border border-black/8 bg-[#fafaf9] p-1.5">
                      {groupUsersSearchQuery.isLoading ? (
                        <p className="px-2 py-2 text-xs text-stone-500">Ищем пользователей...</p>
                      ) : availableGroupUsers.length > 0 ? (
                        <div className="space-y-1">
                          {availableGroupUsers.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => addGroupMemberMutation.mutate(candidate.id)}
                              disabled={isGroupActionPending}
                              className="flex w-full items-center justify-between rounded-[10px] border border-transparent px-2 py-2 text-left transition hover:border-black/10 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              <span className="truncate text-xs font-medium text-[#171717]">
                                {candidate.displayName}
                              </span>
                              <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                                Add
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="px-2 py-2 text-xs text-stone-500">Нет пользователей для добавления.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-stone-500">
                  У вас нет прав на добавление участников в эту группу.
                </p>
              )}

              {groupMembersQuery.data.members.length > 0 ? (
                <div className="space-y-2">
                  {groupMembersQuery.data.members.map((member) => {
                    const canToggleRole =
                      groupMembersQuery.data.permissions.canManageRoles &&
                      !member.isCurrentUser &&
                      member.role !== "creator";

                    return (
                      <div
                        key={member.user.id}
                        className="flex items-center justify-between gap-3 rounded-[14px] border border-black/8 bg-white px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#171717]">
                            {member.user.displayName}
                            {member.isCurrentUser ? " (Вы)" : ""}
                          </p>
                          <p className="truncate text-xs text-stone-500">{member.user.email}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="rounded-full border border-black/12 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                            {formatGroupRole(member.role)}
                          </span>
                          {canToggleRole ? (
                            <button
                              type="button"
                              onClick={() => handleToggleGroupMemberRole(member.user.id, member.role)}
                              disabled={isGroupActionPending}
                              className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              {member.role === "admin" ? "Снять admin" : "Сделать admin"}
                            </button>
                          ) : null}
                          {canRemoveGroupMember(member) ? (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmingMemberRemoval({
                                  userId: member.user.id,
                                  displayName: member.user.displayName,
                                })
                              }
                              disabled={isGroupActionPending}
                              className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-[14px] border border-dashed border-black/12 bg-white px-3 py-2 text-xs text-stone-500">
                  В группе пока нет участников.
                </p>
              )}

              <div className="flex justify-end">
                {groupMembersQuery.data.permissions.canLeaveGroup ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingGroupLeave(true)}
                    disabled={isGroupActionPending}
                    className="rounded-full border border-black/12 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    Выйти из группы
                  </button>
                ) : (
                  <p className="text-xs text-stone-500">
                    Создатель может удалить группу, но не может выйти из неё.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div
        ref={messageListRef}
        onScroll={updateStickToBottomState}
        className="scroll-region-y relative z-10 flex-1 min-h-0 overflow-y-auto px-3 py-5 transition-[padding] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-4"
        style={conversationProfileOffsetStyle}
        data-testid="message-list"
      >
        <div className="w-full space-y-3">
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
          const isSearchMatch =
            normalizedMessageSearchLower.length > 0 &&
            normalizedBody.toLocaleLowerCase().includes(normalizedMessageSearchLower);
          const isActiveSearchMatch = activeSearchMessage?.id === message.id;
          const isFocusedFromGlobalSearch = focusedMessageId === message.id;
          const isEditedMessage = !message.isDeleted && message.updatedAt !== message.createdAt;
          const messageMetaLabel = `${isEditedMessage ? "изм. " : ""}${formatTime(message.createdAt)}`;
          const replyToMessage = message.replyTo;
          const replyPreviewText = getReplyPreviewText(replyToMessage);
          const highlightClassName = isMine
            ? "rounded bg-white px-0.5 text-[#111111]"
            : "rounded bg-[#111111] px-0.5 text-white";
          const hasAttachments = message.attachments.length > 0;
          const attachmentOnlyBubble = hasAttachments && !hasText;
          const inlineMetaBubble = hasText && !hasAttachments;
          const compactBubble = inlineMetaBubble;
          const shortTextOnlyBubble =
            inlineMetaBubble && normalizedBody.length <= 8 && !normalizedBody.includes("\n");
          const currentUserId = user?.id ?? null;
          const bubbleOnRight = usesSplitConversationLayout && isMine;
          return (
            <div
              key={item.key}
              data-testid="message-item"
              data-message-id={message.id}
              data-message-owner={isMine ? "self" : "other"}
              data-message-search-match={isSearchMatch ? "true" : "false"}
              data-message-search-active={isActiveSearchMatch ? "true" : "false"}
              onContextMenu={(event) => {
                if (message.isDeleted) {
                  return;
                }

                event.preventDefault();
                openMessageContextMenu(message, event.clientX, event.clientY);
              }}
              className={clsx("group flex w-full", bubbleOnRight ? "justify-end" : "justify-start")}
            >
              <div
                className={clsx(
                  "relative",
                  bubbleOnRight
                    ? "ml-auto max-w-[94%] sm:max-w-[88%] xl:max-w-[80%] 2xl:max-w-[78%]"
                    : "max-w-[94%] sm:max-w-[88%] xl:max-w-[80%] 2xl:max-w-[78%]",
                )}
              >
                <div
                  className={clsx(
                    "flex max-w-full flex-col gap-1.5",
                    bubbleOnRight ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={clsx(
                      "w-fit max-w-full shadow-sm transition-[box-shadow]",
                      shortTextOnlyBubble
                        ? bubbleOnRight
                          ? "rounded-[18px] rounded-br-[7px] px-3 py-1"
                          : "rounded-[18px] rounded-bl-[7px] px-3 py-1"
                        : compactBubble
                          ? bubbleOnRight
                            ? "rounded-[22px] rounded-br-[8px] px-3 py-1.5"
                            : "rounded-[22px] rounded-bl-[8px] px-3 py-1.5"
                          : attachmentOnlyBubble
                            ? bubbleOnRight
                              ? "rounded-[24px] rounded-br-[10px] px-3 py-[2px]"
                              : "rounded-[24px] rounded-bl-[10px] px-3 py-[2px]"
                            : bubbleOnRight
                              ? "rounded-[24px] rounded-br-[9px] px-4 py-2.5"
                              : "rounded-[24px] rounded-bl-[9px] px-4 py-2.5",
                      isMine
                        ? "bg-[#111111] text-white"
                        : "border border-black/8 bg-white text-[#171717]",
                      isActiveSearchMatch
                        ? isMine
                          ? "ring-2 ring-white/75 ring-offset-2 ring-offset-[#111111]"
                          : "ring-2 ring-black/35 ring-offset-2 ring-offset-white"
                        : null,
                      !isActiveSearchMatch && isFocusedFromGlobalSearch
                        ? isMine
                          ? "ring-2 ring-white/45 ring-offset-2 ring-offset-[#111111]"
                          : "ring-2 ring-black/20 ring-offset-2 ring-offset-white"
                        : null,
                    )}
                  >
                    {replyToMessage ? (
                      <button
                        type="button"
                        onClick={() => focusMessageById(replyToMessage.id, "smooth")}
                        className={clsx(
                          "mb-1.5 block w-full rounded-[12px] border px-2.5 py-1.5 text-left transition hover:opacity-90",
                          isMine
                            ? "border-white/20 bg-white/10 text-white"
                            : "border-black/10 bg-black/[0.03] text-stone-700",
                        )}
                        data-testid="message-reply-preview"
                      >
                        <p
                          className={clsx(
                            "truncate text-[10px] uppercase tracking-[0.12em]",
                            isMine ? "text-white/70" : "text-stone-500",
                          )}
                        >
                          {replyToMessage.sender.displayName}
                        </p>
                        <p className="mt-0.5 truncate text-xs">{replyPreviewText}</p>
                      </button>
                    ) : null}
                    {inlineMetaBubble && message.body ? (
                      <div
                        className={clsx(
                          "grid grid-cols-[minmax(0,1fr)_auto] items-end",
                          shortTextOnlyBubble ? "gap-x-1" : "gap-x-1.5",
                        )}
                      >
                        <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-5">
                          {renderHighlightedMessageBody(
                            message.body,
                            normalizedMessageSearch,
                            highlightClassName,
                          )}
                        </p>
                        <p
                          className={clsx(
                            "shrink-0 self-end pb-0 text-[11px] leading-none",
                            isMine ? "text-white/62" : "text-stone-400",
                          )}
                        >
                          {messageMetaLabel}
                        </p>
                      </div>
                    ) : null}
                    {message.body && !inlineMetaBubble ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-5">
                        {renderHighlightedMessageBody(
                          message.body,
                          normalizedMessageSearch,
                          highlightClassName,
                        )}
                      </p>
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
                          hasText
                            ? "mt-1 text-right text-[11px] leading-none"
                            : attachmentOnlyBubble
                              ? "mt-0 text-right text-[11px] leading-none"
                              : "mt-1.5 text-right text-[11px] leading-none",
                          isMine ? "text-white/62" : "text-stone-400",
                        )}
                      >
                        {messageMetaLabel}
                      </p>
                    ) : null}
                    {message.reactions.length > 0 ? (
                      <div
                        className={clsx(
                          "mt-2 flex max-w-full flex-wrap gap-1",
                          bubbleOnRight ? "justify-end" : "justify-start",
                        )}
                      >
                        {message.reactions.map((reaction) => {
                          const reactedByCurrentUser =
                            currentUserId ? reaction.userIds.includes(currentUserId) : false;

                          return (
                            <button
                              key={`${message.id}-${reaction.emoji}`}
                              type="button"
                              onClick={() =>
                                handleToggleMessageReaction(
                                  message,
                                  reaction.emoji as (typeof QUICK_REACTIONS)[number],
                                )
                              }
                              className={clsx(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-[3px] text-[11px] font-medium transition",
                                reactedByCurrentUser
                                  ? isMine
                                    ? "bg-[#58aeea] text-white"
                                    : "border border-[#c6def2] bg-[#eef7ff] text-[#1d5f93]"
                                  : isMine
                                    ? "bg-white/14 text-white hover:bg-white/18"
                                    : "border border-black/8 bg-black/[0.04] text-stone-600 hover:border-black/18 hover:text-black",
                              )}
                              data-testid="message-reaction-chip"
                            >
                              <span className="text-[14px] leading-none">{reaction.emoji}</span>
                              <span
                                className={clsx(
                                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none",
                                  reactedByCurrentUser
                                    ? isMine
                                      ? "bg-white/22 text-white"
                                      : "bg-[#48a7ea]/16 text-[#1d5f93]"
                                    : isMine
                                      ? "bg-white/14 text-white/92"
                                      : "bg-black/[0.06] text-stone-500",
                                )}
                              >
                                {reaction.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                </div>
              </div>
            </div>
          );
        })}
        {typingIndicatorLabel ? (
          <div
            className="flex justify-start"
            data-testid="typing-indicator"
          >
            <div className="rounded-[16px] border border-black/8 bg-white px-3 py-1.5 text-xs text-stone-500 shadow-sm">
              {typingIndicatorLabel}
            </div>
          </div>
        ) : null}
        <div ref={messageListEndRef} aria-hidden="true" />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex-none border-t border-black/8 p-4 transition-[padding] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-5"
        style={conversationProfileOffsetStyle}
      >
        <div className="w-full">
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

        {editingMessage || replyingToMessage ? (
          <div
            className="mb-3 flex items-start justify-between gap-3 rounded-[18px] border border-black/8 bg-white px-4 py-3"
            data-testid={editingMessage ? "composer-edit-context" : "composer-reply-context"}
          >
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">
                {editingMessage
                  ? "Редактирование сообщения"
                  : `Ответ: ${replyingToMessage?.sender.displayName ?? "Сообщение"}`}
              </p>
              <button
                type="button"
                onClick={() =>
                  focusMessageById(editingMessage?.id ?? replyingToMessage?.id ?? "", "smooth")
                }
                className="mt-1 block max-w-full truncate text-left text-sm text-[#171717] hover:underline"
              >
                {editingMessage
                  ? getReplyPreviewText(editingMessage)
                  : getReplyPreviewText(replyingToMessage)}
              </button>
            </div>
            <button
              type="button"
              onClick={cancelComposerContext}
              className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-600 transition hover:border-black/25 hover:text-black"
            >
              Отмена
            </button>
          </div>
        ) : null}

        {pendingFile ? (
          <div
            className="mb-3 flex items-center justify-between gap-3 rounded-[20px] border border-black/8 bg-white px-4 py-3 shadow-[0_12px_24px_rgba(17,24,39,0.04)]"
            data-testid="attachment-preview"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#171717]">{pendingFile.name}</p>
              <p className="text-xs text-stone-500">
                {pendingAttachmentTypeLabel ?? "Файл"} · {formatFileSize(pendingFile.size)} · до {ATTACHMENT_MAX_MB} MB
              </p>
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

        {recordingState !== "idle" ? (
          <div
            className="mb-3 flex flex-col gap-3 rounded-[22px] border border-black/8 bg-white px-4 py-3 shadow-[0_14px_26px_rgba(17,24,39,0.05)] sm:flex-row sm:items-center sm:justify-between"
            data-testid="voice-recorder-panel"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white">
                <span className="absolute h-full w-full animate-ping rounded-full bg-black/20" />
                <MicIcon className="relative h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#171717]">
                  {recordingState === "stopping" ? "Готовим голосовое..." : "Идёт запись"}
                </p>
                <p className="text-xs text-stone-500">
                  {formatRecordingDuration(recordingSeconds)} · как в Telegram, можно отменить или отправить
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => finishVoiceRecording(false)}
                disabled={recordingState === "stopping"}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => finishVoiceRecording(true)}
                disabled={recordingState === "stopping"}
                className="rounded-full bg-[#111111] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                Отправить
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[27px] border border-black/8 bg-white pl-2 pr-3 py-1.5 shadow-[0_14px_24px_rgba(17,24,39,0.045)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={recordingState !== "idle" || isEditingMessage || isComposerSubmitPending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/10 bg-[#f7f7f5] text-stone-500 transition hover:border-black/25 hover:bg-white hover:text-black"
              data-testid="attachment-picker-button"
              aria-label="Прикрепить файл"
              title="Прикрепить файл"
            >
              <PaperclipIcon className="h-5 w-5" />
            </button>

            <div className="relative flex min-w-0 flex-1 items-center">
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
                onBlur={() => setLocalTypingState(false)}
                onKeyDown={handleComposerKeyDown}
                rows={1}
                maxLength={MESSAGE_MAX_LENGTH}
                disabled={recordingState !== "idle" || isComposerSubmitPending}
                placeholder={isEditingMessage ? "Измените сообщение..." : "Сообщение..."}
                className="h-[42px] min-h-[42px] max-h-[200px] w-full resize-none overflow-y-hidden border border-transparent bg-transparent px-1 pb-0 pt-[6px] leading-[28px] text-[#171717] outline-none transition placeholder:text-stone-400 disabled:cursor-not-allowed disabled:opacity-45"
              />

              <div className="pointer-events-none absolute bottom-0 right-1 flex justify-end">
                <p data-testid="message-counter" className="shrink-0 text-[10px] leading-none text-stone-400">
                  {draft.length}/{MESSAGE_MAX_LENGTH}
                </p>
              </div>
            </div>
          </div>

          <div
            className={clsx(
              "self-center relative h-11 overflow-visible transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              showComposerAction ? "w-11 opacity-100" : "pointer-events-none w-0 opacity-0",
            )}
          >
            <button
              data-testid={
                composerActionMode === "voice" ? "voice-message-button" : "send-message-button"
              }
              type={composerActionMode === "send" ? "submit" : "button"}
              onClick={composerActionMode === "voice" ? startVoiceRecording : undefined}
              disabled={
                composerActionMode === "send"
                  ? isComposerSubmitPending || !hasComposerContent
                  : recordingState !== "idle"
              }
              tabIndex={showComposerAction ? 0 : -1}
              aria-label={
                composerActionMode === "send"
                  ? submitButtonLabel
                  : "Записать голосовое сообщение"
              }
              title={
                composerActionMode === "send"
                  ? submitButtonLabel
                  : "Записать голосовое сообщение"
              }
              className={clsx(
                "absolute inset-0 flex h-11 w-11 items-center justify-center rounded-full transition-[background-color,color,border-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                composerActionMode === "send"
                  ? "border border-black/0 bg-[#111111] text-white hover:translate-y-[-1px] hover:bg-black"
                  : "border border-black/10 bg-white text-[#111111] hover:border-black/25 hover:bg-[#111111] hover:text-white",
                showComposerAction ? "scale-100 opacity-100" : "scale-75 opacity-0",
                "disabled:cursor-not-allowed disabled:opacity-55",
              )}
            >
              <span className="relative h-5 w-5">
                <span
                  className={clsx(
                    "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    composerActionMode === "voice"
                      ? "opacity-100 scale-100 rotate-0"
                      : "pointer-events-none opacity-0 scale-[0.52] rotate-[16deg]",
                  )}
                >
                  <MicIcon className="h-5 w-5" />
                </span>
                <span
                  className={clsx(
                    "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    composerActionMode === "send"
                      ? "opacity-100 scale-100 rotate-0 delay-[70ms]"
                      : "pointer-events-none opacity-0 scale-[0.52] rotate-[-16deg]",
                  )}
                >
                  {isComposerSubmitPending ? (
                    <span className="text-sm font-semibold leading-none">...</span>
                  ) : (
                    <SendIcon className="h-5 w-5" />
                  )}
                </span>
              </span>
            </button>
          </div>
        </div>
        </div>
      </form>

      {contextMenuMessage && messageContextMenuPosition
        ? createPortal(
            <div className="fixed inset-0 z-[220]" data-testid="message-context-menu-layer">
              <button
                type="button"
                aria-label="Закрыть контекстное меню"
                className="absolute inset-0 cursor-default bg-transparent"
                onClick={closeMessageContextMenu}
              />
              <div
                className="absolute w-[276px] overflow-hidden rounded-[22px] border border-black/10 bg-white text-[#171717] shadow-[0_24px_48px_rgba(17,24,39,0.18)]"
                style={{
                  left: messageContextMenuPosition.left,
                  top: messageContextMenuPosition.top,
                }}
                role="menu"
                aria-label="Действия с сообщением"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <div className="flex items-center gap-1.5 border-b border-black/8 bg-white px-3 py-2.5">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleToggleMessageReaction(contextMenuMessage, emoji)}
                      className={clsx(
                        "flex h-9 min-w-9 items-center justify-center rounded-full border px-2 text-lg transition",
                        contextMenuCurrentUserReaction === emoji
                          ? "border-black bg-[#111111] text-white"
                          : "border-black/10 bg-white text-[#171717] hover:border-black/20 hover:bg-black/[0.04]",
                      )}
                      aria-label={`Поставить реакцию ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                <div className="space-y-0.5 px-2 py-2">
                  <MessageContextMenuRow
                    icon={ReplyArrowIcon}
                    label="Ответить"
                    onClick={() => handleReplyMessage(contextMenuMessage)}
                  />
                  <MessageContextMenuRow
                    icon={PinIcon}
                    label="Закрепить"
                    onClick={() => handlePinMessageStub(contextMenuMessage)}
                  />
                  <MessageContextMenuRow
                    icon={CopyIcon}
                    label="Копировать текст"
                    onClick={() => {
                      void handleCopyMessageText(contextMenuMessage);
                    }}
                    disabled={!contextMenuMessage.body?.trim()}
                  />
                  <MessageContextMenuRow
                    icon={ExportIcon}
                    label="Переслать"
                    onClick={() => handleStartForwardMessage(contextMenuMessage)}
                  />
                  {contextMenuMessage.senderId === user?.id ? (
                    <MessageContextMenuRow
                      icon={EditPencilIcon}
                      label="Изменить"
                      onClick={() => handleStartEditingMessage(contextMenuMessage)}
                    />
                  ) : null}
                  <MessageContextMenuRow
                    icon={TrashIcon}
                    label="Удалить"
                    onClick={() => handleDeleteMessage(contextMenuMessage)}
                    destructive
                  />
                  <MessageContextMenuRow
                    icon={SelectCheckIcon}
                    label="Выделить"
                    onClick={() => handleSelectMessageStub(contextMenuMessage)}
                  />
                </div>

                <div className="flex items-center gap-2 border-t border-black/8 bg-[#fafaf9] px-3 py-2 text-xs text-stone-500">
                  <ClockIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{contextMenuTimestampLabel}</span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {forwardingMessage ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[3px]"
          onClick={() => {
            if (!forwardMessageMutation.isPending) {
              setForwardingMessage(null);
              setForwardPanelError(null);
            }
          }}
          data-testid="forward-message-modal"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forward-message-title"
            className="w-full max-w-[470px] rounded-[22px] border border-black/10 bg-white p-4 shadow-[0_22px_52px_rgba(17,24,39,0.22)] sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="forward-message-title" className="text-lg font-semibold tracking-tight text-[#171717]">
              Переслать сообщение
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              {getReplyPreviewText(forwardingMessage)}
            </p>

            <input
              value={forwardSearch}
              onChange={(event) => setForwardSearch(event.target.value)}
              placeholder="Поиск чата для пересылки"
              className="mt-3 w-full rounded-[14px] border border-black/10 bg-[#f7f7f5] px-3 py-2 text-sm text-[#171717] outline-none transition placeholder:text-stone-400 focus:border-black/70 focus:bg-white focus:ring-4 focus:ring-black/5"
              data-testid="forward-search-input"
            />

            {forwardPanelError ? (
              <p className="mt-3 rounded-[12px] border border-black/10 bg-black px-3 py-2 text-xs text-white">
                {forwardPanelError}
              </p>
            ) : null}

            <div className="scroll-region-y mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-[14px] border border-black/8 bg-[#fafaf9] p-1.5">
              {chatsQuery.isLoading ? (
                <p className="px-2 py-2 text-sm text-stone-500">Загружаем чаты...</p>
              ) : forwardCandidates.length > 0 ? (
                forwardCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => handleForwardToChat(candidate.id)}
                    disabled={forwardMessageMutation.isPending}
                    className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-transparent px-3 py-2.5 text-left transition hover:border-black/10 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
                    data-testid="forward-target-chat"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#171717]">{candidate.title}</p>
                      <p className="truncate text-xs text-stone-500">{candidate.lastMessagePreview}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-black/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                      {candidate.isCurrentChat ? "Текущий" : candidate.type === "group" ? "Группа" : "Личный"}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-2 text-sm text-stone-500">Подходящих чатов не найдено.</p>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!forwardMessageMutation.isPending) {
                    setForwardingMessage(null);
                    setForwardPanelError(null);
                  }
                }}
                disabled={forwardMessageMutation.isPending}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <DeleteMessageDialog
        open={Boolean(confirmingMessage)}
        title="Удалить это сообщение?"
        description="Выберите, нужно ли удалить сообщение только у вас или у всех участников этого чата."
        isLoading={deleteMessageMutation.isPending}
        allowDeleteForEveryone={confirmingMessage?.senderId === user?.id}
        onCancel={() => {
          if (!deleteMessageMutation.isPending) {
            setConfirmingMessage(null);
          }
        }}
        onDeleteForSelf={() => handleDeleteMessageMode("self")}
        onDeleteForEveryone={() => handleDeleteMessageMode("everyone")}
      />

      <ConfirmDialog
        open={Boolean(confirmingMemberRemoval)}
        title="Удалить участника из группы?"
        description={
          confirmingMemberRemoval
            ? `${confirmingMemberRemoval.displayName} будет удален(а) из группы.`
            : "Участник будет удален из группы."
        }
        isLoading={removeGroupMemberMutation.isPending}
        onCancel={() => {
          if (!removeGroupMemberMutation.isPending) {
            setConfirmingMemberRemoval(null);
          }
        }}
        onConfirm={() => {
          if (confirmingMemberRemoval) {
            removeGroupMemberMutation.mutate(confirmingMemberRemoval.userId);
          }
        }}
      />

      <ConfirmDialog
        open={confirmingGroupLeave}
        title="Выйти из группы?"
        description="Вы потеряете доступ к сообщениям этой группы."
        confirmLabel="Выйти"
        isLoading={leaveGroupMutation.isPending}
        onCancel={() => {
          if (!leaveGroupMutation.isPending) {
            setConfirmingGroupLeave(false);
          }
        }}
        onConfirm={() => {
          leaveGroupMutation.mutate();
        }}
      />

      <ConfirmDialog
        open={confirmingChatDeletion}
        title={isGroupChat ? "Удалить группу?" : "Удалить этот чат?"}
        description={
          isGroupChat
            ? `Группа «${conversationTitle}» будет удалена для всех участников.`
            : `Диалог «${conversationTitle}» будет удален целиком.`
        }
        confirmLabel="Удалить"
        isLoading={deleteChatMutation.isPending}
        onCancel={() => {
          if (!deleteChatMutation.isPending) {
            setConfirmingChatDeletion(false);
          }
        }}
        onConfirm={() => {
          deleteChatMutation.mutate();
        }}
      />
    </section>
  );
}

function ConversationMenuRow({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  showChevron = false,
  compact = false,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  showChevron?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-3 rounded-[18px] text-left transition hover:bg-black/[0.035]",
        compact ? "px-3 py-2.5" : "px-3 py-3",
      )}
    >
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border",
          destructive
            ? "border-red-500/15 bg-red-50 text-red-500"
            : "border-black/8 bg-[#f7f7f5] text-stone-600",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span
        className={clsx(
          "min-w-0 flex-1 truncate text-[15px] leading-none",
          destructive ? "text-red-500" : "text-[#171717]",
        )}
      >
        {label}
      </span>
      {showChevron ? (
        <ChevronRightIcon
          className={clsx("h-4 w-4 shrink-0", destructive ? "text-red-300" : "text-stone-400")}
        />
      ) : null}
    </button>
  );
}

function MessageContextMenuRow({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[15px] transition disabled:cursor-not-allowed disabled:opacity-45",
        destructive
          ? "text-[#d43c33] hover:bg-[#fff1ef]"
          : "text-[#171717] hover:bg-black/[0.04]",
      )}
    >
      <Icon
        className={clsx(
          "h-[18px] w-[18px] shrink-0",
          destructive ? "text-[#d43c33]" : "text-stone-500",
        )}
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function ProfileActionTile({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[86px] flex-col items-center justify-center gap-2 rounded-[20px] border border-black/8 bg-[#fafaf9] px-3 py-4 text-center text-stone-600 transition hover:border-black/16 hover:bg-white hover:text-black"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-black/8 bg-white text-[#171717]">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-xs font-medium tracking-[0.04em]">{label}</span>
    </button>
  );
}

function ProfileStatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: IconComponent;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-black/8 bg-[#fafaf9] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-black/8 bg-white text-stone-600">
          <Icon className="h-5 w-5" />
        </span>
        <p className="truncate text-sm text-[#171717]">{label}</p>
      </div>
      <span className="shrink-0 text-sm font-semibold text-[#171717]">{value}</span>
    </div>
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
    <div className={clsx("space-y-2", attachments.length > 0 && "mt-1")}>
      {attachments.map((attachment) => {
        const downloadUrl = buildAttachmentUrl(attachment.downloadPath, accessToken);
        const kind = getAttachmentKind(attachment);

        if (kind === "image") {
          return (
            <a
              key={attachment.id}
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="group/image relative block overflow-hidden rounded-[18px] border border-black/10 bg-black/5"
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
                  "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-3 py-2 text-xs opacity-0 transition duration-200 group-hover/image:opacity-100 group-focus-visible/image:opacity-100",
                  isMine
                    ? "bg-gradient-to-t from-black/70 to-black/20 text-white"
                    : "bg-gradient-to-t from-black/62 to-black/18 text-white",
                )}
              >
                <span className="truncate">{attachment.originalName}</span>
                <span className="shrink-0">{formatFileSize(attachment.sizeBytes)}</span>
              </div>
            </a>
          );
        }

        if (kind === "audio") {
          return (
            <VoiceMessageAttachment
              key={attachment.id}
              attachment={attachment}
              downloadUrl={downloadUrl}
              isMine={isMine}
            />
          );
        }

        if (kind === "video") {
          return (
            <VideoMessageAttachment
              key={attachment.id}
              attachment={attachment}
              downloadUrl={downloadUrl}
              isMine={isMine}
            />
          );
        }

        if (kind === "pdf") {
          return (
            <PdfMessageAttachment
              key={attachment.id}
              attachment={attachment}
              downloadUrl={downloadUrl}
              isMine={isMine}
            />
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
                {getAttachmentTypeLabel(attachment)} · {formatFileSize(attachment.sizeBytes)}
              </p>
            </div>
            <span className="shrink-0 text-xs uppercase tracking-[0.16em]">Open</span>
          </a>
        );
      })}
    </div>
  );
}

function VideoMessageAttachment({
  attachment,
  downloadUrl,
  isMine,
}: {
  attachment: ChatAttachment;
  downloadUrl: string;
  isMine: boolean;
}) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[18px] border",
        isMine ? "border-white/12 bg-black/30 text-white" : "border-black/10 bg-white text-[#171717]",
      )}
      data-testid="message-attachment"
    >
      <video
        controls
        preload="metadata"
        src={downloadUrl}
        className="max-h-80 w-full bg-black object-contain"
      >
        <a href={downloadUrl} target="_blank" rel="noreferrer">
          Открыть видео
        </a>
      </video>
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="min-w-0 truncate">{attachment.originalName}</span>
        <span className={clsx("shrink-0", isMine ? "text-white/80" : "text-stone-500")}>
          {formatFileSize(attachment.sizeBytes)}
        </span>
      </div>
    </div>
  );
}

function PdfMessageAttachment({
  attachment,
  downloadUrl,
  isMine,
}: {
  attachment: ChatAttachment;
  downloadUrl: string;
  isMine: boolean;
}) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[18px] border",
        isMine ? "border-white/12 bg-black/30 text-white" : "border-black/10 bg-white text-[#171717]",
      )}
      data-testid="message-attachment"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{attachment.originalName}</p>
          <p className={clsx("mt-0.5", isMine ? "text-white/75" : "text-stone-500")}>
            PDF · {formatFileSize(attachment.sizeBytes)}
          </p>
        </div>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className={clsx(
            "shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition",
            isMine
              ? "border-white/25 text-white hover:border-white/45"
              : "border-black/15 text-stone-600 hover:border-black/35 hover:text-black",
          )}
        >
          Open
        </a>
      </div>
      <iframe
        src={`${downloadUrl}#toolbar=0&navpanes=0`}
        title={attachment.originalName}
        className="h-56 w-full bg-white"
      />
    </div>
  );
}

function VoiceMessageAttachment({
  attachment,
  downloadUrl,
  isMine,
}: {
  attachment: ChatAttachment;
  downloadUrl: string;
  isMine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const progress = durationSeconds > 0 ? Math.min(currentSeconds / durationSeconds, 1) : 0;
  const waveform = useMemo(() => buildWaveformVariant(attachment.id, 34), [attachment.id]);
  const pseudoTranscript = useMemo(
    () => buildPseudoTranscript(attachment.id, durationSeconds || currentSeconds, attachment.sizeBytes),
    [attachment.id, attachment.sizeBytes, currentSeconds, durationSeconds],
  );

  const togglePlayback = async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      await audio.play().catch(() => undefined);
      return;
    }

    audio.pause();
  };

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;
    const updateProgress = () => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      setCurrentSeconds(audio.currentTime);
      frameId = window.requestAnimationFrame(updateProgress);
    };

    frameId = window.requestAnimationFrame(updateProgress);

    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying]);

  return (
    <div
      className={clsx(
        "w-[min(290px,52vw)] max-w-full",
        isMine ? "text-white" : "text-[#171717]",
      )}
      data-testid="message-voice"
    >
      <audio
        ref={audioRef}
        preload="metadata"
        src={downloadUrl}
        className="hidden"
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          setDurationSeconds(Number.isFinite(duration) ? duration : 0);
        }}
        onTimeUpdate={(event) => {
          setCurrentSeconds(event.currentTarget.currentTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentSeconds(0);
        }}
      >
        <a href={downloadUrl} target="_blank" rel="noreferrer">
          Открыть голосовое сообщение
        </a>
      </audio>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={togglePlayback}
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:scale-[1.03]",
            isMine ? "bg-white text-[#111111]" : "bg-[#111111] text-white",
          )}
          aria-label={isPlaying ? "Пауза" : "Воспроизвести голосовое сообщение"}
        >
          {isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5 -ml-[1px]" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div
              className="grid h-3.5 min-w-0 flex-1 items-center gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${waveform.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {waveform.map((height, index) => {
                const barProgress = (index + 1) / waveform.length;
                const isActive = barProgress <= progress;

                return (
                  <span
                    key={`${height}-${index}`}
                    className={clsx(
                      "w-full rounded-full transition-colors",
                      isMine
                        ? isActive
                          ? "bg-white"
                          : "bg-white/35"
                        : isActive
                          ? "bg-[#111111]"
                          : "bg-black/22",
                    )}
                    style={{ height: `${height}px` }}
                  />
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowTranscript((prev) => !prev)}
              className={clsx(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border text-[12px] font-semibold transition",
                isMine
                  ? "border-white/30 bg-white/10 text-white hover:bg-white/20"
                  : "border-black/15 bg-white text-[#111111] hover:border-black/30",
              )}
              data-testid="voice-transcript-button"
              title="Псевдо-расшифровка"
              aria-label="Псевдо-расшифровка"
            >
              A
            </button>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium">
            <span className={clsx(isMine ? "text-white/78" : "text-stone-500")}>
              {formatRecordingDuration(durationSeconds || currentSeconds)}
            </span>
            <span className={clsx("h-1 w-1 rounded-full", isMine ? "bg-white/55" : "bg-black/30")} />
            <span className={clsx(isMine ? "text-white/78" : "text-stone-500")}>
              {formatFileSize(attachment.sizeBytes)}
            </span>
          </div>
        </div>
      </div>

      {showTranscript ? (
        <div
          className={clsx(
            "mt-2 rounded-[12px] border px-2.5 py-2 text-[12px] leading-5",
            isMine
              ? "border-white/22 bg-white/10 text-white/90"
              : "border-black/10 bg-white/75 text-stone-700",
          )}
          data-testid="voice-transcript-content"
        >
          {pseudoTranscript}
        </div>
      ) : null}
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

function renderHighlightedMessageBody(body: string, query: string, highlightClassName: string) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return body;
  }

  const escapedQuery = escapeRegExp(normalizedQuery);
  if (!escapedQuery) {
    return body;
  }

  const matcher = new RegExp(`(${escapedQuery})`, "gi");
  const loweredQuery = normalizedQuery.toLocaleLowerCase();

  return body.split(matcher).map((part, index) => {
    if (part.toLocaleLowerCase() === loweredQuery) {
      return (
        <mark key={`${part}-${index}`} className={highlightClassName}>
          {part}
        </mark>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatGroupRole(role: ChatMemberRole) {
  switch (role) {
    case "creator":
      return "creator";
    case "admin":
      return "admin";
    default:
      return "member";
  }
}

function getReplyPreviewText(
  message:
    | {
        body: string | null;
        isDeleted?: boolean;
        deletedAt?: string | null;
        attachments?: Array<{ originalName: string; mimeType?: string | null }>;
      }
    | null
    | undefined,
) {
  return getLastMessagePreviewText(message);
}

function formatRecordingDuration(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;

  return `${minutes}:${String(restSeconds).padStart(2, "0")}`;
}

function buildWaveformVariant(seed: string, bars: number) {
  const normalizedBars = Math.max(24, bars);
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  const heights: number[] = [];
  for (let index = 0; index < normalizedBars; index += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const normalized = hash / 0xffffffff;
    const gaussianEnvelope = Math.exp(-Math.pow((index - normalizedBars * 0.34) / 7.2, 2));
    const baseHeight = 2 + Math.round(normalized * 7);
    const peakBoost = Math.round(gaussianEnvelope * 6);

    heights.push(Math.max(2, Math.min(12, baseHeight + peakBoost)));
  }

  return heights;
}

function buildPseudoTranscript(seed: string, durationSeconds: number, sizeBytes: number) {
  const variants = [
    "Псевдо-расшифровка: короткая реплика про текущую задачу и следующий шаг.",
    "Псевдо-расшифровка: подтверждение, что всё ок, продолжаем в том же потоке.",
    "Псевдо-расшифровка: уточнение по дизайну и просьба сделать компактнее.",
    "Псевдо-расшифровка: голосовое с быстрым фидбеком по интерфейсу.",
    "Псевдо-расшифровка: обсуждение деталей перед финальным коммитом.",
  ];
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }

  const variant = variants[hash % variants.length];
  return `${variant} (${formatRecordingDuration(durationSeconds)} · ${formatFileSize(sizeBytes)})`;
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

function MicIcon({ className }: { className?: string }) {
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
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
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

function ReplyArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 8 4 12l5 4" />
      <path d="M20 18c0-4.42-3.58-8-8-8H4" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
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
      <path d="m14.5 4.5 5 5" />
      <path d="M10 9 19 18" />
      <path d="m9.5 14.5-4 5" />
      <path d="M7 6.5 17.5 17" />
      <path d="m7 6.5 2.5-2.5 7 7L14 13.5" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
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
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EditPencilIcon({ className }: { className?: string }) {
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
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-5 1 1-5 12.5-12.5Z" />
    </svg>
  );
}

function SelectCheckIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.3 2.3 4.7-5.1" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v4.7l3.2 1.8" />
    </svg>
  );
}

function BellOffIcon({ className }: { className?: string }) {
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
      <path d="M9.22 5.23A6 6 0 0 1 18 10v3.8l1.4 2.3a1 1 0 0 1-.85 1.5H7.6" />
      <path d="M4.71 4.71 19.29 19.29" />
      <path d="M5.45 17.6A1 1 0 0 1 4.6 16.1L6 13.8V10a6 6 0 0 1 .38-2.11" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
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
      <path d="M6.8 8.5a5.2 5.2 0 1 1 10.4 0v2.1c0 .9.26 1.78.75 2.53l.95 1.48a1.2 1.2 0 0 1-1.01 1.85H6.07a1.2 1.2 0 0 1-1.01-1.85l.95-1.48c.49-.75.75-1.63.75-2.53V8.5Z" />
      <path d="M9.75 18.4a2.25 2.25 0 0 0 4.5 0" />
    </svg>
  );
}

function GiftIcon({ className }: { className?: string }) {
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
      <rect x="3.5" y="9" width="17" height="11" rx="2.2" />
      <path d="M12 9v11" />
      <path d="M4 9h16" />
      <path d="M7.9 9c-1.53 0-2.9-.9-2.9-2.35C5 5.43 5.95 4.5 7.3 4.5c2.08 0 3.38 2.3 4.7 4.5H7.9Z" />
      <path d="M16.1 9c1.53 0 2.9-.9 2.9-2.35 0-1.22-.95-2.15-2.3-2.15-2.08 0-3.38 2.3-4.7 4.5h4.1Z" />
    </svg>
  );
}

function WallpaperIcon({ className }: { className?: string }) {
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
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="m6.5 16 3.5-3.5 2.6 2.6 3.9-4.1 3 3" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CopySlashIcon({ className }: { className?: string }) {
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
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 5H8a2 2 0 0 0-2 2v7" />
      <path d="M4.71 4.71 19.29 19.29" />
    </svg>
  );
}

function ExportIcon({ className }: { className?: string }) {
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
      <path d="M12 3v10" />
      <path d="m8.5 9.5 3.5 3.5 3.5-3.5" />
      <path d="M5 15.5v1.75A2.75 2.75 0 0 0 7.75 20h8.5A2.75 2.75 0 0 0 19 17.25V15.5" />
    </svg>
  );
}

function BroomIcon({ className }: { className?: string }) {
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
      <path d="m14 4 6 6" />
      <path d="m4 14 6 6" />
      <path d="m13 5-8 8a2 2 0 0 0 0 2.83L8.17 19a2 2 0 0 0 2.83 0l8-8" />
      <path d="m2 22 5-5" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M4 7h16" />
      <path d="M10 3h4" />
      <path d="M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function GalleryIcon({ className }: { className?: string }) {
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
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="9" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <path d="m6.5 17 4-4 2.8 2.8 2.2-2.3 2 2.5" />
    </svg>
  );
}

function VideoIcon({ className }: { className?: string }) {
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
      <rect x="3.5" y="6" width="12.5" height="12" rx="2.5" />
      <path d="m16 10 4-2.2v8.4L16 14" />
    </svg>
  );
}

function FileStackIcon({ className }: { className?: string }) {
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
      <path d="M8 3.5h7l3 3V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
      <path d="M15 3.5V7h3" />
      <path d="M9 12h6" />
      <path d="M9 15h6" />
    </svg>
  );
}

function AudioBarsIcon({ className }: { className?: string }) {
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
      <path d="M5 15v-3" />
      <path d="M9 18v-9" />
      <path d="M13 15v-3" />
      <path d="M17 20V4" />
      <path d="M21 14v-4" />
    </svg>
  );
}

function LinkChainIcon({ className }: { className?: string }) {
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
      <path d="M10 14 8.5 15.5a3 3 0 0 1-4.24-4.24l3-3A3 3 0 0 1 11.5 8" />
      <path d="M14 10 15.5 8.5a3 3 0 1 1 4.24 4.24l-3 3A3 3 0 0 1 12.5 16" />
      <path d="m9 15 6-6" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21.2 16.6v2a1.8 1.8 0 0 1-1.96 1.8 17.88 17.88 0 0 1-7.78-2.77 17.45 17.45 0 0 1-5.42-5.42A17.88 17.88 0 0 1 3.27 4.43 1.8 1.8 0 0 1 5.06 2.5h1.95a1.8 1.8 0 0 1 1.77 1.49c.13.9.43 1.76.88 2.56a1.8 1.8 0 0 1-.4 2.08L8.1 9.8a14.2 14.2 0 0 0 6.1 6.1l1.17-1.16a1.8 1.8 0 0 1 2.08-.4c.8.45 1.66.75 2.56.88A1.8 1.8 0 0 1 21.2 16.6Z" />
    </svg>
  );
}

function DotsVerticalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="12" cy="19" r="2.2" />
    </svg>
  );
}

function PanelRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M14 4v16" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3.5" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M14 4.13a3.5 3.5 0 0 1 0 5.74" />
    </svg>
  );
}

function ChatBubbleIcon({ className }: { className?: string }) {
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
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5A8.38 8.38 0 0 1 8 18.74L3 20l1.35-4.5A8.5 8.5 0 1 1 21 11.5Z" />
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
      <path d="m18 6-12 12" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 5.75c0-1.2 1.32-1.94 2.35-1.32l10.02 6.01c1 .6 1 2.05 0 2.65L10.35 19.1C9.32 19.72 8 18.98 8 17.78V5.75Z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.4 5.25A1.4 1.4 0 0 0 7 6.65v10.7a1.4 1.4 0 0 0 2.8 0V6.65a1.4 1.4 0 0 0-1.4-1.4Zm7.2 0a1.4 1.4 0 0 0-1.4 1.4v10.7a1.4 1.4 0 0 0 2.8 0V6.65a1.4 1.4 0 0 0-1.4-1.4Z" />
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
