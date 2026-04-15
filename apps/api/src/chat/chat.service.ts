import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Attachment,
  ChatMemberRole,
  ChatType,
  MessageReaction,
  ModerationReportStatus,
  Prisma,
  User,
  UserChatPreference,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_MB,
  getAttachmentStorageExtension,
  getAttachmentValidationMessage,
  resolveAttachmentMimeType,
} from "./attachment-rules";
import { CreateModerationReportDto } from "./dto/create-moderation-report.dto";
import { CreateDirectChatDto } from "./dto/create-direct-chat.dto";
import { CreateGroupChatDto } from "./dto/create-group-chat.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { UpdateChatPreferencesDto } from "./dto/update-chat-preferences.dto";
const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "🔥", "😮", "😢"]);

type UploadedAttachmentFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type ChatWithMembersAndMessages = Prisma.ChatGetPayload<{
  include: {
    members: { include: { user: true } };
    messages: { include: { attachments: true } };
  };
}>;

type MessageWithRelations = Prisma.MessageGetPayload<{
  include: {
    sender: true;
    attachments: true;
    reactions: true;
    replyTo: {
      include: {
        sender: true;
      };
    };
  };
}>;

type ReplyPreviewWithSender = Prisma.MessageGetPayload<{
  include: {
    sender: true;
  };
}>;

type MembershipWithChat = Prisma.ChatMemberGetPayload<{
  include: {
    chat: true;
  };
}>;

