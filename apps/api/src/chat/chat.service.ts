import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ChatType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateDirectChatDto } from "./dto/create-direct-chat.dto";
import { SendMessageDto } from "./dto/send-message.dto";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async createDirectChat(currentUserId: string, dto: CreateDirectChatDto) {
    if (currentUserId === dto.targetUserId) {
      throw new ForbiddenException("You cannot create a direct chat with yourself");
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException("Target user not found");
    }

    const memberships = await this.prisma.chatMember.findMany({
      where: {
        userId: {
          in: [currentUserId, dto.targetUserId],
        },
        chat: {
          type: ChatType.DIRECT,
        },
      },
      select: {
        chatId: true,
        userId: true,
      },
    });

    const sharedChatId = this.findDirectChatId(memberships, currentUserId, dto.targetUserId);

    if (sharedChatId) {
      this.logger.log(
        `Reused direct chat ${sharedChatId} for users ${currentUserId} and ${dto.targetUserId}`,
      );
      return this.getChatById(sharedChatId, currentUserId);
    }

    const chat = await this.prisma.chat.create({
      data: {
        type: ChatType.DIRECT,
        members: {
          create: [
            { userId: currentUserId },
            { userId: dto.targetUserId },
          ],
        },
      },
    });

    this.logger.log(
      `Created direct chat ${chat.id} for users ${currentUserId} and ${dto.targetUserId}`,
    );

    return this.getChatById(chat.id, currentUserId);
  }

  async listChats(currentUserId: string) {
    const chats = await this.prisma.chat.findMany({
      where: {
        members: {
          some: {
            userId: currentUserId,
          },
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return chats.map((chat) => this.toChatListItem(chat, currentUserId));
  }

  async getChatById(chatId: string, currentUserId: string) {
    const chat = await this.prisma.chat.findFirst({
      where: {
        id: chatId,
        members: {
          some: {
            userId: currentUserId,
          },
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    return this.toChatListItem(chat, currentUserId);
  }

  async getMessages(chatId: string, currentUserId: string, cursor?: string) {
    await this.ensureMembership(chatId, currentUserId);

    const messages = await this.prisma.message.findMany({
      where: {
        chatId,
      },
      include: {
        sender: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 30,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    });

    return {
      items: messages.reverse().map((message) => ({
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        sender: {
          id: message.sender.id,
          email: message.sender.email,
          displayName: message.sender.displayName,
          avatarUrl: message.sender.avatarUrl,
          lastSeenAt: message.sender.lastSeenAt?.toISOString() ?? null,
        },
      })),
      nextCursor: messages.length === 30 ? messages[messages.length - 1]?.id ?? null : null,
    };
  }

  async sendMessage(chatId: string, currentUserId: string, dto: SendMessageDto) {
    await this.ensureMembership(chatId, currentUserId);

    const message = await this.prisma.$transaction(async (transaction) => {
      const createdMessage = await transaction.message.create({
        data: {
          chatId,
          senderId: currentUserId,
          body: dto.body.trim(),
        },
        include: {
          sender: true,
        },
      });

      await transaction.chat.update({
        where: { id: chatId },
        data: {
          lastMessageId: createdMessage.id,
          updatedAt: new Date(),
        },
      });

      return createdMessage;
    });

    const payload = {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      sender: {
        id: message.sender.id,
        email: message.sender.email,
        displayName: message.sender.displayName,
        avatarUrl: message.sender.avatarUrl,
        lastSeenAt: message.sender.lastSeenAt?.toISOString() ?? null,
      },
    };

    this.realtimeGateway.emitMessageNew(chatId, payload);
    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`Stored message ${message.id} in chat ${chatId} from user ${currentUserId}`);

    return payload;
  }

  async markRead(chatId: string, currentUserId: string, lastReadMessageId: string) {
    await this.ensureMembership(chatId, currentUserId);

    await this.prisma.chatMember.update({
      where: {
        chatId_userId: {
          chatId,
          userId: currentUserId,
        },
      },
      data: {
        lastReadMessageId,
      },
    });

    this.realtimeGateway.emitChatRead(chatId, {
      chatId,
      userId: currentUserId,
      lastReadMessageId,
    });

    this.logger.log(
      `Marked chat ${chatId} as read up to message ${lastReadMessageId} for user ${currentUserId}`,
    );

    return { success: true };
  }

  private async ensureMembership(chatId: string, currentUserId: string) {
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this chat");
    }

    return membership;
  }

  private findDirectChatId(
    memberships: Array<{ chatId: string; userId: string }>,
    currentUserId: string,
    targetUserId: string,
  ) {
    const grouped = new Map<string, Set<string>>();

    for (const membership of memberships) {
      if (!grouped.has(membership.chatId)) {
        grouped.set(membership.chatId, new Set());
      }

      grouped.get(membership.chatId)?.add(membership.userId);
    }

    for (const [chatId, users] of grouped.entries()) {
      if (users.has(currentUserId) && users.has(targetUserId) && users.size === 2) {
        return chatId;
      }
    }

    return null;
  }

  private toChatListItem(
    chat: Prisma.ChatGetPayload<{
      include: {
        members: { include: { user: true } };
        messages: true;
      };
    }>,
    currentUserId: string,
  ) {
    const currentMembership = chat.members.find(
      (member) => member.userId === currentUserId,
    );

    const unreadCount =
      chat.messages[0] &&
      chat.messages[0].id !== currentMembership?.lastReadMessageId &&
      chat.messages[0].senderId !== currentUserId
        ? 1
        : 0;

    return {
      id: chat.id,
      type: "direct" as const,
      updatedAt: chat.updatedAt.toISOString(),
      unreadCount,
      members: chat.members.map((member) => ({
        id: member.user.id,
        email: member.user.email,
        displayName: member.user.displayName,
        avatarUrl: member.user.avatarUrl,
        lastSeenAt: member.user.lastSeenAt?.toISOString() ?? null,
      })),
      lastMessage: chat.messages[0]
        ? {
            id: chat.messages[0].id,
            chatId: chat.messages[0].chatId,
            senderId: chat.messages[0].senderId,
            body: chat.messages[0].body,
            createdAt: chat.messages[0].createdAt.toISOString(),
            updatedAt: chat.messages[0].updatedAt.toISOString(),
          }
        : null,
    };
  }
}
