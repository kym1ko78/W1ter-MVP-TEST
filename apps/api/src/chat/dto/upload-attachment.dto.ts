import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class UploadAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
