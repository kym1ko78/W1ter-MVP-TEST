import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseFilters,
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
import { AddChatMemberDto } from "./dto/add-chat-member.dto";
import { CreateDirectChatDto } from "./dto/create-direct-chat.dto";
import { CreateGroupChatDto } from "./dto/create-group-chat.dto";
import { ForwardMessageDto } from "./dto/forward-message.dto";
import { MarkReadDto } from "./dto/mark-read.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { ToggleMessageReactionDto } from "./dto/toggle-message-reaction.dto";
import { UpdateChatPreferencesDto } from "./dto/update-chat-preferences.dto";
import { UpdateChatMemberRoleDto } from "./dto/update-chat-member-role.dto";
import { UpdateMessageDto } from "./dto/update-message.dto";
import { UploadAttachmentDto } from "./dto/upload-attachment.dto";
import { CreateModerationReportDto } from "./dto/create-moderation-report.dto";
import { ATTACHMENT_MAX_BYTES } from "./attachment-rules";
import { MulterExceptionFilter } from "./multer-exception.filter";

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

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-create-group",
    limit: 10,
    windowMs: 60 * 1000,
    scope: "user",
  })
  @Post("group")
  async createGroupChat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateGroupChatDto,
  ) {
    return this.chatService.createGroupChat(user.sub, dto);
  }

  @Get(":chatId")
  async getChat(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
  ) {
    return this.chatService.getChatById(chatId, user.sub);
  }

  @Get(":chatId/members")
  async getGroupMembers(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
  ) {
    return this.chatService.getGroupMembers(chatId, user.sub);
  }

  @Post(":chatId/members")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-members-add",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  async addGroupMember(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: AddChatMemberDto,
  ) {
    return this.chatService.addGroupMember(chatId, user.sub, dto.userId);
  }

  @Delete(":chatId/members/:memberId")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-members-remove",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  async removeGroupMember(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.chatService.removeGroupMember(chatId, user.sub, memberId);
  }

  @Patch(":chatId/members/:memberId/role")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-members-role",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  async updateGroupMemberRole(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateChatMemberRoleDto,
  ) {
    return this.chatService.updateGroupMemberRole(chatId, user.sub, memberId, dto.role);
  }

  @Post(":chatId/leave")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-leave-group",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  async leaveGroup(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
  ) {
    return this.chatService.leaveGroup(chatId, user.sub);
  }

  @Delete(":chatId")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-delete",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
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

  @Patch(":chatId/messages/:messageId")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-edit-message",
    limit: 30,
    windowMs: 60 * 1000,
    scope: "user",
  })
  async editMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.chatService.editMessage(chatId, messageId, user.sub, dto.body);
  }

  @Post(":chatId/messages/:messageId/forward")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-forward-message",
    limit: 15,
    windowMs: 60 * 1000,
    scope: "user",
  })
  async forwardMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.chatService.forwardMessage(chatId, messageId, dto.targetChatId, user.sub);
  }

  @Put(":chatId/messages/:messageId/reaction")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-reaction",
    limit: 60,
    windowMs: 60 * 1000,
    scope: "user",
  })
  async toggleMessageReaction(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: ToggleMessageReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(chatId, messageId, user.sub, dto.emoji);
  }

  @Delete(":chatId/messages/:messageId")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-delete-message",
    limit: 30,
    windowMs: 60 * 1000,
    scope: "user",
  })
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
  @UseFilters(new MulterExceptionFilter())
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: ATTACHMENT_MAX_BYTES,
      },
    }),
  )
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @UploadedFile() file: UploadedAttachmentFile | undefined,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.chatService.sendAttachment(chatId, user.sub, file, dto.body, dto.replyToMessageId);
  }

  @Post(":chatId/read")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-read",
    limit: 120,
    windowMs: 60 * 1000,
    scope: "user",
  })
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.chatService.markRead(chatId, user.sub, dto.lastReadMessageId);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-update-preferences",
    limit: 60,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  @Patch(":chatId/preferences")
  async updateChatPreferences(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: UpdateChatPreferencesDto,
  ) {
    return this.chatService.updateChatPreferences(chatId, user.sub, dto);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "chat-report",
    limit: 12,
    windowMs: 60 * 60 * 1000,
    scope: "user",
  })
  @Post(":chatId/report")
  async reportChat(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: CreateModerationReportDto,
  ) {
    return this.chatService.createModerationReport(chatId, user.sub, dto);
  }
}
