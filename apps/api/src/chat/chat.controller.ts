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
import { DeleteMessageDto } from "./dto/delete-message.dto";
import { ForwardMessageDto } from "./dto/forward-message.dto";
import { MarkReadDto } from "./dto/mark-read.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { ToggleMessageReactionDto } from "./dto/toggle-message-reaction.dto";
import { UpdateChatMemberRoleDto } from "./dto/update-chat-member-role.dto";
import { UpdateMessageDto } from "./dto/update-message.dto";
import { UploadAttachmentDto } from "./dto/upload-attachment.dto";
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
  async addGroupMember(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: AddChatMemberDto,
  ) {
    return this.chatService.addGroupMember(chatId, user.sub, dto.userId);
  }

  @Delete(":chatId/members/:memberId")
  async removeGroupMember(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.chatService.removeGroupMember(chatId, user.sub, memberId);
  }

  @Patch(":chatId/members/:memberId/role")
  async updateGroupMemberRole(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateChatMemberRoleDto,
  ) {
    return this.chatService.updateGroupMemberRole(chatId, user.sub, memberId, dto.role);
  }

  @Post(":chatId/leave")
  async leaveGroup(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
  ) {
    return this.chatService.leaveGroup(chatId, user.sub);
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

  @Patch(":chatId/messages/:messageId")
  async editMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.chatService.editMessage(chatId, messageId, user.sub, dto.body);
  }

  @Post(":chatId/messages/:messageId/forward")
  async forwardMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.chatService.forwardMessage(chatId, messageId, dto.targetChatId, user.sub);
  }

  @Put(":chatId/messages/:messageId/reaction")
  async toggleMessageReaction(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: ToggleMessageReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(chatId, messageId, user.sub, dto.emoji);
  }

  @Delete(":chatId/messages/:messageId")
  async deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Param("messageId") messageId: string,
    @Body() dto: DeleteMessageDto,
  ) {
    return this.chatService.deleteMessage(chatId, messageId, user.sub, dto.mode);
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
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param("chatId") chatId: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.chatService.markRead(chatId, user.sub, dto.lastReadMessageId);
  }
}
