"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { SOCKET_EVENTS } from "@repo/shared/events";
import {
  ChangeEvent,
  type ComponentType,
  FormEvent,
  KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readJson, useAuth } from "../lib/auth-context";
import {
  appendMessageUnique,
  dedupeMessages,
  normalizeMessagePage,
  upsertMessage,
} from "../lib/message-cache";
import { buildAttachmentUrl } from "../lib/config";
import {
  useRealtime,
  type CallMode,
  type RealtimeCallAcceptedPayload,
  type RealtimeCallDeclinedPayload,
  type RealtimeCallEndedPayload,
  type RealtimeCallIncomingPayload,
  type RealtimeCallSignalPayload,
} from "../lib/realtime-context";
import {
  CHAT_CENTER_MIN_WIDTH,
  CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  CHAT_RIGHT_PANEL_MAX_WIDTH,
  CHAT_RIGHT_PANEL_MIN_WIDTH,
  useChatLayout,
} from "../lib/chat-layout-context";
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
import { ConfirmDialog } from "./confirm-dialog";
import { UserAvatar } from "./user-avatar";

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
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
].join(",");
const ATTACHMENT_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
]);
const VOICE_RECORDER_MIME_TYPE = "audio/webm";
const VOICE_RECORDING_FILE_NAME = "voice-message.webm";
const SCROLL_BOTTOM_THRESHOLD = 180;
const PROFILE_PANEL_TRANSITION_MS = 280;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "😮", "😢"] as const;
const CALL_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];
const CALL_STATUS_MESSAGES: Record<CallSessionStatus, string> = {
  incoming: "Входящий вызов",
  outgoing: "Исходящий вызов",
  connecting: "Соединяем",
  active: "Вызов активен",
};

