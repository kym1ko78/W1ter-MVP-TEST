export function formatTime(isoString: string | null) {
  if (!isoString) {
    return "recently";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function formatRelativeLastSeen(isoString: string | null) {
  if (!isoString) {
    return "Недавно";
  }

  const date = new Date(isoString);
  const now = new Date();
  const diffMinutes = Math.max(1, Math.round((now.getTime() - date.getTime()) / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} мин назад`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ч назад`;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(sizeBytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function getChatTitle(
  members: Array<{ id: string; displayName: string }>,
  currentUserId: string | undefined,
) {
  const otherMember = members.find((member) => member.id !== currentUserId);
  return otherMember?.displayName ?? "Новый чат";
}

export function getLastMessagePreviewText(
  message:
    | {
        body: string | null;
        attachments?: Array<{ originalName: string }>;
      }
    | null
    | undefined,
) {
  if (!message) {
    return "Сообщений пока нет";
  }

  if (message.body?.trim()) {
    return message.body;
  }

  const firstAttachment = message.attachments?.[0];
  if (firstAttachment) {
    return `Вложение: ${firstAttachment.originalName}`;
  }

  return "Сообщений пока нет";
}