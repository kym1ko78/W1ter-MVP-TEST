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

export function getChatTitle(
  members: Array<{ id: string; displayName: string }>,
  currentUserId: string | undefined,
) {
  const otherMember = members.find((member) => member.id !== currentUserId);
  return otherMember?.displayName ?? "Новый чат";
}

