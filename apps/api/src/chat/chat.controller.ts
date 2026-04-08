import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import type { JwtPayload } from "../common/types/jwt-payload";
import { ChatService } from "./chat.service";
import { CreateDirectChatDto } from "./dto/create-direct-chat.dto";
import { MarkReadDto } from "./dto/mark-read.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { UploadAttachmentDto } from "./dto/upload-attachment.dto";

type UploadedAttachmentFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@UseGuards(AccessTokenGuard)
@Controller("chats")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  async listChats(@CurrentUser() user: JwtPayload) {
    return this.chatService.listChats(user.sub);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-create-direct",
    limit: 15,
    windowMs: 60 * 1000,
    scope: "user",
  })
  @Post("direct")
  async createDirectChat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDirectChatDto,
  ) {
    return this.chatService.createDirectChat(user.sub, dto);
  }

  @Get(":chatId")
  async getChat(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
  ) {
    return this.chatService.getChatById(chatId, user.sub);
  }

  @Delete(":chatId")
  async deleteChat(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
  ) {
    return this.chatService.deleteChat(chatId, user.sub);
  }

  @Get(":chatId/messages")
  async getMessages(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.chatService.getMessages(chatId, user.sub, cursor);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-send-message",
    limit: 20,
    windowMs: 60 * 1000,
    scope: "user",
  })
  @Post(":chatId/messages")
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(chatId, user.sub, dto);
  }

  @Delete(":chatId/messages/:messageId")
  async deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.chatService.deleteMessage(chatId, messageId, user.sub);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-send-attachment",
    limit: 10,
    windowMs: 60 * 1000,
    scope: "user",
  })
  @Post(":chatId/attachments")
  @UseInterceptors(FileInterceptor("file"))
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @UploadedFile() file: UploadedAttachmentFile | undefined,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.chatService.sendAttachment(chatId, user.sub, file, dto.body);
  }

  @Post(":chatId/read")
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.chatService.markRead(chatId, user.sub, dto.lastReadMessageId);
  }
}