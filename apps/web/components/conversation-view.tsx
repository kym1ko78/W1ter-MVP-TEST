"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
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
  formatConversationDateLabel,
  formatFileSize,
  formatRelativeLastSeen,
  formatTime,
  getChatTitle,
  getConversationDayKey,
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

type ComposerPayload = {
  body: string;
  file: File | null;
};

type RecordingState = "idle" | "recording" | "stopping";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { accessToken, authorizedFetch, isAuthenticated, user } = useAuth();
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [confirmingMessage, setConfirmingMessage] = useState<ChatMessage | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const deferredMessageSearch = useDeferredValue(messageSearch);
  const deferredGroupMemberSearch = useDeferredValue(groupMemberSearch);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageListEndRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollAfterSendRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const hasInitialScrollRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const prefilledSearchQueryRef = useRef<string | null>(null);
  const focusedFromSearchParamRef = useRef<string | null>(null);

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
    setShowGroupMembersPanel(false);
    setGroupMemberSearch("");
    setGroupPanelError(null);
    setConfirmingMemberRemoval(null);
    setConfirmingGroupLeave(false);
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
  const hasComposerContent = Boolean(draft.trim() || pendingFile);
  const showSendButton = hasComposerContent || sendMessageMutation.isPending;
  const showVoiceButton =
    !hasComposerContent && !sendMessageMutation.isPending && recordingState === "idle";
  const hasSearchInput = normalizedMessageSearch.length > 0;
  const hasSearchMatches = messageSearchMatches.length > 0;
  const activeSearchNumber = hasSearchMatches
    ? Math.min(activeMatchIndex + 1, messageSearchMatches.length)
    : 0;
  const isGroupActionPending =
    addGroupMemberMutation.isPending ||
    removeGroupMemberMutation.isPending ||
    updateGroupMemberRoleMutation.isPending ||
    leaveGroupMutation.isPending;

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
    if (recordingState !== "idle" || sendMessageMutation.isPending) {
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
  }, [recordingState, sendMessageMutation.isPending, stopMediaStream]);

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
        sendMessageMutation.mutate({ body: "", file: voiceFile });
      };

      recorder.stop();
    },
    [sendMessageMutation, stopMediaStream],
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
    const body = draft.trim();
    if ((!body && !pendingFile) || sendMessageMutation.isPending || recordingState !== "idle") {
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
      <header className="relative z-10 flex flex-none flex-wrap items-center justify-between gap-3 border-b border-black/8 px-5 py-4 sm:flex-nowrap sm:gap-4 sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar
            user={
              otherUser ?? {
                displayName: conversationTitle,
                email: conversationTitle,
                avatarUrl: null,
              }
            }
            accessToken={accessToken}
            className="h-12 w-12 shrink-0 rounded-[16px]"
            fallbackClassName="text-sm"
          />
          <div className="min-w-0">
            <h2
              className="truncate text-lg font-semibold tracking-tight text-[#171717]"
              data-testid="conversation-title"
            >
              {conversationTitle}
            </h2>
            <p className="truncate text-sm text-stone-500" data-testid="conversation-status">
              {isGroupChat
                ? `${groupMembersCount} участников`
                : otherUser?.lastSeenAt
                ? `Был(а) ${formatRelativeLastSeen(otherUser.lastSeenAt)}`
                : "Личный чат"}
            </p>
          </div>
        </div>
        <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto">
          {chatQuery.data.unreadCount > 0 ? (
            <div className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-stone-500">
              {chatQuery.data.unreadCount}
            </div>
          ) : null}
          {isGroupChat ? (
            <button
              type="button"
              onClick={() => setShowGroupMembersPanel((prev) => !prev)}
              data-testid="group-members-toggle"
              className={clsx(
                "shrink-0 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition",
                showGroupMembersPanel
                  ? "border-black bg-[#111111] text-white"
                  : "border-black/12 bg-white text-stone-600 hover:border-black/25 hover:text-black",
              )}
            >
              {showGroupMembersPanel ? "Скрыть участников" : "Участники"}
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-[290px] sm:flex-none">
            <input
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
            {hasSearchInput ? (
              <div className="flex shrink-0 items-center gap-1">
                <span
                  data-testid="message-search-counter"
                  className="rounded-full border border-black/10 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-stone-500"
                >
                  {activeSearchNumber}/{messageSearchMatches.length}
                </span>
                <button
                  type="button"
                  onClick={() => moveMessageSearch(-1)}
                  disabled={!hasSearchMatches}
                  data-testid="message-search-prev"
                  className="h-8 w-8 rounded-full border border-black/10 bg-white text-sm text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label="Предыдущее совпадение"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveMessageSearch(1)}
                  disabled={!hasSearchMatches}
                  data-testid="message-search-next"
                  className="h-8 w-8 rounded-full border border-black/10 bg-white text-sm text-stone-600 transition hover:border-black/25 hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
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
                  className="h-8 w-8 rounded-full border border-black/10 bg-white text-sm text-stone-600 transition hover:border-black/25 hover:text-black"
                  aria-label="Очистить поиск по сообщениям"
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {hasSearchInput ? (
        <div
          className={clsx(
            "border-b border-black/8 px-4 py-2 text-xs sm:px-6",
            hasSearchMatches ? "text-stone-500" : "text-stone-600",
          )}
          data-testid="message-search-state"
        >
          {hasSearchMatches
            ? `Найдено ${messageSearchMatches.length}. Enter, ↑ и ↓ — переход по совпадениям.`
            : "Ничего не найдено в этом диалоге."}
        </div>
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
          const highlightClassName = isMine
            ? "rounded bg-white px-0.5 text-[#111111]"
            : "rounded bg-[#111111] px-0.5 text-white";
          const hasAttachments = message.attachments.length > 0;
          const attachmentOnlyBubble = hasAttachments && !hasText;
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
              data-message-search-match={isSearchMatch ? "true" : "false"}
              data-message-search-active={isActiveSearchMatch ? "true" : "false"}
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
                    "w-fit max-w-full shadow-sm transition-[box-shadow]",
                    shortTextOnlyBubble
                      ? "rounded-[13px] px-2.5 py-0.5"
                      : compactBubble
                        ? "rounded-[17px] px-2.5 py-1"
                        : attachmentOnlyBubble
                          ? "rounded-[20px] px-3 py-[2px]"
                        : "rounded-[22px] px-4 py-2.5",
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
                        {formatTime(message.createdAt)}
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
              disabled={recordingState !== "idle"}
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
                disabled={recordingState !== "idle"}
                placeholder="Сообщение..."
                className="h-[44px] min-h-[44px] max-h-[200px] w-full resize-none overflow-y-hidden border border-transparent bg-transparent px-1 py-[9px] leading-[26px] text-[#171717] outline-none transition placeholder:text-stone-400 disabled:cursor-not-allowed disabled:opacity-45"
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

          <div
            className={clsx(
              "self-center overflow-hidden transition-all duration-200 ease-out",
              showVoiceButton ? "w-12 opacity-100" : "pointer-events-none w-0 opacity-0",
            )}
          >
            <button
              data-testid="voice-message-button"
              type="button"
              onClick={startVoiceRecording}
              tabIndex={showVoiceButton ? 0 : -1}
              aria-label="Записать голосовое сообщение"
              title="Записать голосовое сообщение"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-[#111111] transition hover:translate-y-[-1px] hover:border-black/25 hover:bg-[#111111] hover:text-white"
            >
              <MicIcon className="h-5 w-5" />
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
