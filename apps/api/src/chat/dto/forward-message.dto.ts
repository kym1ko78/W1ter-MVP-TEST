import { IsUUID } from "class-validator";

export class ForwardMessageDto {
  @IsUUID()
  targetChatId!: string;
}
