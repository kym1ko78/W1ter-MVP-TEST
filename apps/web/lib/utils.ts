function getLocalDateParts(date: Date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function formatTime(isoString: string | null) {
  if (!isoString) {
    return "recently";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function getConversationDayKey(isoString: string | null) {
  if (!isoString) {
    return "unknown-day";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "unknown-day";
  }

  const { year, month, day } = getLocalDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatConversationDateLabel(isoString: string | null) {
  if (!isoString) {
    return "";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat(
    "ru-RU",
    isCurrentYear
      ? {
          day: "numeric",
          month: "long",
        }
      : {
          day: "numeric",
          month: "long",
          year: "numeric",
        },
  ).format(date);
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
        deletedAt?: string | null;
        isDeleted?: boolean;
        attachments?: Array<{ originalName: string; mimeType?: string | null }>;
      }
    | null
    | undefined,
) {
  if (!message) {
    return "Сообщений пока нет";
  }

  if (message.isDeleted || message.deletedAt) {
    return "Сообщение удалено";
  }

  if (message.body?.trim()) {
    return message.body;
  }

  const firstAttachment = message.attachments?.[0];
  if (firstAttachment) {
    if (firstAttachment.mimeType?.startsWith("audio/")) {
      return "Голосовое сообщение";
    }

    return `Вложение: ${firstAttachment.originalName}`;
  }

  return "Сообщений пока нет";
}

export function getInitials(value: string) {
  return (
    value
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "W"
  );
}
