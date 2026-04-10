import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Attachment, ChatType, Prisma, User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateDirectChatDto } from "./dto/create-direct-chat.dto";
import { SendMessageDto } from "./dto/send-message.dto";

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "audio/webm",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
]);

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
  };
}>;

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

    return this.toChatListItem(chat, currentUserId);
  }

  async deleteChat(chatId: string, currentUserId: string) {
    await this.ensureMembership(chatId, currentUserId);

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

    const message = await this.prisma.$transaction(async (transaction) => {
      const createdMessage = await transaction.message.create({
        data: {
          chatId,
          senderId: currentUserId,
          body,
        },
        include: {
          sender: true,
          attachments: true,
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

  async sendAttachment(
    chatId: string,
    currentUserId: string,
    uploadedFile: UploadedAttachmentFile | undefined,
    body?: string,
  ) {
    await this.ensureMembership(chatId, currentUserId);

    if (!uploadedFile || !Buffer.isBuffer(uploadedFile.buffer) || uploadedFile.size <= 0) {
      throw new BadRequestException("Файл не был загружен.");
    }

    const trimmedBody = body?.trim() ?? "";
    const mimeType = uploadedFile.mimetype || "application/octet-stream";

    if (!ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        "Поддерживаются PNG, JPEG, WEBP, PDF, TXT и аудиофайлы WEBM/OGG/MP4/MP3.",
      );
    }

    if (uploadedFile.size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException("Размер файла не должен превышать 10 MB.");
    }

    const originalName = this.sanitizeOriginalName(uploadedFile.originalname);
    const storageKey = `${randomUUID()}${extname(originalName).slice(0, 24)}`;
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
      sender: this.toSafeUser(message.sender),
      attachments: isDeleted
        ? []
        : message.attachments.map((attachment) => this.toAttachmentPayload(attachment)),
    };
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

  private toChatListItem(chat: ChatWithMembersAndMessages, currentUserId: string) {
    const currentMembership = chat.members.find((member) => member.userId === currentUserId);
    const latestVisibleMessage = chat.messages[0] ?? null;

    const unreadCount =
      latestVisibleMessage &&
      latestVisibleMessage.id !== currentMembership?.lastReadMessageId &&
      latestVisibleMessage.senderId !== currentUserId
        ? 1
        : 0;

    return {
      id: chat.id,
      type: "direct" as const,
      updatedAt: chat.updatedAt.toISOString(),
      unreadCount,
      members: chat.members.map((member) => this.toSafeUser(member.user)),
      lastMessage: latestVisibleMessage ? this.toMessagePreview(latestVisibleMessage) : null,
    };
  }
}