type ChatSerializationContext = {
  preferencesByChatId: Map<string, UserChatPreference>;
  blockedByCurrentUser: Set<string>;
  blockedCurrentUser: Set<string>;
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly configService: ConfigService,
  ) {}

  async createDirectChat(currentUserId: string, dto: CreateDirectChatDto) {
    if (currentUserId === dto.targetUserId) {
      throw new ForbiddenException("You cannot create a direct chat with yourself");
    }

    await this.ensureUsersNotBlocked(currentUserId, dto.targetUserId);

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

    const sharedChatId = this.findDirectChatId(
      memberships,
      currentUserId,
      dto.targetUserId,
    );

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
          create: [{ userId: currentUserId }, { userId: dto.targetUserId }],
        },
      },
    });

    this.logger.log(
      `Created direct chat ${chat.id} for users ${currentUserId} and ${dto.targetUserId}`,
    );

    return this.getChatById(chat.id, currentUserId);
  }

  async createGroupChat(currentUserId: string, dto: CreateGroupChatDto) {
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException("Название группы не должно быть пустым.");
    }

    const memberIds = Array.from(new Set(dto.memberIds ?? []))
      .map((memberId) => memberId.trim())
      .filter((memberId) => memberId && memberId !== currentUserId);

    if (memberIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: {
          id: {
            in: memberIds,
          },
        },
        select: {
          id: true,
        },
      });

      const foundUserIds = new Set(users.map((item) => item.id));
      const missingUserId = memberIds.find((memberId) => !foundUserIds.has(memberId));

      if (missingUserId) {
        throw new NotFoundException("Один из выбранных пользователей не найден.");
      }
    }

    const chat = await this.prisma.chat.create({
      data: {
        type: ChatType.GROUP,
        title,
        members: {
          create: [
            { userId: currentUserId, role: ChatMemberRole.CREATOR },
            ...memberIds.map((memberId) => ({ userId: memberId, role: ChatMemberRole.MEMBER })),
          ],
        },
      },
    });

    this.logger.log(`Created group chat ${chat.id} by user ${currentUserId}`);

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
          where: {
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            attachments: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const context = await this.buildChatSerializationContext(currentUserId, chats);
    return chats.map((chat) => this.toChatListItem(chat, currentUserId, context));
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
          where: {
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            attachments: true,
          },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    const context = await this.buildChatSerializationContext(currentUserId, [chat]);
    return this.toChatListItem(chat, currentUserId, context);
  }

  async getGroupMembers(chatId: string, currentUserId: string) {
    const membership = await this.ensureGroupMembership(chatId, currentUserId);

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: {
          include: {
            user: true,
          },
          orderBy: {
            joinedAt: "asc",
          },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    return {
      chatId: chat.id,
      title: chat.title,
      members: chat.members.map((member) => ({
        user: this.toSafeUser(member.user),
        role: this.toChatMemberRole(member.role),
        joinedAt: member.joinedAt.toISOString(),
        isCurrentUser: member.userId === currentUserId,
      })),
      permissions: this.getGroupPermissions(membership.role),
    };
  }

  async addGroupMember(chatId: string, currentUserId: string, userId: string) {
    const membership = await this.ensureGroupMembership(chatId, currentUserId);

    if (!this.canManageGroupMembers(membership.role)) {
      throw new ForbiddenException("Только creator и admin могут добавлять участников.");
    }

    if (userId === currentUserId) {
      throw new BadRequestException("Вы уже состоите в этой группе.");
    }

    const [targetUser, existingMember] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }),
      this.prisma.chatMember.findUnique({
        where: {
          chatId_userId: {
            chatId,
            userId,
          },
        },
      }),
    ]);

    if (!targetUser) {
      throw new NotFoundException("Пользователь не найден.");
    }

    if (existingMember) {
      throw new BadRequestException("Пользователь уже в группе.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatMember.create({
        data: {
          chatId,
          userId,
          role: ChatMemberRole.MEMBER,
        },
      });

      await transaction.chat.update({
        where: { id: chatId },
        data: {
          updatedAt: new Date(),
        },
      });
    });

    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`Added user ${userId} to group chat ${chatId} by ${currentUserId}`);

    return this.getGroupMembers(chatId, currentUserId);
  }

  async removeGroupMember(chatId: string, currentUserId: string, memberId: string) {
    const membership = await this.ensureGroupMembership(chatId, currentUserId);

    if (!this.canManageGroupMembers(membership.role)) {
      throw new ForbiddenException("Только creator и admin могут удалять участников.");
    }

    if (memberId === currentUserId) {
      throw new BadRequestException("Чтобы выйти из группы, используйте отдельное действие.");
    }

    const targetMember = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId: memberId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException("Участник не найден.");
    }

    if (targetMember.role === ChatMemberRole.CREATOR) {
      throw new ForbiddenException("Нельзя удалить создателя группы.");
    }

    if (membership.role === ChatMemberRole.ADMIN && targetMember.role === ChatMemberRole.ADMIN) {
      throw new ForbiddenException("Admin не может удалять другого admin.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatMember.delete({
        where: {
          chatId_userId: {
            chatId,
            userId: memberId,
          },
        },
      });

      await transaction.chat.update({
        where: { id: chatId },
        data: {
          updatedAt: new Date(),
        },
      });
    });

    this.realtimeGateway.emitChatDeleted([memberId], { chatId });
    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`Removed user ${memberId} from group chat ${chatId} by ${currentUserId}`);

    return this.getGroupMembers(chatId, currentUserId);
  }

  async updateGroupMemberRole(
    chatId: string,
    currentUserId: string,
    memberId: string,
    role: "admin" | "member",
  ) {
    const membership = await this.ensureGroupMembership(chatId, currentUserId);

    if (membership.role !== ChatMemberRole.CREATOR) {
      throw new ForbiddenException("Только creator может управлять ролями.");
    }

    if (memberId === currentUserId) {
      throw new BadRequestException("Нельзя изменить роль создателя.");
    }

    const targetMember = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId: memberId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException("Участник не найден.");
    }

    if (targetMember.role === ChatMemberRole.CREATOR) {
      throw new ForbiddenException("Нельзя изменить роль создателя.");
    }

    const nextRole = role === "admin" ? ChatMemberRole.ADMIN : ChatMemberRole.MEMBER;

    if (targetMember.role !== nextRole) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.chatMember.update({
          where: {
            chatId_userId: {
              chatId,
              userId: memberId,
            },
          },
          data: {
            role: nextRole,
          },
        });

        await transaction.chat.update({
          where: { id: chatId },
          data: {
            updatedAt: new Date(),
          },
        });
      });

      this.realtimeGateway.emitChatUpdated(chatId);
    }

    this.logger.log(`Updated role for user ${memberId} in group chat ${chatId} by ${currentUserId}`);

    return this.getGroupMembers(chatId, currentUserId);
  }

  async leaveGroup(chatId: string, currentUserId: string) {
    const membership = await this.ensureGroupMembership(chatId, currentUserId);

    if (membership.role === ChatMemberRole.CREATOR) {
      throw new ForbiddenException("Создатель не может выйти из группы. Удалите группу или передайте роль.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatMember.delete({
        where: {
          chatId_userId: {
            chatId,
            userId: currentUserId,
          },
        },
      });

      await transaction.chat.update({
        where: { id: chatId },
        data: {
          updatedAt: new Date(),
        },
      });
    });

    this.realtimeGateway.emitChatDeleted([currentUserId], { chatId });
    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`User ${currentUserId} left group chat ${chatId}`);

    return {
      success: true,
      chatId,
    };
  }

  async deleteChat(chatId: string, currentUserId: string) {
    const membership = await this.ensureMembership(chatId, currentUserId);

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: true,
        messages: {
          include: {
            attachments: true,
          },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    if (chat.type === ChatType.GROUP && membership.role !== ChatMemberRole.CREATOR) {
      throw new ForbiddenException("Только creator может удалить группу.");
    }

    const attachmentStorageKeys = chat.messages.flatMap((message) =>
      message.attachments.map((attachment) => attachment.storageKey),
    );
    const memberIds = chat.members.map((member) => member.userId);

    await this.prisma.chat.delete({
      where: { id: chatId },
    });

    await this.cleanupStoredFiles(attachmentStorageKeys);

    this.realtimeGateway.emitChatDeleted(memberIds, { chatId });
    this.logger.log(`Deleted chat ${chatId} by user ${currentUserId}`);

    return {
      success: true,
      chatId,
    };
  }

  async getMessages(chatId: string, currentUserId: string, cursor?: string) {
    await this.ensureMembership(chatId, currentUserId);

    const messages = await this.prisma.message.findMany({
      where: {
        chatId,
      },
      include: {
        sender: true,
        attachments: true,
        reactions: true,
        replyTo: {
          include: {
            sender: true,
          },
        },
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
      items: messages.reverse().map((message) => this.toMessagePayload(message)),
      nextCursor: messages.length === 30 ? messages[messages.length - 1]?.id ?? null : null,
    };
  }

  async sendMessage(chatId: string, currentUserId: string, dto: SendMessageDto) {
    await this.ensureMembership(chatId, currentUserId);

    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException("Сообщение не должно быть пустым.");
    }
    await this.enforceMessagingSecurityRules(chatId, currentUserId, body);
    const replyToMessage = await this.resolveReplyTarget(chatId, dto.replyToMessageId);

    const message = await this.prisma.$transaction(async (transaction) => {
      const createdMessage = await transaction.message.create({
        data: {
          chatId,
          senderId: currentUserId,
          body,
          replyToMessageId: replyToMessage?.id ?? null,
        },
        include: {
          sender: true,
          attachments: true,
          reactions: true,
          replyTo: {
            include: {
              sender: true,
            },
          },
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

    const payload = this.toMessagePayload(message);

    this.realtimeGateway.emitMessageNew(chatId, payload);
    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`Stored message ${message.id} in chat ${chatId} from user ${currentUserId}`);

    return payload;
  }

  async editMessage(chatId: string, messageId: string, currentUserId: string, nextBody: string) {
    await this.ensureMembership(chatId, currentUserId);

    const body = nextBody.trim();
    if (!body) {
      throw new BadRequestException("Сообщение не должно быть пустым.");
    }

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        chatId,
      },
      include: {
        sender: true,
        attachments: true,
        reactions: true,
        replyTo: {
          include: {
            sender: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    if (message.senderId !== currentUserId) {
      throw new ForbiddenException("Вы можете редактировать только свои сообщения.");
    }

    if (message.deletedAt) {
      throw new BadRequestException("Удаленное сообщение нельзя редактировать.");
    }

    if (message.body?.trim() === body) {
      return this.toMessagePayload(message);
    }

    const updatedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        body,
        updatedAt: new Date(),
      },
      include: {
        sender: true,
        attachments: true,
        reactions: true,
        replyTo: {
          include: {
            sender: true,
          },
        },
      },
    });

    const payload = this.toMessagePayload(updatedMessage);

    this.realtimeGateway.emitMessageUpdated(chatId, payload);
    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`Edited message ${messageId} in chat ${chatId} by user ${currentUserId}`);

    return payload;
  }

  async deleteMessage(chatId: string, messageId: string, currentUserId: string) {
    await this.ensureMembership(chatId, currentUserId);

    const [message, chat] = await Promise.all([
      this.prisma.message.findFirst({
        where: {
          id: messageId,
          chatId,
        },
        include: {
          sender: true,
          attachments: true,
          reactions: true,
          replyTo: {
            include: {
              sender: true,
            },
          },
        },
      }),
      this.prisma.chat.findUnique({
        where: { id: chatId },
        select: { lastMessageId: true },
      }),
    ]);

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    if (message.senderId !== currentUserId) {
      throw new ForbiddenException("Вы можете удалить только свое сообщение.");
    }

    if (message.deletedAt) {
      return this.toMessagePayload(message);
    }

    const attachmentStorageKeys = message.attachments.map((attachment) => attachment.storageKey);
    const shouldRefreshLastMessage = chat?.lastMessageId === message.id;

    const deletedMessage = await this.prisma.$transaction(async (transaction) => {
      await transaction.attachment.deleteMany({
        where: {
          messageId: message.id,
        },
      });

      const updatedMessage = await transaction.message.update({
        where: { id: message.id },
        data: {
          body: null,
          deletedAt: new Date(),
        },
        include: {
          sender: true,
          attachments: true,
          reactions: true,
          replyTo: {
            include: {
              sender: true,
            },
          },
        },
      });

      await transaction.messageReaction.deleteMany({
        where: {
          messageId: message.id,
        },
      });

      if (shouldRefreshLastMessage) {
        await this.refreshChatLastMessageReference(transaction, chatId);
      }

      return updatedMessage;
    });

    await this.cleanupStoredFiles(attachmentStorageKeys);

    const payload = this.toMessagePayload(deletedMessage);

    this.realtimeGateway.emitMessageUpdated(chatId, payload);
    this.realtimeGateway.emitChatUpdated(chatId);
    this.logger.log(`Deleted message ${message.id} in chat ${chatId} by user ${currentUserId}`);

    return payload;
  }

  async forwardMessage(
    chatId: string,
    messageId: string,
    targetChatId: string,
    currentUserId: string,
  ) {
    await this.ensureMembership(chatId, currentUserId);
    await this.ensureMembership(targetChatId, currentUserId);

    const sourceMessage = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        chatId,
      },
      include: {
        sender: true,
        attachments: true,
        reactions: true,
        replyTo: {
          include: {
            sender: true,
          },
        },
      },
    });

    if (!sourceMessage) {
      throw new NotFoundException("Сообщение для пересылки не найдено.");
    }

    if (sourceMessage.deletedAt) {
      throw new BadRequestException("Удаленное сообщение нельзя переслать.");
    }

    const normalizedBody = sourceMessage.body?.trim() ?? "";

    if (!normalizedBody && sourceMessage.attachments.length === 0) {
      throw new BadRequestException("В этом сообщении нечего пересылать.");
    }

    const uploadsDir = this.getUploadsDirectory();
    await mkdir(uploadsDir, { recursive: true });

    const copiedAttachments = sourceMessage.attachments.map((attachment) => {
      const sourceAbsolutePath = join(uploadsDir, attachment.storageKey);

      if (!existsSync(sourceAbsolutePath)) {
        throw new NotFoundException("Один из файлов вложения недоступен для пересылки.");
      }

      const safeOriginalName = this.sanitizeOriginalName(attachment.originalName);
      const storageKey = `${randomUUID()}${extname(safeOriginalName).slice(0, 24)}`;
      const targetAbsolutePath = join(uploadsDir, storageKey);

      return {
        sourceAbsolutePath,
        targetAbsolutePath,
        storageKey,
        originalName: safeOriginalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
    });

    await Promise.all(
      copiedAttachments.map((attachment) =>
        copyFile(attachment.sourceAbsolutePath, attachment.targetAbsolutePath),
      ),
    );

    try {
      const forwardedMessage = await this.prisma.$transaction(async (transaction) => {
        const createdMessage = await transaction.message.create({
          data: {
            chatId: targetChatId,
            senderId: currentUserId,
            body: normalizedBody || null,
            attachments:
              copiedAttachments.length > 0
                ? {
                    create: copiedAttachments.map((attachment) => ({
                      uploaderId: currentUserId,
                      storageKey: attachment.storageKey,
                      originalName: attachment.originalName,
                      mimeType: attachment.mimeType,
                      sizeBytes: attachment.sizeBytes,
                    })),
                  }
                : undefined,
          },
          include: {
            sender: true,
            attachments: true,
            reactions: true,
            replyTo: {
              include: {
                sender: true,
              },
            },
          },
        });

        await transaction.chat.update({
          where: { id: targetChatId },
          data: {
            lastMessageId: createdMessage.id,
            updatedAt: new Date(),
          },
        });

        return createdMessage;
      });

      const payload = this.toMessagePayload(forwardedMessage);

      this.realtimeGateway.emitMessageNew(targetChatId, payload);
      this.realtimeGateway.emitChatUpdated(targetChatId);
      this.logger.log(
        `Forwarded message ${messageId} from chat ${chatId} to chat ${targetChatId} by user ${currentUserId}`,
      );

      return payload;
    } catch (error) {
      await this.cleanupStoredFiles(copiedAttachments.map((attachment) => attachment.storageKey));
      throw error;
    }
  }

  async toggleMessageReaction(
    chatId: string,
    messageId: string,
    currentUserId: string,
    emoji: string,
  ) {
    await this.ensureMembership(chatId, currentUserId);

    const normalizedEmoji = emoji.trim();

    if (!REACTION_EMOJIS.has(normalizedEmoji)) {
      throw new BadRequestException("Выберите реакцию из доступного списка.");
    }

    const targetMessage = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        chatId,
      },
      select: {
        id: true,
        deletedAt: true,
      },
    });

    if (!targetMessage) {
      throw new NotFoundException("Message not found");
    }

    if (targetMessage.deletedAt) {
      throw new BadRequestException("Нельзя поставить реакцию на удаленное сообщение.");
    }

    const updatedMessage = await this.prisma.$transaction(async (transaction) => {
      const existingReaction = await transaction.messageReaction.findUnique({
        where: {
          messageId_userId: {
            messageId,
            userId: currentUserId,
          },
        },
      });

      if (!existingReaction) {
        await transaction.messageReaction.create({
          data: {
            messageId,
            userId: currentUserId,
            emoji: normalizedEmoji,
          },
        });
      } else if (existingReaction.emoji === normalizedEmoji) {
        await transaction.messageReaction.delete({
          where: {
            messageId_userId: {
              messageId,
              userId: currentUserId,
            },
          },
        });
      } else {
        await transaction.messageReaction.update({
          where: {
            messageId_userId: {
              messageId,
              userId: currentUserId,
            },
          },
          data: {
            emoji: normalizedEmoji,
          },
        });
      }

      return transaction.message.findFirst({
        where: {
          id: messageId,
          chatId,
        },
        include: {
          sender: true,
          attachments: true,
          reactions: true,
          replyTo: {
            include: {
              sender: true,
            },
          },
        },
      });
    });

    if (!updatedMessage) {
      throw new NotFoundException("Message not found");
    }

    const payload = this.toMessagePayload(updatedMessage);

    this.realtimeGateway.emitMessageUpdated(chatId, payload);
    this.logger.log(
      `Toggled reaction ${normalizedEmoji} for message ${messageId} in chat ${chatId} by user ${currentUserId}`,
    );

    return payload;
  }

  async sendAttachment(
    chatId: string,
    currentUserId: string,
    uploadedFile: UploadedAttachmentFile | undefined,
    body?: string,
    replyToMessageId?: string,
  ) {
    await this.ensureMembership(chatId, currentUserId);
    await this.enforceMessagingSecurityRules(chatId, currentUserId, body?.trim() ?? "<attachment>");

    if (!uploadedFile || !Buffer.isBuffer(uploadedFile.buffer) || uploadedFile.size <= 0) {
      throw new BadRequestException("Файл не был загружен.");
    }

    const trimmedBody = body?.trim() ?? "";
    const replyToMessage = await this.resolveReplyTarget(chatId, replyToMessageId);
    const mimeType = resolveAttachmentMimeType(uploadedFile.mimetype, uploadedFile.originalname);

    if (!mimeType) {
      throw new BadRequestException(
        getAttachmentValidationMessage(),
      );
    }

    if (uploadedFile.size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(`Размер файла не должен превышать ${ATTACHMENT_MAX_MB} MB.`);
    }

    const originalName = this.sanitizeOriginalName(uploadedFile.originalname);
    const sourceExtension = extname(originalName).slice(0, 24);
    const extension = sourceExtension || getAttachmentStorageExtension(mimeType);
    const storageKey = `${randomUUID()}${extension}`;
    const uploadsDir = this.getUploadsDirectory();
    const absolutePath = join(uploadsDir, storageKey);

    await mkdir(uploadsDir, { recursive: true });
    await writeFile(absolutePath, uploadedFile.buffer);

    try {
      const message = await this.prisma.$transaction(async (transaction) => {
        const createdMessage = await transaction.message.create({
          data: {
            chatId,
            senderId: currentUserId,
            body: trimmedBody || null,
            replyToMessageId: replyToMessage?.id ?? null,
            attachments: {
              create: {
                uploaderId: currentUserId,
                storageKey,
                originalName,
                mimeType,
                sizeBytes: uploadedFile.size,
              },
            },
          },
          include: {
            sender: true,
            attachments: true,
            reactions: true,
            replyTo: {
              include: {
                sender: true,
              },
            },
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

      const payload = this.toMessagePayload(message);

      this.realtimeGateway.emitMessageNew(chatId, payload);
      this.realtimeGateway.emitChatUpdated(chatId);
      this.logger.log(
        `Stored attachment message ${message.id} in chat ${chatId} from user ${currentUserId}`,
      );

      return payload;
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async getAttachmentDownload(attachmentId: string, currentUserId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        message: {
          chat: {
            members: {
              some: {
                userId: currentUserId,
              },
            },
          },
        },
      },
    });

    if (!attachment) {
      throw new NotFoundException("Вложение не найдено.");
    }

    const absolutePath = join(this.getUploadsDirectory(), attachment.storageKey);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException("Файл вложения недоступен.");
    }

    return { attachment, absolutePath };
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

  async updateChatPreferences(
    chatId: string,
    currentUserId: string,
    dto: UpdateChatPreferencesDto,
  ) {
    await this.ensureMembership(chatId, currentUserId);

    const hasMutedChange = typeof dto.isMuted === "boolean" || dto.mutedUntil !== undefined;
    const hasArchivedChange = typeof dto.isArchived === "boolean";

    if (!hasMutedChange && !hasArchivedChange) {
      throw new BadRequestException("Укажите хотя бы одно поле для обновления настроек.");
    }

    const existingPreference = await this.prisma.userChatPreference.findUnique({
      where: {
        userId_chatId: {
          userId: currentUserId,
          chatId,
        },
      },
    });

    const now = new Date();
    const isMuted = dto.isMuted ?? existingPreference?.isMuted ?? false;
    const mutedUntilDate = this.resolveMutedUntil(dto.mutedUntil, isMuted);
    const isArchived = dto.isArchived ?? existingPreference?.isArchived ?? false;
    const archivedAt =
      isArchived && !existingPreference?.isArchived
        ? now
        : isArchived
          ? existingPreference?.archivedAt ?? now
          : null;

    const preference = await this.prisma.userChatPreference.upsert({
      where: {
        userId_chatId: {
          userId: currentUserId,
          chatId,
        },
      },
      create: {
        userId: currentUserId,
        chatId,
        isMuted,
        mutedUntil: isMuted ? mutedUntilDate : null,
        isArchived,
        archivedAt,
      },
      update: {
        isMuted,
        mutedUntil: isMuted ? mutedUntilDate : null,
        isArchived,
        archivedAt,
      },
    });

    return this.toChatPreferencePayload(preference);
  }

  async createModerationReport(
    chatId: string,
    currentUserId: string,
    dto: CreateModerationReportDto,
  ) {
    await this.ensureMembership(chatId, currentUserId);

    const normalizedReason = dto.reason.trim();
    if (normalizedReason.length < 3) {
      throw new BadRequestException("Причина жалобы слишком короткая.");
    }

    const normalizedDetails = dto.details?.trim() || null;
    const messageId = dto.messageId?.trim() || null;
    let targetUserId = dto.targetUserId?.trim() || null;

    if (messageId) {
      const message = await this.prisma.message.findFirst({
        where: {
          id: messageId,
          chatId,
        },
        select: {
          id: true,
          senderId: true,
        },
      });

      if (!message) {
        throw new NotFoundException("Сообщение для жалобы не найдено.");
      }

      if (!targetUserId) {
        targetUserId = message.senderId;
      }
    }

    if (!targetUserId) {
      const chat = await this.prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          members: {
            select: {
              userId: true,
            },
          },
        },
      });

      if (!chat) {
        throw new NotFoundException("Chat not found");
      }

      if (chat.type === ChatType.DIRECT) {
        targetUserId =
          chat.members.find((member) => member.userId !== currentUserId)?.userId ?? null;
      }
    }

    if (targetUserId) {
      if (targetUserId === currentUserId) {
        throw new BadRequestException("Нельзя отправить жалобу на себя.");
      }

      const targetMembership = await this.prisma.chatMember.findUnique({
        where: {
          chatId_userId: {
            chatId,
            userId: targetUserId,
          },
        },
      });

      if (!targetMembership) {
        throw new BadRequestException("Жалоба может быть отправлена только на участника этого чата.");
      }
    }

    const report = await this.prisma.moderationReport.create({
      data: {
        reporterId: currentUserId,
        reportedUserId: targetUserId,
        chatId,
        messageId,
        reason: normalizedReason,
        details: normalizedDetails,
      },
    });

    this.logger.warn(
      `Moderation report ${report.id} created by ${currentUserId} in chat ${chatId} (target=${targetUserId ?? "none"})`,
    );

    return {
      id: report.id,
      status: report.status.toLowerCase(),
      reason: report.reason,
      details: report.details,
      createdAt: report.createdAt.toISOString(),
      chatId,
      messageId,
      targetUserId,
    };
  }

  private async enforceMessagingSecurityRules(
    chatId: string,
    currentUserId: string,
    contentFingerprint: string,
  ) {
    await this.ensureDirectMessagingAllowed(chatId, currentUserId);
    await this.ensureUserIsNotTemporarilyRestricted(currentUserId);
    await this.ensureNoSpamFlood(chatId, currentUserId, contentFingerprint);
  }

  private async ensureDirectMessagingAllowed(chatId: string, currentUserId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: {
        id: chatId,
      },
      include: {
        members: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!chat || chat.type !== ChatType.DIRECT) {
      return;
    }

    const partnerId = chat.members.find((member) => member.userId !== currentUserId)?.userId;
    if (!partnerId) {
      return;
    }

    await this.ensureUsersNotBlocked(currentUserId, partnerId);
  }

  private async ensureNoSpamFlood(chatId: string, currentUserId: string, contentFingerprint: string) {
    const now = Date.now();
    const recentWindowStart = new Date(now - 20 * 1000);
    const duplicateWindowStart = new Date(now - 45 * 1000);
    const normalizedContent = contentFingerprint.trim().toLocaleLowerCase();

    const [recentMessages, duplicateMessages] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          chatId,
          senderId: currentUserId,
          deletedAt: null,
          createdAt: {
            gte: recentWindowStart,
          },
        },
        select: {
          id: true,
        },
      }),
      normalizedContent
        ? this.prisma.message.findMany({
            where: {
              chatId,
              senderId: currentUserId,
              deletedAt: null,
              createdAt: {
                gte: duplicateWindowStart,
              },
            },
            select: {
              body: true,
            },
            take: 8,
            orderBy: {
              createdAt: "desc",
            },
          })
        : Promise.resolve([] as Array<{ body: string | null }>),
    ]);

    if (recentMessages.length >= 8) {
      this.logger.warn(
        `Spam guard: too many messages from user ${currentUserId} in chat ${chatId}`,
      );
      throw new ForbiddenException("Слишком много сообщений за короткое время. Попробуйте чуть позже.");
    }

    if (normalizedContent) {
      const duplicates = duplicateMessages.filter(
        (message) => (message.body ?? "").trim().toLocaleLowerCase() === normalizedContent,
      );

      if (duplicates.length >= 3) {
        this.logger.warn(
          `Spam guard: duplicate content from user ${currentUserId} in chat ${chatId}`,
        );
        throw new ForbiddenException("Похожие сообщения отправляются слишком часто.");
      }
    }
  }

  private async ensureUserIsNotTemporarilyRestricted(currentUserId: string) {
    const reportsCount = await this.prisma.moderationReport.count({
      where: {
        reportedUserId: currentUserId,
        status: ModerationReportStatus.OPEN,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (reportsCount >= 6) {
      throw new ForbiddenException(
        "Отправка сообщений временно ограничена из-за подозрительной активности.",
      );
    }
  }

  private async ensureUsersNotBlocked(currentUserId: string, targetUserId: string) {
    const relation = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          {
            blockerId: currentUserId,
            blockedId: targetUserId,
          },
          {
            blockerId: targetUserId,
            blockedId: currentUserId,
          },
        ],
      },
      select: {
        blockerId: true,
      },
    });

    if (!relation) {
      return;
    }

    if (relation.blockerId === currentUserId) {
      throw new ForbiddenException("Сначала разблокируйте пользователя, чтобы продолжить общение.");
    }

    throw new ForbiddenException("Этот пользователь ограничил контакт с вами.");
  }

  private resolveMutedUntil(mutedUntil: string | null | undefined, isMuted: boolean) {
    if (!isMuted) {
      return null;
    }

    if (mutedUntil === null || mutedUntil === undefined || mutedUntil === "") {
      return null;
    }

    const parsedDate = new Date(mutedUntil);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException("Неверное значение mutedUntil.");
    }

    if (parsedDate <= new Date()) {
      throw new BadRequestException("Дата mutedUntil должна быть в будущем.");
    }

    return parsedDate;
  }

  private toChatPreferencePayload(preference: UserChatPreference) {
    return {
      chatId: preference.chatId,
      isMuted: preference.isMuted,
      mutedUntil: preference.mutedUntil?.toISOString() ?? null,
      isArchived: preference.isArchived,
      archivedAt: preference.archivedAt?.toISOString() ?? null,
      updatedAt: preference.updatedAt.toISOString(),
    };
  }

  private async buildChatSerializationContext(
    currentUserId: string,
    chats: ChatWithMembersAndMessages[],
  ): Promise<ChatSerializationContext> {
    const chatIds = chats.map((chat) => chat.id);
    const directPartnerIds = chats
      .filter((chat) => chat.type === ChatType.DIRECT)
      .map((chat) => chat.members.find((member) => member.userId !== currentUserId)?.userId ?? null)
      .filter((userId): userId is string => Boolean(userId));

    const [preferences, blockedByCurrentUser, blockedCurrentUser] = await Promise.all([
      chatIds.length
        ? this.prisma.userChatPreference.findMany({
            where: {
              userId: currentUserId,
              chatId: {
                in: chatIds,
              },
            },
          })
        : Promise.resolve([] as UserChatPreference[]),
      directPartnerIds.length
        ? this.prisma.userBlock.findMany({
            where: {
              blockerId: currentUserId,
              blockedId: {
                in: directPartnerIds,
              },
            },
            select: {
              blockedId: true,
            },
          })
        : Promise.resolve([] as Array<{ blockedId: string }>),
      directPartnerIds.length
        ? this.prisma.userBlock.findMany({
            where: {
              blockerId: {
                in: directPartnerIds,
              },
              blockedId: currentUserId,
            },
            select: {
              blockerId: true,
            },
          })
        : Promise.resolve([] as Array<{ blockerId: string }>),
    ]);

    return {
      preferencesByChatId: new Map(
        preferences.map((preference) => [preference.chatId, preference]),
      ),
      blockedByCurrentUser: new Set(
        blockedByCurrentUser.map((item) => item.blockedId),
      ),
      blockedCurrentUser: new Set(
        blockedCurrentUser.map((item) => item.blockerId),
      ),
    };
  }

  private async resolveReplyTarget(chatId: string, replyToMessageId?: string) {
    const normalizedReplyToMessageId = replyToMessageId?.trim();

    if (!normalizedReplyToMessageId) {
      return null;
    }

    const replyToMessage = await this.prisma.message.findFirst({
      where: {
        id: normalizedReplyToMessageId,
        chatId,
      },
      include: {
        sender: true,
      },
    });

    if (!replyToMessage) {
      throw new NotFoundException("Исходное сообщение для ответа не найдено.");
    }

    return replyToMessage satisfies ReplyPreviewWithSender;
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

  private async ensureGroupMembership(chatId: string, currentUserId: string) {
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId: currentUserId,
        },
      },
      include: {
        chat: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this chat");
    }

    if (membership.chat.type !== ChatType.GROUP) {
      throw new BadRequestException("Управление участниками доступно только для групп.");
    }

    return membership satisfies MembershipWithChat;
  }

  private canManageGroupMembers(role: ChatMemberRole) {
    return role === ChatMemberRole.CREATOR || role === ChatMemberRole.ADMIN;
  }

  private getGroupPermissions(role: ChatMemberRole) {
    const isCreator = role === ChatMemberRole.CREATOR;
    const isAdmin = isCreator || role === ChatMemberRole.ADMIN;

    return {
      isCreator,
      isAdmin,
      canAddMembers: isAdmin,
      canRemoveMembers: isAdmin,
      canManageRoles: isCreator,
      canLeaveGroup: !isCreator,
    };
  }

  private async refreshChatLastMessageReference(
    transaction: Prisma.TransactionClient,
    chatId: string,
  ) {
    const lastVisibleMessage = await transaction.message.findFirst({
      where: {
        chatId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    await transaction.chat.update({
      where: { id: chatId },
      data: {
        lastMessageId: lastVisibleMessage?.id ?? null,
      },
    });
  }

  private async cleanupStoredFiles(storageKeys: string[]) {
    await Promise.all(
      storageKeys.map((storageKey) =>
        unlink(join(this.getUploadsDirectory(), storageKey)).catch(() => undefined),
      ),
    );
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

  private getUploadsDirectory() {
    return this.configService.get<string>("UPLOADS_DIR") || join(process.cwd(), "uploads");
  }

  private sanitizeOriginalName(originalName: string) {
    const normalized = basename(originalName || "attachment").replace(/[\r\n]/g, "_");
    return normalized || "attachment";
  }

  private toSafeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    };
  }

  private toAttachmentPayload(attachment: Attachment) {
    return {
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      isImage: attachment.mimeType.startsWith("image/"),
      downloadPath: `/attachments/${attachment.id}`,
    };
  }

  private toChatMemberRole(role: ChatMemberRole) {
    return role.toLowerCase() as "creator" | "admin" | "member";
  }

  private toReplyPreview(message: ReplyPreviewWithSender | null) {
    if (!message) {
      return null;
    }

    const isDeleted = Boolean(message.deletedAt);

    return {
      id: message.id,
      senderId: message.senderId,
      sender: this.toSafeUser(message.sender),
      body: isDeleted ? null : message.body,
      isDeleted,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
  }

  private toMessagePayload(message: MessageWithRelations) {
    const isDeleted = Boolean(message.deletedAt);

    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      body: isDeleted ? null : message.body,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      deletedAt: message.deletedAt?.toISOString() ?? null,
      isDeleted,
      replyTo: this.toReplyPreview(message.replyTo),
      sender: this.toSafeUser(message.sender),
      attachments: isDeleted
        ? []
        : message.attachments.map((attachment) => this.toAttachmentPayload(attachment)),
      reactions: isDeleted ? [] : this.toMessageReactionsPayload(message.reactions),
    };
  }

  private toMessageReactionsPayload(reactions: MessageReaction[]) {
    if (reactions.length === 0) {
      return [];
    }

    const grouped = new Map<string, { emoji: string; count: number; userIds: string[] }>();
    const sortedReactions = [...reactions].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );

    for (const reaction of sortedReactions) {
      const existing = grouped.get(reaction.emoji);

      if (existing) {
        existing.count += 1;
        existing.userIds.push(reaction.userId);
        continue;
      }

      grouped.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        userIds: [reaction.userId],
      });
    }

    return Array.from(grouped.values()).sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.emoji.localeCompare(right.emoji, "ru");
    });
  }

  private toMessagePreview(
    message: Prisma.MessageGetPayload<{ include: { attachments: true } }>,
  ) {
    const isDeleted = Boolean(message.deletedAt);

    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      body: isDeleted ? null : message.body,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      deletedAt: message.deletedAt?.toISOString() ?? null,
      isDeleted,
      attachments: isDeleted
        ? []
        : message.attachments.map((attachment) => this.toAttachmentPayload(attachment)),
    };
  }

  private toChatListItem(
    chat: ChatWithMembersAndMessages,
    currentUserId: string,
    context: ChatSerializationContext,
  ) {
    const currentMembership = chat.members.find((member) => member.userId === currentUserId);
    const latestVisibleMessage = chat.messages[0] ?? null;
    const preference = context.preferencesByChatId.get(chat.id);
    const isMuted = Boolean(
      preference?.isMuted &&
        (!preference.mutedUntil || preference.mutedUntil > new Date()),
    );
    const isArchived = Boolean(preference?.isArchived);
    const directPartnerId =
      chat.type === ChatType.DIRECT
        ? chat.members.find((member) => member.userId !== currentUserId)?.userId ?? null
        : null;
    const blockedByCurrentUser = Boolean(
      directPartnerId && context.blockedByCurrentUser.has(directPartnerId),
    );
    const hasBlockedCurrentUser = Boolean(
      directPartnerId && context.blockedCurrentUser.has(directPartnerId),
    );

    const unreadCount =
      latestVisibleMessage &&
      latestVisibleMessage.id !== currentMembership?.lastReadMessageId &&
      latestVisibleMessage.senderId !== currentUserId
        ? 1
        : 0;

    return {
      id: chat.id,
      type: chat.type === ChatType.GROUP ? ("group" as const) : ("direct" as const),
      title: chat.type === ChatType.GROUP ? chat.title : null,
      updatedAt: chat.updatedAt.toISOString(),
      unreadCount,
      currentUserRole: this.toChatMemberRole((currentMembership?.role ?? "MEMBER") as ChatMemberRole),
      isMuted,
      mutedUntil: preference?.mutedUntil?.toISOString() ?? null,
      isArchived,
      archivedAt: preference?.archivedAt?.toISOString() ?? null,
      directStatus:
        chat.type === ChatType.DIRECT
          ? {
              blockedByCurrentUser,
              hasBlockedCurrentUser,
            }
          : null,
      members: chat.members.map((member) => this.toSafeUser(member.user)),
      lastMessage: latestVisibleMessage ? this.toMessagePreview(latestVisibleMessage) : null,
    };
  }
}
