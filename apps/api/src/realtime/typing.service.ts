import { Injectable } from "@nestjs/common";

type TypingStatusChange = {
  chatId: string;
  userId: string;
  isTyping: boolean;
};

@Injectable()
export class TypingService {
  private readonly typingConnections = new Map<string, Map<string, Set<string>>>();

  setTyping(chatId: string, userId: string, socketId: string, isTyping: boolean) {
    const chatMap = this.ensureChat(chatId);
    const userSockets = this.ensureUserSockets(chatMap, userId);
    const wasTyping = userSockets.size > 0;

    if (isTyping) {
      userSockets.add(socketId);
    } else {
      userSockets.delete(socketId);
    }

    if (userSockets.size === 0) {
      chatMap.delete(userId);
    }

    if (chatMap.size === 0) {
      this.typingConnections.delete(chatId);
    }

    const isTypingNow = (chatMap.get(userId)?.size ?? 0) > 0;
    return {
      changed: wasTyping !== isTypingNow,
      isTyping: isTypingNow,
    };
  }

  clearSocket(socketId: string): TypingStatusChange[] {
    const changes: TypingStatusChange[] = [];

    for (const [chatId, usersMap] of this.typingConnections.entries()) {
      for (const [userId, sockets] of usersMap.entries()) {
        if (!sockets.has(socketId)) {
          continue;
        }

        const wasTyping = sockets.size > 0;
        sockets.delete(socketId);

        if (sockets.size === 0) {
          usersMap.delete(userId);
          if (wasTyping) {
            changes.push({
              chatId,
              userId,
              isTyping: false,
            });
          }
        }
      }

      if (usersMap.size === 0) {
        this.typingConnections.delete(chatId);
      }
    }

    return changes;
  }

  private ensureChat(chatId: string) {
    if (!this.typingConnections.has(chatId)) {
      this.typingConnections.set(chatId, new Map());
    }

    return this.typingConnections.get(chatId)!;
  }

  private ensureUserSockets(chatMap: Map<string, Set<string>>, userId: string) {
    if (!chatMap.has(userId)) {
      chatMap.set(userId, new Set());
    }

    return chatMap.get(userId)!;
  }
}
