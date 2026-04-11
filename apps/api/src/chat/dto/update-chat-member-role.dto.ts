import { IsIn } from "class-validator";

export class UpdateChatMemberRoleDto {
  @IsIn(["admin", "member"])
  role!: "admin" | "member";
}