type ComposerPayload = {
  body: string;
  file: File | null;
  replyToMessageId?: string | null;
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

type CallSessionStatus = "incoming" | "outgoing" | "connecting" | "active";

type CallSession = {
  callId: string;
  mode: CallMode;
  status: CallSessionStatus;
  initiatorUserId: string;
  peerUserId: string | null;
  createdAt: string;
};

export function ConversationView({ chatId }: { chatId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { accessToken, authorizedFetch, isAuthenticated, user } = useAuth();
  const { connectionState, emitSocketEvent, subscribeSocketEvent } = useRealtime();
  const { isDesktopLayout, leftSidebarWidth, rightPanelWidth, setRightPanelWidth } =
    useChatLayout();
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
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [confirmingMessage, setConfirmingMessage] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardPanelError, setForwardPanelError] = useState<string | null>(null);
  const [recentlyReactedMessageId, setRecentlyReactedMessageId] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [showConversationProfile, setShowConversationProfile] = useState(false);
  const [isConversationProfileMounted, setIsConversationProfileMounted] = useState(false);
  const [isConversationProfileVisible, setIsConversationProfileVisible] = useState(false);
  const [headerStatusMessage, setHeaderStatusMessage] = useState<string | null>(null);
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [isCallMicMuted, setIsCallMicMuted] = useState(false);
  const [isCallLocalCameraEnabled, setIsCallLocalCameraEnabled] = useState(true);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
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
  const callSessionRef = useRef<CallSession | null>(null);
  const callStartedAtRef = useRef<string | null>(null);
  const callPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callLocalStreamRef = useRef<MediaStream | null>(null);
  const callRemoteStreamRef = useRef<MediaStream | null>(null);
  const callRemoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const callRemoteVideoRef = useRef<HTMLVideoElement | null>(null);

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
      setRecentlyReactedMessageId(variables.messageId);
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
    setActiveMatchIndex(0);
  }, [chatId, normalizedMessageSearch]);

  useEffect(() => {
    const peerConnection = callPeerConnectionRef.current;
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      callPeerConnectionRef.current = null;
    }

    callLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
    callLocalStreamRef.current = null;
    callRemoteStreamRef.current = null;
    callStartedAtRef.current = null;
    setCallDurationSeconds(0);
    setCallSession(null);
    setCallError(null);
    setIsCallMicMuted(false);
    setIsCallLocalCameraEnabled(true);
    if (callRemoteAudioRef.current) {
      callRemoteAudioRef.current.srcObject = null;
    }
    if (callLocalVideoRef.current) {
      callLocalVideoRef.current.srcObject = null;
    }
    if (callRemoteVideoRef.current) {
      callRemoteVideoRef.current.srcObject = null;
    }
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
    setRecentlyReactedMessageId(null);
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
    !isGroupChat && conversationProfileUser.username
      ? `#${conversationProfileUser.username}`
      : null;
  const profileDetailRows = isGroupChat
    ? [
        { label: "Тип", value: "Групповой чат" },
        { label: "Участники", value: String(groupMembersCount) },
        {
          label: "Ваша роль",
          value: formatGroupRole(chatQuery.data?.currentUserRole ?? "member"),
        },
      ]
    : [
        { label: "Email", value: conversationProfileUser.email },
        {
          label: "Статус",
          value: otherUser?.lastSeenAt
            ? `Был(а) ${formatRelativeLastSeen(otherUser.lastSeenAt)}`
            : "Личный чат",
        },
        {
          label: "Последняя активность",
          value: otherUser?.lastSeenAt
            ? formatTime(otherUser.lastSeenAt)
            : "Сейчас недоступно",
        },
      ];
  const visibleGroupMembers = groupMembersQuery.data?.members ?? [];

  const clearCallSessionLocally = useCallback(
    (statusMessage?: string | null) => {
      const peerConnection = callPeerConnectionRef.current;
      if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
        callPeerConnectionRef.current = null;
      }

      callLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
      callLocalStreamRef.current = null;
      callRemoteStreamRef.current = null;
      callStartedAtRef.current = null;
      setCallDurationSeconds(0);
      setIsCallMicMuted(false);
      setIsCallLocalCameraEnabled(true);
      setCallSession(null);
      setCallError(null);

      if (callRemoteAudioRef.current) {
        callRemoteAudioRef.current.srcObject = null;
      }

      if (callLocalVideoRef.current) {
        callLocalVideoRef.current.srcObject = null;
      }

      if (callRemoteVideoRef.current) {
        callRemoteVideoRef.current.srcObject = null;
      }

      if (statusMessage) {
        setHeaderStatusMessage(statusMessage);
      }
    },
    [],
  );

  const ensureLocalCallStream = useCallback(async (mode: CallMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Браузер не поддерживает getUserMedia.");
    }

    if (callLocalStreamRef.current) {
      return callLocalStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video",
    });

    callLocalStreamRef.current = stream;
    setIsCallMicMuted(false);
    setIsCallLocalCameraEnabled(mode === "video");

    if (callLocalVideoRef.current) {
      callLocalVideoRef.current.srcObject = stream;
      if (mode === "video") {
        void callLocalVideoRef.current.play().catch(() => undefined);
      }
    }

    return stream;
  }, []);

  const ensureCallPeerConnection = useCallback(
    (callId: string, targetUserId: string | null) => {
      if (typeof RTCPeerConnection === "undefined") {
        throw new Error("WebRTC не поддерживается в этом браузере.");
      }

      const existingConnection = callPeerConnectionRef.current;
      if (existingConnection) {
        return existingConnection;
      }

      const nextConnection = new RTCPeerConnection({
        iceServers: CALL_ICE_SERVERS,
      });

      const remoteStream = new MediaStream();
      callRemoteStreamRef.current = remoteStream;

      if (callRemoteAudioRef.current) {
        callRemoteAudioRef.current.srcObject = remoteStream;
      }

      if (callRemoteVideoRef.current) {
        callRemoteVideoRef.current.srcObject = remoteStream;
      }

      nextConnection.ontrack = (event) => {
        const stream = callRemoteStreamRef.current;
        if (!stream) {
          return;
        }

        const incomingTracks =
          event.streams[0]?.getTracks().length
            ? event.streams[0].getTracks()
            : [event.track];

        for (const track of incomingTracks) {
          stream.addTrack(track);
        }

        if (callRemoteAudioRef.current) {
          void callRemoteAudioRef.current.play().catch(() => undefined);
        }

        if (callRemoteVideoRef.current) {
          void callRemoteVideoRef.current.play().catch(() => undefined);
        }
      };

      nextConnection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        emitSocketEvent(SOCKET_EVENTS.callSignal, {
          chatId,
          callId,
          targetUserId: targetUserId ?? undefined,
          signalType: "ice-candidate",
          payload: event.candidate.toJSON(),
        });
      };

      nextConnection.onconnectionstatechange = () => {
        const state = nextConnection.connectionState;

        if (state === "connected") {
          setCallSession((current) =>
            current
              ? {
                  ...current,
                  status: "active",
                }
              : current,
          );

          if (!callStartedAtRef.current) {
            callStartedAtRef.current = new Date().toISOString();
          }
          return;
        }

        if (state === "failed" || state === "closed" || state === "disconnected") {
          const activeSession = callSessionRef.current;
          if (activeSession) {
            emitSocketEvent(SOCKET_EVENTS.callEnd, {
              chatId,
              callId: activeSession.callId,
              reason: "connection_lost",
            });
          }
          clearCallSessionLocally("Соединение звонка прервано.");
        }
      };

      callPeerConnectionRef.current = nextConnection;
      return nextConnection;
    },
    [chatId, clearCallSessionLocally, emitSocketEvent],
  );

  const prepareCallConnection = useCallback(
    async (session: CallSession, targetUserId: string | null) => {
      const localStream = await ensureLocalCallStream(session.mode);
      const connection = ensureCallPeerConnection(session.callId, targetUserId);
      const senderTrackIds = new Set(
        connection
          .getSenders()
          .map((sender) => sender.track?.id)
          .filter((trackId): trackId is string => Boolean(trackId)),
      );

      for (const track of localStream.getTracks()) {
        if (senderTrackIds.has(track.id)) {
          continue;
        }

        connection.addTrack(track, localStream);
      }

      return connection;
    },
    [ensureCallPeerConnection, ensureLocalCallStream],
  );

  const startOfferForCall = useCallback(
    async (session: CallSession, targetUserId: string | null) => {
      try {
        const connection = await prepareCallConnection(session, targetUserId);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        emitSocketEvent(SOCKET_EVENTS.callSignal, {
          chatId,
          callId: session.callId,
          targetUserId: targetUserId ?? undefined,
          signalType: "offer",
          payload: offer,
        });
      } catch (error) {
        setCallError(error instanceof Error ? error.message : "Не удалось начать звонок.");
        clearCallSessionLocally("Не удалось установить звонок.");
      }
    },
    [chatId, clearCallSessionLocally, emitSocketEvent, prepareCallConnection],
  );

  const handleStartCall = useCallback(
    (mode: CallMode) => {
      if (!user?.id) {
        setCallError("Нужно дождаться авторизации пользователя.");
        return;
      }

      if (connectionState !== "connected") {
        setCallError("Realtime еще не подключен. Попробуйте через пару секунд.");
        return;
      }

      if (callSessionRef.current) {
        setCallError("Сначала завершите текущий звонок.");
        return;
      }

      const callId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const createdAt = new Date().toISOString();
      callStartedAtRef.current = createdAt;
      setCallDurationSeconds(0);
      setCallError(null);
      setShowConversationMenu(false);
      setShowConversationProfile(false);
      setCallSession({
        callId,
        mode,
        status: "outgoing",
        initiatorUserId: user.id,
        peerUserId: otherUser?.id ?? null,
        createdAt,
      });

      emitSocketEvent(SOCKET_EVENTS.callStart, {
        chatId,
        callId,
        mode,
      });
    },
    [chatId, connectionState, emitSocketEvent, otherUser?.id, user?.id],
  );

  const handleAcceptCall = useCallback(async () => {
    const session = callSessionRef.current;
    if (!session || session.status !== "incoming") {
      return;
    }

    setCallError(null);
    setCallSession((current) =>
      current
        ? {
            ...current,
            status: "connecting",
          }
        : current,
    );
    callStartedAtRef.current = new Date().toISOString();
    setCallDurationSeconds(0);

    emitSocketEvent(SOCKET_EVENTS.callAccept, {
      chatId,
      callId: session.callId,
    });

    try {
      await prepareCallConnection(session, session.peerUserId ?? session.initiatorUserId);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Не удалось принять вызов.");
      emitSocketEvent(SOCKET_EVENTS.callDecline, {
        chatId,
        callId: session.callId,
        reason: "media_error",
      });
      clearCallSessionLocally("Не удалось принять вызов.");
    }
  }, [chatId, clearCallSessionLocally, emitSocketEvent, prepareCallConnection]);

  const handleDeclineCall = useCallback(() => {
    const session = callSessionRef.current;
    if (!session) {
      return;
    }

    emitSocketEvent(SOCKET_EVENTS.callDecline, {
      chatId,
      callId: session.callId,
      reason: "declined",
    });
    clearCallSessionLocally("Вызов отклонен.");
  }, [chatId, clearCallSessionLocally, emitSocketEvent]);

  const handleEndCall = useCallback(() => {
    const session = callSessionRef.current;
    if (!session) {
      return;
    }

    emitSocketEvent(SOCKET_EVENTS.callEnd, {
      chatId,
      callId: session.callId,
      reason: "ended_by_user",
    });
    clearCallSessionLocally("Звонок завершен.");
  }, [chatId, clearCallSessionLocally, emitSocketEvent]);

  const toggleCallMicMute = useCallback(() => {
    const stream = callLocalStreamRef.current;
    if (!stream) {
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      return;
    }

    const nextMuted = !isCallMicMuted;
    for (const track of audioTracks) {
      track.enabled = !nextMuted;
    }
    setIsCallMicMuted(nextMuted);
  }, [isCallMicMuted]);

  const toggleCallCamera = useCallback(() => {
    const stream = callLocalStreamRef.current;
    if (!stream) {
      return;
    }

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) {
      return;
    }

    const nextEnabled = !isCallLocalCameraEnabled;
    for (const track of videoTracks) {
      track.enabled = nextEnabled;
    }
    setIsCallLocalCameraEnabled(nextEnabled);
  }, [isCallLocalCameraEnabled]);

  const handleIncomingCallSignal = useCallback(
    async (payload: RealtimeCallSignalPayload) => {
      if (payload.chatId !== chatId) {
        return;
      }

      const session = callSessionRef.current;
      if (!session || session.callId !== payload.callId || payload.fromUserId === user?.id) {
        return;
      }

      try {
        if (payload.signalType === "offer") {
          const offer = toSessionDescriptionInit(payload.payload);
          if (!offer) {
            return;
          }

          const targetUserId = payload.fromUserId;
          const connection = await prepareCallConnection(session, targetUserId);
          await connection.setRemoteDescription(offer);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);

          emitSocketEvent(SOCKET_EVENTS.callSignal, {
            chatId,
            callId: session.callId,
            targetUserId,
            signalType: "answer",
            payload: answer,
          });

          setCallSession((current) =>
            current
              ? {
                  ...current,
                  status: "connecting",
                  peerUserId: targetUserId,
                }
              : current,
          );
          return;
        }

        if (payload.signalType === "answer") {
          const answer = toSessionDescriptionInit(payload.payload);
          const connection = callPeerConnectionRef.current;
          if (!answer || !connection) {
            return;
          }

          await connection.setRemoteDescription(answer);
          setCallSession((current) =>
            current
              ? {
                  ...current,
                  status: "active",
                  peerUserId: payload.fromUserId,
                }
              : current,
          );

          if (!callStartedAtRef.current) {
            callStartedAtRef.current = new Date().toISOString();
          }
          return;
        }

        if (payload.signalType === "ice-candidate") {
          const candidate = toIceCandidateInit(payload.payload);
          const connection = callPeerConnectionRef.current;
          if (!candidate || !connection) {
            return;
          }

          await connection.addIceCandidate(candidate);
        }
      } catch (error) {
        setCallError(error instanceof Error ? error.message : "Ошибка обработки звонка.");
      }
    },
    [chatId, emitSocketEvent, prepareCallConnection, user?.id],
  );

  useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  useEffect(() => {
    if (callSession?.status !== "active") {
      return;
    }

    const updateDuration = () => {
      if (!callStartedAtRef.current) {
        return;
      }

      const startedAtMs = new Date(callStartedAtRef.current).getTime();
      if (Number.isNaN(startedAtMs)) {
        return;
      }

      const nextSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      setCallDurationSeconds(nextSeconds);
    };

    updateDuration();
    const intervalId = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(intervalId);
  }, [callSession?.status]);

  useEffect(() => {
    const unsubscribers = [
      subscribeSocketEvent("call:incoming", (payload) => {
        const nextPayload = payload as RealtimeCallIncomingPayload;
        if (nextPayload.chatId !== chatId || nextPayload.fromUserId === user?.id) {
          return;
        }

        const activeSession = callSessionRef.current;
        if (activeSession && activeSession.callId !== nextPayload.callId) {
          emitSocketEvent(SOCKET_EVENTS.callDecline, {
            chatId: nextPayload.chatId,
            callId: nextPayload.callId,
            reason: "busy",
          });
          return;
        }

        callStartedAtRef.current = nextPayload.createdAt;
        setCallDurationSeconds(0);
        setCallError(null);
        setCallSession({
          callId: nextPayload.callId,
          mode: nextPayload.mode,
          status: "incoming",
          initiatorUserId: nextPayload.fromUserId,
          peerUserId: nextPayload.fromUserId,
          createdAt: nextPayload.createdAt,
        });
      }),
      subscribeSocketEvent("call:accepted", (payload) => {
        const nextPayload = payload as RealtimeCallAcceptedPayload;
        if (nextPayload.chatId !== chatId) {
          return;
        }

        const activeSession = callSessionRef.current;
        if (!activeSession || activeSession.callId !== nextPayload.callId) {
          return;
        }

        if (nextPayload.userId === user?.id) {
          setCallSession((current) =>
            current
              ? {
                  ...current,
                  status: "connecting",
                }
              : current,
          );
          return;
        }

        if (
          activeSession.peerUserId &&
          activeSession.peerUserId !== nextPayload.userId
        ) {
          return;
        }

        if (activeSession.status === "outgoing" || activeSession.status === "connecting") {
          const nextSession: CallSession = {
            ...activeSession,
            status: "connecting",
            peerUserId: nextPayload.userId,
          };
          setCallSession(nextSession);
          void startOfferForCall(nextSession, nextPayload.userId);
        }
      }),
      subscribeSocketEvent("call:declined", (payload) => {
        const nextPayload = payload as RealtimeCallDeclinedPayload;
        if (nextPayload.chatId !== chatId) {
          return;
        }

        const activeSession = callSessionRef.current;
        if (!activeSession || activeSession.callId !== nextPayload.callId) {
          return;
        }

        if (nextPayload.userId === user?.id) {
          return;
        }

        clearCallSessionLocally("Собеседник отклонил вызов.");
      }),
      subscribeSocketEvent("call:ended", (payload) => {
        const nextPayload = payload as RealtimeCallEndedPayload;
        if (nextPayload.chatId !== chatId) {
          return;
        }

        const activeSession = callSessionRef.current;
        if (!activeSession || activeSession.callId !== nextPayload.callId) {
          return;
        }

        if (nextPayload.userId === user?.id) {
          return;
        }

        clearCallSessionLocally("Собеседник завершил звонок.");
      }),
      subscribeSocketEvent("call:signal", (payload) => {
        void handleIncomingCallSignal(payload as RealtimeCallSignalPayload);
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [
    chatId,
    clearCallSessionLocally,
    emitSocketEvent,
    handleIncomingCallSignal,
    startOfferForCall,
    subscribeSocketEvent,
    user?.id,
  ]);

  useEffect(
    () => () => {
      const peerConnection = callPeerConnectionRef.current;
      if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
        callPeerConnectionRef.current = null;
      }

      callLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
      callLocalStreamRef.current = null;
      callRemoteStreamRef.current = null;
      callStartedAtRef.current = null;

      if (callRemoteAudioRef.current) {
        callRemoteAudioRef.current.srcObject = null;
      }
      if (callLocalVideoRef.current) {
        callLocalVideoRef.current.srcObject = null;
      }
      if (callRemoteVideoRef.current) {
        callRemoteVideoRef.current.srcObject = null;
      }
    },
    [],
  );

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
  }, [isComposerSubmitPending, isEditingMessage, recordingState, stopMediaStream]);

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

    if (!ATTACHMENT_ALLOWED_TYPES.has(selectedFile.type)) {
      setComposerError("Поддерживаются PNG, JPEG, WEBP, PDF, TXT и аудио WEBM/OGG/MP4/MP3.");
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

    setComposerError(null);
    if (editingMessage) {
      editMessageMutation.mutate({ messageId: editingMessage.id, body });
      return;
    }

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

    setConfirmingMessage(message);
  };

  const handleReplyMessage = (message: ChatMessage) => {
    if (recordingState !== "idle" || isComposerSubmitPending) {
      return;
    }

    if (message.isDeleted) {
      setComposerError("Нельзя ответить на удаленное сообщение.");
      return;
    }

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

    toggleReactionMutation.mutate({
      messageId: message.id,
      emoji,
    });
  };

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

  const materialsCount = useMemo(
    () =>
      messageItems.reduce((total, message) => {
        const linkCount = (message.body?.match(/(?:https?:\/\/|www\.)\S+/gi) ?? []).length;
        return total + message.attachments.length + linkCount;
      }, 0),
    [messageItems],
  );

  const profileSummaryStatus = isGroupChat
    ? `${groupMembersCount} участников`
    : otherUser?.lastSeenAt
      ? `Был(а) ${formatRelativeLastSeen(otherUser.lastSeenAt)}`
      : "Личный чат";
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
  const callPartnerName = otherUser?.displayName ?? conversationTitle;
  const hasCallSession = Boolean(callSession);
  const isIncomingCall = callSession?.status === "incoming";
  const callStatusLabel = callSession ? CALL_STATUS_MESSAGES[callSession.status] : null;
  const callModeLabel = callSession?.mode === "video" ? "Видео" : "Аудио";
  const callSummaryLabel = callStatusLabel
    ? `${callStatusLabel} · ${callModeLabel.toLocaleLowerCase()}`
    : null;

  const handleConversationCall = () => {
    if (hasCallSession) {
      setHeaderStatusMessage("Сначала завершите текущий звонок.");
      setShowConversationMenu(false);
      return;
    }

    handleStartCall("audio");
    setShowConversationMenu(false);
  };

  const handleConversationVideoCall = () => {
    if (hasCallSession) {
      setHeaderStatusMessage("Сначала завершите текущий звонок.");
      setShowConversationMenu(false);
      return;
    }

    handleStartCall("video");
    setShowConversationMenu(false);
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
        className="relative z-20 flex flex-none items-start justify-between gap-4 border-b border-black/8 bg-white px-4 py-3 transition-[padding] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-5"
        style={conversationProfileOffsetStyle}
      >
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
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-full border border-transparent transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black",
              hasCallSession ? "border-black/12 bg-[#111111] text-white hover:bg-black hover:text-white" : null,
            )}
            aria-label="Позвонить собеседнику"
            title="Позвонить собеседнику"
          >
            <PhoneIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleConversationVideoCall}
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-full border border-transparent transition hover:border-black/10 hover:bg-black/[0.03] hover:text-black",
              hasCallSession && callSession?.mode === "video"
                ? "border-black/12 bg-[#111111] text-white hover:bg-black hover:text-white"
                : null,
            )}
            aria-label="Видеозвонок"
            title="Видеозвонок"
          >
            <VideoIcon className="h-5 w-5" />
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
                className="absolute right-0 top-12 z-30 min-w-[220px] rounded-[22px] border border-black/8 bg-white p-2 text-sm text-[#171717] shadow-[0_24px_60px_rgba(17,24,39,0.14)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowConversationMenu(false);
                    setShowConversationProfile(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                >
                  <PanelRightIcon className="h-4 w-4 text-stone-500" />
                  <span>Открыть профиль</span>
                </button>
                <button
                  type="button"
                  onClick={handleConversationCall}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                >
                  <PhoneIcon className="h-4 w-4 text-stone-500" />
                  <span>{hasCallSession ? "Аудио уже активен" : "Аудио звонок"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleConversationVideoCall}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                >
                  <VideoIcon className="h-4 w-4 text-stone-500" />
                  <span>{hasCallSession ? "Видео уже активен" : "Видео звонок"}</span>
                </button>
                {hasCallSession ? (
                  <button
                    type="button"
                    onClick={handleEndCall}
                    className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-stone-700 transition hover:bg-black/[0.03]"
                  >
                    <CloseIcon className="h-4 w-4 text-stone-500" />
                    <span>Завершить звонок</span>
                  </button>
                ) : null}
                {isGroupChat ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowConversationMenu(false);
                      setShowGroupMembersPanel((current) => !current);
                    }}
                    data-testid="group-members-toggle"
                    className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                  >
                    <UsersIcon className="h-4 w-4 text-stone-500" />
                    <span>{showGroupMembersPanel ? "Скрыть участников" : "Показать участников"}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={toggleMessageSearch}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                >
                  <SearchIcon className="h-4 w-4 text-stone-500" />
                  <span>{showMessageSearch || hasSearchInput ? "Скрыть поиск" : "Искать в чате"}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {callSession ? (
        <div
          className="relative z-10 border-b border-black/8 bg-[#f8f8f7] px-4 py-3 sm:px-6"
          data-testid="call-panel"
        >
          <audio ref={callRemoteAudioRef} autoPlay playsInline className="hidden" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {callSummaryLabel}
              </p>
              <p className="mt-1 truncate text-sm text-[#171717]">
                {isIncomingCall
                  ? `${callPartnerName} звонит вам`
                  : `${callPartnerName} · ${formatRecordingDuration(callDurationSeconds)}`}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {connectionState === "connected"
                  ? "Realtime активен"
                  : "Realtime переподключается"}
              </p>
              {callError ? (
                <p className="mt-2 rounded-[10px] border border-black/10 bg-white px-2.5 py-1.5 text-xs text-stone-600">
                  {callError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isIncomingCall ? (
                <>
                  <button
                    type="button"
                    onClick={handleDeclineCall}
                    className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black"
                    data-testid="call-decline-button"
                  >
                    Отклонить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleAcceptCall();
                    }}
                    className="rounded-full bg-[#111111] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-black"
                    data-testid="call-accept-button"
                  >
                    Принять
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleCallMicMute}
                    className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black"
                    data-testid="call-toggle-mic-button"
                  >
                    {isCallMicMuted ? "Mic Off" : "Mic On"}
                  </button>
                  {callSession.mode === "video" ? (
                    <button
                      type="button"
                      onClick={toggleCallCamera}
                      className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600 transition hover:border-black/25 hover:text-black"
                      data-testid="call-toggle-video-button"
                    >
                      {isCallLocalCameraEnabled ? "Cam On" : "Cam Off"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleEndCall}
                    className="rounded-full bg-[#111111] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-black"
                    data-testid="call-end-button"
                  >
                    Завершить
                  </button>
                </>
              )}
            </div>
          </div>

          {callSession.mode === "video" ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <video
                ref={callRemoteVideoRef}
                autoPlay
                playsInline
                className="h-36 w-full rounded-[16px] border border-black/8 bg-black object-cover sm:h-40"
                data-testid="call-remote-video"
              />
              <video
                ref={callLocalVideoRef}
                autoPlay
                muted
                playsInline
                className={clsx(
                  "h-36 w-full rounded-[16px] border border-black/8 bg-black object-cover sm:h-40",
                  !isCallLocalCameraEnabled && "opacity-60",
                )}
                data-testid="call-local-video"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {showMessageSearch ? (
        <div
          className="relative z-10 border-b border-black/8 bg-white px-4 py-3 sm:px-6"
          style={conversationProfileOffsetStyle}
        >
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
          style={conversationProfileOffsetStyle}
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
                isConversationProfileVisible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-3 opacity-0",
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
                  onClick={() => setHeaderStatusMessage("Настройки звука добавим следующим шагом.")}
                />
                <ProfileActionTile
                  icon={GiftIcon}
                  label="Подарок"
                  onClick={() => setHeaderStatusMessage("Подарки добавим следующим шагом.")}
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
                    <p className="text-lg font-semibold text-[#171717]">{materialsCount}</p>
                    <p className="mt-1 text-sm text-stone-500">Материалов и ссылок</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6 px-5 py-6">
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
                              {formatGroupRole(member.role)}
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
        className="scroll-region-y relative z-10 flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-5 sm:px-6"
        style={conversationProfileOffsetStyle}
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
          const currentUserReaction =
            currentUserId
              ? message.reactions.find((reaction) => reaction.userIds.includes(currentUserId))?.emoji ??
                null
              : null;

          return (
            <div
              key={item.key}
              data-testid="message-item"
              data-message-id={message.id}
              data-message-owner={isMine ? "self" : "other"}
              data-message-search-match={isSearchMatch ? "true" : "false"}
              data-message-search-active={isActiveSearchMatch ? "true" : "false"}
              onMouseLeave={() => {
                setRecentlyReactedMessageId((current) =>
                  current === message.id ? null : current,
                );
              }}
              className={clsx(
                "group flex w-full",
                bubbleOnRight ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={clsx(
                  "relative",
                  bubbleOnRight
                    ? "ml-auto max-w-[97%] sm:max-w-[93%] xl:max-w-[86%] 2xl:max-w-[84%]"
                    : "max-w-[97%] sm:max-w-[93%] xl:max-w-[86%] 2xl:max-w-[84%]",
                )}
              >
                {!message.isDeleted ? (
                  <div
                    className={clsx(
                      "pointer-events-none absolute top-0 z-20 flex min-w-[120px] flex-col gap-1 rounded-[14px] border border-black/10 bg-white/95 p-1 shadow-[0_12px_28px_rgba(17,24,39,0.12)] backdrop-blur-sm opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                      isMine ? "right-full mr-2" : "left-full ml-2",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleReplyMessage(message)}
                      data-testid="reply-message-button"
                      className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500 transition hover:border-black/25 hover:text-black"
                    >
                      Ответ
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartForwardMessage(message)}
                      data-testid="forward-message-button"
                      className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500 transition hover:border-black/25 hover:text-black"
                    >
                      Переслать
                    </button>
                    {isMine ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartEditingMessage(message)}
                          data-testid="edit-message-button"
                          className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500 transition hover:border-black/25 hover:text-black"
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(message)}
                          data-testid="delete-message-button"
                          className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500 transition hover:border-black/25 hover:text-black"
                        >
                          {deleteMessageMutation.isPending ? "..." : "Удалить"}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
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
                          ? "rounded-[18px] rounded-br-[7px] px-3 py-1.5"
                          : "rounded-[18px] rounded-bl-[7px] px-3 py-1.5"
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
                          shortTextOnlyBubble ? "gap-x-2" : "gap-x-1.5",
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
                  </div>

                  {message.reactions.length > 0 ? (
                    <div
                      className={clsx(
                        "flex max-w-full flex-wrap gap-1",
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
                              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                              reactedByCurrentUser
                                ? "border-black bg-black text-white"
                                : "border-black/10 bg-white text-stone-600 hover:border-black/25 hover:text-black",
                            )}
                            data-testid="message-reaction-chip"
                          >
                            <span>{reaction.emoji}</span>
                            <span>{reaction.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {!message.isDeleted && recentlyReactedMessageId !== message.id ? (
                    <div
                      className="pointer-events-none flex max-h-0 max-w-full flex-wrap gap-1 overflow-hidden rounded-[14px] border border-black/10 bg-white px-2 py-0 opacity-0 shadow-sm -translate-y-1 transition-all duration-150 ease-out group-hover:pointer-events-auto group-hover:max-h-16 group-hover:translate-y-0 group-hover:py-1.5 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:max-h-16 group-focus-within:translate-y-0 group-focus-within:py-1.5 group-focus-within:opacity-100"
                      data-testid="message-reaction-picker"
                    >
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={`${message.id}-${emoji}-quick-reaction`}
                          type="button"
                          onClick={() => handleToggleMessageReaction(message, emoji)}
                          disabled={toggleReactionMutation.isPending}
                          className={clsx(
                            "rounded-full border px-2 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                            currentUserReaction === emoji
                              ? "border-black bg-black text-white"
                              : "border-black/10 bg-white text-stone-700 hover:border-black/25 hover:text-black",
                          )}
                          data-testid="quick-reaction-button"
                          aria-label={`Поставить реакцию ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messageListEndRef} aria-hidden="true" />
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex-none border-t border-black/8 p-4 sm:p-5"
        style={conversationProfileOffsetStyle}
      >
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
      </form>

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
    <div className={clsx("space-y-2", attachments.length > 0 && "mt-1")}>
      {attachments.map((attachment) => {
        const downloadUrl = buildAttachmentUrl(attachment.downloadPath, accessToken);
        const isAudio = attachment.mimeType.startsWith("audio/");

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

        if (isAudio) {
          return (
            <VoiceMessageAttachment
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

function toSessionDescriptionInit(payload: unknown): RTCSessionDescriptionInit | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeDescription = payload as Partial<RTCSessionDescriptionInit>;
  if (
    typeof maybeDescription.type !== "string" ||
    (maybeDescription.type !== "offer" && maybeDescription.type !== "answer") ||
    typeof maybeDescription.sdp !== "string"
  ) {
    return null;
  }

  return {
    type: maybeDescription.type,
    sdp: maybeDescription.sdp,
  };
}

function toIceCandidateInit(payload: unknown): RTCIceCandidateInit | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeCandidate = payload as Partial<RTCIceCandidateInit>;
  if (typeof maybeCandidate.candidate !== "string") {
    return null;
  }

  return {
    candidate: maybeCandidate.candidate,
    sdpMid:
      typeof maybeCandidate.sdpMid === "string" ? maybeCandidate.sdpMid : null,
    sdpMLineIndex:
      typeof maybeCandidate.sdpMLineIndex === "number"
        ? maybeCandidate.sdpMLineIndex
        : null,
    usernameFragment:
      typeof maybeCandidate.usernameFragment === "string"
        ? maybeCandidate.usernameFragment
        : undefined,
  };
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

function PhoneIcon({ className }: { className?: string }) {
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
      <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 3.18 2 2 0 0 1 4.11 1h2a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.1 8.91a16 16 0 0 0 6 6l1.27-1.26a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function VideoIcon({ className }: { className?: string }) {
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
      <path d="M15 10.5v3a3 3 0 0 1-3 3H6.5a3.5 3.5 0 0 1-3.5-3.5V11a3.5 3.5 0 0 1 3.5-3.5H12a3 3 0 0 1 3 3Z" />
      <path d="m15 11 6-3v8l-6-3" />
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

function ProfileActionTile({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
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
