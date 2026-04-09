import type { ChatMessage, MessagePage } from "../types/api";

function isVisibleMessage(message: ChatMessage) {
  return !message.isDeleted && !message.deletedAt;
}

export function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const uniqueMessages = new Map<string, ChatMessage>();

  for (const message of messages) {
    if (!uniqueMessages.has(message.id)) {
      uniqueMessages.set(message.id, message);
    }
  }

  return Array.from(uniqueMessages.values());
}

export function normalizeMessagePage(
  page: MessagePage | undefined,
): MessagePage | undefined {
  if (!page) {
    return page;
  }

  const items = dedupeMessages(page.items).filter(isVisibleMessage);

  if (items.length === page.items.length) {
    return page;
  }

  return {
    ...page,
    items,
  };
}

export function appendMessageUnique(
  page: MessagePage | undefined,
  message: ChatMessage,
): MessagePage {
  const normalizedPage = normalizeMessagePage(page);

  if (!isVisibleMessage(message)) {
    return (
      normalizedPage ?? {
        items: [],
        nextCursor: null,
      }
    );
  }

  if (!normalizedPage) {
    return {
      items: [message],
      nextCursor: null,
    };
  }

  if (normalizedPage.items.some((item) => item.id === message.id)) {
    return normalizedPage;
  }

  return {
    ...normalizedPage,
    items: [...normalizedPage.items, message],
  };
}

export function upsertMessage(
  page: MessagePage | undefined,
  message: ChatMessage,
): MessagePage {
  const normalizedPage = normalizeMessagePage(page);

  if (!isVisibleMessage(message)) {
    if (!normalizedPage) {
      return {
        items: [],
        nextCursor: null,
      };
    }

    return {
      ...normalizedPage,
      items: normalizedPage.items.filter((item) => item.id !== message.id),
    };
  }

  if (!normalizedPage) {
    return {
      items: [message],
      nextCursor: null,
    };
  }

  const existingIndex = normalizedPage.items.findIndex((item) => item.id === message.id);

  if (existingIndex === -1) {
    return {
      ...normalizedPage,
      items: [...normalizedPage.items, message],
    };
  }

  const nextItems = [...normalizedPage.items];
  nextItems[existingIndex] = message;

  return {
    ...normalizedPage,
    items: nextItems,
  };
}
