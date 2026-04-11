import { IsUUID } from "class-validator";

export class AddChatMemberDto {
  @IsUUID()
  userId!: string;
}
