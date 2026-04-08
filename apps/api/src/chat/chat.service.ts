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
        "Поддерживаются только PNG, JPEG, WEBP, PDF и TXT файлы.",
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
    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      sender: this.toSafeUser(message.sender),
      attachments: message.attachments.map((attachment) => this.toAttachmentPayload(attachment)),
    };
  }

  private toMessagePreview(
    message: Prisma.MessageGetPayload<{ include: { attachments: true } }>,
  ) {
    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      attachments: message.attachments.map((attachment) => this.toAttachmentPayload(attachment)),
    };
  }

  private toChatListItem(chat: ChatWithMembersAndMessages, currentUserId: string) {
    const currentMembership = chat.members.find((member) => member.userId === currentUserId);

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
      members: chat.members.map((member) => this.toSafeUser(member.user)),
      lastMessage: chat.messages[0] ? this.toMessagePreview(chat.messages[0]) : null,
    };
  }
}