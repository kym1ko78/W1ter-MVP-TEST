import { IsIn, IsOptional, IsString } from "class-validator";

export class DeleteMessageDto {
  @IsOptional()
  @IsString()
  @IsIn(["self", "everyone"])
  mode?: "self" | "everyone";
}
