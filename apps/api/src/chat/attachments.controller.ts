import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import type { JwtPayload } from "../common/types/jwt-payload";
import { ChatService } from "./chat.service";

@UseGuards(AccessTokenGuard)
@Controller("attachments")
export class AttachmentsController {
  constructor(private readonly chatService: ChatService) {}

  @Get(":attachmentId")
  async downloadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { absolutePath, attachment } = await this.chatService.getAttachmentDownload(
      attachmentId,
      user.sub,
    );
    const disposition = attachment.mimeType.startsWith("image/")
      ? "inline"
      : "attachment";
    const fileName = attachment.originalName.replace(/[\r\n\"]/g, "_");

    response.setHeader("Content-Type", attachment.mimeType);
    response.setHeader("Content-Length", String(attachment.sizeBytes));
    response.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${fileName}"`,
    );

    return new StreamableFile(createReadStream(absolutePath));
  }
}